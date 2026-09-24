"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TEXT_TOP_FRAC = exports.TEXT_SIDE_FRAC = exports.FONT_FRACTION_OF_W = exports.LAYERS_PER_SOURCE = void 0;
exports.chunkPages = chunkPages;
exports.buildTriptych = buildTriptych;
const types_1 = require("@m0saic/types");
const dsl_1 = require("@m0saic/dsl");
const template_utils_1 = require("@m0saic/template-utils");
const font_metrics_1 = require("./font-metrics");
const typeset_1 = require("./typeset");
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
const ENTRANCE_SEC = 0.28;
const RISE_EM = 0.16;
const sec = (ms) => (ms / 1000).toFixed(3);
/** `min(1, u)` without a comma, for u ≥ 0: placement exprs are filtergraph-inlined. */
const progressExpr = (startSec) => {
    const u = `(t-${startSec})/${ENTRANCE_SEC}`;
    // 1 - min(1,u) == (1 - u + |u - 1|) / 2
    return `((1-${u}+abs(${u}-1))/2)`;
};
function wordLayer(word, page, baseFontPx, entrance) {
    const a = sec(word.atMs);
    const e = sec(page.endMs);
    const rest = progressExpr(a); // 1 → 0 over the entrance
    const riseOffset = entrance === "rise" ? `+${Math.round(page.fontPx * RISE_EM)}*${rest}*${rest}` : "";
    const layer = {
        content: { kind: "literal", text: word.text },
        placement: {
            xExpr: String(word.x),
            yExpr: `${word.baseline}-ascent${riseOffset}`,
        },
        overlay: {
            // The enable string and the structured window describe the SAME
            // window, minted from the same rounded seconds.
            enable: `between(t,${a},${e})`,
            window: { startSec: Number(a), endSec: Number(e) },
            ...(entrance === "instant"
                ? {}
                : { alpha: `min(1,max(0,(t-${a})/${ENTRANCE_SEC}))` }),
        },
    };
    if (page.fontPx !== baseFontPx)
        layer.style = { fontSize: page.fontPx };
    return layer;
}
/** Split pages into chunks of ≤ LAYERS_PER_SOURCE word layers (a page never straddles). */
function chunkPages(pages) {
    const chunks = [];
    let current = [];
    let count = 0;
    for (const p of pages) {
        const n = p.lines.reduce((s, l) => s + l.length, 0);
        if (count > 0 && count + n > exports.LAYERS_PER_SOURCE) {
            chunks.push(current);
            current = [];
            count = 0;
        }
        current.push(p);
        count += n;
    }
    if (current.length > 0)
        chunks.push(current);
    return chunks;
}
function buildTriptych(args) {
    const W = Math.round(args.canvasW);
    const H = Math.round(args.canvasH);
    const { style } = args;
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
    // Word coordinates are CELL-relative: the text sources fill the raw cell.
    const textBoxInCell = {
        x: painted.x - cell.x + sideInset,
        y: painted.y - cell.y + topInset,
        w: painted.w - 2 * sideInset,
        h: painted.h - 2 * topInset,
    };
    const baseFontPx = Math.max(12, Math.round(W * exports.FONT_FRACTION_OF_W * style.textScale));
    const typeset = args.pages.map((p) => (0, typeset_1.typesetPage)(p, textBoxInCell, { fontPx: baseFontPx, align: style.align }));
    const chunks = chunkPages(typeset);
    // ── assets ──────────────────────────────────────────────────────────────
    const assets = {};
    const assetFor = (path, mediaType) => {
        const id = (0, template_utils_1.slugifyAssetKeyFromPath)(path);
        assets[id] = { kind: "file", path, mediaType };
        return (0, types_1.asAssetId)(id);
    };
    // ── row sources ─────────────────────────────────────────────────────────
    const rowSource = (row, i) => {
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
    // ── lyric sources: per chunk, an optional blurred glow twin under the words ─
    const glow = Math.min(1, Math.max(0, style.glow));
    const lyricSources = [];
    chunks.forEach((chunk, ci) => {
        const layers = chunk.flatMap((page) => page.lines.flat().map((w) => wordLayer(w, page, baseFontPx, style.entrance)));
        const window = {
            startSec: Number(sec(chunk[0].startMs)),
            endSec: Number(sec(chunk[chunk.length - 1].endMs)),
        };
        const text = (glowPass) => ({
            type: "text",
            renderMode: { kind: "video" },
            // Behind the glyphs: the ink colour at ZERO alpha, never transparent
            // black. drawtext blends into the RGB it draws over, so over black@0
            // a fading word passes through dark grey (a dark ghost on bright
            // footage) and a blur spreads a dark fringe.
            visual: glowPass
                ? { backgroundColor: `${style.glowColor}@0`, opacity: Math.min(1, 0.5 + glow * 0.5) }
                : { backgroundColor: `${style.textColor}@0` },
            style: {
                fontFamily: font_metrics_1.FONT_METRICS.family,
                fontSize: baseFontPx,
                fontColor: glowPass ? style.glowColor : style.textColor,
            },
            layers,
            ...(glowPass ? { effects: { blur: Math.max(1, Math.round(baseFontPx * (0.025 + glow * 0.06))) } } : {}),
            overlay: { window },
            editor: {
                owner: "template",
                label: `lyrics:${glowPass ? "glow" : "words"}${chunks.length > 1 ? `-${ci + 1}` : ""}`,
            },
        });
        if (glow > 0)
            lyricSources.push(text(true));
        lyricSources.push(text(false));
    });
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
    const nest = (n) => (n === 0 ? "" : `{1${nest(n - 1)}}`);
    const rowTokens = [0, 1, 2].map((i) => (i === style.lyricRow ? `1${nest(lyricSources.length)}` : "1"));
    const m0 = `3[${rowTokens.join(",")}]${nest(rootOverlay.length)}`;
    const v = (0, dsl_1.validateM0String)(m0);
    if (!v.ok)
        throw new Error(`lyric-triptych: generated m0 is invalid (${JSON.stringify(v)})`);
    // Sources follow the string order of the `1` tokens.
    const sources = [];
    args.rows.forEach((row, i) => {
        sources.push(rowSource(row, i));
        if (i === style.lyricRow)
            sources.push(...lyricSources);
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
        chunks: chunks.length,
    };
}
