import { isBreakText, resolvePageWindows, resolvePages, resolveWordTimes, tokenize } from "./pages";

describe("lyric pages: timing that never blocks a render", () => {
  it("spreads a fully untimed set evenly over the song", () => {
    const w = resolvePageWindows([{ text: "a" }, { text: "b" }, { text: "c" }, { text: "d" }], 8000);
    expect(w.map((p) => [p.startMs, p.endMs])).toEqual([
      [0, 2000],
      [2000, 4000],
      [4000, 6000],
      [6000, 8000],
    ]);
  });

  it("lets untimed pages share the gap between timed neighbours", () => {
    const w = resolvePageWindows(
      [{ text: "a", startMs: 1000 }, { text: "b" }, { text: "c" }, { text: "d", startMs: 4000 }],
      10_000,
    );
    expect(w.map((p) => p.startMs)).toEqual([1000, 2000, 3000, 4000]);
    expect(w[3].endMs).toBe(10_000);
  });

  it("keeps an explicit end (a clear before the next page) and drops pages past the end", () => {
    const w = resolvePageWindows(
      [{ text: "a", startMs: 0, endMs: 1500 }, { text: "b", startMs: 3000 }, { text: "late", startMs: 9000 }],
      5000,
    );
    expect(w.map((p) => [p.cue.text, p.startMs, p.endMs])).toEqual([
      ["a", 0, 1500],
      ["b", 3000, 5000],
    ]);
  });

  it("treats a [bracketed] page as a pause that clears the screen", () => {
    expect(isBreakText("[break]")).toBe(true);
    expect(isBreakText(" [Instrumental] ")).toBe(true);
    expect(isBreakText("not [a] break")).toBe(false);
    const pages = resolvePages(
      [{ text: "one two", startMs: 0 }, { text: "[break]", startMs: 1000 }, { text: "three", startMs: 2000 }],
      3000,
    );
    expect(pages.map((p) => [p.words.map((w) => w.text).join(" "), p.startMs, p.endMs])).toEqual([
      ["one two", 0, 1000],
      ["three", 2000, 3000],
    ]);
  });

  it("keeps studio word times and guesses the rest in between, by length", () => {
    const words = resolveWordTimes("aa bbbb cc dd", { startMs: 1000, endMs: 5000 }, [
      { startMs: 1000 },
      {},
      {},
      { startMs: 3000 },
    ]);
    // aa : bbbb : cc share the 2 s before "dd" as 2 : 4 : 2.
    expect(words.map((w) => w.atMs)).toEqual([1000, 1500, 2500, 3000]);
    expect(words.map((w) => w.timed)).toEqual([true, false, false, true]);
  });

  it("spreads fully untimed words over the first 70% of the page", () => {
    const words = resolveWordTimes("one two three four", { startMs: 0, endMs: 10_000 }, undefined);
    expect(words[0].atMs).toBe(0);
    expect(words[3].atMs).toBeLessThan(7000);
    expect([...words.map((w) => w.atMs)].sort((a, b) => a - b)).toEqual(words.map((w) => w.atMs));
  });

  it("ignores word timing whose count no longer matches the text (edited after timing)", () => {
    const stale = resolveWordTimes("one two three", { startMs: 0, endMs: 3000 }, [{ startMs: 2500 }, { startMs: 2600 }]);
    expect(stale.every((w) => !w.timed)).toBe(true);
  });

  it("never lets a mis-tapped word land before the word ahead of it", () => {
    const words = resolveWordTimes("a b c", { startMs: 0, endMs: 3000 }, [
      { startMs: 1000 },
      { startMs: 500 },
      { startMs: 2000 },
    ]);
    expect(words.map((w) => w.atMs)).toEqual([1000, 1000, 2000]);
  });

  it("honours explicit line breaks inside a page", () => {
    expect(tokenize("one two\nthree")).toEqual([
      { text: "one", lineBreakBefore: false },
      { text: "two", lineBreakBefore: false },
      { text: "three", lineBreakBefore: true },
    ]);
  });
});
