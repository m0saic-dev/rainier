import type {
  MosaicAssetManifest,
  MosaicColor,
  MosaicDocument,
  MosaicMediaKind,
  MosaicSource,
  MosaicTextLayer,
  MosaicTextSource,
} from "@m0saic/types";
import { asAssetId } from "@m0saic/types";
import { parseM0StringToRenderFrames, validateM0String } from "@m0saic/dsl";
import {
  bindProp,
  bindPropRect,
  fadeInExpr,
  latticeCellInset,
  placeInsetPieces,
  slugifyAssetKeyFromPath,
} from "@m0saic/template-utils";

import { FONT_METRICS } from "./font-metrics";
import type { LyricPage } from "./pages";
import type { Box, TextAlign, TypesetPage } from "./typeset";
import { inkTop, measureText, typesetPage } from "./typeset";

/**
 * The document — pure assembly, no ctx.
 *
 * Geometry is a gutterless `3[1,1,1]` (three equal rows); the border between
 * them is a per-row `placement.inset` from `latticeCellInset`, so the gaps are
 * exactly `borderPx` on every canvas and the document background shows
 * through them as the border colour (ratio-grid recipe: never DSL gutters).
 *
 * Everything else rides overlays, nested so paint order is explicit:
 *
 *   template layout:  3[ row, row{ glow{ words … }}, row ]{ reelsUi{ song } }
 *   custom layout:    3[ row, row{ glow{ <one cell per word> }}, row ]{ … }
 *
 * THE RENDER, both layouts: every word is ONE drawtext layer inside a
 * row-sized text source — its own x (measured), its own y (`baseline −
 * inkTop`: drawtext places a string by its tallest glyph, so the measured
 * glyph top puts words with and without ascenders on one baseline, as a plain
 * number Make's preview can evaluate too), its own enable window [word lands,
 * page clears) and entrance. Placement exprs are inlined into the filtergraph
 * verbatim, so they must stay COMMA-FREE (no min/max/if — clamps are written
 * with abs()).
 *
 * CUSTOM layout, in Make (`editable`, the host's design pass): every word is
 * its OWN CELL (a real m0 rect, placed with `placeInsetPieces` so it paints
 * on its exact box), a one-word tile whose window / fade / rise ride the
 * source overlay, bound to element `i` of the `wordBoxes` regions list. The
 * artist drags or resizes a word; the box written back becomes that word's
 * position and size (bigger box = bigger font). The REAL render draws the
 * same final positions through the drawtext path above: one cell per word
 * would cost every word its own composite input (measured ~5x slower on a
 * 150-word minute) for pixels the drawtext layer already puts in the same
 * place.
 *
 * Every row tile is BOUND to its clip prop (a `media` binding), filled or
 * not: in Make the row is a drop target (drag a video or photo onto it) and
 * a click opens the picker. Make looks THROUGH unbound tiles stacked on top
 * (the lyric layers, the Reels UI, the song leaf) to the row beneath, so
 * only the rows carry bindings — never the song, whose leaf covers the
 * whole canvas and would swallow every drop.
 */

export type Row = {
  /** The `media` prop this row shows; its tile is bound to it (drop target). */
  propKey: string;
  /** Absent → a placeholder panel telling the artist what goes here. */
  clip?: { path: string; mediaType: "video" | "image"; durationMs?: number };
  trimStartMs: number;
  /** Cover-crop anchor, 0 = keep the top of the clip, 1 = keep the bottom. */
  focusY: number;
  placeholder: { color: MosaicColor; label: string };
};

export type WordEntrance = "rise" | "fade" | "instant";
export type WordLayout = "template" | "custom";

export type TriptychStyle = {
  lyricRow: 0 | 1 | 2;
  align: TextAlign;
  entrance: WordEntrance;
  /** Multiplier on the canvas-derived base size. */
  textScale: number;
  textColor: MosaicColor;
  /** 0 = no glow, 1 = strong. */
  glow: number;
  /** White reads as a halo; black reads as a soft shadow on bright footage. */
  glowColor: MosaicColor;
  borderPx: number;
  borderColor: MosaicColor;
  outerBorder: boolean;
  wordLayout: WordLayout;
};

