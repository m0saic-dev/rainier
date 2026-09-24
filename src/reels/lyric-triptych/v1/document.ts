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
import { bindProp, latticeCellInset, slugifyAssetKeyFromPath } from "@m0saic/template-utils";

import { FONT_METRICS } from "./font-metrics";
import type { LyricPage } from "./pages";
import type { Box, TextAlign, TypesetPage } from "./typeset";
import { typesetPage } from "./typeset";

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
 *   3[ row, row{ glow{ words{ glow{ words … }}}}, row ]{ reelsUi{ song } }
 *        └ the lyric row carries the word layers, chunked ≤ 300 per source
 *
 * Every row tile is BOUND to its clip prop (a `media` binding), filled or
 * not: in Make the row is a drop target (drag a video or photo onto it) and
 * a click opens the picker. Make looks THROUGH unbound tiles stacked on top
 * (the lyric layers, the Reels UI, the song leaf) to the row beneath, so
 * only the rows carry bindings — never the song, whose leaf covers the
 * whole canvas and would swallow every drop.
 *
 * Each word is ONE drawtext layer: its own x (measured), its own baseline
 * (`y = baseline − ascent` — drawtext's `ascent` is the word's own glyph
 * height, so words with and without ascenders share one baseline), its own
 * enable window [word lands, page clears) and entrance. Placement exprs are
 * inlined into the filtergraph verbatim, so they must stay COMMA-FREE (no
 * min/max/if — clamps are written with abs()).
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
};

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

const ENTRANCE_SEC = 0.28;
const RISE_EM = 0.16;

const sec = (ms: number) => (ms / 1000).toFixed(3);

/** `min(1, u)` without a comma, for u ≥ 0: placement exprs are filtergraph-inlined. */
const progressExpr = (startSec: string) => {
  const u = `(t-${startSec})/${ENTRANCE_SEC}`;
  // 1 - min(1,u) == (1 - u + |u - 1|) / 2
  return `((1-${u}+abs(${u}-1))/2)`;
};

function wordLayer(
  word: { text: string; x: number; baseline: number; atMs: number },
  page: TypesetPage,
  baseFontPx: number,
  entrance: WordEntrance,
): MosaicTextLayer {
  const a = sec(word.atMs);
  const e = sec(page.endMs);
  const rest = progressExpr(a); // 1 → 0 over the entrance
  const riseOffset =
    entrance === "rise" ? `+${Math.round(page.fontPx * RISE_EM)}*${rest}*${rest}` : "";
  const layer: MosaicTextLayer = {
    content: { kind: "literal", text: word.text },
    placement: {
      xExpr: String(word.x),
      yExpr: `${word.baseline}-ascent${riseOffset}`,
    },
    overlay: {
      // The enable string and the structured window describe the SAME
      // window, minted from the same rounded seconds.
      enable: `between(t,${a},${e})`,
      window: { startSec: Number(a), endSec: Number(e) },
      ...(entrance === "instant"
        ? {}
        : { alpha: `min(1,max(0,(t-${a})/${ENTRANCE_SEC}))` }),
    },
  };
  if (page.fontPx !== baseFontPx) layer.style = { fontSize: page.fontPx };
  return layer;
}

/** Split pages into chunks of ≤ LAYERS_PER_SOURCE word layers (a page never straddles). */
export function chunkPages(pages: TypesetPage[]): TypesetPage[][] {
  const chunks: TypesetPage[][] = [];
  let current: TypesetPage[] = [];
  let count = 0;
  for (const p of pages) {
    const n = p.lines.reduce((s, l) => s + l.length, 0);
    if (count > 0 && count + n > LAYERS_PER_SOURCE) {
      chunks.push(current);
      current = [];
      count = 0;
    }
    current.push(p);
    count += n;
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
  chunks: number;
};

export function buildTriptych(args: TriptychArgs): TriptychPlan {
  const W = Math.round(args.canvasW);
  const H = Math.round(args.canvasH);
  const { style } = args;

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
  // Word coordinates are CELL-relative: the text sources fill the raw cell.
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
  const chunks = chunkPages(typeset);

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

  // ── lyric sources: per chunk, an optional blurred glow twin under the words ─
  const glow = Math.min(1, Math.max(0, style.glow));
  const lyricSources: MosaicSource[] = [];
  chunks.forEach((chunk, ci) => {
    const layers = chunk.flatMap((page) =>
      page.lines.flat().map((w) => wordLayer(w, page, baseFontPx, style.entrance)),
    );
    const window = {
      startSec: Number(sec(chunk[0].startMs)),
      endSec: Number(sec(chunk[chunk.length - 1].endMs)),
    };
    const text = (glowPass: boolean): MosaicTextSource =>
      ({
        type: "text",
        renderMode: { kind: "video" },
        // Behind the glyphs: the ink colour at ZERO alpha, never transparent
        // black. drawtext blends into the RGB it draws over, so over black@0
        // a fading word passes through dark grey (a dark ghost on bright
        // footage) and a blur spreads a dark fringe.
        visual: glowPass
          ? { backgroundColor: `${style.glowColor}@0` as MosaicColor, opacity: Math.min(1, 0.5 + glow * 0.5) }
          : { backgroundColor: `${style.textColor}@0` as MosaicColor },
        style: {
          fontFamily: FONT_METRICS.family,
          fontSize: baseFontPx,
          fontColor: glowPass ? style.glowColor : style.textColor,
        },
        layers,
        ...(glowPass ? { effects: { blur: Math.max(1, Math.round(baseFontPx * (0.025 + glow * 0.06))) } } : {}),
        overlay: { window },
        editor: {
          owner: "template",
          label: `lyrics:${glowPass ? "glow" : "words"}${chunks.length > 1 ? `-${ci + 1}` : ""}`,
        },
      }) as MosaicTextSource;
    if (glow > 0) lyricSources.push(text(true));
    lyricSources.push(text(false));
  });

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
  const nest = (n: number): string => (n === 0 ? "" : `{1${nest(n - 1)}}`);
  const rowTokens = [0, 1, 2].map((i) => (i === style.lyricRow ? `1${nest(lyricSources.length)}` : "1"));
  const m0 = `3[${rowTokens.join(",")}]${nest(rootOverlay.length)}`;
  const v = validateM0String(m0);
  if (!v.ok) throw new Error(`lyric-triptych: generated m0 is invalid (${JSON.stringify(v)})`);

  // Sources follow the string order of the `1` tokens.
  const sources: MosaicSource[] = [];
  args.rows.forEach((row, i) => {
    sources.push(rowSource(row, i));
    if (i === style.lyricRow) sources.push(...lyricSources);
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
    chunks: chunks.length,
  };
}
