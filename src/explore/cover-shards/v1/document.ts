import type {
  MosaicAssetManifest,
  MosaicColor,
  MosaicDocument,
  MosaicMediaKind,
  MosaicSource,
} from "@m0saic/types";
import { asAssetId } from "@m0saic/types";
import { validateM0String } from "@m0saic/dsl";
import {
  bindProp,
  bindProps,
  makeColorTile,
  placeInsetPieces,
  slugifyAssetKeyFromPath,
  svgLabel,
  tag,
  uniqueAssetKey,
} from "@m0saic/template-utils";

import { fitWordToBox, normalizeForFont, wordTile } from "../../../_shared/glyph-text";
import { audioPolicy } from "../../../_shared/platform-emit";
import { shardOverlay, textOverlay } from "./motion";
import type { Rect, RevealTiming, ShardMotion, ShardOrder } from "./plan";
import { TEXT_RAMP_SEC, landingOrder, shardGrid, sourceRects, stageLayout, scaledGap } from "./plan";

/**
 * Cover Shards, the document:
 *
 *   root W x H, backgroundColor = pageColor (no base rect)
 *     shard tiles    n*n <= 16, each bound to `cover` (a drop target, empty or not)
 *                    cover probed: the cover image, placement.sourceRect = its cell of
 *                                  the centred square crop, fit cover
 *                    no cover:     a placeholder colour tile (four colours)
 *     [scrim]        square canvases: a translucent band under the text
 *     headline       glyph tile (colour + inline mask), bound to headline + textColor
 *     subline        the same, smaller; empty = a transparent tile of its box, still bound
 *     [note]         design mode only: the empty-state hint or why the cover did not load
 *     [song]         an audio-only leaf, never bound
 *
 * Every piece is placed on its exact rect with `placeInsetPieces`. Paint
 * order: a moving shard is drawn over the neighbour it travels across (rise
 * and float stack rows top over bottom, slide stacks columns left over
 * right), so at most n shard layers, never one layer per shard.
 */

/** The per-node source ceiling this template stays under (16 shards + scrim + 2 lines + song). */
export const MAX_ROOT_SOURCES = 20;

/** Placeholder shards when there is no cover yet: four colours, `(row + col) % 4`. */
export const PLACEHOLDER_PALETTE: readonly MosaicColor[] = Object.freeze([
  "#FF6B5B",
  "#FFC857",
  "#2EC4B6",
  "#8C9EFF",
] as MosaicColor[]);

/** Ink of the design-only note: dark, over the bright placeholder shards. */
const NOTE_INK = "#0E0E10" as MosaicColor;
/** How much of the page colour the scrim keeps (square canvases). */
const SCRIM_ALPHA = 0.72;

export type CoverImage = { path: string; width: number; height: number };
export type SongLeaf = { path: string; mediaType: MosaicMediaKind; clipStartMs: number };

export type CoverShardsDocArgs = {
  W: number;
  H: number;
  fps: number;
  durationMs: number;
  n: number;
  order: ShardOrder;
  motion: ShardMotion;
  seed: number;
  gapPx: number;
  timing: RevealTiming;
  headline: string;
  subline: string;
  fontPath: string;
  textColor: MosaicColor;
  pageColor: MosaicColor;
  /** A probed image; absent = placeholder shards. */
  cover?: CoverImage;
  song?: SongLeaf;
  /** Design-only text over the square (the caller gates it on ctx.mode). */
  note?: string;
};

type Piece = { rect: Rect & { importance: number }; source: MosaicSource };

/** Layers, bottom to top. Shards take 1..n. */
const Z_SCRIM = 10;
const Z_TEXT = 11;
const Z_NOTE = 12;
const Z_SONG = 13;

function shardImportance(motion: ShardMotion, n: number, row: number, col: number): number {
  if (motion === "rise" || motion === "float") return 1 + (n - 1 - row);
  if (motion === "slide") return 1 + (n - 1 - col);
  return 1;
}

/** Keep a rect inside the canvas (a glyph extent may round a pixel past its box). */
function clampRect(r: Rect, W: number, H: number): Rect {
  const x = Math.min(Math.max(0, r.x), W - 1);
  const y = Math.min(Math.max(0, r.y), H - 1);
  return { x, y, w: Math.max(1, Math.min(r.w, W - x)), h: Math.max(1, Math.min(r.h, H - y)) };
}

