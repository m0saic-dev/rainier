import path from "node:path";

import type {
  MosaicColor,
  MosaicDocument,
  MosaicEngineContext,
  MosaicTimedCue,
} from "@m0saic/types";
import { asAssetId, asTemplateId } from "@m0saic/types";
import {
  defineMosaicTemplate,
  definePropsSchema,
  determineMediaType,
  makeErrorMosaic,
  parseCueTrackValue,
  resolveOutputDurationMs,
} from "@m0saic/template-utils";

import type { Row, TriptychStyle, WordEntrance } from "./document";
import { buildTriptych } from "./document";
import { resolvePages } from "./pages";
import type { TextAlign } from "./typeset";

/**
 * `@rainier/reels/lyric-triptych/v1` — three stacked clips, your song, and
 * lyrics that land word by word as you sing them.
 *
 * ONE CONCEPT: a lyric page is two timings. The PAGE says when a block of
 * words takes the screen and when it clears; the WORDS say when each one
 * appears inside it. Both come from the Cue Timing Studio on the Lyrics
 * field: the tap pass stamps pages (Space as each page starts), the word
 * pass stamps words (hold Space per word). Nothing has to be timed for the
 * render to work: untimed pages spread over the song and untimed words
 * cascade in by length, and every tap replaces a guess.
 *
 * The rule that bites: every word is its own drawtext layer, so the template
 * must know exactly how wide each word renders. It measures with committed
 * Helvetica Neue metrics (tools/bake-font-metrics.mjs) — the font macOS
 * ships and drawtext draws. On a machine without Helvetica Neue the words
 * still show, but the spacing drifts.
 *
 * "Show Instagram UI" lays the Reels viewer chrome over the render (baked by
 * tools/bake-reels-ui.mjs) so you can see what the buttons and caption will
 * cover while you edit. It is baked INTO the video — turn it off to export.
 */

export type LyricTriptychProps = {
  song?: string;
  lyrics?: MosaicTimedCue[] | string;
  topClip?: string;
  middleClip?: string;
  bottomClip?: string;
  showReelsUi?: boolean;
  lyricsRow?: "top" | "middle" | "bottom";
  textAlign?: TextAlign;
  wordEntrance?: WordEntrance;
  textSize?: number;
  textColor?: string;
  glow?: number;
  glowColor?: string;
  borderPx?: number;
  borderColor?: string;
  outerBorder?: boolean;
  topTrimSec?: number;
  middleTrimSec?: number;
  bottomTrimSec?: number;
  topFraming?: number;
  middleFraming?: number;
  bottomFraming?: number;
};

const ID = "@rainier/reels/lyric-triptych/v1";
export const MAX_PAGES = 300;
const HEX = /^#[0-9a-fA-F]{6}$/;

/** The baked Reels chrome, shipped beside this file (src/ and dist/ alike). */
export const REELS_UI_PNG = path.join(__dirname, "assets", "reels-ui.png");

/**
 * Placeholder lyrics: generic on purpose (this repo is public), and they
 * double as the instructions. One entry = one page.
 */
export const DEFAULT_LYRICS: MosaicTimedCue[] = [
  { text: "paste your lyrics here one page at a time" },
  { text: "each page holds the screen until the next" },
  { text: "tap the pages in time with your song" },
  { text: "then tap every word as you sing it" },
  { text: "and watch them land on the beat" },
];

const ROW_NAMES = ["top", "middle", "bottom"] as const;
/** Placeholder panels (no clip yet): three quiet tones, one per row. */
const PLACEHOLDER_COLORS = ["#2A2238", "#1D2733", "#332228"] as const;

const DEFAULTS = {
  lyrics: DEFAULT_LYRICS,
  showReelsUi: false,
  lyricsRow: "middle",
  textAlign: "justify",
  wordEntrance: "rise",
  textSize: 1,
  textColor: "#FFFFFF",
  glow: 0.6,
  glowColor: "#FFFFFF",
  borderPx: 6,
  borderColor: "#0A0A0A",
  outerBorder: false,
  topTrimSec: 0,
  middleTrimSec: 0,
  bottomTrimSec: 0,
  topFraming: 0.5,
  middleFraming: 0.5,
  bottomFraming: 0.5,
} satisfies LyricTriptychProps;

