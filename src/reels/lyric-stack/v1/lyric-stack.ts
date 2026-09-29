import path from "node:path";

import type {
  MosaicColor,
  MosaicDocument,
  MosaicDocumentPipeline,
  MosaicEngineContext,
  MosaicTemplateOutputHints,
  MosaicTemplatePropDefinition,
  MosaicTimedCue,
} from "@m0saic/types";
import { asAssetId, asTemplateId } from "@m0saic/types";
import {
  defineMosaicTemplate,
  definePropsSchema,
  determineMediaType,
  makeErrorMosaic,
  parseCueTrackValue,
  parseRegionsValue,
  resolveOutputDurationMs,
  resolveRegionsToPx,
} from "@m0saic/template-utils";

import { declareBindings } from "../../../_shared/bindings";
import { DEFAULT_FONT_ID, FONT_FILE_EXTENSIONS, FONT_OPTIONS, resolveFontPath } from "../../../_shared/fonts";
import type { Rect, TextAlign } from "../../../_shared/glyph-text";
import { fontError } from "../../../_shared/glyph-text";
import { audioPolicy, durationAdvisory, emitForPlatforms, guideFitsCanvas, guidePng, guideTiles } from "../../../_shared/platform-emit";
import type { PlatformKnob } from "../../../_shared/platform-emit";
import type { ShortPlatform, ShortPlatformId } from "../../../_shared/platforms";
import {
  DEFAULT_SHORT_PLATFORM,
  SHORT_PLATFORM_IDS,
  SHORT_PLATFORM_OPTIONS,
  isShortPlatformId,
  platformStage,
} from "../../../_shared/platforms";
import { songStartOf, windowPages } from "../../../_shared/song-window";
import type { LyricPosition, TakeLayout } from "../../../_shared/stage-layout";
import { LYRIC_POSITIONS, TAKE_LAYOUTS, layoutTakes, lyricBox } from "../../../_shared/stage-layout";

import { nameChar } from "./advisory";
import type { StackPage, TakeSlot } from "./document";
import { WORD_BOXES_PROP, buildLyricStack, glowSigma } from "./document";
import { applyWordBoxes, layoutPage } from "./layout";
import { hasTimedPage, resolvePages } from "./pages";
import type { LyricPage } from "./pages";
import type { RevealMode, WordEntrance } from "./reveal";
import { REVEAL_MODES, RISE_EM, WORD_ENTRANCES, isShown, revealWindows } from "./reveal";

/**
 * `@rainier/reels/lyric-stack/v1`: your takes stacked on screen, your song
 * under them, and your lyrics landing word by word in the font you pick.
 *
 * ONE CONCEPT: the LYRIC BANK. Lyrics are timed ONCE, against the whole song,
 * in the Cue Timing Studio (tap pass per page, word pass per word). Every clip
 * then says where in the song it begins (`songStartSec`); the template moves
 * the timings onto the clip and drops what the clip cannot show. Untimed
 * lyrics spread over the clip instead.
 *
 * WORDS ARE GLYPH OUTLINES from a real font file (a bundled face, or the
 * artist's own .ttf / .otf / .woff), one masked colour tile per word, so the
 * Make preview and the export draw the same thing and every word is its own
 * rect: drag it anywhere on the canvas, resize it to grow it (it stays
 * centred). Words live in nested page children (at most 19 per child) because
 * the engine drops masks past ~25 timed overlays on one node.
 *
 * WORD POSITIONS ARE PER CLIP. `wordBoxes` holds one box per word the clip
 * DRAWS, in reading order (slot 0 = the first word on screen in this clip,
 * whatever its place in the whole song). Make seeds a rect list densely from
 * element 0 and stops at the first element with no tile, so slots must run
 * 0..n-1 with no gap: bound by the word's global index, a clip starting
 * mid-song bound [4..15] and a drag wrote a one-element list. A list whose
 * length is not the clip's word count is ignored, with a design note (the
 * words on screen changed: the lyrics, Song start or the clip's length).
 *
 * Guides (the platform's UI, duration and font advisories) are drawn only in
 * Make's design preview (`ctx.mode === "design"`), never into an export, and
 * none of them covers the canvas: the guide is one tile per region of the
 * platform's chrome (9:16 canvases only), the advisory a strip at the top of
 * the safe area, both UNDER the lyrics; and each lyric container hugs its
 * words (document.ts, NOTHING FULL-FRAME TAKES THE POINTER).
 */

