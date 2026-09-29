import type { MosaicColor, MosaicDocument, MosaicEngineContext, MosaicMediaMetadata, MosaicTimedCue } from "@m0saic/types";
import { asAssetId, asTemplateId } from "@m0saic/types";
import {
  defineMosaicTemplate,
  definePropsSchema,
  makeErrorMosaic,
  parseCueTrackValue,
  resolveOutputDurationMs,
} from "@m0saic/template-utils";

import { declareBindings } from "../../../_shared/bindings";
import { BUNDLED_FONTS, DEFAULT_FONT_ID, FONT_OPTIONS, resolveFontPath } from "../../../_shared/fonts";
import { songStartOf } from "../../../_shared/song-window";
import type { CoverImage, SongLeaf } from "./document";
import { buildCoverShardsDocument } from "./document";
import type { GridValue, ShardMotion, ShardOrder } from "./plan";
import { GRID_VALUES, SHARD_MOTIONS, SHARD_ORDERS, beatTimes, revealTiming, sourceRects } from "./plan";

/**
 * `@rainier/explore/cover-shards/v1` — the cover-art reveal: the art
 * assembles from its own tiles, each landing on a beat the artist taps, then
 * the release line rises in underneath.
 *
 * ONE CONCEPT: one image, many windows. Every shard is the SAME picture with
 * `placement.sourceRect` set to its own cell of the centred square crop (in
 * the picture's own pixels, from `ctx.media`), under `fit: "cover"`. Nothing
 * is cut or generated; the engine crops each shard as it draws it.
 *
 * - The square is laid out from `ctx.target`: under the Reels safe area on
 *   tall canvases, shrunk to fit its text at 4:5, text on a scrim at 1:1.
 * - Landing order: rows, centre out, or a `mulberry32(seed)` shuffle.
 * - Timing: shard j lands on the j-th beat tapped in Beats (timed against the
 *   whole song, moved by Song start); untapped shards spread evenly up to
 *   Reveal. The length is the reveal plus Hold, unless the host asks for one.
 * - Motion: a comma-free ramp on xExpr / yExpr (motion.ts), gated with
 *   `enable` + `window` that carry the same start.
 * - Text: glyph outlines cut from a bundled OFL face (`_shared/glyph-text`),
 *   bound with Text colour so a double-click retypes it on the canvas.
 * - No cover yet: placeholder colour shards, every one bound to `cover`, so a
 *   file dropped on any tile becomes the art. In Make, a hint says so.
 *
 * Errors: a cover that is set but unreadable (or not a picture), a song with
 * no sound, or a Song start past the song's end is an error card in a real
 * render, and the placeholder (or silence) plus a note in Make's design pass,
 * so the artist can fix it straight away. A colour that is not #rrggbb is an
 * error card in both.
 */

export type CoverShardsProps = {
  cover?: string;
  headline?: string;
  subline?: string;
  grid?: GridValue;
  order?: ShardOrder;
  motion?: ShardMotion;
  revealSec?: number;
  holdSec?: number;
  song?: string;
  songStartSec?: number;
  beats?: MosaicTimedCue[] | string;
  font?: string;
  textColor?: string;
  pageColor?: string;
  gapPx?: number;
  seed?: number;
};

export const COVER_SHARDS_ID = "@rainier/explore/cover-shards/v1";
/** Beats the studio accepts: one per shard at the biggest grid. */
export const COVER_SHARDS_MAX_BEATS = 16;
const TITLE = "Cover Shards";
const HEX = /^#[0-9a-fA-F]{6}$/;

const DEFAULTS = {
  headline: "out friday",
  subline: "Song Title",
  grid: "4" as GridValue,
  order: "shuffle" as ShardOrder,
  motion: "rise" as ShardMotion,
  revealSec: 3,
  holdSec: 3,
  songStartSec: 0,
  beats: [] as MosaicTimedCue[],
  font: DEFAULT_FONT_ID as string,
  textColor: "#FFFFFF",
  pageColor: "#0E0E10",
  gapPx: 6,
  seed: 7,
} satisfies CoverShardsProps;

