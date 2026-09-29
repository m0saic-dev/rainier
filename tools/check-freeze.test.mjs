// Run with: node --test tools/check-freeze.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  FREEZE_HASH_VERSION, FREEZE_MANIFEST_FILE, additiveViolations, checkTree, collectFrozenFiles, gitSource, hashBytes, hashFor, hashRaw, isFrozenSeed, judgeStaged,
  main, mintManifest, relativeImportSpecifiers,
} from "./check-freeze.mjs";
import { shippedReleasesFrom } from "./freeze-manifest.mjs";

function pkg() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cfreeze-"));
  const w = (rel, text) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };
  w("src/cards/hello/v1/hello.ts", 'import { helper } from "../../_shared/theme";\nexport const a = helper(1);\n');
  w("src/cards/hello/v1/hello.test.ts", "test('x', () => {});\n");
  w("src/cards/_shared/theme.ts", 'import { base } from "../../util/base";\nexport const helper = (n) => base + n;\n');
  w("src/util/base.ts", "export const base = 1;\n");
  w("src/cards/registry.ts", "export const cardsRegistry = [];\n");
  w("src/repo.ts", "export const TEMPLATE_REPO = { repoId: \"@x\" };\n");
  w("src/cards/hello/v1/uses-repo.ts", 'import { TEMPLATE_REPO } from "../../../repo";\nexport const r = TEMPLATE_REPO;\n');
  w("src/cards/index.ts", "export {};\n");
  w("src/__testutils__/render.ts", "export const ctx = 1;\n");
  w("src/basics/hello-world/v1/hello-world.ts", "export const hw = 1;\n");
  w("src/lab/flow/v1/flow.ts", "export const m = 1;\n");
  return { root, w };
}

/** A throwaway git repo in the fixture (never the real checkout). */
function gitIn(root) {
  const env = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
  const git = (...a) => execFileSync("git", a, { cwd: root, encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] });
  git("init", "-q");
  git("config", "commit.gpgsign", "false");
  git("config", "core.hooksPath", "/dev/null");
  return git;
}

/** Run the CLI in-process with its console quiet; returns { code, out, err }. */
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

test("seeds are vN / _shared .ts files under src/, never tests, registries or testutils", () => {
  assert.equal(isFrozenSeed("src/cards/hello/v1/hello.ts"), true);
  assert.equal(isFrozenSeed("src/cards/_shared/theme.ts"), true);
  assert.equal(isFrozenSeed("src/_shared/bindings.ts"), true);
  assert.equal(isFrozenSeed("src/basics/hello-world/v1/hello-world.ts"), true);
  assert.equal(isFrozenSeed("src/cards/hello/v1/hello.test.ts"), false);
  assert.equal(isFrozenSeed("src/cards/hello/v1/hello.layout.m0"), false);
  assert.equal(isFrozenSeed("src/cards/registry.ts"), false);
  assert.equal(isFrozenSeed("src/template-registry.ts"), false);
  assert.equal(isFrozenSeed("src/repo.ts"), false);
});

test("the frozen set is seeds + their import closure, minus __testutils__ and excluded packs", () => {
  const { root } = pkg();
  assert.deepEqual(collectFrozenFiles(root, ["src/lab/"]), [
    "src/basics/hello-world/v1/hello-world.ts",
    "src/cards/_shared/theme.ts",
    "src/cards/hello/v1/hello.ts",
    "src/cards/hello/v1/uses-repo.ts",
    "src/util/base.ts",
  ]); // src/repo.ts is imported by a frozen file yet never frozen
  assert.ok(collectFrozenFiles(root).includes("src/lab/flow/v1/flow.ts"));
});

test("import scan ignores commented-out imports", () => {
  assert.deepEqual(relativeImportSpecifiers('// import x from "./dead";\n/* import y from "./dead2" */\nimport z from "./live";\nimport "@m0saic/types";'), ["./live"]);
});

test("hashes are CRLF-agnostic", () => {
  assert.equal(hashBytes(Buffer.from("a\r\nb\rc\n")), hashBytes(Buffer.from("a\nb\nc\n")));
});

test("release is the m0saic line: the mint refuses a date, a v-tag or nothing", () => {
  const { root } = pkg();
  for (const bad of ["2026-09-20", "v0.2.0", "0.2", "0.2.0-rc.1", undefined]) {
    assert.throws(() => mintManifest(root, { tag: bad, commit: "abc" }), /m0saic line/, String(bad));
  }
  assert.equal(mintManifest(root, { tag: "0.2.0", commit: "abc" }).release, "0.2.0");
});