export type LyricStackProps = {
  song?: string;
  lyrics?: MosaicTimedCue[] | string;
  songStartSec?: number;
  takeCount?: string;
  take1?: string;
  take2?: string;
  take3?: string;
  take4?: string;
  font?: string;
  fontFile?: string;
  textSize?: number;
  textColor?: string;
  textAlign?: TextAlign;
  reveal?: RevealMode;
  wordEntrance?: WordEntrance;
  lyricsPosition?: LyricPosition;
  layout?: TakeLayout;
  wordBoxes?: unknown;
  glow?: number;
  glowColor?: string;
  borderPx?: number;
  borderColor?: string;
  platform?: ShortPlatformId;
  exportAll?: boolean;
  masterAudio?: boolean;
  showGuide?: boolean;
  take1TrimSec?: number;
  take2TrimSec?: number;
  take3TrimSec?: number;
  take4TrimSec?: number;
  take1Framing?: number;
  take2Framing?: number;
  take3Framing?: number;
  take4Framing?: number;
};

const ID = "@rainier/reels/lyric-stack/v1";
export const LYRIC_STACK_ID = ID;
/** The cue-track cap (pages). */
export const LYRIC_STACK_MAX_PAGES = 300;
/** Base type size as a fraction of canvas width (119 px on a 1080-wide Reel), times Text size. */
export const FONT_FRACTION_OF_W = 0.11;
/** `word` mode: a lone word grows to at most this multiple of the base size. */
export const SOLO_MAX_SCALE = 1.6;
/** Padding around every word tile, in ems of the base size. */
export const WORD_PAD_EM = 0.04;
const HEX = /^#[0-9a-fA-F]{6}$/;

/** The transparent PNG every page child carries as a corner tile under its words (src/ and dist/ alike). */
export const CLEAR_PNG = path.join(__dirname, "assets", "clear.png");

/**
 * Placeholder lyrics: generic on purpose (this repo is public), and they
 * double as the instructions. One entry = one page.
 */
export const LYRIC_STACK_DEFAULT_LYRICS: MosaicTimedCue[] = [
  { text: "type your lyrics here one page per line" },
  { text: "each page stays up until the next one starts" },
  { text: "time the pages once against your whole song" },
  { text: "then set song start for every clip you cut" },
  { text: "drag any word to move it anywhere you like" },
];

const TAKE_COUNTS = ["1", "2", "3", "4"] as const;
/** Placeholder panels (no clip yet): four quiet tones, one per take. */
const PLACEHOLDER_COLORS = ["#2A2238", "#1D2733", "#332228", "#23302A"] as const;

const DEFAULTS = {
  lyrics: LYRIC_STACK_DEFAULT_LYRICS,
  songStartSec: 0,
  takeCount: "3",
  font: DEFAULT_FONT_ID,
  textSize: 1,
  textColor: "#FFFFFF",
  textAlign: "center",
  reveal: "cumulative",
  wordEntrance: "rise",
  lyricsPosition: "middle",
  layout: "auto",
  glow: 0.5,
  glowColor: "#FFFFFF",
  borderPx: 6,
  borderColor: "#0A0A0A",
  platform: DEFAULT_SHORT_PLATFORM,
  exportAll: false,
  masterAudio: false,
  showGuide: true,
  take1TrimSec: 0,
  take2TrimSec: 0,
  take3TrimSec: 0,
  take4TrimSec: 0,
  take1Framing: 0.5,
  take2Framing: 0.5,
  take3Framing: 0.5,
  take4Framing: 0.5,
} satisfies LyricStackProps;

const TAKE4_NOTE = " Used when Takes = 4.";

