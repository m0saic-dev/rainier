#!/usr/bin/env node
// check-freeze — the Rainier template freeze, enforced.
//
// A template that has shipped (committed, and released on an m0saic line) is
// frozen: its files never change again — a fix is a new vN+1 folder beside
// it, and the old one is deprecated (`deprecated: { replacement }`, set from
// the pack barrel so the frozen file itself never moves), never edited. This
// script is the machinery behind that sentence:
//
//   node tools/check-freeze.mjs                     the gate (build / CI): exit 1 if a
//                                                   frozen file changed or vanished, or a
//                                                   new file landed in a frozen template
//   node tools/check-freeze.mjs --require-complete  …and exit 1 if any frozen-shaped
//                                                   file is not in the manifest yet
//   node tools/check-freeze.mjs --staged            the commit-time gate: judges the git
//                                                   INDEX against the manifest at HEAD.
//                                                   `npm run check:freeze:staged`, and the
//                                                   pre-commit hook in tools/githooks/
//                                                   once a clone opts in (once per clone):
//                                                   git config core.hooksPath tools/githooks
//   node tools/check-freeze.mjs --update --tag 0.3.0
//                                                   mint frozen.manifest.json from what is
//                                                   COMMITTED at HEAD (a release act —
//                                                   founder only, never an agent's)
//
// Ported from the one-a-day repo's tools/check-freeze.mjs. What differs here:
//   - lines, never dates. `shipped` maps each frozen template folder to the
//     m0saic LINE it shipped at ("0.2.0"); `release` is the line of the mint
//     that wrote the manifest. The 0.3.0 conventions audit compares them as
//     semver, so "2026-09-20" would read as 2026.0.0 and lag nothing: --update
//     refuses any other --tag, and the gate refuses a manifest that carries one
//     (tools/freeze-manifest.mjs).
//   - a re-mint KEEPS every frozen folder's line and stamps --tag only on the
//     folders it freezes for the first time: the triptych frozen at 0.2.0 stays
//     0.2.0 through the 0.3.0 mint, so its 0.3.0 lag stays lag. A --tag older
//     than the manifest's release is refused (lines only move forward).
//   - the mint hashes HEAD, not the working tree: it lists files with
//     `git ls-tree HEAD` and hashes `git show HEAD:<path>`, so untracked or
//     uncommitted work in the tree can never be frozen by accident.
//   - the mint is additive: a file the previous manifest froze must still be at
//     HEAD with the same bytes, and a folder keeps its line, or the mint refuses
//     (re-minting cannot bless an edit). "Previous" is the manifest in the tree
//     AND the one committed at HEAD; a manifest committed at HEAD but missing
//     from the tree is refused, never re-minted over.
//   - no manifest yet = nothing frozen yet: the gate says so and exits 0 — unless
//     HEAD has one, in which case the tree lost it and the gate fails closed.
//
// Node built-ins only, on purpose: CI can run THIS file on a bare clone, the
// same way it runs tools/contract-check.mjs.
//
// WHAT IS FROZEN. Every non-test `.ts` under src/ whose path has a `/vN/` or
// `_shared` segment (a shipped template and the helpers it shares), everything
// under src/ they reach through relative imports, and every render-time asset:
// any file under an `assets/` folder below a `vN` or `_shared` segment (the
// guide PNGs, the bundled fonts — tools/copy-assets.mjs ships every assets/
// folder into dist/). NOT frozen: tests (`*.test.ts` never reach dist/ — a test
// may be tightened without touching what shipped), dotfiles, src/__testutils__/,
// the pack registries and barrels (src/<pack>/registry.ts, src/<pack>/index.ts —
// deprecation and relabelling are set there), src/repo.ts, src/index.ts,
// src/template-registry.ts, src/registry-types.ts, the manifest generator — the
// files a new template has to touch to exist (NEVER_FROZEN_FILES; the import
// closure stops there) — and the `.layout.m0` fingerprint beside a template
// (it has its own gate in check-registry).
//
// HOW IT HASHES (hashVersion 2). sha256. Text files (.ts, .md, .txt, .json,
// .svg, …) with CRLF/CR normalized to LF; every other file (PNG, TTF, …) over
// its raw bytes. No comment-stripping: a comment edit to a frozen file is a
// change here (byte freeze, no tokenizer to drift). hashVersion 1 hashed .ts
// only; a v1 manifest must be re-minted (its .ts hashes carry over unchanged).
//
// Exit 0 clean · 1 freeze violated · 2 the gate could not run (fails CLOSED).
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  FREEZE_MANIFEST_FILE, assertReleaseShape, compareLines, readFreezeManifest, shippedFolderReleases, templateFolderOf, templateFoldersIn,
} from "./freeze-manifest.mjs";

