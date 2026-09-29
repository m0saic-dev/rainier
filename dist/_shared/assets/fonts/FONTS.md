# Bundled fonts

Eight display faces for the templates' glyph-outline text (`src/_shared/fonts.ts`).
Every face is licensed under the **SIL Open Font License 1.1**; the licence for
each family sits beside it as `OFL-<Family>.txt` and ships with it into `dist/`.
The OFL lets these fonts be bundled and redistributed with this repo; it does not
allow selling them on their own.

**Frozen once shipped.** Saved projects store these ids and renders bake these
outlines. Never replace, subset or rename a file here. `src/_shared/fonts.test.ts`
checks every row of this page against the files: bytes, SHA-256 and the gaps column.

## Faces

"Lacks" lists which of these characters the face has no glyph for:
U+2019 ’ U+2018 ‘ U+201C “ U+201D ” U+2026 … U+2014 — U+2013 –.
Every face also covers all of printable ASCII (U+0020 to U+007E).

| id | label | file | family | style | license | source | bytes | lacks |
|---|---|---|---|---|---|---|---|---|
| anton | Anton | Anton-Regular.ttf | Anton | Regular | OFL-1.1 | https://raw.githubusercontent.com/google/fonts/23e54b51ddffbc7713c583748e3bd86f62b1fa4a/ofl/anton/Anton-Regular.ttf | 170812 | none |
| bebas-neue | Bebas Neue | BebasNeue-Regular.ttf | Bebas Neue | Regular | OFL-1.1 | https://raw.githubusercontent.com/google/fonts/23e54b51ddffbc7713c583748e3bd86f62b1fa4a/ofl/bebasneue/BebasNeue-Regular.ttf | 61400 | none |
| archivo-black | Archivo Black | ArchivoBlack-Regular.ttf | Archivo Black | Regular | OFL-1.1 | https://raw.githubusercontent.com/google/fonts/23e54b51ddffbc7713c583748e3bd86f62b1fa4a/ofl/archivoblack/ArchivoBlack-Regular.ttf | 90988 | none |
| oswald-bold | Oswald Bold | Oswald-Bold.ttf | Oswald | Bold | OFL-1.1 | https://fonts.gstatic.com/s/oswald/v57/TK3_WkUHHAIjg75cFRf3bXL8LICs1xZogUE.ttf | 86416 | none |
| righteous | Righteous | Righteous-Regular.ttf | Righteous | Regular | OFL-1.1 | https://raw.githubusercontent.com/google/fonts/23e54b51ddffbc7713c583748e3bd86f62b1fa4a/ofl/righteous/Righteous-Regular.ttf | 43104 | none |
| bangers | Bangers | Bangers-Regular.ttf | Bangers | Regular | OFL-1.1 | https://raw.githubusercontent.com/google/fonts/23e54b51ddffbc7713c583748e3bd86f62b1fa4a/ofl/bangers/Bangers-Regular.ttf | 93148 | none |
| pacifico | Pacifico | Pacifico-Regular.ttf | Pacifico | Regular | OFL-1.1 | https://raw.githubusercontent.com/google/fonts/23e54b51ddffbc7713c583748e3bd86f62b1fa4a/ofl/pacifico/Pacifico-Regular.ttf | 329380 | none |
| playfair-black | Playfair Display Black | PlayfairDisplay-Black.ttf | Playfair Display | Black | OFL-1.1 | https://raw.githubusercontent.com/clauseggers/Playfair/6e115d70ee7ff6ed887babf3829ccd1de65fd2bd/fonts/TTF/PlayfairDisplay-Black.ttf | 225100 | none |

Total: 1,100,348 bytes of TTF (about 1.1 MB), plus eight licence files.

## Checksums

| file | sha256 |
|---|---|
| Anton-Regular.ttf | a4ba3a92350ebb031da0cb47630ac49eb265082ca1bc0450442f4a83ab947cab |
| BebasNeue-Regular.ttf | 08e4623805102d819f58601e46e345648846075e363b2ceb23313c2d1c83ec73 |
| ArchivoBlack-Regular.ttf | dd9a89a019b4849f66ab75455fe7bdf931311042cbb0f0f97acc061539703180 |
| Oswald-Bold.ttf | a6ee8b91ec269a6f48631ba4ba1a3ab7e5039e5482dda8dc9672ee4620d7bd68 |
| Righteous-Regular.ttf | 2ffb3fe5c27d7e6571210b800448c4e234e651b46c6b4426c1bb567e5341348a |
| Bangers-Regular.ttf | 4160a7311de9342674cce9160cde9fcbb30f48190397d86ff1b70b455af65824 |
| Pacifico-Regular.ttf | 5b6c0d5334a7bf77dea52b975c5a0c408878c0f7115ed5b6fb151f634b7bf701 |
| PlayfairDisplay-Black.ttf | 03222aaa136ab405491318173ac21caf4c5d1da83e5dc16db25ebcbc1b770168 |

## Why static TrueType

The glyph engine is opentype.js 1.3.4 (inside `@m0saic/text`, reached through
`textToPath` / `measureText` in `@m0saic/template-utils`). It reads TTF, OTF and
WOFF 1.0. It cannot read WOFF2 or TTC/OTC collections, and a variable font draws
only its default instance. Every file here starts with the TrueType signature
`0x00010000` and has no `fvar` table.

## Where each file came from

- **Anton, Bebas Neue, Archivo Black, Righteous, Bangers, Pacifico**: the static
  TTF in `google/fonts`, pinned to commit `23e54b51ddffbc7713c583748e3bd86f62b1fa4a`.
  Each `OFL-<Family>.txt` is that folder's `OFL.txt` at the same commit.
- **Oswald Bold**: `google/fonts` ships Oswald only as a variable font
  (`ofl/oswald/Oswald[wght].ttf`), so this is the static weight-700 instance Google
  Fonts serves to clients that cannot take WOFF2. `curl` with its default user agent
  on `https://fonts.googleapis.com/css2?family=Oswald:wght@700` names the URL in the
  table (Oswald 4.103). Oswald's licence has no Reserved Font Name, so a derived
  static instance may keep the name. `OFL-Oswald.txt` is `ofl/oswald/OFL.txt` at the
  pinned `google/fonts` commit.
- **Playfair Display Black**: `google/fonts` ships Playfair Display only as a
  variable font too, but its licence reserves the name "Playfair Display", and a
  static instance cut from the variable font is a Modified Version that may not
  carry that name. So this is the author's own static release instead: tag `1.202`
  of `clauseggers/Playfair` (commit `6e115d70ee7ff6ed887babf3829ccd1de65fd2bd`),
  `fonts/TTF/PlayfairDisplay-Black.ttf`, unmodified. `OFL-PlayfairDisplay.txt` is
  that tag's `OFL.txt`.
- Licence files were converted from CRLF to LF line endings (the repo stores text as
  LF); their words are unchanged. No font file was modified.

## Notes for the glyph code

- **Pacifico and Righteous have a blank `.notdef`** (no outline) whose advance equals
  the space's. A character either face lacks draws as an invisible space, and a
  "same path as `.notdef`" coverage check sees the space itself as missing. Skip
  whitespace in that check.
- **Bebas Neue and Bangers are capitals only**: their lowercase letters draw as
  capitals, by design.
- Right single quote U+2019 doubles as the apostrophe in typed lyrics ("don’t"), and
  every face has it.
- Playfair Display 1.202 uses 1240 units per em (the others use 1000 or 2048);
  `measureText` scales by units per em, so sizes compare fairly across faces.
