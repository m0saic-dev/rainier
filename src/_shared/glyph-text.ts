import { measureText, textToPath } from "@m0saic/template-utils";

/**
 * Glyph text: lyrics typeset as SVG glyph OUTLINES cut from a real font file.
 * Pure, deterministic, no ctx, no fs (the glyph engine reads the font).
 *
 * THE TILE. Every word is its own rect: a colour tile whose `inline-mask`
 * is the word's outline. The engine rasterises the mask with
 * `viewBox = 0 0 bounds.width bounds.height` stretched onto the tile, so
 * `wordTile` returns `bounds = { x: 0, y: 0, width: rect.w, height: rect.h }`
 * and a path in the rect's OWN px space, with the rect in integer px. The
 * rect is rounded outward and the fractional remainder goes into the path's
 * offset, so a word's baseline and pen position land exactly (to the path's
 * 0.01 px) where the typesetter put them.
 *
 * ONE BASELINE PER LINE. A tile's top and height come from the FONT's
 * ascent and descent, not the word's own ink, so "on" and "the" on one line
 * share one baseline inside identical rects (the triptych's drawtext placed
 * words by their tallest glyph, so the two drifted).
 *
 * INK THAT LEAVES THE FONT BLOCK. Some faces draw outside the advance box
 * and the ascent/descent block: script swashes (Pacifico runs ~0.13 em past
 * its advance), leaning display faces (Bangers), accents over capitals (an
 * A-ring in Archivo Black climbs 0.08 em above the ascent). A mask clips at its
 * bounds, so a rect cut to the font block would shave those glyphs. Every
 * measurement here therefore uses a word's EXTENT: the union of its advance
 * box x ascent/descent block and its ink bounding box. For nearly every word
 * in nearly every font the two are the same box; where the ink overhangs,
 * the rect grows to hold it (baseline unchanged), `typesetPage` keeps the
 * overhang inside the box it was given, and `fitWordToBox` fits and centres
 * the extent, so a tile's rect is the box it was fitted to and a dragged
 * tile round-trips without growing or drifting.
 *
 * UNITS. Every size and position is px in the caller's space (canvas, or a
 * page child's local space, whichever `box` / `x` / `baseline` are in).
 * `fontPx` is the em size. `fontPath` is an absolute font file path, or
 * `undefined` for the glyph engine's bundled Roboto.
 *
 * FONT ERRORS. Every function THROWS when the engine cannot read `fontPath`
 * (missing file, not a font, WOFF2). Check a user's font once with
 * `fontError` before drawing with it.
 *
 * MEMO. Advances, kerning and outlines are linear in size, so each font's
 * numbers are measured once in em units (per font path, per word) and
 * scaled by `fontPx`; a shrink ladder costs no extra parsing. The memo is
 * keyed by path for the life of the process, like the glyph engine's own
 * parsed-font cache: a font file replaced in place is not re-read.
 *
 * COVERAGE. A character the font lacks draws as `.notdef` (usually a box).
 * `glyphCoverage` finds them by comparing each character's outline and
 * advance with `.notdef`'s; `normalizeForFont` swaps the typographic
 * characters Apple Notes types (curly quotes, ellipsis, dashes, no-break
 * space) for ASCII when the font lacks them, and reports the rest.
 *
 * `_shared` is frozen once shipped: a change is a copy beside a new template
 * version, never an edit here.
 */

/** A rectangle in px, in the caller's space. */
export type Rect = { x: number; y: number; w: number; h: number };

/** How a page's lines sit in their box. Justify spreads each line edge to edge; a lone word sits left. */
export type TextAlign = "justify" | "left" | "center";

/** How one fitted word sits in its box horizontally (`justify` = `left`: a lone word sits left). */
export type WordAlign = "left" | "center" | "right" | "justify";

/** Line pitch as a multiple of the font size (the triptych's, measured off real posts). */
export const LINE_HEIGHT = 1.28;

/** The smallest fraction of the requested size a page shrinks to. */
export const MIN_SCALE = 0.38;