/** Dropdown labels: the panel shows these, never the raw values. */
const TEXT_ALIGN_VALUES = ["center", "justify", "left"] as const satisfies readonly TextAlign[];
const TEXT_ALIGN_LABELS: Record<(typeof TEXT_ALIGN_VALUES)[number], string> = {
  center: "Centred",
  justify: "Edge to edge",
  left: "Left",
};
const REVEAL_LABELS: Record<RevealMode, string> = {
  cumulative: "Words build up",
  word: "One word at a time",
  line: "Line by line",
};
const ENTRANCE_LABELS: Record<WordEntrance, string> = { rise: "Rise", fade: "Fade", instant: "Instant" };
const POSITION_LABELS: Record<LyricPosition, string> = { top: "Top", middle: "Middle", bottom: "Bottom" };
const TAKE_LAYOUT_LABELS: Record<TakeLayout, string> = {
  auto: "Automatic",
  stack: "Rows",
  split: "Columns",
  grid: "Grid 2 x 2",
};
const optionsOf = <T extends string>(values: readonly T[], labels: Record<T, string>) =>
  values.map((value) => ({ value, label: labels[value] }));

const takeProp = (n: number, order: number): MosaicTemplatePropDefinition => ({
  type: "media",
  required: false,
  description:
    `Take ${n}: a video or photo, cropped to fill its place. Drop a file straight onto it in the preview, or pick one here. ` +
    `Its own sound is muted (the song plays instead).${n === 4 ? TAKE4_NOTE : ""}`,
  meta: {
    control: { picker: "file", accept: ["video", "image"] },
    ui: {
      label: `Take ${n}`,
      order,
      ...(n <= 3 ? { primary: true } : {}),
      ...(n === 4 ? { visibleWhen: { prop: "takeCount", equals: "4" } } : {}),
    },
  },
});

const trimProp = (n: number, order: number): MosaicTemplatePropDefinition => ({
  type: "number",
  required: false,
  description:
    `Skip this many seconds at the start of take ${n}, so the moment you want lines up with the song.${n === 4 ? TAKE4_NOTE : ""}`,
  meta: {
    constraints: { min: 0, max: 600 },
    control: { step: 0.05 },
    ui: {
      label: `Take ${n}: trim start (s)`,
      order,
      ...(n === 4 ? { visibleWhen: { prop: "takeCount", equals: "4" } } : {}),
    },
  },
});

const framingProp = (n: number, order: number): MosaicTemplatePropDefinition => ({
  type: "number",
  required: false,
  description:
    `Which part of take ${n} stays in view when it is cropped: 0 keeps the top (or left), 0.5 the middle, 1 the bottom (or right).` +
    (n === 4 ? TAKE4_NOTE : ""),
  meta: {
    constraints: { min: 0, max: 1 },
    control: { flavor: "slider", step: 0.05 },
    ui: {
      label: `Take ${n}: framing`,
      order,
      ...(n === 4 ? { visibleWhen: { prop: "takeCount", equals: "4" } } : {}),
    },
  },
});

const colorProp = (label: string, order: number, description: string, fallback: string): MosaicTemplatePropDefinition => ({
  type: "string",
  required: false,
  description,
  meta: {
    constraints: { isColor: true },
    control: { colorPicker: true, defaultColor: fallback },
    ui: { label, order },
  },
});

