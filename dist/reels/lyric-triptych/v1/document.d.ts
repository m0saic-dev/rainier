import type { MosaicColor, MosaicDocument, MosaicMediaKind } from "@m0saic/types";
import type { LyricPage } from "./pages";
import type { Box, TextAlign, TypesetPage } from "./typeset";
/**
 * The document — pure assembly, no ctx.
 *
 * Geometry is a gutterless `3[1,1,1]` (three equal rows); the border between
 * them is a per-row `placement.inset` from `latticeCellInset`, so the gaps are
 * exactly `borderPx` on every canvas and the document background shows
 * through them as the border colour (ratio-grid recipe: never DSL gutters).
 *
 * Everything else rides overlays, nested so paint order is explicit:
 *
 *   template layout:  3[ row, row{ glow{ words … }}, row ]{ reelsUi{ song } }
 *   custom layout:    3[ row, row{ glow{ <one cell per word> }}, row ]{ … }
 *
 * THE RENDER, both layouts: every word is ONE drawtext layer inside a
 * row-sized text source — its own x (measured), its own y (`baseline −
 * inkTop`: drawtext places a string by its tallest glyph, so the measured
 * glyph top puts words with and without ascenders on one baseline, as a plain
 * number Make's preview can evaluate too), its own enable window [word lands,
 * page clears) and entrance. Placement exprs are inlined into the filtergraph
 * verbatim, so they must stay COMMA-FREE (no min/max/if — clamps are written
 * with abs()).
 *
 * CUSTOM layout, in Make (`editable`, the host's design pass): every word is
 * its OWN CELL (a real m0 rect, placed with `placeInsetPieces` so it paints
 * on its exact box), a one-word tile whose window / fade / rise ride the
 * source overlay, bound to element `i` of the `wordBoxes` regions list. The
 * artist drags or resizes a word; the box written back becomes that word's
 * position and size (bigger box = bigger font). The REAL render draws the
 * same final positions through the drawtext path above: one cell per word
 * would cost every word its own composite input (measured ~5x slower on a
 * 150-word minute) for pixels the drawtext layer already puts in the same
 * place.
 *
 * Every row tile is BOUND to its clip prop (a `media` binding), filled or
 * not: in Make the row is a drop target (drag a video or photo onto it) and
 * a click opens the picker. Make looks THROUGH unbound tiles stacked on top
 * (the lyric layers, the Reels UI, the song leaf) to the row beneath, so
 * only the rows carry bindings — never the song, whose leaf covers the
 * whole canvas and would swallow every drop.
 */
export type Row = {
    /** The `media` prop this row shows; its tile is bound to it (drop target). */
    propKey: string;
    /** Absent → a placeholder panel telling the artist what goes here. */
    clip?: {
        path: string;
        mediaType: "video" | "image";
        durationMs?: number;
    };
    trimStartMs: number;
    /** Cover-crop anchor, 0 = keep the top of the clip, 1 = keep the bottom. */
    focusY: number;
    placeholder: {
        color: MosaicColor;
        label: string;
    };
};
export type WordEntrance = "rise" | "fade" | "instant";
export type WordLayout = "template" | "custom";
export type TriptychStyle = {
    lyricRow: 0 | 1 | 2;
    align: TextAlign;
    entrance: WordEntrance;
    /** Multiplier on the canvas-derived base size. */
    textScale: number;
    textColor: MosaicColor;
    /** 0 = no glow, 1 = strong. */
    glow: number;
    /** White reads as a halo; black reads as a soft shadow on bright footage. */
    glowColor: MosaicColor;
    borderPx: number;
    borderColor: MosaicColor;
    outerBorder: boolean;
    wordLayout: WordLayout;
};
export type TriptychArgs = {
    canvasW: number;
    canvasH: number;
    fps: number;
    durationMs: number;
    rows: [Row, Row, Row];
    pages: LyricPage[];
    style: TriptychStyle;
    song?: {
        path: string;
        mediaType: MosaicMediaKind;
    };
    /** Absolute path of the baked Reels UI PNG when the guide is on. */
    reelsUiPath?: string;
    /** The host's editing pass (Make's `design` preview): custom layout emits
     *  its draggable per-word cells here and only here. */
    editable?: boolean;
    /**
     * Custom layout: the artist's word boxes in CANVAS px, element `i` = word
     * `i` in reading order across every page (null = that entry was unusable).
     * Applied only when the count matches the words on screen; see
     * {@link applyWordBoxes}.
     */
    wordBoxes?: Array<Box | null>;
};
/** Prop key of the regions list custom-layout words bind to. */
export declare const WORD_BOXES_PROP = "wordBoxes";
/**
 * Word layers per text source. The drawtext chain itself is cheap (a 360-word
 * source renders a minute in ~5 s); what costs is every extra SOURCE in the
 * composite, above all its blurred glow twin, which blurs for the whole song
 * whether its words are showing or not. So a typical song's lyrics ride ONE
 * source (plus one glow), and only a very wordy one splits.
 */
