// Run with: node --test tools/stamp-ordinals.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FREEZE_MANIFEST_FILE } from "./freeze-manifest.mjs";
import { main, planOrdinals, registryRows, splitOrdinal } from "./stamp-ordinals.mjs";

const row = (pack, slug, exportName, title) => `  {
    slug: "${slug}",
    templateId: "@x/${pack}/${slug}/v1",
    exportName: "${exportName}",
    title: "${title}",
    description: "d",
    tags: ["${pack}"],
  },
`;
const templateFile = (label) => `export const T = defineMosaicTemplate({\n  id: asTemplateId("x"),\n  label: "${label}",\n  propsSchema: { title: { meta: { ui: { label: "Title" } } } },\n});\n`;

/** A tiny repo: basics (hello), reels (triptych: frozen; stack), explore (shards). */
function fixture({ triptychBarrel = "bare" } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "stamp-"));
  const w = (rel, text) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };
  w("src/template-registry.ts", 'export const CHAPTERS = [\n  { pack: "basics", entries: basicsRegistry },\n  { pack: "reels", entries: reelsRegistry },\n  // last\n  { pack: "explore", entries: exploreRegistry },\n];\n');
  w("src/basics/registry.ts", `export const basicsRegistry = [\n${row("basics", "hello", "HelloV1", "01 · Hello")}];\n`);
  w("src/reels/registry.ts", `export const reelsRegistry = [\n${row("reels", "triptych", "TriptychV1", "02 · Triptych")}${row("reels", "stack", "StackV1", "03 · Stack")}];\n`);
  w("src/explore/registry.ts", `export const exploreRegistry = [\n${row("explore", "shards", "ShardsV1", "04 · Shards")}];\n`);
  w("src/basics/hello/v1/hello.ts", templateFile("01 · Hello"));
  w("src/reels/triptych/v1/triptych.ts", templateFile("02 · Triptych"));
  w("src/reels/stack/v1/stack.ts", templateFile("03 · Stack"));
  w("src/explore/shards/v1/shards.ts", templateFile("04 · Shards"));
  const entry = (name) => `  ${name} as unknown as MosaicTemplate<MosaicTemplateProps>,\n`;
  const reelsBarrel = triptychBarrel === "const"
    ? `const triptychDeprecated = {\n  ...TriptychV1,\n  deprecated: { reason: "old", replacement: StackV1.id },\n};\n\nexport const reelsTemplates = [\n${entry("triptychDeprecated")}${entry("StackV1")}];\n`
    : triptychBarrel === "labelled"
      ? `export const reelsTemplates = [\n  { ...TriptychV1, label: "02 · Triptych" } as unknown as MosaicTemplate<MosaicTemplateProps>,\n${entry("StackV1")}];\n`
      : `export const reelsTemplates = [\n${entry("TriptychV1")}${entry("StackV1")}];\n`;
  w("src/reels/index.ts", reelsBarrel);
  w("src/basics/index.ts", `export const basicsTemplates = [\n${entry("HelloV1")}];\n`);
  w("src/explore/index.ts", `export const exploreTemplates = [\n${entry("ShardsV1")}];\n`);
  w(FREEZE_MANIFEST_FILE, JSON.stringify({ release: "0.2.0", files: { "src/basics/hello/v1/hello.ts": "h", "src/reels/triptych/v1/triptych.ts": "t" } }));
  const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
  /** A new basics row: every later ordinal shifts by one. */
  const addBasics = () => {
    w("src/basics/registry.ts", `export const basicsRegistry = [\n${row("basics", "hello", "HelloV1", "01 · Hello")}${row("basics", "extra", "ExtraV1", "02 · Extra")}];\n`);
    w("src/basics/extra/v1/extra.ts", templateFile("02 · Extra"));
    w("src/basics/index.ts", `export const basicsTemplates = [\n${entry("HelloV1")}${entry("ExtraV1")}];\n`);
  };
  return { root, w, read, addBasics };
}

function run(argv, root) {
  const out = [];
  const err = [];
  const log = console.log;
  const error = console.error;
  console.log = (...a) => out.push(a.join(" "));
  console.error = (...a) => err.push(a.join(" "));
  try { return { code: main(argv, root), out: out.join("\n"), err: err.join("\n") }; }
  finally { console.log = log; console.error = error; }
}