const propsSchema = definePropsSchema<LyricStackProps>({
  song: {
    type: "media",
    required: false,
    description:
      "Your master (an audio file, or a video whose sound you want). The timing studio plays the whole song; time your lyrics once.",
    meta: {
      control: { picker: "file", accept: ["audio", "video"] },
      ui: { label: "Song", order: 1, primary: true },
    },
  },
  lyrics: {
    type: "json",
    required: false,
    description:
      "Your lyrics as PAGES: one entry per block of words that shares the screen before it clears. Time them once against " +
      "the whole song in the timing studio (tap each page, then each word) and keep the timed list for every clip of that song. " +
      "Untimed lyrics spread over the clip. A page written in [brackets] is a pause: the screen clears.",
    meta: {
      constraints: {
        jsonSchema: {
          type: "array",
          maxItems: LYRIC_STACK_MAX_PAGES,
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
          maxCues: LYRIC_STACK_MAX_PAGES,
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
  songStartSec: {
    type: "number",
    required: false,
    description:
      "Where in the song this clip begins, in seconds (read it off the timing studio's playhead). The song and your timed " +
      "lyrics start here; lyrics sung earlier are dropped.",
    meta: {
      constraints: { min: 0, max: 600 },
      control: { step: 0.05 },
      ui: { label: "Song start (s)", order: 3, primary: true },
    },
  },
  takeCount: {
    type: "string",
    required: false,
    description: "How many takes share the screen (1 to 4). The layout follows what you have.",
    meta: {
      constraints: { oneOf: [...TAKE_COUNTS] },
      control: { options: TAKE_COUNTS.map((v) => ({ value: v, label: v })) },
      ui: { label: "Takes", order: 4 },
    },
  },
  take1: takeProp(1, 5),
  take2: takeProp(2, 6),
  take3: takeProp(3, 7),
  take4: takeProp(4, 8),
  font: {
    type: "string",
    required: false,
    description: "The lyric font (all free to use). A font file below overrides it.",
    meta: {
      control: { options: FONT_OPTIONS },
      ui: { label: "Font", order: 9 },
    },
  },
  fontFile: {
    type: "media",
    required: false,
    description: "Your own font (.ttf, .otf or .woff). Overrides Font. WOFF2 and .ttc cannot be read; convert to TTF.",
    meta: {
      control: { picker: "file", extensions: [...FONT_FILE_EXTENSIONS] },
      ui: { label: "Font file", order: 10 },
    },
  },
  textSize: {
    type: "number",
    required: false,
    description: "Lyric size. A page too long for the lyric box shrinks on its own.",
    meta: {
      constraints: { min: 0.5, max: 1.5 },
      control: { flavor: "slider", step: 0.05 },
      ui: { label: "Text size", order: 11 },
    },
  },
  textColor: colorProp("Text colour", 12, "Lyric colour.", DEFAULTS.textColor),
  textAlign: {
    type: "string",
    required: false,
    description: "Centred: each line centred. Edge to edge: every line runs the full width (a lone word sits left). Left: ragged right.",
    meta: {
      constraints: { oneOf: [...TEXT_ALIGN_VALUES] },
      control: { options: optionsOf(TEXT_ALIGN_VALUES, TEXT_ALIGN_LABELS) },
      ui: { label: "Text alignment", order: 13 },
    },
  },
  reveal: {
    type: "string",
    required: false,
    description:
      "Words build up: each word lands on its beat and stays until the page clears. One word at a time: each word alone, " +
      "centred. Line by line: each line lands at once.",
    meta: {
      constraints: { oneOf: [...REVEAL_MODES] },
      control: { options: optionsOf(REVEAL_MODES, REVEAL_LABELS) },
      ui: { label: "Reveal", order: 14 },
    },
  },
  wordEntrance: {
    type: "string",
    required: false,
    description: "How each word arrives: Rise (fades in as it moves up into place), Fade, or Instant.",
    meta: {
      constraints: { oneOf: [...WORD_ENTRANCES] },
      control: { options: optionsOf(WORD_ENTRANCES, ENTRANCE_LABELS) },
      ui: { label: "Word entrance", order: 15 },
    },
  },
  lyricsPosition: {
    type: "string",
    required: false,
    description: "Where the lyrics sit, inside the area the platform's buttons and caption leave clear.",
    meta: {
      constraints: { oneOf: [...LYRIC_POSITIONS] },
      control: { options: optionsOf(LYRIC_POSITIONS, POSITION_LABELS) },
      ui: { label: "Lyrics position", order: 16 },
    },
  },
  layout: {
    type: "string",
    required: false,
    description:
      "How the takes share the screen. Automatic: 2 or 3 in rows, 4 in a grid. Rows, Columns, or Grid 2 x 2 (4 takes; fewer go in rows).",
    meta: {
      constraints: { oneOf: [...TAKE_LAYOUTS] },
      control: { options: optionsOf(TAKE_LAYOUTS, TAKE_LAYOUT_LABELS) },
      ui: { label: "Take layout", order: 17 },
    },
  },
  [WORD_BOXES_PROP]: {
    type: "json",
    required: false,
    description:
      "Where each word sits: one box per word on screen in this clip. Written for you when you drag or resize a word in the " +
      "preview (a bigger box is a bigger word, and it stays centred); clear it to put every word back. Reset when the words on " +
      "screen change (the lyrics, Song start or the clip's length).",
    meta: {
      control: { picker: "regions", regions: { shapes: ["rect"] } },
      ui: { label: "Word positions", order: 18 },
    },
  },
  glow: {
    type: "number",
    required: false,
    description: "Soft glow around the words. 0 = none (and a faster render).",
    meta: {
      constraints: { min: 0, max: 1 },
      control: { flavor: "slider", step: 0.05 },
      ui: { label: "Glow", order: 19 },
    },
  },
  glowColor: colorProp(
    "Glow colour",
    20,
    "Glow colour. White reads as a halo; black turns it into a soft shadow for bright footage.",
    DEFAULTS.glowColor,
  ),
  borderPx: {
    type: "number",
    required: false,
    description: "Border between the takes, in pixels. 0 = the takes touch.",
    meta: {
      constraints: { min: 0, max: 40 },
      control: { flavor: "slider", step: 1 },
      ui: { label: "Border (px)", order: 21 },
    },
  },
  borderColor: colorProp("Border colour", 22, "Border colour (the background behind the takes).", DEFAULTS.borderColor),
  platform: {
    type: "string",
    required: false,
    description: "Where you will post. Keeps the lyrics clear of that app's buttons and caption, and picks the guide.",
    meta: {
      constraints: { oneOf: [...SHORT_PLATFORM_IDS] },
      control: { options: SHORT_PLATFORM_OPTIONS },
      ui: { label: "Platform", order: 23 },
    },
  },
  exportAll: {
    type: "boolean",
    required: false,
    description:
      "Also export the other two platforms: three files, each laid out for its app. Always AAC audio (Master audio is single-platform).",
    meta: { ui: { label: "Export all platforms", order: 24 } },
  },
  masterAudio: {
    type: "boolean",
    required: false,
    description:
      "Export a .mov with 24-bit PCM audio (your master, untouched) instead of an MP4 with AAC 320k. Single-platform exports only; a big file.",
    meta: { ui: { label: "Master audio (MOV)", order: 25 } },
  },
  showGuide: {
    type: "boolean",
    required: false,
    description:
      "Show the platform's screen (buttons, caption) over the preview while you edit. Never drawn into the export.",
    meta: { ui: { label: "Show platform guide", order: 26 } },
  },
  take1TrimSec: trimProp(1, 27),
  take1Framing: framingProp(1, 28),
  take2TrimSec: trimProp(2, 29),
  take2Framing: framingProp(2, 30),
  take3TrimSec: trimProp(3, 31),
  take3Framing: framingProp(3, 32),
  take4TrimSec: trimProp(4, 33),
  take4Framing: framingProp(4, 34),
});

/** Why the props that could carry a canvas handle have none (the 0.3.0 roll call). */
export const UNBOUND_REASONS = {
  song: "audio; a rect would swallow drops",
  songStartSec: "timing",
  lyrics: "text and timing live in the studio; a canvas edit would strand the word timings",
  fontFile: "a font is not a picture",
  textSize: "size",
  glow: "effect",
  glowColor: "effect colour",
  borderPx: "geometry",
  take4: "drawn only when Takes = 4",
  take4TrimSec: "drawn only when Takes = 4",
  take4Framing: "drawn only when Takes = 4",
} as const;

// ── prop readers ─────────────────────────────────────────────────────────────

const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;

const num = (value: unknown, fallback: number, min: number, max: number): number =>
  typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;

const mediaPath = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;

const positive = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined);

/** A #rrggbb colour, the fallback when unset, or null when malformed. */
const colorOf = (value: unknown, fallback: string): MosaicColor | null => {
  if (value === undefined || value === null || value === "") return fallback as MosaicColor;
  return typeof value === "string" && HEX.test(value) ? (value as MosaicColor) : null;
};

/** m:ss of whole seconds (ASCII). */
const clock = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** The platform knob as the render uses it: an id, else the default. */
export const platformOf = (value: unknown): ShortPlatformId =>
  isShortPlatformId(value) ? value : DEFAULT_SHORT_PLATFORM;

/** The takes on screen, 1..4 (a junk value reads as the default 3). */
export const takeCountOf = (value: unknown): number => Number(pick(value, TAKE_COUNTS, "3"));

/** Output hints the props decide: the canvas never moves; the container follows Master audio. */
export function resolveLyricStackHints(p: LyricStackProps): Partial<MosaicTemplateOutputHints> {
  const mov = p?.masterAudio === true && p?.exportAll !== true;
  return {
    width: 1080,
    height: 1920,
    format: mov ? { kind: "video", container: "mov" } : { kind: "video", container: "mp4" },
  };
}

// ── the template ─────────────────────────────────────────────────────────────

export const LyricStackV1 = defineMosaicTemplate<LyricStackProps>({
  id: asTemplateId(ID),
  label: "04 · Lyric Stack",
  version: 1,
  description:
    "Your takes stacked on screen, your song, and your lyrics landing word by word in the font you pick. Time the lyrics once " +
    "against the whole song, set where each clip starts, drag any word anywhere, and export for Reels, TikTok and Shorts.",
  capabilities: { tier: "core" },
  tags: ["reels", "music", "lyrics", "musicians", "creators", "instagram", "tiktok", "shorts", "vertical", "animated", "fonts"],

  outputHints: {
    width: 1080,
    height: 1920,
    fps: 30,
    durationMs: 15_000,
    posterTimeMs: 2_800,
    format: { kind: "video", container: "mp4" },
    note: "A 9:16 short. With takes dropped in, the video runs as long as the longest take (after its trim).",
  },
  resolveOutputHints: resolveLyricStackHints,

  propsSchema,
  defaultProps: { ...DEFAULTS, lyrics: LYRIC_STACK_DEFAULT_LYRICS.map((c) => ({ ...c })) },
  ...declareBindings(UNBOUND_REASONS),

  async render(rawProps: LyricStackProps, ctx: MosaicEngineContext): Promise<MosaicDocument | MosaicDocumentPipeline> {
    const props: LyricStackProps = { ...DEFAULTS, ...(rawProps ?? {}) };
    const { width: W, height: H, fps } = ctx.target;
    const design = ctx.mode === "design";
    const fail = (message: string) => makeErrorMosaic(message, { width: W, height: H, title: "Lyric Stack" });

    // ── lyrics ─────────────────────────────────────────────────────────────
    const parsed = parseCueTrackValue(props.lyrics);
    if (!parsed.ok) return fail(`Lyrics did not parse: ${parsed.error}`);
    const cues = parsed.cues;
    if (cues.length > LYRIC_STACK_MAX_PAGES) return fail(`Too many lyric pages (${cues.length}; the limit is ${LYRIC_STACK_MAX_PAGES}).`);

    // ── colours ────────────────────────────────────────────────────────────
    const textColor = colorOf(props.textColor, DEFAULTS.textColor);
    const glowColor = colorOf(props.glowColor, DEFAULTS.glowColor);
    const borderColor = colorOf(props.borderColor, DEFAULTS.borderColor);
    for (const [name, c] of [["Text colour", textColor], ["Glow colour", glowColor], ["Border colour", borderColor]] as const) {
      if (c === null) return fail(`${name} must be a colour like #FFFFFF.`);
    }

    // ── media ──────────────────────────────────────────────────────────────
    const metaOf = (p: string) => ctx.media?.[asAssetId(p)];
    const songPath = mediaPath(props.song);
    const songMs = songPath ? positive(metaOf(songPath)?.durationMs) : undefined;
    const songStartMs = songStartOf(num(props.songStartSec, 0, 0, 600) * 1000);
    if (songMs !== undefined && songStartMs >= songMs) {
      return fail(
        `Song start (${clock(songStartMs)}) is past the end of the song (${clock(songMs)}). Set Song start inside the song.`,
      );
    }

    const count = takeCountOf(props.takeCount);
    const takeInputs = Array.from({ length: count }, (_, i) => {
      const n = i + 1;
      const p = mediaPath(props[`take${n}` as "take1"]);
      const kind = p ? (determineMediaType(p, ctx) === "image" ? ("image" as const) : ("video" as const)) : undefined;
      return {
        n,
        path: p,
        kind,
        trimMs: Math.round(num(props[`take${n}TrimSec` as "take1TrimSec"], 0, 0, 600) * 1000),
        framing: num(props[`take${n}Framing` as "take1Framing"], 0.5, 0, 1),
        durationMs: p && kind === "video" ? positive(metaOf(p)?.durationMs) : undefined,
      };
    });

    // Length: an explicit ask wins, then the longest take after its trim,
    // then the rest of the song from Song start, then the host's target.
    const takeLengths = takeInputs
      .map((t) => (t.durationMs !== undefined ? t.durationMs - (t.kind === "video" ? t.trimMs : 0) : undefined))
      .filter((d): d is number => typeof d === "number" && d > 0);
    const naturalMs =
      takeLengths.length > 0 ? Math.max(...takeLengths) : songMs !== undefined ? songMs - songStartMs : undefined;
    const durationMs = resolveOutputDurationMs(ctx, { naturalMs });

    // ── pages: the lyric bank on the song, windowed onto the clip ──────────
    let pages: LyricPage[];
    if (hasTimedPage(cues)) {
      const songTimelineMs = songMs ?? songStartMs + durationMs;
      // Words sung before the clip are clamped to their page's start by the
      // window; `word` reveal must know which (reveal.ts, CARRIED WORDS).
      const songPages = resolvePages(cues, songTimelineMs).map((page) => ({
        ...page,
        words: page.words.map((w) => ({ ...w, carried: w.atMs < songStartMs })),
      }));
      pages = windowPages(songPages, { songStartMs, durationMs });
    } else {
      pages = resolvePages(cues, durationMs);
    }

    // ── font ───────────────────────────────────────────────────────────────
    const font = resolveFontPath({ font: props.font, fontFile: props.fontFile }, { readError: fontError });

    // ── custom word layout: the artist's boxes, root canvas px ────────────
    // One box per word the clip draws (see WORD POSITIONS ARE PER CLIP); the
    // length check waits for the layout, which knows which words those are.
    const readNotes: string[] = [];
    let wordBoxes: Array<Rect | null> | undefined;
    const regions = parseRegionsValue(props.wordBoxes);
    if (regions.ok && regions.regions.length > 0) {
      wordBoxes = resolveRegionsToPx(regions, { width: W, height: H }).map((r) =>
        r.ok ? { x: r.x, y: r.y, w: r.w, h: r.h } : null,
      );
    } else if (!regions.ok) {
      readNotes.push("Word positions could not be read; clear the field.");
    }

    // ── style ──────────────────────────────────────────────────────────────
    const reveal = pick(props.reveal, REVEAL_MODES, "cumulative");
    const entrance = pick(props.wordEntrance, WORD_ENTRANCES, "rise");
    const align = pick(props.textAlign, TEXT_ALIGN_VALUES, "center");
    const position = pick(props.lyricsPosition, LYRIC_POSITIONS, "middle");
    const takeLayout = pick(props.layout, TAKE_LAYOUTS, "auto");
    const glow = num(props.glow, DEFAULTS.glow, 0, 1);
    const baseFontPx = Math.max(12, Math.round(W * FONT_FRACTION_OF_W * num(props.textSize, 1, 0.5, 1.5)));
    const pad = Math.max(2, Math.round(baseFontPx * WORD_PAD_EM));
    const platformId = platformOf(props.platform);
    // The design surface is always ONE flat document; only an export fans out.
    const knob: PlatformKnob = props.exportAll === true && !design ? "all" : platformId;

    const missing: string[] = [];
    const build = (platform: ShortPlatform): MosaicDocument => {
      const stage = platformStage(platform, W, H);
      const box = lyricBox({ W, H, stage, position });
      const canvas = { W, H };
      // Lay out and time every page. Windows read only times and lines, never
      // rects, so a box never changes which words the clip draws.
      const laidPages = pages.map((page) => {
        const laid = layoutPage(page.words, {
          box,
          fontPx: baseFontPx,
          align,
          fontPath: font.path,
          pad,
          mode: reveal,
          soloMaxPx: Math.round(baseFontPx * SOLO_MAX_SCALE),
          canvas,
        });
        for (const ch of laid.missing) if (!missing.includes(ch)) missing.push(ch);
        const timing = laid.words.map((w, k) => ({ atMs: w.atMs, line: w.line, carried: page.words[k]?.carried }));
        return { laid, windows: revealWindows(page, timing, reveal) };
      });
      // Each drawn word's slot in Word positions: 0..n-1 in reading order across the clip.
      let drawnWords = 0;
      const boxSlots = laidPages.map(({ laid, windows }) =>
        laid.words.map((w, k) => (w.d !== "" && isShown(windows[k]) ? drawnWords++ : -1)),
      );
      const boxes = wordBoxes && wordBoxes.length === drawnWords ? wordBoxes : undefined;
      const notes = [...readNotes];
      if (wordBoxes && !boxes) {
        notes.push("Word positions reset: the words on screen changed. Clear Word positions, then drag again.");
      }

      const stackPages: StackPage[] = laidPages.map(({ laid, windows }, p) => {
        const words = boxes
          ? applyWordBoxes(
              laid.words,
              boxSlots[p].map((slot) => (slot >= 0 ? boxes[slot] : null)),
              font.path,
              pad,
              canvas,
            )
          : laid.words;
        return {
          words: words.map((w, k) => ({
            index: w.index,
            box: boxSlots[p][k],
            text: w.text,
            rect: w.rect,
            d: w.d,
            window: windows[k],
            risePx: Math.round(w.fontPx * RISE_EM),
          })),
          glowSigma: glowSigma(glow, laid.fontPx),
        };
      });

      const takes = layoutTakes({ W, H, count, layout: takeLayout, borderPx: num(props.borderPx, 6, 0, 40) });
      const slots: TakeSlot[] = takeInputs.map((t, i) => ({
        propKey: `take${t.n}`,
        trimKey: `take${t.n}TrimSec`,
        framingKey: `take${t.n}Framing`,
        ...(t.path && t.kind ? { clip: { path: t.path, mediaType: t.kind } } : {}),
        trimStartMs: t.trimMs,
        framing: t.framing,
        placeholder: { color: PLACEHOLDER_COLORS[i] as MosaicColor, label: `Take ${t.n} - drop a clip here` },
      }));

      const lines: string[] = [];
      if (design) {
        const advisory = durationAdvisory(platform, durationMs);
        if (advisory) lines.push(advisory);
        if (font.warning) lines.push(font.warning);
        lines.push(...notes);
        if (missing.length > 0) {
          // A character the advisory's own face cannot draw is named by code point (advisory.ts).
          lines.push(`This font has no ${missing.map(nameChar).join(" ")}; those draw as boxes.`);
        }
        if (props.showGuide !== false && !guideFitsCanvas(W, H)) {
          lines.push(`The ${platform.label} guide is drawn for a 9:16 canvas; this one is ${W}x${H}, so it is hidden.`);
        }
      }

      return buildLyricStack({
        W,
        H,
        fps,
        durationMs,
        takes,
        slots,
        pages: stackPages,
        style: {
          textColor: textColor as MosaicColor,
          glow,
          glowColor: glowColor as MosaicColor,
          borderColor: borderColor as MosaicColor,
          entrance,
        },
        clearPngPath: CLEAR_PNG,
        ...(songPath
          ? { song: { path: songPath, mediaType: determineMediaType(songPath, ctx), clipStartMs: songStartMs } }
          : {}),
        ...(design
          ? {
              guide: {
                ...(props.showGuide !== false
                  ? { png: { path: guidePng(platform), tiles: guideTiles(platform, W, H) } }
                  : {}),
                lines,
                stage,
              },
            }
          : {}),
        output: audioPolicy({ masterAudio: props.masterAudio === true, multi: knob === "all" }),
      }).doc;
    };

    return emitForPlatforms(knob, fps, build);
  },
});

export default LyricStackV1;
