import type { MosaicTimedCue } from "@m0saic/types";
import { mulberry32 } from "@m0saic/template-utils";

import { DEFAULT_SHORT_PLATFORM, platformStage, resolveShortPlatform } from "../../../_shared/platforms";
import { songStartOf, windowMs } from "../../../_shared/song-window";

/**
 * Cover Shards, the pure half: where the square goes on the canvas, how it
 * splits into shards, which part of the picture each shard shows, which
 * shard lands first, and when each one lands. No ctx, no fs, no strings for
 * ffmpeg (motion.ts writes those). Every rect is integer px.
 */

export type Rect = { x: number; y: number; w: number; h: number };

/** Shards per side, as the `grid` prop stores it (a string on purpose, like Lyric Stack's `takeCount`). */
export type GridValue = "2" | "3" | "4";
export const GRID_VALUES: GridValue[] = ["2", "3", "4"];

export type ShardOrder = "shuffle" | "rows" | "center";
export const SHARD_ORDERS: ShardOrder[] = ["shuffle", "rows", "center"];

export type ShardMotion = "rise" | "slide" | "float" | "fade";
export const SHARD_MOTIONS: ShardMotion[] = ["rise", "slide", "float", "fade"];

/** Taps at or before this (clip time, s) are dropped: a shard needs a moment to arrive. */
export const MIN_TAP_SEC = 0.2;
/** With no taps, the first shard lands here (s). */
export const UNTIMED_FROM_SEC = 0.3;
/** The reveal runs at least this long past the last tap (s). */
export const TAIL_SEC = 0.4;
/** A shard's move starts this long before it lands (clamped at 0), s. */
export const RAMP_SEC = 0.35;
/** Headline and subline enter this long after the reveal ends (s). */
export const HEADLINE_DELAY_SEC = 0.1;
export const SUBLINE_DELAY_SEC = 0.25;
/** How long each text line takes to rise in (s). */
export const TEXT_RAMP_SEC = 0.4;

/** Seconds rounded to the millisecond: every time the document carries goes through this. */
export const sec3 = (s: number): number => Math.round(s * 1000) / 1000;

// ── Stage ──────────────────────────────────────────────────────────────────

export type StageKind = "tall" | "portrait" | "square";

export type StageLayout = {
  kind: StageKind;
  /** The box the square fills before it is snapped to the grid (a square, integer px). */
  squareBox: Rect;
  headline: Rect;
  subline: Rect;
  /** Square canvases only: the translucent band under the text (the bottom sixth). */
  scrim?: Rect;
};

/** Tall = 9:16-ish (H/W at least 1.5); square = H/W under 1.15 (landscape too); the rest is portrait (4:5). */
export function stageKind(W: number, H: number): StageKind {
  const r = H / W;
  if (r >= 1.5) return "tall";
  if (r < 1.15) return "square";
  return "portrait";
}

const px = (v: number): number => Math.max(1, Math.round(v));

/**
 * Where the cover and its two lines sit on a W x H canvas.
 *
 * - tall: the square spans the width minus the platform's side crop and a
 *   margin, from the top of the Reels safe area; the text band sits under it,
 *   centred on the square and kept left of the action rail.
 * - portrait (4:5): the square shrinks until the band fits under it; the pair
 *   is centred vertically.
 * - square (and landscape): the square fills the canvas minus a margin; the
 *   text sits on a translucent scrim across the bottom sixth.
 */
