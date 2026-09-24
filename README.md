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
| 02 | **Lyric Triptych** | Three stacked clips, your song, and lyrics that land word by word as you sing them. 1080×1920 (the Reels size), as long as your song. |

### Lyric Triptych: the workflow

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

Style knobs: lyrics row, alignment (justified by default), word entrance
(rise / fade / instant), text size and colour, glow amount and colour (black
turns the glow into a soft shadow for bright footage), and the border between
the rows.

Words are set in Helvetica Neue, the font every Mac ships. On a computer
without it the words still show, but the spacing drifts. Glow roughly
doubles render time; set Glow to 0 for quick drafts.

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
- `node tools/bake-reels-ui.mjs` redraws the Instagram UI guide PNG.
- `node tools/bake-font-metrics.mjs` re-measures Helvetica Neue (macOS only).

Agents: read [`AGENTS.md`](AGENTS.md) first.
