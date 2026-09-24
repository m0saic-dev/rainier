"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WORD_SPREAD_FRACTION = exports.isBreakText = void 0;
exports.tokenize = tokenize;
exports.resolvePageWindows = resolvePageWindows;
exports.resolveWordTimes = resolveWordTimes;
exports.resolvePages = resolvePages;
/** A page whose whole text is `[like this]` is a pause: it clears the screen. */
const isBreakText = (text) => /^\s*\[[^\]]*\]\s*$/.test(text);
exports.isBreakText = isBreakText;
/** Guessed words land across this share of the page, leaving it readable after. */
exports.WORD_SPREAD_FRACTION = 0.7;
/** Shortest page a guess will produce (ms). */
const MIN_PAGE_MS = 400;
/** Split a page into word tokens, remembering explicit line breaks. */
function tokenize(text) {
    const out = [];
    text
        .trim()
        .split(/\n/)
        .forEach((line, li) => {
        line
            .split(/\s+/)
            .filter((t) => t !== "")
            .forEach((t, wi) => out.push({ text: t, lineBreakBefore: li > 0 && wi === 0 }));
    });
    return out;
}
/**
 * Page windows for every cue, in order. Timed cues keep their times; runs of
 * untimed cues share the gap between their timed neighbours (a leading run
 * starts at 0, a trailing run ends at the song's end). An explicit `endMs`
 * wins when it is sane; otherwise a page lasts until the next one starts.
 * Cues starting at/after `durationMs` are dropped (a render pinned shorter
 * than the song).
 */
function resolvePageWindows(cues, durationMs) {
    const dur = Math.max(1, Math.round(durationMs));
    const inside = cues.filter((c) => !(typeof c.startMs === "number" && c.startMs >= dur));
    const starts = new Array(inside.length);
    let i = 0;
    let prevBound = 0;
    while (i < inside.length) {
        const s = inside[i].startMs;
        if (typeof s === "number") {
            starts[i] = Math.max(prevBound, Math.max(0, s));
            prevBound = starts[i];
            i++;
            continue;
        }
        let j = i;
        while (j < inside.length && typeof inside[j].startMs !== "number")
            j++;
        const nextBound = j < inside.length ? Math.max(prevBound, inside[j].startMs) : dur;
        const run = j - i;
        // With a timed page before the run, that page keeps the first slot.
        const slots = i > 0 ? run + 1 : run;
        const span = Math.max(0, nextBound - prevBound);
        for (let k = 0; k < run; k++) {
            const slot = i > 0 ? k + 1 : k;
            starts[i + k] = Math.round(prevBound + (slot * span) / Math.max(1, slots));
        }
        i = j;
        prevBound = nextBound;
    }
    const out = [];
    for (let k = 0; k < inside.length; k++) {
        const startMs = Math.min(starts[k], dur - 1);
        const next = k + 1 < inside.length ? starts[k + 1] : dur;
        const explicit = inside[k].endMs;
        let endMs = typeof explicit === "number" && explicit > startMs ? Math.min(explicit, dur) : Math.min(next, dur);
        // Two taps on the same instant (or a mis-tap) still get a readable beat.
        if (endMs - startMs < MIN_PAGE_MS)
            endMs = Math.min(dur, startMs + MIN_PAGE_MS);
        if (endMs > startMs)
            out.push({ cue: inside[k], startMs, endMs });
    }
    return out;
}
/**
 * When each word of one page lands. Studio-timed words keep their time
 * (clamped into the page, never earlier than the word before); untimed words
 * are spread by character count between the timed words around them — or,
 * with nothing timed, across the first {@link WORD_SPREAD_FRACTION} of the
 * page. A `words[]` whose length no longer matches the text (the text was
 * edited after timing) is ignored, like the studio does.
 */
function resolveWordTimes(text, window, words) {
    const tokens = tokenize(text);
    if (tokens.length === 0)
        return [];
    const aligned = Array.isArray(words) && words.length === tokens.length ? words : undefined;
    const last = Math.max(window.startMs, window.endMs - 60);
    const clamp = (ms) => Math.min(Math.max(ms, window.startMs), last);
    const known = tokens.map((_, i) => {
        var _a;
        const s = (_a = aligned === null || aligned === void 0 ? void 0 : aligned[i]) === null || _a === void 0 ? void 0 : _a.startMs;
        return typeof s === "number" && Number.isFinite(s) ? clamp(Math.round(s)) : undefined;
    });
    // Keep studio times monotonic (a mis-tap can't make a word land early).
    let floor = window.startMs;
    for (let i = 0; i < known.length; i++) {
        if (known[i] !== undefined) {
            known[i] = Math.max(floor, known[i]);
            floor = known[i];
        }
    }
    const spreadEnd = clamp(Math.round(window.startMs + (window.endMs - window.startMs) * exports.WORD_SPREAD_FRACTION));
    const at = new Array(tokens.length);
    let i = 0;
    while (i < tokens.length) {
        if (known[i] !== undefined) {
            at[i] = known[i];
            i++;
            continue;
        }
        let j = i;
        while (j < tokens.length && known[j] === undefined)
            j++;
        // Guess the run [i, j) between its anchors, weighting by word length.
        const from = i > 0 ? at[i - 1] : window.startMs;
        // A trailing run past the spread point still gets a quick cascade.
        const to = j < tokens.length
            ? known[j]
            : Math.max(spreadEnd, Math.min(last, from + 180 * (j - i + 1)));
        const weights = tokens.slice(i, j).map((t) => Math.max(1, t.text.length));
        // A run after a timed word starts one share later (that word needs its moment).
        const lead = i > 0 ? Math.max(1, tokens[i - 1].text.length) : 0;
        const total = weights.reduce((a, b) => a + b, 0) + lead;
        let acc = lead;
        for (let k = i; k < j; k++) {
            at[k] = Math.round(from + ((to - from) * acc) / Math.max(1, total));
            acc += weights[k - i];
        }
        i = j;
    }
    return tokens.map((t, k) => ({
        text: t.text,
        atMs: clamp(at[k]),
        timed: known[k] !== undefined,
        lineBreakBefore: t.lineBreakBefore,
    }));
}
/** Every renderable page: windows + word times; pause pages (`[break]`) dropped. */
function resolvePages(cues, durationMs) {
    return resolvePageWindows(cues, durationMs)
        .filter(({ cue }) => !(0, exports.isBreakText)(cue.text))
        .map(({ cue, startMs, endMs }) => ({
        startMs,
        endMs,
        words: resolveWordTimes(cue.text, { startMs, endMs }, cue.words),
    }))
        .filter((p) => p.words.length > 0);
}
