"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.glowSigma = exports.glowOpacity = exports.nest = exports.CHROME_LAYER = exports.LYRIC_LAYER = exports.TEXT_COLOR_PROP = exports.WORD_BOXES_PROP = exports.CONTAINER_BASIS = exports.GLOW_REACH_SIGMA = exports.ALPHA_TILE_PX = exports.CLEAR_ASSET_ID = exports.PAGES_PER_SHEET = exports.ROOT_RESERVED = exports.WORDS_PER_LINKED_NODE = exports.WORDS_PER_NODE = exports.NODE_TILE_BUDGET = void 0;
exports.stackOverlays = stackOverlays;
exports.latticeUnit = latticeUnit;
exports.snapBox = snapBox;
exports.inkReach = inkReach;
exports.alphaTileRect = alphaTileRect;
exports.packUnits = packUnits;
exports.chunkWords = chunkWords;
exports.buildLyricStack = buildLyricStack;
const types_1 = require("@m0saic/types");
const dsl_1 = require("@m0saic/dsl");
const template_utils_1 = require("@m0saic/template-utils");
const advisory_1 = require("./advisory");
const reveal_1 = require("./reveal");
/**
 * The document: pure assembly, no ctx.
 *
 *   root W x H, backgroundColor = the border colour (no base rect)
 *     takes lattice (layoutTakes): one tile per take, bound to its media +
 *       trim + framing props (a placeholder panel when empty, same bindings)
 *     { design only, placed by `placeInsetPieces` (each on its own small rect):
 *         guide tiles, then the advisory plate, then its text
 *       { lyrics, placed by `placeInsetPieces`, bottom to top:
 *           glow refs     (each at its page's GLOW box)
 *           ink refs      (each at its page's INK box), or sheet refs (at the sheet's box)
 *           song          (audio-only leaf, never bound) } }
 *
 *   children.page_P / page_P_1   one page: a child the size of its BOX (see
 *     CONTAINERS HUG THEIR WORDS) holding a small clear PNG tile in a corner
 *     (see THE ALPHA TILE) and <= WORDS_PER_NODE word tiles. A word tile is a
 *     colour tile (the ink) with an inline-mask of the word's glyph outlines,
 *     its own window, fade and rise, and a rect binding to `wordBoxes[i]`
 *     (i = the word's slot: its place among the words THIS CLIP draws, in
 *     reading order, so the slots run 0..n-1 with no gap, which is how Make
 *     seeds a rect list). Word rects are ROOT px everywhere outside this file
 *     (layout, `wordBoxes`, the advisory's avoid list); a child places them
 *     at `rect - box origin`, so they paint on exactly the same root pixels.
 *     The first word of each page also carries the `textColor` entry. A word
 *     whose rect leaves the canvas is skipped rather than placed
 *     (`placeInsetPieces` would throw); the layout keeps every word on the
 *     canvas, so this is only a backstop.
 *   children.glow_P / glow_P_1   the same page in the glow colour, UNBOUND (a
 *     second bound copy would double every word handle in Make), in its own
 *     box: the ink box grown by the halo's reach. Its ref carries
 *     `effects.blur` and `visual.opacity`: the engine blurs a tile BEFORE its
 *     mask, so blurring the word tiles themselves would stay crisp; blurring
 *     the rendered child is the halo, composited with PLAIN ALPHA (see GLOW
 *     BLEND below).
 *   A page longer than WORDS_PER_NODE words is a CHAIN (see LONG PAGES).
 *   children.sheet_L_K   when the root would hold more than NODE_TILE_BUDGET -
 *     ROOT_RESERVED refs, consecutive pages group into sheets (their glow/ink
 *     refs and nothing else: see THE ALPHA TILE), level by level, until the
 *     root fits.
 *
 * Every glow ref sits under every ink ref, at the root and in each sheet, so
 * a halo never paints over a word.
 *
 * NOTHING FULL-FRAME TAKES THE POINTER. In Make every tile is a click target
 * the size of its rect, and a later tile wins the pointer, whatever it draws
 * (a zero-alpha background included). That holds for a `type: "mosaic"` REF
 * too: its wrap is a slot-sized target (a single click on it says "Set by the
 * template", hover washes it), so a full-canvas ref shadows every take under
 * it for as long as its page is on stage. So:
 *   - the only full-canvas tile is the song, which is audio only (Make gives
 *     an audio-only leaf no pointer);
 *   - the platform guide is one tile per region of its PNG (`guideTiles`),
 *     each hugging the chrome it draws, and the advisory is its own strip
 *     (`advisory.ts`); both paint UNDER the lyrics, so a word the artist drags
 *     onto the caption or the rail stays on top, hoverable and draggable;
 *   - every lyric container hugs its words (CONTAINERS HUG THEIR WORDS), and
 *     no container on stage ever sits over another container's words (LONG
 *     PAGES; pages and sheets never share a window).
 *
 * CONTAINERS HUG THEIR WORDS. A page's ink box is the union of its word rects,
 * grown below by the rise (a rising word paints up to `risePx` under its
 * rect) and by the alpha tile's room; its glow box is that grown by
 * GLOW_REACH_SIGMA sigmas of its blur on every side (the halo is clipped at
 * the child's edge, and past that reach it rounds to nothing). Both are
 * snapped OUTWARD to the lyric nest's lattice unit (`latticeUnit`: the pitch
 * `placeInsetPieces` quantizes the axis to at CONTAINER_BASIS, made even; 10 x
 * 8 px on 1080 x 1920) and grown to a 5-smooth number of units (`snapBox`), so:
 *   - the ref's m0 cell IS the box: `placeInsetPieces` gives it no recovery
 *     inset, the child is drawn 1:1 in the engine, and Make's world-frame
 *     math (`frame + inset box + contain-fit`) lands every word on its root
 *     rect with no half-pixel drift (Make adds the inset UNFLOORED), so a
 *     word drag seeds and writes back the exact rect each sibling paints;
 *   - every origin and size is even: the engine overlays a child onto the
 *     yuv420 root at an even offset (an odd one shifts it a pixel);
 *   - every split count inside the child divides a 5-smooth size, so it is
 *     5-smooth (the `latticeSmooth` convention).
 * A sheet's box is the union of its pages' boxes; everything inside a sheet
 * is full-canvas relative to it (a sheet is the old full-canvas structure,
 * scaled to its box). The lyric refs are placed by their OWN
 * `placeInsetPieces` call: the chrome's thin lines clamp its lattice finer,
 * which would leave the lyric boxes off-lattice (an inset). The two nests are
 * chained with `stackOverlays`.
 *
 * LONG PAGES. A page of more than WORDS_PER_NODE drawn words is a CHAIN of
 * chunk children, each the page's box: chunk c holds the alpha tile, then a
 * full-canvas ref to chunk c + 1, then its own words (WORDS_PER_LINKED_NODE of
 * them, so the node stays at NODE_TILE_BUDGET tiles); the last chunk holds the
 * rest (<= WORDS_PER_NODE). The root (or sheet) references only the first
 * chunk, with the page's window; each inner ref has the window of the words
 * it holds. Chunks of a page share the screen (the build-up reveals), so as
 * siblings the later chunk's container would sit over the earlier chunk's
 * words (Make: hover, click and badges land on the container); in the chain
 * every chunk's words are later in the tree than the refs to the chunks after
 * it, so they stay on top. The glow chain mirrors it, blurred once at its top
 * ref (the page glows as one).
 *
 * CHILDREN LIVE WHERE THEY ARE REFERENCED (the build-digest pattern): a
 * sheet's page and glow documents sit in the SHEET's own `children` map, a
 * chunk's next chunk in the CHUNK's map, and the root's map holds only what the
 * root references. The engine resolves refs local-first (then from the root),
 * Make's preview merges inherited maps, and template-utils
 * `resolvePropBindings` (0.2.0) looks in the local map only, so a word tile
 * bound three levels down is visible to every consumer.
 *
 * THE BUDGET. Every tile carrying an enable / window / alpha / position
 * expression is one overlay op on its node's chain; past ~25 per node with
 * inline masks the engine drops masks silently (defaults.ts
 * DEFAULT_OVERLAY_DEPTH_WARN = 20). So every page child holds at most
 * NODE_TILE_BUDGET tiles INCLUDING its alpha tile and chain ref, every sheet
 * at most NODE_TILE_BUDGET refs, and the root at most NODE_TILE_BUDGET -
 * ROOT_RESERVED lyric refs. ROOT_RESERVED is the same in every mode, so design
 * and render group pages identically (a drag in Make means the same thing in
 * the file). The engine only ever renders the RENDER document (Make draws the
 * design document in the browser; exports are render mode), whose root holds
 * the lyric refs and the song and nothing else. The design-only tiles are
 * static crops and a plate with its label, a few overlay layers under the
 * lyrics (non-overlapping tiles share a layer; thin guide lines that meet a
 * region spill onto the next), drawn only by Make, never by the engine.
 *
 * THE ALPHA TILE. Under an opaque (mp4) root a page child whose tiles OVERLAP
 * (`word` mode stacks every word on the box centre, a dragged word can land
 * on another, tight line spacing crosses the words' grid, a chunk's chain ref
 * spans its words) takes the engine's single-flat path, where only IMAGE
 * media earns an alpha carrier (core buildChunkCommands.ts
 * `mediaSliceWantsAlpha`; a nested child's intermediate does not count).
 * Without one the child comes back through h264 and paints its WHOLE frame in
 * its background colour: a solid box over the takes. A transparent
 * `backgroundColor` does NOT help (probed 2026-09-27: `#FFFFFF@0` over
 * overlapping words is the same white box; the background's alpha is honoured
 * only after an alpha carrier was chosen). The image does not need to cover
 * the frame, only to be there: the clear PNG as one ALPHA_TILE_PX tile in a
 * corner of the child (`alphaTileRect`: the first corner no word rect touches,
 * bottom-left first, which the ink box keeps free), under the words, renders
 * pixel-identical to a full-canvas base (PSNR inf, glow twin included). Each
 * child keeps `size` (with an image tile and no size the engine lays the child
 * out at the PNG's own size and the render fails) and its ink (or glow) colour
 * as `backgroundColor`: under the alpha carrier the engine forces it to
 * `<rgb>@0.0`, so anti-aliased edges keep the ink's RGB instead of blending
 * toward black. A SHEET needs no image: its refs all fill the same frame, one
 * clean band, and the band path always gives a non-root node the alpha
 * carrier (probed with 2 to 20 refs).
 *
 * GLOW BLEND. `overlay.blendMode` exists (0.2.0) but the glow uses plain alpha,
 * probe-verified on the 0.2.0 engine (core ffmpegCommands.ts
 * `compositeWithBlend` premultiplies the layer, then blends OPAQUE rgb24):
 *   - white (the default): `screen` is pixel-identical to the alpha over
 *     (b + a(1 - b) either way) and costs a full-canvas premultiply pass;
 *   - `multiply` (a dark glow): every transparent pixel multiplies the base by
 *     zero, so the WHOLE frame goes black; a black halo over plain alpha,
 *     b(1 - a), is already what a correct multiply gives;
 *   - `screen` inside a sheet child: the blend drops the sheet's alpha and the
 *     whole sheet turns opaque over the takes. Sheets appear past 8 glowing
 *     pages, so screen could only ever apply to short clips, and a song's
 *     clips would glow differently by length.
 */
