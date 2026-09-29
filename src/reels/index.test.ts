import { templates } from "../index";
import { targetCtx } from "../__testutils__/render";
import { LyricStackV1, LyricTriptychV1, reelsTemplates } from "./index";

const TRIPTYCH = "@rainier/reels/lyric-triptych/v1";

describe("reels barrel: the triptych is deprecated from the barrel, never in its frozen file", () => {
  const entry = templates.find((t) => String(t.id) === TRIPTYCH);

  it("templates[] carries deprecated.replacement = Lyric Stack", () => {
    expect(entry).toBeDefined();
    expect(String(entry?.deprecated?.replacement)).toBe("@rainier/reels/lyric-stack/v1");
    expect(entry?.deprecated?.replacement).toBe(LyricStackV1.id);
    expect(typeof entry?.deprecated?.reason).toBe("string");
    expect(entry?.deprecated?.since).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("the named frozen export is the object exactly as shipped", () => {
    expect((LyricTriptychV1 as { deprecated?: unknown }).deprecated).toBeUndefined();
    expect(reelsTemplates[0]).not.toBe(LyricTriptychV1);
    expect(entry?.render).toBe(LyricTriptychV1.render);
    expect(entry?.propsSchema).toBe(LyricTriptychV1.propsSchema);
    expect(entry?.defaultProps).toBe(LyricTriptychV1.defaultProps);
  });

  it("no other template is deprecated, and ids are unique", () => {
    expect(templates.filter((t) => t.deprecated).map((t) => String(t.id))).toEqual([TRIPTYCH]);
    expect(new Set(templates.map((t) => String(t.id))).size).toBe(templates.length);
  });

  it("the deprecated copy renders the same document as the frozen export", async () => {
    if (!entry) throw new Error("triptych missing from templates[]");
    const viaBarrel = await entry.render({ ...entry.defaultProps } as never, targetCtx(540, 960, { durationMs: 3000 }));
    const direct = await LyricTriptychV1.render(
      { ...LyricTriptychV1.defaultProps } as never,
      targetCtx(540, 960, { durationMs: 3000 }),
    );
    expect(viaBarrel).toBeTruthy();
    expect(JSON.stringify(viaBarrel)).toBe(JSON.stringify(direct));
  });
});