const title = (row: string) => `${row[0].toUpperCase()}${row.slice(1)}`;

const clipProp = (row: string, order: number) => ({
  type: "media" as const,
  required: false,
  description: `The ${row} row's clip (video or photo), cropped to fill the row. Empty = a placeholder panel.`,
  meta: {
    control: { picker: "file" as const, accept: ["video" as const, "image" as const] },
    ui: { label: `${title(row)} clip`, order, primary: true },
  },
});

const trimProp = (row: string, order: number) => ({
  type: "number" as const,
  required: false,
  description:
    `Skip this many seconds at the start of the ${row} clip, so the moment you want lines up with the song's start. ` +
    "Use it to sync takes that started recording at different times.",
  meta: {
    constraints: { min: 0, max: 600 },
    control: { step: 0.05 },
    ui: { label: `${title(row)} clip: trim start (s)`, order },
  },
});

const framingProp = (row: string, order: number) => ({
  type: "number" as const,
  required: false,
  description:
    `Which part of the ${row} clip stays in view when it is cropped to the row: 0 keeps the top, 0.5 the middle, 1 the bottom.`,
  meta: {
    constraints: { min: 0, max: 1 },
    control: { flavor: "slider" as const, step: 0.05 },
    ui: { label: `${title(row)} clip: framing (top → bottom)`, order },
  },
});

