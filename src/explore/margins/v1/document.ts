import type {
  MosaicAssetManifest,
  MosaicColor,
  MosaicDocument,
  MosaicMediaKind,
  MosaicOverlayExpr,
  MosaicSource,
} from "@m0saic/types";
import { asAssetId } from "@m0saic/types";
import { validateM0String } from "@m0saic/dsl";
import {
  bindProp,
  bindProps,
  fadeInExpr,
  makeColorTile,
  placeInsetPieces,
  slugifyAssetKeyFromPath,
  uniqueAssetKey,
} from "@m0saic/template-utils";

import type { AudioPolicy } from "../../../_shared/platform-emit";
import type { Box, MarkStyle, PageFit } from "./marks";
import { markPath, ruledPaperPath, scribbleStrokes } from "./marks";

/**
 * The Margins document: pure assembly, no ctx.
 *
 *   root W x H, backgroundColor = paperColor (no base rect)
 *     page          the photo (fit contain | cover), bound to `page`;
 *                   no photo: ruled paper, a masked colour tile, bound to `page`
 *     [scribble]    no photo only: the handwriting stand-in, one masked tile (unbound)
 *     [audio]       the recording: an audio-only leaf from the audio start (unbound:
 *                   a full-canvas leaf has no pointer surface and would swallow drops)
 *     mark_1..N     one colour tile per line at its box (placeInsetPieces), an inline
 *                   mask by style whose bounds are the box size, bound to
 *                   `lineBoxes[i]` (a rect handle, first) and `markColor` (a swatch)
 *
 * m0: `1{1{1{<marks>}}}` (page, scribble, audio, then the placed marks as the
 * innermost overlay), each optional layer left out. Sources follow the frame
 * order. Marks do not move: no xExpr or yExpr anywhere.
 *
 * A mark's visibility is one of:
 *   - `always`: no overlay window at all (Make's design pass while placing
 *     boxes: every box on screen at once so each can be dragged);
 *   - `window`: `[startMs, endMs]` as an `enable` + `window` pair minted from
 *     the same rounded seconds (they agree), with a 120 ms fade in;
 *   - `never`: design pass only, a line the clip does not show (sung before
 *     the audio start, or out of order). The tile still exists so Make's box
 *     session sees every element of `lineBoxes` (it seeds the list densely
 *     and stops at the first element with no tile), but it never shows: an
 *     `enable` of `lt(t,0)` and NO window (a `[0,0]` window is degenerate,
 *     and the engine ignores a degenerate window rather than hiding the tile).
 *   A line with no tile at all (render only) costs nothing.
 *
 * Blending: `highlight` on a light page is a translucent marker with normal
 * blending (see HIGHLIGHT_ALPHA_LIGHT for why not `multiply`); on a dark page
 * it is `screen` (black is screen's identity, so the tile's transparent
 * surroundings leave the page untouched). `underline` and `box` are opaque
 * ink, normal blending. Opacity is always `overlay.alpha` (see RULE_INK).
 */

export type MarkVisibility =
  | { kind: "always" }
  | { kind: "window"; startMs: number; endMs: number }
  | { kind: "never" };

export type PageTone = "light" | "dark";

export type MarginsArgs = {
  W: number;
  H: number;
  fps: number;
  durationMs: number;
  paperColor: MosaicColor;
  /** The photo, or absent for the ruled placeholder. */
  page?: { path: string; mediaType: "image" | "video"; fit: PageFit };
  /** The recording, played from `clipStartMs`. */
  audio?: { path: string; mediaType: MosaicMediaKind; clipStartMs: number };
  style: MarkStyle;
  /** `#rrggbb`. */
  markColor: string;
  pageTone: PageTone;
  /** Canvas px, one per line (index = line index). */
  boxes: Box[];
  /** One per line: `null` = no tile. */
  marks: Array<MarkVisibility | null>;
  /** `audioPolicy({})` from `_shared/platform-emit`. */
  output: AudioPolicy;
};

/** Prop keys the tiles bind (the schema's names). */
export const PAGE_PROP = "page";
export const LINE_BOXES_PROP = "lineBoxes";
export const MARK_COLOR_PROP = "markColor";

/** Each mark fades in over this long when its line starts. */
export const FADE_SEC = 0.12;

/** The design-only "this line is not in the clip" gate: never true. */
export const NEVER_ENABLE = "lt(t,0)";

/** Root sources at most: 16 marks + page + scribble + the audio leaf (the engine's cap is 20). */
export const MAX_ROOT_SOURCES = 19;

