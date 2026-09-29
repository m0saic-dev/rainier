"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SCRIBBLE_INK = exports.RULE_INK = exports.RULE_ALPHA = exports.HIGHLIGHT_ALPHA_DARK = exports.HIGHLIGHT_ALPHA_LIGHT = exports.MAX_ROOT_SOURCES = exports.NEVER_ENABLE = exports.FADE_SEC = exports.MARK_COLOR_PROP = exports.LINE_BOXES_PROP = exports.PAGE_PROP = void 0;
exports.markAlpha = markAlpha;
exports.markOverlay = markOverlay;
exports.buildMargins = buildMargins;
const types_1 = require("@m0saic/types");
const dsl_1 = require("@m0saic/dsl");
const template_utils_1 = require("@m0saic/template-utils");
const marks_1 = require("./marks");
/** Prop keys the tiles bind (the schema's names). */
exports.PAGE_PROP = "page";
exports.LINE_BOXES_PROP = "lineBoxes";
exports.MARK_COLOR_PROP = "markColor";
/** Each mark fades in over this long when its line starts. */
exports.FADE_SEC = 0.12;
/** The design-only "this line is not in the clip" gate: never true. */
exports.NEVER_ENABLE = "lt(t,0)";
/** Root sources at most: 16 marks + page + scribble + the audio leaf (the engine's cap is 20). */
exports.MAX_ROOT_SOURCES = 19;
/**
 * The highlighter over a LIGHT page: normal blending at this alpha.
 *
 * Not `multiply`, on purpose. The 0.2.x engine blends a tile by first laying
 * it on a transparent layer the size of its whole parent, premultiplying
 * that layer by its alpha and making it opaque (black wherever the tile is
 * not), then `blend=all_mode=multiply` against everything below
 * (m0saic packages/core/src/ffmpeg/ffmpegCommands.ts: `compositeWithBlend`
 * 2969-3012, called at 1222, 1345 and 1809). Black is multiply's
 * zero, so a multiplied mark would black out the whole frame outside its
 * mask, and before its window opens. `screen` and `add` survive the same
 * path because black is their identity. This is the plan's own fallback
 * (plan section 8, "Blend plus inline mask order").
 */
exports.HIGHLIGHT_ALPHA_LIGHT = 0.4;
/**
 * The highlighter over a DARK page (`screen`): a gold band that keeps light
 * text readable. The one costly path here: every blended tile runs a
 * full-canvas per-pixel premultiply (`geq`) for as long as its window is
 * open (the engine gates it to the window), so with `past: keep` the last
 * seconds of a 16-line clip carry up to 16 of them.
 */
exports.HIGHLIGHT_ALPHA_DARK = 0.55;
/** The ruled lines of the empty page sit this faint on the paper. */
exports.RULE_ALPHA = 0.5;
/**
 * Translucency rides `overlay.alpha`, never a `#rrggbb@a` colour: an inline
 * mask's `alphamerge` REPLACES the tile's alpha plane (m0saic
 * packages/core/src/ffmpeg/filters/applyTileEffects.ts:195-203 and
 * filters/applyMask.ts:60), so a colour's own alpha would render fully opaque
 * and bury the handwriting. A constant alpha, and a canonical fade times a
 * constant, both lower to compiled filters (`fade` + `colorchannelmixer`),
 * never a per-pixel fold (ffmpegCommands.ts `tryLowerAlphaSide`, 2474-2534).
 */
