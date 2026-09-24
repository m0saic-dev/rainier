import { resolveWordTimes } from "./pages";
import { LINE_HEIGHT, measureText, typesetPage } from "./typeset";

const page = (text: string) => ({
  startMs: 0,
  endMs: 4000,
  words: resolveWordTimes(text, { startMs: 0, endMs: 4000 }, undefined),
});

const BOX = { x: 100, y: 20, w: 840, h: 590 };

describe("typesetting a lyric page", () => {
  it("measures with Helvetica Neue advances and kerning", () => {
    // "o" = 574 and "n" = 556 units per 1000 → 113 px at 100 px.
    expect(measureText("on", 100)).toBeCloseTo(113, 0);
    expect(measureText("AV", 100)).toBeLessThan(measureText("A", 100) + measureText("V", 100));
  });

  it("justifies multi-word lines edge to edge and parks a lone word on the left", () => {
    const set = typesetPage(page("paint the window gold tonight"), BOX, { fontPx: 123, align: "justify" });
    for (const line of set.lines) {
      expect(line[0].x).toBe(BOX.x);
      if (line.length > 1) {
        const last = line[line.length - 1];
        const right = last.x + measureText(last.text, set.fontPx);
        expect(Math.abs(right - (BOX.x + BOX.w))).toBeLessThanOrEqual(1);
      }
    }
    expect(set.lines.map((l) => l.map((w) => w.text).join(" "))).toEqual([
      "paint the",
      "window gold",
      "tonight",
    ]);
  });

  it("uses natural spacing when left-aligned", () => {
    const set = typesetPage(page("we could run"), BOX, { fontPx: 123, align: "left" });
    const [a, b] = set.lines[0];
    expect(b.x - a.x).toBeCloseTo(measureText("we ", 123), -1);
  });

  it("shrinks a page that cannot fit, and keeps every line inside the box", () => {
    const long = "this page has far too many words to ever fit in one row at the full size so it has to shrink down";
    const set = typesetPage(page(long), BOX, { fontPx: 123, align: "justify" });
    expect(set.fontPx).toBeLessThan(123);
    const lastBaseline = set.lines[set.lines.length - 1][0].baseline;
    expect(lastBaseline).toBeLessThanOrEqual(BOX.y + BOX.h);
    expect(set.lines[0][0].baseline - set.fontPx * 0.714).toBeGreaterThanOrEqual(BOX.y - 1);
    expect(set.lines[1][0].baseline - set.lines[0][0].baseline).toBeCloseTo(set.fontPx * LINE_HEIGHT, -1);
  });

  it("centres the block vertically in the box", () => {
    const one = typesetPage(page("midnight"), BOX, { fontPx: 123, align: "justify" });
    const mid = BOX.y + BOX.h / 2;
    expect(Math.abs(one.lines[0][0].baseline - mid)).toBeLessThan(123);
  });
});
