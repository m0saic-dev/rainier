#!/usr/bin/env node
/**
 * Mint preview assets for the Templates-page browse cards (founder-run; not CI).
 *
 * For every manifest entry without a preview image (or with --force), renders
 *   assets/templates/<templateKey with "/" -> "__">/preview.png
 * via the m0saic CLI at 1920x1080. Ids listed in ANIMATED_PREVIEW_IDS also get
 * preview.mp4 (1920x1080, the template's own length) + poster.png.
 *
 * Budgets (SOFT, 2026-09-14): preview.png > 500 KB or preview.mp4 > 5 MB prints a
 * warning and keeps the file — devs want previews that look like the product, not
 * 360p thumbnails. Trim the default props only when a warning says so.
 *
 * CLI resolution and Windows quoting: same rules as tools/smoke-render.mjs
 * (M0SAIC_CLI env override, shell spawn on win32).
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const IS_WIN = process.platform === "win32";
const FORCE = process.argv.includes("--force");

const PNG_BUDGET = 500 * 1024;
const MP4_BUDGET = 5 * 1024 * 1024;

/** Ids whose motion is the point — these also get preview.mp4 + poster.png. */
const ANIMATED_PREVIEW_IDS = new Set([
  // The front door: the field wipes in and the M assembles — the motion IS the card.
  "@rainier/basics/hello-world/v1",
  // Words landing one by one IS the template; a still can't show it.
  "@rainier/reels/lyric-triptych/v1",
]);

/** Clip dims per id; default 1920×1080 (previews look like the product). */
const CLIP_DIMS = new Map([
  // A 9:16 Reel, at a size that keeps the 12 s clip light.
  ["@rainier/reels/lyric-triptych/v1", ["720", "1280"]],
]);
/** Where to cut a from-video still, in seconds; default 0.8 (40% into the
 *  CLI's 2s default — past a leading transition, before a trailing one). A
 *  reveal that settles at the END of its clip names its own moment here. */
const STILL_AT_SEC = new Map([
  ["@rainier/basics/hello-world/v1", 2.45],
  // Page 3 once all of its words have landed.
  ["@rainier/reels/lyric-triptych/v1", 7.0],
]);
/** Ids whose still must be CUT from the mp4 rather than rendered directly.
 *  Two different reasons, both landing here:
 *
 *   1. An emit:"single" pipeline cannot produce an image AT ALL — the engine
 *      rejects it ("Image outputs are not supported for mosaic_pipeline
 *      renderables under emit:single").
 *   2. The template renders fine as an image, but the FIRST FRAME is not
 *      representative — a timed sequence has barely started at t=0, and any
 *      reveal that begins from nothing is outright blank there.
 *
 *  Needs an ffmpeg on PATH (or M0SAIC_FFMPEG), same as
 *  tools/regen-fixtures.mjs. */
const STILL_FROM_VIDEO = new Set([
  // (2) the front door: the field wipes in and the M assembles — t=0 is a
  // bare navy canvas; the card is settled only at the end of the clip.
  "@rainier/basics/hello-world/v1",
  // (2) words land over time — t=0 shows the first word only.
  "@rainier/reels/lyric-triptych/v1",
]);
const FFMPEG = process.env.M0SAIC_FFMPEG || "ffmpeg";

/** Cut one frame out of `video` into `still`, `atSec` in. */
function frameFromVideo(video, still, atSec, label) {
  const result = spawnSync(
    FFMPEG,
    ["-y", "-hide_banner", "-loglevel", "error", "-ss", String(atSec), "-i", video, "-frames:v", "1", still],
    { stdio: "pipe", encoding: "utf8" },
  );
  if (result.error && result.error.code === "ENOENT") {
    console.error(`x ${label}: ffmpeg not found ("${FFMPEG}"). Set M0SAIC_FFMPEG.`);
    return false;
  }
  if (result.status !== 0) {
    console.error(`x ${label}`);
    if (result.stderr) console.error(result.stderr.trim());
    return false;
  }
  return true;
}