test("parsing: registry rows and the NN · prefix", () => {
  const rows = registryRows(`[\n${row("reels", "a", "AV1", "02 · A")}${row("reels", "b", "BV1", "B")}]`);
  assert.deepEqual(rows.map((r) => [r.templateId, r.exportName, r.title]), [["@x/reels/a/v1", "AV1", "02 · A"], ["@x/reels/b/v1", "BV1", "B"]]);
  assert.deepEqual(splitOrdinal("05 · Cover Shards"), { nn: "05", rest: "Cover Shards" });
  assert.deepEqual(splitOrdinal("Cover Shards"), { nn: null, rest: "Cover Shards" });
});

test("in step: nothing to do", () => {
  const { root } = fixture();
  const plan = planOrdinals(root);
  assert.deepEqual(plan.edits, []);
  assert.deepEqual(plan.blocked, []);
  assert.deepEqual(plan.rows.map((r) => r.expected), ["01", "02", "03", "04"]);
  assert.equal(run(["--check"], root).code, 0);
});

test("--check reports drift and writes nothing", () => {
  const { root, read, addBasics } = fixture();
  addBasics();
  const before = read("src/reels/registry.ts");
  const r = run(["--check"], root);
  assert.equal(r.code, 1);
  assert.match(r.out, /would restamp {2}src\/reels\/registry\.ts {2}title of @x\/reels\/triptych\/v1: "02 · Triptych" → "03 · Triptych"/);
  assert.equal(read("src/reels/registry.ts"), before);
});

test("a shift restamps titles and unfrozen labels; a FROZEN label moves to the barrel, the frozen file never changes", () => {
  const { root, read, addBasics } = fixture();
  addBasics();
  const frozenBefore = read("src/reels/triptych/v1/triptych.ts");
  const r = run([], root);
  assert.equal(r.code, 0, r.err);
  assert.match(read("src/reels/registry.ts"), /title: "03 · Triptych"[\s\S]*title: "04 · Stack"/);
  assert.match(read("src/explore/registry.ts"), /title: "05 · Shards"/);
  assert.match(read("src/reels/stack/v1/stack.ts"), /^ {2}label: "04 · Stack",$/m);
  assert.match(read("src/reels/stack/v1/stack.ts"), /ui: \{ label: "Title" \}/); // prop labels untouched
  assert.match(read("src/explore/shards/v1/shards.ts"), /label: "05 · Shards"/);
  assert.equal(read("src/reels/triptych/v1/triptych.ts"), frozenBefore);
  assert.match(read("src/reels/index.ts"), /^ {2}\{ \.\.\.TriptychV1, label: "03 · Triptych" \} as unknown as MosaicTemplate<MosaicTemplateProps>,$/m);
  assert.equal(run(["--check"], root).code, 0); // idempotent: the barrel label now carries the ordinal
  assert.equal(read("src/basics/hello/v1/hello.ts"), templateFile("01 · Hello"));
});

test("a frozen template deprecated through a barrel const gets its label in that spread", () => {
  const { root, read, addBasics } = fixture({ triptychBarrel: "const" });
  addBasics();
  assert.equal(run([], root).code, 0);
  assert.match(read("src/reels/index.ts"), /const triptychDeprecated = \{\n {2}\.\.\.TriptychV1,\n {2}label: "03 · Triptych",\n {2}deprecated: \{ reason: "old", replacement: StackV1\.id \},\n\};/);
  assert.equal(run(["--check"], root).code, 0);
});

test("a barrel that already carries the label is restamped there", () => {
  const { root, read, addBasics } = fixture({ triptychBarrel: "labelled" });
  addBasics();
  assert.equal(run([], root).code, 0);
  assert.match(read("src/reels/index.ts"), /\{ \.\.\.TriptychV1, label: "03 · Triptych" \}/);
  assert.equal(read("src/reels/triptych/v1/triptych.ts"), templateFile("02 · Triptych"));
});

test("what it cannot place is listed with the fix, exit 1 — never a silent success", () => {
  const { root, w, addBasics } = fixture();
  addBasics();
  w("src/reels/stack/v1/stack.ts", "export const T = defineMosaicTemplate({ label: 'Stack' });\n");
  w("src/reels/index.ts", "export const reelsTemplates = [];\n"); // the frozen triptych has no barrel entry
  const r = run([], root);
  assert.equal(r.code, 1);
  assert.match(r.err, /src\/reels\/stack\/v1: expected exactly one `label: "NN · …"` line/);
  assert.match(r.err, /triptych\.ts is frozen and src\/reels\/index\.ts has no templates-array entry for TriptychV1 — write `\{ \.\.\.TriptychV1, label: "03 · Triptych" \}/);
});
