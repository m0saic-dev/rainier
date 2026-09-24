import type { MosaicTemplate, MosaicTemplateProps } from "@m0saic/types";

import { HelloWorldV1 } from "./hello-world/v1/hello-world";

/** Pack `basics`, in registry order (mirrors ./registry.ts). */
export const basicsTemplates: MosaicTemplate<MosaicTemplateProps>[] = [
  HelloWorldV1 as unknown as MosaicTemplate<MosaicTemplateProps>,
];

// `export *` ONLY — see the note in src/index.ts.
export * from "./hello-world/v1/hello-world";
