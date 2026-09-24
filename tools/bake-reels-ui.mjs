#!/usr/bin/env node
/**
 * bake-reels-ui — draw the Instagram Reels viewer chrome (status bar, header,
 * action rail, caption block) as ONE transparent 1080x1920 PNG a template can
 * lay over its render while you edit.
 *
 *   node tools/bake-reels-ui.mjs [--svg]   (--svg also writes the .svg beside it)
 *
 * Geometry was measured from screenshots of a Reel on a 6.3" iPhone (1206x2622
 * screen, the Reel filling the 1206x2365 area above the comment bar) and
 * mapped back onto the 1080x1920 video: the phone scales the video by
 * 2365/1920 = 1.2316 and crops ~50 px off EACH SIDE (the video is 9:16, the
 * area is narrower). So this is a guide, not a pixel-exact spec — Instagram
 * moves things between app versions and phones.
 *
 * Everything drawn is generic: "yourhandle", placeholder counts, a blank
 * avatar, simple outline icons drawn here. No real account, no logo.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const sharp = require("sharp");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "src/reels/lyric-triptych/v1/assets");
const W = 1080;
const H = 1920;
/** Side strips a tall phone crops off a 9:16 video (px of the 1080-wide video). */
const SIDE_CROP = 50;

const FONT = `-apple-system, 'SF Pro Text', 'Helvetica Neue', Helvetica, Arial, sans-serif`;
const INK = "#FFFFFF";
const STROKE = 4.5;

/** An outline icon drawn in a 60x60 box, centred on (cx, cy) at `size` px. */
const icon = (d, cx, cy, size, extra = "") =>
  `<g transform="translate(${cx - size / 2} ${cy - size / 2}) scale(${size / 60})" fill="none" stroke="${INK}" stroke-width="${(STROKE * 60) / size}" stroke-linecap="round" stroke-linejoin="round" ${extra}>${d}</g>`;

const ICONS = {
  heart: `<path d="M30 52 C 12 39 5 30 5 20.5 C 5 12 11.5 6 19.5 6 C 24.5 6 28 8.6 30 12.4 C 32 8.6 35.5 6 40.5 6 C 48.5 6 55 12 55 20.5 C 55 30 48 39 30 52 Z"/>`,
  comment: `<path d="M49.7 43.8 A 24 24 0 1 0 43.8 49.7 L 55 55 Z"/>`,
  repost: `<path d="M13 27 V21 A 7 7 0 0 1 20 14 H45"/><path d="M38 6.5 L45.5 14 L38 21.5"/><path d="M47 33 V39 A 7 7 0 0 1 40 46 H15"/><path d="M22 38.5 L14.5 46 L22 53.5"/>`,
  share: `<path d="M6 11 L54 9 L29 53 L24.5 31.5 Z"/><path d="M24.5 31.5 L54 9"/>`,
  more: `<path d="M13 25 H49"/><path d="M11 37 H38"/>`,
  back: `<path d="M38 8 L18 30 L38 52"/>`,
  camera: `<path d="M9 19 H18 L22 12 H38 L42 19 H51 A 5 5 0 0 1 56 24 V47 A 5 5 0 0 1 51 52 H9 A 5 5 0 0 1 4 47 V24 A 5 5 0 0 1 9 19 Z"/><circle cx="30" cy="35" r="9.5"/>`,
};

const text = (s, x, y, size, { weight = 600, anchor = "start", opacity = 1 } = {}) =>
  `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" font-weight="${weight}" fill="${INK}" fill-opacity="${opacity}" text-anchor="${anchor}">${s}</text>`;

