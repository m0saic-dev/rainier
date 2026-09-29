"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.templateRegistry = exports.CHAPTERS = void 0;
const registry_1 = require("./basics/registry");
const registry_2 = require("./reels/registry");
const registry_3 = require("./explore/registry");
/**
 * Every template, chapter by chapter. Array order is display order — the
 * manifest generator flattens this verbatim into template-manifest.json
 * and asserts it agrees exactly with what src/index.ts exports.
 */
exports.CHAPTERS = [
    { pack: "basics", entries: registry_1.basicsRegistry },
    { pack: "reels", entries: registry_2.reelsRegistry },
    // Experiments stay the last chapter (see EXPLORE.md).
    { pack: "explore", entries: registry_3.exploreRegistry },
];
/** Flat view over every chapter, in order. */
exports.templateRegistry = exports.CHAPTERS.flatMap((chapter) => chapter.entries);
