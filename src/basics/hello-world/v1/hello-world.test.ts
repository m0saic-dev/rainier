import { resolvePropBindings } from "@m0saic/template-utils";
import { asDocument, defaultCtx } from "../../../__testutils__/render";
import { TEMPLATE_REPO } from "../../../repo";
import { HELLO_WORLD_ID, HelloWorldV1 } from "./hello-world";

type Labelled = { editor?: { label?: string } };
const allSources = (doc: ReturnType<typeof asDocument>): Labelled[] => {
  const kids = (doc as unknown as { children?: Record<string, { sources: Labelled[] }> }).children ?? {};
  return [...(doc.sources as Labelled[]), ...Object.values(kids).flatMap((d) => d.sources)];
};

describe(HELLO_WORLD_ID, () => {
  it("is the repo's front door — what `m0saic hello-world --template-repo .` renders", () => {
    expect(String(HelloWorldV1.id)).toBe(HELLO_WORLD_ID);
    expect(String(TEMPLATE_REPO.helloWorld)).toBe(HELLO_WORLD_ID);
  });

  it("wears this repo's subline as the caption default — one string, edited in repo.ts", () => {
    expect(HelloWorldV1.defaultProps?.caption).toBe(`by ${TEMPLATE_REPO.displayName}`);
    expect(HelloWorldV1.defaultProps?.greeting).toBe("Hello, world.");
  });

  it("renders the canonical card: field, card, M, wordmark, greeting and the subline", async () => {
    const doc = asDocument(await HelloWorldV1.render({ ...HelloWorldV1.defaultProps }, defaultCtx));
    expect(doc.kind).toBe("mosaic_document");
    const labels = allSources(doc).map((s) => s.editor?.label ?? "");
    expect(labels).toEqual(expect.arrayContaining(["field", "card", "mark", "wordmark", "greeting", "caption"]));
  });

  it("binds the greeting and the subline — Make's double-click edits them in place (the binding rule)", async () => {
    const doc = asDocument(await HelloWorldV1.render({ ...HelloWorldV1.defaultProps }, defaultCtx));
    const { byProp, rejected } = resolvePropBindings(doc, defaultCtx.target.width, defaultCtx.target.height, {
      propsSchema: HelloWorldV1.propsSchema,
    });
    expect(rejected).toEqual([]); // every binding names a real, bindable prop
    expect(byProp.greeting).toHaveLength(1); // exactly one rect edits the greeting
    expect(byProp.caption).toHaveLength(1); // …and one the subline
    expect(byProp.accent).toBeDefined(); // the M and the wordmark's 0 carry the accent
  });

  it("is deterministic — identical props, identical document", async () => {
    const a = await HelloWorldV1.render({}, defaultCtx);
    const b = await HelloWorldV1.render({}, defaultCtx);
    expect(a).toEqual(b);
  });
});
