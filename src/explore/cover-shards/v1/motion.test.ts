import { FLOAT_DRIFT, gateAt, num, rampExpr, restExpr, shardOverlay, textOverlay } from "./motion";
import { SHARD_MOTIONS } from "./plan";

/**
 * A tiny evaluator for the comma-free subset the position exprs use:
 * numbers, t, W, H, abs(), + - * / and parentheses. Anything else throws,
 * so an expression that sneaks in min/max/clip fails here first.
 */
function evaluate(expr: string, vars: { t: number; W?: number; H?: number }): number {
  let i = 0;
  const peek = () => expr[i];
  const eat = (c: string) => {
    if (expr[i] !== c) throw new Error(`expected "${c}" at ${i} in ${expr}`);
    i++;
  };
  const primary = (): number => {
    const c = peek();
    if (c === "(") {
      eat("(");
      const v = sum();
      eat(")");
      return v;
    }
    if (c === "-") {
      eat("-");
      return -primary();
    }
    if (expr.startsWith("abs(", i)) {
      i += 3;
      eat("(");
      const v = sum();
      eat(")");
      return Math.abs(v);
    }
    const m = /^(\d+(?:\.\d+)?)/.exec(expr.slice(i));
    if (m) {
      i += m[1].length;
      return Number(m[1]);
    }
    if (c === "t" || c === "W" || c === "H") {
      i++;
      const v = vars[c];
      if (v === undefined) throw new Error(`no value for ${c}`);
      return v;
    }
    throw new Error(`unexpected "${c}" at ${i} in ${expr}`);
  };
  const product = (): number => {
    let v = primary();
    while (peek() === "*" || peek() === "/") {
      const op = expr[i++];
      const r = primary();
      v = op === "*" ? v * r : v / r;
    }
    return v;
  };
  const sum = (): number => {
    let v = product();
    while (peek() === "+" || peek() === "-") {
      const op = expr[i++];
      const r = product();
      v = op === "+" ? v + r : v - r;
    }
    return v;
  };
  const v = sum();
  if (i !== expr.length) throw new Error(`trailing input at ${i} in ${expr}`);
  return v;
}

describe("cover-shards motion: the comma-free ramp", () => {
  it("is 0 before t0, halfway at t0 + d/2 and 1 after t0 + d", () => {
    for (const [t0, d] of [
      [1.2, 0.35],
      [0, 0.3],
      [4.65, 0.35],
    ]) {
      const r = rampExpr(t0, d);
      expect(evaluate(r, { t: t0 - 1 })).toBeCloseTo(0, 9);
      expect(evaluate(r, { t: t0 + d / 2 })).toBeCloseTo(0.5, 9);
      expect(evaluate(r, { t: t0 + d + 1 })).toBeCloseTo(1, 9);
      expect(evaluate(r, { t: t0 + d })).toBeCloseTo(1, 9);
    }
  });

  it("eases out: the rest offset is (1 - r)^2, one tile at the start, none once landed", () => {
    const rest = restExpr(2, 0.4);
    expect(evaluate(rest, { t: 1 })).toBeCloseTo(1, 9);
    expect(evaluate(rest, { t: 2.2 })).toBeCloseTo(0.25, 9);
    expect(evaluate(rest, { t: 3 })).toBeCloseTo(0, 9);
  });

  it("writes times with at most three decimals and never an exponent", () => {
    expect(num(0.1 + 0.2)).toBe("0.3");
    expect(num(1e-7)).toBe("0");
    expect(num(-0)).toBe("0");
    expect(num(12.34567)).toBe("12.346");
  });
});

describe("cover-shards motion: overlays", () => {
  it("rise starts one tile below and slide one tile right, then settle at 0", () => {
    const rise = shardOverlay("rise", 1, 0.35);
    expect(rise.xExpr).toBeUndefined();
    expect(evaluate(String(rise.yExpr), { t: 1, H: 200 })).toBeCloseTo(200, 6);
    expect(evaluate(String(rise.yExpr), { t: 2, H: 200 })).toBeCloseTo(0, 6);
    const slide = shardOverlay("slide", 1, 0.35);
    expect(slide.yExpr).toBeUndefined();
    expect(evaluate(String(slide.xExpr), { t: 1, W: 300 })).toBeCloseTo(300, 6);
    expect(evaluate(String(slide.xExpr), { t: 9, W: 300 })).toBeCloseTo(0, 6);
  });

  it("float drifts a fraction of a tile and fades; fade only fades", () => {
    const float = shardOverlay("float", 0.5, 0.3);
    expect(evaluate(String(float.yExpr), { t: 0.5, H: 100 })).toBeCloseTo(100 * FLOAT_DRIFT, 6);
    expect(float.alpha).toMatch(/^\(1-\(1-\(min\(1,max\(0,\(t-0\.5\)\/0\.3\)\)\)\)\*/);
    const fade = shardOverlay("fade", 0.5, 0.3);
    expect(fade.xExpr).toBeUndefined();
    expect(fade.yExpr).toBeUndefined();
    expect(fade.alpha).toBe(float.alpha);
  });

  it("never puts a comma or a colon in xExpr / yExpr, and enable agrees with window", () => {
    const overlays = [
      ...SHARD_MOTIONS.flatMap((m) => [shardOverlay(m, 0, 0.3), shardOverlay(m, 3.123, 0.35)]),
      textOverlay(3.1, 0.4),
      textOverlay(3.25, 0.4, false),
    ];
    for (const o of overlays) {
      for (const e of [o.xExpr, o.yExpr]) if (e !== undefined) expect(e).not.toMatch(/[,:]/);
      const m = /^gte\(t,(\d+(?:\.\d+)?)\)$/.exec(String(o.enable));
      expect(m).not.toBeNull();
      expect(o.window).toEqual({ startSec: Number(m?.[1]) });
    }
  });

  it("gates at the same number it writes", () => {
    expect(gateAt(1.23456)).toEqual({ enable: "gte(t,1.235)", window: { startSec: 1.235 } });
    expect(gateAt(0)).toEqual({ enable: "gte(t,0)", window: { startSec: 0 } });
  });
});
