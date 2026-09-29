import type { MosaicColor, MosaicDocument, MosaicMediaKind } from "@m0saic/types";
import type { RevealTiming, ShardMotion, ShardOrder } from "./plan";
/**
 * Cover Shards, the document:
 *
 *   root W x H, backgroundColor = pageColor (no base rect)
 *     shard tiles    n*n <= 16, each bound to `cover` (a drop target, empty or not)
 *                    cover probed: the cover image, placement.sourceRect = its cell of
 *                                  the centred square crop, fit cover
 *                    no cover:     a placeholder colour tile (four colours)
 *     [scrim]        square canvases: a translucent band under the text
 *     headline       glyph tile (colour + inline mask), bound to headline + textColor
 *     subline        the same, smaller; empty = a transparent tile of its box, still bound
 *     [note]         design mode only: the empty-state hint or why the cover did not load
 *     [song]         an audio-only leaf, never bound
 *
 * Every piece is placed on its exact rect with `placeInsetPieces`. Paint
 * order: a moving shard is drawn over the neighbour it travels across (rise
 * and float stack rows top over bottom, slide stacks columns left over
 * right), so at most n shard layers, never one layer per shard.
 */
/** The per-node source ceiling this template stays under (16 shards + scrim + 2 lines + song). */
export declare const MAX_ROOT_SOURCES = 20;
/** Placeholder shards when there is no cover yet: four colours, `(row + col) % 4`. */
export declare const PLACEHOLDER_PALETTE: readonly MosaicColor[];
export type CoverImage = {
    path: string;
    width: number;
    height: number;
};
export type SongLeaf = {
    path: string;
    mediaType: MosaicMediaKind;
    clipStartMs: number;
};
export type CoverShardsDocArgs = {
    W: number;
    H: number;
    fps: number;
    durationMs: number;
    n: number;
    order: ShardOrder;
    motion: ShardMotion;
    seed: number;
    gapPx: number;
    timing: RevealTiming;
    headline: string;
    subline: string;
    fontPath: string;
    textColor: MosaicColor;
    pageColor: MosaicColor;
    /** A probed image; absent = placeholder shards. */
    cover?: CoverImage;
    song?: SongLeaf;
    /** Design-only text over the square (the caller gates it on ctx.mode). */
    note?: string;
};
export declare function buildCoverShardsDocument(a: CoverShardsDocArgs): MosaicDocument;
