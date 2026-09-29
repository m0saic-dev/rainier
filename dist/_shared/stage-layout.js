"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LYRIC_HEIGHT_FRAC = exports.LYRIC_SIDE_FRAC = exports.LYRIC_POSITIONS = exports.MAX_TAKES = exports.MIN_TAKES = exports.TAKE_LAYOUTS = void 0;
exports.clampTakeCount = clampTakeCount;
exports.resolveTakeArrangement = resolveTakeArrangement;
exports.layoutTakes = layoutTakes;
exports.rectInset = rectInset;
exports.lyricBox = lyricBox;
const dsl_1 = require("@m0saic/dsl");
const dsl_stdlib_1 = require("@m0saic/dsl-stdlib");
const template_utils_1 = require("@m0saic/template-utils");
exports.TAKE_LAYOUTS = ["auto", "stack", "split", "grid"];
exports.MIN_TAKES = 1;
exports.MAX_TAKES = 4;
/** Takes count as laid out: an integer in 1..4 (anything else is clamped; NaN reads as 1). */
function clampTakeCount(count) {
    const n = Math.round(Number(count));
    if (!Number.isFinite(n))
        return exports.MIN_TAKES;
    return Math.min(exports.MAX_TAKES, Math.max(exports.MIN_TAKES, n));
}
/**
 * The arrangement a (count, layout) pair draws:
 * - one take is always `full`;
 * - `auto`: 2 and 3 stack as rows, 4 is a 2x2 grid;
 * - `stack` = rows, `split` = columns;
 * - `grid` is a 2x2 for 4 takes. For 2 or 3 takes there is no honest grid (a
 *   2x2 with an empty cell, or a spanning cell, would leave a hole or a
 *   lopsided take), so it falls back to `stack`, the same as `auto`.
 */
function resolveTakeArrangement(count, layout) {
    const n = clampTakeCount(count);
    if (n === 1)
        return "full";
    switch (layout) {
        case "split":
            return "split";
        case "stack":
            return "stack";
        case "grid":
        case "auto":
        default:
            return n === 4 ? "grid" : "stack";
    }
}
function latticeShape(arrangement, n) {
    switch (arrangement) {
        case "full":
            return { cols: 1, rows: 1 };
        case "split":
            return { cols: n, rows: 1 };
        case "grid":
            return { cols: 2, rows: 2 };
        case "stack":
        default:
            return { cols: 1, rows: n };
    }
}
/**
 * Lay out 1..4 takes on a W x H stage. See the module note for the idiom.
 * Never throws for a canvas of at least 16 x 16 px.
 */
function layoutTakes(opts) {
    const W = Math.round(opts.W);
    const H = Math.round(opts.H);
    if (!(W >= 1) || !(H >= 1))
        throw new Error(`layoutTakes: canvas must be at least 1x1 px, got ${opts.W}x${opts.H}`);
    const count = clampTakeCount(opts.count);
    const arrangement = resolveTakeArrangement(count, opts.layout);
    const { cols, rows } = latticeShape(arrangement, count);
    const outer = opts.outerBorder === true;
    // Cap: at most a quarter of the smallest take pitch, so every take keeps at
    // least half its unbordered size (and latticeCellInset never runs out of room).
    const cap = Math.floor(Math.min(W / cols, H / rows) / 4);
    const wanted = Math.round(Number(opts.borderPx));
    const borderPx = Number.isFinite(wanted) ? Math.min(cap, Math.max(0, wanted)) : 0;
    const m0 = String((0, dsl_stdlib_1.grid)({ rows, cols }).m0);
    const v = (0, dsl_1.validateM0String)(m0);
    if (!v.ok)
        throw new Error(`layoutTakes: generated m0 "${m0}" is invalid (${v.error.code})`);
    // Raw cells in m0 tile order (logicalIndex), which is reading order for a
    // row-major grid: top-left, top-right, bottom-left, bottom-right.
    const frames = (0, dsl_1.parseM0StringToRenderFrames)(m0, W, H)
        .slice()
        .sort((a, b) => a.logicalIndex - b.logicalIndex);
    if (frames.length !== count) {
        throw new Error(`layoutTakes: "${m0}" realised ${frames.length} cells at ${W}x${H}, expected ${count}`);
    }
    const cells = frames.map((f) => ({ x: f.x, y: f.y, w: f.width, h: f.height }));
    const lattice = (0, template_utils_1.latticeCellInset)({
        cols,
        rows,
        canvasW: W,
        canvasH: H,
        gutterXPx: borderPx,
        gutterYPx: borderPx,
        marginPx: outer ? borderPx : 0,
        cells: cells.map((raw, i) => ({ unit: { c0: i % cols, r0: Math.floor(i / cols), cs: 1, rs: 1 }, raw })),
    });
    return {
        m0,
        takes: lattice.targets.map((t) => ({ x: t.x, y: t.y, w: t.w, h: t.h })),
        insets: cells.map((_, i) => lattice.insetAt(i)),
        cells,
        arrangement,
        cols,
        rows,
        count,
        borderPx,
    };
}
/**
 * `placement.inset` that paints exactly `target` inside `cell` (both integer
 * px, `target` inside `cell`), in the half-pixel-centred form the engine's
 * per-edge floor recovers exactly (`latticeCellInset`'s encoding). Use it to
 * put the lyric box on a full-canvas tile: `rectInset({ x: 0, y: 0, w: W, h: H }, box)`.
 * `undefined` when the target is the whole cell. A target poking out of the
 * cell is cut to it.
 */
