/**
 * One pipeline step per take.
 *
 * A valid take is a hermetic one-cell document (m0 `1`, its own asset
 * manifest) whose one source is the video cut with the engine's playback
 * primitive (`clipStartMs` + `clipDurationMs`, `loopMode: "cut"`). The media
 * source is BOUND to the `source` prop in every step, so in Make any take is
 * a drop target for a new video. Camera audio is kept (the source's own
 * track, in sync) unless `muteAudio`: then the source is disabled in the mix
 * AND the document says `audio.mode: "off"`, which is what actually strips
 * the track (a source-level mute alone ships a silent one).
 *
 * An invalid take becomes an error step IN PLACE, at the same size as its
 * siblings, so names stay positional and one bad take never sinks the batch.
 * Order is the artist's, never sorted.
 */

import type {
  MosaicAssetManifest,
  MosaicColor,
  MosaicDocument,
  MosaicOutputFormat,
  MosaicPipelineStep,
  MosaicSource,
  MosaicTimeRangeMs,
} from "@m0saic/types";
import { asAssetId } from "@m0saic/types";
import { toM0String } from "@m0saic/dsl-stdlib";
import {
  bindProp,
  makeErrorMosaic,
  normalizeTimeRanges,
  slugifyAssetKeyFromPath,
  solidBackground,
} from "@m0saic/template-utils";

import type { Size, TakeFrame } from "./plan";
import { coverFocus, labelBase, rangeStepName, takeLabel, takeSize } from "./plan";

/** Length of an error step (a take that could not be cut). */
export const ERROR_STEP_MS = 1000;

/** The prop every step's media cell is bound to. */
export const SOURCE_PROP = "source";

/** mp4 only: no format prop, so no extension-mismatch failure. */
export const TAKE_FORMAT: MosaicOutputFormat = { kind: "video", container: "mp4" };

const TITLE = "Take Cutter";
const LETTERBOX: MosaicColor = "#000000";

/** Resolved knobs a step needs (clamped once by the template). */
export type TakeKnobs = {
  frame: TakeFrame;
  /** 0..1 crop position on the cropped axis (vertical only). */
  framing: number;
  muteAudio: boolean;
  /** Downscale cap in px (as filmed only). */
  maxWidth?: number;
  /** Name part for takes without a name; "" = the video's name. */
  namePrefix: string;
};

export type TakeStepsArgs = {
  /** The video's path, exactly as the `source` prop holds it. */
  sourcePath: string;
  /** File-name safe name of the video (the last fallback for a label). */
  videoName: string;
  source: Size;
  sourceDurationMs: number;
  takes: MosaicTimeRangeMs[];
  knobs: TakeKnobs;
};

/** The label a take's file carries: its own name, else the prefix, else the video's name. */
export function labelFor(take: { label?: string }, knobs: TakeKnobs, videoName: string, startMs: number, endMs: number): string {
  return takeLabel(labelBase([take.label, knobs.namePrefix, videoName]), startMs, endMs);
}

export function buildTakeSteps(args: TakeStepsArgs): MosaicPipelineStep[] {
  const { sourcePath, videoName, knobs } = args;
  const verdicts = normalizeTimeRanges(args.takes, args.sourceDurationMs);
  const size = takeSize(args.source, knobs.frame, knobs.maxWidth);
  const focus = coverFocus(args.source, knobs.frame, knobs.framing);
  const assetKey = slugifyAssetKeyFromPath(sourcePath);

  return verdicts.map((verdict, i): MosaicPipelineStep => {
    if (!verdict.ok) {
      const label = labelFor(verdict.range, knobs, videoName, verdict.range.startMs, verdict.range.endMs);
      const file: MosaicDocument = {
        ...makeErrorMosaic(`Take ${i + 1} could not be cut: ${verdict.reason}. Open Takes and mark it again.`, {
          title: TITLE,
          width: size.width,
          height: size.height,
        }),
        format: { ...TAKE_FORMAT },
      };
      return { name: rangeStepName(i, label), label, durationMs: ERROR_STEP_MS, file };
    }

    const { startMs, endMs } = verdict;
    const label = labelFor(verdict, knobs, videoName, startMs, endMs);
    const assetId = asAssetId(assetKey);
    const media: MosaicSource = {
      type: "media",
      mediaType: "video",
      assetId,
      // As filmed, the cell has the video's own aspect (up to even-rounding),
      // so cover is an exact fit; vertical crops on one axis at the focus.
      placement: { fit: "cover", ...focus },
      playback: { clipStartMs: startMs, clipDurationMs: endMs - startMs, loopMode: "cut" },
      ...(knobs.muteAudio ? { audio: { enabled: false } } : {}),
      editor: { owner: "template", label: `take-${i + 1}` },
    };
    const file: MosaicDocument = {
      kind: "mosaic_document",
      version: 1,
      m0: toM0String("1", TITLE),
      assets: { [assetId]: { kind: "file", path: sourcePath, mediaType: "video" } } as MosaicAssetManifest,
      sources: [bindProp(media, SOURCE_PROP)],
      size: { ...size },
      backgroundColor: solidBackground(LETTERBOX),
      format: { ...TAKE_FORMAT },
      ...(knobs.muteAudio ? { audio: { mode: "off" as const } } : {}),
    };
    return { name: rangeStepName(i, label), label, durationMs: endMs - startMs, file };
  });
}
