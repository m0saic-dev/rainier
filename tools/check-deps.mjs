#!/usr/bin/env node
/**
 * Starter-repo policy gate — dependency allowlist + pack lint.
 * Pure Node (no packages), so it runs on a bare clone and in CI before the
 * @m0saic substrate is installable from npm.
 *
 * Checks:
 *  1. package.json dependencies ⊆ dep-allowlist.json packages.
 *  2. Every import/require specifier in runtime source (src/**, tests
 *     excluded) is relative, an allowlisted package (subpaths included), an
 *     allowlisted builtin, or covered by a per-file exception.
 *  3. Pack lint over template-manifest.json: every templateKey lives under
 *     `<repoId>/<pack>/<slug>/vN`, its pack is declared in
 *     manifest.packs[], and maps to an existing src/<pack>/ folder.
 *  4. Curriculum lint: every declared pack id appears as a `## <pack>`
 *     heading in CURRICULUM.md (skipped with a warning until the file
 *     exists), so the human path can't silently drift from the manifest.
 *  5. NOTICE.md exists whenever third-party media ships (assets/media/bbb-*).
 *
 * Exit 0 = clean; exit 1 with a report otherwise.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const problems = [];

function fail(msg) {
  problems.push(msg);
}

const allowlist = JSON.parse(
  fs.readFileSync(path.join(ROOT, "dep-allowlist.json"), "utf8"),
);
const allowedPackages = allowlist.packages ?? [];
const allowedBuiltins = new Set(allowlist.builtins ?? []);
const exceptions = new Map(
  (allowlist.exceptions ?? []).map((e) => [e.file, new Set(e.allow ?? [])]),
);

/* ── 1. package.json dependencies ─────────────────────────── */

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
for (const dep of Object.keys(pkg.dependencies ?? {})) {
  if (!allowedPackages.includes(dep)) {
    fail(`package.json dependency "${dep}" is not in dep-allowlist.json`);
  }
}

/* ── 2. import scan over runtime source ───────────────────── */

function* walk(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) yield* walk(p);
    else yield p;
  }
}

const IMPORT_RE =
  /(?:from\s+|import\s*\(\s*|require(?:\.resolve)?\s*\(\s*)["']([^"']+)["']/g;

function isAllowedPackage(spec) {
  return allowedPackages.some((p) => spec === p || spec.startsWith(`${p}/`));
}

const srcDir = path.join(ROOT, "src");
for (const file of walk(srcDir)) {
  if (!file.endsWith(".ts") && !file.endsWith(".tsx")) continue;
  if (/\.test\.tsx?$/.test(file)) continue; // policy targets runtime code
  const rel = path.relative(ROOT, file).split(path.sep).join("/");
  const fileExceptions = exceptions.get(rel) ?? new Set();
  const text = fs.readFileSync(file, "utf8");
  for (const match of text.matchAll(IMPORT_RE)) {
    const spec = match[1];
    if (spec.startsWith(".")) continue;
    if (allowedBuiltins.has(spec)) continue;
    if (isAllowedPackage(spec)) continue;
    if (fileExceptions.has(spec)) continue;
    fail(
      `${rel}: imports "${spec}" — not allowlisted (dep-allowlist.json) and no exception covers it`,
    );
  }
}

/* ── 3. pack lint (manifest-driven) ───────────────────────── */

const escapeRe = (v) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
let STARTER_KEY_RE = /^$/; // derived from the manifest's repoId below

const manifestPath = path.join(ROOT, "template-manifest.json");
let declaredPackIds = [];
if (!fs.existsSync(manifestPath)) {
  fail("template-manifest.json missing — run the build");
} else {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const repoId = String(manifest.repo?.repoId ?? "");
  STARTER_KEY_RE = new RegExp(
    `^${escapeRe(repoId)}\\/([a-z0-9][a-z0-9-]*)\\/([a-z0-9][a-z0-9-]*)\\/v([1-9]\\d*)$`,
  );
  declaredPackIds = (manifest.packs ?? []).map((p) => p.id);
  const declared = new Set(declaredPackIds);

  for (const entry of manifest.templates ?? []) {
    const key = String(entry.templateKey ?? "");
    const m = STARTER_KEY_RE.exec(key);
    if (!m) {
      fail(
        `manifest entry "${key}" does not match <repoId>/<pack>/<slug>/vN`,
      );
      continue;
    }
    const [, packId] = m;
    if (entry.pack !== packId) {
      fail(`manifest entry "${key}": pack "${entry.pack}" != id segment "${packId}"`);
    }
    if (!declared.has(packId)) {
      fail(`manifest entry "${key}": pack "${packId}" not declared in manifest.packs[]`);
    }
    if (!fs.existsSync(path.join(ROOT, "src", packId))) {
      fail(`manifest entry "${key}": no src/${packId}/ folder`);
    }
  }

  for (const packId of declared) {
    const hasEntry = (manifest.templates ?? []).some((t) => t.pack === packId);
    if (!hasEntry) fail(`manifest.packs[] declares "${packId}" but no template uses it`);
  }
}

/* ── 4. curriculum lint ───────────────────────────────────── */

const curriculumPath = path.join(ROOT, "CURRICULUM.md");
if (fs.existsSync(curriculumPath)) {
  const curriculum = fs.readFileSync(curriculumPath, "utf8");
  for (const packId of declaredPackIds) {
    const headingRe = new RegExp(`^##\\s+\`?${packId}\`?\\b`, "m");
    if (!headingRe.test(curriculum)) {
      fail(`CURRICULUM.md has no "## ${packId}" heading for declared pack "${packId}"`);
    }
  }
} else {
  console.warn("check-deps: CURRICULUM.md not present yet — skipping curriculum lint");
}

/* ── 5. attribution notice ────────────────────────────────── */

const mediaDir = path.join(ROOT, "assets", "media");
const hasThirdPartyMedia =
  fs.existsSync(mediaDir) &&
  fs.readdirSync(mediaDir).some((f) => f.startsWith("bbb-"));
if (hasThirdPartyMedia && !fs.existsSync(path.join(ROOT, "NOTICE.md"))) {
  fail("NOTICE.md missing (Big Buck Bunny CC-BY attribution for assets/media/bbb-*)");
}

/* ── Report ───────────────────────────────────────────────── */

if (problems.length > 0) {
  console.error(`check-deps: ${problems.length} problem(s)\n`);
  for (const p of problems) console.error(`  x ${p}`);
  process.exit(1);
}
console.log("check-deps: clean (dependencies, imports, packs, curriculum, notices)");