test("checkTree: unchanged passes, a byte edit (even a comment) fails, a deletion fails, new work is unfrozen", () => {
  const { root, w } = pkg();
  const m = mintManifest(root, { tag: "0.2.0", commit: "abc", excluded: ["src/lab/"] });
  assert.equal(Object.keys(m.files).length, 5);
  assert.equal(checkTree(root, m).ok, true);
  w("src/cards/hello/v1/hello.ts", '// a comment\nimport { helper } from "../../_shared/theme";\nexport const a = helper(1);\n');
  let r = checkTree(root, m);
  assert.equal(r.ok, false);
  assert.deepEqual(r.changed, ["src/cards/hello/v1/hello.ts"]);
  fs.rmSync(path.join(root, "src/util/base.ts"));
  r = checkTree(root, m);
  assert.deepEqual(r.deleted, ["src/util/base.ts"]);
  w("src/cards/hello/v2/hello.ts", "export const a = 2;\n");
  assert.ok(checkTree(root, m).unfrozen.includes("src/cards/hello/v2/hello.ts"));
  assert.equal(checkTree(root, { ...m, hashVersion: 99 }).hashVersionMismatch !== undefined, true);
});

test("gate: no manifest means nothing is frozen yet (exit 0); a new unhashed vN folder passes", () => {
  const { root, w } = pkg();
  let r = run([], root);
  assert.equal(r.code, 0);
  assert.match(r.out, /nothing is frozen yet/);
  const m = mintManifest(root, { tag: "0.2.0", commit: "abc", excluded: ["src/lab/"] });
  fs.writeFileSync(path.join(root, FREEZE_MANIFEST_FILE), JSON.stringify(m, null, 2) + "\n");
  w("src/cards/hello/v2/hello.ts", 'import { helper } from "../../_shared/theme";\nexport const a = helper(2);\n');
  w("src/_shared/bindings.ts", "export const declareBindings = (u) => ({ bindings: { unbound: u } });\n");
  r = run([], root);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /5 frozen files unchanged, 2 not yet frozen/);
  assert.equal(run(["--require-complete"], root).code, 1);
});

test("gate: a bad release or an unreadable manifest fails closed (exit 2)", () => {
  const { root } = pkg();
  const m = mintManifest(root, { tag: "0.2.0", commit: "abc" });
  fs.writeFileSync(path.join(root, FREEZE_MANIFEST_FILE), JSON.stringify({ ...m, release: "2026-09-20" }));
  let r = run([], root);
  assert.equal(r.code, 2);
  assert.match(r.err, /m0saic line/);
  fs.writeFileSync(path.join(root, FREEZE_MANIFEST_FILE), "{ not json");
  r = run([], root);
  assert.equal(r.code, 2);
});

test("gate: a manifest committed at HEAD but missing from the tree fails closed (exit 2)", () => {
  const { root } = pkg();
  const git = gitIn(root);
  const m = mintManifest(root, { tag: "0.2.0", commit: "abc" });
  fs.writeFileSync(path.join(root, FREEZE_MANIFEST_FILE), JSON.stringify(m, null, 2) + "\n");
  git("add", "-A");
  git("commit", "-q", "--no-verify", "-m", "frozen");
  fs.rmSync(path.join(root, FREEZE_MANIFEST_FILE));
  const r = run([], root);
  assert.equal(r.code, 2);
  assert.match(r.err, /MISSING/);
});

