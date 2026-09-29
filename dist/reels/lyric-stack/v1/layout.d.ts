import type { Rect, TextAlign } from "../../../_shared/glyph-text";
import type { RevealMode } from "./reveal";
/**
 * Word layout: where each word of a page sits, as a glyph-outline tile in
 * ROOT canvas px. Pure, deterministic; the glyph engine reads the font file.
 *
 *   cumulative / line  the page is typeset into the lyric box (greedy lines,
 *                      shrink ladder, the chosen alignment), one tile per word
 *                      on its line's baseline;
 *   word               every word ALONE, fitted to the lyric box and centred in
 *                      it (capped at `soloMaxPx`), so the centre never moves
 *                      from word to word.
 *
 * CUSTOM LAYOUT (`applyWordBoxes`). Make writes the whole `wordBoxes` list
 * whenever one word is dragged, every sibling pinned at the rect it was
 * painted in. So a box within 1 px of the word's own tile rect is UNTOUCHED
 * (the word keeps following size, alignment and position), and a moved or
 * resized box re-fits the word inside it, centred (`fitWordToBox`): a bigger
 * box is a bigger word and its centre stays put.
 *
 * ON THE CANVAS, ALWAYS. A word tile whose rect leaves the canvas cannot be
 * placed (`placeInsetPieces` throws, and the whole render fails). So:
 *   - a page too big for the box even at the shrink ladder's floor (a very
 *     long token, dozens of forced line breaks) keeps shrinking, below the
 *     floor, until it fits the box (which lies inside the canvas);
 *   - every word is then checked against the canvas (`keepOnCanvas`): one
 *     that still leaves it is re-fitted into the part of its rect the canvas
 *     shows, and when even the smallest word overflows that (a box dragged to
 *     a sliver at the edge, narrower than the padding), the whole tile slides
 *     in. Its path is rect-local, so moving the rect moves the glyphs with it;
 *     the rect is never cropped under its mask. A word that fits nowhere on
 *     the canvas (thousands of characters) is not drawn; a word the artist
 *     boxed falls back to its own layout instead, so the words a clip draws,
 *     and with them the `wordBoxes` slots, never depend on a box.
 *
 * Text goes through `normalizeForFont` first: curly quotes, ellipses, dashes
 * and no-break spaces that the font lacks become ASCII stand-ins, and what
 * is still missing is reported (it would draw as the font's `.notdef`).
 */
export type LayoutWordInput = {
    /** Global reading-order index in the lyrics (it rides along; layout never reads it). */
    index: number;
    text: string;
    atMs: number;
    lineBreakBefore: boolean;
};
export type LaidWord = {
    index: number;
    /** The text as drawn (normalized for the font). Empty = nothing to draw. */
    text: string;
    atMs: number;
    /** Line number inside the page (in `word` mode every word is its own line). */
    line: number;
    fontPx: number;
    /** Integer root-canvas px: the tile's rect (and the rect Make drags). */
    rect: Rect;
    /** Glyph outlines in rect-local px (`inline-mask` localPath); `""` for an empty word. */
    d: string;
    /** True when the rect came from the artist's `wordBoxes` entry. */
    moved: boolean;
};
export type PageLayoutOptions = {
    /** The lyric box, root canvas px. */
    box: Rect;
    /** Requested size, px (the page shrinks from here when it does not fit). */
    fontPx: number;
    align: TextAlign;
    fontPath: string | undefined;
    /** Padding around every word tile, px (the same value for typesetting and tiles). */
    pad: number;
    mode: RevealMode;
    /** `word` mode: the largest size a lone word grows to, px. */
    soloMaxPx: number;
    /** The canvas every word tile must stay inside, px (the page children are full-canvas). */
    canvas: Canvas;
};
/** A canvas size, px. */
export type Canvas = {
    W: number;
    H: number;
};
export type PageLayout = {
    words: LaidWord[];
    /** The page's representative size, px (typeset size, or the mean solo size). */
    fontPx: number;
    /** Characters the font lacks (drawn as `.notdef`), each once. */
    missing: string[];
};
/** True when `r` lies wholly inside the canvas. */
export declare function onCanvas(r: Rect, canvas: Canvas): boolean;
/** Every word inside the canvas; one that fits nowhere on it is emptied (not drawn). */
export declare function keepOnCanvas(words: readonly LaidWord[], canvas: Canvas, fontPath: string | undefined, pad: number): LaidWord[];
/** Lay one page's words into `opts.box`, every tile inside `opts.canvas`. */
export declare function layoutPage(words: readonly LayoutWordInput[], opts: PageLayoutOptions): PageLayout;
/** Two rects within `tol` px on every edge measure. */
export declare function sameBox(a: Rect, b: Rect, tol?: number): boolean;
/**
 * The artist's word boxes over the laid-out words (already on the canvas).
 * `boxes[k]` is `words[k]`'s box in root canvas px, aligned with `words`
 * (null or missing = no box: the word keeps its layout). The caller decides
 * which `wordBoxes` element belongs to which word, and whether the list
 * applies at all. A box within 1 px of the word's own rect is untouched; any
 * other box re-fits the word, centred, kept on the canvas; a word no size of
 * which fits there keeps its own layout.
 */
export declare function applyWordBoxes(words: readonly LaidWord[], boxes: ReadonlyArray<Rect | null | undefined>, fontPath: string | undefined, pad: number, canvas: Canvas): LaidWord[];
