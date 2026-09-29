# Explore

How Rainier's **explore** pack grows: one small experiment per session, built by a coding agent the
founder starts, reviewed by the founder before anything ships. It borrows the one-a-day shape
(scout, plan, build, critique, ship) without the runner: the founder is the scheduler and the gate.

## What the explore pack is

Rainier has two kinds of templates.

- **Production** (`reels`, `business`): part of the artist's general production process (Take Cutter,
  Lyric Stack, Review Card and what follows). Planned in full, approved first, built in phases.
- **Explore** (`explore`, ids `@rainier/explore/<slug>/v1`): experiments the artist may find useful.
  Cheap (a day or less), allowed to be quirky, built on published m0saic features only, with the
  bundled fonts. Each one frames something the artist already has (the cover art, a lyric page, a
  rehearsal clip, a show photo) in a way that would take an evening in a phone editor.

An experiment that the artist keeps using can later be rebuilt as a production template under a new
id; the explore id stays exactly as it shipped.

## Where the work lives

| What | Where |
|---|---|
| The contract for any agent in this repo | [`AGENTS.md`](AGENTS.md) |
| The idea backlog, scored and tiered | `.ai/templates/BACKLOG.md` |
| One plan per template, with its Journal | `.ai/templates/<pack>/<slug>.md` |
| Naming, graduation, the privacy law | `.ai/templates/README.md` |
| The template | `src/explore/<slug>/v1/` |
| The review script (not committed) | `.scratch/claude/explore-<slug>-review.mjs` |

`.ai/` and `.scratch/` are git-ignored: the backlog, the plans and the journals stay on the founder's
machine, so a session runs in the founder's working copy. Only the template itself (and this file)
is public.

## One session

A session is one agent run on one experiment. Nothing survives between sessions except files, so
every phase ends by writing down what it found.

### 0. Orient

Read `AGENTS.md`, this file, `.ai/templates/README.md` and `.ai/templates/BACKLOG.md`. Run
`git status`: note anything uncommitted that is not yours and do not touch it. One session at a time
in a working tree (the build rewrites `dist/` and `template-manifest.json`).

### 1. Pick

Take the highest-ranked backlog row with pack `explore`, tier **Now**, and status `idea` or
`planned`, unless the founder named one in the prompt. Skip a row whose plan says it depends on
something unfinished, and a row whose `src/explore/<slug>/` folder already exists (it is built and
its status is stale: name it at the STOP, do not edit its row). Set the picked row's status to
`building`.

### 2. Scout

- Read the row's plan if one exists. Otherwise read its backlog paragraph.
- Read the nearest neighbours: the templates in `src/`, and the official and community libraries
  linked from `AGENTS.md`. Mirror shapes that exist.
- Open every `@m0saic/*` API the plan names in `node_modules/@m0saic/*/dist/*.d.ts`. Never guess a
  signature. Note anything the plan got wrong.
- Read the `_shared/` helpers the plan uses. `_shared/` is frozen once a shipped template imports it:
  use it, never edit it.

### 3. Plan

Write or refresh `.ai/templates/explore/<slug>.md` in the shape `.ai/templates/README.md` describes:
context, output, a props table with defaults and the roll call, a document sketch, the Make
walkthrough, tests, a review-script outline, risks, and a `## Journal` section. The day is fixed;
the scope is what moves. Cut a style, a mode or a canvas before stretching the session.

### 4. Build

```
npm run new -- explore/<slug> --title "<Title>"     # template + test + registry wiring (+ the pack)
npm run build                                        # freeze check, tsc, assets, manifest, conventions gate
node tools/check-registry.mjs --json                 # the gate's findings, each with its fix; loop on it
npm run fingerprints:update                          # after a layout change: <slug>.layout.m0
npm run build && npm run lint && npm test && npm run check:deps   # the session gate (see Gates)
npm run test:contract                                # expected to fail ONLY on "has no preview asset"
m0saic doctor .
m0saic make @rainier/explore/<slug>/v1 --template-repo . --validate-only
```

- The conventions in `AGENTS.md` apply in full: deterministic, geometry from `ctx.target`, every
  optional prop with a default, validated m0, 5-smooth splits past 12, comma-free xExpr and yExpr,
  `enable` and `window` agreeing, sized nested children, 20 sources or fewer per node,
  `document.backgroundColor` instead of a full-canvas colour rect.
- **The roll call:** every prop that can carry a canvas handle (text, colours, numbers, media, json
  and list leaves, region rects) is bound on the rect that shows it, even when empty, or declared
  with one honest word through `declareBindings` from `src/_shared/bindings.ts`. Never declare a
  prop that is also bound. Every bound prop gets a one-sentence description (`bindingHints`: Make
  shows it under the value; like the roll call, a build error on 0.3.0).