/** Tiles per node, the alpha tile and a chain ref included (the engine's overlay-depth warn line). */
exports.NODE_TILE_BUDGET = 20;
/** Word tiles in a page child with no chain ref: the last (or only) chunk of a page (the alpha tile takes the 20th slot). */
exports.WORDS_PER_NODE = exports.NODE_TILE_BUDGET - 1;
/** Word tiles in a chunk that also carries the ref to the next chunk of its page. */
exports.WORDS_PER_LINKED_NODE = exports.NODE_TILE_BUDGET - 2;
/** Root overlay slots kept free in every mode (so design and render group pages alike): the song, and in design the guide and advisory. */
exports.ROOT_RESERVED = 3;
/** Page items per first-level sheet. */
exports.PAGES_PER_SHEET = 10;
/** Asset id of the transparent PNG inside every page child. */
exports.CLEAR_ASSET_ID = "clear_png";
/** Side of the clear PNG tile in a page child's corner, px (clamped to the child). */
exports.ALPHA_TILE_PX = 16;
/** How far a glow child reaches round its words, in sigmas of its blur (past it the halo rounds to nothing). */
exports.GLOW_REACH_SIGMA = 4;
/**
 * The split basis the lyric containers are placed with at the root (twice the
 * default 120): a finer lattice, so a container hugs its words more closely
 * (18 px -> 10 px steps across 1080, 16 -> 8 down 1920).
 */
