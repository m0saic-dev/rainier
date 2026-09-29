import type { MosaicColor, MosaicDocument, MosaicSource } from "@m0saic/types";
import { parseM0StringToRenderFrames, validateM0String } from "@m0saic/dsl";
import { evaluateM0 } from "@m0saic/dsl-stdlib";
import { isSmooth } from "@m0saic/template-utils";

import { audioPolicy, guidePng, guideTiles } from "../../../_shared/platform-emit";
import { platformStage, resolveShortPlatform } from "../../../_shared/platforms";
import { layoutTakes } from "../../../_shared/stage-layout";
import type { Rect } from "../../../_shared/glyph-text";
import type { StackArgs, StackPage, StackWord } from "./document";
import {
  ALPHA_TILE_PX,
  CLEAR_ASSET_ID,
  GLOW_REACH_SIGMA,
  NODE_TILE_BUDGET,
  PAGES_PER_SHEET,
  ROOT_RESERVED,
  WORDS_PER_LINKED_NODE,
  WORDS_PER_NODE,
  alphaTileRect,
  buildLyricStack,
  chunkWords,
  inkReach,
  latticeUnit,
  nest,
  packUnits,
  snapBox,
  stackOverlays,
} from "./document";

const W = 1080;
const H = 1920;
const D = "M0 0L10 0L10 10Z";

const word = (index: number, startMs: number, endMs: number): StackWord => ({
  index,
  box: index,
  text: `w${index}`,
  rect: { x: 100 + (index % 5) * 150, y: 600 + Math.floor((index % 20) / 5) * 130, w: 140, h: 120 },
  d: D,
  window: { startMs, endMs },
  risePx: 19,
});

/** `n` pages of `perPage` words, one second each. */
function pages(n: number, perPage: number): StackPage[] {
  let index = 0;
  return Array.from({ length: n }, (_, p) => ({
    words: Array.from({ length: perPage }, (_, k) => word(index++, p * 1000 + k * 10, (p + 1) * 1000)),
    glowSigma: 6,
  }));
}

const args = (over: Partial<StackArgs> = {}): StackArgs => ({
  W,
  H,
  fps: 30,
  durationMs: 60_000,
  takes: layoutTakes({ W, H, count: 3, layout: "auto", borderPx: 6 }),
  slots: [1, 2, 3].map((n) => ({
    propKey: `take${n}`,
    trimKey: `take${n}TrimSec`,
    framingKey: `take${n}Framing`,
    trimStartMs: 0,
    framing: 0.5,
    placeholder: { color: "#222222" as MosaicColor, label: `Take ${n}` },
  })),
  pages: pages(3, 4),
  style: {
    textColor: "#FFFFFF" as MosaicColor,
    glow: 0.5,
    glowColor: "#FF3366" as MosaicColor,
    borderColor: "#0A0A0A" as MosaicColor,
    entrance: "rise",
  },
  clearPngPath: "/repo/assets/clear.png",
  output: audioPolicy({}),
  ...over,
});

type Node = { key: string; doc: MosaicDocument };
/** Every child in the tree, depth first (children nest where they are referenced). */
const childNodes = (doc: MosaicDocument): Node[] =>
  Object.entries(doc.children ?? {}).flatMap(([key, d]) => [
    { key, doc: d as MosaicDocument },
    ...childNodes(d as MosaicDocument),
  ]);

/** Tiles on a node's overlay chain: every tile of a child; the root's overlay nest (takes excluded). */
const overlayTiles = (doc: MosaicDocument, isRoot: boolean, takes = 0) =>
  isRoot ? doc.sources.length - takes : doc.sources.length;

const feasible = (m0: string) => {
  expect(validateM0String(m0).ok).toBe(true);
  const ev = evaluateM0(m0, { width: W, height: H });
  expect(ev.feasible && ev.meetsPrecision).toBe(true);
  expect(parseM0StringToRenderFrames(m0, W, H).length).toBeGreaterThan(0);
};

