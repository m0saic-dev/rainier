import * as fs from "node:fs";
import * as path from "node:path";

import { buildStarterManifest } from "./gen-template-manifest";

/**
 * Manifest freshness: the template-manifest.json on disk (written by
 * `npm run build`; not committed) must be exactly what the current source
 * builds. A drifted manifest means someone edited templates (or the
 * registry) without rebuilding — the browse surface would lie about the code.
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
