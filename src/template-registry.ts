import type { StarterChapter, StarterRegistryEntry } from "./registry-types";
import { basicsRegistry } from "./basics/registry";
import { reelsRegistry } from "./reels/registry";

/**
 * Every template, chapter by chapter. Array order is display order — the
 * manifest generator flattens this verbatim into template-manifest.json
 * and asserts it agrees exactly with what src/index.ts exports.
 */
export const CHAPTERS: StarterChapter[] = [
  { pack: "basics", entries: basicsRegistry },
  { pack: "reels", entries: reelsRegistry },
];

/** Flat view over every chapter, in order. */
export const templateRegistry: StarterRegistryEntry[] = CHAPTERS.flatMap(
  (chapter) => chapter.entries,
);
