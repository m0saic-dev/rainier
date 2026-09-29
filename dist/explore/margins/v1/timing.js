"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NO_RECORDING_HORIZON_MS = exports.MIN_LINE_MS = exports.MAX_PACE_MS = exports.MIN_PACE_MS = exports.DEFAULT_LINE_MS = exports.UNTIMED_CAP_MS = exports.TAIL_MS = exports.MAX_LINES = void 0;
exports.judgeLines = judgeLines;
exports.paceOf = paceOf;
exports.songWindows = songWindows;
exports.naturalDurationMs = naturalDurationMs;
exports.lineWindows = lineWindows;
const template_utils_1 = require("@m0saic/template-utils");
const song_window_1 = require("../../../_shared/song-window");
/**
 * When each line of the page is marked. Pure, no ctx.
 *
 * The artist taps each line in the Cue Timing Studio against the WHOLE
 * recording (a voice memo or the master). A clip may begin later in that
 * recording (`audioStartSec`), so the times go through three steps:
 *
 *   1. `judgeLines`: `resolveCueWindows` over the probed recording says which
 *      lines are timed, untimed, outside the recording, or out of order
 *      (`inverted`). Outside and inverted lines never get a mark.
 *   2. `songWindows`: untimed lines get a guess, the Lyric Triptych's rule.
 *      A run of untimed lines between two timed ones shares that gap evenly
 *      (the timed line before it keeps the first slot); a run before the
 *      first timed line shares the stretch from the clip's start to it. After
 *      the LAST timed line there is no gap to share, so each untimed line
 *      there gets the page's pace (the average time per line between the
 *      first and last timed lines; 3 s with one timed line). A line ends at
 *      its explicit end, else where the next shown line starts, else one pace
 *      after it starts; never shorter than {@link MIN_LINE_MS}.
 *   3. `lineWindows`: every window moves onto the clip's own timeline
 *      (`windowMs`, from `_shared/song-window`); a line ending at or before 0
 *      (sung before the clip) or starting at or after the clip's end is
 *      dropped, and a straddler is clamped.
 *
 * With NOTHING timed, the recording's times mean nothing yet: every untimed
 * line shares the clip evenly (line i shows at i/N of it).
 *
 * The clip's natural length (`naturalDurationMs`): `lengthSec` when set;
 * otherwise from the audio start to the end of the last shown line plus
 * {@link TAIL_MS}, never past the end of the recording; with nothing timed,
 * the rest of the recording capped at {@link UNTIMED_CAP_MS}; with no
 * recording, `undefined` (the host's hint decides, 10 s).
 */
/** Lines per page (the studio caps a paste at this too). */
exports.MAX_LINES = 16;
/** The clip runs this long after the last line ends. */
exports.TAIL_MS = 1500;
/** Nothing timed yet: at most this much of the recording. */
exports.UNTIMED_CAP_MS = 60000;
/** A line's guessed length when the page has no pace to go by. */
exports.DEFAULT_LINE_MS = 3000;
exports.MIN_PACE_MS = 1000;
exports.MAX_PACE_MS = 10000;
/** Shortest window a line gets (two taps on the same instant still read). */
exports.MIN_LINE_MS = 400;
/** `resolveCueWindows` needs an end; with no recording probed, a day stands in. */
exports.NO_RECORDING_HORIZON_MS = 86400000;
/** Step 1: the per-line verdict over the whole recording (`recordingMs` absent = not probed). */
function judgeLines(cues, recordingMs) {
    const horizon = typeof recordingMs === "number" && Number.isFinite(recordingMs) && recordingMs > 0
        ? Math.round(recordingMs)
        : exports.NO_RECORDING_HORIZON_MS;
    return (0, template_utils_1.resolveCueWindows)([...cues], { durationMs: horizon }).map((v, i) => {
        if (!v.ok)
            return { kind: v.reason };
        return typeof cues[i].endMs === "number"
            ? { kind: "timed", startMs: v.startMs, endMs: v.endMs }
            : { kind: "timed", startMs: v.startMs };
    });
}
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
/** Average time per line between the first and the last timed line (index distance counts every line). */
function paceOf(lines) {
    const timed = lines
        .map((l, i) => (l.kind === "timed" ? { i, s: l.startMs } : null))
        .filter((t) => t !== null);
    if (timed.length < 2)
        return exports.DEFAULT_LINE_MS;
    const first = timed[0];
    const last = timed[timed.length - 1];
    if (last.i <= first.i || last.s <= first.s)
        return exports.DEFAULT_LINE_MS;
    return clamp((last.s - first.s) / (last.i - first.i), exports.MIN_PACE_MS, exports.MAX_PACE_MS);
}
/**
 * Step 2: song-timeline windows, one per line (`null` = the line never
 * shows: outside, inverted). Returns `null` when no line is timed at all
 * (the caller spreads the lines over the clip instead).
 */
