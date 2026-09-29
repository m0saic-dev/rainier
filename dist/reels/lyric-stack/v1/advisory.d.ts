import type { Rect } from "../../../_shared/glyph-text";
import type { PlatformStage } from "../../../_shared/platforms";
/**
 * The design advisory: the plain-words notes Make shows while the artist
 * edits (the platform's length limit, a font that could not be used, Word
 * positions that were reset, characters the font lacks). Design only; never
 * in an export. Pure, no ctx.
 *
 * ITS OWN RECT, never the whole canvas: a full-canvas tile takes the pointer
 * over the whole frame in Make (a zero-alpha background changes nothing), so
 * no word under it could be hovered or dragged. The strip sits at the TOP of
 * the safe area, just under the app's nav row, `margin` in from the safe
 * edges and left of the action rail wherever the two share a row. It never
 * covers a drawn word when it can help it (`layoutAdvisory`):
 *   1. the top strip; else the BOTTOM of the safe area, just above the
 *      caption; else the first band down the safe area that touches no word;
 *   2. else the notes collapse to ONE line (the first note, "(+N more)") in
 *      the first free place of the same kind;
 *   3. else that one line where it overlaps the least word area.
 * (The document paints the advisory UNDER the lyrics, so even case 3 leaves
 * every word on top, hoverable and draggable.)
 *
 * WRAPPED, never cut off: the engine's svg text does not wrap, so the lines
 * are broken here with `wrapMeasured`, measured with the bundled face the
 * svg rasterizer draws with (Make's preview draws the same face with the
 * same breaks: `white-space: pre`, line height 1.25). Each note starts on its
 * own line; the size steps down (to 80 %, still readable) until the notes fit
 * in at most ADVISORY_MAX_LINES lines, EVERY line inside the text width. At
 * the floor a word that is still wider than the strip on its own (a long file
 * name) is shortened in the middle, keeping its end ("MyHandLet...FINAL.woff2"),
 * and a note past the line cap is cut with "..." on the last line. The text
 * is measured against 92 % of the strip, slack for a preview that falls back
 * to a wider face.
 *
 * DRAWABLE, never tofu: the bundled face covers ASCII and Latin-1 plus Latin
 * Extended-A (U+0020-U+007E, U+00A0-U+017F, checked against its cmap); any
 * other character in a note (a file name, say) is shown as "?".
 */
/** At most this many lines in the strip (three notes wrap to about five on a narrow canvas). */
export declare const ADVISORY_MAX_LINES = 6;
/** Share of the strip's width the text may use. */
export declare const ADVISORY_TEXT_FRAC = 0.92;
export type AdvisoryLayout = {
    /** The strip, canvas px. */
    rect: Rect;
    /** The wrapped notes, "\n"-joined: one svg text layer. */
    text: string;
    lines: number;
    fontSize: number;
};
export type AdvisoryOptions = {
    W: number;
    H: number;
    stage: PlatformStage;
    /** Rects the strip should not cover (the drawn words, canvas px). */
    avoid?: readonly Rect[];
};
/** True for a character the bundled face draws. */
export declare const drawable: (ch: string) => boolean;
/** A note with every character the bundled face lacks shown as "?". */
export declare const drawableText: (s: string) => string;
/** A character named for a note: itself in quotes when drawable, else its code point. */
export declare const nameChar: (ch: string) => string;
/**
 * `token` shortened in the middle until it fits `maxW` ("MyHandLet...FINAL.woff2"):
 * the most characters that fit, split evenly between its start and its end
 * (the end keeps a file's extension). Unchanged when it already fits.
 */
export declare function shortenToken(token: string, fontSize: number, maxW: number): string;
/**
 * Where the advisory goes and what it says, or null when there is nothing to
 * say. Deterministic.
 */
export declare function layoutAdvisory(notes: readonly string[], opts: AdvisoryOptions): AdvisoryLayout | null;
