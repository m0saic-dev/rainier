# AGENTS.md

Entry point for coding agents working in this repo. Humans want
[`README.md`](README.md).

## What this repo is

**Rainier**: a PUBLIC template repo shared with working artists who test
m0saic. The founder studies a real post (screenshots in `ref/`, git-ignored)
and rebuilds its layout as a template the artist fills with their own clips,
song and lyrics in Mosaic Desktop, which loads this repo from its GitHub URL.

Identity: `@rainier` / "Rainier" in `src/repo.ts`. Unsigned, third-party.
Home: `github.com/m0saic-dev/rainier`.

**The privacy rule (hard):** nothing from a real artist ever enters this
repo: no names, handles, lyrics, photos, audio or video, not in a default, a
test, a preview, a comment or a commit message. `ref/` stays ignored. Defaults
are generic placeholders ("yourhandle", "Song Title", lyric lines you invent).

**dist/ and template-manifest.json are committed** (Desktop only reads
`dist/`). Rebuild before committing; a stale dist ships stale code.

## Two kinds of template

| | Production | Explore |
|---|---|---|
| Packs | `reels` (and `business` when Review Card lands) | `explore`, always the LAST chapter |
| What | The artist's weekly process: Take Cutter, Lyric Stack, Review Card... | Experiments the artist may find useful; quirky is fine |
| How | Planned in `.ai/plans/`, approved, built in phases with founder STOPs | One per session, the loop in [`EXPLORE.md`](EXPLORE.md) |
| Substrate | Ships on m0saic 0.3.0 | Published 0.2.0 features, bundled fonts only |

`.ai/` (plans, the idea backlog `.ai/templates/BACKLOG.md`, per-template plans
and journals) and `.scratch/` (review scripts) are git-ignored: they live in
the founder's working copy only.

## Before you write a template: the knowledge base and the examples

