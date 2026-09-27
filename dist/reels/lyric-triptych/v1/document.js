"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WORD_PAD_EM = exports.WORD_DESCENT_EM = exports.WORD_ASCENT_EM = exports.TEXT_TOP_FRAC = exports.TEXT_SIDE_FRAC = exports.FONT_FRACTION_OF_W = exports.LAYERS_PER_SOURCE = exports.WORD_BOXES_PROP = void 0;
exports.wordBox = wordBox;
exports.fitWordToBox = fitWordToBox;
exports.applyWordBoxes = applyWordBoxes;
exports.wordItems = wordItems;
exports.chunkWords = chunkWords;
exports.buildTriptych = buildTriptych;
const types_1 = require("@m0saic/types");
const dsl_1 = require("@m0saic/dsl");
const template_utils_1 = require("@m0saic/template-utils");
const font_metrics_1 = require("./font-metrics");
const typeset_1 = require("./typeset");
/** Prop key of the regions list custom-layout words bind to. */
exports.WORD_BOXES_PROP = "wordBoxes";
/**
 * Word layers per text source. The drawtext chain itself is cheap (a 360-word
 * source renders a minute in ~5 s); what costs is every extra SOURCE in the
 * composite, above all its blurred glow twin, which blurs for the whole song
 * whether its words are showing or not. So a typical song's lyrics ride ONE
 * source (plus one glow), and only a very wordy one splits.
 */
exports.LAYERS_PER_SOURCE = 300;
/** Base font size as a fraction of canvas width (≈123 px on a 1080-wide Reel). */
exports.FONT_FRACTION_OF_W = 0.114;
/** Text box inset inside the lyric row: sides (of row width), top/bottom (of row height). */
exports.TEXT_SIDE_FRAC = 0.11;
exports.TEXT_TOP_FRAC = 0.035;
/** A word's box, in ems of its font: the font's full ascender + descender tall,
 *  its advance + a side pad wide (the pad keeps overhanging glyphs inside). */
exports.WORD_ASCENT_EM = font_metrics_1.FONT_METRICS.ascender / font_metrics_1.FONT_METRICS.unitsPerEm;
exports.WORD_DESCENT_EM = -font_metrics_1.FONT_METRICS.descender / font_metrics_1.FONT_METRICS.unitsPerEm;
exports.WORD_PAD_EM = 0.08;
const MIN_WORD_FONT_PX = 8;
const ENTRANCE_SEC = 0.28;
const RISE_EM = 0.16;
const sec = (ms) => (ms / 1000).toFixed(3);
/** `1 - min(1, u)` without a comma, for u ≥ 0: placement exprs are filtergraph-inlined. */
const restExpr = (startSec) => {
    const u = `(t-${startSec})/${ENTRANCE_SEC}`;
    // 1 - min(1,u) == (1 - u + |u - 1|) / 2
    return `((1-${u}+abs(${u}-1))/2)`;
};
/** The box a word at (x, baseline, fontPx) occupies. */
function wordBox(text, x, baseline, fontPx) {
    const pad = Math.round(fontPx * exports.WORD_PAD_EM);
    const top = baseline - Math.round(fontPx * exports.WORD_ASCENT_EM);
    return {
        x: x - pad,
        y: top,
        w: Math.ceil((0, typeset_1.measureText)(text, fontPx)) + 2 * pad,
        h: Math.round(fontPx * (exports.WORD_ASCENT_EM + exports.WORD_DESCENT_EM)),
    };
}
/**
 * Fit a word into a box the artist drew: the largest font whose word box fits
 * (height and width), left-aligned, vertically centred. Resizing a box is how
 * a word gets bigger or smaller.
 */
