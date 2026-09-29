import fs from "node:fs";

import type {
  MosaicDocument,
  MosaicEngineContext,
  MosaicSource,
  MosaicTemplatePropDefinition,
  MosaicTimedCue,
} from "@m0saic/types";
import { asAssetId } from "@m0saic/types";
import { parseM0StringToRenderFrames, validateM0String } from "@m0saic/dsl";
import { evaluateM0 } from "@m0saic/dsl-stdlib";
import {
  auditRenderedTemplate,
  getOpentype,
  layoutFingerprintOf,
  registerFontBytes,
  resolvePropBindings,
} from "@m0saic/template-utils";

import { asDocument, asPipeline, targetCtx } from "../../../__testutils__/render";
import { unboundOf } from "../../../_shared/bindings";
import { guidePng, guideTiles } from "../../../_shared/platform-emit";
import type { Rect } from "../../../_shared/platforms";
import { SHORT_PLATFORM_IDS, platformStage, resolveShortPlatform } from "../../../_shared/platforms";
import { ALPHA_TILE_PX, NODE_TILE_BUDGET, ROOT_RESERVED, WORD_BOXES_PROP } from "./document";
import type { LyricStackProps } from "./lyric-stack";
import { CLEAR_PNG, LYRIC_STACK_DEFAULT_LYRICS, LyricStackV1, resolveLyricStackHints } from "./lyric-stack";

const W = 1080;
const H = 1920;
const SONG = "/media/song.wav";
const TAKE1 = "/media/take1.mp4";
const TAKE2 = "/media/take2.mp4";
const TAKE3 = "/media/take3.mov";
const TAKE4 = "/media/take4.mp4";
const PHOTO = "/media/photo.jpg";

const media = {
  [asAssetId(SONG)]: { durationMs: 40_000, hasAudio: true, hasVideo: false },
  [asAssetId(TAKE1)]: { durationMs: 20_000, width: 1080, height: 1920, hasAudio: true, hasVideo: true },
  [asAssetId(TAKE2)]: { durationMs: 25_000, width: 1920, height: 1080, hasAudio: true, hasVideo: true },
  [asAssetId(TAKE3)]: { durationMs: 12_000, width: 1080, height: 1920, hasAudio: true, hasVideo: true },
  [asAssetId(TAKE4)]: { durationMs: 9_000, width: 1080, height: 1920, hasAudio: true, hasVideo: true },
} as unknown as MosaicEngineContext["media"];

/** Generic timed lyrics against a 40 s song (global word indexes 0..16). */
const TIMED: MosaicTimedCue[] = [
  { text: "first page of words", startMs: 2000 },
  { text: "second page right here", startMs: 6000 },
  { text: "[break]", startMs: 10_000 },
  { text: "third page after the break", startMs: 14_000 },
  { text: "fourth and final page", startMs: 20_000, endMs: 26_000 },
];

const ctxFor = (mode: "render" | "design", durationMs = 15_000) =>
  ({ ...targetCtx(W, H, { media, durationMs }), mode }) as MosaicEngineContext;

const renderAny = (props: LyricStackProps = {}, mode: "render" | "design" = "render") =>
  LyricStackV1.render({ ...LyricStackV1.defaultProps, ...props }, ctxFor(mode));
const render = (props: LyricStackProps = {}) => renderAny(props, "render").then(asDocument);
const design = (props: LyricStackProps = {}) => renderAny(props, "design").then(asDocument);

type Node = { key: string; doc: MosaicDocument };
/** Every node of the tree, root first (children nest where they are referenced). */
const nodes = (doc: MosaicDocument, key = "root"): Node[] => [
  { key, doc },
  ...Object.entries(doc.children ?? {}).flatMap(([k, d]) => nodes(d as MosaicDocument, k)),
];
const inkChildren = (doc: MosaicDocument) => nodes(doc).filter((n) => n.key.startsWith("page_"));
const wordTiles = (doc: MosaicDocument) =>
  inkChildren(doc).flatMap((n) => n.doc.sources.filter((s): s is Extract<MosaicSource, { type: "lavfi" }> => s.type === "lavfi"));
/** A word tile's global index, from its label `word-N`. */
const indexOf = (s: MosaicSource) => Number(String(s.editor?.label).replace("word-", "")) - 1;
/** A word tile's Word positions slot: its `wordBoxes` binding index. */
const slotOf = (s: MosaicSource) => Number((s.editor?.bindings?.[0] ?? s.editor?.binding)?.index);
/**
 * The ROOT-px rect a word tile PAINTS: its frame minus the recovery inset,
 * composed through the containers above it. Make seeds a drag with it (the
 * tile's world frame) and writes it back for every sibling
 * (apps/mosaic effectiveInsetRect).
 */
const paintedRect = (doc: MosaicDocument, t: MosaicSource) => {
  const leaf = leavesOf(doc, W, H).find((l) => l.source === t);
  if (!leaf) throw new Error(`no leaf for ${String(t.editor?.label)}`);
  return leaf.rect;
};
/** The design advisory's words, its wrapped lines joined back with spaces ("" when there is none). */
const advisoryText = (doc: MosaicDocument): string => {
  const a = doc.sources.find((s) => s.editor?.label === "design-advisory");
  return a?.type === "text" && a.layers[0].content.kind === "literal" ? a.layers[0].content.text.replace(/\n/g, " ") : "";
};

type Leaf = { node: string; label: string; source: MosaicSource; rect: Rect };
/**
 * Every LEAF tile of a document with the rect it paints on the root canvas:
 * its frame minus its recovery inset, composed through the refs above it (a
 * declared-size child is contained in its ref's box, as the engine and Make
 * place it). What Make hit-tests.
 */
function leavesOf(doc: MosaicDocument, cw: number, ch: number): Leaf[] {
  const out: Leaf[] = [];
  const walk = (d: MosaicDocument, ox: number, oy: number, k: number, node: string) => {
    const w = d.size?.width ?? cw;
    const h = d.size?.height ?? ch;
    const frames = parseM0StringToRenderFrames(String(d.m0), w, h);
    d.sources.forEach((src, i) => {
      const f = frames[i];
      const inset = ((src as { placement?: { inset?: Record<string, number> } }).placement?.inset ?? {}) as Record<string, number>;
      const l = Math.floor((inset.left ?? 0) * f.width);
      const r = Math.floor((inset.right ?? 0) * f.width);
      const t = Math.floor((inset.top ?? 0) * f.height);
      const b = Math.floor((inset.bottom ?? 0) * f.height);
      const box = { x: f.x + l, y: f.y + t, w: f.width - l - r, h: f.height - t - b };
      const world = { x: ox + box.x * k, y: oy + box.y * k, w: box.w * k, h: box.h * k };
      if (src.type === "mosaic") {
        const child = (d.children as Record<string, MosaicDocument>)[src.ref];
        const kw = child.size?.width ?? box.w;
        const kh = child.size?.height ?? box.h;
        const s = Math.min(box.w / kw, box.h / kh);
        walk(child, world.x + ((box.w - kw * s) / 2) * k, world.y + ((box.h - kh * s) / 2) * k, s * k, `${node}/${src.ref}`);
        return;
      }
      out.push({ node, label: String(src.editor?.label), source: src, rect: world });
    });
  };
  walk(doc, 0, 0, 1, "root");
  return out;
}
/** A source's structured overlay window, if it has one. */
const windowOf = (s: MosaicSource) => (s as { overlay?: { window?: { startSec?: number; endSec?: number } } }).overlay?.window;
/** One wrap of Make's preview: what it is, the rect it takes the pointer on, and where it sits in tree order. */
type StageEl = {
  id: string;
  label: string;
  source: MosaicSource;
  cell: Rect;
  /** The inset box it paints (a pointer in the cell's margin goes to what is under it), or null. */
  eff: Rect | null;
  container: boolean;
  audioOnly: boolean;
  order: number;
};
/**
 * The wraps Make's preview lays out for a document at time `t` (null = all,
 * ungated), in tree order: a child's wraps inside (after) its ref's wrap, a
 * ref's window hiding its whole subtree.
 */
