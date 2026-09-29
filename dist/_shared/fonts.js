"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FONT_FILE_EXTENSIONS = exports.FONT_OPTIONS = exports.DEFAULT_FONT_ID = exports.BUNDLED_FONTS = void 0;
exports.bundledFontPath = bundledFontPath;
exports.resolveFontPath = resolveFontPath;
/**
 * Bundled display fonts, and the resolver that picks the font file a
 * template draws its words with.
 *
 * LICENCES. All eight faces are SIL Open Font License 1.1. Each family's
 * licence ships beside its file as `assets/fonts/OFL-<Family>.txt`, and
 * `tools/copy-assets.mjs` mirrors the folder into `dist/`, so the licence
 * travels with every copy of the font. The OFL allows bundling and
 * redistributing the fonts inside this repo; it forbids selling them on
 * their own. Playfair Display and Righteous carry a Reserved Font Name, so
 * their files ship exactly as their authors released them (never subset,
 * instanced or renamed). Sources, sizes, checksums and character gaps:
 * `assets/fonts/FONTS.md`.
 *
 * WHY STATIC TRUETYPE. Words are drawn as glyph outlines by `textToPath` /
 * `measureText` (`@m0saic/template-utils`, backed by opentype.js 1.3.4).
 * That parser reads TTF, OTF and WOFF 1.0. It cannot read WOFF2 (Brotli)
 * or TTC/OTC collections, and a variable font draws only its default
 * instance (Oswald[wght].ttf would draw Regular, never Bold). So every face
 * here is one static instance with no `fvar` table, and a user's `.woff2`
 * or `.ttc` falls back to a bundled face with a plain-words warning. A
 * variable `.ttf` a user picks still loads; it just draws its default
 * weight (nothing here reads the file to tell).
 *
 * FROZEN ONCE SHIPPED. Saved projects store these ids and renders bake these
 * outlines. Never edit a row, a file, an id or the order. A template that
 * needs a different set copies this module (and the fonts it needs) beside
 * itself, the `_shared` law.
 *
 * Runtime code: no fs. This module only builds paths; the glyph engine reads
 * the file when it draws.
 *
 * Name clash: `@m0saic/template-utils` also exports a no-argument
 * `bundledFontPath()` (its own Roboto). Import this one under an alias if a
 * file needs both.
 */
const node_path_1 = __importDefault(require("node:path"));
function face(id, label, file, family, style, licenseFile) {
    return Object.freeze({ id, label, file, family, style, license: "OFL-1.1", licenseFile });
}
/** The bundled faces, in picker order. Frozen: never edit a row. */
exports.BUNDLED_FONTS = Object.freeze([
    face("anton", "Anton", "Anton-Regular.ttf", "Anton", "Regular", "OFL-Anton.txt"),
    face("bebas-neue", "Bebas Neue", "BebasNeue-Regular.ttf", "Bebas Neue", "Regular", "OFL-BebasNeue.txt"),
    face("archivo-black", "Archivo Black", "ArchivoBlack-Regular.ttf", "Archivo Black", "Regular", "OFL-ArchivoBlack.txt"),
    face("oswald-bold", "Oswald Bold", "Oswald-Bold.ttf", "Oswald", "Bold", "OFL-Oswald.txt"),
    face("righteous", "Righteous", "Righteous-Regular.ttf", "Righteous", "Regular", "OFL-Righteous.txt"),
    face("bangers", "Bangers", "Bangers-Regular.ttf", "Bangers", "Regular", "OFL-Bangers.txt"),
    face("pacifico", "Pacifico", "Pacifico-Regular.ttf", "Pacifico", "Regular", "OFL-Pacifico.txt"),
    face("playfair-black", "Playfair Display Black", "PlayfairDisplay-Black.ttf", "Playfair Display", "Black", "OFL-PlayfairDisplay.txt"),
]);
exports.DEFAULT_FONT_ID = "anton";
/** `control.options` for a `font` prop (a plain array, as the prop type wants). */
exports.FONT_OPTIONS = exports.BUNDLED_FONTS.map((f) => ({ value: f.id, label: f.label }));
/** The formats the glyph engine reads (the resolver's own copy; the export below is for props). */
const READABLE_FONT_EXTENSIONS = ["ttf", "otf", "woff"];
/** `control.extensions` for a `fontFile` prop: the formats the glyph engine reads. */
exports.FONT_FILE_EXTENSIONS = [...READABLE_FONT_EXTENSIONS];
/** Font formats people find online that the glyph engine cannot read. */
const UNREADABLE_FONT_EXTENSIONS = ["woff2", "ttc", "otc", "dfont", "eot"];
const FONTS_DIR = node_path_1.default.join(__dirname, "assets", "fonts");
function defaultFont() {
    return exports.BUNDLED_FONTS.find((f) => f.id === exports.DEFAULT_FONT_ID);
}
/** "Bebas Neue", " bebas_neue " and "bebas-neue" all name one face. */
function fontKey(value) {
    return value.trim().toLowerCase().replace(/[\s_]+/g, "-");
}
function findFont(value) {
    const key = fontKey(value);
    if (key === "")
        return undefined;
    return exports.BUNDLED_FONTS.find((f) => f.id === key || fontKey(f.label) === key);
}
/**
 * Absolute path of a bundled face (inside `src/` under jest, `dist/` when
 * built). An id outside the manifest gets the default face; never throws.
 */