export { FREEZE_MANIFEST_FILE };
export const FREEZE_HASH_VERSION = 2;
export const FROZEN_SEED_ROOTS = ["src"];
export const NEVER_FROZEN_PREFIXES = ["src/__testutils__/"];
/** Wiring a new template must touch these; they are never frozen even when a
 *  frozen template imports them (the closure stops here). */
export const NEVER_FROZEN_FILES = new Set([
  "src/repo.ts",
  "src/index.ts",
  "src/template-registry.ts",
  "src/registry-types.ts",
  "src/gen-template-manifest.ts",
]);
const NEVER_FROZEN_PACK_FILE = /^src\/[^/]+\/(registry|index)\.ts$/;
/** Hashed with CRLF/CR normalized to LF; every other extension is hashed raw. */
export const TEXT_EXTENSIONS = new Set([".ts", ".md", ".txt", ".json", ".svg", ".m0", ".csv", ".css", ".html", ".xml", ".yml", ".yaml"]);
const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_NOTE =
  "Frozen once shipped. `shipped` is the m0saic line each template folder shipped at (the conventions audit's shippedAt, compared as semver — never a date); " +
  "`release` is the line of the mint that wrote this file, and a re-mint keeps every folder's line. A hashed file never changes again — comments included " +
  "(byte hashes; render-time assets too). A fix is a new vN+1 folder; deprecate the old one from the pack barrel (`deprecated: { replacement }`) and point it " +
  "at the new id. Minted from HEAD with `node tools/check-freeze.mjs --update --tag <m0saic line>` at a release, by the founder. See AGENTS.md.";

/* ── hashing ─────────────────────────────────────────────────────────────── */

