import { getOpentype, registerFontBytes } from "@m0saic/template-utils";

import { bundledFontPath } from "../../../_shared/fonts";
import type { Rect } from "../../../_shared/glyph-text";
import { wordTile } from "../../../_shared/glyph-text";
import type { Canvas, LaidWord, LayoutWordInput, PageLayoutOptions } from "./layout";
import { applyWordBoxes, keepOnCanvas, layoutPage, onCanvas, sameBox } from "./layout";

const ANTON = bundledFontPath("anton");
const BOX: Rect = { x: 115, y: 672, w: 730, h: 576 };
const CANVAS: Canvas = { W: 1080, H: 1920 };

const input = (text: string, first = 0): LayoutWordInput[] =>
  text.split(/\s+/).map((t, k) => ({ index: first + k, text: t, atMs: k * 100, lineBreakBefore: false }));

const opts = (over: Partial<PageLayoutOptions> = {}): PageLayoutOptions => ({
  box: BOX,
  fontPx: 119,
  align: "center",
  fontPath: ANTON,
  pad: 5,
  mode: "cumulative",
  soloMaxPx: 190,
  canvas: CANVAS,
  ...over,
});

const centre = (r: Rect) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
const inside = (r: Rect, b: Rect) => r.x >= b.x && r.y >= b.y && r.x + r.w <= b.x + b.w && r.y + r.h <= b.y + b.h;

/** A synthetic font with ASCII only (no curly quotes, ellipsis or dashes). */
function asciiOnlyFont(key: string): string {
  const ot = getOpentype();
  const rect = () => {
    const p = new ot.Path();
    p.moveTo(40, 0);
    p.lineTo(460, 0);
    p.lineTo(460, 500);
    p.lineTo(40, 500);
    p.close();
    return p;
  };
  const notdef = new ot.Path();
  notdef.moveTo(50, 0);
  notdef.lineTo(550, 0);
  notdef.lineTo(550, 700);
  notdef.lineTo(50, 700);
  notdef.close();
  const glyphs = [new ot.Glyph({ name: ".notdef", advanceWidth: 600, path: notdef })];
  glyphs.push(new ot.Glyph({ name: "space", unicode: 32, advanceWidth: 250, path: new ot.Path() }));
  Array.from("abcdefghijklmnopqrstuvwxyz'\".-").forEach((ch, i) =>
    glyphs.push(new ot.Glyph({ name: `g${i}`, unicode: ch.codePointAt(0), advanceWidth: 500, path: rect() })),
  );
  const font = new ot.Font({ familyName: key, styleName: "Regular", unitsPerEm: 1000, ascender: 800, descender: -200, glyphs });
  registerFontBytes(key, font.toArrayBuffer());
  return key;
}

