import { parseM0StringToRenderFrames, validateM0String } from "@m0saic/dsl";
import { engineRecover } from "@m0saic/template-utils";

import type { LyricPosition, Rect, TakeLayout, TakesLayoutResult } from "./stage-layout";
import {
  LYRIC_POSITIONS,
  TAKE_LAYOUTS,
  clampTakeCount,
  layoutTakes,
  lyricBox,
  rectInset,
  resolveTakeArrangement,
} from "./stage-layout";

const CANVASES: Array<[number, number]> = [
  [1080, 1920],
  [720, 1280],
];
const COUNTS = [1, 2, 3, 4];
const BORDERS = [0, 1, 6, 7, 40];

const right = (r: Rect) => r.x + r.w;
const bottom = (r: Rect) => r.y + r.h;
const isInt = (n: number) => Number.isInteger(n);
const overlapArea = (a: Rect, b: Rect) =>
  Math.max(0, Math.min(right(a), right(b)) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(bottom(a), bottom(b)) - Math.max(a.y, b.y));

/** Every structural promise of a take layout, at one canvas. */
function expectExactTiling(res: TakesLayoutResult, W: number, H: number, outer: boolean): void {
  const { takes, insets, cells, cols, rows, borderPx: g } = res;
  const m = outer ? g : 0;
  expect(takes).toHaveLength(res.count);
  expect(cols * rows).toBe(res.count);

  // valid m0 whose tiles are the raw cells, in order
  expect(validateM0String(res.m0)).toEqual({ ok: true });
  const frames = parseM0StringToRenderFrames(res.m0, W, H)
    .slice()
    .sort((a, b) => a.logicalIndex - b.logicalIndex)
    .map((f) => ({ x: f.x, y: f.y, w: f.width, h: f.height }));
  expect(frames).toEqual(cells);

  takes.forEach((t, i) => {
    // integer px, inside its raw cell, and exactly what the engine paints from the inset
    expect([t.x, t.y, t.w, t.h].every(isInt)).toBe(true);
    expect(t.w).toBeGreaterThan(0);
    expect(t.h).toBeGreaterThan(0);
    expect(t.x).toBeGreaterThanOrEqual(cells[i].x);
    expect(t.y).toBeGreaterThanOrEqual(cells[i].y);
    expect(right(t)).toBeLessThanOrEqual(right(cells[i]));
    expect(bottom(t)).toBeLessThanOrEqual(bottom(cells[i]));
    expect(engineRecover(cells[i], insets[i])).toEqual(t);
    if (g === 0 && !outer) expect(insets[i]).toBeUndefined();
  });

  // no overlap
  for (let i = 0; i < takes.length; i++)
    for (let j = i + 1; j < takes.length; j++) expect(overlapArea(takes[i], takes[j])).toBe(0);

  // reading order + exact borders between neighbours, exact outer margins
  const at = (c: number, r: number) => takes[r * cols + c];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const t = at(c, r);
      if (c === 0) expect(t.x).toBe(m);
      if (c === cols - 1) expect(right(t)).toBe(W - m);
      if (r === 0) expect(t.y).toBe(m);
      if (r === rows - 1) expect(bottom(t)).toBe(H - m);
      if (c + 1 < cols) {
        const n = at(c + 1, r);
        expect(n.x - right(t)).toBe(g);
        expect([n.y, n.h]).toEqual([t.y, t.h]);
      }
      if (r + 1 < rows) {
        const n = at(c, r + 1);
        expect(n.y - bottom(t)).toBe(g);
        expect([n.x, n.w]).toEqual([t.x, t.w]);
      }
    }
  }

  // tiles the bordered stage exactly: disjoint + the right total area
  const area = takes.reduce((sum, t) => sum + t.w * t.h, 0);
  expect(area).toBe((W - 2 * m - (cols - 1) * g) * (H - 2 * m - (rows - 1) * g));

  // equal takes, to the ±1 px rounding jitter
  const ws = takes.map((t) => t.w);
  const hs = takes.map((t) => t.h);
  expect(Math.max(...ws) - Math.min(...ws)).toBeLessThanOrEqual(1);
  expect(Math.max(...hs) - Math.min(...hs)).toBeLessThanOrEqual(1);
}

