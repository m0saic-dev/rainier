#!/usr/bin/env node
/**
 * bake-platform-ui — draw each short-form viewer's chrome (status bar, header,
 * action rail, caption block, side-crop strips, progress line) as ONE
 * transparent 1080x1920 PNG per platform, plus a dashed outline of the
 * text-safe area, and write the REGIONS that hold every drawn pixel. A
 * template shows the PNG over its DESIGN-mode preview (never over an export)
 * as one small tile per region (`placement.sourceRect` crops the PNG), so the
 * artist sees what each app will cover while every word between the regions
 * stays reachable in Make: a full-canvas guide tile is a click target that
 * shadows everything under it.
 *
 *   node tools/bake-platform-ui.mjs [reels|tiktok|shorts|all] [--svg]
 *
 *   writes  src/_shared/assets/<slug>-ui.png    (the path `guidePng()` returns)
 *           src/_shared/platform-guide-regions.ts  (GENERATED; only with `all`)
 *   --svg   also writes <tmpdir>/bake-platform-ui/<slug>-ui.svg for inspection.
 *           Never beside the PNG: tools/copy-assets.mjs mirrors every file in
 *           assets/ into dist/, so an .svg there would ship.
 *
 * NOTHING SPANS THE FRAME. No full-width scrim (a crop would cut its gradient
 * into hard dark boxes, and a scrim tile would be a full-frame click target
 * again): the ink keeps its own soft shadow for legibility. No label inside
 * the safe area (the only drawing that sat where the words go): the outline's
 * "text-safe area" legend runs down the left side strip, and an estimated
 * row says "estimated guide" ABOVE `safe.y`, beside the header.
 *
 * GEOMETRY COMES FROM THE TABLE. `TABLE` below restates the fractions of
 * `SHORT_PLATFORMS` in src/_shared/platforms.ts (a .mjs tool cannot import the
 * TS), each next to the platforms.ts expression it copies, and `stageOf`
 * restates `platformStage`. Three gates run before anything is written:
 *
 *   1. drift: platforms.ts is transpiled in memory (typescript, a
 *      devDependency) and every fraction here, the `measured` flag, and the
 *      integer-px stage at 1080x1920 must equal the live row. A mismatch
 *      names the field and exits 1. Fix whichever side is wrong; never bake
 *      past it.
 *   2. ink: each chrome group is rendered on its own and its opaque ink
 *      (alpha >= 128) must sit inside its table rect: status bar and header
 *      above `safe.y`, the rail inside `rail`, the caption inside
 *      `captionBlock`, the progress bar below the safe area. So the picture
 *      the artist sees IS the table the templates lay out against.
 *   3. regions (`deriveRegions`): the lines (side strips, the safe outline's
 *      top and bottom edges, the progress bar) come from the stage; each
 *      chrome group's region is its visible ink box (alpha >= REGION_ALPHA,
 *      shadow included) rounded OUT to even px, clamped so no two regions
 *      share a pixel (the dashed lines own their bands; the rail region also
 *      owns the notch the outline cuts round it). Every pixel of the final
 *      PNG at alpha >= REGION_ALPHA must lie in exactly one region, or
 *      nothing is written. Fainter shadow pixels outside every region
 *      (invisible, under 3 %) are cleared, so the PNG holds exactly what the
 *      region tiles show.
 *
 * Reels keeps the positions measured for tools/bake-reels-ui.mjs (the rows
 * of platforms.ts were derived from them). TikTok and Shorts are drawn from
 * their rects (rail items spread over `rail`, caption rows inside
 * `captionBlock`, header inside `safe.y`), so re-measuring a row moves the
 * drawing with it. Both were measured from screenshots on 2026-09-29; their
 * drawings follow what those screenshots show (the item order of each rail,
 * the caption rows), in generic shapes. A row marked `measured: false` would
 * also get the "estimated guide" note.
 *
 * Everything drawn is generic: "yourhandle", placeholder counts and titles, a
 * blank avatar, gradient thumbnails, outline and filled icons drawn here from
 * plain SVG shapes. No logo, wordmark, brand glyph or brand colour; no real
 * account. The primitives (icon, text, side crop, status bar) are lifted
 * from bake-reels-ui.mjs, which stays untouched: it writes into the frozen
 * triptych's folder.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const sharp = require("sharp");
const ts = require("typescript");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLATFORMS_TS = path.join(ROOT, "src/_shared/platforms.ts");
const OUT_DIR = path.join(ROOT, "src/_shared/assets");
const REGIONS_TS = path.join(ROOT, "src/_shared/platform-guide-regions.ts");
const SVG_DIR = path.join(os.tmpdir(), "bake-platform-ui");
const W = 1080;
const H = 1920;

// ── THE TABLE, restated from src/_shared/platforms.ts (SHORT_PLATFORMS) ───
// Keep every number beside the platforms.ts expression it copies. The drift
// gate compares both at run time; edit platforms.ts first, then here.
const TABLE = {
  reels: {
    canvas: { width: 1080, height: 1920 }, // REELS_W x REELS_H
    chrome: {
      top: 241 / 1920, //                     REELS_HEADER_BOTTOM / REELS_H
      bottom: (1920 - 1631) / 1920, //        (REELS_H - REELS_CAPTION_TOP) / REELS_H
      side: 50 / 1080, //                     REELS_SIDE_CROP / REELS_W
    },
    rail: {
      width: (1080 - 910) / 1080, //          (REELS_W - REELS_RAIL_LEFT) / REELS_W
      top: 965 / 1920, //                     REELS_RAIL_TOP / REELS_H
      bottom: (1920 - 1876) / 1920, //        (REELS_H - REELS_RAIL_BOTTOM) / REELS_H
    },
    caption: { height: (1874 - 1631) / (1920 - 1631) }, // (REELS_CAPTION_BOTTOM - REELS_CAPTION_TOP) / (REELS_H - REELS_CAPTION_TOP)
    measured: true, //                        measured: true
  },
  tiktok: {
    canvas: { width: 1080, height: 1920 }, // TIKTOK_W x TIKTOK_H
    chrome: {
      top: 247 / 1920, //                     TIKTOK_HEADER_BOTTOM / TIKTOK_H
      bottom: (1920 - 1747) / 1920, //        (TIKTOK_H - TIKTOK_CAPTION_TOP) / TIKTOK_H
      side: 52 / 1080, //                     TIKTOK_SIDE_CROP / TIKTOK_W
    },
    rail: {
      width: (1080 - 896) / 1080, //          (TIKTOK_W - TIKTOK_RAIL_LEFT) / TIKTOK_W
      top: 953 / 1920, //                     TIKTOK_RAIL_TOP / TIKTOK_H
      bottom: (1920 - 1886) / 1920, //        (TIKTOK_H - TIKTOK_RAIL_BOTTOM) / TIKTOK_H
    },
    caption: { height: (1893 - 1747) / (1920 - 1747) }, // (TIKTOK_CAPTION_BOTTOM - TIKTOK_CAPTION_TOP) / (TIKTOK_H - TIKTOK_CAPTION_TOP)
    measured: true, //                        measured: true
  },
  shorts: {
    canvas: { width: 1080, height: 1920 }, // SHORTS_W x SHORTS_H
    chrome: {
      top: 232 / 1920, //                     SHORTS_HEADER_BOTTOM / SHORTS_H
      bottom: (1920 - 1735) / 1920, //        (SHORTS_H - SHORTS_CAPTION_TOP) / SHORTS_H
      side: 52 / 1080, //                     SHORTS_SIDE_CROP / SHORTS_W
    },
    rail: {
      width: (1080 - 897) / 1080, //          (SHORTS_W - SHORTS_RAIL_LEFT) / SHORTS_W
      top: 1063 / 1920, //                    SHORTS_RAIL_TOP / SHORTS_H
      bottom: (1920 - 1872) / 1920, //        (SHORTS_H - SHORTS_RAIL_BOTTOM) / SHORTS_H
    },
    caption: { height: (1876 - 1735) / (1920 - 1735) }, // (SHORTS_CAPTION_BOTTOM - SHORTS_CAPTION_TOP) / (SHORTS_H - SHORTS_CAPTION_TOP)
    measured: true, //                        measured: true
  },
};
const SLUGS = Object.keys(TABLE);

// ── platformStage, restated (src/_shared/platforms.ts) ─────────────────────
function dim(v) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 1 ? n : 1;
}
function px(size, frac) {
  const f = Number.isFinite(frac) ? frac : 0;
  return Math.min(size, Math.max(0, Math.round(size * f)));
}
function stageOf(row, width, height) {
  const cw = dim(width);
  const ch = dim(height);
  const side = Math.min(px(cw, row.chrome.side), Math.floor((cw - 1) / 2));
  const top = Math.min(px(ch, row.chrome.top), ch - 1);
  const bottom = Math.min(px(ch, row.chrome.bottom), ch - 1 - top);
  const safe = { x: side, y: top, w: Math.max(1, cw - 2 * side), h: Math.max(1, ch - top - bottom) };
  const stage = { safe };
  if (row.rail) {
    const railW = Math.min(Math.max(1, px(cw, row.rail.width)), cw);
    const railTop = Math.min(px(ch, row.rail.top), ch - 1);
    const railBottom = Math.min(px(ch, row.rail.bottom), ch - 1 - railTop);
    stage.rail = { x: cw - railW, y: railTop, w: railW, h: Math.max(1, ch - railTop - railBottom) };
  }
  if (row.caption && bottom > 0) {
    const h = Math.min(bottom, Math.max(1, px(bottom, row.caption.height)));
    const right = stage.rail ? Math.min(stage.rail.x, safe.x + safe.w) : safe.x + safe.w;
    stage.captionBlock = { x: safe.x, y: ch - bottom, w: Math.max(1, right - safe.x), h };
  }
  return stage;
}

// ── gate 1: drift against the live platforms.ts ────────────────────────────
function loadLivePlatforms() {
  const source = fs.readFileSync(PLATFORMS_TS, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: "platforms.ts",
  });
  const mod = { exports: {} };
  vm.runInNewContext(outputText, {
    exports: mod.exports,
    module: mod,
    require: (id) => {
      throw new Error(`platforms.ts imports "${id}"; the drift gate expects a module with no runtime imports`);
    },
  });
  return mod.exports;
}

function driftProblems() {
  const live = loadLivePlatforms();
  const problems = [];
  const liveSlugs = live.SHORT_PLATFORMS.map((p) => p.slug);
  if (liveSlugs.join(",") !== SLUGS.join(",")) {
    problems.push(`platform order: platforms.ts has [${liveSlugs}], this tool draws [${SLUGS}]`);
  }
  const same = (a, b) => a === b || (typeof a === "number" && typeof b === "number" && Math.abs(a - b) < 1e-12);
  for (const slug of SLUGS) {
    const row = live.SHORT_PLATFORMS.find((p) => p.slug === slug);
    if (!row) {
      problems.push(`${slug}: no row in platforms.ts`);
      continue;
    }
    const spec = TABLE[slug];
    for (const group of ["canvas", "chrome", "rail", "caption"]) {
      const a = spec[group];
      const b = row[group];
      if (!a !== !b) {
        problems.push(`${slug}.${group}: ${b ? "platforms.ts has it, TABLE does not" : "TABLE has it, platforms.ts does not"}`);
        continue;
      }
      if (!a) continue;
      for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
        if (!same(a[key], b[key])) problems.push(`${slug}.${group}.${key}: platforms.ts ${b[key]}, TABLE ${a[key]}`);
      }
    }
    if (spec.measured !== row.measured) problems.push(`${slug}.measured: platforms.ts ${row.measured}, TABLE ${spec.measured}`);
    const want = JSON.stringify(live.platformStage(row, W, H));
    const got = JSON.stringify(stageOf(spec, W, H));
    if (want !== got) problems.push(`${slug} stage at ${W}x${H}: platformStage ${want}, stageOf ${got}`);
  }
  return problems;
}

// ── primitives (lifted from bake-reels-ui.mjs) ─────────────────────────────
const FONT = `-apple-system, 'SF Pro Text', 'Helvetica Neue', Helvetica, Arial, sans-serif`;
const INK = "#FFFFFF";
const STROKE = 4.5;
/** Placeholder thumbnail / accent colours (generic, no brand colour). */
const THUMB_A = "#6D5BD0";
const THUMB_B = "#E0637A";

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** An outline icon drawn in a 60x60 box, centred on (cx, cy) at `size` px; the stroke stays STROKE px. */
const icon = (d, cx, cy, size, extra = "") =>
  `<g transform="translate(${cx - size / 2} ${cy - size / 2}) scale(${size / 60})" fill="none" stroke="${INK}" stroke-width="${(STROKE * 60) / size}" stroke-linecap="round" stroke-linejoin="round" ${extra}>${d}</g>`;