export type TriptychArgs = {
  canvasW: number;
  canvasH: number;
  fps: number;
  durationMs: number;
  rows: [Row, Row, Row];
  pages: LyricPage[];
  style: TriptychStyle;
  song?: { path: string; mediaType: MosaicMediaKind };
  /** Absolute path of the baked Reels UI PNG when the guide is on. */
  reelsUiPath?: string;
  /** The host's editing pass (Make's `design` preview): custom layout emits
   *  its draggable per-word cells here and only here. */
  editable?: boolean;
  /**
   * Custom layout: the artist's word boxes in CANVAS px, element `i` = word
   * `i` in reading order across every page (null = that entry was unusable).
   * Applied only when the count matches the words on screen; see
   * {@link applyWordBoxes}.
   */
  wordBoxes?: Array<Box | null>;
};

/** Prop key of the regions list custom-layout words bind to. */
export const WORD_BOXES_PROP = "wordBoxes";

/**
 * Word layers per text source. The drawtext chain itself is cheap (a 360-word
 * source renders a minute in ~5 s); what costs is every extra SOURCE in the
 * composite, above all its blurred glow twin, which blurs for the whole song
 * whether its words are showing or not. So a typical song's lyrics ride ONE
 * source (plus one glow), and only a very wordy one splits.
 */
export const LAYERS_PER_SOURCE = 300;
/** Base font size as a fraction of canvas width (≈123 px on a 1080-wide Reel). */
export const FONT_FRACTION_OF_W = 0.114;
/** Text box inset inside the lyric row: sides (of row width), top/bottom (of row height). */
export const TEXT_SIDE_FRAC = 0.11;
export const TEXT_TOP_FRAC = 0.035;

/** A word's box, in ems of its font: the font's full ascender + descender tall,
 *  its advance + a side pad wide (the pad keeps overhanging glyphs inside). */
export const WORD_ASCENT_EM = FONT_METRICS.ascender / FONT_METRICS.unitsPerEm;
export const WORD_DESCENT_EM = -FONT_METRICS.descender / FONT_METRICS.unitsPerEm;
export const WORD_PAD_EM = 0.08;
const MIN_WORD_FONT_PX = 8;

const ENTRANCE_SEC = 0.28;
const RISE_EM = 0.16;

const sec = (ms: number) => (ms / 1000).toFixed(3);

/** `1 - min(1, u)` without a comma, for u ≥ 0: placement exprs are filtergraph-inlined. */
const restExpr = (startSec: string) => {
  const u = `(t-${startSec})/${ENTRANCE_SEC}`;
  // 1 - min(1,u) == (1 - u + |u - 1|) / 2
  return `((1-${u}+abs(${u}-1))/2)`;
};

/** One word on screen: where it sits (cell px), how big, and when. */
export type WordItem = {
  text: string;
  /** Left edge of the pen box (drawtext `x`). */
  x: number;
  baseline: number;
  fontPx: number;
  atMs: number;
  endMs: number;
  /** Index of its page among the rendered pages. */
  page: number;
  /** The word's cell (custom layout) — also what Make seeds a drag with. */
  box: Box;
  /** True when the box came from the artist, not the typesetter. */
  moved: boolean;
};

/** The box a word at (x, baseline, fontPx) occupies. */
export function wordBox(text: string, x: number, baseline: number, fontPx: number): Box {
  const pad = Math.round(fontPx * WORD_PAD_EM);
  const top = baseline - Math.round(fontPx * WORD_ASCENT_EM);
  return {
    x: x - pad,
    y: top,
    w: Math.ceil(measureText(text, fontPx)) + 2 * pad,
    h: Math.round(fontPx * (WORD_ASCENT_EM + WORD_DESCENT_EM)),
  };
}

/**
 * Fit a word into a box the artist drew: the largest font whose word box fits
 * (height and width), left-aligned, vertically centred. Resizing a box is how
 * a word gets bigger or smaller.
 */
