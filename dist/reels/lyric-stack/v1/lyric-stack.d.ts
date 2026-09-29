import type { MosaicTemplateOutputHints, MosaicTimedCue } from "@m0saic/types";
import type { TextAlign } from "../../../_shared/glyph-text";
import type { ShortPlatformId } from "../../../_shared/platforms";
import type { LyricPosition, TakeLayout } from "../../../_shared/stage-layout";
import type { RevealMode, WordEntrance } from "./reveal";
/**
 * `@rainier/reels/lyric-stack/v1`: your takes stacked on screen, your song
 * under them, and your lyrics landing word by word in the font you pick.
 *
 * ONE CONCEPT: the LYRIC BANK. Lyrics are timed ONCE, against the whole song,
 * in the Cue Timing Studio (tap pass per page, word pass per word). Every clip
 * then says where in the song it begins (`songStartSec`); the template moves
 * the timings onto the clip and drops what the clip cannot show. Untimed
 * lyrics spread over the clip instead.
 *
 * WORDS ARE GLYPH OUTLINES from a real font file (a bundled face, or the
 * artist's own .ttf / .otf / .woff), one masked colour tile per word, so the
 * Make preview and the export draw the same thing and every word is its own
 * rect: drag it anywhere on the canvas, resize it to grow it (it stays
 * centred). Words live in nested page children (at most 19 per child) because
 * the engine drops masks past ~25 timed overlays on one node.
 *
 * WORD POSITIONS ARE PER CLIP. `wordBoxes` holds one box per word the clip
 * DRAWS, in reading order (slot 0 = the first word on screen in this clip,
 * whatever its place in the whole song). Make seeds a rect list densely from
 * element 0 and stops at the first element with no tile, so slots must run
 * 0..n-1 with no gap: bound by the word's global index, a clip starting
 * mid-song bound [4..15] and a drag wrote a one-element list. A list whose
 * length is not the clip's word count is ignored, with a design note (the
 * words on screen changed: the lyrics, Song start or the clip's length).
 *
 * Guides (the platform's UI, duration and font advisories) are drawn only in
 * Make's design preview (`ctx.mode === "design"`), never into an export, and
 * none of them covers the canvas: the guide is one tile per region of the
 * platform's chrome (9:16 canvases only), the advisory a strip at the top of
 * the safe area, both UNDER the lyrics; and each lyric container hugs its
 * words (document.ts, NOTHING FULL-FRAME TAKES THE POINTER).
 */
export type LyricStackProps = {
    song?: string;
    lyrics?: MosaicTimedCue[] | string;
    songStartSec?: number;
    takeCount?: string;
    take1?: string;
    take2?: string;
    take3?: string;
    take4?: string;
    font?: string;
    fontFile?: string;
    textSize?: number;
    textColor?: string;
    textAlign?: TextAlign;
    reveal?: RevealMode;
    wordEntrance?: WordEntrance;
    lyricsPosition?: LyricPosition;
    layout?: TakeLayout;
    wordBoxes?: unknown;
    glow?: number;
    glowColor?: string;
    borderPx?: number;
    borderColor?: string;
    platform?: ShortPlatformId;
    exportAll?: boolean;
    masterAudio?: boolean;
    showGuide?: boolean;
    take1TrimSec?: number;
    take2TrimSec?: number;
    take3TrimSec?: number;
    take4TrimSec?: number;
    take1Framing?: number;
    take2Framing?: number;
    take3Framing?: number;
    take4Framing?: number;
};
export declare const LYRIC_STACK_ID = "@rainier/reels/lyric-stack/v1";
/** The cue-track cap (pages). */
export declare const LYRIC_STACK_MAX_PAGES = 300;
/** Base type size as a fraction of canvas width (119 px on a 1080-wide Reel), times Text size. */
export declare const FONT_FRACTION_OF_W = 0.11;
/** `word` mode: a lone word grows to at most this multiple of the base size. */
export declare const SOLO_MAX_SCALE = 1.6;
/** Padding around every word tile, in ems of the base size. */
export declare const WORD_PAD_EM = 0.04;
/** The transparent PNG every page child carries as a corner tile under its words (src/ and dist/ alike). */
export declare const CLEAR_PNG: string;
/**
 * Placeholder lyrics: generic on purpose (this repo is public), and they
 * double as the instructions. One entry = one page.
 */
export declare const LYRIC_STACK_DEFAULT_LYRICS: MosaicTimedCue[];
/** Why the props that could carry a canvas handle have none (the 0.3.0 roll call). */
export declare const UNBOUND_REASONS: {
    readonly song: "audio; a rect would swallow drops";
    readonly songStartSec: "timing";
    readonly lyrics: "text and timing live in the studio; a canvas edit would strand the word timings";
    readonly fontFile: "a font is not a picture";
    readonly textSize: "size";
    readonly glow: "effect";
    readonly glowColor: "effect colour";
    readonly borderPx: "geometry";
    readonly take4: "drawn only when Takes = 4";
    readonly take4TrimSec: "drawn only when Takes = 4";
    readonly take4Framing: "drawn only when Takes = 4";
};
/** The platform knob as the render uses it: an id, else the default. */
export declare const platformOf: (value: unknown) => ShortPlatformId;
/** The takes on screen, 1..4 (a junk value reads as the default 3). */
export declare const takeCountOf: (value: unknown) => number;
/** Output hints the props decide: the canvas never moves; the container follows Master audio. */
export declare function resolveLyricStackHints(p: LyricStackProps): Partial<MosaicTemplateOutputHints>;
export declare const LyricStackV1: import("@m0saic/types").MosaicTemplate<LyricStackProps, import("@m0saic/types").MosaicTemplateOutputs, import("@m0saic/types").MosaicTemplateUpstreamVariables, import("@m0saic/types").MosaicTemplateUpstreamData, import("@m0saic/types").MosaicTemplateSidecars>;
export default LyricStackV1;
