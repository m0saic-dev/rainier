// Run with: node --test tools/freeze-manifest.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  FREEZE_MANIFEST_FILE, assertReleaseShape, compareLines, frozenWriteReason, readFreezeManifest, shippedFolderReleases, shippedIdsFrom, shippedReleasesFrom,
  templateFolderOf,
} from "./freeze-manifest.mjs";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "fmanifest-"));

test("readFreezeManifest: null when absent, the object when present, a named error when malformed", () => {
  const root = tmp();
  assert.equal(readFreezeManifest(root), null);
  fs.writeFileSync(path.join(root, FREEZE_MANIFEST_FILE), JSON.stringify({ release: "0.2.0", files: {} }));
  assert.deepEqual(readFreezeManifest(root), { release: "0.2.0", files: {} });
  fs.writeFileSync(path.join(root, FREEZE_MANIFEST_FILE), "{ nope");
  assert.throws(() => readFreezeManifest(root), /frozen\.manifest\.json is not valid JSON/);
  fs.writeFileSync(path.join(root, FREEZE_MANIFEST_FILE), "[]");
  assert.throws(() => readFreezeManifest(root), /JSON object/);
});

test("assertReleaseShape: only MAJOR.MINOR.PATCH passes — a date would compare as 2026.0.0", () => {
  assert.equal(assertReleaseShape("0.2.0"), "0.2.0");
  assert.equal(assertReleaseShape("10.20.300"), "10.20.300");
  for (const bad of ["2026-09-20", "v0.2.0", "0.2", "0.2.0-rc.1", " 0.2.0", "", null, undefined, 20]) {
    assert.throws(() => assertReleaseShape(bad), /release must be the m0saic line/, String(bad));
  }
});

test("shippedIdsFrom: hashed src/<pack>/<slug>/vN/ paths become repo ids; helpers and tooling do not", () => {
  const manifest = {
    release: "0.2.0",
    files: {
      "src/basics/hello-world/v1/hello-world.ts": "a",
      "src/reels/lyric-triptych/v1/document.ts": "b",
      "src/reels/lyric-triptych/v1/lyric-triptych.ts": "c",
      "src/reels/lyric-triptych/v2/lyric-triptych.ts": "d",
      "src/_shared/bindings.ts": "e",
      "src/reels/_shared/theme.ts": "f",
      "src/util/base.ts": "g",
    },
  };
  assert.deepEqual(shippedIdsFrom(manifest, "@rainier"), [
    "@rainier/basics/hello-world/v1",
    "@rainier/reels/lyric-triptych/v1",
    "@rainier/reels/lyric-triptych/v2",
  ]);
  assert.deepEqual(shippedIdsFrom(null, "@rainier"), []);
  assert.deepEqual(shippedIdsFrom({ release: "0.2.0" }, "@rainier"), []);
  assert.throws(() => shippedIdsFrom(manifest, ""), /repoId/);
});

test("compareLines orders m0saic lines as semver, not as strings", () => {
  assert.ok(compareLines("0.2.0", "0.3.0") < 0);
  assert.ok(compareLines("0.10.0", "0.9.9") > 0);
  assert.equal(compareLines("0.3.0", "0.3.0"), 0);
});

test("templateFolderOf: src/<pack>/<slug>/vN for template files, null for helpers", () => {
  assert.equal(templateFolderOf("src/reels/lyric-triptych/v1/pages.ts"), "src/reels/lyric-triptych/v1");
  assert.equal(templateFolderOf("src/reels/lyric-triptych/v1/assets/reels-ui.png"), "src/reels/lyric-triptych/v1");
  assert.equal(templateFolderOf("src/_shared/assets/reels-ui.png"), null);
  assert.equal(templateFolderOf("src/reels/_shared/theme.ts"), null);
  assert.equal(templateFolderOf("src/repo.ts"), null);
});