export declare const LAYERS_PER_SOURCE = 300;
/** Base font size as a fraction of canvas width (≈123 px on a 1080-wide Reel). */
export declare const FONT_FRACTION_OF_W = 0.114;
/** Text box inset inside the lyric row: sides (of row width), top/bottom (of row height). */
export declare const TEXT_SIDE_FRAC = 0.11;
export declare const TEXT_TOP_FRAC = 0.035;
/** A word's box, in ems of its font: the font's full ascender + descender tall,
 *  its advance + a side pad wide (the pad keeps overhanging glyphs inside). */
export declare const WORD_ASCENT_EM: number;
export declare const WORD_DESCENT_EM: number;
export declare const WORD_PAD_EM = 0.08;
/** One word on screen: where it sits (cell px), how big, and when. */
export type WordItem = {
    text: string;
    /** Left edge of the pen box (drawtext `x`). */
    x: number;
    baseline: number;
    fontPx: number;
    atMs: number;
    endMs: number;
    /** Index of its page among the rendered pages. */
    page: number;
    /** The word's cell (custom layout) — also what Make seeds a drag with. */
    box: Box;
    /** True when the box came from the artist, not the typesetter. */
    moved: boolean;
};
/** The box a word at (x, baseline, fontPx) occupies. */
export declare function wordBox(text: string, x: number, baseline: number, fontPx: number): Box;
/**
 * Fit a word into a box the artist drew: the largest font whose word box fits
 * (height and width), left-aligned, vertically centred. Resizing a box is how
 * a word gets bigger or smaller.
 */
export declare function fitWordToBox(text: string, box: Box): {
    x: number;
    baseline: number;
    fontPx: number;
};
/**
 * Lay the artist's boxes over the typeset words (custom layout).
 *
 * Make writes the WHOLE list whenever one word moves (every sibling pinned at
 * the box it was painted in), so a box equal to the word's own typeset box is
 * "untouched" and keeps following the template (text size, alignment). A list
 * whose length no longer matches the words on screen (lyrics edited after
 * moving words) is ignored rather than shifting every box onto the wrong
 * word — `applied: false` says so.
 */
export declare function applyWordBoxes(items: WordItem[], boxes: Array<Box | null> | undefined, cell: Box): {
    items: WordItem[];
    applied: boolean;
};
/** Flatten typeset pages into words (reading order: page, line, word). A
 *  word's box is its full ascender-to-descender box, cut to the lyric cell
 *  (a top line's accent room can poke above the row). */
export declare function wordItems(pages: TypesetPage[], cell: {
    w: number;
    h: number;
}): WordItem[];
/** Split words into chunks of ≤ LAYERS_PER_SOURCE (a page never straddles). */
export declare function chunkWords(items: WordItem[]): WordItem[][];
export type TriptychPlan = {
    doc: MosaicDocument;
    /** Painted rect of each row (px), the planning truth. */
    rowRects: Box[];
    /** The lyric text box (px, canvas space). */
    textBox: Box;
    pages: TypesetPage[];
    /** Every word as rendered (cell px). */
    words: WordItem[];
    /** Custom layout: the artist's boxes were applied (false = none / stale). */
    wordBoxesApplied: boolean;
    /** Text sources carrying drawtext word layers (template layout) or glow. */
    chunks: number;
};
export declare function buildTriptych(args: TriptychArgs): TriptychPlan;
