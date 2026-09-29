import type { MosaicTimedCue } from "@m0saic/types";

import { DEFAULT_SHORT_PLATFORM, platformStage, resolveShortPlatform } from "../../../_shared/platforms";
import type { Rect } from "./plan";
import {
  MIN_TAP_SEC,
  RAMP_SEC,
  TAIL_SEC,
  UNTIMED_FROM_SEC,
  beatTimes,
  landingOrder,
  revealTiming,
  scaledGap,
  shardGrid,
  sourceRects,
  stageKind,
  stageLayout,
} from "./plan";

const CANVASES: Array<[number, number]> = [
  [1080, 1920],
  [1080, 1350],
  [1080, 1080],
];
const isInt = (r: Rect) => [r.x, r.y, r.w, r.h].every(Number.isInteger);
const inside = (r: Rect, W: number, H: number) => r.x >= 0 && r.y >= 0 && r.w >= 1 && r.h >= 1 && r.x + r.w <= W && r.y + r.h <= H;

describe("cover-shards plan: the stage", () => {
  it("names the three shapes", () => {
    expect(CANVASES.map(([w, h]) => stageKind(w, h))).toEqual(["tall", "portrait", "square"]);
    expect(stageKind(1920, 1080)).toBe("square");
  });

  it("keeps the square and both lines inside the canvas, the lines under the square (or on the scrim)", () => {
    for (const [W, H] of CANVASES) {
      const L = stageLayout(W, H);
      for (const r of [L.squareBox, L.headline, L.subline]) {
        expect(isInt(r)).toBe(true);
        expect(inside(r, W, H)).toBe(true);
      }
      expect(L.squareBox.w).toBe(L.squareBox.h);
      expect(L.subline.y).toBeGreaterThanOrEqual(L.headline.y + L.headline.h);
      if (L.kind === "square") {
        expect(L.scrim).toEqual({ x: 0, y: H - Math.round(H / 6), w: W, h: Math.round(H / 6) });
        expect(L.headline.y).toBeGreaterThanOrEqual(L.scrim?.y ?? 0);
        expect(L.subline.y + L.subline.h).toBeLessThanOrEqual(H);
      } else {
        expect(L.scrim).toBeUndefined();
        expect(L.headline.y).toBeGreaterThanOrEqual(L.squareBox.y + L.squareBox.h);
      }
    }
  });

  it("on a tall canvas starts at the top of the Reels safe area and keeps the text left of the rail", () => {
    const stage = platformStage(resolveShortPlatform(DEFAULT_SHORT_PLATFORM), 1080, 1920);
    const L = stageLayout(1080, 1920);
    expect(L.squareBox.y).toBe(stage.safe.y);
    expect(L.squareBox.x).toBeGreaterThan(stage.safe.x);
    expect(L.squareBox.x + L.squareBox.w).toBeLessThan(stage.safe.x + stage.safe.w);
    for (const r of [L.headline, L.subline]) {
      expect(r.x + r.w).toBeLessThanOrEqual(stage.rail?.x ?? 1080);
      expect(r.y + r.h).toBeLessThanOrEqual(stage.safe.y + stage.safe.h);
      // Centred under the square.
      expect(Math.abs(r.x + r.w / 2 - (L.squareBox.x + L.squareBox.w / 2))).toBeLessThanOrEqual(1);
    }
  });

  it("shrinks the square at 4:5 so the band fits under it", () => {
    const L = stageLayout(1080, 1350);
    expect(L.subline.y + L.subline.h).toBeLessThanOrEqual(1350);
    expect(L.squareBox.w).toBeLessThan(1080);
  });
});

describe("cover-shards plan: shard rects", () => {
  it("tile the snapped square with exact gaps, integer squares, inside the canvas", () => {
    for (const [W, H] of CANVASES) {
      for (const n of [2, 3, 4]) {
        const L = stageLayout(W, H);
        const g = shardGrid(L.squareBox, n, scaledGap(6, W, H));
        expect(g.rects).toHaveLength(n * n);
        expect(g.square.w).toBe(n * g.cell + (n - 1) * g.gap);
        expect(g.square.w).toBeLessThanOrEqual(L.squareBox.w);
        expect(g.square.w).toBeGreaterThan(L.squareBox.w - n);
        for (let r = 0; r < n; r++) {
          for (let c = 0; c < n; c++) {
            const s = g.rects[r * n + c];
            expect(isInt(s)).toBe(true);
            expect(inside(s, W, H)).toBe(true);
            expect(s.w).toBe(g.cell);
            expect(s.h).toBe(g.cell);
            expect(s.x).toBe(g.square.x + c * (g.cell + g.gap));
            expect(s.y).toBe(g.square.y + r * (g.cell + g.gap));
          }
        }
        // The last shard ends exactly at the square's far corner.
        const last = g.rects[n * n - 1];
        expect(last.x + last.w).toBe(g.square.x + g.square.w);
        expect(last.y + last.h).toBe(g.square.y + g.square.h);
      }
    }
  });

  it("scales the gap with the canvas and drops it when the square cannot hold it", () => {
    expect(scaledGap(6, 1080, 1920)).toBe(6);
    expect(scaledGap(6, 720, 1280)).toBe(4);
    expect(scaledGap(99, 1080, 1080)).toBe(24);
    expect(shardGrid({ x: 0, y: 0, w: 10, h: 10 }, 4, 6).gap).toBe(0);
  });
});