function bundledFontPath(id) {
    var _a;
    const font = (_a = exports.BUNDLED_FONTS.find((f) => f.id === id)) !== null && _a !== void 0 ? _a : defaultFont();
    return node_path_1.default.join(FONTS_DIR, font.file);
}
/** The last path segment, split on both separators (a Windows path read on a Mac too). */
function fileName(p) {
    var _a;
    const parts = p.split(/[\\/]/);
    return (_a = parts[parts.length - 1]) !== null && _a !== void 0 ? _a : p;
}
function extensionOf(name) {
    const dot = name.lastIndexOf(".");
    return dot <= 0 ? "" : name.slice(dot + 1).toLowerCase();
}
/** True when `readError` reports nothing; a throw counts as a failure. */
function opensCleanly(readError, fontPath) {
    try {
        const err = readError(fontPath);
        return err === null || err === undefined;
    }
    catch {
        return false;
    }
}
/**
 * Pick the font file to draw with. Never throws; never reads the disk
 * itself (`opts.readError` may).
 *
 * - `fontFile` ending in .ttf / .otf / .woff: that path, `source: "file"`,
 *   unless `opts.readError` says the engine cannot open it: then the chosen
 *   bundled font plus a warning.
 * - `fontFile` in any other format (.woff2, .ttc, a picture, no extension):
 *   the chosen bundled font plus a warning that says to convert it to TTF.
 * - No `fontFile`: the bundled `font`; an id outside the manifest gets the
 *   default face plus a warning.
 *
 * Only the file NAME appears in a warning, never the folders above it.
 */
function resolveFontPath(choice = {}, opts = {}) {
    const warnings = [];
    const rawFont = typeof choice.font === "string" ? choice.font : "";
    const rawFile = typeof choice.fontFile === "string" ? choice.fontFile.trim() : "";
    if (rawFile !== "") {
        const name = fileName(rawFile);
        const ext = extensionOf(name);
        if (READABLE_FONT_EXTENSIONS.includes(ext)) {
            if (!opts.readError || opensCleanly(opts.readError, rawFile)) {
                return { path: rawFile, source: "file" };
            }
            warnings.push(`The font file "${name}" couldn't be opened (missing, damaged or not really a font).`);
        }
        else {
            warnings.push(UNREADABLE_FONT_EXTENSIONS.includes(ext)
                ? `The font file "${name}" can't be read; convert it to TTF.`
                : `"${name}" can't be read as a font (use a .ttf, .otf or .woff file); convert it to TTF.`);
        }
    }
    let font = findFont(rawFont);
    if (!font) {
        font = defaultFont();
        if (rawFont.trim() !== "") {
            warnings.push(`"${rawFont.trim()}" is not one of the bundled fonts.`);
        }
    }
    const resolved = { path: node_path_1.default.join(FONTS_DIR, font.file), source: "bundled" };
    if (warnings.length > 0) {
        resolved.warning = `${warnings.join(" ")} Using ${font.label} instead.`;
    }
    return resolved;
}
