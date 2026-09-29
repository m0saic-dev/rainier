/** The ids a `font` prop stores. */
export type BundledFontId = "anton" | "bebas-neue" | "archivo-black" | "oswald-bold" | "righteous" | "bangers" | "pacifico" | "playfair-black";
export interface BundledFont {
    /** What a `font` prop stores. */
    readonly id: BundledFontId;
    /** What the font picker shows. */
    readonly label: string;
    /** File name inside `assets/fonts/`. */
    readonly file: string;
    /** Family name as the font itself reports it. */
    readonly family: string;
    /** The static instance shipped (a family's other weights are not). */
    readonly style: string;
    /** SPDX licence id. */
    readonly license: "OFL-1.1";
    /** The licence text beside the font, inside `assets/fonts/`. */
    readonly licenseFile: string;
}
/** The bundled faces, in picker order. Frozen: never edit a row. */
export declare const BUNDLED_FONTS: readonly BundledFont[];
export declare const DEFAULT_FONT_ID: BundledFontId;
export interface FontOption {
    value: string;
    label: string;
}
/** `control.options` for a `font` prop (a plain array, as the prop type wants). */
export declare const FONT_OPTIONS: FontOption[];
/** `control.extensions` for a `fontFile` prop: the formats the glyph engine reads. */
export declare const FONT_FILE_EXTENSIONS: string[];
/**
 * Absolute path of a bundled face (inside `src/` under jest, `dist/` when
 * built). An id outside the manifest gets the default face; never throws.
 */
export declare function bundledFontPath(id: BundledFontId): string;
export interface FontChoice {
    /** A bundled font id (the `font` prop). Empty or absent = the default. */
    font?: string | null;
    /** A path to the user's own font file (the `fontFile` prop). Overrides `font`. */
    fontFile?: string | null;
}
export interface ResolvedFontPath {
    /** The file to hand `textToPath` / `measureText` as `fontPath`. */
    path: string;
    /** `"file"` = the user's own font; `"bundled"` = one of `BUNDLED_FONTS`. */
    source: "file" | "bundled";
    /** Plain-words note for the artist when a choice could not be honoured. */
    warning?: string;
}
export interface ResolveFontOptions {
    /**
     * Opens a user font the extension says is readable: `null` (or undefined)
     * when the glyph engine can draw with it, anything else when it cannot.
     * Pass `fontError` from `glyph-text.ts`. Called only for a .ttf / .otf /
     * .woff `fontFile`; a failure (or a throw) falls back to the bundled face
     * with a warning. Absent = trust the extension (this module never reads
     * the disk itself).
     */
    readError?: (fontPath: string) => string | null | undefined;
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
export declare function resolveFontPath(choice?: FontChoice, opts?: ResolveFontOptions): ResolvedFontPath;
