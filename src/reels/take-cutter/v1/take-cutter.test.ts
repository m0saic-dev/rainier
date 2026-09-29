import type { MosaicDocument, MosaicEngineContext, MosaicMediaSource, MosaicTemplatePropDefinition } from "@m0saic/types";
import { asAssetId } from "@m0saic/types";
import { parseM0StringToRenderFrames, validateM0String } from "@m0saic/dsl";
import { assertDefaultPropsComplete, resolvePropBindings } from "@m0saic/template-utils";

import { unboundOf } from "../../../_shared/bindings";
import { asDocument, asPipeline, targetCtx } from "../../../__testutils__/render";
import { TAKE_CUTTER_MAX_TAKES, TakeCutterV1, resolveTakeCutterKnobs } from "./take-cutter";

const W = 1080;
const H = 1920;
const VIDEO = "/media/rehearsal.mov";
const PHOTO = "/media/cover.jpg";

const video = (over: Record<string, unknown> = {}) => ({
  kind: "video",
  width: 1920,
  height: 1080,
  hasVideo: true,
  hasAudio: true,
  durationMs: 2_700_000,
  fps: 29.97,
  ...over,
});

const ctxWith = (media: Record<string, unknown>, mode: "render" | "design" = "render"): MosaicEngineContext =>
  ({
    ...targetCtx(W, H, {
      durationMs: 20_000,
      media: Object.fromEntries(Object.entries(media).map(([k, v]) => [asAssetId(k), v])) as MosaicEngineContext["media"],
    }),
    mode,
  }) as MosaicEngineContext;

const TAKES = [
  { startMs: 270_000, endMs: 285_000 },
  { startMs: 1_080_000, endMs: 1_095_000, label: "chorus 2" },
  { startMs: 1_890_000, endMs: 1_905_000 },
];

const render = (props: Parameters<typeof TakeCutterV1.render>[0], ctx = ctxWith({ [VIDEO]: video() })) =>
  TakeCutterV1.render({ ...TakeCutterV1.defaultProps, ...props }, ctx);

const texts = (doc: MosaicDocument) =>
  doc.sources.flatMap((s) =>
    s.type === "text" ? s.layers.map((l) => (l.content.kind === "literal" ? l.content.text : "")) : [],
  );

const isError = (doc: MosaicDocument) => doc.sources.some((s) => s.engine?.renderStatus === "error");

/** A static, opaque, unshaped colour source (the 0.3.0 `canvasFill` smell when it covers the canvas). */
const isPlainColorFill = (s: Record<string, unknown>) =>
  !s.overlay && !s.mask && !s.placement && !s.effects && s.type === "lavfi" && typeof s.color === "string";

