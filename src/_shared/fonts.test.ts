import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { measureText, textToPath } from "@m0saic/template-utils";

import type { BundledFontId, FontChoice } from "./fonts";
import {
  BUNDLED_FONTS,
  DEFAULT_FONT_ID,
  FONT_FILE_EXTENSIONS,
  FONT_OPTIONS,
  bundledFontPath,
  resolveFontPath,
} from "./fonts";

const FONTS_DIR = path.join(__dirname, "assets", "fonts");
const FONTS_MD = fs.readFileSync(path.join(FONTS_DIR, "FONTS.md"), "utf8");

/** Body rows of the markdown table whose header row starts `| <firstHeader> |`. */
function tableRows(md: string, firstHeader: string): string[][] {
  const lines = md.split("\n");
  const start = lines.findIndex((l) => l.startsWith(`| ${firstHeader} |`));
  if (start < 0) throw new Error(`FONTS.md has no table headed "${firstHeader}"`);
  const rows: string[][] = [];
  for (let i = start + 2; i < lines.length && lines[i].startsWith("|"); i++) {
    rows.push(
      lines[i]
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim()),
    );
  }
  return rows;
}

/** The sfnt table tags, read straight from the table directory. */
function sfntTags(buf: Buffer): string[] {
  const numTables = buf.readUInt16BE(4);
  return Array.from({ length: numTables }, (_, i) => buf.toString("latin1", 12 + i * 16, 16 + i * 16));
}

const PROBE_CANVAS = { width: 2000, height: 400 };
function glyphPath(text: string, fontPath: string): string {
  return textToPath(text, { fontSize: 100, hAlign: "left", vAlign: "top", fontPath }, PROBE_CANVAS);
}

/** Private use area: no face maps it, so it always draws the `.notdef` glyph. */
const NOTDEF_PROBE = String.fromCodePoint(0xe000);
const TYPOGRAPHIC = [0x2019, 0x2018, 0x201c, 0x201d, 0x2026, 0x2014, 0x2013];
const PRINTABLE_ASCII = Array.from({ length: 0x7e - 0x20 + 1 }, (_, i) => 0x20 + i);
const uPlus = (cp: number): string => `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`;

/**
 * Code points the face lacks: `textToPath` draws them exactly as it draws the
 * `.notdef`. When the `.notdef` itself is blank (Pacifico, Righteous) a space
 * draws the same, so whitespace cannot be judged by its outline and is skipped.
 */
function missing(codePoints: readonly number[], fontPath: string): number[] {
  const notdef = glyphPath(NOTDEF_PROBE, fontPath);
  return codePoints.filter((cp) => {
    const ch = String.fromCodePoint(cp);
    if (notdef === "" && ch.trim() === "") return false;
    return glyphPath(ch, fontPath) === notdef;
  });
}

const fontFile = (id: BundledFontId): string => {
  const font = BUNDLED_FONTS.find((f) => f.id === id);
  if (!font) throw new Error(`no font ${id}`);
  return path.join(FONTS_DIR, font.file);
};

describe("BUNDLED_FONTS manifest", () => {
  it("lists the eight faces in picker order, default first", () => {
    expect(BUNDLED_FONTS.map((f) => f.id)).toEqual([
      "anton",
      "bebas-neue",
      "archivo-black",
      "oswald-bold",
      "righteous",
      "bangers",
      "pacifico",
      "playfair-black",
    ]);
    expect(DEFAULT_FONT_ID).toBe("anton");
    expect(BUNDLED_FONTS[0].id).toBe(DEFAULT_FONT_ID);
  });

  it("names files <Family>-<Style>.ttf and licences OFL-<Family>.txt", () => {
    for (const f of BUNDLED_FONTS) {
      const family = f.family.replace(/ /g, "");
      expect(f.file).toBe(`${family}-${f.style}.ttf`);
      expect(f.licenseFile).toBe(`OFL-${family}.txt`);
      expect(f.license).toBe("OFL-1.1");
    }
    expect(new Set(BUNDLED_FONTS.map((f) => f.file)).size).toBe(BUNDLED_FONTS.length);
  });

  it("is frozen, row by row", () => {
    expect(Object.isFrozen(BUNDLED_FONTS)).toBe(true);
    for (const f of BUNDLED_FONTS) expect(Object.isFrozen(f)).toBe(true);
  });

  it("FONT_OPTIONS mirrors the manifest", () => {
    expect(FONT_OPTIONS).toEqual(BUNDLED_FONTS.map((f) => ({ value: f.id, label: f.label })));
  });

  it("the fonts folder holds exactly the manifest's files, their licences and FONTS.md", () => {
    const expected = [...BUNDLED_FONTS.flatMap((f) => [f.file, f.licenseFile]), "FONTS.md"].sort();
    expect(fs.readdirSync(FONTS_DIR).sort()).toEqual(expected);
  });
});

