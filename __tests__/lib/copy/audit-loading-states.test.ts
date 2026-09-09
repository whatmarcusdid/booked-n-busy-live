import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DID_YOU_KNOW_FACTS,
  HEADLINES,
  PROGRESS_STAGES,
  resolveLoadingView,
  resolveStages,
  SLOW_AUDIT_THRESHOLD_MS,
  WAIT_CARD,
} from "@/lib/copy/audit-progress";
import { SLOW_AUDIT_MESSAGE } from "@/lib/copy/timing";
import { AUDIT_WALL_CLOCK_CEILING_MS } from "@/lib/audit-workflow/budget";

const MINUTE = 60_000;
const POLLER = join(
  process.cwd(),
  "app/audit/status/[token]/status-poller.tsx",
);
const PAGE = join(process.cwd(), "app/audit/status/[token]/page.tsx");
const SCREEN = join(
  process.cwd(),
  "app/audit/status/[token]/loading-screen.tsx",
);
const PROGRESS_MODULE = join(process.cwd(), "lib/copy/audit-progress.ts");

/** The processing states the loading screen owns. */
const PROCESSING_STATES = [
  "submitted",
  "validating",
  "discovering",
  "rendering",
  "collecting_signals",
  "scoring",
  "generating_report",
  "validating_report",
];

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

