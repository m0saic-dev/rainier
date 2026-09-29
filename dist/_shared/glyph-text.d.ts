/**
 * Glyph text: lyrics typeset as SVG glyph OUTLINES cut from a real font file.
 * Pure, deterministic, no ctx, no fs (the glyph engine reads the font).
 *
 * THE TILE. Every word is its own rect: a colour tile whose `inline-mask`
 * is the word's outline. The engine rasterises the mask with
 * `viewBox = 0 0 bounds.width bounds.height` stretched onto the tile, so
 * `wordTile` returns `bounds = { x: 0, y: 0, width: rect.w, height: rect.h }`
 * and a path in the rect's OWN px space, with the rect in integer px. The
 * rect is rounded outward and the fractional remainder goes into the path's
 * offset, so a word's baseline and pen position land exactly (to the path's
 * 0.01 px) where the typesetter put them.
 *
 * ONE BASELINE PER LINE. A tile's top and height come from the FONT's
 * ascent and descent, not the word's own ink, so "on" and "the" on one line
 * share one baseline inside identical rects (the triptych's drawtext placed
 * words by their tallest glyph, so the two drifted).
 *
 * INK THAT LEAVES THE FONT BLOCK. Some faces draw outside the advance box
 * and the ascent/descent block: script swashes (Pacifico runs ~0.13 em past
 * its advance), leaning display faces (Bangers), accents over capitals (an
 * A-ring in Archivo Black climbs 0.08 em above the ascent). A mask clips at its
 * bounds, so a rect cut to the font block would shave those glyphs. Every
 * measurement here therefore uses a word's EXTENT: the union of its advance
 * box x ascent/descent block and its ink bounding box. For nearly every word
 * in nearly every font the two are the same box; where the ink overhangs,
 * the rect grows to hold it (baseline unchanged), `typesetPage` keeps the
 * overhang inside the box it was given, and `fitWordToBox` fits and centres
 * the extent, so a tile's rect is the box it was fitted to and a dragged
 * tile round-trips without growing or drifting.
 *
 * UNITS. Every size and position is px in the caller's space (canvas, or a
 * page child's local space, whichever `box` / `x` / `baseline` are in).
 * `fontPx` is the em size. `fontPath` is an absolute font file path, or
 * `undefined` for the glyph engine's bundled Roboto.
 *
 * FONT ERRORS. Every function THROWS when the engine cannot read `fontPath`
 * (missing file, not a font, WOFF2). Check a user's font once with
 * `fontError` before drawing with it.
 *
 * MEMO. Advances, kerning and outlines are linear in size, so each font's
 * numbers are measured once in em units (per font path, per word) and
 * scaled by `fontPx`; a shrink ladder costs no extra parsing. The memo is
 * keyed by path for the life of the process, like the glyph engine's own
 * parsed-font cache: a font file replaced in place is not re-read.
 *
 * COVERAGE. A character the font lacks draws as `.notdef` (usually a box).
 * `glyphCoverage` finds them by comparing each character's outline and
 * advance with `.notdef`'s; `normalizeForFont` swaps the typographic
 * characters Apple Notes types (curly quotes, ellipsis, dashes, no-break
 * space) for ASCII when the font lacks them, and reports the rest.
 *
 * `_shared` is frozen once shipped: a change is a copy beside a new template
 * version, never an edit here.
 */
/** A rectangle in px, in the caller's space. */
export type Rect = {
    x: number;
    y: number;
    w: number;
    h: number;
};
/** How a page's lines sit in their box. Justify spreads each line edge to edge; a lone word sits left. */
export type TextAlign = "justify" | "left" | "center";
/** How one fitted word sits in its box horizontally (`justify` = `left`: a lone word sits left). */
export type WordAlign = "left" | "center" | "right" | "justify";
/** Line pitch as a multiple of the font size (the triptych's, measured off real posts). */
export declare const LINE_HEIGHT = 1.28;
/** The smallest fraction of the requested size a page shrinks to. */
export declare const MIN_SCALE = 0.38;
/** Shrink steps a page tries in order (fractions of the requested size), the triptych's ladder. */
export declare const FIT_LADDER: readonly number[];
/** Font-wide metrics at one size, px. */
export type FontMetrics = {
    /** Above the baseline (the font's hhea ascender). */
    ascent: number;
    /** Below the baseline, positive (the font's hhea descender). */
    descent: number;
    /** Advance of the space glyph. */
    spaceWidth: number;
};
export type TypesetOptions = {
    /** Requested em size, px (> 0). The page shrinks from here when it does not fit. */
    fontPx: number;
    align: TextAlign;
    /** Font file; `undefined` = the glyph engine's bundled Roboto. */
    fontPath?: string;
    /** Baseline pitch as a multiple of the font size. Default `LINE_HEIGHT` (1.28). */
    lineHeight?: number;
    /** Floor of the shrink ladder, 0 < minScale <= 1. Default `MIN_SCALE` (0.38). */
    minScale?: number;
    /** `lineBreaksBefore[i]` starts a new line at word `i` (ignored for the first word). */
    lineBreaksBefore?: readonly boolean[];
    /** The `pad` the caller will pass to `wordTile`, px (default 0), so the padded tiles stay inside the box. */
    pad?: number;
};
export type TypesetWord = {
    /** The word's index in the input (reading order). */
    index: number;
    text: string;
    /** Pen origin: left edge of the word's advance box, px. Hand it to `wordTile`. */
    x: number;
    /** Advance width with kerning, px. */
    width: number;
};
export type TypesetLine = {
    /** The line's baseline, px. Hand it to `wordTile`. */
    baseline: number;
    words: TypesetWord[];
};
export type TypesetPage = {
    /** The size the page was set at, px (the requested size times a ladder step). */
    fontPx: number;
    lines: TypesetLine[];
    /**
     * True when every line and the block fit the box. False only at the
     * ladder's floor (the page is too long for the box: split it) or when a
     * single word is wider than the box even at the floor.
     */
    fits: boolean;
};
export type WordTileOptions = {
    /** Extra px around the word's extent on every side (default 0). */
    pad?: number;
};
/** One word as a masked colour tile. */
export type WordTile = {
    /** Integer px, in the same space as the `x` / `baseline` given. */
    rect: Rect;
    /** SVG path of the glyph outlines in rect-local px; `""` for an empty word. */
    d: string;
    /** The `inline-mask` bounds: always the rect's own size at the origin. */
    bounds: {
        x: 0;
        y: 0;
        width: number;
        height: number;
    };
};
export type FitWordOptions = {
    /** Horizontal placement of the word in the box. Default `"center"`. */
    align?: WordAlign;
    /** Cap on the fitted em size, px. */
    maxPx?: number;
    /** The `pad` the caller will pass to `wordTile`, px (default 0). */
    pad?: number;
};
export type FittedWord = {
    /** Em size, px. */
    fontPx: number;
    /** Pen origin, px. */
    x: number;
    /** Baseline, px. */
    baseline: number;
};
export type NormalizedText = {
    text: string;
    /** Characters the font lacks and nothing stood in for, each once, in order of first appearance. */
    missing: string[];
};
/**
 * `null` when the glyph engine can read and draw with `fontPath`, else the
 * engine's reason (for logs: it may carry the full path, so show the artist
 * the file NAME, never this text). Never throws. Every other function here
 * THROWS on a font the engine cannot read (missing file, not a font, WOFF2),
 * so a template checks a user's font once, up front, and falls back to a
 * bundled face (`resolveFontPath(choice, { readError: fontError })` in
 * `fonts.ts` does exactly that). A good font is parsed once and memoised; a
 * failure is not remembered, so a file that appears later is picked up.
 */