- `tsc --noEmit` is weaker than `npm run build`. The CLI renders `dist/`, so rebuild before you
  render. Exit 0 is not a picture: `m0saic make` exits **3** when it rendered an error mosaic, and
  that is a failure.
- A cheap smoke render is allowed: 3 seconds or less, small size, one frame pulled with ffmpeg, all
  output in the temp folder. Long and full-size renders are the founder's.
- Write `.scratch/claude/explore-<slug>-review.mjs` (the `explore-` prefix keeps it apart from the
  production scripts): Node ESM, fails fast, one echo header per render, props built as JS objects
  and JSON-stringified (never shell-quoted), the founder's media from argv, every output in one
  folder under `os.tmpdir()/<slug>`, ffprobe on every deliverable, the produced files listed, then
  the folder opened. Write it; do not run its renders.

### 5. Critique

Be adversarial: the default verdict is "not ready". Score each line 0, 1 or 2 and write one sentence
of evidence per line.

1. Renders at defaults without an error mosaic (`--validate-only` exits 0).
2. The defaults show the idea to a stranger (the gallery preview is the default render).
3. It frames the artist's own media and words; nothing is generated for them.
4. The Make flow works on the canvas: drop, double-click and drag reach the props the plan says, and
   the roll call is complete and honest.
5. The engine laws hold (the list under Build), and the tests prove the ones that can be proved.
6. Text fits and stays inside the platform safe area at every canvas the plan names.
7. The tests assert what the plan claims, not only that something rendered.
8. It is clearly different from Take Cutter, Lyric Stack and the rest of the repo, and the plan says
   how.
9. The smoke render's cost is noted and nothing about it is surprising.

Fatal, whatever the score: an error mosaic, anything from a real artist, a prop with no default, a
declaration that is stale or dishonest, or a hand edit outside what a session may change. A session
may change exactly these:

- its template folder `src/explore/<slug>/v1/` (including the generated `<slug>.layout.m0`);
- the pack's `src/explore/registry.ts` and `src/explore/index.ts`, as `npm run new` writes them (and,
  for a brand-new pack, the wiring `npm run new` does in `src/repo.ts`, `src/template-registry.ts`
  and `src/index.ts`);
- whatever `npm run build` and `npm run fingerprints:update` generate (`dist/`,
  `template-manifest.json`, the layout fingerprint);
- its plan `.ai/templates/explore/<slug>.md` (the plan and its Journal), and the status cell of its
  row in `.ai/templates/BACKLOG.md`;
- its review script `.scratch/claude/explore-<slug>-review.mjs`.

Any other edit, by hand or by a tool, is fatal.

### 6. STOP

Append the Journal entry (below), set the backlog status to `review`, and end the session by printing
the template id, what the defaults show, every check and its result, the review command, and your
questions. Then stop. The founder runs the review script with their own media and opens the
template in Make (`m0saic open --template @rainier/explore/<slug>/v1`).

### 7. Ship (the founder)

The founder writes the verdict into the Journal: **ship**, **another pass** (with what to change),
or **drop** (with why). On ship, the founder (or an agent the founder asks in a follow-up session)
runs `m0saic license` (the paid tier), `npm run previews`, `npm run build`, then the full
`npm run verify` (the ship gate: its loader contract passes once the preview exists), adds the
template's row to the README table in the artist's words, sets the backlog status to `shipped`,
checks `git status` for anything real, and commits. Agents never commit or push.

## The Journal

Every explore plan ends with `## Journal`. Each session appends one entry; nothing above it is
rewritten.

```
### 2026-09-28 · session 1 · build · <agent CLI> (<model, as the agent declares it>)
- Picked: why this row today.
- Scout: APIs verified; what the plan got wrong.
- Built: files, props, anything cut from the plan and why.
- Checks: session gate <ok|fail>; test:contract <only "no preview asset" | what else>; doctor <findings>; validate-only exit <n>; smoke render <what it showed, time>.
- Critique: <n>/18, weak spots, fatal <none|what>.
- Review: node .scratch/claude/explore-<slug>-review.mjs <args>
- Questions for the founder: ...
- Verdict (founder): SHIP | ANOTHER PASS: ... | DROP: ...
```

## Gates

The session gate (step 4) and the ship gate (step 7) differ by one check. `npm run verify` is
`build && lint && test && test:contract && check:deps`, and `test:contract` fails for any template
with no gallery preview. Previews are minted only at ship, by the founder, on the paid tier, so a
session cannot pass the full `verify`.

