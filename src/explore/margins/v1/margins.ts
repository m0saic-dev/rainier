import type { MosaicColor, MosaicDocument, MosaicEngineContext, MosaicMediaMetadata, MosaicTimedCue } from "@m0saic/types";
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
import { audioPolicy } from "../../../_shared/platform-emit";
import { songStartOf } from "../../../_shared/song-window";
import type { MarkVisibility, MarginsArgs, PageTone } from "./document";
import { LINE_BOXES_PROP, buildMargins } from "./document";
import type { Box, MarkStyle, PageFit } from "./marks";
import { MARK_STYLES, clampBox, defaultLineBoxes, pageContentRect, placeholderBlock } from "./marks";
import { MAX_LINES, judgeLines, lineWindows, naturalDurationMs } from "./timing";

/**
 * `@rainier/explore/margins/v1` — the artist's own lyric page (a notebook
 * photo, a Notes screenshot), each line marked as it is sung: a highlighter
 * stroke, a wavy underline, or a hand-drawn box. THE TEMPLATE WRITES NO
 * TEXT: the words are the artist's handwriting; the template only marks them
 * in time.
 *
 * ONE CONCEPT: a line is a box and a tap. The box comes from `lineBoxes` (a
 * regions list: one rect per line, dragged over the page in Make), the tap
 * from `lines` (a cue track timed against the whole recording in the Cue
 * Timing Studio). Each mark is ONE colour tile with an inline mask whose
 * bounds are the box size, so a resized box redraws its stroke.
 *
 * - Timing (timing.ts): `resolveCueWindows` over the probed recording, then
 *   `windowMs` by Audio start. Untimed lines share the gaps between timed
 *   ones evenly (the Lyric Triptych rule); with nothing timed they spread
 *   over the clip. `past: keep` holds every mark to the clip's end.
 * - Boxes (marks.ts): a `lineBoxes` list whose length matches the lines is
 *   used, rescaled from the canvas Make drew it on; any other list is
 *   ignored and the default bands apply (evenly spaced over the page).
 * - Make: with "Place boxes" on, the design pass shows every mark at once
 *   (no windows) so each box can be dragged onto its line. The export always
 *   follows the timing.
 * - No page yet: ruled paper (a masked tile bound to `page`, so a file
 *   dropped anywhere on it becomes the page) and a squiggle stand-in for the
 *   handwriting. Squiggles, never letters.
 */

export type MarginsProps = {
  page?: string;
  audio?: string;
  lines?: MosaicTimedCue[] | string;
  audioStartSec?: number;
  lineBoxes?: unknown;
  style?: MarkStyle;
  markColor?: string;
  pageTone?: PageTone;
  past?: MarginsPast;
  pageFit?: MarginsPageFit;
  paperColor?: string;
  lengthSec?: number;
  placing?: boolean;
};

export type MarginsPast = "keep" | "clear";
export type MarginsPageFit = "whole" | "fill";

export const MARGINS_ID = "@rainier/explore/margins/v1";
const TITLE = "Margins";
const HEX = /^#[0-9a-fA-F]{6}$/;

export const PAGE_TONES: readonly PageTone[] = ["light", "dark"];
export const PAST_MODES: readonly MarginsPast[] = ["keep", "clear"];
export const PAGE_FITS: readonly MarginsPageFit[] = ["whole", "fill"];
const FIT_OF: Readonly<Record<MarginsPageFit, PageFit>> = { whole: "contain", fill: "cover" };

/** Five untimed placeholder lines: the defaults show marks landing one by one. */
export const DEFAULT_LINES: readonly MosaicTimedCue[] = Object.freeze(
  [1, 2, 3, 4, 5].map((n) => Object.freeze({ text: `line ${n}` })),
);

const DEFAULTS = {
  audioStartSec: 0,
  style: "highlight" as MarkStyle,
  markColor: "#FFD83D",
  pageTone: "light" as PageTone,
  past: "keep" as MarginsPast,
  pageFit: "whole" as MarginsPageFit,
  paperColor: "#F4EFE4",
  lengthSec: 0,
  placing: true,
} satisfies MarginsProps;

const freshLines = (): MosaicTimedCue[] => DEFAULT_LINES.map((c) => ({ ...c }));

