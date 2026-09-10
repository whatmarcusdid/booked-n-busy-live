import { isAiNarrationEnabled, isRealScanEnabled } from "@/lib/flags";

describe("isRealScanEnabled", () => {
  it("defaults off when unset", () => {
    expect(isRealScanEnabled(undefined)).toBe(false);
  });

  it("is off for any value other than true", () => {
    expect(isRealScanEnabled("false")).toBe(false);
    expect(isRealScanEnabled("1")).toBe(false);
    expect(isRealScanEnabled("TRUE")).toBe(false);
  });

  it("is on only for the string true", () => {
    expect(isRealScanEnabled("true")).toBe(true);
  });
});

describe("isAiNarrationEnabled", () => {
  it("defaults off when unset", () => {
    expect(isAiNarrationEnabled(undefined)).toBe(false);
  });

  it("is on only for the string true", () => {
    expect(isAiNarrationEnabled("true")).toBe(true);
    expect(isAiNarrationEnabled("false")).toBe(false);
  });
});
