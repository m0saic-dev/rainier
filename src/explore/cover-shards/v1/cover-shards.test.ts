import type {
  MosaicDocument,
  MosaicEngineContext,
  MosaicMediaSource,
  MosaicTemplatePropDefinition,
} from "@m0saic/types";
import { asAssetId } from "@m0saic/types";
import { validateM0String } from "@m0saic/dsl";
import {
  assertDefaultPropsComplete,
  auditRenderedTemplate,
  enforceTemplateConventions,
  resolveDocFrames,
  resolvePropBindings,
} from "@m0saic/template-utils";

import { unboundOf } from "../../../_shared/bindings";
import { asDocument, targetCtx } from "../../../__testutils__/render";
import { COVER_SHARDS_ID, CoverShardsV1, resolveCoverShardsKnobs } from "./cover-shards";
import { MAX_ROOT_SOURCES, PLACEHOLDER_PALETTE } from "./document";
import { sourceRects } from "./plan";

const COVER = "/media/cover-art.png";
const SONG = "/media/master.wav";
const CLIP = "/media/rehearsal.mov";

const image = (width: number, height: number) => ({ kind: "image", width, height, hasVideo: true, hasAudio: false });
const audio = () => ({ kind: "audio", width: 0, height: 0, hasVideo: false, hasAudio: true, durationMs: 200_000 });
const video = () => ({ kind: "video", width: 1920, height: 1080, hasVideo: true, hasAudio: true, durationMs: 60_000 });

type Props = Parameters<typeof CoverShardsV1.render>[0];

const ctxFor = (
  W: number,
  H: number,
  opts: { media?: Record<string, unknown>; mode?: "render" | "design"; askMs?: number } = {},
): MosaicEngineContext =>
  ({
    ...targetCtx(W, H, {
      durationMs: 6000,
      media: Object.fromEntries(Object.entries(opts.media ?? {}).map(([k, v]) => [asAssetId(k), v])) as MosaicEngineContext["media"],
    }),
    mode: opts.mode ?? "render",
    ...(opts.askMs ? { userIntent: { durationMs: opts.askMs } } : {}),
  }) as MosaicEngineContext;

const render = (props: Props = {}, ctx: MosaicEngineContext = ctxFor(1080, 1920)) =>
  CoverShardsV1.render({ ...CoverShardsV1.defaultProps, ...props }, ctx).then(asDocument);

const withCover = { [COVER]: image(3000, 3000) };

type AnySource = Record<string, unknown> & {
  type: string;
  editor?: { label?: string; binding?: { propKey: string }; bindings?: Array<{ propKey: string }> };
  overlay?: { xExpr?: string; yExpr?: string; enable?: string; window?: { startSec?: number; endSec?: number } };
};
const sourcesOf = (doc: MosaicDocument) => doc.sources as unknown as AnySource[];
const labelled = (doc: MosaicDocument, prefix: string) => sourcesOf(doc).filter((s) => s.editor?.label?.startsWith(prefix));
const boundTo = (s: AnySource) => [
  ...(s.editor?.binding ? [s.editor.binding.propKey] : []),
  ...(s.editor?.bindings ?? []).map((b) => b.propKey),
];
const isError = (doc: MosaicDocument) => doc.sources.some((s) => s.engine?.renderStatus === "error");

/**
 * The 0.3.0 roll call's schema side, mirrored from template-utils
 * `accountableProps` (monorepo auditRenderedTemplate.ts; 0.2.0 does not
 * export it): every prop that CAN carry a canvas handle, with its kind.
 */
function accountableProps(schema: Record<string, MosaicTemplatePropDefinition>): Array<{ key: string; kind: string }> {
  const closedOrPicked = (def: MosaicTemplatePropDefinition) => {
    const c = def.meta?.constraints as Record<string, unknown> | undefined;
    const k = def.meta?.control as Record<string, unknown> | undefined;
    return Boolean(
      (Array.isArray(c?.oneOf) && (c?.oneOf as unknown[]).length > 0) ||
        c?.isColor ||
        (Array.isArray(k?.options) && (k?.options as unknown[]).length > 0) ||
        k?.optionsFrom ||
        k?.optionsFromConnection ||
        k?.colorPicker ||
        k?.picker,
    );
  };
  const out: Array<{ key: string; kind: string }> = [];
  for (const [key, def] of Object.entries(schema)) {
    if (def.meta?.ui?.hidden) continue;
    if ((def.meta?.ui as Record<string, unknown> | undefined)?.consumer === "human") continue;
    const colour = Boolean(def.meta?.constraints?.isColor || (def.meta?.control as Record<string, unknown> | undefined)?.colorPicker);
    // `type: "array"` arrives with 0.3.0 types; the string compare keeps this walker honest for both.
    switch (def.type as string) {
      case "string":
        if (colour) out.push({ key, kind: "color" });
        else if (!closedOrPicked(def)) out.push({ key, kind: "string" });
        break;
      case "number":
        if (!closedOrPicked(def)) out.push({ key, kind: "number" });
        break;
      case "media":
        out.push({ key, kind: "media" });
        break;
      case "string[]":
      case "number[]":
      case "media[]":
        out.push({ key, kind: "element" });
        break;
      case "json":
      case "list":
      case "array":
        out.push({ key, kind: "leaf" });
        break;
      default:
        break;
    }
  }
  return out;
}