const propsSchema = definePropsSchema<MarginsProps>({
  page: {
    type: "media",
    required: false,
    description: "A photo of your lyric page, or a screenshot of it. Drop it on the canvas.",
    meta: {
      control: { picker: "file", accept: ["image"] },
      ui: { label: "Page", order: 1, primary: true },
    },
  },
  audio: {
    type: "media",
    required: false,
    description: "The voice memo or the song. The lines are timed against it.",
    meta: {
      control: { picker: "file", accept: ["audio", "video"] },
      ui: { label: "Audio", order: 2, primary: true },
    },
  },
  lines: {
    type: "json",
    required: false,
    description:
      "Tap each line as it is sung. One entry per line on your page, top to bottom (the words, or just 1, 2, 3); " +
      "open the timing studio, play the recording and tap Space as each line starts. Lines you have not tapped share " +
      "the gaps evenly. Only the timing is used: the page stays yours.",
    meta: {
      constraints: {
        jsonSchema: {
          type: "array",
          maxItems: MAX_LINES,
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
          mediaFromProp: "audio",
          maxCues: MAX_LINES,
          vocabulary: {
            item: "line",
            media: "recording",
            pasteHint:
              "One line per lyric line on your page, top to bottom (the words, or just 1, 2, 3). Only the timing is used; the page stays yours.",
          },
        },
      },
      ui: { label: "Lines", order: 3, primary: true },
    },
  },
  audioStartSec: {
    type: "number",
    required: false,
    description:
      "Where in the recording this clip begins. Lines are timed against the whole recording; earlier ones are dropped.",
    meta: {
      constraints: { min: 0, max: 600 },
      control: { step: 0.05 },
      ui: { label: "Audio start (s)", order: 4 },
    },
  },
  [LINE_BOXES_PROP]: {
    type: "json",
    required: false,
    description:
      "Where each line sits on your page. Drag and resize each box over its line; clear this to start again.",
    meta: {
      control: { picker: "regions", regions: { shapes: ["rect"] } },
      ui: { label: "Line boxes", order: 5 },
    },
  },
  style: {
    type: "string",
    required: false,
    description: "The kind of mark: a highlighter stroke, a wavy underline, or a hand-drawn box around the line.",
    meta: {
      constraints: { oneOf: [...MARK_STYLES] },
      control: {
        options: [
          { value: "highlight", label: "Highlighter" },
          { value: "underline", label: "Underline" },
          { value: "box", label: "Box" },
        ],
      },
      ui: { label: "Style", order: 6 },
    },
  },
  markColor: {
    type: "string",
    required: false,
    description: "Marker colour: the highlighter, the underline or the box.",
    meta: {
      constraints: { isColor: true },
      control: { colorPicker: true, defaultColor: DEFAULTS.markColor },
      ui: { label: "Mark colour", order: 7 },
    },
  },
  pageTone: {
    type: "string",
    required: false,
    description:
      "Light paper (the highlighter lays over it like marker ink) or a dark screen (it glows, so light writing stays readable).",
    meta: {
      constraints: { oneOf: [...PAGE_TONES] },
      control: {
        options: [
          { value: "light", label: "Light page" },
          { value: "dark", label: "Dark screen" },
        ],
      },
      ui: { label: "Page tone", order: 8 },
    },
  },
  past: {
    type: "string",
    required: false,
    description: "Sung lines stay marked, or only the current line is.",
    meta: {
      constraints: { oneOf: [...PAST_MODES] },
      control: {
        options: [
          { value: "keep", label: "Keep sung lines marked" },
          { value: "clear", label: "Only the current line" },
        ],
      },
      ui: { label: "Sung lines", order: 9 },
    },
  },
  pageFit: {
    type: "string",
    required: false,
    description: "The whole page with paper around it, or filling the frame.",
    meta: {
      constraints: { oneOf: [...PAGE_FITS] },
      control: {
        options: [
          { value: "whole", label: "Whole page" },
          { value: "fill", label: "Fill the frame" },
        ],
      },
      ui: { label: "Page fit", order: 10 },
    },
  },
  paperColor: {
    type: "string",
    required: false,
    description: "Around the page, and the placeholder paper.",
    meta: {
      constraints: { isColor: true },
      control: { colorPicker: true, defaultColor: DEFAULTS.paperColor },
      ui: { label: "Paper colour", order: 11 },
    },
  },
  lengthSec: {
    type: "number",
    required: false,
    description: "Clip length. 0 = until the last marked line ends.",
    meta: {
      constraints: { min: 0, max: 180 },
      control: { step: 0.5 },
      ui: { label: "Length (s)", order: 12 },
    },
  },
  placing: {
    type: "boolean",
    required: false,
    description:
      "Place boxes: show every box at once so you can drag each onto its line. Turn it off to preview the timing. The export always follows the timing.",
    meta: { ui: { label: "Place boxes", order: 13 } },
  },
});