export function stageLayout(W: number, H: number): StageLayout {
  const kind = stageKind(W, H);

  if (kind === "tall") {
    const stage = platformStage(resolveShortPlatform(DEFAULT_SHORT_PLATFORM), W, H);
    const margin = Math.round(W * 0.04);
    const left = stage.safe.x + margin;
    const right = stage.safe.x + stage.safe.w - margin;
    const headH = px(W * 0.14);
    const subH = px(W * 0.065);
    const textGap = Math.round(W * 0.015);
    const below = Math.round(W * 0.045);
    const bandH = headH + textGap + subH;
    const side = Math.max(1, Math.min(right - left, stage.safe.h - below - bandH));
    const squareBox: Rect = { x: Math.round((W - side) / 2), y: stage.safe.y, w: side, h: side };
    const bandTop = squareBox.y + side + below;
    const bandBottom = bandTop + bandH;
    // Centre the band on the square; keep its right edge off the rail where the two share rows.
    const cx = squareBox.x + side / 2;
    let half = Math.min(cx - left, right - cx);
    const rail = stage.rail;
    if (rail && rail.y < bandBottom && rail.y + rail.h > bandTop) half = Math.min(half, rail.x - margin - cx);
    half = Math.max(1, Math.floor(half));
    const bx = Math.round(cx - half);
    return {
      kind,
      squareBox,
      headline: { x: bx, y: bandTop, w: 2 * half, h: headH },
      subline: { x: bx, y: bandTop + headH + textGap, w: 2 * half, h: subH },
    };
  }

  if (kind === "portrait") {
    const margin = Math.round(W * 0.05);
    const headH = px(W * 0.12);
    const subH = px(W * 0.055);
    const textGap = Math.round(W * 0.012);
    const below = Math.round(W * 0.035);
    const bandH = headH + textGap + subH;
    const side = Math.max(1, Math.min(W - 2 * margin, H - 2 * margin - below - bandH));
    const top = Math.round((H - (side + below + bandH)) / 2);
    const squareBox: Rect = { x: Math.round((W - side) / 2), y: top, w: side, h: side };
    const bandTop = top + side + below;
    return {
      kind,
      squareBox,
      headline: { x: squareBox.x, y: bandTop, w: side, h: headH },
      subline: { x: squareBox.x, y: bandTop + headH + textGap, w: side, h: subH },
    };
  }

  const short = Math.min(W, H);
  const margin = Math.round(short * 0.05);
  const side = Math.max(1, short - 2 * margin);
  const squareBox: Rect = { x: Math.round((W - side) / 2), y: Math.round((H - side) / 2), w: side, h: side };
  const scrimH = px(H / 6);
  const scrim: Rect = { x: 0, y: H - scrimH, w: W, h: scrimH };
  const pad = Math.round(scrimH * 0.12);
  const inner = Math.max(2, scrimH - 2 * pad);
  const textGap = Math.round(inner * 0.06);
  const headH = px((inner - textGap) * 0.64);
  const subH = Math.max(1, inner - textGap - headH);
  return {
    kind,
    squareBox,
    headline: { x: squareBox.x, y: scrim.y + pad, w: side, h: headH },
    subline: { x: squareBox.x, y: scrim.y + pad + headH + textGap, w: side, h: subH },
    scrim,
  };
}

// ── Shards ─────────────────────────────────────────────────────────────────

/** The gap in canvas px: `gapPx` is measured at 1080 on the canvas's short side, clamped to 0..24. */
export function scaledGap(gapPx: number, W: number, H: number): number {
  const g = Number.isFinite(gapPx) ? Math.min(24, Math.max(0, gapPx)) : 0;
  return Math.round((g * Math.min(W, H)) / 1080);
}

export type ShardGrid = {
  n: number;
  /** Gap actually used, px (0 when the square is too small for the asked gap). */
  gap: number;
  /** Side of one shard, px. */
  cell: number;
  /** The snapped square: n * cell + (n - 1) * gap on a side, centred in the box. */
  square: Rect;
  /** One square per shard, row-major (index = row * n + col). */
  rects: Rect[];
};

/**
 * Split the square box into n x n integer squares with `gap` px between them.
 * The side is snapped down so `(side - (n - 1) * gap)` divides by n, and the
 * snapped square is centred in the box (it moves by less than n px).
 */
export function shardGrid(box: Rect, n: number, gapPx: number): ShardGrid {
  const side = Math.min(box.w, box.h);
  let gap = Math.max(0, Math.round(gapPx));
  if (side - (n - 1) * gap < n) gap = 0;
  const cell = Math.max(1, Math.floor((side - (n - 1) * gap) / n));
  const S = n * cell + (n - 1) * gap;
  const square: Rect = {
    x: box.x + Math.floor((box.w - S) / 2),
    y: box.y + Math.floor((box.h - S) / 2),
    w: S,
    h: S,
  };
  const rects: Rect[] = [];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      rects.push({ x: square.x + c * (cell + gap), y: square.y + r * (cell + gap), w: cell, h: cell });
    }
  }
  return { n, gap, cell, square, rects };
}

/**
 * Which pixels of the picture each shard shows: the centred square crop
 * (`side = min(w, h)`, offset by half the overflow) split into n x n integer
 * rects in SOURCE px, row-major. The last row and column absorb the
 * remainder, so the crop is covered exactly (no gap, no overlap). Null when
 * the picture is smaller than n px on its short side.
 */
