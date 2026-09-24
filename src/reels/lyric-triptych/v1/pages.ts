import type { MosaicTimedCue } from "@m0saic/types";

/**
 * Timing for lyric PAGES and their WORDS — pure, no ctx.
 *
 * The cue track is a list of pages: one cue = the words that share the
 * screen until it clears. A page's `startMs` is when it appears, its
 * `endMs` (or the next page's start) is when it clears, and its optional
 * `words[]` (one span per whitespace token — the Cue Timing Studio's word
 * pass) says when each word lands.
 *
 * Nothing here ever blocks a render. An artist mid-way through timing
 * should see their video, not an error card, so every gap is filled with a
 * guess that the next tap replaces:
 *   - no page timed at all  → pages spread evenly over the song;
 *   - some pages untimed    → they share the gap between timed neighbours;
 *   - words untimed         → spread by length across the page's first 70%
 *                             (or between the words that ARE timed).
 */

/** One page, resolved: when it shows, when it clears, when each word lands. */
export type LyricPage = {
  /** Output-timeline ms. */
  startMs: number;
  endMs: number;
  /** Whitespace tokens in order; `lineBreakBefore` marks an explicit "\n". */
  words: PageWord[];
};

export type PageWord = {
  text: string;
  /** When the word appears (output ms, inside the page window). */
  atMs: number;
  /** True when the time came from the studio, not a guess. */
  timed: boolean;
  lineBreakBefore: boolean;
};

/** A page whose whole text is `[like this]` is a pause: it clears the screen. */
export const isBreakText = (text: string): boolean => /^\s*\[[^\]]*\]\s*$/.test(text);

/** Guessed words land across this share of the page, leaving it readable after. */
export const WORD_SPREAD_FRACTION = 0.7;
/** Shortest page a guess will produce (ms). */
const MIN_PAGE_MS = 400;

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
 * Page windows for every cue, in order. Timed cues keep their times; runs of
 * untimed cues share the gap between their timed neighbours (a leading run
 * starts at 0, a trailing run ends at the song's end). An explicit `endMs`
 * wins when it is sane; otherwise a page lasts until the next one starts.
 * Cues starting at/after `durationMs` are dropped (a render pinned shorter
 * than the song).
 */
export function resolvePageWindows(
  cues: MosaicTimedCue[],
  durationMs: number,
): Array<{ cue: MosaicTimedCue; startMs: number; endMs: number }> {
  const dur = Math.max(1, Math.round(durationMs));
  const inside = cues.filter((c) => !(typeof c.startMs === "number" && c.startMs >= dur));
  const starts: number[] = new Array(inside.length);
  let i = 0;
  let prevBound = 0;
  while (i < inside.length) {
    const s = inside[i].startMs;
    if (typeof s === "number") {
      starts[i] = Math.max(prevBound, Math.max(0, s));
      prevBound = starts[i];
      i++;
      continue;
    }
    let j = i;
    while (j < inside.length && typeof inside[j].startMs !== "number") j++;
    const nextBound = j < inside.length ? Math.max(prevBound, inside[j].startMs as number) : dur;
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

  const out: Array<{ cue: MosaicTimedCue; startMs: number; endMs: number }> = [];
  for (let k = 0; k < inside.length; k++) {
    const startMs = Math.min(starts[k], dur - 1);
    const next = k + 1 < inside.length ? starts[k + 1] : dur;
    const explicit = inside[k].endMs;
    let endMs =
      typeof explicit === "number" && explicit > startMs ? Math.min(explicit, dur) : Math.min(next, dur);
    // Two taps on the same instant (or a mis-tap) still get a readable beat.
    if (endMs - startMs < MIN_PAGE_MS) endMs = Math.min(dur, startMs + MIN_PAGE_MS);
    if (endMs > startMs) out.push({ cue: inside[k], startMs, endMs });
  }
  return out;
}

/**
 * When each word of one page lands. Studio-timed words keep their time
 * (clamped into the page, never earlier than the word before); untimed words
 * are spread by character count between the timed words around them — or,
 * with nothing timed, across the first {@link WORD_SPREAD_FRACTION} of the
 * page. A `words[]` whose length no longer matches the text (the text was
 * edited after timing) is ignored, like the studio does.
 */
export function resolveWordTimes(
  text: string,
  window: { startMs: number; endMs: number },
  words: MosaicTimedCue["words"],
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

  const spreadEnd = clamp(
    Math.round(window.startMs + (window.endMs - window.startMs) * WORD_SPREAD_FRACTION),
  );
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
      j < tokens.length
        ? (known[j] as number)
        : Math.max(spreadEnd, Math.min(last, from + 180 * (j - i + 1)));
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
    atMs: clamp(at[k]),
    timed: known[k] !== undefined,
    lineBreakBefore: t.lineBreakBefore,
  }));
}

/** Every renderable page: windows + word times; pause pages (`[break]`) dropped. */
export function resolvePages(cues: MosaicTimedCue[], durationMs: number): LyricPage[] {
  return resolvePageWindows(cues, durationMs)
    .filter(({ cue }) => !isBreakText(cue.text))
    .map(({ cue, startMs, endMs }) => ({
      startMs,
      endMs,
      words: resolveWordTimes(cue.text, { startMs, endMs }, cue.words),
    }))
    .filter((p) => p.words.length > 0);
}