export type MarginsKnobs = {
  style: MarkStyle;
  pageTone: PageTone;
  past: MarginsPast;
  fit: PageFit;
  audioStartSec: number;
  lengthSec: number;
  placing: boolean;
};

const num = (value: unknown, fallback: number, min: number, max: number): number =>
  typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;

const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;

/** Clamp the knobs into range. Never throws: an unknown value takes the default. */
export function resolveMarginsKnobs(props: MarginsProps): MarginsKnobs {
  return {
    style: pick(props.style, MARK_STYLES, DEFAULTS.style),
    pageTone: pick(props.pageTone, PAGE_TONES, DEFAULTS.pageTone),
    past: pick(props.past, PAST_MODES, DEFAULTS.past),
    fit: FIT_OF[pick(props.pageFit, PAGE_FITS, DEFAULTS.pageFit)],
    audioStartSec: num(props.audioStartSec, DEFAULTS.audioStartSec, 0, 600),
    lengthSec: num(props.lengthSec, DEFAULTS.lengthSec, 0, 180),
    placing: props.placing !== false,
  };
}

/**
 * One box per line, canvas px. A `lineBoxes` list with exactly `count`
 * rects is used (rescaled from the canvas it was drawn on); any other list,
 * or none, gives the default bands over `content`. A single rect that does
 * not resolve (degenerate, off-canvas) falls back to its own default band.
 */
export function resolveLineBoxes(
  value: unknown,
  count: number,
  canvas: { W: number; H: number },
  content: Box,
): { boxes: Box[]; custom: boolean } {
  const { W, H } = canvas;
  const bands = defaultLineBoxes(count, content).map((b) => clampBox(b, W, H));
  if (count === 0) return { boxes: [], custom: false };
  const parsed = parseRegionsValue(value);
  if (!parsed.ok || parsed.regions.length !== count) return { boxes: bands, custom: false };
  const px = resolveRegionsToPx(parsed, { width: W, height: H });
  return {
    boxes: px.map((r, i) => (r.ok ? clampBox({ x: r.x, y: r.y, w: r.w, h: r.h }, W, H) : bands[i])),
    custom: true,
  };
}

const mediaPath = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;

/** An absent or blank lines value is "no lines yet", not a parse error. */
const linesValue = (value: unknown): unknown =>
  value === undefined || value === null || (typeof value === "string" && value.trim() === "") ? [] : value;

/** The file name alone, shortened, ASCII (it only ever reaches an error card). */
function shownName(p: string): string {
  const parts = p.split(/[\\/]/);
  const name = (parts[parts.length - 1] || p).replace(/[^\x20-\x7E]/g, "?");
  return name.length > 36 ? `${name.slice(0, 33)}...` : name;
}

function mediaMeta(ctx: MosaicEngineContext, raw: string, trimmed: string): MosaicMediaMetadata | undefined {
  return ctx.media?.[asAssetId(raw)] ?? ctx.media?.[asAssetId(trimmed)];
}

/** `#rrggbb`, the default when unset, or `null` for anything else. */
function hexOf(value: unknown, fallback: string): MosaicColor | null {
  const v = value === undefined || value === "" ? fallback : value;
  return typeof v === "string" && HEX.test(v) ? (v as MosaicColor) : null;
}

