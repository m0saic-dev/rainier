import type {
  MosaicDocument,
  MosaicDocumentPipeline,
  MosaicEngineContext,
  MosaicTimeRangeMs,
} from "@m0saic/types";
import { asAssetId, asTemplateId } from "@m0saic/types";
import {
  buildStepNames,
  defineMosaicTemplate,
  definePropsSchema,
  determineMediaType,
  makeErrorMosaic,
  parseTimeRangesValue,
} from "@m0saic/template-utils";

import { declareBindings } from "../../../_shared/bindings";
import { buildMarkTakesCard, buildOnboardingCard } from "./card";
import type { TakeKnobs } from "./pipeline";
import { buildTakeSteps } from "./pipeline";
import type { TakeFrame } from "./plan";
import { shortName } from "./plan";

/**
 * `@rainier/reels/take-cutter/v1` — cut the best takes out of a long
 * rehearsal recording, one file per take.
 *
 * ONE CONCEPT: a take is a range of the SOURCE video (`{ startMs, endMs,
 * label? }`), marked in the Clip-Range Studio on "Takes" (A-B marking over a
 * thumbnail strip, zoomable): the desktop answer to scrubbing a 44-minute file
 * on a phone. Every take becomes its own file through an `emit: "multi"`
 * pipeline, and every file is named with where it sits in the source
 * (`chorus_01m22s-01m37s`), so a moment can be found again.
 *
 * - Output as filmed by default (`frame: "source"`): each take keeps the
 *   video's own shape and size (even-rounded, optionally capped by
 *   `maxWidth`), because Lyric Stack does the framing later. `vertical` cuts
 *   to 1080x1920 now, cropping on one axis at `framing`.
 * - Camera sound is kept (to check a cut by ear) unless `muteAudio`.
 * - The pipeline's fps follows the probed video, so cuts are not resampled to
 *   the engine's default 30.
 * - ONE take still returns a one-step multi pipeline: the planner collapses it
 *   to a single render and the bare `-o` path is the file.
 * - mp4 only (no format prop), so an `-o` extension can never disagree.
 *
 * Before there is anything to cut the template draws a card instead (see
 * card.ts): no video = the onboarding card (its big tile is the drop target);
 * a video with no takes = "Open Takes to mark your first take" in Make's design
 * pass, and an error card in a real render.
 *
 * File names: the CLI names files with `--output-pattern "{{label}}.{{ext}}"`
 * (the step `label`); Mosaic Desktop names them from the label too, falling
 * back to the step `name` (`take_01_<label>`), which is positional and unique.
 */

export type TakeCutterProps = {
  source?: string;
  takes?: MosaicTimeRangeMs[] | string;
  frame?: TakeFrame;
  framing?: number;
  namePrefix?: string;
  muteAudio?: boolean;
  maxWidth?: number;
};

export const TAKE_CUTTER_ID = "@rainier/reels/take-cutter/v1";
/** Takes per video (the picker's cap too). */
export const TAKE_CUTTER_MAX_TAKES = 100;
const TITLE = "Take Cutter";

const DEFAULTS = {
  takes: [] as MosaicTimeRangeMs[],
  frame: "source" as TakeFrame,
  framing: 0.5,
  namePrefix: "",
  muteAudio: false,
} satisfies TakeCutterProps;

const propsSchema = definePropsSchema<TakeCutterProps>({
  source: {
    type: "media",
    required: false,
    description:
      "Your long recording: a rehearsal, a live set, a jam. Drop it on the big tile in the preview, or pick it here.",
    meta: {
      control: { picker: "file", accept: ["video"] },
      ui: { label: "Video", order: 1, primary: true },
    },
  },
  takes: {
    type: "json",
    required: false,
    description:
      "The pieces you want to keep. Open Takes to play the video and mark where each take starts and ends; " +
      "give a take a name if you like. Every take becomes its own file, named with where it sits in the video " +
      "(for example chorus_01m22s-01m37s).",
    meta: {
      constraints: {
        jsonSchema: {
          type: "array",
          maxItems: TAKE_CUTTER_MAX_TAKES,
          items: {
            type: "object",
            required: ["startMs", "endMs"],
            properties: {
              startMs: { type: "integer", minimum: 0 },
              endMs: { type: "integer", minimum: 1 },
              label: { type: "string" },
            },
          },
        },
      },
      control: { picker: "time-ranges", videoFromProp: "source" },
      ui: { label: "Takes", order: 2, primary: true },
    },
  },
  frame: {
    type: "string",
    required: false,
    description:
      "As filmed: every take keeps the video's own shape and size (Lyric Stack frames it later). " +
      "Vertical: cut every take to 1080x1920 now, ready to post as it is.",
    meta: {
      constraints: { oneOf: ["source", "vertical"] },
      control: {
        options: [
          { value: "source", label: "As filmed" },
          { value: "vertical", label: "Vertical 9:16" },
        ],
      },
      ui: { label: "Shape", order: 3, primary: true },
    },
  },
  framing: {
    type: "number",
    required: false,
    description:
      "Which part of the picture stays in view when a take is cut to vertical: 0 keeps the left (or the top), " +
      "0.5 the middle, 1 the right (or the bottom).",
    meta: {
      constraints: { min: 0, max: 1 },
      control: { flavor: "slider", step: 0.05 },
      ui: { label: "Framing", order: 4, visibleWhen: { prop: "frame", equals: "vertical" } },
    },
  },
  namePrefix: {
    type: "string",
    required: false,
    description:
      "The first part of each file name when a take has no name of its own. Leave it empty to use the video's " +
      "file name. The take's place in the video is always added (for example live_01m22s-01m37s).",
    meta: {
      control: { placeholder: "the video's name" },
      ui: { label: "File name", order: 5 },
    },
  },
  muteAudio: {
    type: "boolean",
    required: false,
    description:
      "Camera sound is kept so you can check a cut by ear. Turn this on for silent takes (Lyric Stack mutes takes anyway).",
    meta: { ui: { label: "Remove camera sound", order: 6 } },
  },
  maxWidth: {
    type: "number",
    required: false,
    description:
      "For very big videos (4K): shrink every take to at most this many pixels wide. Never makes a take bigger. " +
      "Empty = the video's own size.",
    meta: {
      constraints: { min: 128, max: 3840 },
      control: { placeholder: "the video's own width", step: 2 },
      ui: { label: "Max width (px)", order: 7, visibleWhen: { prop: "frame", equals: "source" } },
    },
  },
});

