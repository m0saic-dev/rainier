import type { MosaicTemplate, MosaicTemplateProps } from "@m0saic/types";

import { CoverShardsV1 } from "./cover-shards/v1/cover-shards";
import { MarginsV1 } from "./margins/v1/margins";

/** Pack `explore`, in registry order (mirrors ./registry.ts). */
export const exploreTemplates: MosaicTemplate<MosaicTemplateProps>[] = [
  CoverShardsV1 as unknown as MosaicTemplate<MosaicTemplateProps>,
  MarginsV1 as unknown as MosaicTemplate<MosaicTemplateProps>,
];

// `export *` ONLY — see the note in src/index.ts.
export * from "./cover-shards/v1/cover-shards";
export * from "./margins/v1/margins";