export const MarginsV1 = defineMosaicTemplate<MarginsProps>({
  id: asTemplateId(MARGINS_ID),
  label: "06 · Margins",
  version: 1,
  description:
    "Your handwritten lyric page, marked line by line as you sing: tap each line to the voice memo or the song and a highlighter stroke, underline or hand-drawn box lands on it. The template writes no words; the page is yours. 1080x1920.",
  capabilities: { tier: "core" },
  tags: ["explore", "lyrics", "experiment", "music", "musicians", "songwriting", "creators", "vertical", "animated"],

  outputHints: {
    width: 1080,
    height: 1920,
    fps: 30,
    durationMs: 10_000,
    posterTimeMs: 7000,
    format: { kind: "video", container: "mp4" },
    note: "10 s at the defaults (five untimed lines). With lines tapped, the clip runs to the last marked line plus 1.5 s.",
  },

  propsSchema,
  defaultProps: { ...DEFAULTS, lines: freshLines() },

  // The 0.3.0 roll call. Bound: page (the photo, or the ruled placeholder),
  // lineBoxes (a rect handle on mark i, bound even when the list is empty)
  // and markColor (a swatch beside it on every mark). paperColor IS
  // document.backgroundColor. Closed sets and the boolean never count.
  ...declareBindings({
    audio: "audio: an audio leaf has no pointer surface",
    lines: "timing, tapped in the studio",
    audioStartSec: "timing",
    lengthSec: "timing",
  }),

  async render(rawProps: MarginsProps, ctx: MosaicEngineContext): Promise<MosaicDocument> {
    const props: MarginsProps = { ...DEFAULTS, lines: freshLines(), ...(rawProps ?? {}) };
    const { width: W, height: H, fps } = ctx.target;
    const design = ctx.mode === "design";
    const fail = (message: string) => makeErrorMosaic(message, { width: W, height: H, title: TITLE });
    const knobs = resolveMarginsKnobs(props);

    const markColor = hexOf(props.markColor, DEFAULTS.markColor);
    if (!markColor) return fail(`Mark colour ${JSON.stringify(props.markColor)} must be a colour like #FFD83D.`);
    const paperColor = hexOf(props.paperColor, DEFAULTS.paperColor);
    if (!paperColor) return fail(`Paper colour ${JSON.stringify(props.paperColor)} must be a colour like #F4EFE4.`);

    // ── lines ──────────────────────────────────────────────────────────────
    const parsed = parseCueTrackValue(linesValue(props.lines));
    if (!parsed.ok) return fail(`The lines could not be read. Open Lines and paste them again. (${parsed.error})`);
    const cues = parsed.cues;
    if (cues.length > MAX_LINES) {
      return fail(`Too many lines (${cues.length}). A page takes at most ${MAX_LINES}: split it into two clips.`);
    }

    // ── the page: a probed picture, or the ruled placeholder ───────────────
    let page: MarginsArgs["page"];
    let pageMeta: MosaicMediaMetadata | undefined;
    const pageRaw = typeof props.page === "string" ? props.page : "";
    const pagePath = mediaPath(pageRaw);
    if (pagePath) {
      pageMeta = mediaMeta(ctx, pageRaw, pagePath);
      const kind = pageMeta?.kind === "unknown" || !pageMeta ? determineMediaType(pagePath, ctx) : pageMeta.kind;
      if (kind === "audio") {
        // Make's design pass keeps the placeholder so another file can be dropped on it.
        if (!design) return fail(`"${shownName(pagePath)}" is not a picture. Drop a photo or a screenshot of your page.`);
        pageMeta = undefined;
      } else {
        page = { path: pagePath, mediaType: kind === "video" ? "video" : "image", fit: knobs.fit };
      }
    }

    // ── the recording: an audio-only leaf from Audio start ────────────────
    let audio: MarginsArgs["audio"];
    let recordingMs: number | undefined;
    const audioRaw = typeof props.audio === "string" ? props.audio : "";
    const audioPath = mediaPath(audioRaw);
    const audioStartMs = songStartOf(knobs.audioStartSec * 1000);
    if (audioPath) {
      const meta = mediaMeta(ctx, audioRaw, audioPath);
      const d = meta?.durationMs;
      recordingMs = typeof d === "number" && Number.isFinite(d) && d > 0 ? d : undefined;
      audio = { path: audioPath, mediaType: meta?.kind === "video" ? "video" : "audio", clipStartMs: audioStartMs };
    }

    // ── timing ─────────────────────────────────────────────────────────────
    const judged = judgeLines(cues, recordingMs);
    const naturalMs = naturalDurationMs(judged, { audioStartMs, recordingMs, lengthMs: knobs.lengthSec * 1000 });
    const durationMs = resolveOutputDurationMs(ctx, { naturalMs });
    const windows = lineWindows(judged, { audioStartMs, durationMs });

    // ── boxes: the artist's, or bands over the page ────────────────────────
    const content = page ? pageContentRect(W, H, knobs.fit, pageMeta) : placeholderBlock(W, H);
    const { boxes } = resolveLineBoxes(props.lineBoxes, cues.length, { W, H }, content);

    // Placing (design only): every mark on screen, no window. Otherwise each
    // line's window; a line the clip does not show keeps an invisible tile in
    // design (Make's box session needs every element) and no tile in a render.
    const placingAll = design && knobs.placing;
    const marks = windows.map((w): MarkVisibility | null => {
      if (placingAll) return { kind: "always" };
      if (!w) return design ? { kind: "never" } : null;
      return { kind: "window", startMs: w.startMs, endMs: knobs.past === "keep" ? durationMs : w.endMs };
    });

    return buildMargins({
      W,
      H,
      fps,
      durationMs,
      paperColor,
      ...(page ? { page } : {}),
      ...(audio ? { audio } : {}),
      style: knobs.style,
      markColor,
      pageTone: knobs.pageTone,
      boxes,
      marks,
      output: audioPolicy({}),
    }).doc;
  },
});

export default MarginsV1;