const TRIPTYCH = "src/reels/lyric-triptych/v1";
const HELLO = "src/basics/hello-world/v1";
const STACK = "src/reels/lyric-stack/v1";
const files = {
  [`${HELLO}/hello-world.ts`]: "a",
  [`${TRIPTYCH}/pages.ts`]: "b",
  [`${TRIPTYCH}/assets/reels-ui.png`]: "c",
  [`${STACK}/lyric-stack.ts`]: "d",
  "src/_shared/bindings.ts": "e",
};

test("shippedFolderReleases: a manifest without `shipped` ships every hashed folder at `release`", () => {
  assert.deepEqual(shippedFolderReleases({ release: "0.2.0", files }), { [HELLO]: "0.2.0", [STACK]: "0.2.0", [TRIPTYCH]: "0.2.0" });
  assert.deepEqual(shippedFolderReleases(null), {});
  assert.throws(() => shippedFolderReleases({ release: "2026-09-20", files }), /m0saic line/);
});

test("shippedFolderReleases: `shipped` gives each folder its own line; inconsistencies fail closed", () => {
  const shipped = { [HELLO]: "0.2.0", [TRIPTYCH]: "0.2.0", [STACK]: "0.3.0" };
  assert.deepEqual(shippedFolderReleases({ release: "0.3.0", shipped, files }), shipped);
  const { [STACK]: _dropped, ...missing } = shipped;
  assert.throws(() => shippedFolderReleases({ release: "0.3.0", shipped: missing, files }), /lyric-stack\/v1 is hashed but "shipped" names no m0saic line/);
  assert.throws(() => shippedFolderReleases({ release: "0.3.0", shipped: { ...shipped, "src/reels/gone/v1": "0.2.0" }, files }), /no hashed file lives/);
  assert.throws(() => shippedFolderReleases({ release: "0.3.0", shipped: { ...shipped, [STACK]: "2026-09-27" }, files }), /shipped\["src\/reels\/lyric-stack\/v1"\]: release must be the m0saic line/);
  assert.throws(() => shippedFolderReleases({ release: "0.2.0", shipped, files }), /newer than the manifest's release 0\.2\.0/);
  assert.throws(() => shippedFolderReleases({ release: "0.3.0", shipped: [], files }), /"shipped" must map/);
});

test("shippedReleasesFrom: template id -> the line THAT template shipped at", () => {
  const m = { release: "0.3.0", shipped: { [HELLO]: "0.2.0", [TRIPTYCH]: "0.2.0", [STACK]: "0.3.0" }, files };
  assert.deepEqual([...shippedReleasesFrom(m, "@rainier")], [
    ["@rainier/basics/hello-world/v1", "0.2.0"],
    ["@rainier/reels/lyric-stack/v1", "0.3.0"],
    ["@rainier/reels/lyric-triptych/v1", "0.2.0"],
  ]);
  assert.deepEqual(shippedIdsFrom(m, "@rainier"), [...shippedReleasesFrom(m, "@rainier").keys()]);
  assert.equal(shippedReleasesFrom(null, "@rainier").size, 0);
  assert.throws(() => shippedReleasesFrom(m, ""), /repoId/);
});

test("frozenWriteReason: a bake tool may not write a hashed file or into a frozen template folder", () => {
  const root = tmp();
  assert.equal(frozenWriteReason(root, path.join(root, TRIPTYCH, "assets/reels-ui.png")), null); // no manifest: nothing frozen
  fs.writeFileSync(path.join(root, FREEZE_MANIFEST_FILE), JSON.stringify({ release: "0.2.0", files }));
  assert.match(frozenWriteReason(root, path.join(root, TRIPTYCH, "assets/reels-ui.png")), /is hashed/);
  assert.match(frozenWriteReason(root, path.join(root, TRIPTYCH, "assets/reels-ui.svg")), /inside src\/reels\/lyric-triptych\/v1\//);
  assert.match(frozenWriteReason(root, path.join(root, "src/_shared/bindings.ts")), /is hashed/);
  assert.equal(frozenWriteReason(root, path.join(root, "src/_shared/assets/tiktok-ui.png")), null);
  assert.equal(frozenWriteReason(root, path.join(root, "src/reels/lyric-triptych/v2/assets/reels-ui.png")), null);
});
