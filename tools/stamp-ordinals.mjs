#!/usr/bin/env node
// stamp-ordinals — keep the `NN · ` curriculum ordinals in step with chapter order.
//
//   node tools/stamp-ordinals.mjs            restamp every registry title and template label
//   node tools/stamp-ordinals.mjs --check    write nothing; exit 1 if anything is off
//
// The manifest generator (src/gen-template-manifest.ts) asserts that every
// registry title AND every exported template's label starts with `NN · `, NN
// being the template's position in the whole repo in CHAPTERS order, with no
// gaps. A template added to an earlier pack shifts every later ordinal, so
// this tool restamps them:
//
//   - the registry row's `title` (src/<pack>/registry.ts is never frozen);
//   - the template's `label`:
//       * in its source file when that file is NOT hashed in frozen.manifest.json;
//       * in the pack BARREL when it is: the object that spreads the template
//         (`{ ...XV1, deprecated: … }`, the barrel's deprecation spread) gains
//         `label: "NN · Title"`, or a bare array entry becomes
//         `{ ...XV1, label: "NN · Title" } as unknown as MosaicTemplate<…>`.
//         src/<pack>/index.ts is never frozen, the frozen file stays
//         byte-identical, and the generator reads the label `templates[]` carries.
//
// Anything it cannot place (no `label: "NN · …"` line, two of them, a barrel
// entry it cannot find) is listed with the exact change to make, and the exit
// code is 1 — never a silent success. Node built-ins only.
//
// Exit 0 in step (or restamped) · 1 drift left (--check) or a change it could not make · 2 could not read the repo.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readFreezeManifest } from "./freeze-manifest.mjs";

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SEP = " · ";
const ID_RE = /^[^/]+(?:\/[^/]+)?\/([a-z0-9][a-z0-9-]*)\/([a-z0-9][a-z0-9-]*)\/(v[1-9]\d*)$/;
const LABEL_LINE = /^([ \t]*label:[ \t]*)"(\d{2,}) · ([^"\n]*)"/gm;

const pad = (n) => String(n).padStart(2, "0");
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const toPosix = (p) => p.split(path.sep).join("/");

/** Pack ids in CHAPTERS order (src/template-registry.ts). */
export function chapterPacks(text) {
  return [...text.matchAll(/\{\s*pack:\s*"([a-z0-9-]+)"/g)].map((m) => m[1]);
}

/** Registry rows `{ templateId, exportName, title, titleAt }` in array order; `titleAt` = offset of the title string literal. */
export function registryRows(text) {
  const ids = [...text.matchAll(/\btemplateId:\s*"([^"]+)"/g)];
  return ids.map((m, i) => {
    const end = i + 1 < ids.length ? ids[i + 1].index : text.length;
    const start = text.lastIndexOf("{", m.index);
    const chunk = text.slice(start, end);
    const exportName = /\bexportName:\s*"([^"]+)"/.exec(chunk)?.[1];
    const t = /\btitle:\s*("((?:[^"\\]|\\.)*)")/.exec(chunk);
    return {
      templateId: m[1],
      exportName,
      title: t ? JSON.parse(t[1]) : undefined,
      titleAt: t ? start + t.index + t[0].length - t[1].length : -1,
      titleLiteral: t ? t[1] : undefined,
    };
  });
}

/** `{ nn, rest }` for "05 · Cover Shards"; `{ nn: null, rest: title }` without a prefix. */
export function splitOrdinal(title) {
  const m = /^(\d{2,}) · (.*)$/s.exec(title ?? "");
  return m ? { nn: m[1], rest: m[2] } : { nn: null, rest: title ?? "" };
}

/** Every `label: "NN · …"` line in the non-test .ts files of a template folder. */
function labelSites(root, folderRel) {
  const dir = path.join(root, folderRel);
  let names = [];
  try { names = fs.readdirSync(dir).filter((n) => n.endsWith(".ts") && !n.endsWith(".test.ts") && !n.endsWith(".d.ts")).sort(); } catch { return []; }
  const sites = [];
  for (const name of names) {
    const rel = `${folderRel}/${name}`;
    const text = fs.readFileSync(path.join(root, rel), "utf8");
    for (const m of text.matchAll(LABEL_LINE)) sites.push({ file: rel, index: m.index, match: m[0], lead: m[1], nn: m[2], rest: m[3] });
  }
  return sites;
}

/**
 * The end of the bracketed span that opens at `open` (`{`, `[` or `(`),
 * skipping strings and comments, plus every offset inside it that sits at
 * depth 1 (directly in that object). Returns null when it never closes.
 */
