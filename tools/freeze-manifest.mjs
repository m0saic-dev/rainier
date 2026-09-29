// freeze-manifest — pure helpers over frozen.manifest.json, shared by
// tools/check-freeze.mjs (the freeze gate), tools/check-registry.mjs (the
// conventions gate) and the bake tools (which refuse to write into a frozen
// template). Node built-ins only, like every freeze tool here.
//
// The manifest names m0saic LINES ("0.2.0"), never dates or tags. The
// conventions audit compares them as semver against the line each rule landed
// in (template-utils compareConventionVersions): "2026-09-20" would parse as
// 2026.0.0, sit above every line, and silently report nothing as lagging. So
// the shape is checked at every seam that reads one, and a wrong one fails
// closed.
//
// Two lines live in a manifest:
//   - `shipped`: { "src/<pack>/<slug>/vN": "<line>" } — the line EACH template
//     folder shipped at. This is what the audit's `shippedAt` reads, per
//     template. A re-mint keeps every folder's line and stamps only folders it
//     freezes for the first time, so the triptych frozen at 0.2.0 stays 0.2.0
//     after the 0.3.0 mint (and its 0.3.0 lag stays lag, never a fatal error).
//   - `release`: the line of the mint that wrote the manifest (the newest line
//     in `shipped`). A manifest written before `shipped` existed has only
//     `release`; every hashed template folder then shipped at it.
import fs from "node:fs";
import path from "node:path";

export const FREEZE_MANIFEST_FILE = "frozen.manifest.json";
/** `MAJOR.MINOR.PATCH`, digits only: the m0saic line. */
export const RELEASE_PATTERN = /^\d+\.\d+\.\d+$/;

/** The parsed manifest at `<root>/frozen.manifest.json`, or null when there is none.
 *  Throws (with the path) when the file exists but is not a JSON object. */
