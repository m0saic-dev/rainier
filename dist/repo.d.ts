import type { MosaicTemplatePackDescriptor, MosaicTemplateRepoDescriptor } from "@m0saic/types";
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
export declare const TEMPLATE_REPO: MosaicTemplateRepoDescriptor;
/**
 * Packs, in display order. One is enough to start; add more by mirroring
 * the basics/ folder (pack id = folder name = the <pack> segment of ids).
 */
export declare const TEMPLATE_PACKS: MosaicTemplatePackDescriptor[];
