import { createHash } from "crypto";
import {
  customerMessageForHomeFetchFailure,
  fetchBrowserlessContent,
  inferHomeFetchFailureType,
  isTargetAccessDenied,
  redactProviderSecrets,
  terminalStateForHomeFetchFailure,
  type CaptureScreenshot,
  type FetchPagePerformance,
  type FetchRenderedPage,
  type HomeFetchDiagnostic,
} from "../browserless";
import {
  aiNarrationCostUsd,
  COST_KILL_REASON_SENTINEL,
  type AuditBudget,
  type CostCharge,
} from "./budget";
import { assessPageCoverage, resolveTerminalState } from "./coverage";
import { fetchRobotsOverHttp } from "../crawler/fetch-robots";
import {
  fetchRobotsTxt,
  isPathAllowed,
  type FetchRobotsTxt,
  type RobotsDecision,
  type RobotsTxt,
} from "../crawler/robots";
import { isAutoPublishEnabled, isRealScanEnabled } from "../flags";
import {
  AUTO_PUBLICATION_EVALUATED_EVENT,
  evaluateAutoPublicationEligibility,
  requiresPriorityReview,
} from "../reports/auto-publication";
import type { ArtifactStorage } from "../storage/audit-artifacts";
import {
  CATEGORY_PAGE_TYPES,
  extractMetaDescription,
  extractTitle,
  selectCategoryUrls,
  type CategoryPageType,
} from "./discover-links";
import { captureHomePerformance } from "./home-performance";
import { captureAndStoreHomeScreenshot } from "./home-screenshot";
import { captureAndStorePageScreenshots } from "./page-screenshot";
import {
  applyHomeRubric,
  deterministicMockScore,
  mockKeysForAffectedPillars,
} from "./rubric/apply";
import { extractHomeScoringSignals } from "./rubric/signals";
import { isRealHomeCheck, RULE_VERSION } from "./rubric/model";
import {
  assessUrlSafety,
  type UrlSafetyDeps,
} from "../url-safety";
import { writesReport, writesScores } from "./outcome";
import {
  allowsManualRetry,
  classifyHomeFetchRetry,
  MAX_AUTOMATIC_RETRIES,
  planHomeFetchRetry,
} from "./retry";
import {
  outcomeFromMockScore,
  selectRecommendations,
  toRecommendationInput,
} from "./recommendations";
import { assembleReport } from "../reports/assemble";
import { narrateAssembledReport } from "../reports/narration";
import type {
  AuditWorkflowStore,
  CriterionInput,
  PageInput,
} from "./store";
import {
  CRITERIA_BY_PILLAR,
  PILLARS,
  type AuditWorkflowState,
  type PillarKey,
  type WorkflowTerminalState,
} from "./types";

/**
 * Stage bodies. Discovering runs the URL-safety guard always. When
 * REAL_SCAN_ENABLED=true the home page is fetched via Browserless /content,
 * then About/Services/Contact are selected from same-origin links and
 * fetched independently. Home gets desktop+mobile screenshots; category
 * pages get desktop only. Home also gets a Browserless /performance call
 * (Lighthouse-style). Scoring is mock unless the flag is on, in which
 * case the v2 real home checks (license_insurance, service_area_clarity,
 * phone_cta_visibility, quote_booking_cta_visibility, process_clarity,
 * website_performance, seo_ai_search_readiness, security_health,
 * faq_common_concerns, offer_differentiation) are scored from the home
 * fetch and /performance result. Remaining catalog keys stay mock.
 */

function deterministicScore(auditId: string, key: string): number {
  return deterministicMockScore(auditId, key);
}