/** A filled icon drawn in a 60x60 box, centred on (cx, cy) at `size` px. */
const solid = (d, cx, cy, size) =>
  `<g transform="translate(${cx - size / 2} ${cy - size / 2}) scale(${size / 60})" fill="${INK}" stroke="none">${d}</g>`;

const text = (s, x, y, size, { weight = 600, anchor = "start", opacity = 1, fill = INK } = {}) =>
  `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" font-weight="${weight}" fill="${fill}" fill-opacity="${opacity}" text-anchor="${anchor}">${esc(s)}</text>`;

/** Scale a fragment by `s` about the anchor (ax, ay). */
const scaled = (s, ax, ay, body) =>
  s === 1 ? body : `<g transform="translate(${ax} ${ay}) scale(${s}) translate(${-ax} ${-ay})">${body}</g>`;

/** 60x60-box icon paths: the Reels set from bake-reels-ui.mjs plus generic extras. */
const ICONS = {
  heart: `<path d="M30 52 C 12 39 5 30 5 20.5 C 5 12 11.5 6 19.5 6 C 24.5 6 28 8.6 30 12.4 C 32 8.6 35.5 6 40.5 6 C 48.5 6 55 12 55 20.5 C 55 30 48 39 30 52 Z"/>`,
  comment: `<path d="M49.7 43.8 A 24 24 0 1 0 43.8 49.7 L 55 55 Z"/>`,
  repost: `<path d="M13 27 V21 A 7 7 0 0 1 20 14 H45"/><path d="M38 6.5 L45.5 14 L38 21.5"/><path d="M47 33 V39 A 7 7 0 0 1 40 46 H15"/><path d="M22 38.5 L14.5 46 L22 53.5"/>`,
  share: `<path d="M6 11 L54 9 L29 53 L24.5 31.5 Z"/><path d="M24.5 31.5 L54 9"/>`,
  more: `<path d="M13 25 H49"/><path d="M11 37 H38"/>`,
  back: `<path d="M38 8 L18 30 L38 52"/>`,
  camera: `<path d="M9 19 H18 L22 12 H38 L42 19 H51 A 5 5 0 0 1 56 24 V47 A 5 5 0 0 1 51 52 H9 A 5 5 0 0 1 4 47 V24 A 5 5 0 0 1 9 19 Z"/><circle cx="30" cy="35" r="9.5"/>`,
  // generic extras
  search: `<circle cx="26" cy="26" r="17"/><path d="M38.5 38.5 L53 53"/>`,
  bubble: `<path d="M10 10 H50 A 5 5 0 0 1 55 15 V39 A 5 5 0 0 1 50 44 H25 L14 53 V44 H10 A 5 5 0 0 1 5 39 V15 A 5 5 0 0 1 10 10 Z"/>`,
  forward: `<path d="M33 8 L55 29 L33 50 V38 C 19 38 10 42 5 52 C 6 35 15 23 33 21 Z"/>`,
  thumbUp: `<path d="M7 27 H17 V53 H7 Z"/><path d="M17 29 L28 9 C 30 5 36 6 36 11 V23 H50 C 54 23 57 27 56 31 L52 49 C 51.3 51.6 49 53 46.5 53 H17"/>`,
  remix: `<path d="M47 24 A 18 18 0 0 0 14 22"/><path d="M47 10 V24 H33"/><path d="M13 36 A 18 18 0 0 0 46 38"/><path d="M13 50 V36 H27"/>`,
};
ICONS.thumbDown = `<g transform="matrix(1 0 0 -1 0 60)">${ICONS.thumbUp}</g>`;

