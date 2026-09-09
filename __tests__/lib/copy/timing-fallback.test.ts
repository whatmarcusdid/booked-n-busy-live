import { readFileSync } from "fs";
import { ANALYTICS_EVENTS } from "@/lib/analytics/events";
import {
  resolveTimingView,
  SLOW_AUDIT_MESSAGE,
  SLOW_AUDIT_THRESHOLD_MS,
  TIMING_PROMISE,
} from "@/lib/copy/timing";
import { getProgressInfo } from "@/lib/schemas/audit-status";

const fresh = {
  fallbackAlreadyShown: false,
  completionAlreadyReported: false,
};

describe("locked timing copy", () => {
  it("uses the approved promise and fallback wording", () => {
    expect(TIMING_PROMISE).toBe("Most audits complete in under 2 minutes.");
    expect(SLOW_AUDIT_MESSAGE).toBe(
      "This one's taking a bit longer than usual — we'll email your report as soon as it's ready.",
    );
    expect(SLOW_AUDIT_THRESHOLD_MS).toBe(90_000);
  });

  it("no longer advertises a multi-minute estimate per stage", () => {
    // These stages previously promised "5-7 minutes" down to "1 minute",
    // which contradicted the locked promise.
    for (const status of [
      "submitted",
      "validating",
      "discovering",
      "rendering",
      "collecting_signals",
      "scoring",
      "generating_report",
      "validating_report",
    ]) {
      const progress = getProgressInfo(status);
      expect(JSON.stringify(progress)).not.toMatch(/minute/i);
      expect(progress).not.toHaveProperty("estimatedTimeRemaining");
    }
  });

  it("has no stale duration copy left in customer-facing pages", () => {
    const surfaces = [
      "app/page.tsx",
      "app/intake-form.tsx",
      "app/audit/status/[token]/page.tsx",
      "app/audit/status/[token]/status-poller.tsx",
      "lib/schemas/audit-status.ts",
    ];
    for (const path of surfaces) {
      // Comments stripped: the guarantee is about copy the customer reads,
      // and a comment explaining why the old estimates were removed has to
      // be allowed to name them.
      const source = readFileSync(path, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
      expect(source).not.toMatch(/2-10 minutes/i);
      expect(source).not.toMatch(/up to 10 minutes/i);
      expect(source).not.toMatch(/60 seconds/i);
      expect(source).not.toMatch(/\d+-\d+ minutes/i);
    }
  });
});

describe("90-second fallback transition", () => {
  it("shows the normal promise before the threshold", () => {
    const view = resolveTimingView({
      status: "rendering",
      elapsedMs: SLOW_AUDIT_THRESHOLD_MS - 1,
      ...fresh,
    });
    expect(view.message).toBe(TIMING_PROMISE);
    expect(view.showFallback).toBe(false);
    expect(view.event).toBeNull();
  });

  it("switches to the fallback message at exactly 90 seconds", () => {
    const view = resolveTimingView({
      status: "rendering",
      elapsedMs: SLOW_AUDIT_THRESHOLD_MS,
      ...fresh,
    });
    expect(view.message).toBe(SLOW_AUDIT_MESSAGE);
    expect(view.showFallback).toBe(true);
    expect(view.event).toBe(ANALYTICS_EVENTS.auditTimingFallbackShown);
  });

  it("keeps polling after the fallback, so the session still reaches results", () => {
    const view = resolveTimingView({
      status: "scoring",
      elapsedMs: 10 * 60 * 1000,
      ...fresh,
    });
    expect(view.showFallback).toBe(true);
    // The whole point: the fallback does not end the live session.
    expect(view.keepPolling).toBe(true);
  });

  it("records the fallback event once, not on every poll", () => {
    const first = resolveTimingView({
      status: "rendering",
      elapsedMs: SLOW_AUDIT_THRESHOLD_MS,
      ...fresh,
    });
    expect(first.event).toBe(ANALYTICS_EVENTS.auditTimingFallbackShown);

    const second = resolveTimingView({
      status: "rendering",
      elapsedMs: SLOW_AUDIT_THRESHOLD_MS + 3000,
      fallbackAlreadyShown: true,
      completionAlreadyReported: false,
    });
    expect(second.event).toBeNull();
    expect(second.showFallback).toBe(true);
  });
});

describe("completion analytics distinguishes the timing cases", () => {
  it("reports completion before the fallback", () => {
    const view = resolveTimingView({
      status: "complete",
      elapsedMs: 40_000,
      ...fresh,
    });
    expect(view.event).toBe(ANALYTICS_EVENTS.auditCompletedBeforeFallback);
    expect(view.keepPolling).toBe(false);
    expect(view.message).toBeNull();
  });

  it("reports completion after the fallback was shown", () => {
    const view = resolveTimingView({
      status: "complete",
      elapsedMs: 200_000,
      fallbackAlreadyShown: true,
      completionAlreadyReported: false,
    });
    expect(view.event).toBe(ANALYTICS_EVENTS.auditCompletedAfterFallback);
    expect(view.keepPolling).toBe(false);
  });

  it("does not repeat the completion event", () => {
    const view = resolveTimingView({
      status: "complete",
      elapsedMs: 200_000,
      fallbackAlreadyShown: true,
      completionAlreadyReported: true,
    });
    expect(view.event).toBeNull();
  });

  it("covers all four required timing outcomes", () => {
    // The kill-switch case is recorded server-side by the budget, since a
    // killed audit's live session may already be gone.
    expect(Object.values(ANALYTICS_EVENTS)).toEqual(
      expect.arrayContaining([
        ANALYTICS_EVENTS.auditCompletedBeforeFallback,
        ANALYTICS_EVENTS.auditTimingFallbackShown,
        ANALYTICS_EVENTS.auditCompletedAfterFallback,
        ANALYTICS_EVENTS.auditTerminatedByKillSwitch,
      ]),
    );
  });
});

describe("the fallback cannot affect the audit", () => {
  it("is decided by a pure function with no way to mutate anything", () => {
    // `resolveTimingView` receives only a status snapshot and returns only a
    // message and an event name. It is handed no store, no fetch, and no
    // audit id, so it structurally cannot change state or send an email.
    const source = readFileSync("lib/copy/timing.ts", "utf8");
    const withoutComments = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    for (const forbidden of [
      "fetch(",
      "recordTransition",
      "recordEvent",
      "requestReportEmail",
      "abort",
      "cancel",
    ]) {
      expect(withoutComments).not.toContain(forbidden);
    }
  });

  it("does not send anything from the live session past the threshold", () => {
    const poller = readFileSync(
      "app/audit/status/[token]/status-poller.tsx",
      "utf8",
    );
    // The only request the poller makes is the read-only status poll.
    const requests = poller.match(/fetch\(`[^`]*`/g) ?? [];
    expect(requests).toEqual(["fetch(`/api/v1/audit-status/${token}`"]);
    expect(poller).not.toContain("method:");
    // Every audit-mutating route, the email request among them, lives under
    // /api/v1/audits/. Matching on the route prefix rather than the word
    // "email" keeps this from tripping over an icon named after one.
    expect(poller).not.toContain("/api/v1/audits");
  });
});
