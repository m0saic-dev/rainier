"use strict";
/**
 * The two cards Take Cutter shows before there is anything to cut.
 *
 * - ONBOARDING (no video yet, any mode): a big tile that IS the drop target
 *   for the video (bound to `source`: drop a file on it, or double-click it
 *   to pick one; a single click only selects it), three plain steps, and a
 *   caption bound to `namePrefix` that shows how the files will be named.
 * - MARK TAKES (a video, no takes yet, Make's design pass only): the video
 *   itself in the big tile (still bound to `source`, so a drop replaces it)
 *   and "Open Takes to mark your first take". A real render with no takes is
 *   an error card instead: there is nothing to write.
 *
 * Both are one flat document: the canvas is `document.backgroundColor`, every
 * piece is placed on its exact rect with `placeInsetPieces`, and text is
 * svg-rasterized with the bundled font (ASCII only), pre-fitted to its box.
 * Unbound text sits ON TOP of the tile; Make looks through unbound tiles, so
 * a drop still lands on the tile beneath.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CARD_BG = void 0;
exports.cardLayout = cardLayout;
exports.fitAspect = fitAspect;
exports.fileNamesCaption = fileNamesCaption;
exports.buildOnboardingCard = buildOnboardingCard;
exports.buildMarkTakesCard = buildMarkTakesCard;
const types_1 = require("@m0saic/types");
const dsl_1 = require("@m0saic/dsl");
const template_utils_1 = require("@m0saic/template-utils");
const plan_1 = require("./plan");
exports.CARD_BG = "#15131C";
const TILE = "#231F2E";
const TILE_EDGE = "#9B8BFF";
const INK = "#FFFFFF";
const MUTED = "#B9B3C8";
const ACCENT = "#B7A8FF";
/** Example times in the file-name caption (a take from 1:22 to 1:37). */
const EXAMPLE_START_MS = 82000;
const EXAMPLE_END_MS = 97000;
/** Every rect of the card, from the canvas alone (fractions of W and H). */
function cardLayout(W, H) {
    const pad = Math.round(W * 0.08);
    const row = (y, h) => ({ x: pad, y: Math.round(H * y), w: W - 2 * pad, h: Math.max(1, Math.round(H * h)) });
    const tile = row(0.19, 0.5);
    const inTile = (y, h) => ({
        x: tile.x + Math.round(tile.w * 0.08),
        y: tile.y + Math.round(tile.h * y),
        w: tile.w - 2 * Math.round(tile.w * 0.08),
        h: Math.max(1, Math.round(tile.h * h)),
    });
    return {
        title: row(0.055, 0.065),
        subtitle: row(0.125, 0.045),
        tile,
        tileHead: inTile(0.37, 0.13),
        tileSub: inTile(0.51, 0.07),
        headline: row(0.72, 0.05),
        lines: [row(0.785, 0.035), row(0.822, 0.035), row(0.859, 0.035)],
        caption: row(0.915, 0.035),
    };
}
/** The largest rect of `aspectW:aspectH` inside `box`, centred (integer px). */
function fitAspect(box, aspectW, aspectH) {
    if (!(aspectW > 0) || !(aspectH > 0))
        return { ...box };
    const scale = Math.min(box.w / aspectW, box.h / aspectH);
    const w = Math.max(2, Math.min(box.w, Math.round(aspectW * scale)));
    const h = Math.max(2, Math.min(box.h, Math.round(aspectH * scale)));
    return { x: box.x + Math.floor((box.w - w) / 2), y: box.y + Math.floor((box.h - h) / 2), w, h };
}
/** The caption: how a take's file will be named with the current prefix. */
function fileNamesCaption(namePrefix, videoName) {
    const base = (0, plan_1.labelBase)([namePrefix, videoName, "yourvideo"]);
    return `File names: ${(0, plan_1.takeLabel)(base, EXAMPLE_START_MS, EXAMPLE_END_MS)}.mp4`;
}
const label = (text, r, color, name, maxPx = Math.round(r.h * 0.7)) => (0, template_utils_1.tag)((0, template_utils_1.svgLabel)(text, r.w, r.h, { color, maxPx, maxLines: 1 }), name);
/** Lines set at ONE size: the largest every line fits at. */
function evenLines(texts, rects, color, name) {
    const px = Math.min(...texts.map((t, i) => (0, template_utils_1.fitSvgText)(t, rects[i].w, rects[i].h, { maxPx: Math.round(rects[i].h * 0.7), maxLines: 1 }).fontSize));
    return texts.map((t, i) => ({ rect: rects[i], source: label(t, rects[i], color, `${name}-${i + 1}`, px), importance: 1 }));
}
function assemble(frame, pieces, assets) {
    const placed = (0, template_utils_1.placeInsetPieces)({
        rootW: frame.W,
        rootH: frame.H,
        pieces: pieces.map((p) => ({ rect: { ...p.rect, importance: p.importance }, source: p.source })),
    });
    const m0 = placed.m0;
    const v = (0, dsl_1.validateM0String)(String(m0));
    if (!v.ok)
        throw new Error(`take-cutter: card m0 is invalid (${JSON.stringify(v)})`);
    return {
        kind: "mosaic_document",
        version: 1,
        m0,
        fps: frame.fps,
        durationMs: frame.durationMs,
        size: { width: frame.W, height: frame.H },
        backgroundColor: exports.CARD_BG,
        assets,
        sources: placed.sources,
        // A card is a guide, never a soundtrack.
        audio: { mode: "off" },
    };
}
/** No video yet: the big tile is where the video goes. */
function buildOnboardingCard(frame, namePrefix) {
    const L = cardLayout(frame.W, frame.H);
    const dropTile = (0, template_utils_1.bindProp)((0, template_utils_1.tag)((0, template_utils_1.makeColorTile)(TILE, {
        effects: {
            rounding: { borderRadius: 0.08 },
            stroke: { width: 0.006, color: TILE_EDGE, alpha: 0.55 },
        },
    }), "card:drop-video"), "source");
    const pieces = [
        { rect: L.title, source: label("Take Cutter", L.title, INK, "card:title"), importance: 1 },
        { rect: L.subtitle, source: label("Cut the best takes out of a long recording", L.subtitle, MUTED, "card:subtitle"), importance: 1 },
        { rect: L.tile, source: dropTile, importance: 0 },
        { rect: L.tileHead, source: label("Drop your video here", L.tileHead, INK, "card:drop-hint"), importance: 1 },
        { rect: L.tileSub, source: label("or double-click here to choose a file", L.tileSub, MUTED, "card:drop-sub"), importance: 1 },
        { rect: L.headline, source: label("How it works", L.headline, ACCENT, "card:headline"), importance: 1 },
        ...evenLines([
            "1. Drop a long video: a rehearsal, a live set",
            "2. Open Takes and mark each piece you want",
            "3. Make: every take is saved as its own file",
        ], L.lines, MUTED, "card:step"),
        {
            rect: L.caption,
            source: (0, template_utils_1.bindProp)(label(fileNamesCaption(namePrefix), L.caption, MUTED, "card:file-names"), "namePrefix"),
            importance: 1,
        },
    ];
    return assemble(frame, pieces, {});
}
/** A video, no takes: show the video and the one next step. */
function buildMarkTakesCard(frame, args) {
    const L = cardLayout(frame.W, frame.H);
    const assetId = (0, types_1.asAssetId)((0, template_utils_1.slugifyAssetKeyFromPath)(args.sourcePath));
    const video = (0, template_utils_1.bindProp)({
        type: "media",
        mediaType: "video",
        assetId,
        placement: { fit: "cover" },
        audio: { enabled: false },
        editor: { owner: "template", label: "card:video" },
    }, "source");
    const pieces = [
        { rect: L.title, source: label("Take Cutter", L.title, INK, "card:title"), importance: 1 },
        {
            rect: L.subtitle,
            source: label(`${(0, plan_1.shortName)(args.videoName)}, ${(0, plan_1.fmtStamp)(args.source.durationMs)} long`, L.subtitle, MUTED, "card:video-name"),
            importance: 1,
        },
        { rect: fitAspect(L.tile, args.source.width, args.source.height), source: video, importance: 0 },
        { rect: L.headline, source: label("Open Takes to mark your first take", L.headline, ACCENT, "card:headline"), importance: 1 },
        ...evenLines([
            "Play the video and find a piece you like",
            "Mark where it starts and where it ends",
            "Every take you mark becomes its own file",
        ], L.lines, MUTED, "card:step"),
        {
            rect: L.caption,
            source: (0, template_utils_1.bindProp)(label(fileNamesCaption(args.namePrefix, args.videoName), L.caption, MUTED, "card:file-names"), "namePrefix"),
            importance: 1,
        },
    ];
    const assets = { [assetId]: { kind: "file", path: args.sourcePath, mediaType: "video" } };
    return assemble(frame, pieces, assets);
}