export function buildCoverShardsDocument(a: CoverShardsDocArgs): MosaicDocument {
  const { W, H, n } = a;
  const assets: Record<string, { kind: "file"; path: string; mediaType: MosaicMediaKind }> = {};
  // One key per file. The slug drops the extension, so "release.png" (the
  // cover) and "release.wav" (the song) would share a key: the second gets
  // "_2" instead of overwriting the first.
  const assetFor = (path: string, mediaType: MosaicMediaKind) => {
    const same = Object.keys(assets).find((k) => assets[k].path === path && assets[k].mediaType === mediaType);
    if (same !== undefined) return asAssetId(same);
    const id = uniqueAssetKey(slugifyAssetKeyFromPath(path), assets as MosaicAssetManifest);
    assets[id] = { kind: "file", path, mediaType };
    return id;
  };

  const layout = stageLayout(W, H);
  const grid = shardGrid(layout.squareBox, n, scaledGap(a.gapPx, W, H));
  const crops = a.cover ? sourceRects(a.cover.width, a.cover.height, n) : null;
  const coverId = a.cover && crops ? assetFor(a.cover.path, "image") : undefined;
  const order = landingOrder(n, a.order, a.seed);
  const pieces: Piece[] = [];

  // ── shards, in landing order ────────────────────────────────────────────
  order.forEach((cellIndex, j) => {
    const row = Math.floor(cellIndex / n);
    const col = cellIndex % n;
    const overlay = shardOverlay(a.motion, a.timing.rampStart[j], a.timing.rampDur[j]);
    const label = `shard-${cellIndex + 1}`;
    const art: MosaicSource =
      coverId && crops
        ? ({
            type: "media",
            mediaType: "image",
            assetId: coverId,
            placement: { fit: "cover", sourceRect: { ...crops[cellIndex] } },
            overlay,
          } as MosaicSource)
        : (makeColorTile(PLACEHOLDER_PALETTE[(row + col) % PLACEHOLDER_PALETTE.length], { overlay }) as MosaicSource);
    pieces.push({
      rect: { ...grid.rects[cellIndex], importance: shardImportance(a.motion, n, row, col) },
      source: bindProp(tag(art, label), "cover"),
    });
  });

  // ── the scrim (square canvases) ─────────────────────────────────────────
  if (layout.scrim) {
    const scrim = makeColorTile(`${a.pageColor}@${SCRIM_ALPHA}` as MosaicColor, {
      overlay: textOverlay(a.timing.headlineAt, TEXT_RAMP_SEC, false),
    }) as MosaicSource;
    pieces.push({ rect: { ...layout.scrim, importance: Z_SCRIM }, source: tag(scrim, "scrim") });
  }

  // ── headline and subline ────────────────────────────────────────────────
  const textPiece = (text: string, box: Rect, propKey: string, at: number): Piece => {
    const bindings = [{ propKey }, { propKey: "textColor" }];
    const drawn = normalizeForFont(text.trim(), a.fontPath).text.trim();
    if (drawn === "") {
      // Nothing to draw: a transparent tile of the same box keeps the line reachable (double-click to add).
      const empty = makeColorTile(`${a.textColor}@0` as MosaicColor) as MosaicSource;
      return { rect: { ...box, importance: Z_TEXT }, source: bindProps(tag(empty, propKey), bindings) };
    }
    const fit = fitWordToBox(drawn, box, a.fontPath, { align: "center" });
    const tile = wordTile(drawn, fit.x, fit.baseline, fit.fontPx, a.fontPath);
    const rect = clampRect(tile.rect, W, H);
    const src = makeColorTile(a.textColor, {
      mask: { kind: "inline-mask", localPath: tile.d, bounds: { x: 0, y: 0, width: rect.w, height: rect.h } },
      overlay: textOverlay(at, TEXT_RAMP_SEC),
    }) as MosaicSource;
    return { rect: { ...rect, importance: Z_TEXT }, source: bindProps(tag(src, propKey), bindings) };
  };
  pieces.push(textPiece(a.headline, layout.headline, "headline", a.timing.headlineAt));
  pieces.push(textPiece(a.subline, layout.subline, "subline", a.timing.sublineAt));

  // ── design-only note, centred on the square ─────────────────────────────
  // Sits over the shards, unbound: Make looks through unbound tiles, so a
  // drop still lands on the shard beneath. Dropped (never the art) when the
  // node is full.
  const extras = (a.song ? 1 : 0) + (a.note ? 1 : 0);
  if (a.note && pieces.length + extras <= MAX_ROOT_SOURCES) {
    const S = grid.square.w;
    const w = Math.max(1, Math.round(S * 0.84));
    const h = Math.max(1, Math.round(S * 0.16));
    const box: Rect = { x: grid.square.x + Math.floor((S - w) / 2), y: grid.square.y + Math.floor((S - h) / 2), w, h };
    const note = svgLabel(a.note, box.w, box.h, { color: NOTE_INK, maxPx: Math.max(8, Math.round(h * 0.34)), maxLines: 2 });
    pieces.push({ rect: { ...box, importance: Z_NOTE }, source: tag(note, "design-note") });
  }

  // ── the song: an audio-only leaf on the root, never bound ───────────────
  if (a.song) {
    const leaf = {
      type: "media",
      // MANDATORY even for real audio files: an mp3 with cover art probes as
      // video; declaring "audio" makes the engine take only its sound.
      mediaType: "audio",
      assetId: assetFor(a.song.path, a.song.mediaType),
      ...(a.song.clipStartMs > 0 ? { playback: { clipStartMs: Math.round(a.song.clipStartMs) } } : {}),
      audio: { enabled: true, volume: 1 },
    } as MosaicSource;
    pieces.push({ rect: { x: 0, y: 0, w: W, h: H, importance: Z_SONG }, source: tag(leaf, "song") });
  }

  if (pieces.length > MAX_ROOT_SOURCES) {
    throw new Error(`cover-shards: ${pieces.length} sources on the root, over the ${MAX_ROOT_SOURCES} ceiling.`);
  }

  const placed = placeInsetPieces({ rootW: W, rootH: H, pieces });
  const m0 = placed.m0;
  const v = validateM0String(String(m0));
  if (!v.ok) throw new Error(`cover-shards: generated m0 is invalid (${JSON.stringify(v)})`);

  return {
    kind: "mosaic_document",
    version: 1,
    m0,
    fps: a.fps,
    durationMs: a.durationMs,
    size: { width: W, height: H },
    backgroundColor: a.pageColor,
    assets: assets as MosaicAssetManifest,
    sources: placed.sources,
    ...audioPolicy({}),
  };
}
