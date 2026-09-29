/**
 * The two cards Take Cutter shows before there is anything to cut.
 *
 * - ONBOARDING (no video yet, any mode): a big tile that IS the drop target
 *   for the video (bound to `source`: drop a file on it, or double-click it
 *   to pick one; a single click only selects it), three plain steps, and a
 *   caption bound to `namePrefix` that shows how the files will be named.
 * - MARK TAKES (a video, no takes yet, Make's design pass only): the video
 *   itself in the big tile (still bound to `source`, so a drop replaces it)
 *   and "Open Takes to mark your first take". A real render with no takes is
 *   an error card instead: there is nothing to write.
 *
 * Both are one flat document: the canvas is `document.backgroundColor`, every
 * piece is placed on its exact rect with `placeInsetPieces`, and text is
 * svg-rasterized with the bundled font (ASCII only), pre-fitted to its box.
 * Unbound text sits ON TOP of the tile; Make looks through unbound tiles, so
 * a drop still lands on the tile beneath.
 */
import type { MosaicColor, MosaicDocument } from "@m0saic/types";
export declare const CARD_BG: MosaicColor;
export type Rect = {
    x: number;
    y: number;
    w: number;
    h: number;
};
export type CardFrame = {
    W: number;
    H: number;
    fps: number;
    durationMs: number;
};
/** Every rect of the card, from the canvas alone (fractions of W and H). */
export declare function cardLayout(W: number, H: number): {
    title: Rect;
    subtitle: Rect;
    tile: Rect;
    tileHead: Rect;
    tileSub: Rect;
    headline: Rect;
    lines: Rect[];
    caption: Rect;
};
/** The largest rect of `aspectW:aspectH` inside `box`, centred (integer px). */
export declare function fitAspect(box: Rect, aspectW: number, aspectH: number): Rect;
/** The caption: how a take's file will be named with the current prefix. */
export declare function fileNamesCaption(namePrefix: string, videoName?: string): string;
/** No video yet: the big tile is where the video goes. */
export declare function buildOnboardingCard(frame: CardFrame, namePrefix: string): MosaicDocument;
export type MarkTakesArgs = {
    sourcePath: string;
    videoName: string;
    source: {
        width: number;
        height: number;
        durationMs: number;
    };
    namePrefix: string;
};
/** A video, no takes: show the video and the one next step. */
export declare function buildMarkTakesCard(frame: CardFrame, args: MarkTakesArgs): MosaicDocument;