// ── rail: centred on x = 956 (measured) ──────────────────────────────────
const RAIL_X = 956;
const rail = [
  { icon: "heart", y: 995, size: 60, count: "12.4K", countY: 1080 },
  { icon: "comment", y: 1181, size: 57, count: "318", countY: 1257 },
  { icon: "repost", y: 1368, size: 58, count: "96", countY: 1448 },
  { icon: "share", y: 1547, size: 56, count: "1,204", countY: 1624 },
  { icon: "more", y: 1720, size: 56 },
];

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="top" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#000" stop-opacity="0.30"/>
      <stop offset="1" stop-color="#000" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="bottom" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#000" stop-opacity="0"/>
      <stop offset="1" stop-color="#000" stop-opacity="0.45"/>
    </linearGradient>
    <linearGradient id="thumb" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#6D5BD0"/>
      <stop offset="1" stop-color="#E0637A"/>
    </linearGradient>
    <filter id="soft" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="1" stdDeviation="2.5" flood-color="#000" flood-opacity="0.35"/>
    </filter>
  </defs>

  <!-- legibility scrims Instagram lays over the top and bottom of a Reel -->
  <rect x="0" y="0" width="${W}" height="300" fill="url(#top)"/>
  <rect x="0" y="1460" width="${W}" height="460" fill="url(#bottom)"/>

  <!-- tall phones crop ~50 px off each side of a 9:16 video -->
  <rect x="0" y="0" width="${SIDE_CROP}" height="${H}" fill="#000" fill-opacity="0.35"/>
  <rect x="${W - SIDE_CROP}" y="0" width="${SIDE_CROP}" height="${H}" fill="#000" fill-opacity="0.35"/>
  <path d="M${SIDE_CROP} 0 V${H} M${W - SIDE_CROP} 0 V${H}" stroke="#FFFFFF" stroke-opacity="0.35" stroke-width="2" stroke-dasharray="10 10"/>

  <g filter="url(#soft)">
    <!-- status bar -->
    ${text("9:41", 180, 92, 37, { anchor: "middle" })}
    <rect x="322" y="34" width="418" height="89" rx="44.5" fill="#000"/>
    <g fill="${INK}">
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
    <path d="M950 76 V85" stroke="${INK}" stroke-opacity="0.45" stroke-width="3.5" stroke-linecap="round"/>

    <!-- header -->
    ${icon(ICONS.back, 142, 212, 50)}
    ${text("Reels", 540, 229, 42, { anchor: "middle" })}
    ${icon(ICONS.camera, 959, 211, 60)}

    <!-- action rail -->
    ${rail
      .map(
        (r) =>
          icon(ICONS[r.icon], RAIL_X, r.y, r.size) +
          (r.count ? text(r.count, RAIL_X, r.countY + 12, 32, { anchor: "middle" }) : ""),
      )
      .join("\n    ")}
    <rect x="921" y="1804" width="70" height="70" rx="14" fill="url(#thumb)" stroke="${INK}" stroke-width="4"/>

    <!-- caption block -->
    <circle cx="133" cy="1675" r="42" fill="#3A3F4B" stroke="${INK}" stroke-opacity="0.9" stroke-width="3"/>
    <circle cx="133" cy="1662" r="15" fill="#9AA3B2"/>
    <path d="M107 1702 A 28 24 0 0 1 159 1702 Z" fill="#9AA3B2"/>
    ${text("yourhandle", 197, 1689, 35)}
    <rect x="394" y="1654" width="120" height="48" rx="12" fill="none" stroke="${INK}" stroke-opacity="0.9" stroke-width="3"/>
    ${text("Follow", 454, 1687, 28, { anchor: "middle" })}
    ${text("your caption goes here, the first line of it…", 91, 1783, 32, { weight: 400 })}
    <circle cx="112" cy="1852" r="19" fill="#5B6270" stroke="#000" stroke-opacity="0.5" stroke-width="3"/>
    <circle cx="140" cy="1852" r="19" fill="#7B8494" stroke="#000" stroke-opacity="0.5" stroke-width="3"/>
    ${text("Liked by a_friend and 12,431 others", 175, 1862, 28, { weight: 400, opacity: 0.92 })}
  </g>

  <!-- playback progress along the bottom edge -->
  <rect x="0" y="${H - 4}" width="${W}" height="4" fill="${INK}" fill-opacity="0.3"/>
  <rect x="0" y="${H - 4}" width="${Math.round(W * 0.38)}" height="4" fill="${INK}" fill-opacity="0.9"/>
</svg>
`;

fs.mkdirSync(OUT_DIR, { recursive: true });
const png = path.join(OUT_DIR, "reels-ui.png");
await sharp(Buffer.from(svg)).png({ compressionLevel: 9, palette: false }).toFile(png);
if (process.argv.includes("--svg")) fs.writeFileSync(path.join(OUT_DIR, "reels-ui.svg"), svg);
const { size } = fs.statSync(png);
console.log(`bake-reels-ui: ${path.relative(ROOT, png)} (${W}x${H}, ${Math.round(size / 1024)} KB)`);