/**
 * The highlighter over a LIGHT page: normal blending at this alpha.
 *
 * Not `multiply`, on purpose. The 0.2.x engine blends a tile by first laying
 * it on a transparent layer the size of its whole parent, premultiplying
 * that layer by its alpha and making it opaque (black wherever the tile is
 * not), then `blend=all_mode=multiply` against everything below
 * (m0saic packages/core/src/ffmpeg/ffmpegCommands.ts: `compositeWithBlend`
 * 2969-3012, called at 1222, 1345 and 1809). Black is multiply's
 * zero, so a multiplied mark would black out the whole frame outside its
 * mask, and before its window opens. `screen` and `add` survive the same
 * path because black is their identity. This is the plan's own fallback
 * (plan section 8, "Blend plus inline mask order").
 */
export const HIGHLIGHT_ALPHA_LIGHT = 0.4;
/**
 * The highlighter over a DARK page (`screen`): a gold band that keeps light
 * text readable. The one costly path here: every blended tile runs a
 * full-canvas per-pixel premultiply (`geq`) for as long as its window is
 * open (the engine gates it to the window), so with `past: keep` the last
 * seconds of a 16-line clip carry up to 16 of them.
 */
export const HIGHLIGHT_ALPHA_DARK = 0.55;
/** The ruled lines of the empty page sit this faint on the paper. */
export const RULE_ALPHA = 0.5;

/**
 * Translucency rides `overlay.alpha`, never a `#rrggbb@a` colour: an inline
 * mask's `alphamerge` REPLACES the tile's alpha plane (m0saic
 * packages/core/src/ffmpeg/filters/applyTileEffects.ts:195-203 and
 * filters/applyMask.ts:60), so a colour's own alpha would render fully opaque
 * and bury the handwriting. A constant alpha, and a canonical fade times a
 * constant, both lower to compiled filters (`fade` + `colorchannelmixer`),
 * never a per-pixel fold (ffmpegCommands.ts `tryLowerAlphaSide`, 2474-2534).
 */
export const RULE_INK = "#6F8FB5" as MosaicColor;
/** The handwriting stand-in (opaque ink). */
export const SCRIBBLE_INK = "#2C3450" as MosaicColor;

const sec = (ms: number) => (ms / 1000).toFixed(3);

/** How opaque a mark is: the highlighter is translucent, the underline and the box are ink. */
export function markAlpha(style: MarkStyle, tone: PageTone): number {
  if (style !== "highlight") return 1;
  return tone === "dark" ? HIGHLIGHT_ALPHA_DARK : HIGHLIGHT_ALPHA_LIGHT;
}

/** The overlay for one mark: its window, its fade, its opacity and the highlighter's blend. */
export function markOverlay(style: MarkStyle, tone: PageTone, vis: MarkVisibility): MosaicOverlayExpr | undefined {
  const k = markAlpha(style, tone);
  const blend: MosaicOverlayExpr = style === "highlight" && tone === "dark" ? { blendMode: "screen" } : {};
  const still: MosaicOverlayExpr = { ...blend, ...(k < 1 ? { alpha: String(k) } : {}) };
  if (vis.kind === "always") return Object.keys(still).length > 0 ? still : undefined;
  if (vis.kind === "never") return { ...still, enable: NEVER_ENABLE };
  const a = sec(vis.startMs);
  const e = sec(vis.endMs);
  const fade = fadeInExpr(Number(a), FADE_SEC, "linear");
  return {
    ...blend,
    enable: `between(t,${a},${e})`,
    window: { startSec: Number(a), endSec: Number(e) },
    alpha: k < 1 ? `${fade}*${k}` : fade,
  };
}

/** One inline mask whose bounds are the box size (the path is box-local px). */
function boxMask(d: string, w: number, h: number) {
  return { kind: "inline-mask" as const, localPath: d, bounds: { x: 0, y: 0, width: w, height: h } };
}

export type MarginsPlan = {
  doc: MosaicDocument;
  /** Line index of each mark tile, in `doc.sources` order after the full-canvas layers. */
  markLines: number[];
  /** How many full-canvas layers precede the marks (page, scribble, audio). */
  layers: number;
};

