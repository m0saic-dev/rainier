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
export declare const isBreakText: (text: string) => boolean;
/** Guessed words land across this share of the page, leaving it readable after. */
export declare const WORD_SPREAD_FRACTION = 0.7;
/**
 * A page whose own end comes sooner than this (ms) stretches toward it, but
 * never past the next page's start: pages share one lyric box.
 */
export declare const MIN_PAGE_MS = 400;
/** Split a page into word tokens, remembering explicit line breaks. */
export declare function tokenize(text: string): Array<{
    text: string;
    lineBreakBefore: boolean;
}>;
/**
 * The global index of each cue's first word, and the total word count: words
 * of every non-break page in order. `[break]` pages hold no words.
 */
export declare function wordIndexBase(cues: readonly MosaicTimedCue[]): {
    firstWord: number[];
    total: number;
};
/** True when at least one page carries a studio start time. */
export declare function hasTimedPage(cues: readonly MosaicTimedCue[]): boolean;
/**
 * Page windows for every cue, in order. Timed cues keep their times; runs of
 * untimed cues share the gap between their timed neighbours (a leading run
 * starts at 0, a trailing run ends at the timeline's end). An explicit
 * `endMs` wins when it is sane; otherwise a page lasts until the next one
 * starts. A page shorter than {@link MIN_PAGE_MS} stretches, but only up to
 * the next page's start (a page with no room at all is dropped). Cues
 * starting at/after `durationMs` are dropped.
 */
export declare function resolvePageWindows(cues: readonly MosaicTimedCue[], durationMs: number): Array<{
    cue: MosaicTimedCue;
    cueIndex: number;
    startMs: number;
    endMs: number;
}>;
/**
 * When each word of one page lands. Studio-timed words keep their time
 * (clamped into the page, never earlier than the word before); untimed words
 * are spread by character count between the timed words around them, or,
 * with nothing timed, across the first {@link WORD_SPREAD_FRACTION} of the
 * page. A `words[]` whose length no longer matches the text (the text was
 * edited after timing) is ignored, like the studio does.
 */
export declare function resolveWordTimes(text: string, window: {
    startMs: number;
    endMs: number;
}, words: MosaicTimedCue["words"], firstIndex?: number): PageWord[];
/**
 * Every renderable page on a timeline of `durationMs`: windows + word times,
 * pause pages (`[break]`) dropped. Word indexes are GLOBAL (see
 * {@link wordIndexBase}), whatever subset of the cues survives.
 */
export declare function resolvePages(cues: readonly MosaicTimedCue[], durationMs: number): LyricPage[];
