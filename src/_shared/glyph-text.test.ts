import { readFileSync } from "node:fs";
import { bundledFontPath, getOpentype, measureText, registerFontBytes, textToPath } from "@m0saic/template-utils";
import type { Rect } from "./glyph-text";
import {
  FIT_LADDER,
  fitWordToBox,
  fontError,
  fontMetrics,
  glyphCoverage,
  measureWord,
  normalizeForFont,
  spaceBetween,
  typesetPage,
  wordTile,
} from "./glyph-text";

/** The glyph engine's bundled Roboto Regular: no dependency on the repo's font pack. */
const ROBOTO = bundledFontPath();

const u = (...codePoints: number[]) => String.fromCodePoint(...codePoints);
const RSQUO = u(0x2019);
const LSQUO = u(0x2018);
const LDQUO = u(0x201c);
const RDQUO = u(0x201d);
const ELLIPSIS = u(0x2026);
const EM_DASH = u(0x2014);
const EN_DASH = u(0x2013);
const NBSP = u(0x00a0);
const E_ACUTE = u(0x00e9);
const A_RING = u(0x00c5);

/** Extremes of a path's numbers (the engine emits absolute M/L/Q/C/Z: x, y pairs). */
function pathBox(d: string) {
  const n = (d.match(/-?\d*\.?\d+/g) ?? []).map(Number);
  const xs = n.filter((_, i) => i % 2 === 0);
  const ys = n.filter((_, i) => i % 2 === 1);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

function inside(r: Rect, box: Rect): boolean {
  return r.x >= box.x && r.y >= box.y && r.x + r.w <= box.x + box.w && r.y + r.h <= box.y + box.h;
}

// ── A synthetic test font (built in memory, registered under a logical key) ──

type GlyphSpec = { advance: number; box?: [number, number, number, number] };

/**
 * Font units: 1000 per em, ascender 800, descender -200, y up. The `.notdef`
 * is a hollow box, or (`blankNotdef`) no outline at the space's 250 advance,
 * the way Pacifico and Righteous ship it.
 */
function registerTestFont(key: string, glyphs: Record<string, GlyphSpec>, opts: { blankNotdef?: boolean } = {}): string {
  const ot = getOpentype();
  const rect = (x0: number, y0: number, x1: number, y1: number) => {
    const p = new ot.Path();
    p.moveTo(x0, y0);
    p.lineTo(x1, y0);
    p.lineTo(x1, y1);
    p.lineTo(x0, y1);
    p.close();
    return p;
  };
  const notdef = opts.blankNotdef ? new ot.Path() : rect(50, 0, 550, 700);
  if (!opts.blankNotdef) notdef.extend(rect(100, 50, 500, 650));
  const list = [new ot.Glyph({ name: ".notdef", advanceWidth: opts.blankNotdef ? 250 : 600, path: notdef })];
  Object.entries(glyphs).forEach(([ch, g], i) => {
    list.push(
      new ot.Glyph({
        name: `g${i}`,
        unicode: ch.codePointAt(0),
        advanceWidth: g.advance,
        path: g.box ? rect(...g.box) : new ot.Path(),
      }),
    );
  });
  const font = new ot.Font({
    familyName: key,
    styleName: "Regular",
    unitsPerEm: 1000,
    ascender: 800,
    descender: -200,
    glyphs: list,
  });
  registerFontBytes(key, font.toArrayBuffer());
  return key;
}

const plain = (chars: string): Record<string, GlyphSpec> =>
  Object.fromEntries(Array.from(chars).map((c) => [c, { advance: 500, box: [40, 0, 460, 500] } as GlyphSpec]));

/** ASCII letters and punctuation only: no curly quotes, ellipsis, dashes or no-break space. */
const ASCII_FONT = registerTestFont("test:ascii-only", {
  " ": { advance: 250 },
  ...plain("abcdefghijklmnopqrstuvwxyz'\".-"),
});

/** Same, without "." (so the ellipsis has no stand-in). */
const NO_DOT_FONT = registerTestFont("test:no-dot", {
  " ": { advance: 250 },
  ...plain("abcdefghijklmnopqrstuvwxyz"),
});

/** ASCII letters with a BLANK `.notdef` whose advance equals the space's. */
const BLANK_NOTDEF_FONT = registerTestFont(
  "test:blank-notdef",
  { " ": { advance: 250 }, ...plain("abcdefghijklmnopqrstuvwxyz") },
  { blankNotdef: true },
);

/** Glyphs whose ink leaves the font block: w runs right, x runs left, k climbs, j sinks. */
const OVERHANG_FONT = registerTestFont("test:overhang", {
  " ": { advance: 250 },
  ...plain("aeo"),
  w: { advance: 500, box: [40, 0, 700, 500] },
  x: { advance: 500, box: [-150, 0, 460, 500] },
  k: { advance: 500, box: [40, 0, 460, 950] },
  j: { advance: 500, box: [40, -350, 460, 500] },
});

describe("metrics", () => {
  it("fontMetrics scales linearly and agrees with the glyph engine", () => {
    const m = measureText(" ", { fontSize: 100, fontPath: ROBOTO });
    const a = fontMetrics(ROBOTO, 100);
    expect(a.ascent).toBeCloseTo(m.ascent, 9);
    expect(a.descent).toBeCloseTo(m.descent, 9);
    expect(a.spaceWidth).toBeCloseTo(m.width, 9);
    const b = fontMetrics(ROBOTO, 250);
    expect(b.ascent).toBeCloseTo(2.5 * a.ascent, 9);
    expect(b.spaceWidth).toBeCloseTo(2.5 * a.spaceWidth, 9);
  });

  it("measureWord includes kerning (Roboto pulls AV and To together)", () => {
    for (const [pair, l, r] of [
      ["AV", "A", "V"],
      ["To", "T", "o"],
    ]) {
      const kerned = measureWord(pair, 100, ROBOTO);
      expect(kerned).toBeCloseTo(measureText(pair, { fontSize: 100, fontPath: ROBOTO }).width, 9);
      expect(kerned).toBeLessThan(measureWord(l, 100, ROBOTO) + measureWord(r, 100, ROBOTO) - 3);
    }
  });

  it("spaceBetween is the space plus the kerning on both sides of it", () => {
    const px = 88;
    const m = (t: string) => measureText(t, { fontSize: px, fontPath: ROBOTO }).width;
    expect(spaceBetween("on", "the", px, ROBOTO)).toBeCloseTo(m("n t") - m("n") - m("t"), 9);
    expect(spaceBetween("say", "To", px, ROBOTO)).toBeCloseTo(m("y T") - m("y") - m("T"), 9);
  });

  it("reads an undefined font path as the glyph engine's bundled Roboto", () => {
    expect(measureWord("Tonight", 72, undefined)).toBeCloseTo(measureWord("Tonight", 72, ROBOTO), 9);
    expect(fontMetrics(undefined, 72)).toEqual(fontMetrics(ROBOTO, 72));
  });

  it("rejects a size that is not a positive number", () => {
    expect(() => measureWord("a", 0, ROBOTO)).toThrow(RangeError);
    expect(() => fontMetrics(ROBOTO, Number.NaN)).toThrow(RangeError);
  });
});

describe("wordTile", () => {
  it("is an integer rect whose bounds are its own size and whose glyphs sit inside it", () => {
    const t = wordTile("Rainy", 101.37, 540.62, 88, ROBOTO);
    for (const v of [t.rect.x, t.rect.y, t.rect.w, t.rect.h]) expect(Number.isInteger(v)).toBe(true);
    expect(t.bounds).toEqual({ x: 0, y: 0, width: t.rect.w, height: t.rect.h });
    const b = pathBox(t.d);
    expect(b.minX).toBeGreaterThanOrEqual(-0.01);
    expect(b.minY).toBeGreaterThanOrEqual(-0.01);
    expect(b.maxX).toBeLessThanOrEqual(t.rect.w + 0.01);
    expect(b.maxY).toBeLessThanOrEqual(t.rect.h + 0.01);
  });

  it("lands the pen and the baseline exactly (the rounding goes into the padding)", () => {
    const px = 88;
    const { ascent } = fontMetrics(ROBOTO, px);
    // Reference: the word alone with its pen at x = 0 and its baseline at y = ascent.
    const ref = pathBox(textToPath("Rainy", { fontSize: px, hAlign: "left", vAlign: "top", fontPath: ROBOTO }, { width: 1, height: 1 }));
    for (const [x, baseline] of [
      [101.37, 540.62],
      [7.5, 300.01],
      [640.99, 99.5],
    ]) {
      const t = wordTile("Rainy", x, baseline, px, ROBOTO);
      const b = pathBox(t.d);
      expect(t.rect.x + b.minX - x).toBeCloseTo(ref.minX, 1.5);
      expect(t.rect.y + b.maxY - baseline).toBeCloseTo(ref.maxY - ascent, 1.5);
    }
  });

  it("puts 'on' and 'the' on one baseline in rects of one top and height", () => {
    const px = 97.3;
    const page = typesetPage(["on", "the"], { x: 0, y: 0, w: 1080, h: 400 }, { fontPx: px, align: "center", fontPath: ROBOTO });
    expect(page.lines).toHaveLength(1);
    const { baseline, words } = page.lines[0];
    expect(Number.isInteger(baseline)).toBe(false); // a fractional baseline exercises the carry
    const [on, the] = words.map((w) => wordTile(w.text, w.x, baseline, page.fontPx, ROBOTO));
    // The font's ascent/descent sets the rect, not the word's ink ("the" is taller than "on").
    expect(on.rect.y).toBe(the.rect.y);
    expect(on.rect.h).toBe(the.rect.h);
    // Bottoms of the non-descender glyphs (o, n / t, h, e) land on one canvas y.
    const onBottom = on.rect.y + pathBox(on.d).maxY;
    const theBottom = the.rect.y + pathBox(the.d).maxY;
    expect(Math.abs(onBottom - theBottom)).toBeLessThanOrEqual(0.5);
    // ...and that y is the baseline plus Roboto's overshoot, not a drifted one.
    const ref = pathBox(textToPath("on", { fontSize: page.fontPx, hAlign: "left", vAlign: "top", fontPath: ROBOTO }, { width: 1, height: 1 }));
    expect(onBottom - baseline).toBeCloseTo(ref.maxY - fontMetrics(ROBOTO, page.fontPx).ascent, 1.5);
  });

  it("grows the rect to hold ink that leaves the font block, and keeps the baseline", () => {
    const x = 100.4;
    const baseline = 300.7;
    const px = 100; // 1 font unit = 0.1 px in the test font
    const block = wordTile("a", x, baseline, px, OVERHANG_FONT).rect;
    expect(block).toEqual({ x: 100, y: 220, w: 51, h: 101 }); // ascent 80 + descent 20

    const w = wordTile("w", x, baseline, px, OVERHANG_FONT); // ink to x + 70, advance 50
    expect(w.rect.x + w.rect.w).toBeGreaterThanOrEqual(x + 70);
    expect(pathBox(w.d).maxX).toBeLessThanOrEqual(w.rect.w + 0.01);
    expect(w.rect.y).toBe(block.y);

    const xw = wordTile("x", x, baseline, px, OVERHANG_FONT); // ink from x - 15
    expect(xw.rect.x).toBe(Math.floor(x - 15));
    expect(xw.rect.x + pathBox(xw.d).minX).toBeCloseTo(x - 15, 1.5);

    const k = wordTile("k", x, baseline, px, OVERHANG_FONT); // ink to 95 above the baseline
    expect(k.rect.y).toBe(Math.floor(baseline - 95));
    expect(pathBox(k.d).minY).toBeGreaterThanOrEqual(-0.01);
    expect(k.rect.y + pathBox(k.d).maxY).toBeCloseTo(baseline, 1.5);

    const j = wordTile("j", x, baseline, px, OVERHANG_FONT); // ink to 35 below the baseline
    expect(j.rect.y + j.rect.h).toBe(Math.ceil(baseline + 35));
    expect(j.rect.y).toBe(block.y);
  });

  it("does the same for a real accent above Roboto's ascent", () => {
    const px = 100;
    const t = wordTile(`${A_RING}re`, 50, 400.3, px, ROBOTO);
    expect(t.rect.y).toBeLessThan(Math.floor(400.3 - fontMetrics(ROBOTO, px).ascent));
    expect(pathBox(t.d).minY).toBeGreaterThanOrEqual(-0.01);
  });

  it("adds pad on every side", () => {
    const a = wordTile("sing", 200, 500, 90, ROBOTO);
    const b = wordTile("sing", 200, 500, 90, ROBOTO, { pad: 6 });
    expect(b.rect).toEqual({ x: a.rect.x - 6, y: a.rect.y - 6, w: a.rect.w + 12, h: a.rect.h + 12 });
    expect(b.bounds).toEqual({ x: 0, y: 0, width: b.rect.w, height: b.rect.h });
  });
});

describe("typesetPage", () => {
  const LYRIC = "we sing it loud and we mean it every single night".split(" ");

  it("justify runs every multi-word line edge to edge; a lone word sits left", () => {
    const box = { x: 40, y: 100, w: 1000, h: 800 };
    const breaks = LYRIC.map((_, i) => i === LYRIC.length - 1);
    const page = typesetPage(LYRIC, box, { fontPx: 120, align: "justify", fontPath: ROBOTO, lineBreaksBefore: breaks });
    expect(page.fits).toBe(true);
    expect(page.lines.length).toBeGreaterThan(2);
    const last = page.lines[page.lines.length - 1];
    expect(last.words.map((w) => w.text)).toEqual(["night"]);
    const lone = page.lines.filter((l) => l.words.length === 1);
    const spread = page.lines.filter((l) => l.words.length > 1);
    expect(spread.length).toBeGreaterThanOrEqual(2);
    for (const line of lone) expect(line.words[0].x).toBeCloseTo(box.x, 6);
    for (const line of spread) {
      const first = line.words[0];
      const end = line.words[line.words.length - 1];
      expect(first.x).toBeCloseTo(box.x, 6);
      expect(end.x + end.width).toBeCloseTo(box.x + box.w, 6);
      // The spare width is spread evenly: every gap is its natural space plus one constant.
      const extras = line.words.slice(1).map((w, k) => {
        const prev = line.words[k];
        return w.x - (prev.x + prev.width) - spaceBetween(prev.text, w.text, page.fontPx, ROBOTO);
      });
      for (const e of extras) expect(e).toBeCloseTo(extras[0], 6);
      expect(extras[0]).toBeGreaterThan(0);
      // The tiles reach both edges and stay inside the box.
      const tiles = line.words.map((w) => wordTile(w.text, w.x, line.baseline, page.fontPx, ROBOTO));
      expect(tiles[0].rect.x).toBe(box.x);
      expect(tiles[tiles.length - 1].rect.x + tiles[tiles.length - 1].rect.w).toBe(box.x + box.w);
      for (const t of tiles) expect(inside(t.rect, box)).toBe(true);
    }
  });

  it("left sets natural spaces from the left edge; center centres each line", () => {
    const box = { x: 0, y: 0, w: 900, h: 700 };
    const left = typesetPage(LYRIC, box, { fontPx: 100, align: "left", fontPath: ROBOTO });
    const center = typesetPage(LYRIC, box, { fontPx: 100, align: "center", fontPath: ROBOTO });
    expect(center.lines.map((l) => l.words.map((w) => w.index))).toEqual(left.lines.map((l) => l.words.map((w) => w.index)));
    left.lines.forEach((line, li) => {
      expect(line.words[0].x).toBeCloseTo(box.x, 6);
      line.words.slice(1).forEach((w, k) => {
        const prev = line.words[k];
        expect(w.x - (prev.x + prev.width)).toBeCloseTo(spaceBetween(prev.text, w.text, left.fontPx, ROBOTO), 6);
      });
      const c = center.lines[li].words;
      const leftGap = c[0].x - box.x;
      const rightGap = box.x + box.w - (c[c.length - 1].x + c[c.length - 1].width);
      expect(leftGap).toBeCloseTo(rightGap, 6);
    });
  });

  it("centres the block (first ascent to last descent) vertically", () => {
    const box = { x: 0, y: 200, w: 900, h: 1000 };
    const page = typesetPage(LYRIC, box, { fontPx: 100, align: "left", fontPath: ROBOTO });
    const { ascent, descent } = fontMetrics(ROBOTO, page.fontPx);
    const top = page.lines[0].baseline - ascent;
    const bottom = page.lines[page.lines.length - 1].baseline + descent;
    expect(top - box.y).toBeCloseTo(box.y + box.h - bottom, 6);
    page.lines.slice(1).forEach((l, i) => expect(l.baseline - page.lines[i].baseline).toBeCloseTo(page.fontPx * 1.28, 9));
  });

  it("shrinks down the ladder to the largest step that fits, and the tiles stay inside", () => {
    const box = { x: 30, y: 60, w: 600, h: 420 };
    const page = typesetPage(LYRIC, box, { fontPx: 200, align: "justify", fontPath: ROBOTO });
    expect(page.fits).toBe(true);
    expect(page.fontPx).toBeLessThan(200);
    const step = page.fontPx / 200;
    const at = FIT_LADDER.findIndex((s) => Math.abs(s - step) < 1e-12);
    expect(at).toBeGreaterThan(0);
    // The step above does not fit (a ladder that stops there reports it).
    const above = typesetPage(LYRIC, box, { fontPx: 200, align: "justify", fontPath: ROBOTO, minScale: FIT_LADDER[at - 1] });
    expect(above.fits).toBe(false);
    expect(above.fontPx).toBeCloseTo(200 * FIT_LADDER[at - 1], 9);
    for (const line of page.lines) {
      for (const w of line.words) expect(inside(wordTile(w.text, w.x, line.baseline, page.fontPx, ROBOTO).rect, box)).toBe(true);
    }
  });

  it("does not shrink a page that fits, and stops at minScale when nothing does", () => {
    const roomy = typesetPage(["hello"], { x: 0, y: 0, w: 1000, h: 1000 }, { fontPx: 80, align: "center", fontPath: ROBOTO });
    expect(roomy.fontPx).toBe(80);
    const cramped = typesetPage(LYRIC, { x: 0, y: 0, w: 120, h: 60 }, { fontPx: 100, align: "left", fontPath: ROBOTO });
    expect(cramped.fits).toBe(false);
    expect(cramped.fontPx).toBeCloseTo(38, 9);
    const floor = typesetPage(LYRIC, { x: 0, y: 0, w: 120, h: 60 }, { fontPx: 100, align: "left", fontPath: ROBOTO, minScale: 0.6 });
    expect(floor.fontPx).toBeCloseTo(60, 9);
  });

  it("honours forced breaks (a break before the first word is ignored)", () => {
    const words = ["one", "two", "three", "four"];
    const page = typesetPage(words, { x: 0, y: 0, w: 2000, h: 600 }, {
      fontPx: 80,
      align: "left",
      fontPath: ROBOTO,
      lineBreaksBefore: [true, false, true, false],
    });
    expect(page.lines.map((l) => l.words.map((w) => w.text))).toEqual([
      ["one", "two"],
      ["three", "four"],
    ]);
  });

  it("indexes words in reading order and returns an empty page for no words", () => {
    const page = typesetPage(LYRIC, { x: 0, y: 0, w: 700, h: 900 }, { fontPx: 90, align: "center", fontPath: ROBOTO });
    expect(page.lines.flatMap((l) => l.words.map((w) => w.index))).toEqual(LYRIC.map((_, i) => i));
    expect(typesetPage([], { x: 0, y: 0, w: 10, h: 10 }, { fontPx: 90, align: "left", fontPath: ROBOTO })).toEqual({
      fontPx: 90,
      lines: [],
      fits: true,
    });
  });

  it("keeps overhanging ink inside the box: justify, shrink and vertical", () => {
    const box = { x: 20, y: 40, w: 400, h: 260 };
    const words = ["xa", "kaw", "jaw", "ox", "wok", "jax"];
    for (const align of ["justify", "left", "center"] as const) {
      const page = typesetPage(words, box, { fontPx: 200, align, fontPath: OVERHANG_FONT });
      expect(page.fits).toBe(true);
      const tiles = page.lines.flatMap((l) => l.words.map((w) => wordTile(w.text, w.x, l.baseline, page.fontPx, OVERHANG_FONT)));
      for (const t of tiles) expect(inside(t.rect, box)).toBe(true);
    }
    // Justify: the ink (not the advance) reaches both edges.
    const page = typesetPage(["xa", "aw"], box, { fontPx: 100, align: "justify", fontPath: OVERHANG_FONT });
    const [first, second] = page.lines[0].words;
    expect(first.x).toBeCloseTo(box.x + 15, 6);
    expect(second.x + second.width).toBeCloseTo(box.x + box.w - 20, 6);
  });

  it("honours pad: padded tiles stay inside the box", () => {
    const box = { x: 0, y: 0, w: 640, h: 480 };
    const page = typesetPage(LYRIC, box, { fontPx: 160, align: "justify", fontPath: ROBOTO, pad: 8 });
    for (const line of page.lines) {
      for (const w of line.words) {
        expect(inside(wordTile(w.text, w.x, line.baseline, page.fontPx, ROBOTO, { pad: 8 }).rect, box)).toBe(true);
      }
    }
  });
});

describe("fitWordToBox", () => {
  const centre = (r: Rect) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

  it("keeps a centred word's centre when the box doubles around it", () => {
    const box = { x: 300, y: 700, w: 400, h: 160 };
    const big = { x: 100, y: 620, w: 800, h: 320 }; // same centre (500, 780), twice the size
    const c = centre(box);
    const a = fitWordToBox("hello", box, ROBOTO);
    const b = fitWordToBox("hello", big, ROBOTO);
    expect(b.fontPx).toBeCloseTo(2 * a.fontPx, 9);
    for (const fit of [a, b]) {
      const { ascent, descent } = fontMetrics(ROBOTO, fit.fontPx);
      // The advance box is centred horizontally, the ascent + descent block vertically.
      expect(fit.x + measureWord("hello", fit.fontPx, ROBOTO) / 2).toBeCloseTo(c.x, 6);
      expect((fit.baseline - ascent + fit.baseline + descent) / 2).toBeCloseTo(c.y, 6);
      // The tile's rect is centred too (outward rounding moves each edge by under 1 px).
      const t = wordTile("hello", fit.x, fit.baseline, fit.fontPx, ROBOTO);
      expect(Math.abs(centre(t.rect).x - c.x)).toBeLessThan(0.5);
      expect(Math.abs(centre(t.rect).y - c.y)).toBeLessThan(0.5);
    }
  });

  it("is the largest size that fits: tight on one side, inside on both", () => {
    for (const box of [
      { x: 10, y: 10, w: 500, h: 400 }, // width-bound
      { x: 10, y: 10, w: 2000, h: 120 }, // height-bound
    ]) {
      const fit = fitWordToBox("sing", box, ROBOTO);
      const { ascent, descent } = fontMetrics(ROBOTO, fit.fontPx);
      const w = measureWord("sing", fit.fontPx, ROBOTO);
      const tightW = Math.abs(w - box.w) < 1e-6;
      const tightH = Math.abs(ascent + descent - box.h) < 1e-6;
      expect(tightW || tightH).toBe(true);
      expect(w).toBeLessThanOrEqual(box.w + 1e-6);
      expect(ascent + descent).toBeLessThanOrEqual(box.h + 1e-6);
      expect(inside(wordTile("sing", fit.x, fit.baseline, fit.fontPx, ROBOTO).rect, box)).toBe(true);
    }
  });

  it("caps at maxPx and still centres; left and right align the advance box", () => {
    const box = { x: 0, y: 0, w: 1000, h: 400 };
    const capped = fitWordToBox("sing", box, ROBOTO, { maxPx: 60 });
    expect(capped.fontPx).toBe(60);
    expect(capped.x + measureWord("sing", 60, ROBOTO) / 2).toBeCloseTo(500, 6);
    const left = fitWordToBox("sing", box, ROBOTO, { maxPx: 60, align: "left" });
    expect(left.x).toBeCloseTo(0, 6);
    const right = fitWordToBox("sing", box, ROBOTO, { maxPx: 60, align: "right" });
    expect(right.x + measureWord("sing", 60, ROBOTO)).toBeCloseTo(1000, 6);
  });

  it("round-trips a moved tile: refitting its own rect elsewhere changes nothing but the position", () => {
    for (const [word, font] of [
      ["hello", ROBOTO],
      ["wax", OVERHANG_FONT],
      ["jok", OVERHANG_FONT],
    ] as const) {
      for (const box of [
        { x: 100, y: 100, w: 400, h: 180 },
        { x: 13, y: 250, w: 301, h: 97 },
      ]) {
        const a = fitWordToBox(word, box, font);
        const t = wordTile(word, a.x, a.baseline, a.fontPx, font);
        const moved = { ...t.rect, x: t.rect.x + 37, y: t.rect.y - 12 };
        const b = fitWordToBox(word, moved, font);
        expect(b.fontPx).toBeCloseTo(a.fontPx, 9);
        expect(b.x - a.x).toBeCloseTo(37, 9);
        expect(b.baseline - a.baseline).toBeCloseTo(-12, 9);
        expect(wordTile(word, b.x, b.baseline, b.fontPx, font).rect).toEqual(moved);
      }
    }
  });

  it("fits and centres the ink of an overhanging word, so its tile is its box", () => {
    const box = { x: 200, y: 300, w: 360, h: 180 };
    const fit = fitWordToBox("wax", box, OVERHANG_FONT);
    const t = wordTile("wax", fit.x, fit.baseline, fit.fontPx, OVERHANG_FONT);
    expect(inside(t.rect, box)).toBe(true);
    expect(Math.abs(centre(t.rect).x - centre(box).x)).toBeLessThan(0.5);
    expect(Math.abs(centre(t.rect).y - centre(box).y)).toBeLessThan(0.5);
    expect(Math.max(box.w - t.rect.w, box.h - t.rect.h)).toBeGreaterThan(0); // one side has slack
    expect(Math.min(box.w - t.rect.w, box.h - t.rect.h)).toBeLessThanOrEqual(1); // the other is tight
  });
});

describe("coverage and normalizeForFont", () => {
  it("swaps what Apple Notes types for ASCII when the font lacks it", () => {
    const pasted = `don${RSQUO}t ${LDQUO}stop${RDQUO}${ELLIPSIS} now${EM_DASH}${NBSP}go ${LSQUO}til dawn${EN_DASH}ok`;
    expect(glyphCoverage(pasted, ASCII_FONT)).toEqual([RSQUO, LDQUO, RDQUO, ELLIPSIS, EM_DASH, NBSP, LSQUO, EN_DASH]);
    expect(normalizeForFont(pasted, ASCII_FONT)).toEqual({
      text: `don't "stop"... now- go 'til dawn-ok`,
      missing: [],
    });
  });

  it("reports other missing characters once and keeps them (they draw as .notdef)", () => {
    const text = `caf${E_ACUTE} ${E_ACUTE}t${E_ACUTE}`;
    expect(normalizeForFont(text, ASCII_FONT)).toEqual({ text, missing: [E_ACUTE] });
    expect(glyphCoverage(text, ASCII_FONT)).toEqual([E_ACUTE]);
  });

  it("reports a character whose stand-in the font also lacks", () => {
    expect(normalizeForFont(`wait${ELLIPSIS}`, NO_DOT_FONT)).toEqual({ text: `wait${ELLIPSIS}`, missing: [ELLIPSIS] });
  });

  it("never touches a character the font has: Roboto keeps its curly quotes", () => {
    const pasted = `don${RSQUO}t ${LDQUO}stop${RDQUO}${ELLIPSIS} now${EM_DASH}go caf${E_ACUTE}`;
    expect(glyphCoverage(pasted, ROBOTO)).toEqual([]);
    expect(normalizeForFont(pasted, ROBOTO)).toEqual({ text: pasted, missing: [] });
  });

  it("finds what Roboto lacks and ignores line breaks and controls", () => {
    const smile = u(0x1f600);
    expect(glyphCoverage(`hi ${smile}\nyou\t${smile}`, ROBOTO)).toEqual([smile]);
    expect(normalizeForFont(`a\nb`, ASCII_FONT)).toEqual({ text: "a\nb", missing: [] });
  });

  it("a blank .notdef: spaces are never reported, a real gap still is", () => {
    // The space and the no-break space draw as a blank either way.
    expect(glyphCoverage(`a b${NBSP}c`, BLANK_NOTDEF_FONT)).toEqual([]);
    expect(normalizeForFont(`a b${NBSP}c`, BLANK_NOTDEF_FONT)).toEqual({ text: `a b${NBSP}c`, missing: [] });
    // A letter the face lacks would draw as an invisible gap: reported.
    expect(glyphCoverage(`caf${E_ACUTE} ok`, BLANK_NOTDEF_FONT)).toEqual([E_ACUTE]);
    // A boxed .notdef keeps reporting a missing no-break space (and swaps it).
    expect(glyphCoverage(NBSP, ASCII_FONT)).toEqual([NBSP]);
  });
});

describe("fontError", () => {
  it("is null for a font the engine reads, including the bundled default", () => {
    expect(fontError(ROBOTO)).toBeNull();
    expect(fontError(undefined)).toBeNull();
    expect(fontError(ASCII_FONT)).toBeNull();
  });

  it("returns the reason, never throws, for a missing file or a file that is not a font", () => {
    for (const bad of ["/no/such/folder/brand.ttf", __filename]) {
      const reason = fontError(bad);
      expect(typeof reason).toBe("string");
      expect(reason!.length).toBeGreaterThan(0);
      // The drawing functions themselves throw on it (the reason fontError exists).
      expect(() => measureWord("a", 10, bad)).toThrow();
      // A failure is not remembered: asking again gives the same answer, still no throw.
      expect(fontError(bad)).toBe(reason);
    }
  });
});

describe("determinism", () => {
  it("gives identical paths and pages every time, and from a fresh parse of the same bytes", () => {
    const again = registerFontBytes; // same API the host uses to register bytes
    const bytes = readFileSync(ROBOTO);
    const copy = "test:roboto-copy";
    again(copy, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    const box = { x: 0, y: 0, w: 800, h: 600 };
    const a = typesetPage(["the", "night", "is", "ours"], box, { fontPx: 110, align: "justify", fontPath: ROBOTO });
    const b = typesetPage(["the", "night", "is", "ours"], box, { fontPx: 110, align: "justify", fontPath: ROBOTO });
    const c = typesetPage(["the", "night", "is", "ours"], box, { fontPx: 110, align: "justify", fontPath: copy });
    expect(b).toEqual(a);
    expect(c).toEqual(a);
    const w = a.lines[0].words[1];
    const t1 = wordTile(w.text, w.x, a.lines[0].baseline, a.fontPx, ROBOTO);
    const t2 = wordTile(w.text, w.x, a.lines[0].baseline, a.fontPx, ROBOTO);
    const t3 = wordTile(w.text, w.x, a.lines[0].baseline, a.fontPx, copy);
    expect(t1.d.length).toBeGreaterThan(50);
    expect(t2).toEqual(t1);
    expect(t3).toEqual(t1);
  });
});
