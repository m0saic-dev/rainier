"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FIT_LADDER = exports.MIN_SCALE = exports.LINE_HEIGHT = void 0;
exports.fontError = fontError;
exports.fontMetrics = fontMetrics;
exports.measureWord = measureWord;
exports.spaceBetween = spaceBetween;
exports.glyphCoverage = glyphCoverage;
exports.normalizeForFont = normalizeForFont;
exports.wordTile = wordTile;
exports.fitWordToBox = fitWordToBox;
exports.typesetPage = typesetPage;
const template_utils_1 = require("@m0saic/template-utils");
/** Line pitch as a multiple of the font size (the triptych's, measured off real posts). */
exports.LINE_HEIGHT = 1.28;
/** The smallest fraction of the requested size a page shrinks to. */
exports.MIN_SCALE = 0.38;
/** Shrink steps a page tries in order (fractions of the requested size), the triptych's ladder. */
exports.FIT_LADDER = Object.freeze([
    1, 0.93, 0.86, 0.8, 0.74, 0.68, 0.62, 0.56, 0.5, 0.44, 0.38,
]);
/** Size everything is measured at before scaling (a large em keeps the 2-decimal path exact to 1e-5 em). */
const REF_PX = 1000;
/** Float slack for fits and for integer rounding (sums of kerned advances carry 1e-13 noise). */
const EPS = 1e-6;
/** The smallest size `fitWordToBox` returns when nothing fits. */
const MIN_FONT_PX = 1;
/** A font's word memo is dropped past this many entries (results are identical; only speed changes). */
const WORD_MEMO_CAP = 8192;
/** Memo key for the bundled default font (no user path can contain a NUL). */
const DEFAULT_FONT_KEY = "\u0000bundled";
/** A noncharacter no cmap maps: it always draws `.notdef`. */
const NOTDEF_PROBE = "\uFFFF";
const FONTS = new Map();
function fontEm(fontPath) {
    const key = fontPath !== null && fontPath !== void 0 ? fontPath : DEFAULT_FONT_KEY;
    let f = FONTS.get(key);
    if (!f) {
        const m = (0, template_utils_1.measureText)(" ", { fontSize: REF_PX, fontPath });
        f = {
            ascent: m.ascent / REF_PX,
            descent: m.descent / REF_PX,
            space: m.width / REF_PX,
            words: new Map(),
            gaps: new Map(),
            covered: new Map(),
        };
        FONTS.set(key, f);
    }
    return f;
}
function advanceEm(text, fontPath) {
    return text ? (0, template_utils_1.measureText)(text, { fontSize: REF_PX, fontPath }).width / REF_PX : 0;
}
/** The outline of `text` at REF_PX with its pen at x = 0 and its baseline at y = ascent. */
function refPath(text, fontPath) {
    return (0, template_utils_1.textToPath)(text, { fontSize: REF_PX, hAlign: "left", vAlign: "top", fontPath }, { width: 1, height: 1 });
}
const NUMBER = /-?\d*\.?\d+(?:e[-+]?\d+)?/gi;
/**
 * Bounding box of a path's points (endpoints and control points: a superset
 * of the ink, since a curve stays inside its control hull). The glyph engine
 * emits only absolute M / L / Q / C / Z, so its numbers are x, y pairs.
 */
