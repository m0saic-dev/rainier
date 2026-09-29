"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TakeCutterV1 = exports.TAKE_CUTTER_MAX_TAKES = exports.TAKE_CUTTER_ID = void 0;
exports.resolveTakeCutterKnobs = resolveTakeCutterKnobs;
const types_1 = require("@m0saic/types");
const template_utils_1 = require("@m0saic/template-utils");
const bindings_1 = require("../../../_shared/bindings");
const card_1 = require("./card");
const pipeline_1 = require("./pipeline");
const plan_1 = require("./plan");
exports.TAKE_CUTTER_ID = "@rainier/reels/take-cutter/v1";
/** Takes per video (the picker's cap too). */
exports.TAKE_CUTTER_MAX_TAKES = 100;
const TITLE = "Take Cutter";
const DEFAULTS = {
    takes: [],
    frame: "source",
    framing: 0.5,
    namePrefix: "",
    muteAudio: false,
};
const propsSchema = (0, template_utils_1.definePropsSchema)({
    source: {
        type: "media",
        required: false,
        description: "Your long recording: a rehearsal, a live set, a jam. Drop it on the big tile in the preview, or pick it here.",
        meta: {
            control: { picker: "file", accept: ["video"] },
            ui: { label: "Video", order: 1, primary: true },
        },
    },
    takes: {
        type: "json",
        required: false,
        description: "The pieces you want to keep. Open Takes to play the video and mark where each take starts and ends; " +
            "give a take a name if you like. Every take becomes its own file, named with where it sits in the video " +
            "(for example chorus_01m22s-01m37s).",
        meta: {
            constraints: {
                jsonSchema: {
                    type: "array",
                    maxItems: exports.TAKE_CUTTER_MAX_TAKES,
                    items: {
                        type: "object",
                        required: ["startMs", "endMs"],
                        properties: {
                            startMs: { type: "integer", minimum: 0 },
                            endMs: { type: "integer", minimum: 1 },
                            label: { type: "string" },
                        },
                    },
                },
            },
            control: { picker: "time-ranges", videoFromProp: "source" },
            ui: { label: "Takes", order: 2, primary: true },
        },
    },
    frame: {
        type: "string",
        required: false,
        description: "As filmed: every take keeps the video's own shape and size (Lyric Stack frames it later). " +
            "Vertical: cut every take to 1080x1920 now, ready to post as it is.",
        meta: {
            constraints: { oneOf: ["source", "vertical"] },
            control: {
                options: [
                    { value: "source", label: "As filmed" },
                    { value: "vertical", label: "Vertical 9:16" },
                ],
            },
            ui: { label: "Shape", order: 3, primary: true },
        },
    },
    framing: {
        type: "number",
        required: false,
        description: "Which part of the picture stays in view when a take is cut to vertical: 0 keeps the left (or the top), " +
            "0.5 the middle, 1 the right (or the bottom).",
        meta: {
            constraints: { min: 0, max: 1 },
            control: { flavor: "slider", step: 0.05 },
            ui: { label: "Framing", order: 4, visibleWhen: { prop: "frame", equals: "vertical" } },
        },
    },
    namePrefix: {
        type: "string",
        required: false,
        description: "The first part of each file name when a take has no name of its own. Leave it empty to use the video's " +
            "file name. The take's place in the video is always added (for example live_01m22s-01m37s).",
        meta: {
            control: { placeholder: "the video's name" },
            ui: { label: "File name", order: 5 },
        },
    },
    muteAudio: {
        type: "boolean",
        required: false,
        description: "Camera sound is kept so you can check a cut by ear. Turn this on for silent takes (Lyric Stack mutes takes anyway).",
        meta: { ui: { label: "Remove camera sound", order: 6 } },
    },
    maxWidth: {
        type: "number",
        required: false,
        description: "For very big videos (4K): shrink every take to at most this many pixels wide. Never makes a take bigger. " +
            "Empty = the video's own size.",
        meta: {
            constraints: { min: 128, max: 3840 },
            control: { placeholder: "the video's own width", step: 2 },
            ui: { label: "Max width (px)", order: 7, visibleWhen: { prop: "frame", equals: "source" } },
        },
    },
});
const num = (value, fallback, min, max) => typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
/** Clamp the props into the knobs every step shares. Never throws. */
function resolveTakeCutterKnobs(props) {
    return {
        frame: props.frame === "vertical" ? "vertical" : "source",
        framing: num(props.framing, DEFAULTS.framing, 0, 1),
        muteAudio: props.muteAudio === true,
        namePrefix: typeof props.namePrefix === "string" ? props.namePrefix : "",
        ...(typeof props.maxWidth === "number" && Number.isFinite(props.maxWidth)
            ? { maxWidth: Math.round(num(props.maxWidth, 3840, 128, 3840)) }
            : {}),
    };
}
const mediaPath = (value) => typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
/** An absent or blank takes value is "no takes yet", not a parse error. */
const takesValue = (value) => value === undefined || value === null || (typeof value === "string" && value.trim() === "") ? [] : value;
exports.TakeCutterV1 = (0, template_utils_1.defineMosaicTemplate)({
    id: (0, types_1.asTemplateId)(exports.TAKE_CUTTER_ID),
    label: "03 · Take Cutter",
    version: 1,
    description: "Drop a long rehearsal video, mark the takes you want, and get every take as its own file, named with where it sits in the video. As filmed, or cut to vertical 1080x1920.",
    capabilities: { tier: "core" },
    tags: ["reels", "clips", "takes", "cut", "musicians", "creators", "rehearsal", "video", "multi-output"],
    outputHints: {
        width: 1080,
        height: 1920,
        fps: 30,
        durationMs: 20000,
        format: { kind: "video", container: "mp4" },
        note: "One mp4 per take, as long as the take, at the video's own size (or 1080x1920 when Shape is vertical).",
    },
    propsSchema,
    defaultProps: { ...DEFAULTS, takes: [] },
    ...(0, bindings_1.declareBindings)({ takes: "timing", framing: "geometry", maxWidth: "geometry" }),
    async render(rawProps, ctx) {
        var _a, _b, _c;
        const props = { ...DEFAULTS, ...(rawProps !== null && rawProps !== void 0 ? rawProps : {}) };
        const { width: W, height: H, fps, durationMs } = ctx.target;
        const canvas = { W, H, fps, durationMs };
        const fail = (message) => (0, template_utils_1.makeErrorMosaic)(message, { width: W, height: H, title: TITLE });
        const knobs = resolveTakeCutterKnobs(props);
        const raw = typeof props.source === "string" ? props.source : undefined;
        const sourcePath = mediaPath(raw);
        if (!sourcePath)
            return (0, card_1.buildOnboardingCard)(canvas, knobs.namePrefix);
        const videoName = (0, template_utils_1.buildStepNames)([sourcePath])[0];
        const shown = (0, plan_1.shortName)(videoName);
        const meta = (_b = (_a = ctx.media) === null || _a === void 0 ? void 0 : _a[(0, types_1.asAssetId)(raw)]) !== null && _b !== void 0 ? _b : (_c = ctx.media) === null || _c === void 0 ? void 0 : _c[(0, types_1.asAssetId)(sourcePath)];
        if (!meta) {
            return fail((0, template_utils_1.determineMediaType)(sourcePath, ctx) === "image"
                ? `"${shown}" is a photo. Take Cutter cuts takes out of a video: drop an mp4 or a mov.`
                : `Could not read "${shown}". Drop a video file (an mp4 or a mov).`);
        }
        if (meta.kind !== "video" || !(meta.width > 0) || !(meta.height > 0)) {
            return fail(`"${shown}" is not a video (it reads as ${meta.kind}). Take Cutter needs a video: an mp4 or a mov.`);
        }
        if (!(typeof meta.durationMs === "number" && meta.durationMs > 0)) {
            return fail(`Could not tell how long "${shown}" is. Try saving it again as an mp4.`);
        }
        const parsed = (0, template_utils_1.parseTimeRangesValue)(takesValue(props.takes));
        if (!parsed.ok)
            return fail(`The takes could not be read (${parsed.error}). Open Takes and mark them again.`);
        if (parsed.ranges.length > exports.TAKE_CUTTER_MAX_TAKES) {
            return fail(`Too many takes (${parsed.ranges.length}). The limit is ${exports.TAKE_CUTTER_MAX_TAKES} per video.`);
        }
        if (parsed.ranges.length === 0) {
            if (ctx.mode === "design") {
                return (0, card_1.buildMarkTakesCard)(canvas, {
                    sourcePath,
                    videoName,
                    source: { width: meta.width, height: meta.height, durationMs: meta.durationMs },
                    namePrefix: knobs.namePrefix,
                });
            }
            return fail("No takes marked yet. Open Takes, mark where each take starts and ends, then Make again.");
        }
        const steps = (0, pipeline_1.buildTakeSteps)({
            sourcePath,
            videoName,
            source: { width: meta.width, height: meta.height },
            sourceDurationMs: meta.durationMs,
            takes: parsed.ranges,
            knobs,
        });
        const sourceFps = typeof meta.fps === "number" && meta.fps > 0 ? Math.max(1, Math.round(meta.fps)) : undefined;
        return {
            kind: "mosaic_pipeline",
            version: 1,
            emit: "multi",
            ...(sourceFps !== undefined ? { fps: sourceFps } : {}),
            steps,
        };
    },
});
exports.default = exports.TakeCutterV1;