function rectInset(cell, target) {
    const l = Math.max(0, Math.round(target.x - cell.x));
    const t = Math.max(0, Math.round(target.y - cell.y));
    const r = Math.max(0, Math.round(cell.x + cell.w - (target.x + target.w)));
    const b = Math.max(0, Math.round(cell.y + cell.h - (target.y + target.h)));
    if (l === 0 && t === 0 && r === 0 && b === 0)
        return undefined;
    return {
        left: (l + 0.5) / cell.w,
        right: (r + 0.5) / cell.w,
        top: (t + 0.5) / cell.h,
        bottom: (b + 0.5) / cell.h,
    };
}
exports.LYRIC_POSITIONS = ["top", "middle", "bottom"];
/** Default side margin inside the safe area, as a fraction of W (65 px on a 1080-wide Reel). */
exports.LYRIC_SIDE_FRAC = 0.06;
/** Default box height, as a fraction of H (576 px on a 1920-tall Reel: three big lines). */
exports.LYRIC_HEIGHT_FRAC = 0.3;
/** `r` cut to the canvas, integer px (at least 1 x 1). */
function clipToCanvas(r, W, H) {
    const x0 = Math.min(W - 1, Math.max(0, Math.round(r.x)));
    const y0 = Math.min(H - 1, Math.max(0, Math.round(r.y)));
    const x1 = Math.max(x0 + 1, Math.min(W, Math.round(r.x + r.w)));
    const y1 = Math.max(y0 + 1, Math.min(H, Math.round(r.y + r.h)));
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
const finiteOr = (v, fallback) => typeof v === "number" && Number.isFinite(v) ? v : fallback;
/**
 * The lyric box (integer px, canvas space): inside the safe area, `pad =
 * sideFrac * W` in from its left and right edges, and, when the box's
 * vertical span overlaps the rail's, with its right edge pulled to `pad` px
 * left of the rail. Only the right edge moves; the left edge stays put, so a
 * centred page shifts left, away from the buttons. (A stage whose rail leaves
 * no room at all, which no real platform has, gets a 1-px-wide box at the
 * left margin rather than an error.)
 */
function lyricBox(opts) {
    const W = Math.round(opts.W);
    const H = Math.round(opts.H);
    if (!(W >= 1) || !(H >= 1))
        throw new Error(`lyricBox: canvas must be at least 1x1 px, got ${opts.W}x${opts.H}`);
    const safe = clipToCanvas(opts.stage.safe, W, H);
    const sideFrac = Math.min(0.45, Math.max(0, finiteOr(opts.sideFrac, exports.LYRIC_SIDE_FRAC)));
    const heightFrac = Math.min(1, Math.max(0, finiteOr(opts.heightFrac, exports.LYRIC_HEIGHT_FRAC)));
    // The margin never eats the whole safe width.
    const pad = Math.min(Math.round(sideFrac * W), Math.floor((safe.w - 1) / 2));
    const h = Math.min(safe.h, Math.max(1, Math.round(heightFrac * H)));
    const yMin = safe.y;
    const yMax = safe.y + safe.h - h;
    const y = opts.position === "top"
        ? yMin
        : opts.position === "bottom"
            ? yMax
            : Math.min(yMax, Math.max(yMin, Math.round((H - h) / 2)));
    const left = safe.x + pad;
    let right = safe.x + safe.w - pad;
    const rail = opts.stage.rail;
    if (rail && rail.w > 0 && rail.h > 0) {
        const railX = Math.round(rail.x);
        const railTop = Math.round(rail.y);
        const railBottom = Math.round(rail.y + rail.h);
        const overlapsY = y < railBottom && railTop < y + h;
        if (overlapsY && railX < right)
            right = Math.min(right, railX - pad);
    }
    return { x: left, y, w: Math.max(1, right - left), h };
}
