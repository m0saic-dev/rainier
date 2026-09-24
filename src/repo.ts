import type {
  MosaicTemplatePackDescriptor,
  MosaicTemplateRepoDescriptor,
} from "@m0saic/types";
import { asRepoId, asTemplateId } from "@m0saic/types";

/**
 * Who this repo is. The entry module (src/index.ts) re-exports this as
 * `repo` — one of the two exports every Mosaic host requires from an
 * external template repo (the other is `templates`).
 *
 * FORKS RENAME THEMSELVES HERE, AND ONLY HERE. Change `repoId` to your own
 * handle, update every template id's prefix to match, and rebuild — the
 * manifest generator, contract check, and dep gate all derive the expected
 * id namespace from this one field. Id ownership in a running host is
 * first-registrant-wins per id, so never squat someone else's handle.
 */
export const TEMPLATE_REPO: MosaicTemplateRepoDescriptor = {
  // A shared sandbox for templates built with (and tested by) working
  // artists. Generic by rule: this repo is PUBLIC, so no template, default
  // or preview ever carries a real artist's name, handle, lyrics or media —
  // the artist brings their own in Mosaic Desktop.
  repoId: asRepoId("@rainier"),
  displayName: "Rainier",
  schemaVersion: 1,
  description:
    "A shared template repo for artists testing m0saic: layouts lifted from real short-form posts, rebuilt as templates you fill with your own clips, song and lyrics. Add it in Mosaic Desktop (Templates -> Add source) and new templates arrive with each update.",
  curator: "Rainier",
  homepage: "https://github.com/m0saic-project/rainier",
  assets: { templatesDir: "assets/templates" },
  // The front door — the template a newcomer renders first (the hello-world
  // convention): the canonical card with this repo's subline. Point it at
  // your own template if you want your own look.
  helloWorld: asTemplateId("@rainier/basics/hello-world/v1"),
};

/**
 * Packs, in display order. One is enough to start; add more by mirroring
 * the basics/ folder (pack id = folder name = the <pack> segment of ids).
 */
export const TEMPLATE_PACKS: MosaicTemplatePackDescriptor[] = [
  {
    id: "basics",
    title: "Basics",
    description: "The front door. The real templates live in their own packs.",
  },
  {
    id: "reels",
    title: "Reels",
    description:
      "Vertical 9:16 layouts for Instagram Reels, TikTok and Shorts: your clips, your song, your words.",
  },
];