exports.CONTAINER_BASIS = 240;
/** Prop key of the regions list word tiles bind to. */
exports.WORD_BOXES_PROP = "wordBoxes";
exports.TEXT_COLOR_PROP = "textColor";
/** Paint order of the lyric overlays (`placeInsetPieces` importance: higher paints later, on top). */
exports.LYRIC_LAYER = { glow: 1, ink: 2, song: 3 };
/** Paint order of the design-only chrome, all of it under the lyrics (the plate shares the guide's layers: they never meet). */
exports.CHROME_LAYER = { guide: 1, advisoryPlate: 1, advisoryText: 2 };
/** A nest of full-canvas overlay tiles: `{1{1{1}}}` for 3. */
const nest = (n) => (n <= 0 ? "" : `{1${(0, exports.nest)(n - 1)}}`);
exports.nest = nest;
function assertM0(label, m0) {
    const v = (0, dsl_1.validateM0String)(m0);
    if (!v.ok)
        throw new Error(`lyric-stack: generated m0 for ${label} is invalid (${JSON.stringify(v)})`);
    return m0;
}
/**
 * Two overlay nests as one: `over` on top of `base`'s innermost layer.
 * `placeInsetPieces` emits `L0{L1{...{Ln}}}` with no braces inside a layer,
 * so the trailing run of `}` is exactly the nest's closers.
 */