/** Shrink steps a page tries in order (fractions of the requested size), the triptych's ladder. */
export const FIT_LADDER: readonly number[] = Object.freeze([
  1, 0.93, 0.86, 0.8, 0.74, 0.68, 0.62, 0.56, 0.5, 0.44, 0.38,
]);

/** Font-wide metrics at one size, px. */
export type FontMetrics = {
  /** Above the baseline (the font's hhea ascender). */
  ascent: number;
  /** Below the baseline, positive (the font's hhea descender). */
  descent: number;
  /** Advance of the space glyph. */
  spaceWidth: number;
};

export type TypesetOptions = {
  /** Requested em size, px (> 0). The page shrinks from here when it does not fit. */
  fontPx: number;
  align: TextAlign;
  /** Font file; `undefined` = the glyph engine's bundled Roboto. */
  fontPath?: string;
  /** Baseline pitch as a multiple of the font size. Default `LINE_HEIGHT` (1.28). */
  lineHeight?: number;
  /** Floor of the shrink ladder, 0 < minScale <= 1. Default `MIN_SCALE` (0.38). */
  minScale?: number;
  /** `lineBreaksBefore[i]` starts a new line at word `i` (ignored for the first word). */
  lineBreaksBefore?: readonly boolean[];
  /** The `pad` the caller will pass to `wordTile`, px (default 0), so the padded tiles stay inside the box. */
  pad?: number;
};

export type TypesetWord = {
  /** The word's index in the input (reading order). */
  index: number;
  text: string;
  /** Pen origin: left edge of the word's advance box, px. Hand it to `wordTile`. */
  x: number;
  /** Advance width with kerning, px. */
  width: number;
};

export type TypesetLine = {
  /** The line's baseline, px. Hand it to `wordTile`. */
  baseline: number;
  words: TypesetWord[];
};

export type TypesetPage = {
  /** The size the page was set at, px (the requested size times a ladder step). */
  fontPx: number;
  lines: TypesetLine[];
  /**
   * True when every line and the block fit the box. False only at the
   * ladder's floor (the page is too long for the box: split it) or when a
   * single word is wider than the box even at the floor.
   */
  fits: boolean;
};

export type WordTileOptions = {
  /** Extra px around the word's extent on every side (default 0). */
  pad?: number;
};

/** One word as a masked colour tile. */
export type WordTile = {
  /** Integer px, in the same space as the `x` / `baseline` given. */
  rect: Rect;
  /** SVG path of the glyph outlines in rect-local px; `""` for an empty word. */
  d: string;
  /** The `inline-mask` bounds: always the rect's own size at the origin. */
  bounds: { x: 0; y: 0; width: number; height: number };
};

export type FitWordOptions = {
  /** Horizontal placement of the word in the box. Default `"center"`. */
  align?: WordAlign;
  /** Cap on the fitted em size, px. */
  maxPx?: number;
  /** The `pad` the caller will pass to `wordTile`, px (default 0). */
  pad?: number;
};

export type FittedWord = {
  /** Em size, px. */
  fontPx: number;
  /** Pen origin, px. */
  x: number;
  /** Baseline, px. */
  baseline: number;
};

export type NormalizedText = {
  text: string;
  /** Characters the font lacks and nothing stood in for, each once, in order of first appearance. */
  missing: string[];
};

// ── Per-font memo, em units ────────────────────────────────────────────────

/** An em-unit box relative to the pen origin and the baseline, y down (top < 0 is above the baseline). */
type EmBox = { left: number; top: number; right: number; bottom: number };

type WordEm = {
  advance: number;
  /** The union of the advance box x ascent/descent block and the ink. */
  extent: EmBox;
};

type FontEm = {
  ascent: number;
  descent: number;
  space: number;
  words: Map<string, WordEm>;
  gaps: Map<string, number>;
  covered: Map<string, boolean>;
  notdef?: { d: string; advance: number };
};

