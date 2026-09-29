import type { MosaicTimedCue } from "@m0saic/types";
import type { GridValue, ShardMotion, ShardOrder } from "./plan";
/**
 * `@rainier/explore/cover-shards/v1` — the cover-art reveal: the art
 * assembles from its own tiles, each landing on a beat the artist taps, then
 * the release line rises in underneath.
 *
 * ONE CONCEPT: one image, many windows. Every shard is the SAME picture with
 * `placement.sourceRect` set to its own cell of the centred square crop (in
 * the picture's own pixels, from `ctx.media`), under `fit: "cover"`. Nothing
 * is cut or generated; the engine crops each shard as it draws it.
 *
 * - The square is laid out from `ctx.target`: under the Reels safe area on
 *   tall canvases, shrunk to fit its text at 4:5, text on a scrim at 1:1.
 * - Landing order: rows, centre out, or a `mulberry32(seed)` shuffle.
 * - Timing: shard j lands on the j-th beat tapped in Beats (timed against the
 *   whole song, moved by Song start); untapped shards spread evenly up to
 *   Reveal. The length is the reveal plus Hold, unless the host asks for one.
 * - Motion: a comma-free ramp on xExpr / yExpr (motion.ts), gated with
 *   `enable` + `window` that carry the same start.
 * - Text: glyph outlines cut from a bundled OFL face (`_shared/glyph-text`),
 *   bound with Text colour so a double-click retypes it on the canvas.
 * - No cover yet: placeholder colour shards, every one bound to `cover`, so a
 *   file dropped on any tile becomes the art. In Make, a hint says so.
 *
 * Errors: a cover that is set but unreadable (or not a picture), a song with
 * no sound, or a Song start past the song's end is an error card in a real
 * render, and the placeholder (or silence) plus a note in Make's design pass,
 * so the artist can fix it straight away. A colour that is not #rrggbb is an
 * error card in both.
 */
export type CoverShardsProps = {
    cover?: string;
    headline?: string;
    subline?: string;
    grid?: GridValue;
    order?: ShardOrder;
    motion?: ShardMotion;
    revealSec?: number;
    holdSec?: number;
    song?: string;
    songStartSec?: number;
    beats?: MosaicTimedCue[] | string;
    font?: string;
    textColor?: string;
    pageColor?: string;
    gapPx?: number;
    seed?: number;
};
export declare const COVER_SHARDS_ID = "@rainier/explore/cover-shards/v1";
/** Beats the studio accepts: one per shard at the biggest grid. */
export declare const COVER_SHARDS_MAX_BEATS = 16;
export type CoverShardsKnobs = {
    n: number;
    order: ShardOrder;
    motion: ShardMotion;
    revealSec: number;
    holdSec: number;
    songStartSec: number;
    gapPx: number;
    seed: number;
};
/** Clamp the knobs into range. Never throws: an unknown value takes the default. */
export declare function resolveCoverShardsKnobs(props: CoverShardsProps): CoverShardsKnobs;
export declare const CoverShardsV1: import("@m0saic/types").MosaicTemplate<CoverShardsProps, import("@m0saic/types").MosaicTemplateOutputs, import("@m0saic/types").MosaicTemplateUpstreamVariables, import("@m0saic/types").MosaicTemplateUpstreamData, import("@m0saic/types").MosaicTemplateSidecars>;
export default CoverShardsV1;