function stackOverlays(base, over) {
    let closers = 0;
    while (closers < base.length && base[base.length - 1 - closers] === "}")
        closers++;
    return `${base.slice(0, base.length - closers)}{${over}}${"}".repeat(closers)}`;
}
const intersects = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
/**
 * The lattice unit of an axis of `len` px: the pitch `placeInsetPieces`
 * quantizes it to at CONTAINER_BASIS (the smallest divisor of `len` that is
 * >= len / basis), doubled when odd so every snapped edge is even.
 * 1080 -> 10, 1920 -> 8, 540 -> 6, 960 -> 4.
 */
function latticeUnit(len, basis = exports.CONTAINER_BASIS) {
    const L = Math.max(1, Math.round(len));
    let p = L;
    for (let d = 1; d <= L; d++) {
        if (L % d === 0 && d * basis >= L) {
            p = d;
            break;
        }
    }
    return p % 2 === 0 ? p : 2 * p;
}
/**
 * `[a0, a1)` snapped OUT to the axis's lattice unit and grown to a 5-smooth
 * number of units (the growth split round the content), slid inside
 * `[0, len)`. The whole axis when that would not fit.
 */
function snapSpan(a0, a1, len) {
    const u = latticeUnit(len);
    const lo = Math.max(0, Math.floor(a0 / u) * u);
    const hi = Math.min(len, Math.max(lo + 1, Math.ceil(a1 / u) * u));
    const need = Math.max(1, Math.ceil((hi - lo) / u));
    const units = (0, template_utils_1.ceilToSmooth)(need);
    const size = units * u;
    if (size >= len)
        return { start: 0, size: len };
    const start = Math.max(0, Math.min(lo - Math.floor((units - need) / 2) * u, len - size));
    return { start, size };
}
/** A root-px reach as a container box: lattice-aligned, even, 5-smooth, inside the canvas (see CONTAINERS HUG THEIR WORDS). */
function snapBox(reach, W, H) {
    const x = snapSpan(reach.x, reach.x + reach.w, W);
    const y = snapSpan(reach.y, reach.y + reach.h, H);
    return { x: x.start, y: y.start, w: x.size, h: y.size };
}
const union = (rects) => {
    const x0 = Math.min(...rects.map((r) => r.x));
    const y0 = Math.min(...rects.map((r) => r.y));
    const x1 = Math.max(...rects.map((r) => r.x + r.w));
    const y1 = Math.max(...rects.map((r) => r.y + r.h));
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
};
/** Grow `r` by `pad` on every side, clamped to the canvas. */
const grow = (r, pad, W, H) => {
    const x0 = Math.max(0, r.x - pad);
    const y0 = Math.max(0, r.y - pad);
    return { x: x0, y: y0, w: Math.min(W, r.x + r.w + pad) - x0, h: Math.min(H, r.y + r.h + pad) - y0 };
};
/** How far below its rect a word paints while it rises in (0 unless the entrance is `rise`). */
const riseOf = (w, entrance) => (entrance === "rise" ? Math.max(0, Math.round(w.risePx)) : 0);
/**
 * Where a page's words can paint, root px: their rects, the rise below each,
 * and ALPHA_TILE_PX clear below the lowest rect (the alpha tile's corner),
 * clamped to the canvas.
 */
function inkReach(words, entrance, W, H) {
    const u = union(words.map((w) => w.rect));
    const lowest = u.y + u.h;
    const y1 = Math.min(H, Math.max(lowest + exports.ALPHA_TILE_PX, ...words.map((w) => w.rect.y + w.rect.h + riseOf(w, entrance))));
    return { x: u.x, y: u.y, w: u.w, h: y1 - u.y };
}
const clearAssets = (clearPngPath) => ({ [exports.CLEAR_ASSET_ID]: { kind: "file", path: clearPngPath, mediaType: "image" } });
const clearTile = (label) => ({
    type: "media",
    mediaType: "image",
    assetId: (0, types_1.asAssetId)(exports.CLEAR_ASSET_ID),
    placement: { fit: "cover" },
    editor: { owner: "template", label: `${label}:alpha-base` },
});
/**
 * The alpha tile's rect in a `W` x `H` child: the first corner whose tile
 * touches none of `avoid` (child px), bottom-left first; bottom-left when
 * every corner is taken (it paints nothing, and the words paint over it).
 */
