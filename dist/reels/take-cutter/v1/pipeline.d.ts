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
import type { MosaicOutputFormat, MosaicPipelineStep, MosaicTimeRangeMs } from "@m0saic/types";
import type { Size, TakeFrame } from "./plan";
/** Length of an error step (a take that could not be cut). */
export declare const ERROR_STEP_MS = 1000;
/** The prop every step's media cell is bound to. */
export declare const SOURCE_PROP = "source";
/** mp4 only: no format prop, so no extension-mismatch failure. */
export declare const TAKE_FORMAT: MosaicOutputFormat;
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
export declare function labelFor(take: {
    label?: string;
}, knobs: TakeKnobs, videoName: string, startMs: number, endMs: number): string;
export declare function buildTakeSteps(args: TakeStepsArgs): MosaicPipelineStep[];
