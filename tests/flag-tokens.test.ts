import { describe, it, expect } from "vitest";
import { getCircleFlagUrl, getCircleFlagFallbackUrl } from "../src/platform/flags/flag-tokens";

describe("flag token urls", () => {
  it("resolves checkered to circle-flags other path", () => {
    expect(getCircleFlagUrl("checkered")).toBe(
      "https://hatscripts.github.io/circle-flags/flags/other/checkered.svg",
    );
  });

  it("uses chequered fallback for checkered special code", () => {
    expect(getCircleFlagFallbackUrl("checkered")).toBe(
      "https://hatscripts.github.io/circle-flags/flags/other/chequered.svg",
    );
  });
});