function alphaTileRect(W, H, avoid = []) {
    var _a;
    const w = Math.max(1, Math.min(exports.ALPHA_TILE_PX, Math.round(W)));
    const h = Math.max(1, Math.min(exports.ALPHA_TILE_PX, Math.round(H)));
    const corners = [
        { x: 0, y: H - h, w, h },
        { x: 0, y: 0, w, h },
        { x: W - w, y: H - h, w, h },
        { x: W - w, y: 0, w, h },
    ];
    return (_a = corners.find((c) => !avoid.some((r) => intersects(r, c)))) !== null && _a !== void 0 ? _a : corners[0];
}
const ref = (key, window, extra = {}) => ({
    type: "mosaic",
    ref: key,
    ...extra,
    overlay: (0, reveal_1.overlayWindow)(window),
    editor: { owner: "template", label: key },
});
/**
 * One chunk of a page as a child document, the size of its box: the corner
 * alpha tile, the ref to the next chunk (full-canvas, under the words), and
 * one masked colour tile per word at `rect - box origin`.
 */
function pageDoc(words, color, bound, bindColorOnFirst, entrance, f, label, next) {
    const { box } = f;
    const local = (r) => ({ x: r.x - box.x, y: r.y - box.y, w: r.w, h: r.h });
    const pieces = words.map((w, k) => {
        const tile = {
            type: "lavfi",
            color,
            mask: {
                kind: "inline-mask",
                localPath: w.d,
                bounds: { x: 0, y: 0, width: w.rect.w, height: w.rect.h },
            },
            overlay: (0, reveal_1.wordOverlay)(w.window, entrance, w.risePx),
            editor: { owner: "template", label: `word-${w.index + 1}` },
        };
        let source = tile;
        if (bound) {
            source =
                bindColorOnFirst && k === 0
                    ? (0, template_utils_1.bindProps)(tile, [
                        // The rect entry FIRST: it is the tile's primary handle (Make seeds the
                        // word-drag session from rect-primary tiles); the colour rides as a badge.
                        { propKey: exports.WORD_BOXES_PROP, index: w.box, kind: "rect" },
                        { propKey: exports.TEXT_COLOR_PROP },
                    ])
                    : (0, template_utils_1.bindPropRect)(tile, exports.WORD_BOXES_PROP, w.box);
        }
        return { rect: { ...local(w.rect), importance: 2 }, source };
    });
    // The next chunk under this chunk's words, over the whole child; the alpha tile under both.
    if (next)
        pieces.unshift({ rect: { x: 0, y: 0, w: box.w, h: box.h, importance: 1 }, source: ref(next.key, next.window) });
    const corner = alphaTileRect(box.w, box.h, words.map((w) => local(w.rect)));
    pieces.unshift({ rect: { ...corner, importance: 0 }, source: clearTile(label) });
    const placed = (0, template_utils_1.placeInsetPieces)({ rootW: box.w, rootH: box.h, pieces });
    return {
        kind: "mosaic_document",
        version: 1,
        m0: assertM0(label, String(placed.m0)),
        fps: f.fps,
        durationMs: f.durationMs,
        size: { width: box.w, height: box.h },
        backgroundColor: color,
        assets: clearAssets(f.clearPngPath),
        sources: placed.sources,
        ...(next ? { children: { [next.key]: next.doc } } : {}),
        editor: { label },
    };
}
/** A group of refs as a child document the size of its box: a nest of full-canvas refs (no image: see THE ALPHA TILE). */
function sheetDoc(refs, children, color, f, label) {
    return {
        kind: "mosaic_document",
        version: 1,
        m0: assertM0(label, `1${(0, exports.nest)(refs.length - 1)}`),
        fps: f.fps,
        durationMs: f.durationMs,
        size: { width: f.box.w, height: f.box.h },
        backgroundColor: color,
        // An empty manifest, not none: the engine requires `assets` on every document.
        assets: {},
        sources: refs,
        children,
        editor: { label },
    };
}
/**
 * Consecutive units packed into groups of at most `capacity` refs and at most
 * `maxUnits` units (a unit never splits).
 */
function packUnits(units, capacity, maxUnits = Number.POSITIVE_INFINITY) {
    const groups = [];
    let current = [];
    let used = 0;
    for (const u of units) {
        if (current.length > 0 && (used + u.refs.length > capacity || current.length >= maxUnits)) {
            groups.push(current);
            current = [];
            used = 0;
        }
        current.push(u);
        used += u.refs.length;
    }
    if (current.length > 0)
        groups.push(current);
    return groups;
}
/**
 * A page's drawn words as chunks: one chunk when they fit a node
 * (WORDS_PER_NODE), else WORDS_PER_LINKED_NODE per chunk (each carries the
 * ref to the next) until the rest fits the last.
 */
