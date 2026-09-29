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
import path from "node:path";

/** The ids a `font` prop stores. */
export type BundledFontId =
  | "anton"
  | "bebas-neue"
  | "archivo-black"
  | "oswald-bold"
  | "righteous"
  | "bangers"
  | "pacifico"
  | "playfair-black";

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

function face(
  id: BundledFontId,
  label: string,
  file: string,
  family: string,
  style: string,
  licenseFile: string,
): BundledFont {
  return Object.freeze({ id, label, file, family, style, license: "OFL-1.1", licenseFile });
}

/** The bundled faces, in picker order. Frozen: never edit a row. */
export const BUNDLED_FONTS: readonly BundledFont[] = Object.freeze([
  face("anton", "Anton", "Anton-Regular.ttf", "Anton", "Regular", "OFL-Anton.txt"),
  face("bebas-neue", "Bebas Neue", "BebasNeue-Regular.ttf", "Bebas Neue", "Regular", "OFL-BebasNeue.txt"),
  face("archivo-black", "Archivo Black", "ArchivoBlack-Regular.ttf", "Archivo Black", "Regular", "OFL-ArchivoBlack.txt"),
  face("oswald-bold", "Oswald Bold", "Oswald-Bold.ttf", "Oswald", "Bold", "OFL-Oswald.txt"),
  face("righteous", "Righteous", "Righteous-Regular.ttf", "Righteous", "Regular", "OFL-Righteous.txt"),
  face("bangers", "Bangers", "Bangers-Regular.ttf", "Bangers", "Regular", "OFL-Bangers.txt"),
  face("pacifico", "Pacifico", "Pacifico-Regular.ttf", "Pacifico", "Regular", "OFL-Pacifico.txt"),
  face(
    "playfair-black",
    "Playfair Display Black",
    "PlayfairDisplay-Black.ttf",
    "Playfair Display",
    "Black",
    "OFL-PlayfairDisplay.txt",
  ),
]);

export const DEFAULT_FONT_ID: BundledFontId = "anton";

export interface FontOption {
  value: string;
  label: string;
}

/** `control.options` for a `font` prop (a plain array, as the prop type wants). */
export const FONT_OPTIONS: FontOption[] = BUNDLED_FONTS.map((f) => ({ value: f.id, label: f.label }));

/** The formats the glyph engine reads (the resolver's own copy; the export below is for props). */
const READABLE_FONT_EXTENSIONS: readonly string[] = ["ttf", "otf", "woff"];

/** `control.extensions` for a `fontFile` prop: the formats the glyph engine reads. */
export const FONT_FILE_EXTENSIONS: string[] = [...READABLE_FONT_EXTENSIONS];

/** Font formats people find online that the glyph engine cannot read. */
const UNREADABLE_FONT_EXTENSIONS: readonly string[] = ["woff2", "ttc", "otc", "dfont", "eot"];

const FONTS_DIR = path.join(__dirname, "assets", "fonts");

function defaultFont(): BundledFont {
  return BUNDLED_FONTS.find((f) => f.id === DEFAULT_FONT_ID) as BundledFont;
}

/** "Bebas Neue", " bebas_neue " and "bebas-neue" all name one face. */
function fontKey(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_]+/g, "-");
}

function findFont(value: string): BundledFont | undefined {
  const key = fontKey(value);
  if (key === "") return undefined;
  return BUNDLED_FONTS.find((f) => f.id === key || fontKey(f.label) === key);
}

/**
 * Absolute path of a bundled face (inside `src/` under jest, `dist/` when
 * built). An id outside the manifest gets the default face; never throws.
 */
export function bundledFontPath(id: BundledFontId): string {
  const font = BUNDLED_FONTS.find((f) => f.id === id) ?? defaultFont();
  return path.join(FONTS_DIR, font.file);
}

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

/** The last path segment, split on both separators (a Windows path read on a Mac too). */
function fileName(p: string): string {
  const parts = p.split(/[\\/]/);
  return parts[parts.length - 1] ?? p;
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot + 1).toLowerCase();
}

/** True when `readError` reports nothing; a throw counts as a failure. */
function opensCleanly(readError: (fontPath: string) => string | null | undefined, fontPath: string): boolean {
  try {
    const err = readError(fontPath);
    return err === null || err === undefined;
  } catch {
    return false;
  }
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
export function resolveFontPath(choice: FontChoice = {}, opts: ResolveFontOptions = {}): ResolvedFontPath {
  const warnings: string[] = [];
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
    } else {
      warnings.push(
        UNREADABLE_FONT_EXTENSIONS.includes(ext)
          ? `The font file "${name}" can't be read; convert it to TTF.`
          : `"${name}" can't be read as a font (use a .ttf, .otf or .woff file); convert it to TTF.`,
      );
    }
  }

  let font = findFont(rawFont);
  if (!font) {
    font = defaultFont();
    if (rawFont.trim() !== "") {
      warnings.push(`"${rawFont.trim()}" is not one of the bundled fonts.`);
    }
  }

  const resolved: ResolvedFontPath = { path: path.join(FONTS_DIR, font.file), source: "bundled" };
  if (warnings.length > 0) {
    resolved.warning = `${warnings.join(" ")} Using ${font.label} instead.`;
  }
  return resolved;
}