function delayMs(ms: number): Promise<void> {
  // Tests drive the retry path directly; a real sleep would only slow them.
  if (ms <= 0 || process.env.JEST_WORKER_ID) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function assessedCriteriaForOutcome(
  outcome: WorkflowTerminalState,
): Array<{ pillar: PillarKey; key: string; name: string; weight: number }> {
  if (!writesScores(outcome)) return [];

  // Every check is attempted. Coverage is whatever the evidence supports:
  // `applyHomeRubric` writes `not_assessed` for checks it could not reach,
  // and the audit-level Partial verdict comes from page coverage at report
  // finalization, not from a per-outcome allowlist here. This used to slice
  // two checks per pillar when the outcome was pre-set to `partial`, which
  // only worked because the outcome was known before scoring ran.
  return PILLARS.flatMap((pillar) =>
    CRITERIA_BY_PILLAR[pillar.key].map((criterion) => ({
      pillar: pillar.key,
      ...criterion,
    })),
  );
}

function pageOrigin(websiteUrl: string): string {
  return websiteUrl.replace(/\/$/, "");
}

function mockPages(websiteUrl: string): PageInput[] {
  const origin = pageOrigin(websiteUrl);
  return [
    {
      url: origin,
      page_type: "home",
      title: "Home",
      meta_description: "Mock homepage",
      metadata: { mock: true },
    },
    {
      url: `${origin}/about`,
      page_type: "about",
      title: "About Us",
      meta_description: "Mock about page",
      metadata: { mock: true },
    },
    {
      url: `${origin}/services`,
      page_type: "services",
      title: "Services",
      meta_description: "Mock services page",
      metadata: { mock: true },
    },
    {
      url: `${origin}/contact`,
      page_type: "contact",
      title: "Contact",
      meta_description: "Mock contact page",
      metadata: { mock: true },
    },
  ];
}

/**
 * Runs one paid operation behind both kill switches.
 *
 * The ceiling is checked BEFORE the spend, never after: checking afterwards
 * would let a single call carry the audit past the limit. The charge is
 * recorded after the work so the ledger only ever reflects money actually
 * committed. `operationKey` makes the charge idempotent, so a replayed
 * durable step re-runs the check but cannot double-count the cost.
 */
async function spend<T>(
  budget: AuditBudget | undefined,
  charge: CostCharge,
  run: () => Promise<T>,
): Promise<{ tripped: true } | { tripped: false; value: T }> {
  const verdict = await budget?.verdict();
  if (verdict?.tripped) return { tripped: true };
  const value = await run();
  await budget?.charge(charge);
  return { tripped: false, value };
}

/** Signals to the pipeline that a ceiling stopped this stage's paid work. */
function killSwitchResult(): StageWorkResult {
  return { reasonCode: COST_KILL_REASON_SENTINEL };
}

export type StageWorkResult = {
  abortTo?: WorkflowTerminalState;
  reasonCode?: string;
  /**
   * The terminal state resolved at report finalization from actual page
   * coverage and check outcomes. Unlike `abortTo` this does not short-circuit
   * the pipeline — the remaining stages still run, they just run knowing
   * which terminal state they are heading for.
   */
  resolveTo?: WorkflowTerminalState;
};

function pageFromRender(input: {
  url: string;
  html: string;
  status: number;
  finalUrl: string;
  pageType: string;
  fallbackTitle: string;
}): PageInput {
  const htmlBytes = Buffer.byteLength(input.html, "utf8");
  return {
    url: pageOrigin(input.url),
    page_type: input.pageType,
    title: extractTitle(input.html, input.fallbackTitle),
    meta_description:
      extractMetaDescription(input.html) || input.fallbackTitle,
    metadata: {
      mock: false,
      assessed: true,
      http_status: input.status,
      content_length: htmlBytes,
      content_hash: createHash("sha256").update(input.html).digest("hex"),
      render_status: "rendered",
      source: "browserless_content",
      ...(input.finalUrl !== input.url ? { final_url: input.finalUrl } : {}),
    },
  };
}

export const HOME_PAGE_FETCH_FAILED_EVENT = "home_page_fetch_failed";
export const HOME_PAGE_FETCH_RETRIED_EVENT = "home_page_fetch_retried";
export const PROHIBITED_CONTENT_BLOCKED_EVENT = "prohibited_content_blocked";
export const PAGE_COVERAGE_RESOLVED_EVENT = "page_coverage_resolved";
export const ROBOTS_PREFLIGHT_EVENT = "robots_txt_preflight";
export const ROBOTS_PAGE_SKIPPED_EVENT = "robots_txt_page_skipped";
export const ROBOTS_DISALLOWED_REASON_CODE = "ROBOTS_DISALLOWED";

async function persistHomeFetchDiagnostic(
  store: AuditWorkflowStore,
  auditId: string,
  websiteUrl: string,
  diagnostic: HomeFetchDiagnostic,
  retry?: { attemptsUsed: number; manualRetryAvailable: boolean },
): Promise<void> {
  const providerMessage = diagnostic.providerMessage
    ? redactProviderSecrets(diagnostic.providerMessage)
    : undefined;
  const accessDenied = isTargetAccessDenied(
    diagnostic.failureType,
    diagnostic.httpStatus,
  );
  const customerMessage = accessDenied
    ? customerMessageForHomeFetchFailure(diagnostic)
    : undefined;
  await store.recordEvent(auditId, HOME_PAGE_FETCH_FAILED_EVENT, {
    reason_code: diagnostic.reasonCode,
    failure_type: diagnostic.failureType,
    http_status: diagnostic.httpStatus ?? null,
    provider_message: providerMessage ?? null,
    ...(customerMessage ? { customer_message: customerMessage } : {}),
    ...(retry
      ? {
          attempts_used: retry.attemptsUsed,
          max_automatic_retries: MAX_AUTOMATIC_RETRIES,
          manual_retry_available: retry.manualRetryAvailable,
        }
      : {}),
  });
  await store.upsertPages(auditId, [
    {
      url: pageOrigin(websiteUrl),
      page_type: "home",
      title: "Home",
      meta_description: "",
      metadata: {
        mock: false,
        assessed: false,
        reason_code: diagnostic.reasonCode,
        failure_type: diagnostic.failureType,
        ...(diagnostic.httpStatus !== undefined
          ? { http_status: diagnostic.httpStatus }
          : {}),
        ...(providerMessage ? { provider_message: providerMessage } : {}),
        ...(customerMessage ? { customer_message: customerMessage } : {}),
      },
    },
  ]);
}

function diagnosticFromFetchFailure(
  fetched: Extract<Awaited<ReturnType<FetchRenderedPage>>, { ok: false }>,
): HomeFetchDiagnostic {
  return {
    reasonCode: fetched.reasonCode,
    failureType:
      fetched.diagnostic?.failureType ??
      inferHomeFetchFailureType(fetched.reasonCode),
    httpStatus: fetched.diagnostic?.httpStatus,
    providerMessage: fetched.diagnostic?.providerMessage,
  };
}

function unassessedPage(
  websiteUrl: string,
  pageType: CategoryPageType,
  reasonCode: string,
  candidateUrl?: string,
): PageInput {
  const fallback = mockPages(websiteUrl).find(
    (page) => page.page_type === pageType,
  );
  return {
    url: candidateUrl ? pageOrigin(candidateUrl) : (fallback?.url ?? websiteUrl),
    page_type: pageType,
    title: fallback?.title ?? pageType,
    meta_description: fallback?.meta_description ?? "",
    metadata: {
      mock: false,
      assessed: false,
      not_found: reasonCode === "NOT_FOUND",
      reason_code: reasonCode,
    },
  };
}

/**
 * Records the prohibited-content pre-flight match as structured evidence.
 * Runs before any real fetch or screenshot, so nothing has been captured yet.
 */
/**
 * Records the robots.txt pre-flight as structured evidence: whether we could
 * read the file, which `User-agent` group applied, the rule that decided the
 * homepage, and the crawl-delay we deliberately ignored.
 */
async function recordRobotsPreflight(
  store: AuditWorkflowStore,
  auditId: string,
  robots: RobotsTxt,
  home: RobotsDecision,
): Promise<void> {
  await store.recordEvent(auditId, ROBOTS_PREFLIGHT_EVENT, {
    robots_url: robots.url,
    fetch_status: robots.status,
    http_status: robots.httpStatus ?? null,
    matched_user_agent: robots.matchedUserAgent,
    rule_count: robots.rules.length,
    home_allowed: home.allowed,
    home_matched_rule: home.matchedRule
      ? `${home.matchedRule.directive}: ${home.matchedRule.pattern}`
      : null,
    // Reported, never honoured. See the note in lib/crawler/robots.ts.
    crawl_delay_seconds: robots.crawlDelaySeconds,
    crawl_delay_honored: false,
    checked_before_fetch: true,
  });
}

async function recordRobotsSkippedPage(
  store: AuditWorkflowStore,
  auditId: string,
  robots: RobotsTxt,
  decision: RobotsDecision,
  skippedUrl: string,
  pageType: string,
): Promise<void> {
  await store.recordEvent(auditId, ROBOTS_PAGE_SKIPPED_EVENT, {
    robots_url: robots.url,
    skipped_url: skippedUrl,
    page_type: pageType,
    matched_user_agent: robots.matchedUserAgent,
    matched_rule: decision.matchedRule
      ? `${decision.matchedRule.directive}: ${decision.matchedRule.pattern}`
      : null,
    checked_before_fetch: true,
  });
}

async function recordProhibitedContent(
  store: AuditWorkflowStore,
  auditId: string,
  safety: Extract<Awaited<ReturnType<typeof assessUrlSafety>>, { ok: false }>,
): Promise<void> {
  if (safety.reasonCode !== "PROHIBITED_CONTENT" || !safety.prohibited) return;
  await store.recordEvent(auditId, PROHIBITED_CONTENT_BLOCKED_EVENT, {
    reason_code: safety.reasonCode,
    category: safety.prohibited.category,
    matched_rule: safety.prohibited.matchedRule,
    matched_value: safety.prohibited.matchedValue,
    checked_before_fetch: true,
  });
}

async function discoverPages(input: {
  store: AuditWorkflowStore;
  auditId: string;
  websiteUrl: string;
  safetyDeps?: UrlSafetyDeps;
  realScanEnabled?: boolean;
  fetchHomePage?: FetchRenderedPage;
  fetchRobots?: FetchRobotsTxt;
  budget?: AuditBudget;
}): Promise<StageWorkResult> {
  const safety = await assessUrlSafety(input.websiteUrl, input.safetyDeps);
  if (!safety.ok) {
    await recordProhibitedContent(input.store, input.auditId, safety);
    return { abortTo: "unsupported", reasonCode: safety.reasonCode };
  }

  const realScan = input.realScanEnabled ?? isRealScanEnabled();
  if (!realScan) {
    await input.store.upsertPages(
      input.auditId,
      mockPages(safety.normalizedUrl),
    );
    return {};
  }

  const fetchSafety = await assessUrlSafety(
    safety.normalizedUrl,
    input.safetyDeps,
  );
  if (!fetchSafety.ok) {
    await recordProhibitedContent(input.store, input.auditId, fetchSafety);
    await persistHomeFetchDiagnostic(
      input.store,
      input.auditId,
      safety.normalizedUrl,
      {
        reasonCode: fetchSafety.reasonCode,
        failureType: "SAFETY_REJECTED",
      },
    );
    return { abortTo: "unsupported", reasonCode: fetchSafety.reasonCode };
  }

  // robots.txt pre-flight, at the same priority as the prohibited-content
  // check: before any real page fetch or screenshot capture. Crawl-delay is
  // read for evidence only and never slows anything down.
  const robots = await fetchRobotsTxt(
    fetchSafety.normalizedUrl,
    input.fetchRobots ?? fetchRobotsOverHttp,
    fetchSafety.bounds.maxFetchDurationMs,
  );
  const homeRobots = isPathAllowed(robots, fetchSafety.normalizedUrl);
  await recordRobotsPreflight(input.store, input.auditId, robots, homeRobots);

  if (!homeRobots.allowed) {
    // Homepage disallowed is treated exactly like a homepage 401/403: the
    // site has told us we may not look, which is a policy answer, not a
    // transient failure. Routed through the same Unsupported path.
    await persistHomeFetchDiagnostic(
      input.store,
      input.auditId,
      fetchSafety.normalizedUrl,
      {
        reasonCode: ROBOTS_DISALLOWED_REASON_CODE,
        failureType: "SAFETY_REJECTED",
      },
    );
    return {
      abortTo: "unsupported",
      reasonCode: ROBOTS_DISALLOWED_REASON_CODE,
    };
  }

  const fetchHomePage = input.fetchHomePage ?? fetchBrowserlessContent;

  // Rules 2 and 10 allow exactly one automatic retry. `attemptsUsed` is the
  // whole-fetch budget, so reclassifying between attempts cannot buy a second.
  const firstAttempt = await spend(
    input.budget,
    { category: "browserless_content", operationKey: "content:home:1" },
    () =>
      fetchHomePage({
        url: fetchSafety.normalizedUrl,
        timeoutMs: fetchSafety.bounds.maxFetchDurationMs,
        maxResponseBytes: fetchSafety.bounds.maxResponseBytes,
      }),
  );
  if (firstAttempt.tripped) return killSwitchResult();
  let fetched = firstAttempt.value;
  let attemptsUsed = 1;

  if (!fetched.ok) {
    const firstDiagnostic = diagnosticFromFetchFailure(fetched);
    const plan = planHomeFetchRetry(firstDiagnostic, attemptsUsed);
    if (plan.retry) {
      await input.store.recordEvent(
        input.auditId,
        HOME_PAGE_FETCH_RETRIED_EVENT,
        {
          attempt: attemptsUsed + 1,
          max_automatic_retries: MAX_AUTOMATIC_RETRIES,
          retry_class: classifyHomeFetchRetry(firstDiagnostic),
          first_reason_code: firstDiagnostic.reasonCode,
          first_failure_type: firstDiagnostic.failureType,
          first_http_status: firstDiagnostic.httpStatus ?? null,
          varied_user_agent: plan.userAgent ?? null,
        },
      );
      await delayMs(plan.delayMs);
      // The retry is charged as its own operation, so a retry that pushes the
      // audit over the ceiling is caught rather than hidden inside attempt 1.
      const retried = await spend(
        input.budget,
        { category: "browserless_content", operationKey: "content:home:2" },
        () =>
          fetchHomePage({
            url: fetchSafety.normalizedUrl,
            timeoutMs: fetchSafety.bounds.maxFetchDurationMs,
            maxResponseBytes: fetchSafety.bounds.maxResponseBytes,
            ...(plan.userAgent ? { userAgent: plan.userAgent } : {}),
          }),
      );
      if (retried.tripped) return killSwitchResult();
      fetched = retried.value;
      attemptsUsed += 1;
    }
  }

  if (!fetched.ok) {
    const diagnostic = diagnosticFromFetchFailure(fetched);
    await persistHomeFetchDiagnostic(
      input.store,
      input.auditId,
      fetchSafety.normalizedUrl,
      diagnostic,
      { attemptsUsed, manualRetryAvailable: allowsManualRetry(diagnostic) },
    );
    await applyHomeRubric({
      store: input.store,
      auditId: input.auditId,
      mockKeys: mockKeysForAffectedPillars(),
    });
    return {
      abortTo: terminalStateForHomeFetchFailure(diagnostic),
      reasonCode: fetched.reasonCode,
    };
  }

  if (fetched.redirected || fetched.finalUrl !== fetchSafety.normalizedUrl) {
    const dest = await assessUrlSafety(fetched.finalUrl, input.safetyDeps);
    if (!dest.ok) {
      await persistHomeFetchDiagnostic(
        input.store,
        input.auditId,
        fetched.finalUrl,
        {
          reasonCode: dest.reasonCode,
          failureType: "SAFETY_REJECTED",
        },
      );
      await applyHomeRubric({
        store: input.store,
        auditId: input.auditId,
        mockKeys: mockKeysForAffectedPillars(),
      });
      return { abortTo: "unsupported", reasonCode: dest.reasonCode };
    }
  }

  const home = pageFromRender({
    url: fetchSafety.normalizedUrl,
    html: fetched.html,
    status: fetched.status,
    finalUrl: fetched.finalUrl,
    pageType: "home",
    fallbackTitle: "Home",
  });
  home.metadata = {
    ...home.metadata,
    scoring_signals: extractHomeScoringSignals({
      html: fetched.html,
      finalUrl: fetched.finalUrl,
      status: fetched.status,
    }),
  };

  const discovered = selectCategoryUrls(
    fetched.html,
    fetched.finalUrl || fetchSafety.normalizedUrl,
  );
  const categoryPages: PageInput[] = [];
  let attempted = 1;

  for (const pageType of CATEGORY_PAGE_TYPES) {
    if (attempted >= fetchSafety.bounds.maxPagesPerDomain) {
      categoryPages.push(
        unassessedPage(
          fetchSafety.normalizedUrl,
          pageType,
          "PAGE_LIMIT_REACHED",
        ),
      );
      continue;
    }

    const candidate = discovered[pageType];
    if (!candidate) {
      categoryPages.push(
        unassessedPage(fetchSafety.normalizedUrl, pageType, "NOT_FOUND"),
      );
      continue;
    }

    // An internal page disallowed by robots.txt is skipped through the same
    // omission path as a missing link or an unsafe one — the homepage was
    // allowed, so the audit still runs on what we may legitimately read.
    // Skipping happens BEFORE the fetch and before `attempted` increments,
    // so a disallowed page never consumes any of the page budget.
    const candidateRobots = isPathAllowed(robots, candidate);
    if (!candidateRobots.allowed) {
      await recordRobotsSkippedPage(
        input.store,
        input.auditId,
        robots,
        candidateRobots,
        candidate,
        pageType,
      );
      categoryPages.push(
        unassessedPage(
          fetchSafety.normalizedUrl,
          pageType,
          ROBOTS_DISALLOWED_REASON_CODE,
          candidate,
        ),
      );
      continue;
    }

    attempted += 1;
    const pageSafety = await assessUrlSafety(candidate, input.safetyDeps);
    if (!pageSafety.ok) {
      categoryPages.push(
        unassessedPage(
          fetchSafety.normalizedUrl,
          pageType,
          pageSafety.reasonCode,
          candidate,
        ),
      );
      continue;
    }

    const pageAttempt = await spend(
      input.budget,
      {
        category: "browserless_content",
        operationKey: `content:page:${pageType}`,
      },
      () =>
        fetchHomePage({
          url: pageSafety.normalizedUrl,
          timeoutMs: pageSafety.bounds.maxFetchDurationMs,
          maxResponseBytes: pageSafety.bounds.maxResponseBytes,
        }),
    );
    if (pageAttempt.tripped) return killSwitchResult();
    const pageFetch = pageAttempt.value;

    if (!pageFetch.ok) {
      categoryPages.push(
        unassessedPage(
          fetchSafety.normalizedUrl,
          pageType,
          pageFetch.reasonCode,
          pageSafety.normalizedUrl,
        ),
      );
      continue;
    }

    if (
      pageFetch.redirected ||
      pageFetch.finalUrl !== pageSafety.normalizedUrl
    ) {
      const dest = await assessUrlSafety(pageFetch.finalUrl, input.safetyDeps);
      if (!dest.ok) {
        categoryPages.push(
          unassessedPage(
            fetchSafety.normalizedUrl,
            pageType,
            dest.reasonCode,
            pageFetch.finalUrl,
          ),
        );
        continue;
      }
    }

    categoryPages.push(
      pageFromRender({
        url: pageSafety.normalizedUrl,
        html: pageFetch.html,
        status: pageFetch.status,
        finalUrl: pageFetch.finalUrl,
        pageType,
        fallbackTitle:
          pageType === "about"
            ? "About Us"
            : pageType === "services"
              ? "Services"
              : "Contact",
      }),
    );
  }

  await input.store.upsertPages(input.auditId, [home, ...categoryPages]);
  return {};
}

function publicationStatusFor(_outcome: WorkflowTerminalState): string {
  // Generated reports never auto-publish. They stay in review until
  // publishReportRevision() is called from the admin publish route.
  return "review_required";
}

export async function applyMockStageWork(input: {
  store: AuditWorkflowStore;
  auditId: string;
  websiteUrl: string;
  toState: AuditWorkflowState;
  outcome: WorkflowTerminalState;
  safetyDeps?: UrlSafetyDeps;
  realScanEnabled?: boolean;
  fetchHomePage?: FetchRenderedPage;
  fetchRobots?: FetchRobotsTxt;
  captureScreenshot?: CaptureScreenshot;
  fetchPerformance?: FetchPagePerformance;
  artifactStorage?: ArtifactStorage;
  budget?: AuditBudget;
}): Promise<StageWorkResult> {
  const { store, auditId, websiteUrl, toState, outcome } = input;

  if (toState === "discovering") {
    return discoverPages(input);
  }

  if (toState === "rendering") {
    const realScan = input.realScanEnabled ?? isRealScanEnabled();
    if (realScan) {
      // Each capture helper is charged as a group: the screenshot calls it
      // makes plus the storage upload each one produces. Quantities are the
      // maximum the helper can perform, so a helper that skips work it has
      // already done is over-charged rather than under-charged.
      const home = await spend(
        input.budget,
        {
          category: "browserless_screenshot",
          operationKey: "screenshot:home",
          quantity: 2,
        },
        () =>
          captureAndStoreHomeScreenshot({
            store,
            auditId,
            websiteUrl,
            safetyDeps: input.safetyDeps,
            captureScreenshot: input.captureScreenshot,
            artifactStorage: input.artifactStorage,
          }),
      );
      if (home.tripped) return killSwitchResult();
      await input.budget?.charge({
        category: "storage_upload",
        operationKey: "storage:home",
        quantity: 2,
      });

      const performance = await spend(
        input.budget,
        {
          category: "browserless_performance",
          operationKey: "performance:home",
        },
        () =>
          captureHomePerformance({
            store,
            auditId,
            websiteUrl,
            safetyDeps: input.safetyDeps,
            fetchPerformance: input.fetchPerformance,
          }),
      );
      if (performance.tripped) return killSwitchResult();

      for (const pageType of CATEGORY_PAGE_TYPES) {
        const page = await spend(
          input.budget,
          {
            category: "browserless_screenshot",
            operationKey: `screenshot:${pageType}`,
          },
          () =>
            captureAndStorePageScreenshots({
              store,
              auditId,
              websiteUrl,
              pageType,
              viewports: ["desktop"],
              safetyDeps: input.safetyDeps,
              captureScreenshot: input.captureScreenshot,
              artifactStorage: input.artifactStorage,
            }),
        );
        if (page.tripped) return killSwitchResult();
        await input.budget?.charge({
          category: "storage_upload",
          operationKey: `storage:${pageType}`,
        });
      }
    } else {
      await store.upsertEvidence(auditId, [
        {
          mock_key: "homepage_screenshot",
          evidence_type: "screenshot",
          description: "Homepage screenshot",
          metadata: { page: "home" },
        },
      ]);
      await store.upsertEvidence(auditId, [
        {
          mock_key: "lighthouse_report",
          evidence_type: "lighthouse_report",
          description: "Performance metrics",
          metadata: {
            performance: deterministicScore(auditId, "lighthouse"),
          },
        },
      ]);
    }
  }

  if (toState === "scoring") {
    const realScan = input.realScanEnabled ?? isRealScanEnabled();
    if (realScan) {
      const assessed = assessedCriteriaForOutcome(outcome);
      if (assessed.length === 0) return {};
      const mockKeys = new Set(
        assessed
          .filter((criterion) => !isRealHomeCheck(criterion.key))
          .map((criterion) => criterion.key),
      );
      const realKeys = new Set(
        assessed
          .filter((criterion) => isRealHomeCheck(criterion.key))
          .map((criterion) => criterion.key),
      );
      await applyHomeRubric({
        store,
        auditId,
        mockKeys,
        realKeys,
      });
      return {};
    }

    const assessed = assessedCriteriaForOutcome(outcome);
    if (assessed.length === 0) return {};

    const criteria: CriterionInput[] = assessed.map((criterion) => {
      const score = deterministicScore(auditId, criterion.key);
      return {
        criterion_key: criterion.key,
        criterion_name: criterion.name,
        pillar: criterion.pillar,
        score,
        weight: criterion.weight,
        rule_version: RULE_VERSION,
        findings: {
          assessed: true,
          score,
          passed: score >= 0.7,
          outcome: outcomeFromMockScore(score),
          mock: true,
          rule_version: RULE_VERSION,
        },
      };
    });

    await store.upsertCriteria(auditId, criteria);

    const pillars = PILLARS.flatMap((pillar) => {
      const pillarCriteria = criteria.filter((row) => row.pillar === pillar.key);
      if (pillarCriteria.length === 0) return [];
      const score =
        Math.round(
          (pillarCriteria.reduce((sum, row) => sum + row.score * row.weight, 0) /
            pillarCriteria.reduce((sum, row) => sum + row.weight, 0)) *
            100,
        ) / 100;
      return [
        {
          pillar_key: pillar.key,
          pillar_name: pillar.name,
          score,
          criteria_count: pillarCriteria.length,
          rule_version: RULE_VERSION,
          summary: `Mock ${outcome} summary for ${pillar.name}`,
        },
      ];
    });

    await store.upsertPillars(auditId, pillars);
  }

  if (toState === "generating_report" && writesReport(outcome)) {
    const criteria = await store.listCriteria(auditId);
    const pillars = await store.listPillars(auditId);
    const selected = selectRecommendations(criteria);
    const assembled = assembleReport({
      websiteUrl,
      criteria,
      pillars,
      recommendations: selected,
    });
    // The AI call is the one paid operation that reports what it actually
    // consumed, so it is priced from real token counts. Charged after the
    // call rather than through `spend` so the reported usage — summed across
    // the validation retry — is what lands in the ledger, falling back to the
    // configured estimate only if the provider reports nothing.
    const aiVerdict = await input.budget?.verdict();
    if (aiVerdict?.tripped) return killSwitchResult();

    let aiInputTokens = 0;
    let aiOutputTokens = 0;
    let aiUsageReported = false;
    const narrated = await narrateAssembledReport(assembled, {
      onUsage: (usage) => {
        aiUsageReported = true;
        aiInputTokens += usage.inputTokens ?? 0;
        aiOutputTokens += usage.outputTokens ?? 0;
      },
    });
    await input.budget?.charge({
      category: "ai_narration",
      operationKey: "ai:narration",
      ...(aiUsageReported
        ? {
            amountUsd: aiNarrationCostUsd({
              inputTokens: aiInputTokens,
              outputTokens: aiOutputTokens,
            }),
          }
        : {}),
    });
    const report = narrated.report;

    // Audit-level coverage resolution (decision #11 rule 5). Runs here, at
    // report finalization, because it needs the final page set. The Partial
    // verdict it produces is also what condition (c) of the auto-publication
    // rule means by "audit-level Partial", so it is computed first.
    const coverage = await assessPageCoverage(store, auditId);
    const provisionalState = resolveTerminalState({
      coverage,
      requiresPriorityReview: false,
    });

    // Shadow-mode only (decision #12 / Auto-publication threshold). The
    // verdict is computed and recorded for post-pilot analysis; it is never
    // consulted when choosing the publication status, which stays
    // review_required until a human publishes.
    const eligibility = evaluateAutoPublicationEligibility({
      criteria,
      auditState: provisionalState,
    });

    const resolvedState = resolveTerminalState({
      coverage,
      requiresPriorityReview: requiresPriorityReview(eligibility),
    });

    // Recorded whatever the resolved state turns out to be, so a Needs Review
    // audit does not lose its partial-coverage detail to the higher-precedence
    // state. The reviewer and the report both read from here.
    await store.recordEvent(auditId, PAGE_COVERAGE_RESOLVED_EVENT, {
      home_assessed: coverage.homeAssessed,
      assessed_page_types: coverage.assessedPageTypes,
      absent_page_types: coverage.absentPageTypes,
      expected_page_count: coverage.expectedPageCount,
      omitted_pages: coverage.omissions.map((omission) => ({
        page_type: omission.pageType,
        url: omission.url,
        reason_code: omission.reasonCode,
      })),
      provisional_state: provisionalState,
      resolved_state: resolvedState,
      needs_review_took_precedence:
        resolvedState === "needs_review" && provisionalState === "partial",
    });
    await store.recordEvent(auditId, AUTO_PUBLICATION_EVALUATED_EVENT, {
      eligible: eligibility.eligible,
      reasons: eligibility.reasons,
      metrics: eligibility.metrics,
      requires_priority_review: requiresPriorityReview(eligibility),
      auto_publish_enabled: isAutoPublishEnabled(),
      shadow_mode: true,
    });

    const reportId = await store.upsertReport(auditId, {
      overall_score: report.overallScore,
      executive_summary: report.executiveSummary,
      publication_status: publicationStatusFor(resolvedState),
      scoring_band_version: report.scoringBandVersion,
      score_band: report.band?.key ?? null,
      metadata: {
        assembled: report,
        rule_version: report.ruleVersion,
        scoring_band_version: report.scoringBandVersion,
        narration_source: narrated.source,
        auto_publication_eligibility: eligibility,
        page_coverage: coverage,
        resolved_terminal_state: resolvedState,
      },
    });

    if (report.recommendations.length > 0) {
      await store.upsertRecommendations(
        auditId,
        reportId,
        report.recommendations.map((row) => {
          const selectedRow = selected.find(
            (item) => item.criterion_key === row.criterion_key,
          );
          return toRecommendationInput({
            criterion_key: row.criterion_key,
            criterion_name: selectedRow?.criterion_name ?? row.criterion_key,
            pillar: row.pillar,
            outcome: "fail",
            severity_class: selectedRow?.severity_class ?? "growth_discovery",
            priority: row.priority,
            sort_order: selectedRow?.sort_order ?? 0,
            title: row.title,
            description: row.description,
            evidence_ids: row.evidence_ids,
            estimated_impact: selectedRow?.estimated_impact ?? "medium",
            implementation_difficulty:
              selectedRow?.implementation_difficulty ?? "medium",
          });
        }),
      );
    }

    return { resolveTo: resolvedState };
  }

  return {};
}