function fitWordToBox(text, box) {
    const perPx = (0, typeset_1.measureText)(text, 1) + 2 * exports.WORD_PAD_EM;
    const byH = box.h / (exports.WORD_ASCENT_EM + exports.WORD_DESCENT_EM);
    const byW = box.w / Math.max(0.01, perPx);
    const fontPx = Math.max(MIN_WORD_FONT_PX, Math.floor(Math.min(byH, byW)));
    const used = fontPx * (exports.WORD_ASCENT_EM + exports.WORD_DESCENT_EM);
    return {
        x: box.x + Math.round(fontPx * exports.WORD_PAD_EM),
        baseline: Math.round(box.y + (box.h - used) / 2 + fontPx * exports.WORD_ASCENT_EM),
        fontPx,
    };
}
const sameBox = (a, b) => Math.abs(a.x - b.x) <= 1 && Math.abs(a.y - b.y) <= 1 && Math.abs(a.w - b.w) <= 1 && Math.abs(a.h - b.h) <= 1;
/**
 * Lay the artist's boxes over the typeset words (custom layout).
 *
 * Make writes the WHOLE list whenever one word moves (every sibling pinned at
 * the box it was painted in), so a box equal to the word's own typeset box is
 * "untouched" and keeps following the template (text size, alignment). A list
 * whose length no longer matches the words on screen (lyrics edited after
 * moving words) is ignored rather than shifting every box onto the wrong
 * word — `applied: false` says so.
 */
function applyWordBoxes(items, boxes, cell) {
    if (!boxes || boxes.length === 0 || boxes.length !== items.length)
        return { items, applied: false };
    const out = items.map((item, i) => {
        const b = boxes[i];
        if (!b)
            return item;
        // Canvas px → cell px, kept inside the lyric row.
        const w = Math.max(MIN_WORD_FONT_PX, Math.min(Math.round(b.w), cell.w));
        const h = Math.max(MIN_WORD_FONT_PX, Math.min(Math.round(b.h), cell.h));
        const local = {
            x: Math.min(Math.max(0, Math.round(b.x - cell.x)), cell.w - w),
            y: Math.min(Math.max(0, Math.round(b.y - cell.y)), cell.h - h),
            w,
            h,
        };
        if (sameBox(local, item.box))
            return item;
        return { ...item, ...fitWordToBox(item.text, local), box: local, moved: true };
    });
    return { items: out, applied: true };
}
/** `box` cut to the cell (a cell may not leave its parent rect). */
function clampToCell(box, cellW, cellH) {
    const x = Math.max(0, box.x);
    const y = Math.max(0, box.y);
    return {
        x,
        y,
        w: Math.max(1, Math.min(box.x + box.w, cellW) - x),
        h: Math.max(1, Math.min(box.y + box.h, cellH) - y),
    };
}
/** Flatten typeset pages into words (reading order: page, line, word). A
 *  word's box is its full ascender-to-descender box, cut to the lyric cell
 *  (a top line's accent room can poke above the row). */