describe(`${COVER_SHARDS_ID}: metadata`, () => {
  it("puts cover, headline and subline first and shows every knob's default", () => {
    const primary = Object.entries(CoverShardsV1.propsSchema ?? {})
      .filter(([, d]) => d.meta?.ui?.primary)
      .map(([k]) => k);
    expect(primary).toEqual(["cover", "headline", "subline"]);
    expect(() => assertDefaultPropsComplete(CoverShardsV1)).not.toThrow();
    expect(CoverShardsV1.outputHints).toMatchObject({ width: 1080, height: 1920, fps: 30, durationMs: 6000, posterTimeMs: 5000 });
    expect(CoverShardsV1.outputHints?.format).toEqual({ kind: "video", container: "mp4" });
  });

  it("declares the cue-track picker on beats, reading the song, sixteen at most", () => {
    const control = CoverShardsV1.propsSchema?.beats?.meta?.control;
    expect(control?.picker).toBe("cue-track");
    expect(control?.cueTrack).toMatchObject({ mediaFromProp: "song", maxCues: 16, vocabulary: { item: "beat", media: "song" } });
  });

  it("has no fontFile prop in v1", () => {
    expect(Object.keys(CoverShardsV1.propsSchema ?? {})).not.toContain("fontFile");
  });

  it("passes the definition-time conventions", () => {
    // First-party mode throws on the first fatal finding; the rest come back as warnings.
    let findings: ReturnType<typeof enforceTemplateConventions> = [];
    expect(() => (findings = enforceTemplateConventions(CoverShardsV1))).not.toThrow();
    expect(findings.filter((f) => f.severity === "error")).toEqual([]);
  });

  it("clamps knobs and never throws on junk", () => {
    expect(resolveCoverShardsKnobs({ grid: "9" as never, order: "x" as never, revealSec: 99, gapPx: -3, seed: 1.6 })).toMatchObject({
      n: 4,
      order: "shuffle",
      revealSec: 10,
      gapPx: 0,
      seed: 2,
    });
  });
});

