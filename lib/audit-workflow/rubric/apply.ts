import { createHash } from "crypto";
import type {
  AuditWorkflowStore,
  CriterionInput,
  EvidenceInput,
  PillarInput,
} from "../store";
import { CRITERIA_BY_PILLAR, PILLARS, type PillarKey } from "../types";
import {
  isRealHomeCheck,
  pillarSummary,
  pointsForOutcome,
  REAL_HOME_CHECKS,
  RULE_VERSION,
  scoreAssessedChecks,
  type CheckOutcome,
} from "./model";
import { confidenceLabelFromScore } from "./confidence";
import {
  needsReviewFindings,
  needsReviewVerdict,
  type NeedsReviewRecord,
} from "./needs-review";
import {
  conversionOutcomeFromSignal,
  credentialsOutcomeFromSignal,
  phoneOutcomeFromSignal,
  processClarityOutcomeFromSignal,
  seoOutcomeFromSignal,
  serviceAreaOutcomeFromSignal,
  faqOutcomeFromSignal,
  offerOutcomeFromSignal,
  type HomeScoringSignals,
} from "./signals";
import { outcomeFromMockScore } from "../recommendations";
import { persistCriteriaByGroup } from "../progress-groups";
import { assessSecurityHealth, isHttpsDowngrade } from "./security-health";
import { assessWebsitePerformance } from "./website-performance";
import type { PerformanceSignal } from "./website-performance";

export function deterministicMockScore(auditId: string, key: string): number {
  const digest = createHash("sha256").update(`${auditId}:${key}`).digest();
  const unit = digest[0] / 255;
  return Math.round((0.58 + unit * 0.34) * 100) / 100;
}

/**
 * Confidence for one check (PRD Section 7 confidence labels).
 *
 * `positiveConfidence` discounts for INTERPRETATION ambiguity — how sure we
 * are that a signal we matched actually means what we think (a keyword near
 * the top of the page is weaker evidence than a `tel:` link or JSON-LD block).
 *
 * A `fail` carries no such ambiguity. Every real check fails only on a
 * definitive negative fact observed across the whole fetched homepage: no
 * signal found at all, an explicit `noindex`, or a non-HTTPS resolved URL.
 * That is "direct technical evidence supports the finding", so a fail is
 * `high` confidence. This is also what makes the locked Fix First severity
 * classes reachable — decision #12 places `phone_cta_visibility` and
 * `quote_booking_cta_visibility` in the second-highest class, which would be
 * unreachable if an absence-based fail were discounted to medium.
 */
function checkConfidence(
  outcome: CheckOutcome,
  positiveConfidence: number,
): number {
  if (outcome === "not_assessed" || outcome === "needs_review") return 0;
  if (outcome === "fail") return 1;
  return positiveConfidence;
}

function homeSignals(
  metadata: Record<string, unknown> | undefined,
): HomeScoringSignals | undefined {
  const raw = metadata?.scoring_signals;
  if (!raw || typeof raw !== "object") return undefined;
  return raw as HomeScoringSignals;
}

function homeWasAssessed(
  metadata: Record<string, unknown> | undefined,
): boolean {
  return metadata?.assessed === true && metadata?.mock !== true;
}

function performanceSignal(
  metadata: Record<string, unknown> | undefined,
): PerformanceSignal | undefined {
  const raw = metadata?.performance;
  if (!raw || typeof raw !== "object") return undefined;
  return raw as PerformanceSignal;
}