/** sha256 over text with CRLF/CR normalized to LF (source files). */
export function hashBytes(buf) {
  const text = buf.toString("utf8").replace(/\r\n?/g, "\n");
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** sha256 over the raw bytes (binaries: PNG, TTF, …). */
export function hashRaw(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

/** The hash a manifest records for `rel`: text-normalized for TEXT_EXTENSIONS, raw otherwise. */
export function hashFor(rel, buf) {
  return TEXT_EXTENSIONS.has(path.posix.extname(rel).toLowerCase()) ? hashBytes(buf) : hashRaw(buf);
}

/* ── where files come from: the working tree, or a commit ────────────────── */

const toPosix = (p) => p.split(path.sep).join("/");
const isFreezableSource = (rel) => rel.endsWith(".ts") && !rel.endsWith(".test.ts") && !rel.endsWith(".d.ts");

function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

/** The working tree under the seed roots: `{ list, has, read }` over package-relative posix paths. */
export function treeSource(packageRoot) {
  return {
    list() {
      const out = [];
      const walk = (dir) => {
        let entries;
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const e of entries) {
          const abs = path.join(dir, e.name);
          if (e.isDirectory()) walk(abs);
          else out.push(toPosix(path.relative(packageRoot, abs)));
        }
      };
      for (const root of FROZEN_SEED_ROOTS) walk(path.join(packageRoot, root));
      return out;
    },
    has(rel) {
      try { return fs.statSync(path.join(packageRoot, rel)).isFile(); } catch { return false; }
    },
    read(rel) {
      try { return fs.readFileSync(path.join(packageRoot, rel)); } catch { return undefined; }
    },
  };
}

/**
 * The files COMMITTED at `rev` under the seed roots (`git ls-tree -r`), read
 * with `git show <rev>:./<path>` — what the mint hashes, so untracked and
 * uncommitted work never enters the manifest. Paths are package-relative even
 * when the package is a subfolder of the git repo. Throws when `packageRoot`
 * is not a git checkout or `rev` does not exist.
 */
export function gitSource(packageRoot, rev = "HEAD") {
  const files = new Set();
  for (const root of FROZEN_SEED_ROOTS) {
    const out = git(["ls-tree", "-r", "--name-only", "-z", rev, "--", root], packageRoot);
    for (const rel of out.split("\0")) if (rel) files.add(rel);
  }
  return {
    list: () => [...files],
    has: (rel) => files.has(rel),
    read(rel) {
      if (!files.has(rel)) return undefined;
      return execFileSync("git", ["show", `${rev}:./${rel}`], { cwd: packageRoot, stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
    },
  };
}

/* ── the frozen set ──────────────────────────────────────────────────────── */

/**
 * A frozen SEED: a shipped template's source or a shared helper (`.ts` below
 * a `vN` or `_shared` segment), or a render-time asset (any non-dot file under
 * an `assets/` folder below such a segment).
 */
export function isFrozenSeed(rel) {
  if (!FROZEN_SEED_ROOTS.some((r) => rel.startsWith(r + "/"))) return false;
  if (rel.endsWith(".test.ts")) return false;
  const segments = rel.split("/");
  const anchor = segments.findIndex((s) => /^v\d+$/.test(s) || s === "_shared");
  if (anchor < 0) return false;
  if (isFreezableSource(rel)) return true;
  const base = segments[segments.length - 1];
  return !base.startsWith(".") && segments.slice(anchor + 1, -1).includes("assets");
}

export function isExcluded(rel, excluded) {
  if (NEVER_FROZEN_FILES.has(rel) || NEVER_FROZEN_PACK_FILE.test(rel)) return true;
  return NEVER_FROZEN_PREFIXES.some((p) => rel.startsWith(p)) || (excluded || []).some((p) => rel.startsWith(p));
}

/** Comment-free-ish import scan: `from "./x"`, `import "./x"`, `import("./x")`, `require("./x")`. */
export function relativeImportSpecifiers(src) {
  const text = src.replace(/\r\n?/g, "\n").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");
  const re = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)["']([^"']+)["']/g;
  const out = [];
  let m;
  while ((m = re.exec(text))) if (m[1].startsWith("./") || m[1].startsWith("../")) out.push(m[1]);
  return out;
}

function resolveImport(source, fromRel, spec) {
  const target = path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), spec));
  const candidates = target.endsWith(".ts") ? [target] : target.endsWith(".js") ? [target.slice(0, -3) + ".ts"] : [target + ".ts", target + "/index.ts"];
  for (const rel of candidates) {
    if (!rel.startsWith("src/")) continue;
    if (!source.has(rel)) continue;
    return isFreezableSource(rel) ? rel : undefined;
  }
  return undefined;
}

/** Every frozen file, package-relative, sorted: seeds + the import closure of
 *  their sources inside src/. Reads the working tree unless `source` says
 *  otherwise (the mint passes gitSource(root, "HEAD")). */
