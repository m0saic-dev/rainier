#!/usr/bin/env node
/**
 * Loader-contract self-check for the BUILT artifacts (dist/ + manifest).
 * Run `npm run build` first — neither file is committed in this scaffold.
 *
 * Tier A (default) — pure Node, fork-safe: verifies the things
 * `loadTemplateRepoFromPath` will verify, without needing the @m0saic
 * substrate on disk at check time:
 *   1. package.json is not "type":"module" and `main` points at a real file.
 *   2. template-manifest.json parses; schemaVersion 1 at both levels;
 *      repoId matches the manifest (derived from src/repo.ts); entryModule exists; every preview path
 *      exists; every templateKey matches <repoId>/<pack>/<slug>/vN
 *      with a declared pack and a real src/<pack>/ folder.
 *   3. The entry is genuinely CommonJS: a bare require() must succeed
 *      (an ESM build throws ERR_REQUIRE_ESM — that IS the CJS gate).
 *      Substrate imports are satisfied by tools/stub-substrate.cjs.
 *   4. The entry exports `repo` (repoId/displayName/schemaVersion) and
 *      `templates[]` (or getTemplates()); ids are unique, well-formed,
 *      prefix-correct; every template has a `version` and a `render`
 *      function; no undefined holes (the barrel-file trap).
 *   5. Manifest templateKeys set === live template ids set.
 *
 * Tier B (--deep) — author mode (node_modules present): same checks with
 * the REAL substrate (no stubs), then loads the repo through the actual
 * `loadTemplateRepoFromPath` from @m0saic/platform and fails on any
 * error-severity diagnostic or an ESM partial-reload warning.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEEP = process.argv.includes("--deep");
// The id namespace is read from the manifest's own repo descriptor (which
// the generator derives from src/repo.ts) — a fork renames itself in ONE
// file and this gate follows.
const escapeRe = (v) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const keyReFor = (repoId) =>
  new RegExp(`^${escapeRe(repoId)}\\/([a-z0-9][a-z0-9-]*)\\/([a-z0-9][a-z0-9-]*)\\/v([1-9]\\d*)$`);
let STARTER_KEY_RE = /^$/; // set once the manifest's repoId is known

const problems = [];
const fail = (msg) => problems.push(msg);
const requireCjs = createRequire(pathToFileURL(path.join(ROOT, "package.json")));

/* ── 1. package.json ──────────────────────────────────────── */

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
if (pkg.type === "module") {
  fail(`package.json declares "type": "module" — the loader needs a CommonJS build`);
}
const mainRel = pkg.main ?? "dist/index.js";
const mainAbs = path.join(ROOT, mainRel);
if (!fs.existsSync(mainAbs)) {
  fail(`package.json main "${mainRel}" does not exist — run \`npm run build\` first (dist/ is not committed)`);
}

/* ── 2. template-manifest.json ────────────────────────────── */

let manifest;
const manifestPath = path.join(ROOT, "template-manifest.json");
if (!fs.existsSync(manifestPath)) {
  fail("template-manifest.json missing — run the build");
} else {
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (err) {
    fail(`template-manifest.json does not parse: ${err.message}`);
  }
}

if (manifest) {
  if (manifest.schemaVersion !== 1) {
    fail(`manifest schemaVersion is ${manifest.schemaVersion}, must be 1`);
  }
  if (manifest.repo?.schemaVersion !== 1) {
    fail(`manifest.repo.schemaVersion is ${manifest.repo?.schemaVersion}, must be 1`);
  }
  if (typeof manifest.repo?.repoId !== "string" || !/^@[a-z0-9][a-z0-9-]*$/.test(manifest.repo.repoId)) {
    fail(`manifest.repo.repoId "${manifest.repo?.repoId}" must be an @-prefixed lowercase id`);
  } else {
    STARTER_KEY_RE = keyReFor(manifest.repo.repoId);
  }
  const entryModule = manifest.entryModule ?? "./dist/index.js";
  if (!fs.existsSync(path.join(ROOT, entryModule))) {
    fail(`manifest.entryModule "${entryModule}" does not exist`);
  }
  const declaredPacks = new Set((manifest.packs ?? []).map((p) => p.id));
  for (const entry of manifest.templates ?? []) {
    const key = String(entry.templateKey ?? "");
    const m = STARTER_KEY_RE.exec(key);
    if (!m) {
      fail(`manifest templateKey "${key}" does not match <repoId>/<pack>/<slug>/vN`);
      continue;
    }
    if (!declaredPacks.has(m[1])) {
      fail(`manifest templateKey "${key}": pack "${m[1]}" not in manifest.packs[]`);
    }
    if (!fs.existsSync(path.join(ROOT, "src", m[1]))) {
      fail(`manifest templateKey "${key}": no src/${m[1]}/ folder`);
    }
    // EVERY template ships a preview — a browse card with a blank tile is a
    // template nobody clicks. Minting is a separate step (`npm run previews`
    // renders through the built dist), so this is checked here rather than in
    // the generator, which has to be able to build BEFORE the assets exist.
    if (!entry.preview?.image && !entry.preview?.video) {
      fail(
        `"${key}" has no preview asset. Run \`npm run build && npm run previews\`, ` +
          `then \`npm run build\` again so the manifest picks up the path.`,
      );
    }
    for (const field of ["image", "video", "poster"]) {
      const p = entry.preview?.[field];
      if (p && !fs.existsSync(path.join(ROOT, p))) {
        fail(`"${key}" preview.${field} points to missing file: "${p}"`);
      }
    }
  }
}

