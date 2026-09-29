"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LyricStackV1 = exports.takeCountOf = exports.platformOf = exports.UNBOUND_REASONS = exports.LYRIC_STACK_DEFAULT_LYRICS = exports.CLEAR_PNG = exports.WORD_PAD_EM = exports.SOLO_MAX_SCALE = exports.FONT_FRACTION_OF_W = exports.LYRIC_STACK_MAX_PAGES = exports.LYRIC_STACK_ID = void 0;
exports.resolveLyricStackHints = resolveLyricStackHints;
const node_path_1 = __importDefault(require("node:path"));
const types_1 = require("@m0saic/types");
const template_utils_1 = require("@m0saic/template-utils");
const bindings_1 = require("../../../_shared/bindings");
const fonts_1 = require("../../../_shared/fonts");
const glyph_text_1 = require("../../../_shared/glyph-text");
const platform_emit_1 = require("../../../_shared/platform-emit");
const platforms_1 = require("../../../_shared/platforms");
const song_window_1 = require("../../../_shared/song-window");
const stage_layout_1 = require("../../../_shared/stage-layout");
const advisory_1 = require("./advisory");
const document_1 = require("./document");
const layout_1 = require("./layout");
const pages_1 = require("./pages");
const reveal_1 = require("./reveal");
const ID = "@rainier/reels/lyric-stack/v1";
exports.LYRIC_STACK_ID = ID;
/** The cue-track cap (pages). */
exports.LYRIC_STACK_MAX_PAGES = 300;
/** Base type size as a fraction of canvas width (119 px on a 1080-wide Reel), times Text size. */
exports.FONT_FRACTION_OF_W = 0.11;
/** `word` mode: a lone word grows to at most this multiple of the base size. */
exports.SOLO_MAX_SCALE = 1.6;
/** Padding around every word tile, in ems of the base size. */
exports.WORD_PAD_EM = 0.04;
const HEX = /^#[0-9a-fA-F]{6}$/;
/** The transparent PNG every page child carries as a corner tile under its words (src/ and dist/ alike). */
exports.CLEAR_PNG = node_path_1.default.join(__dirname, "assets", "clear.png");
/**
 * Placeholder lyrics: generic on purpose (this repo is public), and they
 * double as the instructions. One entry = one page.
 */
