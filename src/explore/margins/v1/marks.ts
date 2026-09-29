/**
 * Margins geometry: where each line's box sits by default, and the mask
 * shapes the template paints. Pure, no ctx, no randomness.
 *
 * Every mark is ONE colour tile with an inline mask. The mask path is written
 * in the box's own px space (0..w, 0..h) and its `bounds` are the box size,
 * so a box the artist resizes regenerates the stroke at the new size on the
 * next render. Paths use only absolute `M`, `L` and `Z`, every point is
 * clamped inside the box, and every sub-path winds the same way (clockwise
 * on screen): the rasterizer fills with the default nonzero rule, so where
 * two sub-paths overlap (the corners of the hand-drawn box) they add up
 * instead of cutting a hole.
 *
 * The "hand-drawn" feel comes from fixed patterns (ragged ends, a gentle
 * wave, a slight skew), never from a random source: the same box always
 * gives the same path.
 *
 * The empty page (no photo yet) is ruled notebook paper with a handwriting
 * stand-in: squiggle strokes on five lines, drawn as the mask's open
 * `strokes` (the one place a path is not a closed filled shape). Squiggles
 * only, never letters: the template writes nothing.
 */

/** A rect in canvas px (integers from the helpers below). */
export type Box = { x: number; y: number; w: number; h: number };

export const MARK_STYLES = ["highlight", "underline", "box"] as const;
export type MarkStyle = (typeof MARK_STYLES)[number];

export type PageFit = "contain" | "cover";

/** Default band: x from 8 % to 92 % of the page's content width, 70 % of its slot tall. */
export const BAND_X0 = 0.08;
export const BAND_X1 = 0.92;
export const BAND_FILL = 0.7;
/** Smallest box side a mark is drawn at (px). */
export const MIN_BOX_PX = 4;

/** The writing block of the empty page: five ruled lines, the default bands' home. */
export const PLACEHOLDER_LINES = 5;

/** A number as it goes into a path: one decimal, never "-0". */
const n1 = (v: number): string => {
  const r = Math.round(v * 10) / 10;
  return String(r === 0 ? 0 : r);
};

type Pt = [number, number];

/** One closed sub-path through `pts`, every point clamped into [0,w] x [0,h]. */
function subpath(pts: readonly Pt[], w: number, h: number): string {
  const c = (p: Pt): Pt => [Math.min(w, Math.max(0, p[0])), Math.min(h, Math.max(0, p[1]))];
  return (
    pts
      .map(c)
      .map(([x, y], i) => `${i === 0 ? "M" : "L"}${n1(x)} ${n1(y)}`)
      .join(" ") + " Z"
  );
}

/**
 * Where the page shows inside a W x H canvas: the whole canvas for `cover`
 * (and when the photo's size is unknown), the centred fitted rect for
 * `contain`.
 */
export function pageContentRect(
  W: number,
  H: number,
  fit: PageFit,
  media?: { width?: number; height?: number },
): Box {
  const iw = media?.width;
  const ih = media?.height;
  if (fit === "cover" || !(typeof iw === "number" && iw > 0) || !(typeof ih === "number" && ih > 0)) {
    return { x: 0, y: 0, w: W, h: H };
  }
  const s = Math.min(W / iw, H / ih);
  const w = Math.max(1, Math.min(W, Math.round(iw * s)));
  const h = Math.max(1, Math.min(H, Math.round(ih * s)));
  return { x: Math.floor((W - w) / 2), y: Math.floor((H - h) / 2), w, h };
}

/** The empty page's writing block (right of the margin line, the middle of the sheet). */
export function placeholderBlock(W: number, H: number): Box {
  return {
    x: Math.round(0.12 * W),
    y: Math.round(0.26 * H),
    w: Math.round(0.84 * W),
    h: Math.round(0.48 * H),
  };
}

