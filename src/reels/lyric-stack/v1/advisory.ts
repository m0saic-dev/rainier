import { measureText, wrapMeasured } from "@m0saic/template-utils";

import type { Rect } from "../../../_shared/glyph-text";
import type { PlatformStage } from "../../../_shared/platforms";

/**
 * The design advisory: the plain-words notes Make shows while the artist
 * edits (the platform's length limit, a font that could not be used, Word
 * positions that were reset, characters the font lacks). Design only; never
 * in an export. Pure, no ctx.
 *
 * ITS OWN RECT, never the whole canvas: a full-canvas tile takes the pointer
 * over the whole frame in Make (a zero-alpha background changes nothing), so
 * no word under it could be hovered or dragged. The strip sits at the TOP of
 * the safe area, just under the app's nav row, `margin` in from the safe
 * edges and left of the action rail wherever the two share a row. It never
 * covers a drawn word when it can help it (`layoutAdvisory`):
 *   1. the top strip; else the BOTTOM of the safe area, just above the
 *      caption; else the first band down the safe area that touches no word;
 *   2. else the notes collapse to ONE line (the first note, "(+N more)") in
 *      the first free place of the same kind;
 *   3. else that one line where it overlaps the least word area.
 * (The document paints the advisory UNDER the lyrics, so even case 3 leaves
 * every word on top, hoverable and draggable.)
 *
 * WRAPPED, never cut off: the engine's svg text does not wrap, so the lines
 * are broken here with `wrapMeasured`, measured with the bundled face the
 * svg rasterizer draws with (Make's preview draws the same face with the
 * same breaks: `white-space: pre`, line height 1.25). Each note starts on its
 * own line; the size steps down (to 80 %, still readable) until the notes fit
 * in at most ADVISORY_MAX_LINES lines, EVERY line inside the text width. At
 * the floor a word that is still wider than the strip on its own (a long file
 * name) is shortened in the middle, keeping its end ("MyHandLet...FINAL.woff2"),
 * and a note past the line cap is cut with "..." on the last line. The text
 * is measured against 92 % of the strip, slack for a preview that falls back
 * to a wider face.
 *
 * DRAWABLE, never tofu: the bundled face covers ASCII and Latin-1 plus Latin
 * Extended-A (U+0020-U+007E, U+00A0-U+017F, checked against its cmap); any
 * other character in a note (a file name, say) is shown as "?".
 */

/** At most this many lines in the strip (three notes wrap to about five on a narrow canvas). */
export const ADVISORY_MAX_LINES = 6;
/** Share of the strip's width the text may use. */
export const ADVISORY_TEXT_FRAC = 0.92;

export type AdvisoryLayout = {
  /** The strip, canvas px. */
  rect: Rect;
  /** The wrapped notes, "\n"-joined: one svg text layer. */
  text: string;
  lines: number;
  fontSize: number;
};

export type AdvisoryOptions = {
  W: number;
  H: number;
  stage: PlatformStage;
  /** Rects the strip should not cover (the drawn words, canvas px). */
  avoid?: readonly Rect[];
};

/** True for a character the bundled face draws. */
export const drawable = (ch: string): boolean => {
  const cp = ch.codePointAt(0) ?? 0;
  return (cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0x17f);
};

/** A note with every character the bundled face lacks shown as "?". */
export const drawableText = (s: string): string =>
  Array.from(s.replace(/\s+/g, " ").trim())
    .map((ch) => (drawable(ch) ? ch : "?"))
    .join("");

/** A character named for a note: itself in quotes when drawable, else its code point. */
export const nameChar = (ch: string): string =>
  drawable(ch) ? JSON.stringify(ch) : `U+${(ch.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0")}`;

const intersects = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const overlapArea = (a: Rect, b: Rect): number =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

const widthOf = (s: string, fontSize: number): number => measureText(s, { fontSize }).width;

/**
 * `token` shortened in the middle until it fits `maxW` ("MyHandLet...FINAL.woff2"):
 * the most characters that fit, split evenly between its start and its end
 * (the end keeps a file's extension). Unchanged when it already fits.
 */
export function shortenToken(token: string, fontSize: number, maxW: number): string {
  if (widthOf(token, fontSize) <= maxW) return token;
  const chars = Array.from(token);
  const cut = (n: number) => `${chars.slice(0, Math.ceil(n / 2)).join("")}...${chars.slice(chars.length - Math.floor(n / 2)).join("")}`;
  let lo = 0;
  let hi = chars.length - 1;
  // The widest cut that fits: width grows with n, so bisect.
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (widthOf(cut(mid), fontSize) <= maxW) lo = mid;
    else hi = mid - 1;
  }
  return cut(lo);
}

/** `line` shortened word by word until it fits `maxW` with "..." after it. */
function ellipsize(line: string, fontSize: number, maxW: number): string {
  const words = line.split(" ");
  while (words.length > 1 && widthOf(`${words.join(" ")}...`, fontSize) > maxW) words.pop();
  const out = `${words.join(" ")}...`;
  return widthOf(out, fontSize) <= maxW
    ? out
    : `${shortenToken(words.join(" "), fontSize, Math.max(1, maxW - widthOf("...", fontSize)))}...`;
}

const fits = (lines: readonly string[], fontSize: number, textW: number, maxLines: number): boolean =>
  lines.length <= maxLines && lines.every((l) => widthOf(l, fontSize) <= textW);

