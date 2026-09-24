"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LINE_HEIGHT = void 0;
exports.measureText = measureText;
exports.typesetPage = typesetPage;
const font_metrics_1 = require("./font-metrics");
/** Line pitch as a multiple of the font size (measured off real posts ≈ 1.3). */
exports.LINE_HEIGHT = 1.28;
/** Shrink steps tried when a page does not fit (fractions of the base size). */
const FIT_LADDER = [1, 0.93, 0.86, 0.8, 0.74, 0.68, 0.62, 0.56, 0.5, 0.44, 0.38];
/** Visual extent of a line around its baseline (fractions of the font size). */
const CAP_TOP = font_metrics_1.FONT_METRICS.capHeight / font_metrics_1.FONT_METRICS.unitsPerEm;
const DESCENT = 0.2;
const unit = (px) => px / font_metrics_1.FONT_METRICS.unitsPerEm;
/** Advance width of `text` at `fontPx`, kerning included. */
function measureText(text, fontPx) {
    var _a, _b;
    const { advances, kerning, fallbackAdvance } = font_metrics_1.FONT_METRICS;
    let units = 0;
    const chars = Array.from(text);
    for (let i = 0; i < chars.length; i++) {
        units += (_a = advances[chars[i]]) !== null && _a !== void 0 ? _a : fallbackAdvance;
        if (i + 1 < chars.length)
            units += (_b = kerning[chars[i] + chars[i + 1]]) !== null && _b !== void 0 ? _b : 0;
    }
    return units * unit(fontPx);
}
/** Width of the space between two words (kerning on both sides of it). */
function spaceBetween(left, right, fontPx) {
    var _a, _b, _c, _d;
    const { advances, kerning } = font_metrics_1.FONT_METRICS;
    const a = (_a = Array.from(left).pop()) !== null && _a !== void 0 ? _a : "";
    const b = (_b = Array.from(right)[0]) !== null && _b !== void 0 ? _b : "";
    return (advances[" "] + ((_c = kerning[a + " "]) !== null && _c !== void 0 ? _c : 0) + ((_d = kerning[" " + b]) !== null && _d !== void 0 ? _d : 0)) * unit(fontPx);
}
/** Greedy line breaking: fill each line until the next word would not fit. */
function breakLines(words, maxW, fontPx) {
    const lines = [];
    let line = [];
    let lineW = 0;
    for (const word of words) {
        const add = line.length === 0 ? word.w : spaceBetween(line[line.length - 1].text, word.text, fontPx) + word.w;
        if (line.length > 0 && (word.lineBreakBefore || lineW + add > maxW)) {
            lines.push(line);
            line = [word];
            lineW = word.w;
        }
        else {
            line.push(word);
            lineW += add;
        }
    }
    if (line.length > 0)
        lines.push(line);
    return lines;
}
const blockHeight = (lineCount, fontPx) => (lineCount - 1) * fontPx * exports.LINE_HEIGHT + fontPx * (CAP_TOP + DESCENT);
/**
 * Lay one page into `box`: the largest size on the ladder at which every
 * word fits the width and every line fits the height (the floor size wins
 * when nothing does — a page that long should be split into two).
 */
function typesetPage(page, box, opts) {
    let chosen;
    for (const scale of FIT_LADDER) {
        const fontPx = Math.max(10, Math.round(opts.fontPx * scale));
        const measured = page.words.map((w) => ({ ...w, w: measureText(w.text, fontPx) }));
        const lines = breakLines(measured, box.w, fontPx);
        const fitsW = measured.every((m) => m.w <= box.w);
        const fitsH = blockHeight(lines.length, fontPx) <= box.h;
        chosen = { fontPx, lines };
        if (fitsW && fitsH)
            break;
    }
    const { fontPx, lines } = chosen;
    const pitch = fontPx * exports.LINE_HEIGHT;
    const top = box.y + (box.h - blockHeight(lines.length, fontPx)) / 2;
    const firstBaseline = top + fontPx * CAP_TOP;
    const placed = lines.map((line, li) => {
        const baseline = Math.round(firstBaseline + li * pitch);
        const gaps = line.slice(1).map((w, k) => spaceBetween(line[k].text, w.text, fontPx));
        const natural = line.reduce((s, w) => s + w.w, 0) + gaps.reduce((s, g) => s + g, 0);
        const justify = opts.align === "justify" && line.length > 1;
        const extra = justify ? (box.w - natural) / (line.length - 1) : 0;
        let x = opts.align === "center" ? box.x + (box.w - natural) / 2 : box.x;
        return line.map((w, k) => {
            if (k > 0)
                x += gaps[k - 1] + extra;
            const word = { text: w.text, x: Math.round(x), baseline, atMs: w.atMs };
            x += w.w;
            return word;
        });
    });
    return { startMs: page.startMs, endMs: page.endMs, fontPx, lines: placed };
}
