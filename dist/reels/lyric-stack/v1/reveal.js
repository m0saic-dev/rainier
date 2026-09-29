"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isShown = exports.sec = exports.MIN_SOLO_MS = exports.RISE_EM = exports.ENTRANCE_SEC = exports.WORD_ENTRANCES = exports.REVEAL_MODES = void 0;
exports.revealWindows = revealWindows;
exports.soloWindows = soloWindows;
exports.overlayWindow = overlayWindow;
exports.wordOverlay = wordOverlay;
exports.spanOf = spanOf;
exports.REVEAL_MODES = ["cumulative", "word", "line"];
exports.WORD_ENTRANCES = ["rise", "fade", "instant"];
/** How long a word takes to fade / rise into place, s. */
exports.ENTRANCE_SEC = 0.28;
/** How far a rising word travels, in ems of its size. */
exports.RISE_EM = 0.16;
/** The shortest window a word gets in `word` mode when the page has room, ms. */
exports.MIN_SOLO_MS = 120;
/** Seconds, 3 decimals: the one spelling every window string uses. */
const sec = (ms) => (ms / 1000).toFixed(3);
exports.sec = sec;
/**
 * Each word's window inside its page `[startMs, endMs)`. A word that lands at
 * or after the page end (a word sung after the clip ends keeps its place in
 * the page with `atMs === endMs`) gets an EMPTY window (`startMs === endMs`)
 * and is not drawn, and so does, in `word` mode, a carried word whose turn
 * ended before the clip (see CARRIED WORDS); every other window lies inside
 * the page and is non-empty.
 */
function revealWindows(page, words, mode) {
    const s = Math.round(page.startMs);
    const e = Math.max(s, Math.round(page.endMs));
    const at = words.map((w) => Math.max(s, Math.round(w.atMs)));
    const shown = at.map((ms) => ms < e);
    const none = { startMs: e, endMs: e };
    if (mode === "word") {
        const drawn = soloDrawn(words, at, shown, s);
        const solo = soloWindows({ startMs: s, endMs: e }, at.filter((_, k) => drawn[k]));
        let next = 0;
        return at.map((_, k) => (drawn[k] ? solo[next++] : none));
    }
    if (mode === "line") {
        const lineStart = new Map();
        words.forEach((w, k) => {
            if (!shown[k])
                return;
            const prev = lineStart.get(w.line);
            lineStart.set(w.line, prev === undefined ? at[k] : Math.min(prev, at[k]));
        });
        return words.map((w, k) => (shown[k] ? { startMs: lineStart.get(w.line), endMs: e } : none));
    }
    return at.map((ms, k) => (shown[k] ? { startMs: ms, endMs: e } : none));
}
/** True when a window shows anything. */
const isShown = (w) => w.endMs > w.startMs;
exports.isShown = isShown;
/**
 * `word` mode: which shown words get a turn. Every word sung in the clip does.
 * Of the carried words (sung before the clip, clamped to the page start
 * `s`), only the last one does, and only when the first word sung in the
 * clip lands at least {@link MIN_SOLO_MS} later (or never): the word still
 * on screen when the clip begins, never a flash, never delaying a word
 * being sung.
 */
function soloDrawn(words, at, shown, s) {
    const live = (k) => shown[k] && words[k].carried !== true;
    const firstLive = at.findIndex((_, k) => live(k));
    let keep = -1;
    at.forEach((_, k) => {
        if (shown[k] && words[k].carried === true && (firstLive < 0 || k < firstLive))
            keep = k;
    });
    if (keep >= 0 && firstLive >= 0 && at[firstLive] - s < exports.MIN_SOLO_MS)
        keep = -1;
    return at.map((_, k) => live(k) || k === keep);
}
/**
 * `word` mode: disjoint, non-empty, in-order windows. Word k shows from its
 * (monotonic) beat until word k+1 lands; the last word holds to the page end.
 * A word landing too close to the next is given {@link MIN_SOLO_MS} when the
 * page has room for everyone; otherwise the page is shared out equally.
 */
function soloWindows(page, atMs) {
    const n = atMs.length;
    if (n === 0)
        return [];
    const s = Math.round(page.startMs);
    const e = Math.max(s + 1, Math.round(page.endMs));
    const span = e - s;
    const min = Math.min(exports.MIN_SOLO_MS, Math.floor(span / n));
    if (min < 1) {
        // No room at all: n equal slices, the last one takes the remainder.
        return atMs.map((_, k) => ({
            startMs: s + Math.floor((k * span) / n),
            endMs: k === n - 1 ? e : s + Math.floor(((k + 1) * span) / n),
        }));
    }
    const starts = [];
    for (let k = 0; k < n; k++) {
        // Leave room for the words still to come, never start before the last one's minimum.
        const latest = e - (n - k) * min;
        const earliest = k === 0 ? s : starts[k - 1] + min;
        starts.push(Math.min(latest, Math.max(earliest, Math.round(atMs[k]))));
    }
    return starts.map((start, k) => ({ startMs: start, endMs: k + 1 < n ? starts[k + 1] : e }));
}
/** The enable string and structured window for a half-open `[startMs, endMs)`, in agreement. */
function overlayWindow(w) {
    const a = (0, exports.sec)(w.startMs);
    const b = (0, exports.sec)(Math.max(w.startMs, w.endMs - 1));
    return { enable: `between(t,${a},${b})`, window: { startSec: Number(a), endSec: Number(b) } };
}
/** `1 - min(1, u)` for u >= 0 without a comma: `(1 - u + |u - 1|) / 2`. */
function restExpr(startSec) {
    const u = `(t-${startSec})/${exports.ENTRANCE_SEC}`;
    return `((1-${u}+abs(${u}-1))/2)`;
}
/**
 * A word tile's overlay: its window, plus the entrance. `fade` ramps alpha
 * 0 -> 1 over {@link ENTRANCE_SEC}; `rise` also eases the word up from
 * `risePx` below its place (an ease-out: the offset is `risePx * rest^2`).
 */
function wordOverlay(w, entrance, risePx) {
    const out = { ...overlayWindow(w) };
    if (entrance === "instant")
        return out;
    const a = (0, exports.sec)(w.startMs);
    out.alpha = `min(1,max(0,(t-${a})/${exports.ENTRANCE_SEC}))`;
    const rise = Math.max(0, Math.round(risePx));
    if (entrance === "rise" && rise > 0) {
        const rest = restExpr(a);
        out.yExpr = `${rise}*${rest}*${rest}`;
    }
    return out;
}
/** The union of windows, `null` for none. */
function spanOf(windows) {
    if (windows.length === 0)
        return null;
    let startMs = Infinity;
    let endMs = -Infinity;
    for (const w of windows) {
        startMs = Math.min(startMs, w.startMs);
        endMs = Math.max(endMs, w.endMs);
    }
    return { startMs, endMs };
}
