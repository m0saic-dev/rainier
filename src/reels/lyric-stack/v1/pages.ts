import type { MosaicTimedCue } from "@m0saic/types";

/**
 * Timing for lyric PAGES and their WORDS: pure, no ctx.
 *
 * A LOCAL COPY of `lyric-triptych/v1/pages.ts` (that template is frozen, and a
 * frozen helper is never shared), with two additions Lyric Stack needs:
 *
 *   - every page remembers the cue it came from (`cueIndex`), and every word
 *     its GLOBAL index: its position in reading order across every page of
 *     the lyrics (`[break]` pages hold no words). It labels the word's tile
 *     (`word-N`) and stays put whatever slice of the song a clip shows
 *     (`songStartSec`). It is NOT the word's `wordBoxes` element: Word
 *     positions are per clip, one box per word the clip draws (see
 *     `lyric-stack.ts`).
 *   - `hasTimedPage` tells the caller whether the lyrics were timed at all
 *     (untimed lyrics spread over the clip, never over the whole song).
 *
 * And one fix: a short page's readable-beat stretch ({@link MIN_PAGE_MS})
 * stops at the next page's start. The triptych's stretch ran past it, so
 * pages less than 400 ms apart (rapid taps, a long lyric on a short clip)
 * drew on top of each other in the one lyric box. Only an explicit `endMs`
 * past the next start (a held line, which the cue-track contract allows)
 * still overlaps.
 *
 * The cue track is a list of pages: one cue = the words that share the
 * screen until it clears. A page's `startMs` is when it appears, its
 * `endMs` (or the next page's start) is when it clears, and its optional
 * `words[]` (one span per whitespace token: the Cue Timing Studio's word
 * pass) says when each word lands.
 *
 * Nothing here ever blocks a render. An artist mid-way through timing should
 * see their video, not an error card, so every gap is filled with a guess
 * that the next tap replaces:
 *   - no page timed at all  -> pages spread evenly over the timeline;
 *   - some pages untimed    -> they share the gap between timed neighbours;
 *   - words untimed         -> spread by length across the page's first 70%
 *                              (or between the words that ARE timed).
 */

/** One page, resolved: when it shows, when it clears, when each word lands. */
export type LyricPage = {
  /** Index of the cue this page came from (the position in the Lyrics list). */
  cueIndex: number;
  /** Timeline ms (the song's or the clip's, whichever it was resolved on). */
  startMs: number;
  endMs: number;
  /** Whitespace tokens in order; `lineBreakBefore` marks an explicit "\n". */
  words: PageWord[];
};

export type PageWord = {
  text: string;
  /** Position in reading order across every page of the lyrics. */
  index: number;
  /** When the word appears (timeline ms, inside the page window). */
  atMs: number;
  /** True when the time came from the studio, not a guess. */
  timed: boolean;
  lineBreakBefore: boolean;
  /**
   * Set by the caller that windows the song onto a clip: the word was sung
   * before the clip began (its time is clamped to the page start). `word`
   * reveal shows only the last such word of a page (`reveal.ts`).
   */
  carried?: boolean;
};

/** A page whose whole text is `[like this]` is a pause: it clears the screen. */
export const isBreakText = (text: string): boolean => /^\s*\[[^\]]*\]\s*$/.test(text);

/** Guessed words land across this share of the page, leaving it readable after. */
export const WORD_SPREAD_FRACTION = 0.7;
/**
 * A page whose own end comes sooner than this (ms) stretches toward it, but
 * never past the next page's start: pages share one lyric box.
 */
export const MIN_PAGE_MS = 400;

/** Split a page into word tokens, remembering explicit line breaks. */
export function tokenize(text: string): Array<{ text: string; lineBreakBefore: boolean }> {
  const out: Array<{ text: string; lineBreakBefore: boolean }> = [];
  text
    .trim()
    .split(/\n/)
    .forEach((line, li) => {
      line
        .split(/\s+/)
        .filter((t) => t !== "")
        .forEach((t, wi) => out.push({ text: t, lineBreakBefore: li > 0 && wi === 0 }));
    });
  return out;
}

/**
 * The global index of each cue's first word, and the total word count: words
 * of every non-break page in order. `[break]` pages hold no words.
 */
export function wordIndexBase(cues: readonly MosaicTimedCue[]): { firstWord: number[]; total: number } {
  const firstWord: number[] = [];
  let total = 0;
  for (const cue of cues) {
    firstWord.push(total);
    if (!isBreakText(cue.text)) total += tokenize(cue.text).length;
  }
  return { firstWord, total };
}

/** True when at least one page carries a studio start time. */
export function hasTimedPage(cues: readonly MosaicTimedCue[]): boolean {
  return cues.some((c) => typeof c.startMs === "number" && Number.isFinite(c.startMs));
}

/**
 * Page windows for every cue, in order. Timed cues keep their times; runs of
 * untimed cues share the gap between their timed neighbours (a leading run
 * starts at 0, a trailing run ends at the timeline's end). An explicit
 * `endMs` wins when it is sane; otherwise a page lasts until the next one
 * starts. A page shorter than {@link MIN_PAGE_MS} stretches, but only up to
 * the next page's start (a page with no room at all is dropped). Cues
 * starting at/after `durationMs` are dropped.
 */