/**
 * One default box per line: `count` equal slots down the content rect, each
 * band centred in its slot at {@link BAND_FILL} of the slot's height, x from
 * {@link BAND_X0} to {@link BAND_X1} of the content width. The bands never
 * overlap (a gap of 30 % of a slot between neighbours).
 */
export function defaultLineBoxes(count: number, content: Box): Box[] {
  if (count <= 0) return [];
  const slot = content.h / count;
  const x = Math.round(content.x + content.w * BAND_X0);
  const w = Math.max(1, Math.round(content.x + content.w * BAND_X1) - x);
  const out: Box[] = [];
  for (let i = 0; i < count; i++) {
    const top = Math.round(content.y + i * slot + ((1 - BAND_FILL) / 2) * slot);
    const bottom = Math.round(content.y + i * slot + ((1 + BAND_FILL) / 2) * slot);
    out.push({ x, y: top, w, h: Math.max(1, bottom - top) });
  }
  return out;
}

/** A box kept inside the canvas and at least {@link MIN_BOX_PX} on each side. */
export function clampBox(b: Box, W: number, H: number): Box {
  const w = Math.min(W, Math.max(MIN_BOX_PX, Math.round(b.w)));
  const h = Math.min(H, Math.max(MIN_BOX_PX, Math.round(b.h)));
  const x = Math.min(W - w, Math.max(0, Math.round(b.x)));
  const y = Math.min(H - h, Math.max(0, Math.round(b.y)));
  return { x, y, w, h };
}

// ── the three marks (box-local px) ───────────────────────────────────────────

/** Left end of the marker, top to bottom: how far in each point sits (fraction of the ragged depth). */
const RAGGED_LEFT = [0.5, 0.1, 0.65, 0.2, 0.8, 0.05, 0.45] as const;
/** Right end, top to bottom: how far in from the right edge. */
const RAGGED_RIGHT = [0.35, 0.85, 0.15, 0.7, 0.3, 0.9, 0.5] as const;
const EDGE_STEPS = 8;

/**
 * A highlighter stroke: a bar from 10 % to 90 % of the box height with a
 * gently wavy top and bottom and ragged ends (a fixed pattern). One
 * sub-path, clockwise.
 */
export function highlightPath(w: number, h: number): string {
  const top = 0.1 * h;
  const bot = 0.9 * h;
  const depth = Math.min(0.22 * h, 0.08 * w);
  const wave = (u: number, phase: number) => 0.025 * h * Math.sin(2 * Math.PI * (1.5 * u + phase));
  const n = RAGGED_LEFT.length;
  const ys = RAGGED_LEFT.map((_, i) => top + (i * (bot - top)) / (n - 1));
  const pts: Pt[] = [];
  // top edge, left to right
  const tl = RAGGED_LEFT[0] * depth;
  const tr = w - RAGGED_RIGHT[0] * depth;
  for (let k = 0; k <= EDGE_STEPS; k++) {
    const u = k / EDGE_STEPS;
    pts.push([tl + u * (tr - tl), top + wave(u, 0.1)]);
  }
  // right end, top to bottom
  for (let i = 1; i < n; i++) pts.push([w - RAGGED_RIGHT[i] * depth, ys[i]]);
  // bottom edge, right to left
  const br = w - RAGGED_RIGHT[n - 1] * depth;
  const bl = RAGGED_LEFT[n - 1] * depth;
  for (let k = 1; k <= EDGE_STEPS; k++) {
    const u = k / EDGE_STEPS;
    pts.push([br + u * (bl - br), bot + wave(1 - u, 0.6)]);
  }
  // left end, bottom to top
  for (let i = n - 2; i >= 1; i--) pts.push([RAGGED_LEFT[i] * depth, ys[i]]);
  return subpath(pts, w, h);
}

/** The underline's zone: the bottom 18 % of the box. */
export const UNDERLINE_ZONE = 0.18;

/**
 * A hand-drawn wavy underline across the bottom {@link UNDERLINE_ZONE} of
 * the box, drawn as a thin filled ribbon (tapered at both ends) rather than
 * a stroke. One sub-path, clockwise.
 */
