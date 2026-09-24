import type { MosaicTimedCue } from "@m0saic/types";
import type { WordEntrance } from "./document";
import type { TextAlign } from "./typeset";
/**
 * `@rainier/reels/lyric-triptych/v1` — three stacked clips, your song, and
 * lyrics that land word by word as you sing them.
 *
 * ONE CONCEPT: a lyric page is two timings. The PAGE says when a block of
 * words takes the screen and when it clears; the WORDS say when each one
 * appears inside it. Both come from the Cue Timing Studio on the Lyrics
 * field: the tap pass stamps pages (Space as each page starts), the word
 * pass stamps words (hold Space per word). Nothing has to be timed for the
 * render to work: untimed pages spread over the song and untimed words
 * cascade in by length, and every tap replaces a guess.
 *
 * The rule that bites: every word is its own drawtext layer, so the template
 * must know exactly how wide each word renders. It measures with committed
 * Helvetica Neue metrics (tools/bake-font-metrics.mjs) — the font macOS
 * ships and drawtext draws. On a machine without Helvetica Neue the words
 * still show, but the spacing drifts.
 *
 * "Show Instagram UI" lays the Reels viewer chrome over the render (baked by
 * tools/bake-reels-ui.mjs) so you can see what the buttons and caption will
 * cover while you edit. It is baked INTO the video — turn it off to export.
 */
export type LyricTriptychProps = {
    song?: string;
    lyrics?: MosaicTimedCue[] | string;
    topClip?: string;
    middleClip?: string;
    bottomClip?: string;
    showReelsUi?: boolean;
    lyricsRow?: "top" | "middle" | "bottom";
    textAlign?: TextAlign;
    wordEntrance?: WordEntrance;
    textSize?: number;
    textColor?: string;
    glow?: number;
    glowColor?: string;
    borderPx?: number;
    borderColor?: string;
    outerBorder?: boolean;
    topTrimSec?: number;
    middleTrimSec?: number;
    bottomTrimSec?: number;
    topFraming?: number;
    middleFraming?: number;
    bottomFraming?: number;
};
export declare const MAX_PAGES = 300;
/** The baked Reels chrome, shipped beside this file (src/ and dist/ alike). */
export declare const REELS_UI_PNG: string;
/**
 * Placeholder lyrics: generic on purpose (this repo is public), and they
 * double as the instructions. One entry = one page.
 */
export declare const DEFAULT_LYRICS: MosaicTimedCue[];
export declare const LyricTriptychV1: import("@m0saic/types").MosaicTemplate<LyricTriptychProps, import("@m0saic/types").MosaicTemplateOutputs, import("@m0saic/types").MosaicTemplateUpstreamVariables, import("@m0saic/types").MosaicTemplateUpstreamData, import("@m0saic/types").MosaicTemplateSidecars>;
export default LyricTriptychV1;