function stageOf(doc: MosaicDocument, cw: number, ch: number, t: number | null): StageEl[] {
  const out: StageEl[] = [];
  const onAt = (s: MosaicSource) => {
    const win = windowOf(s);
    return t === null || !win || ((win.startSec === undefined || t >= win.startSec) && (win.endSec === undefined || t <= win.endSec));
  };
  const walk = (d: MosaicDocument, ox: number, oy: number, k: number, prefix: string) => {
    const w = d.size?.width ?? cw;
    const h = d.size?.height ?? ch;
    const frames = parseM0StringToRenderFrames(String(d.m0), w, h);
    d.sources.forEach((src, i) => {
      if (!onAt(src)) return;
      const f = frames[i];
      const inset = ((src as { placement?: { inset?: Record<string, number> } }).placement?.inset ?? null) as Record<string, number> | null;
      const l = Math.floor((inset?.left ?? 0) * f.width);
      const r = Math.floor((inset?.right ?? 0) * f.width);
      const tp = Math.floor((inset?.top ?? 0) * f.height);
      const b = Math.floor((inset?.bottom ?? 0) * f.height);
      const world = (x: number, y: number, ww: number, hh: number) => ({ x: ox + x * k, y: oy + y * k, w: ww * k, h: hh * k });
      const cell = world(f.x, f.y, f.width, f.height);
      const eff = l || r || tp || b ? world(f.x + l, f.y + tp, f.width - l - r, f.height - tp - b) : null;
      const id = `${prefix}/${i}`;
      out.push({
        id,
        label: String(src.editor?.label ?? src.type),
        source: src,
        cell,
        eff,
        container: src.type === "mosaic",
        audioOnly: src.type === "media" && src.mediaType === "audio",
        order: out.length,
      });
      if (src.type === "mosaic") {
        const child = (d.children as Record<string, MosaicDocument>)[src.ref];
        const box = eff ?? cell;
        const kw = child.size?.width ?? box.w / k;
        const kh = child.size?.height ?? box.h / k;
        const s = Math.min(box.w / kw, box.h / kh);
        walk(child, box.x + (box.w - kw * s) / 2, box.y + (box.h - kh * s) / 2, s, `${id}#${src.ref}`);
      }
    });
  };
  walk(doc, 0, 0, 1, "");
  return out;
}
const within = (p: { x: number; y: number }, r: Rect) => p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h;
/** The wrap a hover at `p` lands on: the topmost pointer target there, past an inset tile's margin. */
function hoverAt(els: StageEl[], p: { x: number; y: number }): StageEl | null {
  const stack = els.filter((e) => !e.audioOnly && within(p, e.cell)).sort((a, b) => b.order - a.order);
  const top = stack[0];
  if (!top) return null;
  if (top.eff && !within(p, top.eff)) return stack.find((e) => e !== top && (!e.eff || within(p, e.eff))) ?? null;
  return top;
}
const overlapArea = (a: Rect, b: Rect) =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
const isBound = (s: MosaicSource) => Boolean(s.editor?.binding ?? s.editor?.bindings);
const isChrome = (label: string) =>
  label.startsWith("platform-guide") || label.startsWith("design-advisory") || label.endsWith(":alpha-base");
/** Max `{` nesting of an m0: the overlay layers on the node's chain. */
const overlayLayers = (m0: string) => {
  let depth = 0;
  let max = 0;
  for (const c of m0) {
    if (c === "{") max = Math.max(max, ++depth);
    else if (c === "}") depth--;
  }
  return max;
};

const maskWidth = (t: MosaicSource | undefined) =>
  t?.type === "lavfi" && t.mask?.kind === "inline-mask" ? t.mask.bounds.width : Number.NaN;
const enableNums = (enable: string | undefined) => (enable?.match(/-?\d+\.\d+/g) ?? []).map(Number);

// ── the 0.3.0 roll call, mirrored (0.2.0 does not export accountableProps) ───
// Mirror of packages/template-utils/src/template/auditRenderedTemplate.ts
// `accountableProps` (m0saic monorepo, ~lines 541-612).
type AnyRecord = Record<string, unknown>;
const closedOrPicked = (def: MosaicTemplatePropDefinition): boolean => {
  const c = def.meta?.constraints as AnyRecord | undefined;
  const k = def.meta?.control as AnyRecord | undefined;
  return Boolean(
    (Array.isArray(c?.oneOf) && (c?.oneOf as unknown[]).length > 0) ||
      c?.isColor ||
      (Array.isArray(k?.options) && (k?.options as unknown[]).length > 0) ||
      k?.optionsFrom ||
      k?.optionsFromConnection ||
      k?.colorPicker ||
      k?.picker,
  );
};
function accountableProps(schema: Record<string, MosaicTemplatePropDefinition>): Array<{ key: string; kind: string }> {
  const out: Array<{ key: string; kind: string }> = [];
  const walk = (level: Record<string, MosaicTemplatePropDefinition>, prefix: string) => {
    for (const [name, def] of Object.entries(level)) {
      const key = prefix ? `${prefix}.${name}` : name;
      if (def.meta?.ui?.hidden || def.meta?.ui?.consumer === "human") continue;
      const colour = Boolean(def.meta?.constraints?.isColor || (def.meta?.control as AnyRecord | undefined)?.colorPicker);
      // 0.2.0's prop type has no "array" yet; compare as a plain string.
      switch (def.type as string) {
        case "string":
          if (colour) out.push({ key, kind: "color" });
          else if (!closedOrPicked(def)) out.push({ key, kind: "string" });
          break;
        case "number":
          if (!closedOrPicked(def)) out.push({ key, kind: "number" });
          break;
        case "media":
          out.push({ key, kind: "media" });
          break;
        case "string[]":
        case "number[]":
        case "media[]":
          out.push({ key, kind: "element" });
          break;
        case "json":
        case "list":
        case "array":
          out.push({ key, kind: (def.meta?.control as AnyRecord | undefined)?.picker === "regions" ? "rect" : "leaf" });
          break;
        case "group":
          walk((def as unknown as { fields: Record<string, MosaicTemplatePropDefinition> }).fields ?? {}, key);
          break;
        default:
          break;
      }
    }
  };
  walk(schema, "");
  return out;
}
const backgroundsOf = (doc: MosaicDocument): Set<string> =>
  new Set(nodes(doc).map((n) => String(n.doc.backgroundColor ?? "").toLowerCase()).filter(Boolean));

/** A synthetic ASCII-only font registered under a path-like key (no curly quotes). */
function asciiFont(key: string): string {
  const ot = getOpentype();
  const box = () => {
    const p = new ot.Path();
    p.moveTo(40, 0);
    p.lineTo(460, 0);
    p.lineTo(460, 500);
    p.lineTo(40, 500);
    p.close();
    return p;
  };
  const glyphs = [new ot.Glyph({ name: ".notdef", advanceWidth: 600, path: box() })];
  glyphs.push(new ot.Glyph({ name: "space", unicode: 32, advanceWidth: 250, path: new ot.Path() }));
  Array.from("abcdefghijklmnopqrstuvwxyz'\".-").forEach((ch, i) =>
    glyphs.push(new ot.Glyph({ name: `g${i}`, unicode: ch.codePointAt(0), advanceWidth: 500, path: box() })),
  );
  const font = new ot.Font({ familyName: key, styleName: "Regular", unitsPerEm: 1000, ascender: 800, descender: -200, glyphs });
  registerFontBytes(key, font.toArrayBuffer());
  return key;
}