export function collectFrozenFiles(packageRoot, excluded = [], source = treeSource(packageRoot)) {
  const seeds = source.list().filter((rel) => isFrozenSeed(rel) && !isExcluded(rel, excluded));
  const frozen = new Set(seeds);
  const queue = seeds.filter(isFreezableSource);
  while (queue.length) {
    const rel = queue.pop();
    const buf = source.read(rel);
    if (buf === undefined) continue;
    for (const spec of relativeImportSpecifiers(buf.toString("utf8"))) {
      const dep = resolveImport(source, rel, spec);
      if (dep !== undefined && !isExcluded(dep, excluded) && !frozen.has(dep)) { frozen.add(dep); queue.push(dep); }
    }
  }
  return [...frozen].sort();
}

/* ── manifest ────────────────────────────────────────────────────────────── */

/** The manifest, or null when there is none (throws on a malformed file). */
export function readManifest(packageRoot) {
  return readFreezeManifest(packageRoot);
}

/** The manifest committed at `rev`, or null when that commit has none (throws on a malformed one). */
export function manifestAtRev(packageRoot, rev = "HEAD") {
  try { git(["cat-file", "-e", `${rev}:./${FREEZE_MANIFEST_FILE}`], packageRoot); } catch { return null; }
  let parsed;
  try { parsed = JSON.parse(git(["show", `${rev}:./${FREEZE_MANIFEST_FILE}`], packageRoot)); }
  catch (err) { throw new Error(`${FREEZE_MANIFEST_FILE} at ${rev} is not valid JSON (${err && err.message ? err.message : String(err)})`); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`${FREEZE_MANIFEST_FILE} at ${rev} must hold a JSON object`);
  return parsed;
}

const asList = (previous) => (Array.isArray(previous) ? previous : [previous]).filter(Boolean);

/**
 * A manifest over `source` (default: the working tree — the mint CLI passes
 * HEAD). `tag` is the m0saic line of this mint and must be MAJOR.MINOR.PATCH.
 * `previous` (a manifest or a list: the tree's, HEAD's) supplies the line of
 * every folder already frozen; only folders frozen for the first time get
 * `tag`. Throws when `tag` is older than a previous manifest's release.
 */
export function mintManifest(packageRoot, { tag, commit, note, excluded = [], now = new Date(), source = treeSource(packageRoot), previous = [] }) {
  const release = assertReleaseShape(tag);
  const prior = asList(previous);
  for (const p of prior) {
    if (p.release !== undefined && compareLines(release, assertReleaseShape(p.release)) < 0) {
      throw new Error(`--tag ${release} is older than the manifest's release ${p.release}: lines only move forward (a folder frozen now shipped at the line being released)`);
    }
  }
  const files = {};
  for (const rel of collectFrozenFiles(packageRoot, excluded, source)) {
    const buf = source.read(rel);
    if (buf !== undefined) files[rel] = hashFor(rel, buf);
  }
  const priorLines = prior.map((p) => shippedFolderReleases(p));
  const shipped = {};
  for (const folder of templateFoldersIn(files)) {
    shipped[folder] = priorLines.find((lines) => lines[folder] !== undefined)?.[folder] ?? release;
  }
  return {
    release,
    commit,
    mintedAt: now.toISOString(),
    note: note || DEFAULT_NOTE,
    hashVersion: FREEZE_HASH_VERSION,
    excluded: [...excluded].sort(),
    shipped,
    files,
  };
}

/**
 * A re-mint may only ADD: every file the previous manifest froze keeps its
 * hash, and every template folder it froze keeps the line it shipped at.
 */
export function additiveViolations(previous, next) {
  const lines = [];
  if (!previous || !previous.files) return lines;
  for (const [rel, hash] of Object.entries(previous.files)) {
    if (next.files[rel] === undefined) lines.push(`drops  ${rel}  (frozen at ${previous.release}; not at this commit, or excluded now)`);
    else if (next.files[rel] !== hash) lines.push(`moves  ${rel}  (frozen at ${previous.release}; its bytes changed — that is an edit to a frozen file)`);
  }
  const was = shippedFolderReleases(previous);
  let now = {};
  try { now = shippedFolderReleases(next); } catch (err) { lines.push(`unreadable shipped lines in the new manifest (${err.message})`); }
  for (const [folder, line] of Object.entries(was)) {
    if (now[folder] === undefined) continue; // its files are reported as drops above
    if (now[folder] !== line) lines.push(`restamps  ${folder}  (shipped at ${line}; the new manifest says ${now[folder]} — a template keeps the line it shipped at)`);
  }
  return lines;
}

