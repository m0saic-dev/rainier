import type { StarterRegistryEntry } from "../registry-types";

/**
 * Pack registry: `explore` — array order is the display order. Experiments,
 * one per session (see EXPLORE.md). Keep this the LAST chapter in
 * src/template-registry.ts so an explore session never renumbers a
 * production card.
 */
export const exploreRegistry: StarterRegistryEntry[] = [
  {
    slug: "cover-shards",
    templateId: "@rainier/explore/cover-shards/v1",
    exportName: "CoverShardsV1",
    title: "05 · Cover Shards",
    description:
      "Your cover art builds itself from its own tiles, each one landing on a beat you tap to the song, then your release line rises in underneath. A 9:16 teaser of about 6 seconds for release week. Experiment.",
    tags: ["explore", "experiment", "cover", "release", "music", "musicians", "creators", "vertical", "animated"],
  },
  {
    slug: "margins",
    templateId: "@rainier/explore/margins/v1",
    exportName: "MarginsV1",
    title: "06 · Margins",
    description:
      "A photo of your handwritten lyric page, marked line by line as you sing: tap each line to the voice memo or the song, and a highlighter stroke, underline or hand-drawn box lands on it. The words stay yours; the template writes none. 9:16. Experiment.",
    tags: ["explore", "experiment", "lyrics", "songwriting", "music", "musicians", "creators", "vertical", "animated"],
  },
];