function pathBox(d) {
    const nums = d.match(NUMBER);
    if (!nums || nums.length < 2)
        return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i + 1 < nums.length; i += 2) {
        const x = Number(nums[i]);
        const y = Number(nums[i + 1]);
        if (x < minX)
            minX = x;
        if (x > maxX)
            maxX = x;
        if (y < minY)
            minY = y;
        if (y > maxY)
            maxY = y;
    }
    return { minX, minY, maxX, maxY };
}
function wordEm(f, fontPath, text) {
    const hit = f.words.get(text);
    if (hit)
        return hit;
    const advance = advanceEm(text, fontPath);
    const extent = { left: 0, top: -f.ascent, right: advance, bottom: f.descent };
    const ink = text ? pathBox(refPath(text, fontPath)) : null;
    if (ink) {
        extent.left = Math.min(extent.left, ink.minX / REF_PX);
        extent.right = Math.max(extent.right, ink.maxX / REF_PX);
        extent.top = Math.min(extent.top, ink.minY / REF_PX - f.ascent);
        extent.bottom = Math.max(extent.bottom, ink.maxY / REF_PX - f.ascent);
    }
    const w = { advance, extent };
    if (f.words.size >= WORD_MEMO_CAP)
        f.words.clear();
    f.words.set(text, w);
    return w;
}
const firstChar = (s) => { var _a; return (_a = Array.from(s)[0]) !== null && _a !== void 0 ? _a : ""; };
const lastChar = (s) => {
    var _a;
    const chars = Array.from(s);
    return (_a = chars[chars.length - 1]) !== null && _a !== void 0 ? _a : "";
};
/** The space between two words in em: the space glyph plus the kerning on both sides of it. */
function gapEm(f, fontPath, left, right) {
    const a = lastChar(left);
    const b = firstChar(right);
    if (!a || !b)
        return f.space;
    const key = `${a}\u0000${b}`;
    let g = f.gaps.get(key);
    if (g === undefined) {
        g = advanceEm(`${a} ${b}`, fontPath) - advanceEm(a, fontPath) - advanceEm(b, fontPath);
        f.gaps.set(key, g);
    }
    return g;
}
function assertPx(name, v) {
    if (!(Number.isFinite(v) && v > 0))
        throw new RangeError(`glyph-text: ${name} must be a finite number > 0, got ${v}`);
}
function assertPad(pad) {
    if (!(Number.isFinite(pad) && pad >= 0))
        throw new RangeError(`glyph-text: pad must be a finite number >= 0, got ${pad}`);
}
// ── Metrics ────────────────────────────────────────────────────────────────
/**
 * `null` when the glyph engine can read and draw with `fontPath`, else the
 * engine's reason (for logs: it may carry the full path, so show the artist
 * the file NAME, never this text). Never throws. Every other function here
 * THROWS on a font the engine cannot read (missing file, not a font, WOFF2),
 * so a template checks a user's font once, up front, and falls back to a
 * bundled face (`resolveFontPath(choice, { readError: fontError })` in
 * `fonts.ts` does exactly that). A good font is parsed once and memoised; a
 * failure is not remembered, so a file that appears later is picked up.
 */
function fontError(fontPath) {
    try {
        const f = fontEm(fontPath);
        // A parse can succeed on a file whose outlines are broken: draw one probe word.
        wordEm(f, fontPath, "Ag");
        return null;
    }
    catch (err) {
        return err instanceof Error ? err.message : String(err);
    }
}
/** Ascent, descent and space advance of the font at `fontPx`, px. */
function fontMetrics(fontPath, fontPx) {
    assertPx("fontPx", fontPx);
    const f = fontEm(fontPath);
    return { ascent: f.ascent * fontPx, descent: f.descent * fontPx, spaceWidth: f.space * fontPx };
}
/** Advance width of `text` at `fontPx` with the font's kerning, px. */
function measureWord(text, fontPx, fontPath) {
    assertPx("fontPx", fontPx);
    return wordEm(fontEm(fontPath), fontPath, text).advance * fontPx;
}
/**
 * The space between two words set on one line, px: the space's advance plus
 * the kerning between `left`'s last character and the space and between the
 * space and `right`'s first character.
 */
function spaceBetween(left, right, fontPx, fontPath) {
    assertPx("fontPx", fontPx);
    return gapEm(fontEm(fontPath), fontPath, left, right) * fontPx;
}
// ── Coverage ───────────────────────────────────────────────────────────────
/** Layout characters (controls, line and paragraph separators): never drawn, never reported. */
function isLayoutChar(ch) {
    var _a;
    const c = (_a = ch.codePointAt(0)) !== null && _a !== void 0 ? _a : 0;
    return c < 0x20 || (c >= 0x7f && c <= 0x9f) || c === 0x2028 || c === 0x2029;
}
/**
 * ASCII stand-ins for what Apple Notes (and word processors) type, used only
 * when the font lacks the original. `""` removes an invisible character.
 */
