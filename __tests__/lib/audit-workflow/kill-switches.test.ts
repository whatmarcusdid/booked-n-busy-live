import { readFileSync } from "fs";
import {
  AUDIT_COST_CEILING_USD,
  AUDIT_WALL_CLOCK_CEILING_MS,
  aiNarrationCostUsd,
  CONFIGURED_UNIT_COSTS_USD,
  COST_CEILING_REASON_CODE,
  createAuditBudget,
  KILL_SWITCH_EVENT,
  WALL_CLOCK_CEILING_REASON_CODE,
  type AuditBudget,
} from "@/lib/audit-workflow/budget";
import { hashEmail, hmacSha256 } from "@/lib/crypto";
import {
  createMemoryEmailStore,
  requestReportEmail,
} from "@/lib/email/service";
import type { TransactionalEmailProvider } from "@/lib/email/provider";
import { runAuditPipeline } from "@/lib/audit-workflow/pipeline";
import { createMemoryAuditStore } from "@/lib/audit-workflow/store";
import type { FetchRenderedPage } from "@/lib/browserless";
import type { FetchRobotsTxt } from "@/lib/crawler/robots";
import type { ArtifactStorage } from "@/lib/storage/audit-artifacts";

const HOME = "https://acmeplumbing.com";
const PUBLIC_IP = "93.184.216.34";
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const HOME_HTML = `<!doctype html><html><head><title>Acme Plumbing</title>
<meta name="description" content="Licensed and insured plumbing across the metro area, 24/7."></head>
<body>
<a href="tel:+15125550100">(512) 555-0100</a>
<a href="/about">About Us</a>
<a href="/services">Services</a>
<a href="/contact">Contact</a>
</body></html>`;

const PAGE_HTML = `<!doctype html><html><head><title>Page</title>
<meta name="description" content="A page on the site."></head><body><p>Hi</p></body></html>`;

const allowAll: FetchRobotsTxt = async () => ({
  ok: true,
  body: "User-agent: *\nAllow: /",
  httpStatus: 200,
});

function seedStore(auditId: string) {
  return createMemoryAuditStore([
    { id: auditId, website_url: HOME, current_state: "submitted" },
  ]);
}

function memoryStorage(): ArtifactStorage {
  return { async upload() { return { ok: true }; } };
}

/**
 * A healthy site that serves everything. Counts calls so a test can prove
 * that paid work actually stopped rather than merely that the audit failed.
 */
function countingFetch(onCall?: () => void): {
  fetch: FetchRenderedPage;
  calls: () => number;
} {
  let calls = 0;
  const fetch: FetchRenderedPage = async ({ url }) => {
    calls += 1;
    onCall?.();
    const path = new URL(url).pathname;
    const html = path === "/" || path === "" ? HOME_HTML : PAGE_HTML;
    return { ok: true, html, status: 200, finalUrl: url, redirected: false };
  };
  return { fetch, calls: () => calls };
}

async function run(input: {
  auditId: string;
  fetchHomePage: FetchRenderedPage;
  budget?: AuditBudget;
  store?: ReturnType<typeof seedStore>;
  onScreenshot?: () => void;
}) {
  const store = input.store ?? seedStore(input.auditId);
  const result = await runAuditPipeline({
    auditId: input.auditId,
    websiteUrl: HOME,
    store,
    delayMs: 0,
    realScanEnabled: true,
    budget: input.budget,
    fetchHomePage: input.fetchHomePage,
    fetchRobots: allowAll,
    fetchPerformance: async () => ({
      ok: true,
      metrics: { score: 0.95, lcpMs: 1500, tbtMs: 100, cls: 0.02 },
    }),
    captureScreenshot: async ({ url }) => {
      input.onScreenshot?.();
      return {
        ok: true,
        bytes: PNG,
        mimeType: "image/png",
        finalUrl: url,
        redirected: false,
      };
    },
    artifactStorage: memoryStorage(),
    safetyDeps: { lookup: async () => [PUBLIC_IP] },
  });

  const kill = store.events.find(
    (row) => row.event_type === KILL_SWITCH_EVENT,
  );
  return { store, result, kill: kill?.event_data };
}