function chunkWords(words) {
    const out = [];
    let i = 0;
    while (words.length - i > exports.WORDS_PER_NODE) {
        out.push(words.slice(i, i + exports.WORDS_PER_LINKED_NODE));
        i += exports.WORDS_PER_LINKED_NODE;
    }
    out.push(words.slice(i));
    return out;
}
/** The box a unit covers on its parent: a page's glow box (else ink box), a sheet's box. */
const unitBox = (u) => { var _a; return (u.kind === "sheet" ? u.box : ((_a = u.glow) !== null && _a !== void 0 ? _a : u.ink)); };
function buildLyricStack(args) {
    var _a, _b;
    const W = Math.round(args.W);
    const H = Math.round(args.H);
    const { style } = args;
    const glowOn = style.glow > 0;
    const nodeTiles = {};
    const frameAt = (box) => ({ box, fps: args.fps, durationMs: args.durationMs, clearPngPath: args.clearPngPath });
    // ── pages: what each draws, its chunks and its boxes ─────────────────────
    const pages = [];
    const drawnRects = [];
    let items = 0;
    const canvas = (r) => r.x >= 0 && r.y >= 0 && r.w >= 1 && r.h >= 1 && r.x + r.w <= W && r.y + r.h <= H;
    args.pages.forEach((page, p) => {
        const drawn = page.words.filter((w) => w.box >= 0 && w.d !== "" && (0, reveal_1.isShown)(w.window) && canvas(w.rect));
        if (drawn.length === 0)
            return;
        drawnRects.push(...drawn.map((w) => w.rect));
        const reach = inkReach(drawn, style.entrance, W, H);
        const blur = Math.max(1, Math.round(page.glowSigma));
        pages.push({
            kind: "page",
            n: p + 1,
            chunks: chunkWords(drawn),
            window: (0, reveal_1.spanOf)(drawn.map((w) => w.window)),
            glowSigma: page.glowSigma,
            ink: snapBox(reach, W, H),
            glow: glowOn ? snapBox(grow(reach, Math.ceil(exports.GLOW_REACH_SIGMA * blur), W, H), W, H) : null,
            refs: glowOn ? [0, 0] : [0],
        });
    });
    // ── sheets: group until the root's overlays fit ───────────────────────────
    const rootCapacity = exports.NODE_TILE_BUDGET - exports.ROOT_RESERVED;
    const sheetColor = glowOn ? style.glowColor : style.textColor;
    let level = pages;
    let sheets = 0;
    let depth = 0;
    while (level.reduce((n, u) => n + u.refs.length, 0) > rootCapacity) {
        depth++;
        // First level: pages, at most PAGES_PER_SHEET a sheet; above it, sheets by the tile budget.
        const groups = packUnits(level, exports.NODE_TILE_BUDGET, depth === 1 ? exports.PAGES_PER_SHEET : undefined);
        level = groups.map((members, k) => ({
            kind: "sheet",
            key: `sheet_${depth}_${k + 1}`,
            members,
            window: (0, reveal_1.spanOf)(members.map((m) => m.window)),
            box: snapBox(union(members.map(unitBox)), W, H),
            refs: [0],
        }));
        sheets += groups.length;
    }
    /**
     * A unit's refs and documents. `at` = the box of the root-level sheet it
     * sits in (everything inside a sheet is full-canvas relative to it), or
     * null at the root (a page takes its own boxes).
     */
    const build = (u, at) => {
        if (u.kind === "sheet") {
            const box = at !== null && at !== void 0 ? at : u.box;
            const inner = u.members.map((m) => build(m, box));
            // Every glow under every ink (see the header).
            const refs = [...inner.flatMap((b) => b.glow.map((g) => g.source)), ...inner.flatMap((b) => b.ink.map((g) => g.source))];
            nodeTiles[u.key] = refs.length;
            const docs = Object.assign({}, ...inner.map((b) => b.docs));
            return { glow: [], ink: [{ source: ref(u.key, u.window), box }], docs: { [u.key]: sheetDoc(refs, docs, sheetColor, frameAt(box), u.key) } };
        }
        const suffix = (c) => (u.chunks.length > 1 ? `${u.n}_${c + 1}` : `${u.n}`);
        /** The page's chunk chain in one colour, built last chunk first; returns the first chunk. */
        const chain = (prefix, color, bound, box) => {
            let next = null;
            for (let c = u.chunks.length - 1; c >= 0; c--) {
                const key = `${prefix}_${suffix(c)}`;
                const doc = pageDoc(u.chunks[c], color, bound, bound && c === 0, style.entrance, frameAt(box), key, next);
                nodeTiles[key] = doc.sources.length;
                const window = (0, reveal_1.spanOf)(u.chunks.slice(c).flatMap((ch) => ch.map((w) => w.window)));
                next = { key, doc, window };
            }
            return next;
        };
        items += u.chunks.length;
        const inkBox = at !== null && at !== void 0 ? at : u.ink;
        const ink = chain("page", style.textColor, true, inkBox);
        const out = { glow: [], ink: [{ source: ref(ink.key, u.window), box: inkBox }], docs: { [ink.key]: ink.doc } };
        if (u.glow) {
            const glowBox = at !== null && at !== void 0 ? at : u.glow;
            const glow = chain("glow", style.glowColor, false, glowBox);
            out.docs[glow.key] = glow.doc;
            out.glow.push({
                source: ref(glow.key, u.window, {
                    effects: { blur: Math.max(1, Math.round(u.glowSigma)) },
                    visual: { opacity: (0, exports.glowOpacity)(style.glow) },
                }),
                box: glowBox,
            });
        }
        return out;
    };
    const built = level.map((u) => build(u, null));
    const children = Object.assign({}, ...built.map((b) => b.docs));
    // ── assets ────────────────────────────────────────────────────────────────
    // One key per file. The slug drops the folder and the extension, so a take
    // "Song Title.mov" and the song "Song Title.wav", or two IMG_0001.MOV from
    // different folders, would share a key and the second would overwrite the
    // first (a take tile playing the song): a clash gets "_2" instead. The same
    // file with the same media type reuses its key.
    const assets = {};
    const assetFor = (path, mediaType) => {
        const same = Object.keys(assets).find((k) => assets[k].path === path && assets[k].mediaType === mediaType);
        if (same !== undefined)
            return (0, types_1.asAssetId)(same);
        const id = (0, template_utils_1.uniqueAssetKey)((0, template_utils_1.slugifyAssetKeyFromPath)(path), assets);
        assets[id] = { kind: "file", path, mediaType };
        return id;
    };
    // ── takes ─────────────────────────────────────────────────────────────────
    const takeSources = args.slots.map((slot, i) => {
        const inset = args.takes.insets[i];
        const bindings = [{ propKey: slot.propKey }, { propKey: slot.trimKey }, { propKey: slot.framingKey }];
        if (!slot.clip) {
            const panel = {
                type: "text",
                renderMode: { kind: "image" },
                visual: { backgroundColor: slot.placeholder.color },
                style: {
                    fontFamily: "Helvetica Neue",
                    fontSize: Math.max(12, Math.round(W * 0.03)),
                    fontColor: "#FFFFFF@0.6",
                },
                ...(inset ? { placement: { inset } } : {}),
                layers: [
                    {
                        content: { kind: "literal", text: slot.placeholder.label },
                        placement: { hAlign: "center", vAlign: "middle" },
                    },
                ],
                editor: { owner: "template", label: `take-${i + 1}:placeholder` },
            };
            return (0, template_utils_1.bindProps)(panel, bindings);
        }
        const { clip } = slot;
        const trim = clip.mediaType === "video" ? Math.max(0, Math.round(slot.trimStartMs)) : 0;
        const framing = Math.min(1, Math.max(0, slot.framing));
        const media = {
            type: "media",
            mediaType: clip.mediaType,
            assetId: assetFor(clip.path, clip.mediaType),
            // Cover crops ONE axis; the other focus is a no-op, so one knob serves both.
            placement: { fit: "cover", focusX: framing, focusY: framing, ...(inset ? { inset } : {}) },
            ...(trim > 0 ? { playback: { clipStartMs: trim } } : {}),
            audio: { enabled: false },
            editor: { owner: "template", label: `take-${i + 1}` },
        };
        return (0, template_utils_1.bindProps)(media, bindings);
    });
    // ── the lyrics and the song: their own nest (see CONTAINERS HUG THEIR WORDS) ─
    const lyricPieces = [
        ...built.flatMap((b) => b.glow).map(({ source, box }) => ({ rect: { ...box, importance: exports.LYRIC_LAYER.glow }, source })),
        ...built.flatMap((b) => b.ink).map(({ source, box }) => ({ rect: { ...box, importance: exports.LYRIC_LAYER.ink }, source })),
    ];
    if (args.song) {
        lyricPieces.push({
            rect: { x: 0, y: 0, w: W, h: H, importance: exports.LYRIC_LAYER.song },
            source: {
                type: "media",
                // MANDATORY even for real audio files: an mp3 with cover art probes as
                // video; declaring "audio" makes the engine take only its sound.
                mediaType: "audio",
                assetId: assetFor(args.song.path, args.song.mediaType),
                ...(args.song.clipStartMs > 0 ? { playback: { clipStartMs: Math.round(args.song.clipStartMs) } } : {}),
                audio: { enabled: true, volume: 1 },
                editor: { owner: "template", label: "song" },
            },
        });
    }
    const lyrics = lyricPieces.length > 0 ? (0, template_utils_1.placeInsetPieces)({ rootW: W, rootH: H, pieces: lyricPieces, basis: exports.CONTAINER_BASIS }) : null;
    for (const s of (_a = lyrics === null || lyrics === void 0 ? void 0 : lyrics.sources) !== null && _a !== void 0 ? _a : []) {
        // A container's cell must BE its box (no recovery inset): see CONTAINERS HUG THEIR WORDS.
        if (s.type === "mosaic" && ((_b = s.placement) === null || _b === void 0 ? void 0 : _b.inset) !== undefined) {
            throw new Error(`lyric-stack: container ${s.ref} is off the root lattice at ${W}x${H}`);
        }
    }
    // ── design only: the guide and the advisory, under the lyrics ────────────
    const chromePieces = [];
    const guide = args.guide;
    if (guide === null || guide === void 0 ? void 0 : guide.png) {
        const assetId = assetFor(guide.png.path, "image");
        for (const t of guide.png.tiles) {
            chromePieces.push({
                rect: { ...t.rect, importance: exports.CHROME_LAYER.guide },
                source: {
                    type: "media",
                    mediaType: "image",
                    assetId,
                    // `cover` on a crop the size of its rect's shape: a 1:1 window at 1080 x 1920.
                    placement: { fit: "cover", sourceRect: { ...t.sourceRect } },
                    editor: { owner: "template", label: `platform-guide:${t.name}` },
                },
            });
        }
    }
    const advisory = guide ? (0, advisory_1.layoutAdvisory)(guide.lines, { W, H, stage: guide.stage, avoid: drawnRects }) : null;
    if (advisory) {
        chromePieces.push({
            rect: { ...advisory.rect, importance: exports.CHROME_LAYER.advisoryPlate },
            source: {
                type: "lavfi",
                color: "#000000",
                visual: { opacity: 0.7 },
                editor: { owner: "template", label: "design-advisory:plate" },
            },
        }, {
            rect: { ...advisory.rect, importance: exports.CHROME_LAYER.advisoryText },
            source: {
                // Svg text: the bundled face in the preview and the engine alike, with no background of its own.
                ...(0, template_utils_1.svgTextSource)([{ text: advisory.text, fontSize: advisory.fontSize, color: "#FFFFFF", vAlign: "middle" }]),
                editor: { owner: "template", label: "design-advisory" },
            },
        });
    }
    const chrome = chromePieces.length > 0 ? (0, template_utils_1.placeInsetPieces)({ rootW: W, rootH: H, pieces: chromePieces }) : null;
    nodeTiles.root = lyricPieces.length + chromePieces.length;
    const overlays = chrome && lyrics ? stackOverlays(String(chrome.m0), String(lyrics.m0)) : chrome ? String(chrome.m0) : lyrics ? String(lyrics.m0) : null;
    const m0 = assertM0("root", overlays ? `${args.takes.m0}{${overlays}}` : args.takes.m0);
    const doc = {
        kind: "mosaic_document",
        version: 1,
        m0,
        fps: args.fps,
        durationMs: args.durationMs,
        size: { width: W, height: H },
        backgroundColor: style.borderColor,
        format: args.output.format,
        audio: args.output.audio,
        assets: assets,
        sources: [...takeSources, ...(chrome ? chrome.sources : []), ...(lyrics ? lyrics.sources : [])],
        ...(Object.keys(children).length > 0 ? { children } : {}),
    };
    return { doc, items, sheets, nodeTiles };
}
/** Glow strength -> the halo ref's opacity. */
const glowOpacity = (glow) => Math.min(1, 0.5 + Math.min(1, Math.max(0, glow)) * 0.5);
exports.glowOpacity = glowOpacity;
/** Glow strength and the page's type size -> the halo's gaussian sigma, px. */
const glowSigma = (glow, fontPx) => Math.max(1, Math.round(fontPx * (0.025 + Math.min(1, Math.max(0, glow)) * 0.06)));
exports.glowSigma = glowSigma;