function scanObject(text, open) {
  const pairs = { "{": "}", "[": "]", "(": ")" };
  const top = [];
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'" || c === "`") {
      for (i++; i < text.length && text[i] !== c; i++) if (text[i] === "\\") i++;
      continue;
    }
    if (c === "/" && text[i + 1] === "/") { i = text.indexOf("\n", i); if (i < 0) return null; continue; }
    if (c === "/" && text[i + 1] === "*") { i = text.indexOf("*/", i + 2); if (i < 0) return null; i++; continue; }
    if (pairs[c]) { depth++; continue; }
    if (c === "}" || c === "]" || c === ")") { depth--; if (depth === 0) return { end: i + 1, top }; continue; }
    if (depth === 1) top.push(i);
  }
  return null;
}

/**
 * Where the barrel carries `exportName`: an object literal that spreads it
 * first (`{ ...XV1, deprecated: … }`, inline in the templates array or as a
 * const the array lists) — with its top-level `label` when it has one — or a
 * bare `XV1 as unknown as MosaicTemplate<…>` array entry. Null when neither.
 */
function barrelEntry(text, exportName) {
  const n = esc(exportName);
  const spread = new RegExp(`\\{([ \\t]*\\n?)([ \\t]*)\\.\\.\\.${n}[ \\t]*,`).exec(text);
  if (spread) {
    const obj = scanObject(text, spread.index);
    if (obj) {
      const topSet = new Set(obj.top);
      const labelRe = /\blabel\s*:\s*("(?:[^"\\]|\\.)*")/g;
      labelRe.lastIndex = spread.index;
      let label = null;
      for (let m; (m = labelRe.exec(text)) && m.index < obj.end;) if (topSet.has(m.index)) { label = m; break; }
      return {
        kind: "spread",
        multiline: spread[1].includes("\n"),
        indent: spread[2],
        headEnd: spread.index + spread[0].length,
        label: label ? JSON.parse(label[1]) : undefined,
        labelAt: label ? label.index : -1,
        labelLiteral: label ? label[0] : undefined,
      };
    }
  }
  const bare = new RegExp(`^([ \\t]*)${n}(\\s+as\\s+unknown\\s+as\\s+MosaicTemplate<)`, "m").exec(text);
  if (bare) return { kind: "bare", at: bare.index, text: bare[0], indent: bare[1], tail: bare[2] };
  return null;
}

/**
 * What the ordinals should be, and the edits that get there.
 * Returns `{ rows, edits, blocked }`:
 *   rows    [{ templateId, expected, title }] in chapter order;
 *   edits   [{ file, what, from, to, apply(text) → text }] (at most one per site);
 *   blocked [string] — changes this tool could not make, each with the fix.
 */