test("mint (--update): hashes HEAD bytes only — untracked and uncommitted work never enters; refuses a non-line tag", () => {
  const { root, w } = pkg();
  const git = gitIn(root);
  git("add", "-A");
  git("commit", "-q", "--no-verify", "-m", "shipped");
  const sha = git("rev-parse", "HEAD").trim();
  const headHello = fs.readFileSync(path.join(root, "src/cards/hello/v1/hello.ts"));
  // work in progress after the commit: an untracked template + shared helper, and an uncommitted edit
  w("src/cards/new-card/v1/new-card.ts", 'import { x } from "../../../_shared/bindings";\nexport const n = x;\n');
  w("src/_shared/bindings.ts", "export const x = 1;\n");
  w("src/cards/hello/v1/hello.ts", "export const a = 99; // not committed\n");

  assert.equal(run(["--update", "--tag", "2026-09-20"], root).code, 2);
  assert.equal(run(["--update"], root).code, 2);
  assert.equal(fs.existsSync(path.join(root, FREEZE_MANIFEST_FILE)), false);

  const r = run(["--update", "--tag", "0.2.0"], root);
  assert.equal(r.code, 0, r.err);
  assert.match(r.err, /differs from HEAD/); // the uncommitted edit is reported, not frozen
  const m = JSON.parse(fs.readFileSync(path.join(root, FREEZE_MANIFEST_FILE), "utf8"));
  assert.equal(m.release, "0.2.0");
  assert.equal(m.commit, sha);
  assert.equal(m.commit.length, 40);
  assert.deepEqual(Object.keys(m.files).sort(), [
    "src/basics/hello-world/v1/hello-world.ts",
    "src/cards/_shared/theme.ts",
    "src/cards/hello/v1/hello.ts",
    "src/cards/hello/v1/uses-repo.ts",
    "src/lab/flow/v1/flow.ts",
    "src/util/base.ts",
  ]);
  assert.equal(m.files["src/cards/hello/v1/hello.ts"], hashBytes(headHello));
  // the same set the git source sees, independent of the tree
  assert.deepEqual(collectFrozenFiles(root, [], gitSource(root, "HEAD")), Object.keys(m.files).sort());
});

test("mint is additive: a re-mint over a HEAD that moved a frozen file is refused", () => {
  const { root, w } = pkg();
  const git = gitIn(root);
  git("add", "-A");
  git("commit", "-q", "--no-verify", "-m", "shipped");
  assert.equal(run(["--update", "--tag", "0.2.0"], root).code, 0);
  const first = JSON.parse(fs.readFileSync(path.join(root, FREEZE_MANIFEST_FILE), "utf8"));
  git("add", "-A");
  git("commit", "-q", "--no-verify", "-m", "freeze");
  // later: new work (fine) and an edit to a frozen file, both committed
  w("src/cards/next/v1/next.ts", "export const n = 1;\n");
  git("add", "-A");
  git("commit", "-q", "--no-verify", "-m", "new work");
  let r = run(["--update", "--tag", "0.3.0"], root);
  assert.equal(r.code, 0, r.err);
  const second = JSON.parse(fs.readFileSync(path.join(root, FREEZE_MANIFEST_FILE), "utf8"));
  assert.deepEqual(additiveViolations(first, second), []);
  assert.ok(second.files["src/cards/next/v1/next.ts"]);
  w("src/util/base.ts", "export const base = 2;\n");
  git("add", "-A");
  git("commit", "-q", "--no-verify", "-m", "edit a frozen file");
  r = run(["--update", "--tag", "0.3.0"], root);
  assert.equal(r.code, 1);
  assert.match(r.err, /moves {2}src\/util\/base\.ts/);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, FREEZE_MANIFEST_FILE), "utf8")), second); // untouched
});

test("judgeStaged: the index is judged against the manifest at HEAD; the manifest is additive-only", () => {
  const { root, w } = pkg();
  const git = gitIn(root);
  const m = mintManifest(root, { tag: "0.2.0", commit: "abc", excluded: ["src/lab/"] });
  fs.writeFileSync(path.join(root, FREEZE_MANIFEST_FILE), JSON.stringify(m, null, 2) + "\n");
  git("add", "-A");
  git("commit", "-q", "--no-verify", "-m", "frozen");
  // new work stages clean
  w("src/cards/hello/v2/hello.ts", "export const a = 2;\n");
  git("add", "-A");
  assert.equal(judgeStaged(root, "").code, 0);
  // a frozen edit is caught in the INDEX even if the working tree is later restored
  w("src/cards/hello/v1/hello.ts", "export const a = 3;\n");
  git("add", "-A");
  let v = judgeStaged(root, "");
  assert.equal(v.code, 1);
  assert.ok(v.lines.some((l) => l.startsWith("changed  src/cards/hello/v1/hello.ts")));
  git("checkout", "HEAD", "--", "src/cards/hello/v1/hello.ts");
  assert.equal(judgeStaged(root, "").code, 0);
  // blessing the edit by staging a re-minted manifest is refused
  w("src/cards/hello/v1/hello.ts", "export const a = 3;\n");
  const remint = mintManifest(root, { tag: "0.2.0", commit: "abc", excluded: m.excluded });
  fs.writeFileSync(path.join(root, FREEZE_MANIFEST_FILE), JSON.stringify(remint, null, 2) + "\n");
  git("add", "-A");
  v = judgeStaged(root, "");
  assert.equal(v.code, 1);
  assert.ok(v.lines.some((l) => l.startsWith("manifest moves")));
  // deleting a frozen file is refused
  git("checkout", "HEAD", "--", ".");
  git("rm", "-q", "src/util/base.ts");
  v = judgeStaged(root, "");
  assert.equal(v.code, 1);
  assert.ok(v.lines.some((l) => l.startsWith("DELETED  src/util/base.ts")));
});