export function buildMargins(args: MarginsArgs): MarginsPlan {
  const W = Math.round(args.W);
  const H = Math.round(args.H);

  const assets: Record<string, { kind: "file"; path: string; mediaType: MosaicMediaKind }> = {};
  // One key per file. The slug drops the extension, so "lyrics.jpg" (the
  // page) and "lyrics.m4a" (the recording) would share a key: the second
  // gets "_2" instead of overwriting the first.
  const assetFor = (p: string, mediaType: MosaicMediaKind) => {
    const same = Object.keys(assets).find((k) => assets[k].path === p && assets[k].mediaType === mediaType);
    if (same !== undefined) return asAssetId(same);
    const id = uniqueAssetKey(slugifyAssetKeyFromPath(p), assets as MosaicAssetManifest);
    assets[id] = { kind: "file", path: p, mediaType };
    return id;
  };

  // ── full-canvas layers ───────────────────────────────────────────────────
  const layers: MosaicSource[] = [];
  if (args.page) {
    const { path: p, mediaType, fit } = args.page;
    const photo = {
      type: "media",
      mediaType,
      assetId: assetFor(p, mediaType),
      placement: { fit },
      ...(mediaType === "video" ? { audio: { enabled: false } } : {}),
      editor: { owner: "template", label: "page" },
    } as MosaicSource;
    layers.push(bindProp(photo, PAGE_PROP));
  } else {
    const paper = makeColorTile(RULE_INK, {
      mask: boxMask(ruledPaperPath(W, H), W, H),
      overlay: { alpha: String(RULE_ALPHA) },
    });
    paper.editor = { owner: "template", label: "page:placeholder" };
    layers.push(bindProp(paper as MosaicSource, PAGE_PROP));
    // The stand-in is pen strokes, not filled shapes: the mask's `strokes`
    // (round caps and joins; `localPath` may be "" when strokes carry it all).
    const scribble = makeColorTile(SCRIBBLE_INK, {
      mask: { ...boxMask("", W, H), strokes: scribbleStrokes(W, H) },
    });
    scribble.editor = { owner: "template", label: "page:scribble" };
    layers.push(scribble as MosaicSource);
  }
  if (args.audio) {
    const { path: p, mediaType, clipStartMs } = args.audio;
    const start = Math.max(0, Math.round(clipStartMs));
    layers.push({
      type: "media",
      // MANDATORY even for a real audio file: an mp3 with cover art probes as
      // video; declaring "audio" makes the engine take only its sound.
      mediaType: "audio",
      assetId: assetFor(p, mediaType),
      ...(start > 0 ? { playback: { clipStartMs: start } } : {}),
      audio: { enabled: true, volume: 1 },
      editor: { owner: "template", label: "audio" },
    } as MosaicSource);
  }

  // ── marks ────────────────────────────────────────────────────────────────
  const pieces = args.marks.flatMap((vis, i) => {
    if (!vis) return [];
    const box = args.boxes[i];
    const overlay = markOverlay(args.style, args.pageTone, vis);
    const tile = makeColorTile(args.markColor as MosaicColor, {
      mask: boxMask(markPath(args.style, box.w, box.h), box.w, box.h),
      ...(overlay ? { overlay } : {}),
    });
    tile.editor = { owner: "template", label: `mark-${i + 1}` };
    // The rect handle first: a double-click opens the box session on this
    // line; the colour swatch rides beside it.
    const bound = bindProps(tile, [{ propKey: LINE_BOXES_PROP, index: i, kind: "rect" }, { propKey: MARK_COLOR_PROP }]);
    return [{ rect: { ...box, importance: 1 }, source: bound as MosaicSource }];
  });
  const placed = pieces.length > 0 ? placeInsetPieces({ rootW: W, rootH: H, pieces }) : null;

  // ── m0: the layers nest, the marks innermost ─────────────────────────────
  let m0 = placed ? String(placed.m0) : "";
  for (let k = layers.length - 1; k >= 0; k--) m0 = m0 ? `1{${m0}}` : "1";
  const v = validateM0String(m0);
  if (!v.ok) throw new Error(`margins: generated m0 is invalid (${JSON.stringify(v)})`);

  const markSources = placed ? placed.sources : [];
  const markLines = markSources.map((s) => {
    const label = (s as { editor?: { label?: string } }).editor?.label ?? "";
    return Number(label.replace("mark-", "")) - 1;
  });

  const sources = [...layers, ...markSources];
  if (sources.length > MAX_ROOT_SOURCES) {
    throw new Error(`margins: ${sources.length} root sources (the cap is ${MAX_ROOT_SOURCES}); at most 16 lines`);
  }

  const doc = {
    kind: "mosaic_document",
    version: 1,
    m0,
    fps: args.fps,
    durationMs: Math.max(1, Math.round(args.durationMs)),
    size: { width: W, height: H },
    backgroundColor: args.paperColor,
    ...args.output,
    assets: assets as unknown as MosaicAssetManifest,
    sources,
  } as unknown as MosaicDocument;

  return { doc, markLines, layers: layers.length };
}
