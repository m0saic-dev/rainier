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

import type { MosaicAssetManifest, MosaicColor, MosaicDocument, MosaicSource } from "@m0saic/types";
import { asAssetId } from "@m0saic/types";
import { validateM0String } from "@m0saic/dsl";
import {
  bindProp,
  fitSvgText,
  makeColorTile,
  placeInsetPieces,
  slugifyAssetKeyFromPath,
  svgLabel,
  tag,
} from "@m0saic/template-utils";

import { fmtStamp, labelBase, shortName, takeLabel } from "./plan";

export const CARD_BG: MosaicColor = "#15131C";
const TILE: MosaicColor = "#231F2E";
const TILE_EDGE: MosaicColor = "#9B8BFF";
const INK: MosaicColor = "#FFFFFF";
const MUTED: MosaicColor = "#B9B3C8";
const ACCENT: MosaicColor = "#B7A8FF";

/** Example times in the file-name caption (a take from 1:22 to 1:37). */
const EXAMPLE_START_MS = 82_000;
const EXAMPLE_END_MS = 97_000;

export type Rect = { x: number; y: number; w: number; h: number };

export type CardFrame = { W: number; H: number; fps: number; durationMs: number };

/** Every rect of the card, from the canvas alone (fractions of W and H). */
export function cardLayout(W: number, H: number) {
  const pad = Math.round(W * 0.08);
  const row = (y: number, h: number): Rect => ({ x: pad, y: Math.round(H * y), w: W - 2 * pad, h: Math.max(1, Math.round(H * h)) });
  const tile = row(0.19, 0.5);
  const inTile = (y: number, h: number): Rect => ({
    x: tile.x + Math.round(tile.w * 0.08),
    y: tile.y + Math.round(tile.h * y),
    w: tile.w - 2 * Math.round(tile.w * 0.08),
    h: Math.max(1, Math.round(tile.h * h)),
  });
  return {
    title: row(0.055, 0.065),
    subtitle: row(0.125, 0.045),
    tile,
    tileHead: inTile(0.37, 0.13),
    tileSub: inTile(0.51, 0.07),
    headline: row(0.72, 0.05),
    lines: [row(0.785, 0.035), row(0.822, 0.035), row(0.859, 0.035)],
    caption: row(0.915, 0.035),
  };
}

/** The largest rect of `aspectW:aspectH` inside `box`, centred (integer px). */
export function fitAspect(box: Rect, aspectW: number, aspectH: number): Rect {
  if (!(aspectW > 0) || !(aspectH > 0)) return { ...box };
  const scale = Math.min(box.w / aspectW, box.h / aspectH);
  const w = Math.max(2, Math.min(box.w, Math.round(aspectW * scale)));
  const h = Math.max(2, Math.min(box.h, Math.round(aspectH * scale)));
  return { x: box.x + Math.floor((box.w - w) / 2), y: box.y + Math.floor((box.h - h) / 2), w, h };
}

/** The caption: how a take's file will be named with the current prefix. */
export function fileNamesCaption(namePrefix: string, videoName?: string): string {
  const base = labelBase([namePrefix, videoName, "yourvideo"]);
  return `File names: ${takeLabel(base, EXAMPLE_START_MS, EXAMPLE_END_MS)}.mp4`;
}

type Piece = { rect: Rect; source: MosaicSource; importance: number };

const label = (text: string, r: Rect, color: MosaicColor, name: string, maxPx = Math.round(r.h * 0.7)): MosaicSource =>
  tag(svgLabel(text, r.w, r.h, { color, maxPx, maxLines: 1 }), name);

/** Lines set at ONE size: the largest every line fits at. */
function evenLines(texts: string[], rects: Rect[], color: MosaicColor, name: string): Piece[] {
  const px = Math.min(
    ...texts.map((t, i) => fitSvgText(t, rects[i].w, rects[i].h, { maxPx: Math.round(rects[i].h * 0.7), maxLines: 1 }).fontSize),
  );
  return texts.map((t, i) => ({ rect: rects[i], source: label(t, rects[i], color, `${name}-${i + 1}`, px), importance: 1 }));
}

