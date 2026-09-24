import type { MosaicTemplate, MosaicTemplateProps } from "@m0saic/types";
import { TEMPLATE_PACKS, TEMPLATE_REPO } from "./repo";
/** The two exports every Mosaic host requires from a template repo. */
export declare const repo: import("@m0saic/types").MosaicTemplateRepoDescriptor;
export declare const templates: MosaicTemplate<MosaicTemplateProps>[];
export * from "./basics";
export * from "./reels";
export { TEMPLATE_PACKS, TEMPLATE_REPO };