- **Session:** `npm run build && npm run lint && npm test && npm run check:deps` is green, and
  `npm run test:contract` reports nothing but `"<id>" has no preview asset` for templates whose
  previews are not minted yet (the session's own, and any earlier one still waiting for the
  founder). Any other contract problem is real.
- **Ship:** after `m0saic license`, `npm run previews` and `npm run build`, the full `npm run verify`
  is green.
- `m0saic doctor .` reports no blocking finding.
- `m0saic make @rainier/explore/<slug>/v1 --template-repo . --validate-only` exits 0 (3 means an
  error mosaic).
- The review script exists and the founder has run it.
- `git status` shows nothing from `ref/` and no real media anywhere.

## Rules

- **Privacy (hard).** This repo is public. Nothing from a real artist enters it: no name, handle,
  lyric, photo, audio, video or screenshot, in code, a default, a test, a preview, a comment, a plan,
  a journal or a commit message. `ref/` is git-ignored reference material: never copy it, describe
  it, quote it or derive text from it. Defaults are generic placeholders ("yourhandle", "Song Title",
  invented lines).
- **Git is read-only for agents.** `status`, `diff`, `log`, `show` only. Never add, commit, stash,
  checkout, restore, reset, branch, tag or push.
- **Manual-first.** A template frames the artist's own work: their clips, photos, pages, songs,
  words and taps. It never writes lyrics, captions, hooks or ideas for them, and never needs an agent
  to be used.
- **One new template folder per session.** Beyond it, change only what step 5 lists (the pack's
  registry and barrel through `npm run new`, the build's generated files, the plan, the backlog
  status cell, the review script). Do not touch other templates, `src/_shared/`, `tools/`,
  `package.json`, `dep-allowlist.json`, `frozen.manifest.json`, `ref/`, or `dist/` by hand.
- **No new dependencies.** Runtime code imports only what `dep-allowlist.json` lists; no `node:fs`,
  no network, no clock, no `Math.random` (seeds are props).
- **A session that ships nothing is fine.** A session that ships something wrong is not. If the
  experiment does not work, say so in the Journal and set the row to `dropped` or leave it at
  `planned` with the reason.

## Freeze

- Until the founder commits it, an experiment is work in progress and a later session may change it.
- Once committed, it has shipped: an artist may have a saved job against it. Never edit its `v1`
  folder again. A fix is a `v2` folder, and the old one is deprecated from the pack barrel
  (`deprecated: { replacement }`). Never delete a shipped template.
- `frozen.manifest.json` is minted by the founder at an m0saic release
  (`node tools/check-freeze.mjs --update --tag <m0saic line>`); agents never run `--update`.

## The session prompt

Paste this into the agent, filling in the first line or leaving it blank:

```
Experiment for this session: <a slug from .ai/templates/BACKLOG.md, or blank for the top unbuilt explore row in tier Now>

You are running one Rainier explore session in this repository (the public @rainier m0saic template
repo). Read, in order: AGENTS.md, EXPLORE.md, .ai/templates/README.md, .ai/templates/BACKLOG.md,
then the plan for the experiment in .ai/templates/explore/.

Run the session exactly as EXPLORE.md describes: orient, pick, scout, plan, build, critique, STOP.
- Build at most one new template, in src/explore/<slug>/v1/, scaffolded with npm run new.
- Verify every @m0saic API in node_modules/@m0saic/*/dist/*.d.ts before you use it.
- Gates: npm run build && npm run lint && npm test && npm run check:deps green; npm run
  test:contract failing only on "has no preview asset" (previews are minted at ship, not by you);
  m0saic doctor . with no blocking finding;
  m0saic make @rainier/explore/<slug>/v1 --template-repo . --validate-only exits 0.
- Smoke renders only if cheap (3 s or less, small, output in the temp folder).
- Write .scratch/claude/explore-<slug>-review.mjs (do not run its renders) and append a Journal
  entry to the plan.
- Outside your template folder, change only what EXPLORE.md step 5 lists.

Hard rules: nothing from a real artist enters the repo, and ref/ is off limits; git is read-only for
you (no add, commit, stash, checkout, restore, reset, branch, tag or push); never edit a shipped
template, src/_shared/, tools/, package.json, frozen.manifest.json or dist/ by hand; no new
dependencies; never generate lyrics, captions, hooks or ideas for the artist.

Finish by printing: the template id, what the defaults show, each check and its result, the review
command, and your questions. Then stop and wait for my verdict.
```