export function underlinePath(w: number, h: number): string {
  const zone = UNDERLINE_ZONE * h;
  const thick = Math.min(0.6 * zone, Math.max(1.5, 0.38 * zone));
  const amp = ((zone - thick) / 2) * 0.85;
  const cy = h - zone / 2;
  const x0 = 0.02 * w;
  const x1 = 0.98 * w;
  const lambda = Math.max(24, 1.1 * h);
  const steps = Math.min(160, Math.max(16, Math.ceil((x1 - x0) / (lambda / 8))));
  const centre = (u: number): Pt => {
    const x = x0 + u * (x1 - x0);
    return [x, cy + amp * Math.sin((2 * Math.PI * (x - x0)) / lambda)];
  };
  const half = (u: number) => (thick * (0.55 + 0.45 * Math.sin(Math.PI * u))) / 2;
  const topEdge: Pt[] = [];
  const bottomEdge: Pt[] = [];
  for (let k = 0; k <= steps; k++) {
    const u = k / steps;
    const [x, y] = centre(u);
    topEdge.push([x, y - half(u)]);
    bottomEdge.push([x, y + half(u)]);
  }
  return subpath([...topEdge, ...bottomEdge.reverse()], w, h);
}

/**
 * A hand-drawn box: four thin bars in one path, each slightly skewed so the
 * corners do not meet square. Every bar winds clockwise, so the overlapping
 * corners fill (nonzero) instead of cutting holes.
 */
export function boxOutlinePath(w: number, h: number): string {
  const t = Math.max(1, Math.min(Math.min(w, h) / 4, Math.max(2, Math.round(0.055 * Math.min(w, h)))));
  const j = 0.6 * t;
  const bars: Pt[][] = [
    // top: top-left, top-right, bottom-right, bottom-left
    [
      [0, j],
      [w, 0],
      [w, t],
      [0, j + t],
    ],
    // right
    [
      [w - t, 0],
      [w, 0],
      [w - j, h],
      [w - j - t, h],
    ],
    // bottom
    [
      [0, h - t],
      [w, h - t - j],
      [w, h - j],
      [0, h],
    ],
    // left
    [
      [j, 0],
      [j + t, 0],
      [t, h],
      [0, h],
    ],
  ];
  return bars.map((b) => subpath(b, w, h)).join(" ");
}

/** The mask path for one mark of `style` in a w x h box. */
export function markPath(style: MarkStyle, w: number, h: number): string {
  if (style === "underline") return underlinePath(w, h);
  if (style === "box") return boxOutlinePath(w, h);
  return highlightPath(w, h);
}

// ── the empty page: ruled paper and the handwriting stand-in ────────────────

/** Rule and margin-line thickness, px. */
const ruleThickness = (W: number) => Math.max(2, Math.round(W / 540));

/** Where the placeholder's rules sit inside each writing slot (the handwriting's baseline is just above). */
const RULE_AT = 0.72;
const BASELINE_AT = 0.68;
const X_HEIGHT = 0.22;

/**
 * Ruled notebook paper over the whole canvas: horizontal rules at the
 * placeholder's line pitch (from 10 % to 96 % of the height) and a margin
 * line left of the writing block. One path, canvas px, one sub-path per
 * rule.
 */
export function ruledPaperPath(W: number, H: number): string {
  const block = placeholderBlock(W, H);
  const slot = block.h / PLACEHOLDER_LINES;
  const t = ruleThickness(W);
  const rects: Box[] = [];
  if (slot >= 1) {
    const first = Math.ceil((0.1 * H - block.y - RULE_AT * slot) / slot);
    for (let k = first; ; k++) {
      const y = Math.round(block.y + (k + RULE_AT) * slot);
      if (y + t > 0.96 * H) break;
      if (y >= 0.1 * H) rects.push({ x: 0, y, w: W, h: t });
    }
  }
  const marginX = Math.round(0.1 * W);
  rects.push({ x: marginX, y: 0, w: t, h: H });
  return rects
    .map((r) =>
      subpath(
        [
          [r.x, r.y],
          [r.x + r.w, r.y],
          [r.x + r.w, r.y + r.h],
          [r.x, r.y + r.h],
        ],
        W,
        H,
      ),
    )
    .join(" ");
}

