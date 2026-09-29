import type { MosaicTimedCue } from "@m0saic/types";

import {
  DEFAULT_LINE_MS,
  MIN_LINE_MS,
  TAIL_MS,
  UNTIMED_CAP_MS,
  judgeLines,
  lineWindows,
  naturalDurationMs,
  paceOf,
} from "./timing";

const cue = (startMs?: number, endMs?: number): MosaicTimedCue => ({
  text: "line",
  ...(startMs !== undefined ? { startMs } : {}),
  ...(endMs !== undefined ? { endMs } : {}),
});
const starts = (ws: ReadonlyArray<{ startMs: number } | null>) => ws.map((w) => (w ? w.startMs : null));

describe("margins timing: the verdict over the whole recording", () => {
  it("names each line timed, untimed, outside the recording or out of order", () => {
    const lines = judgeLines([cue(1000), cue(), cue(5000), cue(4000), cue(50_000)], 30_000);
    expect(lines.map((l) => l.kind)).toEqual(["timed", "untimed", "inverted", "timed", "outside"]);
    // Only an end the studio stored is kept; inferred ends are the template's job.
    expect(lines[0]).toEqual({ kind: "timed", startMs: 1000 });
    expect(judgeLines([cue(5000, 6500)], 30_000)[0]).toEqual({ kind: "timed", startMs: 5000, endMs: 6500 });
  });

  it("judges against a day when the recording is not probed, so nothing is outside", () => {
    expect(judgeLines([cue(50_000), cue(200_000)]).map((l) => l.kind)).toEqual(["timed", "timed"]);
  });
});

describe("margins timing: untimed lines share the gaps (the triptych rule)", () => {
  it("spreads a page with nothing timed evenly over the clip", () => {
    const lines = judgeLines([cue(), cue(), cue(), cue(), cue()], 30_000);
    expect(lineWindows(lines, { audioStartMs: 0, durationMs: 10_000 })).toEqual([
      { startMs: 0, endMs: 2000 },
      { startMs: 2000, endMs: 4000 },
      { startMs: 4000, endMs: 6000 },
      { startMs: 6000, endMs: 8000 },
      { startMs: 8000, endMs: 10_000 },
    ]);
  });

  it("shares a gap between two timed lines, the one before keeping the first slot", () => {
    const lines = judgeLines([cue(1000), cue(), cue(), cue(4000)], 30_000);
    expect(starts(lineWindows(lines, { audioStartMs: 0, durationMs: 20_000 }))).toEqual([1000, 2000, 3000, 4000]);
  });

  it("shares the lead-in from the clip's start to the first timed line", () => {
    const lines = judgeLines([cue(), cue(), cue(6000)], 30_000);
    expect(starts(lineWindows(lines, { audioStartMs: 0, durationMs: 20_000 }))).toEqual([0, 3000, 6000]);
    // From Audio start, not from the top of the recording.
    expect(starts(lineWindows(lines, { audioStartMs: 2000, durationMs: 20_000 }))).toEqual([0, 2000, 4000]);
  });

  it("carries untimed lines after the last tap on at the page's pace", () => {
    const lines = judgeLines([cue(1000), cue(3000), cue(), cue()], 30_000);
    expect(paceOf(lines)).toBe(2000);
    expect(lineWindows(lines, { audioStartMs: 0, durationMs: 20_000 })).toEqual([
      { startMs: 1000, endMs: 3000 },
      { startMs: 3000, endMs: 5000 },
      { startMs: 5000, endMs: 7000 },
      { startMs: 7000, endMs: 9000 },
    ]);
    expect(paceOf(judgeLines([cue(1000)], 30_000))).toBe(DEFAULT_LINE_MS);
  });

  it("keeps an explicit end, stretches a too-short one to a readable beat, and skips inverted and outside lines", () => {
    const w = lineWindows(judgeLines([cue(1000, 1800), cue(2000, 2100), cue(3000), cue(3000)], 30_000), {
      audioStartMs: 0,
      durationMs: 20_000,
    });
    expect(w[0]).toEqual({ startMs: 1000, endMs: 1800 });
    expect(w[1]).toEqual({ startMs: 2000, endMs: 2000 + MIN_LINE_MS });
    // Two taps on one instant: the first is out of order (the next timed line starts no later) and gets no mark.
    expect(w[2]).toBeNull();
    expect(w[3]?.startMs).toBe(3000);
    const out = lineWindows(judgeLines([cue(1000), cue(40_000)], 30_000), { audioStartMs: 0, durationMs: 20_000 });
    expect(out[1]).toBeNull();
  });
});

describe("margins timing: Audio start moves every line onto the clip", () => {
  const lines = judgeLines([cue(1000), cue(5000), cue(9000), cue(13_000)], 60_000);

  it("shifts by Audio start, drops lines sung before it, clamps a straddler to 0", () => {
    expect(lineWindows(lines, { audioStartMs: 5000, durationMs: 20_000 })).toEqual([
      null,
      { startMs: 0, endMs: 4000 },
      { startMs: 4000, endMs: 8000 },
      { startMs: 8000, endMs: 12_000 },
    ]);
    expect(lineWindows(lines, { audioStartMs: 3000, durationMs: 20_000 })[0]).toEqual({ startMs: 0, endMs: 2000 });
  });

  it("drops lines past the clip's end and clamps the last one to it", () => {
    expect(lineWindows(lines, { audioStartMs: 0, durationMs: 7000 })).toEqual([
      { startMs: 1000, endMs: 5000 },
      { startMs: 5000, endMs: 7000 },
      null,
      null,
    ]);
  });

  it("reads float noise in the start as whole ms (30.05 s * 1000)", () => {
    const w = lineWindows(judgeLines([cue(31_050)], 60_000), { audioStartMs: 30.05 * 1000, durationMs: 10_000 });
    expect(w[0]?.startMs).toBe(1000);
  });
});

describe("margins timing: the clip's natural length", () => {
  it("is Length when set", () => {
    expect(naturalDurationMs(judgeLines([cue(1000)], 30_000), { audioStartMs: 0, recordingMs: 30_000, lengthMs: 12_500 })).toBe(12_500);
  });

  it("is the last marked line's end plus the tail, from Audio start, never past the recording", () => {
    const lines = judgeLines([cue(1000), cue(3000), cue(5000)], 60_000);
    // The last line ends one pace (2 s) after it starts: 7000, plus the tail.
    expect(naturalDurationMs(lines, { audioStartMs: 0, recordingMs: 60_000 })).toBe(7000 + TAIL_MS);
    expect(naturalDurationMs(lines, { audioStartMs: 2000, recordingMs: 60_000 })).toBe(5000 + TAIL_MS);
    expect(naturalDurationMs(lines, { audioStartMs: 0, recordingMs: 7500 })).toBe(7500);
  });

  it("with nothing timed is the rest of the recording, capped; with no recording it is the host's call", () => {
    const untimed = judgeLines([cue(), cue()], 200_000);
    expect(naturalDurationMs(untimed, { audioStartMs: 0, recordingMs: 200_000 })).toBe(UNTIMED_CAP_MS);
    expect(naturalDurationMs(untimed, { audioStartMs: 0, recordingMs: 25_000 })).toBe(25_000);
    expect(naturalDurationMs(untimed, { audioStartMs: 20_000, recordingMs: 25_000 })).toBe(5000);
    expect(naturalDurationMs(untimed, { audioStartMs: 0 })).toBeUndefined();
    // Timed lines and no recording: the taps still decide.
    expect(naturalDurationMs(judgeLines([cue(2000, 4000)]), { audioStartMs: 0 })).toBe(4000 + TAIL_MS);
  });
});
