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
exports.TEMPLATE_REPO = exports.TEMPLATE_PACKS = exports.templates = exports.repo = void 0;
const repo_1 = require("./repo");
Object.defineProperty(exports, "TEMPLATE_PACKS", { enumerable: true, get: function () { return repo_1.TEMPLATE_PACKS; } });
Object.defineProperty(exports, "TEMPLATE_REPO", { enumerable: true, get: function () { return repo_1.TEMPLATE_REPO; } });
const basics_1 = require("./basics");
const reels_1 = require("./reels");
/** The two exports every Mosaic host requires from a template repo. */
exports.repo = repo_1.TEMPLATE_REPO;
exports.templates = [
    ...basics_1.basicsTemplates,
    ...reels_1.reelsTemplates,
];
// Library re-exports for anyone importing this repo as code. `export *`
// ONLY for template modules — never pair `export * from "./x"` with a
// named re-export of the same module (tsc double-require hazard).
__exportStar(require("./basics"), exports);
__exportStar(require("./reels"), exports);
