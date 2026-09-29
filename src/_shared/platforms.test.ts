import type { Rect, ShortPlatform } from "./platforms";
import {
  DEFAULT_SHORT_PLATFORM,
  PLATFORM_LIMITS,
  PLATFORM_SLUG,
  SHORT_PLATFORMS,
  SHORT_PLATFORM_IDS,
  SHORT_PLATFORM_OPTIONS,
  isShortPlatformId,
  platformStage,
  resolveShortPlatform,
} from "./platforms";

const CANVASES: Array<[number, number]> = [
  [1080, 1920],
  [720, 1280],
];

function expectInside(r: Rect, W: number, H: number): void {
  for (const v of [r.x, r.y, r.w, r.h]) expect(Number.isInteger(v)).toBe(true);
  expect(r.w).toBeGreaterThanOrEqual(1);
  expect(r.h).toBeGreaterThanOrEqual(1);
  expect(r.x).toBeGreaterThanOrEqual(0);
  expect(r.y).toBeGreaterThanOrEqual(0);
  expect(r.x + r.w).toBeLessThanOrEqual(W);
  expect(r.y + r.h).toBeLessThanOrEqual(H);
}

describe("SHORT_PLATFORMS rows", () => {
  it("lists reels, tiktok, shorts in step order", () => {
    expect(SHORT_PLATFORMS.map((p) => [p.id, p.slug])).toEqual([
      ["instagram-reel", "reels"],
      ["tiktok", "tiktok"],
      ["youtube-shorts", "shorts"],
    ]);
    expect(SHORT_PLATFORM_IDS).toEqual(["instagram-reel", "tiktok", "youtube-shorts"]);
  });

  it("every row is complete: label, 1080x1920, sane fractions, rail, caption, note", () => {
    for (const p of SHORT_PLATFORMS) {
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.canvas).toEqual({ width: 1080, height: 1920 });
      const { top, bottom, side } = p.chrome;
      for (const f of [top, bottom, side]) {
        expect(f).toBeGreaterThan(0);
        expect(f).toBeLessThan(0.5);
      }
      expect(top + bottom).toBeLessThan(0.5);
      expect(p.rail).toBeDefined();
      expect(p.rail!.width).toBeGreaterThan(0);
      expect(p.rail!.top + p.rail!.bottom).toBeLessThan(1);
      expect(p.caption!.height).toBeGreaterThan(0);
      expect(p.caption!.height).toBeLessThanOrEqual(1);
      expect(p.note.length).toBeGreaterThan(0);
    }
  });

  it("all three rows are measured from screenshots", () => {
    expect(SHORT_PLATFORMS.filter((p) => p.measured).map((p) => p.id)).toEqual(SHORT_PLATFORM_IDS);
    for (const p of SHORT_PLATFORMS) expect(p.note).toMatch(/^Measured /);
  });

  it("carries each platform's limits", () => {
    expect(PLATFORM_LIMITS).toEqual({
      "instagram-reel": { maxDurationMs: 180_000, captionChars: 2200 },
      tiktok: { maxDurationMs: 600_000, captionChars: 4000 },
      "youtube-shorts": { maxDurationMs: 180_000, captionChars: 5000, titleChars: 100 },
    });
    for (const p of SHORT_PLATFORMS) expect(PLATFORM_LIMITS[p.id]).toBe(p.limits);
  });

  it("PLATFORM_SLUG, the options and the default agree with the rows", () => {
    for (const p of SHORT_PLATFORMS) expect(PLATFORM_SLUG[p.id]).toBe(p.slug);
    expect(SHORT_PLATFORM_OPTIONS).toEqual(SHORT_PLATFORMS.map((p) => ({ value: p.id, label: p.label })));
    expect(DEFAULT_SHORT_PLATFORM).toBe("instagram-reel");
  });

  it("rows are frozen, so one template cannot move another's stage", () => {
    const reels = SHORT_PLATFORMS[0];
    expect(Object.isFrozen(SHORT_PLATFORMS)).toBe(true);
    expect(Object.isFrozen(reels)).toBe(true);
    expect(Object.isFrozen(reels.chrome)).toBe(true);
    expect(Object.isFrozen(reels.rail)).toBe(true);
    expect(() => {
      (reels.chrome as { top: number }).top = 0;
    }).toThrow(TypeError);
  });
});

describe("isShortPlatformId / resolveShortPlatform", () => {
  it("accepts the three ids only", () => {
    expect(SHORT_PLATFORM_IDS.every(isShortPlatformId)).toBe(true);
    for (const v of ["reels", "Instagram", "", undefined, null, 3, {}]) expect(isShortPlatformId(v)).toBe(false);
  });

  it("resolves ids and slugs to their rows", () => {
    for (const p of SHORT_PLATFORMS) {
      expect(resolveShortPlatform(p.id)).toBe(p);
      expect(resolveShortPlatform(p.slug)).toBe(p);
    }
  });

  it("resolves anything unknown to the default, never throwing", () => {
    for (const v of ["", "all", "INSTAGRAM-REEL", "youtube", undefined, null, 42, NaN, {}, [], Symbol("x")]) {
      expect(resolveShortPlatform(v).id).toBe(DEFAULT_SHORT_PLATFORM);
    }
  });
});