export function resolvePageWindows(
  cues: readonly MosaicTimedCue[],
  durationMs: number,
): Array<{ cue: MosaicTimedCue; cueIndex: number; startMs: number; endMs: number }> {
  const dur = Math.max(1, Math.round(durationMs));
  const inside = cues
    .map((cue, cueIndex) => ({ cue, cueIndex }))
    .filter(({ cue }) => !(typeof cue.startMs === "number" && cue.startMs >= dur));
  const starts: number[] = new Array(inside.length);
  let i = 0;
  let prevBound = 0;
  while (i < inside.length) {
    const s = inside[i].cue.startMs;
    if (typeof s === "number") {
      starts[i] = Math.max(prevBound, Math.max(0, s));
      prevBound = starts[i];
      i++;
      continue;
    }
    let j = i;
    while (j < inside.length && typeof inside[j].cue.startMs !== "number") j++;
    const nextBound = j < inside.length ? Math.max(prevBound, inside[j].cue.startMs as number) : dur;
    const run = j - i;
    // With a timed page before the run, that page keeps the first slot.
    const slots = i > 0 ? run + 1 : run;
    const span = Math.max(0, nextBound - prevBound);
    for (let k = 0; k < run; k++) {
      const slot = i > 0 ? k + 1 : k;
      starts[i + k] = Math.round(prevBound + (slot * span) / Math.max(1, slots));
    }
    i = j;
    prevBound = nextBound;
  }

  const out: Array<{ cue: MosaicTimedCue; cueIndex: number; startMs: number; endMs: number }> = [];
  for (let k = 0; k < inside.length; k++) {
    const startMs = Math.min(starts[k], dur - 1);
    const next = k + 1 < inside.length ? starts[k + 1] : dur;
    const explicit = inside[k].cue.endMs;
    let endMs =
      typeof explicit === "number" && explicit > startMs ? Math.min(explicit, dur) : Math.min(next, dur);
    // A short page (an early clear tap) gets a readable beat, up to the next
    // page's start and never past it: two pages never share the lyric box
    // unless an explicit end holds a line over the next. A page with no room
    // at all (two taps on one instant) is replaced by the next and not drawn.
    if (endMs - startMs < MIN_PAGE_MS) endMs = Math.max(endMs, Math.min(dur, next, startMs + MIN_PAGE_MS));
    if (endMs > startMs) out.push({ cue: inside[k].cue, cueIndex: inside[k].cueIndex, startMs, endMs });
  }
  return out;
}

/**
 * When each word of one page lands. Studio-timed words keep their time
 * (clamped into the page, never earlier than the word before); untimed words
 * are spread by character count between the timed words around them, or,
 * with nothing timed, across the first {@link WORD_SPREAD_FRACTION} of the
 * page. A `words[]` whose length no longer matches the text (the text was
 * edited after timing) is ignored, like the studio does.
 */
export function resolveWordTimes(
  text: string,
  window: { startMs: number; endMs: number },
  words: MosaicTimedCue["words"],
  firstIndex = 0,
): PageWord[] {
  const tokens = tokenize(text);
  if (tokens.length === 0) return [];
  const aligned = Array.isArray(words) && words.length === tokens.length ? words : undefined;
  const last = Math.max(window.startMs, window.endMs - 60);
  const clamp = (ms: number) => Math.min(Math.max(ms, window.startMs), last);

  const known: Array<number | undefined> = tokens.map((_, i) => {
    const s = aligned?.[i]?.startMs;
    return typeof s === "number" && Number.isFinite(s) ? clamp(Math.round(s)) : undefined;
  });
  // Keep studio times monotonic (a mis-tap can't make a word land early).
  let floor = window.startMs;
  for (let i = 0; i < known.length; i++) {
    if (known[i] !== undefined) {
      known[i] = Math.max(floor, known[i] as number);
      floor = known[i] as number;
    }
  }

  const spreadEnd = clamp(Math.round(window.startMs + (window.endMs - window.startMs) * WORD_SPREAD_FRACTION));
  const at: number[] = new Array(tokens.length);
  let i = 0;
  while (i < tokens.length) {
    if (known[i] !== undefined) {
      at[i] = known[i] as number;
      i++;
      continue;
    }
    let j = i;
    while (j < tokens.length && known[j] === undefined) j++;
    // Guess the run [i, j) between its anchors, weighting by word length.
    const from = i > 0 ? at[i - 1] : window.startMs;
    // A trailing run past the spread point still gets a quick cascade.
    const to =
      j < tokens.length ? (known[j] as number) : Math.max(spreadEnd, Math.min(last, from + 180 * (j - i + 1)));
    const weights = tokens.slice(i, j).map((t) => Math.max(1, t.text.length));
    // A run after a timed word starts one share later (that word needs its moment).
    const lead = i > 0 ? Math.max(1, tokens[i - 1].text.length) : 0;
    const total = weights.reduce((a, b) => a + b, 0) + lead;
    let acc = lead;
    for (let k = i; k < j; k++) {
      at[k] = Math.round(from + ((to - from) * acc) / Math.max(1, total));
      acc += weights[k - i];
    }
    i = j;
  }

  return tokens.map((t, k) => ({
    text: t.text,
    index: firstIndex + k,
    atMs: clamp(at[k]),
    timed: known[k] !== undefined,
    lineBreakBefore: t.lineBreakBefore,
  }));
}

/**
 * Every renderable page on a timeline of `durationMs`: windows + word times,
 * pause pages (`[break]`) dropped. Word indexes are GLOBAL (see
 * {@link wordIndexBase}), whatever subset of the cues survives.
 */
export function resolvePages(cues: readonly MosaicTimedCue[], durationMs: number): LyricPage[] {
  const { firstWord } = wordIndexBase(cues);
  return resolvePageWindows(cues, durationMs)
    .filter(({ cue }) => !isBreakText(cue.text))
    .map(({ cue, cueIndex, startMs, endMs }) => ({
      cueIndex,
      startMs,
      endMs,
      words: resolveWordTimes(cue.text, { startMs, endMs }, cue.words, firstWord[cueIndex]),
    }))
    .filter((p) => p.words.length > 0);
}