/** Working tree vs manifest. `intruders`: frozen-shaped files that appeared
 *  inside a frozen template folder (a new file there edits what shipped). */
export function checkTree(packageRoot, manifest) {
  const report = { ok: true, unchanged: [], changed: [], deleted: [], unfrozen: [], intruders: [] };
  if ((manifest.hashVersion ?? 1) !== FREEZE_HASH_VERSION) {
    report.ok = false;
    report.hashVersionMismatch = `manifest hashVersion ${manifest.hashVersion ?? 1} != checker ${FREEZE_HASH_VERSION}`;
    return report;
  }
  const excluded = manifest.excluded || [];
  const frozenFolders = new Set(templateFoldersIn(manifest.files));
  const present = new Set(collectFrozenFiles(packageRoot, excluded));
  for (const rel of Object.keys(manifest.files)) if (!present.has(rel) && fs.existsSync(path.join(packageRoot, rel))) present.add(rel);
  for (const rel of Object.keys(manifest.files)) if (!fs.existsSync(path.join(packageRoot, rel))) report.deleted.push(rel);
  for (const rel of [...present].sort()) {
    const expected = manifest.files[rel];
    if (expected === undefined) {
      (frozenFolders.has(templateFolderOf(rel)) ? report.intruders : report.unfrozen).push(rel);
      continue;
    }
    const actual = hashFor(rel, fs.readFileSync(path.join(packageRoot, rel)));
    (actual === expected ? report.unchanged : report.changed).push(rel);
  }
  report.ok = report.changed.length === 0 && report.deleted.length === 0 && report.intruders.length === 0;
  return report;
}

/* ── the commit-time gate ────────────────────────────────────────────────── */

/** Staged entries `{ status, path }` (repo-relative), renames split, typechanges included. */
export function listStaged(repoRoot) {
  const out = git(["diff", "--cached", "--name-status", "--diff-filter=ACDMRT", "--no-renames", "-z"], repoRoot);
  const parts = out.split("\0");
  const entries = [];
  for (let i = 0; i + 1 < parts.length; i += 2) if (parts[i]) entries.push({ status: parts[i][0], path: parts[i + 1] });
  return entries;
}

/**
 * Judge the index against the manifest at HEAD. `prefix` = the package as git
 * prints paths ("" when the package is the repo root). Pure apart from git
 * reads; returns { code, lines }.
 */
