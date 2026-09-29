"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sec3 = exports.TEXT_RAMP_SEC = exports.SUBLINE_DELAY_SEC = exports.HEADLINE_DELAY_SEC = exports.RAMP_SEC = exports.TAIL_SEC = exports.UNTIMED_FROM_SEC = exports.MIN_TAP_SEC = exports.SHARD_MOTIONS = exports.SHARD_ORDERS = exports.GRID_VALUES = void 0;
exports.stageKind = stageKind;
exports.stageLayout = stageLayout;
exports.scaledGap = scaledGap;
exports.shardGrid = shardGrid;
exports.sourceRects = sourceRects;
exports.landingOrder = landingOrder;
exports.beatTimes = beatTimes;
exports.revealTiming = revealTiming;
const template_utils_1 = require("@m0saic/template-utils");
const platforms_1 = require("../../../_shared/platforms");
const song_window_1 = require("../../../_shared/song-window");
exports.GRID_VALUES = ["2", "3", "4"];
exports.SHARD_ORDERS = ["shuffle", "rows", "center"];
exports.SHARD_MOTIONS = ["rise", "slide", "float", "fade"];
/** Taps at or before this (clip time, s) are dropped: a shard needs a moment to arrive. */
exports.MIN_TAP_SEC = 0.2;
/** With no taps, the first shard lands here (s). */
exports.UNTIMED_FROM_SEC = 0.3;
/** The reveal runs at least this long past the last tap (s). */
exports.TAIL_SEC = 0.4;
/** A shard's move starts this long before it lands (clamped at 0), s. */
exports.RAMP_SEC = 0.35;
/** Headline and subline enter this long after the reveal ends (s). */
exports.HEADLINE_DELAY_SEC = 0.1;
exports.SUBLINE_DELAY_SEC = 0.25;
/** How long each text line takes to rise in (s). */
exports.TEXT_RAMP_SEC = 0.4;
/** Seconds rounded to the millisecond: every time the document carries goes through this. */
const sec3 = (s) => Math.round(s * 1000) / 1000;
exports.sec3 = sec3;
/** Tall = 9:16-ish (H/W at least 1.5); square = H/W under 1.15 (landscape too); the rest is portrait (4:5). */
function stageKind(W, H) {
    const r = H / W;
    if (r >= 1.5)
        return "tall";
    if (r < 1.15)
        return "square";
    return "portrait";
}
const px = (v) => Math.max(1, Math.round(v));
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
function stageLayout(W, H) {
    const kind = stageKind(W, H);
    if (kind === "tall") {
        const stage = (0, platforms_1.platformStage)((0, platforms_1.resolveShortPlatform)(platforms_1.DEFAULT_SHORT_PLATFORM), W, H);
        const margin = Math.round(W * 0.04);
        const left = stage.safe.x + margin;
        const right = stage.safe.x + stage.safe.w - margin;
        const headH = px(W * 0.14);
        const subH = px(W * 0.065);
        const textGap = Math.round(W * 0.015);
        const below = Math.round(W * 0.045);
        const bandH = headH + textGap + subH;
        const side = Math.max(1, Math.min(right - left, stage.safe.h - below - bandH));
        const squareBox = { x: Math.round((W - side) / 2), y: stage.safe.y, w: side, h: side };
        const bandTop = squareBox.y + side + below;
        const bandBottom = bandTop + bandH;
        // Centre the band on the square; keep its right edge off the rail where the two share rows.
        const cx = squareBox.x + side / 2;
        let half = Math.min(cx - left, right - cx);
        const rail = stage.rail;
        if (rail && rail.y < bandBottom && rail.y + rail.h > bandTop)
            half = Math.min(half, rail.x - margin - cx);
        half = Math.max(1, Math.floor(half));
        const bx = Math.round(cx - half);
        return {
            kind,
            squareBox,
            headline: { x: bx, y: bandTop, w: 2 * half, h: headH },
            subline: { x: bx, y: bandTop + headH + textGap, w: 2 * half, h: subH },
        };
    }
    if (kind === "portrait") {
        const margin = Math.round(W * 0.05);
        const headH = px(W * 0.12);
        const subH = px(W * 0.055);
        const textGap = Math.round(W * 0.012);
        const below = Math.round(W * 0.035);
        const bandH = headH + textGap + subH;
        const side = Math.max(1, Math.min(W - 2 * margin, H - 2 * margin - below - bandH));
        const top = Math.round((H - (side + below + bandH)) / 2);
        const squareBox = { x: Math.round((W - side) / 2), y: top, w: side, h: side };
        const bandTop = top + side + below;
        return {
            kind,
            squareBox,
            headline: { x: squareBox.x, y: bandTop, w: side, h: headH },
            subline: { x: squareBox.x, y: bandTop + headH + textGap, w: side, h: subH },
        };
    }
    const short = Math.min(W, H);
    const margin = Math.round(short * 0.05);
    const side = Math.max(1, short - 2 * margin);
    const squareBox = { x: Math.round((W - side) / 2), y: Math.round((H - side) / 2), w: side, h: side };
    const scrimH = px(H / 6);
    const scrim = { x: 0, y: H - scrimH, w: W, h: scrimH };
    const pad = Math.round(scrimH * 0.12);
    const inner = Math.max(2, scrimH - 2 * pad);
    const textGap = Math.round(inner * 0.06);
    const headH = px((inner - textGap) * 0.64);
    const subH = Math.max(1, inner - textGap - headH);
    return {
        kind,
        squareBox,
        headline: { x: squareBox.x, y: scrim.y + pad, w: side, h: headH },
        subline: { x: squareBox.x, y: scrim.y + pad + headH + textGap, w: side, h: subH },
        scrim,
    };
}
// ── Shards ─────────────────────────────────────────────────────────────────
/** The gap in canvas px: `gapPx` is measured at 1080 on the canvas's short side, clamped to 0..24. */
function scaledGap(gapPx, W, H) {
    const g = Number.isFinite(gapPx) ? Math.min(24, Math.max(0, gapPx)) : 0;
    return Math.round((g * Math.min(W, H)) / 1080);
}
/**
 * Split the square box into n x n integer squares with `gap` px between them.
 * The side is snapped down so `(side - (n - 1) * gap)` divides by n, and the
 * snapped square is centred in the box (it moves by less than n px).
 */
