import type { MosaicOverlayExpr } from "@m0saic/types";

/**
 * Reveal: WHEN each word is on screen, and how it arrives. Pure, no ctx.
 *
 * Three modes (the `reveal` prop):
 *
 *   cumulative  words land one by one on their beat and stay until the page
 *               clears (the triptych's behaviour);
 *   line        a line's words land together (at the line's first word) and
 *               stay until the page clears;
 *   word        ONE word at a time: each word shows alone, from its beat
 *               until the next word lands. Windows are disjoint (never two
 *               words on screen at once) and never empty, so a word too fast
 *               for its neighbours still gets a readable minimum when the
 *               page has room, and an equal share when it does not.
 *
 * CARRIED WORDS. A page that straddles Song start keeps the words sung
 * before the clip, clamped to the page start (`song-window.ts`), so the page
 * typesets as it does in the song; the caller marks them `carried`. The
 * build-up modes show them from the first frame (they had landed). In `word`
 * mode each of them already had its turn: only the LAST can still be on
 * screen when the clip begins, and only until the next word lands, so the
 * others are not drawn at all (before, each flashed for MIN_SOLO_MS and
 * pushed the words being sung late).
 *
 * Windows are half-open `[startMs, endMs)` on the output timeline, integer
 * ms. On the wire (`overlayWindow`) they become an inclusive `enable` /
 * `window` pair that ends one millisecond early, so a window closing at the
 * instant the next one opens never shares a frame with it.
 *
 * Placement expressions are inlined into the filtergraph verbatim, so the
 * rise (`yExpr`) is written comma-free (clamps via `abs()`); `alpha` and
 * `enable` are escaped by the engine and may use commas.
 */

export type RevealMode = "word" | "cumulative" | "line";
export type WordEntrance = "rise" | "fade" | "instant";

export const REVEAL_MODES: readonly RevealMode[] = ["cumulative", "word", "line"];
export const WORD_ENTRANCES: readonly WordEntrance[] = ["rise", "fade", "instant"];

/** How long a word takes to fade / rise into place, s. */
export const ENTRANCE_SEC = 0.28;
/** How far a rising word travels, in ems of its size. */
export const RISE_EM = 0.16;
/** The shortest window a word gets in `word` mode when the page has room, ms. */
export const MIN_SOLO_MS = 120;

/** A half-open window on the output timeline, integer ms. */
export type Window = { startMs: number; endMs: number };

/** The only word fields the windows read. */
export type RevealWord = {
  atMs: number;
  line: number;
  /** Sung before the clip began (the song window clamped it to the page start). Only `word` mode reads it. */
  carried?: boolean;
};

/** Seconds, 3 decimals: the one spelling every window string uses. */
export const sec = (ms: number): string => (ms / 1000).toFixed(3);

/**
 * Each word's window inside its page `[startMs, endMs)`. A word that lands at
 * or after the page end (a word sung after the clip ends keeps its place in
 * the page with `atMs === endMs`) gets an EMPTY window (`startMs === endMs`)
 * and is not drawn, and so does, in `word` mode, a carried word whose turn
 * ended before the clip (see CARRIED WORDS); every other window lies inside
 * the page and is non-empty.
 */
export function revealWindows(page: Window, words: readonly RevealWord[], mode: RevealMode): Window[] {
  const s = Math.round(page.startMs);
  const e = Math.max(s, Math.round(page.endMs));
  const at = words.map((w) => Math.max(s, Math.round(w.atMs)));
  const shown = at.map((ms) => ms < e);
  const none: Window = { startMs: e, endMs: e };
  if (mode === "word") {
    const drawn = soloDrawn(words, at, shown, s);
    const solo = soloWindows({ startMs: s, endMs: e }, at.filter((_, k) => drawn[k]));
    let next = 0;
    return at.map((_, k) => (drawn[k] ? solo[next++] : none));
  }
  if (mode === "line") {
    const lineStart = new Map<number, number>();
    words.forEach((w, k) => {
      if (!shown[k]) return;
      const prev = lineStart.get(w.line);
      lineStart.set(w.line, prev === undefined ? at[k] : Math.min(prev, at[k]));
    });
    return words.map((w, k) => (shown[k] ? { startMs: lineStart.get(w.line) as number, endMs: e } : none));
  }
  return at.map((ms, k) => (shown[k] ? { startMs: ms, endMs: e } : none));
}