describe(`${COVER_SHARDS_ID}: the 0.3.0 roll call at the defaults`, () => {
  it("declares exactly the seven props with no rect, each with a reason", () => {
    const unbound = unboundOf(CoverShardsV1);
    expect(Object.keys(unbound).sort()).toEqual(["beats", "gapPx", "holdSec", "revealSec", "seed", "song", "songStartSec"]);
    for (const reason of Object.values(unbound)) expect(reason.trim()).not.toBe("");
  });

  it("binds cover, headline, subline and textColor, rejects nothing, and accounts for every prop", async () => {
    const doc = await render();
    const { byProp, rejected } = resolvePropBindings(doc, 1080, 1920, { propsSchema: CoverShardsV1.propsSchema });
    expect(rejected).toEqual([]);
    expect(Object.keys(byProp).sort()).toEqual(["cover", "headline", "subline", "textColor"]);
    expect(byProp.cover).toHaveLength(16);

    const declared = unboundOf(CoverShardsV1);
    const accountable = accountableProps(CoverShardsV1.propsSchema as Record<string, MosaicTemplatePropDefinition>);
    const defaults = CoverShardsV1.defaultProps as Record<string, unknown>;
    const background = String(doc.backgroundColor).toLowerCase();
    const missing = accountable.filter(({ key, kind }) => {
      if (byProp[key]) return false;
      if (kind === "color" && String(defaults[key]).toLowerCase() === background) return false;
      return !(key in declared);
    });
    expect(missing).toEqual([]);
    // Never declare a prop that is also bound, never declare one that cannot carry a handle.
    const keys = new Set(accountable.map((a) => a.key));
    for (const key of Object.keys(declared)) {
      expect(keys.has(key)).toBe(true);
      expect(byProp[key]).toBeUndefined();
    }
  });

  it("fills the canvas with document.backgroundColor (the page colour), never a full-canvas rect", async () => {
    for (const [w, h] of [
      [1080, 1920],
      [1080, 1350],
      [1080, 1080],
    ]) {
      const doc = await render({ pageColor: "#123456" }, ctxFor(w, h));
      expect(doc.backgroundColor).toBe("#123456");
      const { framesByLogical } = resolveDocFrames(doc, w, h);
      const flat = framesByLogical.filter((f, i) => {
        const s = sourcesOf(doc)[i];
        const plain = s.type === "lavfi" && typeof s.color === "string" && !s.overlay && !s.mask && !s.placement && !s.effects;
        return plain && f.x === 0 && f.y === 0 && f.width === w && f.height === h;
      });
      expect(flat).toEqual([]);
    }
  });

  it("renders the defaults: 16 placeholder shards in four colours, valid m0, deterministic, about 6 s", async () => {
    const doc = await render();
    expect(validateM0String(String(doc.m0)).ok).toBe(true);
    const shards = labelled(doc, "shard-");
    expect(shards).toHaveLength(16);
    expect(new Set(shards.map((s) => s.color))).toEqual(new Set(PLACEHOLDER_PALETTE));
    for (const s of shards) expect(boundTo(s)).toEqual(["cover"]);
    expect(doc.durationMs).toBe(6000);
    expect(doc.size).toEqual({ width: 1080, height: 1920 });
    expect(doc.format).toEqual({ kind: "video", container: "mp4" });
    expect(doc.audio).toMatchObject({ codec: "aac", bitrate: "320k" });
    expect(await render()).toEqual(doc);
    expect(labelled(doc, "design-note")).toEqual([]);
    expect(labelled(doc, "song")).toEqual([]);
  });

  it("passes the installed render-time audit with no error", async () => {
    const audit = await auditRenderedTemplate(CoverShardsV1, { record: false, sweepCanvases: [{ width: 1080, height: 1350 }, { width: 1080, height: 1080 }] });
    expect(audit.skipped).toBeUndefined();
    expect(audit.findings.filter((f) => f.severity === "error")).toEqual([]);
  });
});

describe(`${COVER_SHARDS_ID}: the cover`, () => {
  it("cuts a probed 3000x3000 cover into 16 windows of itself, each bound to cover", async () => {
    const doc = await render({ cover: COVER }, ctxFor(1080, 1920, { media: withCover }));
    const shards = labelled(doc, "shard-") as unknown as MosaicMediaSource[];
    expect(shards).toHaveLength(16);
    const expected = sourceRects(3000, 3000, 4) ?? [];
    for (const s of shards) {
      expect(s.type).toBe("media");
      expect(s.mediaType).toBe("image");
      expect(s.placement?.fit).toBe("cover");
      const cell = Number(String(s.editor?.label).slice("shard-".length)) - 1;
      expect(s.placement?.sourceRect).toEqual(expected[cell]);
      expect(boundTo(s as unknown as AnySource)).toEqual(["cover"]);
    }
    expect(Object.values(doc.assets)).toEqual([{ kind: "file", path: COVER, mediaType: "image" }]);
  });

  it("makes four with grid 2 and nine with grid 3", async () => {
    const ctx = ctxFor(1080, 1920, { media: withCover });
    expect(labelled(await render({ cover: COVER, grid: "2" }, ctx), "shard-")).toHaveLength(4);
    expect(labelled(await render({ cover: COVER, grid: "3" }, ctx), "shard-")).toHaveLength(9);
  });

  it("crops a landscape cover to its centred square", async () => {
    const doc = await render({ cover: COVER, grid: "2" }, ctxFor(1080, 1080, { media: { [COVER]: image(4000, 3000) } }));
    const rects = (labelled(doc, "shard-") as unknown as MosaicMediaSource[]).map((s) => s.placement?.sourceRect);
    expect(rects).toEqual(expect.arrayContaining([{ x: 500, y: 0, w: 1500, h: 1500 }, { x: 2000, y: 1500, w: 1500, h: 1500 }]));
  });

  it("an unreadable cover is an error card in a render, the placeholder plus a note in Make", async () => {
    const renderDoc = await render({ cover: COVER });
    expect(isError(renderDoc)).toBe(true);
    const notPicture = await render({ cover: CLIP }, ctxFor(1080, 1920, { media: { [CLIP]: video() } }));
    expect(isError(notPicture)).toBe(true);

    const designDoc = await render({ cover: COVER }, ctxFor(1080, 1920, { mode: "design" }));
    expect(isError(designDoc)).toBe(false);
    expect(labelled(designDoc, "shard-").every((s) => s.type === "lavfi")).toBe(true);
    expect(labelled(designDoc, "shard-").every((s) => boundTo(s)[0] === "cover")).toBe(true);
    expect(labelled(designDoc, "design-note")).toHaveLength(1);
  });

  it("shows the empty-state hint only in Make's design pass", async () => {
    expect(labelled(await render({}, ctxFor(1080, 1920, { mode: "design" })), "design-note")).toHaveLength(1);
    expect(labelled(await render({ cover: COVER }, ctxFor(1080, 1920, { media: withCover, mode: "design" })), "design-note")).toEqual([]);
  });
});

