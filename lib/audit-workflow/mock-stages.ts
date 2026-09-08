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
import { isRealScanEnabled } from "../flags";
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

export function assessedCriteriaForOutcome(
  outcome: WorkflowTerminalState,
): Array<{ pillar: PillarKey; key: string; name: string; weight: number }> {
  if (!writesScores(outcome)) return [];

  const all = PILLARS.flatMap((pillar) =>
    CRITERIA_BY_PILLAR[pillar.key].map((criterion) => ({
      pillar: pillar.key,
      ...criterion,
    })),
  );

  if (outcome === "partial") {
    // Assess two checks per pillar; the rest stay unwritten (not assessed).
    return PILLARS.flatMap((pillar) =>
      CRITERIA_BY_PILLAR[pillar.key].slice(0, 2).map((criterion) => ({
        pillar: pillar.key,
        ...criterion,
      })),
    );
  }

  return all;
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

export type StageWorkResult = {
  abortTo?: WorkflowTerminalState;
  reasonCode?: string;
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

async function persistHomeFetchDiagnostic(
  store: AuditWorkflowStore,
  auditId: string,
  websiteUrl: string,
  diagnostic: HomeFetchDiagnostic,
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

async function discoverPages(input: {
  store: AuditWorkflowStore;
  auditId: string;
  websiteUrl: string;
  safetyDeps?: UrlSafetyDeps;
  realScanEnabled?: boolean;
  fetchHomePage?: FetchRenderedPage;
}): Promise<StageWorkResult> {
  const safety = await assessUrlSafety(input.websiteUrl, input.safetyDeps);
  if (!safety.ok) {
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

  const fetchHomePage = input.fetchHomePage ?? fetchBrowserlessContent;
  const fetched = await fetchHomePage({
    url: fetchSafety.normalizedUrl,
    timeoutMs: fetchSafety.bounds.maxFetchDurationMs,
    maxResponseBytes: fetchSafety.bounds.maxResponseBytes,
  });

  if (!fetched.ok) {
    const diagnostic = diagnosticFromFetchFailure(fetched);
    await persistHomeFetchDiagnostic(
      input.store,
      input.auditId,
      fetchSafety.normalizedUrl,
      diagnostic,
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

    const pageFetch = await fetchHomePage({
      url: pageSafety.normalizedUrl,
      timeoutMs: pageSafety.bounds.maxFetchDurationMs,
      maxResponseBytes: pageSafety.bounds.maxResponseBytes,
    });

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
  captureScreenshot?: CaptureScreenshot;
  fetchPerformance?: FetchPagePerformance;
  artifactStorage?: ArtifactStorage;
}): Promise<StageWorkResult> {
  const { store, auditId, websiteUrl, toState, outcome } = input;

  if (toState === "discovering") {
    return discoverPages(input);
  }

  if (toState === "rendering") {
    const realScan = input.realScanEnabled ?? isRealScanEnabled();
    if (realScan) {
      await captureAndStoreHomeScreenshot({
        store,
        auditId,
        websiteUrl,
        safetyDeps: input.safetyDeps,
        captureScreenshot: input.captureScreenshot,
        artifactStorage: input.artifactStorage,
      });
      await captureHomePerformance({
        store,
        auditId,
        websiteUrl,
        safetyDeps: input.safetyDeps,
        fetchPerformance: input.fetchPerformance,
      });
      for (const pageType of CATEGORY_PAGE_TYPES) {
        await captureAndStorePageScreenshots({
          store,
          auditId,
          websiteUrl,
          pageType,
          viewports: ["desktop"],
          safetyDeps: input.safetyDeps,
          captureScreenshot: input.captureScreenshot,
          artifactStorage: input.artifactStorage,
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
    const narrated = await narrateAssembledReport(assembled);
    const report = narrated.report;
    const reportId = await store.upsertReport(auditId, {
      overall_score: report.overallScore,
      executive_summary: report.executiveSummary,
      publication_status: publicationStatusFor(outcome),
      metadata: {
        assembled: report,
        rule_version: report.ruleVersion,
        narration_source: narrated.source,
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
            outcome: selectedRow?.outcome ?? "partial",
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
  }

  return {};
}
