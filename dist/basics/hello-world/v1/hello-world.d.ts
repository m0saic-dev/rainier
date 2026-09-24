/**
 * `@rainier/basics/hello-world/v1` — this repo's FRONT DOOR, and
 * its one template.
 *
 * The canonical m0saic hello-world card — the brand-pattern field wiping in,
 * the M assembling from its own rectangles, the wordmark, a greeting — with
 * THIS repo's subline under it. It is one call to `defineHelloWorldTemplate`
 * from `@m0saic/template-utils`: every template repo ships the same card, so
 * `m0saic hello-world --template-repo .` and Make's "Start here" land on
 * something a newcomer already recognises.
 *
 * The convention (`repo.helloWorld` in src/repo.ts names this id):
 *   · default chrome — keep this call; the subline is ONE string, edited in
 *     src/repo.ts (`displayName`) or passed explicitly below;
 *   · your own look — write your own template and point `repo.helloWorld`
 *     at it. The build warns (never fails) while a repo names no front door.
 *
 * Your first REAL template: `npm run new -- basics/my-card --title "My Card"`
 * scaffolds one that passes every gate as generated.
 */
import type { HelloWorldProps } from "@m0saic/template-utils";
export declare const HELLO_WORLD_ID = "@rainier/basics/hello-world/v1";
export declare const HelloWorldV1: import("@m0saic/types").MosaicTemplate<HelloWorldProps, import("@m0saic/types").MosaicTemplateOutputs, import("@m0saic/types").MosaicTemplateUpstreamVariables, import("@m0saic/types").MosaicTemplateUpstreamData, import("@m0saic/types").MosaicTemplateSidecars>;
export default HelloWorldV1;