/** Filled 60x60-box shapes (for the solid() helper). */
const SOLIDS = {
  heart: ICONS.heart,
  bubble: `<path d="M30 8 C 15 8 5 17 5 28.5 C 5 36 9.5 42 16.5 45.5 L 14 54 L 26 48.6 C 27.3 48.8 28.6 49 30 49 C 45 49 55 40 55 28.5 C 55 17 45 8 30 8 Z"/><g fill="#000" fill-opacity="0.45"><circle cx="19" cy="28.5" r="3.6"/><circle cx="30" cy="28.5" r="3.6"/><circle cx="41" cy="28.5" r="3.6"/></g>`,
  bookmark: `<path d="M15 6 H45 A 3 3 0 0 1 48 9 V54 L30 42 L12 54 V9 A 3 3 0 0 1 15 6 Z"/>`,
  forward: ICONS.forward,
  dots: `<circle cx="30" cy="12" r="4.8"/><circle cx="30" cy="30" r="4.8"/><circle cx="30" cy="48" r="4.8"/>`,
  note: `<path d="M22 44 V14 L50 8 V38" fill="none" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/><ellipse cx="15.5" cy="44" rx="8" ry="6.5"/><ellipse cx="43.5" cy="38" rx="8" ry="6.5"/>`,
};

/** A blank avatar (the Reels caption avatar, scaled to radius r). */
function avatar(cx, cy, r) {
  const k = r / 42;
  return (
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#3A3F4B" stroke="${INK}" stroke-opacity="0.9" stroke-width="3"/>` +
    `<circle cx="${cx}" cy="${cy - 13 * k}" r="${15 * k}" fill="#9AA3B2"/>` +
    `<path d="M${cx - 26 * k} ${cy + 27 * k} A ${28 * k} ${24 * k} 0 0 1 ${cx + 26 * k} ${cy + 27 * k} Z" fill="#9AA3B2"/>`
  );
}

/**
 * The status bar measured for Reels (time at x 180, the camera island centred
 * on x 540, signal / wifi / battery ending at x 954), each cluster scaled by
 * `s` about its own anchor so a shorter header keeps the same arrangement.
 */
