"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.FALLBACK_BASE = exports.LABEL_BASE_MAX = exports.VERTICAL_SIZE = void 0;
exports.evenRound = evenRound;
exports.scaleToMaxWidth = scaleToMaxWidth;
exports.takeSize = takeSize;
exports.coverFocus = coverFocus;
exports.fmtStamp = fmtStamp;
exports.sanitizeLabel = sanitizeLabel;
exports.labelBase = labelBase;
exports.takeLabel = takeLabel;
exports.rangeStepName = rangeStepName;
exports.shortName = shortName;
/** The vertical deliverable: Reels, TikTok and Shorts all post 1080x1920. */
exports.VERTICAL_SIZE = { width: 1080, height: 1920 };
/** Longest name part a label keeps. The timestamps always follow it. */
exports.LABEL_BASE_MAX = 48;
/** Used when neither the take, the prefix nor the video gives a usable name. */
exports.FALLBACK_BASE = "take";
/** Nearest even integer, at least 2 (yuv420p needs even dimensions). */
function evenRound(v) {
    return Math.max(2, Math.round(v / 2) * 2);
}
/**
 * The file size of an as-filmed take: the probed size, even-rounded, and
 * shrunk (aspect kept) when it would be wider than `maxWidth`. Never
 * upscales, and never goes over the cap: an odd cap rounds DOWN to even
 * (1279 gives 1278), and the height follows that width.
 */
function scaleToMaxWidth(width, height, maxWidth) {
    if (maxWidth !== undefined && maxWidth > 0) {
        const cap = Math.max(2, Math.floor(maxWidth / 2) * 2);
        if (width > cap)
            return { width: cap, height: evenRound((height * cap) / width) };
    }
    return { width: evenRound(width), height: evenRound(height) };
}
/** A take's file size: the vertical deliverable, or the video's own (capped). */
function takeSize(source, frame, maxWidth) {
    return frame === "vertical" ? { ...exports.VERTICAL_SIZE } : scaleToMaxWidth(source.width, source.height, maxWidth);
}
/**
 * Where a vertical crop sits. The crop runs along ONE axis: sideways when the
 * video is wider than 9:16 (`focusX`: 0 keeps the left edge, 1 the right),
 * up and down otherwise (`focusY`: 0 keeps the top). As filmed, nothing is
 * cropped, so there is no focus.
 */
function coverFocus(source, frame, framing) {
    if (frame !== "vertical")
        return {};
    const f = Number.isFinite(framing) ? Math.min(1, Math.max(0, framing)) : 0.5;
    const widerThanVertical = source.width * exports.VERTICAL_SIZE.height > source.height * exports.VERTICAL_SIZE.width;
    return widerThanVertical ? { focusX: f } : { focusY: f };
}
/**
 * A place in the source video, file-name safe: `01m22s` under an hour,
 * `1h02m05s` from an hour on. Whole seconds, floored: the reading a player's
 * clock shows at that moment.
 */
function fmtStamp(ms) {
    const total = Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 1000)) : 0;
    const h = Math.floor(total / 3600);
    const m = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
    const s = String(total % 60).padStart(2, "0");
    return h > 0 ? `${h}h${m}m${s}s` : `${m}m${s}s`;
}
/**
 * File-name safe text: anything outside `A-Z a-z 0-9 . _ -` becomes `_`
 * (`--output-pattern "{{label}}"` does not sanitize), leading and trailing
 * separators go (a leading dot would hide the file), capped at `max`.
 * Returns "" when nothing survives.
 */
function sanitizeLabel(label, max = 64) {
    const trim = (s) => s.replace(/^[._-]+/, "").replace(/[._-]+$/, "");
    return trim(trim(label.replace(/[^A-Za-z0-9._-]+/g, "_")).slice(0, Math.max(0, max)));
}
/** The name part of a label: the first candidate that survives sanitizing. */
function labelBase(candidates) {
    for (const c of candidates) {
        const s = typeof c === "string" ? sanitizeLabel(c, exports.LABEL_BASE_MAX) : "";
        if (s)
            return s;
    }
    return exports.FALLBACK_BASE;
}
/** `<base>_<start>-<end>`: the timestamps are always there. */
function takeLabel(base, startMs, endMs) {
    return `${base}_${fmtStamp(startMs)}-${fmtStamp(endMs)}`;
}
/**
 * Step name for take `index` (0-based): `take_01_<label>`. Positional across
 * ALL takes, invalid ones included, so a bad take never renumbers the rest,
 * and two takes with the same label still get different names.
 */
function rangeStepName(index, label) {
    return `take_${String(index + 1).padStart(2, "0")}_${label}`;
}
/** A name short enough for a card line: `max` characters, `...` when cut. */
function shortName(name, max = 32) {
    return name.length <= max ? name : `${name.slice(0, Math.max(1, max - 3))}...`;
}
