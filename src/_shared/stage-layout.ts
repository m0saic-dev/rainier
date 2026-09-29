import { parseM0StringToRenderFrames, validateM0String } from "@m0saic/dsl";
import { grid } from "@m0saic/dsl-stdlib";
import type { LatticeInsetSides } from "@m0saic/template-utils";
import { latticeCellInset } from "@m0saic/template-utils";

/**
 * Stage layout: where the takes go and where the lyrics sit. Pure, no ctx.
 *
 * TAKES (`layoutTakes`) are the triptych's idiom generalised to 1–4 slots: a
 * GUTTERLESS unit-weight ratio split (`grid({ rows, cols })`: `1`, `2[1,1]`,
 * `3(1,1,1)`, `2[2(1,1),2(1,1)]`) and the border between the takes as a
 * per-take `placement.inset` from `latticeCellInset`. The inset is emitted as
 * `(px + 0.5) / rawSize`, so the engine's per-edge floor recovers the integer
 * target exactly: every border is exactly `borderPx` on every canvas, the m0
 * stays tiny (precision = the take count), and the border COLOUR is whatever
 * shows through the gaps, i.e. `document.backgroundColor`. No border rect, no
 * full-canvas colour rect, ever.
 *
 * THE LYRIC BOX (`lyricBox`) sits inside the platform's safe area, keeps a
 * side margin from its edges, and pulls its right edge left of the action rail
 * whenever the two share any vertical span.
 *
 * `_shared` is frozen once shipped: a change is a copy beside a new template
 * version, never an edit here.
 */

/** An integer-px rectangle in canvas space. Structurally the same as the one in `platforms.ts`. */
export type Rect = { x: number; y: number; w: number; h: number };

/** What the artist picks. */
export type TakeLayout = "auto" | "stack" | "split" | "grid";
/** What was actually drawn (`full` = one take filling the stage). */
export type TakeArrangement = "full" | "stack" | "split" | "grid";

export const TAKE_LAYOUTS: readonly TakeLayout[] = ["auto", "stack", "split", "grid"];
export const MIN_TAKES = 1;
export const MAX_TAKES = 4;

export type LayoutTakesOptions = {
  /** Canvas (the render target), px. Rounded to integers. */
  W: number;
  H: number;
  /** Takes on screen, 1..4. Rounded and clamped (a NaN reads as 1). */
  count: number;
  layout: TakeLayout;
  /**
   * Border between takes, px. Rounded, floored at 0, and capped at a quarter
   * of the smallest take pitch so a take can never collapse.
   */
  borderPx: number;
  /** Also draw the border around the outside of the stage. Default false (full bleed). */
  outerBorder?: boolean;
};

export type TakesLayoutResult = {
  /** The gutterless take split, validated. Take `i` is the `i`-th `1` tile. */
  m0: string;
  /** Painted rect of each take (integer px), reading order = m0 tile order. */
  takes: Rect[];
  /**
   * `placement.inset` for take `i` (the inset IS the border); `undefined` =
   * the raw cell already is the take, omit `placement.inset`.
   */
  insets: Array<LatticeInsetSides | undefined>;
  /** Raw cell the m0 realises for take `i` at (W, H), before the inset. */
  cells: Rect[];
  arrangement: TakeArrangement;
  cols: number;
  rows: number;
  /** The count actually laid out (after clamping). */
  count: number;
  /** The border actually drawn (after rounding and the cap). */
  borderPx: number;
};

/** Takes count as laid out: an integer in 1..4 (anything else is clamped; NaN reads as 1). */
export function clampTakeCount(count: number): number {
  const n = Math.round(Number(count));
  if (!Number.isFinite(n)) return MIN_TAKES;
  return Math.min(MAX_TAKES, Math.max(MIN_TAKES, n));
}

/**
 * The arrangement a (count, layout) pair draws:
 * - one take is always `full`;
 * - `auto`: 2 and 3 stack as rows, 4 is a 2x2 grid;
 * - `stack` = rows, `split` = columns;
 * - `grid` is a 2x2 for 4 takes. For 2 or 3 takes there is no honest grid (a
 *   2x2 with an empty cell, or a spanning cell, would leave a hole or a
 *   lopsided take), so it falls back to `stack`, the same as `auto`.
 */