const STAND_INS = Object.freeze({
    "\u2018": "'", // left single quote
    "\u2019": "'", // right single quote / apostrophe
    "\u201A": "'", // single low quote
    "\u201B": "'", // single high-reversed quote
    "\u2032": "'", // prime
    "\u201C": '"', // left double quote
    "\u201D": '"', // right double quote
    "\u201E": '"', // double low quote
    "\u201F": '"', // double high-reversed quote
    "\u2033": '"', // double prime
    "\u2026": "...", // ellipsis
    "\u2010": "-", // hyphen
    "\u2011": "-", // non-breaking hyphen
    "\u2012": "-", // figure dash
    "\u2013": "-", // en dash
    "\u2014": "-", // em dash
    "\u2015": "-", // horizontal bar
    "\u2212": "-", // minus sign
    "\u00A0": " ", // no-break space
    "\u2002": " ",
    "\u2003": " ",
    "\u2004": " ",
    "\u2005": " ",
    "\u2006": " ",
    "\u2007": " ",
    "\u2008": " ",
    "\u2009": " ",
    "\u200A": " ",
    "\u202F": " ", // narrow no-break space
    "\u205F": " ",
    "\u3000": " ",
    "\u00AD": "", // soft hyphen
    "\u200B": "", // zero-width space
    "\u200C": "", // zero-width non-joiner
    "\u200D": "", // zero-width joiner
    "\u2060": "", // word joiner
    "\uFEFF": "", // byte-order mark
});
function isCovered(f, fontPath, ch) {
    const hit = f.covered.get(ch);
    if (hit !== undefined)
        return hit;
    if (!f.notdef)
        f.notdef = { d: refPath(NOTDEF_PROBE, fontPath), advance: advanceEm(NOTDEF_PROBE, fontPath) };
    let covered = !(refPath(ch, fontPath) === f.notdef.d && advanceEm(ch, fontPath) === f.notdef.advance);
    // A BLANK `.notdef` (Pacifico, Righteous: no outline, the space's advance)
    // draws exactly like a space, so a space-like character cannot be judged by
    // its outline, and it draws as a blank either way: count it as covered.
    // (Without this, those faces reported the plain space as missing.)
    if (!covered && f.notdef.d === "" && (ch === " " || STAND_INS[ch] === " "))
        covered = true;
    f.covered.set(ch, covered);
    return covered;
}
/**
 * Characters of `text` the font has no glyph for (they would draw as
 * `.notdef`), each once, in order of first appearance. Controls and line
 * breaks are never reported, and neither is a space-like character in a
 * face whose `.notdef` is blank (it draws as a blank anyway).
 */
function glyphCoverage(text, fontPath) {
    const f = fontEm(fontPath);
    const missing = [];
    for (const ch of Array.from(text)) {
        if (isLayoutChar(ch) || missing.includes(ch))
            continue;
        if (!isCovered(f, fontPath, ch))
            missing.push(ch);
    }
    return missing;
}
/**
 * `text` made drawable in the font: a character the font lacks becomes its
 * ASCII stand-in (U+2018 / U+2019 -> ', U+201C / U+201D -> ", U+2026 -> ...,
 * U+2013 / U+2014 -> -, no-break space -> space, invisible joiners removed,
 * and a few relatives) when the font has the stand-in. Anything else it
 * lacks stays in the text (it draws as `.notdef`) and is reported. A
 * character the font HAS is never touched: a font with real curly quotes
 * keeps them.
 */
function normalizeForFont(text, fontPath) {
    const f = fontEm(fontPath);
    const missing = [];
    let out = "";
    for (const ch of Array.from(text)) {
        if (isLayoutChar(ch) || isCovered(f, fontPath, ch)) {
            out += ch;
            continue;
        }
        const alt = STAND_INS[ch];
        if (alt !== undefined && Array.from(alt).every((c) => isCovered(f, fontPath, c))) {
            out += alt;
            continue;
        }
        out += ch;
        if (!missing.includes(ch))
            missing.push(ch);
    }
    return { text: out, missing };
}
// ── The tile ───────────────────────────────────────────────────────────────
/**
 * One word as a masked tile: its pen at `x`, its baseline at `baseline`
 * (px, any space), set at `fontPx`.
 *
 * The rect spans the font's ascent and descent (plus `pad`) and the word's
 * advance (plus `pad`), grown only where the ink leaves that block, then
 * rounded outward to integers. The fractional remainder goes into the path's
 * offset, so the glyphs sit on `baseline` exactly. `d` is in rect-local px
 * and `bounds` is `{ 0, 0, rect.w, rect.h }`: hand both to an `inline-mask`
 * and place the tile at `rect`.
 */