describe("three states, resolved from status alone", () => {
  it("shows Normal below the threshold", () => {
    const view = resolveLoadingView({ status: "discovering", elapsedMs: 0 });
    expect(view?.state).toBe("normal");
    expect(view?.headline).toBe(HEADLINES.normal);
    expect(view?.statusLine.emphasis).toBe("2 mins");
    expect(view?.waitCard).toBeNull();
    expect(view?.keepPolling).toBe(true);
  });

  it("shows Slower Than Usual at exactly 90 seconds", () => {
    const just_under = resolveLoadingView({
      status: "collecting_signals",
      elapsedMs: SLOW_AUDIT_THRESHOLD_MS - 1,
    });
    const at = resolveLoadingView({
      status: "collecting_signals",
      elapsedMs: SLOW_AUDIT_THRESHOLD_MS,
    });

    expect(SLOW_AUDIT_THRESHOLD_MS).toBe(90_000);
    expect(just_under?.state).toBe("normal");
    expect(at?.state).toBe("slow");
    expect(at?.headline).toBe(HEADLINES.slow);
    expect(at?.waitCard).toEqual(WAIT_CARD);
  });

  it("uses the locked slow-audit sentence verbatim and unsplit", () => {
    const view = resolveLoadingView({
      status: "scoring",
      elapsedMs: SLOW_AUDIT_THRESHOLD_MS,
    });
    expect(view?.statusLine.lead).toBe(SLOW_AUDIT_MESSAGE);
    expect(view?.statusLine.emphasis).toBeUndefined();
    expect(SLOW_AUDIT_MESSAGE).toBe(
      "This one's taking a bit longer than usual.",
    );
  });

  it("promises email delivery once in the slow state, not twice", () => {
    // The sentence and the wait card sat directly above one another and both
    // promised the email. The card owns that promise; the sentence reports
    // only that the audit is slow.
    const view = resolveLoadingView({
      status: "scoring",
      elapsedMs: SLOW_AUDIT_THRESHOLD_MS,
    });

    const onScreen = [
      view?.headline ?? "",
      view?.statusLine.lead ?? "",
      view?.statusLine.emphasis ?? "",
      view?.waitCard?.heading ?? "",
      view?.waitCard?.body ?? "",
    ].join(" ");

    expect(onScreen.match(/we\u2019ll email|we'll email/gi)).toHaveLength(1);
    expect(view?.statusLine.lead).not.toMatch(/email/i);
    expect(view?.waitCard?.body).toMatch(/email/i);
  });

  it("keeps polling in the slow state so a late finish still reaches results", () => {
    const view = resolveLoadingView({
      status: "collecting_signals",
      elapsedMs: 8 * MINUTE,
    });
    expect(view?.state).toBe("slow");
    expect(view?.keepPolling).toBe(true);
  });

  it("owns no terminal state other than needs_review", () => {
    for (const status of ["complete", "partial", "failed", "unsupported"]) {
      expect(resolveLoadingView({ status, elapsedMs: 0 })).toBeNull();
    }
  });
});

describe("Needs Review has no time-based trigger", () => {
  it("shows State C for a needs_review audit at any elapsed time", () => {
    // Including zero: a fast audit whose findings need review is still
    // State C, which a time-driven implementation could never produce.
    for (const elapsedMs of [
      0,
      1_000,
      SLOW_AUDIT_THRESHOLD_MS - 1,
      SLOW_AUDIT_THRESHOLD_MS,
      5 * MINUTE,
      AUDIT_WALL_CLOCK_CEILING_MS,
    ]) {
      const view = resolveLoadingView({ status: "needs_review", elapsedMs });
      expect(view?.state).toBe("needs_review");
      expect(view?.headline).toBe(HEADLINES.needs_review);
      expect(view?.statusLine.emphasis).toBe("additional review…");
    }
  });

  it("never reaches State C on elapsed time alone, however long it runs", () => {
    // The old Figma frame was labelled "more than 5 mins", so five minutes
    // and beyond are checked explicitly.
    for (const status of PROCESSING_STATES) {
      for (const minutes of [5, 6, 10, 14, 30, 120]) {
        const view = resolveLoadingView({
          status,
          elapsedMs: minutes * MINUTE,
        });
        expect(view?.state).toBe("slow");
        expect(view?.state).not.toBe("needs_review");
      }
    }
  });

  it("has exactly two thresholds in the system, neither tied to review", () => {
    // 90 seconds is presentational; 15 minutes is the kill switch. A third
    // time constant appearing in this module would be the regression.
    const source = stripComments(readFileSync(PROGRESS_MODULE, "utf8"));
    const durations = source.match(/\b\d[\d_]{2,}\b/g) ?? [];
    expect(durations).toEqual([]);
    expect(AUDIT_WALL_CLOCK_CEILING_MS).toBe(15 * MINUTE);
  });

  it("claims nothing is running while waiting for review", () => {
    const view = resolveLoadingView({ status: "needs_review", elapsedMs: 0 });
    expect(view?.stages.some((s) => s.progress === "active")).toBe(false);
    expect(view?.keepPolling).toBe(false);
  });
});

describe("progress stages reflect real workflow state", () => {
  it("carries the five PRD stages in order", () => {
    expect(PROGRESS_STAGES.map((s) => s.label)).toEqual([
      "Confirming your website is reachable.",
      "Reviewing trust and credibility signals.",
      "Checking how customers can call or request a quote.",
      "Checking speed, security, and growth foundations.",
      "Preparing your scorecard.",
    ]);
  });

  it("advances the active stage as the workflow advances", () => {
    const activeFor = (input: Parameters<typeof resolveStages>[0]) =>
      resolveStages(input)
        .filter((s) => s.progress === "active")
        .map((s) => s.key);

    expect(activeFor({ status: "validating", anyActive: true })).toEqual([
      "reachable",
    ]);

    // Capture is the long wait, but it is still "is the site reachable".
    // Pillar-named stages wait for the checks those pillars actually own.
    expect(
      activeFor({
        status: "rendering",
        anyActive: true,
        captureMilestone: null,
      }),
    ).toEqual(["reachable"]);
    expect(
      activeFor({
        status: "rendering",
        anyActive: true,
        captureMilestone: "capture_pages",
      }),
    ).toEqual(["reachable"]);

    // Once checks are running, the active pillar group picks the stage.
    expect(
      activeFor({
        status: "scoring",
        anyActive: true,
        activeGroup: "trust_signals",
      }),
    ).toEqual(["trust"]);
    expect(
      activeFor({
        status: "scoring",
        anyActive: true,
        activeGroup: "lead_conversion",
      }),
    ).toEqual(["contact"]);
    expect(
      activeFor({
        status: "scoring",
        anyActive: true,
        activeGroup: "growth_infrastructure",
      }),
    ).toEqual(["foundations"]);

    // Explicitly null means every group returned: only the scorecard is left.
    expect(
      activeFor({ status: "scoring", anyActive: true, activeGroup: null }),
    ).toEqual(["scorecard"]);

    expect(
      activeFor({ status: "generating_report", anyActive: true }),
    ).toEqual(["scorecard"]);
  });

  it("marks earlier stages done and later ones pending, never the reverse", () => {
    const stages = resolveStages({
      status: "scoring",
      anyActive: true,
      activeGroup: "lead_conversion",
    });
    expect(stages.map((s) => s.progress)).toEqual([
      "done",
      "done",
      "active",
      "pending",
      "pending",
    ]);
  });

  it("widens rather than guesses when a signal state carries no group data", () => {
    // Absent signals are not evidence that trust is the running pillar. The
    // pre-existing three-wide claim is the honest fallback.
    const stages = resolveStages({
      status: "collecting_signals",
      anyActive: true,
    });
    expect(
      stages.filter((s) => s.progress === "active").map((s) => s.key),
    ).toEqual(["trust", "contact", "foundations"]);
  });

  it("presents exactly one stage as running per processing state", () => {
    for (const status of PROCESSING_STATES) {
      const view = resolveLoadingView({ status, elapsedMs: 0 });
      const active = view!.stages.filter((s) => s.progress === "active");
      expect(active.length).toBeGreaterThan(0);
      // Never a pending stage before an active one.
      const keys = view!.stages.map((s) => s.progress);
      expect(keys.indexOf("pending")).toBeLessThanOrEqual(
        keys.lastIndexOf("active") === -1 ? Infinity : keys.length,
      );
      expect(keys.slice(0, keys.indexOf("active"))).not.toContain("pending");
    }
  });
});

describe("the 90-second transition changes only what is displayed", () => {
  it("is decided by a resolver with no means to mutate anything", () => {
    const source = stripComments(readFileSync(PROGRESS_MODULE, "utf8"));
    for (const forbidden of [
      "fetch(",
      "recordTransition",
      "requestReportEmail",
      "setTimeout",
      "setInterval",
      "Date.now",
      "store",
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });

  it("reads elapsed time from the server, never from a client clock", () => {
    // A client clock would restart on reload and let a refresh reset the
    // message; the server's elapsedMs is measured from execution start.
    const poller = stripComments(readFileSync(POLLER, "utf8"));
    expect(poller).toContain("json.elapsedMs");
    expect(poller).not.toContain("Date.now");
    expect(poller).not.toContain("performance.now");
  });

  it("polls read-only, with no mutating request anywhere on the screen", () => {
    const poller = stripComments(readFileSync(POLLER, "utf8"));
    const page = stripComments(readFileSync(PAGE, "utf8"));

    // The screen's entire network surface: one GET of the status endpoint.
    const calls = [...poller.matchAll(/fetch\(([^)]*)\)/g)].map((m) => m[1]);
    expect(calls).toEqual(["`/api/v1/audit-status/${token}`"]);

    for (const source of [poller, page, stripComments(readFileSync(SCREEN, "utf8"))]) {
      // No request options at all, so no method, body, or header can be set.
      expect(source).not.toContain("method:");
      // Every audit-mutating route lives under /api/v1/audits/.
      expect(source).not.toContain("/api/v1/audits");
    }
  });

  it("offers no control that implies the audit can be stopped", () => {
    // Cancel navigated home while the scan kept running and the report was
    // still emailed. Nothing on this screen can stop an audit, so nothing on
    // it may look like it can.
    const page = stripComments(readFileSync(PAGE, "utf8"));
    const cancel = page.match(/<(\w+)[^>]*audit-loading-cancel[^>]*>/);

    expect(cancel).not.toBeNull();
    // A disabled button, not a link: an anchor cannot be inert.
    expect(cancel![1]).toBe("button");
    expect(cancel![0]).toContain("disabled");
    expect(cancel![0]).not.toContain("href");

    const css = readFileSync(
      join(process.cwd(), "app/audit/status/[token]/audit-loading.css"),
      "utf8",
    );
    expect(css).toContain(".audit-loading-cancel:disabled");
  });

  it("resumes from server-resolved status on first paint", () => {
    // Rendering a neutral shell and letting the client decide would flash
    // the Normal state to an audit already in Needs Review.
    const page = stripComments(readFileSync(PAGE, "utf8"));
    expect(page).toContain("getAuditStatus");
    expect(page).toContain("initial={initial}");
  });
});

describe("all three states render at all three breakpoints", () => {
  const css = readFileSync(
    join(process.cwd(), "app/audit/status/[token]/audit-loading.css"),
    "utf8",
  );

  it("defines a tablet and a mobile breakpoint over a desktop default", () => {
    expect(css).toContain("@media (min-width: 768px) and (max-width: 1023px)");
    expect(css).toContain("@media (max-width: 767px)");
    // Figma H1/H2 per breakpoint: 36/28 desktop, 32/26 tablet, 30/24 mobile.
    expect(css).toContain("--al-h1: 36px");
    expect(css).toContain("--al-h1: 32px");
    expect(css).toContain("--al-h1: 30px");
  });

  it("styles every state-specific element the states can produce", () => {
    // Slow and review both add the wait card; only its tone differs.
    expect(css).toContain(".audit-loading-wait");
    expect(css).toContain(".audit-loading-status.is-slow");
    expect(css).toContain(".audit-loading-status.is-review");
    for (const progress of ["done", "active", "pending"]) {
      expect(css).toContain(`data-progress="${progress}"`);
    }
  });

  it("ships every asset the three states reference", () => {
    const markup = [POLLER, PAGE, SCREEN]
      .map((file) => readFileSync(file, "utf8"))
      .join("\n");
    const referenced = [
      ...markup.matchAll(/\/audit\/[a-z0-9-]+\.(svg|png)/g),
    ].map((m) => m[0]);

    expect(referenced.length).toBeGreaterThan(0);
    for (const asset of new Set(referenced)) {
      expect(() =>
        readFileSync(join(process.cwd(), "public", asset)),
      ).not.toThrow();
    }
    // One hourglass per state, so a state cannot silently borrow another's.
    for (const tone of ["normal", "slow", "review"]) {
      expect(referenced).toContain(`/audit/hourglass-${tone}.svg`);
    }
  });

  it("renders three facts so mobile and tablet match their frames", () => {
    expect(DID_YOU_KNOW_FACTS).toHaveLength(3);
    // Desktop's frame shows two, so the third is hidden there rather than
    // being a separate component.
    expect(css).toContain("@media (min-width: 1024px)");
    expect(css).toContain(".audit-loading-fact:nth-child(3)");
  });
});
