import type { MosaicAudioConfig, MosaicColor, MosaicDocument, MosaicMediaKind, MosaicOutputFormat } from "@m0saic/types";
import type { Rect } from "../../../_shared/glyph-text";
import type { GuideTile } from "../../../_shared/platform-emit";
import type { PlatformStage } from "../../../_shared/platforms";
import type { TakesLayoutResult } from "../../../_shared/stage-layout";
import type { Window, WordEntrance } from "./reveal";
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
export declare const NODE_TILE_BUDGET = 20;
/** Word tiles in a page child with no chain ref: the last (or only) chunk of a page (the alpha tile takes the 20th slot). */
export declare const WORDS_PER_NODE: number;
/** Word tiles in a chunk that also carries the ref to the next chunk of its page. */
export declare const WORDS_PER_LINKED_NODE: number;
/** Root overlay slots kept free in every mode (so design and render group pages alike): the song, and in design the guide and advisory. */
export declare const ROOT_RESERVED = 3;
/** Page items per first-level sheet. */
export declare const PAGES_PER_SHEET = 10;
/** Asset id of the transparent PNG inside every page child. */
export declare const CLEAR_ASSET_ID = "clear_png";
/** Side of the clear PNG tile in a page child's corner, px (clamped to the child). */
export declare const ALPHA_TILE_PX = 16;
/** How far a glow child reaches round its words, in sigmas of its blur (past it the halo rounds to nothing). */
export declare const GLOW_REACH_SIGMA = 4;
/**
 * The split basis the lyric containers are placed with at the root (twice the
 * default 120): a finer lattice, so a container hugs its words more closely
 * (18 px -> 10 px steps across 1080, 16 -> 8 down 1920).
 */
export declare const CONTAINER_BASIS = 240;
/** Prop key of the regions list word tiles bind to. */
export declare const WORD_BOXES_PROP = "wordBoxes";
export declare const TEXT_COLOR_PROP = "textColor";
/** Paint order of the lyric overlays (`placeInsetPieces` importance: higher paints later, on top). */
export declare const LYRIC_LAYER: {
    readonly glow: 1;
    readonly ink: 2;
    readonly song: 3;
};
/** Paint order of the design-only chrome, all of it under the lyrics (the plate shares the guide's layers: they never meet). */
export declare const CHROME_LAYER: {
    readonly guide: 1;
    readonly advisoryPlate: 1;
    readonly advisoryText: 2;
};
export type TakeSlot = {
    /** The `media` prop the slot shows, and its trim and framing props (all bound to the tile). */
    propKey: string;
    trimKey: string;
    framingKey: string;
    /** Absent: a placeholder panel saying what goes here. */
    clip?: {
        path: string;
        mediaType: "video" | "image";
    };
    trimStartMs: number;
    /** Cover-crop anchor 0..1 on whichever axis the crop removes. */
    framing: number;
    placeholder: {
        color: MosaicColor;
        label: string;
    };
};
/** One word tile, ready to place. */
export type StackWord = {
    /** Global reading-order index in the lyrics (the tile's label, `word-N`). */
    index: number;
    /** The `wordBoxes` element this tile binds to: its slot among the words the clip draws (-1 = not drawn). */
    box: number;
    text: string;
    /** Root canvas px. */
    rect: Rect;
    /** Glyph outlines, rect-local px. */
    d: string;
    window: Window;
    risePx: number;
};
export type StackPage = {
    words: StackWord[];
    /** Gaussian sigma of this page's glow, px. */
    glowSigma: number;
};
export type StackStyle = {
    textColor: MosaicColor;
    /** 0 = no glow. */
    glow: number;
    glowColor: MosaicColor;
    borderColor: MosaicColor;
    entrance: WordEntrance;
};
/** Design only: what Make shows over the preview. Never in an export. */
export type StackGuide = {
    /** The platform guide: its PNG and the tiles that crop it (`guideTiles`). Absent = Show platform guide off. */
    png?: {
        path: string;
        tiles: GuideTile[];
    };
    /** Advisory notes, one per line of thought (empty = no advisory). */
    lines: string[];
    /** The platform's stage at this canvas: the advisory sits inside `safe`, left of `rail`. */
    stage: PlatformStage;
};
export type StackArgs = {
    W: number;
    H: number;
    fps: number;
    durationMs: number;
    takes: TakesLayoutResult;
    /** One per take on screen, in `takes` order. */
    slots: TakeSlot[];
    pages: StackPage[];
    style: StackStyle;
    /** Absolute path of the transparent PNG (assets/clear.png). */
    clearPngPath: string;
    song?: {
        path: string;
        mediaType: MosaicMediaKind;
        clipStartMs: number;
    };
    /** Design only: the platform guide and the advisory. */
    guide?: StackGuide;
    output: {
        format: MosaicOutputFormat;
        audio: MosaicAudioConfig;
    };
};
export type StackPlan = {
    doc: MosaicDocument;
    /** Page items (a page, or one chunk of a long page). */
    items: number;
    /** Sheet children, all levels. */
    sheets: number;
    /** Tile count per node (`root` = the root's overlays; takes excluded). */
    nodeTiles: Record<string, number>;
};
/** A nest of full-canvas overlay tiles: `{1{1{1}}}` for 3. */
export declare const nest: (n: number) => string;
/**
 * Two overlay nests as one: `over` on top of `base`'s innermost layer.
 * `placeInsetPieces` emits `L0{L1{...{Ln}}}` with no braces inside a layer,
 * so the trailing run of `}` is exactly the nest's closers.
 */
