import fs from "node:fs";

import type { MosaicDocument, MosaicEngineContext, MosaicTextSource } from "@m0saic/types";
import { asAssetId } from "@m0saic/types";
import { parseM0StringToRenderFrames, validateM0String } from "@m0saic/dsl";
import { evaluateM0 } from "@m0saic/dsl-stdlib";
import { resolvePropBindings } from "@m0saic/template-utils";

import { asDocument, targetCtx } from "../../../__testutils__/render";
import { LAYERS_PER_SOURCE } from "./document";
import { LyricTriptychV1, REELS_UI_PNG } from "./lyric-triptych";

const W = 1080;
const H = 1920;

const SONG = "/media/song.m4a";
const CLIP = "/media/take.mp4";
const media = {
  [asAssetId(SONG)]: { durationMs: 30_000, hasAudio: true, hasVideo: false },
  [asAssetId(CLIP)]: { durationMs: 25_000, width: 1080, height: 1920, hasAudio: true, hasVideo: true },
} as unknown as MosaicEngineContext["media"];

const render = (props: Parameters<typeof LyricTriptychV1.render>[0] = {}) =>
  LyricTriptychV1.render(
    { ...LyricTriptychV1.defaultProps, ...props },
    targetCtx(W, H, { media, durationMs: 12_000 }),
  ).then(asDocument);

const textSources = (doc: MosaicDocument) =>
  doc.sources.filter((s): s is MosaicTextSource => s.type === "text" && s.renderMode?.kind === "video");

describe("@rainier/reels/lyric-triptych/v1", () => {
  it("emits a valid, feasible m0 with exactly one source per frame", async () => {
    const doc = await render();
    const m0 = String(doc.m0);
    expect(validateM0String(m0).ok).toBe(true);
    expect(parseM0StringToRenderFrames(m0, W, H)).toHaveLength(doc.sources.length);
    const ev = evaluateM0(m0, { width: W, height: H });
    expect(ev.feasible && ev.meetsPrecision).toBe(true);
  });

  it("draws one comma-free drawtext layer per word, its enable and window in agreement", async () => {
    const doc = await render({ glow: 0 });
    const layers = textSources(doc).flatMap((s) => s.layers);
    const words = (LyricTriptychV1.defaultProps.lyrics as Array<{ text: string }>).flatMap((c) =>
      c.text.split(/\s+/),
    );
    expect(layers.map((l) => (l.content.kind === "literal" ? l.content.text : ""))).toEqual(words);
    for (const l of layers) {
      // Placement exprs are inlined into the filtergraph verbatim.
      expect(l.placement?.xExpr).not.toMatch(/[,:]/);
      expect(l.placement?.yExpr).not.toMatch(/[,:]/);
      expect(l.placement?.yExpr).toMatch(/-ascent/);
      const w = l.overlay?.window;
      expect(l.overlay?.enable).toBe(`between(t,${w?.startSec?.toFixed(3)},${w?.endSec?.toFixed(3)})`);
    }
  });

  it("adds a blurred glow twin under every word source only when glow is on", async () => {
    const on = textSources(await render({ glow: 0.6 }));
    expect(on.map((s) => (s.effects?.blur ? "glow" : "words"))).toEqual(["glow", "words"]);
    expect(textSources(await render({ glow: 0 }))).toHaveLength(1);
  });

  it("splits long lyrics across sources, never more than the per-source budget", async () => {
    const lyrics = Array.from({ length: 70 }, (_, i) => ({ text: `page ${i} has five words`, startMs: i * 400 }));
    const sources = textSources(await render({ lyrics, glow: 0, song: SONG }));
    expect(sources.length).toBeGreaterThan(1);
    for (const s of sources) expect(s.layers.length).toBeLessThanOrEqual(LAYERS_PER_SOURCE);
    expect(sources.reduce((n, s) => n + s.layers.length, 0)).toBe(70 * 5);
  });

  it("follows the song's length and plays it as an audio-only leaf on top", async () => {
    const doc = await render({ song: SONG });
    expect(doc.durationMs).toBe(30_000);
    const last = doc.sources[doc.sources.length - 1];
    expect(last).toMatchObject({ type: "media", mediaType: "audio", audio: { enabled: true } });
  });

  it("fills a row with its clip (cover, muted, trimmed, framed) and the border as an inset", async () => {
    const doc = await render({ topClip: CLIP, topTrimSec: 1.5, topFraming: 0.2, borderPx: 6 });
    const top = doc.sources[0];
    expect(top).toMatchObject({
      type: "media",
      mediaType: "video",
      placement: { fit: "cover", focusY: 0.2 },
      playback: { clipStartMs: 1500 },
      audio: { enabled: false },
    });
    expect(top.type === "media" && top.placement?.inset).toBeTruthy();
    expect(doc.durationMs).toBe(25_000);
  });

  it("puts the Reels UI guide on top only when asked, from a file that ships", async () => {
    expect(fs.existsSync(REELS_UI_PNG)).toBe(true);
    const off = await render();
    expect(JSON.stringify(off.assets ?? {})).not.toContain("reels-ui");
    const on = await render({ showReelsUi: true });
    expect(on.sources[on.sources.length - 1]).toMatchObject({
      type: "media",
      mediaType: "image",
      placement: { fit: "contain" },
    });
  });

  it("binds each row to its clip prop, empty or filled, so Make takes a dropped file", async () => {
    for (const props of [{}, { topClip: CLIP, middleClip: CLIP, bottomClip: CLIP, song: SONG, showReelsUi: true }]) {
      const doc = await render(props);
      const { byProp, rejected } = resolvePropBindings(doc, W, H, { propsSchema: LyricTriptychV1.propsSchema });
      expect(rejected).toEqual([]);
      expect(Object.keys(byProp).sort()).toEqual(["bottomClip", "middleClip", "topClip"]);
      const rows = parseM0StringToRenderFrames(String(doc.m0), W, H);
      ["topClip", "middleClip", "bottomClip"].forEach((key, i) => {
        expect(byProp[key]).toHaveLength(1);
        // The binding sits on the row tile itself (y of row i), under the lyrics.
        const src = doc.sources.find((s) => s.editor?.binding?.propKey === key);
        const frame = rows[doc.sources.indexOf(src as (typeof doc.sources)[number])];
        expect(frame.y).toBe((H / 3) * i);
      });
    }
  });

  it("moves the lyrics to another row", async () => {
    expect(String((await render({ lyricsRow: "top", glow: 0 })).m0)).toBe("3[1{1},1,1]");
  });

  it("is deterministic and rejects a bad colour", async () => {
    expect(await render()).toEqual(await render());
    await expect(render({ textColor: "white" })).rejects.toThrow(/#rrggbb/);
  });
});