describe.each(BUNDLED_FONTS.map((f) => [f.id, f] as const))("%s", (_id, font) => {
  const file = path.join(FONTS_DIR, font.file);

  it("is a static TrueType file (sfnt signature, no fvar table)", () => {
    const buf = fs.readFileSync(file);
    expect([0x00010000, 0x74727565 /* "true" */, 0x4f54544f /* "OTTO" */]).toContain(buf.readUInt32BE(0));
    const tags = sfntTags(buf);
    expect(tags).toEqual(expect.arrayContaining(["cmap", "head", "hmtx", "name"]));
    expect(tags).not.toContain("fvar");
  });

  it("ships its OFL licence text", () => {
    const text = fs.readFileSync(path.join(FONTS_DIR, font.licenseFile), "utf8");
    expect(text).toContain("SIL OPEN FONT LICENSE Version 1.1");
  });

  it("parses and measures a sample word wider than 0", () => {
    expect(measureText("Song", { fontSize: 64, fontPath: file }).width).toBeGreaterThan(0);
  });

  it("covers printable ASCII", () => {
    expect(missing(PRINTABLE_ASCII, file).map(uPlus)).toEqual([]);
  });

  it("the gap rule is live: it flags a character no face has", () => {
    expect(missing([0x4e00], file)).toEqual([0x4e00]);
  });
});

describe("FONTS.md", () => {
  const faces = tableRows(FONTS_MD, "id");
  const checksums = new Map(tableRows(FONTS_MD, "file").map(([file, sha]) => [file, sha]));

  it("has one row per face, matching the manifest", () => {
    expect(faces.map(([id, label, file, family, style, license]) => ({ id, label, file, family, style, license }))).toEqual(
      BUNDLED_FONTS.map(({ id, label, file, family, style, license }) => ({ id, label, file, family, style, license })),
    );
  });

  it.each(BUNDLED_FONTS.map((f) => [f.id, f.file] as const))("%s: bytes and sha256 match the file", (id, file) => {
    const row = faces.find((r) => r[0] === id);
    const buf = fs.readFileSync(path.join(FONTS_DIR, file));
    expect(Number(row?.[7])).toBe(buf.length);
    expect(checksums.get(file)).toBe(createHash("sha256").update(buf).digest("hex"));
  });

  it.each(BUNDLED_FONTS.map((f) => [f.id] as const))("%s: the typographic gaps are what the Lacks column says", (id) => {
    const row = faces.find((r) => r[0] === id);
    const lacks = row?.[8] ?? "";
    const documented = lacks === "none" ? [] : lacks.split(",").map((s) => s.trim());
    expect(missing(TYPOGRAPHIC, fontFile(id)).map(uPlus)).toEqual(documented);
  });

  it("names the faces whose .notdef is blank (the whitespace exemption above)", () => {
    const blank = BUNDLED_FONTS.filter((f) => glyphPath(NOTDEF_PROBE, fontFile(f.id)) === "").map((f) => f.label);
    expect(blank).toEqual(["Righteous", "Pacifico"]);
    for (const label of blank) expect(FONTS_MD).toContain(label);
  });
});

describe("bundledFontPath", () => {
  it("points into assets/fonts next to the module, at a file that exists", () => {
    for (const f of BUNDLED_FONTS) {
      expect(bundledFontPath(f.id)).toBe(path.join(FONTS_DIR, f.file));
      expect(fs.existsSync(bundledFontPath(f.id))).toBe(true);
    }
  });

  it("an id outside the manifest gets the default face", () => {
    expect(bundledFontPath("nope" as BundledFontId)).toBe(fontFile(DEFAULT_FONT_ID));
  });
});

