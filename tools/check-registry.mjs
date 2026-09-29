#!/usr/bin/env node
/**
 * Build-time registry gate.
 *
 * Stage 1 — load the freshly built `templates` first-party so every template
 * passes through `defineMosaicTemplate`, the seam that enforces the
 * DEFINITION-TIME conventions: defaultProps ("a knob shows what it does"),
 * colorProps (isColor + colorPicker), noLocalPaths (no absolute paths in
 * defaults), browseSurface (description + tags), propLabels (ui.label, a
 * warning). A throw-posture violation throws here, naming the template, the
 * knobs, and the fix — the build fails before the template can load in Mosaic
 * Desktop or the CLI.
 *
 * Stage 2 — render every template at its `defaultProps` on its hinted canvas
 * and audit the RENDER-TIME conventions: rendersAtDefaults, bindingsSound
 * (every editor.binding resolves), bindingsCover (a prop drawn as text is
 * bound to its rect — a warning), svgGlyphCoverage (svg text only uses
 * characters the font has). Templates whose required inputs have no default
 * are skipped, not failed.
 *
 * Shipped templates and the conventions of their day: `frozen.manifest.json`
 * (tools/check-freeze.mjs) hashes every shipped `src/<pack>/<slug>/vN/` and
 * names the m0saic line EACH one shipped at (`shipped`, e.g. the triptych
 * "0.2.0" and Lyric Stack "0.3.0"; a manifest without `shipped` ships them all
 * at its `release`). Each id is audited with ITS OWN `{ shippedAt }`: a finding
 * from a convention that landed AFTER that line (0.3.0's bindingsDeclared /
 * canvasFill for a 0.2.0 template) comes back in `audit.lagging`, not
 * `findings` — printed one line per template, never fatal; the fix is the
 * template's next vN. A template frozen at 0.3.0 is held to 0.3.0's rules. A
 * manifest with a line that is not MAJOR.MINOR.PATCH, or a hashed folder
 * without a line, fails the gate closed (a date would compare as 2026.0.0 and
 * lag nothing). On a template-utils without `shippedAt` (0.2.0) the option is
 * ignored and nothing lags — behaviour is unchanged.
 *
 * Same gate as the m0saic monorepo's `packages/templates/tools/check-registry.mjs`.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { FREEZE_MANIFEST_FILE, assertReleaseShape, compareLines, readFreezeManifest, shippedFolderReleases, shippedReleasesFrom } from "./freeze-manifest.mjs";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.env.M0SAIC_CLI ??= "/usr/bin/false";

// `--sweep`: also render every template on the standard canvases (1080p
// landscape / portrait / square) for the `canvasEnvelope` rule. Off by
// default — a build gate renders once; the sweep is a few times the cost.
const SWEEP = process.argv.includes("--sweep");
// `--json`: one machine-readable report on stdout (every finding with its
// convention, severity, keys, details and the fix), no human log lines —
// for agents looping on their own errors. Exit code is unchanged.
const JSON_OUT = process.argv.includes("--json");
// `--update-fingerprints`: (re)write layout-fingerprints/*.fingerprint from
// the current flattened layouts instead of comparing against them. Commit
// the result: the diff IS the review of a layout change.
const UPDATE_FP = process.argv.includes("--update-fingerprints");
// Fingerprints are SIDECARS: `<srcRoot>/<pack>/<slug>/vN/<slug>.layout.m0`
// next to the template source; a template whose id has no source folder
// falls back to `layout-fingerprints/<key>.m0`.
const FP_OPTS = { srcRoot: 'src' };
const log0 = console.log.bind(console);
const warn0 = console.warn.bind(console);
const err0 = console.error.bind(console);
const say = (...a) => { if (!JSON_OUT) log0(...a); };
const warn = (...a) => { if (!JSON_OUT) warn0(...a); };
const fail = (...a) => { if (!JSON_OUT) err0(...a); };
const report = { ok: true, mode: SWEEP ? "sweep" : "gate", templates: 0, rendered: 0, skipped: [], errors: [], warnings: [], notes: [], fingerprints: { srcRoot: FP_OPTS.srcRoot, fallbackDir: "layout-fingerprints", minted: 0, unchanged: 0, missing: 0, changed: 0 } };
const toJson = (f) => ({ templateId: f.templateId, convention: f.convention, severity: f.severity, violations: f.violations, fix: templateUtils.TEMPLATE_CONVENTION_FIX?.[f.convention] ?? null });
const finish = (code) => {
  if (JSON_OUT) { report.ok = code === 0; process.stdout.write(JSON.stringify(report, null, 2) + "\n"); }
  process.exit(code);
};

// ── The freeze manifest: which templates shipped, and at which m0saic line ──
// Read before anything loads, and fail CLOSED on a bad one: without it the
// gate cannot tell a shipped template (lag is allowed) from new work (held to
// every current rule). No manifest = nothing shipped yet = every template is
// held to the current conventions.
let FREEZE_MANIFEST = null;
try {
  FREEZE_MANIFEST = readFreezeManifest(ROOT);
  if (FREEZE_MANIFEST) {
    assertReleaseShape(FREEZE_MANIFEST.release);
    shippedFolderReleases(FREEZE_MANIFEST); // every hashed folder has a line, every line has the shape
  }
} catch (err) {
  const message = err && err.message ? err.message : String(err);
  report.conventions = { shippedAt: null, shipped: {}, lagging: [], error: message };
  fail(`\n[check-registry] ✗ ${FREEZE_MANIFEST_FILE}: ${message}`);
  fail("[check-registry] Failing closed: shipped templates cannot be told from new work. Restore the manifest from git; minting is a release act (node tools/check-freeze.mjs --update --tag <m0saic line>).");
  finish(1);
}
// `shippedAt` in the report is the manifest's `release` (the newest line it
// froze); `shipped` holds each template's own line, which is what the audit uses.
const SHIPPED_AT = FREEZE_MANIFEST ? FREEZE_MANIFEST.release : null;
report.conventions = { shippedAt: SHIPPED_AT, shipped: {}, lagging: [] };

let templates;
let templateUtils;
try {
  ({ templates } = require("../dist/index.js")); // side effect: defineMosaicTemplate() for every template
  templateUtils = require("@m0saic/template-utils");
  // The filesystem half of layout fingerprints lives in the node-only entry
  // (the root barrel is walked by the web bundle and must stay free of node:fs).
  templateUtils = { ...templateUtils, ...require("@m0saic/template-utils/dist/dev/index.js") };
} catch (err) {
  const message = err && err.message ? err.message : String(err);
  fail(`\n[check-registry] ✗ the built templates refused to load:\n\n${message}\n`);
  fail("[check-registry] Fix the template above, then rebuild. (tools/check-registry.mjs)");
  finish(1);
}

const count = Array.isArray(templates) ? templates.length : 0;

// ── Repo level: the front door (hello-world convention, 2026-09-14) ────────
// `repo.helloWorld` names the template a newcomer renders first — the
// canonical card via defineHelloWorldTemplate, or the pack's own. Record
// posture: the finding rides the same log Stage 1 prints, keyed by the repo
// id. (Same block as the monorepo's check-registry.)
{
  const entry = require("../dist/index.js");
  const repo = entry.repo ?? entry.TEMPLATE_REPO ?? null;
  const ownIds = Array.isArray(templates) ? templates.map((t) => String(t.id)) : [];
  const violations = typeof templateUtils.auditRepoFrontDoor === "function" ? templateUtils.auditRepoFrontDoor(repo, ownIds) : [];
  if (violations.length && typeof templateUtils.recordTemplateConventionFinding === "function") {
    templateUtils.recordTemplateConventionFinding(
      templateUtils.makeTemplateConventionFinding(String(repo?.repoId ?? "(repo)"), "repoFrontDoor", violations, false),
    );
  }
}
// The ids the manifest hashes (`src/<pack>/<slug>/vN/…` → `<repoId>/<pack>/<slug>/vN`),
// each with the m0saic line it shipped at.
let SHIPPED = new Map();
if (FREEZE_MANIFEST) {
  const entry = require("../dist/index.js");
  const repoId = (entry.repo ?? entry.TEMPLATE_REPO ?? null)?.repoId;
  if (!repoId) {
    fail(`[check-registry] ✗ ${FREEZE_MANIFEST_FILE} names shipped templates but dist/index.js exports no repo.repoId to name them with — failing closed.`);
    finish(1);
  }
  SHIPPED = shippedReleasesFrom(FREEZE_MANIFEST, String(repoId));
  report.conventions.shipped = Object.fromEntries(SHIPPED);
}
const printFindings = (label, findings) => {
  for (const f of findings) {
    fail(`  ${label} ${f.templateId} — ${f.convention}: ${f.violations.map((v) => v.key).join(", ")}`);
    for (const v of f.violations.slice(0, 4)) fail(`      ${v.detail}`);
    if (f.violations.length > 4) fail(`      …+${f.violations.length - 4} more`);
  }
};

report.templates = typeof ids !== "undefined" ? ids.length : (typeof count !== "undefined" ? count : 0);
// ── Stage 1: definition time ───────────────────────────────────────────────
const recorded = typeof templateUtils.listTemplateConventionFindings === "function"
  ? templateUtils.listTemplateConventionFindings().filter((f) => !f.external)
  : [];
const errors1 = recorded.filter((f) => f.severity === "error");
report.errors.push(...errors1.map(toJson));
const warnings1 = recorded.filter((f) => f.severity === "warning");
report.warnings.push(...warnings1.map(toJson));
if (count === 0 || errors1.length > 0) {
  fail(`[check-registry] ✗ ${count} templates exported, ${errors1.length} convention error(s) recorded.`);
  printFindings("✗", errors1);
  finish(1);
}
const warnedKnobs = warnings1.reduce((n, f) => n + f.violations.length, 0);
say(`[check-registry] ✓ ${count} templates — definition-time conventions hold` +
  (warnings1.length ? ` (${warnings1.length} template(s) carry ${warnedKnobs} warning knob(s): ${[...new Set(warnings1.map((f) => f.convention))].join(", ")})` : "") + ".");

// ── Stage 2: render time ───────────────────────────────────────────────────
if (typeof templateUtils.auditRenderedTemplate !== "function") {
  warn("[check-registry] ⚠ this @m0saic/template-utils has no auditRenderedTemplate — render-time conventions not checked.");
  finish(0);
}
// A host registers every template of a repo before rendering any of them
// (a lesson may invoke a sibling by id through the registry). Do the same
// here, first-party, so nested invocations resolve exactly as they do in
// Mosaic Desktop and the CLI.
for (const template of templates) templateUtils.registerTemplate(template);
const errors2 = [];
const warnings2 = [];
const skipped = [];
const layouts = [];
let rendered = 0;
for (const template of templates) {
  // `shippedAt` exempts a SHIPPED template from conventions newer than the line
  // IT shipped at: those findings come back in `audit.lagging` (0.3.0+). A new
  // template gets no `shippedAt` and meets every current rule.
  const shippedAt = SHIPPED.get(String(template.id));
  const audit = await templateUtils.auditRenderedTemplate(template, {
    ...(SWEEP ? { sweepCanvases: templateUtils.STANDARD_SWEEP_CANVASES } : {}),
    ...(shippedAt ? { shippedAt } : {}),
  });
  if (audit.skipped) {
    skipped.push(`${audit.templateId}: ${audit.skipped}`);
    report.skipped.push({ templateId: audit.templateId, reason: audit.skipped });
    continue;
  }
  rendered++;
  report.rendered = rendered;
  const lag = audit.lagging ?? [];
  if (lag.length) {
    const conventions = [...new Set(lag.map((f) => f.convention))].sort();
    const lines = conventions.map((c) => templateUtils.TEMPLATE_CONVENTION_SINCE?.[c]).filter((v) => typeof v === "string");
    const behind = lines.sort(compareLines).pop() ?? templateUtils.conventionVersions?.().slice(-1)[0] ?? "the current line";
    report.conventions.lagging.push({ templateId: audit.templateId ?? String(template.id), shippedAt: shippedAt ?? null, behind, conventions });
  }
  if (audit.layout) layouts.push({ id: audit.templateId, layout: audit.layout });
  for (const f of audit.findings) { (f.severity === "error" ? errors2 : warnings2).push(f); (f.severity === "error" ? report.errors : report.warnings).push(toJson(f)); }
  for (const note of audit.notes) report.notes.push({ templateId: audit.templateId, note });
  for (const note of audit.notes) warn(`  ⚠ ${audit.templateId}: ${note}`);
}
if (warnings2.length) {
  warn(`[check-registry] ⚠ ${warnings2.length} render-time warning(s) (record posture — fix when you touch the template):`);
  printFindings("⚠", warnings2);
}
// Lag, not defects: a shipped template met the conventions of its day. One
// line each, never fatal — this is the list the next vN pass works from.
for (const l of report.conventions.lagging) {
  say(`[check-registry] ℹ ${l.templateId}: behind ${l.behind} on ${l.conventions.join(", ")} - not a defect: shipped at ${l.shippedAt}; fix in the next vN`);
}
// ── Stage 3: layout fingerprints ───────────────────────────────────────────
// The flattened layout at the hinted canvas, committed per template as a
// native `.m0` sidecar next to its source (`# size:` = the canvas, `# title:`
// = the id). A change is a build ERROR until re-minted with
// --update-fingerprints — so an edit to a shared helper shows its blast
// radius as a diff, not a surprise.
for (const { id, layout } of layouts) {
  if (UPDATE_FP) {
    if (templateUtils.writeLayoutFingerprint(ROOT, id, layout, FP_OPTS) > 0) report.fingerprints.minted++; else report.fingerprints.unchanged++;
    continue;
  }
  const result = templateUtils.checkLayoutFingerprint(ROOT, id, layout, false, FP_OPTS);
  if (result === "missing") {
    report.fingerprints.missing++;
    const where = templateUtils.layoutFingerprintLocation(ROOT, id, FP_OPTS);
    const f = { templateId: id, convention: "layoutFingerprint", severity: "warning", violations: [{ key: "missing", detail: `no committed fingerprint at ${path.relative(ROOT, path.join(where.dir, templateUtils.layoutFingerprintFileName(where.base)))} — run \`node tools/check-registry.mjs --update-fingerprints\` and commit it.` }] };
    warnings2.push(f); report.warnings.push(toJson(f));
  } else if (result) {
    report.fingerprints.changed++; errors2.push(result); report.errors.push(toJson(result));
  } else {
    report.fingerprints.unchanged++;
  }
}
if (UPDATE_FP) say(`[check-registry] ✎ layout fingerprints: ${report.fingerprints.minted} written, ${report.fingerprints.unchanged} unchanged → <template folder>/<slug>.layout.m0 (commit them).`);
else say(`[check-registry] ✓ layout fingerprints: ${report.fingerprints.unchanged} unchanged, ${report.fingerprints.missing} missing, ${report.fingerprints.changed} changed.`);

if (errors2.length) {
  fail(`[check-registry] ✗ ${errors2.length} render-time convention error(s):`);
  printFindings("✗", errors2);
  fail("[check-registry] Fix the template(s) above, then rebuild. (tools/check-registry.mjs)");
  finish(1);
}
if (SWEEP) say(`[check-registry] (sweep) each template was also rendered on ${templateUtils.STANDARD_SWEEP_CANVASES.length} standard canvases for the canvasEnvelope rule.`);
say(`[check-registry] ✓ ${rendered} templates rendered at their defaults — render-time conventions hold (${skipped.length} skipped: inputs required).`);
finish(0);