async function writeCheckEvidence(
  store: AuditWorkflowStore,
  auditId: string,
  pageId: string | null,
  /**
   * Escalations keyed by criterion. The reason code is written onto the
   * evidence row as well as the criterion, so a reviewer reading the evidence
   * viewer sees WHY a check was escalated, not just that it was.
   */
  reviews: Map<string, NeedsReviewRecord>,
  item: {
    key: keyof typeof REAL_HOME_CHECKS;
    outcome: CheckOutcome;
    value?: string;
    locator?: string;
    snippet?: string;
    confidence: number;
    collectionMethod: string;
    url?: string;
    artifactId?: string | null;
    extraMetadata?: Record<string, unknown>;
  },
): Promise<string[]> {
  const def = REAL_HOME_CHECKS[item.key];
  const review = reviews.get(def.key);
  const evidence: EvidenceInput = {
    mock_key: `rubric:${RULE_VERSION}:${item.key}`,
    evidence_type: item.key,
    url: item.url ?? null,
    artifact_id: item.artifactId ?? null,
    description: (item.snippet ?? item.value ?? item.outcome).slice(0, 120),
    metadata: {
      mock: false,
      criterion_key: def.key,
      page_id: pageId,
      value: item.value ?? item.outcome,
      locator: item.locator ?? null,
      confidence: item.confidence,
      collection_method: item.collectionMethod,
      outcome: item.outcome,
      rule_version: RULE_VERSION,
      ...(review ? needsReviewFindings(review) : {}),
      ...item.extraMetadata,
    },
  };
  return store.upsertEvidence(auditId, [evidence]);
}

function criterionRow(
  def: { key: string; name: string; pillar: string; weight: number },
  outcome: CheckOutcome,
  points: number,
  extraFindings: Record<string, unknown>,
  evidenceIds: string[],
  /**
   * Numeric confidence from the check's evidence row. Persisted onto the
   * criterion as a label so Fix First eligibility can be evaluated without
   * re-joining evidence at report time.
   */
  confidence: number,
): CriterionInput {
  return {
    criterion_key: def.key,
    criterion_name: def.name,
    pillar: def.pillar,
    score: points,
    weight: def.weight,
    rule_version: RULE_VERSION,
    evidence_ids: evidenceIds,
    findings: {
      assessed: outcome !== "not_assessed" && outcome !== "needs_review",
      outcome,
      confidence: confidenceLabelFromScore(confidence),
      confidence_score: confidence,
      rule_version: RULE_VERSION,
      mock: false,
      ...extraFindings,
    },
  };
}