const propsSchema = definePropsSchema<CoverShardsProps>({
  cover: {
    type: "media",
    required: false,
    description: "Your cover art. Square works best; anything else is centre-cropped to a square. Drop it on any tile.",
    meta: {
      control: { picker: "file", accept: ["image"] },
      ui: { label: "Cover art", order: 1, primary: true },
    },
  },
  headline: {
    type: "string",
    required: false,
    description: "The big line under the cover. Double-click it on the canvas to retype.",
    meta: {
      control: { placeholder: DEFAULTS.headline },
      ui: { label: "Headline", order: 2, primary: true },
    },
  },
  subline: {
    type: "string",
    required: false,
    description: "The smaller line under the headline. Leave empty to hide it.",
    meta: {
      control: { placeholder: DEFAULTS.subline },
      ui: { label: "Subline", order: 3, primary: true },
    },
  },
  grid: {
    type: "string",
    required: false,
    description: "How many shards per side: 2 (4 shards), 3 (9 shards) or 4 (16 shards).",
    meta: {
      constraints: { oneOf: [...GRID_VALUES] },
      control: {
        options: [
          { value: "2", label: "2 x 2" },
          { value: "3", label: "3 x 3" },
          { value: "4", label: "4 x 4" },
        ],
      },
      ui: { label: "Grid", order: 4 },
    },
  },
  order: {
    type: "string",
    required: false,
    description: "Which shard lands first: shuffled, row by row from the top, or from the centre out.",
    meta: {
      constraints: { oneOf: [...SHARD_ORDERS] },
      control: {
        options: [
          { value: "shuffle", label: "Shuffle" },
          { value: "rows", label: "Row by row" },
          { value: "center", label: "Centre out" },
        ],
      },
      ui: { label: "Order", order: 5 },
    },
  },
  motion: {
    type: "string",
    required: false,
    description:
      "How a shard arrives: rises from one tile below, slides in from one tile to the right, floats up as it fades in, or just fades in.",
    meta: {
      constraints: { oneOf: [...SHARD_MOTIONS] },
      control: {
        options: [
          { value: "rise", label: "Rise" },
          { value: "slide", label: "Slide" },
          { value: "float", label: "Float" },
          { value: "fade", label: "Fade" },
        ],
      },
      ui: { label: "Motion", order: 6 },
    },
  },
  revealSec: {
    type: "number",
    required: false,
    description: "How long the cover takes to assemble when no beats are tapped, in seconds.",
    meta: {
      constraints: { min: 1, max: 10 },
      control: { flavor: "slider", step: 0.1 },
      ui: { label: "Reveal (s)", order: 7 },
    },
  },
  holdSec: {
    type: "number",
    required: false,
    description: "How long the finished cover stays on screen, in seconds.",
    meta: {
      constraints: { min: 0, max: 20 },
      control: { flavor: "slider", step: 0.1 },
      ui: { label: "Hold (s)", order: 8 },
    },
  },
  song: {
    type: "media",
    required: false,
    description: "Optional: the song under the reveal (the master WAV is fine).",
    meta: {
      control: { picker: "file", accept: ["audio", "video"] },
      ui: { label: "Song", order: 9 },
    },
  },
  songStartSec: {
    type: "number",
    required: false,
    description:
      "Where in the song the reveal starts, in seconds. Beats are tapped against the whole song; beats before this point are dropped.",
    meta: {
      constraints: { min: 0, max: 600 },
      control: { step: 0.05 },
      ui: { label: "Song start (s)", order: 10 },
    },
  },
  beats: {
    type: "json",
    required: false,
    description:
      "Optional beat taps. Type one line per shard (any text: 1, 2, 3...), open Beats, play the song and tap Space on each beat: " +
      "the first shard lands on the first beat, the second on the second. Shards you do not tap spread evenly over the reveal.",
    meta: {
      constraints: {
        jsonSchema: {
          type: "array",
          maxItems: COVER_SHARDS_MAX_BEATS,
          items: {
            type: "object",
            required: ["text"],
            properties: {
              text: { type: "string" },
              startMs: { type: "integer", minimum: 0 },
              endMs: { type: "integer", minimum: 1 },
            },
          },
        },
      },
      control: {
        picker: "cue-track",
        cueTrack: {
          mediaFromProp: "song",
          maxCues: COVER_SHARDS_MAX_BEATS,
          vocabulary: {
            item: "beat",
            media: "song",
            pasteHint: "One line per shard (any text: 1, 2, 3...). Tap Space on each beat; shard N lands on beat N.",
          },
        },
      },
      ui: { label: "Beats", order: 11 },
    },
  },
  font: {
    type: "string",
    required: false,
    description: "The typeface for both lines. Every choice is bundled and free to use.",
    meta: {
      constraints: { oneOf: BUNDLED_FONTS.map((f) => f.id) },
      control: { options: FONT_OPTIONS },
      ui: { label: "Font", order: 12 },
    },
  },
  textColor: {
    type: "string",
    required: false,
    description: "Colour of the headline and the subline.",
    meta: {
      constraints: { isColor: true },
      control: { colorPicker: true, defaultColor: DEFAULTS.textColor },
      ui: { label: "Text colour", order: 13 },
    },
  },
  pageColor: {
    type: "string",
    required: false,
    description: "The page behind everything, which also shows in the thin gaps between the shards.",
    meta: {
      constraints: { isColor: true },
      control: { colorPicker: true, defaultColor: DEFAULTS.pageColor },
      ui: { label: "Page colour", order: 14 },
    },
  },
  gapPx: {
    type: "number",
    required: false,
    description: "The gap between shards, in pixels on a 1080-wide canvas (it scales with the canvas). 0 = no gap.",
    meta: {
      constraints: { min: 0, max: 24 },
      control: { flavor: "slider", step: 1 },
      ui: { label: "Gap", order: 15 },
    },
  },
  seed: {
    type: "number",
    required: false,
    description: "Change it for a different shuffle. The same seed always gives the same order.",
    meta: {
      constraints: { min: 0, max: 9999 },
      control: { step: 1 },
      ui: { label: "Shuffle seed", order: 16, visibleWhen: { prop: "order", equals: "shuffle" } },
    },
  },
});