const propsSchema = definePropsSchema<LyricTriptychProps>({
  song: {
    type: "media",
    required: false,
    description:
      "The song (audio file, or a video whose sound you want). The video runs as long as the song, and the Lyrics timing studio plays it.",
    meta: {
      control: { picker: "file", accept: ["audio", "video"] },
      ui: { label: "Song", order: 1, primary: true },
    },
  },
  lyrics: {
    type: "json",
    required: false,
    description:
      "Your lyrics as PAGES: one entry per block of words that shares the screen before it clears. " +
      "Open the timing studio: the tap pass stamps when each page starts, the word pass stamps each word. " +
      "Untimed pages spread over the song and untimed words cascade in, so you can time as much or as little as you like. " +
      "A page written in [brackets] is a pause: the screen clears.",
    meta: {
      constraints: {
        jsonSchema: {
          type: "array",
          maxItems: MAX_PAGES,
          items: {
            type: "object",
            required: ["text"],
            properties: {
              text: { type: "string", minLength: 1 },
              startMs: { type: "integer", minimum: 0 },
              endMs: { type: "integer", minimum: 0 },
            },
          },
        },
      },
      control: {
        picker: "cue-track",
        cueTrack: {
          mediaFromProp: "song",
          maxCues: MAX_PAGES,
          wordTiming: true,
          vocabulary: {
            item: "page",
            collection: "lyrics",
            media: "song",
            pasteHint: "One page per line: the words that share the screen before it clears.",
            beatLabel: "[break]",
          },
        },
      },
      ui: { label: "Lyrics", order: 2, primary: true },
    },
  },
  topClip: clipProp("top", 3),
  middleClip: clipProp("middle", 4),
  bottomClip: clipProp("bottom", 5),
  showReelsUi: {
    type: "boolean",
    required: false,
    description:
      "Lay Instagram's Reels screen (status bar, buttons, caption, the strips a tall phone crops) over the video, so you can see what it will cover. " +
      "An editing guide: it is drawn INTO the render, so turn it off before you export.",
    meta: { ui: { label: "Show Instagram UI (guide)", order: 6, primary: true } },
  },
  lyricsRow: {
    type: "string",
    required: false,
    description: "Which row carries the lyrics.",
    meta: { constraints: { oneOf: ["top", "middle", "bottom"] }, ui: { label: "Lyrics row", order: 7 } },
  },
  textAlign: {
    type: "string",
    required: false,
    description:
      "justify: every line runs edge to edge (a lone word sits left). left / center: natural word spacing.",
    meta: { constraints: { oneOf: ["justify", "left", "center"] }, ui: { label: "Text alignment", order: 8 } },
  },
  wordEntrance: {
    type: "string",
    required: false,
    description: "How each word arrives: rise (fades up into place), fade, or instant.",
    meta: { constraints: { oneOf: ["rise", "fade", "instant"] }, ui: { label: "Word entrance", order: 9 } },
  },
  textSize: {
    type: "number",
    required: false,
    description: "Lyric size. A page too long for the row shrinks on its own.",
    meta: {
      constraints: { min: 0.5, max: 1.5 },
      control: { flavor: "slider", step: 0.05 },
      ui: { label: "Text size", order: 10 },
    },
  },
  textColor: {
    type: "string",
    required: false,
    description: "Lyric colour.",
    meta: {
      constraints: { isColor: true },
      control: { colorPicker: true, defaultColor: DEFAULTS.textColor },
      ui: { label: "Text colour", order: 11 },
    },
  },
  glow: {
    type: "number",
    required: false,
    description: "Soft glow around the words. 0 = none.",
    meta: {
      constraints: { min: 0, max: 1 },
      control: { flavor: "slider", step: 0.05 },
      ui: { label: "Glow", order: 12 },
    },
  },
  glowColor: {
    type: "string",
    required: false,
    description: "Glow colour. White reads as a halo; black turns it into a soft shadow for bright footage.",
    meta: {
      constraints: { isColor: true },
      control: { colorPicker: true, defaultColor: DEFAULTS.glowColor },
      ui: { label: "Glow colour", order: 13 },
    },
  },
  borderPx: {
    type: "number",
    required: false,
    description: "Border between the rows, in pixels. 0 = the rows touch.",
    meta: {
      constraints: { min: 0, max: 40 },
      control: { flavor: "slider", step: 1 },
      ui: { label: "Border (px)", order: 14 },
    },
  },
  borderColor: {
    type: "string",
    required: false,
    description: "Border colour.",
    meta: {
      constraints: { isColor: true },
      control: { colorPicker: true, defaultColor: DEFAULTS.borderColor },
      ui: { label: "Border colour", order: 15 },
    },
  },
  outerBorder: {
    type: "boolean",
    required: false,
    description: "Also draw the border around the outside edges.",
    meta: { ui: { label: "Border around the edges", order: 16 } },
  },
  topTrimSec: trimProp("top", 17),
  middleTrimSec: trimProp("middle", 18),
  bottomTrimSec: trimProp("bottom", 19),
  topFraming: framingProp("top", 20),
  middleFraming: framingProp("middle", 21),
  bottomFraming: framingProp("bottom", 22),
});

const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;

const num = (value: unknown, fallback: number, min: number, max: number): number =>
  typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;

const color = (value: unknown, fallback: string, name: string): MosaicColor => {
  if (value === undefined || value === "") return fallback as MosaicColor;
  if (typeof value !== "string" || !HEX.test(value)) {
    throw new Error(`${ID}: ${name} ${JSON.stringify(value)} must be #rrggbb.`);
  }
  return value as MosaicColor;
};

const mediaPath = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;

