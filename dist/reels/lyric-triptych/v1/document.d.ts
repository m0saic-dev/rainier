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
 *   3[ row, row{ glow{ words{ glow{ words … }}}}, row ]{ reelsUi{ song } }
 *        └ the lyric row carries the word layers, chunked ≤ 300 per source
 *
 * Each word is ONE drawtext layer: its own x (measured), its own baseline
 * (`y = baseline − ascent` — drawtext's `ascent` is the word's own glyph
 * height, so words with and without ascenders share one baseline), its own
 * enable window [word lands, page clears) and entrance. Placement exprs are
 * inlined into the filtergraph verbatim, so they must stay COMMA-FREE (no
 * min/max/if — clamps are written with abs()).
 */
export type Row = {
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
};
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
/** Split pages into chunks of ≤ LAYERS_PER_SOURCE word layers (a page never straddles). */
export declare function chunkPages(pages: TypesetPage[]): TypesetPage[][];
export type TriptychPlan = {
    doc: MosaicDocument;
    /** Painted rect of each row (px), the planning truth. */
    rowRects: Box[];
    /** The lyric text box (px, canvas space). */
    textBox: Box;
    pages: TypesetPage[];
    chunks: number;
};
export declare function buildTriptych(args: TriptychArgs): TriptychPlan;