/**
 * Wrap every note at the largest size (down to `minPx`) at which the lines
 * fit `maxLines` and every one fits `textW`; at the floor, shorten any word
 * wider than `textW` on its own, and cut past the line cap with "...".
 */
function wrapNotes(
  notes: readonly string[],
  textW: number,
  fontPx: number,
  minPx: number,
  maxLines: number,
): { lines: string[]; fontSize: number } {
  const wrap = (fontSize: number, shorten: boolean) =>
    notes.flatMap((n) =>
      wrapMeasured(shorten ? n.split(" ").map((t) => shortenToken(t, fontSize, textW)).join(" ") : n, fontSize, textW),
    );
  for (let fontSize = fontPx; fontSize > minPx; fontSize--) {
    const lines = wrap(fontSize, false);
    if (fits(lines, fontSize, textW, maxLines)) return { lines, fontSize };
  }
  let lines = wrap(minPx, true);
  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    lines[maxLines - 1] = ellipsize(lines[maxLines - 1], minPx, textW);
  }
  return { lines, fontSize: minPx };
}

/**
 * Where the advisory goes and what it says, or null when there is nothing to
 * say. Deterministic.
 */
export function layoutAdvisory(notes: readonly string[], opts: AdvisoryOptions): AdvisoryLayout | null {
  const clean = notes.map(drawableText).filter((n) => n !== "");
  if (clean.length === 0) return null;
  const W = Math.max(1, Math.round(opts.W));
  const { safe, rail } = opts.stage;
  const margin = Math.max(4, Math.round(W * 0.02));
  const fontPx = Math.max(10, Math.round(W * 0.026));
  const minPx = Math.max(8, Math.round(fontPx * 0.8));
  const x = safe.x + margin;
  const safeRight = safe.x + safe.w - margin;
  const top = safe.y + margin;
  const bottom = safe.y + safe.h - margin;

  // The same notes at the same width wrap the same way: measure once.
  const wrapped = new Map<string, { lines: string[]; fontSize: number }>();
  const wrapAt = (texts: readonly string[], maxLines: number, textW: number) => {
    const key = `${maxLines}|${textW}|${texts.join("\n")}`;
    let hit = wrapped.get(key);
    if (!hit) {
      hit = wrapNotes(texts, textW, fontPx, minPx, maxLines);
      wrapped.set(key, hit);
    }
    return hit;
  };

  /**
   * The strip holding `texts`, its top at `at.top` or its bottom at
   * `at.bottom` (inside the safe area), left of the rail wherever the two
   * share a row (a narrower strip may wrap taller: check again).
   */
  const strip = (texts: readonly string[], maxLines: number, at: { top: number } | { bottom: number }): AdvisoryLayout => {
    let right = safeRight;
    for (;;) {
      const w = Math.max(1, right - x);
      const { lines, fontSize } = wrapAt(texts, maxLines, Math.max(1, Math.floor(w * ADVISORY_TEXT_FRAC)));
      const padY = Math.round(fontSize * 0.5);
      const h = lines.length * Math.round(fontSize * 1.25) + 2 * padY;
      const y = "top" in at ? at.top : Math.max(safe.y, at.bottom - h);
      const railRight = rail && rail.y < y + h && y < rail.y + rail.h ? Math.min(right, rail.x - margin) : right;
      if (railRight < right && railRight > x) {
        right = railRight;
        continue;
      }
      return { rect: { x, y, w, h }, text: lines.join("\n"), lines: lines.length, fontSize };
    }
  };

  const avoid = opts.avoid ?? [];
  const covers = (a: AdvisoryLayout) => avoid.some((r) => intersects(r, a.rect));
  /**
   * Top, bottom, then bands down the safe area, top first: every quarter
   * strip, and just under every word (a free band slid up stops at the top or
   * at a word's bottom edge, so those find every gap a band fits).
   */
  function* places(texts: readonly string[], maxLines: number): Generator<AdvisoryLayout> {
    const first = strip(texts, maxLines, { top });
    yield first;
    yield strip(texts, maxLines, { bottom });
    const step = Math.max(4, Math.round(first.rect.h / 4));
    const ys = new Set<number>();
    for (let y = top + step; y < bottom; y += step) ys.add(y);
    for (const r of avoid) if (r.y + r.h > top && r.y + r.h < bottom) ys.add(r.y + r.h);
    for (const y of [...ys].sort((a, b) => a - b)) {
      const s = strip(texts, maxLines, { top: y });
      if (s.rect.y + s.rect.h <= bottom) yield s;
    }
  }
  const firstFree = (texts: readonly string[], maxLines: number): AdvisoryLayout | null => {
    for (const a of places(texts, maxLines)) if (!covers(a)) return a;
    return null;
  };

  const full = firstFree(clean, ADVISORY_MAX_LINES);
  if (full) return full;
  // One line: the first note, and how many more there are.
  const one = [`${clean[0]}${clean.length > 1 ? ` (+${clean.length - 1} more)` : ""}`];
  const oneFree = firstFree(one, 1);
  if (oneFree) return oneFree;
  const cost = (a: AdvisoryLayout) => avoid.reduce((sum, r) => sum + overlapArea(r, a.rect), 0);
  let best: AdvisoryLayout | null = null;
  for (const a of places(one, 1)) if (!best || cost(a) < cost(best)) best = a;
  return best as AdvisoryLayout;
}