exports.LYRIC_STACK_DEFAULT_LYRICS = [
    { text: "type your lyrics here one page per line" },
    { text: "each page stays up until the next one starts" },
    { text: "time the pages once against your whole song" },
    { text: "then set song start for every clip you cut" },
    { text: "drag any word to move it anywhere you like" },
];
const TAKE_COUNTS = ["1", "2", "3", "4"];
/** Placeholder panels (no clip yet): four quiet tones, one per take. */
const PLACEHOLDER_COLORS = ["#2A2238", "#1D2733", "#332228", "#23302A"];
const DEFAULTS = {
    lyrics: exports.LYRIC_STACK_DEFAULT_LYRICS,
    songStartSec: 0,
    takeCount: "3",
    font: fonts_1.DEFAULT_FONT_ID,
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
    platform: platforms_1.DEFAULT_SHORT_PLATFORM,
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
};
const TAKE4_NOTE = " Used when Takes = 4.";
/** Dropdown labels: the panel shows these, never the raw values. */
const TEXT_ALIGN_VALUES = ["center", "justify", "left"];
const TEXT_ALIGN_LABELS = {
    center: "Centred",
    justify: "Edge to edge",
    left: "Left",
};
const REVEAL_LABELS = {
    cumulative: "Words build up",
    word: "One word at a time",
    line: "Line by line",
};
const ENTRANCE_LABELS = { rise: "Rise", fade: "Fade", instant: "Instant" };
const POSITION_LABELS = { top: "Top", middle: "Middle", bottom: "Bottom" };
const TAKE_LAYOUT_LABELS = {
    auto: "Automatic",
    stack: "Rows",
    split: "Columns",
    grid: "Grid 2 x 2",
};
const optionsOf = (values, labels) => values.map((value) => ({ value, label: labels[value] }));
const takeProp = (n, order) => ({
    type: "media",
    required: false,
    description: `Take ${n}: a video or photo, cropped to fill its place. Drop a file straight onto it in the preview, or pick one here. ` +
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
const trimProp = (n, order) => ({
    type: "number",
    required: false,
    description: `Skip this many seconds at the start of take ${n}, so the moment you want lines up with the song.${n === 4 ? TAKE4_NOTE : ""}`,
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
const framingProp = (n, order) => ({
    type: "number",
    required: false,
    description: `Which part of take ${n} stays in view when it is cropped: 0 keeps the top (or left), 0.5 the middle, 1 the bottom (or right).` +
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
const colorProp = (label, order, description, fallback) => ({
    type: "string",
    required: false,
    description,
    meta: {
        constraints: { isColor: true },
        control: { colorPicker: true, defaultColor: fallback },
        ui: { label, order },
    },
});
const propsSchema = (0, template_utils_1.definePropsSchema)({
    song: {
        type: "media",
        required: false,
        description: "Your master (an audio file, or a video whose sound you want). The timing studio plays the whole song; time your lyrics once.",
        meta: {
            control: { picker: "file", accept: ["audio", "video"] },
            ui: { label: "Song", order: 1, primary: true },
        },
    },
    lyrics: {
        type: "json",
        required: false,
        description: "Your lyrics as PAGES: one entry per block of words that shares the screen before it clears. Time them once against " +
            "the whole song in the timing studio (tap each page, then each word) and keep the timed list for every clip of that song. " +
            "Untimed lyrics spread over the clip. A page written in [brackets] is a pause: the screen clears.",
        meta: {
            constraints: {
                jsonSchema: {
                    type: "array",
                    maxItems: exports.LYRIC_STACK_MAX_PAGES,
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
                    maxCues: exports.LYRIC_STACK_MAX_PAGES,
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
        description: "Where in the song this clip begins, in seconds (read it off the timing studio's playhead). The song and your timed " +
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
            control: { options: fonts_1.FONT_OPTIONS },
            ui: { label: "Font", order: 9 },
        },
    },
    fontFile: {
        type: "media",
        required: false,
        description: "Your own font (.ttf, .otf or .woff). Overrides Font. WOFF2 and .ttc cannot be read; convert to TTF.",
        meta: {
            control: { picker: "file", extensions: [...fonts_1.FONT_FILE_EXTENSIONS] },
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
        description: "Words build up: each word lands on its beat and stays until the page clears. One word at a time: each word alone, " +
            "centred. Line by line: each line lands at once.",
        meta: {
            constraints: { oneOf: [...reveal_1.REVEAL_MODES] },
            control: { options: optionsOf(reveal_1.REVEAL_MODES, REVEAL_LABELS) },
            ui: { label: "Reveal", order: 14 },
        },
    },
    wordEntrance: {
        type: "string",
        required: false,
        description: "How each word arrives: Rise (fades in as it moves up into place), Fade, or Instant.",
        meta: {
            constraints: { oneOf: [...reveal_1.WORD_ENTRANCES] },
            control: { options: optionsOf(reveal_1.WORD_ENTRANCES, ENTRANCE_LABELS) },
            ui: { label: "Word entrance", order: 15 },
        },
    },
    lyricsPosition: {
        type: "string",
        required: false,
        description: "Where the lyrics sit, inside the area the platform's buttons and caption leave clear.",
        meta: {
            constraints: { oneOf: [...stage_layout_1.LYRIC_POSITIONS] },
            control: { options: optionsOf(stage_layout_1.LYRIC_POSITIONS, POSITION_LABELS) },
            ui: { label: "Lyrics position", order: 16 },
        },
    },
    layout: {
        type: "string",
        required: false,
        description: "How the takes share the screen. Automatic: 2 or 3 in rows, 4 in a grid. Rows, Columns, or Grid 2 x 2 (4 takes; fewer go in rows).",
        meta: {
            constraints: { oneOf: [...stage_layout_1.TAKE_LAYOUTS] },
            control: { options: optionsOf(stage_layout_1.TAKE_LAYOUTS, TAKE_LAYOUT_LABELS) },
            ui: { label: "Take layout", order: 17 },
        },
    },
    [document_1.WORD_BOXES_PROP]: {
        type: "json",
        required: false,
        description: "Where each word sits: one box per word on screen in this clip. Written for you when you drag or resize a word in the " +
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
    glowColor: colorProp("Glow colour", 20, "Glow colour. White reads as a halo; black turns it into a soft shadow for bright footage.", DEFAULTS.glowColor),
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
            constraints: { oneOf: [...platforms_1.SHORT_PLATFORM_IDS] },
            control: { options: platforms_1.SHORT_PLATFORM_OPTIONS },
            ui: { label: "Platform", order: 23 },
        },
    },
    exportAll: {
        type: "boolean",
        required: false,
        description: "Also export the other two platforms: three files, each laid out for its app. Always AAC audio (Master audio is single-platform).",
        meta: { ui: { label: "Export all platforms", order: 24 } },
    },
    masterAudio: {
        type: "boolean",
        required: false,
        description: "Export a .mov with 24-bit PCM audio (your master, untouched) instead of an MP4 with AAC 320k. Single-platform exports only; a big file.",
        meta: { ui: { label: "Master audio (MOV)", order: 25 } },
    },
    showGuide: {
        type: "boolean",
        required: false,
        description: "Show the platform's screen (buttons, caption) over the preview while you edit. Never drawn into the export.",
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
exports.UNBOUND_REASONS = {
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
};
// ── prop readers ─────────────────────────────────────────────────────────────
const pick = (value, allowed, fallback) => typeof value === "string" && allowed.includes(value) ? value : fallback;
const num = (value, fallback, min, max) => typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
const mediaPath = (value) => typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
const positive = (v) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined);
/** A #rrggbb colour, the fallback when unset, or null when malformed. */
const colorOf = (value, fallback) => {
    if (value === undefined || value === null || value === "")
        return fallback;
    return typeof value === "string" && HEX.test(value) ? value : null;
};
/** m:ss of whole seconds (ASCII). */
const clock = (ms) => {
    const s = Math.max(0, Math.round(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
/** The platform knob as the render uses it: an id, else the default. */
const platformOf = (value) => (0, platforms_1.isShortPlatformId)(value) ? value : platforms_1.DEFAULT_SHORT_PLATFORM;
exports.platformOf = platformOf;
/** The takes on screen, 1..4 (a junk value reads as the default 3). */
const takeCountOf = (value) => Number(pick(value, TAKE_COUNTS, "3"));
exports.takeCountOf = takeCountOf;
/** Output hints the props decide: the canvas never moves; the container follows Master audio. */
function resolveLyricStackHints(p) {
    const mov = (p === null || p === void 0 ? void 0 : p.masterAudio) === true && (p === null || p === void 0 ? void 0 : p.exportAll) !== true;
    return {
        width: 1080,
        height: 1920,
        format: mov ? { kind: "video", container: "mov" } : { kind: "video", container: "mp4" },
    };
}
// ── the template ─────────────────────────────────────────────────────────────
exports.LyricStackV1 = (0, template_utils_1.defineMosaicTemplate)({
    id: (0, types_1.asTemplateId)(ID),
    label: "04 · Lyric Stack",
    version: 1,
    description: "Your takes stacked on screen, your song, and your lyrics landing word by word in the font you pick. Time the lyrics once " +
        "against the whole song, set where each clip starts, drag any word anywhere, and export for Reels, TikTok and Shorts.",
    capabilities: { tier: "core" },
    tags: ["reels", "music", "lyrics", "musicians", "creators", "instagram", "tiktok", "shorts", "vertical", "animated", "fonts"],
    outputHints: {
        width: 1080,
        height: 1920,
        fps: 30,
        durationMs: 15000,
        posterTimeMs: 2800,
        format: { kind: "video", container: "mp4" },
        note: "A 9:16 short. With takes dropped in, the video runs as long as the longest take (after its trim).",
    },
    resolveOutputHints: resolveLyricStackHints,
    propsSchema,
    defaultProps: { ...DEFAULTS, lyrics: exports.LYRIC_STACK_DEFAULT_LYRICS.map((c) => ({ ...c })) },
    ...(0, bindings_1.declareBindings)(exports.UNBOUND_REASONS),
    async render(rawProps, ctx) {
        var _a;
        const props = { ...DEFAULTS, ...(rawProps !== null && rawProps !== void 0 ? rawProps : {}) };
        const { width: W, height: H, fps } = ctx.target;
        const design = ctx.mode === "design";
        const fail = (message) => (0, template_utils_1.makeErrorMosaic)(message, { width: W, height: H, title: "Lyric Stack" });
        // ── lyrics ─────────────────────────────────────────────────────────────
        const parsed = (0, template_utils_1.parseCueTrackValue)(props.lyrics);
        if (!parsed.ok)
            return fail(`Lyrics did not parse: ${parsed.error}`);
        const cues = parsed.cues;
        if (cues.length > exports.LYRIC_STACK_MAX_PAGES)
            return fail(`Too many lyric pages (${cues.length}; the limit is ${exports.LYRIC_STACK_MAX_PAGES}).`);
        // ── colours ────────────────────────────────────────────────────────────
        const textColor = colorOf(props.textColor, DEFAULTS.textColor);
        const glowColor = colorOf(props.glowColor, DEFAULTS.glowColor);
        const borderColor = colorOf(props.borderColor, DEFAULTS.borderColor);
        for (const [name, c] of [["Text colour", textColor], ["Glow colour", glowColor], ["Border colour", borderColor]]) {
            if (c === null)
                return fail(`${name} must be a colour like #FFFFFF.`);
        }
        // ── media ──────────────────────────────────────────────────────────────
        const metaOf = (p) => { var _a; return (_a = ctx.media) === null || _a === void 0 ? void 0 : _a[(0, types_1.asAssetId)(p)]; };
        const songPath = mediaPath(props.song);
        const songMs = songPath ? positive((_a = metaOf(songPath)) === null || _a === void 0 ? void 0 : _a.durationMs) : undefined;
        const songStartMs = (0, song_window_1.songStartOf)(num(props.songStartSec, 0, 0, 600) * 1000);
        if (songMs !== undefined && songStartMs >= songMs) {
            return fail(`Song start (${clock(songStartMs)}) is past the end of the song (${clock(songMs)}). Set Song start inside the song.`);
        }
        const count = (0, exports.takeCountOf)(props.takeCount);
        const takeInputs = Array.from({ length: count }, (_, i) => {
            var _a;
            const n = i + 1;
            const p = mediaPath(props[`take${n}`]);
            const kind = p ? ((0, template_utils_1.determineMediaType)(p, ctx) === "image" ? "image" : "video") : undefined;
            return {
                n,
                path: p,
                kind,
                trimMs: Math.round(num(props[`take${n}TrimSec`], 0, 0, 600) * 1000),
                framing: num(props[`take${n}Framing`], 0.5, 0, 1),
                durationMs: p && kind === "video" ? positive((_a = metaOf(p)) === null || _a === void 0 ? void 0 : _a.durationMs) : undefined,
            };
        });
        // Length: an explicit ask wins, then the longest take after its trim,
        // then the rest of the song from Song start, then the host's target.
        const takeLengths = takeInputs
            .map((t) => (t.durationMs !== undefined ? t.durationMs - (t.kind === "video" ? t.trimMs : 0) : undefined))
            .filter((d) => typeof d === "number" && d > 0);
        const naturalMs = takeLengths.length > 0 ? Math.max(...takeLengths) : songMs !== undefined ? songMs - songStartMs : undefined;
        const durationMs = (0, template_utils_1.resolveOutputDurationMs)(ctx, { naturalMs });
        // ── pages: the lyric bank on the song, windowed onto the clip ──────────
        let pages;
        if ((0, pages_1.hasTimedPage)(cues)) {
            const songTimelineMs = songMs !== null && songMs !== void 0 ? songMs : songStartMs + durationMs;
            // Words sung before the clip are clamped to their page's start by the
            // window; `word` reveal must know which (reveal.ts, CARRIED WORDS).
            const songPages = (0, pages_1.resolvePages)(cues, songTimelineMs).map((page) => ({
                ...page,
                words: page.words.map((w) => ({ ...w, carried: w.atMs < songStartMs })),
            }));
            pages = (0, song_window_1.windowPages)(songPages, { songStartMs, durationMs });
        }
        else {
            pages = (0, pages_1.resolvePages)(cues, durationMs);
        }
        // ── font ───────────────────────────────────────────────────────────────
        const font = (0, fonts_1.resolveFontPath)({ font: props.font, fontFile: props.fontFile }, { readError: glyph_text_1.fontError });
        // ── custom word layout: the artist's boxes, root canvas px ────────────
        // One box per word the clip draws (see WORD POSITIONS ARE PER CLIP); the
        // length check waits for the layout, which knows which words those are.
        const readNotes = [];
        let wordBoxes;
        const regions = (0, template_utils_1.parseRegionsValue)(props.wordBoxes);
        if (regions.ok && regions.regions.length > 0) {
            wordBoxes = (0, template_utils_1.resolveRegionsToPx)(regions, { width: W, height: H }).map((r) => r.ok ? { x: r.x, y: r.y, w: r.w, h: r.h } : null);
        }
        else if (!regions.ok) {
            readNotes.push("Word positions could not be read; clear the field.");
        }
        // ── style ──────────────────────────────────────────────────────────────
        const reveal = pick(props.reveal, reveal_1.REVEAL_MODES, "cumulative");
        const entrance = pick(props.wordEntrance, reveal_1.WORD_ENTRANCES, "rise");
        const align = pick(props.textAlign, TEXT_ALIGN_VALUES, "center");
        const position = pick(props.lyricsPosition, stage_layout_1.LYRIC_POSITIONS, "middle");
        const takeLayout = pick(props.layout, stage_layout_1.TAKE_LAYOUTS, "auto");
        const glow = num(props.glow, DEFAULTS.glow, 0, 1);
        const baseFontPx = Math.max(12, Math.round(W * exports.FONT_FRACTION_OF_W * num(props.textSize, 1, 0.5, 1.5)));
        const pad = Math.max(2, Math.round(baseFontPx * exports.WORD_PAD_EM));
        const platformId = (0, exports.platformOf)(props.platform);
        // The design surface is always ONE flat document; only an export fans out.
        const knob = props.exportAll === true && !design ? "all" : platformId;
        const missing = [];
        const build = (platform) => {
            const stage = (0, platforms_1.platformStage)(platform, W, H);
            const box = (0, stage_layout_1.lyricBox)({ W, H, stage, position });
            const canvas = { W, H };
            // Lay out and time every page. Windows read only times and lines, never
            // rects, so a box never changes which words the clip draws.
            const laidPages = pages.map((page) => {
                const laid = (0, layout_1.layoutPage)(page.words, {
                    box,
                    fontPx: baseFontPx,
                    align,
                    fontPath: font.path,
                    pad,
                    mode: reveal,
                    soloMaxPx: Math.round(baseFontPx * exports.SOLO_MAX_SCALE),
                    canvas,
                });
                for (const ch of laid.missing)
                    if (!missing.includes(ch))
                        missing.push(ch);
                const timing = laid.words.map((w, k) => { var _a; return ({ atMs: w.atMs, line: w.line, carried: (_a = page.words[k]) === null || _a === void 0 ? void 0 : _a.carried }); });
                return { laid, windows: (0, reveal_1.revealWindows)(page, timing, reveal) };
            });
            // Each drawn word's slot in Word positions: 0..n-1 in reading order across the clip.
            let drawnWords = 0;
            const boxSlots = laidPages.map(({ laid, windows }) => laid.words.map((w, k) => (w.d !== "" && (0, reveal_1.isShown)(windows[k]) ? drawnWords++ : -1)));
            const boxes = wordBoxes && wordBoxes.length === drawnWords ? wordBoxes : undefined;
            const notes = [...readNotes];
            if (wordBoxes && !boxes) {
                notes.push("Word positions reset: the words on screen changed. Clear Word positions, then drag again.");
            }
            const stackPages = laidPages.map(({ laid, windows }, p) => {
                const words = boxes
                    ? (0, layout_1.applyWordBoxes)(laid.words, boxSlots[p].map((slot) => (slot >= 0 ? boxes[slot] : null)), font.path, pad, canvas)
                    : laid.words;
                return {
                    words: words.map((w, k) => ({
                        index: w.index,
                        box: boxSlots[p][k],
                        text: w.text,
                        rect: w.rect,
                        d: w.d,
                        window: windows[k],
                        risePx: Math.round(w.fontPx * reveal_1.RISE_EM),
                    })),
                    glowSigma: (0, document_1.glowSigma)(glow, laid.fontPx),
                };
            });
            const takes = (0, stage_layout_1.layoutTakes)({ W, H, count, layout: takeLayout, borderPx: num(props.borderPx, 6, 0, 40) });
            const slots = takeInputs.map((t, i) => ({
                propKey: `take${t.n}`,
                trimKey: `take${t.n}TrimSec`,
                framingKey: `take${t.n}Framing`,
                ...(t.path && t.kind ? { clip: { path: t.path, mediaType: t.kind } } : {}),
                trimStartMs: t.trimMs,
                framing: t.framing,
                placeholder: { color: PLACEHOLDER_COLORS[i], label: `Take ${t.n} - drop a clip here` },
            }));
            const lines = [];
            if (design) {
                const advisory = (0, platform_emit_1.durationAdvisory)(platform, durationMs);
                if (advisory)
                    lines.push(advisory);
                if (font.warning)
                    lines.push(font.warning);
                lines.push(...notes);
                if (missing.length > 0) {
                    // A character the advisory's own face cannot draw is named by code point (advisory.ts).
                    lines.push(`This font has no ${missing.map(advisory_1.nameChar).join(" ")}; those draw as boxes.`);
                }
                if (props.showGuide !== false && !(0, platform_emit_1.guideFitsCanvas)(W, H)) {
                    lines.push(`The ${platform.label} guide is drawn for a 9:16 canvas; this one is ${W}x${H}, so it is hidden.`);
                }
            }
            return (0, document_1.buildLyricStack)({
                W,
                H,
                fps,
                durationMs,
                takes,
                slots,
                pages: stackPages,
                style: {
                    textColor: textColor,
                    glow,
                    glowColor: glowColor,
                    borderColor: borderColor,
                    entrance,
                },
                clearPngPath: exports.CLEAR_PNG,
                ...(songPath
                    ? { song: { path: songPath, mediaType: (0, template_utils_1.determineMediaType)(songPath, ctx), clipStartMs: songStartMs } }
                    : {}),
                ...(design
                    ? {
                        guide: {
                            ...(props.showGuide !== false
                                ? { png: { path: (0, platform_emit_1.guidePng)(platform), tiles: (0, platform_emit_1.guideTiles)(platform, W, H) } }
                                : {}),
                            lines,
                            stage,
                        },
                    }
                    : {}),
                output: (0, platform_emit_1.audioPolicy)({ masterAudio: props.masterAudio === true, multi: knob === "all" }),
            }).doc;
        };
        return (0, platform_emit_1.emitForPlatforms)(knob, fps, build);
    },
});
exports.default = exports.LyricStackV1;
