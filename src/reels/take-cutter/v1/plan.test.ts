import {
  FALLBACK_BASE,
  LABEL_BASE_MAX,
  VERTICAL_SIZE,
  coverFocus,
  evenRound,
  fmtStamp,
  labelBase,
  rangeStepName,
  sanitizeLabel,
  scaleToMaxWidth,
  shortName,
  takeLabel,
  takeSize,
} from "./plan";

describe("fmtStamp", () => {
  it("writes minutes and seconds under an hour, hours from an hour on", () => {
    expect(fmtStamp(82_000)).toBe("01m22s");
    expect(fmtStamp(3_725_000)).toBe("1h02m05s");
    expect(fmtStamp(0)).toBe("00m00s");
    expect(fmtStamp(59_999)).toBe("00m59s"); // floored: what a player's clock reads
    expect(fmtStamp(44 * 60_000 + 10_000)).toBe("44m10s");
    expect(fmtStamp(10 * 3_600_000)).toBe("10h00m00s");
  });

  it("never goes negative or NaN", () => {
    expect(fmtStamp(-5)).toBe("00m00s");
    expect(fmtStamp(Number.NaN)).toBe("00m00s");
  });
});

describe("sanitizeLabel", () => {
  it("keeps file-name-safe characters and collapses the rest", () => {
    expect(sanitizeLabel("chorus 2")).toBe("chorus_2");
    expect(sanitizeLabel("  the/final cut!! ")).toBe("the_final_cut");
    expect(sanitizeLabel("take-3.b")).toBe("take-3.b");
  });

  it("drops leading and trailing separators (a leading dot hides a file)", () => {
    expect(sanitizeLabel(".hidden")).toBe("hidden");
    expect(sanitizeLabel("__x--")).toBe("x");
    expect(sanitizeLabel("___")).toBe("");
  });

  it("caps the length, and never ends on a separator after the cut", () => {
    expect(sanitizeLabel("x".repeat(100))).toHaveLength(64);
    expect(sanitizeLabel(`${"a".repeat(9)}_bbb`, 10)).toBe("a".repeat(9));
  });
});

describe("labels", () => {
  it("pick the take's name, then the prefix, then the video's name", () => {
    expect(labelBase(["chorus 2", "live", "rehearsal"])).toBe("chorus_2");
    expect(labelBase([undefined, "live", "rehearsal"])).toBe("live");
    expect(labelBase(["", "", "rehearsal"])).toBe("rehearsal");
    expect(labelBase(["!!!", undefined, "???"])).toBe(FALLBACK_BASE);
    expect(labelBase(["y".repeat(200)])).toHaveLength(LABEL_BASE_MAX);
  });

  it("always carry the source timestamps, however long the name", () => {
    expect(takeLabel("chorus_2", 82_000, 97_400)).toBe("chorus_2_01m22s-01m37s");
    const long = takeLabel(labelBase(["z".repeat(300)]), 3_725_000, 3_740_000);
    expect(long.endsWith("_1h02m05s-1h02m20s")).toBe(true);
  });
});

describe("rangeStepName", () => {
  it("numbers positionally from 01 and keeps the label", () => {
    expect(rangeStepName(0, "live_00m10s-00m20s")).toBe("take_01_live_00m10s-00m20s");
    expect(rangeStepName(9, "a")).toBe("take_10_a");
    expect(rangeStepName(99, "a")).toBe("take_100_a");
  });
});

describe("size rules", () => {
  it("even-rounds", () => {
    expect(evenRound(1)).toBe(2);
    expect(evenRound(1281)).toBe(1282);
    expect(scaleToMaxWidth(1281, 719)).toEqual({ width: 1282, height: 720 });
  });

  it("caps the width with the aspect kept, and never upscales", () => {
    expect(scaleToMaxWidth(3840, 2160, 1920)).toEqual({ width: 1920, height: 1080 });
    expect(scaleToMaxWidth(640, 360, 1280)).toEqual({ width: 640, height: 360 });
  });

  it("never goes over an odd cap: the cap rounds down to even", () => {
    expect(scaleToMaxWidth(1920, 1080, 1279)).toEqual({ width: 1278, height: 718 });
    // An odd video right at an odd cap would even-round 1 px over it.
    expect(scaleToMaxWidth(1281, 721, 1281)).toEqual({ width: 1280, height: 720 });
    // Under an even cap, even-rounding up still fits.
    expect(scaleToMaxWidth(1281, 719, 1282)).toEqual({ width: 1282, height: 720 });
    expect(takeSize({ width: 3840, height: 2160 }, "source", 129)).toEqual({ width: 128, height: 72 });
  });

  it("as filmed keeps the video's size; vertical is always 1080x1920", () => {
    expect(takeSize({ width: 1920, height: 1080 }, "source")).toEqual({ width: 1920, height: 1080 });
    expect(takeSize({ width: 3840, height: 2160 }, "source", 1280)).toEqual({ width: 1280, height: 720 });
    expect(takeSize({ width: 3840, height: 2160 }, "vertical", 1280)).toEqual(VERTICAL_SIZE);
    expect(takeSize({ width: 720, height: 1280 }, "vertical")).toEqual(VERTICAL_SIZE);
  });
});

describe("focus rules", () => {
  it("crops sideways (focusX) when the video is wider than 9:16", () => {
    expect(coverFocus({ width: 1920, height: 1080 }, "vertical", 0.2)).toEqual({ focusX: 0.2 });
    expect(coverFocus({ width: 1080, height: 1080 }, "vertical", 1)).toEqual({ focusX: 1 });
  });

  it("crops up and down (focusY) when the video is 9:16 or taller", () => {
    expect(coverFocus({ width: 1080, height: 1920 }, "vertical", 0.3)).toEqual({ focusY: 0.3 });
    expect(coverFocus({ width: 1080, height: 2400 }, "vertical", 0)).toEqual({ focusY: 0 });
  });

  it("clamps the framing, and has no focus as filmed", () => {
    expect(coverFocus({ width: 1920, height: 1080 }, "vertical", 7)).toEqual({ focusX: 1 });
    expect(coverFocus({ width: 1920, height: 1080 }, "vertical", Number.NaN)).toEqual({ focusX: 0.5 });
    expect(coverFocus({ width: 1920, height: 1080 }, "source", 0.2)).toEqual({});
  });
});

describe("shortName", () => {
  it("cuts long names for a card line", () => {
    expect(shortName("short")).toBe("short");
    expect(shortName("n".repeat(40), 10)).toBe("nnnnnnn...");
  });
});