function shardGrid(box, n, gapPx) {
    const side = Math.min(box.w, box.h);
    let gap = Math.max(0, Math.round(gapPx));
    if (side - (n - 1) * gap < n)
        gap = 0;
    const cell = Math.max(1, Math.floor((side - (n - 1) * gap) / n));
    const S = n * cell + (n - 1) * gap;
    const square = {
        x: box.x + Math.floor((box.w - S) / 2),
        y: box.y + Math.floor((box.h - S) / 2),
        w: S,
        h: S,
    };
    const rects = [];
    for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
            rects.push({ x: square.x + c * (cell + gap), y: square.y + r * (cell + gap), w: cell, h: cell });
        }
    }
    return { n, gap, cell, square, rects };
}
/**
 * Which pixels of the picture each shard shows: the centred square crop
 * (`side = min(w, h)`, offset by half the overflow) split into n x n integer
 * rects in SOURCE px, row-major. The last row and column absorb the
 * remainder, so the crop is covered exactly (no gap, no overlap). Null when
 * the picture is smaller than n px on its short side.
 */
function sourceRects(imgW, imgH, n) {
    const w = Math.floor(imgW);
    const h = Math.floor(imgH);
    const side = Math.min(w, h);
    const base = Math.floor(side / n);
    if (!(base >= 1))
        return null;
    const ox = Math.floor((w - side) / 2);
    const oy = Math.floor((h - side) / 2);
    const span = (i) => (i === n - 1 ? side - (n - 1) * base : base);
    const out = [];
    for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
            out.push({ x: ox + c * base, y: oy + r * base, w: span(c), h: span(r) });
        }
    }
    return out;
}
// ── Order ──────────────────────────────────────────────────────────────────
/**
 * The shard indices (row-major) in the order they land.
 *
 * - rows: row-major;
 * - center: nearest the square's centre first, ties row-major;
 * - shuffle: Fisher-Yates with `mulberry32(seed)`. The same seed always gives
 *   the same order.
 */