export function readFreezeManifest(root) {
  const p = path.join(root, FREEZE_MANIFEST_FILE);
  if (!fs.existsSync(p)) return null;
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (err) {
    throw new Error(`${FREEZE_MANIFEST_FILE} is not valid JSON (${err && err.message ? err.message : String(err)})`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${FREEZE_MANIFEST_FILE} must hold a JSON object`);
  }
  return parsed;
}

/** Returns `release` when it is the m0saic line (`0.2.0`); throws otherwise. */
export function assertReleaseShape(release) {
  if (typeof release !== "string" || !RELEASE_PATTERN.test(release)) {
    throw new Error(
      `release must be the m0saic line the templates shipped at (MAJOR.MINOR.PATCH, e.g. "0.2.0"), got ${JSON.stringify(release)}. ` +
        "It is compared as semver: a date or a tag would lag nothing.",
    );
  }
  return release;
}

/** Semver-ish compare of two m0saic lines (`0.2.0` < `0.3.0` < `0.10.0`). */
export function compareLines(a, b) {
  const seg = (v) => String(v).split(".").map((n) => Number.parseInt(n, 10) || 0);
  const [a0, a1, a2] = seg(a);
  const [b0, b1, b2] = seg(b);
  return a0 - b0 || a1 - b1 || a2 - b2;
}

const SHIPPED_PATH = /^(src\/([^/]+)\/([^/]+)\/(v\d+))\//;

/**
 * The template folder a hashed path belongs to (`src/<pack>/<slug>/vN`), or
 * null for shared helpers (`src/_shared/…`, `src/<pack>/_shared/…`), folders
 * whose pack or slug starts with `_`, and anything outside a vN folder.
 */
export function templateFolderOf(rel) {
  const m = SHIPPED_PATH.exec(rel);
  if (!m || m[2].startsWith("_") || m[3].startsWith("_")) return null;
  return m[1];
}

/** Every template folder a `files` map hashes, sorted. */
export function templateFoldersIn(files) {
  const out = new Set();
  for (const rel of Object.keys(files || {})) {
    const folder = templateFolderOf(rel);
    if (folder) out.add(folder);
  }
  return [...out].sort();
}

/**
 * `{ "src/<pack>/<slug>/vN": "<line>" }` for every template folder the
 * manifest hashes: its `shipped` entry, or `release` for a manifest written
 * before `shipped` existed. Throws (fail closed) on a bad line, a hashed folder
 * with no line, a line for a folder nothing is hashed in, or a line newer than
 * the manifest's own `release`. A null manifest ships nothing.
 */
export function shippedFolderReleases(manifest) {
  if (!manifest || typeof manifest.files !== "object" || manifest.files === null) return {};
  const folders = templateFoldersIn(manifest.files);
  const out = {};
  if (manifest.shipped === undefined) {
    if (folders.length) assertReleaseShape(manifest.release);
    for (const f of folders) out[f] = manifest.release;
    return out;
  }
  const shipped = manifest.shipped;
  if (!shipped || typeof shipped !== "object" || Array.isArray(shipped)) {
    throw new Error(`${FREEZE_MANIFEST_FILE}: "shipped" must map each frozen template folder to the m0saic line it shipped at`);
  }
  const release = assertReleaseShape(manifest.release);
  for (const f of folders) {
    if (shipped[f] === undefined) throw new Error(`${FREEZE_MANIFEST_FILE}: ${f} is hashed but "shipped" names no m0saic line for it`);
    let line;
    try { line = assertReleaseShape(shipped[f]); } catch (err) { throw new Error(`${FREEZE_MANIFEST_FILE}: shipped["${f}"]: ${err.message}`); }
    if (compareLines(line, release) > 0) throw new Error(`${FREEZE_MANIFEST_FILE}: shipped["${f}"] is ${line}, newer than the manifest's release ${release}`);
    out[f] = line;
  }
  for (const k of Object.keys(shipped)) {
    if (!(k in out)) throw new Error(`${FREEZE_MANIFEST_FILE}: shipped names "${k}" but no hashed file lives in that template folder`);
  }
  return out;
}

/**
 * `Map<templateId, line>`: every hashed `src/<pack>/<slug>/vN/…` folder as
 * `<repoId>/<pack>/<slug>/vN`, with the line THAT template shipped at, sorted
 * by id. Throws like shippedFolderReleases.
 */
export function shippedReleasesFrom(manifest, repoId) {
  if (typeof repoId !== "string" || !repoId) throw new Error("shippedReleasesFrom: repoId is required (e.g. \"@rainier\")");
  const byFolder = shippedFolderReleases(manifest);
  const entries = Object.entries(byFolder).map(([folder, line]) => [`${repoId}/${folder.slice("src/".length)}`, line]);
  return new Map(entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/**
 * Template ids the manifest hashes: every `src/<pack>/<slug>/vN/…` file key
 * becomes `<repoId>/<pack>/<slug>/vN`. Unique, sorted. Shared helpers
 * (`src/_shared/…`, `src/<pack>/_shared/…`) and folders whose pack starts with
 * `_` are not templates. A null manifest ships nothing.
 */
export function shippedIdsFrom(manifest, repoId) {
  if (!manifest || typeof manifest.files !== "object" || manifest.files === null) return [];
  if (typeof repoId !== "string" || !repoId) throw new Error("shippedIdsFrom: repoId is required (e.g. \"@rainier\")");
  return templateFoldersIn(manifest.files).map((folder) => `${repoId}/${folder.slice("src/".length)}`);
}

/**
 * Why writing `absPath` would break the freeze, or null when it is free to
 * write: the path is hashed in the manifest, or it lies inside a frozen
 * template folder (a new file in a shipped template's assets/ is still an
 * edit to that template). For bake tools: call before every write.
 */
export function frozenWriteReason(root, absPath, manifest = readFreezeManifest(root)) {
  if (!manifest || typeof manifest.files !== "object" || manifest.files === null) return null;
  const rel = path.relative(root, path.resolve(absPath)).split(path.sep).join("/");
  if (manifest.files[rel] !== undefined) return `${rel} is hashed in ${FREEZE_MANIFEST_FILE}`;
  const folder = templateFoldersIn(manifest.files).find((f) => rel.startsWith(f + "/"));
  if (folder) return `${rel} is inside ${folder}/, a template frozen in ${FREEZE_MANIFEST_FILE}`;
  return null;
}
