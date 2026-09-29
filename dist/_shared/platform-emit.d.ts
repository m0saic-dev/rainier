import type { MosaicAudioConfig, MosaicDocument, MosaicDocumentPipeline, MosaicOutputFormat } from "@m0saic/types";
import type { GuideRegionName } from "./platform-guide-regions";
import type { Rect, ShortPlatform, ShortPlatformId } from "./platforms";
/**
 * Platform emission: one flat document for one platform, or an `emit:"multi"`
 * pipeline with one file per platform; the audio/container policy; the
 * duration advisory; the guide PNG path and the tiles that show it.
 *
 * FROZEN ONCE SHIPPED (see `platforms.ts`). A change is a copy beside the
 * template version that needs it.
 *
 * FAN-OUT (`emitForPlatforms(knob, fps, build)`)
 *
 *   knob = one platform  ->  build(row), returned untouched: a flat document.
 *   knob = "all"         ->  {
 *       kind: "mosaic_pipeline", version: 1, emit: "multi", fps,
 *       steps: [ { name: slug, label: slug, durationMs, file: build(row) }, ... ]
 *     }  one step per platform in SHORT_PLATFORMS order: reels, tiktok, shorts.
 *
 *   `build` stamps everything the file needs: `size` (use the row's canvas or
 *   the target), `format` + `audio` (spread `audioPolicy(...)`), and
 *   `durationMs`. A pipeline step REQUIRES an exact positive integer
 *   `durationMs` (the engine rejects a step without one), so under "all" each
 *   step takes its file's `durationMs`, rounded; a file without one is a
 *   template bug and throws here, where the template's own test finds it.
 *   Per-file durations mean a platform may be cut shorter than another.
 *
 *   Under emit:"multi" every step is its own deliverable: the engine plans it
 *   as a root render at its own `size` and resolves its own `format` and
 *   `audio`, and Desktop names the files `<base>-<label>.<ext>`. Never
 *   `encodes`: that is a codec axis that re-encodes from an AAC master.
 *
 *   Design mode: pass the ONE platform the artist is looking at. The design
 *   surface is always one flat document; only the export fans out.
 *
 * AUDIO (`audioPolicy({ masterAudio, multi })`), exactly what the file ships:
 *
 *   default                  mp4, AAC 320k, 48 kHz stereo
 *   masterAudio, one file    mov + ProRes (prores_ks, yuv422p10le), PCM 24-bit, 48 kHz stereo
 *   multi (any masterAudio)  mp4, AAC 320k, 48 kHz stereo: masterAudio is honoured on a
 *                            single-platform export only (founder decision, plan section 2)
 *
 *   Why AAC 320k also holds under "all": in the 0.2.x engine (unchanged in
 *   the 0.3.0 tree) an emit:"multi" pipeline skips the stitch entirely and each
 *   step's final render is the deliverable, muxed with that step's own
 *   `doc.audio` (packages/core/src/core/buildMosaicPlanFromFile.ts: per-step
 *   format at 986, the step planned as a root at 1036, the multi return before
 *   any stitch at 1144; buildChunkCommands.ts:372 `flatRenderIsDeliverable`;
 *   ffmpegCommands.ts:469 `deliverableAudioMuxArgs`, used at 1921). The
 *   hard-coded AAC 192k in buildMosaicPlanFromFile.ts (1500, 1684, 1840) is the
 *   emit:"single" duration-fit, concat and xfade passes, which a multi export
 *   never runs. A plan-only probe of an emit:"multi" pipeline (a nested child
 *   plus a real audio input) showed `-c:a aac -b:a 320k` on one step and
 *   `-c:a pcm_s24le` + `prores_ks yuv422p10le` on another.
 *
 *   Where AAC 192k DOES bite, flat or multi: a nested child document renders
 *   to an internal carrier at AAC 192k (ffmpegCommands.ts:1930), so audio that
 *   lives inside a child passes through a lossy generation before the final
 *   encode. Keep the song on the ROOT document.
 *
 *   Why not the "alpha-mov" preset's pixel format (`yuva444p10le`): a Lyric
 *   Stack frame is opaque (document.backgroundColor), and an alpha pixel
 *   format makes the engine treat the render as alpha-bearing, which moves the
 *   final mov to its alpha intermediate codec (qtrle / argb) instead of ProRes.
 *   `yuv422p10le` is ProRes 422's native format; the engine's own default for
 *   mov (`yuv420p`) is one prores_ks cannot encode.
 */