/** A PNG-ish binary whose bytes include CR/LF pairs (text normalization would change its hash). */
const binary = (n) => Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, n, 0x0d, 0x0a, 0x0d]);
const readManifestFile = (root) => JSON.parse(fs.readFileSync(path.join(root, FREEZE_MANIFEST_FILE), "utf8"));

test("render-time assets are seeds: files under assets/ below a vN or _shared segment, never dotfiles or fingerprints", () => {
  assert.equal(isFrozenSeed("src/reels/lyric-triptych/v1/assets/reels-ui.png"), true);
  assert.equal(isFrozenSeed("src/_shared/assets/fonts/Anton-Regular.ttf"), true);
  assert.equal(isFrozenSeed("src/_shared/assets/fonts/OFL-Anton.txt"), true);
  assert.equal(isFrozenSeed("src/_shared/assets/.DS_Store"), false);
  assert.equal(isFrozenSeed("src/reels/lyric-triptych/v1/lyric-triptych.layout.m0"), false);
  assert.equal(isFrozenSeed("src/reels/lyric-triptych/v1/notes.md"), false);
  assert.equal(isFrozenSeed("assets/templates/x/preview.png"), false);
});

test("hashing: text files are CRLF-normalized, binaries hashed raw", () => {
  const b = binary(1);
  assert.notEqual(hashRaw(b), hashBytes(b));
  assert.equal(hashFor("src/x/v1/assets/a.png", b), hashRaw(b));
  assert.equal(hashFor("src/x/v1/assets/a.ttf", b), hashRaw(b));
  assert.equal(hashFor("src/x/v1/a.ts", Buffer.from("a\r\n")), hashBytes(Buffer.from("a\n")));
  assert.equal(hashFor("src/_shared/assets/fonts/OFL.txt", Buffer.from("a\r\n")), hashBytes(Buffer.from("a\n")));
});

test("assets: the mint hashes a frozen template's assets raw; a changed or a new asset in it fails the gate", () => {
  const { root, w } = pkg();
  fs.mkdirSync(path.join(root, "src/cards/hello/v1/assets"), { recursive: true });
  fs.writeFileSync(path.join(root, "src/cards/hello/v1/assets/guide.png"), binary(1));
  const m = mintManifest(root, { tag: "0.2.0", commit: "abc", excluded: ["src/lab/"] });
  assert.equal(m.hashVersion, FREEZE_HASH_VERSION);
  assert.equal(m.files["src/cards/hello/v1/assets/guide.png"], hashRaw(binary(1)));
  fs.writeFileSync(path.join(root, FREEZE_MANIFEST_FILE), JSON.stringify(m, null, 2) + "\n");
  assert.equal(run([], root).code, 0);
  // the bake tool re-draws the guide: a changed asset
  fs.writeFileSync(path.join(root, "src/cards/hello/v1/assets/guide.png"), binary(2));
  let r = run([], root);
  assert.equal(r.code, 1);
  assert.match(r.err, /changed {2}src\/cards\/hello\/v1\/assets\/guide\.png/);
  fs.writeFileSync(path.join(root, "src/cards/hello/v1/assets/guide.png"), binary(1));
  // …or writes a new file beside it: an intruder in a frozen template
  fs.writeFileSync(path.join(root, "src/cards/hello/v1/assets/guide.svg"), "<svg/>\n");
  r = run([], root);
  assert.equal(r.code, 1);
  assert.match(r.err, /added {4}src\/cards\/hello\/v1\/assets\/guide\.svg/);
  assert.deepEqual(checkTree(root, m).intruders, ["src/cards/hello/v1/assets/guide.svg"]);
  fs.rmSync(path.join(root, "src/cards/hello/v1/assets/guide.svg"));
  // a new asset in NEW work is fine
  w("src/cards/hello/v2/assets/guide.png", "x");
  assert.equal(run([], root).code, 0);
});