function statusBar(s) {
  const time = text("9:41", 180, 92, 37, { anchor: "middle" });
  const island = `<rect x="322" y="34" width="418" height="89" rx="44.5" fill="#000"/>`;
  const right = `<g fill="${INK}">
      <rect x="781" y="83" width="8" height="9" rx="2"/>
      <rect x="793" y="78" width="8" height="14" rx="2"/>
      <rect x="805" y="73" width="8" height="19" rx="2" fill-opacity="0.4"/>
      <rect x="817" y="68" width="8" height="24" rx="2" fill-opacity="0.4"/>
    </g>
    <g fill="none" stroke="${INK}" stroke-width="4.5" stroke-linecap="round">
      <path d="M840 76 A 28 28 0 0 1 878 76"/>
      <path d="M847 83 A 18 18 0 0 1 871 83"/>
    </g>
    <circle cx="859" cy="90" r="3.5" fill="${INK}"/>
    <rect x="892" y="69" width="54" height="23" rx="7" fill="none" stroke="${INK}" stroke-opacity="0.45" stroke-width="2.5"/>
    <rect x="896" y="73" width="46" height="15" rx="4" fill="${INK}"/>
    <path d="M950 76 V85" stroke="${INK}" stroke-opacity="0.45" stroke-width="3.5" stroke-linecap="round"/>`;
  return [scaled(s, 180, 0, time), scaled(s, 540, 0, island), scaled(s, 954, 0, right)].join("\n    ");
}
/** Status bar ink bottom at scale 1 (the island: y 34 + 89). */
const STATUS_BOTTOM = 123;
/** Header row height kept below a scaled status bar on the estimated rows. */
const HEADER_ROW = 52;
/** Status-bar scale that leaves a header row inside `safe.y` (1 = the measured Reels size). */
const statusScale = (safeY) => Math.min(1, Math.max(0.3, (safeY - HEADER_ROW) / STATUS_BOTTOM));

/**
 * Spread rail items over the rail rect, first at its top, last at its bottom.
 * Each item is `{ h, draw(top) }` and keeps its ink inside [top, top + h].
 */
function stackRail(rail, items) {
  const total = items.reduce((sum, it) => sum + it.h, 0);
  const gap = items.length > 1 ? Math.max(8, (rail.h - total) / (items.length - 1)) : 0;
  let y = rail.y;
  const out = [];
  for (const it of items) {
    out.push(it.draw(Math.round(y)));
    y += it.h + gap;
  }
  return out.join("\n    ");
}

/** The x the rail items centre on: the middle of the rail's VISIBLE part (rail.x to W - side). */
const railCentre = (stage) => Math.round((stage.rail.x + (W - stage.safe.x)) / 2);

/** A music-note + "Original audio" ticker; `x` is the note's left edge, `y` the text baseline. */
const ticker = (label, x, y, size = 28) =>
  solid(SOLIDS.note, x + 13, y - 10, 26) + text(label, x + 34, y, size, { weight: 400, opacity: 0.95 });

// ── per-platform drawing: { status, header, rail, caption } ─────────────────
// Placeholder copy, invented here and shared by all three.
const CAPTION_1 = "your caption goes here, the first line of it";
const CAPTION_2 = "and a second line before it folds… more";

const DRAW = {
  /** Reels: the positions measured for bake-reels-ui.mjs (the source of the Reels row). */
  reels(stage) {
    const RAIL_X = 956; // measured rail centre
    const rail = [
      { icon: "heart", y: 995, size: 60, count: "12.4K", countY: 1080 },
      { icon: "comment", y: 1181, size: 57, count: "318", countY: 1257 },
      { icon: "repost", y: 1368, size: 58, count: "96", countY: 1448 },
      { icon: "share", y: 1547, size: 56, count: "1,204", countY: 1624 },
      { icon: "more", y: 1720, size: 56 },
    ];
    return {
      status: statusBar(statusScale(stage.safe.y)),
      header: [
        icon(ICONS.back, 142, 212, 50),
        text("Reels", 540, 229, 42, { anchor: "middle" }),
        icon(ICONS.camera, 959, 211, 60),
      ].join("\n    "),
      rail: [
        ...rail.map(
          (r) =>
            icon(ICONS[r.icon], RAIL_X, r.y, r.size) +
            (r.count ? text(r.count, RAIL_X, r.countY + 12, 32, { anchor: "middle" }) : ""),
        ),
        // audio tile
        `<rect x="921" y="1804" width="70" height="70" rx="14" fill="url(#thumb)" stroke="${INK}" stroke-width="4"/>`,
      ].join("\n    "),
      caption: [
        avatar(133, 1675, 42),
        text("yourhandle", 197, 1689, 35),
        `<rect x="394" y="1654" width="120" height="48" rx="12" fill="none" stroke="${INK}" stroke-opacity="0.9" stroke-width="3"/>`,
        text("Follow", 454, 1687, 28, { anchor: "middle" }),
        text(CAPTION_1, 91, 1768, 32, { weight: 400 }),
        text(CAPTION_2, 91, 1810, 32, { weight: 400 }),
        ticker("yourhandle · Original audio", 91, 1860),
      ].join("\n    "),
    };
  },

  /** TikTok: tabs header, a six-item rail ending in the sound disc, name row + two caption lines. */
  tiktok(stage) {
    const { safe, rail, captionBlock: cap } = stage;
    const cx = railCentre(stage);
    const counted = (shape, size, count) => ({
      h: size + 38,
      draw: (top) =>
        solid(SOLIDS[shape], cx, top + size / 2, size) +
        text(count, cx, top + size + 34, 28, { anchor: "middle" }),
    });
    const tabY = safe.y - 14; // tab baseline
    const L = cap.x + 30;
    return {
      status: statusBar(statusScale(safe.y)),
      header: [
        text("Following", 522, tabY, 32, { anchor: "end", opacity: 0.7 }),
        `<path d="M540 ${tabY - 20} V${tabY - 2}" stroke="${INK}" stroke-opacity="0.45" stroke-width="2.5" stroke-linecap="round"/>`,
        text("For You", 558, tabY, 32, { weight: 700 }),
        `<rect x="594" y="${tabY + 6}" width="44" height="4" rx="2" fill="${INK}"/>`,
        icon(ICONS.search, 968, safe.y - 30, 40),
      ].join("\n    "),
      rail: stackRail(rail, [
        {
          // avatar with a follow (+) badge
          h: 104,
          draw: (top) =>
            avatar(cx, top + 44, 42) +
            `<circle cx="${cx}" cy="${top + 86}" r="16" fill="${THUMB_B}"/>` +
            `<path d="M${cx - 8} ${top + 86} H${cx + 8} M${cx} ${top + 78} V${top + 94}" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>`,
        },
        counted("heart", 66, "12.4K"),
        counted("bubble", 62, "318"),
        counted("bookmark", 56, "1,204"),
        counted("forward", 60, "96"),
        {
          // the round sound disc
          h: 88,
          draw: (top) =>
            `<circle cx="${cx}" cy="${top + 44}" r="40" fill="#1C1C1E" stroke="#3A3A3C" stroke-width="8"/>` +
            `<circle cx="${cx}" cy="${top + 44}" r="19" fill="url(#thumb)"/>` +
            `<circle cx="${cx}" cy="${top + 44}" r="3.5" fill="#1C1C1E"/>`,
        },
      ]),
      // Measured: the name row, then two caption lines ending in "… more".
      caption: [
        text("yourhandle", L, cap.y + 30, 36, { weight: 700 }),
        text(CAPTION_1, L, cap.y + 90, 31, { weight: 400 }),
        text(CAPTION_2, L, cap.y + 132, 31, { weight: 400 }),
      ].join("\n    "),
    };
  },

  /** Shorts: search + more header, a six-item rail ending in the sound tile, channel row + Subscribe, title. */
  shorts(stage) {
    const { safe, rail, captionBlock: cap } = stage;
    const cx = railCentre(stage);
    // Measured: outline icons with a label under each, no backdrops.
    const labelled = (glyph, size, label) => ({
      h: 96,
      draw: (top) => icon(glyph, cx, top + 24, size) + text(label, cx, top + 88, 28, { anchor: "middle" }),
    });
    const L = cap.x + 30;
    const rowY = cap.y + 40; // channel row centre
    return {
      status: statusBar(statusScale(safe.y)),
      // The search and more icons, at the x measured on the screenshot.
      header: [icon(ICONS.search, 836, safe.y - 26, 44), solid(SOLIDS.dots, 954, safe.y - 26, 44)].join("\n    "),
      rail: stackRail(rail, [
        labelled(ICONS.heart, 48, "12K"),
        labelled(ICONS.bubble, 48, "318"),
        labelled(SOLIDS.bookmark, 46, "Save"),
        labelled(ICONS.forward, 48, "Share"),
        labelled(ICONS.remix, 48, "Remix"),
        {
          // sound tile
          h: 80,
          draw: (top) =>
            `<rect x="${cx - 38}" y="${top + 2}" width="76" height="76" rx="14" fill="url(#thumb)" stroke="${INK}" stroke-width="3"/>`,
        },
      ]),
      caption: [
        avatar(L + 46, rowY, 37),
        text("@yourhandle", L + 100, rowY + 11, 32),
        `<rect x="${L + 300}" y="${rowY - 25}" width="156" height="50" rx="25" fill="${INK}"/>`,
        text("Subscribe", L + 378, rowY + 9, 26, { anchor: "middle", fill: "#0F0F0F" }),
        text("Song Title - live rehearsal", L, cap.y + 130, 32),
      ].join("\n    "),
    };
  },
};

