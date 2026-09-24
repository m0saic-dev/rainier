import { FONT_METRICS } from "./font-metrics";
import type { LyricPage } from "./pages";

/**
 * Typesetting for one lyric page — pure, deterministic.
 *
 * Every word is drawn as its OWN text layer (so it can appear on its own
 * beat), which means this module has to know exactly where drawtext would
 * have put it inside one long line. It measures with the committed
 * Helvetica Neue metrics (font-metrics.ts: advances + kerning, the same
 * numbers drawtext lays the font out with), breaks lines greedily, shrinks
 * a page that does not fit, and places each word's left edge and baseline.
 *
 * The look it copies: big words, justified edge to edge (a lone word sits
 * left), the block centred in the row.
 */

export type TextAlign = "justify" | "left" | "center";

export type Box = { x: number; y: number; w: number; h: number };

export type PlacedWord = {
  text: string;
  /** Left edge of the word's pen box (drawtext `x`), px in the cell. */
  x: number;
  /** Baseline, px in the cell (drawtext `y` = baseline − ascent). */
  baseline: number;
  atMs: number;
};

export type TypesetPage = {
  startMs: number;
  endMs: number;
  fontPx: number;
  lines: PlacedWord[][];
};

/** Line pitch as a multiple of the font size (measured off real posts ≈ 1.3). */
export const LINE_HEIGHT = 1.28;
/** Shrink steps tried when a page does not fit (fractions of the base size). */
const FIT_LADDER = [1, 0.93, 0.86, 0.8, 0.74, 0.68, 0.62, 0.56, 0.5, 0.44, 0.38] as const;
/** Visual extent of a line around its baseline (fractions of the font size). */
const CAP_TOP = FONT_METRICS.capHeight / FONT_METRICS.unitsPerEm;
const DESCENT = 0.2;

const unit = (px: number) => px / FONT_METRICS.unitsPerEm;

/** Advance width of `text` at `fontPx`, kerning included. */
export function measureText(text: string, fontPx: number): number {
  const { advances, kerning, fallbackAdvance } = FONT_METRICS;
  let units = 0;
  const chars = Array.from(text);
  for (let i = 0; i < chars.length; i++) {
    units += advances[chars[i]] ?? fallbackAdvance;
    if (i + 1 < chars.length) units += kerning[chars[i] + chars[i + 1]] ?? 0;
  }
  return units * unit(fontPx);
}

/** Width of the space between two words (kerning on both sides of it). */
function spaceBetween(left: string, right: string, fontPx: number): number {
  const { advances, kerning } = FONT_METRICS;
  const a = Array.from(left).pop() ?? "";
  const b = Array.from(right)[0] ?? "";
  return (advances[" "] + (kerning[a + " "] ?? 0) + (kerning[" " + b] ?? 0)) * unit(fontPx);
}

type Measured = { text: string; w: number; atMs: number; lineBreakBefore: boolean };

/** Greedy line breaking: fill each line until the next word would not fit. */
function breakLines(words: Measured[], maxW: number, fontPx: number): Measured[][] {
  const lines: Measured[][] = [];
  let line: Measured[] = [];
  let lineW = 0;
  for (const word of words) {
    const add = line.length === 0 ? word.w : spaceBetween(line[line.length - 1].text, word.text, fontPx) + word.w;
    if (line.length > 0 && (word.lineBreakBefore || lineW + add > maxW)) {
      lines.push(line);
      line = [word];
      lineW = word.w;
    } else {
      line.push(word);
      lineW += add;
    }
  }
  if (line.length > 0) lines.push(line);
  return lines;
}

const blockHeight = (lineCount: number, fontPx: number) =>
  (lineCount - 1) * fontPx * LINE_HEIGHT + fontPx * (CAP_TOP + DESCENT);

/**
 * Lay one page into `box`: the largest size on the ladder at which every
 * word fits the width and every line fits the height (the floor size wins
 * when nothing does — a page that long should be split into two).
 */
export function typesetPage(
  page: LyricPage,
  box: Box,
  opts: { fontPx: number; align: TextAlign },
): TypesetPage {
  let chosen: { fontPx: number; lines: Measured[][] } | undefined;
  for (const scale of FIT_LADDER) {
    const fontPx = Math.max(10, Math.round(opts.fontPx * scale));
    const measured = page.words.map((w) => ({ ...w, w: measureText(w.text, fontPx) }));
    const lines = breakLines(measured, box.w, fontPx);
    const fitsW = measured.every((m) => m.w <= box.w);
    const fitsH = blockHeight(lines.length, fontPx) <= box.h;
    chosen = { fontPx, lines };
    if (fitsW && fitsH) break;
  }
  const { fontPx, lines } = chosen as { fontPx: number; lines: Measured[][] };

  const pitch = fontPx * LINE_HEIGHT;
  const top = box.y + (box.h - blockHeight(lines.length, fontPx)) / 2;
  const firstBaseline = top + fontPx * CAP_TOP;

  const placed = lines.map((line, li) => {
    const baseline = Math.round(firstBaseline + li * pitch);
    const gaps = line.slice(1).map((w, k) => spaceBetween(line[k].text, w.text, fontPx));
    const natural = line.reduce((s, w) => s + w.w, 0) + gaps.reduce((s, g) => s + g, 0);
    const justify = opts.align === "justify" && line.length > 1;
    const extra = justify ? (box.w - natural) / (line.length - 1) : 0;
    let x =
      opts.align === "center" ? box.x + (box.w - natural) / 2 : box.x;
    return line.map((w, k) => {
      if (k > 0) x += gaps[k - 1] + extra;
      const word: PlacedWord = { text: w.text, x: Math.round(x), baseline, atMs: w.atMs };
      x += w.w;
      return word;
    });
  });

  return { startMs: page.startMs, endMs: page.endMs, fontPx, lines: placed };
}