describe(`${COVER_SHARDS_ID}: text`, () => {
  it("draws headline and subline as glyph tiles bound with textColor", async () => {
    const doc = await render({ textColor: "#FF00AA" });
    for (const key of ["headline", "subline"]) {
      const [tile] = labelled(doc, key);
      expect(tile.type).toBe("lavfi");
      expect(tile.color).toBe("#FF00AA");
      expect((tile.mask as { kind: string }).kind).toBe("inline-mask");
      expect(boundTo(tile)).toEqual([key, "textColor"]);
    }
  });

  it("keeps an empty subline reachable: a transparent tile of its box, still bound", async () => {
    const doc = await render({ subline: "   " });
    const [tile] = labelled(doc, "subline");
    expect(tile.color).toBe("#FFFFFF@0");
    expect(tile.mask).toBeUndefined();
    expect(boundTo(tile)).toEqual(["subline", "textColor"]);
  });

  it("enters after the reveal: headline first, subline after", async () => {
    const doc = await render();
    const at = (key: string) => Number(labelled(doc, key)[0].overlay?.window?.startSec);
    expect(at("headline")).toBeCloseTo(3.1, 6);
    expect(at("subline")).toBeCloseTo(3.25, 6);
  });

  it("adds a scrim under the text on a square canvas only", async () => {
    expect(labelled(await render({}, ctxFor(1080, 1080)), "scrim")).toHaveLength(1);
    expect(labelled(await render({}, ctxFor(1080, 1920)), "scrim")).toEqual([]);
    expect(labelled(await render({}, ctxFor(1080, 1350)), "scrim")).toEqual([]);
  });
});

describe(`${COVER_SHARDS_ID}: timing and motion`, () => {
  it("never puts a comma or a colon in xExpr / yExpr, and enable agrees with window on every source", async () => {
    for (const motion of ["rise", "slide", "float", "fade"] as const) {
      const doc = await render({ motion, cover: COVER }, ctxFor(1080, 1080, { media: withCover }));
      for (const s of sourcesOf(doc)) {
        const o = s.overlay;
        if (!o) continue;
        for (const e of [o.xExpr, o.yExpr]) if (e !== undefined) expect(e).not.toMatch(/[,:]/);
        if (o.enable !== undefined || o.window !== undefined) {
          const m = /^gte\(t,(\d+(?:\.\d+)?)\)$/.exec(String(o.enable));
          expect(m).not.toBeNull();
          expect(o.window).toEqual({ startSec: Number(m?.[1]) });
        }
      }
    }
  });

  it("lands shards on tapped beats (through Song start) and lengthens past the reveal", async () => {
    const beats = [
      { text: "1", startMs: 11_000 },
      { text: "2", startMs: 12_000 },
      { text: "3", startMs: 13_000 },
      { text: "4", startMs: 14_000 },
    ];
    const doc = await render({ grid: "2", order: "rows", beats, songStartSec: 10 });
    const starts = labelled(doc, "shard-").map((s) => Number(s.overlay?.window?.startSec)).sort((a, b) => a - b);
    expect(starts).toEqual([0.65, 1.65, 2.65, 3.65]);
    expect(doc.durationMs).toBe(Math.round((4 + 0.4 + 3) * 1000));
  });

  it("lets an explicit length from the host win", async () => {
    const doc = await render({}, ctxFor(1080, 1920, { askMs: 9000 }));
    expect(doc.durationMs).toBe(9000);
  });

  it("stacks a moving shard over the neighbour it crosses, in at most n shard layers", async () => {
    const doc = await render({ motion: "rise", order: "rows" });
    // Frames are emitted layer by layer: rise puts the TOP row in the top-most shard layer.
    const rows = labelled(doc, "shard-").map((s) => Math.floor((Number(String(s.editor?.label).slice(6)) - 1) / 4));
    expect(rows.slice(0, 4)).toEqual([3, 3, 3, 3]);
    expect(rows.slice(12)).toEqual([0, 0, 0, 0]);
  });
});

