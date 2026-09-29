"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TEXT_RISE = exports.FLOAT_DRIFT = void 0;
exports.num = num;
exports.rampExpr = rampExpr;
exports.restExpr = restExpr;
exports.gateAt = gateAt;
exports.shardOverlay = shardOverlay;
exports.textOverlay = textOverlay;
const template_utils_1 = require("@m0saic/template-utils");
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
function num(v) {
    const r = Math.round(v * 1000) / 1000;
    return String(Object.is(r, -0) ? 0 : r);
}
/** 0 before t0, 1 after t0 + d, linear between. Comma-free (see the module note). */
function rampExpr(t0, d) {
    return `((abs(t-${num(t0)})-abs(t-${num(t0 + d)})+${num(d)})/${num(2 * d)})`;
}
/** `(1 - eased)` of the ramp: 1 before the move, 0 once it lands. */
function restExpr(t0, d) {
    const r = rampExpr(t0, d);
    return `(1-${r})*(1-${r})`;
}
/** The gate shared by every entering tile: hidden before t0, then on for good. */
function gateAt(t0) {
    const at = num(t0);
    return { enable: `gte(t,${at})`, window: { startSec: Number(at) } };
}
/** How far `float` drifts, as a fraction of the tile's height. */
exports.FLOAT_DRIFT = 0.3;
/** How far a text line rises, as a fraction of its own height. */
exports.TEXT_RISE = 0.5;
/**
 * A shard's entrance. `t0` = when its move starts, `d` = how long it takes.
 * - rise: from one tile below;
 * - slide: from one tile right;
 * - float: a short drift up while it fades in;
 * - fade: a plain fade.
 */
function shardOverlay(kind, t0, d) {
    const gate = gateAt(t0);
    switch (kind) {
        case "rise":
            return { ...gate, yExpr: `${restExpr(t0, d)}*H` };
        case "slide":
            return { ...gate, xExpr: `${restExpr(t0, d)}*W` };
        case "float":
            return { ...gate, yExpr: `${exports.FLOAT_DRIFT}*${restExpr(t0, d)}*H`, alpha: (0, template_utils_1.fadeInExpr)(Number(num(t0)), Number(num(d)), "easeOut") };
        case "fade":
        default:
            return { ...gate, alpha: (0, template_utils_1.fadeInExpr)(Number(num(t0)), Number(num(d)), "easeOut") };
    }
}
/** A text line (or the scrim behind it) rising in after the reveal. */
function textOverlay(t0, d, rise = true) {
    return {
        ...gateAt(t0),
        ...(rise ? { yExpr: `${exports.TEXT_RISE}*${restExpr(t0, d)}*H` } : {}),
        alpha: (0, template_utils_1.fadeInExpr)(Number(num(t0)), Number(num(d)), "easeOut"),
    };
}
