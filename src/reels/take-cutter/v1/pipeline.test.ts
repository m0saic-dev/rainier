import type { MosaicDocument, MosaicMediaSource, MosaicTimeRangeMs } from "@m0saic/types";
import { isFriendlySlug } from "@m0saic/types";
import { validateM0String } from "@m0saic/dsl";
import { resolvePropBindings } from "@m0saic/template-utils";

import type { TakeKnobs } from "./pipeline";
import { ERROR_STEP_MS, SOURCE_PROP, buildTakeSteps } from "./pipeline";

const VIDEO = "/media/rehearsal.mov";
const KNOBS: TakeKnobs = { frame: "source", framing: 0.5, muteAudio: false, namePrefix: "" };

const build = (over: { takes?: MosaicTimeRangeMs[]; knobs?: Partial<TakeKnobs>; source?: { width: number; height: number } } = {}) =>
  buildTakeSteps({
    sourcePath: VIDEO,
    videoName: "rehearsal",
    source: over.source ?? { width: 1920, height: 1080 },
    sourceDurationMs: 2_700_000,
    takes: over.takes ?? [
      { startMs: 82_000, endMs: 97_000 },
      { startMs: 600_000, endMs: 620_500, label: "chorus 2" },
    ],
    knobs: { ...KNOBS, ...(over.knobs ?? {}) },
  });

const doc = (step: { file?: unknown }) => step.file as MosaicDocument;
const media = (step: { file?: unknown }) => doc(step).sources[0] as MosaicMediaSource;

describe("buildTakeSteps", () => {
  it("builds one step per take: cut, named with source timestamps, as filmed", () => {
    const steps = build();
    expect(steps.map((s) => s.label)).toEqual(["rehearsal_01m22s-01m37s", "chorus_2_10m00s-10m20s"]);
    expect(steps.map((s) => s.name)).toEqual(["take_01_rehearsal_01m22s-01m37s", "take_02_chorus_2_10m00s-10m20s"]);
    expect(steps.map((s) => s.durationMs)).toEqual([15_000, 20_500]);
    const d = doc(steps[0]);
    expect(validateM0String(String(d.m0)).ok).toBe(true);
    expect(d.size).toEqual({ width: 1920, height: 1080 });
    expect(d.format).toEqual({ kind: "video", container: "mp4" });
    expect(d.audio).toBeUndefined(); // camera sound kept
    expect(media(steps[0])).toMatchObject({
      type: "media",
      mediaType: "video",
      placement: { fit: "cover" },
      playback: { clipStartMs: 82_000, clipDurationMs: 15_000, loopMode: "cut" },
    });
    expect(media(steps[0]).placement).toEqual({ fit: "cover" });
    expect(Object.values(d.assets)).toEqual([{ kind: "file", path: VIDEO, mediaType: "video" }]);
  });

  it("gives every name the engine's filename-safe slug shape", () => {
    const steps = build({ takes: [{ startMs: 0, endMs: 1000, label: "  weird/name: ok? " }] });
    for (const s of steps) {
      expect(isFriendlySlug(s.name)).toBe(true);
      expect(isFriendlySlug(s.label)).toBe(true);
    }
  });

  it("binds every step's media cell to the source prop", () => {
    const steps = build({ knobs: { frame: "vertical" } });
    for (const s of steps) {
      expect(media(s).editor?.binding).toEqual({ propKey: SOURCE_PROP });
      const d = doc(s);
      const { byProp, rejected } = resolvePropBindings(d, d.size!.width, d.size!.height);
      expect(rejected).toEqual([]);
      expect(Object.keys(byProp)).toEqual([SOURCE_PROP]);
    }
  });

  it("three takes with the middle one inverted give three steps, the second an error in place", () => {
    const steps = build({
      takes: [
        { startMs: 1000, endMs: 5000 },
        { startMs: 9000, endMs: 7000 },
        { startMs: 12_000, endMs: 15_000 },
      ],
    });
    expect(steps).toHaveLength(3);
    expect(steps.map((s) => s.name)).toEqual([
      "take_01_rehearsal_00m01s-00m05s",
      "take_02_rehearsal_00m09s-00m07s",
      "take_03_rehearsal_00m12s-00m15s",
    ]);
    expect(steps[1].durationMs).toBe(ERROR_STEP_MS);
    const err = doc(steps[1]);
    expect(err.sources[0].engine?.renderStatus).toBe("error");
    // The error card comes out at the batch's size, as an mp4 like its siblings.
    expect(err.size).toEqual({ width: 1920, height: 1080 });
    expect(err.format).toEqual({ kind: "video", container: "mp4" });
    expect([steps[0], steps[2]].map((s) => doc(s).sources[0].engine?.renderStatus)).toEqual([undefined, undefined]);
  });

  it("keeps names unique when two takes share a label", () => {
    const steps = build({
      takes: [
        { startMs: 1000, endMs: 5000, label: "verse" },
        { startMs: 1000, endMs: 5000, label: "verse" },
      ],
    });
    expect(steps[0].label).toBe(steps[1].label);
    expect(new Set(steps.map((s) => s.name)).size).toBe(2);
  });

  it("uses the prefix for unnamed takes, and a take's own name over it", () => {
    const steps = build({ knobs: { namePrefix: "live set" } });
    expect(steps.map((s) => s.label)).toEqual(["live_set_01m22s-01m37s", "chorus_2_10m00s-10m20s"]);
  });

  it("vertical: 1080x1920, cropped at the framing on the wide axis", () => {
    const wide = build({ knobs: { frame: "vertical", framing: 0.25, maxWidth: 640 } });
    expect(doc(wide[0]).size).toEqual({ width: 1080, height: 1920 });
    expect(media(wide[0]).placement).toEqual({ fit: "cover", focusX: 0.25 });
    const tall = build({ knobs: { frame: "vertical", framing: 0.25 }, source: { width: 1080, height: 2400 } });
    expect(media(tall[0]).placement).toEqual({ fit: "cover", focusY: 0.25 });
  });

  it("as filmed with a width cap: shrinks, aspect kept", () => {
    const steps = build({ knobs: { maxWidth: 1280 }, source: { width: 3840, height: 2160 } });
    expect(doc(steps[0]).size).toEqual({ width: 1280, height: 720 });
  });

  it("muteAudio strips the track at both levels", () => {
    const steps = build({ knobs: { muteAudio: true } });
    expect(media(steps[0]).audio).toEqual({ enabled: false });
    expect(doc(steps[0]).audio).toEqual({ mode: "off" });
  });

  it("clamps a take past the end of the video, and keeps the artist's order", () => {
    const steps = build({
      takes: [
        { startMs: 2_690_000, endMs: 2_900_000 },
        { startMs: 1000, endMs: 2000 },
      ],
    });
    expect(steps[0].durationMs).toBe(10_000);
    expect(steps.map((s) => media(s).playback?.clipStartMs)).toEqual([2_690_000, 1000]);
  });

  it("shares no objects between steps", () => {
    const [a, b] = build();
    expect(doc(a)).not.toBe(doc(b));
    expect(doc(a).size).not.toBe(doc(b).size);
    expect(doc(a).sources).not.toBe(doc(b).sources);
  });
});
