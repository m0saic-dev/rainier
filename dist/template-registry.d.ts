import type { StarterChapter, StarterRegistryEntry } from "./registry-types";
/**
 * Every template, chapter by chapter. Array order is display order — the
 * manifest generator flattens this verbatim into template-manifest.json
 * and asserts it agrees exactly with what src/index.ts exports.
 */
export declare const CHAPTERS: StarterChapter[];
/** Flat view over every chapter, in order. */
export declare const templateRegistry: StarterRegistryEntry[];
