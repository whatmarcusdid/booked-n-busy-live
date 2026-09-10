import { hashEmail } from "../crypto";
import { isWithinRetention } from "./tokens";

/**
 * Re-request flow for an expired report link.
 *
 * Branches on whether the data is still retained, not on how old the link is.
 * Those are different windows — a link dies after 30 days, the data lives for
 * 365 — so a customer whose link expired at day 31 gets their existing report
 * re-sent, while one returning after a year gets a new scan.
 */

export type ReRequestOutcome =
  /** Data still on file: issue fresh access to the existing report. */
  | { action: "resend"; auditId: string; reportRevisionId: string }
  /** Data past retention: run a new audit for the same site. */
  | { action: "rescan"; websiteUrl: string; leadId: string }
  /** Email did not match, or nothing to act on. */
  | { action: "none" };

export interface ReRequestRow {
  auditId: string;
  leadId: string;
  websiteUrl: string;
  reportRevisionId: string | null;
  leadEmailHash: string;
  publishedAt: string | null;
  auditCreatedAt: string | null;
}

export interface ReRequestStore {
  findByReportTokenHash(tokenHash: string): Promise<ReRequestRow | null>;
  findLatestByEmailHash(emailHash: string): Promise<ReRequestRow | null>;
}

export async function resolveReRequest(
  input: {
    email: string;
    /** From the access cookie, when the visitor came from a real link. */
    tokenHash?: string;
  },
  store: ReRequestStore,
  now: Date = new Date(),
): Promise<ReRequestOutcome> {
  const emailHash = hashEmail(input.email);

  let row = input.tokenHash
    ? await store.findByReportTokenHash(input.tokenHash)
    : null;

  // Token hash lives on report_revisions. After the 12-month purge the row
  // is gone, so a still-held cookie cannot look the report up by hash. Fall
  // back to the email so a purged-but-not-expired visitor still rescans.
  if (!row) {
    row = await store.findLatestByEmailHash(emailHash);
  }

  if (!row) return { action: "none" };

  // The email must match the lead the report belongs to. Without this, an
  // expired link would let anyone redirect a report to their own inbox.
  if (row.leadEmailHash !== emailHash) return { action: "none" };

  const retained = isWithinRetention(
    { published_at: row.publishedAt, created_at: row.auditCreatedAt },
    now,
  );

  if (retained && row.reportRevisionId) {
    return {
      action: "resend",
      auditId: row.auditId,
      reportRevisionId: row.reportRevisionId,
    };
  }

  return { action: "rescan", websiteUrl: row.websiteUrl, leadId: row.leadId };
}