/** Word lengths per placeholder line, as fractions of the line's width (each line fits its band). Generic shapes, no letters. */
const SCRIBBLE_WORDS: readonly (readonly number[])[] = [
  [0.2, 0.13, 0.26, 0.14],
  [0.33, 0.17, 0.22],
  [0.11, 0.25, 0.15, 0.24],
  [0.28, 0.1, 0.3],
  [0.17, 0.23, 0.13, 0.2],
];
/** Letter heights, cycled along each word (1 = the x-height; above {@link LOOP_ABOVE} is a tall looped stroke). */
const HUMPS = [1, 0.9, 1.75, 1, 0.8, 1.1, 1.9, 0.95, 1] as const;
const LOOP_ABOVE = 1.4;
/** Points per letter stroke. */
const SAMPLES_PER_HUMP = 8;
/** Forward lean of the writing (x shift per px of height). */
const SLANT = 0.2;

/** An open polyline as path data (canvas px, one decimal). */
const polyline = (pts: readonly Pt[]): string =>
  pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${n1(x)} ${n1(y)}`).join(" ");

/** The pen width of the handwriting stand-in, px. */
export const scribblePen = (W: number): number => Math.max(2, Math.round(W / 270));

/**
 * The handwriting stand-in: five lines of cursive-looking squiggle "words"
 * (a run of humps that loops over on its tall strokes, leaning forward)
 * sitting on the placeholder's rules, in the default bands of a five-line
 * page. One open polyline per word, canvas px, drawn as an inline-mask
 * STROKE (round caps and joins) at {@link scribblePen} wide. Squiggles only,
 * never letters.
 */
export function scribbleStrokes(W: number, H: number): Array<{ d: string; width: number }> {
  const block = placeholderBlock(W, H);
  const slot = block.h / PLACEHOLDER_LINES;
  const bands = defaultLineBoxes(PLACEHOLDER_LINES, block);
  const pen = scribblePen(W);
  const xh = X_HEIGHT * slot;
  const out: Array<{ d: string; width: number }> = [];
  SCRIBBLE_WORDS.forEach((words, line) => {
    const band = bands[line];
    const baseline = block.y + line * slot + BASELINE_AT * slot;
    const gap = 0.035 * band.w;
    let x = band.x + 0.03 * band.w;
    words.forEach((frac, wi) => {
      const len = frac * band.w;
      const count = Math.max(1, Math.round(len / Math.max(4 * pen, 0.8 * xh)));
      const advance = len / count;
      const samples = count * SAMPLES_PER_HUMP;
      const pts: Pt[] = [];
      for (let k = 0; k <= samples; k++) {
        const phase = (k / samples) * count;
        const hump = Math.min(count - 1, Math.floor(phase));
        const hi = HUMPS[(hump + line * 3 + wi * 2) % HUMPS.length];
        // A prolate cycloid: a wide enough radius turns the top of a tall
        // stroke into a loop (an "l"), a small one just leans the hump.
        const r = advance * (hi > LOOP_ABOVE ? 0.24 : 0.1);
        const lift = xh * hi * (0.5 - 0.5 * Math.cos(2 * Math.PI * phase));
        const px = x + phase * advance + r * Math.sin(2 * Math.PI * phase) + SLANT * lift;
        pts.push([Math.min(W, Math.max(0, px)), Math.min(H, Math.max(0, baseline - lift))]);
      }
      out.push({ d: polyline(pts), width: pen });
      x += len + gap;
    });
  });
  return out;
}
