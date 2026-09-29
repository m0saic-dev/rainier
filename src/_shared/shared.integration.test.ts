/**
 * The `_shared` layer as ONE system: the seams between its modules, the files
 * they point at, and the guide baker's copy of the platform table. Each
 * module's own suite tests the module; this one tests that they fit together
 * the way Lyric Stack will use them.
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

import { parseM0StringToRenderFrames, validateM0String } from "@m0saic/dsl";
import { validateMosaicDocument } from "@m0saic/platform";
import type { HelloWorldProps, LatticeInsetSides } from "@m0saic/template-utils";
import {
  defineHelloWorldTemplate,
  defineMosaicTemplate,
  engineRecover,
  makeColorTile,
  placeInsetPieces,
  textToPath,
} from "@m0saic/template-utils";
import type {
  MosaicColor,
  MosaicDocument,
  MosaicDocumentPipeline,
  MosaicSource,
  MosaicTimedCue,
} from "@m0saic/types";

import type { LyricPage } from "../reels/lyric-triptych/v1/pages";
import { resolvePages } from "../reels/lyric-triptych/v1/pages";
import { declareBindings, unboundOf } from "./bindings";
import { BUNDLED_FONTS, FONT_OPTIONS, bundledFontPath, resolveFontPath } from "./fonts";
import type { Rect as GlyphRect, TextAlign } from "./glyph-text";
import {
  fitWordToBox,
  fontError,
  fontMetrics,
  measureWord,
  normalizeForFont,
  typesetPage,
  wordTile,
} from "./glyph-text";
import { audioPolicy, emitForPlatforms, guidePng } from "./platform-emit";
import type { Rect as PlatformRect, ShortPlatform } from "./platforms";
import { SHORT_PLATFORMS, platformStage, resolveShortPlatform } from "./platforms";
import { windowPages } from "./song-window";
import type { LyricStage, Rect as StageRect } from "./stage-layout";
import { layoutTakes, lyricBox, rectInset } from "./stage-layout";

const REPO = path.join(__dirname, "..", "..");

// ── shared helpers ──────────────────────────────────────────────────────────

/** Extremes of a glyph path's numbers (the engine emits absolute M/L/Q/C/Z: x, y pairs). */
function pathBox(d: string) {
  const n = (d.match(/-?\d*\.?\d+/g) ?? []).map(Number);
  const xs = n.filter((_, i) => i % 2 === 0);
  const ys = n.filter((_, i) => i % 2 === 1);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

const right = (r: PlatformRect) => r.x + r.w;
const bottom = (r: PlatformRect) => r.y + r.h;
const inside = (r: PlatformRect, box: PlatformRect) =>
  r.x >= box.x && r.y >= box.y && right(r) <= right(box) && bottom(r) <= bottom(box);
const overlapArea = (a: PlatformRect, b: PlatformRect) =>
  Math.max(0, Math.min(right(a), right(b)) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(bottom(a), bottom(b)) - Math.max(a.y, b.y));
const centre = (r: PlatformRect) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

const u = (...codePoints: number[]) => String.fromCodePoint(...codePoints);
const RSQUO = u(0x2019);
const LDQUO = u(0x201c);
const RDQUO = u(0x201d);
const ELLIPSIS = u(0x2026);
const EM_DASH = u(0x2014);

/** An invented lyric page with what Apple Notes types: curly quotes, an ellipsis, an em dash. */
const LYRIC = `Hold on ${RSQUO}til the lights go down${ELLIPSIS} we${RSQUO}re still singing ${EM_DASH} ${LDQUO}one more time${RDQUO}`;
const LYRIC_WORDS = LYRIC.split(/\s+/);

// ── 1. one Rect, one stage ──────────────────────────────────────────────────

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

describe("the modules share one geometry", () => {
  it("platforms, stage-layout and glyph-text declare the same Rect", () => {
    // A compile-time check: if one Rect drifts, this line stops type-checking.
    const agree: [Same<PlatformRect, StageRect>, Same<StageRect, GlyphRect>] = [true, true];
    expect(agree).toEqual([true, true]);
  });

  it.each(SHORT_PLATFORMS.map((p) => [p.slug, p] as const))(
    "%s: platformStage feeds lyricBox directly, at the export size and a draft size",
    (_slug, p) => {
      for (const [W, H] of [
        [1080, 1920],
        [720, 1280],
      ]) {
        const stage = platformStage(p, W, H);
        const lyricStage: LyricStage = stage; // no adapter
        for (const position of ["top", "middle", "bottom"] as const) {
          const box = lyricBox({ W, H, stage: lyricStage, position });
          expect([box.x, box.y, box.w, box.h].every(Number.isInteger)).toBe(true);
          expect(inside(box, stage.safe)).toBe(true);
          expect(overlapArea(box, stage.rail!)).toBe(0);
          expect(box.w).toBeGreaterThan(W / 2); // room for a line of lyrics on every row
        }
      }
    },
  );
});

// ── 2. the guide baker restates platforms.ts ────────────────────────────────

/** The `TABLE` object literal of tools/bake-platform-ui.mjs, evaluated on its own (plain numbers). */
function bakerTable(): Record<string, Record<string, unknown>> {
  const src = fs.readFileSync(path.join(REPO, "tools", "bake-platform-ui.mjs"), "utf8");
  const start = src.indexOf("const TABLE = {");
  const end = src.indexOf("\n};\n", start);
  if (start < 0 || end < 0) throw new Error("tools/bake-platform-ui.mjs: no `const TABLE = { ... };` block");
  const literal = src.slice(start + "const TABLE = ".length, end + 2);
  return vm.runInNewContext(`(${literal})`) as Record<string, Record<string, unknown>>;
}

describe("the guide baker and its PNGs", () => {
  const table = bakerTable();

  it("draws the platforms in platforms.ts order", () => {
    expect(Object.keys(table)).toEqual(SHORT_PLATFORMS.map((p) => p.slug));
  });

  it.each(SHORT_PLATFORMS.map((p) => [p.slug, p] as const))("%s: every TABLE number equals the live row", (slug, p) => {
    const spec = table[slug];
    expect(spec.canvas).toEqual(p.canvas);
    expect(spec.measured).toBe(p.measured);
    for (const group of ["chrome", "rail", "caption"] as const) {
      const want = p[group] as Record<string, number> | undefined;
      const got = spec[group] as Record<string, number> | undefined;
      expect(Boolean(got)).toBe(Boolean(want));
      if (!want || !got) continue;
      expect(Object.keys(got).sort()).toEqual(Object.keys(want).sort());
      for (const key of Object.keys(want)) expect(Math.abs(got[key] - want[key])).toBeLessThan(1e-12);
    }
  });

  it.each(SHORT_PLATFORMS.map((p) => [p.slug, p] as const))("%s: guidePng is a baked 1080x1920 RGBA PNG", (_slug, p) => {
    const file = guidePng(p);
    expect(path.basename(file)).toBe(`${p.slug}-ui.png`);
    expect(fs.existsSync(file)).toBe(true);
    const buf = fs.readFileSync(file);
    expect(buf.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(buf.toString("latin1", 12, 16)).toBe("IHDR");
    expect([buf.readUInt32BE(16), buf.readUInt32BE(20)]).toEqual([p.canvas.width, p.canvas.height]);
    expect([buf[24], buf[25]]).toEqual([8, 6]); // 8-bit, colour type 6 = RGBA
  });
});

// ── 3. fonts meet the glyph engine ──────────────────────────────────────────

describe("fonts resolve to files the glyph engine reads", () => {
  it("every picker option resolves to its bundled file, which opens cleanly", () => {
    expect(FONT_OPTIONS.map((o) => o.value)).toEqual(BUNDLED_FONTS.map((f) => f.id));
    for (const f of BUNDLED_FONTS) {
      const resolved = resolveFontPath({ font: f.id }, { readError: fontError });
      expect(resolved).toEqual({ path: bundledFontPath(f.id), source: "bundled" });
      expect(fontError(resolved.path)).toBeNull();
    }
  });

  it("a user file the engine cannot open falls back with a warning; one it can open is used", () => {
    const missing = path.join(REPO, "no-such-folder", "brand.ttf");
    const fallback = resolveFontPath({ font: "bangers", fontFile: missing }, { readError: fontError });
    expect(fallback.path).toBe(bundledFontPath("bangers"));
    expect(fallback.warning).toMatch(/^The font file "brand\.ttf" couldn't be opened .* Using Bangers instead\.$/);
    // A real TTF passed as the user's own file (any readable path works the same).
    const own = bundledFontPath("righteous");
    expect(resolveFontPath({ font: "bangers", fontFile: own }, { readError: fontError })).toEqual({
      path: own,
      source: "file",
    });
  });
});

describe.each(BUNDLED_FONTS.map((f) => [f.id, bundledFontPath(f.id)] as const))("glyph text in %s", (_id, fontPath) => {
  // The Reels lyric box, in the page child's own space (what Lyric Stack typesets into).
  const reels = resolveShortPlatform("instagram-reel");
  const canvasBox = lyricBox({ W: 1080, H: 1920, stage: platformStage(reels, 1080, 1920), position: "middle" });
  const local: GlyphRect = { x: 0, y: 0, w: canvasBox.w, h: canvasBox.h };

  it("draws the pasted typographic characters as they are (nothing missing, nothing swapped)", () => {
    expect(normalizeForFont(LYRIC, fontPath)).toEqual({ text: LYRIC, missing: [] });
  });

  it("kerns (AV or To is tighter than its letters apart)", () => {
    const adv = (s: string) => measureWord(s, 100, fontPath);
    const kern = (pair: string) => adv(pair) - adv(pair[0]) - adv(pair[1]);
    expect(Math.min(kern("AV"), kern("To"))).toBeLessThan(-0.5);
  });

  it.each(["justify", "left", "center"] as TextAlign[])("%s: a page fits, and every tile is an exact, contained mask", (align) => {
    const page = typesetPage(LYRIC_WORDS, local, { fontPx: 96, align, fontPath });
    expect(page.fits).toBe(true);
    expect(page.lines.flatMap((l) => l.words.map((w) => w.index))).toEqual(LYRIC_WORDS.map((_, i) => i));
    const { ascent } = fontMetrics(fontPath, page.fontPx);
    for (const line of page.lines) {
      for (const w of line.words) {
        const t = wordTile(w.text, w.x, line.baseline, page.fontPx, fontPath);
        expect([t.rect.x, t.rect.y, t.rect.w, t.rect.h].every(Number.isInteger)).toBe(true);
        expect(t.bounds).toEqual({ x: 0, y: 0, width: t.rect.w, height: t.rect.h });
        expect(inside(t.rect, local)).toBe(true);
        expect(t.d.length).toBeGreaterThan(0);
        const b = pathBox(t.d);
        expect(b.minX).toBeGreaterThanOrEqual(-0.01);
        expect(b.minY).toBeGreaterThanOrEqual(-0.01);
        expect(b.maxX).toBeLessThanOrEqual(t.rect.w + 0.01);
        expect(b.maxY).toBeLessThanOrEqual(t.rect.h + 0.01);
        // The pen and the baseline land exactly where the typesetter put them.
        const ref = pathBox(
          textToPath(w.text, { fontSize: page.fontPx, hAlign: "left", vAlign: "top", fontPath }, { width: 1, height: 1 }),
        );
        expect(t.rect.x + b.minX - w.x).toBeCloseTo(ref.minX, 1.5);
        expect(t.rect.y + b.maxY - line.baseline).toBeCloseTo(ref.maxY - ascent, 1.5);
      }
    }
  });

  it("fitWordToBox centres a word, keeps the centre when the box doubles, and round-trips a moved tile", () => {
    const box = { x: 100, y: 700, w: 600, h: 240 };
    const doubled = { x: -200, y: 580, w: 1200, h: 480 }; // same centre
    const a = fitWordToBox("night", box, fontPath);
    const b = fitWordToBox("night", doubled, fontPath);
    expect(b.fontPx).toBeCloseTo(2 * a.fontPx, 9);
    const ta = wordTile("night", a.x, a.baseline, a.fontPx, fontPath);
    const tb = wordTile("night", b.x, b.baseline, b.fontPx, fontPath);
    expect(inside(ta.rect, box)).toBe(true);
    for (const t of [ta, tb]) {
      expect(Math.abs(centre(t.rect).x - centre(box).x)).toBeLessThan(0.5);
      expect(Math.abs(centre(t.rect).y - centre(box).y)).toBeLessThan(0.5);
    }
    const moved = { ...ta.rect, x: ta.rect.x + 37, y: ta.rect.y - 12 };
    const again = fitWordToBox("night", moved, fontPath);
    expect(again.fontPx).toBeCloseTo(a.fontPx, 9);
    expect(wordTile("night", again.x, again.baseline, again.fontPx, fontPath).rect).toEqual(moved);
  });

  it("is deterministic", () => {
    const opts = { fontPx: 96, align: "justify" as const, fontPath };
    expect(typesetPage(LYRIC_WORDS, local, opts)).toEqual(typesetPage(LYRIC_WORDS, local, opts));
    expect(wordTile("singing", 10.25, 200.75, 88, fontPath)).toEqual(wordTile("singing", 10.25, 200.75, 88, fontPath));
  });
});

// ── 4. song-window takes the lyric templates' page shape ────────────────────

describe("song-window over the triptych's LyricPage", () => {
  it("windows resolved pages and keeps the caller's type and fields", () => {
    // Invented placeholder lyrics, timed against a 30 s song.
    const cues: MosaicTimedCue[] = [
      { text: "first page here", startMs: 1_000, endMs: 4_000 },
      { text: "second page\nwith a break", startMs: 4_000, endMs: 9_000 },
      { text: "[break]", startMs: 9_000, endMs: 10_000 },
      { text: "third page", startMs: 10_000 },
    ];
    const song: LyricPage[] = resolvePages(cues, 30_000);
    // The clip: song 3 s .. 11 s.
    const clip: LyricPage[] = windowPages(song, { songStartMs: 3_000, durationMs: 8_000 });
    expect(clip.map((p) => [p.startMs, p.endMs])).toEqual([
      [0, 1_000],
      [1_000, 6_000],
      [7_000, 8_000],
    ]);
    expect(clip.map((p) => p.words.map((w) => w.text).join(" "))).toEqual([
      "first page here",
      "second page with a break",
      "third page",
    ]);
    expect(clip[1].words.map((w) => w.lineBreakBefore)).toEqual([false, false, true, false, false]);
    for (const p of clip) for (const w of p.words) expect(w.atMs >= p.startMs && w.atMs <= p.endMs).toBe(true);
  });
});

// ── 5. the pieces compose into documents the platform validator accepts ─────

const TAKE_COLOURS = ["#2B3A55", "#553A2B", "#2B5540", "#40402B"] as MosaicColor[];
const INK = "#FFFFFF" as MosaicColor;

type MiniDocument = {
  doc: MosaicDocument;
  /** The lyric box (canvas px), the takes' painted rects, and the word tiles' rects (page-child px). */
  box: StageRect;
  takes: StageRect[];
  words: StageRect[];
};

/** A Lyric-Stack-shaped document: a takes lattice, one page child of masked word tiles in the lyric box. */
function miniDocument(p: ShortPlatform, multi: boolean): MiniDocument {
  const W = p.canvas.width;
  const H = p.canvas.height;
  const fontPath = resolveFontPath({ font: "anton" }, { readError: fontError }).path;
  const box = lyricBox({ W, H, stage: platformStage(p, W, H), position: "middle" });
  const takes = layoutTakes({ W, H, count: 3, layout: "auto", borderPx: 6 });
  const takeSources: MosaicSource[] = takes.insets.map((inset, i) =>
    makeColorTile(TAKE_COLOURS[i], inset ? { placement: { inset } } : {}),
  );

  const page = typesetPage(LYRIC_WORDS, { x: 0, y: 0, w: box.w, h: box.h }, { fontPx: 96, align: "center", fontPath });
  const tiles = page.lines.flatMap((line) => line.words.map((w) => wordTile(w.text, w.x, line.baseline, page.fontPx, fontPath)));
  const pieces = tiles.map((t) => ({
    rect: t.rect,
    source: makeColorTile(INK, { mask: { kind: "inline-mask", localPath: t.d, bounds: t.bounds } }),
  }));
  const placed = placeInsetPieces({ rootW: box.w, rootH: box.h, pieces });
  const child: MosaicDocument = {
    kind: "mosaic_document",
    version: 1,
    m0: placed.m0,
    size: { width: box.w, height: box.h },
    durationMs: 20_000,
    assets: {},
    sources: placed.sources,
  };

  const inset = rectInset({ x: 0, y: 0, w: W, h: H }, box);
  const pageRef: MosaicSource = { type: "mosaic", ref: "page-1", ...(inset ? { placement: { inset } } : {}) };
  const m0 = `${takes.m0}{1}`;
  expect(validateM0String(m0)).toEqual({ ok: true });
  const doc: MosaicDocument = {
    kind: "mosaic_document",
    version: 1,
    m0: m0 as MosaicDocument["m0"],
    size: { width: W, height: H },
    fps: 30,
    durationMs: 20_000,
    backgroundColor: "#0A0A0A" as MosaicColor,
    assets: {},
    sources: [...takeSources, pageRef],
    children: { "page-1": child },
    ...audioPolicy({ multi }),
  };
  return { doc, box, takes: takes.takes, words: tiles.map((t) => t.rect) };
}

const errorsOf = (doc: MosaicDocument) =>
  validateMosaicDocument(doc, doc.size!.width, doc.size!.height).filter((d) => d.severity === "error");

/** Where the engine paints each source: its m0 frame (source order), recovered through its placement.inset. */
function paintedRects(doc: MosaicDocument): StageRect[] {
  const frames = parseM0StringToRenderFrames(doc.m0, doc.size!.width, doc.size!.height)
    .slice()
    .sort((a, b) => a.logicalIndex - b.logicalIndex);
  return frames.map((f, i) => {
    const placement = (doc.sources[i] as { placement?: { inset?: LatticeInsetSides } }).placement;
    return engineRecover({ x: f.x, y: f.y, w: f.width, h: f.height }, placement?.inset);
  });
}

describe("a Lyric-Stack-shaped document built from _shared", () => {
  it.each(SHORT_PLATFORMS.map((p) => [p.slug, p] as const))("%s: validates, and paints exactly where _shared said", (_slug, p) => {
    const { doc, box, takes, words } = miniDocument(p, false);
    const page = doc.children!["page-1"] as MosaicDocument;
    expect(errorsOf(doc)).toEqual([]);
    expect(errorsOf(page)).toEqual([]);
    // Root: the takes on their lattice rects, then the page on the lyric box.
    expect(paintedRects(doc)).toEqual([...takes, box]);
    // Page child: every word tile on its exact rect (placeInsetPieces reorders
    // the sources, so compare as sets), each mask's bounds its tile's own size.
    const painted = paintedRects(page);
    const byPos = (a: StageRect, b: StageRect) => a.y - b.y || a.x - b.x || a.w - b.w || a.h - b.h;
    expect(words).toHaveLength(LYRIC_WORDS.length);
    expect(painted.slice().sort(byPos)).toEqual(words.slice().sort(byPos));
    page.sources.forEach((s, i) => {
      expect((s as { mask?: { bounds?: unknown } }).mask?.bounds).toEqual({ x: 0, y: 0, width: painted[i].w, height: painted[i].h });
    });
  });

  it('"all" fans out to three valid 1080x1920 files named reels, tiktok, shorts, each AAC 320k', () => {
    const out = emitForPlatforms("all", 30, (p) => miniDocument(p, true).doc) as MosaicDocumentPipeline;
    expect(out.emit).toBe("multi");
    expect(out.steps.map((s) => s.name)).toEqual(["reels", "tiktok", "shorts"]);
    for (const step of out.steps) {
      const file = step.file as MosaicDocument;
      expect(file.size).toEqual({ width: 1080, height: 1920 });
      expect(file.audio).toMatchObject({ codec: "aac", bitrate: "320k" });
      expect(errorsOf(file)).toEqual([]);
    }
  });
});

// ── 6. bindings survive defineMosaicTemplate ────────────────────────────────

describe("declareBindings", () => {
  it("survives defineMosaicTemplate (the 0.3.0 audit reads it off the defined template)", () => {
    const card = defineHelloWorldTemplate({ id: "@rainier/test/bindings/v1", label: "t", subline: "s" });
    const defined = defineMosaicTemplate<HelloWorldProps>({ ...card, ...declareBindings({ subline: "text" }) });
    expect(unboundOf(defined)).toEqual({ subline: "text" });
  });
});