export function planOrdinals(root = PACKAGE_ROOT) {
  const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
  const packs = chapterPacks(read("src/template-registry.ts"));
  if (!packs.length) throw new Error("no CHAPTERS rows in src/template-registry.ts");
  const manifest = readFreezeManifest(root);
  const hashed = new Set(Object.keys(manifest?.files ?? {}));
  const rows = [];
  const edits = [];
  const blocked = [];
  let n = 0;
  for (const pack of packs) {
    const regRel = `src/${pack}/registry.ts`;
    if (!fs.existsSync(path.join(root, regRel))) { blocked.push(`${regRel} is missing (CHAPTERS names pack "${pack}")`); continue; }
    const regText = read(regRel);
    for (const row of registryRows(regText)) {
      n += 1;
      const expected = pad(n);
      rows.push({ templateId: row.templateId, expected, title: row.title });
      if (row.title === undefined) { blocked.push(`${regRel}: row ${row.templateId} has no title: "…" string — give it title: "${expected} · <Title>"`); continue; }
      const { nn, rest } = splitOrdinal(row.title);
      if (nn !== expected) {
        const to = `${expected}${SEP}${rest}`;
        const { titleAt, titleLiteral } = row;
        edits.push({
          file: regRel, what: `title of ${row.templateId}`, from: row.title, to,
          apply: (text) => {
            if (text.slice(titleAt, titleAt + titleLiteral.length) !== titleLiteral) throw new Error(`${regRel} changed while stamping`);
            return text.slice(0, titleAt) + JSON.stringify(to) + text.slice(titleAt + titleLiteral.length);
          },
          at: titleAt,
        });
      }
      // ── the label ──
      const id = ID_RE.exec(row.templateId);
      if (!id) { blocked.push(`${row.templateId}: not a <repoId>/<pack>/<slug>/vN id — cannot find its label`); continue; }
      const folder = `src/${id[1]}/${id[2]}/${id[3]}`;
      const barrelRel = `src/${pack}/index.ts`;
      const barrelText = fs.existsSync(path.join(root, barrelRel)) ? read(barrelRel) : "";
      const entry = row.exportName ? barrelEntry(barrelText, row.exportName) : null;
      if (entry?.kind === "spread" && entry.label !== undefined) {
        // the barrel already carries this template's label: that is the one the generator reads
        if (splitOrdinal(entry.label).nn !== expected) {
          const to = `${expected}${SEP}${splitOrdinal(entry.label).rest}`;
          const at = entry.labelAt;
          const lit = entry.labelLiteral;
          edits.push({ file: barrelRel, what: `barrel label of ${row.exportName}`, from: entry.label, to, at, apply: (text) => {
            if (text.slice(at, at + lit.length) !== lit) throw new Error(`${barrelRel} changed while stamping`);
            return text.slice(0, at) + `label: ${JSON.stringify(to)}` + text.slice(at + lit.length);
          } });
        }
        continue;
      }
      const sites = labelSites(root, folder);
      if (sites.length !== 1) {
        blocked.push(`${folder}: expected exactly one \`label: "NN · …"\` line in its .ts files, found ${sites.length} — set the template's label to "${expected} · <Title>" by hand`);
        continue;
      }
      const site = sites[0];
      const labelTo = `${expected}${SEP}${site.rest}`;
      if (site.nn === expected) continue;
      if (!hashed.has(site.file)) {
        const at = site.index;
        const lit = site.match;
        edits.push({ file: site.file, what: `label of ${row.templateId}`, from: `${site.nn}${SEP}${site.rest}`, to: labelTo, at, apply: (text) => {
          if (text.slice(at, at + lit.length) !== lit) throw new Error(`${site.file} changed while stamping`);
          return text.slice(0, at) + `${site.lead}${JSON.stringify(labelTo)}` + text.slice(at + lit.length);
        } });
        continue;
      }
      // frozen source: stamp the label in the barrel instead
      if (!entry) {
        blocked.push(`${site.file} is frozen and ${barrelRel} has no templates-array entry for ${row.exportName ?? "(no exportName)"} — ` +
          `write \`{ ...${row.exportName}, label: ${JSON.stringify(labelTo)} } as unknown as MosaicTemplate<MosaicTemplateProps>,\` there`);
        continue;
      }
      if (entry.kind === "bare") {
        const at = entry.at;
        const lit = entry.text;
        const to = `${entry.indent}{ ...${row.exportName}, label: ${JSON.stringify(labelTo)} }${entry.tail}`;
        edits.push({ file: barrelRel, what: `barrel label of ${row.exportName} (its source is frozen)`, from: `${site.nn}${SEP}${site.rest}`, to: labelTo, at, apply: (text) => {
          if (text.slice(at, at + lit.length) !== lit) throw new Error(`${barrelRel} changed while stamping`);
          return text.slice(0, at) + to + text.slice(at + lit.length);
        } });
      } else {
        const at = entry.headEnd;
        const prop = entry.multiline ? `\n${entry.indent}label: ${JSON.stringify(labelTo)},` : ` label: ${JSON.stringify(labelTo)},`;
        edits.push({ file: barrelRel, what: `barrel label of ${row.exportName} (its source is frozen)`, from: `${site.nn}${SEP}${site.rest}`, to: labelTo, at, apply: (text) =>
          text.slice(0, at) + prop + text.slice(at) });
      }
    }
  }
  return { rows, edits, blocked };
}

/** Apply `edits` (bottom-up per file so offsets hold). Returns the files written. */
export function applyOrdinals(root, edits) {
  const byFile = new Map();
  for (const e of edits) byFile.set(e.file, [...(byFile.get(e.file) ?? []), e]);
  const written = [];
  for (const [file, list] of byFile) {
    let text = fs.readFileSync(path.join(root, file), "utf8");
    for (const e of [...list].sort((a, b) => b.at - a.at)) text = e.apply(text);
    fs.writeFileSync(path.join(root, file), text);
    written.push(file);
  }
  return written.sort();
}

export function main(argv, root = PACKAGE_ROOT) {
  const check = argv.includes("--check");
  const repoArg = argv.indexOf("--repo");
  const dir = repoArg >= 0 ? path.resolve(argv[repoArg + 1] ?? ".") : root;
  let plan;
  try { plan = planOrdinals(dir); }
  catch (err) { console.error(`[stamp-ordinals] ✗ could not read the registry: ${err.message}`); return 2; }
  const { rows, edits, blocked } = plan;
  for (const e of edits) console.log(`  ${check ? "would restamp" : "restamp"}  ${toPosix(e.file)}  ${e.what}: "${e.from}" → "${e.to}"`);
  if (!check && edits.length) {
    try { applyOrdinals(dir, edits); }
    catch (err) { console.error(`[stamp-ordinals] ✗ ${err.message}`); return 2; }
  }
  for (const b of blocked) console.error(`  ✗ ${b}`);
  if (blocked.length) {
    console.error(`[stamp-ordinals] ✗ ${blocked.length} ordinal(s) need a hand edit (above); the manifest generator will refuse the build until they match.`);
    return 1;
  }
  if (check && edits.length) {
    console.error(`[stamp-ordinals] ✗ ${edits.length} ordinal(s) out of step with CHAPTERS order — run node tools/stamp-ordinals.mjs`);
    return 1;
  }
  console.log(`[stamp-ordinals] ✓ ${rows.length} templates, ordinals 01–${pad(rows.length)} in CHAPTERS order${edits.length ? ` (${edits.length} restamped)` : ""}.`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
