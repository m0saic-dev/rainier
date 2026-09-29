import type { SongWindowPage } from "./song-window";
import { songStartOf, windowMs, windowPages } from "./song-window";

/** The shape the lyric templates use (the triptych's `LyricPage`). */
type Word = { text: string; atMs: number; timed: boolean; lineBreakBefore: boolean };
type Page = { startMs: number; endMs: number; words: Word[] };

const word = (text: string, atMs: number): Word => ({ text, atMs, timed: true, lineBreakBefore: false });
const page = (startMs: number, endMs: number, ...words: Word[]): Page => ({ startMs, endMs, words });

/** Placeholder lyrics, invented. */
const SONG: Page[] = [
  page(1_000, 4_000, word("first", 1_000), word("page", 1_600)),
  page(4_000, 9_000, word("second", 4_200), word("page", 5_000), word("here", 8_500)),
  page(9_000, 14_000, word("third", 9_100), word("page", 10_000)),
  page(14_000, 20_000, word("fourth", 14_500), word("page", 19_500)),
  page(20_000, 26_000, word("last", 20_100)),
];

const deepFreeze = <T>(v: T): T => {
  if (v && typeof v === "object") {
    Object.values(v as object).forEach(deepFreeze);
    Object.freeze(v);
  }
  return v;
};

describe("windowMs", () => {
  it("shifts by minus the song start and never clamps", () => {
    expect(windowMs(12_000, 10_000)).toBe(2_000);
    expect(windowMs(4_000, 10_000)).toBe(-6_000);
    expect(windowMs(4_000, 0)).toBe(4_000);
  });

  it("reads the song start as a whole, non-negative ms", () => {
    expect(songStartOf(30.05 * 1000)).toBe(30_050);
    expect(windowMs(30_050, 30.05 * 1000)).toBe(0);
    expect(songStartOf(-500)).toBe(0);
    expect(songStartOf(Number.NaN)).toBe(0);
  });
});

describe("windowPages", () => {
  it("at song start 0 over the whole song, changes nothing but identity", () => {
    const out = windowPages(SONG, { songStartMs: 0, durationMs: 60_000 });
    expect(out).toEqual(SONG);
  });

  it("shifts every time by minus the song start", () => {
    const out = windowPages(SONG, { songStartMs: 4_000, durationMs: 60_000 });
    expect(out.map((p) => [p.startMs, p.endMs])).toEqual([
      [0, 5_000],
      [5_000, 10_000],
      [10_000, 16_000],
      [16_000, 22_000],
    ]);
    expect(out[1].words.map((w) => w.atMs)).toEqual([5_100, 6_000]);
  });

  it("drops pages ending at or before 0 and pages starting at or after the duration", () => {
    // clip = song 9 s .. 20 s
    const out = windowPages(SONG, { songStartMs: 9_000, durationMs: 11_000 });
    // page 1 ends at 4 s, page 2 ends exactly at 9 s (0 on the clip): both gone;
    // the last page starts exactly at 20 s (the duration): gone.
    expect(out.map((p) => p.words[0].text)).toEqual(["third", "fourth"]);
    expect(out.map((p) => [p.startMs, p.endMs])).toEqual([
      [0, 5_000],
      [5_000, 11_000],
    ]);
  });

  it("clamps straddlers: start to 0, early words to 0, end to the duration", () => {
    // clip = song 5 s .. 15 s
    const out = windowPages(SONG, { songStartMs: 5_000, durationMs: 10_000 });
    expect(out.map((p) => p.words[0].text)).toEqual(["second", "third", "fourth"]);
    const [first, , last] = out;
    expect([first.startMs, first.endMs]).toEqual([0, 4_000]);
    // "second" landed at 4.2 s (before the clip): shows from 0. "page" at 5 s is 0 exactly.
    expect(first.words.map((w) => w.atMs)).toEqual([0, 0, 3_500]);
    // the fourth page runs 14 s .. 20 s: cut at the clip end; its late word keeps
    // its place in the page, landing at the end (never shown).
    expect([last.startMs, last.endMs]).toEqual([9_000, 10_000]);
    expect(last.words.map((w) => [w.text, w.atMs])).toEqual([
      ["fourth", 9_500],
      ["page", 10_000],
    ]);
  });

  it("every word stays inside its page window", () => {
    for (const songStartMs of [0, 1_500, 4_100, 9_000, 13_999, 19_600]) {
      for (const durationMs of [500, 3_000, 10_000, 60_000]) {
        for (const p of windowPages(SONG, { songStartMs, durationMs })) {
          expect(p.startMs).toBeGreaterThanOrEqual(0);
          expect(p.endMs).toBeLessThanOrEqual(durationMs);
          expect(p.startMs).toBeLessThan(p.endMs);
          for (const w of p.words) {
            expect(w.atMs).toBeGreaterThanOrEqual(p.startMs);
            expect(w.atMs).toBeLessThanOrEqual(p.endMs);
          }
        }
      }
    }
  });

  it("keeps the input order, even when the input is out of time order", () => {
    const shuffled = [SONG[3], SONG[1], SONG[2]];
    const out = windowPages(shuffled, { songStartMs: 2_000, durationMs: 60_000 });
    expect(out.map((p) => p.words[0].text)).toEqual(["fourth", "second", "third"]);
  });

  it("is pure: the input is untouched and every page and word is a new object", () => {
    const input = deepFreeze(SONG.map((p) => ({ ...p, words: p.words.map((w) => ({ ...w })) })));
    const snapshot = JSON.stringify(input);
    const out = windowPages(input, { songStartMs: 0, durationMs: 60_000 });
    expect(JSON.stringify(input)).toBe(snapshot);
    out.forEach((p, i) => {
      expect(p).not.toBe(input[i]);
      expect(p.words).not.toBe(input[i].words);
      p.words.forEach((w, j) => expect(w).not.toBe(input[i].words[j]));
    });
  });

  it("carries every other field through (text, timed, line breaks) and keeps the caller's type", () => {
    const withExtras = [
      {
        startMs: 3_000,
        endMs: 6_000,
        label: "chorus",
        words: [{ text: "hold", atMs: 3_000, timed: false, lineBreakBefore: true }],
      },
    ];
    const out = windowPages(withExtras, { songStartMs: 1_000, durationMs: 60_000 });
    const label: string = out[0].label;
    expect(label).toBe("chorus");
    expect(out[0].words[0]).toEqual({ text: "hold", atMs: 2_000, timed: false, lineBreakBefore: true });
  });

  it("an open-ended window (Infinity) keeps everything after the start; an empty one keeps nothing", () => {
    expect(windowPages(SONG, { songStartMs: 0, durationMs: Infinity })).toHaveLength(5);
    expect(windowPages(SONG, { songStartMs: 0, durationMs: Number.NaN })).toHaveLength(5);
    expect(windowPages(SONG, { songStartMs: 0, durationMs: 0 })).toEqual([]);
    expect(windowPages([] as SongWindowPage[], { songStartMs: 0, durationMs: 1_000 })).toEqual([]);
  });
});