describe("@rainier/reels/take-cutter/v1: metadata", () => {
  it("declares the time-ranges picker on takes, reading the video from source", () => {
    const control = TakeCutterV1.propsSchema?.takes?.meta?.control;
    expect(control?.picker).toBe("time-ranges");
    expect(control?.videoFromProp).toBe("source");
    expect(TakeCutterV1.propsSchema?.takes?.meta?.constraints?.jsonSchema).toMatchObject({ maxItems: TAKE_CUTTER_MAX_TAKES });
  });

  it("puts video, takes and shape first, as filmed by default", () => {
    const primary = Object.entries(TakeCutterV1.propsSchema ?? {})
      .filter(([, d]) => d.meta?.ui?.primary)
      .map(([k]) => k);
    expect(primary).toEqual(["source", "takes", "frame"]);
    expect(TakeCutterV1.defaultProps).toEqual({ takes: [], frame: "source", framing: 0.5, namePrefix: "", muteAudio: false });
    expect(TakeCutterV1.outputHints).toMatchObject({ width: 1080, height: 1920, fps: 30, durationMs: 20_000 });
  });

  it("shows every optional knob's effective default", () => {
    expect(() => assertDefaultPropsComplete(TakeCutterV1)).not.toThrow();
  });

  it("declares exactly takes, framing and maxWidth as unbound, each with a reason", () => {
    const unbound = unboundOf(TakeCutterV1);
    expect(Object.keys(unbound).sort()).toEqual(["framing", "maxWidth", "takes"]);
    for (const reason of Object.values(unbound)) expect(reason.trim()).not.toBe("");
  });

  it("roll call: every prop that can carry a handle is bound at defaults or declared", async () => {
    const doc = asDocument(await render({}));
    const { byProp } = resolvePropBindings(doc, W, H, { propsSchema: TakeCutterV1.propsSchema });
    const unbound = unboundOf(TakeCutterV1);
    const closed = (d: MosaicTemplatePropDefinition) =>
      d.type === "boolean" || (d.meta?.constraints?.oneOf?.length ?? 0) > 0;
    for (const [key, def] of Object.entries(TakeCutterV1.propsSchema ?? {})) {
      if (closed(def)) {
        expect(unbound[key]).toBeUndefined();
        continue;
      }
      // Bound XOR declared: a declaration for a bound prop is stale.
      expect([key, Boolean(byProp[key]) !== Boolean(unbound[key])]).toEqual([key, true]);
    }
  });

  it("clamps knobs and never throws", () => {
    expect(resolveTakeCutterKnobs({})).toEqual({ frame: "source", framing: 0.5, muteAudio: false, namePrefix: "" });
    expect(resolveTakeCutterKnobs({ frame: "square" as never, framing: 9, maxWidth: 50, muteAudio: true })).toEqual({
      frame: "source",
      framing: 1,
      muteAudio: true,
      namePrefix: "",
      maxWidth: 128,
    });
    expect(resolveTakeCutterKnobs({ maxWidth: 99_999 }).maxWidth).toBe(3840);
  });
});

describe("@rainier/reels/take-cutter/v1: before there is anything to cut", () => {
  it("defaults render the onboarding card: bindings resolve, no full-canvas colour source, identical twice", async () => {
    const a = asDocument(await render({}, ctxWith({})));
    const b = asDocument(await render({}, ctxWith({})));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(validateM0String(String(a.m0)).ok).toBe(true);
    expect(isError(a)).toBe(false);
    const { byProp, rejected } = resolvePropBindings(a, W, H, { propsSchema: TakeCutterV1.propsSchema });
    expect(rejected).toEqual([]);
    expect(Object.keys(byProp).sort()).toEqual(["namePrefix", "source"]);
    const frames = parseM0StringToRenderFrames(String(a.m0), W, H);
    a.sources.forEach((s, i) => {
      const full = frames[i].x === 0 && frames[i].y === 0 && frames[i].width === W && frames[i].height === H;
      expect(full && isPlainColorFill(s as unknown as Record<string, unknown>)).toBe(false);
    });
    expect(a.backgroundColor).toBeTruthy();
  });

  it("the onboarding caption follows the file-name prefix", async () => {
    const doc = asDocument(await render({ namePrefix: "live set" }, ctxWith({})));
    expect(texts(doc)).toContain("File names: live_set_01m22s-01m37s.mp4");
  });

  it("a video with no takes: design mode asks for the first take, a real render is an error card", async () => {
    const design = asDocument(await render({ source: VIDEO }, ctxWith({ [VIDEO]: video() }, "design")));
    expect(isError(design)).toBe(false);
    expect(texts(design)).toContain("Open Takes to mark your first take");
    const tile = design.sources.find((s) => s.editor?.binding?.propKey === "source");
    expect(tile?.type).toBe("media");

    const real = asDocument(await render({ source: VIDEO }));
    expect(isError(real)).toBe(true);
    // A blank takes value is still "no takes yet", not a parse error.
    expect(texts(asDocument(await render({ source: VIDEO, takes: "" }, ctxWith({ [VIDEO]: video() }, "design"))))).toContain(
      "Open Takes to mark your first take",
    );
  });

  it.each([
    ["an unprobed video", { source: VIDEO, takes: TAKES }, {}],
    ["a photo", { source: PHOTO, takes: TAKES }, { [PHOTO]: video({ kind: "image", durationMs: undefined }) }],
    ["no probed length", { source: VIDEO, takes: TAKES }, { [VIDEO]: video({ durationMs: undefined }) }],
    ["unreadable takes", { source: VIDEO, takes: "{bad" }, { [VIDEO]: video() }],
    [
      "too many takes",
      { source: VIDEO, takes: Array.from({ length: TAKE_CUTTER_MAX_TAKES + 1 }, (_, i) => ({ startMs: i * 1000, endMs: i * 1000 + 500 })) },
      { [VIDEO]: video() },
    ],
  ])("%s gives an error card, in design mode too", async (_name, props, media) => {
    for (const mode of ["render", "design"] as const) {
      const doc = asDocument(await render(props as never, ctxWith(media, mode)));
      expect(isError(doc)).toBe(true);
    }
  });
});

