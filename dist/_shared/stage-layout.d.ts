import type { LatticeInsetSides } from "@m0saic/template-utils";
/**
 * Stage layout: where the takes go and where the lyrics sit. Pure, no ctx.
 *
 * TAKES (`layoutTakes`) are the triptych's idiom generalised to 1–4 slots: a
 * GUTTERLESS unit-weight ratio split (`grid({ rows, cols })`: `1`, `2[1,1]`,
 * `3(1,1,1)`, `2[2(1,1),2(1,1)]`) and the border between the takes as a
 * per-take `placement.inset` from `latticeCellInset`. The inset is emitted as
 * `(px + 0.5) / rawSize`, so the engine's per-edge floor recovers the integer
 * target exactly: every border is exactly `borderPx` on every canvas, the m0
 * stays tiny (precision = the take count), and the border COLOUR is whatever
 * shows through the gaps, i.e. `document.backgroundColor`. No border rect, no
 * full-canvas colour rect, ever.
 *
 * THE LYRIC BOX (`lyricBox`) sits inside the platform's safe area, keeps a
 * side margin from its edges, and pulls its right edge left of the action rail
 * whenever the two share any vertical span.
 *
 * `_shared` is frozen once shipped: a change is a copy beside a new template
 * version, never an edit here.
 */
/** An integer-px rectangle in canvas space. Structurally the same as the one in `platforms.ts`. */
export type Rect = {
    x: number;
    y: number;
    w: number;
    h: number;
};
/** What the artist picks. */
export type TakeLayout = "auto" | "stack" | "split" | "grid";
/** What was actually drawn (`full` = one take filling the stage). */
export type TakeArrangement = "full" | "stack" | "split" | "grid";
export declare const TAKE_LAYOUTS: readonly TakeLayout[];
export declare const MIN_TAKES = 1;
export declare const MAX_TAKES = 4;
export type LayoutTakesOptions = {
    /** Canvas (the render target), px. Rounded to integers. */
    W: number;
    H: number;
    /** Takes on screen, 1..4. Rounded and clamped (a NaN reads as 1). */
    count: number;
    layout: TakeLayout;
    /**
     * Border between takes, px. Rounded, floored at 0, and capped at a quarter
     * of the smallest take pitch so a take can never collapse.
     */
    borderPx: number;
    /** Also draw the border around the outside of the stage. Default false (full bleed). */
    outerBorder?: boolean;
};
export type TakesLayoutResult = {
    /** The gutterless take split, validated. Take `i` is the `i`-th `1` tile. */
    m0: string;
    /** Painted rect of each take (integer px), reading order = m0 tile order. */
    takes: Rect[];
    /**
     * `placement.inset` for take `i` (the inset IS the border); `undefined` =
     * the raw cell already is the take, omit `placement.inset`.
     */
    insets: Array<LatticeInsetSides | undefined>;
    /** Raw cell the m0 realises for take `i` at (W, H), before the inset. */
    cells: Rect[];
    arrangement: TakeArrangement;
    cols: number;
    rows: number;
    /** The count actually laid out (after clamping). */
    count: number;
    /** The border actually drawn (after rounding and the cap). */
    borderPx: number;
};
/** Takes count as laid out: an integer in 1..4 (anything else is clamped; NaN reads as 1). */
export declare function clampTakeCount(count: number): number;
/**
 * The arrangement a (count, layout) pair draws:
 * - one take is always `full`;
 * - `auto`: 2 and 3 stack as rows, 4 is a 2x2 grid;
 * - `stack` = rows, `split` = columns;
 * - `grid` is a 2x2 for 4 takes. For 2 or 3 takes there is no honest grid (a
 *   2x2 with an empty cell, or a spanning cell, would leave a hole or a
 *   lopsided take), so it falls back to `stack`, the same as `auto`.
 */
export declare function resolveTakeArrangement(count: number, layout: TakeLayout): TakeArrangement;
/**
 * Lay out 1..4 takes on a W x H stage. See the module note for the idiom.
 * Never throws for a canvas of at least 16 x 16 px.
 */
export declare function layoutTakes(opts: LayoutTakesOptions): TakesLayoutResult;
/**
 * `placement.inset` that paints exactly `target` inside `cell` (both integer
 * px, `target` inside `cell`), in the half-pixel-centred form the engine's
 * per-edge floor recovers exactly (`latticeCellInset`'s encoding). Use it to
 * put the lyric box on a full-canvas tile: `rectInset({ x: 0, y: 0, w: W, h: H }, box)`.
 * `undefined` when the target is the whole cell. A target poking out of the
 * cell is cut to it.
 */
export declare function rectInset(cell: Rect, target: Rect): LatticeInsetSides | undefined;
export type LyricPosition = "top" | "middle" | "bottom";
export declare const LYRIC_POSITIONS: readonly LyricPosition[];
/** Default side margin inside the safe area, as a fraction of W (65 px on a 1080-wide Reel). */
export declare const LYRIC_SIDE_FRAC = 0.06;
/** Default box height, as a fraction of H (576 px on a 1920-tall Reel: three big lines). */
export declare const LYRIC_HEIGHT_FRAC = 0.3;
/** The part of a platform stage the lyric box reads (`platformStage(...)` fits it). */
export type LyricStage = {
    /** Where nothing of the app's chrome sits, canvas px. */
    safe: Rect;
    /** The action rail (short-form only), canvas px. Absent / null = no rail. */
    rail?: Rect | null;
};
export type LyricBoxOptions = {
    /** Canvas, px. */
    W: number;
    H: number;
    stage: LyricStage;
    /**
     * `top` hugs the top of the safe area, `bottom` its bottom, and `middle`
     * centres on the CANVAS middle (so it lines up with the middle take of a
     * three-take stack), clamped into the safe area.
     */
    position: LyricPosition;
    /**
     * Margin kept from the safe area's left and right edges AND from the rail,
     * as a fraction of W. Default {@link LYRIC_SIDE_FRAC}. Clamped to 0..0.45.
     */
    sideFrac?: number;
    /** Box height as a fraction of H, capped at the safe height. Default {@link LYRIC_HEIGHT_FRAC}. */
    heightFrac?: number;
};
/**
 * The lyric box (integer px, canvas space): inside the safe area, `pad =
 * sideFrac * W` in from its left and right edges, and, when the box's
 * vertical span overlaps the rail's, with its right edge pulled to `pad` px
 * left of the rail. Only the right edge moves; the left edge stays put, so a
 * centred page shifts left, away from the buttons. (A stage whose rail leaves
 * no room at all, which no real platform has, gets a 1-px-wide box at the
 * left margin rather than an error.)
 */
export declare function lyricBox(opts: LyricBoxOptions): Rect;