describe("locked ceilings", () => {
  it("uses the decision's $1.00 and 15-minute limits", () => {
    expect(AUDIT_COST_CEILING_USD).toBe(1.0);
    expect(AUDIT_WALL_CLOCK_CEILING_MS).toBe(15 * 60 * 1000);
  });
});

describe("cost kill switch, in isolation", () => {
  it("terminates a runaway audit at $1.00 and does no paid work at all", async () => {
    const auditId = "audit-cost-ceiling";
    const store = seedStore(auditId);
    // Simulates an execution that already burned the ceiling — e.g. a stage
    // that looped over paid fetches before this attempt resumed.
    await store.chargeAuditCost(auditId, {
      operation_key: "runaway-loop",
      category: "browserless_content",
      quantity: 100,
      amount_usd: AUDIT_COST_CEILING_USD,
      pricing_source: "configured_estimate",
    });

    const counting = countingFetch();
    let screenshots = 0;
    const { result, kill } = await run({
      auditId,
      store,
      fetchHomePage: counting.fetch,
      onScreenshot: () => {
        screenshots += 1;
      },
    });

    expect(result).toBe("failed");
    expect(kill?.reason_code).toBe(COST_CEILING_REASON_CODE);
    expect(counting.calls()).toBe(0);
    expect(screenshots).toBe(0);
  });

  it("stops a looping stage partway once its charges cross the ceiling", async () => {
    const auditId = "audit-cost-midflight";
    const store = seedStore(auditId);
    // Just under the ceiling: the next charge crosses it, so exactly one more
    // paid fetch is allowed and everything after it is refused.
    await store.chargeAuditCost(auditId, {
      operation_key: "prior-spend",
      category: "browserless_content",
      quantity: 99,
      amount_usd: 0.995,
      pricing_source: "configured_estimate",
    });

    const counting = countingFetch();
    const { result, kill } = await run({
      auditId,
      store,
      fetchHomePage: counting.fetch,
    });

    expect(result).toBe("failed");
    expect(kill?.reason_code).toBe(COST_CEILING_REASON_CODE);
    // The homepage fetch was affordable; the ones after it were not. Without
    // the ceiling this site would have been fetched four times.
    expect(counting.calls()).toBe(1);
  });

  it("charges every category of paid work to the audit", async () => {
    const auditId = "audit-cost-attribution";
    const counting = countingFetch();
    const { store, result } = await run({
      auditId,
      fetchHomePage: counting.fetch,
    });

    expect(result).toBe("complete");
    const categories = new Set(
      store.costEntries
        .filter((row) => row.auditId === auditId)
        .map((row) => row.category),
    );
    expect(categories).toContain("browserless_content");
    expect(categories).toContain("browserless_screenshot");
    expect(categories).toContain("browserless_performance");
    expect(categories).toContain("storage_upload");

    const total = await store.getAuditCostTotal(auditId);
    expect(total).toBeGreaterThan(0);
    expect(total).toBeLessThan(AUDIT_COST_CEILING_USD);
  });

  it("records the audit's cost and elapsed time for observability", async () => {
    const auditId = "audit-telemetry";
    const counting = countingFetch();
    const { store } = await run({ auditId, fetchHomePage: counting.fetch });

    const telemetry = store.telemetry.get(auditId);
    expect(telemetry?.cost_usd).toBeGreaterThan(0);
    expect(telemetry?.elapsed_ms).toBeGreaterThanOrEqual(0);
  });
});

