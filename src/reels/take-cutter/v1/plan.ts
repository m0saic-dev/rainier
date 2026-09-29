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
export const VERTICAL_SIZE = { width: 1080, height: 1920 } as const;

/** Longest name part a label keeps. The timestamps always follow it. */
export const LABEL_BASE_MAX = 48;

/** Used when neither the take, the prefix nor the video gives a usable name. */
export const FALLBACK_BASE = "take";

export type Size = { width: number; height: number };

/** Nearest even integer, at least 2 (yuv420p needs even dimensions). */
export function evenRound(v: number): number {
  return Math.max(2, Math.round(v / 2) * 2);
}

/**
 * The file size of an as-filmed take: the probed size, even-rounded, and
 * shrunk (aspect kept) when it would be wider than `maxWidth`. Never
 * upscales, and never goes over the cap: an odd cap rounds DOWN to even
 * (1279 gives 1278), and the height follows that width.
 */
export function scaleToMaxWidth(width: number, height: number, maxWidth?: number): Size {
  if (maxWidth !== undefined && maxWidth > 0) {
    const cap = Math.max(2, Math.floor(maxWidth / 2) * 2);
    if (width > cap) return { width: cap, height: evenRound((height * cap) / width) };
  }
  return { width: evenRound(width), height: evenRound(height) };
}

/** A take's file size: the vertical deliverable, or the video's own (capped). */
export function takeSize(source: Size, frame: TakeFrame, maxWidth?: number): Size {
  return frame === "vertical" ? { ...VERTICAL_SIZE } : scaleToMaxWidth(source.width, source.height, maxWidth);
}

/**
 * Where a vertical crop sits. The crop runs along ONE axis: sideways when the
 * video is wider than 9:16 (`focusX`: 0 keeps the left edge, 1 the right),
 * up and down otherwise (`focusY`: 0 keeps the top). As filmed, nothing is
 * cropped, so there is no focus.
 */
export function coverFocus(source: Size, frame: TakeFrame, framing: number): { focusX?: number; focusY?: number } {
  if (frame !== "vertical") return {};
  const f = Number.isFinite(framing) ? Math.min(1, Math.max(0, framing)) : 0.5;
  const widerThanVertical = source.width * VERTICAL_SIZE.height > source.height * VERTICAL_SIZE.width;
  return widerThanVertical ? { focusX: f } : { focusY: f };
}

/**
 * A place in the source video, file-name safe: `01m22s` under an hour,
 * `1h02m05s` from an hour on. Whole seconds, floored: the reading a player's
 * clock shows at that moment.
 */
export function fmtStamp(ms: number): string {
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
export function sanitizeLabel(label: string, max = 64): string {
  const trim = (s: string) => s.replace(/^[._-]+/, "").replace(/[._-]+$/, "");
  return trim(trim(label.replace(/[^A-Za-z0-9._-]+/g, "_")).slice(0, Math.max(0, max)));
}

/** The name part of a label: the first candidate that survives sanitizing. */
export function labelBase(candidates: ReadonlyArray<string | undefined>): string {
  for (const c of candidates) {
    const s = typeof c === "string" ? sanitizeLabel(c, LABEL_BASE_MAX) : "";
    if (s) return s;
  }
  return FALLBACK_BASE;
}

/** `<base>_<start>-<end>`: the timestamps are always there. */
export function takeLabel(base: string, startMs: number, endMs: number): string {
  return `${base}_${fmtStamp(startMs)}-${fmtStamp(endMs)}`;
}

/**
 * Step name for take `index` (0-based): `take_01_<label>`. Positional across
 * ALL takes, invalid ones included, so a bad take never renumbers the rest,
 * and two takes with the same label still get different names.
 */
export function rangeStepName(index: number, label: string): string {
  return `take_${String(index + 1).padStart(2, "0")}_${label}`;
}

/** A name short enough for a card line: `max` characters, `...` when cut. */
export function shortName(name: string, max = 32): string {
  return name.length <= max ? name : `${name.slice(0, Math.max(1, max - 3))}...`;
}
