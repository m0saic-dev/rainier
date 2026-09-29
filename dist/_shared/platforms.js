"use strict";
/**
 * Short-form platforms: the three vertical feeds an artist posts to, one row
 * each, and the stage (safe area, action rail, caption block) a template lays
 * out against.
 *
 * FROZEN ONCE SHIPPED. `_shared` is imported by shipped templates, so this API
 * never changes shape and a row never changes meaning. A new platform, a
 * re-measured row that would move a shipped template's layout, or a new field
 * goes in a copy beside the template version that needs it. TikTok and Shorts
 * were measured before the first template shipped (the one planned edit; the
 * row shape was chosen so measuring never changed the API).
 *
 * THE ROW (`ShortPlatform`), all geometry as fractions of the canvas:
 *
 *   id        the prop value ("instagram-reel" | "tiktok" | "youtube-shorts")
 *   slug      file/step name ("reels" | "tiktok" | "shorts"): the pipeline step
 *             name under "export all", and the guide PNG's basename
 *   label     option label for the props panel
 *   canvas    the size the platform wants (1080x1920 for all three)
 *   chrome    { top, bottom, side }: what the app draws over the video. `top` and
 *             `bottom` are fractions of H, `side` of W (each side). `side` is
 *             what a tall phone crops off a 9:16 video, not app UI.
 *   rail      { width, top, bottom }: the action-button column up the right
 *             edge. `width` is a fraction of W measured from the right edge;
 *             `top` / `bottom` are fractions of H from the top / bottom edge.
 *             Optional: absent = no rail.
 *   caption   { height }: the caption block (handle, caption text, extra line)
 *             is the top `height` of the bottom chrome band, left of the rail.
 *             Optional: absent = no caption block.
 *   limits    { maxDurationMs, captionChars, titleChars? }
 *   measured  true = measured from screenshots; false = an estimate (all three
 *             rows are measured; the flag stays for a future row)
 *   note      where the numbers come from
 *
 * THE STAGE (`platformStage(p, W, H)`) turns a row into integer-px rects at
 * any canvas, so a 720x1280 draft scales with the 1080x1920 export:
 *
 *   safe          inside the chrome: text belongs here
 *   rail?         the action column (x from W - rail px to W); a layout keeps
 *                 its right edge left of `rail.x` wherever the two overlap in y
 *   captionBlock? the caption's place inside the bottom band, left of the rail
 *
 * The geometry is TIGHT: each edge is where the app's drawing starts, with no
 * breathing room. A layout adds its own margin (stage-layout's `lyricBox` does).
 *
 * PROVENANCE
 *
 * Reels (measured): `tools/bake-reels-ui.mjs` measured a Reel on a 6.3-inch
 * iPhone (1206x2622 screen, the Reel filling the 1206x2365 area above the
 * comment bar) and mapped it back onto the 1080x1920 video: the phone scales
 * the video by 2365 / 1920 = 1.2316 and crops about 50 px off each side. The
 * px below are that tool's SVG geometry; the ink extents of the baked
 * `reels-ui.png` agree to within the icon stroke (header ink ends at y 234,
 * caption ink spans y 1631 to 1872, rail ink starts at x 916 and spans y 969
 * to 1875).
 *
 * TikTok and Shorts (measured 2026-09-29): one screenshot each on the same
 * 6.3-inch iPhone (1206x2622; `ref/tiktok_ref.PNG`, `ref/youtube_shorts_ref.PNG`,
 * git-ignored), mapped back onto the 1080x1920 video the same way. The video
 * fills from the top of the screen down to the app's bottom bar: TikTok to
 * y 2373 (scale 2373 / 1920 = 1.2359), Shorts to y 2375 (1.2370; its progress
 * line lies OVER the video's last rows). Both crop 52 px off each side, so a
 * screen x maps to (x + 64.4) / scale (TikTok) and (x + 65.0) / scale (Shorts).
 * Each edge is the ink of the app's own drawing, rounded outwards:
 *   TikTok  header = the search row's bottom (screen y 305; the For You tabs sit
 *           higher, so this is the tighter bound); rail = profile avatar top
 *           (y 1178) to the sound disc's bottom (y 2330), ink from x 1050;
 *           caption = the name row's top (y 2160) to the second caption line's
 *           descenders (y 2339).
 *   Shorts  header = the search / more icons' bottom (y 286); rail = the like
 *           icon's top (y 1315) to the sound thumbnail's bottom (y 2315), ink
 *           from x 1052 (the "Remix" label); caption = the channel avatar's top
 *           (y 2147) to the title line's descenders (y 2320).
 * The rail's left edge keeps the 6 px the Reels row leaves beside its ink.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PLATFORM_LIMITS = exports.PLATFORM_SLUG = exports.DEFAULT_SHORT_PLATFORM = exports.SHORT_PLATFORM_OPTIONS = exports.SHORT_PLATFORM_IDS = exports.SHORT_PLATFORMS = void 0;
exports.isShortPlatformId = isShortPlatformId;
exports.resolveShortPlatform = resolveShortPlatform;
exports.platformStage = platformStage;
// ── Reels, measured (tools/bake-reels-ui.mjs, 1080x1920 video px) ─────────
const REELS_W = 1080;
const REELS_H = 1920;
/** `SIDE_CROP`: a tall phone crops this much off each side of a 9:16 video. */
const REELS_SIDE_CROP = 50;
/** Header row bottom: the camera icon, 60 px centred on y 211 (181 to 241). */
const REELS_HEADER_BOTTOM = 241;
/** Caption block top: the avatar circle's outer stroke (cy 1675, r 42, stroke 3). */
const REELS_CAPTION_TOP = 1631;
/** Caption block bottom: the "Liked by" line and its two 19 px avatars (cy 1852), rounded to the thumb's edge. */
const REELS_CAPTION_BOTTOM = 1874;
/**
 * Rail left edge: the items centre on x 956; the widest are the 32 px count
 * labels (about 86 px, ink from x 916), so 910 leaves 6 px.
 */
