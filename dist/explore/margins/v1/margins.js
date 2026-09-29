"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MarginsV1 = exports.DEFAULT_LINES = exports.PAGE_FITS = exports.PAST_MODES = exports.PAGE_TONES = exports.MARGINS_ID = void 0;
exports.resolveMarginsKnobs = resolveMarginsKnobs;
exports.resolveLineBoxes = resolveLineBoxes;
const types_1 = require("@m0saic/types");
const template_utils_1 = require("@m0saic/template-utils");
const bindings_1 = require("../../../_shared/bindings");
const platform_emit_1 = require("../../../_shared/platform-emit");
const song_window_1 = require("../../../_shared/song-window");
const document_1 = require("./document");
const marks_1 = require("./marks");
const timing_1 = require("./timing");
exports.MARGINS_ID = "@rainier/explore/margins/v1";
const TITLE = "Margins";
const HEX = /^#[0-9a-fA-F]{6}$/;
exports.PAGE_TONES = ["light", "dark"];
exports.PAST_MODES = ["keep", "clear"];
exports.PAGE_FITS = ["whole", "fill"];
const FIT_OF = { whole: "contain", fill: "cover" };
/** Five untimed placeholder lines: the defaults show marks landing one by one. */
exports.DEFAULT_LINES = Object.freeze([1, 2, 3, 4, 5].map((n) => Object.freeze({ text: `line ${n}` })));
const DEFAULTS = {
    audioStartSec: 0,
    style: "highlight",
    markColor: "#FFD83D",
    pageTone: "light",
    past: "keep",
    pageFit: "whole",
    paperColor: "#F4EFE4",
    lengthSec: 0,
    placing: true,
};
const freshLines = () => exports.DEFAULT_LINES.map((c) => ({ ...c }));
const propsSchema = (0, template_utils_1.definePropsSchema)({
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
        description: "Tap each line as it is sung. One entry per line on your page, top to bottom (the words, or just 1, 2, 3); " +
            "open the timing studio, play the recording and tap Space as each line starts. Lines you have not tapped share " +
            "the gaps evenly. Only the timing is used: the page stays yours.",
        meta: {
            constraints: {
                jsonSchema: {
                    type: "array",
                    maxItems: timing_1.MAX_LINES,
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
                    maxCues: timing_1.MAX_LINES,
                    vocabulary: {
                        item: "line",
                        media: "recording",
                        pasteHint: "One line per lyric line on your page, top to bottom (the words, or just 1, 2, 3). Only the timing is used; the page stays yours.",
                    },
                },
            },
            ui: { label: "Lines", order: 3, primary: true },
        },
    },
    audioStartSec: {
        type: "number",
        required: false,
        description: "Where in the recording this clip begins. Lines are timed against the whole recording; earlier ones are dropped.",
        meta: {
            constraints: { min: 0, max: 600 },
            control: { step: 0.05 },
            ui: { label: "Audio start (s)", order: 4 },
        },
    },
    [document_1.LINE_BOXES_PROP]: {
        type: "json",
        required: false,
        description: "Where each line sits on your page. Drag and resize each box over its line; clear this to start again.",
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
            constraints: { oneOf: [...marks_1.MARK_STYLES] },
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
        description: "Light paper (the highlighter lays over it like marker ink) or a dark screen (it glows, so light writing stays readable).",
        meta: {
            constraints: { oneOf: [...exports.PAGE_TONES] },
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
            constraints: { oneOf: [...exports.PAST_MODES] },
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
            constraints: { oneOf: [...exports.PAGE_FITS] },
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
        description: "Place boxes: show every box at once so you can drag each onto its line. Turn it off to preview the timing. The export always follows the timing.",
        meta: { ui: { label: "Place boxes", order: 13 } },
    },
});
const num = (value, fallback, min, max) => typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
const pick = (value, allowed, fallback) => typeof value === "string" && allowed.includes(value) ? value : fallback;
/** Clamp the knobs into range. Never throws: an unknown value takes the default. */
function resolveMarginsKnobs(props) {
    return {
        style: pick(props.style, marks_1.MARK_STYLES, DEFAULTS.style),
        pageTone: pick(props.pageTone, exports.PAGE_TONES, DEFAULTS.pageTone),
        past: pick(props.past, exports.PAST_MODES, DEFAULTS.past),
        fit: FIT_OF[pick(props.pageFit, exports.PAGE_FITS, DEFAULTS.pageFit)],
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
function resolveLineBoxes(value, count, canvas, content) {
    const { W, H } = canvas;
    const bands = (0, marks_1.defaultLineBoxes)(count, content).map((b) => (0, marks_1.clampBox)(b, W, H));
    if (count === 0)
        return { boxes: [], custom: false };
    const parsed = (0, template_utils_1.parseRegionsValue)(value);
    if (!parsed.ok || parsed.regions.length !== count)
        return { boxes: bands, custom: false };
    const px = (0, template_utils_1.resolveRegionsToPx)(parsed, { width: W, height: H });
    return {
        boxes: px.map((r, i) => (r.ok ? (0, marks_1.clampBox)({ x: r.x, y: r.y, w: r.w, h: r.h }, W, H) : bands[i])),
        custom: true,
    };
}
const mediaPath = (value) => typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
/** An absent or blank lines value is "no lines yet", not a parse error. */
const linesValue = (value) => value === undefined || value === null || (typeof value === "string" && value.trim() === "") ? [] : value;
/** The file name alone, shortened, ASCII (it only ever reaches an error card). */
function shownName(p) {
    const parts = p.split(/[\\/]/);
    const name = (parts[parts.length - 1] || p).replace(/[^\x20-\x7E]/g, "?");
    return name.length > 36 ? `${name.slice(0, 33)}...` : name;
}
function mediaMeta(ctx, raw, trimmed) {
    var _a, _b, _c;
    return (_b = (_a = ctx.media) === null || _a === void 0 ? void 0 : _a[(0, types_1.asAssetId)(raw)]) !== null && _b !== void 0 ? _b : (_c = ctx.media) === null || _c === void 0 ? void 0 : _c[(0, types_1.asAssetId)(trimmed)];
}
/** `#rrggbb`, the default when unset, or `null` for anything else. */
function hexOf(value, fallback) {
    const v = value === undefined || value === "" ? fallback : value;
    return typeof v === "string" && HEX.test(v) ? v : null;
}
exports.MarginsV1 = (0, template_utils_1.defineMosaicTemplate)({
    id: (0, types_1.asTemplateId)(exports.MARGINS_ID),
    label: "06 · Margins",
    version: 1,
    description: "Your handwritten lyric page, marked line by line as you sing: tap each line to the voice memo or the song and a highlighter stroke, underline or hand-drawn box lands on it. The template writes no words; the page is yours. 1080x1920.",
    capabilities: { tier: "core" },
    tags: ["explore", "lyrics", "experiment", "music", "musicians", "songwriting", "creators", "vertical", "animated"],
    outputHints: {
        width: 1080,
        height: 1920,
        fps: 30,
        durationMs: 10000,
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
    ...(0, bindings_1.declareBindings)({
        audio: "audio: an audio leaf has no pointer surface",
        lines: "timing, tapped in the studio",
        audioStartSec: "timing",
        lengthSec: "timing",
    }),
    async render(rawProps, ctx) {
        const props = { ...DEFAULTS, lines: freshLines(), ...(rawProps !== null && rawProps !== void 0 ? rawProps : {}) };
        const { width: W, height: H, fps } = ctx.target;
        const design = ctx.mode === "design";
        const fail = (message) => (0, template_utils_1.makeErrorMosaic)(message, { width: W, height: H, title: TITLE });
        const knobs = resolveMarginsKnobs(props);
        const markColor = hexOf(props.markColor, DEFAULTS.markColor);
        if (!markColor)
            return fail(`Mark colour ${JSON.stringify(props.markColor)} must be a colour like #FFD83D.`);
        const paperColor = hexOf(props.paperColor, DEFAULTS.paperColor);
        if (!paperColor)
            return fail(`Paper colour ${JSON.stringify(props.paperColor)} must be a colour like #F4EFE4.`);
        // ── lines ──────────────────────────────────────────────────────────────
        const parsed = (0, template_utils_1.parseCueTrackValue)(linesValue(props.lines));
        if (!parsed.ok)
            return fail(`The lines could not be read. Open Lines and paste them again. (${parsed.error})`);
        const cues = parsed.cues;
        if (cues.length > timing_1.MAX_LINES) {
            return fail(`Too many lines (${cues.length}). A page takes at most ${timing_1.MAX_LINES}: split it into two clips.`);
        }
        // ── the page: a probed picture, or the ruled placeholder ───────────────
        let page;
        let pageMeta;
        const pageRaw = typeof props.page === "string" ? props.page : "";
        const pagePath = mediaPath(pageRaw);
        if (pagePath) {
            pageMeta = mediaMeta(ctx, pageRaw, pagePath);
            const kind = (pageMeta === null || pageMeta === void 0 ? void 0 : pageMeta.kind) === "unknown" || !pageMeta ? (0, template_utils_1.determineMediaType)(pagePath, ctx) : pageMeta.kind;
            if (kind === "audio") {
                // Make's design pass keeps the placeholder so another file can be dropped on it.
                if (!design)
                    return fail(`"${shownName(pagePath)}" is not a picture. Drop a photo or a screenshot of your page.`);
                pageMeta = undefined;
            }
            else {
                page = { path: pagePath, mediaType: kind === "video" ? "video" : "image", fit: knobs.fit };
            }
        }
        // ── the recording: an audio-only leaf from Audio start ────────────────
        let audio;
        let recordingMs;
        const audioRaw = typeof props.audio === "string" ? props.audio : "";
        const audioPath = mediaPath(audioRaw);
        const audioStartMs = (0, song_window_1.songStartOf)(knobs.audioStartSec * 1000);
        if (audioPath) {
            const meta = mediaMeta(ctx, audioRaw, audioPath);
            const d = meta === null || meta === void 0 ? void 0 : meta.durationMs;
            recordingMs = typeof d === "number" && Number.isFinite(d) && d > 0 ? d : undefined;
            audio = { path: audioPath, mediaType: (meta === null || meta === void 0 ? void 0 : meta.kind) === "video" ? "video" : "audio", clipStartMs: audioStartMs };
        }
        // ── timing ─────────────────────────────────────────────────────────────
        const judged = (0, timing_1.judgeLines)(cues, recordingMs);
        const naturalMs = (0, timing_1.naturalDurationMs)(judged, { audioStartMs, recordingMs, lengthMs: knobs.lengthSec * 1000 });
        const durationMs = (0, template_utils_1.resolveOutputDurationMs)(ctx, { naturalMs });
        const windows = (0, timing_1.lineWindows)(judged, { audioStartMs, durationMs });
        // ── boxes: the artist's, or bands over the page ────────────────────────
        const content = page ? (0, marks_1.pageContentRect)(W, H, knobs.fit, pageMeta) : (0, marks_1.placeholderBlock)(W, H);
        const { boxes } = resolveLineBoxes(props.lineBoxes, cues.length, { W, H }, content);
        // Placing (design only): every mark on screen, no window. Otherwise each
        // line's window; a line the clip does not show keeps an invisible tile in
        // design (Make's box session needs every element) and no tile in a render.
        const placingAll = design && knobs.placing;
        const marks = windows.map((w) => {
            if (placingAll)
                return { kind: "always" };
            if (!w)
                return design ? { kind: "never" } : null;
            return { kind: "window", startMs: w.startMs, endMs: knobs.past === "keep" ? durationMs : w.endMs };
        });
        return (0, document_1.buildMargins)({
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
            output: (0, platform_emit_1.audioPolicy)({}),
        }).doc;
    },
});
exports.default = exports.MarginsV1;