export function sourceRects(imgW: number, imgH: number, n: number): Rect[] | null {
  const w = Math.floor(imgW);
  const h = Math.floor(imgH);
  const side = Math.min(w, h);
  const base = Math.floor(side / n);
  if (!(base >= 1)) return null;
  const ox = Math.floor((w - side) / 2);
  const oy = Math.floor((h - side) / 2);
  const span = (i: number) => (i === n - 1 ? side - (n - 1) * base : base);
  const out: Rect[] = [];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      out.push({ x: ox + c * base, y: oy + r * base, w: span(c), h: span(r) });
    }
  }
  return out;
}

// ── Order ──────────────────────────────────────────────────────────────────

/**
 * The shard indices (row-major) in the order they land.
 *
 * - rows: row-major;
 * - center: nearest the square's centre first, ties row-major;
 * - shuffle: Fisher-Yates with `mulberry32(seed)`. The same seed always gives
 *   the same order.
 */
export function landingOrder(n: number, order: ShardOrder, seed: number): number[] {
  const N = n * n;
  const idx = Array.from({ length: N }, (_, i) => i);
  if (order === "rows") return idx;
  if (order === "center") {
    // Twice the offset from the centre, so the distance stays an integer.
    const d2 = (i: number) => {
      const r = Math.floor(i / n);
      const c = i % n;
      return (2 * r - (n - 1)) ** 2 + (2 * c - (n - 1)) ** 2;
    };
    return idx.sort((a, b) => d2(a) - d2(b) || a - b);
  }
  const rng = mulberry32(seed);
  for (let i = N - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = idx[i];
    idx[i] = idx[j];
    idx[j] = t;
  }
  return idx;
}

// ── Timing ─────────────────────────────────────────────────────────────────

/**
 * The tapped beats on the clip's timeline, seconds, ascending: every TIMED
 * cue's `startMs` moved by the song start (`windowMs`), taps at or before
 * `MIN_TAP_SEC` dropped. Beats are anonymous (any text), so they are sorted:
 * shard j in landing order lands on the j-th beat.
 */
export function beatTimes(cues: readonly MosaicTimedCue[], songStartSec: number): number[] {
  const startMs = songStartOf(songStartSec * 1000);
  const out: number[] = [];
  for (const cue of cues) {
    if (typeof cue.startMs !== "number" || !Number.isFinite(cue.startMs)) continue;
    const t = sec3(windowMs(cue.startMs, startMs) / 1000);
    if (t > MIN_TAP_SEC) out.push(t);
  }
  return out.sort((a, b) => a - b);
}

export type RevealTiming = {
  /** Landing time of the j-th shard in landing order, s (ascending). */
  land: number[];
  /** When the move of the j-th shard starts, s (>= 0). */
  rampStart: number[];
  /** How long the move of the j-th shard takes, s (> 0). */
  rampDur: number[];
  /** When the cover is complete: max(revealSec, last tap + TAIL_SEC). */
  revealEnd: number;
  headlineAt: number;
  sublineAt: number;
  /** Taps actually used (at most one per shard). */
  tapped: number;
};

/**
 * When each shard lands. Shard j takes tap j; the untimed rest spread evenly
 * after the last tap (or from `UNTIMED_FROM_SEC`) up to `revealEnd`, the last
 * one landing exactly on it.
 */
export function revealTiming(count: number, taps: readonly number[], revealSec: number): RevealTiming {
  const used = taps.slice(0, count).map(sec3);
  const lastTap = used.length > 0 ? used[used.length - 1] : undefined;
  const revealEnd = sec3(lastTap === undefined ? revealSec : Math.max(revealSec, lastTap + TAIL_SEC));
  const land = [...used];
  const k = count - used.length;
  if (lastTap === undefined) {
    for (let i = 0; i < k; i++) {
      land.push(sec3(k === 1 ? revealEnd : UNTIMED_FROM_SEC + (i * (revealEnd - UNTIMED_FROM_SEC)) / (k - 1)));
    }
  } else {
    for (let i = 0; i < k; i++) land.push(sec3(lastTap + ((i + 1) * (revealEnd - lastTap)) / k));
  }
  const rampStart = land.map((t) => sec3(Math.max(0, t - RAMP_SEC)));
  const rampDur = land.map((t, j) => Math.max(0.001, sec3(t - rampStart[j])));
  return {
    land,
    rampStart,
    rampDur,
    revealEnd,
    headlineAt: sec3(revealEnd + HEADLINE_DELAY_SEC),
    sublineAt: sec3(revealEnd + SUBLINE_DELAY_SEC),
    tapped: used.length,
  };
}