export function resolveTakeArrangement(count: number, layout: TakeLayout): TakeArrangement {
  const n = clampTakeCount(count);
  if (n === 1) return "full";
  switch (layout) {
    case "split":
      return "split";
    case "stack":
      return "stack";
    case "grid":
    case "auto":
    default:
      return n === 4 ? "grid" : "stack";
  }
}

function latticeShape(arrangement: TakeArrangement, n: number): { cols: number; rows: number } {
  switch (arrangement) {
    case "full":
      return { cols: 1, rows: 1 };
    case "split":
      return { cols: n, rows: 1 };
    case "grid":
      return { cols: 2, rows: 2 };
    case "stack":
    default:
      return { cols: 1, rows: n };
  }
}

/**
 * Lay out 1..4 takes on a W x H stage. See the module note for the idiom.
 * Never throws for a canvas of at least 16 x 16 px.
 */
export function layoutTakes(opts: LayoutTakesOptions): TakesLayoutResult {
  const W = Math.round(opts.W);
  const H = Math.round(opts.H);
  if (!(W >= 1) || !(H >= 1)) throw new Error(`layoutTakes: canvas must be at least 1x1 px, got ${opts.W}x${opts.H}`);
  const count = clampTakeCount(opts.count);
  const arrangement = resolveTakeArrangement(count, opts.layout);
  const { cols, rows } = latticeShape(arrangement, count);
  const outer = opts.outerBorder === true;

  // Cap: at most a quarter of the smallest take pitch, so every take keeps at
  // least half its unbordered size (and latticeCellInset never runs out of room).
  const cap = Math.floor(Math.min(W / cols, H / rows) / 4);
  const wanted = Math.round(Number(opts.borderPx));
  const borderPx = Number.isFinite(wanted) ? Math.min(cap, Math.max(0, wanted)) : 0;

  const m0 = String(grid({ rows, cols }).m0);
  const v = validateM0String(m0);
  if (!v.ok) throw new Error(`layoutTakes: generated m0 "${m0}" is invalid (${v.error.code})`);

  // Raw cells in m0 tile order (logicalIndex), which is reading order for a
  // row-major grid: top-left, top-right, bottom-left, bottom-right.
  const frames = parseM0StringToRenderFrames(m0, W, H)
    .slice()
    .sort((a, b) => a.logicalIndex - b.logicalIndex);
  if (frames.length !== count) {
    throw new Error(`layoutTakes: "${m0}" realised ${frames.length} cells at ${W}x${H}, expected ${count}`);
  }
  const cells: Rect[] = frames.map((f) => ({ x: f.x, y: f.y, w: f.width, h: f.height }));

  const lattice = latticeCellInset({
    cols,
    rows,
    canvasW: W,
    canvasH: H,
    gutterXPx: borderPx,
    gutterYPx: borderPx,
    marginPx: outer ? borderPx : 0,
    cells: cells.map((raw, i) => ({ unit: { c0: i % cols, r0: Math.floor(i / cols), cs: 1, rs: 1 }, raw })),
  });

  return {
    m0,
    takes: lattice.targets.map((t) => ({ x: t.x, y: t.y, w: t.w, h: t.h })),
    insets: cells.map((_, i) => lattice.insetAt(i)),
    cells,
    arrangement,
    cols,
    rows,
    count,
    borderPx,
  };
}

/**
 * `placement.inset` that paints exactly `target` inside `cell` (both integer
 * px, `target` inside `cell`), in the half-pixel-centred form the engine's
 * per-edge floor recovers exactly (`latticeCellInset`'s encoding). Use it to
 * put the lyric box on a full-canvas tile: `rectInset({ x: 0, y: 0, w: W, h: H }, box)`.
 * `undefined` when the target is the whole cell. A target poking out of the
 * cell is cut to it.
 */
export function rectInset(cell: Rect, target: Rect): LatticeInsetSides | undefined {
  const l = Math.max(0, Math.round(target.x - cell.x));
  const t = Math.max(0, Math.round(target.y - cell.y));
  const r = Math.max(0, Math.round(cell.x + cell.w - (target.x + target.w)));
  const b = Math.max(0, Math.round(cell.y + cell.h - (target.y + target.h)));
  if (l === 0 && t === 0 && r === 0 && b === 0) return undefined;
  return {
    left: (l + 0.5) / cell.w,
    right: (r + 0.5) / cell.w,
    top: (t + 0.5) / cell.h,
    bottom: (b + 0.5) / cell.h,
  };
}

