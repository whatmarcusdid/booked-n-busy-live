import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildResultsView, RESULTS_PILLARS } from "@/lib/copy/audit-results";
import type { ResultsView } from "@/lib/copy/audit-results";
import type { LoadAuditResultsResult } from "@/lib/services/audit-results-service";
import {
  submitPreCallAnswers,
  type PreCallAnswerRow,
  type PreCallAnswerStore,
} from "@/lib/pre-call/answers";

const SCREEN = join(
  process.cwd(),
  "app/audit/prepare/[token]/prepare-screen.tsx",
);
const FORM = join(process.cwd(), "app/audit/prepare/[token]/prepare-form.tsx");
const MIGRATION = join(
  process.cwd(),
  "supabase/migrations/20260909160000_pre_call_answers.sql",
);

const STATUS_TOKEN = "status-token";

function viewWithRecommendations(titles: string[]): ResultsView {
  return buildResultsView({
    firstName: "Alex",
    websiteUrl: "https://bookednbusy.app",
    pillars: RESULTS_PILLARS.map((pillar) => ({
      key: pillar.key,
      name: pillar.name,
      score: 0.8,
    })),
    criteria: [],
    recommendations: titles.map((title, index) => ({
      title,
      description: "Show this first.",
      pillar: "lead_conversion",
      priority: "fix_first",
      sortOrder: index,
    })),
  });
}

function memoryStore() {
  const rows: PreCallAnswerRow[] = [];
  const store: PreCallAnswerStore & { rows: typeof rows } = {
    rows,
    async insert(row) {
      rows.push(row);
      return { id: `row-${rows.length}` };
    },
  };
  return store;
}

function okResults(
  titles: string[],
  overrides: Partial<Extract<LoadAuditResultsResult, { ok: true }>> = {},
): Extract<LoadAuditResultsResult, { ok: true }> {
  return {
    ok: true,
    statusToken: STATUS_TOKEN,
    auditId: "audit-1",
    leadId: "lead-1",
    view: viewWithRecommendations(titles),
    ...overrides,
  };
}

describe("submitted pre-call answers persist", () => {
  it("writes the selected option text and sets submitted_at", async () => {
    const store = memoryStore();
    const submittedAt = "2026-09-09T16:00:00.000Z";
    const result = await submitPreCallAnswers(
      {
        statusToken: STATUS_TOKEN,
        findingAnswer: "Make the phone number obvious above the fold",
        resultAnswer: "More phone calls",
        timingAnswer: "Right away",
      },
      {
        loadResults: async () =>
          okResults(["Make the phone number obvious above the fold"]),
        store,
        now: () => new Date(submittedAt),
      },
    );

    expect(result).toEqual({ ok: true, id: "row-1" });
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]).toEqual({
      auditId: "audit-1",
      leadId: "lead-1",
      findingAnswer: "Make the phone number obvious above the fold",
      resultAnswer: "More phone calls",
      timingAnswer: "Right away",
      submittedAt,
    });
  });

  it("allows submitting with every dropdown left empty", async () => {
    const store = memoryStore();
    const result = await submitPreCallAnswers(
      { statusToken: STATUS_TOKEN },
      {
        loadResults: async () => okResults(["A real finding"]),
        store,
        now: () => new Date("2026-09-09T16:00:00.000Z"),
      },
    );

    expect(result.ok).toBe(true);
    expect(store.rows[0]).toMatchObject({
      findingAnswer: null,
      resultAnswer: null,
      timingAnswer: null,
      submittedAt: "2026-09-09T16:00:00.000Z",
    });
  });

  it("rejects a finding that is not in this audit's option list", async () => {
    const store = memoryStore();
    const result = await submitPreCallAnswers(
      {
        statusToken: STATUS_TOKEN,
        findingAnswer: "Trust Signals",
      },
      {
        loadResults: async () => okResults(["Make the phone number obvious"]),
        store,
      },
    );

    expect(result).toEqual({ ok: false, reason: "invalid_option" });
    expect(store.rows).toHaveLength(0);
  });

  it("resolves the audit through loadAuditResults, not a booking session", async () => {
    const source = readFileSync(
      join(process.cwd(), "lib/pre-call/answers.ts"),
      "utf8",
    );
    expect(source).toContain("loadAuditResults");
    expect(source).not.toContain("booking_sessions");
    expect(source).not.toContain("booking-sessions");
    expect(source).not.toContain("meetings");
  });
});

describe("Skip For Now writes no row", () => {
  it("navigates to the Calendar handoff from Skip For Now and Cancel without posting answers", () => {
    const screen = readFileSync(SCREEN, "utf8");
    const form = readFileSync(FORM, "utf8");

    expect(screen).toContain("href={scheduleTo}");
    expect(screen).toContain("scheduleHandoffPath");
    expect(screen).toContain("REPORT_SCHEDULE_PATH");
    expect(screen).toContain("SKIP_FOR_NOW_LABEL");
    expect(screen).toContain("CANCEL_LABEL");
    expect(screen).not.toContain("fetch(");
    expect(screen).not.toContain("submitPreCallAnswers");
    expect(screen).not.toContain("pre-call-answers");

    expect(form).toContain('fetch(submitUrl');
    expect(form).toContain('"/api/v1/pre-call-answers"');
    expect(form).toContain("onSubmit");
    expect(form).not.toContain("Skip For Now");
    expect(form).not.toContain("Cancel");
  });
});

describe("pre_call_answers migration", () => {
  it("is a standalone table with service-role-only RLS", () => {
    const sql = readFileSync(MIGRATION, "utf8");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS pre_call_answers");
    expect(sql).toContain("audit_id UUID NOT NULL REFERENCES audits(id)");
    expect(sql).toContain("lead_id UUID NOT NULL REFERENCES leads(id)");
    expect(sql).toContain("finding_answer TEXT");
    expect(sql).toContain("result_answer TEXT");
    expect(sql).toContain("timing_answer TEXT");
    expect(sql).toContain("submitted_at TIMESTAMPTZ");
    expect(sql).toContain("ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain('CREATE POLICY "Service role full access"');
    expect(sql).toContain("TO service_role");
    expect(sql).not.toMatch(/\banon\b/);
    expect(sql).not.toMatch(/\bpublic\b/);
    expect(sql).not.toMatch(/REFERENCES\s+(booking_sessions|meetings)\b/);
    expect(sql).not.toContain("CHECK (");
  });
});