test("a v1 manifest (.ts only) fails the gate until re-minted; the re-mint carries its .ts hashes over", () => {
  const { root } = pkg();
  const git = gitIn(root);
  fs.mkdirSync(path.join(root, "src/cards/hello/v1/assets"), { recursive: true });
  fs.writeFileSync(path.join(root, "src/cards/hello/v1/assets/guide.png"), binary(1));
  git("add", "-A");
  git("commit", "-q", "--no-verify", "-m", "shipped");
  const v2 = mintManifest(root, { tag: "0.2.0", commit: "abc" });
  const v1Files = Object.fromEntries(Object.entries(v2.files).filter(([rel]) => rel.endsWith(".ts")));
  const { shipped: _shipped, ...legacy } = { ...v2, hashVersion: 1, files: v1Files };
  fs.writeFileSync(path.join(root, FREEZE_MANIFEST_FILE), JSON.stringify(legacy, null, 2) + "\n");
  const r = run([], root);
  assert.equal(r.code, 2);
  assert.match(r.err, /hashVersion 1 != checker 2/);
  assert.equal(run(["--update", "--tag", "0.2.0"], root).code, 0);
  const m = readManifestFile(root);
  for (const [rel, hash] of Object.entries(v1Files)) assert.equal(m.files[rel], hash, rel);
  assert.equal(m.files["src/cards/hello/v1/assets/guide.png"], hashRaw(binary(1)));
  assert.equal(run([], root).code, 0);
});

