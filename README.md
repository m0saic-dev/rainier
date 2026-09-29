# Rainier

A shared m0saic template repo for artists. Each template is a layout lifted
from a real short-form post and rebuilt so you can fill it with **your own**
clips, song and lyrics.

## Get it in Mosaic Desktop

Templates → **Add source** → paste this repo's GitHub URL → Refresh. New
templates show up when the repo updates.

## Templates

| | Template | What it does |
|---|---|---|
| 01 | Hello World | The front door card. |
| 02 | **Lyric Triptych** | Three stacked clips, your song, and lyrics that land word by word as you sing them. 1080×1920 (the Reels size), as long as your song. *Superseded by 04 Lyric Stack: Desktop lists it under "Show deprecated" with a jump to Lyric Stack, and projects that already use it still open.* |
| 03 | **Take Cutter** | Drop a long rehearsal video, mark the takes you want, and get each take as its own file, named with where it sits in the video (`yourvideo_01m22s-01m37s.mp4`). As filmed, or cut to vertical 1080×1920. *New, in review; ships with m0saic 0.3.0.* |
| 04 | **Lyric Stack** | One to four takes, your song, and your lyrics landing word by word in the font you pick (8 bundled). Time the lyrics once against the whole song, set where each clip starts, drag any word anywhere, export for Reels, TikTok and Shorts. *New, in review; ships with m0saic 0.3.0.* |

**Explore** (experiments you may find useful; each one is small and a little quirky):

| | Template | What it does |
|---|---|---|
| 05 | **Cover Shards** | Your cover art builds itself from its own tiles, each landing on a beat you tap, then your release line rises in underneath. About 6 s, 9:16. *In review.* |
| 06 | **Margins** | A photo of your handwritten lyric page, marked line by line as you sing: a highlighter stroke, underline or hand-drawn box on each line. The words stay yours; the template writes none. *In review.* |

How the explore pack grows, one experiment per session: [`EXPLORE.md`](EXPLORE.md).
The idea backlog and the per-template plans live in `.ai/templates/`, which is
kept on the founder's machine and never published.

For the business side (a post log and review dashboard for Excel, Numbers or
Google Sheets), see [`kits/`](kits/README.md).

### Lyric Triptych: the workflow

*Lyric Triptych is superseded by Lyric Stack (04). These steps stay for
projects that already use it.*

1. **Song**: pick the track (an audio file, or a video whose sound you want).
2. **Top / Middle / Bottom clip**: drag a video or photo from Finder straight
   onto a row in the preview (or click the row / use the field). If the takes
   started recording at different moments, use *trim start* to line them up
   with the song. Use *framing* to choose which part of a tall clip stays in view.
3. **Lyrics**: paste them one **page** per line. A page is the words that
   share the screen before it clears.
4. Open the timing studio on Lyrics:
   - **tap pass**: play the song and press Space as each page starts;
   - **word pass**: hold Space for each word as you sing it.

   You don't have to time everything. Untimed pages spread over the song and
   untimed words cascade in, and every tap replaces a guess.
5. A page written in `[brackets]` (e.g. `[break]`) is a pause: the screen clears.
6. **Show Instagram UI (guide)** lays the Reels screen (status bar, buttons,
   caption, the strips a tall phone crops) over the video so you can see what
   they will cover. It is drawn *into* the render, so **turn it off before you
   export**.

7. **Word layout → custom** (optional): every word becomes its own box in the
   preview. Scrub to a page, then drag a word to move it or pull its corner to
   resize it (a bigger box makes a bigger word). Your boxes are saved in
   *Word positions*; clear that field to put every word back. Set text size
   and alignment **first**, because moved words stay where you put them. If you
   add or remove words later, the saved positions are ignored and every word
   returns to the template layout.

Style knobs: lyrics row, alignment (justified by default), word entrance
(rise / fade / instant), text size and colour, glow amount and colour (black
turns the glow into a soft shadow for bright footage), and the border between
the rows.

Words are set in Helvetica Neue, the font every Mac ships. On a computer
without it the words still show, but the spacing drifts. Glow roughly
doubles render time; set Glow to 0 for quick drafts.

## Licence

The code, templates and docs are MIT ([`LICENSE`](LICENSE)). The eight bundled
fonts are **not** MIT: the `.ttf` files in `src/_shared/assets/fonts/` (and
their copies in `dist/_shared/assets/fonts/`) are under the
[SIL Open Font License 1.1](https://openfontlicense.org). Each family's licence
sits beside it as `OFL-<Family>.txt`, and
[`FONTS.md`](src/_shared/assets/fonts/FONTS.md) lists every face, its source and
its checksum. The fonts may be bundled and redistributed with this repo, but
never sold on their own, and a modified copy may not use a Reserved Font Name
("Playfair Display", "Righteous"). A font you pick in Desktop (Lyric Stack's
*Font file*) stays on your machine and never becomes part of this repo.

## Rules for this repo

- **It is public.** No real artist's name, handle, lyrics, photos or media go in
  a template, a default, a preview or a commit. The artist brings their own in
  Desktop. Reference screenshots live in `ref/`, which is git-ignored. Keep it that way.
- `dist/` and `template-manifest.json` **are committed**: Desktop loads the repo
  straight from GitHub and only reads `dist/`. Run `npm run build` before every commit.
- A template that has shipped stays as it is. A change is a `v2` folder.

## Develop

```
npm install
npm run verify     # build + lint + jest + loader contract + dependency policy
m0saic make @rainier/reels/lyric-triptych/v1 --template-repo . -o triptych.mp4
m0saic doctor .
```

- `npm run new -- <pack>/<slug> --title "…"` scaffolds a template that passes every gate.
- `npm run previews` mints the gallery previews (then `npm run build`).
- `node tools/bake-platform-ui.mjs [reels|tiktok|shorts|all]` redraws the platform guide PNGs in
  `src/_shared/assets/` (Lyric Stack's design-only guides).
- `tools/bake-reels-ui.mjs` and `tools/bake-font-metrics.mjs` wrote the Lyric Triptych's guide and
  its Helvetica Neue metrics. That template is frozen (`frozen.manifest.json`, checked by
  `npm run check:freeze` and at the start of every build), so leave both be.

Agents: read [`AGENTS.md`](AGENTS.md) first.