/** Size everything is measured at before scaling (a large em keeps the 2-decimal path exact to 1e-5 em). */
const REF_PX = 1000;
/** Float slack for fits and for integer rounding (sums of kerned advances carry 1e-13 noise). */
const EPS = 1e-6;
/** The smallest size `fitWordToBox` returns when nothing fits. */
const MIN_FONT_PX = 1;
/** A font's word memo is dropped past this many entries (results are identical; only speed changes). */
const WORD_MEMO_CAP = 8192;
/** Memo key for the bundled default font (no user path can contain a NUL). */
const DEFAULT_FONT_KEY = "\u0000bundled";
/** A noncharacter no cmap maps: it always draws `.notdef`. */
const NOTDEF_PROBE = "\uFFFF";

const FONTS = new Map<string, FontEm>();

function fontEm(fontPath: string | undefined): FontEm {
  const key = fontPath ?? DEFAULT_FONT_KEY;
  let f = FONTS.get(key);
  if (!f) {
    const m = measureText(" ", { fontSize: REF_PX, fontPath });
    f = {
      ascent: m.ascent / REF_PX,
      descent: m.descent / REF_PX,
      space: m.width / REF_PX,
      words: new Map(),
      gaps: new Map(),
      covered: new Map(),
    };
    FONTS.set(key, f);
  }
  return f;
}

function advanceEm(text: string, fontPath: string | undefined): number {
  return text ? measureText(text, { fontSize: REF_PX, fontPath }).width / REF_PX : 0;
}

/** The outline of `text` at REF_PX with its pen at x = 0 and its baseline at y = ascent. */
function refPath(text: string, fontPath: string | undefined): string {
  return textToPath(text, { fontSize: REF_PX, hAlign: "left", vAlign: "top", fontPath }, { width: 1, height: 1 });
}

const NUMBER = /-?\d*\.?\d+(?:e[-+]?\d+)?/gi;

/**
 * Bounding box of a path's points (endpoints and control points: a superset
 * of the ink, since a curve stays inside its control hull). The glyph engine
 * emits only absolute M / L / Q / C / Z, so its numbers are x, y pairs.
 */
