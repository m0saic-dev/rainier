"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GUIDE_PNG_SHA256 = exports.GUIDE_REGIONS = exports.GUIDE_PNG_SIZE = void 0;
/** The size every guide PNG is baked at, px. */
exports.GUIDE_PNG_SIZE = Object.freeze({ width: 1080, height: 1920 });
const region = (name, x, y, w, h) => Object.freeze({ name, rect: Object.freeze({ x, y, w, h }) });
/** Every platform's regions, in drawing order. */
exports.GUIDE_REGIONS = Object.freeze({
    reels: Object.freeze([
        region("statusBar", 142, 32, 812, 96),
        region("navRow", 126, 188, 866, 50),
        region("safeTopEdge", 52, 238, 976, 6),
        region("actionRail", 908, 962, 120, 918),
        region("safeBottomEdge", 52, 1628, 856, 6),
        region("captionBlock", 86, 1634, 580, 236),
        region("sideCropLeft", 0, 0, 52, 1916),
        region("sideCropRight", 1028, 0, 52, 1916),
        region("progressBar", 0, 1916, 1080, 4),
    ]),
    tiktok: Object.freeze([
        region("statusBar", 142, 32, 812, 96),
        region("navRow", 378, 198, 610, 46),
        region("safeTopEdge", 54, 244, 972, 6),
        region("actionRail", 894, 950, 132, 940),
        region("safeBottomEdge", 54, 1744, 840, 6),
        region("captionBlock", 80, 1750, 560, 134),
        region("sideCropLeft", 0, 0, 54, 1916),
        region("sideCropRight", 1026, 0, 54, 1916),
        region("progressBar", 0, 1916, 1080, 4),
    ]),
    shorts: Object.freeze([
        region("statusBar", 142, 32, 812, 96),
        region("navRow", 814, 186, 146, 44),
        region("safeTopEdge", 54, 230, 972, 4),
        region("actionRail", 894, 1060, 132, 816),
        region("safeBottomEdge", 54, 1732, 840, 6),
        region("captionBlock", 80, 1738, 462, 138),
        region("sideCropLeft", 0, 0, 54, 1916),
        region("sideCropRight", 1026, 0, 54, 1916),
        region("progressBar", 0, 1916, 1080, 4),
    ]),
});
/** SHA-256 of each PNG the regions were derived from (the test re-hashes the files). */
exports.GUIDE_PNG_SHA256 = Object.freeze({
    reels: "3d95ca3d7fe37fe3997bb27fe6aed1840f414766d2618248292a7de4c1ca7ea6",
    tiktok: "62cd0505d1bd3eccf47ff35e34c439377197764255adf4908a80d7c26176f8e9",
    shorts: "f0649dbc430a2beeda55015d49f7e3ea05c41afbeb2235f54b62d91db1064613",
});
