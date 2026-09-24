import type {
  MosaicDocument,
  MosaicDocumentPipeline,
  MosaicEngineContext,
  MosaicRenderableFile,
} from "@m0saic/types";

/**
 * Test-only helpers (excluded from the shipped dist — see tsconfig.build.json).
 *
 * A template's `render` returns a union: a document OR a pipeline. Tests
 * narrow through these guards so a template that changes shape fails loudly
 * with "expected a document, got mosaic_pipeline" instead of a fuzzy
 * property-access error.
 */

type Renderable = MosaicRenderableFile | MosaicDocument | MosaicDocumentPipeline;

export function asDocument(renderable: Renderable): MosaicDocument {
  if (renderable.kind !== "mosaic_document") {
    throw new Error(`expected a mosaic_document, got "${renderable.kind}"`);
  }
  return renderable;
}

export function asPipeline(renderable: Renderable): MosaicDocumentPipeline {
  if (renderable.kind !== "mosaic_pipeline") {
    throw new Error(`expected a mosaic_pipeline, got "${renderable.kind}"`);
  }
  return renderable;
}

/**
 * The minimal honest ctx: `mode`, `target`, and `output` are what
 * `defineMosaicTemplate`'s wrapper itself reads on EVERY render (compaction
 * + output stamping), so a real host always supplies them — and so must
 * tests. `media` defaults empty. Anything else stays absent on purpose:
 * a template touching a ctx member it didn't declare a need for should
 * fail loudly here.
 */
export function targetCtx(
  width: number,
  height: number,
  opts: { fps?: number; durationMs?: number; media?: MosaicEngineContext["media"] } = {},
): MosaicEngineContext {
  const target = {
    width,
    height,
    fps: opts.fps ?? 30,
    durationMs: opts.durationMs ?? 2000,
  };
  return {
    mode: "render",
    target,
    output: { ...target, workspaceDir: "/tmp/starter-test" },
    media: opts.media ?? {},
  } as unknown as MosaicEngineContext;
}

/** The default 16:9 test canvas for templates with no size-sensitive logic. */
export const defaultCtx = targetCtx(1280, 720);