function pathBox(d: string): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const nums = d.match(NUMBER);
  if (!nums || nums.length < 2) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i + 1 < nums.length; i += 2) {
    const x = Number(nums[i]);
    const y = Number(nums[i + 1]);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

function wordEm(f: FontEm, fontPath: string | undefined, text: string): WordEm {
  const hit = f.words.get(text);
  if (hit) return hit;
  const advance = advanceEm(text, fontPath);
  const extent: EmBox = { left: 0, top: -f.ascent, right: advance, bottom: f.descent };
  const ink = text ? pathBox(refPath(text, fontPath)) : null;
  if (ink) {
    extent.left = Math.min(extent.left, ink.minX / REF_PX);
    extent.right = Math.max(extent.right, ink.maxX / REF_PX);
    extent.top = Math.min(extent.top, ink.minY / REF_PX - f.ascent);
    extent.bottom = Math.max(extent.bottom, ink.maxY / REF_PX - f.ascent);
  }
  const w: WordEm = { advance, extent };
  if (f.words.size >= WORD_MEMO_CAP) f.words.clear();
  f.words.set(text, w);
  return w;
}

const firstChar = (s: string): string => Array.from(s)[0] ?? "";
const lastChar = (s: string): string => {
  const chars = Array.from(s);
  return chars[chars.length - 1] ?? "";
};

/** The space between two words in em: the space glyph plus the kerning on both sides of it. */
function gapEm(f: FontEm, fontPath: string | undefined, left: string, right: string): number {
  const a = lastChar(left);
  const b = firstChar(right);
  if (!a || !b) return f.space;
  const key = `${a}\u0000${b}`;
  let g = f.gaps.get(key);
  if (g === undefined) {
    g = advanceEm(`${a} ${b}`, fontPath) - advanceEm(a, fontPath) - advanceEm(b, fontPath);
    f.gaps.set(key, g);
  }
  return g;
}

function assertPx(name: string, v: number): void {
  if (!(Number.isFinite(v) && v > 0)) throw new RangeError(`glyph-text: ${name} must be a finite number > 0, got ${v}`);
}

function assertPad(pad: number): void {
  if (!(Number.isFinite(pad) && pad >= 0)) throw new RangeError(`glyph-text: pad must be a finite number >= 0, got ${pad}`);
}

// ── Metrics ────────────────────────────────────────────────────────────────

/**
 * `null` when the glyph engine can read and draw with `fontPath`, else the
 * engine's reason (for logs: it may carry the full path, so show the artist
 * the file NAME, never this text). Never throws. Every other function here
 * THROWS on a font the engine cannot read (missing file, not a font, WOFF2),
 * so a template checks a user's font once, up front, and falls back to a
 * bundled face (`resolveFontPath(choice, { readError: fontError })` in
 * `fonts.ts` does exactly that). A good font is parsed once and memoised; a
 * failure is not remembered, so a file that appears later is picked up.
 */
export function fontError(fontPath: string | undefined): string | null {
  try {
    const f = fontEm(fontPath);
    // A parse can succeed on a file whose outlines are broken: draw one probe word.
    wordEm(f, fontPath, "Ag");
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

/** Ascent, descent and space advance of the font at `fontPx`, px. */
export function fontMetrics(fontPath: string | undefined, fontPx: number): FontMetrics {
  assertPx("fontPx", fontPx);
  const f = fontEm(fontPath);
  return { ascent: f.ascent * fontPx, descent: f.descent * fontPx, spaceWidth: f.space * fontPx };
}

/** Advance width of `text` at `fontPx` with the font's kerning, px. */
export function measureWord(text: string, fontPx: number, fontPath: string | undefined): number {
  assertPx("fontPx", fontPx);
  return wordEm(fontEm(fontPath), fontPath, text).advance * fontPx;
}

/**
 * The space between two words set on one line, px: the space's advance plus
 * the kerning between `left`'s last character and the space and between the
 * space and `right`'s first character.
 */
export function spaceBetween(left: string, right: string, fontPx: number, fontPath: string | undefined): number {
  assertPx("fontPx", fontPx);
  return gapEm(fontEm(fontPath), fontPath, left, right) * fontPx;
}

// ── Coverage ───────────────────────────────────────────────────────────────

/** Layout characters (controls, line and paragraph separators): never drawn, never reported. */
function isLayoutChar(ch: string): boolean {
  const c = ch.codePointAt(0) ?? 0;
  return c < 0x20 || (c >= 0x7f && c <= 0x9f) || c === 0x2028 || c === 0x2029;
}

/**
 * ASCII stand-ins for what Apple Notes (and word processors) type, used only
 * when the font lacks the original. `""` removes an invisible character.
 */
const STAND_INS: Readonly<Record<string, string>> = Object.freeze({
  "\u2018": "'", // left single quote
  "\u2019": "'", // right single quote / apostrophe
  "\u201A": "'", // single low quote
  "\u201B": "'", // single high-reversed quote
  "\u2032": "'", // prime
  "\u201C": '"', // left double quote
  "\u201D": '"', // right double quote
  "\u201E": '"', // double low quote
  "\u201F": '"', // double high-reversed quote
  "\u2033": '"', // double prime
  "\u2026": "...", // ellipsis
  "\u2010": "-", // hyphen
  "\u2011": "-", // non-breaking hyphen
  "\u2012": "-", // figure dash
  "\u2013": "-", // en dash
  "\u2014": "-", // em dash
  "\u2015": "-", // horizontal bar
  "\u2212": "-", // minus sign
  "\u00A0": " ", // no-break space
  "\u2002": " ",
  "\u2003": " ",
  "\u2004": " ",
  "\u2005": " ",
  "\u2006": " ",
  "\u2007": " ",
  "\u2008": " ",
  "\u2009": " ",
  "\u200A": " ",
  "\u202F": " ", // narrow no-break space
  "\u205F": " ",
  "\u3000": " ",
  "\u00AD": "", // soft hyphen
  "\u200B": "", // zero-width space
  "\u200C": "", // zero-width non-joiner
  "\u200D": "", // zero-width joiner
  "\u2060": "", // word joiner
  "\uFEFF": "", // byte-order mark
});

function isCovered(f: FontEm, fontPath: string | undefined, ch: string): boolean {
  const hit = f.covered.get(ch);
  if (hit !== undefined) return hit;
  if (!f.notdef) f.notdef = { d: refPath(NOTDEF_PROBE, fontPath), advance: advanceEm(NOTDEF_PROBE, fontPath) };
  let covered = !(refPath(ch, fontPath) === f.notdef.d && advanceEm(ch, fontPath) === f.notdef.advance);
  // A BLANK `.notdef` (Pacifico, Righteous: no outline, the space's advance)
  // draws exactly like a space, so a space-like character cannot be judged by
  // its outline, and it draws as a blank either way: count it as covered.
  // (Without this, those faces reported the plain space as missing.)
  if (!covered && f.notdef.d === "" && (ch === " " || STAND_INS[ch] === " ")) covered = true;
  f.covered.set(ch, covered);
  return covered;
}

/**
 * Characters of `text` the font has no glyph for (they would draw as
 * `.notdef`), each once, in order of first appearance. Controls and line
 * breaks are never reported, and neither is a space-like character in a
 * face whose `.notdef` is blank (it draws as a blank anyway).
 */
export function glyphCoverage(text: string, fontPath: string | undefined): string[] {
  const f = fontEm(fontPath);
  const missing: string[] = [];
  for (const ch of Array.from(text)) {
    if (isLayoutChar(ch) || missing.includes(ch)) continue;
    if (!isCovered(f, fontPath, ch)) missing.push(ch);
  }
  return missing;
}

/**
 * `text` made drawable in the font: a character the font lacks becomes its
 * ASCII stand-in (U+2018 / U+2019 -> ', U+201C / U+201D -> ", U+2026 -> ...,
 * U+2013 / U+2014 -> -, no-break space -> space, invisible joiners removed,
 * and a few relatives) when the font has the stand-in. Anything else it
 * lacks stays in the text (it draws as `.notdef`) and is reported. A
 * character the font HAS is never touched: a font with real curly quotes
 * keeps them.
 */
export function normalizeForFont(text: string, fontPath: string | undefined): NormalizedText {
  const f = fontEm(fontPath);
  const missing: string[] = [];
  let out = "";
  for (const ch of Array.from(text)) {
    if (isLayoutChar(ch) || isCovered(f, fontPath, ch)) {
      out += ch;
      continue;
    }
    const alt = STAND_INS[ch];
    if (alt !== undefined && Array.from(alt).every((c) => isCovered(f, fontPath, c))) {
      out += alt;
      continue;
    }
    out += ch;
    if (!missing.includes(ch)) missing.push(ch);
  }
  return { text: out, missing };
}

// ── The tile ───────────────────────────────────────────────────────────────

/**
 * One word as a masked tile: its pen at `x`, its baseline at `baseline`
 * (px, any space), set at `fontPx`.
 *
 * The rect spans the font's ascent and descent (plus `pad`) and the word's
 * advance (plus `pad`), grown only where the ink leaves that block, then
 * rounded outward to integers. The fractional remainder goes into the path's
 * offset, so the glyphs sit on `baseline` exactly. `d` is in rect-local px
 * and `bounds` is `{ 0, 0, rect.w, rect.h }`: hand both to an `inline-mask`
 * and place the tile at `rect`.
 */
export function wordTile(
  text: string,
  x: number,
  baseline: number,
  fontPx: number,
  fontPath: string | undefined,
  opts: WordTileOptions = {},
): WordTile {
  assertPx("fontPx", fontPx);
  const pad = opts.pad ?? 0;
  assertPad(pad);
  const f = fontEm(fontPath);
  const { extent } = wordEm(f, fontPath, text);
  const left = x + fontPx * extent.left - pad;
  const top = baseline + fontPx * extent.top - pad;
  const right = x + fontPx * extent.right + pad;
  const bottom = baseline + fontPx * extent.bottom + pad;
  const rx = Math.floor(left + EPS);
  const ry = Math.floor(top + EPS);
  const w = Math.max(1, Math.ceil(right - EPS) - rx);
  const h = Math.max(1, Math.ceil(bottom - EPS) - ry);
  // textToPath with hAlign "left" / vAlign "top" puts the pen at padding.x and
  // the first baseline at padding.y + ascent.
  const d = text
    ? textToPath(
        text,
        {
          fontSize: fontPx,
          hAlign: "left",
          vAlign: "top",
          padding: { x: x - rx, y: baseline - f.ascent * fontPx - ry },
          fontPath,
        },
        { width: w, height: h },
      )
    : "";
  return { rect: { x: rx, y: ry, w, h }, d, bounds: { x: 0, y: 0, width: w, height: h } };
}

// ── One word in a box ──────────────────────────────────────────────────────

/**
 * The largest size at which `text` fits `box` (w and h), and where its pen
 * and baseline go: the word's extent (its advance box x the font's ascent +
 * descent block, grown by any overhanging ink, plus `pad`) is centred
 * vertically and centred (or aligned) horizontally. Scaling the box about
 * its centre scales the word about the same centre, so a resized box keeps
 * the word where it was (the "a centred word grows but doesn't stay
 * centred" complaint). Pass the result to `wordTile` with the same `pad`;
 * the tile's rect is then the fitted extent, inside the box.
 *
 * When nothing fits (a box smaller than 1 px of type) the size is 1 px and
 * the word overflows its box, still centred.
 */
export function fitWordToBox(
  text: string,
  box: Rect,
  fontPath: string | undefined,
  opts: FitWordOptions = {},
): FittedWord {
  const align = opts.align ?? "center";
  const pad = opts.pad ?? 0;
  assertPad(pad);
  if (opts.maxPx !== undefined) assertPx("maxPx", opts.maxPx);
  const { extent } = wordEm(fontEm(fontPath), fontPath, text);
  const wEm = extent.right - extent.left;
  const hEm = extent.bottom - extent.top;
  let fontPx = Math.min(
    wEm > 0 ? (box.w - 2 * pad) / wEm : Infinity,
    hEm > 0 ? (box.h - 2 * pad) / hEm : Infinity,
  );
  if (opts.maxPx !== undefined) fontPx = Math.min(fontPx, opts.maxPx);
  if (!(Number.isFinite(fontPx) && fontPx >= MIN_FONT_PX)) fontPx = MIN_FONT_PX;
  const extW = fontPx * wEm + 2 * pad;
  const extH = fontPx * hEm + 2 * pad;
  const extLeft =
    align === "center" ? box.x + (box.w - extW) / 2 : align === "right" ? box.x + box.w - extW : box.x;
  const extTop = box.y + (box.h - extH) / 2;
  return {
    fontPx,
    x: extLeft + pad - fontPx * extent.left,
    baseline: extTop + pad - fontPx * extent.top,
  };
}

// ── A page of words ────────────────────────────────────────────────────────

function ladder(minScale: number): number[] {
  const steps = FIT_LADDER.filter((s) => s >= minScale);
  if (steps[steps.length - 1] !== minScale) steps.push(minScale);
  return steps;
}

type Layout = { lines: number[][]; fits: boolean; extTop: number; extBottom: number };

/**
 * Lay `words` into `box`: greedy line breaking (forced breaks honoured),
 * shrinking down the ladder until every line fits the width and the block
 * fits the height (the floor size wins when nothing does, with `fits:
 * false`). The block (first ascent to last descent) is centred vertically,
 * nudged only to keep overhanging ink inside the box. Justify spreads each
 * line's spare width evenly across its gaps; a lone word sits left.
 *
 * Words are tokens without spaces. Positions are floats: `wordTile` does the
 * integer rounding without moving the glyphs.
 */
export function typesetPage(words: readonly string[], box: Rect, opts: TypesetOptions): TypesetPage {
  const { align, fontPath } = opts;
  const lineHeight = opts.lineHeight ?? LINE_HEIGHT;
  const minScale = opts.minScale ?? MIN_SCALE;
  const pad = opts.pad ?? 0;
  assertPx("fontPx", opts.fontPx);
  assertPx("lineHeight", lineHeight);
  if (!(minScale > 0 && minScale <= 1)) throw new RangeError(`glyph-text: minScale must be in (0, 1], got ${minScale}`);
  assertPad(pad);
  if (words.length === 0) return { fontPx: opts.fontPx, lines: [], fits: true };

  const f = fontEm(fontPath);
  const em = words.map((w) => wordEm(f, fontPath, w));
  const gaps = words.map((w, i) => (i === 0 ? 0 : gapEm(f, fontPath, words[i - 1], w)));
  const forced = (i: number) => i > 0 && opts.lineBreaksBefore?.[i] === true;

  // How far a word's padded extent reaches past its advance box, px (>= pad).
  const leftOver = (i: number, px: number) => pad - px * em[i].extent.left;
  const rightOver = (i: number, px: number) => px * (em[i].extent.right - em[i].advance) + pad;
  const lineWidth = (line: number[], px: number) => {
    let run = em[line[0]].advance * px;
    for (let k = 1; k < line.length; k++) run += (gaps[line[k]] + em[line[k]].advance) * px;
    return leftOver(line[0], px) + run + rightOver(line[line.length - 1], px);
  };

  const layoutAt = (px: number): Layout => {
    const lines: number[][] = [];
    let line: number[] = [];
    let run = 0;
    for (let i = 0; i < words.length; i++) {
      const adv = em[i].advance * px;
      if (line.length > 0) {
        const next = run + gaps[i] * px + adv;
        if (!forced(i) && leftOver(line[0], px) + next + rightOver(i, px) <= box.w + EPS) {
          line.push(i);
          run = next;
          continue;
        }
        lines.push(line);
      }
      line = [i];
      run = adv;
    }
    lines.push(line);

    const pitch = px * lineHeight;
    let extTop = Infinity;
    let extBottom = -Infinity;
    lines.forEach((ln, li) => {
      for (const i of ln) {
        extTop = Math.min(extTop, li * pitch + px * em[i].extent.top - pad);
        extBottom = Math.max(extBottom, li * pitch + px * em[i].extent.bottom + pad);
      }
    });
    const fitsW = lines.every((ln) => lineWidth(ln, px) <= box.w + EPS);
    const fitsH = extBottom - extTop <= box.h + EPS;
    return { lines, fits: fitsW && fitsH, extTop, extBottom };
  };

  let fontPx = opts.fontPx;
  let layout: Layout | undefined;
  for (const scale of ladder(minScale)) {
    fontPx = opts.fontPx * scale;
    layout = layoutAt(fontPx);
    if (layout.fits) break;
  }
  const { lines, fits, extTop, extBottom } = layout as Layout;

  // First baseline: centre the font block (first ascent .. last descent,
  // padded); keep overhanging ink inside the box when the page fits.
  const pitch = fontPx * lineHeight;
  const fontTop = -f.ascent * fontPx - pad;
  const fontBottom = (lines.length - 1) * pitch + f.descent * fontPx + pad;
  let first = box.y + (box.h - (fontBottom - fontTop)) / 2 - fontTop;
  if (fits) {
    if (first + extTop < box.y) first = box.y - extTop;
    if (first + extBottom > box.y + box.h) first = box.y + box.h - extBottom;
  } else {
    first = box.y + (box.h - (extBottom - extTop)) / 2 - extTop;
  }

  const placed: TypesetLine[] = lines.map((line, li) => {
    const width = lineWidth(line, fontPx);
    const spread = align === "justify" && line.length > 1;
    const extra = spread ? Math.max(0, (box.w - width) / (line.length - 1)) : 0;
    let x = (align === "center" ? box.x + (box.w - width) / 2 : box.x) + leftOver(line[0], fontPx);
    const out: TypesetWord[] = line.map((i, k) => {
      if (k > 0) x += gaps[i] * fontPx + extra;
      const word: TypesetWord = { index: i, text: words[i], x, width: em[i].advance * fontPx };
      x += word.width;
      return word;
    });
    return { baseline: first + li * pitch, words: out };
  });

  return { fontPx, lines: placed, fits };
}