function mockCriterion(
  auditId: string,
  pillar: PillarKey,
  key: string,
  name: string,
  weight: number,
): CriterionInput {
  const score = deterministicMockScore(auditId, key);
  return {
    criterion_key: key,
    criterion_name: name,
    pillar,
    score,
    weight,
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
}

export async function applyHomeRubric(input: {
  store: AuditWorkflowStore;
  auditId: string;
  /** When set, only these mock keys are written (plus the real home checks). */
  mockKeys?: Set<string>;
  /** When set, only these real checks are written. Default: all real home checks. */
  realKeys?: Set<string>;
}): Promise<void> {
  const home = await input.store.findPage(input.auditId, "home");
  const assessed = homeWasAssessed(home?.metadata);
  const signals = homeSignals(home?.metadata);

  const security = assessSecurityHealth({
    homeAssessed: assessed,
    finalUrl: signals?.finalUrl ?? (assessed ? home?.url : undefined),
    probe: signals?.securityProbe,
  });
  // `raw*` is what the signal supports before any `needs_review` escalation.
  // Everything downstream uses the resolved `*Check.outcome` below.
  const rawPhoneOutcome = assessed
    ? phoneOutcomeFromSignal(signals?.phone)
    : "not_assessed";
  const rawConversionOutcome = assessed
    ? conversionOutcomeFromSignal(signals?.conversion)
    : "not_assessed";
  const rawSeoOutcome = assessed
    ? seoOutcomeFromSignal(signals?.seo)
    : "not_assessed";
  const rawCredentialsOutcome = assessed
    ? credentialsOutcomeFromSignal(signals?.credentials)
    : "not_assessed";
  const rawServiceAreaOutcome = assessed
    ? serviceAreaOutcomeFromSignal(signals?.serviceArea)
    : "not_assessed";
  const rawProcessOutcome = assessed
    ? processClarityOutcomeFromSignal(signals?.process)
    : "not_assessed";
  const rawFaqOutcome = assessed
    ? faqOutcomeFromSignal(signals?.faq)
    : "not_assessed";
  const rawOfferOutcome = assessed
    ? offerOutcomeFromSignal(signals?.offer)
    : "not_assessed";
  const performance = assessWebsitePerformance({
    homeAssessed: assessed,
    signal: performanceSignal(home?.metadata),
  });

  /**
   * The one place a check is escalated to `needs_review`.
   *
   * It runs before points, evidence, and criterion rows are derived, so all
   * three describe the same outcome — an evidence row asserting `pass` beside
   * a criterion row saying `needs_review` would itself be one of the
   * contradictions trigger 2 exists to catch.
   */
  const reviews = new Map<string, NeedsReviewRecord>();

  function resolveCheck(
    criterionKey: string,
    rawOutcome: CheckOutcome,
    positiveConfidence: number,
    extra: {
      findings?: Record<string, unknown>;
      signalAmbiguity?: string | null;
    } = {},
  ): { outcome: CheckOutcome; confidence: number } {
    const rawConfidence = checkConfidence(rawOutcome, positiveConfidence);
    const verdict = needsReviewVerdict({
      criterionKey,
      outcome: rawOutcome,
      confidenceScore: rawConfidence,
      findings: extra.findings,
      signalAmbiguity: extra.signalAmbiguity,
    });
    if (!verdict) {
      return { outcome: rawOutcome, confidence: rawConfidence };
    }

    reviews.set(criterionKey, {
      ...verdict,
      preReviewOutcome: rawOutcome,
      preReviewConfidence: rawConfidence,
    });
    // An escalated check carries zero confidence, which labels as
    // `not_assessed` — Section 7's "could not interpret the evidence", which
    // is precisely what `needs_review` means. The suppressed number survives
    // on the record as `pre_review_confidence`.
    return { outcome: "needs_review", confidence: 0 };
  }

  const securityCheck = resolveCheck("security_health", security.outcome, 1, {
    findings: {
      protocol: security.signal?.protocol ?? signals?.protocol,
      reason_code: security.signal?.reasonCode,
    },
  });
  const phoneCheck = resolveCheck(
    "phone_cta_visibility",
    rawPhoneOutcome,
    signals?.phone?.kind === "tel_link" ? 0.95 : 0.7,
    { signalAmbiguity: signals?.phone?.ambiguityDetail ?? null },
  );
  const conversionCheck = resolveCheck(
    "quote_booking_cta_visibility",
    rawConversionOutcome,
    signals?.conversion?.kind === "booking_host" ? 0.9 : 0.85,
    { signalAmbiguity: signals?.conversion?.ambiguityDetail ?? null },
  );
  const seoCheck = resolveCheck(
    "seo_ai_search_readiness",
    rawSeoOutcome,
    0.95,
    {
      findings: { noindex: signals?.seo?.noindex },
    },
  );
  const credentialsCheck = resolveCheck(
    "license_insurance",
    rawCredentialsOutcome,
    signals?.credentials?.kind === "credential_word"
      ? 0.85
      : signals?.credentials?.kind === "license_number"
        ? 0.7
        : 0.65,
  );
  const serviceAreaCheck = resolveCheck(
    "service_area_clarity",
    rawServiceAreaOutcome,
    signals?.serviceArea?.kind === "radius" ? 0.9 : 0.8,
  );
  const processCheck = resolveCheck(
    "process_clarity",
    rawProcessOutcome,
    signals?.process?.kind === "response_time" ? 0.85 : 0.8,
  );
  const faqCheck = resolveCheck(
    "faq_common_concerns",
    rawFaqOutcome,
    signals?.faq?.kind === "faqpage_jsonld"
      ? 0.95
      : signals?.faq?.kind === "faq_section"
        ? 0.85
        : 0.6,
  );
  const offerCheck = resolveCheck(
    "offer_differentiation",
    rawOfferOutcome,
    signals?.offer?.kind === "guarantee" || signals?.offer?.kind === "financing"
      ? 0.85
      : 0.8,
  );
  const performanceCheck = resolveCheck(
    "website_performance",
    performance.outcome,
    0.95,
  );

  const securityPoints = pointsForOutcome(securityCheck.outcome);
  const phonePoints = pointsForOutcome(phoneCheck.outcome);
  const conversionPoints = pointsForOutcome(conversionCheck.outcome);
  const seoPoints = pointsForOutcome(seoCheck.outcome);
  const credentialsPoints = pointsForOutcome(credentialsCheck.outcome);
  const serviceAreaPoints = pointsForOutcome(serviceAreaCheck.outcome);
  const processPoints = pointsForOutcome(processCheck.outcome);
  const faqPoints = pointsForOutcome(faqCheck.outcome);
  const offerPoints = pointsForOutcome(offerCheck.outcome);
  const performancePoints = pointsForOutcome(performanceCheck.outcome);

  // One confidence value per check, shared by its evidence row and its
  // criterion row so the two can never disagree.
  const securityConfidence = securityCheck.confidence;
  const phoneConfidence = phoneCheck.confidence;
  const conversionConfidence = conversionCheck.confidence;
  const seoConfidence = seoCheck.confidence;
  const credentialsConfidence = credentialsCheck.confidence;
  const serviceAreaConfidence = serviceAreaCheck.confidence;
  const processConfidence = processCheck.confidence;
  const faqConfidence = faqCheck.confidence;
  const offerConfidence = offerCheck.confidence;
  const performanceConfidence = performanceCheck.confidence;
  const writeSecurity =
    !input.realKeys || input.realKeys.has("security_health");
  const writePhone =
    !input.realKeys || input.realKeys.has("phone_cta_visibility");
  const writeConversion =
    !input.realKeys || input.realKeys.has("quote_booking_cta_visibility");
  const writeSeo =
    !input.realKeys || input.realKeys.has("seo_ai_search_readiness");
  const writeCredentials =
    !input.realKeys || input.realKeys.has("license_insurance");
  const writeServiceArea =
    !input.realKeys || input.realKeys.has("service_area_clarity");
  const writeProcess = !input.realKeys || input.realKeys.has("process_clarity");
  const writeFaq = !input.realKeys || input.realKeys.has("faq_common_concerns");
  const writeOffer =
    !input.realKeys || input.realKeys.has("offer_differentiation");
  const writePerformance =
    !input.realKeys || input.realKeys.has("website_performance");

  const securityEvidence = writeSecurity
    ? await writeCheckEvidence(
        input.store,
        input.auditId,
        home?.id ?? null,
        reviews,
        {
          key: "security_health",
          outcome: securityCheck.outcome,
          value: security.value,
          locator: security.locator,
          snippet: security.value,
          confidence: securityConfidence,
          collectionMethod:
            security.locator === "https_scheme_probe"
              ? "https_scheme_probe"
              : "home_fetch_final_url",
          url: security.value,
          extraMetadata: {
            reason_code: security.signal?.reasonCode,
            schemes: security.signal?.schemes,
            https_attempt: security.signal?.httpsAttempt,
            used_http_fallback: security.signal?.usedHttpFallback,
          },
        },
      )
    : [];
  const phoneEvidence = writePhone
    ? await writeCheckEvidence(
        input.store,
        input.auditId,
        home?.id ?? null,
        reviews,
        {
          key: "phone_cta_visibility",
          outcome: phoneCheck.outcome,
          value: signals?.phone?.value,
          locator: signals?.phone?.locator,
          snippet: signals?.phone?.snippet,
          confidence: phoneConfidence,
          collectionMethod: "home_html_parse",
          url:
            signals?.phone?.kind === "tel_link"
              ? signals.phone.value
              : home?.url,
        },
      )
    : [];
  const conversionEvidence = writeConversion
    ? await writeCheckEvidence(
        input.store,
        input.auditId,
        home?.id ?? null,
        reviews,
        {
          key: "quote_booking_cta_visibility",
          outcome: conversionCheck.outcome,
          value: signals?.conversion?.value,
          locator: signals?.conversion?.locator,
          snippet: signals?.conversion?.snippet,
          confidence: conversionConfidence,
          collectionMethod: "home_html_parse",
          url:
            signals?.conversion?.kind === "booking_host"
              ? signals.conversion.value
              : home?.url,
        },
      )
    : [];
  const seoSnippet = [signals?.seo?.title, signals?.seo?.metaDescription]
    .filter(Boolean)
    .join(" | ")
    .slice(0, 80);
  const seoEvidence = writeSeo
    ? await writeCheckEvidence(
        input.store,
        input.auditId,
        home?.id ?? null,
        reviews,
        {
          key: "seo_ai_search_readiness",
          outcome: seoCheck.outcome,
          value:
            seoCheck.outcome === "fail" && signals?.seo?.noindex
              ? "noindex"
              : (
                  signals?.seo?.title ||
                  signals?.seo?.metaDescription ||
                  seoCheck.outcome
                ).slice(0, 64),
          locator: "head",
          snippet: seoSnippet || seoCheck.outcome,
          confidence: seoConfidence,
          collectionMethod: "home_html_parse",
          url: home?.url,
        },
      )
    : [];
  const credentialsEvidence = writeCredentials
    ? await writeCheckEvidence(
        input.store,
        input.auditId,
        home?.id ?? null,
        reviews,
        {
          key: "license_insurance",
          outcome: credentialsCheck.outcome,
          value: signals?.credentials?.value,
          locator: signals?.credentials?.locator,
          snippet: signals?.credentials?.snippet,
          confidence: credentialsConfidence,
          collectionMethod: "home_html_parse",
          url: home?.url,
        },
      )
    : [];
  const serviceAreaEvidence = writeServiceArea
    ? await writeCheckEvidence(
        input.store,
        input.auditId,
        home?.id ?? null,
        reviews,
        {
          key: "service_area_clarity",
          outcome: serviceAreaCheck.outcome,
          value: signals?.serviceArea?.value,
          locator: signals?.serviceArea?.locator,
          snippet: signals?.serviceArea?.snippet,
          confidence: serviceAreaConfidence,
          collectionMethod: "home_html_parse",
          url: home?.url,
        },
      )
    : [];
  const processEvidence = writeProcess
    ? await writeCheckEvidence(
        input.store,
        input.auditId,
        home?.id ?? null,
        reviews,
        {
          key: "process_clarity",
          outcome: processCheck.outcome,
          value: signals?.process?.value,
          locator: signals?.process?.locator,
          snippet: signals?.process?.snippet,
          confidence: processConfidence,
          collectionMethod: "home_html_parse",
          url: home?.url,
        },
      )
    : [];
  const faqEvidence = writeFaq
    ? await writeCheckEvidence(
        input.store,
        input.auditId,
        home?.id ?? null,
        reviews,
        {
          key: "faq_common_concerns",
          outcome: faqCheck.outcome,
          value: signals?.faq?.value,
          locator: signals?.faq?.locator,
          snippet: signals?.faq?.snippet,
          confidence: faqConfidence,
          collectionMethod: "home_html_parse",
          url: home?.url,
        },
      )
    : [];
  const offerEvidence = writeOffer
    ? await writeCheckEvidence(
        input.store,
        input.auditId,
        home?.id ?? null,
        reviews,
        {
          key: "offer_differentiation",
          outcome: offerCheck.outcome,
          value: signals?.offer?.value,
          locator: signals?.offer?.locator,
          snippet: signals?.offer?.snippet,
          confidence: offerConfidence,
          collectionMethod: "home_html_parse",
          url: home?.url,
        },
      )
    : [];
  const performanceEvidence = writePerformance
    ? await writeCheckEvidence(
        input.store,
        input.auditId,
        home?.id ?? null,
        reviews,
        {
          key: "website_performance",
          outcome: performanceCheck.outcome,
          value:
            typeof performance.signal?.score === "number"
              ? String(performance.signal.score)
              : performance.signal?.reason_code,
          locator: "categories.performance.score",
          snippet:
            typeof performance.signal?.score === "number"
              ? `performance score ${performance.signal.score}`
              : performance.signal?.reason_code,
          confidence: performanceConfidence,
          collectionMethod: "browserless_performance",
          url: home?.url,
          extraMetadata: {
            score: performance.signal?.score,
            lcp_ms: performance.signal?.lcp_ms,
            tbt_ms: performance.signal?.tbt_ms,
            cls: performance.signal?.cls,
            reason_code: performance.signal?.reason_code,
          },
        },
      )
    : [];

  const realRows: CriterionInput[] = [];
  if (writeSecurity) {
    realRows.push(
      criterionRow(
        REAL_HOME_CHECKS.security_health,
        securityCheck.outcome,
        securityPoints ?? 0,
        {
          protocol: security.signal?.protocol,
          final_url: security.value,
          reason_code: security.signal?.reasonCode,
          schemes: security.signal?.schemes,
          // An HTTPS→HTTP redirect is something the site configured against
          // itself, not mere absence of a listener. Decision #12 gives
          // active misconfigurations the top Fix First severity class.
          active_misconfiguration:
            securityCheck.outcome === "fail" &&
            isHttpsDowngrade(security.signal?.reasonCode),
        },
        securityEvidence,
        securityConfidence,
      ),
    );
  }
  if (writePhone) {
    realRows.push(
      criterionRow(
        REAL_HOME_CHECKS.phone_cta_visibility,
        phoneCheck.outcome,
        phonePoints ?? 0,
        {
          kind: signals?.phone?.kind,
          locator: signals?.phone?.locator,
          prominent: signals?.phone?.prominent,
        },
        phoneEvidence,
        phoneConfidence,
      ),
    );
  }
  if (writeConversion) {
    realRows.push(
      criterionRow(
        REAL_HOME_CHECKS.quote_booking_cta_visibility,
        conversionCheck.outcome,
        conversionPoints ?? 0,
        {
          kind: signals?.conversion?.kind,
          locator: signals?.conversion?.locator,
          prominent: signals?.conversion?.prominent,
        },
        conversionEvidence,
        conversionConfidence,
      ),
    );
  }
  if (writeSeo) {
    realRows.push(
      criterionRow(
        REAL_HOME_CHECKS.seo_ai_search_readiness,
        seoCheck.outcome,
        seoPoints ?? 0,
        {
          title: signals?.seo?.title,
          title_ok: signals?.seo?.titleOk,
          meta_description: signals?.seo?.metaDescription,
          meta_ok: signals?.seo?.metaOk,
          noindex: signals?.seo?.noindex,
          // A `noindex` directive is something the site actively configured
          // to suppress itself, not a missing signal. Decision #12 gives
          // active misconfigurations the top Fix First severity class
          // regardless of which pillar the check belongs to.
          active_misconfiguration:
            seoCheck.outcome === "fail" && signals?.seo?.noindex === true,
        },
        seoEvidence,
        seoConfidence,
      ),
    );
  }
  if (writeCredentials) {
    realRows.push(
      criterionRow(
        REAL_HOME_CHECKS.license_insurance,
        credentialsCheck.outcome,
        credentialsPoints ?? 0,
        {
          kind: signals?.credentials?.kind,
          locator: signals?.credentials?.locator,
          prominent: signals?.credentials?.prominent,
        },
        credentialsEvidence,
        credentialsConfidence,
      ),
    );
  }
  if (writeServiceArea) {
    realRows.push(
      criterionRow(
        REAL_HOME_CHECKS.service_area_clarity,
        serviceAreaCheck.outcome,
        serviceAreaPoints ?? 0,
        {
          kind: signals?.serviceArea?.kind,
          locator: signals?.serviceArea?.locator,
          prominent: signals?.serviceArea?.prominent,
        },
        serviceAreaEvidence,
        serviceAreaConfidence,
      ),
    );
  }
  if (writeProcess) {
    realRows.push(
      criterionRow(
        REAL_HOME_CHECKS.process_clarity,
        processCheck.outcome,
        processPoints ?? 0,
        {
          kind: signals?.process?.kind,
          locator: signals?.process?.locator,
          prominent: signals?.process?.prominent,
        },
        processEvidence,
        processConfidence,
      ),
    );
  }
  if (writeFaq) {
    realRows.push(
      criterionRow(
        REAL_HOME_CHECKS.faq_common_concerns,
        faqCheck.outcome,
        faqPoints ?? 0,
        {
          kind: signals?.faq?.kind,
          locator: signals?.faq?.locator,
          prominent: signals?.faq?.prominent,
          pair_count: signals?.faq?.pairCount,
        },
        faqEvidence,
        faqConfidence,
      ),
    );
  }
  if (writeOffer) {
    realRows.push(
      criterionRow(
        REAL_HOME_CHECKS.offer_differentiation,
        offerCheck.outcome,
        offerPoints ?? 0,
        {
          kind: signals?.offer?.kind,
          locator: signals?.offer?.locator,
          prominent: signals?.offer?.prominent,
        },
        offerEvidence,
        offerConfidence,
      ),
    );
  }
  if (writePerformance) {
    realRows.push(
      criterionRow(
        REAL_HOME_CHECKS.website_performance,
        performanceCheck.outcome,
        performancePoints ?? 0,
        {
          score: performance.signal?.score,
          lcp_ms: performance.signal?.lcp_ms,
          tbt_ms: performance.signal?.tbt_ms,
          cls: performance.signal?.cls,
          reason_code: performance.signal?.reason_code,
        },
        performanceEvidence,
        performanceConfidence,
      ),
    );
  }

  const mockRows: CriterionInput[] = [];
  for (const pillar of PILLARS) {
    for (const criterion of CRITERIA_BY_PILLAR[pillar.key]) {
      if (isRealHomeCheck(criterion.key)) continue;
      if (input.mockKeys && !input.mockKeys.has(criterion.key)) continue;
      mockRows.push(
        mockCriterion(
          input.auditId,
          pillar.key,
          criterion.key,
          criterion.name,
          criterion.weight,
        ),
      );
    }
  }

  // Reason codes are merged in one place rather than at each of the ten
  // criterion call sites, so a new check cannot be added without them.
  const reviewedRows = realRows.map((row) => {
    const review = reviews.get(row.criterion_key);
    if (!review) return row;
    return {
      ...row,
      findings: { ...row.findings, ...needsReviewFindings(review) },
    };
  });

  const all = [...reviewedRows, ...mockRows];
  await persistCriteriaByGroup(all, (rows) =>
    input.store.upsertCriteria(input.auditId, rows),
  );

  const pillars: PillarInput[] = PILLARS.flatMap((pillar) => {
    const rows = all.filter((row) => row.pillar === pillar.key);
    if (rows.length === 0) return [];
    const points = rows.map((row) => {
      // Mock rows keep their continuous score in the pillar average.
      // Mapping them through pass/partial/fail bands would change stored
      // pillar scores and is not part of recommendation eligibility.
      if (row.findings.mock === true) {
        return row.findings.assessed === true ? row.score : null;
      }
      const outcome = row.findings.outcome;
      if (typeof outcome === "string") {
        return pointsForOutcome(outcome as CheckOutcome);
      }
      return row.findings.assessed === true ? row.score : null;
    });
    const { score, assessedCount } = scoreAssessedChecks(points);
    if (
      assessedCount === 0 &&
      !rows.some((row) => isRealHomeCheck(row.criterion_key))
    ) {
      return [];
    }
    return [
      {
        pillar_key: pillar.key,
        pillar_name: pillar.name,
        score,
        criteria_count: assessedCount,
        rule_version: RULE_VERSION,
        summary: pillarSummary(pillar.name, assessedCount),
      },
    ];
  });

  await input.store.upsertPillars(input.auditId, pillars);
}

export function mockKeysForAffectedPillars(): Set<string> {
  const keys = new Set<string>();
  for (const pillar of [
    "lead_conversion",
    "growth_infrastructure",
    "trust_signals",
  ] as const) {
    for (const criterion of CRITERIA_BY_PILLAR[pillar]) {
      if (!isRealHomeCheck(criterion.key)) keys.add(criterion.key);
    }
  }
  return keys;
}
