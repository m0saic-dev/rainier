import type { LyricPage } from "./pages";
/**
 * Typesetting for one lyric page — pure, deterministic.
 *
 * Every word is drawn as its OWN text layer (so it can appear on its own
 * beat), which means this module has to know exactly where drawtext would
 * have put it inside one long line. It measures with the committed
 * Helvetica Neue metrics (font-metrics.ts: advances + kerning, the same
 * numbers drawtext lays the font out with), breaks lines greedily, shrinks
 * a page that does not fit, and places each word's left edge and baseline.
 *
 * The look it copies: big words, justified edge to edge (a lone word sits
 * left), the block centred in the row.
 */
export type TextAlign = "justify" | "left" | "center";
export type Box = {
    x: number;
    y: number;
    w: number;
    h: number;
};
export type PlacedWord = {
    text: string;
    /** Left edge of the word's pen box (drawtext `x`), px in the cell. */
    x: number;
    /** Baseline, px in the cell (drawtext `y` = baseline − ascent). */
    baseline: number;
    atMs: number;
};
export type TypesetPage = {
    startMs: number;
    endMs: number;
    fontPx: number;
    lines: PlacedWord[][];
};
/** Line pitch as a multiple of the font size (measured off real posts ≈ 1.3). */
export declare const LINE_HEIGHT = 1.28;
/** Advance width of `text` at `fontPx`, kerning included. */
export declare function measureText(text: string, fontPx: number): number;
/**
 * Lay one page into `box`: the largest size on the ladder at which every
 * word fits the width and every line fits the height (the floor size wins
 * when nothing does — a page that long should be split into two).
 */
export declare function typesetPage(page: LyricPage, box: Box, opts: {
    fontPx: number;
    align: TextAlign;
}): TypesetPage;
