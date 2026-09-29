import path from "node:path";
import type { MosaicDocument, MosaicDocumentPipeline } from "@m0saic/types";
import { FRIENDLY_SLUG_PATTERN } from "@m0saic/types";
import { validateOutputConfig } from "@m0saic/platform";
import type { ShortPlatform } from "./platforms";
import { SHORT_PLATFORMS, resolveShortPlatform } from "./platforms";
import { audioPolicy, durationAdvisory, emitForPlatforms, guideFitsCanvas, guidePng, guideTiles } from "./platform-emit";
import { GUIDE_REGIONS } from "./platform-guide-regions";

/** A minimal valid document for one platform, the way a template's build would stamp it. */
function docFor(p: ShortPlatform, durationMs: number | null = 20_000): MosaicDocument {
  return {
    kind: "mosaic_document",
    version: 1,
    m0: "1" as MosaicDocument["m0"],
    assets: {},
    sources: [{ type: "lavfi", lavfi: "color=c=#224466" }],
    size: { width: p.canvas.width, height: p.canvas.height },
    backgroundColor: "#0A0A0A",
    ...(durationMs === null ? {} : { durationMs }),
    ...audioPolicy({ multi: true }),
  };
}

const reels = resolveShortPlatform("instagram-reel");
const tiktok = resolveShortPlatform("tiktok");
const shorts = resolveShortPlatform("youtube-shorts");

describe("emitForPlatforms", () => {
  it("one platform: returns build(row) untouched, a flat document", () => {
    const seen: string[] = [];
    let built: MosaicDocument | undefined;
    const out = emitForPlatforms("tiktok", 30, (p) => {
      seen.push(p.id);
      built = docFor(p);
      return built;
    });
    expect(seen).toEqual(["tiktok"]);
    expect(out).toBe(built);
    expect(out.kind).toBe("mosaic_document");
  });

  it("an unknown knob resolves to the default platform", () => {
    const seen: string[] = [];
    emitForPlatforms("myspace" as never, 30, (p) => {
      seen.push(p.id);
      return docFor(p);
    });
    expect(seen).toEqual(["instagram-reel"]);
  });

  it('"all": an emit:"multi" pipeline, one step per platform named and labelled by slug', () => {
    const seen: string[] = [];
    const out = emitForPlatforms("all", 30, (p) => {
      seen.push(p.id);
      return docFor(p);
    }) as MosaicDocumentPipeline;

    expect(seen).toEqual(["instagram-reel", "tiktok", "youtube-shorts"]);
    expect(out.kind).toBe("mosaic_pipeline");
    expect(out.version).toBe(1);
    expect(out.emit).toBe("multi");
    expect(out.fps).toBe(30);
    expect(out).not.toHaveProperty("encodes");
    expect(out.steps.map((s) => [s.name, s.label])).toEqual([
      ["reels", "reels"],
      ["tiktok", "tiktok"],
      ["shorts", "shorts"],
    ]);
    for (const step of out.steps) {
      expect(step.name).toMatch(FRIENDLY_SLUG_PATTERN);
      expect(step.durationMs).toBe(20_000);
      expect(step.file!.size).toEqual({ width: 1080, height: 1920 });
    }
  });

  it("takes each step's length from its own file, rounded to whole ms", () => {
    const out = emitForPlatforms("all", 24, (p) =>
      docFor(p, p.slug === "tiktok" ? 200_000.4 : 180_000),
    ) as MosaicDocumentPipeline;
    expect(out.steps.map((s) => s.durationMs)).toEqual([180_000, 200_000, 180_000]);
    expect(out.fps).toBe(24);
  });

  it("throws when build leaves a step without a length (the engine would reject it)", () => {
    expect(() => emitForPlatforms("all", 30, (p) => docFor(p, null))).toThrow(/durationMs/);
    expect(() => emitForPlatforms("all", 30, (p) => docFor(p, 0))).toThrow(/durationMs/);
  });

  it("leaves fps out rather than stamping a junk rate", () => {
    const out = emitForPlatforms("all", NaN, (p) => docFor(p)) as MosaicDocumentPipeline;
    expect(out).not.toHaveProperty("fps");
  });
});