describe("layoutTakes", () => {
  for (const [W, H] of CANVASES) {
    for (const count of COUNTS) {
      for (const layout of TAKE_LAYOUTS) {
        it(`${W}x${H}, ${count} take(s), ${layout}: exact tiling for every border`, () => {
          for (const borderPx of BORDERS) {
            for (const outerBorder of [false, true]) {
              const res = layoutTakes({ W, H, count, layout, borderPx, outerBorder });
              expect(res.borderPx).toBe(borderPx);
              expectExactTiling(res, W, H, outerBorder);
            }
          }
        });
      }
    }
  }

  it("auto: 1 full, 2 and 3 stacked rows, 4 a 2x2 grid", () => {
    const shape = (count: number, layout: TakeLayout) => {
      const r = layoutTakes({ W: 1080, H: 1920, count, layout, borderPx: 6 });
      return [r.arrangement, r.m0];
    };
    expect(shape(1, "auto")).toEqual(["full", "1"]);
    expect(shape(2, "auto")).toEqual(["stack", "2[1,1]"]);
    expect(shape(3, "auto")).toEqual(["stack", "3[1,1,1]"]);
    expect(shape(4, "auto")).toEqual(["grid", "2[2(1,1),2(1,1)]"]);
  });

  it("stack = rows, split = columns, grid = 2x2 for four and a stack for two or three", () => {
    expect(layoutTakes({ W: 1080, H: 1920, count: 4, layout: "stack", borderPx: 0 }).m0).toBe("4[1,1,1,1]");
    expect(layoutTakes({ W: 1080, H: 1920, count: 3, layout: "split", borderPx: 0 }).m0).toBe("3(1,1,1)");
    expect(layoutTakes({ W: 1080, H: 1920, count: 4, layout: "grid", borderPx: 0 }).m0).toBe("2[2(1,1),2(1,1)]");
    expect(resolveTakeArrangement(2, "grid")).toBe("stack");
    expect(resolveTakeArrangement(3, "grid")).toBe("stack");
    for (const layout of TAKE_LAYOUTS) expect(resolveTakeArrangement(1, layout)).toBe("full");
  });

  it("takes come in reading order (row by row, left to right)", () => {
    const { takes } = layoutTakes({ W: 1080, H: 1920, count: 4, layout: "grid", borderPx: 6 });
    expect(takes.map((t) => [t.x, t.y])).toEqual([
      [0, 0],
      [543, 0],
      [0, 963],
      [543, 963],
    ]);
  });

  it("one full-bleed take needs no inset; the outer border is then the only border", () => {
    const full = layoutTakes({ W: 1080, H: 1920, count: 1, layout: "auto", borderPx: 6 });
    expect(full.takes).toEqual([{ x: 0, y: 0, w: 1080, h: 1920 }]);
    expect(full.insets).toEqual([undefined]);
    const framed = layoutTakes({ W: 1080, H: 1920, count: 1, layout: "auto", borderPx: 6, outerBorder: true });
    expect(framed.takes).toEqual([{ x: 6, y: 6, w: 1068, h: 1908 }]);
  });

  it("clamps the count and the border instead of failing", () => {
    expect(clampTakeCount(0)).toBe(1);
    expect(clampTakeCount(7)).toBe(4);
    expect(clampTakeCount(2.4)).toBe(2);
    expect(clampTakeCount(Number.NaN)).toBe(1);
    expect(layoutTakes({ W: 1080, H: 1920, count: 9, layout: "auto", borderPx: -3 }).borderPx).toBe(0);
    // split 4 at 1080 wide: pitch 270, cap 67
    const wide = layoutTakes({ W: 1080, H: 1920, count: 4, layout: "split", borderPx: 500, outerBorder: true });
    expect(wide.borderPx).toBe(67);
    expectExactTiling(wide, 1080, 1920, true);
  });

  it("is deterministic", () => {
    const a = layoutTakes({ W: 720, H: 1280, count: 3, layout: "auto", borderPx: 7, outerBorder: true });
    const b = layoutTakes({ W: 720, H: 1280, count: 3, layout: "auto", borderPx: 7, outerBorder: true });
    expect(a).toEqual(b);
  });
});

describe("rectInset", () => {
  it("paints exactly the target under the engine's floor math", () => {
    const cell = { x: 0, y: 0, w: 1080, h: 1920 };
    for (const target of [
      { x: 65, y: 672, w: 950, h: 576 },
      { x: 1, y: 1, w: 1078, h: 1918 },
      { x: 0, y: 0, w: 1079, h: 1920 },
      { x: 137, y: 311, w: 1, h: 1 },
    ]) {
      expect(engineRecover(cell, rectInset(cell, target))).toEqual(target);
    }
    expect(rectInset(cell, cell)).toBeUndefined();
  });
});

