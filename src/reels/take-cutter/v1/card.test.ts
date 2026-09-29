import type { MosaicDocument, MosaicSource } from "@m0saic/types";
import { parseM0StringToRenderFrames, validateM0String } from "@m0saic/dsl";
import { resolvePropBindings } from "@m0saic/template-utils";

import { CARD_BG, buildMarkTakesCard, buildOnboardingCard, cardLayout, fileNamesCaption, fitAspect } from "./card";

const W = 1080;
const H = 1920;
const FRAME = { W, H, fps: 30, durationMs: 20_000 };
const VIDEO = "/media/rehearsal.mov";

const markTakes = (width: number, height: number) =>
  buildMarkTakesCard(FRAME, {
    sourcePath: VIDEO,
    videoName: "rehearsal",
    source: { width, height, durationMs: 2_650_000 },
    namePrefix: "",
  });

const texts = (doc: MosaicDocument) =>
  doc.sources.flatMap((s) =>
    s.type === "text" ? s.layers.map((l) => (l.content.kind === "literal" ? l.content.text : "")) : [],
  );

const bound = (doc: MosaicDocument, key: string) => doc.sources.filter((s) => s.editor?.binding?.propKey === key);

/** The painted rect of source `i`: its frame minus its placement inset. */
const painted = (doc: MosaicDocument, s: MosaicSource) => {
  const f = parseM0StringToRenderFrames(String(doc.m0), W, H)[doc.sources.indexOf(s)];
  const inset = (s as { placement?: { inset?: { top: number; right: number; bottom: number; left: number } } }).placement
    ?.inset ?? { top: 0, right: 0, bottom: 0, left: 0 };
  const x = f.x + Math.floor(f.width * inset.left);
  const y = f.y + Math.floor(f.height * inset.top);
  return { x, y, w: f.x + f.width - Math.floor(f.width * inset.right) - x, h: f.y + f.height - Math.floor(f.height * inset.bottom) - y };
};

describe("cards", () => {
  for (const [name, make] of [
    ["onboarding", () => buildOnboardingCard(FRAME, "")],
    ["mark takes", () => markTakes(1920, 1080)],
  ] as const) {
    it(`${name}: a valid m0, one source per frame, the canvas filled by the document`, () => {
      const doc = make();
      expect(validateM0String(String(doc.m0)).ok).toBe(true);
      expect(parseM0StringToRenderFrames(String(doc.m0), W, H)).toHaveLength(doc.sources.length);
      expect(doc.backgroundColor).toBe(CARD_BG);
      expect(doc.audio).toEqual({ mode: "off" });
      // No source covers the whole canvas: the background is the document's.
      for (const s of doc.sources) {
        const r = painted(doc, s);
        expect(r.w === W && r.h === H).toBe(false);
      }
    });

    it(`${name}: ASCII text only (the bundled glyph font is lean)`, () => {
      for (const t of texts(make())) expect(t).toMatch(/^[\x20-\x7E\n]*$/);
    });

    it(`${name}: the big tile is bound to the video, the caption to the file name`, () => {
      const doc = make();
      const { byProp, rejected } = resolvePropBindings(doc, W, H);
      expect(rejected).toEqual([]);
      expect(Object.keys(byProp).sort()).toEqual(["namePrefix", "source"]);
      const [tile] = bound(doc, "source");
      const L = cardLayout(W, H);
      const r = painted(doc, tile);
      // Inside the tile area and big: at least half the canvas height's worth of it.
      expect(r.x).toBeGreaterThanOrEqual(L.tile.x);
      expect(r.y).toBeGreaterThanOrEqual(L.tile.y);
      expect(r.x + r.w).toBeLessThanOrEqual(L.tile.x + L.tile.w);
      expect(r.y + r.h).toBeLessThanOrEqual(L.tile.y + L.tile.h);
      expect(r.w).toBe(L.tile.w);
    });

    it(`${name}: identical twice`, () => {
      expect(JSON.stringify(make())).toBe(JSON.stringify(make()));
    });
  }

  it("onboarding: the tile is a drop target painted exactly on its rect", () => {
    const doc = buildOnboardingCard(FRAME, "");
    const [tile] = bound(doc, "source");
    expect(tile.type).toBe("lavfi");
    expect(painted(doc, tile)).toEqual(cardLayout(W, H).tile);
    expect(texts(doc)).toContain("Drop your video here");
  });

  it("mark takes: shows the video itself, fitted to its shape, and the next step", () => {
    const doc = markTakes(1920, 1080);
    const [tile] = bound(doc, "source");
    expect(tile).toMatchObject({ type: "media", mediaType: "video", audio: { enabled: false } });
    const r = painted(doc, tile);
    expect(Math.abs(r.w / r.h - 16 / 9)).toBeLessThan(0.01);
    expect(texts(doc)).toContain("Open Takes to mark your first take");
    expect(texts(doc).some((t) => t.startsWith("rehearsal, 44m10s"))).toBe(true);
    expect(Object.values(doc.assets)).toEqual([{ kind: "file", path: VIDEO, mediaType: "video" }]);
  });

  it("the caption shows the file name the current prefix gives", () => {
    expect(fileNamesCaption("")).toBe("File names: yourvideo_01m22s-01m37s.mp4");
    expect(fileNamesCaption("", "rehearsal")).toBe("File names: rehearsal_01m22s-01m37s.mp4");
    expect(fileNamesCaption("live set", "rehearsal")).toBe("File names: live_set_01m22s-01m37s.mp4");
  });

  it("fitAspect centres the largest rect of that shape", () => {
    expect(fitAspect({ x: 0, y: 0, w: 900, h: 900 }, 16, 9)).toEqual({ x: 0, y: 197, w: 900, h: 506 });
    expect(fitAspect({ x: 10, y: 0, w: 900, h: 900 }, 9, 16)).toEqual({ x: 10 + 197, y: 0, w: 506, h: 900 });
  });
});