describe(`${COVER_SHARDS_ID}: song and budget`, () => {
  it("adds the song as an audio-only leaf only when set, trimmed to Song start", async () => {
    expect(labelled(await render(), "song")).toEqual([]);
    const doc = await render({ song: SONG, songStartSec: 30.05 }, ctxFor(1080, 1920, { media: { [SONG]: audio() } }));
    const [leaf] = labelled(doc, "song") as unknown as MosaicMediaSource[];
    expect(leaf.mediaType).toBe("audio");
    expect(leaf.playback?.clipStartMs).toBe(30050);
    expect(leaf.audio).toEqual({ enabled: true, volume: 1 });
    expect(boundTo(leaf as unknown as AnySource)).toEqual([]);
    const noStart = await render({ song: SONG }, ctxFor(1080, 1920, { media: { [SONG]: audio() } }));
    expect((labelled(noStart, "song")[0] as unknown as MosaicMediaSource).playback).toBeUndefined();
  });

  it("keeps the cover and a same-named song apart (release.png and release.wav are two assets)", async () => {
    const cover = "/art/release.png";
    const song = "/audio/release.wav";
    const doc = await render({ cover, song, grid: "2" }, ctxFor(1080, 1920, { media: { [cover]: image(2000, 2000), [song]: audio() } }));
    const byPath = Object.fromEntries(Object.entries(doc.assets).map(([id, a]) => [(a as { path: string }).path, id]));
    expect(Object.keys(byPath).sort()).toEqual([song, cover].sort());
    expect(byPath[cover]).not.toBe(byPath[song]);
    for (const s of labelled(doc, "shard-") as unknown as MosaicMediaSource[]) expect(s.assetId).toBe(byPath[cover]);
    expect((labelled(doc, "song")[0] as unknown as MosaicMediaSource).assetId).toBe(byPath[song]);
  });

  it("a song with no sound, or a Song start past its end, is an error card in a render and a note in Make", async () => {
    const silent = { [CLIP]: { ...video(), hasAudio: false } };
    expect(isError(await render({ song: CLIP }, ctxFor(1080, 1920, { media: silent })))).toBe(true);
    const design = await render({ song: CLIP }, ctxFor(1080, 1920, { media: silent, mode: "design" }));
    expect(isError(design)).toBe(false);
    expect(labelled(design, "song")).toEqual([]);
    expect(labelled(design, "design-note")).toHaveLength(1);

    const short = { [SONG]: { ...audio(), durationMs: 20_000 } };
    expect(isError(await render({ song: SONG, songStartSec: 25 }, ctxFor(1080, 1920, { media: short })))).toBe(true);
    expect(isError(await render({ song: SONG, songStartSec: 15 }, ctxFor(1080, 1920, { media: short })))).toBe(false);
  });

  it("takes a blank colour as the default and turns junk into an error card", async () => {
    const blank = await render({ pageColor: "", textColor: "" });
    expect(blank.backgroundColor).toBe("#0E0E10");
    expect(labelled(blank, "headline")[0].color).toBe("#FFFFFF");
    expect(isError(await render({ textColor: "white" }))).toBe(true);
    expect(isError(await render({ pageColor: "#12345" }))).toBe(true);
  });

  it("stays within 20 sources on the root for every grid, canvas, mode, cover and song", async () => {
    for (const grid of ["2", "3", "4"] as const) {
      for (const [w, h] of [
        [1080, 1920],
        [1080, 1350],
        [1080, 1080],
      ]) {
        for (const mode of ["render", "design"] as const) {
          for (const song of [undefined, SONG]) {
            for (const cover of [undefined, COVER]) {
              const media = { ...(song ? { [SONG]: audio() } : {}), ...(cover ? withCover : {}) };
              const doc = await render({ grid, song, cover }, ctxFor(w, h, { media, mode }));
              expect(doc.sources.length).toBeLessThanOrEqual(MAX_ROOT_SOURCES);
              expect(validateM0String(String(doc.m0)).ok).toBe(true);
            }
          }
        }
      }
    }
  });
});