/** A single platform, or every platform as one multi-file export. */
export type PlatformKnob = ShortPlatformId | "all";
export type AudioPolicyInput = {
    /** The artist asked for the master: MOV + 24-bit PCM. */
    masterAudio?: boolean;
    /** The export fans out to several files (`emitForPlatforms(..., "all")`). */
    multi?: boolean;
};
export type AudioPolicy = {
    format: MosaicOutputFormat;
    audio: MosaicAudioConfig;
};
/**
 * One platform: `build(row)` untouched. `"all"`: an emit:"multi" pipeline,
 * one step per platform (reels, tiktok, shorts), each named and labelled by
 * slug. An unknown knob resolves like `resolveShortPlatform` (the default
 * platform). Throws only when `build` returns a file without a usable
 * `durationMs` under `"all"`.
 */
export declare function emitForPlatforms(knob: PlatformKnob, fps: number, build: (platform: ShortPlatform) => MosaicDocument): MosaicDocument | MosaicDocumentPipeline;
/** The container and audio a file ships with. Fresh objects on every call. */
export declare function audioPolicy({ masterAudio, multi }: AudioPolicyInput): AudioPolicy;
/**
 * Plain words when the clip is longer than the platform accepts
 * ("Reels stop at 3:00 - this clip is 3:24."), else null. The clip length
 * rounds UP to the second, so a clip that is over never reads as equal.
 * Design-only text; never blocking. ASCII only.
 */
export declare function durationAdvisory(platform: ShortPlatform, durationMs: number): string | null;
/**
 * The platform's design-mode guide: `assets/<slug>-ui.png` beside this file
 * (1080x1920 RGBA, baked by tools/bake-platform-ui.mjs; `copy-assets` mirrors
 * it into dist). Returns the path only; whether the file exists is the
 * baker's job.
 */
export declare function guidePng(platform: ShortPlatform): string;
/** One tile of a platform guide: the PNG region it crops, and where it sits on the canvas. */
export type GuideTile = {
    name: GuideRegionName;
    /** The crop, in guide-PNG px: the tile's `placement.sourceRect`. */
    sourceRect: Rect;
    /** Where the crop is painted, canvas px. */
    rect: Rect;
};
/** How far a canvas's aspect may stray from the guide PNG's 9:16 before the guide is left out (a fraction). */
export declare const GUIDE_ASPECT_TOLERANCE = 0.01;
/**
 * True when a `W` x `H` canvas has the guide PNG's shape (9:16, within
 * GUIDE_ASPECT_TOLERANCE). The guide is a phone screen: on another shape its
 * regions would stretch one way, and each `cover` crop would cut its drawing.
 */
export declare function guideFitsCanvas(W: number, H: number): boolean;
/**
 * The platform's design-mode guide as one tile per region of its PNG (see
 * `platform-guide-regions.ts`): each tile crops its region
 * (`placement.sourceRect`, PNG px) and covers only that part of the canvas,
 * so the guide hugs the app's chrome and never becomes a full-canvas click
 * target over the words. A region lands on the canvas at the same fractions
 * of W and H it has of the PNG; its EDGES are rounded (not its size), so
 * neighbours stay flush at any canvas. A region that rounds to nothing is
 * left out. Show each tile with `fit: "cover"` (a `contain` crop leaves seams
 * between flush thin tiles). No tiles at all on a canvas that is not 9:16
 * (`guideFitsCanvas`): say so instead.
 */
export declare function guideTiles(platform: ShortPlatform, W: number, H: number): GuideTile[];