export function fitWordToBox(text: string, box: Box): { x: number; baseline: number; fontPx: number } {
  const perPx = measureText(text, 1) + 2 * WORD_PAD_EM;
  const byH = box.h / (WORD_ASCENT_EM + WORD_DESCENT_EM);
  const byW = box.w / Math.max(0.01, perPx);
  const fontPx = Math.max(MIN_WORD_FONT_PX, Math.floor(Math.min(byH, byW)));
  const used = fontPx * (WORD_ASCENT_EM + WORD_DESCENT_EM);
  return {
    x: box.x + Math.round(fontPx * WORD_PAD_EM),
    baseline: Math.round(box.y + (box.h - used) / 2 + fontPx * WORD_ASCENT_EM),
    fontPx,
  };
}

const sameBox = (a: Box, b: Box) =>
  Math.abs(a.x - b.x) <= 1 && Math.abs(a.y - b.y) <= 1 && Math.abs(a.w - b.w) <= 1 && Math.abs(a.h - b.h) <= 1;

/**
 * Lay the artist's boxes over the typeset words (custom layout).
 *
 * Make writes the WHOLE list whenever one word moves (every sibling pinned at
 * the box it was painted in), so a box equal to the word's own typeset box is
 * "untouched" and keeps following the template (text size, alignment). A list
 * whose length no longer matches the words on screen (lyrics edited after
 * moving words) is ignored rather than shifting every box onto the wrong
 * word — `applied: false` says so.
 */
export function applyWordBoxes(
  items: WordItem[],
  boxes: Array<Box | null> | undefined,
  cell: Box,
): { items: WordItem[]; applied: boolean } {
  if (!boxes || boxes.length === 0 || boxes.length !== items.length) return { items, applied: false };
  const out = items.map((item, i) => {
    const b = boxes[i];
    if (!b) return item;
    // Canvas px → cell px, kept inside the lyric row.
    const w = Math.max(MIN_WORD_FONT_PX, Math.min(Math.round(b.w), cell.w));
    const h = Math.max(MIN_WORD_FONT_PX, Math.min(Math.round(b.h), cell.h));
    const local: Box = {
      x: Math.min(Math.max(0, Math.round(b.x - cell.x)), cell.w - w),
      y: Math.min(Math.max(0, Math.round(b.y - cell.y)), cell.h - h),
      w,
      h,
    };
    if (sameBox(local, item.box)) return item;
    return { ...item, ...fitWordToBox(item.text, local), box: local, moved: true };
  });
  return { items: out, applied: true };
}

/** `box` cut to the cell (a cell may not leave its parent rect). */
function clampToCell(box: Box, cellW: number, cellH: number): Box {
  const x = Math.max(0, box.x);
  const y = Math.max(0, box.y);
  return {
    x,
    y,
    w: Math.max(1, Math.min(box.x + box.w, cellW) - x),
    h: Math.max(1, Math.min(box.y + box.h, cellH) - y),
  };
}

/** Flatten typeset pages into words (reading order: page, line, word). A
 *  word's box is its full ascender-to-descender box, cut to the lyric cell
 *  (a top line's accent room can poke above the row). */
export function wordItems(pages: TypesetPage[], cell: { w: number; h: number }): WordItem[] {
  return pages.flatMap((page, p) =>
    page.lines.flat().map((w) => ({
      text: w.text,
      x: w.x,
      baseline: w.baseline,
      fontPx: page.fontPx,
      atMs: w.atMs,
      endMs: page.endMs,
      page: p,
      box: clampToCell(wordBox(w.text, w.x, w.baseline, page.fontPx), cell.w, cell.h),
      moved: false,
    })),
  );
}

/** The drawtext layer for one word inside a row-sized text source. */
function wordLayer(item: WordItem, baseFontPx: number, entrance: WordEntrance): MosaicTextLayer {
  const a = sec(item.atMs);
  const e = sec(item.endMs);
  const rest = restExpr(a); // 1 → 0 over the entrance
  const riseOffset = entrance === "rise" ? `+${Math.round(item.fontPx * RISE_EM)}*${rest}*${rest}` : "";
  const layer: MosaicTextLayer = {
    content: { kind: "literal", text: item.text },
    placement: {
      xExpr: String(item.x),
      yExpr: `${item.baseline - inkTop(item.text, item.fontPx)}${riseOffset}`,
    },
    overlay: {
      // The enable string and the structured window describe the SAME
      // window, minted from the same rounded seconds.
      enable: `between(t,${a},${e})`,
      window: { startSec: Number(a), endSec: Number(e) },
      ...(entrance === "instant" ? {} : { alpha: `min(1,max(0,(t-${a})/${ENTRANCE_SEC}))` }),
    },
  };
  if (item.fontPx !== baseFontPx) layer.style = { fontSize: item.fontPx };
  return layer;
}