export declare function fontError(fontPath: string | undefined): string | null;
/** Ascent, descent and space advance of the font at `fontPx`, px. */
export declare function fontMetrics(fontPath: string | undefined, fontPx: number): FontMetrics;
/** Advance width of `text` at `fontPx` with the font's kerning, px. */
export declare function measureWord(text: string, fontPx: number, fontPath: string | undefined): number;
/**
 * The space between two words set on one line, px: the space's advance plus
 * the kerning between `left`'s last character and the space and between the
 * space and `right`'s first character.
 */
export declare function spaceBetween(left: string, right: string, fontPx: number, fontPath: string | undefined): number;
/**
 * Characters of `text` the font has no glyph for (they would draw as
 * `.notdef`), each once, in order of first appearance. Controls and line
 * breaks are never reported, and neither is a space-like character in a
 * face whose `.notdef` is blank (it draws as a blank anyway).
 */
export declare function glyphCoverage(text: string, fontPath: string | undefined): string[];
/**
 * `text` made drawable in the font: a character the font lacks becomes its
 * ASCII stand-in (U+2018 / U+2019 -> ', U+201C / U+201D -> ", U+2026 -> ...,
 * U+2013 / U+2014 -> -, no-break space -> space, invisible joiners removed,
 * and a few relatives) when the font has the stand-in. Anything else it
 * lacks stays in the text (it draws as `.notdef`) and is reported. A
 * character the font HAS is never touched: a font with real curly quotes
 * keeps them.
 */
export declare function normalizeForFont(text: string, fontPath: string | undefined): NormalizedText;
/**
 * One word as a masked tile: its pen at `x`, its baseline at `baseline`
 * (px, any space), set at `fontPx`.
 *
 * The rect spans the font's ascent and descent (plus `pad`) and the word's
 * advance (plus `pad`), grown only where the ink leaves that block, then
 * rounded outward to integers. The fractional remainder goes into the path's
 * offset, so the glyphs sit on `baseline` exactly. `d` is in rect-local px
 * and `bounds` is `{ 0, 0, rect.w, rect.h }`: hand both to an `inline-mask`
 * and place the tile at `rect`.
 */
export declare function wordTile(text: string, x: number, baseline: number, fontPx: number, fontPath: string | undefined, opts?: WordTileOptions): WordTile;
/**
 * The largest size at which `text` fits `box` (w and h), and where its pen
 * and baseline go: the word's extent (its advance box x the font's ascent +
 * descent block, grown by any overhanging ink, plus `pad`) is centred
 * vertically and centred (or aligned) horizontally. Scaling the box about
 * its centre scales the word about the same centre, so a resized box keeps
 * the word where it was (the "a centred word grows but doesn't stay
 * centred" complaint). Pass the result to `wordTile` with the same `pad`;
 * the tile's rect is then the fitted extent, inside the box.
 *
 * When nothing fits (a box smaller than 1 px of type) the size is 1 px and
 * the word overflows its box, still centred.
 */
export declare function fitWordToBox(text: string, box: Rect, fontPath: string | undefined, opts?: FitWordOptions): FittedWord;
/**
 * Lay `words` into `box`: greedy line breaking (forced breaks honoured),
 * shrinking down the ladder until every line fits the width and the block
 * fits the height (the floor size wins when nothing does, with `fits:
 * false`). The block (first ascent to last descent) is centred vertically,
 * nudged only to keep overhanging ink inside the box. Justify spreads each
 * line's spare width evenly across its gaps; a lone word sits left.
 *
 * Words are tokens without spaces. Positions are floats: `wordTile` does the
 * integer rounding without moving the glyphs.
 */
export declare function typesetPage(words: readonly string[], box: Rect, opts: TypesetOptions): TypesetPage;
