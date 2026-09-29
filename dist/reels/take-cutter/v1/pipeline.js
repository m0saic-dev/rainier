"use strict";
/**
 * One pipeline step per take.
 *
 * A valid take is a hermetic one-cell document (m0 `1`, its own asset
 * manifest) whose one source is the video cut with the engine's playback
 * primitive (`clipStartMs` + `clipDurationMs`, `loopMode: "cut"`). The media
 * source is BOUND to the `source` prop in every step, so in Make any take is
 * a drop target for a new video. Camera audio is kept (the source's own
 * track, in sync) unless `muteAudio`: then the source is disabled in the mix
 * AND the document says `audio.mode: "off"`, which is what actually strips
 * the track (a source-level mute alone ships a silent one).
 *
 * An invalid take becomes an error step IN PLACE, at the same size as its
 * siblings, so names stay positional and one bad take never sinks the batch.
 * Order is the artist's, never sorted.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TAKE_FORMAT = exports.SOURCE_PROP = exports.ERROR_STEP_MS = void 0;
exports.labelFor = labelFor;
exports.buildTakeSteps = buildTakeSteps;
const types_1 = require("@m0saic/types");
const dsl_stdlib_1 = require("@m0saic/dsl-stdlib");
const template_utils_1 = require("@m0saic/template-utils");
const plan_1 = require("./plan");
/** Length of an error step (a take that could not be cut). */
exports.ERROR_STEP_MS = 1000;
/** The prop every step's media cell is bound to. */
exports.SOURCE_PROP = "source";
/** mp4 only: no format prop, so no extension-mismatch failure. */
exports.TAKE_FORMAT = { kind: "video", container: "mp4" };
const TITLE = "Take Cutter";
const LETTERBOX = "#000000";
/** The label a take's file carries: its own name, else the prefix, else the video's name. */
function labelFor(take, knobs, videoName, startMs, endMs) {
    return (0, plan_1.takeLabel)((0, plan_1.labelBase)([take.label, knobs.namePrefix, videoName]), startMs, endMs);
}
function buildTakeSteps(args) {
    const { sourcePath, videoName, knobs } = args;
    const verdicts = (0, template_utils_1.normalizeTimeRanges)(args.takes, args.sourceDurationMs);
    const size = (0, plan_1.takeSize)(args.source, knobs.frame, knobs.maxWidth);
    const focus = (0, plan_1.coverFocus)(args.source, knobs.frame, knobs.framing);
    const assetKey = (0, template_utils_1.slugifyAssetKeyFromPath)(sourcePath);
    return verdicts.map((verdict, i) => {
        if (!verdict.ok) {
            const label = labelFor(verdict.range, knobs, videoName, verdict.range.startMs, verdict.range.endMs);
            const file = {
                ...(0, template_utils_1.makeErrorMosaic)(`Take ${i + 1} could not be cut: ${verdict.reason}. Open Takes and mark it again.`, {
                    title: TITLE,
                    width: size.width,
                    height: size.height,
                }),
                format: { ...exports.TAKE_FORMAT },
            };
            return { name: (0, plan_1.rangeStepName)(i, label), label, durationMs: exports.ERROR_STEP_MS, file };
        }
        const { startMs, endMs } = verdict;
        const label = labelFor(verdict, knobs, videoName, startMs, endMs);
        const assetId = (0, types_1.asAssetId)(assetKey);
        const media = {
            type: "media",
            mediaType: "video",
            assetId,
            // As filmed, the cell has the video's own aspect (up to even-rounding),
            // so cover is an exact fit; vertical crops on one axis at the focus.
            placement: { fit: "cover", ...focus },
            playback: { clipStartMs: startMs, clipDurationMs: endMs - startMs, loopMode: "cut" },
            ...(knobs.muteAudio ? { audio: { enabled: false } } : {}),
            editor: { owner: "template", label: `take-${i + 1}` },
        };
        const file = {
            kind: "mosaic_document",
            version: 1,
            m0: (0, dsl_stdlib_1.toM0String)("1", TITLE),
            assets: { [assetId]: { kind: "file", path: sourcePath, mediaType: "video" } },
            sources: [(0, template_utils_1.bindProp)(media, exports.SOURCE_PROP)],
            size: { ...size },
            backgroundColor: (0, template_utils_1.solidBackground)(LETTERBOX),
            format: { ...exports.TAKE_FORMAT },
            ...(knobs.muteAudio ? { audio: { mode: "off" } } : {}),
        };
        return { name: (0, plan_1.rangeStepName)(i, label), label, durationMs: endMs - startMs, file };
    });
}
