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
export declare const isBreakText: (text: string) => boolean;
/** Guessed words land across this share of the page, leaving it readable after. */
export declare const WORD_SPREAD_FRACTION = 0.7;
/** Split a page into word tokens, remembering explicit line breaks. */
export declare function tokenize(text: string): Array<{
    text: string;
    lineBreakBefore: boolean;
}>;
/**
 * Page windows for every cue, in order. Timed cues keep their times; runs of
 * untimed cues share the gap between their timed neighbours (a leading run
 * starts at 0, a trailing run ends at the song's end). An explicit `endMs`
 * wins when it is sane; otherwise a page lasts until the next one starts.
 * Cues starting at/after `durationMs` are dropped (a render pinned shorter
 * than the song).
 */
export declare function resolvePageWindows(cues: MosaicTimedCue[], durationMs: number): Array<{
    cue: MosaicTimedCue;
    startMs: number;
    endMs: number;
}>;
/**
 * When each word of one page lands. Studio-timed words keep their time
 * (clamped into the page, never earlier than the word before); untimed words
 * are spread by character count between the timed words around them — or,
 * with nothing timed, across the first {@link WORD_SPREAD_FRACTION} of the
 * page. A `words[]` whose length no longer matches the text (the text was
 * edited after timing) is ignored, like the studio does.
 */
export declare function resolveWordTimes(text: string, window: {
    startMs: number;
    endMs: number;
}, words: MosaicTimedCue["words"]): PageWord[];
/** Every renderable page: windows + word times; pause pages (`[break]`) dropped. */
export declare function resolvePages(cues: MosaicTimedCue[], durationMs: number): LyricPage[];
