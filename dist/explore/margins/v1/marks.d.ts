/**
 * Margins geometry: where each line's box sits by default, and the mask
 * shapes the template paints. Pure, no ctx, no randomness.
 *
 * Every mark is ONE colour tile with an inline mask. The mask path is written
 * in the box's own px space (0..w, 0..h) and its `bounds` are the box size,
 * so a box the artist resizes regenerates the stroke at the new size on the
 * next render. Paths use only absolute `M`, `L` and `Z`, every point is
 * clamped inside the box, and every sub-path winds the same way (clockwise
 * on screen): the rasterizer fills with the default nonzero rule, so where
 * two sub-paths overlap (the corners of the hand-drawn box) they add up
 * instead of cutting a hole.
 *
 * The "hand-drawn" feel comes from fixed patterns (ragged ends, a gentle
 * wave, a slight skew), never from a random source: the same box always
 * gives the same path.
 *
 * The empty page (no photo yet) is ruled notebook paper with a handwriting
 * stand-in: squiggle strokes on five lines, drawn as the mask's open
 * `strokes` (the one place a path is not a closed filled shape). Squiggles
 * only, never letters: the template writes nothing.
 */
/** A rect in canvas px (integers from the helpers below). */
export type Box = {
    x: number;
    y: number;
    w: number;
    h: number;
};
export declare const MARK_STYLES: readonly ["highlight", "underline", "box"];
export type MarkStyle = (typeof MARK_STYLES)[number];
export type PageFit = "contain" | "cover";
/** Default band: x from 8 % to 92 % of the page's content width, 70 % of its slot tall. */
export declare const BAND_X0 = 0.08;
export declare const BAND_X1 = 0.92;
export declare const BAND_FILL = 0.7;
/** Smallest box side a mark is drawn at (px). */
export declare const MIN_BOX_PX = 4;
/** The writing block of the empty page: five ruled lines, the default bands' home. */
export declare const PLACEHOLDER_LINES = 5;
/**
 * Where the page shows inside a W x H canvas: the whole canvas for `cover`
 * (and when the photo's size is unknown), the centred fitted rect for
 * `contain`.
 */
export declare function pageContentRect(W: number, H: number, fit: PageFit, media?: {
    width?: number;
    height?: number;
}): Box;
/** The empty page's writing block (right of the margin line, the middle of the sheet). */
export declare function placeholderBlock(W: number, H: number): Box;
/**
 * One default box per line: `count` equal slots down the content rect, each
 * band centred in its slot at {@link BAND_FILL} of the slot's height, x from
 * {@link BAND_X0} to {@link BAND_X1} of the content width. The bands never
 * overlap (a gap of 30 % of a slot between neighbours).
 */
export declare function defaultLineBoxes(count: number, content: Box): Box[];
/** A box kept inside the canvas and at least {@link MIN_BOX_PX} on each side. */
export declare function clampBox(b: Box, W: number, H: number): Box;
/**
 * A highlighter stroke: a bar from 10 % to 90 % of the box height with a
 * gently wavy top and bottom and ragged ends (a fixed pattern). One
 * sub-path, clockwise.
 */
export declare function highlightPath(w: number, h: number): string;
/** The underline's zone: the bottom 18 % of the box. */
export declare const UNDERLINE_ZONE = 0.18;
/**
 * A hand-drawn wavy underline across the bottom {@link UNDERLINE_ZONE} of
 * the box, drawn as a thin filled ribbon (tapered at both ends) rather than
 * a stroke. One sub-path, clockwise.
 */
export declare function underlinePath(w: number, h: number): string;
/**
 * A hand-drawn box: four thin bars in one path, each slightly skewed so the
 * corners do not meet square. Every bar winds clockwise, so the overlapping
 * corners fill (nonzero) instead of cutting holes.
 */
export declare function boxOutlinePath(w: number, h: number): string;
/** The mask path for one mark of `style` in a w x h box. */
export declare function markPath(style: MarkStyle, w: number, h: number): string;
/**
 * Ruled notebook paper over the whole canvas: horizontal rules at the
 * placeholder's line pitch (from 10 % to 96 % of the height) and a margin
 * line left of the writing block. One path, canvas px, one sub-path per
 * rule.
 */
export declare function ruledPaperPath(W: number, H: number): string;
/** The pen width of the handwriting stand-in, px. */
export declare const scribblePen: (W: number) => number;
/**
 * The handwriting stand-in: five lines of cursive-looking squiggle "words"
 * (a run of humps that loops over on its tall strokes, leaning forward)
 * sitting on the placeholder's rules, in the default bands of a five-line
 * page. One open polyline per word, canvas px, drawn as an inline-mask
 * STROKE (round caps and joins) at {@link scribblePen} wide. Squiggles only,
 * never letters.
 */
export declare function scribbleStrokes(W: number, H: number): Array<{
    d: string;
    width: number;
}>;
