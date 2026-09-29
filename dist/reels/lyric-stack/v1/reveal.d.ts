import type { MosaicOverlayExpr } from "@m0saic/types";
/**
 * Reveal: WHEN each word is on screen, and how it arrives. Pure, no ctx.
 *
 * Three modes (the `reveal` prop):
 *
 *   cumulative  words land one by one on their beat and stay until the page
 *               clears (the triptych's behaviour);
 *   line        a line's words land together (at the line's first word) and
 *               stay until the page clears;
 *   word        ONE word at a time: each word shows alone, from its beat
 *               until the next word lands. Windows are disjoint (never two
 *               words on screen at once) and never empty, so a word too fast
 *               for its neighbours still gets a readable minimum when the
 *               page has room, and an equal share when it does not.
 *
 * CARRIED WORDS. A page that straddles Song start keeps the words sung
 * before the clip, clamped to the page start (`song-window.ts`), so the page
 * typesets as it does in the song; the caller marks them `carried`. The
 * build-up modes show them from the first frame (they had landed). In `word`
 * mode each of them already had its turn: only the LAST can still be on
 * screen when the clip begins, and only until the next word lands, so the
 * others are not drawn at all (before, each flashed for MIN_SOLO_MS and
 * pushed the words being sung late).
 *
 * Windows are half-open `[startMs, endMs)` on the output timeline, integer
 * ms. On the wire (`overlayWindow`) they become an inclusive `enable` /
 * `window` pair that ends one millisecond early, so a window closing at the
 * instant the next one opens never shares a frame with it.
 *
 * Placement expressions are inlined into the filtergraph verbatim, so the
 * rise (`yExpr`) is written comma-free (clamps via `abs()`); `alpha` and
 * `enable` are escaped by the engine and may use commas.
 */
export type RevealMode = "word" | "cumulative" | "line";
export type WordEntrance = "rise" | "fade" | "instant";
export declare const REVEAL_MODES: readonly RevealMode[];
export declare const WORD_ENTRANCES: readonly WordEntrance[];
/** How long a word takes to fade / rise into place, s. */
export declare const ENTRANCE_SEC = 0.28;
/** How far a rising word travels, in ems of its size. */
export declare const RISE_EM = 0.16;
/** The shortest window a word gets in `word` mode when the page has room, ms. */
export declare const MIN_SOLO_MS = 120;
/** A half-open window on the output timeline, integer ms. */
export type Window = {
    startMs: number;
    endMs: number;
};
/** The only word fields the windows read. */
export type RevealWord = {
    atMs: number;
    line: number;
    /** Sung before the clip began (the song window clamped it to the page start). Only `word` mode reads it. */
    carried?: boolean;
};
/** Seconds, 3 decimals: the one spelling every window string uses. */
export declare const sec: (ms: number) => string;
/**
 * Each word's window inside its page `[startMs, endMs)`. A word that lands at
 * or after the page end (a word sung after the clip ends keeps its place in
 * the page with `atMs === endMs`) gets an EMPTY window (`startMs === endMs`)
 * and is not drawn, and so does, in `word` mode, a carried word whose turn
 * ended before the clip (see CARRIED WORDS); every other window lies inside
 * the page and is non-empty.
 */
export declare function revealWindows(page: Window, words: readonly RevealWord[], mode: RevealMode): Window[];
/** True when a window shows anything. */
export declare const isShown: (w: Window) => boolean;
/**
 * `word` mode: disjoint, non-empty, in-order windows. Word k shows from its
 * (monotonic) beat until word k+1 lands; the last word holds to the page end.
 * A word landing too close to the next is given {@link MIN_SOLO_MS} when the
 * page has room for everyone; otherwise the page is shared out equally.
 */
export declare function soloWindows(page: Window, atMs: readonly number[]): Window[];
/** The enable string and structured window for a half-open `[startMs, endMs)`, in agreement. */
export declare function overlayWindow(w: Window): Pick<MosaicOverlayExpr, "enable" | "window">;
/**
 * A word tile's overlay: its window, plus the entrance. `fade` ramps alpha
 * 0 -> 1 over {@link ENTRANCE_SEC}; `rise` also eases the word up from
 * `risePx` below its place (an ease-out: the offset is `risePx * rest^2`).
 */
export declare function wordOverlay(w: Window, entrance: WordEntrance, risePx: number): MosaicOverlayExpr;
/** The union of windows, `null` for none. */
export declare function spanOf(windows: readonly Window[]): Window | null;
