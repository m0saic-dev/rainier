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
exports.exploreTemplates = void 0;
const cover_shards_1 = require("./cover-shards/v1/cover-shards");
const margins_1 = require("./margins/v1/margins");
/** Pack `explore`, in registry order (mirrors ./registry.ts). */
exports.exploreTemplates = [
    cover_shards_1.CoverShardsV1,
    margins_1.MarginsV1,
];
// `export *` ONLY — see the note in src/index.ts.
__exportStar(require("./cover-shards/v1/cover-shards"), exports);
__exportStar(require("./margins/v1/margins"), exports);
