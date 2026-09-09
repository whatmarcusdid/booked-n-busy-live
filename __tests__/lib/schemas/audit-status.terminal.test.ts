import { ACCESS_DENIED_CUSTOMER_MESSAGE } from "@/lib/browserless";
import {
  getProgressInfo,
  isTerminalState,
  TERMINAL_AUDIT_STATES,
} from "@/lib/schemas/audit-status";
import { WORKFLOW_TERMINAL_STATES } from "@/lib/audit-workflow/types";

describe("terminal audit states agree across the codebase", () => {
  it("covers the same five states the workflow can terminate in", () => {
    expect([...TERMINAL_AUDIT_STATES].sort()).toEqual(
      [...WORKFLOW_TERMINAL_STATES].sort(),
    );
  });

  it.each(WORKFLOW_TERMINAL_STATES)(
    "%s is terminal and reports 100%% progress",
    (state) => {
      expect(isTerminalState(state)).toBe(true);
      const progress = getProgressInfo(state);
      expect(progress.percentage).toBe(100);
      expect(progress.currentStep).toBeTruthy();
    },
  );

  it.each([
    "submitted",
    "validating",
    "discovering",
    "rendering",
    "collecting_signals",
    "scoring",
    "generating_report",
    "validating_report",
  ])("%s is not terminal", (state) => {
    expect(isTerminalState(state)).toBe(false);
  });
});

describe("terminal status helpers", () => {
  it("treats unsupported as terminal with dedicated progress copy", () => {
    expect(isTerminalState("unsupported")).toBe(true);
    expect(getProgressInfo("unsupported")).toEqual({
      percentage: 100,
      currentStep: "This website type is not supported",
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
