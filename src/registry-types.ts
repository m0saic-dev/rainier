import type { MosaicTemplateRepoManifestEntry } from "@m0saic/types";

/**
 * One row of the authoring registry — the browse metadata for a template,
 * kept next to the code that exports it (each chapter has a registry.ts).
 *
 * The build's manifest generator turns these rows into template-manifest.json
 * and ASSERTS they agree exactly with the templates the entry module exports:
 * a template can't ship unregistered, and a registry row can't outlive its
 * template.
 */
export type StarterRegistryEntry = {
  /** Slug segment of the id — `<repoId>/<pack>/<SLUG>/vN`. */
  slug: string;

  /** The FULL versioned template id, e.g. `"@rainier/basics/hello-world/v1"`. */
  templateId: string;

  /** Named export on the repo entry module (src/index.ts) that yields the template. */
  exportName: string;

  /** Card title on the Templates page. */
  title: string;

  /** One-paragraph description: WHAT it shows and the one concept it teaches. */
  description: string;

  /** Browse tags. Every entry carries its chapter tag plus free-form ones. */
  tags: string[];

  /**
   * Explicit preview overrides. Usually omitted — the generator discovers
   * assets/templates/<id with "/" -> "__">/preview.png|preview.mp4|poster.png
   * by convention.
   */
  preview?: MosaicTemplateRepoManifestEntry["preview"];
};

/** A curriculum chapter: one pack of templates, in teaching order. */
export type StarterChapter = {
  /** Pack id — the `<pack>` id segment AND the src/<pack>/ folder name. */
  pack: string;

  /** Registry rows in curriculum order (array order is authoritative). */
  entries: StarterRegistryEntry[];
};
