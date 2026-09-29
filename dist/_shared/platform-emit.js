"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GUIDE_ASPECT_TOLERANCE = void 0;
exports.emitForPlatforms = emitForPlatforms;
exports.audioPolicy = audioPolicy;
exports.durationAdvisory = durationAdvisory;
exports.guidePng = guidePng;
exports.guideFitsCanvas = guideFitsCanvas;
exports.guideTiles = guideTiles;
const node_path_1 = __importDefault(require("node:path"));
const platform_guide_regions_1 = require("./platform-guide-regions");
const platforms_1 = require("./platforms");
/**
 * One platform: `build(row)` untouched. `"all"`: an emit:"multi" pipeline,
 * one step per platform (reels, tiktok, shorts), each named and labelled by
 * slug. An unknown knob resolves like `resolveShortPlatform` (the default
 * platform). Throws only when `build` returns a file without a usable
 * `durationMs` under `"all"`.
 */
function emitForPlatforms(knob, fps, build) {
    if (knob !== "all")
        return build((0, platforms_1.resolveShortPlatform)(knob));
    const steps = platforms_1.SHORT_PLATFORMS.map((platform) => {
        const file = build(platform);
        return { name: platform.slug, label: platform.slug, durationMs: stepDurationMs(file, platform), file };
    });
    return {
        kind: "mosaic_pipeline",
        version: 1,
        emit: "multi",
        ...(Number.isFinite(fps) && fps > 0 ? { fps } : {}),
        steps,
    };
}
function stepDurationMs(file, platform) {
    const ms = Math.round(Number(file.durationMs));
    if (!Number.isFinite(ms) || ms < 1) {
        throw new Error(`emitForPlatforms: build(${platform.id}) returned a document without a positive durationMs ` +
            `(got ${String(file.durationMs)}); a pipeline step needs its exact length.`);
    }
    return ms;
}
/** The container and audio a file ships with. Fresh objects on every call. */
function audioPolicy({ masterAudio = false, multi = false }) {
    if (masterAudio && !multi) {
        return {
            format: { kind: "video", container: "mov", videoCodec: "prores_ks", pixelFormat: "yuv422p10le" },
            audio: { mode: "auto", codec: "pcm_s24le", sampleRate: 48000, channelLayout: "stereo" },
        };
    }
    return {
        format: { kind: "video", container: "mp4" },
        audio: { mode: "auto", codec: "aac", bitrate: "320k", sampleRate: 48000, channelLayout: "stereo" },
    };
}
/** How each platform is named in an advisory (the verb agrees with the name). */
const STOPS_AT = Object.freeze({
    "instagram-reel": "Reels stop",
    tiktok: "TikTok stops",
    "youtube-shorts": "Shorts stop",
});
/** m:ss, or h:mm:ss from an hour, of a whole number of seconds. */
function clock(totalSec) {
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    const ss = String(s).padStart(2, "0");
    return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}
/**
 * Plain words when the clip is longer than the platform accepts
 * ("Reels stop at 3:00 - this clip is 3:24."), else null. The clip length
 * rounds UP to the second, so a clip that is over never reads as equal.
 * Design-only text; never blocking. ASCII only.
 */
function durationAdvisory(platform, durationMs) {
    var _a;
    const limitMs = platform.limits.maxDurationMs;
    if (!Number.isFinite(durationMs) || durationMs <= limitMs)
        return null;
    const name = (_a = STOPS_AT[platform.id]) !== null && _a !== void 0 ? _a : `${platform.label} stops`;
    return `${name} at ${clock(Math.floor(limitMs / 1000))} - this clip is ${clock(Math.ceil(durationMs / 1000))}.`;
}
/**
 * The platform's design-mode guide: `assets/<slug>-ui.png` beside this file
 * (1080x1920 RGBA, baked by tools/bake-platform-ui.mjs; `copy-assets` mirrors
 * it into dist). Returns the path only; whether the file exists is the
 * baker's job.
 */
function guidePng(platform) {
    return node_path_1.default.join(__dirname, "assets", `${platform.slug}-ui.png`);
}
/** How far a canvas's aspect may stray from the guide PNG's 9:16 before the guide is left out (a fraction). */
exports.GUIDE_ASPECT_TOLERANCE = 0.01;
/**
 * True when a `W` x `H` canvas has the guide PNG's shape (9:16, within
 * GUIDE_ASPECT_TOLERANCE). The guide is a phone screen: on another shape its
 * regions would stretch one way, and each `cover` crop would cut its drawing.
 */
function guideFitsCanvas(W, H) {
    const cw = Math.round(Number(W));
    const ch = Math.round(Number(H));
    if (!(cw > 0 && ch > 0))
        return false;
    const want = platform_guide_regions_1.GUIDE_PNG_SIZE.width / platform_guide_regions_1.GUIDE_PNG_SIZE.height;
    return Math.abs(cw / ch / want - 1) <= exports.GUIDE_ASPECT_TOLERANCE;
}
/**
 * The platform's design-mode guide as one tile per region of its PNG (see
 * `platform-guide-regions.ts`): each tile crops its region
 * (`placement.sourceRect`, PNG px) and covers only that part of the canvas,
 * so the guide hugs the app's chrome and never becomes a full-canvas click
 * target over the words. A region lands on the canvas at the same fractions
 * of W and H it has of the PNG; its EDGES are rounded (not its size), so
 * neighbours stay flush at any canvas. A region that rounds to nothing is
 * left out. Show each tile with `fit: "cover"` (a `contain` crop leaves seams
 * between flush thin tiles). No tiles at all on a canvas that is not 9:16
 * (`guideFitsCanvas`): say so instead.
 */
function guideTiles(platform, W, H) {
    var _a;
    if (!guideFitsCanvas(W, H))
        return [];
    const cw = Math.max(1, Math.round(Number(W)) || 1);
    const ch = Math.max(1, Math.round(Number(H)) || 1);
    const sx = cw / platform_guide_regions_1.GUIDE_PNG_SIZE.width;
    const sy = ch / platform_guide_regions_1.GUIDE_PNG_SIZE.height;
    const tiles = [];
    for (const { name, rect: r } of (_a = platform_guide_regions_1.GUIDE_REGIONS[platform.slug]) !== null && _a !== void 0 ? _a : []) {
        const x0 = Math.round(r.x * sx);
        const x1 = Math.round((r.x + r.w) * sx);
        const y0 = Math.round(r.y * sy);
        const y1 = Math.round((r.y + r.h) * sy);
        if (x1 <= x0 || y1 <= y0)
            continue;
        tiles.push({ name, sourceRect: { x: r.x, y: r.y, w: r.w, h: r.h }, rect: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } });
    }
    return tiles;
}
