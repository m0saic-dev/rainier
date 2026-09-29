"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.onCanvas = onCanvas;
exports.keepOnCanvas = keepOnCanvas;
exports.layoutPage = layoutPage;
exports.sameBox = sameBox;
exports.applyWordBoxes = applyWordBoxes;
const glyph_text_1 = require("../../../_shared/glyph-text");
/** The smallest size a page shrinks to below the ladder's floor, px. */
const MIN_PAGE_PX = 1;
/** How close the below-the-floor search gets to the largest size that fits, px. */
const SHRINK_STEP_PX = 0.5;
function tile(text, x, baseline, fontPx, fontPath, pad) {
    const px = Math.max(1, fontPx);
    const t = (0, glyph_text_1.wordTile)(text, x, baseline, px, fontPath, { pad });
    return { rect: t.rect, d: t.d, fontPx: px };
}
/** True when `r` lies wholly inside the canvas. */
function onCanvas(r, canvas) {
    return r.x >= 0 && r.y >= 0 && r.w >= 1 && r.h >= 1 && r.x + r.w <= canvas.W && r.y + r.h <= canvas.H;
}
/**
 * `w` placed inside the canvas (unchanged when it already is), or `null`
 * when no size of it fits there. See ON THE CANVAS, ALWAYS.
 */
function placeOnCanvas(w, canvas, fontPath, pad) {
    if (w.text === "" || onCanvas(w.rect, canvas))
        return w;
    let t = w;
    const x0 = Math.max(0, w.rect.x);
    const y0 = Math.max(0, w.rect.y);
    const x1 = Math.min(canvas.W, w.rect.x + w.rect.w);
    const y1 = Math.min(canvas.H, w.rect.y + w.rect.h);
    if (x1 > x0 && y1 > y0) {
        const fit = (0, glyph_text_1.fitWordToBox)(w.text, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, fontPath, { align: "center", pad });
        t = { ...w, ...tile(w.text, fit.x, fit.baseline, fit.fontPx, fontPath, pad) };
        if (onCanvas(t.rect, canvas))
            return t;
    }
    if (t.rect.w > canvas.W || t.rect.h > canvas.H)
        return null;
    const x = Math.min(Math.max(0, t.rect.x), canvas.W - t.rect.w);
    const y = Math.min(Math.max(0, t.rect.y), canvas.H - t.rect.h);
    return { ...t, rect: { ...t.rect, x, y } };
}
/** Every word inside the canvas; one that fits nowhere on it is emptied (not drawn). */
function keepOnCanvas(words, canvas, fontPath, pad) {
    return words.map((w) => { var _a; return (_a = placeOnCanvas(w, canvas, fontPath, pad)) !== null && _a !== void 0 ? _a : { ...w, text: "", d: "" }; });
}
/**
 * A page that does not fit its box even at the shrink ladder's floor: the
 * largest size below the floor (to {@link SHRINK_STEP_PX}) at which it fits,
 * or the floor's layout when nothing fits even at {@link MIN_PAGE_PX} (the
 * canvas check then takes over).
 */
function shrinkPastFloor(texts, box, common, floor) {
    const at = (px) => (0, glyph_text_1.typesetPage)(texts, box, { ...common, fontPx: px, minScale: 1 });
    let best = at(MIN_PAGE_PX);
    if (!best.fits)
        return floor;
    let lo = MIN_PAGE_PX;
    let hi = floor.fontPx;
    while (hi - lo > SHRINK_STEP_PX) {
        const mid = (lo + hi) / 2;
        const set = at(mid);
        if (set.fits) {
            lo = mid;
            best = set;
        }
        else {
            hi = mid;
        }
    }
    return best;
}
/** Lay one page's words into `opts.box`, every tile inside `opts.canvas`. */
function layoutPage(words, opts) {
    const missing = [];
    const texts = words.map((w) => {
        const n = (0, glyph_text_1.normalizeForFont)(w.text, opts.fontPath);
        for (const ch of n.missing)
            if (!missing.includes(ch))
                missing.push(ch);
        return n.text;
    });
    if (words.length === 0)
        return { words: [], fontPx: opts.fontPx, missing };
    if (opts.mode === "word") {
        const laid = words.map((w, k) => {
            const fit = (0, glyph_text_1.fitWordToBox)(texts[k] || " ", opts.box, opts.fontPath, {
                align: "center",
                maxPx: opts.soloMaxPx,
                pad: opts.pad,
            });
            return {
                index: w.index,
                text: texts[k],
                atMs: w.atMs,
                line: k,
                ...tile(texts[k], fit.x, fit.baseline, fit.fontPx, opts.fontPath, opts.pad),
                moved: false,
            };
        });
        const mean = laid.reduce((s, w) => s + w.fontPx, 0) / laid.length;
        return { words: keepOnCanvas(laid, opts.canvas, opts.fontPath, opts.pad), fontPx: mean, missing };
    }
    const common = {
        align: opts.align,
        fontPath: opts.fontPath,
        pad: opts.pad,
        lineBreaksBefore: words.map((w) => w.lineBreakBefore),
    };
    let set = (0, glyph_text_1.typesetPage)(texts, opts.box, { ...common, fontPx: opts.fontPx });
    if (!set.fits)
        set = shrinkPastFloor(texts, opts.box, common, set);
    const laid = new Array(words.length);
    set.lines.forEach((line, li) => {
        for (const tw of line.words) {
            const w = words[tw.index];
            laid[tw.index] = {
                index: w.index,
                text: texts[tw.index],
                atMs: w.atMs,
                line: li,
                ...tile(texts[tw.index], tw.x, line.baseline, set.fontPx, opts.fontPath, opts.pad),
                moved: false,
            };
        }
    });
    return { words: keepOnCanvas(laid, opts.canvas, opts.fontPath, opts.pad), fontPx: set.fontPx, missing };
}
/** Two rects within `tol` px on every edge measure. */
function sameBox(a, b, tol = 1) {
    return (Math.abs(a.x - b.x) <= tol && Math.abs(a.y - b.y) <= tol && Math.abs(a.w - b.w) <= tol && Math.abs(a.h - b.h) <= tol);
}
/**
 * The artist's word boxes over the laid-out words (already on the canvas).
 * `boxes[k]` is `words[k]`'s box in root canvas px, aligned with `words`
 * (null or missing = no box: the word keeps its layout). The caller decides
 * which `wordBoxes` element belongs to which word, and whether the list
 * applies at all. A box within 1 px of the word's own rect is untouched; any
 * other box re-fits the word, centred, kept on the canvas; a word no size of
 * which fits there keeps its own layout.
 */
function applyWordBoxes(words, boxes, fontPath, pad, canvas) {
    return words.map((w, k) => {
        var _a;
        const b = boxes[k];
        if (!b || w.text === "" || sameBox(b, w.rect))
            return w;
        const fit = (0, glyph_text_1.fitWordToBox)(w.text, b, fontPath, { align: "center", pad });
        const boxed = { ...w, ...tile(w.text, fit.x, fit.baseline, fit.fontPx, fontPath, pad), moved: true };
        return (_a = placeOnCanvas(boxed, canvas, fontPath, pad)) !== null && _a !== void 0 ? _a : w;
    });
}