describe("@rainier/reels/take-cutter/v1: cutting", () => {
  it("returns a multi pipeline, one step per take, at the video's fps", async () => {
    const out = asPipeline(await render({ source: VIDEO, takes: TAKES }));
    expect(out.emit).toBe("multi");
    expect(out.fps).toBe(30);
    expect(out.steps.map((s) => s.label)).toEqual([
      "rehearsal_04m30s-04m45s",
      "chorus_2_18m00s-18m15s",
      "rehearsal_31m30s-31m45s",
    ]);
    expect(out.steps.map((s) => s.durationMs)).toEqual([15_000, 15_000, 15_000]);
  });

  it("the same in design mode (Make previews the takes)", async () => {
    const out = asPipeline(await render({ source: VIDEO, takes: TAKES }, ctxWith({ [VIDEO]: video() }, "design")));
    expect(out.steps).toHaveLength(3);
  });

  it("a single take still returns a one-step multi pipeline (the planner collapses it)", async () => {
    const out = asPipeline(await render({ source: VIDEO, takes: [TAKES[1]] }));
    expect(out.emit).toBe("multi");
    expect(out.steps).toHaveLength(1);
  });

  it("every step's media source is bound to source, through the template wrapper too", async () => {
    const out = asPipeline(await render({ source: VIDEO, takes: TAKES, frame: "vertical" }));
    for (const step of out.steps) {
      const doc = step.file as MosaicDocument;
      expect(doc.size).toEqual({ width: 1080, height: 1920 });
      const { byProp, rejected } = resolvePropBindings(doc, 1080, 1920, { propsSchema: TakeCutterV1.propsSchema });
      expect(rejected).toEqual([]);
      expect(Object.keys(byProp)).toEqual(["source"]);
    }
  });

  it("takes as a JSON string (a hand-written --props) work the same", async () => {
    const a = asPipeline(await render({ source: VIDEO, takes: JSON.stringify(TAKES) }));
    const b = asPipeline(await render({ source: VIDEO, takes: TAKES }));
    expect(a).toEqual(b);
  });

  it("follows a 60 fps video; with no probed fps the host's own fps stands", async () => {
    const sixty = asPipeline(await render({ source: VIDEO, takes: TAKES }, ctxWith({ [VIDEO]: video({ fps: 60 }) })));
    expect(sixty.fps).toBe(60); // ctx.target.fps is 30: the authored fps wins through the wrapper
    const none = asPipeline(await render({ source: VIDEO, takes: TAKES }, ctxWith({ [VIDEO]: video({ fps: undefined }) })));
    expect(none.fps).toBe(30);
  });

  it("as filmed by default: the video's own size, a plain cover", async () => {
    const out = asPipeline(await render({ source: VIDEO, takes: TAKES }));
    const doc = out.steps[0].file as MosaicDocument;
    expect(doc.size).toEqual({ width: 1920, height: 1080 });
    expect((doc.sources[0] as MosaicMediaSource).placement).toEqual({ fit: "cover" });
  });

  it("is deterministic", async () => {
    expect(await render({ source: VIDEO, takes: TAKES })).toEqual(await render({ source: VIDEO, takes: TAKES }));
  });
});
