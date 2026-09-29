/**
 * Pure math and naming for `@rainier/reels/take-cutter/v1`.
 *
 * No ctx, no IO: everything here is unit-testable on its own. Parsing and
 * clamping the takes lives in `@m0saic/template-utils`
 * (`parseTimeRangesValue` / `normalizeTimeRanges`); this module owns what is
 * Take Cutter's own: how a take is named, how big its file is, and where a
 * vertical crop sits.
 *
 * The helpers `rangeStepName`, `sanitizeLabel`, `scaleToMaxWidth` and
 * `evenRound` follow `@m0saic/media/highlights/v1` (which a template repo
 * cannot import), with Take Cutter's naming: a file carries the take's place
 * in the SOURCE video, so a moment in a 44-minute rehearsal can be found again.
 */
/** `source` = as filmed; `vertical` = cut to 1080x1920 now. */
export type TakeFrame = "source" | "vertical";
/** The vertical deliverable: Reels, TikTok and Shorts all post 1080x1920. */
export declare const VERTICAL_SIZE: {
    readonly width: 1080;
    readonly height: 1920;
};
/** Longest name part a label keeps. The timestamps always follow it. */
export declare const LABEL_BASE_MAX = 48;
/** Used when neither the take, the prefix nor the video gives a usable name. */
export declare const FALLBACK_BASE = "take";
export type Size = {
    width: number;
    height: number;
};
/** Nearest even integer, at least 2 (yuv420p needs even dimensions). */
export declare function evenRound(v: number): number;
/**
 * The file size of an as-filmed take: the probed size, even-rounded, and
 * shrunk (aspect kept) when it would be wider than `maxWidth`. Never
 * upscales, and never goes over the cap: an odd cap rounds DOWN to even
 * (1279 gives 1278), and the height follows that width.
 */
export declare function scaleToMaxWidth(width: number, height: number, maxWidth?: number): Size;
/** A take's file size: the vertical deliverable, or the video's own (capped). */
export declare function takeSize(source: Size, frame: TakeFrame, maxWidth?: number): Size;
/**
 * Where a vertical crop sits. The crop runs along ONE axis: sideways when the
 * video is wider than 9:16 (`focusX`: 0 keeps the left edge, 1 the right),
 * up and down otherwise (`focusY`: 0 keeps the top). As filmed, nothing is
 * cropped, so there is no focus.
 */
export declare function coverFocus(source: Size, frame: TakeFrame, framing: number): {
    focusX?: number;
    focusY?: number;
};
/**
 * A place in the source video, file-name safe: `01m22s` under an hour,
 * `1h02m05s` from an hour on. Whole seconds, floored: the reading a player's
 * clock shows at that moment.
 */
export declare function fmtStamp(ms: number): string;
/**
 * File-name safe text: anything outside `A-Z a-z 0-9 . _ -` becomes `_`
 * (`--output-pattern "{{label}}"` does not sanitize), leading and trailing
 * separators go (a leading dot would hide the file), capped at `max`.
 * Returns "" when nothing survives.
 */
export declare function sanitizeLabel(label: string, max?: number): string;
/** The name part of a label: the first candidate that survives sanitizing. */
export declare function labelBase(candidates: ReadonlyArray<string | undefined>): string;
/** `<base>_<start>-<end>`: the timestamps are always there. */
export declare function takeLabel(base: string, startMs: number, endMs: number): string;
/**
 * Step name for take `index` (0-based): `take_01_<label>`. Positional across
 * ALL takes, invalid ones included, so a bad take never renumbers the rest,
 * and two takes with the same label still get different names.
 */
export declare function rangeStepName(index: number, label: string): string;
/** A name short enough for a card line: `max` characters, `...` when cut. */
export declare function shortName(name: string, max?: number): string;