describe("audioPolicy", () => {
  const AAC_MP4 = {
    format: { kind: "video", container: "mp4" },
    audio: { mode: "auto", codec: "aac", bitrate: "320k", sampleRate: 48000, channelLayout: "stereo" },
  };

  it("defaults to MP4 with AAC 320k, 48 kHz stereo", () => {
    expect(audioPolicy({})).toEqual(AAC_MP4);
    expect(audioPolicy({ masterAudio: false, multi: false })).toEqual(AAC_MP4);
  });

  it("masterAudio on one file: MOV, ProRes 422 10-bit, 24-bit PCM", () => {
    expect(audioPolicy({ masterAudio: true })).toEqual({
      format: { kind: "video", container: "mov", videoCodec: "prores_ks", pixelFormat: "yuv422p10le" },
      audio: { mode: "auto", codec: "pcm_s24le", sampleRate: 48000, channelLayout: "stereo" },
    });
  });

  it("multi: MP4 + AAC 320k whether or not masterAudio is on (never MP4 + PCM)", () => {
    expect(audioPolicy({ multi: true })).toEqual(AAC_MP4);
    expect(audioPolicy({ masterAudio: true, multi: true })).toEqual(AAC_MP4);
    for (const masterAudio of [false, true]) {
      for (const multi of [false, true]) {
        const { format, audio } = audioPolicy({ masterAudio, multi });
        if (format.container === "mp4") expect(audio.codec).toBe("aac");
        if (audio.codec === "pcm_s24le") expect(format.container).toBe("mov");
      }
    }
  });

  it("passes the installed output-config validator with nothing to say", () => {
    for (const masterAudio of [false, true]) {
      for (const multi of [false, true]) {
        const policy = audioPolicy({ masterAudio, multi });
        const result = validateOutputConfig({ ...policy, size: { width: 1080, height: 1920 }, fps: 30 });
        expect(result).toEqual({ errors: [], warnings: [], advice: [] });
      }
    }
  });

  it("returns fresh objects, so a caller's edit cannot leak into the next file", () => {
    const a = audioPolicy({});
    a.audio.bitrate = "96k";
    a.format.container = "webm";
    expect(audioPolicy({})).toEqual(AAC_MP4);
  });
});

describe("durationAdvisory", () => {
  it("is silent at or under the limit", () => {
    expect(durationAdvisory(reels, 20_000)).toBeNull();
    expect(durationAdvisory(reels, 180_000)).toBeNull();
    expect(durationAdvisory(tiktok, 600_000)).toBeNull();
    expect(durationAdvisory(shorts, 0)).toBeNull();
  });

  it("speaks plainly once the clip is over", () => {
    expect(durationAdvisory(reels, 204_000)).toBe("Reels stop at 3:00 - this clip is 3:24.");
    expect(durationAdvisory(shorts, 204_000)).toBe("Shorts stop at 3:00 - this clip is 3:24.");
    expect(durationAdvisory(tiktok, 605_000)).toBe("TikTok stops at 10:00 - this clip is 10:05.");
  });

  it("rounds the clip up, so a clip just over never reads as equal", () => {
    expect(durationAdvisory(reels, 180_001)).toBe("Reels stop at 3:00 - this clip is 3:01.");
  });

  it("writes an hour-long clip as h:mm:ss", () => {
    expect(durationAdvisory(tiktok, 3_725_000)).toBe("TikTok stops at 10:00 - this clip is 1:02:05.");
  });

  it("ignores junk lengths", () => {
    expect(durationAdvisory(reels, NaN)).toBeNull();
    expect(durationAdvisory(reels, -1)).toBeNull();
    expect(durationAdvisory(reels, Infinity)).toBeNull();
  });

  it("keeps to ASCII", () => {
    for (const p of SHORT_PLATFORMS) {
      expect(durationAdvisory(p, 3_725_000)).toMatch(/^[\x20-\x7e]+$/);
    }
  });
});