describe("platformStage", () => {
  it.each(CANVASES)("keeps every rect inside a %ix%i canvas", (W, H) => {
    for (const p of SHORT_PLATFORMS) {
      const stage = platformStage(p, W, H);
      expectInside(stage.safe, W, H);
      expectInside(stage.rail!, W, H);
      expectInside(stage.captionBlock!, W, H);
      // The rail hugs the right edge; the caption block sits under the safe area, left of the rail.
      expect(stage.rail!.x + stage.rail!.w).toBe(W);
      expect(stage.captionBlock!.y).toBe(stage.safe.y + stage.safe.h);
      expect(stage.captionBlock!.x + stage.captionBlock!.w).toBeLessThanOrEqual(stage.rail!.x);
    }
  });

  it("reproduces the Reels geometry measured by bake-reels-ui.mjs", () => {
    const stage = platformStage(resolveShortPlatform("instagram-reel"), 1080, 1920);
    // side crop 50, header to y 241, caption block from y 1631
    expect(stage.safe).toEqual({ x: 50, y: 241, w: 980, h: 1390 });
    // rail from x 910, heart top y 965 to audio-thumb bottom y 1876
    expect(stage.rail).toEqual({ x: 910, y: 965, w: 170, h: 911 });
    // caption lines y 1631 to 1874, left of the rail
    expect(stage.captionBlock).toEqual({ x: 50, y: 1631, w: 860, h: 243 });
  });

  it("reproduces the TikTok geometry measured from ref/tiktok_ref.PNG", () => {
    const stage = platformStage(resolveShortPlatform("tiktok"), 1080, 1920);
    // side crop 52, header to y 247, caption block from y 1747
    expect(stage.safe).toEqual({ x: 52, y: 247, w: 976, h: 1500 });
    // rail from x 896, avatar top y 953 to sound-disc bottom y 1886
    expect(stage.rail).toEqual({ x: 896, y: 953, w: 184, h: 933 });
    // name row y 1747 to the second caption line's descenders y 1893, left of the rail
    expect(stage.captionBlock).toEqual({ x: 52, y: 1747, w: 844, h: 146 });
  });

  it("reproduces the Shorts geometry measured from ref/youtube_shorts_ref.PNG", () => {
    const stage = platformStage(resolveShortPlatform("youtube-shorts"), 1080, 1920);
    // side crop 52, header to y 232, caption block from y 1735
    expect(stage.safe).toEqual({ x: 52, y: 232, w: 976, h: 1503 });
    // rail from x 897, like-icon top y 1063 to sound-tile bottom y 1872
    expect(stage.rail).toEqual({ x: 897, y: 1063, w: 183, h: 809 });
    // channel avatar top y 1735 to the title's descenders y 1876, left of the rail
    expect(stage.captionBlock).toEqual({ x: 52, y: 1735, w: 845, h: 141 });
  });

  it("scales with the canvas: 720x1280 is two thirds of 1080x1920, within a pixel", () => {
    for (const p of SHORT_PLATFORMS) {
      const big = platformStage(p, 1080, 1920);
      const small = platformStage(p, 720, 1280);
      for (const key of ["safe", "rail", "captionBlock"] as const) {
        const a = big[key]!;
        const b = small[key]!;
        for (const k of ["x", "y", "w", "h"] as const) {
          expect(Math.abs(b[k] - (a[k] * 2) / 3)).toBeLessThanOrEqual(1.5);
        }
      }
    }
  });

  it("gives a rail and a caption block only where the row defines them", () => {
    const bare: ShortPlatform = { ...SHORT_PLATFORMS[0], rail: undefined, caption: undefined };
    const stage = platformStage(bare, 1080, 1920);
    expect(stage.rail).toBeUndefined();
    expect(stage.captionBlock).toBeUndefined();
    expect(stage.safe).toEqual(platformStage(SHORT_PLATFORMS[0], 1080, 1920).safe);

    // No rail: the caption block runs to the safe area's right edge.
    const noRail: ShortPlatform = { ...SHORT_PLATFORMS[0], rail: undefined };
    const s2 = platformStage(noRail, 1080, 1920);
    expect(s2.captionBlock!.x + s2.captionBlock!.w).toBe(s2.safe.x + s2.safe.w);
  });

  it("rounds a fractional canvas and survives junk sizes", () => {
    const p = SHORT_PLATFORMS[1];
    expect(platformStage(p, 1079.6, 1920.4)).toEqual(platformStage(p, 1080, 1920));
    for (const [W, H] of [
      [NaN, NaN],
      [0, 0],
      [-5, 3],
      [2, 2],
    ]) {
      const stage = platformStage(p, W, H);
      const cw = Math.max(1, Math.round(W) || 1);
      const ch = Math.max(1, Math.round(H) || 1);
      expectInside(stage.safe, cw, ch);
      if (stage.rail) expectInside(stage.rail, cw, ch);
      if (stage.captionBlock) expectInside(stage.captionBlock, cw, ch);
    }
  });
});