const num = (value: unknown, fallback: number, min: number, max: number): number =>
  typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;

/** Clamp the props into the knobs every step shares. Never throws. */
export function resolveTakeCutterKnobs(props: TakeCutterProps): TakeKnobs {
  return {
    frame: props.frame === "vertical" ? "vertical" : "source",
    framing: num(props.framing, DEFAULTS.framing, 0, 1),
    muteAudio: props.muteAudio === true,
    namePrefix: typeof props.namePrefix === "string" ? props.namePrefix : "",
    ...(typeof props.maxWidth === "number" && Number.isFinite(props.maxWidth)
      ? { maxWidth: Math.round(num(props.maxWidth, 3840, 128, 3840)) }
      : {}),
  };
}

const mediaPath = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;

/** An absent or blank takes value is "no takes yet", not a parse error. */
const takesValue = (value: unknown): unknown =>
  value === undefined || value === null || (typeof value === "string" && value.trim() === "") ? [] : value;

export const TakeCutterV1 = defineMosaicTemplate<TakeCutterProps>({
  id: asTemplateId(TAKE_CUTTER_ID),
  label: "03 · Take Cutter",
  version: 1,
  description:
    "Drop a long rehearsal video, mark the takes you want, and get every take as its own file, named with where it sits in the video. As filmed, or cut to vertical 1080x1920.",
  capabilities: { tier: "core" },
  tags: ["reels", "clips", "takes", "cut", "musicians", "creators", "rehearsal", "video", "multi-output"],

  outputHints: {
    width: 1080,
    height: 1920,
    fps: 30,
    durationMs: 20_000,
    format: { kind: "video", container: "mp4" },
    note: "One mp4 per take, as long as the take, at the video's own size (or 1080x1920 when Shape is vertical).",
  },

  propsSchema,
  defaultProps: { ...DEFAULTS, takes: [] },
  ...declareBindings({ takes: "timing", framing: "geometry", maxWidth: "geometry" }),

  async render(rawProps: TakeCutterProps, ctx: MosaicEngineContext): Promise<MosaicDocument | MosaicDocumentPipeline> {
    const props: TakeCutterProps = { ...DEFAULTS, ...(rawProps ?? {}) };
    const { width: W, height: H, fps, durationMs } = ctx.target;
    const canvas = { W, H, fps, durationMs };
    const fail = (message: string) => makeErrorMosaic(message, { width: W, height: H, title: TITLE });
    const knobs = resolveTakeCutterKnobs(props);

    const raw = typeof props.source === "string" ? props.source : undefined;
    const sourcePath = mediaPath(raw);
    if (!sourcePath) return buildOnboardingCard(canvas, knobs.namePrefix);

    const videoName = buildStepNames([sourcePath])[0];
    const shown = shortName(videoName);
    const meta = ctx.media?.[asAssetId(raw as string)] ?? ctx.media?.[asAssetId(sourcePath)];
    if (!meta) {
      return fail(
        determineMediaType(sourcePath, ctx) === "image"
          ? `"${shown}" is a photo. Take Cutter cuts takes out of a video: drop an mp4 or a mov.`
          : `Could not read "${shown}". Drop a video file (an mp4 or a mov).`,
      );
    }
    if (meta.kind !== "video" || !(meta.width > 0) || !(meta.height > 0)) {
      return fail(`"${shown}" is not a video (it reads as ${meta.kind}). Take Cutter needs a video: an mp4 or a mov.`);
    }
    if (!(typeof meta.durationMs === "number" && meta.durationMs > 0)) {
      return fail(`Could not tell how long "${shown}" is. Try saving it again as an mp4.`);
    }

    const parsed = parseTimeRangesValue(takesValue(props.takes));
    if (!parsed.ok) return fail(`The takes could not be read (${parsed.error}). Open Takes and mark them again.`);
    if (parsed.ranges.length > TAKE_CUTTER_MAX_TAKES) {
      return fail(`Too many takes (${parsed.ranges.length}). The limit is ${TAKE_CUTTER_MAX_TAKES} per video.`);
    }
    if (parsed.ranges.length === 0) {
      if (ctx.mode === "design") {
        return buildMarkTakesCard(canvas, {
          sourcePath,
          videoName,
          source: { width: meta.width, height: meta.height, durationMs: meta.durationMs },
          namePrefix: knobs.namePrefix,
        });
      }
      return fail("No takes marked yet. Open Takes, mark where each take starts and ends, then Make again.");
    }

    const steps = buildTakeSteps({
      sourcePath,
      videoName,
      source: { width: meta.width, height: meta.height },
      sourceDurationMs: meta.durationMs,
      takes: parsed.ranges,
      knobs,
    });
    const sourceFps = typeof meta.fps === "number" && meta.fps > 0 ? Math.max(1, Math.round(meta.fps)) : undefined;
    return {
      kind: "mosaic_pipeline",
      version: 1,
      emit: "multi",
      ...(sourceFps !== undefined ? { fps: sourceFps } : {}),
      steps,
    };
  },
});

export default TakeCutterV1;
