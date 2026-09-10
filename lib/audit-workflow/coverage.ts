import { CATEGORY_PAGE_TYPES } from "./discover-links";
import type { AuditWorkflowStore, StoredPage } from "./store";
import type { WorkflowTerminalState } from "./types";

/**
 * Audit-level coverage resolution (PRD decision #11 rule 5, and Section 18.8
 * report finalization).
 *
 * "Homepage works, internal page blocked → Partial." Until now only
 * page-level omission was tracked: a page that could not be read was stored
 * with `assessed: false` and a reason code, but the audit still finished as
 * Complete. This module turns that page-level record into the audit-level
 * terminal state the decision requires.
 *
 * Deliberately cause-agnostic. A page is omitted whether robots.txt
 * disallowed it, the fetch timed out, a CAPTCHA blocked it, the link was
 * never found, or the page budget ran out. Every cause routes through the
 * same rule, so a customer who got 3 of 4 pages read is told the same thing
 * regardless of why.
 */

/** The pages an audit expects to read beyond the homepage. */
export const EXPECTED_CATEGORY_PAGES = CATEGORY_PAGE_TYPES;

export interface PageOmission {
  pageType: string;
  url: string | null;
  reasonCode: string;
}

export interface CoverageAssessment {
  homeAssessed: boolean;
  assessedPageTypes: string[];
  /** Discoverable pages we could not read. These drive the Partial verdict. */
  omissions: PageOmission[];
  /**
   * Page types the site simply does not have — no link was ever discovered.
   * Recorded for transparency but NOT treated as omissions: a page that does
   * not exist was not withheld from us. Counting these would make Partial the
   * normal outcome, since plenty of small home-service sites are one page.
   */
  absentPageTypes: string[];
  expectedPageCount: number;
}

function isAssessed(page: StoredPage | null): boolean {
  if (!page) return false;
  // Mock-processor pages are synthetic, not read from the site, but they are
  // "covered" for coverage purposes — mock mode is not the product and must
  // not report every audit as Partial.
  if (page.metadata?.mock === true) return true;
  return page.metadata?.assessed === true;
}

/**
 * Did the site have this page at all?
 *
 * `discoverPages` records `not_found: true` when no link to the page type was
 * found on the homepage. That is the one unassessed case that is not an
 * omission — everything else (robots disallow, fetch failure, timeout,
 * CAPTCHA, unsafe redirect, page budget exhausted) means the page was there
 * to read and we did not read it.
 */
function isAbsentFromSite(page: StoredPage | null): boolean {
  return page?.metadata?.not_found === true;
}

function omissionReason(page: StoredPage | null): string {
  if (!page) return "NOT_STORED";
  const reason = page.metadata?.reason_code;
  return typeof reason === "string" && reason ? reason : "NOT_ASSESSED";
}

export async function assessPageCoverage(
  store: AuditWorkflowStore,
  auditId: string,
): Promise<CoverageAssessment> {
  const home = await store.findPage(auditId, "home");
  const assessedPageTypes: string[] = [];
  const omissions: PageOmission[] = [];
  const absentPageTypes: string[] = [];

  if (isAssessed(home)) assessedPageTypes.push("home");

  for (const pageType of EXPECTED_CATEGORY_PAGES) {
    const page = await store.findPage(auditId, pageType);
    if (isAssessed(page)) {
      assessedPageTypes.push(pageType);
      continue;
    }
    if (isAbsentFromSite(page)) {
      absentPageTypes.push(pageType);
      continue;
    }
    omissions.push({
      pageType,
      url: page?.url ?? null,
      reasonCode: omissionReason(page),
    });
  }

  return {
    homeAssessed: isAssessed(home),
    assessedPageTypes,
    omissions,
    absentPageTypes,
    expectedPageCount: EXPECTED_CATEGORY_PAGES.length + 1,
  };
}

/**
 * Resolves the audit's terminal state at report finalization.
 *
 * Precedence, per decision #12's state precedence rule: Needs Review outranks
 * Partial. An audit that is both under-covered AND has review-triggering
 * check outcomes goes to Needs Review — but the omission record is kept and
 * surfaced, so the reviewer sees the partial coverage rather than losing it
 * to the higher-precedence state.
 */
export function resolveTerminalState(input: {
  coverage: CoverageAssessment;
  requiresPriorityReview: boolean;
}): WorkflowTerminalState {
  if (input.requiresPriorityReview) return "needs_review";
  if (!input.coverage.homeAssessed) {
    // Reaching finalization without an assessed homepage should not happen —
    // a failed home fetch aborts to unsupported/failed long before this. If
    // it ever does, Partial is the honest answer, never Complete.
    return "partial";
  }
  if (input.coverage.omissions.length > 0) return "partial";
  return "complete";
}
