import type { MosaicTimedCue } from "@m0saic/types";
/**
 * Cover Shards, the pure half: where the square goes on the canvas, how it
 * splits into shards, which part of the picture each shard shows, which
 * shard lands first, and when each one lands. No ctx, no fs, no strings for
 * ffmpeg (motion.ts writes those). Every rect is integer px.
 */
export type Rect = {
    x: number;
    y: number;
    w: number;
    h: number;
};
/** Shards per side, as the `grid` prop stores it (a string on purpose, like Lyric Stack's `takeCount`). */
export type GridValue = "2" | "3" | "4";
export declare const GRID_VALUES: GridValue[];
export type ShardOrder = "shuffle" | "rows" | "center";
export declare const SHARD_ORDERS: ShardOrder[];
export type ShardMotion = "rise" | "slide" | "float" | "fade";
export declare const SHARD_MOTIONS: ShardMotion[];
/** Taps at or before this (clip time, s) are dropped: a shard needs a moment to arrive. */
export declare const MIN_TAP_SEC = 0.2;
/** With no taps, the first shard lands here (s). */
export declare const UNTIMED_FROM_SEC = 0.3;
/** The reveal runs at least this long past the last tap (s). */
export declare const TAIL_SEC = 0.4;
/** A shard's move starts this long before it lands (clamped at 0), s. */
export declare const RAMP_SEC = 0.35;
/** Headline and subline enter this long after the reveal ends (s). */
export declare const HEADLINE_DELAY_SEC = 0.1;
export declare const SUBLINE_DELAY_SEC = 0.25;
/** How long each text line takes to rise in (s). */
export declare const TEXT_RAMP_SEC = 0.4;
/** Seconds rounded to the millisecond: every time the document carries goes through this. */
export declare const sec3: (s: number) => number;
export type StageKind = "tall" | "portrait" | "square";
export type StageLayout = {
    kind: StageKind;
    /** The box the square fills before it is snapped to the grid (a square, integer px). */
    squareBox: Rect;
    headline: Rect;
    subline: Rect;
    /** Square canvases only: the translucent band under the text (the bottom sixth). */
    scrim?: Rect;
};
/** Tall = 9:16-ish (H/W at least 1.5); square = H/W under 1.15 (landscape too); the rest is portrait (4:5). */
export declare function stageKind(W: number, H: number): StageKind;
/**
 * Where the cover and its two lines sit on a W x H canvas.
 *
 * - tall: the square spans the width minus the platform's side crop and a
 *   margin, from the top of the Reels safe area; the text band sits under it,
 *   centred on the square and kept left of the action rail.
 * - portrait (4:5): the square shrinks until the band fits under it; the pair
 *   is centred vertically.
 * - square (and landscape): the square fills the canvas minus a margin; the
 *   text sits on a translucent scrim across the bottom sixth.
 */
export declare function stageLayout(W: number, H: number): StageLayout;
/** The gap in canvas px: `gapPx` is measured at 1080 on the canvas's short side, clamped to 0..24. */
export declare function scaledGap(gapPx: number, W: number, H: number): number;
export type ShardGrid = {
    n: number;
    /** Gap actually used, px (0 when the square is too small for the asked gap). */
    gap: number;
    /** Side of one shard, px. */
    cell: number;
    /** The snapped square: n * cell + (n - 1) * gap on a side, centred in the box. */
    square: Rect;
    /** One square per shard, row-major (index = row * n + col). */
    rects: Rect[];
};
/**
 * Split the square box into n x n integer squares with `gap` px between them.
 * The side is snapped down so `(side - (n - 1) * gap)` divides by n, and the
 * snapped square is centred in the box (it moves by less than n px).
 */
export declare function shardGrid(box: Rect, n: number, gapPx: number): ShardGrid;
/**
 * Which pixels of the picture each shard shows: the centred square crop
 * (`side = min(w, h)`, offset by half the overflow) split into n x n integer
 * rects in SOURCE px, row-major. The last row and column absorb the
 * remainder, so the crop is covered exactly (no gap, no overlap). Null when
 * the picture is smaller than n px on its short side.
 */
export declare function sourceRects(imgW: number, imgH: number, n: number): Rect[] | null;
/**
 * The shard indices (row-major) in the order they land.
 *
 * - rows: row-major;
 * - center: nearest the square's centre first, ties row-major;
 * - shuffle: Fisher-Yates with `mulberry32(seed)`. The same seed always gives
 *   the same order.
 */
export declare function landingOrder(n: number, order: ShardOrder, seed: number): number[];
/**
 * The tapped beats on the clip's timeline, seconds, ascending: every TIMED
 * cue's `startMs` moved by the song start (`windowMs`), taps at or before
 * `MIN_TAP_SEC` dropped. Beats are anonymous (any text), so they are sorted:
 * shard j in landing order lands on the j-th beat.
 */
export declare function beatTimes(cues: readonly MosaicTimedCue[], songStartSec: number): number[];
export type RevealTiming = {
    /** Landing time of the j-th shard in landing order, s (ascending). */
    land: number[];
    /** When the move of the j-th shard starts, s (>= 0). */
    rampStart: number[];
    /** How long the move of the j-th shard takes, s (> 0). */
    rampDur: number[];
    /** When the cover is complete: max(revealSec, last tap + TAIL_SEC). */
    revealEnd: number;
    headlineAt: number;
    sublineAt: number;
    /** Taps actually used (at most one per shard). */
    tapped: number;
};
/**
 * When each shard lands. Shard j takes tap j; the untimed rest spread evenly
 * after the last tap (or from `UNTIMED_FROM_SEC`) up to `revealEnd`, the last
 * one landing exactly on it.
 */
export declare function revealTiming(count: number, taps: readonly number[], revealSec: number): RevealTiming;