describe("wall-clock kill switch, in isolation", () => {
  it("terminates at 15 minutes even with zero cost accrued", async () => {
    const auditId = "audit-time-ceiling";
    const store = seedStore(auditId);
    // Frozen past the deadline. Nothing has been spent, so only the time
    // ceiling can catch this — proving the two switches are independent.
    const budget = createAuditBudget({
      store,
      auditId,
      startedAtMs: 0,
      now: () => AUDIT_WALL_CLOCK_CEILING_MS,
    });

    const counting = countingFetch();
    const { result, kill } = await run({
      auditId,
      store,
      budget,
      fetchHomePage: counting.fetch,
    });

    expect(result).toBe("failed");
    expect(kill?.reason_code).toBe(WALL_CLOCK_CEILING_REASON_CODE);
    expect(kill?.cost_usd).toBe(0);
    expect(counting.calls()).toBe(0);
  });

  it("terminates a stage that hangs without spending anything", async () => {
    const auditId = "audit-stuck-stage";
    const store = seedStore(auditId);
    // Each fetch burns 6 minutes of wall clock but almost no money, so cost
    // never approaches $1.00. Only the time ceiling can stop this.
    let clock = 0;
    const budget = createAuditBudget({
      store,
      auditId,
      startedAtMs: 0,
      now: () => clock,
    });
    const counting = countingFetch(() => {
      clock += 6 * 60 * 1000;
    });

    const { result, kill } = await run({
      auditId,
      store,
      budget,
      fetchHomePage: counting.fetch,
    });

    expect(result).toBe("failed");
    expect(kill?.reason_code).toBe(WALL_CLOCK_CEILING_REASON_CODE);
    expect(Number(kill?.cost_usd)).toBeLessThan(AUDIT_COST_CEILING_USD);
    expect(Number(kill?.elapsed_ms)).toBeGreaterThanOrEqual(
      AUDIT_WALL_CLOCK_CEILING_MS,
    );
  });

  it("measures from durable execution start, so a resumed step inherits the deadline", async () => {
    const auditId = "audit-resumed";
    const store = seedStore(auditId);
    await store.claimWorkflow(auditId);
    const startedAtMs = await store.getWorkflowStartedAtMs(auditId);
    expect(startedAtMs).not.toBeNull();

    // A step that resumes 15 minutes after the claim is already over the
    // deadline; it must not be granted a fresh window.
    const budget = createAuditBudget({
      store,
      auditId,
      startedAtMs: startedAtMs!,
      now: () => startedAtMs! + AUDIT_WALL_CLOCK_CEILING_MS + 1,
    });
    const verdict = await budget.verdict();
    expect(verdict.tripped).toBe(true);
    expect(verdict.reasonCode).toBe(WALL_CLOCK_CEILING_REASON_CODE);
  });
});

describe("kill switches are idempotent and retry-safe", () => {
  it("does not double-count a replayed charge", async () => {
    const store = seedStore("audit-idem");
    const budget = createAuditBudget({ store, auditId: "audit-idem" });

    await budget.charge({
      category: "browserless_content",
      operationKey: "content:home:1",
    });
    const afterFirst = await store.getAuditCostTotal("audit-idem");

    // Same operation, re-run by a replayed durable step.
    await budget.charge({
      category: "browserless_content",
      operationKey: "content:home:1",
    });
    expect(await store.getAuditCostTotal("audit-idem")).toBe(afterFirst);

    // A genuinely different operation still accrues.
    await budget.charge({
      category: "browserless_content",
      operationKey: "content:home:2",
    });
    expect(await store.getAuditCostTotal("audit-idem")).toBeGreaterThan(
      afterFirst,
    );
  });

  it("records one kill event no matter how many times it is triggered", async () => {
    const store = seedStore("audit-retrigger");
    const budget = createAuditBudget({
      store,
      auditId: "audit-retrigger",
      startedAtMs: 0,
      now: () => AUDIT_WALL_CLOCK_CEILING_MS,
    });

    await budget.recordKill(WALL_CLOCK_CEILING_REASON_CODE);
    await budget.recordKill(WALL_CLOCK_CEILING_REASON_CODE);
    await budget.recordKill(COST_CEILING_REASON_CODE);

    const kills = store.events.filter(
      (row) => row.event_type === KILL_SWITCH_EVENT,
    );
    expect(kills).toHaveLength(1);
    expect(kills[0].event_data.reason_code).toBe(
      WALL_CLOCK_CEILING_REASON_CODE,
    );
  });

  it("re-running a killed audit stays failed and adds no duplicate transition", async () => {
    const auditId = "audit-rerun";
    const store = seedStore(auditId);
    const budget = createAuditBudget({
      store,
      auditId,
      startedAtMs: 0,
      now: () => AUDIT_WALL_CLOCK_CEILING_MS,
    });
    const counting = countingFetch();

    const first = await run({
      auditId,
      store,
      budget,
      fetchHomePage: counting.fetch,
    });
    const second = await run({
      auditId,
      store,
      budget,
      fetchHomePage: counting.fetch,
    });

    expect(first.result).toBe("failed");
    expect(second.result).toBe("failed");
    expect(
      store.transitions.filter(
        (row) => row.auditId === auditId && row.to_state === "failed",
      ),
    ).toHaveLength(1);
    expect(
      store.events.filter((row) => row.event_type === KILL_SWITCH_EVENT),
    ).toHaveLength(1);
  });

  it("persists a terminal reason a human can act on", async () => {
    const auditId = "audit-reason";
    const store = seedStore(auditId);
    await store.chargeAuditCost(auditId, {
      operation_key: "runaway",
      category: "browserless_content",
      quantity: 100,
      amount_usd: 1.5,
      pricing_source: "configured_estimate",
    });
    const counting = countingFetch();
    const { kill } = await run({
      auditId,
      store,
      fetchHomePage: counting.fetch,
    });

    expect(kill).toMatchObject({
      reason_code: COST_CEILING_REASON_CODE,
      failure_type: "KILL_SWITCH",
      cost_ceiling_usd: AUDIT_COST_CEILING_USD,
      wall_clock_ceiling_ms: AUDIT_WALL_CLOCK_CEILING_MS,
    });
    expect(store.telemetry.get(auditId)?.kill_switch_reason).toBe(
      COST_CEILING_REASON_CODE,
    );
  });
});

