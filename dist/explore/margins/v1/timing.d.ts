import type { MosaicTimedCue } from "@m0saic/types";
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
export declare const MAX_LINES = 16;
/** The clip runs this long after the last line ends. */
export declare const TAIL_MS = 1500;
/** Nothing timed yet: at most this much of the recording. */
export declare const UNTIMED_CAP_MS = 60000;
/** A line's guessed length when the page has no pace to go by. */
export declare const DEFAULT_LINE_MS = 3000;
export declare const MIN_PACE_MS = 1000;
export declare const MAX_PACE_MS = 10000;
/** Shortest window a line gets (two taps on the same instant still read). */
export declare const MIN_LINE_MS = 400;
/** `resolveCueWindows` needs an end; with no recording probed, a day stands in. */
export declare const NO_RECORDING_HORIZON_MS = 86400000;
/** One line judged against the recording (song timeline, ms). `endMs` only when the studio stored an end. */
export type SongLine = {
    kind: "timed";
    startMs: number;
    endMs?: number;
} | {
    kind: "untimed";
} | {
    kind: "outside";
} | {
    kind: "inverted";
};
/** A line's window, ms, on whichever timeline the function names. */
export type LineWindow = {
    startMs: number;
    endMs: number;
};
/** Step 1: the per-line verdict over the whole recording (`recordingMs` absent = not probed). */
export declare function judgeLines(cues: readonly MosaicTimedCue[], recordingMs?: number): SongLine[];
/** Average time per line between the first and the last timed line (index distance counts every line). */
export declare function paceOf(lines: readonly SongLine[]): number;
/**
 * Step 2: song-timeline windows, one per line (`null` = the line never
 * shows: outside, inverted). Returns `null` when no line is timed at all
 * (the caller spreads the lines over the clip instead).
 */
export declare function songWindows(lines: readonly SongLine[], audioStartMs: number): Array<LineWindow | null> | null;
/**
 * The clip's natural length, ms (see the module note), or `undefined` when
 * only the host's hint can say (no length asked, no recording).
 */
export declare function naturalDurationMs(lines: readonly SongLine[], opts: {
    audioStartMs: number;
    recordingMs?: number;
    lengthMs?: number;
}): number | undefined;
/**
 * Step 3: every line's window on the clip's timeline, `[0, durationMs]`,
 * whole ms (`null` = no mark: dropped by the window, outside, inverted).
 */
export declare function lineWindows(lines: readonly SongLine[], opts: {
    audioStartMs: number;
    durationMs: number;
}): Array<LineWindow | null>;
