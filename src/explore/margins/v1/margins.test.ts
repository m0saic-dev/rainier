import type {
  MosaicDocument,
  MosaicEngineContext,
  MosaicMediaSource,
  MosaicTemplatePropDefinition,
  MosaicTimedCue,
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
import { FADE_SEC, HIGHLIGHT_ALPHA_DARK, HIGHLIGHT_ALPHA_LIGHT, MAX_ROOT_SOURCES, NEVER_ENABLE } from "./document";
import { MARGINS_ID, MarginsV1, resolveLineBoxes, resolveMarginsKnobs } from "./margins";
import { BAND_X0, BAND_X1, defaultLineBoxes, pageContentRect, placeholderBlock } from "./marks";
import { MAX_LINES } from "./timing";

const PAGE = "/media/lyric-page.jpg";
const MEMO = "/media/voice-memo.m4a";

const image = (width: number, height: number) => ({ kind: "image", width, height, hasVideo: true, hasAudio: false });
const audio = (durationMs: number) => ({ kind: "audio", width: 0, height: 0, hasVideo: false, hasAudio: true, durationMs });

type Props = Parameters<typeof MarginsV1.render>[0];

const ctxFor = (
  W: number,
  H: number,
  opts: { media?: Record<string, unknown>; mode?: "render" | "design"; askMs?: number } = {},
): MosaicEngineContext =>
  ({
    ...targetCtx(W, H, {
      durationMs: 10_000,
      media: Object.fromEntries(Object.entries(opts.media ?? {}).map(([k, v]) => [asAssetId(k), v])) as MosaicEngineContext["media"],
    }),
    mode: opts.mode ?? "render",
    ...(opts.askMs ? { userIntent: { durationMs: opts.askMs } } : {}),
  }) as MosaicEngineContext;

const render = (props: Props = {}, ctx: MosaicEngineContext = ctxFor(1080, 1920)) =>
  MarginsV1.render({ ...MarginsV1.defaultProps, ...props }, ctx).then(asDocument);

type AnyBinding = { propKey: string; index?: number; kind?: string };
type AnySource = Record<string, unknown> & {
  type: string;
  color?: string;
  mediaType?: string;
  playback?: { clipStartMs?: number };
  placement?: { fit?: string; inset?: Record<string, number> };
  mask?: { kind: string; localPath: string; bounds: { x: number; y: number; width: number; height: number }; strokes?: unknown[] };
  editor?: { label?: string; binding?: AnyBinding; bindings?: AnyBinding[] };
  overlay?: {
    xExpr?: string;
    yExpr?: string;
    enable?: string;
    alpha?: string;
    blendMode?: string;
    window?: { startSec?: number; endSec?: number };
  };
};
const sourcesOf = (doc: MosaicDocument) => doc.sources as unknown as AnySource[];
const labelled = (doc: MosaicDocument, prefix: string) => sourcesOf(doc).filter((s) => s.editor?.label?.startsWith(prefix));
const marksOf = (doc: MosaicDocument) =>
  labelled(doc, "mark-").sort((a, b) => lineOf(a) - lineOf(b));
const lineOf = (s: AnySource) => Number(String(s.editor?.label).slice("mark-".length)) - 1;
const bindingsOf = (s: AnySource): AnyBinding[] => [...(s.editor?.binding ? [s.editor.binding] : []), ...(s.editor?.bindings ?? [])];
const isError = (doc: MosaicDocument) => doc.sources.some((s) => s.engine?.renderStatus === "error");
const cues = (starts: Array<number | undefined>): MosaicTimedCue[] =>
  starts.map((s, i) => ({ text: `line ${i + 1}`, ...(s !== undefined ? { startMs: s } : {}) }));

/**
 * A mark's painted rect: its m0 frame with the inset recovery applied
 * (canvas px, fractional: the lattice cell and the integer frame can differ
 * by half a pixel, which the engine's own rounding absorbs).
 */
function paintedRect(doc: MosaicDocument, W: number, H: number, s: AnySource) {
  const i = sourcesOf(doc).indexOf(s);
  const f = resolveDocFrames(doc, W, H).framesByLogical[i];
  const ins = { top: 0, right: 0, bottom: 0, left: 0, ...(s.placement?.inset ?? {}) };
  const x = f.x + f.width * ins.left;
  const y = f.y + f.height * ins.top;
  return { x, y, w: f.x + f.width * (1 - ins.right) - x, h: f.y + f.height * (1 - ins.bottom) - y };
}

/** Each mark paints `expected[i]` to within a pixel, and its mask is exactly the box's size. */
function expectMarksAt(doc: MosaicDocument, W: number, H: number, expected: Array<{ x: number; y: number; w: number; h: number }>) {
  const marks = marksOf(doc);
  expect(marks).toHaveLength(expected.length);
  marks.forEach((m, i) => {
    const r = paintedRect(doc, W, H, m);
    const e = expected[i];
    for (const k of ["x", "y", "w", "h"] as const) expect(Math.abs(r[k] - e[k])).toBeLessThanOrEqual(1);
    expect(m.mask?.bounds).toEqual({ x: 0, y: 0, width: e.w, height: e.h });
  });
}

/**
 * The 0.3.0 roll call's schema side, mirrored from template-utils
 * `accountableProps` (m0saic monorepo auditRenderedTemplate.ts ~586-624;
 * 0.2.0 does not export it): every prop that CAN carry a canvas handle.
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
    const control = def.meta?.control as Record<string, unknown> | undefined;
    const colour = Boolean(def.meta?.constraints?.isColor || control?.colorPicker);
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
        out.push({ key, kind: control?.picker === "regions" ? "rect" : "leaf" });
        break;
      default:
        break;
    }
  }
  return out;
}

describe(`${MARGINS_ID}: metadata`, () => {
  it("puts page, audio and lines first and shows every knob's default", () => {
    const primary = Object.entries(MarginsV1.propsSchema ?? {})
      .filter(([, d]) => d.meta?.ui?.primary)
      .map(([k]) => k);
    expect(primary).toEqual(["page", "audio", "lines"]);
    expect(() => assertDefaultPropsComplete(MarginsV1)).not.toThrow();
    expect(MarginsV1.outputHints).toMatchObject({ width: 1080, height: 1920, fps: 30, durationMs: 10_000, posterTimeMs: 7000 });
    expect(MarginsV1.outputHints?.format).toEqual({ kind: "video", container: "mp4" });
  });

  it("times lines in the cue-track studio against the audio, sixteen at most", () => {
    const control = MarginsV1.propsSchema?.lines?.meta?.control;
    expect(control?.picker).toBe("cue-track");
    expect(control?.cueTrack).toMatchObject({ mediaFromProp: "audio", maxCues: 16, vocabulary: { item: "line", media: "recording" } });
    expect(MAX_LINES).toBe(16);
    expect(MarginsV1.propsSchema?.lineBoxes?.meta?.control).toEqual({ picker: "regions", regions: { shapes: ["rect"] } });
  });

  it("has three styles in v1 and no text or font props (the template writes no text)", () => {
    expect(MarginsV1.propsSchema?.style?.meta?.constraints?.oneOf).toEqual(["highlight", "underline", "box"]);
    const keys = Object.keys(MarginsV1.propsSchema ?? {});
    for (const k of ["font", "fontFile", "text", "headline", "spotlight", "drift"]) expect(keys).not.toContain(k);
  });

  it("passes the definition-time conventions", () => {
    let findings: ReturnType<typeof enforceTemplateConventions> = [];
    expect(() => (findings = enforceTemplateConventions(MarginsV1))).not.toThrow();
    expect(findings.filter((f) => f.severity === "error")).toEqual([]);
  });

  it("clamps knobs and never throws on junk", () => {
    expect(
      resolveMarginsKnobs({ style: "spotlight" as never, pageFit: "fill", audioStartSec: -4, lengthSec: 999, placing: undefined }),
    ).toEqual({ style: "highlight", pageTone: "light", past: "keep", fit: "cover", audioStartSec: 0, lengthSec: 180, placing: true });
  });
});

describe(`${MARGINS_ID}: the 0.3.0 roll call at the defaults`, () => {
  it("declares exactly audio, lines, audioStartSec and lengthSec, each with a reason", () => {
    const unbound = unboundOf(MarginsV1);
    expect(Object.keys(unbound).sort()).toEqual(["audio", "audioStartSec", "lengthSec", "lines"]);
    for (const reason of Object.values(unbound)) expect(reason.trim()).not.toBe("");
  });

  it("binds page, lineBoxes and markColor, rejects nothing, and accounts for every prop", async () => {
    const doc = await render();
    const { byProp, rejected } = resolvePropBindings(doc, 1080, 1920, { propsSchema: MarginsV1.propsSchema });
    expect(rejected).toEqual([]);
    expect(Object.keys(byProp).sort()).toEqual(["lineBoxes", "markColor", "page"]);
    expect(byProp.lineBoxes.map((b) => b.index)).toEqual([0, 1, 2, 3, 4]);
    expect(byProp.lineBoxes.every((b) => b.kind === "rect")).toBe(true);
    expect(byProp.markColor.every((b) => b.kind === "color")).toBe(true);

    const declared = unboundOf(MarginsV1);
    const accountable = accountableProps(MarginsV1.propsSchema as Record<string, MosaicTemplatePropDefinition>);
    expect(accountable.map((a) => a.key).sort()).toEqual(
      ["audio", "audioStartSec", "lengthSec", "lineBoxes", "lines", "markColor", "page", "paperColor"].sort(),
    );
    const defaults = MarginsV1.defaultProps as Record<string, unknown>;
    const background = String(doc.backgroundColor).toLowerCase();
    const missing = accountable.filter(({ key, kind }) => {
      if (byProp[key]) return false;
      if (kind === "color" && String(defaults[key]).toLowerCase() === background) return false;
      return !(key in declared);
    });
    expect(missing).toEqual([]);
    const keys = new Set(accountable.map((a) => a.key));
    for (const key of Object.keys(declared)) {
      expect(keys.has(key)).toBe(true);
      expect(byProp[key]).toBeUndefined();
    }
    // Every bound prop explains itself (0.3.0 bindingHints: the description shows under the inline editor).
    for (const key of Object.keys(byProp)) expect(String(MarginsV1.propsSchema?.[key as keyof Props]?.description).trim()).not.toBe("");
  });

  it("binds mark i to lineBoxes[i] (the rect handle first) and markColor beside it, even with no boxes drawn", async () => {
    const doc = await render({ lineBoxes: undefined });
    const marks = marksOf(doc);
    expect(marks).toHaveLength(5);
    marks.forEach((m, i) => {
      expect(bindingsOf(m)).toEqual([{ propKey: "lineBoxes", index: i, kind: "rect" }, { propKey: "markColor" }]);
    });
  });

  it("renders the defaults: ruled paper and five untimed lines over 10 s, valid m0, deterministic", async () => {
    const doc = await render();
    expect(isError(doc)).toBe(false);
    expect(validateM0String(String(doc.m0)).ok).toBe(true);
    expect(doc.durationMs).toBe(10_000);
    expect(doc.size).toEqual({ width: 1080, height: 1920 });
    expect(doc.format).toEqual({ kind: "video", container: "mp4" });
    expect(doc.audio).toMatchObject({ codec: "aac", bitrate: "320k" });
    expect(doc.backgroundColor).toBe("#F4EFE4");
    expect(marksOf(doc).map((m) => m.overlay?.window)).toEqual([
      { startSec: 0, endSec: 10 },
      { startSec: 2, endSec: 10 },
      { startSec: 4, endSec: 10 },
      { startSec: 6, endSec: 10 },
      { startSec: 8, endSec: 10 },
    ]);
    // Poster at 7 s: four lines marked.
    expect(marksOf(doc).filter((m) => (m.overlay?.window?.startSec ?? 0) <= 7)).toHaveLength(4);
    expect(await render()).toEqual(doc);
    expect(labelled(doc, "audio")).toEqual([]);
  });

  it("fills the canvas with document.backgroundColor (the paper colour), never a full-canvas colour rect", async () => {
    for (const [w, h] of [
      [1080, 1920],
      [720, 1280],
      [1080, 1080],
    ]) {
      const doc = await render({ paperColor: "#123456" }, ctxFor(w, h));
      expect(doc.backgroundColor).toBe("#123456");
      const { framesByLogical } = resolveDocFrames(doc, w, h);
      const flat = framesByLogical.filter((f, i) => {
        const s = sourcesOf(doc)[i];
        const plain = s.type === "lavfi" && typeof s.color === "string" && !s.overlay && !s.mask && !s.placement && !s.effects;
        return plain && f.x === 0 && f.y === 0 && f.width === w && f.height === h;
      });
      expect(flat).toEqual([]);
      expect(validateM0String(String(doc.m0)).ok).toBe(true);
    }
  });

  it("never moves a mark: no xExpr or yExpr anywhere", async () => {
    for (const props of [{}, { style: "underline" as const }, { style: "box" as const, pageTone: "dark" as const }]) {
      const doc = await render(props);
      for (const s of sourcesOf(doc)) {
        expect(s.overlay?.xExpr).toBeUndefined();
        expect(s.overlay?.yExpr).toBeUndefined();
      }
    }
  });

  it("passes the installed render-time audit with no error", async () => {
    const audit = await auditRenderedTemplate(MarginsV1, {
      record: false,
      sweepCanvases: [
        { width: 720, height: 1280 },
        { width: 1080, height: 1080 },
      ],
    });
    expect(audit.skipped).toBeUndefined();
    expect(audit.findings.filter((f) => f.severity === "error")).toEqual([]);
  });
});

describe(`${MARGINS_ID}: the page`, () => {
  const withPage = { [PAGE]: image(3000, 4000) };

  it("shows the photo whole (contain) or filling the frame (cover), bound to page, and drops the placeholder", async () => {
    const whole = await render({ page: PAGE }, ctxFor(1080, 1920, { media: withPage }));
    const [photo] = labelled(whole, "page") as unknown as MosaicMediaSource[];
    expect(photo.type).toBe("media");
    expect(photo.mediaType).toBe("image");
    expect(photo.placement?.fit).toBe("contain");
    expect(bindingsOf(photo as unknown as AnySource)).toEqual([{ propKey: "page" }]);
    expect(labelled(whole, "page:")).toEqual([]);
    expect(Object.values(whole.assets)).toEqual([{ kind: "file", path: PAGE, mediaType: "image" }]);
    const fill = await render({ page: PAGE, pageFit: "fill" }, ctxFor(1080, 1920, { media: withPage }));
    expect((labelled(fill, "page")[0] as unknown as MosaicMediaSource).placement?.fit).toBe("cover");
  });

  it("lays the default bands over the page's content rect: whole page, or the full frame", async () => {
    const ctx = ctxFor(1080, 1920, { media: withPage });
    const whole = await render({ page: PAGE }, ctx);
    const content = pageContentRect(1080, 1920, "contain", { width: 3000, height: 4000 });
    expectMarksAt(whole, 1080, 1920, defaultLineBoxes(5, content));
    const fill = await render({ page: PAGE, pageFit: "fill" }, ctx);
    expectMarksAt(fill, 1080, 1920, defaultLineBoxes(5, { x: 0, y: 0, w: 1080, h: 1920 }));
  });

  it("with no page, fills in ruled paper bound to page (a masked tile) and an unbound squiggle stand-in", async () => {
    const doc = await render();
    const [paper] = labelled(doc, "page:placeholder");
    expect(paper.mask?.kind).toBe("inline-mask");
    expect(paper.mask?.bounds).toEqual({ x: 0, y: 0, width: 1080, height: 1920 });
    expect(bindingsOf(paper)).toEqual([{ propKey: "page" }]);
    const [scribble] = labelled(doc, "page:scribble");
    expect(scribble.mask?.strokes?.length).toBeGreaterThan(0);
    expect(bindingsOf(scribble)).toEqual([]);
    // The bands sit on the placeholder's five written lines.
    expectMarksAt(doc, 1080, 1920, defaultLineBoxes(5, placeholderBlock(1080, 1920)));
  });

  it("a page that is not a picture is an error card in a render, the placeholder in Make", async () => {
    const media = { [PAGE]: audio(20_000) };
    expect(isError(await render({ page: PAGE }, ctxFor(1080, 1920, { media })))).toBe(true);
    const design = await render({ page: PAGE }, ctxFor(1080, 1920, { media, mode: "design" }));
    expect(isError(design)).toBe(false);
    expect(labelled(design, "page:placeholder")).toHaveLength(1);
  });

  it("keeps the page and a same-named recording apart (release.jpg and release.m4a are two assets)", async () => {
    const page = "/media/release.jpg";
    const memo = "/media/release.m4a";
    const media = { [page]: image(3000, 4000), [memo]: audio(60_000) };
    const doc = await render({ page, audio: memo, lines: cues([1000]) }, ctxFor(1080, 1920, { media }));
    const byPath = Object.fromEntries(Object.entries(doc.assets).map(([id, a]) => [(a as { path: string }).path, id]));
    expect(Object.keys(byPath).sort()).toEqual([memo, page].sort());
    expect(byPath[page]).not.toBe(byPath[memo]);
    expect(doc.assets[asAssetId(byPath[page])]).toEqual({ kind: "file", path: page, mediaType: "image" });
    expect(doc.assets[asAssetId(byPath[memo])]).toEqual({ kind: "file", path: memo, mediaType: "audio" });
    const [photo] = labelled(doc, "page") as unknown as MosaicMediaSource[];
    expect(photo.assetId).toBe(byPath[page]);
    expect((labelled(doc, "audio")[0] as unknown as MosaicMediaSource).assetId).toBe(byPath[memo]);
  });

  it("refuses a colour that is not #rrggbb", async () => {
    expect(isError(await render({ markColor: "yellow" }))).toBe(true);
    expect(isError(await render({ paperColor: "#FFF" }))).toBe(true);
  });
});

describe(`${MARGINS_ID}: line boxes`, () => {
  const drawn = (canvas: { w: number; h: number }, n: number) => ({
    canvas,
    regions: Array.from({ length: n }, (_, i) => ({ kind: "rect", x: 100, y: 300 + i * 200, w: 600, h: 120 })),
  });

  it("ignores a list of the wrong length: the default bands apply", async () => {
    for (const n of [3, 6]) {
      const doc = await render({ lineBoxes: drawn({ w: 1080, h: 1920 }, n) });
      expectMarksAt(doc, 1080, 1920, defaultLineBoxes(5, placeholderBlock(1080, 1920)));
    }
    expect(resolveLineBoxes("not json", 2, { W: 1080, H: 1920 }, placeholderBlock(1080, 1920)).custom).toBe(false);
  });

  it("uses a list of the right length, rescaled from the canvas it was drawn on", async () => {
    const value = drawn({ w: 1080, h: 1920 }, 5);
    const big = await render({ lineBoxes: value });
    expectMarksAt(big, 1080, 1920, value.regions.map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h })));
    const small = await render({ lineBoxes: value }, ctxFor(720, 1280));
    const k = 720 / 1080;
    const scaled = value.regions.map((r) => ({ x: Math.round(r.x * k), y: Math.round(r.y * k), w: Math.round(r.w * k), h: Math.round(r.h * k) }));
    expect(resolveLineBoxes(value, 5, { W: 720, H: 1280 }, placeholderBlock(720, 1280))).toEqual({ boxes: scaled, custom: true });
    expectMarksAt(small, 720, 1280, scaled);
  });

  it("sizes each mask's bounds to its box, so a resized box redraws its stroke", async () => {
    const doc = await render({ lineBoxes: drawn({ w: 1080, h: 1920 }, 5), style: "underline" });
    for (const m of marksOf(doc)) expect(m.mask?.bounds).toEqual({ x: 0, y: 0, width: 600, height: 120 });
  });

  it("puts default bands from 8 % to 92 % of the content width", () => {
    const content = { x: 0, y: 240, w: 1080, h: 1440 };
    const { boxes } = resolveLineBoxes(undefined, 4, { W: 1080, H: 1920 }, content);
    for (const b of boxes) {
      expect(b.x).toBe(Math.round(BAND_X0 * 1080));
      expect(b.x + b.w).toBe(Math.round(BAND_X1 * 1080));
    }
  });
});

describe(`${MARGINS_ID}: timing`, () => {
  const media = { [MEMO]: audio(60_000) };
  const ctx = (mode: "render" | "design" = "render") => ctxFor(1080, 1920, { media, mode });

  it("plays the recording from Audio start as an unbound audio-only leaf", async () => {
    const doc = await render({ audio: MEMO, audioStartSec: 12.5, lines: cues([13_000, 15_000]) }, ctx());
    const [leaf] = labelled(doc, "audio");
    expect(leaf).toMatchObject({ type: "media", mediaType: "audio", playback: { clipStartMs: 12_500 } });
    expect(bindingsOf(leaf)).toEqual([]);
    expect(Object.values(doc.assets)).toContainEqual({ kind: "file", path: MEMO, mediaType: "audio" });
  });

  it("runs the clip to the last marked line plus 1.5 s, and Length wins when set", async () => {
    const lines = cues([1000, 3000, 5000]);
    expect((await render({ audio: MEMO, lines }, ctx())).durationMs).toBe(8500);
    expect((await render({ audio: MEMO, lines, lengthSec: 20 }, ctx())).durationMs).toBe(20_000);
  });

  it("past: keep holds every mark to the clip's end; clear lets it go when the line ends", async () => {
    const lines = cues([1000, 3000, 5000]);
    const keep = await render({ audio: MEMO, lines }, ctx());
    expect(marksOf(keep).map((m) => m.overlay?.window)).toEqual([
      { startSec: 1, endSec: 8.5 },
      { startSec: 3, endSec: 8.5 },
      { startSec: 5, endSec: 8.5 },
    ]);
    const clear = await render({ audio: MEMO, lines, past: "clear" }, ctx());
    expect(marksOf(clear).map((m) => m.overlay?.window)).toEqual([
      { startSec: 1, endSec: 3 },
      { startSec: 3, endSec: 5 },
      { startSec: 5, endSec: 7 },
    ]);
  });

  it("agrees enable with window on every mark, and fades each in over 120 ms", async () => {
    for (const props of [{}, { past: "clear" as const }, { style: "box" as const, pageTone: "dark" as const }]) {
      const doc = await render({ audio: MEMO, lines: cues([1000, undefined, undefined, 7000, 9000]), ...props }, ctx());
      for (const m of marksOf(doc)) {
        const w = m.overlay?.window as { startSec: number; endSec: number };
        expect(m.overlay?.enable).toBe(`between(t,${w.startSec.toFixed(3)},${w.endSec.toFixed(3)})`);
        expect(m.overlay?.alpha).toContain(`(t-${w.startSec})/${FADE_SEC}`);
      }
    }
  });

  it("shares a gap between taps evenly among the untimed lines", async () => {
    const doc = await render({ audio: MEMO, lines: cues([1000, undefined, undefined, 7000]) }, ctx());
    expect(marksOf(doc).map((m) => m.overlay?.window?.startSec)).toEqual([1, 3, 5, 7]);
  });

  it("drops lines sung before Audio start in a render; Make keeps an invisible tile so every box stays reachable", async () => {
    const lines = cues([1000, 3000, 5000, 7000]);
    const doc = await render({ audio: MEMO, lines, audioStartSec: 5 }, ctx());
    expect(marksOf(doc).map(lineOf)).toEqual([2, 3]);
    expect(marksOf(doc).map((m) => m.overlay?.window?.startSec)).toEqual([0, 2]);
    // A line straddling the start shows from 0.
    const straddle = await render({ audio: MEMO, lines, audioStartSec: 4 }, ctx());
    expect(marksOf(straddle).map((m) => m.overlay?.window?.startSec)).toEqual([0, 1, 3]);
    const design = await render({ audio: MEMO, lines, audioStartSec: 5, placing: false }, ctx("design"));
    expect(marksOf(design).map(lineOf)).toEqual([0, 1, 2, 3]);
    const [first, second] = marksOf(design);
    for (const m of [first, second]) {
      expect(m.overlay?.enable).toBe(NEVER_ENABLE);
      expect(m.overlay?.window).toBeUndefined();
    }
  });

  it("design + placing shows every mark with no window; placing off follows the timing; a render ignores placing", async () => {
    const lines = cues([1000, 3000, 5000]);
    const placing = await render({ audio: MEMO, lines, placing: true, audioStartSec: 2 }, ctx("design"));
    expect(marksOf(placing)).toHaveLength(3);
    for (const m of marksOf(placing)) {
      expect(m.overlay?.window).toBeUndefined();
      expect(m.overlay?.enable).toBeUndefined();
    }
    const timed = await render({ audio: MEMO, lines, placing: false }, ctx("design"));
    expect(marksOf(timed).map((m) => m.overlay?.window?.startSec)).toEqual([1, 3, 5]);
    const out = await render({ audio: MEMO, lines, placing: true }, ctx("render"));
    expect(out).toEqual(await render({ audio: MEMO, lines, placing: false }, ctx("render")));
    expect(marksOf(out).map((m) => m.overlay?.window?.startSec)).toEqual([1, 3, 5]);
  });

  it("fails fast past sixteen lines", async () => {
    const doc = await render({ lines: cues(Array.from({ length: 17 }, () => undefined)) });
    expect(isError(doc)).toBe(true);
    expect(isError(await render({ lines: "[not json" }))).toBe(true);
  });

  it("stays within the root source budget at sixteen lines, no page, with audio", async () => {
    const doc = await render({ audio: MEMO, lines: cues(Array.from({ length: 16 }, (_, i) => 1000 + i * 1500)) }, ctx());
    expect(isError(doc)).toBe(false);
    expect(marksOf(doc)).toHaveLength(16);
    expect(doc.sources.length).toBe(MAX_ROOT_SOURCES);
    expect(MAX_ROOT_SOURCES).toBeLessThanOrEqual(20);
    expect(validateM0String(String(doc.m0)).ok).toBe(true);
  });

  it("renders with no lines at all: the page alone", async () => {
    const doc = await render({ lines: [] });
    expect(isError(doc)).toBe(false);
    expect(marksOf(doc)).toEqual([]);
    expect(validateM0String(String(doc.m0)).ok).toBe(true);
  });
});

describe(`${MARGINS_ID}: styles`, () => {
  it("translucent highlighter over a light page (normal blend), screen over a dark one; ink marks never blend", async () => {
    const light = marksOf(await render());
    for (const m of light) {
      expect(m.overlay?.blendMode).toBeUndefined();
      expect(m.overlay?.alpha?.endsWith(`*${HIGHLIGHT_ALPHA_LIGHT}`)).toBe(true);
      expect(m.color).toBe("#FFD83D");
    }
    const dark = marksOf(await render({ pageTone: "dark" }));
    for (const m of dark) {
      expect(m.overlay?.blendMode).toBe("screen");
      expect(m.overlay?.alpha?.endsWith(`*${HIGHLIGHT_ALPHA_DARK}`)).toBe(true);
    }
    for (const style of ["underline", "box"] as const) {
      for (const pageTone of ["light", "dark"] as const) {
        for (const m of marksOf(await render({ style, pageTone }))) {
          expect(m.overlay?.blendMode).toBeUndefined();
          expect(m.overlay?.alpha).not.toMatch(/\*0\.\d+$/);
        }
      }
    }
  });

  it("keeps a colour's alpha off the mask tiles (an inline mask replaces it), so translucency rides overlay.alpha", async () => {
    for (const s of sourcesOf(await render())) {
      if (typeof s.color === "string") expect(s.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  it("the placing pass keeps the highlighter's opacity and blend, just without a window", async () => {
    const [m] = marksOf(await render({ pageTone: "dark" }, ctxFor(1080, 1920, { mode: "design" })));
    expect(m.overlay).toEqual({ blendMode: "screen", alpha: String(HIGHLIGHT_ALPHA_DARK) });
  });
});