export type CoverShardsKnobs = {
  n: number;
  order: ShardOrder;
  motion: ShardMotion;
  revealSec: number;
  holdSec: number;
  songStartSec: number;
  gapPx: number;
  seed: number;
};

const num = (value: unknown, fallback: number, min: number, max: number): number =>
  typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;

const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(String(value) as T) ? (String(value) as T) : fallback;

/** Clamp the knobs into range. Never throws: an unknown value takes the default. */
export function resolveCoverShardsKnobs(props: CoverShardsProps): CoverShardsKnobs {
  return {
    n: Number(pick(props.grid, GRID_VALUES, DEFAULTS.grid)),
    order: pick(props.order, SHARD_ORDERS, DEFAULTS.order),
    motion: pick(props.motion, SHARD_MOTIONS, DEFAULTS.motion),
    revealSec: num(props.revealSec, DEFAULTS.revealSec, 1, 10),
    holdSec: num(props.holdSec, DEFAULTS.holdSec, 0, 20),
    songStartSec: num(props.songStartSec, DEFAULTS.songStartSec, 0, 600),
    gapPx: Math.round(num(props.gapPx, DEFAULTS.gapPx, 0, 24)),
    seed: Math.round(num(props.seed, DEFAULTS.seed, 0, 9999)),
  };
}

const mediaPath = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;

/** An absent or blank beats value is "no beats yet", not a parse error. */
const beatsValue = (value: unknown): unknown =>
  value === undefined || value === null || (typeof value === "string" && value.trim() === "") ? [] : value;

/** The file name alone, shortened, ASCII (it is drawn with the bundled font and shown in notes). */
function shownName(p: string): string {
  const parts = p.split(/[\\/]/);
  const name = (parts[parts.length - 1] || p).replace(/[^\x20-\x7E]/g, "?");
  return name.length > 36 ? `${name.slice(0, 33)}...` : name;
}

/** A #rrggbb colour; absent or blank = the default; anything else = null (the caller shows an error card). */
function colorOf(value: unknown, fallback: string): MosaicColor | null {
  const v = value === undefined || value === null || (typeof value === "string" && value.trim() === "") ? fallback : value;
  return typeof v === "string" && HEX.test(v.trim()) ? (v.trim() as MosaicColor) : null;
}

function mediaMeta(ctx: MosaicEngineContext, raw: string, trimmed: string): MosaicMediaMetadata | undefined {
  return ctx.media?.[asAssetId(raw)] ?? ctx.media?.[asAssetId(trimmed)];
}

