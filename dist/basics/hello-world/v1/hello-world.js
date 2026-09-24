"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HelloWorldV1 = exports.HELLO_WORLD_ID = void 0;
const template_utils_1 = require("@m0saic/template-utils");
const types_1 = require("@m0saic/types");
const repo_1 = require("../../../repo");
exports.HELLO_WORLD_ID = "@rainier/basics/hello-world/v1";
/** The canonical card, built by the factory. */
const card = (0, template_utils_1.defineHelloWorldTemplate)({
    id: exports.HELLO_WORLD_ID,
    label: "01 · Hello World",
    // The subline — the muted line under the greeting. One string, one edit.
    subline: `by ${repo_1.TEMPLATE_REPO.displayName}`,
    tags: ["basics", "starter", "brand", "hello"],
    description: "The canonical m0saic hello-world card with this repo's subline: the brand field wipes in, a navy card rises, the M assembles from its own rectangles, then the wordmark and your greeting. The repo's front door — what `m0saic hello-world --template-repo .` renders. Replace it with your first real template, or keep it and point repo.helloWorld at your own.",
});
// Spelled out as a literal (not just `card`) on purpose: the repo's
// NO-INSTALL contract check (`npm run test:contract`) loads this module with
// the whole substrate stubbed to an identity proxy, so a factory call alone
// would read as an options bag. The structural fields it asserts — a numeric
// version, a render() function, a props schema — live HERE; with the real
// substrate installed they are exactly the factory's own.
exports.HelloWorldV1 = (0, template_utils_1.defineMosaicTemplate)({
    ...card,
    id: (0, types_1.asTemplateId)(exports.HELLO_WORLD_ID),
    version: 1,
    propsSchema: { ...template_utils_1.HELLO_WORLD_PROPS_SCHEMA },
    defaultProps: { ...card.defaultProps },
    render: (props, ctx) => card.render(props, ctx),
});
exports.default = exports.HelloWorldV1;