function assemble(frame: CardFrame, pieces: Piece[], assets: MosaicAssetManifest): MosaicDocument {
  const placed = placeInsetPieces({
    rootW: frame.W,
    rootH: frame.H,
    pieces: pieces.map((p) => ({ rect: { ...p.rect, importance: p.importance }, source: p.source })),
  });
  const m0 = placed.m0;
  const v = validateM0String(String(m0));
  if (!v.ok) throw new Error(`take-cutter: card m0 is invalid (${JSON.stringify(v)})`);
  return {
    kind: "mosaic_document",
    version: 1,
    m0,
    fps: frame.fps,
    durationMs: frame.durationMs,
    size: { width: frame.W, height: frame.H },
    backgroundColor: CARD_BG,
    assets,
    sources: placed.sources,
    // A card is a guide, never a soundtrack.
    audio: { mode: "off" },
  };
}

/** No video yet: the big tile is where the video goes. */
export function buildOnboardingCard(frame: CardFrame, namePrefix: string): MosaicDocument {
  const L = cardLayout(frame.W, frame.H);
  const dropTile = bindProp(
    tag(
      makeColorTile(TILE, {
        effects: {
          rounding: { borderRadius: 0.08 },
          stroke: { width: 0.006, color: TILE_EDGE, alpha: 0.55 },
        },
      }),
      "card:drop-video",
    ),
    "source",
  );
  const pieces: Piece[] = [
    { rect: L.title, source: label("Take Cutter", L.title, INK, "card:title"), importance: 1 },
    { rect: L.subtitle, source: label("Cut the best takes out of a long recording", L.subtitle, MUTED, "card:subtitle"), importance: 1 },
    { rect: L.tile, source: dropTile, importance: 0 },
    { rect: L.tileHead, source: label("Drop your video here", L.tileHead, INK, "card:drop-hint"), importance: 1 },
    { rect: L.tileSub, source: label("or double-click here to choose a file", L.tileSub, MUTED, "card:drop-sub"), importance: 1 },
    { rect: L.headline, source: label("How it works", L.headline, ACCENT, "card:headline"), importance: 1 },
    ...evenLines(
      [
        "1. Drop a long video: a rehearsal, a live set",
        "2. Open Takes and mark each piece you want",
        "3. Make: every take is saved as its own file",
      ],
      L.lines,
      MUTED,
      "card:step",
    ),
    {
      rect: L.caption,
      source: bindProp(label(fileNamesCaption(namePrefix), L.caption, MUTED, "card:file-names"), "namePrefix"),
      importance: 1,
    },
  ];
  return assemble(frame, pieces, {} as MosaicAssetManifest);
}

export type MarkTakesArgs = {
  sourcePath: string;
  videoName: string;
  source: { width: number; height: number; durationMs: number };
  namePrefix: string;
};

/** A video, no takes: show the video and the one next step. */
export function buildMarkTakesCard(frame: CardFrame, args: MarkTakesArgs): MosaicDocument {
  const L = cardLayout(frame.W, frame.H);
  const assetId = asAssetId(slugifyAssetKeyFromPath(args.sourcePath));
  const video = bindProp(
    {
      type: "media",
      mediaType: "video",
      assetId,
      placement: { fit: "cover" },
      audio: { enabled: false },
      editor: { owner: "template", label: "card:video" },
    } as MosaicSource,
    "source",
  );
  const pieces: Piece[] = [
    { rect: L.title, source: label("Take Cutter", L.title, INK, "card:title"), importance: 1 },
    {
      rect: L.subtitle,
      source: label(`${shortName(args.videoName)}, ${fmtStamp(args.source.durationMs)} long`, L.subtitle, MUTED, "card:video-name"),
      importance: 1,
    },
    { rect: fitAspect(L.tile, args.source.width, args.source.height), source: video, importance: 0 },
    { rect: L.headline, source: label("Open Takes to mark your first take", L.headline, ACCENT, "card:headline"), importance: 1 },
    ...evenLines(
      [
        "Play the video and find a piece you like",
        "Mark where it starts and where it ends",
        "Every take you mark becomes its own file",
      ],
      L.lines,
      MUTED,
      "card:step",
    ),
    {
      rect: L.caption,
      source: bindProp(label(fileNamesCaption(args.namePrefix, args.videoName), L.caption, MUTED, "card:file-names"), "namePrefix"),
      importance: 1,
    },
  ];
  const assets = { [assetId]: { kind: "file", path: args.sourcePath, mediaType: "video" } } as MosaicAssetManifest;
  return assemble(frame, pieces, assets);
}