describe("@rainier/reels/lyric-stack/v1", () => {
  it("emits a valid, feasible m0 on every node, one source per frame", async () => {
    const doc = await design();
    for (const { key, doc: d } of nodes(doc)) {
      const m0 = String(d.m0);
      expect({ key, ok: validateM0String(m0).ok }).toEqual({ key, ok: true });
      expect(parseM0StringToRenderFrames(m0, W, H)).toHaveLength(d.sources.length);
      const ev = evaluateM0(m0, { width: W, height: H });
      expect({ key, ok: ev.feasible && ev.meetsPrecision }).toEqual({ key, ok: true });
    }
  });

  it("defaults: three bound placeholder takes, five pages of words, Anton, centred, cumulative, glow on", async () => {
    const doc = await render();
    const takes = doc.sources.slice(0, 3);
    expect(takes.map((s) => s.type)).toEqual(["text", "text", "text"]);
    expect(takes.map((s) => (s.type === "text" ? s.layers[0].content : null))).toEqual(
      [1, 2, 3].map((n) => ({ kind: "literal", text: `Take ${n} - drop a clip here` })),
    );
    expect(inkChildren(doc)).toHaveLength(LYRIC_STACK_DEFAULT_LYRICS.length);
    expect(Object.keys(doc.children ?? {}).filter((k) => k.startsWith("glow_"))).toHaveLength(LYRIC_STACK_DEFAULT_LYRICS.length);
    expect(doc.size).toEqual({ width: W, height: H });
    expect(doc.backgroundColor).toBe("#0A0A0A");
    expect(doc.format).toEqual({ kind: "video", container: "mp4" });
    expect(doc.audio).toEqual({ mode: "auto", codec: "aac", bitrate: "320k", sampleRate: 48000, channelLayout: "stereo" });
  });

  it("bindings at defaults resolve with nothing rejected: takes 1-3, every word's box, the text colour", async () => {
    const doc = await render();
    const r = resolvePropBindings(doc, W, H, { propsSchema: LyricStackV1.propsSchema });
    expect(r.rejected).toEqual([]);
    for (const k of ["take1", "take2", "take3", "take1TrimSec", "take2TrimSec", "take3TrimSec", "take1Framing", "take3Framing"]) {
      expect(r.byProp[k]).toHaveLength(1);
    }
    const words = LYRIC_STACK_DEFAULT_LYRICS.flatMap((c) => c.text.split(/\s+/));
    const boxes = r.byProp[WORD_BOXES_PROP];
    expect(boxes.map((b) => b.index).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual(words.map((_, i) => i));
    expect(boxes.every((b) => b.kind === "rect" && b.childPath.length === 1)).toBe(true);
    expect(r.byProp.textColor).toHaveLength(LYRIC_STACK_DEFAULT_LYRICS.length);
    expect(r.byProp.song).toBeUndefined();
  });

  it("roll call: every prop that can carry a handle is bound somewhere or declared, and no declaration is stale", async () => {
    const doc = await render();
    const r = resolvePropBindings(doc, W, H, { propsSchema: LyricStackV1.propsSchema });
    const bound = new Set(Object.keys(r.byProp));
    const declared = unboundOf(LyricStackV1);
    const backgrounds = backgroundsOf(doc);
    const defaults = LyricStackV1.defaultProps as Record<string, unknown>;
    const accountable = accountableProps(LyricStackV1.propsSchema);
    const orphans = accountable.filter(({ key, kind }) => {
      if (bound.has(key) || Object.prototype.hasOwnProperty.call(declared, key)) return false;
      const v = defaults[key];
      return !(kind === "color" && typeof v === "string" && backgrounds.has(v.toLowerCase()));
    });
    expect(orphans).toEqual([]);
    const keys = new Set(accountable.map((a) => a.key));
    for (const [key, reason] of Object.entries(declared)) {
      expect({ key, accountable: keys.has(key), bound: bound.has(key), reason: reason.trim().length > 0 }).toEqual({
        key,
        accountable: true,
        bound: false,
        reason: true,
      });
    }
    // borderColor is the document background: accounted by construction, never declared.
    expect(declared.borderColor).toBeUndefined();
    expect(doc.backgroundColor).toBe(defaults.borderColor);
  });

  it("draws one masked tile per word across the page children; the glow children mirror them", async () => {
    const doc = await render();
    const words = LYRIC_STACK_DEFAULT_LYRICS.flatMap((c) => c.text.split(/\s+/));
    const tiles = wordTiles(doc);
    expect(tiles).toHaveLength(words.length);
    const glowTiles = nodes(doc)
      .filter((n) => n.key.startsWith("glow_"))
      .flatMap((n) => n.doc.sources.filter((s) => s.type === "lavfi"));
    expect(glowTiles).toHaveLength(words.length);
    for (const t of tiles) {
      expect(t.mask?.kind).toBe("inline-mask");
      if (t.mask?.kind !== "inline-mask") continue;
      expect(t.mask.localPath.length).toBeGreaterThan(0);
      expect(t.mask.bounds.x).toBe(0);
      expect(t.color).toBe("#FFFFFF");
      // Placement exprs are inlined verbatim: no commas, no colons.
      expect(t.overlay?.xExpr ?? "").not.toMatch(/[,:]/);
      expect(t.overlay?.yExpr ?? "").not.toMatch(/[,:]/);
      // enable and window describe the same span.
      const [a, b] = enableNums(t.overlay?.enable);
      expect(t.overlay?.window).toEqual({ startSec: a, endSec: b });
    }
  });

  it("every page child keeps the clear PNG as a small corner tile under its words; sheets need none; the file ships", async () => {
    const doc = await render({ lyrics: Array.from({ length: 30 }, (_, i) => ({ text: `page ${i} holds four words` })) });
    const kids = nodes(doc).filter((n) => n.key !== "root");
    expect(kids.some((k) => k.key.startsWith("sheet_"))).toBe(true);
    for (const { key, doc: d } of kids) {
      if (key.startsWith("sheet_")) {
        // One clean band of full-canvas refs: the engine gives it an alpha carrier with no image.
        expect({ key, refsOnly: d.sources.every((x) => x.type === "mosaic") }).toEqual({ key, refsOnly: true });
        continue;
      }
      const base = d.sources[0];
      expect(base.type === "media" && base.mediaType === "image").toBe(true);
      const assetId = base.type === "media" ? String(base.assetId) : "";
      expect((d.assets as unknown as Record<string, { path: string }>)[assetId].path).toBe(CLEAR_PNG);
      // The PNG only has to be present (it earns the child an alpha carrier), not to cover the frame:
      // a 16 px tile in a corner of the child, under none of its words.
      const [tile, ...rest] = leavesOf(d, Number(d.size?.width), Number(d.size?.height)).filter((l) => l.node === "root");
      expect([tile.rect.w, tile.rect.h]).toEqual([ALPHA_TILE_PX, ALPHA_TILE_PX]);
      expect(tile.rect.x === 0 || tile.rect.x + tile.rect.w === d.size?.width).toBe(true);
      expect(tile.rect.y === 0 || tile.rect.y + tile.rect.h === d.size?.height).toBe(true);
      expect({ key, under: rest.filter((l) => overlapArea(l.rect, tile.rect) > 0).map((l) => l.label) }).toEqual({ key, under: [] });
    }
    expect(fs.existsSync(CLEAR_PNG)).toBe(true);
    const png = fs.readFileSync(CLEAR_PNG);
    expect(png.subarray(1, 4).toString("ascii")).toBe("PNG");
    expect(png[25]).toBe(6); // colour type 6 = RGBA
  });

  it("keeps every node inside the overlay budget, root included, even for a long song", async () => {
    const lyrics = Array.from({ length: 80 }, (_, i) => ({
      text: `line ${i} carries a handful of words to sing along with the band tonight`,
      startMs: i * 2000,
    }));
    for (const glow of [0, 0.5]) {
      const doc = await render({ lyrics, glow, song: SONG, songStartSec: 0 });
      for (const { key, doc: d } of nodes(doc)) {
        const tiles = key === "root" ? d.sources.length - 3 : d.sources.length;
        expect({ key, ok: tiles <= NODE_TILE_BUDGET - (key === "root" ? ROOT_RESERVED - 1 : 0) }).toEqual({ key, ok: true });
      }
    }
  });

  it("design groups pages exactly as render; what it adds at the root is static, unbound chrome UNDER the lyrics", async () => {
    // The per-node engine budget is checked on the RENDER document (the one the
    // engine draws: the test above). Design must group the pages the same way
    // (so a drag means the same thing in the file) and may only add the guide
    // crops and the advisory: static, unbound, template-owned leaves between the
    // takes and the lyric refs (a word stays on top of them in Make), a few
    // overlay layers that Make draws in the browser.
    const long = "/media/long.mp4";
    const longMedia = { ...media, [asAssetId(long)]: { durationMs: 204_000, hasVideo: true, width: 1080, height: 1920 } };
    const lyrics = Array.from({ length: 80 }, (_, i) => ({ text: `untimed page ${i} spreads over the clip` }));
    const run = (mode: "render" | "design") =>
      LyricStackV1.render(
        { ...LyricStackV1.defaultProps, lyrics, takeCount: "1", take1: long },
        { ...targetCtx(W, H, { media: longMedia as MosaicEngineContext["media"] }), mode } as MosaicEngineContext,
      ).then(asDocument);
    const [d, r] = [await run("design"), await run("render")];
    const labels = d.sources.map((s) => String(s.editor?.label));
    expect(labels.some((l) => l.startsWith("platform-guide:"))).toBe(true);
    expect(labels).toContain("design-advisory");
    expect(labels.some((l) => l.startsWith("sheet_"))).toBe(true);
    // Same tree of lyrics: the same children, the same refs in the same order.
    expect(JSON.stringify(d.children)).toBe(JSON.stringify(r.children));
    const refs = (doc: MosaicDocument) => JSON.stringify(doc.sources.filter((s) => s.type === "mosaic"));
    expect(refs(d)).toBe(refs(r));
    expect(r.sources.filter((s) => s.type === "mosaic").length).toBeLessThanOrEqual(NODE_TILE_BUDGET - ROOT_RESERVED);
    // Everything design adds: chrome, after the takes and before every lyric ref, with no timing, no binding.
    const firstRef = Math.min(...d.sources.map((s, i) => (s.type === "mosaic" ? i : Infinity)));
    const extra = d.sources.filter((s) => !r.sources.some((x) => JSON.stringify(x) === JSON.stringify(s)));
    expect(extra.length).toBeGreaterThan(0);
    for (const s of extra) {
      const label = String(s.editor?.label);
      const i = d.sources.indexOf(s);
      expect({ label, chrome: isChrome(label), under: i > 0 && i < firstRef }).toEqual({ label, chrome: true, under: true });
      expect({ label, overlay: (s as { overlay?: unknown }).overlay, bound: isBound(s), owner: s.editor?.owner }).toEqual({
        label,
        overlay: undefined,
        bound: false,
        owner: "template",
      });
    }
    // A few static layers under the lyrics (the guide's lines meet its regions and spill onto a few layers;
    // the advisory's text rides one more); every child within the tile budget.
    expect(overlayLayers(String(d.m0)) - overlayLayers(String(r.m0))).toBeLessThanOrEqual(ROOT_RESERVED + 2);
    for (const { key, doc: c } of nodes(d).filter((n) => n.key !== "root")) {
      expect({ key, ok: c.sources.length <= NODE_TILE_BUDGET }).toEqual({ key, ok: true });
    }
  });

  it("design-document audit (Make's pointer): every word answers its own hover, takes stay reachable, nothing full-frame", async () => {
    // A model of Make's preview (GeometricPreview): one wrap per source in tree
    // order, a child's wraps inside its ref's wrap, time-gated by
    // `overlay.window` (a ref's gate hides its whole subtree), audio-only wraps
    // pointer-less, and a pointer in an inset tile's margin handed to what is
    // under it (insetHit.ts). A `type: "mosaic"` wrap is a pointer target like
    // any leaf: a container over a word takes its hover, click and badges.
    const long = "/media/long.mp4";
    const longMedia = { ...media, [asAssetId(long)]: { durationMs: 204_000, hasVideo: true, width: 1080, height: 1920 } };
    const at = (cw: number, ch: number, mode: "design" | "render", props: LyricStackProps, durationMs = 15_000) =>
      LyricStackV1.render(
        { ...LyricStackV1.defaultProps, ...props },
        { ...targetCtx(cw, ch, { media: longMedia as MosaicEngineContext["media"], durationMs }), mode } as MosaicEngineContext,
      ).then(asDocument);
    const stale = { canvas: { w: W, h: H }, regions: [{ x: 100, y: 300, w: 700, h: 260 }] };
    const long26 = Array.from({ length: 26 }, (_, i) => ["we", "run", "all", "night", "under", "neon", "sky"][i % 7]).join(" ");
    type Case = { name: string; cw: number; ch: number; props: LyricStackProps; pages?: number; advisory?: boolean; chromeOnWords?: boolean };
    const cases: Case[] = [
      { name: "defaults", cw: W, ch: H, props: {} },
      { name: "defaults 540x960", cw: 540, ch: 960, props: {} },
      { name: "3-page window", cw: W, ch: H, props: { lyrics: TIMED }, pages: 3 },
      // A mid-song clip of the lyric bank: pages 2 to 4 of the song.
      { name: "3-page window, song from 7 s", cw: W, ch: H, props: { lyrics: TIMED, song: SONG, songStartSec: 7 }, pages: 3 },
      ...SHORT_PLATFORM_IDS.map((platform) => ({ name: `defaults ${platform}`, cw: W, ch: H, props: { platform } })),
      {
        name: "advisories on, lyrics at the top",
        cw: W,
        ch: H,
        props: { takeCount: "1", take1: long, wordBoxes: stale, lyricsPosition: "top" as const },
        advisory: true,
      },
      {
        name: "advisories on 540x960, tiktok",
        cw: 540,
        ch: 960,
        props: { takeCount: "1", take1: long, wordBoxes: stale, platform: "tiktok" as const },
        advisory: true,
      },
      // A page longer than one node: its chunks share the screen.
      { name: "a 26-word page (a chunk chain)", cw: W, ch: H, props: { lyrics: [{ text: "neon lights tonight" }, { text: long26 }, { text: "hold on" }] } },
      { name: "a 26-word page at the bottom", cw: W, ch: H, props: { lyrics: [{ text: long26 }], lyricsPosition: "bottom" as const, textSize: 1.5 } },
      // Sheets: twelve glowing pages.
      { name: "12 pages (sheets)", cw: W, ch: H, props: { lyrics: Array.from({ length: 12 }, (_, i) => ({ text: `sheet page ${i} four` })) } },
      { name: "one word at a time", cw: W, ch: H, props: { reveal: "word" as const } },
    ];

    for (const c of cases) {
      const doc = await at(c.cw, c.ch, "design", c.props);
      const all = stageOf(doc, c.cw, c.ch, null);
      if (c.pages !== undefined) expect({ c: c.name, pages: inkChildren(doc).length }).toEqual({ c: c.name, pages: c.pages });
      expect({ c: c.name, guide: all.some((e) => e.label.startsWith("platform-guide:")) }).toEqual({ c: c.name, guide: true });
      if (c.advisory) expect({ c: c.name, advisory: advisoryText(doc).length > 0 }).toEqual({ c: c.name, advisory: true });

      // 1. Nothing full-frame: no leaf but a bound take (or the audio-only song) over a quarter of the
      //    canvas, and no container over a third (a container hugs its page's words and halo).
      const big = all.filter((e) => {
        const area = e.cell.w * e.cell.h;
        if (e.container) return area > (c.cw * c.ch) / 3;
        return area > 0.25 * c.cw * c.ch && !(isBound(e.source) && e.label.startsWith("take-")) && !e.audioOnly;
      });
      expect({ c: c.name, big: big.map((e) => e.label) }).toEqual({ c: c.name, big: [] });

      // 2. Every word the clip draws answers its own hover, at a moment it is on screen: no container
      //    (a later chunk, a sheet, a glow), no guide tile and no advisory is on top of it.
      const words = all.filter((e) => /^word-\d+$/.test(e.label) && isBound(e.source));
      expect(words.length).toBeGreaterThan(0);
      const shadowed: string[] = [];
      for (const w of words) {
        const win = windowOf(w.source) as { startSec: number; endSec: number };
        const t = (win.startSec + win.endSec) / 2;
        const onStage = stageOf(doc, c.cw, c.ch, t);
        const me = onStage.find((e) => e.id === w.id) as StageEl;
        const box = me.eff ?? me.cell;
        const hit = hoverAt(onStage, { x: box.x + box.w / 2, y: box.y + box.h / 2 });
        if (hit?.id !== me.id) shadowed.push(`${w.label} @${t}s -> ${hit?.label ?? "nothing"}`);
      }
      expect({ c: c.name, shadowed }).toEqual({ c: c.name, shadowed: [] });

      // 3. Every take stays reachable by hover and click, whatever page is up: a page's containers cover
      //    only its own words and halo (before, a full-canvas page ref took the pointer over every take).
      //    A take under the lyric box keeps its margins; one clear of it keeps most of its area.
      const takes = all.filter((e) => /^take-\d/.test(e.label) && isBound(e.source));
      const dur = Number(doc.durationMs);
      for (const t of [0.5, dur / 2000, dur / 1000 - 0.5]) {
        const onStage = stageOf(doc, c.cw, c.ch, t);
        for (const k of takes) {
          const b = k.eff ?? k.cell;
          let hits = 0;
          for (let i = 0; i < 20; i++) {
            for (let j = 0; j < 20; j++) {
              if (hoverAt(onStage, { x: b.x + (b.w * (i + 0.5)) / 20, y: b.y + (b.h * (j + 0.5)) / 20 })?.id === k.id) hits++;
            }
          }
          const share = hits / 400;
          const floor = c.name.startsWith("defaults") && k.label !== "take-2:placeholder" ? 0.5 : 0.05;
          expect({ c: c.name, take: k.label, t, reachable: share >= floor }).toEqual({ c: c.name, take: k.label, t, reachable: true });
        }
      }

      // 4. At the layout's own positions no guide or advisory tile sits on a word (it paints under the
      //    lyrics anyway), and no page's alpha tile sits on one of its own words.
      const leaves = leavesOf(doc, c.cw, c.ch);
      const wordLeaves = leaves.filter((l) => /^word-\d+$/.test(l.label));
      const onWords = leaves
        .filter((l) => isChrome(l.label))
        .flatMap((l) =>
          wordLeaves
            .filter((w) => (l.label.endsWith(":alpha-base") ? w.node.startsWith(l.node) : true))
            .filter((w) => overlapArea(l.rect, w.rect) > 0)
            .map((w) => `${l.label} on ${w.node}/${w.label}`),
        );
      expect({ c: c.name, onWords }).toEqual({ c: c.name, onWords: [] });

      // 5. The render document of the same props: no guide or advisory tile at all.
      const r = await at(c.cw, c.ch, "render", c.props);
      const chrome = leavesOf(r, c.cw, c.ch).filter((l) => l.label.startsWith("platform-guide") || l.label.startsWith("design-advisory"));
      expect({ c: c.name, chrome: chrome.map((l) => l.label) }).toEqual({ c: c.name, chrome: [] });
      expect(Object.values(r.assets).some((a) => /-ui\.png$/.test(String((a as { path?: string }).path)))).toBe(false);
    }
  });

  it("design-document audit: a word dragged onto the chrome (caption, rail, side strip) stays on top and draggable", async () => {
    const base = await design();
    const tiles = wordTiles(base).sort((a, b) => slotOf(a) - slotOf(b));
    const rects = tiles.map((t) => paintedRect(base, t));
    const reels = resolveShortPlatform("instagram-reel");
    const stage = platformStage(reels, W, H);
    const caption = stage.captionBlock as Rect;
    const rail = stage.rail as Rect;
    for (const [name, moved] of [
      ["caption", { x: caption.x + 40, y: caption.y + 40, w: 220, h: 120 }],
      ["rail", { x: rail.x - 60, y: rail.y + 200, w: 170, h: 120 }],
      ["side strip", { x: 0, y: 1100, w: 200, h: 110 }],
    ] as const) {
      const doc = await design({ wordBoxes: { canvas: { w: W, h: H }, regions: rects.map((r, i) => (i === 0 ? moved : r)) } });
      const word = stageOf(doc, W, H, null).find((e) => e.label === "word-1") as StageEl;
      const win = windowOf(word.source) as { startSec: number; endSec: number };
      const onStage = stageOf(doc, W, H, (win.startSec + win.endSec) / 2);
      const me = onStage.find((e) => e.id === word.id) as StageEl;
      const box = me.eff ?? me.cell;
      const chromeUnder = onStage.filter((e) => e.label.startsWith("platform-guide") && overlapArea(e.cell, box) > 0);
      expect({ name, chromeUnder: chromeUnder.length > 0 }).toEqual({ name, chromeUnder: true });
      expect({ name, hit: hoverAt(onStage, { x: box.x + box.w / 2, y: box.y + box.h / 2 })?.label }).toEqual({ name, hit: "word-1" });
    }
  });

  it("word tiles two levels down (inside sheets) still bind: every word's box resolves through its sheet", async () => {
    const lyrics = Array.from({ length: 12 }, (_, i) => ({ text: `sheet page ${i} four` }));
    const doc = await design({ lyrics });
    expect(doc.sources.filter((s) => s.type === "mosaic").every((s) => s.type === "mosaic" && s.ref.startsWith("sheet_"))).toBe(true);
    const r = resolvePropBindings(doc, W, H, { propsSchema: LyricStackV1.propsSchema });
    expect(r.rejected).toEqual([]);
    const boxes = r.byProp[WORD_BOXES_PROP] ?? [];
    expect(boxes.map((b) => b.index).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual(Array.from({ length: 48 }, (_, i) => i));
    expect(boxes.every((b) => b.childPath.length === 2 && b.childPath[0].startsWith("sheet_"))).toBe(true);
    expect(r.byProp.textColor).toHaveLength(12);
  });

  it("a chained long page inside a sheet still binds: every word's box resolves three levels down, slots dense", async () => {
    const long26 = Array.from({ length: 26 }, (_, i) => `w${i}`).join(" ");
    const lyrics = [{ text: long26 }, ...Array.from({ length: 11 }, (_, i) => ({ text: `sheet page ${i} four` }))];
    const doc = await design({ lyrics });
    const r = resolvePropBindings(doc, W, H, { propsSchema: LyricStackV1.propsSchema });
    expect(r.rejected).toEqual([]);
    const boxes = r.byProp[WORD_BOXES_PROP] ?? [];
    expect(boxes.map((b) => b.index).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual(Array.from({ length: 26 + 44 }, (_, i) => i));
    expect(boxes.some((b) => b.childPath.length === 3 && b.childPath[0].startsWith("sheet_") && b.childPath[2] === "page_1_2")).toBe(true);
    // Each word paints where its box says (root px), however deep.
    const tiles = wordTiles(doc);
    expect(tiles).toHaveLength(70);
    for (const t of tiles.slice(0, 30)) {
      const rect = paintedRect(doc, t);
      expect(rect.x >= 0 && rect.y >= 0 && rect.x + rect.w <= W && rect.y + rect.h <= H).toBe(true);
    }
  });

  it("off 9:16 the platform guide is left out, and the advisory says why (design only)", async () => {
    const doc = asDocument(
      await LyricStackV1.render({ ...LyricStackV1.defaultProps }, { ...targetCtx(1080, 1350, { media }), mode: "design" } as MosaicEngineContext),
    );
    expect(doc.sources.some((s) => String(s.editor?.label).startsWith("platform-guide"))).toBe(false);
    expect(advisoryText(doc)).toContain("drawn for a 9:16 canvas; this one is 1080x1350");
    const off = asDocument(
      await LyricStackV1.render(
        { ...LyricStackV1.defaultProps, showGuide: false },
        { ...targetCtx(1080, 1350, { media }), mode: "design" } as MosaicEngineContext,
      ),
    );
    expect(advisoryText(off)).toBe("");
  });

  it("reveal word: one word at a time, windows disjoint", async () => {
    const doc = await render({ reveal: "word", lyrics: TIMED, song: SONG });
    const windows = wordTiles(doc)
      .map((t) => t.overlay?.window as { startSec: number; endSec: number })
      .sort((a, b) => a.startSec - b.startSec);
    expect(windows.length).toBeGreaterThan(5);
    windows.forEach((w, k) => {
      if (k > 0) expect(windows[k - 1].endSec).toBeLessThan(w.startSec);
    });
  });

  it("songStartSec shifts the lyric bank onto the clip, drops what was sung before, keeps word indexes", async () => {
    const at0 = await render({ lyrics: TIMED, song: SONG, songStartSec: 0 });
    const at12 = await render({ lyrics: TIMED, song: SONG, songStartSec: 12 });
    const idx = (doc: MosaicDocument) => wordTiles(doc).map(indexOf).sort((a, b) => a - b);
    expect(idx(at0)).toEqual(Array.from({ length: 17 }, (_, i) => i));
    expect(idx(at12)).toEqual([8, 9, 10, 11, 12, 13, 14, 15, 16]);
    const third = (doc: MosaicDocument) => wordTiles(doc).find((t) => indexOf(t) === 8);
    expect(third(at0)?.overlay?.window?.startSec).toBe(14);
    expect(third(at12)?.overlay?.window?.startSec).toBe(2);
    // The binding index is the word's SLOT in this clip (Word positions are per clip): the first word drawn is 0.
    expect(third(at12)?.editor?.bindings?.[0]).toEqual({ propKey: WORD_BOXES_PROP, index: 0, kind: "rect" });
    expect(third(at0)?.editor?.bindings?.[0]).toEqual({ propKey: WORD_BOXES_PROP, index: 8, kind: "rect" });
    // The song leaf starts at Song start, unbound; the clip runs for the rest of the song.
    const song = at12.sources.find((s) => s.editor?.label === "song");
    expect(song?.type === "media" && song.playback?.clipStartMs).toBe(12_000);
    expect(at12.durationMs).toBe(28_000);
  });

  it("untimed lyrics spread over the clip, whatever Song start says", async () => {
    const doc = await render({ songStartSec: 30, song: SONG });
    expect(doc.durationMs).toBe(10_000);
    expect(wordTiles(doc)).toHaveLength(LYRIC_STACK_DEFAULT_LYRICS.flatMap((c) => c.text.split(/\s+/)).length);
  });

  it("pages never share the lyric box, even on a clip too short for a 400 ms beat each", async () => {
    // Five default pages on a 1 s clip: each clears as the next appears.
    const doc = asDocument(await LyricStackV1.render({ ...LyricStackV1.defaultProps }, ctxFor("render", 1000)));
    expect(doc.durationMs).toBe(1000);
    const spans = inkChildren(doc)
      .map(({ doc: d }) => {
        const w = d.sources
          .filter((s) => s.type === "lavfi")
          .map((s) => s.overlay?.window as { startSec: number; endSec: number });
        return { start: Math.min(...w.map((x) => x.startSec)), end: Math.max(...w.map((x) => x.endSec)) };
      })
      .sort((a, b) => a.start - b.start);
    expect(spans).toHaveLength(LYRIC_STACK_DEFAULT_LYRICS.length);
    spans.forEach((sp, k) => {
      if (k > 0) expect(spans[k - 1].end).toBeLessThanOrEqual(sp.start);
    });
  });

  it("a Song start past the song's end is a plain error card", async () => {
    const doc = await render({ song: SONG, songStartSec: 45 });
    expect(JSON.stringify(doc)).toContain("past the end of the song");
  });

  it("duration follows the longest take after its trim (then the song remainder)", async () => {
    const doc = await render({ takeCount: "2", take1: TAKE1, take2: TAKE2, take2TrimSec: 8, song: SONG });
    expect(doc.durationMs).toBe(20_000);
    const trimmed = doc.sources.find((s) => s.editor?.label === "take-2");
    expect(trimmed?.type === "media" && trimmed.playback?.clipStartMs).toBe(8000);
    expect(trimmed?.type === "media" && trimmed.audio?.enabled).toBe(false);
    expect((await render({ song: SONG, songStartSec: 15 })).durationMs).toBe(25_000);
  });

  it("lays out 1 to 4 takes, each tile bound to its media, trim and framing", async () => {
    const expected = { "1": "1", "2": "2[1,1]", "3": "3[1,1,1]", "4": "2[2(1,1),2(1,1)]" } as const;
    for (const count of ["1", "2", "3", "4"] as const) {
      const doc = await render({ takeCount: count, take1: TAKE1, take3: TAKE3, take4: TAKE4, take2: PHOTO });
      expect(String(doc.m0).startsWith(expected[count])).toBe(true);
      const n = Number(count);
      const takes = doc.sources.slice(0, n);
      takes.forEach((s, i) => expect(s.editor?.bindings?.map((b) => b.propKey)).toEqual([`take${i + 1}`, `take${i + 1}TrimSec`, `take${i + 1}Framing`]));
      const r = resolvePropBindings(doc, W, H, { propsSchema: LyricStackV1.propsSchema });
      expect(r.rejected).toEqual([]);
      expect(Boolean(r.byProp.take4)).toBe(n === 4);
    }
  });

  it("glow children only when glow is above 0", async () => {
    const off = await render({ glow: 0 });
    expect(Object.keys(off.children ?? {}).some((k) => k.startsWith("glow_"))).toBe(false);
    const on = await render({ glow: 0.8, glowColor: "#000000" });
    const glowRef = on.sources.find(
      (s): s is Extract<MosaicSource, { type: "mosaic" }> => s.type === "mosaic" && s.ref === "glow_1",
    );
    expect(glowRef?.effects?.blur).toBeGreaterThan(0);
    expect(glowRef?.visual?.opacity).toBeCloseTo(0.9);
    expect((on.children as Record<string, MosaicDocument>).glow_1.backgroundColor).toBe("#000000");
  });

  it("guides are design-only: the platform PNG and the advisory never reach an export", async () => {
    const long = { takeCount: "1", take1: "/media/long.mp4" };
    const longMedia = { ...media, [asAssetId("/media/long.mp4")]: { durationMs: 204_000, hasVideo: true, width: 1080, height: 1920 } };
    const run = (mode: "render" | "design", props: LyricStackProps) =>
      LyricStackV1.render(
        { ...LyricStackV1.defaultProps, ...props },
        { ...targetCtx(W, H, { media: longMedia as MosaicEngineContext["media"] }), mode } as MosaicEngineContext,
      ).then(asDocument);
    const isGuide = (s: MosaicSource) => String(s.editor?.label).startsWith("platform-guide");
    const d = await run("design", long);
    const reels = resolveShortPlatform("instagram-reel");
    // One crop tile per region of the platform's PNG, each on its own rect.
    const guide = d.sources.filter(isGuide);
    expect(guide.map((s) => s.editor?.label).sort()).toEqual(guideTiles(reels, W, H).map((t) => `platform-guide:${t.name}`).sort());
    expect(guide.every((s) => s.type === "media" && s.mediaType === "image" && s.placement?.fit === "cover")).toBe(true);
    expect(Object.values(d.assets).some((a) => (a as { path?: string }).path === guidePng(reels))).toBe(true);
    expect(advisoryText(d)).toContain("Reels stop at 3:00 - this clip is 3:24.");
    const r = await run("render", long);
    expect(r.sources.some((s) => isGuide(s) || String(s.editor?.label).startsWith("design-advisory"))).toBe(false);
    const off = await run("design", { ...long, showGuide: false });
    expect(off.sources.some(isGuide)).toBe(false);
    expect(off.sources.some((s) => s.editor?.label === "design-advisory")).toBe(true);
    // The advisory sits at the top of the safe area, under the nav row, in its own strip.
    const stage = platformStage(reels, W, H);
    const strip = leavesOf(off, W, H).find((l) => l.label === "design-advisory")?.rect as Rect;
    expect(strip.y).toBeGreaterThan(stage.safe.y);
    expect(strip.y + strip.h).toBeLessThan(stage.safe.y + 200);
    const tiktok = await run("design", { platform: "tiktok" });
    expect(Object.values(tiktok.assets).some((a) => (a as { path?: string }).path === guidePng(resolveShortPlatform("tiktok")))).toBe(true);
  });

  it("exportAll: three steps named reels, tiktok, shorts at 1080x1920 (design stays one document)", async () => {
    const pipe = asPipeline(await renderAny({ exportAll: true, lyrics: TIMED, song: SONG }));
    expect(pipe.emit).toBe("multi");
    expect(pipe.steps.map((s) => [s.name, s.label])).toEqual([
      ["reels", "reels"],
      ["tiktok", "tiktok"],
      ["shorts", "shorts"],
    ]);
    for (const step of pipe.steps) {
      const file = asDocument(step.file as MosaicDocument);
      expect(file.size).toEqual({ width: W, height: H });
      expect(step.durationMs).toBe(file.durationMs);
      expect(file.format).toEqual({ kind: "video", container: "mp4" });
      expect(file.audio?.codec).toBe("aac");
      expect(file.audio?.bitrate).toBe("320k");
    }
    expect((await renderAny({ exportAll: true }, "design")).kind).toBe("mosaic_document");
  });

  it("masterAudio: mov + ProRes + 24-bit PCM on a single-platform export only", async () => {
    const one = await render({ masterAudio: true });
    expect(one.format).toEqual({ kind: "video", container: "mov", videoCodec: "prores_ks", pixelFormat: "yuv422p10le" });
    expect(one.audio?.codec).toBe("pcm_s24le");
    const all = asPipeline(await renderAny({ masterAudio: true, exportAll: true }));
    for (const step of all.steps) {
      const file = step.file as MosaicDocument;
      expect(file.format?.container).toBe("mp4");
      expect(file.audio?.codec).toBe("aac");
    }
    expect(resolveLyricStackHints({ ...LyricStackV1.defaultProps })).toEqual({
      width: 1080,
      height: 1920,
      format: LyricStackV1.outputHints?.format,
    });
    expect(resolveLyricStackHints({ masterAudio: true }).format).toEqual({ kind: "video", container: "mov" });
    expect(resolveLyricStackHints({ masterAudio: true, exportAll: true }).format).toEqual({ kind: "video", container: "mp4" });
  });

  it("custom word boxes: a moved box re-fits its word; a list of the wrong length is ignored", async () => {
    const base = await render();
    // What Make seeds a drag with (and writes back for every sibling): the rect each word tile PAINTS.
    const tiles = wordTiles(base).sort((a, b) => indexOf(a) - indexOf(b));
    const rects = tiles.map((t) => paintedRect(base, t));
    expect(rects).toHaveLength(tiles.length);
    const moved = { x: 100, y: 300, w: 700, h: 260 };
    const wordBoxes = { canvas: { w: W, h: H }, regions: rects.map((r, i) => (i === 3 ? moved : r)) };
    const doc = await render({ wordBoxes });
    const t3 = wordTiles(doc).find((t) => indexOf(t) === 3);
    const t0 = wordTiles(doc).find((t) => indexOf(t) === 0);
    const before3 = tiles.find((t) => indexOf(t) === 3);
    expect(t3?.mask?.kind === "inline-mask" && before3?.mask?.kind === "inline-mask").toBe(true);
    if (t3?.mask?.kind === "inline-mask" && before3?.mask?.kind === "inline-mask") {
      expect(t3.mask.bounds.width).toBeGreaterThan(before3.mask.bounds.width);
    }
    expect(JSON.stringify(t0)).toBe(JSON.stringify(tiles.find((t) => indexOf(t) === 0)));
    const short = await design({ wordBoxes: { canvas: { w: W, h: H }, regions: [moved] } });
    expect(JSON.stringify(wordTiles(short))).toBe(JSON.stringify(wordTiles(await design())));
    expect(advisoryText(short)).toContain("Word positions reset: the words on screen changed");
  });

  it("Word positions are per clip: slots 0..n-1 over the words the clip draws, so a drag in a mid-song clip sticks", async () => {
    // Whole-song lyrics, a clip from 12 s: it draws global words 8..16 only.
    const clip: LyricStackProps = { lyrics: TIMED, song: SONG, songStartSec: 12 };
    const base = await design(clip);
    const r = resolvePropBindings(base, W, H, { propsSchema: LyricStackV1.propsSchema });
    expect(r.rejected).toEqual([]);
    // Dense from 0: Make seeds a rect list from element 0 up to the first element with no tile.
    const slots = (r.byProp[WORD_BOXES_PROP] ?? []).map((b) => b.index ?? -1).sort((a, b) => a - b);
    expect(slots).toEqual(Array.from({ length: 9 }, (_, i) => i));
    // What Make writes on a drag: every slot's painted rect, slot 0 moved and grown.
    const tiles = wordTiles(base).sort((a, b) => slotOf(a) - slotOf(b));
    const rects = tiles.map((t) => paintedRect(base, t));
    const moved = { x: 100, y: 300, w: 700, h: 260 };
    const dragged = await design({ ...clip, wordBoxes: { canvas: { w: W, h: H }, regions: rects.map((rr, i) => (i === 0 ? moved : rr)) } });
    expect(JSON.stringify(dragged.sources)).not.toContain("Word positions reset");
    const first = wordTiles(dragged).find((t) => slotOf(t) === 0);
    expect(first?.editor?.label).toBe("word-9"); // labelled by its global index
    expect(maskWidth(first)).toBeGreaterThan(maskWidth(tiles[0]));
    for (const t of wordTiles(dragged).filter((x) => slotOf(x) > 0)) {
      expect(paintedRect(dragged, t)).toEqual(rects[slotOf(t)]);
    }
    // A list sized for the whole song (17 words) does not match this clip: reset, and the note says why.
    const whole = await design({ ...clip, wordBoxes: { canvas: { w: W, h: H }, regions: Array.from({ length: 17 }, () => moved) } });
    expect(JSON.stringify(wordTiles(whole))).toBe(JSON.stringify(wordTiles(base)));
    expect(advisoryText(whole)).toContain("Word positions reset: the words on screen changed");
    // In an export the note never draws; the boxes apply the same way.
    const exported = await render({ ...clip, wordBoxes: { canvas: { w: W, h: H }, regions: rects.map((rr, i) => (i === 0 ? moved : rr)) } });
    expect(maskWidth(wordTiles(exported).find((t) => slotOf(t) === 0))).toBe(maskWidth(first));
  });

  it("reveal word, a clip starting mid-page: only the word still on screen carries over; sung words keep their beats", async () => {
    const lyrics: MosaicTimedCue[] = [
      {
        text: "one two three four five six seven eight",
        startMs: 0,
        endMs: 3500,
        words: [0, 400, 800, 1200, 1600, 2000, 3000, 3300].map((startMs) => ({ startMs })),
      },
      { text: "the next page", startMs: 4000 },
    ];
    const firstPage = (doc: MosaicDocument) =>
      wordTiles(doc)
        .filter((t) => indexOf(t) < 8)
        .sort((a, b) => indexOf(a) - indexOf(b));
    // From 3 s, "seven" is sung on the first frame: one..six already had their turn and never flash.
    const at3 = await render({ lyrics, song: SONG, songStartSec: 3, reveal: "word" });
    expect(firstPage(at3).map(indexOf)).toEqual([6, 7]);
    expect(firstPage(at3).map((t) => t.overlay?.window?.startSec)).toEqual([0, 0.3]);
    // From 2.5 s, "six" (sung at 2.0) is still on screen until "seven" lands at 0.5.
    const at25 = await render({ lyrics, song: SONG, songStartSec: 2.5, reveal: "word" });
    expect(firstPage(at25).map(indexOf)).toEqual([5, 6, 7]);
    expect(firstPage(at25).map((t) => t.overlay?.window?.startSec)).toEqual([0, 0.5, 0.8]);
    // Slots stay dense over what is drawn.
    const slots = wordTiles(at25).map(slotOf).sort((a, b) => a - b);
    expect(slots).toEqual(slots.map((_, i) => i));
    // The build-up reveal still shows every word of the page from the first frame.
    const built = await render({ lyrics, song: SONG, songStartSec: 3 });
    expect(firstPage(built).map(indexOf)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it("never fails on a word that would leave the canvas: an overlong token, a 40-line page, a box dragged to the edge", async () => {
    const chant = "na-na-na-na-na-na-na-na-na-na-na-na-na";
    for (const font of ["archivo-black", "righteous"]) {
      expect({ font, words: wordTiles(await render({ font, lyrics: [{ text: chant }] })).length }).toEqual({ font, words: 1 });
    }
    for (const platform of SHORT_PLATFORM_IDS) {
      for (const font of ["archivo-black", "righteous", "pacifico"]) {
        const doc = await render({ font, platform, textSize: 1.5, lyrics: [{ text: "never-gonna-give-you-up-tonight" }] });
        expect({ platform, font, words: wordTiles(doc).length }).toEqual({ platform, font, words: 1 });
      }
    }
    const forty = Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n");
    expect(wordTiles(await render({ lyrics: [{ text: forty }] }))).toHaveLength(80);
    // A box dragged mostly off the right edge (Make keeps a sliver of it): the word slides in whole.
    const doc = await render({ lyrics: [{ text: "edge" }], wordBoxes: { canvas: { w: W, h: H }, regions: [{ x: 1072, y: 400, w: 60, h: 40 }] } });
    const [tile] = wordTiles(doc);
    const painted = paintedRect(doc, tile);
    expect(painted.x + painted.w).toBe(W);
    expect(painted.x).toBeGreaterThan(W - 60);
  });

  it("a take named like the song keeps its own file (asset keys never collide)", async () => {
    const doc = await render({ takeCount: "1", take1: "/x/Movies/Song Title.mov", song: "/x/Music/Song Title.wav" });
    const assets = doc.assets as unknown as Record<string, { path: string }>;
    const fileOf = (label: string) => {
      const src = doc.sources.find((x) => x.editor?.label === label);
      return src?.type === "media" ? assets[String(src.assetId)]?.path : undefined;
    };
    expect(fileOf("take-1")).toBe("/x/Movies/Song Title.mov");
    expect(fileOf("song")).toBe("/x/Music/Song Title.wav");
  });

  it("every dropdown shows plain labels, one per allowed value", () => {
    const schema = LyricStackV1.propsSchema as Record<string, MosaicTemplatePropDefinition>;
    const closed = Object.entries(schema).filter(([, def]) => Array.isArray(def.meta?.constraints?.oneOf));
    expect(closed.map(([k]) => k).sort()).toEqual(
      ["layout", "lyricsPosition", "platform", "reveal", "takeCount", "textAlign", "wordEntrance"].sort(),
    );
    for (const [key, def] of closed) {
      const options = (def.meta?.control as { options?: Array<{ value: string; label?: string }> } | undefined)?.options ?? [];
      expect({ key, values: options.map((o) => o.value).sort() }).toEqual({
        key,
        values: [...(def.meta?.constraints?.oneOf as string[])].sort(),
      });
      for (const o of options) expect({ key, label: typeof o.label === "string" && o.label.trim() !== "" }).toEqual({ key, label: true });
    }
    // The five that used to show raw values now show words.
    const labels = (key: string) =>
      ((schema[key].meta?.control as { options?: Array<{ label?: string }> }).options ?? []).map((o) => o.label);
    expect(labels("reveal")).toEqual(["Words build up", "One word at a time", "Line by line"]);
    expect(labels("layout")).toEqual(["Automatic", "Rows", "Columns", "Grid 2 x 2"]);
    expect(labels("textAlign")).toEqual(["Centred", "Edge to edge", "Left"]);
  });

  it("normalises smart quotes the font lacks, and names what is still missing (design only)", async () => {
    const font = asciiFont("test:lyric-stack-template-ascii.ttf");
    const lyrics = [{ text: "don’t “stop” now… café" }];
    const doc = await design({ fontFile: font, lyrics });
    const tiles = wordTiles(doc);
    expect(tiles).toHaveLength(4);
    const note = advisoryText(doc);
    // The curly quotes and the ellipsis had ASCII stand-ins; only the accent is missing.
    expect(note).toBe('This font has no "\u00e9"; those draw as boxes.');
    // With Anton (it has the typographic set) nothing is reported.
    const anton = await design({ lyrics });
    expect(JSON.stringify(anton.sources)).not.toContain("This font has no");
  });

  it("an unreadable font file falls back to a bundled face and says so by file name only", async () => {
    const doc = await design({ fontFile: "/Users/someone/Downloads/Fancy.woff2" });
    expect(wordTiles(doc).length).toBeGreaterThan(0);
    const text = advisoryText(doc);
    expect(text).toContain("Fancy.woff2");
    expect(text).toContain("convert it to TTF");
    expect(JSON.stringify(doc.sources)).not.toContain("/Users/someone");
    const missing = await design({ fontFile: "/nowhere/Gone.ttf" });
    expect(advisoryText(missing)).toContain("Gone.ttf");
    // In a real render the warning never draws.
    expect(JSON.stringify((await render({ fontFile: "/nowhere/Gone.ttf" })).sources)).not.toContain("Gone.ttf");
  });

  it("is deterministic, and its layout fingerprint is stable", async () => {
    const a = await render();
    const b = await render();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const fa = layoutFingerprintOf([a], W, H);
    const fb = layoutFingerprintOf([b], W, H);
    expect(fa?.hash).toBeDefined();
    expect(fa).toEqual(fb);
  });

  it("passes the 0.2.0 render-time audit with no error finding", async () => {
    const audit = await auditRenderedTemplate(LyricStackV1, { record: false });
    expect(audit.skipped).toBeUndefined();
    expect(audit.findings.filter((f) => f.severity === "error")).toEqual([]);
    expect(audit.canvas).toEqual({ width: W, height: H });
  });
});
