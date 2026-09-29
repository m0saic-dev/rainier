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
/** The prop value. */
export type ShortPlatformId = "instagram-reel" | "tiktok" | "youtube-shorts";
/** The file / step name. */
export type ShortPlatformSlug = "reels" | "tiktok" | "shorts";
/** An integer-px rectangle in canvas space (the same shape `stage-layout.ts` uses). */
export type Rect = {
    x: number;
    y: number;
    w: number;
    h: number;
};
/** What the app draws over the video: `top` / `bottom` of H, `side` of W (each side). */
export type PlatformChrome = {
    readonly top: number;
    readonly bottom: number;
    readonly side: number;
};
/** The action column: `width` of W from the right edge; `top` / `bottom` of H from each edge. */
export type PlatformRail = {
    readonly width: number;
    readonly top: number;
    readonly bottom: number;
};
/** The caption block: the top `height` (fraction) of the bottom chrome band. */
export type PlatformCaption = {
    readonly height: number;
};
export type PlatformLimits = {
    /** The longest clip the feed accepts, ms. */
    readonly maxDurationMs: number;
    /** Caption / description length, characters. */
    readonly captionChars: number;
    /** Title length, characters, where the platform has a separate title (Shorts). */
    readonly titleChars?: number;
};
export type ShortPlatform = {
    readonly id: ShortPlatformId;
    readonly slug: ShortPlatformSlug;
    /** Option label in the props panel. */
    readonly label: string;
    /** The canvas the platform wants, px. */
    readonly canvas: {
        readonly width: number;
        readonly height: number;
    };
    readonly chrome: PlatformChrome;
    /** Absent = no action rail. */
    readonly rail?: PlatformRail;
    /** Absent = no caption block. */
    readonly caption?: PlatformCaption;
    readonly limits: PlatformLimits;
    /** true = measured from screenshots; false = an estimate awaiting measurement. */
    readonly measured: boolean;
    /** Where the numbers come from. */
    readonly note: string;
};
/** A platform's stage at a concrete canvas, integer px. */
export type PlatformStage = {
    /** Inside the chrome: text belongs here. */
    safe: Rect;
    /** The action column, from `x` to the right edge. Absent = no rail. */
    rail?: Rect;
    /** The caption's place in the bottom band, left of the rail. Absent = no caption block. */
    captionBlock?: Rect;
};
/** The three platforms, in step order (reels, tiktok, shorts). Deep-frozen: never mutate a row. */
export declare const SHORT_PLATFORMS: readonly ShortPlatform[];
/** Ids in step order. Plugs into `constraints.oneOf`; never mutate it (spread to extend). */
export declare const SHORT_PLATFORM_IDS: ShortPlatformId[];
/** `control.options` for a platform prop. Never mutate it (spread to extend). */
export declare const SHORT_PLATFORM_OPTIONS: {
    value: ShortPlatformId;
    label: string;
}[];
export declare const DEFAULT_SHORT_PLATFORM: ShortPlatformId;
/** Id to slug ("instagram-reel" to "reels"). */
export declare const PLATFORM_SLUG: Readonly<Record<ShortPlatformId, ShortPlatformSlug>>;
/** Id to limits (the same objects as the rows' `limits`). */
export declare const PLATFORM_LIMITS: Readonly<Record<ShortPlatformId, PlatformLimits>>;
export declare function isShortPlatformId(v: unknown): v is ShortPlatformId;
/**
 * A prop value to its row. Takes an id or a slug ("reels"); anything else
 * (unknown, empty, not a string) is the default platform. Never throws: a
 * render must land.
 */
export declare function resolveShortPlatform(v: unknown): ShortPlatform;
/**
 * The platform's safe area, rail and caption block at a concrete canvas, in
 * integer px. Every rect lies inside [0, W] x [0, H] with a width and height
 * of at least 1. `rail` / `captionBlock` appear only when the row defines them.
 */
export declare function platformStage(platform: ShortPlatform, W: number, H: number): PlatformStage;