function wordItems(pages, cell) {
    return pages.flatMap((page, p) => page.lines.flat().map((w) => ({
        text: w.text,
        x: w.x,
        baseline: w.baseline,
        fontPx: page.fontPx,
        atMs: w.atMs,
        endMs: page.endMs,
        page: p,
        box: clampToCell(wordBox(w.text, w.x, w.baseline, page.fontPx), cell.w, cell.h),
        moved: false,
    })));
}
/** The drawtext layer for one word inside a row-sized text source. */
function wordLayer(item, baseFontPx, entrance) {
    const a = sec(item.atMs);
    const e = sec(item.endMs);
    const rest = restExpr(a); // 1 → 0 over the entrance
    const riseOffset = entrance === "rise" ? `+${Math.round(item.fontPx * RISE_EM)}*${rest}*${rest}` : "";
    const layer = {
        content: { kind: "literal", text: item.text },
        placement: {
            xExpr: String(item.x),
            yExpr: `${item.baseline - (0, typeset_1.inkTop)(item.text, item.fontPx)}${riseOffset}`,
        },
        overlay: {
            // The enable string and the structured window describe the SAME
            // window, minted from the same rounded seconds.
            enable: `between(t,${a},${e})`,
            window: { startSec: Number(a), endSec: Number(e) },
            ...(entrance === "instant" ? {} : { alpha: `min(1,max(0,(t-${a})/${ENTRANCE_SEC}))` }),
        },
    };
    if (item.fontPx !== baseFontPx)
        layer.style = { fontSize: item.fontPx };
    return layer;
}
/** Split words into chunks of ≤ LAYERS_PER_SOURCE (a page never straddles). */
function chunkWords(items) {
    const chunks = [];
    let current = [];
    let i = 0;
    while (i < items.length) {
        let j = i;
        while (j < items.length && items[j].page === items[i].page)
            j++;
        const page = items.slice(i, j);
        if (current.length > 0 && current.length + page.length > exports.LAYERS_PER_SOURCE) {
            chunks.push(current);
            current = [];
        }
        current.push(...page);
        i = j;
    }
    if (current.length > 0)
        chunks.push(current);
    return chunks;
}
function buildTriptych(args) {
    const W = Math.round(args.canvasW);
    const H = Math.round(args.canvasH);
    const { style } = args;
    const custom = style.wordLayout === "custom";
    // Per-word cells exist only where someone can grab them.
    const cellsPerWord = custom && args.editable === true;
    // ── rows: gutterless 3-row lattice, the border as an exact inset ────────
    const rowsM0 = "3[1,1,1]";
    const raw = (0, dsl_1.parseM0StringToRenderFrames)(rowsM0, W, H).map((f) => ({
        x: f.x,
        y: f.y,
        w: f.width,
        h: f.height,
    }));
    const border = Math.max(0, Math.round(style.borderPx));
    const lattice = (0, template_utils_1.latticeCellInset)({
        cols: 1,
        rows: 3,
        canvasW: W,
        canvasH: H,
        gutterXPx: 0,
        gutterYPx: border,
        marginPx: style.outerBorder ? border : 0,
        cells: raw.map((r, i) => ({ unit: { c0: 0, r0: i, cs: 1, rs: 1 }, raw: r })),
    });
    const rowRects = lattice.targets.map((t) => ({ ...t }));
    // ── lyrics: typeset every page into the lyric row's text box ───────────
    const cell = raw[style.lyricRow];
    const painted = rowRects[style.lyricRow];
    const sideInset = Math.round(painted.w * exports.TEXT_SIDE_FRAC);
    const topInset = Math.round(painted.h * exports.TEXT_TOP_FRAC);
    // Word coordinates are CELL-relative: the lyric sources fill the raw cell.
    const textBoxInCell = {
        x: painted.x - cell.x + sideInset,
        y: painted.y - cell.y + topInset,
        w: painted.w - 2 * sideInset,
        h: painted.h - 2 * topInset,
    };
    const baseFontPx = Math.max(12, Math.round(W * exports.FONT_FRACTION_OF_W * style.textScale));
    const typeset = args.pages.map((p) => (0, typeset_1.typesetPage)(p, textBoxInCell, { fontPx: baseFontPx, align: style.align }));
    const cellBox = { x: cell.x, y: cell.y, w: cell.w, h: cell.h };
    const typesetWords = wordItems(typeset, cellBox);
    const laid = custom
        ? applyWordBoxes(typesetWords, args.wordBoxes, cellBox)
        : { items: typesetWords, applied: false };
    const words = laid.items;
    const chunks = chunkWords(words);
    // ── assets ──────────────────────────────────────────────────────────────
    const assets = {};
    const assetFor = (path, mediaType) => {
        const id = (0, template_utils_1.slugifyAssetKeyFromPath)(path);
        assets[id] = { kind: "file", path, mediaType };
        return (0, types_1.asAssetId)(id);
    };
    // ── row sources ─────────────────────────────────────────────────────────
    const rowSource = (row, i) => (0, template_utils_1.bindProp)(rowContent(row, i), row.propKey);
    const rowContent = (row, i) => {
        const inset = lattice.insetAt(i);
        if (!row.clip) {
            // Placeholder panel: the row colour with a quiet label, one text tile.
            const label = {
                content: { kind: "literal", text: row.placeholder.label },
                placement: { hAlign: "left", vAlign: "bottom", padding: { left: 0.05, bottom: 0.07 } },
            };
            return {
                type: "text",
                renderMode: { kind: "image" },
                visual: { backgroundColor: row.placeholder.color },
                style: {
                    fontFamily: font_metrics_1.FONT_METRICS.family,
                    fontSize: Math.max(12, Math.round(W * 0.026)),
                    fontColor: "#FFFFFF@0.55",
                },
                ...(inset ? { placement: { inset } } : {}),
                layers: [label],
                editor: { owner: "template", label: `row-${i + 1}:placeholder` },
            };
        }
        const { clip } = row;
        const isVideo = clip.mediaType === "video";
        const trim = isVideo && row.trimStartMs > 0 ? Math.round(row.trimStartMs) : 0;
        return {
            type: "media",
            mediaType: clip.mediaType,
            assetId: assetFor(clip.path, clip.mediaType),
            placement: {
                fit: "cover",
                focusY: Math.min(1, Math.max(0, row.focusY)),
                ...(inset ? { inset } : {}),
            },
            ...(trim > 0 ? { playback: { clipStartMs: trim } } : {}),
            audio: { enabled: false },
            editor: { owner: "template", label: `row-${i + 1}:clip` },
        };
    };
    // ── lyric sources ───────────────────────────────────────────────────────
    // Row-sized drawtext sources per chunk: the glow twin (both layouts, when
    // glow is on) and the words themselves (template layout only).
    const glow = Math.min(1, Math.max(0, style.glow));
    const rowText = (chunk, ci, glowPass) => ({
        type: "text",
        renderMode: { kind: "video" },
        // Behind the glyphs: the ink colour at ZERO alpha, never transparent
        // black. drawtext blends into the RGB it draws over, so over black@0 a
        // fading word passes through dark grey (a dark ghost on bright
        // footage) and a blur spreads a dark fringe.
        visual: glowPass
            ? { backgroundColor: `${style.glowColor}@0`, opacity: Math.min(1, 0.5 + glow * 0.5) }
            : { backgroundColor: `${style.textColor}@0` },
        style: {
            fontFamily: font_metrics_1.FONT_METRICS.family,
            fontSize: baseFontPx,
            fontColor: glowPass ? style.glowColor : style.textColor,
        },
        layers: chunk.map((w) => wordLayer(w, baseFontPx, style.entrance)),
        ...(glowPass ? { effects: { blur: Math.max(1, Math.round(baseFontPx * (0.025 + glow * 0.06))) } } : {}),
        overlay: {
            window: {
                startSec: Number(sec(Math.min(...chunk.map((w) => w.atMs)))),
                endSec: Number(sec(Math.max(...chunk.map((w) => w.endMs)))),
            },
        },
        editor: {
            owner: "template",
            label: `lyrics:${glowPass ? "glow" : "words"}${chunks.length > 1 ? `-${ci + 1}` : ""}`,
        },
    });
    const rowLyrics = [];
    chunks.forEach((chunk, ci) => {
        if (glow > 0)
            rowLyrics.push(rowText(chunk, ci, true));
        if (!cellsPerWord)
            rowLyrics.push(rowText(chunk, ci, false));
    });
    // Custom layout, editing pass: one cell per word, bound to its box.
    let wordCells = null;
    if (cellsPerWord && words.length > 0) {
        const pieces = words.map((w, i) => {
            const a = sec(w.atMs);
            const e = sec(w.endMs);
            const rest = restExpr(a);
            const src = {
                type: "text",
                renderMode: { kind: "image" },
                visual: { backgroundColor: `${style.textColor}@0` },
                style: { fontFamily: font_metrics_1.FONT_METRICS.family, fontSize: w.fontPx, fontColor: style.textColor },
                layers: [
                    {
                        content: { kind: "literal", text: w.text },
                        placement: {
                            xExpr: String(w.x - w.box.x),
                            yExpr: String(w.baseline - w.box.y - (0, typeset_1.inkTop)(w.text, w.fontPx)),
                        },
                    },
                ],
                overlay: {
                    enable: `between(t,${a},${e})`,
                    window: { startSec: Number(a), endSec: Number(e) },
                    ...(style.entrance === "instant" ? {} : { alpha: (0, template_utils_1.fadeInExpr)(Number(a), ENTRANCE_SEC, "linear") }),
                    ...(style.entrance === "rise" ? { yExpr: `${Math.round(w.fontPx * RISE_EM)}*${rest}*${rest}` } : {}),
                },
                editor: { owner: "template", label: `word-${i + 1}:${w.text}` },
            };
            return {
                rect: { ...w.box, importance: w.page + 1 },
                source: (0, template_utils_1.bindPropRect)(src, exports.WORD_BOXES_PROP, i),
            };
        });
        const placed = (0, template_utils_1.placeInsetPieces)({ rootW: cell.w, rootH: cell.h, pieces });
        wordCells = { m0: String(placed.m0), sources: placed.sources };
    }
    // ── root overlays: the Reels UI guide, then the song (an audio-only leaf) ─
    const rootOverlay = [];
    if (args.reelsUiPath) {
        rootOverlay.push({
            type: "media",
            mediaType: "image",
            assetId: assetFor(args.reelsUiPath, "image"),
            placement: { fit: "contain" },
            editor: { owner: "template", label: "reels-ui-guide" },
        });
    }
    if (args.song) {
        rootOverlay.push({
            type: "media",
            // MANDATORY even for real audio files: an mp3 with cover art probes as
            // video; declaring "audio" makes the engine take only its sound.
            mediaType: "audio",
            assetId: assetFor(args.song.path, args.song.mediaType),
            audio: { enabled: true, volume: 1 },
            editor: { owner: "template", label: "song" },
        });
    }
    // ── m0: rows, the lyric row's overlay nest, the root overlay nest ───────
    // A nest of `n` full-cell tiles, the innermost carrying `inner` (if any).
    const nest = (n, inner) => n === 0 ? (inner ? `{${inner}}` : "") : `{1${nest(n - 1, inner)}}`;
    const lyricToken = `1${nest(rowLyrics.length, wordCells === null || wordCells === void 0 ? void 0 : wordCells.m0)}`;
    const rowTokens = [0, 1, 2].map((i) => (i === style.lyricRow ? lyricToken : "1"));
    const m0 = `3[${rowTokens.join(",")}]${nest(rootOverlay.length)}`;
    const v = (0, dsl_1.validateM0String)(m0);
    if (!v.ok)
        throw new Error(`lyric-triptych: generated m0 is invalid (${JSON.stringify(v)})`);
    // Sources follow the string order of the `1` tokens.
    const sources = [];
    args.rows.forEach((row, i) => {
        sources.push(rowSource(row, i));
        if (i === style.lyricRow) {
            sources.push(...rowLyrics);
            if (wordCells)
                sources.push(...wordCells.sources);
        }
    });
    sources.push(...rootOverlay);
    const doc = {
        kind: "mosaic_document",
        version: 1,
        m0,
        fps: args.fps,
        durationMs: args.durationMs,
        size: { width: W, height: H },
        backgroundColor: style.borderColor,
        assets: assets,
        sources,
    };
    return {
        doc,
        rowRects,
        textBox: {
            x: cell.x + textBoxInCell.x,
            y: cell.y + textBoxInCell.y,
            w: textBoxInCell.w,
            h: textBoxInCell.h,
        },
        pages: typeset,
        words,
        wordBoxesApplied: laid.applied,
        chunks: chunks.length,
    };
}
