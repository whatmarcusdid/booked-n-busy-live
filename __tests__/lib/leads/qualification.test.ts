import {
  isLeadQualificationStatus,
  LEAD_QUALIFICATION_STATUSES,
  NOT_HOME_SERVICE_REASON,
} from "@/lib/leads/qualification";
import { WORKFLOW_TERMINAL_STATES } from "@/lib/audit-workflow/types";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Decision #11 rule 8: a non-home-service business is an unqualified LEAD,
 * not an unsupported SITE. Qualification must not be derived from, or stored
 * in, the audit state machine.
 */
describe("lead qualification is separate from audit state (rule 8)", () => {
  it("has its own status vocabulary", () => {
    expect([...LEAD_QUALIFICATION_STATUSES]).toEqual([
      "pending",
      "qualified",
      "unqualified",
    ]);
    expect(isLeadQualificationStatus("unqualified")).toBe(true);
    expect(isLeadQualificationStatus("unsupported")).toBe(false);
  });

  it("shares no value with the audit terminal states", () => {
    for (const status of LEAD_QUALIFICATION_STATUSES) {
      expect(WORKFLOW_TERMINAL_STATES as readonly string[]).not.toContain(
        status,
      );
    }
  });

  it("names a reason for the non-home-service case", () => {
    expect(NOT_HOME_SERVICE_REASON).toBe("not_home_service");
  });

  it("stores qualification on leads, not on audits.current_state", () => {
    const migration = readFileSync(
      join(
        process.cwd(),
        "supabase/migrations/20260908160000_lead_qualification_and_manual_retry.sql",
      ),
      "utf8",
    );
    expect(migration).toMatch(
      /ALTER TABLE leads\s+ADD COLUMN IF NOT EXISTS qualification_status/,
    );
    expect(migration).not.toMatch(/current_state\s+IN\s*\(.*unqualified/i);
  });
});
