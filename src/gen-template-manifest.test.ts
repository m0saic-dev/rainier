import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import { buildStarterManifest } from "./gen-template-manifest";

/**
 * Manifest freshness: the template-manifest.json on disk (written by
 * `npm run build`, and COMMITTED — Mosaic Desktop reads it straight from
 * GitHub) must be exactly what the current source builds. A drifted manifest
 * means someone edited templates (or the registry) without rebuilding — the
 * browse surface would lie about the code, in every copy that loads the repo.
 */
describe("template-manifest.json freshness", () => {
  it("matches buildStarterManifest() output exactly", () => {
    const onDiskPath = path.resolve(__dirname, "..", "template-manifest.json");
    if (!fs.existsSync(onDiskPath)) {
      throw new Error("template-manifest.json is missing — run `npm run build` before `npm test`");
    }
    const onDisk = JSON.parse(fs.readFileSync(onDiskPath, "utf8"));
    expect(onDisk).toEqual(JSON.parse(JSON.stringify(buildStarterManifest())));
  });
});

/**
 * Ordinals: the generator above asserts every `NN · ` title and label. When a
 * template lands in an earlier pack, tools/stamp-ordinals.mjs restamps the
 * later ones (a FROZEN template's label in its pack barrel, never in the
 * frozen file). It must be able to read every registry row, label and barrel
 * entry the repo has TODAY, or the next renumber finds out the hard way.
 */
describe("curriculum ordinals", () => {
  it("tools/stamp-ordinals.mjs --check reads the whole repo and finds it in step", () => {
    const root = path.resolve(__dirname, "..");
    const r = spawnSync(process.execPath, [path.join(root, "tools", "stamp-ordinals.mjs"), "--check"], { cwd: root, encoding: "utf8" });
    expect({ status: r.status, stderr: r.stderr }).toEqual({ status: 0, stderr: "" });
  });
});
