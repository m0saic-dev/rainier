import { measureText } from "@m0saic/template-utils";

import { platformStage, resolveShortPlatform } from "../../../_shared/platforms";
import { ADVISORY_MAX_LINES, ADVISORY_TEXT_FRAC, drawable, drawableText, layoutAdvisory, nameChar, shortenToken } from "./advisory";

const RESET = "Word positions reset: the words on screen changed. Clear Word positions, then drag again.";
const LIMIT = "Reels stop at 3:00 - this clip is 3:24.";
const FONT = 'The font file "Fancy.woff2" can\'t be read; convert it to TTF. Using Anton instead.';

const stageAt = (W: number, H: number, id: Parameters<typeof resolveShortPlatform>[0] = "instagram-reel") =>
  platformStage(resolveShortPlatform(id), W, H);

describe("layoutAdvisory", () => {
  it("nothing to say: no strip", () => {
    expect(layoutAdvisory([], { W: 1080, H: 1920, stage: stageAt(1080, 1920) })).toBeNull();
    expect(layoutAdvisory(["  ", ""], { W: 1080, H: 1920, stage: stageAt(1080, 1920) })).toBeNull();
  });

  it("sits at the top of the safe area, inside its side margins, a thin strip (never the canvas)", () => {
    for (const [W, H] of [
      [1080, 1920],
      [540, 960],
    ]) {
      for (const id of ["instagram-reel", "tiktok", "youtube-shorts"] as const) {
        const stage = stageAt(W, H, id);
        const a = layoutAdvisory([LIMIT], { W, H, stage });
        expect(a).not.toBeNull();
        if (!a) continue;
        const m = Math.max(4, Math.round(W * 0.02));
        expect(a.rect).toMatchObject({ x: stage.safe.x + m, y: stage.safe.y + m, w: stage.safe.w - 2 * m });
        expect(a.lines).toBe(1);
        expect(a.rect.w * a.rect.h).toBeLessThan(0.05 * W * H);
        // Clear of the rail: every rail on file starts below the top strip.
        if (stage.rail) expect(a.rect.y + a.rect.h).toBeLessThan(stage.rail.y);
      }
    }
  });

  it("wraps the long notes instead of drawing one line wider than the stage (1080 and 540 wide)", () => {
    for (const [W, H] of [
      [1080, 1920],
      [540, 960],
    ]) {
      const a = layoutAdvisory([LIMIT, FONT, RESET], { W, H, stage: stageAt(W, H) });
      expect(a).not.toBeNull();
      if (!a) continue;
      const lines = a.text.split("\n");
      expect(lines.length).toBe(a.lines);
      expect(lines.length).toBeLessThanOrEqual(ADVISORY_MAX_LINES);
      for (const line of lines) {
        expect(measureText(line, { fontSize: a.fontSize }).width).toBeLessThanOrEqual(Math.floor(a.rect.w * ADVISORY_TEXT_FRAC));
      }
      // Nothing lost: every word of every note is on screen, in order.
      expect(lines.join(" ")).toBe([LIMIT, FONT, RESET].join(" "));
      // Readable: at most a step below the base size, and the strip holds every line.
      expect(a.fontSize).toBeGreaterThanOrEqual(Math.round(Math.max(10, Math.round(W * 0.026)) * 0.8));
      expect(a.rect.h).toBeGreaterThanOrEqual(lines.length * Math.round(a.fontSize * 1.25));
    }
  });

  it("past the line cap it cuts the last line with an ellipsis rather than overflowing", () => {
    const notes = Array.from({ length: 12 }, (_, i) => `Note number ${i} says something long enough to need its own line here.`);
    const a = layoutAdvisory(notes, { W: 540, H: 960, stage: stageAt(540, 960) });
    expect(a?.lines).toBe(ADVISORY_MAX_LINES);
    expect(a?.text.split("\n").pop()?.endsWith("...")).toBe(true);
  });

  it("moves to the bottom of the safe area (left of the rail) when the top strip would cover a word", () => {
    const stage = stageAt(1080, 1920);
    const top = layoutAdvisory([LIMIT], { W: 1080, H: 1920, stage });
    const word = { x: 300, y: (top?.rect.y ?? 0) + 4, w: 200, h: 100 };
    const a = layoutAdvisory([LIMIT], { W: 1080, H: 1920, stage, avoid: [word] });
    expect(a?.rect.y).toBeGreaterThan(960);
    expect((a?.rect.y ?? 0) + (a?.rect.h ?? 0)).toBeLessThanOrEqual(stage.safe.y + stage.safe.h);
    expect((a?.rect.x ?? 0) + (a?.rect.w ?? 0)).toBeLessThan(stage.rail?.x ?? 1080);
  });

  it("words at both ends: the first band down the safe area that touches no word, never a word", () => {
    // The reviewer's case: a clip over 3:00, one word dragged up, another down.
    const stage = stageAt(1080, 1920);
    const top = layoutAdvisory([LIMIT, FONT, RESET], { W: 1080, H: 1920, stage });
    const bottom = layoutAdvisory([LIMIT, FONT, RESET], { W: 1080, H: 1920, stage, avoid: [{ x: 300, y: 280, w: 200, h: 120 }] });
    const avoid = [
      { x: 300, y: 280, w: 200, h: 120 },
      { x: 300, y: 1500, w: 200, h: 120 },
    ];
    const a = layoutAdvisory([LIMIT, FONT, RESET], { W: 1080, H: 1920, stage, avoid });
    expect(a).not.toBeNull();
    if (!a || !top || !bottom) return;
    const hit = (r: { x: number; y: number; w: number; h: number }) =>
      avoid.some((b) => r.x < b.x + b.w && b.x < r.x + r.w && r.y < b.y + b.h && b.y < r.y + r.h);
    expect(hit(top.rect) && hit(bottom.rect)).toBe(true);
    expect(hit(a.rect)).toBe(false);
    expect(a.rect.y).toBe(400); // just under the word dragged up
    expect(a.rect.y + a.rect.h).toBeLessThanOrEqual(stage.safe.y + stage.safe.h);
    // Every note kept.
    expect(a.text.replace(/\n/g, " ")).toBe([LIMIT, FONT, RESET].join(" "));
  });

  it("no word-free band for the notes: one line, then the place that covers the least", () => {
    const stage = stageAt(1080, 1920);
    // Words down the whole safe area, with gaps a full strip cannot use but one line can.
    const rows = Array.from({ length: 12 }, (_, k) => ({ x: 100, y: stage.safe.y + k * 150, w: 800, h: 80 }));
    const a = layoutAdvisory([LIMIT, FONT, RESET], { W: 1080, H: 1920, stage, avoid: rows });
    expect(a?.lines).toBe(1);
    expect(a?.text.endsWith("(+2 more)")).toBe(true);
    const hit = (r: { x: number; y: number; w: number; h: number }) =>
      rows.some((b) => r.x < b.x + b.w && b.x < r.x + r.w && r.y < b.y + b.h && b.y < r.y + r.h);
    expect(a && hit(a.rect)).toBe(false);
    // The whole safe area covered: still one line, wherever it covers the least.
    const wall = [{ x: 0, y: 0, w: 1080, h: 1920 }];
    const b = layoutAdvisory([LIMIT, FONT], { W: 1080, H: 1920, stage, avoid: wall });
    expect(b?.lines).toBe(1);
  });

  it("a word wider than the strip (a long font file name) is shortened in the middle, never drawn past the strip", () => {
    const name = "/Users/artist/Music/Fonts/MyHandLetteredDisplayFontFinalVersionExportedFromGlyphsApp_v2_final_FINAL.woff2";
    const base = name.split("/").pop() as string;
    const note = `The font file "${base}" can't be read; convert it to TTF. Using Anton instead.`;
    for (const [W, H] of [
      [1080, 1920],
      [540, 960],
    ]) {
      for (const notes of [[note], [LIMIT, note, RESET]]) {
        const a = layoutAdvisory(notes, { W, H, stage: stageAt(W, H) });
        expect(a).not.toBeNull();
        if (!a) continue;
        const textW = Math.floor(a.rect.w * ADVISORY_TEXT_FRAC);
        for (const line of a.text.split("\n")) {
          expect({ W, line, fits: measureText(line, { fontSize: a.fontSize }).width <= textW }).toEqual({ W, line, fits: true });
        }
        // Shortened in the middle: its start and its extension survive.
        expect(a.text).toContain("MyHand");
        expect(a.text).toContain('FINAL.woff2"');
        expect(a.text).toContain("...");
        expect(a.text).toContain("convert it to TTF");
      }
    }
  });

  it("shortenToken keeps a token that fits, and otherwise the most of its start and end that fit", () => {
    expect(shortenToken("short", 20, 1000)).toBe("short");
    const long = "abcdefghijklmnopqrstuvwxyz0123456789";
    const cut = shortenToken(long, 20, 120);
    expect(measureText(cut, { fontSize: 20 }).width).toBeLessThanOrEqual(120);
    expect(cut.startsWith("abc")).toBe(true);
    expect(cut.endsWith("789")).toBe(true);
    expect(cut).toContain("...");
    // One more character would not fit.
    expect(cut.length).toBeGreaterThan(8);
  });

  it("is deterministic", () => {
    const run = () => JSON.stringify(layoutAdvisory([LIMIT, RESET], { W: 720, H: 1280, stage: stageAt(720, 1280, "tiktok") }));
    expect(run()).toBe(run());
  });
});

describe("drawable text", () => {
  it("keeps what the bundled face draws and shows anything else as ?", () => {
    expect(drawable("a") && drawable("é") && drawable("ł") && drawable(" ")).toBe(true);
    expect(drawable("日") || drawable("→") || drawable("\u{1f600}")).toBe(false);
    expect(drawableText('The font file "Café 日本.woff2"\ncan\'t be read.')).toBe('The font file "Café ??.woff2" can\'t be read.');
  });

  it("names a character by itself when drawable, else by its code point", () => {
    expect(nameChar("é")).toBe('"é"');
    expect(nameChar("日")).toBe("U+65E5");
    expect(nameChar("\u{1f600}")).toBe("U+1F600");
  });
});
