"use strict";
/**
 * Song window: map lyric pages timed against the WHOLE song onto one clip.
 * Pure, no ctx.
 *
 * The lyric bank: an artist times their lyrics once, in the Cue Timing Studio,
 * against the whole master. Each clip then says where in the song it begins
 * (`songStartMs`, from the `songStartSec` prop) and how long it runs
 * (`durationMs`). `windowPages` moves every time onto the clip's own timeline
 * and keeps only what the clip can show:
 *
 *   - every time shifts by `-songStartMs`;
 *   - a page ending at or before 0 (sung before the clip) is dropped, and so
 *     is a page starting at or after `durationMs` (sung after it);
 *   - a page straddling an edge is clamped: a start below 0 becomes 0, a word
 *     that landed before 0 shows from 0, an end past the clip becomes
 *     `durationMs`;
 *   - order is kept, the input is never touched, and every page and word in
 *     the result is a new object (other fields, e.g. `text`, `timed`,
 *     `lineBreakBefore`, ride along unchanged).
 *
 * UNTIMED LYRICS ARE THE CALLER'S JOB. The page resolver spreads untimed pages
 * over whatever length it is given. Resolved against the whole song and then
 * windowed, lyrics nobody has timed yet would spread over the song and the
 * clip would show only a slice of them. So a caller whose cue track has NO
 * timed page resolves its pages against the clip's own duration and skips
 * this function (`songStartMs` means nothing without timings); only when at
 * least one page is timed does it resolve against the whole song (length from
 * the song's probed duration) and window the result here.
 *
 * `_shared` is frozen once shipped: a change is a copy beside a new template
 * version, never an edit here.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.songStartOf = songStartOf;
exports.windowMs = windowMs;
exports.windowPages = windowPages;
/**
 * The song start as the window uses it: a whole, non-negative ms. The round
 * matters: `songStartSec * 1000` carries float noise (30.05 * 1000 =
 * 30049.999…).
 */
function songStartOf(songStartMs) {
    const s = Math.round(Number(songStartMs));
    return Number.isFinite(s) && s > 0 ? s : 0;
}
/**
 * One song-timeline time on the clip's timeline: `ms - songStartMs` (with the
 * start read by {@link songStartOf}). Not clamped: a negative result means
 * "before the clip begins".
 */
function windowMs(ms, songStartMs) {
    return ms - songStartOf(songStartMs);
}
/**
 * Pages timed against the whole song, moved onto the clip's timeline and
 * trimmed to it. See the module note for the rules. In every page returned,
 * `0 <= startMs`, `endMs <= durationMs`, and each word's `atMs` lies within
 * `[startMs, endMs]` (a word that would land after the clip ends keeps its
 * place in the page, so the page typesets exactly as it does in the full
 * song, with `atMs === endMs`: it never shows).
 */
function windowPages(pages, window) {
    const start = songStartOf(window.songStartMs);
    const dur = Number.isNaN(window.durationMs) ? Infinity : window.durationMs;
    const out = [];
    for (const page of pages) {
        const s = page.startMs - start;
        const e = page.endMs - start;
        if (e <= 0 || s >= dur)
            continue;
        const startMs = Math.max(0, s);
        const endMs = Math.min(dur, e);
        const words = page.words.map((w) => ({
            ...w,
            atMs: Math.min(endMs, Math.max(startMs, w.atMs - start)),
        }));
        out.push({ ...page, startMs, endMs, words });
    }
    return out;
}
