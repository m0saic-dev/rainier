import type { Box } from "./marks";
import {
  BAND_X0,
  BAND_X1,
  MARK_STYLES,
  MIN_BOX_PX,
  PLACEHOLDER_LINES,
  clampBox,
  defaultLineBoxes,
  markPath,
  pageContentRect,
  placeholderBlock,
  ruledPaperPath,
  scribblePen,
  scribbleStrokes,
} from "./marks";

/** Every `x y` pair in a path of absolute M / L commands. */
function points(d: string): Array<[number, number]> {
  return [...d.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
}
const subpaths = (d: string) => d.split("M").filter((p) => p.trim() !== "").length;
const inside = (p: [number, number], w: number, h: number) => p[0] >= 0 && p[0] <= w && p[1] >= 0 && p[1] <= h;
const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe("margins marks: the page and the default bands", () => {
  it("fits a 3:4 photo whole and centred in 1080x1920, and fills the frame under cover", () => {
    expect(pageContentRect(1080, 1920, "contain", { width: 3000, height: 4000 })).toEqual({ x: 0, y: 240, w: 1080, h: 1440 });
    expect(pageContentRect(1080, 1920, "cover", { width: 3000, height: 4000 })).toEqual({ x: 0, y: 0, w: 1080, h: 1920 });
    // A picture whose size is unknown is laid out as the whole canvas.
    expect(pageContentRect(1080, 1920, "contain")).toEqual({ x: 0, y: 0, w: 1080, h: 1920 });
  });

  it.each([1, 5, 16])("gives %i band(s) inside the content rect, top to bottom, never overlapping", (count) => {
    for (const content of [placeholderBlock(1080, 1920), { x: 0, y: 240, w: 1080, h: 1440 }, placeholderBlock(720, 1280)]) {
      const bands = defaultLineBoxes(count, content);
      expect(bands).toHaveLength(count);
      for (const b of bands) {
        expect(b.x).toBe(Math.round(content.x + content.w * BAND_X0));
        expect(b.x + b.w).toBe(Math.round(content.x + content.w * BAND_X1));
        expect(b.y).toBeGreaterThanOrEqual(content.y);
        expect(b.y + b.h).toBeLessThanOrEqual(content.y + content.h);
        expect(Number.isInteger(b.x) && Number.isInteger(b.y) && Number.isInteger(b.w) && Number.isInteger(b.h)).toBe(true);
      }
      for (let i = 1; i < bands.length; i++) {
        expect(bands[i].y).toBeGreaterThan(bands[i - 1].y);
        expect(overlaps(bands[i], bands[i - 1])).toBe(false);
      }
    }
    expect(defaultLineBoxes(0, placeholderBlock(1080, 1920))).toEqual([]);
  });

  it("clamps a box into the canvas at a minimum size", () => {
    expect(clampBox({ x: -40, y: 1900, w: 200.4, h: 90 }, 1080, 1920)).toEqual({ x: 0, y: 1830, w: 200, h: 90 });
    expect(clampBox({ x: 10, y: 10, w: 0, h: 1 }, 1080, 1920)).toEqual({ x: 10, y: 10, w: MIN_BOX_PX, h: MIN_BOX_PX });
    expect(clampBox({ x: 0, y: 0, w: 5000, h: 5000 }, 1080, 1920)).toEqual({ x: 0, y: 0, w: 1080, h: 1920 });
  });
});

describe("margins marks: the three strokes", () => {
  const sizes: Array<[number, number]> = [
    [761, 129],
    [900, 40],
    [300, 300],
    [MIN_BOX_PX, MIN_BOX_PX],
  ];

  it.each(MARK_STYLES)("%s stays inside its box at every size, and is the same path twice", (style) => {
    for (const [w, h] of sizes) {
      const d = markPath(style, w, h);
      const pts = points(d);
      expect(pts.length).toBeGreaterThan(3);
      for (const p of pts) expect(inside(p, w, h)).toBe(true);
      expect(markPath(style, w, h)).toBe(d);
    }
  });

  it("draws the highlighter and the underline as one shape each, the box as four bars in one path", () => {
    expect(subpaths(markPath("highlight", 761, 129))).toBe(1);
    expect(subpaths(markPath("underline", 761, 129))).toBe(1);
    expect(subpaths(markPath("box", 761, 129))).toBe(4);
  });

  it("keeps the highlighter's ragged ends inside the box but off its edges, and the underline in the bottom 18 %", () => {
    const hl = points(markPath("highlight", 761, 129));
    expect(Math.min(...hl.map((p) => p[1]))).toBeGreaterThan(0.05 * 129);
    expect(Math.max(...hl.map((p) => p[1]))).toBeLessThan(0.95 * 129);
    const ul = points(markPath("underline", 761, 129));
    expect(Math.min(...ul.map((p) => p[1]))).toBeGreaterThanOrEqual(129 * (1 - 0.18) - 0.1);
  });

  it("frames the box on all four sides", () => {
    const pts = points(markPath("box", 400, 100));
    expect(Math.min(...pts.map((p) => p[0]))).toBe(0);
    expect(Math.max(...pts.map((p) => p[0]))).toBe(400);
    expect(Math.min(...pts.map((p) => p[1]))).toBe(0);
    expect(Math.max(...pts.map((p) => p[1]))).toBe(100);
  });
});

describe("margins marks: the empty page", () => {
  it.each([
    [1080, 1920],
    [720, 1280],
    [1080, 1080],
  ])("draws ruled paper inside %ix%i: horizontal rules plus the margin line", (W, H) => {
    const d = ruledPaperPath(W, H);
    for (const p of points(d)) expect(inside(p, W, H)).toBe(true);
    expect(subpaths(d)).toBeGreaterThanOrEqual(PLACEHOLDER_LINES + 1);
    expect(ruledPaperPath(W, H)).toBe(d);
  });

  it("writes the handwriting stand-in as pen strokes on the five placeholder bands, never past them", () => {
    const W = 1080;
    const H = 1920;
    const strokes = scribbleStrokes(W, H);
    expect(strokes.length).toBe(18); // 4 + 3 + 4 + 3 + 4 squiggle words
    const bands = defaultLineBoxes(PLACEHOLDER_LINES, placeholderBlock(W, H));
    const pen = scribblePen(W);
    for (const s of strokes) {
      expect(s.width).toBe(pen);
      expect(s.d).not.toMatch(/Z/);
      const pts = points(s.d);
      const band = bands.find((b) => pts.every((p) => p[1] >= b.y && p[1] <= b.y + b.h));
      expect(band).toBeDefined();
      for (const p of pts) {
        expect(p[0]).toBeGreaterThanOrEqual((band as Box).x);
        expect(p[0]).toBeLessThanOrEqual((band as Box).x + (band as Box).w);
      }
    }
    expect(scribbleStrokes(W, H)).toEqual(strokes);
  });
});
