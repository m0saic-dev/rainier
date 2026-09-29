import type { MosaicTemplate, MosaicTemplateProps } from "@m0saic/types";

import { LyricTriptychV1 } from "./lyric-triptych/v1/lyric-triptych";
import { TakeCutterV1 } from "./take-cutter/v1/take-cutter";
import { LyricStackV1 } from "./lyric-stack/v1/lyric-stack";

/**
 * The shipped Lyric Triptych, deprecated FROM THE BARREL in favour of Lyric
 * Stack, so its frozen file stays byte-identical (AGENTS.md, the freeze rule).
 * Hosts list a deprecated template behind "Show deprecated" with a pointer to
 * the replacement; lookups by id, and projects that already use it, keep
 * working.
 */
const lyricTriptychDeprecated = {
  ...LyricTriptychV1,
  deprecated: {
    reason:
      "Superseded by Lyric Stack: one to four takes, the font you pick, lyrics timed once per song, and a platform guide that never bakes into the export.",
    replacement: LyricStackV1.id,
    since: "2026-09-27",
  },
};

/** Pack `reels`, in registry order (mirrors ./registry.ts). */
export const reelsTemplates: MosaicTemplate<MosaicTemplateProps>[] = [
  lyricTriptychDeprecated as unknown as MosaicTemplate<MosaicTemplateProps>,
  TakeCutterV1 as unknown as MosaicTemplate<MosaicTemplateProps>,
  LyricStackV1 as unknown as MosaicTemplate<MosaicTemplateProps>,
];

// `export *` ONLY — see the note in src/index.ts. Exported names must be
// unique across the pack's template modules (a clash is a tsc error), so a
// new template prefixes its constants (LYRIC_STACK_MAX_PAGES, not MAX_PAGES).
// The named `LyricTriptychV1` re-exported below is the frozen object exactly
// as shipped (no `deprecated`); hosts read `templates[]`, which carries the
// deprecated copy above.
export * from "./lyric-triptych/v1/lyric-triptych";
export * from "./take-cutter/v1/take-cutter";
export * from "./lyric-stack/v1/lyric-stack";
