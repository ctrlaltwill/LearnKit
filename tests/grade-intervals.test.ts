import { describe, it, expect } from "vitest";
import { formatCompactInterval } from "../src/platform/core/grade-intervals";

describe("formatCompactInterval", () => {
  it("formats compact English intervals by default", () => {
    expect(formatCompactInterval(10 * 60_000)).toBe("10m");
    expect(formatCompactInterval(24 * 60 * 60_000)).toBe("1d");
  });

  it("formats compact Chinese intervals for zh locales", () => {
    expect(formatCompactInterval(10 * 60_000, "zh-cn")).toBe("10分");
    expect(formatCompactInterval(24 * 60 * 60_000, "zh-cn")).toBe("1天");
  });

  it("formats sub-minute and yearly ranges in Chinese", () => {
    expect(formatCompactInterval(0, "zh-cn")).toBe("<1分");
    expect(formatCompactInterval(370 * 24 * 60 * 60_000, "zh-cn")).toBe("1年");
  });
});
