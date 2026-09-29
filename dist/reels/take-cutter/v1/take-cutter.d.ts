import type { MosaicTimeRangeMs } from "@m0saic/types";
import type { TakeKnobs } from "./pipeline";
import type { TakeFrame } from "./plan";
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
export declare const TAKE_CUTTER_ID = "@rainier/reels/take-cutter/v1";
/** Takes per video (the picker's cap too). */
export declare const TAKE_CUTTER_MAX_TAKES = 100;
/** Clamp the props into the knobs every step shares. Never throws. */
export declare function resolveTakeCutterKnobs(props: TakeCutterProps): TakeKnobs;
export declare const TakeCutterV1: import("@m0saic/types").MosaicTemplate<TakeCutterProps, import("@m0saic/types").MosaicTemplateOutputs, import("@m0saic/types").MosaicTemplateUpstreamVariables, import("@m0saic/types").MosaicTemplateUpstreamData, import("@m0saic/types").MosaicTemplateSidecars>;
export default TakeCutterV1;