export const CoverShardsV1 = defineMosaicTemplate<CoverShardsProps>({
  id: asTemplateId(COVER_SHARDS_ID),
  label: "05 · Cover Shards",
  version: 1,
  description:
    "Your cover art assembles from its own tiles, each landing on a beat you tap, then your release line rises in underneath. 1080x1920, about 6 seconds.",
  capabilities: { tier: "core" },
  tags: ["explore", "cover", "release", "experiment", "music", "musicians", "creators", "vertical", "animated"],

  outputHints: {
    width: 1080,
    height: 1920,
    fps: 30,
    durationMs: 6000,
    posterTimeMs: 5000,
    format: { kind: "video", container: "mp4" },
    note: "About 6 s at the defaults: the reveal, then the hold. Tapped beats past the reveal make it longer. Also right at 1080x1350 and 1080x1080.",
  },

  propsSchema,
  defaultProps: { ...DEFAULTS, beats: [] },

  // The 0.3.0 roll call. Bound: cover (every shard), headline + subline (their
  // tiles, with textColor). pageColor IS document.backgroundColor. Closed sets
  // (grid, order, motion, font) never count. The rest have no rect:
  ...declareBindings({
    revealSec: "timing",
    holdSec: "timing",
    song: "audio: an audio leaf has no pointer surface",
    songStartSec: "timing",
    beats: "timing, tapped in the studio",
    gapPx: "geometry",
    seed: "determinism",
  }),

  async render(rawProps: CoverShardsProps, ctx: MosaicEngineContext): Promise<MosaicDocument> {
    const props: CoverShardsProps = { ...DEFAULTS, ...(rawProps ?? {}) };
    const { width: W, height: H, fps } = ctx.target;
    const design = ctx.mode === "design";
    const fail = (message: string) => makeErrorMosaic(message, { width: W, height: H, title: TITLE });
    const knobs = resolveCoverShardsKnobs(props);
    const N = knobs.n * knobs.n;

    const textColor = colorOf(props.textColor, DEFAULTS.textColor);
    const pageColor = colorOf(props.pageColor, DEFAULTS.pageColor);
    if (textColor === null) return fail("Text colour must be a colour like #FFFFFF.");
    if (pageColor === null) return fail("Page colour must be a colour like #0E0E10.");
    const fontPath = resolveFontPath({ font: typeof props.font === "string" ? props.font : DEFAULTS.font }).path;
    const notes: string[] = [];

    // Beats: timed against the whole song, moved onto the clip by Song start.
    let taps: number[] = [];
    const parsed = parseCueTrackValue(beatsValue(props.beats));
    if (!parsed.ok) {
      const message = "The beats could not be read. Open Beats and tap them again.";
      if (!design) return fail(`${message} (${parsed.error})`);
      notes.push(message);
    } else {
      taps = beatTimes(parsed.cues, knobs.songStartSec);
    }

    // The cover: a probed picture, or the placeholder.
    let cover: CoverImage | undefined;
    const coverRaw = typeof props.cover === "string" ? props.cover : "";
    const coverPath = mediaPath(coverRaw);
    if (coverPath) {
      const name = shownName(coverPath);
      const meta = mediaMeta(ctx, coverRaw, coverPath);
      let problem: string | undefined;
      if (!meta) problem = `Could not read "${name}". Drop a picture (a jpg or png) on any tile.`;
      else if (meta.kind !== "image") problem = `"${name}" is not a picture (it reads as ${meta.kind}). Drop a jpg or png on any tile.`;
      else if (!(meta.width > 0 && meta.height > 0) || sourceRects(meta.width, meta.height, knobs.n) === null) {
        problem = `"${name}" is too small to split. Use a picture at least a few hundred pixels wide.`;
      }
      if (problem) {
        if (!design) return fail(problem);
        notes.unshift(problem);
      } else if (meta) {
        cover = { path: coverPath, width: meta.width, height: meta.height };
      }
    } else if (design) {
      notes.unshift("Drop your cover art on any tile");
    }

    // The song: an audio-only leaf, trimmed to Song start. An unprobed song
    // still plays (the host probes before a real render); a probed one must
    // have sound, and Song start must fall inside it.
    let song: SongLeaf | undefined;
    const songRaw = typeof props.song === "string" ? props.song : "";
    const songPath = mediaPath(songRaw);
    if (songPath) {
      const name = shownName(songPath);
      const meta = mediaMeta(ctx, songRaw, songPath);
      const clipStartMs = songStartOf(knobs.songStartSec * 1000);
      let problem: string | undefined;
      if (meta && meta.hasAudio === false) problem = `"${name}" has no sound. Pick the song (a wav, an mp3, or a video with sound).`;
      else if (meta && typeof meta.durationMs === "number" && meta.durationMs > 0 && clipStartMs >= meta.durationMs) {
        problem = `Song start (${knobs.songStartSec} s) is past the end of "${name}" (${Math.floor(meta.durationMs / 1000)} s).`;
      }
      if (problem) {
        if (!design) return fail(problem);
        notes.push(problem);
      } else {
        song = { path: songPath, mediaType: meta?.kind === "video" ? "video" : "audio", clipStartMs };
      }
    }

    const timing = revealTiming(N, taps, knobs.revealSec);
    const durationMs = resolveOutputDurationMs(ctx, { naturalMs: (timing.revealEnd + knobs.holdSec) * 1000 });

    return buildCoverShardsDocument({
      W,
      H,
      fps,
      durationMs,
      n: knobs.n,
      order: knobs.order,
      motion: knobs.motion,
      seed: knobs.seed,
      gapPx: knobs.gapPx,
      timing,
      headline: typeof props.headline === "string" ? props.headline : "",
      subline: typeof props.subline === "string" ? props.subline : "",
      fontPath,
      textColor,
      pageColor,
      cover,
      song,
      ...(design && notes.length > 0 ? { note: notes[0] } : {}),
    });
  },
});

export default CoverShardsV1;
