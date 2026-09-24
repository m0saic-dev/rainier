import type { MosaicTemplate, MosaicTemplateProps } from "@m0saic/types";

import { LyricTriptychV1 } from "./lyric-triptych/v1/lyric-triptych";

/** Pack `reels`, in registry order (mirrors ./registry.ts). */
export const reelsTemplates: MosaicTemplate<MosaicTemplateProps>[] = [
  LyricTriptychV1 as unknown as MosaicTemplate<MosaicTemplateProps>,
];

// `export *` ONLY — see the note in src/index.ts.
export * from "./lyric-triptych/v1/lyric-triptych";
