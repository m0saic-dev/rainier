import type { StarterRegistryEntry } from "../registry-types";

/**
 * Pack registry: `basics`. One row per template — the browse metadata the
 * manifest is generated from. The title's `NN · ` prefix is the display
 * ordinal and must match the row's position (the generator asserts it).
 */
export const basicsRegistry: StarterRegistryEntry[] = [
  {
    slug: "hello-world",
    templateId: "@rainier/basics/hello-world/v1",
    exportName: "HelloWorldV1",
    title: "01 · Hello World",
    description:
      "The canonical m0saic hello-world card with this repo's subline: the brand field wipes in, a navy card rises, the M assembles from its own rectangles, then the wordmark and your greeting. The repo's front door — what `m0saic hello-world --template-repo .` renders. Replace it with your first real template, or keep it and point repo.helloWorld at your own.",
    tags: ["basics", "starter", "brand", "hello"],
  },
];