/** The rect source `i` of a node paints in the node's own px: its frame minus its recovery inset (the engine's floor math). */
const painted = (doc: MosaicDocument, i: number) => {
  const f = parseM0StringToRenderFrames(String(doc.m0), doc.size?.width ?? W, doc.size?.height ?? H)[i];
  const inset = ((doc.sources[i] as { placement?: { inset?: Record<string, number> } }).placement?.inset ?? {}) as Record<
    string,
    number
  >;
  const l = Math.floor((inset.left ?? 0) * f.width);
  const r = Math.floor((inset.right ?? 0) * f.width);
  const t = Math.floor((inset.top ?? 0) * f.height);
  const b = Math.floor((inset.bottom ?? 0) * f.height);
  return { x: f.x + l, y: f.y + t, w: f.width - l - r, h: f.height - t - b };
};
const isPageItem = (key: string) => key.startsWith("page_") || key.startsWith("glow_");

type Placed = { key: string; doc: MosaicDocument; box: Rect; parent: string; sized: boolean };
/**
 * Every child with the root-px box it is drawn in: its ref's frame (a
 * container carries no inset), composed down the tree. `sized` is false for a
 * child whose declared size is not its ref's cell (the engine would scale it).
 */
function placed(doc: MosaicDocument, box: Rect = { x: 0, y: 0, w: W, h: H }, parent = "root"): Placed[] {
  const frames = parseM0StringToRenderFrames(String(doc.m0), box.w, box.h);
  return doc.sources.flatMap((s, i) => {
    if (s.type !== "mosaic") return [];
    const child = (doc.children as Record<string, MosaicDocument>)[s.ref];
    const f = frames[i];
    const b = { x: box.x + f.x, y: box.y + f.y, w: f.width, h: f.height };
    const sized = s.placement?.inset === undefined && child.size?.width === f.width && child.size?.height === f.height;
    return [{ key: s.ref, doc: child, box: b, parent, sized }, ...placed(child, b, s.ref)];
  });
}
/** Every word tile with the root-px rect it paints. */
const wordsOf = (doc: MosaicDocument) =>
  placed(doc).flatMap(({ key, doc: d, box }) =>
    d.sources.flatMap((s, i) => {
      if (s.type !== "lavfi") return [];
      const r = painted(d, i);
      return [{ node: key, label: String(s.editor?.label), source: s, rect: { x: box.x + r.x, y: box.y + r.y, w: r.w, h: r.h } }];
    }),
  );