/* ── 3+4. require the entry, structurally verify exports ──── */

let mod;
if (fs.existsSync(mainAbs)) {
  if (!DEEP) {
    const { installStubs } = requireCjs("./tools/stub-substrate.cjs");
    installStubs();
  }
  try {
    mod = requireCjs(mainAbs);
  } catch (err) {
    if (err && err.code === "ERR_REQUIRE_ESM") {
      fail("dist entry is an ES module — the loader needs CommonJS (tsconfig module: commonjs)");
    } else {
      fail(`require(dist entry) threw: ${err && err.message ? err.message : err}`);
    }
  }
}

let liveIds = [];
if (mod) {
  const repo = mod.repo;
  if (!repo || typeof repo !== "object") {
    fail(`entry does not export "repo" (MosaicTemplateRepoDescriptor)`);
  } else {
    if (typeof repo.repoId !== "string" || !/^@[a-z0-9][a-z0-9-]*$/.test(repo.repoId)) {
      fail(`repo.repoId ${JSON.stringify(repo.repoId)} must be an @-prefixed lowercase id`);
    }
    if (typeof repo.displayName !== "string" || repo.displayName.length === 0) {
      fail("repo.displayName must be a non-empty string");
    }
    if (repo.schemaVersion !== 1) {
      fail(`repo.schemaVersion is ${repo.schemaVersion}, must be 1`);
    }
  }

  let templates = mod.templates;
  if (!Array.isArray(templates) && typeof mod.getTemplates === "function") {
    templates = mod.getTemplates();
  }
  if (!Array.isArray(templates)) {
    fail(`entry exports neither "templates" (array) nor "getTemplates()"`);
  } else {
    templates.forEach((t, i) => {
      if (t === undefined || t === null) {
        fail(`templates[${i}] is ${t} — barrel-file re-export trap (see src/index.ts note)`);
        return;
      }
      const id = t.id;
      if (typeof id !== "string" || !STARTER_KEY_RE.test(id)) {
        fail(`templates[${i}].id ${JSON.stringify(id)} does not match <repoId>/<pack>/<slug>/vN`);
        return;
      }
      liveIds.push(id);
      if (typeof t.version !== "number") fail(`"${id}" has no numeric version`);
      if (typeof t.render !== "function") fail(`"${id}" has no render() function`);
      if (!t.propsSchema || typeof t.propsSchema !== "object") {
        fail(`"${id}" has no propsSchema`);
      }
    });
    const dup = liveIds.filter((id, i) => liveIds.indexOf(id) !== i);
    for (const id of new Set(dup)) fail(`duplicate template id "${id}"`);
  }
}

/* ── 5. manifest ↔ dist agreement ─────────────────────────── */

if (manifest && liveIds.length > 0) {
  const manifestKeys = new Set((manifest.templates ?? []).map((t) => String(t.templateKey)));
  for (const id of liveIds) {
    if (!manifestKeys.has(id)) fail(`live template "${id}" missing from template-manifest.json`);
  }
  for (const key of manifestKeys) {
    if (!liveIds.includes(key)) fail(`manifest entry "${key}" has no live template in dist`);
  }
}

/* ── Tier B: the real loader ──────────────────────────────── */

async function deepCheck() {
  let templateRepos;
  try {
    // Deliberately a subpath: the platform root index excludes node:fs-using
    // modules, so the loader lives at @m0saic/platform/template-repos.
    templateRepos = requireCjs("@m0saic/platform/template-repos");
  } catch {
    fail("--deep requires the @m0saic substrate installed (sibling monorepo + npm install)");
    return;
  }
  const load = templateRepos.loadTemplateRepoFromPath;
  if (typeof load !== "function") {
    fail("@m0saic/platform/template-repos does not export loadTemplateRepoFromPath — API drift, update this check");
    return;
  }
  const result = await load(ROOT, {});
  for (const d of result.diagnostics ?? []) {
    const severity = d.severity ?? d.level ?? "";
    const code = String(d.code ?? "");
    if (severity === "error" || code.includes("ESM_RELOAD")) {
      fail(`loader diagnostic [${code}] ${d.message ?? ""}`.trim());
    }
  }
  const loadedCount = (result.templates ?? []).length;
  const manifestCount = (manifest?.templates ?? []).length;
  if (manifest && loadedCount !== manifestCount) {
    fail(`loader registered ${loadedCount} template(s), manifest lists ${manifestCount}`);
  }
}

const finish = () => {
  if (problems.length > 0) {
    console.error(`contract-check${DEEP ? " --deep" : ""}: ${problems.length} problem(s)\n`);
    for (const p of problems) console.error(`  x ${p}`);
    process.exit(1);
  }
  console.log(
    `contract-check${DEEP ? " --deep" : ""}: clean — ${liveIds.length} template(s), CJS entry, manifest agrees`,
  );
};

if (DEEP) {
  deepCheck().then(finish, (err) => {
    fail(`deep check threw: ${err && err.message ? err.message : err}`);
    finish();
  });
} else {
  finish();
}