const REELS_RAIL_LEFT = 910;
/** Rail top: the heart icon, 60 px centred on y 995 (965 to 1025). */
const REELS_RAIL_TOP = 965;
/** Rail bottom: the audio thumb, y 1804 plus 70 px plus its 2 px stroke. */
const REELS_RAIL_BOTTOM = 1876;
// ── TikTok, measured (ref/tiktok_ref.PNG, 1080x1920 video px) ─────────────
const TIKTOK_W = 1080;
const TIKTOK_H = 1920;
/** A tall phone crops this much off each side (64.4 screen px / 1.2359). */
const TIKTOK_SIDE_CROP = 52;
/** Header bottom: the search row's outline (screen y 305 / 1.2359 = 246.8). */
const TIKTOK_HEADER_BOTTOM = 247;
/** Caption block top: the name row's cap tops (screen y 2160 = 1747.6, rounded out). */
const TIKTOK_CAPTION_TOP = 1747;
/** Caption block bottom: the second caption line's descenders (screen y 2339 = 1892.5). */
const TIKTOK_CAPTION_BOTTOM = 1893;
/** Rail left edge: the avatars' ink from screen x 1050 = 901.7, less 6 px. */
const TIKTOK_RAIL_LEFT = 896;
/** Rail top: the profile avatar's top (screen y 1178 = 953.1). */
const TIKTOK_RAIL_TOP = 953;
/** Rail bottom: the sound disc's bottom (screen y 2330 = 1885.2). */
const TIKTOK_RAIL_BOTTOM = 1886;
// ── Shorts, measured (ref/youtube_shorts_ref.PNG, 1080x1920 video px) ─────
const SHORTS_W = 1080;
const SHORTS_H = 1920;
/** A tall phone crops this much off each side (65.0 screen px / 1.2370). */
const SHORTS_SIDE_CROP = 52;
/** Header bottom: the search / more icons (screen y 286 / 1.2370 = 231.2). */
const SHORTS_HEADER_BOTTOM = 232;
/** Caption block top: the channel avatar's top (screen y 2147 = 1735.7, rounded out). */
const SHORTS_CAPTION_TOP = 1735;
/** Caption block bottom: the title line's descenders (screen y 2320 = 1875.5). */
const SHORTS_CAPTION_BOTTOM = 1876;
/** Rail left edge: the "Remix" label's ink from screen x 1052 = 903.0, less 6 px. */
const SHORTS_RAIL_LEFT = 897;
/** Rail top: the like icon's top (screen y 1315 = 1063.1). */
const SHORTS_RAIL_TOP = 1063;
/** Rail bottom: the sound thumbnail's bottom (screen y 2315 = 1871.5). */
const SHORTS_RAIL_BOTTOM = 1872;
function deepFreeze(value) {
    if (value && typeof value === "object" && !Object.isFrozen(value)) {
        for (const key of Object.keys(value))
            deepFreeze(value[key]);
        Object.freeze(value);
    }
    return value;
}
/** The three platforms, in step order (reels, tiktok, shorts). Deep-frozen: never mutate a row. */
exports.SHORT_PLATFORMS = deepFreeze([
    {
        id: "instagram-reel",
        slug: "reels",
        label: "Instagram Reels",
        canvas: { width: REELS_W, height: REELS_H },
        chrome: {
            top: REELS_HEADER_BOTTOM / REELS_H,
            bottom: (REELS_H - REELS_CAPTION_TOP) / REELS_H,
            side: REELS_SIDE_CROP / REELS_W,
        },
        rail: {
            width: (REELS_W - REELS_RAIL_LEFT) / REELS_W,
            top: REELS_RAIL_TOP / REELS_H,
            bottom: (REELS_H - REELS_RAIL_BOTTOM) / REELS_H,
        },
        caption: { height: (REELS_CAPTION_BOTTOM - REELS_CAPTION_TOP) / (REELS_H - REELS_CAPTION_TOP) },
        limits: { maxDurationMs: 180000, captionChars: 2200 },
        measured: true,
        note: "Measured by tools/bake-reels-ui.mjs: a Reel on a 6.3-inch iPhone scales the 1080-wide video by 1.2316 " +
            "and crops about 50 px per side.",
    },
    {
        id: "tiktok",
        slug: "tiktok",
        label: "TikTok",
        canvas: { width: TIKTOK_W, height: TIKTOK_H },
        chrome: {
            top: TIKTOK_HEADER_BOTTOM / TIKTOK_H,
            bottom: (TIKTOK_H - TIKTOK_CAPTION_TOP) / TIKTOK_H,
            side: TIKTOK_SIDE_CROP / TIKTOK_W,
        },
        rail: {
            width: (TIKTOK_W - TIKTOK_RAIL_LEFT) / TIKTOK_W,
            top: TIKTOK_RAIL_TOP / TIKTOK_H,
            bottom: (TIKTOK_H - TIKTOK_RAIL_BOTTOM) / TIKTOK_H,
        },
        caption: { height: (TIKTOK_CAPTION_BOTTOM - TIKTOK_CAPTION_TOP) / (TIKTOK_H - TIKTOK_CAPTION_TOP) },
        limits: { maxDurationMs: 600000, captionChars: 4000 },
        measured: true,
        note: "Measured from a TikTok screenshot on a 6.3-inch iPhone: the phone scales the 1080-wide video by 1.2359 " +
            "and crops about 52 px per side.",
    },
    {
        id: "youtube-shorts",
        slug: "shorts",
        label: "YouTube Shorts",
        canvas: { width: SHORTS_W, height: SHORTS_H },
        chrome: {
            top: SHORTS_HEADER_BOTTOM / SHORTS_H,
            bottom: (SHORTS_H - SHORTS_CAPTION_TOP) / SHORTS_H,
            side: SHORTS_SIDE_CROP / SHORTS_W,
        },
        rail: {
            width: (SHORTS_W - SHORTS_RAIL_LEFT) / SHORTS_W,
            top: SHORTS_RAIL_TOP / SHORTS_H,
            bottom: (SHORTS_H - SHORTS_RAIL_BOTTOM) / SHORTS_H,
        },
        caption: { height: (SHORTS_CAPTION_BOTTOM - SHORTS_CAPTION_TOP) / (SHORTS_H - SHORTS_CAPTION_TOP) },
        limits: { maxDurationMs: 180000, captionChars: 5000, titleChars: 100 },
        measured: true,
        note: "Measured from a YouTube Shorts screenshot on a 6.3-inch iPhone: the phone scales the 1080-wide video by " +
            "1.2370 and crops about 52 px per side.",
    },
]);
/** Ids in step order. Plugs into `constraints.oneOf`; never mutate it (spread to extend). */
exports.SHORT_PLATFORM_IDS = exports.SHORT_PLATFORMS.map((p) => p.id);
/** `control.options` for a platform prop. Never mutate it (spread to extend). */
exports.SHORT_PLATFORM_OPTIONS = exports.SHORT_PLATFORMS.map((p) => ({
    value: p.id,
    label: p.label,
}));
exports.DEFAULT_SHORT_PLATFORM = "instagram-reel";
/** Id to slug ("instagram-reel" to "reels"). */
exports.PLATFORM_SLUG = Object.freeze({
    "instagram-reel": "reels",
    tiktok: "tiktok",
    "youtube-shorts": "shorts",
});
/** Id to limits (the same objects as the rows' `limits`). */
exports.PLATFORM_LIMITS = Object.freeze({
    "instagram-reel": platformById("instagram-reel").limits,
    tiktok: platformById("tiktok").limits,
    "youtube-shorts": platformById("youtube-shorts").limits,
});
function platformById(id) {
    return exports.SHORT_PLATFORMS.find((p) => p.id === id);
}
function isShortPlatformId(v) {
    return typeof v === "string" && exports.SHORT_PLATFORM_IDS.includes(v);
}
/**
 * A prop value to its row. Takes an id or a slug ("reels"); anything else
 * (unknown, empty, not a string) is the default platform. Never throws: a
 * render must land.
 */
