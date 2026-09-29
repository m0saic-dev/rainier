import type { MosaicTimedCue } from "@m0saic/types";
import type { PageTone } from "./document";
import type { Box, MarkStyle, PageFit } from "./marks";
/**
 * `@rainier/explore/margins/v1` — the artist's own lyric page (a notebook
 * photo, a Notes screenshot), each line marked as it is sung: a highlighter
 * stroke, a wavy underline, or a hand-drawn box. THE TEMPLATE WRITES NO
 * TEXT: the words are the artist's handwriting; the template only marks them
 * in time.
 *
 * ONE CONCEPT: a line is a box and a tap. The box comes from `lineBoxes` (a
 * regions list: one rect per line, dragged over the page in Make), the tap
 * from `lines` (a cue track timed against the whole recording in the Cue
 * Timing Studio). Each mark is ONE colour tile with an inline mask whose
 * bounds are the box size, so a resized box redraws its stroke.
 *
 * - Timing (timing.ts): `resolveCueWindows` over the probed recording, then
 *   `windowMs` by Audio start. Untimed lines share the gaps between timed
 *   ones evenly (the Lyric Triptych rule); with nothing timed they spread
 *   over the clip. `past: keep` holds every mark to the clip's end.
 * - Boxes (marks.ts): a `lineBoxes` list whose length matches the lines is
 *   used, rescaled from the canvas Make drew it on; any other list is
 *   ignored and the default bands apply (evenly spaced over the page).
 * - Make: with "Place boxes" on, the design pass shows every mark at once
 *   (no windows) so each box can be dragged onto its line. The export always
 *   follows the timing.
 * - No page yet: ruled paper (a masked tile bound to `page`, so a file
 *   dropped anywhere on it becomes the page) and a squiggle stand-in for the
 *   handwriting. Squiggles, never letters.
 */
export type MarginsProps = {
    page?: string;
    audio?: string;
    lines?: MosaicTimedCue[] | string;
    audioStartSec?: number;
    lineBoxes?: unknown;
    style?: MarkStyle;
    markColor?: string;
    pageTone?: PageTone;
    past?: MarginsPast;
    pageFit?: MarginsPageFit;
    paperColor?: string;
    lengthSec?: number;
    placing?: boolean;
};
export type MarginsPast = "keep" | "clear";
export type MarginsPageFit = "whole" | "fill";
export declare const MARGINS_ID = "@rainier/explore/margins/v1";
export declare const PAGE_TONES: readonly PageTone[];
export declare const PAST_MODES: readonly MarginsPast[];
export declare const PAGE_FITS: readonly MarginsPageFit[];
/** Five untimed placeholder lines: the defaults show marks landing one by one. */
export declare const DEFAULT_LINES: readonly MosaicTimedCue[];
export type MarginsKnobs = {
    style: MarkStyle;
    pageTone: PageTone;
    past: MarginsPast;
    fit: PageFit;
    audioStartSec: number;
    lengthSec: number;
    placing: boolean;
};
/** Clamp the knobs into range. Never throws: an unknown value takes the default. */
export declare function resolveMarginsKnobs(props: MarginsProps): MarginsKnobs;
/**
 * One box per line, canvas px. A `lineBoxes` list with exactly `count`
 * rects is used (rescaled from the canvas it was drawn on); any other list,
 * or none, gives the default bands over `content`. A single rect that does
 * not resolve (degenerate, off-canvas) falls back to its own default band.
 */
export declare function resolveLineBoxes(value: unknown, count: number, canvas: {
    W: number;
    H: number;
}, content: Box): {
    boxes: Box[];
    custom: boolean;
};
export declare const MarginsV1: import("@m0saic/types").MosaicTemplate<MarginsProps, import("@m0saic/types").MosaicTemplateOutputs, import("@m0saic/types").MosaicTemplateUpstreamVariables, import("@m0saic/types").MosaicTemplateUpstreamData, import("@m0saic/types").MosaicTemplateSidecars>;
export default MarginsV1;