// ── composition ────────────────────────────────────────────────────────────
const DEFS = `<defs>
    <linearGradient id="thumb" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${THUMB_A}"/>
      <stop offset="1" stop-color="${THUMB_B}"/>
    </linearGradient>
    <filter id="soft" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="1" stdDeviation="2.5" flood-color="#000" flood-opacity="0.35"/>
    </filter>
  </defs>`;

/** The dashed outline's under-stroke is 4 px wide, centred on the edge it marks. */
const DASH_HALF = 2;

/**
 * The text-safe outline: a dashed hairline at the table's `safe` rect. Where
 * the rail covers the rect, that stretch of the outline is drawn faint and the
 * notch the rail cuts (its left edge, and its top / bottom inside the rect) is
 * drawn at full strength, so the strong line bounds exactly where text is safe
 * (the rule stage-layout's `lyricBox` applies). No label: the outline is the
 * only drawing that reaches into the area where the words go, and it stays on
 * the edge.
 */
function safeGuide({ safe, rail }) {
  const right = safe.x + safe.w;
  const bottom = safe.y + safe.h;
  const DASH = "12 10";
  const dashed = (d, opacity) =>
    `<path d="${d}" fill="none" stroke="#000" stroke-opacity="${(opacity * 0.4).toFixed(2)}" stroke-width="${2 * DASH_HALF}" stroke-dasharray="${DASH}"/>` +
    `<path d="${d}" fill="none" stroke="${INK}" stroke-opacity="${opacity}" stroke-width="2" stroke-dasharray="${DASH}"/>`;
  const outline = `M${safe.x} ${safe.y} H${right} V${bottom} H${safe.x} Z`;
  const parts = [];
  const notch = railNotch({ safe, rail });
  if (notch) {
    const railPath = `M${rail.x} ${rail.y} H${rail.x + rail.w} V${rail.y + rail.h} H${rail.x} Z`;
    parts.push(
      `<defs><clipPath id="off-rail"><path clip-rule="evenodd" d="M0 0 H${W} V${H} H0 Z ${railPath}"/></clipPath>` +
        `<clipPath id="on-rail"><path d="${railPath}"/></clipPath></defs>`,
      `<g clip-path="url(#off-rail)">${dashed(outline, 0.75)}</g>`,
      `<g clip-path="url(#on-rail)">${dashed(outline, 0.25)}</g>`,
    );
    let d = `M${rail.x} ${notch.y0} V${notch.y1}`;
    if (rail.y > safe.y) d = `M${right} ${notch.y0} H${rail.x} V${notch.y1}`;
    if (rail.y + rail.h < bottom) d += ` H${right}`;
    parts.push(dashed(d, 0.75));
  } else {
    parts.push(dashed(outline, 0.75));
  }
  return parts.join("\n  ");
}

/** The vertical span where the rail cuts into the safe rect, or null when it does not. */
function railNotch({ safe, rail }) {
  if (!rail) return null;
  const right = safe.x + safe.w;
  const y0 = Math.max(rail.y, safe.y);
  const y1 = Math.min(rail.y + rail.h, safe.y + safe.h);
  return y1 > y0 && rail.x > safe.x && rail.x < right ? { y0, y1 } : null;
}

/**
 * An estimated row's note, ABOVE `safe.y` at the left (the header draws from
 * the centre rightwards on those rows), so nothing is drawn inside the area
 * where the words go. A measured row has none.
 */
const ESTIMATE_NOTE = "estimated guide";
const estimateNote = ({ safe }) => text(ESTIMATE_NOTE, safe.x + 14, safe.y - 18, 22, { weight: 500, opacity: 0.7 });

/**
 * The outline's legend, INSIDE the left side strip (never in the safe area, and
 * no room beside the header on every row): "text-safe area" read top to bottom
 * down the strip from the outline's top corner, its letters leaning on the
 * dashed edge. It lies in the `sideCropLeft` region with the strip.
 */