function wordTile(text, x, baseline, fontPx, fontPath, opts = {}) {
    var _a;
    assertPx("fontPx", fontPx);
    const pad = (_a = opts.pad) !== null && _a !== void 0 ? _a : 0;
    assertPad(pad);
    const f = fontEm(fontPath);
    const { extent } = wordEm(f, fontPath, text);
    const left = x + fontPx * extent.left - pad;
    const top = baseline + fontPx * extent.top - pad;
    const right = x + fontPx * extent.right + pad;
    const bottom = baseline + fontPx * extent.bottom + pad;
    const rx = Math.floor(left + EPS);
    const ry = Math.floor(top + EPS);
    const w = Math.max(1, Math.ceil(right - EPS) - rx);
    const h = Math.max(1, Math.ceil(bottom - EPS) - ry);
    // textToPath with hAlign "left" / vAlign "top" puts the pen at padding.x and
    // the first baseline at padding.y + ascent.
    const d = text
        ? (0, template_utils_1.textToPath)(text, {
            fontSize: fontPx,
            hAlign: "left",
            vAlign: "top",
            padding: { x: x - rx, y: baseline - f.ascent * fontPx - ry },
            fontPath,
        }, { width: w, height: h })
        : "";
    return { rect: { x: rx, y: ry, w, h }, d, bounds: { x: 0, y: 0, width: w, height: h } };
}
// ── One word in a box ──────────────────────────────────────────────────────
/**
 * The largest size at which `text` fits `box` (w and h), and where its pen
 * and baseline go: the word's extent (its advance box x the font's ascent +
 * descent block, grown by any overhanging ink, plus `pad`) is centred
 * vertically and centred (or aligned) horizontally. Scaling the box about
 * its centre scales the word about the same centre, so a resized box keeps
 * the word where it was (the "a centred word grows but doesn't stay
 * centred" complaint). Pass the result to `wordTile` with the same `pad`;
 * the tile's rect is then the fitted extent, inside the box.
 *
 * When nothing fits (a box smaller than 1 px of type) the size is 1 px and
 * the word overflows its box, still centred.
 */
function fitWordToBox(text, box, fontPath, opts = {}) {
    var _a, _b;
    const align = (_a = opts.align) !== null && _a !== void 0 ? _a : "center";
    const pad = (_b = opts.pad) !== null && _b !== void 0 ? _b : 0;
    assertPad(pad);
    if (opts.maxPx !== undefined)
        assertPx("maxPx", opts.maxPx);
    const { extent } = wordEm(fontEm(fontPath), fontPath, text);
    const wEm = extent.right - extent.left;
    const hEm = extent.bottom - extent.top;
    let fontPx = Math.min(wEm > 0 ? (box.w - 2 * pad) / wEm : Infinity, hEm > 0 ? (box.h - 2 * pad) / hEm : Infinity);
    if (opts.maxPx !== undefined)
        fontPx = Math.min(fontPx, opts.maxPx);
    if (!(Number.isFinite(fontPx) && fontPx >= MIN_FONT_PX))
        fontPx = MIN_FONT_PX;
    const extW = fontPx * wEm + 2 * pad;
    const extH = fontPx * hEm + 2 * pad;
    const extLeft = align === "center" ? box.x + (box.w - extW) / 2 : align === "right" ? box.x + box.w - extW : box.x;
    const extTop = box.y + (box.h - extH) / 2;
    return {
        fontPx,
        x: extLeft + pad - fontPx * extent.left,
        baseline: extTop + pad - fontPx * extent.top,
    };
}
// ── A page of words ────────────────────────────────────────────────────────
function ladder(minScale) {
    const steps = exports.FIT_LADDER.filter((s) => s >= minScale);
    if (steps[steps.length - 1] !== minScale)
        steps.push(minScale);
    return steps;
}
/**
 * Lay `words` into `box`: greedy line breaking (forced breaks honoured),
 * shrinking down the ladder until every line fits the width and the block
 * fits the height (the floor size wins when nothing does, with `fits:
 * false`). The block (first ascent to last descent) is centred vertically,
 * nudged only to keep overhanging ink inside the box. Justify spreads each
 * line's spare width evenly across its gaps; a lone word sits left.
 *
 * Words are tokens without spaces. Positions are floats: `wordTile` does the
 * integer rounding without moving the glyphs.
 */