export declare function stackOverlays(base: string, over: string): string;
/**
 * The lattice unit of an axis of `len` px: the pitch `placeInsetPieces`
 * quantizes it to at CONTAINER_BASIS (the smallest divisor of `len` that is
 * >= len / basis), doubled when odd so every snapped edge is even.
 * 1080 -> 10, 1920 -> 8, 540 -> 6, 960 -> 4.
 */
export declare function latticeUnit(len: number, basis?: number): number;
/** A root-px reach as a container box: lattice-aligned, even, 5-smooth, inside the canvas (see CONTAINERS HUG THEIR WORDS). */
export declare function snapBox(reach: Rect, W: number, H: number): Rect;
/**
 * Where a page's words can paint, root px: their rects, the rise below each,
 * and ALPHA_TILE_PX clear below the lowest rect (the alpha tile's corner),
 * clamped to the canvas.
 */
export declare function inkReach(words: readonly StackWord[], entrance: WordEntrance, W: number, H: number): Rect;
/**
 * The alpha tile's rect in a `W` x `H` child: the first corner whose tile
 * touches none of `avoid` (child px), bottom-left first; bottom-left when
 * every corner is taken (it paints nothing, and the words paint over it).
 */
export declare function alphaTileRect(W: number, H: number, avoid?: readonly Rect[]): Rect;
/**
 * Consecutive units packed into groups of at most `capacity` refs and at most
 * `maxUnits` units (a unit never splits).
 */
export declare function packUnits<T extends {
    refs: unknown[];
}>(units: readonly T[], capacity: number, maxUnits?: number): T[][];
/**
 * A page's drawn words as chunks: one chunk when they fit a node
 * (WORDS_PER_NODE), else WORDS_PER_LINKED_NODE per chunk (each carries the
 * ref to the next) until the rest fits the last.
 */
export declare function chunkWords<T>(words: readonly T[]): T[][];
export declare function buildLyricStack(args: StackArgs): StackPlan;
/** Glow strength -> the halo ref's opacity. */
export declare const glowOpacity: (glow: number) => number;
/** Glow strength and the page's type size -> the halo's gaussian sigma, px. */
export declare const glowSigma: (glow: number, fontPx: number) => number;