const SAFE_LEGEND = "text-safe area";
const SAFE_LEGEND_PX = 18;
const safeLegend = ({ safe }) =>
  `<g transform="translate(${safe.x - 26} ${safe.y + 16}) rotate(90)">${text(SAFE_LEGEND, 0, 0, SAFE_LEGEND_PX, { weight: 500, opacity: 0.75 })}</g>`;

/** The playback progress line along the bottom edge (below the safe area). */
const PROGRESS_H = 4;
const PROGRESS = `<rect x="0" y="${H - PROGRESS_H}" width="${W}" height="${PROGRESS_H}" fill="${INK}" fill-opacity="0.3"/>
  <rect x="0" y="${H - PROGRESS_H}" width="${Math.round(W * 0.38)}" height="${PROGRESS_H}" fill="${INK}" fill-opacity="0.9"/>`;

const CHROME_GROUPS = ["status", "header", "rail", "caption"];

/**
 * The full guide, or (with `only`) one part alone: a chrome group, "note"
 * (the estimate note) or "bottom" (the progress line), for the ink and region
 * gates.
 */
function compose(stage, parts, measured, only) {
  const side = stage.safe.x;
  const body = [];
  if (!only) {
    if (side > 0) {
      body.push(`<!-- the strips a tall phone crops off each side of a 9:16 video -->
  <rect x="0" y="0" width="${side}" height="${H}" fill="#000" fill-opacity="0.35"/>
  <rect x="${W - side}" y="0" width="${side}" height="${H}" fill="#000" fill-opacity="0.35"/>`);
    }
    body.push(`<!-- text-safe area (the table's safe rect) and the rail's notch -->\n  ${safeGuide(stage)}`);
    if (side >= SAFE_LEGEND_PX + 16) body.push(`<!-- its legend, in the left strip -->\n  ${safeLegend(stage)}`);
  }
  if (!measured && (!only || only === "note")) body.push(`<!-- this row is an estimate -->\n  ${estimateNote(stage)}`);
  const groups = only ? (CHROME_GROUPS.includes(only) ? [only] : []) : CHROME_GROUPS;
  if (groups.length) {
    body.push(`<g filter="url(#soft)">
    ${groups.map((g) => `<!-- ${g} -->\n    ${parts[g]}`).join("\n    ")}
  </g>`);
  }
  if (!only || only === "bottom") body.push(`<!-- playback progress -->\n  ${PROGRESS}`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  ${DEFS}
  ${body.join("\n  ")}
</svg>
`;
}

/** An SVG rasterised to straight (not premultiplied) RGBA. */
async function rasterize(svg) {
  const { data, info } = await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.channels !== 4 || info.width !== W || info.height !== H) {
    throw new Error(`bake-platform-ui: expected ${W}x${H} RGBA, got ${info.width}x${info.height}x${info.channels}`);
  }
  return data;
}

// ── gate 2: ink stays inside the table's rects ─────────────────────────────
/** Bounds of the pixels at alpha >= `minAlpha` of an SVG, or null when there are none. */
async function inkBounds(svg, minAlpha = 128) {
  const data = await rasterize(svg);
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < H; y++) {
    const row = y * W * 4;
    for (let x = 0; x < W; x++) {
      if (data[row + x * 4 + 3] >= minAlpha) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x0, y0, x1: x1 + 1, y1: y1 + 1 };
}

/** Anti-aliasing slack, px. */
const TOL = 2;

function inkRules(stage) {
  const { safe, rail, captionBlock } = stage;
  const safeBottom = safe.y + safe.h;
  const inside = (r) => ({ x0: r.x, y0: r.y, x1: r.x + r.w, y1: r.y + r.h });
  const above = { x0: safe.x, y0: 0, x1: safe.x + safe.w, y1: safe.y };
  return {
    status: { label: "above safe.y", box: above },
    header: { label: "above safe.y", box: above },
    note: { label: "above safe.y", box: above },
    rail: rail ? { label: "inside rail", box: inside(rail) } : null,
    caption: captionBlock ? { label: "inside captionBlock", box: inside(captionBlock) } : null,
    bottom: { label: "below the safe area", box: { x0: 0, y0: safeBottom, x1: W, y1: H } },
  };
}

async function checkInk(slug, stage, parts, measured) {
  const rules = inkRules(stage);
  const report = [];
  const problems = [];
  for (const group of [...CHROME_GROUPS, "note", "bottom"]) {
    const rule = rules[group];
    const ink = await inkBounds(compose(stage, parts, measured, group));
    if (!ink) continue;
    const fmt = `x ${ink.x0}-${ink.x1}, y ${ink.y0}-${ink.y1}`;
    report.push(`${group} ${fmt}`);
    if (!rule) {
      problems.push(`${slug}.${group}: drawn but the row defines no rect for it`);
      continue;
    }
    const b = rule.box;
    if (ink.x0 < b.x0 - TOL || ink.y0 < b.y0 - TOL || ink.x1 > b.x1 + TOL || ink.y1 > b.y1 + TOL) {
      problems.push(`${slug}.${group}: ink ${fmt} is not ${rule.label} (x ${b.x0}-${b.x1}, y ${b.y0}-${b.y1})`);
    }
  }
  return { report, problems };
}

// ── gate 3: regions that hold every drawn pixel, and nothing else ─────────
/**
 * A pixel at this alpha or above must lie in a region. Fainter ones (the far
 * tail of the ink's soft shadow, under 3 %) are cleared when they fall
 * outside every region.
 */
const REGION_ALPHA = 8;

const floorEven = (v) => Math.floor(v / 2) * 2;
const ceilEven = (v) => Math.ceil(v / 2) * 2;
/** Edge box (x0 <= x < x1, y0 <= y < y1). */
const box = (x0, y0, x1, y1) => ({ x0, y0, x1, y1 });
const outward = (b) => box(floorEven(b.x0), floorEven(b.y0), ceilEven(b.x1), ceilEven(b.y1));
const union = (a, b) => (!a ? b : !b ? a : box(Math.min(a.x0, b.x0), Math.min(a.y0, b.y0), Math.max(a.x1, b.x1), Math.max(a.y1, b.y1)));
const empty = (b) => b.x1 <= b.x0 || b.y1 <= b.y0;
const overlaps = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
const clampBox = (b, lim) => box(Math.max(b.x0, lim.x0), Math.max(b.y0, lim.y0), Math.min(b.x1, lim.x1), Math.min(b.y1, lim.y1));

/**
 * The regions for one platform, in drawing order, as edge boxes. Lines come
 * from the stage (they are drawn from it); chrome groups from their visible
 * ink, rounded out to even px and clamped off the lines, so no two regions
 * share a pixel:
 *
 *   sideCropLeft / sideCropRight  the side strips + the outline's side edges, full height above the progress line
 *   safeTopEdge / safeBottomEdge  the outline's top / bottom edge between the strips (the bottom stops at the rail)
 *   actionRail                    the rail's ink + the notch the outline cuts round it
 *   statusBar, navRow             above the top edge (the nav row below the status bar)
 *   estimateNote                  an estimated row's note, above the top edge, left of the nav row
 *   captionBlock                  below the bottom edge, left of the rail
 *   progressBar                   the bottom line
 */
async function deriveRegions(stage, parts, measured) {
  const { safe, rail } = stage;
  const safeBottom = safe.y + safe.h;
  const progressBar = box(0, H - PROGRESS_H, W, H);
  const sideCropLeft = box(0, 0, ceilEven(safe.x + DASH_HALF), progressBar.y0);
  const sideCropRight = box(floorEven(safe.x + safe.w - DASH_HALF), 0, W, progressBar.y0);
  const between = box(sideCropLeft.x1, 0, sideCropRight.x0, progressBar.y0);
  const safeTopEdge = box(between.x0, floorEven(safe.y - DASH_HALF), between.x1, ceilEven(safe.y + DASH_HALF));
  const ink = async (only) => {
    const b = await inkBounds(compose(stage, parts, measured, only), REGION_ALPHA);
    return b ? outward(b) : null;
  };

  let actionRail = null;
  const notch = railNotch(stage);
  if (rail) {
    const notchBox = notch ? box(rail.x - DASH_HALF, rail.y - DASH_HALF, between.x1, notch.y1 + DASH_HALF) : null;
    const r = union(await ink("rail"), notchBox && outward(notchBox));
    if (r) actionRail = clampBox(r, box(between.x0, safeTopEdge.y1, between.x1, progressBar.y0));
  }
  const railSpansBottom = actionRail && actionRail.y0 < safeBottom - DASH_HALF && actionRail.y1 > safeBottom + DASH_HALF;
  const safeBottomEdge = box(
    between.x0,
    floorEven(safeBottom - DASH_HALF),
    railSpansBottom ? actionRail.x0 : between.x1,
    ceilEven(safeBottom + DASH_HALF),
  );

  const above = box(between.x0, 0, between.x1, safeTopEdge.y0);
  const statusInk = await ink("status");
  const statusBar = statusInk && clampBox(statusInk, above);
  const headerInk = await ink("header");
  let navRow = headerInk && clampBox(headerInk, above);
  if (navRow && statusBar && overlaps(navRow, statusBar)) navRow = box(navRow.x0, statusBar.y1, navRow.x1, navRow.y1);
  let estimateNote = null;
  if (!measured) {
    const noteInk = await ink("note");
    estimateNote = noteInk && clampBox(noteInk, above);
    if (estimateNote && statusBar && overlaps(estimateNote, statusBar)) {
      estimateNote = box(estimateNote.x0, statusBar.y1, estimateNote.x1, estimateNote.y1);
    }
    if (estimateNote && navRow && overlaps(estimateNote, navRow)) {
      estimateNote = box(estimateNote.x0, estimateNote.y0, navRow.x0, estimateNote.y1);
    }
  }
  const captionInk = await ink("caption");
  const captionBlock =
    captionInk &&
    clampBox(captionInk, box(between.x0, safeBottomEdge.y1, actionRail ? actionRail.x0 : between.x1, progressBar.y0));

  const named = {
    statusBar,
    navRow,
    estimateNote,
    safeTopEdge,
    actionRail,
    safeBottomEdge,
    captionBlock,
    sideCropLeft,
    sideCropRight,
    progressBar,
  };
  return Object.entries(named)
    .filter(([, b]) => b && !empty(b))
    .map(([name, b]) => ({ name, box: b }));
}

/**
 * Gate 3 on the final picture: no two regions share a pixel, every pixel at
 * alpha >= REGION_ALPHA lies in a region, and every region holds some of
 * them. Returns the picture with every pixel outside the regions cleared.
 */
function checkRegions(slug, regions, data) {
  const problems = [];
  for (let i = 0; i < regions.length; i++) {
    for (let j = i + 1; j < regions.length; j++) {
      if (overlaps(regions[i].box, regions[j].box)) problems.push(`${slug}: ${regions[i].name} overlaps ${regions[j].name}`);
    }
  }
  const owner = new Int16Array(W * H).fill(-1);
  regions.forEach(({ box: b }, k) => {
    for (let y = b.y0; y < b.y1; y++) owner.fill(k, y * W + b.x0, y * W + b.x1);
  });
  const inked = new Array(regions.length).fill(0);
  let stray = null;
  let clearedMax = 0;
  const out = Buffer.from(data);
  for (let p = 0; p < W * H; p++) {
    const a = data[p * 4 + 3];
    if (owner[p] >= 0) {
      if (a >= REGION_ALPHA) inked[owner[p]]++;
      continue;
    }
    if (a >= REGION_ALPHA) {
      const x = p % W;
      const y = (p - x) / W;
      stray = union(stray, box(x, y, x + 1, y + 1));
    }
    if (a > clearedMax) clearedMax = a;
    out[p * 4] = 0;
    out[p * 4 + 1] = 0;
    out[p * 4 + 2] = 0;
    out[p * 4 + 3] = 0;
  }
  if (stray) {
    problems.push(
      `${slug}: drawn pixels outside every region, within x ${stray.x0}-${stray.x1}, y ${stray.y0}-${stray.y1}`,
    );
  }
  regions.forEach(({ name }, k) => {
    if (inked[k] === 0) problems.push(`${slug}: region ${name} holds no drawn pixel`);
  });
  return { problems, cleared: out, clearedMax };
}

const regionRect = ({ box: b }) => ({ x: b.x0, y: b.y0, w: b.x1 - b.x0, h: b.y1 - b.y0 });

/** The generated TypeScript module: the regions and each PNG's SHA-256, per slug. */
function regionsModule(all) {
  const names = [
    "statusBar",
    "navRow",
    "estimateNote",
    "safeTopEdge",
    "actionRail",
    "safeBottomEdge",
    "captionBlock",
    "sideCropLeft",
    "sideCropRight",
    "progressBar",
  ];
  const rows = SLUGS.map((slug) => {
    const lines = all[slug].regions.map((r) => {
      const { x, y, w, h } = regionRect(r);
      return `    region("${r.name}", ${x}, ${y}, ${w}, ${h}),`;
    });
    return `  ${slug}: Object.freeze([\n${lines.join("\n")}\n  ]),`;
  });
  const hashes = SLUGS.map((slug) => `  ${slug}: "${all[slug].sha256}",`);
  return `/**
 * GENERATED by tools/bake-platform-ui.mjs from the guide PNGs it bakes. Do not
 * edit: change the drawing (or platforms.ts) and run
 * \`node tools/bake-platform-ui.mjs all\`, which rewrites the PNGs and this file
 * together.
 *
 * Each platform's guide PNG (src/_shared/assets/<slug>-ui.png, ${W}x${H}) is
 * shown in a design preview as one small tile per REGION, never as one
 * full-canvas image: a region is the box of what the PNG draws there (its
 * visible ink, shadow included, rounded out to even px), so the tiles hug the
 * app's chrome and every word between them stays reachable in Make. The
 * regions never share a pixel, and every pixel of the PNG that is not fully
 * transparent lies in exactly one of them (the baker's gate 3;
 * platform-guide-regions.test.ts checks it again against the PNG bytes).
 *
 * Rects are in PNG px; they double as each tile's \`placement.sourceRect\`.
 * \`guideTiles\` (platform-emit.ts) maps them onto a canvas.
 */
import type { ShortPlatformSlug } from "./platforms";

export type GuideRegionName =
${names.map((n) => `  | "${n}"`).join("\n")};

/** One region of a guide PNG: what it holds, and where, in PNG px. */
export type GuideRegion = {
  readonly name: GuideRegionName;
  readonly rect: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
};

/** The size every guide PNG is baked at, px. */
export const GUIDE_PNG_SIZE: Readonly<{ width: number; height: number }> = Object.freeze({ width: ${W}, height: ${H} });

const region = (name: GuideRegionName, x: number, y: number, w: number, h: number): GuideRegion =>
  Object.freeze({ name, rect: Object.freeze({ x, y, w, h }) });

/** Every platform's regions, in drawing order. */
export const GUIDE_REGIONS: Readonly<Record<ShortPlatformSlug, readonly GuideRegion[]>> = Object.freeze({
${rows.join("\n")}
});

/** SHA-256 of each PNG the regions were derived from (the test re-hashes the files). */
export const GUIDE_PNG_SHA256: Readonly<Record<ShortPlatformSlug, string>> = Object.freeze({
${hashes.join("\n")}
});
`;
}

// ── main ───────────────────────────────────────────────────────────────────
const USAGE = "usage: node tools/bake-platform-ui.mjs [reels|tiktok|shorts|all] [--svg]";
const args = process.argv.slice(2);
const writeSvg = args.includes("--svg");
const positional = args.filter((a) => a !== "--svg");
const target = positional[0] ?? "all";
if (positional.length > 1 || !(target === "all" || SLUGS.includes(target)) || args.some((a) => a.startsWith("-") && a !== "--svg")) {
  console.error(USAGE);
  process.exit(2);
}
const targets = target === "all" ? SLUGS : [target];

const drift = driftProblems();
if (drift.length) {
  console.error("bake-platform-ui: TABLE has drifted from src/_shared/platforms.ts; nothing written.");
  for (const p of drift) console.error(`  - ${p}`);
  process.exit(1);
}
console.log("bake-platform-ui: TABLE matches src/_shared/platforms.ts (fractions and 1080x1920 stage)");

// Every gate runs for every target before a single file is written.
const rect = (r) => (r ? `{${r.x},${r.y},${r.w},${r.h}}` : "none");
const baked = {};
for (const slug of targets) {
  const stage = stageOf(TABLE[slug], W, H);
  const parts = DRAW[slug](stage);
  const { measured } = TABLE[slug];
  const { report, problems } = await checkInk(slug, stage, parts, measured);
  if (problems.length) {
    console.error(`bake-platform-ui: ${slug} chrome leaves its table rects; nothing written.`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  const svg = compose(stage, parts, measured);
  const regions = await deriveRegions(stage, parts, measured);
  const gate = checkRegions(slug, regions, await rasterize(svg));
  if (gate.problems.length) {
    console.error(`bake-platform-ui: ${slug} regions do not hold the drawing; nothing written.`);
    for (const p of gate.problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  const png = await sharp(gate.cleared, { raw: { width: W, height: H, channels: 4 } })
    .png({ compressionLevel: 9, palette: false })
    .toBuffer();
  const sha256 = crypto.createHash("sha256").update(png).digest("hex");
  baked[slug] = { stage, svg, png, regions, report, clearedMax: gate.clearedMax, sha256 };
}

fs.mkdirSync(OUT_DIR, { recursive: true });
for (const slug of targets) {
  const { stage, svg, png, regions, report, clearedMax } = baked[slug];
  const file = path.join(OUT_DIR, `${slug}-ui.png`);
  fs.writeFileSync(file, png);
  if (writeSvg) {
    fs.mkdirSync(SVG_DIR, { recursive: true });
    fs.writeFileSync(path.join(SVG_DIR, `${slug}-ui.svg`), svg);
  }
  console.log(
    `bake-platform-ui: ${path.relative(ROOT, file)} (${W}x${H}, ${Math.round(png.length / 1024)} KB)\n` +
      `  stage    safe ${rect(stage.safe)}  rail ${rect(stage.rail)}  captionBlock ${rect(stage.captionBlock)}\n` +
      `  ink      ${report.join("; ")}\n` +
      `  regions  ${regions.map((r) => `${r.name} ${rect(regionRect(r))}`).join("; ")}\n` +
      `           (cleared outside them: alpha <= ${clearedMax})`,
  );
}
if (target === "all") {
  fs.writeFileSync(REGIONS_TS, regionsModule(baked));
  console.log(`bake-platform-ui: ${path.relative(ROOT, REGIONS_TS)} (regions + PNG hashes, all platforms)`);
} else {
  console.log(
    `bake-platform-ui: ${path.relative(ROOT, REGIONS_TS)} NOT rewritten (it covers every platform): ` +
      "run with `all` before you commit, or platform-guide-regions.test.ts fails on the stale hash.",
  );
}
if (writeSvg) console.log(`bake-platform-ui: SVGs in ${SVG_DIR}`);