export function judgeStaged(repoRoot, prefix) {
  const manifestPath = prefix + FREEZE_MANIFEST_FILE;
  let head;
  try { head = JSON.parse(git(["show", `HEAD:${manifestPath}`], repoRoot)); }
  catch {
    const wt = path.join(repoRoot, manifestPath);
    if (!fs.existsSync(wt)) return { code: 0, lines: [`no ${manifestPath} at HEAD or in the tree — nothing is frozen yet`] };
    head = JSON.parse(fs.readFileSync(wt, "utf8"));
  }
  if ((head.hashVersion ?? 1) !== FREEZE_HASH_VERSION) {
    return { code: 2, lines: [`manifest hashVersion ${head.hashVersion ?? 1} != checker ${FREEZE_HASH_VERSION} — staged files cannot be judged; re-mint at a release`] };
  }
  try { shippedFolderReleases(head); }
  catch (err) { return { code: 2, lines: [`${err.message} — staged files cannot be judged; restore the manifest from git`] }; }
  const frozenFolders = new Set(templateFoldersIn(head.files));
  const lines = [];
  let violated = false;
  for (const { status, path: p } of listStaged(repoRoot)) {
    if (!p.startsWith(prefix)) continue;
    const rel = p.slice(prefix.length);
    if (rel === FREEZE_MANIFEST_FILE) {
      if (status === "D") { violated = true; lines.push(`DELETED  ${p}  (the freeze manifest is law; removing it is not a change, it is a release re-mint)`); continue; }
      let next;
      try { next = JSON.parse(git(["show", `:${p}`], repoRoot)); } catch { violated = true; lines.push(`unreadable staged ${p}`); continue; }
      if (!next || typeof next.files !== "object" || next.files === null) { violated = true; lines.push(`staged ${p} has no "files" map`); continue; }
      for (const l of additiveViolations(head, next)) {
        violated = true;
        lines.push(`manifest ${l}  (frozen files and their lines are additive-only; a re-mint only adds)`);
      }
      continue;
    }
    const expected = head.files?.[rel];
    if (expected === undefined) {
      // not frozen: new work — unless it is a frozen-shaped file landing inside a frozen template
      if (status !== "D" && isFrozenSeed(rel) && frozenFolders.has(templateFolderOf(rel))) {
        violated = true;
        lines.push(`added  ${p}  (inside ${templateFolderOf(rel)}/, a frozen template — a new file there changes what shipped)`);
      }
      continue;
    }
    if (status === "D") { violated = true; lines.push(`DELETED  ${p}  (removing shipped behaviour)`); continue; }
    if (status === "T") { violated = true; lines.push(`typechange  ${p}  (a frozen file became something else)`); continue; }
    let staged;
    try { staged = execFileSync("git", ["show", `:${p}`], { cwd: repoRoot, stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 }); }
    catch { violated = true; lines.push(`unreadable staged ${p}`); continue; }
    if (hashFor(rel, staged) !== expected) { violated = true; lines.push(`changed  ${p}`); }
  }
  return { code: violated ? 1 : 0, lines };
}

/* ── CLI ─────────────────────────────────────────────────────────────────── */

/** "2 at 0.2.0, 3 at 0.3.0" — how many frozen templates shipped at each line. */
function linesSummary(byFolder) {
  const counts = new Map();
  for (const line of Object.values(byFolder)) counts.set(line, (counts.get(line) ?? 0) + 1);
  return [...counts.entries()].sort(([a], [b]) => compareLines(a, b)).map(([line, n]) => `${n} at ${line}`).join(", ") || "none";
}