/** Split words into chunks of ≤ LAYERS_PER_SOURCE (a page never straddles). */
export function chunkWords(items: WordItem[]): WordItem[][] {
  const chunks: WordItem[][] = [];
  let current: WordItem[] = [];
  let i = 0;
  while (i < items.length) {
    let j = i;
    while (j < items.length && items[j].page === items[i].page) j++;
    const page = items.slice(i, j);
    if (current.length > 0 && current.length + page.length > LAYERS_PER_SOURCE) {
      chunks.push(current);
      current = [];
    }
    current.push(...page);
    i = j;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

export type TriptychPlan = {
  doc: MosaicDocument;
  /** Painted rect of each row (px), the planning truth. */
  rowRects: Box[];
  /** The lyric text box (px, canvas space). */
  textBox: Box;
  pages: TypesetPage[];
  /** Every word as rendered (cell px). */
  words: WordItem[];
  /** Custom layout: the artist's boxes were applied (false = none / stale). */
  wordBoxesApplied: boolean;
  /** Text sources carrying drawtext word layers (template layout) or glow. */
  chunks: number;
};

export function buildTriptych(args: TriptychArgs): TriptychPlan {
  const W = Math.round(args.canvasW);
  const H = Math.round(args.canvasH);
  const { style } = args;
  const custom = style.wordLayout === "custom";
  // Per-word cells exist only where someone can grab them.
  const cellsPerWord = custom && args.editable === true;

  // ── rows: gutterless 3-row lattice, the border as an exact inset ────────
  const rowsM0 = "3[1,1,1]";
  const raw = parseM0StringToRenderFrames(rowsM0, W, H).map((f) => ({
    x: f.x,
    y: f.y,
    w: f.width,
    h: f.height,
  }));
  const border = Math.max(0, Math.round(style.borderPx));
  const lattice = latticeCellInset({
    cols: 1,
    rows: 3,
    canvasW: W,
    canvasH: H,
    gutterXPx: 0,
    gutterYPx: border,
    marginPx: style.outerBorder ? border : 0,
    cells: raw.map((r, i) => ({ unit: { c0: 0, r0: i, cs: 1, rs: 1 }, raw: r })),
  });
  const rowRects = lattice.targets.map((t) => ({ ...t }));

  // ── lyrics: typeset every page into the lyric row's text box ───────────
  const cell = raw[style.lyricRow];
  const painted = rowRects[style.lyricRow];
  const sideInset = Math.round(painted.w * TEXT_SIDE_FRAC);
  const topInset = Math.round(painted.h * TEXT_TOP_FRAC);
  // Word coordinates are CELL-relative: the lyric sources fill the raw cell.
  const textBoxInCell: Box = {
    x: painted.x - cell.x + sideInset,
    y: painted.y - cell.y + topInset,
    w: painted.w - 2 * sideInset,
    h: painted.h - 2 * topInset,
  };
  const baseFontPx = Math.max(12, Math.round(W * FONT_FRACTION_OF_W * style.textScale));
  const typeset = args.pages.map((p) =>
    typesetPage(p, textBoxInCell, { fontPx: baseFontPx, align: style.align }),
  );
  const cellBox: Box = { x: cell.x, y: cell.y, w: cell.w, h: cell.h };
  const typesetWords = wordItems(typeset, cellBox);
  const laid = custom
    ? applyWordBoxes(typesetWords, args.wordBoxes, cellBox)
    : { items: typesetWords, applied: false };
  const words = laid.items;
  const chunks = chunkWords(words);

  // ── assets ──────────────────────────────────────────────────────────────
  const assets: Record<string, { kind: "file"; path: string; mediaType: MosaicMediaKind }> = {};
  const assetFor = (path: string, mediaType: MosaicMediaKind) => {
    const id = slugifyAssetKeyFromPath(path);
    assets[id] = { kind: "file", path, mediaType };
    return asAssetId(id);
  };

  // ── row sources ─────────────────────────────────────────────────────────
  const rowSource = (row: Row, i: number): MosaicSource => bindProp(rowContent(row, i), row.propKey);
  const rowContent = (row: Row, i: number): MosaicSource => {
    const inset = lattice.insetAt(i);
    if (!row.clip) {
      // Placeholder panel: the row colour with a quiet label, one text tile.
      const label: MosaicTextLayer = {
        content: { kind: "literal", text: row.placeholder.label },
        placement: { hAlign: "left", vAlign: "bottom", padding: { left: 0.05, bottom: 0.07 } },
      };
      return {
        type: "text",
        renderMode: { kind: "image" },
        visual: { backgroundColor: row.placeholder.color },
        style: {
          fontFamily: FONT_METRICS.family,
          fontSize: Math.max(12, Math.round(W * 0.026)),
          fontColor: "#FFFFFF@0.55" as MosaicColor,
        },
        ...(inset ? { placement: { inset } } : {}),
        layers: [label],
        editor: { owner: "template", label: `row-${i + 1}:placeholder` },
      } as MosaicTextSource;
    }
    const { clip } = row;
    const isVideo = clip.mediaType === "video";
    const trim = isVideo && row.trimStartMs > 0 ? Math.round(row.trimStartMs) : 0;
    return {
      type: "media",
      mediaType: clip.mediaType,
      assetId: assetFor(clip.path, clip.mediaType),
      placement: {
        fit: "cover",
        focusY: Math.min(1, Math.max(0, row.focusY)),
        ...(inset ? { inset } : {}),
      },
      ...(trim > 0 ? { playback: { clipStartMs: trim } } : {}),
      audio: { enabled: false },
      editor: { owner: "template", label: `row-${i + 1}:clip` },
    } as MosaicSource;
  };

  // ── lyric sources ───────────────────────────────────────────────────────
  // Row-sized drawtext sources per chunk: the glow twin (both layouts, when
  // glow is on) and the words themselves (template layout only).
  const glow = Math.min(1, Math.max(0, style.glow));
  const rowText = (chunk: WordItem[], ci: number, glowPass: boolean): MosaicTextSource =>
    ({
      type: "text",
      renderMode: { kind: "video" },
      // Behind the glyphs: the ink colour at ZERO alpha, never transparent
      // black. drawtext blends into the RGB it draws over, so over black@0 a
      // fading word passes through dark grey (a dark ghost on bright
      // footage) and a blur spreads a dark fringe.
      visual: glowPass
        ? { backgroundColor: `${style.glowColor}@0` as MosaicColor, opacity: Math.min(1, 0.5 + glow * 0.5) }
        : { backgroundColor: `${style.textColor}@0` as MosaicColor },
      style: {
        fontFamily: FONT_METRICS.family,
        fontSize: baseFontPx,
        fontColor: glowPass ? style.glowColor : style.textColor,
      },
      layers: chunk.map((w) => wordLayer(w, baseFontPx, style.entrance)),
      ...(glowPass ? { effects: { blur: Math.max(1, Math.round(baseFontPx * (0.025 + glow * 0.06))) } } : {}),
      overlay: {
        window: {
          startSec: Number(sec(Math.min(...chunk.map((w) => w.atMs)))),
          endSec: Number(sec(Math.max(...chunk.map((w) => w.endMs)))),
        },
      },
      editor: {
        owner: "template",
        label: `lyrics:${glowPass ? "glow" : "words"}${chunks.length > 1 ? `-${ci + 1}` : ""}`,
      },
    }) as MosaicTextSource;

  const rowLyrics: MosaicSource[] = [];
  chunks.forEach((chunk, ci) => {
    if (glow > 0) rowLyrics.push(rowText(chunk, ci, true));
    if (!cellsPerWord) rowLyrics.push(rowText(chunk, ci, false));
  });

  // Custom layout, editing pass: one cell per word, bound to its box.
  let wordCells: { m0: string; sources: MosaicSource[] } | null = null;
  if (cellsPerWord && words.length > 0) {
    const pieces = words.map((w, i) => {
      const a = sec(w.atMs);
      const e = sec(w.endMs);
      const rest = restExpr(a);
      const src: MosaicTextSource = {
        type: "text",
        renderMode: { kind: "image" },
        visual: { backgroundColor: `${style.textColor}@0` as MosaicColor },
        style: { fontFamily: FONT_METRICS.family, fontSize: w.fontPx, fontColor: style.textColor },
        layers: [
          {
            content: { kind: "literal", text: w.text },
            placement: {
              xExpr: String(w.x - w.box.x),
              yExpr: String(w.baseline - w.box.y - inkTop(w.text, w.fontPx)),
            },
          },
        ],
        overlay: {
          enable: `between(t,${a},${e})`,
          window: { startSec: Number(a), endSec: Number(e) },
          ...(style.entrance === "instant" ? {} : { alpha: fadeInExpr(Number(a), ENTRANCE_SEC, "linear") }),
          ...(style.entrance === "rise" ? { yExpr: `${Math.round(w.fontPx * RISE_EM)}*${rest}*${rest}` } : {}),
        },
        editor: { owner: "template", label: `word-${i + 1}:${w.text}` },
      } as MosaicTextSource;
      return {
        rect: { ...w.box, importance: w.page + 1 },
        source: bindPropRect(src, WORD_BOXES_PROP, i),
      };
    });
    const placed = placeInsetPieces({ rootW: cell.w, rootH: cell.h, pieces });
    wordCells = { m0: String(placed.m0), sources: placed.sources };
  }

  // ── root overlays: the Reels UI guide, then the song (an audio-only leaf) ─
  const rootOverlay: MosaicSource[] = [];
  if (args.reelsUiPath) {
    rootOverlay.push({
      type: "media",
      mediaType: "image",
      assetId: assetFor(args.reelsUiPath, "image"),
      placement: { fit: "contain" },
      editor: { owner: "template", label: "reels-ui-guide" },
    } as MosaicSource);
  }
  if (args.song) {
    rootOverlay.push({
      type: "media",
      // MANDATORY even for real audio files: an mp3 with cover art probes as
      // video; declaring "audio" makes the engine take only its sound.
      mediaType: "audio",
      assetId: assetFor(args.song.path, args.song.mediaType),
      audio: { enabled: true, volume: 1 },
      editor: { owner: "template", label: "song" },
    } as MosaicSource);
  }

  // ── m0: rows, the lyric row's overlay nest, the root overlay nest ───────
  // A nest of `n` full-cell tiles, the innermost carrying `inner` (if any).
  const nest = (n: number, inner?: string): string =>
    n === 0 ? (inner ? `{${inner}}` : "") : `{1${nest(n - 1, inner)}}`;
  const lyricToken = `1${nest(rowLyrics.length, wordCells?.m0)}`;
  const rowTokens = [0, 1, 2].map((i) => (i === style.lyricRow ? lyricToken : "1"));
  const m0 = `3[${rowTokens.join(",")}]${nest(rootOverlay.length)}`;
  const v = validateM0String(m0);
  if (!v.ok) throw new Error(`lyric-triptych: generated m0 is invalid (${JSON.stringify(v)})`);

  // Sources follow the string order of the `1` tokens.
  const sources: MosaicSource[] = [];
  args.rows.forEach((row, i) => {
    sources.push(rowSource(row, i));
    if (i === style.lyricRow) {
      sources.push(...rowLyrics);
      if (wordCells) sources.push(...wordCells.sources);
    }
  });
  sources.push(...rootOverlay);

  const doc = {
    kind: "mosaic_document",
    version: 1,
    m0,
    fps: args.fps,
    durationMs: args.durationMs,
    size: { width: W, height: H },
    backgroundColor: style.borderColor,
    assets: assets as unknown as MosaicAssetManifest,
    sources,
  } as unknown as MosaicDocument;

  return {
    doc,
    rowRects,
    textBox: {
      x: cell.x + textBoxInCell.x,
      y: cell.y + textBoxInCell.y,
      w: textBoxInCell.w,
      h: textBoxInCell.h,
    },
    pages: typeset,
    words,
    wordBoxesApplied: laid.applied,
    chunks: chunks.length,
  };
}
