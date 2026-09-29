import type { Rect, TextAlign, TypesetOptions, TypesetPage } from "../../../_shared/glyph-text";
import { fitWordToBox, normalizeForFont, typesetPage, wordTile } from "../../../_shared/glyph-text";

import type { RevealMode } from "./reveal";

/**
 * Word layout: where each word of a page sits, as a glyph-outline tile in
 * ROOT canvas px. Pure, deterministic; the glyph engine reads the font file.
 *
 *   cumulative / line  the page is typeset into the lyric box (greedy lines,
 *                      shrink ladder, the chosen alignment), one tile per word
 *                      on its line's baseline;
 *   word               every word ALONE, fitted to the lyric box and centred in
 *                      it (capped at `soloMaxPx`), so the centre never moves
 *                      from word to word.
 *
 * CUSTOM LAYOUT (`applyWordBoxes`). Make writes the whole `wordBoxes` list
 * whenever one word is dragged, every sibling pinned at the rect it was
 * painted in. So a box within 1 px of the word's own tile rect is UNTOUCHED
 * (the word keeps following size, alignment and position), and a moved or
 * resized box re-fits the word inside it, centred (`fitWordToBox`): a bigger
 * box is a bigger word and its centre stays put.
 *
 * ON THE CANVAS, ALWAYS. A word tile whose rect leaves the canvas cannot be
 * placed (`placeInsetPieces` throws, and the whole render fails). So:
 *   - a page too big for the box even at the shrink ladder's floor (a very
 *     long token, dozens of forced line breaks) keeps shrinking, below the
 *     floor, until it fits the box (which lies inside the canvas);
 *   - every word is then checked against the canvas (`keepOnCanvas`): one
 *     that still leaves it is re-fitted into the part of its rect the canvas
 *     shows, and when even the smallest word overflows that (a box dragged to
 *     a sliver at the edge, narrower than the padding), the whole tile slides
 *     in. Its path is rect-local, so moving the rect moves the glyphs with it;
 *     the rect is never cropped under its mask. A word that fits nowhere on
 *     the canvas (thousands of characters) is not drawn; a word the artist
 *     boxed falls back to its own layout instead, so the words a clip draws,
 *     and with them the `wordBoxes` slots, never depend on a box.
 *
 * Text goes through `normalizeForFont` first: curly quotes, ellipses, dashes
 * and no-break spaces that the font lacks become ASCII stand-ins, and what
 * is still missing is reported (it would draw as the font's `.notdef`).
 */

export type LayoutWordInput = {
  /** Global reading-order index in the lyrics (it rides along; layout never reads it). */
  index: number;
  text: string;
  atMs: number;
  lineBreakBefore: boolean;
};

export type LaidWord = {
  index: number;
  /** The text as drawn (normalized for the font). Empty = nothing to draw. */
  text: string;
  atMs: number;
  /** Line number inside the page (in `word` mode every word is its own line). */
  line: number;
  fontPx: number;
  /** Integer root-canvas px: the tile's rect (and the rect Make drags). */
  rect: Rect;
  /** Glyph outlines in rect-local px (`inline-mask` localPath); `""` for an empty word. */
  d: string;
  /** True when the rect came from the artist's `wordBoxes` entry. */
  moved: boolean;
};

export type PageLayoutOptions = {
  /** The lyric box, root canvas px. */
  box: Rect;
  /** Requested size, px (the page shrinks from here when it does not fit). */
  fontPx: number;
  align: TextAlign;
  fontPath: string | undefined;
  /** Padding around every word tile, px (the same value for typesetting and tiles). */
  pad: number;
  mode: RevealMode;
  /** `word` mode: the largest size a lone word grows to, px. */
  soloMaxPx: number;
  /** The canvas every word tile must stay inside, px (the page children are full-canvas). */
  canvas: Canvas;
};

/** A canvas size, px. */
export type Canvas = { W: number; H: number };

/** The smallest size a page shrinks to below the ladder's floor, px. */
const MIN_PAGE_PX = 1;
/** How close the below-the-floor search gets to the largest size that fits, px. */
const SHRINK_STEP_PX = 0.5;

export type PageLayout = {
  words: LaidWord[];
  /** The page's representative size, px (typeset size, or the mean solo size). */
  fontPx: number;
  /** Characters the font lacks (drawn as `.notdef`), each once. */
  missing: string[];
};

function tile(text: string, x: number, baseline: number, fontPx: number, fontPath: string | undefined, pad: number) {
  const px = Math.max(1, fontPx);
  const t = wordTile(text, x, baseline, px, fontPath, { pad });
  return { rect: t.rect, d: t.d, fontPx: px };
}

/** True when `r` lies wholly inside the canvas. */
export function onCanvas(r: Rect, canvas: Canvas): boolean {
  return r.x >= 0 && r.y >= 0 && r.w >= 1 && r.h >= 1 && r.x + r.w <= canvas.W && r.y + r.h <= canvas.H;
}

/**
 * `w` placed inside the canvas (unchanged when it already is), or `null`
 * when no size of it fits there. See ON THE CANVAS, ALWAYS.
 */
function placeOnCanvas(w: LaidWord, canvas: Canvas, fontPath: string | undefined, pad: number): LaidWord | null {
  if (w.text === "" || onCanvas(w.rect, canvas)) return w;
  let t = w;
  const x0 = Math.max(0, w.rect.x);
  const y0 = Math.max(0, w.rect.y);
  const x1 = Math.min(canvas.W, w.rect.x + w.rect.w);
  const y1 = Math.min(canvas.H, w.rect.y + w.rect.h);
  if (x1 > x0 && y1 > y0) {
    const fit = fitWordToBox(w.text, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, fontPath, { align: "center", pad });
    t = { ...w, ...tile(w.text, fit.x, fit.baseline, fit.fontPx, fontPath, pad) };
    if (onCanvas(t.rect, canvas)) return t;
  }
  if (t.rect.w > canvas.W || t.rect.h > canvas.H) return null;
  const x = Math.min(Math.max(0, t.rect.x), canvas.W - t.rect.w);
  const y = Math.min(Math.max(0, t.rect.y), canvas.H - t.rect.h);
  return { ...t, rect: { ...t.rect, x, y } };
}