describe("resolveFontPath", () => {
  const ANTON = fontFile("anton");

  it.each<[string, FontChoice, BundledFontId]>([
    ["nothing chosen", {}, "anton"],
    ["nulls", { font: null, fontFile: null }, "anton"],
    ["empty strings", { font: "", fontFile: "   " }, "anton"],
    ["a bundled id", { font: "bangers" }, "bangers"],
    ["a label", { font: "Bebas Neue" }, "bebas-neue"],
    ["an id with stray case and spaces", { font: "  PACIFICO " }, "pacifico"],
    ["a multi-word label", { font: "playfair display black" }, "playfair-black"],
  ])("%s -> the bundled face, no warning", (_name, choice, id) => {
    expect(resolveFontPath(choice)).toEqual({ path: fontFile(id), source: "bundled" });
  });

  it.each<[string, string]>([
    ["a .ttf", "/fonts/My Font.ttf"],
    ["an upper-case .OTF on a Windows path", "C:\\Fonts\\Brand.OTF"],
    ["a .woff", "/fonts/brand.woff"],
  ])("%s -> the user's file", (_name, file) => {
    expect(resolveFontPath({ fontFile: file, font: "bangers" })).toEqual({ path: file, source: "file" });
  });

  it("a readable file overrides even an unknown font id, without a warning", () => {
    expect(resolveFontPath({ fontFile: " /fonts/brand.ttf ", font: "comic" })).toEqual({
      path: "/fonts/brand.ttf",
      source: "file",
    });
  });

  it.each<[string, string]>([
    ["a .woff2", "/fonts/somewhere/brand.woff2"],
    ["a .ttc collection", "C:\\Fonts\\family.ttc"],
  ])("%s -> the chosen bundled face plus a convert-to-TTF warning naming only the file", (_name, file) => {
    const result = resolveFontPath({ fontFile: file, font: "bangers" });
    const name = file.split(/[\\/]/).pop() as string;
    expect(result.path).toBe(fontFile("bangers"));
    expect(result.source).toBe("bundled");
    expect(result.warning).toBe(`The font file "${name}" can't be read; convert it to TTF. Using Bangers instead.`);
    expect(result.warning).not.toMatch(/somewhere|Fonts\\/);
  });

  it.each<[string, string]>([
    ["a picture", "/pictures/cover.png"],
    ["no extension", "/fonts/fontfile"],
  ])("%s -> the default face plus a warning", (_name, file) => {
    const result = resolveFontPath({ fontFile: file });
    expect(result).toMatchObject({ path: ANTON, source: "bundled" });
    expect(result.warning).toMatch(/can't be read as a font .*convert it to TTF\. Using Anton instead\.$/);
  });

  it("an unknown font id -> the default face plus a warning", () => {
    expect(resolveFontPath({ font: "comic-sans" })).toEqual({
      path: ANTON,
      source: "bundled",
      warning: `"comic-sans" is not one of the bundled fonts. Using Anton instead.`,
    });
  });

  it("an unreadable file AND an unknown id -> both warnings, the default face", () => {
    const result = resolveFontPath({ fontFile: "/fonts/brand.woff2", font: "nope" });
    expect(result.path).toBe(ANTON);
    expect(result.warning).toBe(
      `The font file "brand.woff2" can't be read; convert it to TTF. "nope" is not one of the bundled fonts. Using Anton instead.`,
    );
  });

  it("FONT_FILE_EXTENSIONS is exactly what resolves as a file", () => {
    expect(FONT_FILE_EXTENSIONS).toEqual(["ttf", "otf", "woff"]);
    for (const ext of FONT_FILE_EXTENSIONS) expect(resolveFontPath({ fontFile: `/f/a.${ext}` }).source).toBe("file");
    for (const ext of ["woff2", "ttc", "otc", "dfont", "eot", "png"]) {
      expect(resolveFontPath({ fontFile: `/f/a.${ext}` }).source).toBe("bundled");
    }
  });
});

describe("resolveFontPath with a readError check", () => {
  it("keeps a user file the check opens cleanly (null or undefined)", () => {
    for (const answer of [null, undefined]) {
      const seen: string[] = [];
      const check = (p: string) => {
        seen.push(p);
        return answer;
      };
      expect(resolveFontPath({ fontFile: " /fonts/brand.ttf ", font: "bangers" }, { readError: check })).toEqual({
        path: "/fonts/brand.ttf",
        source: "file",
      });
      expect(seen).toEqual(["/fonts/brand.ttf"]);
    }
  });

  it("falls back to the chosen bundled face, naming only the file, when the check fails or throws", () => {
    const fails = () => 'textToPath: font file not found at "/private/somewhere/brand.ttf"';
    const throws = (): string => {
      throw new Error("boom");
    };
    for (const readError of [fails, throws]) {
      const result = resolveFontPath({ fontFile: "/private/somewhere/brand.ttf", font: "bangers" }, { readError });
      expect(result).toEqual({
        path: fontFile("bangers"),
        source: "bundled",
        warning:
          'The font file "brand.ttf" couldn\'t be opened (missing, damaged or not really a font). Using Bangers instead.',
      });
      expect(result.warning).not.toMatch(/somewhere|textToPath|boom/);
    }
  });

  it("is only asked about a file the extension says is readable", () => {
    const seen: string[] = [];
    const check = (p: string) => {
      seen.push(p);
      return null;
    };
    resolveFontPath({ font: "anton" }, { readError: check });
    resolveFontPath({ fontFile: "/f/brand.woff2" }, { readError: check });
    resolveFontPath({ fontFile: "/f/cover.png" }, { readError: check });
    expect(seen).toEqual([]);
  });
});