function landingOrder(n, order, seed) {
    const N = n * n;
    const idx = Array.from({ length: N }, (_, i) => i);
    if (order === "rows")
        return idx;
    if (order === "center") {
        // Twice the offset from the centre, so the distance stays an integer.
        const d2 = (i) => {
            const r = Math.floor(i / n);
            const c = i % n;
            return (2 * r - (n - 1)) ** 2 + (2 * c - (n - 1)) ** 2;
        };
        return idx.sort((a, b) => d2(a) - d2(b) || a - b);
    }
    const rng = (0, template_utils_1.mulberry32)(seed);
    for (let i = N - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        const t = idx[i];
        idx[i] = idx[j];
        idx[j] = t;
    }
    return idx;
}
// ── Timing ─────────────────────────────────────────────────────────────────
/**
 * The tapped beats on the clip's timeline, seconds, ascending: every TIMED
 * cue's `startMs` moved by the song start (`windowMs`), taps at or before
 * `MIN_TAP_SEC` dropped. Beats are anonymous (any text), so they are sorted:
 * shard j in landing order lands on the j-th beat.
 */
function beatTimes(cues, songStartSec) {
    const startMs = (0, song_window_1.songStartOf)(songStartSec * 1000);
    const out = [];
    for (const cue of cues) {
        if (typeof cue.startMs !== "number" || !Number.isFinite(cue.startMs))
            continue;
        const t = (0, exports.sec3)((0, song_window_1.windowMs)(cue.startMs, startMs) / 1000);
        if (t > exports.MIN_TAP_SEC)
            out.push(t);
    }
    return out.sort((a, b) => a - b);
}
/**
 * When each shard lands. Shard j takes tap j; the untimed rest spread evenly
 * after the last tap (or from `UNTIMED_FROM_SEC`) up to `revealEnd`, the last
 * one landing exactly on it.
 */
function revealTiming(count, taps, revealSec) {
    const used = taps.slice(0, count).map(exports.sec3);
    const lastTap = used.length > 0 ? used[used.length - 1] : undefined;
    const revealEnd = (0, exports.sec3)(lastTap === undefined ? revealSec : Math.max(revealSec, lastTap + exports.TAIL_SEC));
    const land = [...used];
    const k = count - used.length;
    if (lastTap === undefined) {
        for (let i = 0; i < k; i++) {
            land.push((0, exports.sec3)(k === 1 ? revealEnd : exports.UNTIMED_FROM_SEC + (i * (revealEnd - exports.UNTIMED_FROM_SEC)) / (k - 1)));
        }
    }
    else {
        for (let i = 0; i < k; i++)
            land.push((0, exports.sec3)(lastTap + ((i + 1) * (revealEnd - lastTap)) / k));
    }
    const rampStart = land.map((t) => (0, exports.sec3)(Math.max(0, t - exports.RAMP_SEC)));
    const rampDur = land.map((t, j) => Math.max(0.001, (0, exports.sec3)(t - rampStart[j])));
    return {
        land,
        rampStart,
        rampDur,
        revealEnd,
        headlineAt: (0, exports.sec3)(revealEnd + exports.HEADLINE_DELAY_SEC),
        sublineAt: (0, exports.sec3)(revealEnd + exports.SUBLINE_DELAY_SEC),
        tapped: used.length,
    };
}