describe("email cost is attributed to the audit ceiling", () => {
  const EMAIL_TOKEN = "status-token";
  const EMAIL_ADDRESS = "owner@example.com";

  function emailStore(auditId: string) {
    return createMemoryEmailStore([
      {
        tokenHash: hmacSha256(EMAIL_TOKEN),
        auditId,
        leadEmailHash: hashEmail(EMAIL_ADDRESS),
        consentReportDelivery: true,
        reportRevisionId: "rev-1",
        publicationStatus: "published",
      },
    ]);
  }

  const sends: TransactionalEmailProvider = {
    async send() {
      return { ok: true, providerMessageId: "resend-1" };
    },
  };

  async function sendWith(
    auditId: string,
    store: ReturnType<typeof seedStore>,
    budget: AuditBudget,
  ) {
    return await requestReportEmail({
      statusToken: EMAIL_TOKEN,
      email: EMAIL_ADDRESS,
      provider: sends,
      store: emailStore(auditId),
      budgetFor: async () => budget,
    });
  }

  it("adds the send to the audit's cumulative cost", async () => {
    const auditId = "audit-email-cost";
    const store = seedStore(auditId);
    const budget = createAuditBudget({ store, auditId });

    expect(await store.getAuditCostTotal(auditId)).toBe(0);
    const result = await sendWith(auditId, store, budget);

    expect(result).toMatchObject({ ok: true, status: "sent" });
    const entries = store.costEntries.filter((row) => row.auditId === auditId);
    expect(entries).toHaveLength(1);
    expect(entries[0].category).toBe("email_send");
    expect(await store.getAuditCostTotal(auditId)).toBe(
      CONFIGURED_UNIT_COSTS_USD.email_send,
    );
  });

  it("charges once when the same delivery is requested twice", async () => {
    const auditId = "audit-email-idem";
    const store = seedStore(auditId);
    const budget = createAuditBudget({ store, auditId });
    const shared = emailStore(auditId);

    for (let i = 0; i < 3; i += 1) {
      await requestReportEmail({
        statusToken: EMAIL_TOKEN,
        email: EMAIL_ADDRESS,
        provider: sends,
        store: shared,
        budgetFor: async () => budget,
      });
    }

    expect(store.costEntries.filter((r) => r.auditId === auditId)).toHaveLength(1);
  });

  it("trips the ceiling when the send is what crosses $1.00, and stops further work", async () => {
    const auditId = "audit-email-tips-ceiling";
    const store = seedStore(auditId);
    // Contrived at real Resend pricing, but it proves the wiring: the audit
    // sits just under the ceiling and the send is what pushes it over.
    await store.chargeAuditCost(auditId, {
      operation_key: "prior-spend",
      category: "browserless_content",
      quantity: 99,
      amount_usd: AUDIT_COST_CEILING_USD - CONFIGURED_UNIT_COSTS_USD.email_send,
      pricing_source: "configured_estimate",
    });

    const budget = createAuditBudget({ store, auditId });
    expect((await budget.costVerdict()).tripped).toBe(false);

    const result = await sendWith(auditId, store, budget);

    // The send itself is not gated — the customer still gets their report.
    expect(result).toMatchObject({ ok: true, status: "sent" });
    expect(await store.getAuditCostTotal(auditId)).toBeGreaterThanOrEqual(
      AUDIT_COST_CEILING_USD,
    );

    // But the breach is recorded...
    const kill = store.events.find((r) => r.event_type === KILL_SWITCH_EVENT);
    expect(kill?.event_data.reason_code).toBe(COST_CEILING_REASON_CODE);
    expect(store.telemetry.get(auditId)?.kill_switch_reason).toBe(
      COST_CEILING_REASON_CODE,
    );

    // ...and remaining paid work for this audit is refused.
    const counting = countingFetch();
    const after = await run({ auditId, store, fetchHomePage: counting.fetch });
    expect(after.result).toBe("failed");
    expect(counting.calls()).toBe(0);
  });

  it("leaves the already-delivered audit complete rather than flipping it to failed", async () => {
    const auditId = "audit-email-no-retro-fail";
    const store = seedStore(auditId);
    // The audit has already finished and its report has already gone out.
    await store.recordTransition(auditId, "submitted", "complete");
    await store.chargeAuditCost(auditId, {
      operation_key: "prior-spend",
      category: "browserless_content",
      quantity: 99,
      amount_usd: AUDIT_COST_CEILING_USD - CONFIGURED_UNIT_COSTS_USD.email_send,
      pricing_source: "configured_estimate",
    });

    const budget = createAuditBudget({ store, auditId });
    await sendWith(auditId, store, budget);

    // The breach is recorded...
    expect(store.telemetry.get(auditId)?.kill_switch_reason).toBe(
      COST_CEILING_REASON_CODE,
    );
    // ...but a delivered report does not retroactively become a failure.
    // Postage cannot unmake a scan the customer already has in hand.
    expect((await store.getAudit(auditId))?.current_state).toBe("complete");
    const transitions = await store.listTransitions(auditId);
    expect(transitions.map((row) => row.to_state)).toEqual(["complete"]);
    expect(transitions.map((row) => row.to_state)).not.toContain("failed");
  });

  it("does not report a wall-clock kill for a report emailed days later", async () => {
    const auditId = "audit-email-late";
    const store = seedStore(auditId);
    // Long past the 15-minute execution window, which is normal: the email
    // can be requested any time the report link is still valid.
    const budget = createAuditBudget({
      store,
      auditId,
      startedAtMs: 0,
      now: () => 3 * 24 * 60 * 60 * 1000,
    });

    await sendWith(auditId, store, budget);

    expect(
      store.events.filter((r) => r.event_type === KILL_SWITCH_EVENT),
    ).toHaveLength(0);
    expect(store.telemetry.get(auditId)?.kill_switch_reason).toBeUndefined();
  });
});

