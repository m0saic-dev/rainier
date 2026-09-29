import crypto from "node:crypto";
import fs from "node:fs";

import sharp from "sharp";

import { guidePng } from "./platform-emit";
import { GUIDE_PNG_SHA256, GUIDE_PNG_SIZE, GUIDE_REGIONS } from "./platform-guide-regions";
import { SHORT_PLATFORMS } from "./platforms";

/**
 * The generated regions against the PNG bytes they were derived from
 * (tools/bake-platform-ui.mjs writes both). A re-bake that forgets the module,
 * or a PNG edited by hand, fails here.
 */
const { width: W, height: H } = GUIDE_PNG_SIZE;

async function pixels(file: string) {
  const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
  return { data, info };
}

describe("platform guide regions", () => {
  it("every platform has its regions and the hash of the PNG they came from", () => {
    for (const p of SHORT_PLATFORMS) {
      const file = guidePng(p);
      expect(fs.existsSync(file)).toBe(true);
      const sha = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
      expect({ slug: p.slug, sha }).toEqual({ slug: p.slug, sha: GUIDE_PNG_SHA256[p.slug] });
      const names = GUIDE_REGIONS[p.slug].map((r) => r.name);
      // The four the founder named, plus the lines; an estimated row also says so above the safe area.
      for (const n of ["statusBar", "navRow", "actionRail", "captionBlock", "sideCropLeft", "sideCropRight", "progressBar"]) {
        expect({ slug: p.slug, has: names.includes(n as never) }).toEqual({ slug: p.slug, has: true });
      }
      expect(names.includes("estimateNote")).toBe(!p.measured);
      expect(new Set(names).size).toBe(names.length);
    }
  });

  it("regions are even-px boxes inside the PNG, and no two share a pixel", () => {
    for (const p of SHORT_PLATFORMS) {
      const regions = GUIDE_REGIONS[p.slug];
      for (const { name, rect: r } of regions) {
        const ok =
          [r.x, r.y, r.w, r.h].every((v) => Number.isInteger(v) && v % 2 === 0) &&
          r.w > 0 &&
          r.h > 0 &&
          r.x >= 0 &&
          r.y >= 0 &&
          r.x + r.w <= W &&
          r.y + r.h <= H;
        expect({ slug: p.slug, name, ok }).toEqual({ slug: p.slug, name, ok: true });
      }
      for (let i = 0; i < regions.length; i++) {
        for (let j = i + 1; j < regions.length; j++) {
          const a = regions[i].rect;
          const b = regions[j].rect;
          const hit = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
          expect({ pair: `${p.slug} ${regions[i].name}/${regions[j].name}`, hit }).toEqual({
            pair: `${p.slug} ${regions[i].name}/${regions[j].name}`,
            hit: false,
          });
        }
      }
    }
  });

  it("every drawn pixel of each PNG lies in exactly one region, and every region draws something", async () => {
    for (const p of SHORT_PLATFORMS) {
      const { data, info } = await pixels(guidePng(p));
      expect({ w: info.width, h: info.height, channels: info.channels }).toEqual({ w: W, h: H, channels: 4 });
      const owner = new Int16Array(W * H).fill(-1);
      GUIDE_REGIONS[p.slug].forEach(({ rect: r }, k) => {
        for (let y = r.y; y < r.y + r.h; y++) owner.fill(k, y * W + r.x, y * W + r.x + r.w);
      });
      let stray = 0;
      const inked = new Array(GUIDE_REGIONS[p.slug].length).fill(0);
      for (let i = 0; i < W * H; i++) {
        if (data[i * 4 + 3] === 0) continue;
        if (owner[i] < 0) stray++;
        else inked[owner[i]]++;
      }
      expect({ slug: p.slug, stray }).toEqual({ slug: p.slug, stray: 0 });
      GUIDE_REGIONS[p.slug].forEach(({ name }, k) => {
        expect({ slug: p.slug, name, inked: inked[k] > 0 }).toEqual({ slug: p.slug, name, inked: true });
      });
    }
  });

  it("nothing is drawn inside the text-safe area except its dashed edge", async () => {
    // The estimate label used to sit inside the safe rect, the one place the
    // words go; the regions that reach into the lyric area are the rail and the
    // outline's own edges.
    for (const p of SHORT_PLATFORMS) {
      const inner = GUIDE_REGIONS[p.slug].filter((r) => ["statusBar", "navRow", "estimateNote", "captionBlock"].includes(r.name));
      const top = GUIDE_REGIONS[p.slug].find((r) => r.name === "safeTopEdge")?.rect;
      const bottom = GUIDE_REGIONS[p.slug].find((r) => r.name === "safeBottomEdge")?.rect;
      expect(top && bottom).toBeTruthy();
      for (const { name, rect: r } of inner) {
        const outside = r.y + r.h <= (top?.y ?? 0) || r.y >= (bottom?.y ?? H) + (bottom?.h ?? 0);
        expect({ slug: p.slug, name, outside }).toEqual({ slug: p.slug, name, outside: true });
      }
    }
  });
});