function resolveShortPlatform(v) {
    if (typeof v === "string") {
        const hit = exports.SHORT_PLATFORMS.find((p) => p.id === v || p.slug === v);
        if (hit)
            return hit;
    }
    return platformById(exports.DEFAULT_SHORT_PLATFORM);
}
/** A canvas dimension as a whole number of px, at least 1 (NaN and junk read as 1). */
function dim(v) {
    const n = Math.round(Number(v));
    return Number.isFinite(n) && n >= 1 ? n : 1;
}
/** A fraction of `size` as whole px, clamped to [0, size]. */
function px(size, frac) {
    const f = Number.isFinite(frac) ? frac : 0;
    return Math.min(size, Math.max(0, Math.round(size * f)));
}
/**
 * The platform's safe area, rail and caption block at a concrete canvas, in
 * integer px. Every rect lies inside [0, W] x [0, H] with a width and height
 * of at least 1. `rail` / `captionBlock` appear only when the row defines them.
 */
function platformStage(platform, W, H) {
    const cw = dim(W);
    const ch = dim(H);
    const side = Math.min(px(cw, platform.chrome.side), Math.floor((cw - 1) / 2));
    const top = Math.min(px(ch, platform.chrome.top), ch - 1);
    const bottom = Math.min(px(ch, platform.chrome.bottom), ch - 1 - top);
    const safe = { x: side, y: top, w: Math.max(1, cw - 2 * side), h: Math.max(1, ch - top - bottom) };
    const stage = { safe };
    if (platform.rail) {
        const railW = Math.min(Math.max(1, px(cw, platform.rail.width)), cw);
        const railTop = Math.min(px(ch, platform.rail.top), ch - 1);
        const railBottom = Math.min(px(ch, platform.rail.bottom), ch - 1 - railTop);
        stage.rail = { x: cw - railW, y: railTop, w: railW, h: Math.max(1, ch - railTop - railBottom) };
    }
    if (platform.caption && bottom > 0) {
        const h = Math.min(bottom, Math.max(1, px(bottom, platform.caption.height)));
        const right = stage.rail ? Math.min(stage.rail.x, safe.x + safe.w) : safe.x + safe.w;
        stage.captionBlock = { x: safe.x, y: ch - bottom, w: Math.max(1, right - safe.x), h };
    }
    return stage;
}
