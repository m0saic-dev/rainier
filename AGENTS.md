# AGENTS.md

Entry point for coding agents working in this repo. Humans want
[`README.md`](README.md).

## What this repo is

**Rainier**: a PUBLIC template repo shared with working artists who test
m0saic. The founder studies a real post (screenshots in `ref/`, git-ignored)
and rebuilds its layout as a template the artist fills with their own clips,
song and lyrics in Mosaic Desktop, which loads this repo from its GitHub URL.

Identity: `@rainier` / "Rainier" in `src/repo.ts`. Unsigned, third-party.

**The privacy rule (hard):** nothing from a real artist ever enters this
repo: no names, handles, lyrics, photos, audio or video, not in a default, a
test, a preview, a comment or a commit message. `ref/` stays ignored. Defaults
are generic placeholders.

**dist/ and template-manifest.json are committed** (Desktop only reads
`dist/`). Rebuild before committing; a stale dist ships stale code.

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

## The loop

```
npm run build        # tsc → copy assets → regenerate template-manifest.json → conventions gate
npm run verify       # build + lint + jest + loader contract + dependency policy
m0saic make @rainier/reels/lyric-triptych/v1 --template-repo . -o triptych.mp4
```

`dist/` and `template-manifest.json` are generated AND committed. Never
hand-edit them; change `src/` and rebuild.

## Adding a template

1. `src/<pack>/<slug>/v1/<slug>.ts` — a plain template object via
   `defineMosaicTemplate`; deterministic, duration from `ctx.target`, every
   optional prop with a default, randomness seeded through a prop.
2. A row in `src/<pack>/registry.ts` (id `@<your-handle>/<pack>/<slug>/v1`,
   title with its `NN · ` ordinal).
3. A unit test beside it asserting something deterministic (geometry, the
   resolved tree, or a validation error).
4. `npm run verify` green; `m0saic doctor .` reports no blocking finding.

A template that has shipped never changes again: a fix is a new `v2` folder
and `deprecated: { replacement }` on the old one.

## Rules that fail silently

- An m0 string you did not validate (`validateM0String` from `@m0saic/dsl`).
- A split count above 12 that is not 5-smooth (`weightedSplit(…, { precision: 120 })`).
- A handle matching `/m0saic/i` — reserved; the guard is exact-match on
  release signatures, so a lookalike name earns a warning, never trust.

## Lessons from the lyric templates (read before touching text)

- **Per-word text needs real metrics.** drawtext draws with a SYSTEM font, not
  the bundled Roboto, so a word placed as its own layer must be measured with
  that font: `font-metrics.ts` (from `tools/bake-font-metrics.mjs`) holds
  Helvetica Neue advances + kerning, verified pixel-exact against drawtext.
- **Baselines: `y = baseline-ascent`.** drawtext's `ascent` is the word's own
  glyph height; a constant `y` puts "on" higher than "the".
- **Placement exprs are inlined verbatim**: no commas or colons in
  `xExpr`/`yExpr` (write clamps with `abs()`); `overlay.alpha`/`enable` are escaped.
- **Draw text over its own colour at zero alpha** (`visual.backgroundColor:
  "<ink>@0"`), never over transparent black: drawtext blends into the RGB below,
  so a fading word passes through dark grey and a blur spreads a dark fringe.
- **Sources cost, layers don't.** A 360-word drawtext source renders a minute
  in ~5 s; every extra text source, and above all a blurred glow twin, costs
  the root composite for the WHOLE song (the engine's window trim applies to
  media sources only). Keep a song's words in as few sources as possible.