exports.RULE_INK = "#6F8FB5";
/** The handwriting stand-in (opaque ink). */
exports.SCRIBBLE_INK = "#2C3450";
const sec = (ms) => (ms / 1000).toFixed(3);
/** How opaque a mark is: the highlighter is translucent, the underline and the box are ink. */
function markAlpha(style, tone) {
    if (style !== "highlight")
        return 1;
    return tone === "dark" ? exports.HIGHLIGHT_ALPHA_DARK : exports.HIGHLIGHT_ALPHA_LIGHT;
}
/** The overlay for one mark: its window, its fade, its opacity and the highlighter's blend. */
function markOverlay(style, tone, vis) {
    const k = markAlpha(style, tone);
    const blend = style === "highlight" && tone === "dark" ? { blendMode: "screen" } : {};
    const still = { ...blend, ...(k < 1 ? { alpha: String(k) } : {}) };
    if (vis.kind === "always")
        return Object.keys(still).length > 0 ? still : undefined;
    if (vis.kind === "never")
        return { ...still, enable: exports.NEVER_ENABLE };
    const a = sec(vis.startMs);
    const e = sec(vis.endMs);
    const fade = (0, template_utils_1.fadeInExpr)(Number(a), exports.FADE_SEC, "linear");
    return {
        ...blend,
        enable: `between(t,${a},${e})`,
        window: { startSec: Number(a), endSec: Number(e) },
        alpha: k < 1 ? `${fade}*${k}` : fade,
    };
}
/** One inline mask whose bounds are the box size (the path is box-local px). */
function boxMask(d, w, h) {
    return { kind: "inline-mask", localPath: d, bounds: { x: 0, y: 0, width: w, height: h } };
}
function buildMargins(args) {
    const W = Math.round(args.W);
    const H = Math.round(args.H);
    const assets = {};
    // One key per file. The slug drops the extension, so "lyrics.jpg" (the
    // page) and "lyrics.m4a" (the recording) would share a key: the second
    // gets "_2" instead of overwriting the first.
    const assetFor = (p, mediaType) => {
        const same = Object.keys(assets).find((k) => assets[k].path === p && assets[k].mediaType === mediaType);
        if (same !== undefined)
            return (0, types_1.asAssetId)(same);
        const id = (0, template_utils_1.uniqueAssetKey)((0, template_utils_1.slugifyAssetKeyFromPath)(p), assets);
        assets[id] = { kind: "file", path: p, mediaType };
        return id;
    };
    // ── full-canvas layers ───────────────────────────────────────────────────
    const layers = [];
    if (args.page) {
        const { path: p, mediaType, fit } = args.page;
        const photo = {
            type: "media",
            mediaType,
            assetId: assetFor(p, mediaType),
            placement: { fit },
            ...(mediaType === "video" ? { audio: { enabled: false } } : {}),
            editor: { owner: "template", label: "page" },
        };
        layers.push((0, template_utils_1.bindProp)(photo, exports.PAGE_PROP));
    }
    else {
        const paper = (0, template_utils_1.makeColorTile)(exports.RULE_INK, {
            mask: boxMask((0, marks_1.ruledPaperPath)(W, H), W, H),
            overlay: { alpha: String(exports.RULE_ALPHA) },
        });
        paper.editor = { owner: "template", label: "page:placeholder" };
        layers.push((0, template_utils_1.bindProp)(paper, exports.PAGE_PROP));
        // The stand-in is pen strokes, not filled shapes: the mask's `strokes`
        // (round caps and joins; `localPath` may be "" when strokes carry it all).
        const scribble = (0, template_utils_1.makeColorTile)(exports.SCRIBBLE_INK, {
            mask: { ...boxMask("", W, H), strokes: (0, marks_1.scribbleStrokes)(W, H) },
        });
        scribble.editor = { owner: "template", label: "page:scribble" };
        layers.push(scribble);
    }
    if (args.audio) {
        const { path: p, mediaType, clipStartMs } = args.audio;
        const start = Math.max(0, Math.round(clipStartMs));
        layers.push({
            type: "media",
            // MANDATORY even for a real audio file: an mp3 with cover art probes as
            // video; declaring "audio" makes the engine take only its sound.
            mediaType: "audio",
            assetId: assetFor(p, mediaType),
            ...(start > 0 ? { playback: { clipStartMs: start } } : {}),
            audio: { enabled: true, volume: 1 },
            editor: { owner: "template", label: "audio" },
        });
    }
    // ── marks ────────────────────────────────────────────────────────────────
    const pieces = args.marks.flatMap((vis, i) => {
        if (!vis)
            return [];
        const box = args.boxes[i];
        const overlay = markOverlay(args.style, args.pageTone, vis);
        const tile = (0, template_utils_1.makeColorTile)(args.markColor, {
            mask: boxMask((0, marks_1.markPath)(args.style, box.w, box.h), box.w, box.h),
            ...(overlay ? { overlay } : {}),
        });
        tile.editor = { owner: "template", label: `mark-${i + 1}` };
        // The rect handle first: a double-click opens the box session on this
        // line; the colour swatch rides beside it.
        const bound = (0, template_utils_1.bindProps)(tile, [{ propKey: exports.LINE_BOXES_PROP, index: i, kind: "rect" }, { propKey: exports.MARK_COLOR_PROP }]);
        return [{ rect: { ...box, importance: 1 }, source: bound }];
    });
    const placed = pieces.length > 0 ? (0, template_utils_1.placeInsetPieces)({ rootW: W, rootH: H, pieces }) : null;
    // ── m0: the layers nest, the marks innermost ─────────────────────────────
    let m0 = placed ? String(placed.m0) : "";
    for (let k = layers.length - 1; k >= 0; k--)
        m0 = m0 ? `1{${m0}}` : "1";
    const v = (0, dsl_1.validateM0String)(m0);
    if (!v.ok)
        throw new Error(`margins: generated m0 is invalid (${JSON.stringify(v)})`);
    const markSources = placed ? placed.sources : [];
    const markLines = markSources.map((s) => {
        var _a, _b;
        const label = (_b = (_a = s.editor) === null || _a === void 0 ? void 0 : _a.label) !== null && _b !== void 0 ? _b : "";
        return Number(label.replace("mark-", "")) - 1;
    });
    const sources = [...layers, ...markSources];
    if (sources.length > exports.MAX_ROOT_SOURCES) {
        throw new Error(`margins: ${sources.length} root sources (the cap is ${exports.MAX_ROOT_SOURCES}); at most 16 lines`);
    }
    const doc = {
        kind: "mosaic_document",
        version: 1,
        m0,
        fps: args.fps,
        durationMs: Math.max(1, Math.round(args.durationMs)),
        size: { width: W, height: H },
        backgroundColor: args.paperColor,
        ...args.output,
        assets: assets,
        sources,
    };
    return { doc, markLines, layers: layers.length };
}