The reasoning behind every rule here lives in **`@m0saic/knowledge`** — the
m0 handbook, the engine mental models, the template-authoring contract, as
plain Markdown. After `npm install` it is at
`node_modules/@m0saic/knowledge/README.md` (start there, then
`docs/m0saic-thesis.md`, then the router in `docs/README.md`); on GitHub at
[m0saic-packages/packages/knowledge](https://github.com/m0saic-project/m0saic-packages/tree/main/packages/knowledge).

Then read code. Three public repos cover most of the product surface:

- [m0saic-template-repo-starter](https://github.com/m0saic-project/m0saic-template-repo-starter)
  — ~80 one-concept lessons, the curriculum; this repo is its compact twin.
- [m0saic-community-templates](https://github.com/m0saic-project/m0saic-community-templates)
  — the public library, one folder per publisher, signed releases.
- [m0saic-packages/packages/templates](https://github.com/m0saic-project/m0saic-packages/tree/main/packages/templates)
  — the official library that ships in the product; the house standard.

Verify every `@m0saic/*` API in `node_modules/@m0saic/*/dist/*.d.ts` before
you use it. Never guess a signature.

## The loop

```
npm run build        # freeze check → tsc → copy assets → template-manifest.json → conventions gate
npm run verify       # build + lint + jest (+ freeze tool tests) + loader contract + dependency policy
m0saic doctor .
m0saic make @rainier/reels/lyric-stack/v1 --template-repo . --validate-only
m0saic make @rainier/reels/lyric-stack/v1 --template-repo . -w 540 -h 960 --durationMs 3000 -o /tmp/ls.mp4
```

`dist/` and `template-manifest.json` are generated AND committed. Never
hand-edit them; change `src/` and rebuild. One agent at a time runs the build:
it rewrites `dist/` and the manifest.

`m0saic doctor .` exits 1 on this repo, on the 0.2.x CLI and on the current
0.3.0 build alike: it audits every template against the newest conventions and
reads only the manifest's top-level `release`, so the frozen triptych's 0.3.0
lag counts as an error (it prints "ALL from conventions added after this repo
shipped at 0.2.0. Not a defect"). The repo's own gate, `tools/check-registry.mjs`,
passes `shippedAt` per shipped template and is the authority. The doctor fix is
upstream (m0saic 0.3.0 plan, Workstream R, items R7 and R11). Anything else the
doctor reports is real.

## Adding a template

1. `npm run new -- <pack>/<slug> --title "…"` scaffolds a template, its test and
   the registry wiring. Or write `src/<pack>/<slug>/v1/<slug>.ts` by hand: a
   plain template object via `defineMosaicTemplate`, deterministic, duration
   from `ctx.target`, every optional prop with a default, randomness seeded
   through a prop.
2. A row in `src/<pack>/registry.ts` (id `@rainier/<pack>/<slug>/v1`) and the
   array entry plus `export *` in `src/<pack>/index.ts`. A new pack also goes
   in `TEMPLATE_PACKS` (`src/repo.ts`), `CHAPTERS` (`src/template-registry.ts`)
   and `src/index.ts`, before `explore`.
3. **Ordinals.** The registry title AND the template's `label` start with
   `NN · `, NN being the template's position in the whole repo in chapter
   order. The manifest generator asserts both, with no gaps. A production
   template added later renumbers every explore card after it (their rows and
   labels): batch that into a release, before anything renumbered is frozen.
4. **Unique export names.** Every pack barrel is `export *` over its template
   modules, so two modules exporting the same name is a tsc error. Prefix a
   template's constants (`LYRIC_STACK_MAX_PAGES`, `TAKE_CUTTER_MAX_TAKES`).
5. A unit test beside it asserting something deterministic (geometry, the
   resolved tree, bindings, or a validation error).
6. `npm run build`; for a new template `npm run fingerprints:update` writes
   `<slug>.layout.m0` (commit it). `npm run verify` green, then `m0saic doctor .`.
   `npm run previews` mints the gallery preview (the paid tier; `m0saic license`
   first), then `npm run build` again.

## The 0.3.0 conventions (the pack ships on m0saic 0.3.0)

Three conventions become build-time errors on 0.3.0 (`TEMPLATE_CONVENTION_SINCE`
= "0.3.0", level `throw`, in `@m0saic/template-utils` `templateConventions.ts`).
New templates meet all three now; the two shipped templates lag and are exempt
(see the freeze rule).

- **The roll call (`bindingsDeclared`).** Every prop that CAN carry a canvas
  handle (free-text and colour strings, numbers including sliders, media, list
  elements, json / list / array leaves, regions rects) is either BOUND on the
  rect that shows it (`bindProp` / `bindProps` / `bindPropPath` /
  `bindPropRect`; bind even when the value is empty, so an empty slot is still
  a drop target) or DECLARED with one honest word:
  `...declareBindings({ song: "audio", songStartSec: "timing" })` from
  `src/_shared/bindings.ts`, spread into the `defineMosaicTemplate` input
  (0.2.0 types have no `bindings` field; the helper carries it). Booleans,
  closed sets (oneOf / options / pickers) and groups never count. A stale
  declaration (unknown prop, or one that is actually bound) is itself a
  violation.
- **`bindingHints`.** Every BOUND prop says in plain words what changing it
  does, because Make shows that line under the value when the artist
  double-clicks the rect (and on the tile card and the handle's tooltip): it is
  the only help they see without opening the settings. Give the prop a
  `description` (one honest sentence, never the value itself); it covers every
  rect the prop is bound to. 0.3.0 adds a per-binding `hint`
  (`bindProp(src, key, i, { hint })` / `withBindingHint`), but the 0.2.0
  helpers installed here have no such option, so use the description. A
  companion leaf (filled only by a media drop) needs none; a declared
  (unbound) prop is not checked.
- **`canvasFill`.** Fill the canvas with `document.backgroundColor`, never a
  full-frame colour rect. A colour prop that IS the background needs no binding
  and no declaration.
- Preview the 0.3.0 audit before the lockstep publishes:
  `node .scratch/claude/audit-030-preview.mjs` runs the monorepo's built
  `auditRenderedTemplate` over `dist/` (shipped ids with `shippedAt`). New
  templates must show zero `bindingsDeclared` / `bindingHints` / `canvasFill`
  errors; the script exits 1 on any of them.

## The freeze rule

- `frozen.manifest.json` pins every file of a SHIPPED template by SHA-256.
  `npm run build` runs `node tools/check-freeze.mjs` first and fails on any
  change to a hashed file, comments included. Tests (`*.test.ts`) are never
  hashed.
- `release` is the **m0saic line** the files shipped at (`"0.2.0"`), compared as
  semver by the conventions audit. Never a date: a date-shaped tag compares as
  2026.0.0 and would silently hide every lag. The gate asserts the shape.
- Mint only at a release, by the founder, from a committed HEAD:
  `node tools/check-freeze.mjs --update --tag <m0saic line>`. Minting is
  additive; it hashes HEAD bytes, never the working tree.
- A shipped template never changes. A fix is a new `vN+1` folder, and the old
  version is deprecated FROM THE PACK BARREL, so the frozen file stays
  byte-identical: `src/reels/index.ts` puts
  `{ ...LyricTriptychV1, deprecated: { reason, replacement: LyricStackV1.id, since } }`
  in `reelsTemplates` (what hosts read) and leaves the `export *` of the frozen
  module alone. Desktop then lists the triptych under "Show deprecated" with a
  jump to Lyric Stack; lookups by id and existing projects keep working. The
  manifest carries no `deprecated` field (0.2.0 manifest entries have none), so
  the browse surface does not change.
- **Never write into a frozen template's `assets/`.** `tools/bake-reels-ui.mjs`
  writes the triptych's guide PNG: do not run it. New guides come from
  `tools/bake-platform-ui.mjs` into `src/_shared/assets/`.
- Shipped at 0.2.0: `basics/hello-world/v1`, `reels/lyric-triptych/v1`.

## The `_shared` law

`src/_shared/` holds what several templates use: `bindings`, `platforms`
(per-platform rows and stage geometry), `platform-emit` (the export fan-out,
audio policy, duration advisory, guide PNGs and their tiles),
`platform-guide-regions` (GENERATED by `tools/bake-platform-ui.mjs` with the
PNGs: the region boxes and PNG hashes), `stage-layout` (takes lattice,
lyric box), `fonts` (8 bundled OFL faces plus a user font file), `glyph-text`
(words as glyph outlines), `song-window` (the lyric bank window).

- **Frozen once a shipped template imports it.** A change after that is a copy
  beside the template version that needs it, never an edit. Before the first
  ship, changes are additive only (a new export or an optional parameter).
- Runtime `src/` imports only `@m0saic/types`, `@m0saic/template-utils`,
  `@m0saic/dsl-stdlib`, `@m0saic/platform`, `@m0saic/dsl` and `node:path`
  (`dep-allowlist.json`, `npm run check:deps`). No `node:fs` in runtime code;
  glyph helpers (`textToPath`, `measureText`) come through
  `@m0saic/template-utils`.

## Design-mode gate

Make renders the editable preview with `ctx.mode === "design"`; exports use
`"render"`. Guides (platform chrome PNGs, safe-area bands), advisories (the
platform's length limit, "Word positions ignored") and onboarding notes are
emitted ONLY in design mode. They never bake into an export (the triptych's
guide had to be switched off by hand; Lyric Stack's cannot leak). Design and
render must otherwise be the same document, so a drag in Make means the same
thing in the file.

**Nothing full-frame takes the pointer, in design above all.** In Make every
tile is a click target the size of its rect, and a later tile wins the
pointer: a full-canvas guide image, a full-canvas text tile (a zero-alpha
background changes nothing) or a full-canvas clear PNG shadows every word
under it, so nothing can be hovered or dragged. A `type: "mosaic"` REF is a
target too (its wrap is slot-sized; a click says "Set by the template"), so a
full-canvas child shadows every take for as long as it is on stage, and a
later sibling container covers an earlier one's words. m0 rects are cheap:
give each piece of chrome its own rect, and size each container to what it
holds. The platform guide is one tile per region of its PNG (`guideTiles` in
`platform-emit.ts`, 9:16 canvases only; the regions generated into
`platform-guide-regions.ts` by `tools/bake-platform-ui.mjs`, which also
refuses to bake a drawing that leaves its regions); an advisory is a strip
with its own rect, wrapped to fit and moved off the words. Lyric Stack paints
all of it UNDER the lyrics, so a word dragged onto the caption stays
grabbable. The "design-document audit" in Lyric Stack's `lyric-stack.test.ts`
is the gate: it models Make's pointer (tree order, windows, inset margins) and
requires every word to answer its own hover, every take to stay reachable, no
leaf but a bound take over 25 % of the canvas and no container over a third.
The one full-canvas tile left is an audio-only song, which Make gives no
pointer.

## Audio policy (`src/_shared/platform-emit.ts` `audioPolicy`)

| Export | Container / video | Audio |
|---|---|---|
| default, one platform | mp4, h264 | AAC 320k, 48 kHz stereo |
| `masterAudio`, one platform | mov, ProRes 422 (`prores_ks`, `yuv422p10le`) | PCM 24-bit (`pcm_s24le`), 48 kHz stereo |
| `exportAll` (emit `multi`, one file per platform) | mp4, h264 | AAC 320k: each step is its own deliverable with its own `doc.audio`; `masterAudio` is ignored |

- MP4 + PCM is never emitted.
- The engine's hard-coded AAC 192k applies to the `emit:"single"` stitch passes
  and to a **nested child document's internal carrier**. Keep the song on the
  ROOT document as an audio-only leaf, never inside a child.
- A song leaf is never bound: a full-canvas audio rect would swallow every drop
  on the takes below it. Declare it (`song: "audio"`).

## Rules that fail silently

- An m0 string you did not validate (`validateM0String` from `@m0saic/dsl`).
- A split count above 12 that is not 5-smooth (`weightedSplit(…, { precision: 120 })`).
- Placement `xExpr` / `yExpr` with a comma or a colon (they are inlined verbatim;
  write clamps with `abs()`). `overlay.alpha` / `enable` are escaped.
- `overlay.enable` and `overlay.window` that disagree.
- A nested child document without `size`.
- A colour's own alpha under an inline mask: the mask replaces the alpha plane,
  so `#FFD83D@0.4` renders opaque. Put opacity on `overlay.alpha`.
- `overlay.blendMode: "multiply"` over a masked or partial tile: the engine
  premultiplies the layer onto an opaque parent-sized plane, so the whole frame
  outside the tile goes black. Plain alpha (or `screen` for light-on-dark).
- A handle matching `/m0saic/i` — reserved; the guard is exact-match on
  release signatures, so a lookalike name earns a warning, never trust.

## Lessons from Lyric Stack (the glyph route)

- **Words are glyph outlines, not drawtext.** The text source has no font-file
  field and drawtext draws with a SYSTEM font; the engine's svg text route
  merges layers and loses per-word timing. So `glyph-text.ts` turns each word
  into a path with `textToPath(text, { fontPath })` and the template emits a
  colour tile with an inline mask of that path. The Make preview draws the
  same silhouettes, and the glyphs travel inside the document: design equals
  render, and any font file works.
- **The `textToPath` baseline.** With `vAlign: "top"` the first baseline sits at
  `padding.y + ascent` (ascent = `ascender * px / unitsPerEm`). The engine
  draws a mask with `viewBox="0 0 w h"` and `preserveAspectRatio="none"`, so a
  path must be in its own rect's px space. Ink leaves the advance box (Bangers
  and Pacifico swashes, accents above the ascent): grow each word's rect to its
  ink extent or the mask clips it.
- **Blur runs before the mask** on a tile, so a blurred word tile stays crisp.
  The glow is a SECOND child (the same page in the glow colour, unbound) whose
  `type:"mosaic"` reference carries `effects.blur` and `visual.opacity`.
- **At most 20 tiles per node** (19 words + the alpha tile; a sheet holds 20
  refs). Every timed tile is one overlay op on its node's chain, and past ~25
  the engine drops inline masks silently. Pages are children; more than 17
  root refs group into sheets of at most 10 pages. A page of more than 19
  words is a CHAIN: each chunk child holds the alpha tile, a full-canvas ref to
  the next chunk, then its own 18 words, so an earlier chunk's words are always
  above the later chunk's container (as siblings sharing a window, the later
  container took the pointer over the earlier words). The budget is checked on
  the RENDER document (the only one the engine draws); design groups pages the
  same way and adds only static chrome, under the lyrics. The
  `costBudget: overlayDepth 30` warning on Lyric Stack measures the FLATTENED
  document (children inlined into the root); per node the root is 10 deep and
  each page 2. It is not a real overflow.
- **Children hug their words.** A page child is the size of its BOX: the
  union of its word rects, grown by the rise and the alpha tile's room (the
  glow child also by 4 sigmas of its blur), snapped OUT to the lyric nest's
  lattice (`latticeUnit`, 10 x 8 px on 1080 x 1920, even) and grown to a
  5-smooth size (`snapBox`). So the ref's m0 cell IS the box: no recovery
  inset (Make adds an inset UNFLOORED, which would put every word half a pixel
  off in the drag seed), the child draws 1:1, overlays land on even pixels
  (yuv420), and every split inside the child is 5-smooth. The lyric refs get
  their own `placeInsetPieces` call (the chrome's thin lines would clamp a
  shared lattice finer and push the boxes off it), chained over the chrome
  with `stackOverlays`. A sheet is the union of its pages' boxes, and
  everything inside it is full-canvas relative to it. Word rects and the
  `wordBoxes` regions stay ROOT pixels everywhere; only `pageDoc` subtracts
  the box origin. Children live in the `children` map of the node that
  references them (0.2.0 `resolvePropBindings` looks only in the local map), so
  a rect binding resolves three levels down (sheet, page, chunk). What is left:
  between the words of a page on stage, its container (template-set) still
  takes the pointer over the take under it; the rest of the take answers as
  usual (the audit measures it).
- **The child-alpha tile (probed 2026-09-27).** Under an opaque (mp4) root, a
  page child whose tiles overlap (word mode, a drag onto another word, tight
  lines) takes the engine's single-flat path, where only IMAGE media earns an
  alpha carrier; without one the child comes back through h264 and paints the
  whole frame in its background colour (a solid box over the takes). A
  transparent `backgroundColor` does NOT do it: `#FFFFFF@0` over overlapping
  words is the same white box (the engine picks the carrier from the media and
  honours the background's alpha only afterwards; a nested child's
  intermediate does not count either). The image need not cover the frame,
  only be there: the clear PNG as a 16 px tile in a corner of the child that no
  word touches (`alphaTileRect`, bottom-left first, which the box keeps free)
  renders pixel-identical to a full-canvas one, glow twins included. Keep `size` on the child (with an
  image tile and no size the engine lays it out at the PNG's size and the
  render fails) and its ink colour as `backgroundColor` (forced to `@0` under
  the alpha carrier, so anti-aliased edges keep the ink's RGB). A SHEET needs
  no image: its refs all fill its frame, a clean band, which always gets the
  alpha carrier. It still needs an `assets` object (an empty one):
  the engine rejects a document without it.
- **The lyric bank.** The artist times lyrics ONCE against the whole song in
  the Cue Timing Studio, keeps that Lyrics value per song, and pastes it into
  every clip. Each clip sets `songStartSec`; `song-window.ts` shifts the cues,
  drops pages outside the clip and clamps straddlers. Word positions are per
  clip: `wordBoxes` slots 0..n-1 cover the words the current clip draws, not the
  whole bank, because Make seeds a rect list densely from element 0 (upstream
  R9). A drag in a mid-song clip therefore sticks (`lyric-stack.test.ts`); the
  drag itself still needs the founder's check in Desktop.

## Lessons from the Lyric Triptych (frozen; drawtext)

- **Per-word text needs real metrics.** drawtext draws with a SYSTEM font, not
  the bundled Roboto, so a word placed as its own layer must be measured with
  that font: `font-metrics.ts` (from `tools/bake-font-metrics.mjs`) holds
  Helvetica Neue advances + kerning, verified pixel-exact against drawtext.
- **Baselines: `y = baseline − inkTop(word)`, a plain number.** drawtext
  places a string by its tallest glyph (a constant `y` puts "on" higher than
  "the"). `baseline-ascent` renders right but Make's live preview cannot
  evaluate `ascent`, so it misplaces every word; `font-metrics.ts` carries each
  glyph's ink top, and the numeric y is pixel-identical at 62–160 px.
- **Editing handles vs render cost.** Make's editable preview renders the
  template with `ctx.mode === "design"`; real renders use `"render"`. Custom
  word layout emits one bound cell per word ONLY in design (so each word can
  be dragged: `bindPropRect(src, "wordBoxes", i)` on a regions list), and
  renders the same final positions through the drawtext path. One cell per
  word in the real render measured ~5x slower (150 image inputs → the engine
  split the composite into 3 passes + a stitch).
- **Draw text over its own colour at zero alpha** (`visual.backgroundColor:
  "<ink>@0"`), never over transparent black: drawtext blends into the RGB below,
  so a fading word passes through dark grey and a blur spreads a dark fringe.
- **Sources cost, layers don't.** A 360-word drawtext source renders a minute
  in ~5 s; every extra text source, and above all a blurred glow twin, costs
  the root composite for the WHOLE song (the engine's window trim applies to
  media sources only). Keep a song's words in as few sources as possible.