const inside = (r: Rect, b: Rect) => r.x >= b.x && r.y >= b.y && r.x + r.w <= b.x + b.w && r.y + r.h <= b.y + b.h;
const touches = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe("lyric-stack document", () => {
  it("puts a few pages straight under the root, every glow ref under every ink ref, windows shared", () => {
    // Glows first: pages never share a window, but the chunks of a long page
    // do, and a later chunk's halo must not paint over an earlier chunk's words.
    const plan = buildLyricStack(args());
    const refs = plan.doc.sources.filter((s) => s.type === "mosaic") as Array<Extract<MosaicSource, { type: "mosaic" }>>;
    expect(refs.map((r) => r.ref)).toEqual(["glow_1", "glow_2", "glow_3", "page_1", "page_2", "page_3"]);
    expect(plan.sheets).toBe(0);
    expect(refs[0].effects?.blur).toBe(6);
    expect(refs[0].visual?.opacity).toBe(0.75);
    expect(refs[0].overlay).toEqual(refs[3].overlay);
    expect(refs[3].overlay).toEqual({ enable: "between(t,0.000,0.999)", window: { startSec: 0, endSec: 0.999 } });
    // Containers hug their words: no recovery inset, each child drawn 1:1 in its ref's cell, well under the canvas.
    expect(refs.every((r) => r.placement?.inset === undefined)).toBe(true);
    for (const c of placed(plan.doc)) {
      expect({ key: c.key, sized: c.sized }).toEqual({ key: c.key, sized: true });
      expect(c.box.w * c.box.h).toBeLessThan(0.25 * W * H);
    }
  });

  it("every page child is its box: lattice-aligned, even, 5-smooth, holding its words, their rise and its glow's reach", () => {
    const plan = buildLyricStack(args());
    const ux = latticeUnit(W);
    const uy = latticeUnit(H);
    const byKey = new Map(placed(plan.doc).map((c) => [c.key, c]));
    args().pages.forEach((page, p) => {
      const ink = byKey.get(`page_${p + 1}`);
      const glow = byKey.get(`glow_${p + 1}`);
      if (!ink || !glow) throw new Error(`page ${p + 1} missing`);
      const reach = inkReach(page.words, "rise", W, H);
      expect(inside(reach, ink.box)).toBe(true);
      const pad = GLOW_REACH_SIGMA * page.glowSigma;
      expect(inside({ x: reach.x - pad, y: reach.y - pad, w: reach.w + 2 * pad, h: reach.h + 2 * pad }, glow.box)).toBe(true);
      for (const c of [ink, glow]) {
        expect([c.box.x % ux, c.box.y % uy, c.box.w % ux, c.box.h % uy]).toEqual([0, 0, 0, 0]);
        expect(isSmooth(c.box.w) && isSmooth(c.box.h)).toBe(true);
      }
    });
  });

  it("every page child keeps the clear PNG as a small corner tile clear of its words, and paints in its own ink", () => {
    // The PNG only has to be THERE (it earns the child an alpha carrier); a
    // full-canvas one was a click target over every word in Make.
    const plan = buildLyricStack(args());
    for (const { key, doc } of placed(plan.doc)) {
      expect(doc.durationMs).toBe(60_000);
      const base = doc.sources[0];
      expect(base.type === "media" && base.mediaType === "image" && base.assetId === CLEAR_ASSET_ID).toBe(true);
      expect(base.editor?.label).toBe(`${key}:alpha-base`);
      const tile = painted(doc, 0);
      expect([tile.w, tile.h]).toEqual([ALPHA_TILE_PX, ALPHA_TILE_PX]);
      // A corner of the child, under no word.
      expect(tile.x === 0 || tile.x + tile.w === doc.size?.width).toBe(true);
      expect(tile.y === 0 || tile.y + tile.h === doc.size?.height).toBe(true);
      doc.sources.forEach((s, i) => {
        if (s.type === "lavfi") expect({ key, i, hit: touches(painted(doc, i), tile) }).toEqual({ key, i, hit: false });
      });
      expect(doc.sources.slice(1).every((s) => s.type === "lavfi")).toBe(true);
      expect((doc.assets as unknown as Record<string, { path: string }>)[CLEAR_ASSET_ID].path).toBe("/repo/assets/clear.png");
      expect(doc.backgroundColor).toBe(key.startsWith("glow") ? "#FF3366" : "#FFFFFF");
      const ev = evaluateM0(String(doc.m0), { width: Number(doc.size?.width), height: Number(doc.size?.height) });
      expect(validateM0String(String(doc.m0)).ok && ev.feasible && ev.meetsPrecision).toBe(true);
    }
    feasible(String(plan.doc.m0));
  });

  it("word tiles paint exactly their root rects through their child (glow twins too)", () => {
    for (const glow of [0, 0.5]) {
      const plan = buildLyricStack(args({ style: { ...args().style, glow } }));
      const tiles = wordsOf(plan.doc);
      expect(tiles).toHaveLength(12 * (glow > 0 ? 2 : 1));
      for (const t of tiles) {
        const index = Number(t.label.replace("word-", "")) - 1;
        expect({ label: t.label, rect: t.rect }).toEqual({ label: t.label, rect: word(index, 0, 1).rect });
      }
    }
  });

  it("binds a word tile to its SLOT (the clip's reading order), labels it by its global index", () => {
    // A clip starting mid-song: global words 8..11 are the clip's slots 0..3.
    const clip: StackPage[] = [
      { words: [8, 9, 10, 11].map((i, k) => ({ ...word(i, k * 10, 1000), box: k })), glowSigma: 6 },
    ];
    const plan = buildLyricStack(args({ pages: clip }));
    const tiles = (plan.doc.children as Record<string, MosaicDocument>).page_1.sources.filter((s) => s.type === "lavfi");
    expect(tiles.map((t) => t.editor?.label)).toEqual(["word-9", "word-10", "word-11", "word-12"]);
    expect(tiles[0].editor?.bindings?.[0]).toEqual({ propKey: "wordBoxes", index: 0, kind: "rect" });
    expect(tiles.slice(1).map((t) => t.editor?.binding?.index)).toEqual([1, 2, 3]);
  });

  it("skips a word whose rect leaves the canvas instead of throwing (a backstop: the layout keeps words on it)", () => {
    const off = (rect: StackWord["rect"]): StackWord => ({ ...word(1, 0, 1000), rect });
    const plan = buildLyricStack(
      args({
        pages: [
          {
            words: [word(0, 0, 1000), off({ x: -8, y: 600, w: 300, h: 120 }), off({ x: 1070, y: 400, w: 12, h: 40 })],
            glowSigma: 6,
          },
        ],
      }),
    );
    const tiles = (plan.doc.children as Record<string, MosaicDocument>).page_1.sources.filter((s) => s.type === "lavfi");
    expect(tiles.map((t) => t.editor?.label)).toEqual(["word-1"]);
  });

  it("binds ink words to wordBoxes (first word of a page also to textColor); glow copies stay unbound", () => {
    const plan = buildLyricStack(args());
    const page1 = (plan.doc.children as Record<string, MosaicDocument>).page_1;
    const words = page1.sources.filter((s) => s.type === "lavfi");
    const first = words.find((s) => s.editor?.label === "word-1");
    expect(first?.editor?.bindings).toEqual([
      { propKey: "wordBoxes", index: 0, kind: "rect" },
      { propKey: "textColor" },
    ]);
    const second = words.find((s) => s.editor?.label === "word-2");
    expect(second?.editor?.binding).toEqual({ propKey: "wordBoxes", index: 1, kind: "rect" });
    const glow1 = (plan.doc.children as Record<string, MosaicDocument>).glow_1;
    expect(glow1.sources.every((s) => !s.editor?.binding && !s.editor?.bindings)).toBe(true);
    expect(glow1.sources.filter((s) => s.type === "lavfi").every((s) => s.type === "lavfi" && s.color === "#FF3366")).toBe(
      true,
    );
  });

  it("glow refs composite with plain alpha for every colour, on the root and inside sheets (no blendMode)", () => {
    // The 0.2.0 engine's blend drops alpha: multiply blacks out the frame, and
    // screen inside a sheet turns the sheet opaque (document.ts, GLOW BLEND).
    for (const glowColor of ["#FFFFFF", "#FF3366", "#000000"] as MosaicColor[]) {
      for (const n of [3, 40]) {
        const plan = buildLyricStack(args({ pages: pages(n, 3), style: { ...args().style, glowColor } }));
        const refs = [plan.doc, ...childNodes(plan.doc).map((c) => c.doc)].flatMap((d) =>
          d.sources.filter((s) => s.type === "mosaic"),
        );
        expect(refs.some((r) => r.effects?.blur)).toBe(true);
        expect(refs.filter((r) => r.overlay?.blendMode !== undefined)).toEqual([]);
      }
    }
  });

  it("no glow children when glow is 0", () => {
    const plan = buildLyricStack(args({ style: { ...args().style, glow: 0 } }));
    expect(Object.keys(plan.doc.children ?? {})).toEqual(["page_1", "page_2", "page_3"]);
    expect(plan.doc.sources.filter((s) => s.type === "mosaic").some((s) => s.effects?.blur)).toBe(false);
  });

  it("a long page is a CHAIN: each chunk holds the next chunk under its own words, so no container covers an earlier chunk", () => {
    for (const glow of [0, 0.5]) {
      const plan = buildLyricStack(args({ pages: pages(1, 45), style: { ...args().style, glow } }));
      const kids = placed(plan.doc).filter((k) => k.key.startsWith("page_"));
      expect(kids.map((k) => [k.key, k.parent])).toEqual([
        ["page_1_1", "root"],
        ["page_1_2", "page_1_1"],
        ["page_1_3", "page_1_2"],
      ]);
      // alpha + next ref + 18 words, twice, then alpha + 9 words: every node at the budget or under.
      expect(kids.map((k) => k.doc.sources.filter((x) => x.type === "lavfi").length)).toEqual([
        WORDS_PER_LINKED_NODE,
        WORDS_PER_LINKED_NODE,
        45 - 2 * WORDS_PER_LINKED_NODE,
      ]);
      expect(kids.map((k) => k.doc.sources.length)).toEqual([NODE_TILE_BUDGET, NODE_TILE_BUDGET, 45 - 2 * WORDS_PER_LINKED_NODE + 1]);
      for (const k of kids) {
        expect(k.sized).toBe(true);
        // In paint order: the alpha tile, the ref to the next chunk, then this chunk's words (on top of the next chunk's container).
        const types = k.doc.sources.map((x) => x.type);
        if (types.includes("mosaic")) expect(types.lastIndexOf("mosaic")).toBeLessThan(types.indexOf("lavfi"));
      }
      // One container per page at the root (glow + ink), with the page's window; inner refs span the words they hold.
      const rootRefs = plan.doc.sources.filter((x) => x.type === "mosaic");
      expect(rootRefs).toHaveLength(glow > 0 ? 2 : 1);
      expect(rootRefs.map((r) => r.overlay?.window)).toEqual(rootRefs.map(() => ({ startSec: 0, endSec: 0.999 })));
      const inner = kids[0].doc.sources.find((x) => x.type === "mosaic");
      expect(inner?.overlay?.window).toEqual({ startSec: 0.18, endSec: 0.999 });
      if (glow > 0) {
        const glowKids = placed(plan.doc).filter((k) => k.key.startsWith("glow_"));
        expect(glowKids.map((k) => k.key)).toEqual(["glow_1_1", "glow_1_2", "glow_1_3"]);
        // Blurred once, at the top of the chain (the page glows as one).
        const glowRef = rootRefs.find((r) => r.type === "mosaic" && r.ref === "glow_1_1");
        expect(glowRef?.effects?.blur).toBe(6);
        expect(glowKids.every((k) => k.doc.sources.every((x) => x.type !== "mosaic" || !x.effects?.blur))).toBe(true);
      }
    }
  });

  it("groups pages into sheets, level by level, and keeps every node inside the tile budget", () => {
    for (const [n, glow] of [
      [9, 0.5],
      [40, 0.5],
      [300, 0.5],
      [300, 0],
    ] as const) {
      const plan = buildLyricStack(args({ pages: pages(n, 3), style: { ...args().style, glow } }));
      expect(plan.items).toBe(n);
      expect(overlayTiles(plan.doc, true, 3)).toBeLessThanOrEqual(NODE_TILE_BUDGET - ROOT_RESERVED);
      for (const { key, doc } of childNodes(plan.doc)) {
        expect(overlayTiles(doc, false)).toBeLessThanOrEqual(NODE_TILE_BUDGET);
        expect(plan.nodeTiles[key]).toBe(doc.sources.length);
        // Inputs: every tile, plus one mask PNG per word tile.
        const masks = doc.sources.filter((s) => "mask" in s && s.mask).length;
        expect(doc.sources.length + masks).toBeLessThanOrEqual(2 * NODE_TILE_BUDGET);
        if (isPageItem(key)) {
          // A page item: the corner alpha tile first, then its words.
          expect(doc.sources[0].type).toBe("media");
        } else {
          // A sheet: full-canvas refs only, one clean band, which always gets the alpha carrier (no PNG).
          expect(doc.sources.every((s) => s.type === "mosaic")).toBe(true);
          expect(doc.assets).toEqual({});
          expect(String(doc.m0)).toBe(`1${nest(doc.sources.length - 1)}`);
        }
      }
      if (n > 8) expect(plan.sheets).toBeGreaterThan(0);
      else expect(plan.sheets).toBe(0);
      // Every ref resolves in its OWN node's children map; every child is referenced exactly once.
      const all = [plan.doc, ...childNodes(plan.doc).map((c) => c.doc)];
      for (const d of all) {
        const local = d.sources.filter((s) => s.type === "mosaic").map((s) => (s as { ref: string }).ref);
        expect(local.sort()).toEqual(Object.keys(d.children ?? {}).sort());
      }
      const keys = childNodes(plan.doc).map((c) => c.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it("a first-level sheet holds at most PAGES_PER_SHEET pages (glow twins included: a sheet has no PNG tile)", () => {
    for (const [glow, perSheet] of [
      [0, PAGES_PER_SHEET],
      [0.5, Math.min(PAGES_PER_SHEET, Math.floor(NODE_TILE_BUDGET / 2))],
    ] as const) {
      const plan = buildLyricStack(args({ pages: pages(40, 2), style: { ...args().style, glow } }));
      const firstLevel = childNodes(plan.doc).filter((c) => c.key.startsWith("sheet_1_"));
      const pageCounts = firstLevel.map((c) => c.doc.sources.filter((s) => s.type === "mosaic" && s.ref.startsWith("page_")).length);
      expect(Math.max(...pageCounts)).toBe(perSheet);
      expect(pageCounts.reduce((a, b) => a + b, 0)).toBe(40);
    }
  });

  it("a sheet's window spans its pages", () => {
    const plan = buildLyricStack(args({ pages: pages(20, 2) }));
    const root = plan.doc.sources.filter((s) => s.type === "mosaic");
    expect(root.every((s) => (s as { ref: string }).ref.startsWith("sheet_1_"))).toBe(true);
    // PAGES_PER_SHEET glowing pages (20 refs: a sheet carries no PNG tile), one second each.
    expect(root[0].overlay?.window).toEqual({ startSec: 0, endSec: PAGES_PER_SHEET - 0.001 });
  });

  it("binds every take (placeholder or clip) to its media, trim and framing; takes are muted", () => {
    const base = args();
    const plan = buildLyricStack(
      args({
        slots: [
          { ...base.slots[0], clip: { path: "/media/a.mp4", mediaType: "video" }, trimStartMs: 1500, framing: 0.2 },
          base.slots[1],
          { ...base.slots[2], clip: { path: "/media/b.jpg", mediaType: "image" }, trimStartMs: 900 },
        ],
      }),
    );
    const [a, b, c] = plan.doc.sources;
    for (const [s, n] of [[a, 1], [b, 2], [c, 3]] as const) {
      expect(s.editor?.bindings).toEqual([
        { propKey: `take${n}` },
        { propKey: `take${n}TrimSec` },
        { propKey: `take${n}Framing` },
      ]);
    }
    expect(a.type === "media" && a.playback?.clipStartMs).toBe(1500);
    expect(a.type === "media" && a.audio?.enabled).toBe(false);
    expect(a.type === "media" && a.placement).toMatchObject({ fit: "cover", focusX: 0.2, focusY: 0.2 });
    expect(b.type).toBe("text");
    expect(c.type === "media" && c.playback).toBeUndefined(); // a photo has no trim
  });

  it("asset keys never collide: a take and the song sharing a name, two takes named alike in different folders", () => {
    const base = args();
    const plan = buildLyricStack(
      args({
        slots: [
          { ...base.slots[0], clip: { path: "/x/Movies/Song Title.mov", mediaType: "video" } },
          { ...base.slots[1], clip: { path: "/a/IMG_0001.MOV", mediaType: "video" } },
          { ...base.slots[2], clip: { path: "/b/IMG_0001.MOV", mediaType: "video" } },
        ],
        song: { path: "/x/Music/Song Title.wav", mediaType: "audio", clipStartMs: 0 },
      }),
    );
    const assets = plan.doc.assets as unknown as Record<string, { path: string; mediaType: string }>;
    const fileOf = (label: string) => {
      const s = plan.doc.sources.find((x) => x.editor?.label === label);
      return s?.type === "media" ? assets[String(s.assetId)] : undefined;
    };
    expect(fileOf("take-1")).toEqual({ kind: "file", path: "/x/Movies/Song Title.mov", mediaType: "video" });
    expect(fileOf("take-2")?.path).toBe("/a/IMG_0001.MOV");
    expect(fileOf("take-3")?.path).toBe("/b/IMG_0001.MOV");
    expect(fileOf("song")).toEqual({ kind: "file", path: "/x/Music/Song Title.wav", mediaType: "audio" });
    expect(Object.keys(assets)).toHaveLength(4);
    // The same file shown twice shares one entry.
    const twice = buildLyricStack(
      args({
        slots: [
          { ...base.slots[0], clip: { path: "/a/take.mp4", mediaType: "video" } },
          { ...base.slots[1], clip: { path: "/a/take.mp4", mediaType: "video" } },
          base.slots[2],
        ],
      }),
    );
    const [t1, t2] = twice.doc.sources;
    expect(t1.type === "media" && t2.type === "media" && t1.assetId === t2.assetId).toBe(true);
    expect(Object.keys(twice.doc.assets)).toHaveLength(1);
  });

  it("the song is an unbound audio-only leaf at the top, started at songStart", () => {
    const plan = buildLyricStack(args({ song: { path: "/media/song.wav", mediaType: "audio", clipStartMs: 30_000 } }));
    const song = plan.doc.sources[plan.doc.sources.length - 1];
    expect(song).toMatchObject({ type: "media", mediaType: "audio", playback: { clipStartMs: 30_000 }, audio: { enabled: true } });
    expect(song.editor?.binding ?? song.editor?.bindings).toBeUndefined();
    expect(painted(plan.doc, plan.doc.sources.length - 1)).toEqual({ x: 0, y: 0, w: W, h: H });
    feasible(String(plan.doc.m0));
  });

  it("design guide: one crop tile per chrome region and the advisory strip, all UNDER the lyrics; the song on top", () => {
    const reels = resolveShortPlatform("instagram-reel");
    const stage = platformStage(reels, W, H);
    const tiles = guideTiles(reels, W, H);
    const song = { path: "/media/song.wav", mediaType: "audio" as const, clipStartMs: 0 };
    const plan = buildLyricStack(
      args({ guide: { png: { path: "/repo/assets/reels-ui.png", tiles }, lines: ["Reels stop at 3:00 - this clip is 3:24."], stage }, song }),
    );
    const labels = plan.doc.sources.map((s) => String(s.editor?.label));
    const at = (pred: (l: string) => boolean) => labels.map((l, i) => (pred(l) ? i : -1)).filter((i) => i >= 0);
    const refs = at((l) => l.startsWith("page_") || l.startsWith("glow_"));
    const guide = at((l) => l.startsWith("platform-guide:"));
    const plate = at((l) => l === "design-advisory:plate");
    const text = at((l) => l === "design-advisory");
    // Paint order: takes < guide tiles and plate < advisory text < lyric refs < song. A word dragged onto the
    // chrome stays on top of it (hoverable, draggable): the chrome informs, it never takes a word's pointer.
    expect(guide).toHaveLength(tiles.length);
    expect(Math.min(...guide, ...plate)).toBeGreaterThanOrEqual(3);
    expect(Math.max(...guide, ...plate)).toBeLessThan(text[0]);
    expect(text[0]).toBeLessThan(Math.min(...refs));
    expect(labels[labels.length - 1]).toBe("song");
    // Each guide tile crops its region of the one PNG and paints exactly its rect (never the whole canvas).
    const assets = plan.doc.assets as unknown as Record<string, { path: string }>;
    for (const i of guide) {
      const s = plan.doc.sources[i];
      const t = tiles.find((x) => `platform-guide:${x.name}` === labels[i]);
      expect(s.type === "media" && assets[String(s.assetId)].path).toBe("/repo/assets/reels-ui.png");
      expect(s.type === "media" && s.placement).toMatchObject({ fit: "cover", sourceRect: t?.sourceRect });
      expect(painted(plan.doc, i)).toEqual(t?.rect);
      expect(s.editor?.binding ?? s.editor?.bindings).toBeUndefined();
    }
    // The advisory: its own strip at the top of the safe area, plate and svg text on the same rect.
    const strip = painted(plan.doc, text[0]);
    expect(painted(plan.doc, plate[0])).toEqual(strip);
    expect(strip.y).toBeGreaterThan(stage.safe.y);
    expect(strip.y).toBeLessThan(stage.safe.y + 60);
    expect(strip.x).toBeGreaterThan(stage.safe.x);
    expect(strip.x + strip.w).toBeLessThan(stage.safe.x + stage.safe.w);
    expect(strip.w * strip.h).toBeLessThan(0.05 * W * H);
    const advisory = plan.doc.sources[text[0]];
    expect(advisory.type === "text" && advisory.rasterizer).toBe("svg");
    expect(JSON.stringify(advisory)).toContain("Reels stop at 3:00 - this clip is 3:24.");
    expect(plan.doc.sources.find((s) => s.editor?.label === "song")?.type).toBe("media");
    expect(guidePng(reels).endsWith("reels-ui.png")).toBe(true);
    feasible(String(plan.doc.m0));
    // The lyrics are the render document's, where the render document has them: the chrome only slides in under them.
    const render = buildLyricStack(args({ song }));
    const lyricPart = (d: MosaicDocument) => JSON.stringify(d.sources.filter((s) => s.type === "mosaic" || s.editor?.label === "song"));
    expect(lyricPart(plan.doc)).toBe(lyricPart(render.doc));
    expect(placed(plan.doc).map((c) => [c.key, c.box])).toEqual(placed(render.doc).map((c) => [c.key, c.box]));
  });

  it("the advisory steps off the words: to the bottom of the safe area when the top strip would cover one", () => {
    const reels = resolveShortPlatform("instagram-reel");
    const stage = platformStage(reels, W, H);
    const high: StackPage[] = [{ words: [{ ...word(0, 0, 1000), rect: { x: 200, y: 260, w: 300, h: 120 } }], glowSigma: 6 }];
    const plan = buildLyricStack(args({ pages: high, guide: { lines: ["Reels stop at 3:00 - this clip is 3:24."], stage } }));
    const i = plan.doc.sources.findIndex((s) => s.editor?.label === "design-advisory");
    const strip = painted(plan.doc, i);
    expect(strip.y + strip.h).toBeLessThanOrEqual(stage.safe.y + stage.safe.h);
    expect(strip.y).toBeGreaterThan(H / 2);
    // Down there the rail shares its rows: the strip stays left of it.
    expect(strip.x + strip.w).toBeLessThanOrEqual((stage.rail?.x ?? W) - 1);
    // No guide PNG when the guide is off; nothing design-only without a guide at all.
    expect(plan.doc.sources.some((s) => String(s.editor?.label).startsWith("platform-guide"))).toBe(false);
    const bare = buildLyricStack(args({ pages: high }));
    expect(bare.doc.sources.some((s) => String(s.editor?.label).startsWith("design-advisory"))).toBe(false);
  });

  it("packs units without splitting one, and chunks words", () => {
    const u = (n: number) => ({ refs: new Array(n).fill(0) });
    expect(packUnits([u(2), u(2), u(2)], 5).map((g) => g.length)).toEqual([2, 1]);
    expect(packUnits([], 5)).toEqual([]);
    expect(packUnits([u(1), u(1), u(1), u(1), u(1)], 5, 2).map((g) => g.length)).toEqual([2, 2, 1]);
    const sizes = (n: number) => chunkWords(Array.from({ length: n }, (_, i) => i)).map((c) => c.length);
    expect(sizes(WORDS_PER_NODE)).toEqual([19]);
    expect(sizes(20)).toEqual([18, 2]);
    expect(sizes(37)).toEqual([18, 19]);
    expect(sizes(40)).toEqual([18, 18, 4]);
  });

  it("snaps a box out to the lattice unit, 5-smooth and even, inside the canvas", () => {
    expect([latticeUnit(1080), latticeUnit(1920), latticeUnit(540), latticeUnit(960), latticeUnit(720)]).toEqual([10, 8, 6, 4, 6]);
    for (const [cw, ch] of [
      [1080, 1920],
      [540, 960],
      [720, 1280],
      [1080, 1350],
    ]) {
      for (const r of [
        { x: Math.round(cw * 0.107), y: Math.round(ch * 0.371), w: Math.round(cw * 0.676), h: Math.round(ch * 0.257) },
        { x: 0, y: 0, w: 3, h: 3 },
        { x: cw - 40, y: ch - 30, w: 40, h: 30 },
        { x: 1, y: 1, w: cw - 2, h: ch - 2 },
      ]) {
        const b = snapBox(r, cw, ch);
        const ok = inside(r, b) && inside(b, { x: 0, y: 0, w: cw, h: ch });
        expect({ cw, ch, r, ok, even: [b.x % 2, b.y % 2, b.w % 2, b.h % 2], smooth: isSmooth(b.w) && isSmooth(b.h) }).toEqual({
          cw,
          ch,
          r,
          ok: true,
          even: [0, 0, 0, 0],
          smooth: true,
        });
      }
    }
  });

  it("stacks one overlay nest on another, and finds a free corner for the alpha tile", () => {
    expect(stackOverlays("1{1{1}}", "2(1,0){1}")).toBe("1{1{1{2(1,0){1}}}}");
    expect(stackOverlays("3[1,0,1]", "1")).toBe("3[1,0,1]{1}");
    expect(alphaTileRect(200, 100)).toEqual({ x: 0, y: 100 - ALPHA_TILE_PX, w: ALPHA_TILE_PX, h: ALPHA_TILE_PX });
    // Bottom-left taken: top-left; three corners taken: the last one.
    expect(alphaTileRect(200, 100, [{ x: 0, y: 50, w: 50, h: 50 }])).toEqual({ x: 0, y: 0, w: 16, h: 16 });
    expect(
      alphaTileRect(200, 100, [
        { x: 0, y: 0, w: 50, h: 100 },
        { x: 150, y: 50, w: 50, h: 50 },
      ]),
    ).toEqual({ x: 184, y: 0, w: 16, h: 16 });
    expect(alphaTileRect(10, 8)).toEqual({ x: 0, y: 0, w: 10, h: 8 });
  });
});
