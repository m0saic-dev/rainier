import type { MosaicOverlayExpr } from "@m0saic/types";
import type { ShardMotion } from "./plan";
/**
 * Cover Shards motion: the overlay each tile carries.
 *
 * COMMA-FREE POSITION. `xExpr` / `yExpr` are inlined verbatim into the
 * overlay filter (this repo's law, learned on the triptych's words), so the
 * position ramp is written without min/max/clip:
 *
 *   ramp(t0, d) = (abs(t-t0) - abs(t-t0-d) + d) / (2*d)
 *
 * which is 0 before t0, 1 after t0 + d and linear between. The eased offset
 * is `(1-ramp)^2` (a quadratic ease-out: 1 - e = (1 - r)^2), multiplied by the
 * tile's own size: `W` and `H` in an overlay offset are the TILE's width and
 * height (the engine substitutes them), so `(1-r)*(1-r)*H` starts exactly one
 * tile below.
 *
 * GATE. Every moving tile is hidden until its move starts: `enable:
 * gte(t,t0)` and `window: { startSec: t0 }` carry the same number, written
 * once (they must agree; the engine prefers the window and trims the tile's
 * chain to it).
 *
 * ALPHA. `overlay.alpha` is escaped by the engine, so the fades use the kit's
 * `fadeInExpr(..., "easeOut")`, the canonical shape the engine lowers to a
 * native `fade` filter instead of a per-pixel fold.
 */
/** A time or length as the document writes it: at most 3 decimals, never exponent notation. */
export declare function num(v: number): string;
/** 0 before t0, 1 after t0 + d, linear between. Comma-free (see the module note). */
export declare function rampExpr(t0: number, d: number): string;
/** `(1 - eased)` of the ramp: 1 before the move, 0 once it lands. */
export declare function restExpr(t0: number, d: number): string;
/** The gate shared by every entering tile: hidden before t0, then on for good. */
export declare function gateAt(t0: number): Pick<MosaicOverlayExpr, "enable" | "window">;
/** How far `float` drifts, as a fraction of the tile's height. */
export declare const FLOAT_DRIFT = 0.3;
/** How far a text line rises, as a fraction of its own height. */
export declare const TEXT_RISE = 0.5;
/**
 * A shard's entrance. `t0` = when its move starts, `d` = how long it takes.
 * - rise: from one tile below;
 * - slide: from one tile right;
 * - float: a short drift up while it fades in;
 * - fade: a plain fade.
 */
export declare function shardOverlay(kind: ShardMotion, t0: number, d: number): MosaicOverlayExpr;
/** A text line (or the scrim behind it) rising in after the reveal. */
export declare function textOverlay(t0: number, d: number, rise?: boolean): MosaicOverlayExpr;
