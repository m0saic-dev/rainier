"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.reelsTemplates = void 0;
const lyric_triptych_1 = require("./lyric-triptych/v1/lyric-triptych");
const take_cutter_1 = require("./take-cutter/v1/take-cutter");
const lyric_stack_1 = require("./lyric-stack/v1/lyric-stack");
/**
 * The shipped Lyric Triptych, deprecated FROM THE BARREL in favour of Lyric
 * Stack, so its frozen file stays byte-identical (AGENTS.md, the freeze rule).
 * Hosts list a deprecated template behind "Show deprecated" with a pointer to
 * the replacement; lookups by id, and projects that already use it, keep
 * working.
 */
const lyricTriptychDeprecated = {
    ...lyric_triptych_1.LyricTriptychV1,
    deprecated: {
        reason: "Superseded by Lyric Stack: one to four takes, the font you pick, lyrics timed once per song, and a platform guide that never bakes into the export.",
        replacement: lyric_stack_1.LyricStackV1.id,
        since: "2026-09-27",
    },
};
/** Pack `reels`, in registry order (mirrors ./registry.ts). */
exports.reelsTemplates = [
    lyricTriptychDeprecated,
    take_cutter_1.TakeCutterV1,
    lyric_stack_1.LyricStackV1,
];
// `export *` ONLY — see the note in src/index.ts. Exported names must be
// unique across the pack's template modules (a clash is a tsc error), so a
// new template prefixes its constants (LYRIC_STACK_MAX_PAGES, not MAX_PAGES).
// The named `LyricTriptychV1` re-exported below is the frozen object exactly
// as shipped (no `deprecated`); hosts read `templates[]`, which carries the
// deprecated copy above.
__exportStar(require("./lyric-triptych/v1/lyric-triptych"), exports);
__exportStar(require("./take-cutter/v1/take-cutter"), exports);
__exportStar(require("./lyric-stack/v1/lyric-stack"), exports);