export function main(argv, packageRootDefault = PACKAGE_ROOT) {
  const has = (f) => argv.includes(f);
  const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
  const packageRoot = val("--repo") ? path.resolve(val("--repo")) : packageRootDefault;

  if (has("--staged")) {
    let repoRoot;
    try { repoRoot = git(["rev-parse", "--show-toplevel"], packageRoot).trim(); }
    catch { console.error("[check-freeze] not a git checkout — the staged gate cannot run"); return 2; }
    const prefix = toPosix(path.relative(repoRoot, packageRoot));
    let verdict;
    try { verdict = judgeStaged(repoRoot, prefix ? prefix + "/" : ""); }
    catch (err) { console.error(`[check-freeze] ✗ the staged gate could not run: ${err.message}`); return 2; }
    const { code, lines } = verdict;
    for (const l of lines) console.error(`    ${l}`);
    if (code === 1) console.error("\n[check-freeze] ✗ FROZEN TEMPLATE MODIFIED in the index — see AGENTS.md: a fix is a new vN+1 folder; deprecate the old one.");
    else if (code === 0) console.log(`[check-freeze] ✓ staged files respect the freeze`);
    return code;
  }

  if (has("--update")) {
    const tag = val("--tag");
    try { assertReleaseShape(tag); }
    catch (err) {
      console.error(`[check-freeze] ✗ --update needs --tag <m0saic line>: ${err.message}`);
      console.error(`[check-freeze]   e.g. node tools/check-freeze.mjs --update --tag 0.3.0`);
      return 2;
    }
    const excluded = argv.flatMap((a, i) => (a === "--exclude" && argv[i + 1] ? [argv[i + 1]] : []));
    let commit;
    let source;
    try {
      commit = git(["rev-parse", "HEAD"], packageRoot).trim();
      source = gitSource(packageRoot, "HEAD");
    } catch {
      console.error("[check-freeze] ✗ the mint hashes what is COMMITTED at HEAD — this is not a git checkout with a HEAD commit. Commit the templates first.");
      return 2;
    }
    // Previous = the tree's manifest AND the one committed at HEAD: a mint is
    // additive over both, so neither a lost file nor a hand-edited one can
    // bless an edit to a frozen template.
    let inTree;
    let atHead;
    try { inTree = readManifest(packageRoot); }
    catch (err) { console.error(`[check-freeze] ✗ ${err.message} — restore it from git before minting.`); return 2; }
    try { atHead = manifestAtRev(packageRoot, "HEAD"); }
    catch (err) { console.error(`[check-freeze] ✗ ${err.message} — the committed manifest cannot be read; fix HEAD before minting.`); return 2; }
    if (!inTree && atHead) {
      console.error(`[check-freeze] ✗ ${FREEZE_MANIFEST_FILE} IS MISSING from the tree but committed at HEAD. Restore it (git checkout -- ${FREEZE_MANIFEST_FILE}); never re-mint to clear this.`);
      return 2;
    }
    const previous = [inTree, atHead].filter(Boolean);
    for (const p of previous) {
      if ((p.hashVersion ?? 1) > FREEZE_HASH_VERSION) {
        console.error(`[check-freeze] ✗ ${FREEZE_MANIFEST_FILE} was minted with hashVersion ${p.hashVersion}, newer than this checker's ${FREEZE_HASH_VERSION} — update tools/check-freeze.mjs before minting.`);
        return 2;
      }
      try { shippedFolderReleases(p); }
      catch (err) { console.error(`[check-freeze] ✗ ${err.message} — restore the manifest from git before minting.`); return 2; }
    }
    let manifest;
    try { manifest = mintManifest(packageRoot, { tag, commit, excluded, source, previous }); }
    catch (err) { console.error(`[check-freeze] ✗ refusing to mint: ${err.message}`); return 2; }
    const lost = [...new Set(previous.flatMap((p) => additiveViolations(p, manifest)))];
    if (lost.length) {
      console.error(`[check-freeze] ✗ refusing to mint: HEAD (${commit.slice(0, 7)}) no longer holds what ${FREEZE_MANIFEST_FILE} froze:`);
      for (const l of lost) console.error(`    ${l}`);
      console.error(`[check-freeze] Restore those files at HEAD; a change to a shipped template is a new vN+1 folder.`);
      return 1;
    }
    fs.writeFileSync(path.join(packageRoot, FREEZE_MANIFEST_FILE), JSON.stringify(manifest, null, 2) + "\n");
    const rels = Object.keys(manifest.files);
    console.log(`[check-freeze] ✎ minted ${FREEZE_MANIFEST_FILE} at ${manifest.release}: ${rels.length} frozen files from HEAD ${commit.slice(0, 7)}${excluded.length ? `, excluded: ${excluded.join(", ")}` : ""} — commit it.`);
    for (const [folder, line] of Object.entries(manifest.shipped)) {
      const first = !previous.some((p) => shippedFolderReleases(p)[folder] !== undefined);
      console.log(`    shipped  ${folder}  ${line}${first ? "  (frozen now)" : ""}`);
    }
    for (const rel of rels) console.log(`    frozen   ${rel}`);
    const r = checkTree(packageRoot, manifest);
    if (!r.ok) {
      console.error(`[check-freeze] ⚠ the working tree differs from HEAD for ${r.changed.length + r.deleted.length + r.intruders.length} frozen file(s); the gate will fail until they match HEAD:`);
      for (const f of r.changed) console.error(`    changed  ${f}`);
      for (const f of r.deleted) console.error(`    DELETED  ${f}`);
      for (const f of r.intruders) console.error(`    added    ${f}`);
    }
    return 0;
  }

  let manifest;
  try { manifest = readManifest(packageRoot); }
  catch (err) { console.error(`[check-freeze] ✗ ${err.message} — the freeze gate cannot run. Restore it from git.`); return 2; }
  if (!manifest) {
    let committed = false;
    try { committed = manifestAtRev(packageRoot, "HEAD") !== null; } catch { committed = true; }
    if (committed) {
      console.error(`[check-freeze] ✗ ${FREEZE_MANIFEST_FILE} IS MISSING from the tree but committed at HEAD — the freeze gate cannot run. Restore it (git checkout -- ${FREEZE_MANIFEST_FILE}); never re-mint to clear this.`);
      return 2;
    }
    console.log(`[check-freeze] ✓ no ${FREEZE_MANIFEST_FILE} — nothing is frozen yet (mint at a release: node tools/check-freeze.mjs --update --tag <m0saic line>).`);
    return 0;
  }
  try { assertReleaseShape(manifest.release); }
  catch (err) { console.error(`[check-freeze] ✗ ${FREEZE_MANIFEST_FILE}: ${err.message}`); return 2; }
  if (!manifest.files || typeof manifest.files !== "object") {
    console.error(`[check-freeze] ✗ ${FREEZE_MANIFEST_FILE} has no "files" map — the freeze gate cannot run. Restore it from git.`);
    return 2;
  }
  let byFolder;
  try { byFolder = shippedFolderReleases(manifest); }
  catch (err) { console.error(`[check-freeze] ✗ ${err.message} — the freeze gate cannot run. Restore it from git.`); return 2; }
  const r = checkTree(packageRoot, manifest);
  if (r.hashVersionMismatch) { console.error(`[check-freeze] ✗ ${r.hashVersionMismatch} — re-mint at a release`); return 2; }
  if (!r.ok) {
    console.error(`\n[check-freeze] ✗ FROZEN TEMPLATE MODIFIED — shipped on m0saic ${linesSummary(byFolder)}; someone holds their output.\n`);
    for (const f of r.changed) console.error(`    changed  ${f}`);
    for (const f of r.deleted) console.error(`    DELETED  ${f}  (removing shipped behaviour)`);
    for (const f of r.intruders) console.error(`    added    ${f}  (a new file inside ${templateFolderOf(f)}/ changes what shipped)`);
    console.error(`\n[check-freeze] A frozen template never changes — comments and assets included. Copy the template into a NEW vN+1/ folder,`);
    console.error(`[check-freeze] make the change there, and set \`deprecated: { replacement }\` on the old version from its pack barrel.`);
    console.error(`[check-freeze] (Minting is a release act: node tools/check-freeze.mjs --update --tag <m0saic line>, hashing HEAD.)\n`);
    return 1;
  }
  console.log(`[check-freeze] ✓ freeze (release ${manifest.release}; templates shipped: ${linesSummary(byFolder)}): ${r.unchanged.length} frozen files unchanged, ${r.unfrozen.length} not yet frozen (new work).`);
  if (has("--require-complete") && r.unfrozen.length) {
    console.error(`\n[check-freeze] ✗ ${r.unfrozen.length} frozen-shaped file(s) are not in the manifest — a release must freeze what it ships:`);
    for (const f of r.unfrozen) console.error(`    unfrozen  ${f}`);
    console.error(`[check-freeze] Commit them, then freeze: node tools/check-freeze.mjs --update --tag <m0saic line>, and commit the manifest.\n`);
    return 1;
  }
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