/** Every word inside the canvas; one that fits nowhere on it is emptied (not drawn). */
export function keepOnCanvas(
  words: readonly LaidWord[],
  canvas: Canvas,
  fontPath: string | undefined,
  pad: number,
): LaidWord[] {
  return words.map((w) => placeOnCanvas(w, canvas, fontPath, pad) ?? { ...w, text: "", d: "" });
}

/**
 * A page that does not fit its box even at the shrink ladder's floor: the
 * largest size below the floor (to {@link SHRINK_STEP_PX}) at which it fits,
 * or the floor's layout when nothing fits even at {@link MIN_PAGE_PX} (the
 * canvas check then takes over).
 */
function shrinkPastFloor(
  texts: readonly string[],
  box: Rect,
  common: Omit<TypesetOptions, "fontPx" | "minScale">,
  floor: TypesetPage,
): TypesetPage {
  const at = (px: number) => typesetPage(texts, box, { ...common, fontPx: px, minScale: 1 });
  let best = at(MIN_PAGE_PX);
  if (!best.fits) return floor;
  let lo = MIN_PAGE_PX;
  let hi = floor.fontPx;
  while (hi - lo > SHRINK_STEP_PX) {
    const mid = (lo + hi) / 2;
    const set = at(mid);
    if (set.fits) {
      lo = mid;
      best = set;
    } else {
      hi = mid;
    }
  }
  return best;
}

/** Lay one page's words into `opts.box`, every tile inside `opts.canvas`. */
export function layoutPage(words: readonly LayoutWordInput[], opts: PageLayoutOptions): PageLayout {
  const missing: string[] = [];
  const texts = words.map((w) => {
    const n = normalizeForFont(w.text, opts.fontPath);
    for (const ch of n.missing) if (!missing.includes(ch)) missing.push(ch);
    return n.text;
  });
  if (words.length === 0) return { words: [], fontPx: opts.fontPx, missing };

  if (opts.mode === "word") {
    const laid = words.map((w, k): LaidWord => {
      const fit = fitWordToBox(texts[k] || " ", opts.box, opts.fontPath, {
        align: "center",
        maxPx: opts.soloMaxPx,
        pad: opts.pad,
      });
      return {
        index: w.index,
        text: texts[k],
        atMs: w.atMs,
        line: k,
        ...tile(texts[k], fit.x, fit.baseline, fit.fontPx, opts.fontPath, opts.pad),
        moved: false,
      };
    });
    const mean = laid.reduce((s, w) => s + w.fontPx, 0) / laid.length;
    return { words: keepOnCanvas(laid, opts.canvas, opts.fontPath, opts.pad), fontPx: mean, missing };
  }

  const common = {
    align: opts.align,
    fontPath: opts.fontPath,
    pad: opts.pad,
    lineBreaksBefore: words.map((w) => w.lineBreakBefore),
  };
  let set = typesetPage(texts, opts.box, { ...common, fontPx: opts.fontPx });
  if (!set.fits) set = shrinkPastFloor(texts, opts.box, common, set);
  const laid: LaidWord[] = new Array(words.length);
  set.lines.forEach((line, li) => {
    for (const tw of line.words) {
      const w = words[tw.index];
      laid[tw.index] = {
        index: w.index,
        text: texts[tw.index],
        atMs: w.atMs,
        line: li,
        ...tile(texts[tw.index], tw.x, line.baseline, set.fontPx, opts.fontPath, opts.pad),
        moved: false,
      };
    }
  });
  return { words: keepOnCanvas(laid, opts.canvas, opts.fontPath, opts.pad), fontPx: set.fontPx, missing };
}

/** Two rects within `tol` px on every edge measure. */
export function sameBox(a: Rect, b: Rect, tol = 1): boolean {
  return (
    Math.abs(a.x - b.x) <= tol && Math.abs(a.y - b.y) <= tol && Math.abs(a.w - b.w) <= tol && Math.abs(a.h - b.h) <= tol
  );
}

/**
 * The artist's word boxes over the laid-out words (already on the canvas).
 * `boxes[k]` is `words[k]`'s box in root canvas px, aligned with `words`
 * (null or missing = no box: the word keeps its layout). The caller decides
 * which `wordBoxes` element belongs to which word, and whether the list
 * applies at all. A box within 1 px of the word's own rect is untouched; any
 * other box re-fits the word, centred, kept on the canvas; a word no size of
 * which fits there keeps its own layout.
 */
export function applyWordBoxes(
  words: readonly LaidWord[],
  boxes: ReadonlyArray<Rect | null | undefined>,
  fontPath: string | undefined,
  pad: number,
  canvas: Canvas,
): LaidWord[] {
  return words.map((w, k) => {
    const b = boxes[k];
    if (!b || w.text === "" || sameBox(b, w.rect)) return w;
    const fit = fitWordToBox(w.text, b, fontPath, { align: "center", pad });
    const boxed: LaidWord = { ...w, ...tile(w.text, fit.x, fit.baseline, fit.fontPx, fontPath, pad), moved: true };
    return placeOnCanvas(boxed, canvas, fontPath, pad) ?? w;
  });
}
