import type { MosaicTimedCue } from "@m0saic/types";

import { windowPages } from "../../../_shared/song-window";
import {
  MIN_PAGE_MS,
  hasTimedPage,
  isBreakText,
  resolvePageWindows,
  resolvePages,
  resolveWordTimes,
  tokenize,
  wordIndexBase,
} from "./pages";

describe("lyric-stack pages", () => {
  const cues: MosaicTimedCue[] = [
    { text: "one two three", startMs: 1000 },
    { text: "[break]", startMs: 4000 },
    { text: "four five", startMs: 6000 },
    { text: "six\nseven eight", startMs: 9000, endMs: 12000 },
  ];

  it("numbers words globally in reading order; pause pages hold no words", () => {
    expect(wordIndexBase(cues)).toEqual({ firstWord: [0, 3, 3, 5], total: 8 });
    const pages = resolvePages(cues, 20_000);
    expect(pages.map((p) => p.cueIndex)).toEqual([0, 2, 3]);
    expect(pages.flatMap((p) => p.words.map((w) => w.index))).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(pages[2].words.map((w) => w.lineBreakBefore)).toEqual([false, true, false]);
  });

  it("keeps global indexes when the timeline drops early and late pages", () => {
    // A timeline that ends before the last page: its words keep their numbers elsewhere.
    const pages = resolvePages(cues, 8000);
    expect(pages.map((p) => p.cueIndex)).toEqual([0, 2]);
    expect(pages[1].words.map((w) => w.index)).toEqual([3, 4]);
    // Windowed onto a clip that starts at 6 s: page "four five" keeps indexes 3 and 4.
    const clip = windowPages(resolvePages(cues, 20_000), { songStartMs: 6000, durationMs: 5000 });
    expect(clip[0].words.map((w) => [w.text, w.index])).toEqual([
      ["four", 3],
      ["five", 4],
    ]);
    expect(clip[0].startMs).toBe(0);
  });

  it("knows timed from untimed lyrics", () => {
    expect(hasTimedPage(cues)).toBe(true);
    expect(hasTimedPage([{ text: "a b" }, { text: "c" }])).toBe(false);
  });

  it("spreads untimed pages over the timeline and cascades untimed words inside", () => {
    const pages = resolvePages([{ text: "a b c" }, { text: "d e" }], 10_000);
    expect(pages.map((p) => [p.startMs, p.endMs])).toEqual([
      [0, 5000],
      [5000, 10_000],
    ]);
    const at = pages[0].words.map((w) => w.atMs);
    expect(at[0]).toBe(0);
    expect(at).toEqual([...at].sort((x, y) => x - y));
    expect(Math.max(...at)).toBeLessThan(5000);
  });

  it("never stretches a short page over the next one (pages share one lyric box)", () => {
    const span = (cs: MosaicTimedCue[], dur: number) => resolvePageWindows(cs, dur).map((w) => [w.startMs, w.endMs]);
    // Five untimed pages on a 1 s clip: 200 ms each, back to back (was 0-400, 200-600, ...).
    const five = ["a", "b", "c", "d", "e"].map((text) => ({ text }));
    expect(span(five, 1000)).toEqual([
      [0, 200],
      [200, 400],
      [400, 600],
      [600, 800],
      [800, 1000],
    ]);
    // Rapid taps 150 ms apart: each page clears as the next appears.
    expect(span([{ text: "a", startMs: 1000 }, { text: "b", startMs: 1150 }, { text: "c", startMs: 1300 }], 5000)).toEqual([
      [1000, 1150],
      [1150, 1300],
      [1300, 5000],
    ]);
    // Two taps on one instant: the second replaces the first, which is not drawn.
    expect(resolvePageWindows([{ text: "a", startMs: 1000 }, { text: "b", startMs: 1000 }], 5000).map((w) => w.cueIndex)).toEqual([1]);
  });

  it("stretches an early clear tap to a readable beat, up to the next start; a held line may overlap", () => {
    const span = (cs: MosaicTimedCue[]) => resolvePageWindows(cs, 10_000).map((w) => [w.startMs, w.endMs]);
    // Room before the next page: the beat is MIN_PAGE_MS.
    expect(span([{ text: "a", startMs: 1000, endMs: 1100 }, { text: "b", startMs: 3000 }])[0]).toEqual([1000, 1000 + MIN_PAGE_MS]);
    // The next page comes sooner: the beat stops at its start.
    expect(span([{ text: "a", startMs: 1000, endMs: 1050 }, { text: "b", startMs: 1200 }])[0]).toEqual([1000, 1200]);
    // An explicit end past the next start is a held line (the cue-track contract): kept.
    expect(span([{ text: "a", startMs: 1000, endMs: 2500 }, { text: "b", startMs: 2000 }])[0]).toEqual([1000, 2500]);
  });

  it("keeps studio word times, monotonic and inside the page", () => {
    const words = resolveWordTimes(
      "a b c",
      { startMs: 1000, endMs: 3000 },
      [{ startMs: 1200 }, { startMs: 1100 }, { startMs: 9000 }] as MosaicTimedCue["words"],
      10,
    );
    expect(words.map((w) => w.atMs)).toEqual([1200, 1200, 2940]);
    expect(words.map((w) => w.index)).toEqual([10, 11, 12]);
    expect(words.every((w) => w.timed)).toBe(true);
  });

  it("tokenizes on whitespace and honours line breaks; recognises pauses", () => {
    expect(tokenize("  hello   world\nagain ")).toEqual([
      { text: "hello", lineBreakBefore: false },
      { text: "world", lineBreakBefore: false },
      { text: "again", lineBreakBefore: true },
    ]);
    expect(isBreakText(" [instrumental] ")).toBe(true);
    expect(isBreakText("[not] a pause")).toBe(false);
  });
});