test("a 0.3.0 re-mint keeps the triptych at 0.2.0 and stamps 0.3.0 only on what it freezes now", () => {
  const { root, w } = pkg();
  const git = gitIn(root);
  w("src/reels/lyric-triptych/v1/lyric-triptych.ts", 'import { pages } from "./pages";\nexport const t = pages;\n');
  w("src/reels/lyric-triptych/v1/pages.ts", "export const pages = 1;\n");
  git("add", "-A");
  git("commit", "-q", "--no-verify", "-m", "0.2.0 templates");
  assert.equal(run(["--update", "--tag", "0.2.0"], root).code, 0);
  const first = readManifestFile(root);
  assert.equal(first.release, "0.2.0");
  assert.equal(first.shipped["src/reels/lyric-triptych/v1"], "0.2.0");
  git("add", "-A");
  git("commit", "-q", "--no-verify", "-m", "freeze 0.2.0");
  // the 0.3.0 work: a new template and a shared helper it imports
  w("src/_shared/bindings.ts", "export const declareBindings = (u) => ({ bindings: { unbound: u } });\n");
  w("src/reels/lyric-stack/v1/lyric-stack.ts", 'import { declareBindings } from "../../../_shared/bindings";\nexport const s = declareBindings({});\n');
  git("add", "-A");
  git("commit", "-q", "--no-verify", "-m", "0.3.0 templates");
  // a line older than the manifest's release is refused, and nothing is written
  let r = run(["--update", "--tag", "0.1.0"], root);
  assert.equal(r.code, 2);
  assert.match(r.err, /older than the manifest's release 0\.2\.0/);
  assert.deepEqual(readManifestFile(root), first);
  r = run(["--update", "--tag", "0.3.0"], root);
  assert.equal(r.code, 0, r.err);
  const second = readManifestFile(root);
  assert.equal(second.release, "0.3.0");
  assert.deepEqual(second.shipped, {
    "src/basics/hello-world/v1": "0.2.0",
    "src/cards/hello/v1": "0.2.0",
    "src/lab/flow/v1": "0.2.0",
    "src/reels/lyric-stack/v1": "0.3.0",
    "src/reels/lyric-triptych/v1": "0.2.0",
  });
  assert.ok(second.files["src/_shared/bindings.ts"]);
  const lines = shippedReleasesFrom(second, "@rainier");
  assert.equal(lines.get("@rainier/reels/lyric-triptych/v1"), "0.2.0");
  assert.equal(lines.get("@rainier/reels/lyric-stack/v1"), "0.3.0");
  assert.deepEqual(additiveViolations(first, second), []);
  // minting the same line again is idempotent on the lines
  assert.equal(run(["--update", "--tag", "0.3.0"], root).code, 0);
  assert.deepEqual(readManifestFile(root).shipped, second.shipped);
});

test("mint: a hand-restamped line is refused (HEAD's manifest is law too)", () => {
  const { root } = pkg();
  const git = gitIn(root);
  git("add", "-A");
  git("commit", "-q", "--no-verify", "-m", "shipped");
  assert.equal(run(["--update", "--tag", "0.2.0"], root).code, 0);
  git("add", "-A");
  git("commit", "-q", "--no-verify", "-m", "freeze");
  const m = readManifestFile(root);
  // someone "moves" hello to 0.3.0 in the tree to silence its lag
  fs.writeFileSync(path.join(root, FREEZE_MANIFEST_FILE), JSON.stringify({ ...m, release: "0.3.0", shipped: { ...m.shipped, "src/cards/hello/v1": "0.3.0" } }, null, 2) + "\n");
  const r = run(["--update", "--tag", "0.3.0"], root);
  assert.equal(r.code, 1);
  assert.match(r.err, /restamps {2}src\/cards\/hello\/v1 {2}\(shipped at 0\.2\.0/);
});

test("mint: a manifest committed at HEAD but missing from the tree is never re-minted over", () => {
  const { root, w } = pkg();
  const git = gitIn(root);
  git("add", "-A");
  git("commit", "-q", "--no-verify", "-m", "shipped");
  assert.equal(run(["--update", "--tag", "0.2.0"], root).code, 0);
  git("add", "-A");
  git("commit", "-q", "--no-verify", "-m", "freeze");
  const frozen = readManifestFile(root);
  // an edit to a frozen file, committed; then the manifest disappears from the tree
  w("src/util/base.ts", "export const base = 2;\n");
  git("add", "-A");
  git("commit", "-q", "--no-verify", "-m", "edit a frozen file");
  assert.equal(run(["--update", "--tag", "0.3.0"], root).code, 1); // refused while the manifest is there
  fs.rmSync(path.join(root, FREEZE_MANIFEST_FILE));
  const r = run(["--update", "--tag", "0.3.0"], root);
  assert.equal(r.code, 2);
  assert.match(r.err, /MISSING from the tree but committed at HEAD/);
  assert.equal(fs.existsSync(path.join(root, FREEZE_MANIFEST_FILE)), false);
  // HEAD's manifest alone still guards: restore the tree copy and the mint refuses the edit
  fs.writeFileSync(path.join(root, FREEZE_MANIFEST_FILE), JSON.stringify(frozen, null, 2) + "\n");
  assert.equal(run(["--update", "--tag", "0.3.0"], root).code, 1);
});

test("judgeStaged: an asset added inside a frozen template, or a restamped line, is refused", () => {
  const { root, w } = pkg();
  const git = gitIn(root);
  const m = mintManifest(root, { tag: "0.2.0", commit: "abc", excluded: ["src/lab/"] });
  fs.writeFileSync(path.join(root, FREEZE_MANIFEST_FILE), JSON.stringify(m, null, 2) + "\n");
  git("add", "-A");
  git("commit", "-q", "--no-verify", "-m", "frozen");
  w("src/cards/hello/v1/assets/guide.svg", "<svg/>\n");
  git("add", "-A");
  let v = judgeStaged(root, "");
  assert.equal(v.code, 1);
  assert.ok(v.lines.some((l) => l.startsWith("added  src/cards/hello/v1/assets/guide.svg")), v.lines.join("\n"));
  git("reset", "-q", "HEAD", "--", "src/cards/hello/v1/assets/guide.svg");
  fs.rmSync(path.join(root, "src/cards/hello/v1/assets"), { recursive: true });
  // a test beside a frozen template is not frozen-shaped: fine
  w("src/cards/hello/v1/hello.more.test.ts", "test('y', () => {});\n");
  git("add", "-A");
  assert.equal(judgeStaged(root, "").code, 0);
  fs.writeFileSync(path.join(root, FREEZE_MANIFEST_FILE), JSON.stringify({ ...m, release: "0.3.0", shipped: { ...m.shipped, "src/cards/hello/v1": "0.3.0" } }, null, 2) + "\n");
  git("add", "-A");
  v = judgeStaged(root, "");
  assert.equal(v.code, 1);
  assert.ok(v.lines.some((l) => l.startsWith("manifest restamps  src/cards/hello/v1")), v.lines.join("\n"));
});