describe("observability surface", () => {
  // The admin queue is the existing surface for audit observability, and it
  // reads Supabase directly. Asserted structurally because the columns can
  // only be verified against a live database, which unit tests do not have.
  const adminSource = readFileSync("lib/admin/service.ts", "utf8");

  it("selects and exposes cost, elapsed time, and kill reason", () => {
    expect(adminSource).toContain("cost_usd");
    expect(adminSource).toContain("elapsed_ms");
    expect(adminSource).toContain("kill_switch_reason");
    expect(adminSource).toContain("costUsd:");
    expect(adminSource).toContain("elapsedMs:");
    expect(adminSource).toContain("killSwitchReason:");
  });

  it("exposes the per-operation cost ledger on audit detail", () => {
    expect(adminSource).toContain("audit_cost_entries");
    expect(adminSource).toContain("costEntries");
  });

  it("renders cost and elapsed time in the admin queue", () => {
    const page = readFileSync("app/admin/page.tsx", "utf8");
    expect(page).toContain("item.costUsd");
    expect(page).toContain("item.elapsedMs");
    expect(page).toContain("item.killSwitchReason");
  });
});

describe("cost attribution", () => {
  it("prices the AI call from reported token usage", () => {
    // 1M input + 1M output at the configured Haiku rate.
    expect(
      aiNarrationCostUsd({ inputTokens: 1_000_000, outputTokens: 1_000_000 }),
    ).toBeCloseTo(6.0, 6);
    expect(aiNarrationCostUsd({})).toBe(0);
  });
});