describe("lyric-stack layout", () => {
  it("typesets a page inside the lyric box, words of a line on one baseline", () => {
    const page = layoutPage(input("type your lyrics here one page per line", 7), opts());
    expect(page.words.map((w) => w.index)).toEqual([7, 8, 9, 10, 11, 12, 13, 14]);
    for (const w of page.words) {
      expect(inside(w.rect, BOX)).toBe(true);
      expect(w.d.length).toBeGreaterThan(0);
    }
    const byLine = new Map<number, number[]>();
    for (const w of page.words) byLine.set(w.line, [...(byLine.get(w.line) ?? []), w.rect.y]);
    expect(byLine.size).toBeGreaterThan(1);
    for (const ys of byLine.values()) expect(new Set(ys).size).toBe(1);
  });

  it("word mode: every word alone at its own size, its centre on the box centre", () => {
    const page = layoutPage(input("a incomprehensibilities word"), opts({ mode: "word" }));
    const c = centre(BOX);
    for (const w of page.words) {
      expect(Math.abs(centre(w.rect).x - c.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(centre(w.rect).y - c.y)).toBeLessThanOrEqual(1);
      expect(w.fontPx).toBeLessThanOrEqual(190);
    }
    expect(new Set(page.words.map((w) => w.line)).size).toBe(page.words.length);
    // The long word shrinks to fit the width; the short ones stop at the cap.
    expect(page.words[1].fontPx).toBeLessThan(page.words[0].fontPx);
  });

  it("custom boxes: within 1 px is untouched, a moved box re-fits the word centred in it", () => {
    const page = layoutPage(input("stay put", 0), opts());
    const [a, b] = page.words;
    const nudged = { ...a.rect, x: a.rect.x + 1 };
    const moved: Rect = { x: 100, y: 200, w: 600, h: 300 };
    const out = applyWordBoxes(page.words, [nudged, moved], ANTON, 5, CANVAS);
    expect(out[0]).toBe(a);
    expect(out[1].moved).toBe(true);
    expect(inside(out[1].rect, { x: 99, y: 199, w: 602, h: 302 })).toBe(true);
    expect(Math.abs(centre(out[1].rect).x - centre(moved).x)).toBeLessThanOrEqual(1);
    expect(Math.abs(centre(out[1].rect).y - centre(moved).y)).toBeLessThanOrEqual(1);
    expect(out[1].fontPx).toBeGreaterThan(b.fontPx);
    // The resized word round-trips: its own rect as the box is "untouched".
    expect(applyWordBoxes(out, [null, out[1].rect], ANTON, 5, CANVAS)[1]).toBe(out[1]);
    expect(sameBox(moved, { ...moved, w: moved.w + 2 })).toBe(false);
  });

  it("a page too big for the box even at the ladder's floor keeps shrinking until it fits", () => {
    // One token far wider than the box at 38% of 178 px: it used to hang off the canvas (x < 0).
    const token = "never-gonna-give-you-up-tonight";
    for (const id of ["archivo-black", "righteous", "pacifico"] as const) {
      const page = layoutPage(input(`${token} ${token}`), opts({ fontPath: bundledFontPath(id), fontPx: 178 }));
      expect(page.fontPx).toBeLessThan(178 * 0.38);
      for (const w of page.words) expect({ id, inside: inside(w.rect, BOX) }).toEqual({ id, inside: true });
    }
    // Forty forced lines: taller than the canvas at the floor; now every line fits the box.
    const lines = Array.from({ length: 40 }, (_, i) => ({ index: i, text: `line${i}`, atMs: i * 10, lineBreakBefore: i > 0 }));
    const tall = layoutPage(lines, opts());
    expect(new Set(tall.words.map((w) => w.line)).size).toBe(40);
    for (const w of tall.words) expect(inside(w.rect, BOX)).toBe(true);
    // A page that fits on the ladder is untouched by the search.
    expect(layoutPage(input("short page"), opts()).fontPx).toBe(119);
  });

  it("a box dragged to a sliver at the canvas edge slides the whole word in, never past the edge", () => {
    const page = layoutPage(input("edge"), opts());
    // What resolveRegionsToPx leaves of a box dragged mostly off the right edge.
    const sliver: Rect = { x: 1072, y: 400, w: 8, h: 40 };
    const [w] = applyWordBoxes(page.words, [sliver], ANTON, 5, CANVAS);
    expect(w.moved).toBe(true);
    expect(onCanvas(w.rect, CANVAS)).toBe(true);
    expect(w.rect.x + w.rect.w).toBe(CANVAS.W);
    expect(w.d.length).toBeGreaterThan(0);
  });

  it("a word hanging off the canvas re-fits into the part the canvas shows; one that fits nowhere is not drawn", () => {
    // A word whose pen sits left of the canvas: its tile hangs off the left edge.
    const t = wordTile("edge", -60, 300, 119, ANTON, { pad: 5 });
    const hanging: LaidWord = { index: 0, text: "edge", atMs: 0, line: 0, fontPx: 119, rect: t.rect, d: t.d, moved: false };
    expect(hanging.rect.x).toBeLessThan(0);
    expect(hanging.rect.x + hanging.rect.w).toBeGreaterThan(0);
    const [kept] = keepOnCanvas([hanging], CANVAS, ANTON, 5);
    expect(onCanvas(kept.rect, CANVAS)).toBe(true);
    expect(kept.fontPx).toBeLessThan(119);
    expect(kept.d.length).toBeGreaterThan(0);
    // Wider than the canvas even at 1 px: emptied, so it is never drawn.
    const [none] = keepOnCanvas([hanging], { W: 4, H: 4 }, ANTON, 5);
    expect(none.d).toBe("");
    // A boxed word that fits nowhere keeps its own layout instead (the clip's words never depend on a box).
    const laid = layoutPage(input("edge"), opts()).words;
    const [fallback] = applyWordBoxes(laid, [{ x: 0, y: 0, w: 2, h: 2 }], ANTON, 5, { W: 4, H: 4 });
    expect(fallback).toBe(laid[0]);
  });

  it("normalises smart quotes, ellipses and dashes a font lacks, and reports what is still missing", () => {
    const font = asciiOnlyFont("test:lyric-stack-ascii.ttf");
    const page = layoutPage(
      [
        { index: 0, text: "‘don’t’", atMs: 0, lineBreakBefore: false },
        { index: 1, text: "wait…", atMs: 0, lineBreakBefore: false },
        { index: 2, text: "“yes”—café", atMs: 0, lineBreakBefore: false },
      ],
      opts({ fontPath: font }),
    );
    expect(page.words.map((w) => w.text)).toEqual(["'don't'", "wait...", "\"yes\"-café"]);
    expect(page.missing).toEqual(["é"]);
    // Anton HAS the typographic set: nothing is swapped.
    expect(layoutPage(input("don’t"), opts()).words[0].text).toBe("don’t");
  });

  it("is deterministic", () => {
    const a = layoutPage(input("same words every time"), opts());
    const b = layoutPage(input("same words every time"), opts());
    expect(a).toEqual(b);
  });
});