/** emit:"multi" templates write `{base}-{step}.{ext}`, never `{base}.{ext}` —
 *  so a preview has to name the step it wants and move it into place. */
const MULTI_OUTPUT_STEP = new Map([
]);

/** Per-id preview canvas when 1920x1080 misrepresents the template — or
 *  (media units showing real video frames) busts the PNG budget. */
const PREVIEW_DIMS = new Map([
]);

/** Per-id overrides when the default flags don't fit (e.g. multi-output
 *  pipelines, or media units whose default props render the pick-a-file
 *  prompt — previews use the repo's committed fixtures instead, absolutized
 *  against the repo root so ffmpeg's workspace cwd can't lose them).
 *  url-asset stays on defaults on purpose (its explainer is offline-safe). */
const FX = (rel) => path.join(ROOT, rel).split(path.sep).join("/");
const PROPS = (obj) => JSON.stringify(obj);
const PREVIEW_OVERRIDES = new Map([
]);

function resolveCli() {
  const env = process.env.M0SAIC_CLI;
  if (env && env.trim().length > 0) {
    if (env.endsWith(".js")) return { cmd: process.execPath, prefix: [env] };
    return { cmd: env, prefix: [] };
  }
  return { cmd: "m0saic", prefix: [] };
}

function quoteArg(arg) {
  if (!IS_WIN) return arg;
  return /[\s"@()^&|<>]/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg;
}

function runCli(args, label) {
  const { cmd, prefix } = resolveCli();
  const full = [...prefix, ...args];
  const result = IS_WIN
    ? spawnSync([cmd, ...full.map(quoteArg)].join(" "), { shell: true, stdio: "pipe", encoding: "utf8" })
    : spawnSync(cmd, full, { stdio: "pipe", encoding: "utf8" });
  if (result.error && result.error.code === "ENOENT") {
    console.error(`gen-previews: cannot find the m0saic CLI. Set M0SAIC_CLI or install it.`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`x ${label}`);
    if (result.stdout) console.error(result.stdout.trim());
    if (result.stderr) console.error(result.stderr.trim());
    return false;
  }
  return true;
}

function enforceBudget(file, budget, label) {
  if (!fs.existsSync(file)) {
    // Not a no-op: a CLI that "succeeded" while writing its output somewhere
    // else (encodes renaming the master, emit:"multi" step suffixes) used to
    // slip through here and report a preview that does not exist.
    console.error(`x ${label}: the CLI exited 0 but ${path.basename(file)} was never written.`);
    return false;
  }
  const size = fs.statSync(file).size;
  if (size <= budget) return true;
  // Soft budget: keep the file, say so. A preview that looks like the product
  // beats a small one; the number is a nudge, not a gate.
  console.warn(
    `! ${label}: ${(size / 1024).toFixed(0)} KB is over the ${(budget / 1024).toFixed(0)} KB soft budget — kept. ` +
      "Simplify the default props or add a PREVIEW_OVERRIDES entry if the corpus is getting heavy.",
  );
  return true;
}

const manifest = JSON.parse(
  fs.readFileSync(path.join(ROOT, "template-manifest.json"), "utf8"),
);

let minted = 0;
let skipped = 0;
let failures = 0;

for (const entry of manifest.templates ?? []) {
  const key = String(entry.templateKey);
  const encoded = key.replace(/\//g, "__");
  const dir = path.join(ROOT, "assets", "templates", encoded);
  const png = path.join(dir, "preview.png");
  const fromVideo = STILL_FROM_VIDEO.has(key);

  // Order matters for `fromVideo` ids: the mp4 is the SOURCE of their still,
  // so it has to be on disk before the still branch runs.
  if (ANIMATED_PREVIEW_IDS.has(key)) {
    const mp4 = path.join(dir, "preview.mp4");
    if (!fs.existsSync(mp4) || FORCE) {
      fs.mkdirSync(dir, { recursive: true });
      // PREVIEW_OVERRIDES apply here too. For a `fromVideo` id this mp4 IS
      // the source of the still, so omitting them meant an override was
      // silently ignored for exactly the templates that most need one.
      const mp4Extra = PREVIEW_OVERRIDES.get(key) ?? [];
      // No duration flag — the CLI's 2s default is exactly the preview length.
      const okMp4 = runCli(
        ["make", key, "--template-repo", ROOT, "-w", ...(CLIP_DIMS.get(key) ?? ["1920", "1080"]).flatMap((v, i) => (i === 0 ? [v] : ["-h", v])), "-o", mp4, "--quiet", ...mp4Extra],
        `preview.mp4 ${key}`,
      );
      if (!okMp4 || !enforceBudget(mp4, MP4_BUDGET, `preview.mp4 for ${key}`)) failures += 1;
    }
  }

  if (fs.existsSync(png) && !FORCE) {
    skipped += 1;
  } else if (fromVideo) {
    // 40% in: past a leading transition, before a trailing one.
    fs.mkdirSync(dir, { recursive: true });
    const mp4 = path.join(dir, "preview.mp4");
    const ok =
      fs.existsSync(mp4) && frameFromVideo(mp4, png, STILL_AT_SEC.get(key) ?? 0.8, `preview.png for ${key} (from preview.mp4)`);
    if (ok && enforceBudget(png, PNG_BUDGET, `preview.png for ${key}`)) {
      minted += 1;
      console.log(`  ok preview ${key} (cut from preview.mp4)`);
    } else {
      failures += 1;
    }
  } else {
    fs.mkdirSync(dir, { recursive: true });
    const extra = PREVIEW_OVERRIDES.get(key) ?? [];
    const [w, h] = PREVIEW_DIMS.get(key) ?? ["1920", "1080"];
    const step = MULTI_OUTPUT_STEP.get(key);
    let ok = runCli(
      ["make", key, "--template-repo", ROOT, "-w", w, "-h", h, "--format", "image", "-o", png, "--quiet", ...extra],
      `preview ${key}`,
    );
    if (ok && step !== undefined) {
      // The run wrote preview-<step>.png (and its siblings). Keep the named
      // one as the preview, drop the rest.
      const wanted = png.replace(/\.png$/, `-${step}.png`);
      if (!fs.existsSync(wanted)) {
        console.error(`x preview ${key}: expected step output ${path.basename(wanted)} — check MULTI_OUTPUT_STEP.`);
        ok = false;
      } else {
        fs.renameSync(wanted, png);
        for (const sibling of fs.readdirSync(dir)) {
          if (/^preview-.+\.png$/.test(sibling)) fs.rmSync(path.join(dir, sibling));
        }
      }
    }
    if (ok && enforceBudget(png, PNG_BUDGET, `preview.png for ${key}`)) {
      minted += 1;
      console.log(`  ok preview ${key}`);
    } else {
      failures += 1;
    }
  }

  if (ANIMATED_PREVIEW_IDS.has(key)) {
    const mp4 = path.join(dir, "preview.mp4");
    const poster = path.join(dir, "poster.png");
    if (fromVideo) {
      if (!fs.existsSync(poster) || FORCE) {
        const okPoster =
          fs.existsSync(mp4) && frameFromVideo(mp4, poster, STILL_AT_SEC.get(key) ?? 0.8, `poster.png for ${key}`);
        if (!okPoster || !enforceBudget(poster, PNG_BUDGET, `poster.png for ${key}`)) failures += 1;
      }
    } else if (!fs.existsSync(poster) || FORCE) {
      const okPoster = runCli(
        ["make", key, "--template-repo", ROOT, "-w", ...(CLIP_DIMS.get(key) ?? ["1920", "1080"]).flatMap((v, i) => (i === 0 ? [v] : ["-h", v])), "--format", "image", "-o", poster, "--quiet"],
        `poster.png ${key}`,
      );
      if (!okPoster || !enforceBudget(poster, PNG_BUDGET, `poster.png for ${key}`)) failures += 1;
    }
  }
}

console.log(`\ngen-previews: minted ${minted}, skipped ${skipped} existing, ${failures} failure(s)`);
console.log("gen-previews: re-run `npm run build` so the manifest picks up new preview paths.");
if (failures > 0) process.exit(1);