/** True when a window shows anything. */
export const isShown = (w: Window): boolean => w.endMs > w.startMs;

/**
 * `word` mode: which shown words get a turn. Every word sung in the clip does.
 * Of the carried words (sung before the clip, clamped to the page start
 * `s`), only the last one does, and only when the first word sung in the
 * clip lands at least {@link MIN_SOLO_MS} later (or never): the word still
 * on screen when the clip begins, never a flash, never delaying a word
 * being sung.
 */
function soloDrawn(words: readonly RevealWord[], at: readonly number[], shown: readonly boolean[], s: number): boolean[] {
  const live = (k: number) => shown[k] && words[k].carried !== true;
  const firstLive = at.findIndex((_, k) => live(k));
  let keep = -1;
  at.forEach((_, k) => {
    if (shown[k] && words[k].carried === true && (firstLive < 0 || k < firstLive)) keep = k;
  });
  if (keep >= 0 && firstLive >= 0 && at[firstLive] - s < MIN_SOLO_MS) keep = -1;
  return at.map((_, k) => live(k) || k === keep);
}

/**
 * `word` mode: disjoint, non-empty, in-order windows. Word k shows from its
 * (monotonic) beat until word k+1 lands; the last word holds to the page end.
 * A word landing too close to the next is given {@link MIN_SOLO_MS} when the
 * page has room for everyone; otherwise the page is shared out equally.
 */
export function soloWindows(page: Window, atMs: readonly number[]): Window[] {
  const n = atMs.length;
  if (n === 0) return [];
  const s = Math.round(page.startMs);
  const e = Math.max(s + 1, Math.round(page.endMs));
  const span = e - s;
  const min = Math.min(MIN_SOLO_MS, Math.floor(span / n));
  if (min < 1) {
    // No room at all: n equal slices, the last one takes the remainder.
    return atMs.map((_, k) => ({
      startMs: s + Math.floor((k * span) / n),
      endMs: k === n - 1 ? e : s + Math.floor(((k + 1) * span) / n),
    }));
  }
  const starts: number[] = [];
  for (let k = 0; k < n; k++) {
    // Leave room for the words still to come, never start before the last one's minimum.
    const latest = e - (n - k) * min;
    const earliest = k === 0 ? s : starts[k - 1] + min;
    starts.push(Math.min(latest, Math.max(earliest, Math.round(atMs[k]))));
  }
  return starts.map((start, k) => ({ startMs: start, endMs: k + 1 < n ? starts[k + 1] : e }));
}

/** The enable string and structured window for a half-open `[startMs, endMs)`, in agreement. */
export function overlayWindow(w: Window): Pick<MosaicOverlayExpr, "enable" | "window"> {
  const a = sec(w.startMs);
  const b = sec(Math.max(w.startMs, w.endMs - 1));
  return { enable: `between(t,${a},${b})`, window: { startSec: Number(a), endSec: Number(b) } };
}

/** `1 - min(1, u)` for u >= 0 without a comma: `(1 - u + |u - 1|) / 2`. */
function restExpr(startSec: string): string {
  const u = `(t-${startSec})/${ENTRANCE_SEC}`;
  return `((1-${u}+abs(${u}-1))/2)`;
}

/**
 * A word tile's overlay: its window, plus the entrance. `fade` ramps alpha
 * 0 -> 1 over {@link ENTRANCE_SEC}; `rise` also eases the word up from
 * `risePx` below its place (an ease-out: the offset is `risePx * rest^2`).
 */
export function wordOverlay(w: Window, entrance: WordEntrance, risePx: number): MosaicOverlayExpr {
  const out: MosaicOverlayExpr = { ...overlayWindow(w) };
  if (entrance === "instant") return out;
  const a = sec(w.startMs);
  out.alpha = `min(1,max(0,(t-${a})/${ENTRANCE_SEC}))`;
  const rise = Math.max(0, Math.round(risePx));
  if (entrance === "rise" && rise > 0) {
    const rest = restExpr(a);
    out.yExpr = `${rise}*${rest}*${rest}`;
  }
  return out;
}

/** The union of windows, `null` for none. */
export function spanOf(windows: readonly Window[]): Window | null {
  if (windows.length === 0) return null;
  let startMs = Infinity;
  let endMs = -Infinity;
  for (const w of windows) {
    startMs = Math.min(startMs, w.startMs);
    endMs = Math.max(endMs, w.endMs);
  }
  return { startMs, endMs };
}