function typesetPage(words, box, opts) {
    var _a, _b, _c;
    const { align, fontPath } = opts;
    const lineHeight = (_a = opts.lineHeight) !== null && _a !== void 0 ? _a : exports.LINE_HEIGHT;
    const minScale = (_b = opts.minScale) !== null && _b !== void 0 ? _b : exports.MIN_SCALE;
    const pad = (_c = opts.pad) !== null && _c !== void 0 ? _c : 0;
    assertPx("fontPx", opts.fontPx);
    assertPx("lineHeight", lineHeight);
    if (!(minScale > 0 && minScale <= 1))
        throw new RangeError(`glyph-text: minScale must be in (0, 1], got ${minScale}`);
    assertPad(pad);
    if (words.length === 0)
        return { fontPx: opts.fontPx, lines: [], fits: true };
    const f = fontEm(fontPath);
    const em = words.map((w) => wordEm(f, fontPath, w));
    const gaps = words.map((w, i) => (i === 0 ? 0 : gapEm(f, fontPath, words[i - 1], w)));
    const forced = (i) => { var _a; return i > 0 && ((_a = opts.lineBreaksBefore) === null || _a === void 0 ? void 0 : _a[i]) === true; };
    // How far a word's padded extent reaches past its advance box, px (>= pad).
    const leftOver = (i, px) => pad - px * em[i].extent.left;
    const rightOver = (i, px) => px * (em[i].extent.right - em[i].advance) + pad;
    const lineWidth = (line, px) => {
        let run = em[line[0]].advance * px;
        for (let k = 1; k < line.length; k++)
            run += (gaps[line[k]] + em[line[k]].advance) * px;
        return leftOver(line[0], px) + run + rightOver(line[line.length - 1], px);
    };
    const layoutAt = (px) => {
        const lines = [];
        let line = [];
        let run = 0;
        for (let i = 0; i < words.length; i++) {
            const adv = em[i].advance * px;
            if (line.length > 0) {
                const next = run + gaps[i] * px + adv;
                if (!forced(i) && leftOver(line[0], px) + next + rightOver(i, px) <= box.w + EPS) {
                    line.push(i);
                    run = next;
                    continue;
                }
                lines.push(line);
            }
            line = [i];
            run = adv;
        }
        lines.push(line);
        const pitch = px * lineHeight;
        let extTop = Infinity;
        let extBottom = -Infinity;
        lines.forEach((ln, li) => {
            for (const i of ln) {
                extTop = Math.min(extTop, li * pitch + px * em[i].extent.top - pad);
                extBottom = Math.max(extBottom, li * pitch + px * em[i].extent.bottom + pad);
            }
        });
        const fitsW = lines.every((ln) => lineWidth(ln, px) <= box.w + EPS);
        const fitsH = extBottom - extTop <= box.h + EPS;
        return { lines, fits: fitsW && fitsH, extTop, extBottom };
    };
    let fontPx = opts.fontPx;
    let layout;
    for (const scale of ladder(minScale)) {
        fontPx = opts.fontPx * scale;
        layout = layoutAt(fontPx);
        if (layout.fits)
            break;
    }
    const { lines, fits, extTop, extBottom } = layout;
    // First baseline: centre the font block (first ascent .. last descent,
    // padded); keep overhanging ink inside the box when the page fits.
    const pitch = fontPx * lineHeight;
    const fontTop = -f.ascent * fontPx - pad;
    const fontBottom = (lines.length - 1) * pitch + f.descent * fontPx + pad;
    let first = box.y + (box.h - (fontBottom - fontTop)) / 2 - fontTop;
    if (fits) {
        if (first + extTop < box.y)
            first = box.y - extTop;
        if (first + extBottom > box.y + box.h)
            first = box.y + box.h - extBottom;
    }
    else {
        first = box.y + (box.h - (extBottom - extTop)) / 2 - extTop;
    }
    const placed = lines.map((line, li) => {
        const width = lineWidth(line, fontPx);
        const spread = align === "justify" && line.length > 1;
        const extra = spread ? Math.max(0, (box.w - width) / (line.length - 1)) : 0;
        let x = (align === "center" ? box.x + (box.w - width) / 2 : box.x) + leftOver(line[0], fontPx);
        const out = line.map((i, k) => {
            if (k > 0)
                x += gaps[i] * fontPx + extra;
            const word = { index: i, text: words[i], x, width: em[i].advance * fontPx };
            x += word.width;
            return word;
        });
        return { baseline: first + li * pitch, words: out };
    });
    return { fontPx, lines: placed, fits };
}