describe("lyricBox", () => {
  // A generic short-form stage: side strips cropped, header on top, caption at
  // the bottom, an action rail down the lower right. Numbers invented for the test.
  const W = 1080;
  const H = 1920;
  const safe: Rect = { x: 50, y: 220, w: 980, h: 1380 };
  const rail: Rect = { x: 910, y: 940, w: 120, h: 820 };
  const pad = Math.round(0.06 * W);

  const inside = (b: Rect, s: Rect) =>
    b.x >= s.x && b.y >= s.y && right(b) <= right(s) && bottom(b) <= bottom(s);

  for (const position of LYRIC_POSITIONS) {
    it(`${position}: integer px, inside the safe area, clear of the rail`, () => {
      for (const [cw, ch] of CANVASES) {
        const sx = cw / W;
        const sy = ch / H;
        const scale = (r: Rect): Rect => ({
          x: Math.round(r.x * sx),
          y: Math.round(r.y * sy),
          w: Math.round(r.w * sx),
          h: Math.round(r.h * sy),
        });
        const stage = { safe: scale(safe), rail: scale(rail) };
        for (const heightFrac of [0.15, 0.3, 0.6, 1]) {
          const b = lyricBox({ W: cw, H: ch, stage, position, heightFrac });
          expect([b.x, b.y, b.w, b.h].every(isInt)).toBe(true);
          expect(inside(b, stage.safe)).toBe(true);
          expect(overlapArea(b, stage.rail)).toBe(0);
          expect(b.x).toBe(stage.safe.x + Math.round(0.06 * cw));
        }
      }
    });
  }

  it("top hugs the safe top, bottom the safe bottom, middle centres on the canvas", () => {
    const top = lyricBox({ W, H, stage: { safe }, position: "top" });
    const mid = lyricBox({ W, H, stage: { safe }, position: "middle" });
    const bot = lyricBox({ W, H, stage: { safe }, position: "bottom" });
    expect(top).toEqual({ x: 50 + pad, y: 220, w: 980 - 2 * pad, h: 576 });
    expect(mid).toEqual({ x: 50 + pad, y: (H - 576) / 2, w: 980 - 2 * pad, h: 576 });
    expect(bot).toEqual({ x: 50 + pad, y: 220 + 1380 - 576, w: 980 - 2 * pad, h: 576 });
  });

  it("pulls only the right edge left of the rail, and only when their spans overlap", () => {
    const top = lyricBox({ W, H, stage: { safe, rail }, position: "top", heightFrac: 0.2 });
    expect(bottom(top)).toBeLessThanOrEqual(rail.y); // above the rail: full width
    expect(right(top)).toBe(right(safe) - pad);
    const mid = lyricBox({ W, H, stage: { safe, rail }, position: "middle" });
    expect(mid.x).toBe(safe.x + pad);
    expect(right(mid)).toBe(rail.x - pad);
    const bot = lyricBox({ W, H, stage: { safe, rail: null }, position: "bottom" });
    expect(right(bot)).toBe(right(safe) - pad); // no rail (long-form): full width
  });

  it("the middle box is clamped into the safe area when the canvas middle is not safe", () => {
    const lowSafe: Rect = { x: 0, y: 1100, w: 1080, h: 700 };
    const b = lyricBox({ W, H, stage: { safe: lowSafe }, position: "middle" });
    expect(b.y).toBe(1100);
    expect(inside(b, lowSafe)).toBe(true);
  });

  it("caps the height at the safe height, honours sideFrac, and cuts a safe area poking off the canvas", () => {
    const tall = lyricBox({ W, H, stage: { safe }, position: "middle", heightFrac: 1 });
    expect(tall.h).toBe(safe.h);
    const noPad = lyricBox({ W, H, stage: { safe }, position: "top", sideFrac: 0 });
    expect([noPad.x, noPad.w]).toEqual([safe.x, safe.w]);
    const off = lyricBox({ W, H, stage: { safe: { x: -40, y: -40, w: 2000, h: 4000 } }, position: "top" });
    expect(inside(off, { x: 0, y: 0, w: W, h: H })).toBe(true);
  });

  it("positions are exactly top / middle / bottom", () => {
    const all: LyricPosition[] = ["top", "middle", "bottom"];
    expect(LYRIC_POSITIONS).toEqual(all);
  });
});