// ── the lyric box ───────────────────────────────────────────────────────────

export type LyricPosition = "top" | "middle" | "bottom";
export const LYRIC_POSITIONS: readonly LyricPosition[] = ["top", "middle", "bottom"];

/** Default side margin inside the safe area, as a fraction of W (65 px on a 1080-wide Reel). */
export const LYRIC_SIDE_FRAC = 0.06;
/** Default box height, as a fraction of H (576 px on a 1920-tall Reel: three big lines). */
export const LYRIC_HEIGHT_FRAC = 0.3;

/** The part of a platform stage the lyric box reads (`platformStage(...)` fits it). */
export type LyricStage = {
  /** Where nothing of the app's chrome sits, canvas px. */
  safe: Rect;
  /** The action rail (short-form only), canvas px. Absent / null = no rail. */
  rail?: Rect | null;
};

export type LyricBoxOptions = {
  /** Canvas, px. */
  W: number;
  H: number;
  stage: LyricStage;
  /**
   * `top` hugs the top of the safe area, `bottom` its bottom, and `middle`
   * centres on the CANVAS middle (so it lines up with the middle take of a
   * three-take stack), clamped into the safe area.
   */
  position: LyricPosition;
  /**
   * Margin kept from the safe area's left and right edges AND from the rail,
   * as a fraction of W. Default {@link LYRIC_SIDE_FRAC}. Clamped to 0..0.45.
   */
  sideFrac?: number;
  /** Box height as a fraction of H, capped at the safe height. Default {@link LYRIC_HEIGHT_FRAC}. */
  heightFrac?: number;
};

/** `r` cut to the canvas, integer px (at least 1 x 1). */
function clipToCanvas(r: Rect, W: number, H: number): Rect {
  const x0 = Math.min(W - 1, Math.max(0, Math.round(r.x)));
  const y0 = Math.min(H - 1, Math.max(0, Math.round(r.y)));
  const x1 = Math.max(x0 + 1, Math.min(W, Math.round(r.x + r.w)));
  const y1 = Math.max(y0 + 1, Math.min(H, Math.round(r.y + r.h)));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

const finiteOr = (v: number | undefined, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;

/**
 * The lyric box (integer px, canvas space): inside the safe area, `pad =
 * sideFrac * W` in from its left and right edges, and, when the box's
 * vertical span overlaps the rail's, with its right edge pulled to `pad` px
 * left of the rail. Only the right edge moves; the left edge stays put, so a
 * centred page shifts left, away from the buttons. (A stage whose rail leaves
 * no room at all, which no real platform has, gets a 1-px-wide box at the
 * left margin rather than an error.)
 */
export function lyricBox(opts: LyricBoxOptions): Rect {
  const W = Math.round(opts.W);
  const H = Math.round(opts.H);
  if (!(W >= 1) || !(H >= 1)) throw new Error(`lyricBox: canvas must be at least 1x1 px, got ${opts.W}x${opts.H}`);
  const safe = clipToCanvas(opts.stage.safe, W, H);

  const sideFrac = Math.min(0.45, Math.max(0, finiteOr(opts.sideFrac, LYRIC_SIDE_FRAC)));
  const heightFrac = Math.min(1, Math.max(0, finiteOr(opts.heightFrac, LYRIC_HEIGHT_FRAC)));
  // The margin never eats the whole safe width.
  const pad = Math.min(Math.round(sideFrac * W), Math.floor((safe.w - 1) / 2));

  const h = Math.min(safe.h, Math.max(1, Math.round(heightFrac * H)));
  const yMin = safe.y;
  const yMax = safe.y + safe.h - h;
  const y =
    opts.position === "top"
      ? yMin
      : opts.position === "bottom"
        ? yMax
        : Math.min(yMax, Math.max(yMin, Math.round((H - h) / 2)));

  const left = safe.x + pad;
  let right = safe.x + safe.w - pad;
  const rail = opts.stage.rail;
  if (rail && rail.w > 0 && rail.h > 0) {
    const railX = Math.round(rail.x);
    const railTop = Math.round(rail.y);
    const railBottom = Math.round(rail.y + rail.h);
    const overlapsY = y < railBottom && railTop < y + h;
    if (overlapsY && railX < right) right = Math.min(right, railX - pad);
  }
  return { x: left, y, w: Math.max(1, right - left), h };
}
