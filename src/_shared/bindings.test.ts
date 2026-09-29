import { declareBindings, unboundOf } from "./bindings";

describe("declareBindings", () => {
  it("wraps the reasons as bindings.unbound", () => {
    expect(declareBindings({ fps: "timing" })).toEqual({ bindings: { unbound: { fps: "timing" } } });
  });

  it("copies the reasons, so a later edit to the input cannot move a declaration", () => {
    const reasons: Record<string, string> = { gap: "geometry" };
    const declared = declareBindings(reasons);
    reasons.gap = "changed";
    expect(unboundOf(declared)).toEqual({ gap: "geometry" });
  });

  it("survives a spread into a template literal (how templates use it)", () => {
    const template = { id: "x", ...declareBindings({ seed: "determinism" }) };
    expect(unboundOf(template)).toEqual({ seed: "determinism" });
  });

  it("reads an absent declaration as empty", () => {
    expect(unboundOf({ id: "x" })).toEqual({});
  });
});