function songWindows(lines, audioStartMs) {
    const anchors = lines.map((l, i) => (l.kind === "timed" ? i : -1)).filter((i) => i >= 0);
    if (anchors.length === 0)
        return null;
    const pace = paceOf(lines);
    const startOfAnchor = (i) => lines[i].startMs;
    const starts = lines.map((l) => (l.kind === "timed" ? l.startMs : undefined));
    const untimedBetween = (from, to) => {
        const out = [];
        for (let i = from; i < to; i++)
            if (lines[i].kind === "untimed")
                out.push(i);
        return out;
    };
    // Before the first timed line: share [clip start, first) evenly.
    const first = anchors[0];
    const lead = untimedBetween(0, first);
    const lower = Math.min((0, song_window_1.songStartOf)(audioStartMs), startOfAnchor(first));
    lead.forEach((idx, k) => {
        starts[idx] = lower + (k * (startOfAnchor(first) - lower)) / lead.length;
    });
    // Between timed lines: share the gap, the timed line before keeping the first slot.
    for (let a = 0; a + 1 < anchors.length; a++) {
        const run = untimedBetween(anchors[a] + 1, anchors[a + 1]);
        const sa = startOfAnchor(anchors[a]);
        const span = Math.max(0, startOfAnchor(anchors[a + 1]) - sa);
        run.forEach((idx, k) => {
            starts[idx] = sa + ((k + 1) * span) / (run.length + 1);
        });
    }
    // After the last timed line: one pace each, from where it ends.
    const last = anchors[anchors.length - 1];
    const lastLine = lines[last];
    const lastEnd = typeof lastLine.endMs === "number" ? lastLine.endMs : lastLine.startMs + pace;
    untimedBetween(last + 1, lines.length).forEach((idx, k) => {
        starts[idx] = lastEnd + k * pace;
    });
    // Ends: explicit, else the next shown line's start, else one pace.
    const shown = starts.map((s, i) => (s === undefined ? -1 : i)).filter((i) => i >= 0);
    const out = lines.map(() => null);
    shown.forEach((idx, k) => {
        var _a;
        const s = starts[idx];
        const line = lines[idx];
        const explicit = line.kind === "timed" && typeof line.endMs === "number" ? line.endMs : undefined;
        const next = k + 1 < shown.length ? starts[shown[k + 1]] : undefined;
        const e = (_a = explicit !== null && explicit !== void 0 ? explicit : next) !== null && _a !== void 0 ? _a : s + pace;
        out[idx] = { startMs: s, endMs: Math.max(e, s + exports.MIN_LINE_MS) };
    });
    return out;
}
/**
 * The clip's natural length, ms (see the module note), or `undefined` when
 * only the host's hint can say (no length asked, no recording).
 */
function naturalDurationMs(lines, opts) {
    if (typeof opts.lengthMs === "number" && Number.isFinite(opts.lengthMs) && opts.lengthMs > 0) {
        return Math.round(opts.lengthMs);
    }
    const start = (0, song_window_1.songStartOf)(opts.audioStartMs);
    const remainder = typeof opts.recordingMs === "number" && Number.isFinite(opts.recordingMs) && opts.recordingMs > start
        ? Math.round(opts.recordingMs - start)
        : undefined;
    const song = songWindows(lines, start);
    if (song) {
        const ends = song.filter((w) => w !== null).map((w) => (0, song_window_1.windowMs)(w.endMs, start));
        const lastEnd = ends.length > 0 ? Math.max(...ends) : 0;
        if (lastEnd > 0) {
            const d = lastEnd + exports.TAIL_MS;
            return Math.round(remainder !== undefined ? Math.min(d, remainder) : d);
        }
    }
    return remainder !== undefined ? Math.min(remainder, exports.UNTIMED_CAP_MS) : undefined;
}
/**
 * Step 3: every line's window on the clip's timeline, `[0, durationMs]`,
 * whole ms (`null` = no mark: dropped by the window, outside, inverted).
 */
function lineWindows(lines, opts) {
    const D = Math.max(1, Math.round(opts.durationMs));
    const start = (0, song_window_1.songStartOf)(opts.audioStartMs);
    const song = songWindows(lines, start);
    if (!song) {
        const untimed = lines.map((l, i) => (l.kind === "untimed" ? i : -1)).filter((i) => i >= 0);
        const out = lines.map(() => null);
        untimed.forEach((idx, k) => {
            out[idx] = {
                startMs: Math.round((k * D) / untimed.length),
                endMs: Math.round(((k + 1) * D) / untimed.length),
            };
        });
        return out;
    }
    return song.map((w) => {
        if (!w)
            return null;
        const s = (0, song_window_1.windowMs)(w.startMs, start);
        const e = (0, song_window_1.windowMs)(w.endMs, start);
        if (e <= 0 || s >= D)
            return null;
        const startMs = Math.max(0, Math.round(s));
        const endMs = Math.min(D, Math.round(e));
        return endMs > startMs ? { startMs, endMs } : null;
    });
}