describe("guidePng", () => {
  it("points at assets/<slug>-ui.png beside the module", () => {
    for (const p of SHORT_PLATFORMS) {
      expect(guidePng(p)).toBe(path.join(__dirname, "assets", `${p.slug}-ui.png`));
    }
  });
});

describe("guideTiles", () => {
  it("at 1080x1920 each tile sits exactly on its PNG region, in region order", () => {
    for (const p of SHORT_PLATFORMS) {
      const tiles = guideTiles(p, 1080, 1920);
      expect(tiles.map((t) => t.name)).toEqual(GUIDE_REGIONS[p.slug].map((r) => r.name));
      for (const t of tiles) expect(t.rect).toEqual(t.sourceRect);
    }
  });

  it("scales by edges, so neighbours stay flush and nothing overlaps, at any 9:16 canvas", () => {
    for (const [W, H] of [
      [540, 960],
      [720, 1280],
      [360, 640],
      [607, 1080],
      [1081, 1920],
    ]) {
      for (const p of SHORT_PLATFORMS) {
        const tiles = guideTiles(p, W, H);
        expect({ W, H, tiles: tiles.length }).toEqual({ W, H, tiles: GUIDE_REGIONS[p.slug].length });
        for (const t of tiles) {
          expect(t.rect.w).toBeGreaterThan(0);
          expect(t.rect.h).toBeGreaterThan(0);
          expect(t.rect.x + t.rect.w).toBeLessThanOrEqual(W);
          expect(t.rect.y + t.rect.h).toBeLessThanOrEqual(H);
          // The crop always stays in PNG px.
          expect(GUIDE_REGIONS[p.slug].find((r) => r.name === t.name)?.rect).toEqual(t.sourceRect);
        }
        for (let i = 0; i < tiles.length; i++) {
          for (let j = i + 1; j < tiles.length; j++) {
            const a = tiles[i].rect;
            const b = tiles[j].rect;
            expect(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h).toBe(false);
          }
        }
        // The left strip and the top edge line meet without a gap.
        const left = tiles.find((t) => t.name === "sideCropLeft");
        const top = tiles.find((t) => t.name === "safeTopEdge");
        if (left && top) expect(top.rect.x).toBe(left.rect.x + left.rect.w);
      }
    }
  });

  it("draws nothing on a canvas that is not 9:16: the phone screen would stretch and every cover crop cut its drawing", () => {
    // At 1080x1350 (4:5) a stretched status bar kept ~70 % of its height, and the
    // safe-edge line tile landed on words laid out against the 4:5 stage.
    for (const [W, H] of [
      [1080, 1350],
      [1080, 1080],
      [1920, 1080],
      [1080, 1940],
      [0, 1920],
    ]) {
      expect({ W, H, fits: guideFitsCanvas(W, H) }).toEqual({ W, H, fits: false });
      for (const p of SHORT_PLATFORMS) expect(guideTiles(p, W, H)).toEqual([]);
    }
    for (const [W, H] of [
      [1080, 1920],
      [540, 960],
      [1080, 1918],
    ]) {
      expect({ W, H, fits: guideFitsCanvas(W, H) }).toEqual({ W, H, fits: true });
    }
  });

  it("no tile covers more than a quarter of the canvas (the guide never becomes a full-frame click target)", () => {
    for (const p of SHORT_PLATFORMS) {
      for (const t of guideTiles(p, 1080, 1920)) {
        expect({ name: t.name, big: t.rect.w * t.rect.h > 0.25 * 1080 * 1920 }).toEqual({ name: t.name, big: false });
      }
    }
  });
});
