import { MIN_SOLO_MS, isShown, overlayWindow, revealWindows, soloWindows, spanOf, wordOverlay } from "./reveal";

const page = { startMs: 1000, endMs: 5000 };
const words = [
  { atMs: 1000, line: 0 },
  { atMs: 1400, line: 0 },
  { atMs: 2000, line: 1 },
  { atMs: 2050, line: 1 },
  { atMs: 3000, line: 2 },
];

const disjoint = (ws: Array<{ startMs: number; endMs: number }>) =>
  ws.every((w, k) => k === 0 || ws[k - 1].endMs <= w.startMs);

describe("lyric-stack reveal", () => {
  it("cumulative: each word from its beat to the page end", () => {
    expect(revealWindows(page, words, "cumulative")).toEqual(words.map((w) => ({ startMs: w.atMs, endMs: 5000 })));
  });

  it("line: a line's words share one window, from the line's first beat", () => {
    const ws = revealWindows(page, words, "line");
    expect(ws.map((w) => w.startMs)).toEqual([1000, 1000, 2000, 2000, 3000]);
    expect(ws.every((w) => w.endMs === 5000)).toBe(true);
  });

  it("word: one word at a time, disjoint and never empty, in order, inside the page", () => {
    const ws = revealWindows(page, words, "word");
    expect(disjoint(ws)).toBe(true);
    expect(ws.every((w) => w.endMs - w.startMs >= MIN_SOLO_MS)).toBe(true);
    expect(ws[0].startMs).toBe(1000);
    expect(ws[ws.length - 1].endMs).toBe(5000);
    // Word 3 lands only 50 ms after word 2: word 2 still gets its minimum.
    expect(ws[2]).toEqual({ startMs: 2000, endMs: 2000 + MIN_SOLO_MS });
  });

  it("word: a crowded page shares itself out and stays disjoint", () => {
    const crowded = soloWindows({ startMs: 0, endMs: 10 }, [0, 0, 0, 0]);
    expect(disjoint(crowded)).toBe(true);
    expect(crowded.every((w) => w.endMs > w.startMs)).toBe(true);
    expect(crowded[3].endMs).toBe(10);
    // Equal beats: pushed apart by the minimum, the last one to the page end.
    const same = soloWindows({ startMs: 0, endMs: 2000 }, [500, 500, 500]);
    expect(same).toEqual([
      { startMs: 500, endMs: 500 + MIN_SOLO_MS },
      { startMs: 500 + MIN_SOLO_MS, endMs: 500 + 2 * MIN_SOLO_MS },
      { startMs: 500 + 2 * MIN_SOLO_MS, endMs: 2000 },
    ]);
  });

  it("word: a page straddling Song start shows only the last word sung before the clip, until the next lands", () => {
    // The song window clamps every word sung before the clip to the page start (0) and marks it carried.
    const straddle = { startMs: 0, endMs: 1000 };
    const c = (atMs: number, carried: boolean) => ({ atMs, line: 0, carried });
    expect(revealWindows(straddle, [c(0, true), c(0, true), c(400, false), c(700, false)], "word")).toEqual([
      { startMs: 1000, endMs: 1000 },
      { startMs: 0, endMs: 400 },
      { startMs: 400, endMs: 700 },
      { startMs: 700, endMs: 1000 },
    ]);
    // Six carried words and one sung at the clip's first frame: no flashes, nobody pushed late
    // (they used to take 120 ms each, the live words 0.7 s late).
    const six = [...Array.from({ length: 6 }, () => c(0, true)), c(0, false), c(500, false)];
    const ws = revealWindows(straddle, six, "word");
    expect(ws.slice(0, 6).some(isShown)).toBe(false);
    expect(ws.slice(6)).toEqual([
      { startMs: 0, endMs: 500 },
      { startMs: 500, endMs: 1000 },
    ]);
    // The next word lands under MIN_SOLO_MS in: the carried one is not flashed either.
    const quick = revealWindows(straddle, [c(0, true), c(MIN_SOLO_MS - 20, false)], "word");
    expect(quick.map(isShown)).toEqual([false, true]);
    expect(quick[1]).toEqual({ startMs: MIN_SOLO_MS - 20, endMs: 1000 });
    // Everything was sung before the clip: the last word holds the page.
    const all = revealWindows(straddle, [c(0, true), c(0, true), c(0, true)], "word");
    expect(all.map(isShown)).toEqual([false, false, true]);
    expect(all[2]).toEqual({ startMs: 0, endMs: 1000 });
    // Two words tapped on one instant (not carried) still both get a turn.
    expect(revealWindows(straddle, [c(0, false), c(0, false)], "word").every(isShown)).toBe(true);
    // The build-up modes show every carried word from the first frame.
    const built = revealWindows(straddle, [c(0, true), c(0, true), c(400, false)], "cumulative");
    expect(built.map((w) => w.startMs)).toEqual([0, 0, 400]);
  });

  it("a word landing at the page end (sung after the clip) is not shown", () => {
    const late = [{ atMs: 1000, line: 0 }, { atMs: 5000, line: 0 }];
    for (const mode of ["cumulative", "line", "word"] as const) {
      const ws = revealWindows(page, late, mode);
      expect(isShown(ws[0])).toBe(true);
      expect(isShown(ws[1])).toBe(false);
    }
  });

  it("the enable string and the window describe the same inclusive span, one ms short of the end", () => {
    expect(overlayWindow({ startMs: 1000, endMs: 2500 })).toEqual({
      enable: "between(t,1.000,2.499)",
      window: { startSec: 1, endSec: 2.499 },
    });
  });

  it("entrances: rise is a comma-free y offset over a fade; instant is the window alone", () => {
    const rise = wordOverlay({ startMs: 1000, endMs: 2000 }, "rise", 19);
    expect(rise.alpha).toBe("min(1,max(0,(t-1.000)/0.28))");
    expect(rise.yExpr).toMatch(/^19\*/);
    expect(rise.yExpr).not.toMatch(/[,:]/);
    expect(wordOverlay({ startMs: 0, endMs: 10 }, "fade", 19).yExpr).toBeUndefined();
    expect(Object.keys(wordOverlay({ startMs: 0, endMs: 10 }, "instant", 19)).sort()).toEqual(["enable", "window"]);
  });

  it("spans windows", () => {
    expect(spanOf([])).toBeNull();
    expect(spanOf([{ startMs: 5, endMs: 9 }, { startMs: 2, endMs: 7 }])).toEqual({ startMs: 2, endMs: 9 });
  });
});