describe("cover-shards plan: source rects", () => {
  it("partition the centred square crop exactly (no gap, no overlap, integer)", () => {
    for (const [w, h] of [
      [3000, 3000],
      [4000, 3000],
      [1080, 1920],
      [1001, 997],
    ]) {
      const side = Math.min(w, h);
      const ox = Math.floor((w - side) / 2);
      const oy = Math.floor((h - side) / 2);
      for (const n of [2, 3, 4]) {
        const rects = sourceRects(w, h, n);
        expect(rects).not.toBeNull();
        const list = rects as Rect[];
        expect(list).toHaveLength(n * n);
        expect(list.every(isInt)).toBe(true);
        expect(list.reduce((sum, r) => sum + r.w * r.h, 0)).toBe(side * side);
        // Row-major, abutting: each rect starts where its left and upper neighbours end.
        for (let r = 0; r < n; r++) {
          for (let c = 0; c < n; c++) {
            const s = list[r * n + c];
            expect(s.x).toBe(c === 0 ? ox : list[r * n + c - 1].x + list[r * n + c - 1].w);
            expect(s.y).toBe(r === 0 ? oy : list[(r - 1) * n + c].y + list[(r - 1) * n + c].h);
          }
        }
        const last = list[n * n - 1];
        expect(last.x + last.w).toBe(ox + side);
        expect(last.y + last.h).toBe(oy + side);
      }
    }
  });

  it("gives up on a picture smaller than the grid", () => {
    expect(sourceRects(3, 900, 4)).toBeNull();
    expect(sourceRects(0, 0, 2)).toBeNull();
  });
});

describe("cover-shards plan: landing order", () => {
  it("rows is row-major", () => {
    expect(landingOrder(3, "rows", 7)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("center goes out from the middle, ties row-major", () => {
    for (const n of [2, 3, 4]) {
      const order = landingOrder(n, "center", 7);
      const d2 = (i: number) => (2 * Math.floor(i / n) - (n - 1)) ** 2 + (2 * (i % n) - (n - 1)) ** 2;
      for (let j = 1; j < order.length; j++) {
        expect(d2(order[j])).toBeGreaterThanOrEqual(d2(order[j - 1]));
        if (d2(order[j]) === d2(order[j - 1])) expect(order[j]).toBeGreaterThan(order[j - 1]);
      }
    }
    expect(landingOrder(3, "center", 7)[0]).toBe(4);
  });

  it("shuffle is a permutation, the same for the same seed, different for another", () => {
    const a = landingOrder(4, "shuffle", 7);
    expect([...a].sort((x, y) => x - y)).toEqual(Array.from({ length: 16 }, (_, i) => i));
    expect(landingOrder(4, "shuffle", 7)).toEqual(a);
    expect(landingOrder(4, "shuffle", 8)).not.toEqual(a);
  });
});

describe("cover-shards plan: timing", () => {
  it("untimed shards spread evenly, the first at 0.3 s and the last on revealSec", () => {
    const t = revealTiming(16, [], 3);
    expect(t.revealEnd).toBe(3);
    expect(t.land[0]).toBe(UNTIMED_FROM_SEC);
    expect(t.land[15]).toBe(3);
    const steps = t.land.slice(1).map((v, i) => v - t.land[i]);
    for (const s of steps) expect(s).toBeCloseTo(steps[0], 2);
    expect(t.tapped).toBe(0);
  });

  it("maps taps through Song start: 11, 12, 13 s with a 10 s start land the first three shards at 1, 2, 3 s", () => {
    const cues: MosaicTimedCue[] = [
      { text: "1", startMs: 11_000 },
      { text: "2", startMs: 12_000 },
      { text: "3", startMs: 13_000 },
    ];
    const taps = beatTimes(cues, 10);
    expect(taps).toEqual([1, 2, 3]);
    const t = revealTiming(16, taps, 3);
    expect(t.land.slice(0, 3)).toEqual([1, 2, 3]);
    expect(t.revealEnd).toBe(3 + TAIL_SEC);
    expect(t.land[15]).toBe(t.revealEnd);
    for (let j = 1; j < 16; j++) expect(t.land[j]).toBeGreaterThan(t.land[j - 1]);
  });

  it("drops taps before the clip, untimed cues and taps at or below 0.2 s", () => {
    const cues: MosaicTimedCue[] = [
      { text: "early", startMs: 9_000 },
      { text: "edge", startMs: 10_000 + MIN_TAP_SEC * 1000 },
      { text: "untimed" },
      { text: "ok", startMs: 10_500 },
    ];
    expect(beatTimes(cues, 10)).toEqual([0.5]);
  });

  it("extends the reveal past revealSec when the taps run later", () => {
    const taps = [1, 2, 3, 4, 5, 6];
    const t = revealTiming(4, taps, 3);
    expect(t.land).toEqual([1, 2, 3, 4]);
    expect(t.tapped).toBe(4);
    expect(t.revealEnd).toBe(4 + TAIL_SEC);
    expect(t.headlineAt).toBeGreaterThan(t.revealEnd);
    expect(t.sublineAt).toBeGreaterThan(t.headlineAt);
  });

  it("starts every move at or after 0 and lands it on time", () => {
    for (const taps of [[], [0.25, 0.3, 0.9], [1, 2, 3]]) {
      const t = revealTiming(16, taps, 1);
      t.land.forEach((land, j) => {
        expect(t.rampStart[j]).toBeGreaterThanOrEqual(0);
        expect(t.rampDur[j]).toBeGreaterThan(0);
        expect(t.rampDur[j]).toBeLessThanOrEqual(RAMP_SEC + 1e-9);
        expect(t.rampStart[j] + t.rampDur[j]).toBeCloseTo(land, 6);
      });
    }
  });
});