export const LyricTriptychV1 = defineMosaicTemplate<LyricTriptychProps>({
  id: asTemplateId(ID),
  label: "02 · Lyric Triptych",
  version: 1,
  description:
    "Three stacked video rows, your song, and word-by-word lyrics: tap each page of lyrics in time, then each word, and the words appear as you sing them. With an Instagram UI guide to see what the buttons cover.",
  capabilities: { tier: "core" },
  tags: ["reels", "music", "lyrics", "musicians", "creators", "instagram", "tiktok", "vertical", "animated"],

  outputHints: {
    width: 1080,
    height: 1920,
    fps: 30,
    durationMs: 12_000,
    format: { kind: "video", container: "mp4" },
    note: "A 9:16 Reel. With a song picked, the video runs as long as the song.",
  },

  propsSchema,
  defaultProps: { ...DEFAULTS, lyrics: DEFAULT_LYRICS.map((c) => ({ ...c })) },

  async render(rawProps: LyricTriptychProps, ctx: MosaicEngineContext): Promise<MosaicDocument> {
    const props: LyricTriptychProps = { ...DEFAULTS, ...(rawProps ?? {}) };
    const { width: W, height: H, fps } = ctx.target;
    const fail = (message: string) => makeErrorMosaic(message, { width: W, height: H, title: "Lyric Triptych" });

    const parsed = parseCueTrackValue(props.lyrics);
    if (!parsed.ok) return fail(`Lyrics did not parse: ${parsed.error}`);
    if (parsed.cues.length > MAX_PAGES) {
      return fail(`Too many lyric pages (${parsed.cues.length}; the limit is ${MAX_PAGES}).`);
    }

    const metaOf = (p: string) => ctx.media?.[asAssetId(p)];
    const songPath = mediaPath(props.song);
    const clipPaths = [props.topClip, props.middleClip, props.bottomClip].map(mediaPath);
    const clipKinds = clipPaths.map((p) =>
      p ? (determineMediaType(p, ctx) === "image" ? ("image" as const) : ("video" as const)) : undefined,
    );

    // Length: an explicit ask wins, then the song, then the longest clip,
    // then the host's target.
    const songMs = songPath ? metaOf(songPath)?.durationMs : undefined;
    const clipMs = clipPaths
      .map((p, i) => (p && clipKinds[i] === "video" ? metaOf(p)?.durationMs : undefined))
      .filter((d): d is number => typeof d === "number" && d > 0);
    const naturalMs =
      typeof songMs === "number" && songMs > 0 ? songMs : clipMs.length > 0 ? Math.max(...clipMs) : undefined;
    const durationMs = resolveOutputDurationMs(ctx, { naturalMs });

    const trims = [props.topTrimSec, props.middleTrimSec, props.bottomTrimSec];
    const framings = [props.topFraming, props.middleFraming, props.bottomFraming];
    const rows = ROW_NAMES.map((name, i): Row => {
      const p = clipPaths[i];
      const kind = clipKinds[i];
      return {
        ...(p && kind ? { clip: { path: p, mediaType: kind, durationMs: metaOf(p)?.durationMs } } : {}),
        trimStartMs: Math.round(num(trims[i], 0, 0, 600) * 1000),
        focusY: num(framings[i], 0.5, 0, 1),
        placeholder: { color: PLACEHOLDER_COLORS[i] as MosaicColor, label: `${name} clip · pick a video` },
      };
    }) as [Row, Row, Row];

    const style: TriptychStyle = {
      lyricRow: ROW_NAMES.indexOf(pick(props.lyricsRow, ROW_NAMES, "middle")) as 0 | 1 | 2,
      align: pick(props.textAlign, ["justify", "left", "center"] as const, "justify"),
      entrance: pick(props.wordEntrance, ["rise", "fade", "instant"] as const, "rise"),
      textScale: num(props.textSize, 1, 0.5, 1.5),
      textColor: color(props.textColor, DEFAULTS.textColor, "textColor"),
      glow: num(props.glow, DEFAULTS.glow, 0, 1),
      glowColor: color(props.glowColor, DEFAULTS.glowColor, "glowColor"),
      borderPx: Math.round(num(props.borderPx, DEFAULTS.borderPx, 0, 40)),
      borderColor: color(props.borderColor, DEFAULTS.borderColor, "borderColor"),
      outerBorder: props.outerBorder === true,
    };

    return buildTriptych({
      canvasW: W,
      canvasH: H,
      fps,
      durationMs,
      rows,
      pages: resolvePages(parsed.cues, durationMs),
      style,
      ...(songPath ? { song: { path: songPath, mediaType: determineMediaType(songPath, ctx) } } : {}),
      ...(props.showReelsUi === true ? { reelsUiPath: REELS_UI_PNG } : {}),
    }).doc;
  },
});

export default LyricTriptychV1;
