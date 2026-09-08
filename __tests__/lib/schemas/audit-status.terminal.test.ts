import { ACCESS_DENIED_CUSTOMER_MESSAGE } from "@/lib/browserless";
import { getProgressInfo, isTerminalState } from "@/lib/schemas/audit-status";

describe("terminal status helpers", () => {
  it("treats unsupported as terminal with dedicated progress copy", () => {
    expect(isTerminalState("unsupported")).toBe(true);
    expect(getProgressInfo("unsupported")).toEqual({
      percentage: 100,
      currentStep: "This website type is not supported",
      estimatedTimeRemaining: undefined,
    });
  });

  it("uses the access-denied copy for 401/403 unsupported, not the URL-safety copy", () => {
    expect(
      getProgressInfo("unsupported", {
        failureType: "NON_2XX_STATUS",
        httpStatus: 403,
      }),
    ).toEqual({
      percentage: 100,
      currentStep: ACCESS_DENIED_CUSTOMER_MESSAGE,
      estimatedTimeRemaining: undefined,
    });
    expect(
      getProgressInfo("unsupported", {
        failureType: "NON_2XX_STATUS",
        httpStatus: 401,
      }).currentStep,
    ).toBe(ACCESS_DENIED_CUSTOMER_MESSAGE);
    expect(
      getProgressInfo("unsupported", {
        failureType: "NON_2XX_STATUS",
        httpStatus: 500,
      }).currentStep,
    ).toBe("This website type is not supported");
    expect(ACCESS_DENIED_CUSTOMER_MESSAGE).not.toMatch(/401|403|CAPTCHA|WAF|bot/i);
    expect(ACCESS_DENIED_CUSTOMER_MESSAGE).not.toBe(
      "This website type is not supported",
    );
  });
});
