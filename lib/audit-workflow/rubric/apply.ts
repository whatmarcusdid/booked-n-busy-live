import { createHash } from "crypto";
import type {
  AuditWorkflowStore,
  CriterionInput,
  EvidenceInput,
  PillarInput,
} from "../store";
import {
  CRITERIA_BY_PILLAR,
  PILLARS,
  type PillarKey,
} from "../types";
import {
  isRealHomeCheck,
  pillarSummary,
  pointsForOutcome,
  REAL_HOME_CHECKS,
  RULE_VERSION,
  scoreAssessedChecks,
  type CheckOutcome,
} from "./model";
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
import { assessSecurityHealth } from "./security-health";
import { assessWebsitePerformance } from "./website-performance";
import type { PerformanceSignal } from "./website-performance";

export function deterministicMockScore(auditId: string, key: string): number {
  const digest = createHash("sha256").update(`${auditId}:${key}`).digest();
  const unit = digest[0] / 255;
  return Math.round((0.58 + unit * 0.34) * 100) / 100;
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
  });
  const phoneOutcome = assessed
    ? phoneOutcomeFromSignal(signals?.phone)
    : "not_assessed";
  const conversionOutcome = assessed
    ? conversionOutcomeFromSignal(signals?.conversion)
    : "not_assessed";
  const seoOutcome = assessed
    ? seoOutcomeFromSignal(signals?.seo)
    : "not_assessed";
  const credentialsOutcome = assessed
    ? credentialsOutcomeFromSignal(signals?.credentials)
    : "not_assessed";
  const serviceAreaOutcome = assessed
    ? serviceAreaOutcomeFromSignal(signals?.serviceArea)
    : "not_assessed";
  const processOutcome = assessed
    ? processClarityOutcomeFromSignal(signals?.process)
    : "not_assessed";
  const faqOutcome = assessed
    ? faqOutcomeFromSignal(signals?.faq)
    : "not_assessed";
  const offerOutcome = assessed
    ? offerOutcomeFromSignal(signals?.offer)
    : "not_assessed";
  const performance = assessWebsitePerformance({
    homeAssessed: assessed,
    signal: performanceSignal(home?.metadata),
  });

  const securityPoints = pointsForOutcome(security.outcome);
  const phonePoints = pointsForOutcome(phoneOutcome);
  const conversionPoints = pointsForOutcome(conversionOutcome);
  const seoPoints = pointsForOutcome(seoOutcome);
  const credentialsPoints = pointsForOutcome(credentialsOutcome);
  const serviceAreaPoints = pointsForOutcome(serviceAreaOutcome);
  const processPoints = pointsForOutcome(processOutcome);
  const faqPoints = pointsForOutcome(faqOutcome);
  const offerPoints = pointsForOutcome(offerOutcome);
  const performancePoints = pointsForOutcome(performance.outcome);
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
    ? await writeCheckEvidence(input.store, input.auditId, home?.id ?? null, {
        key: "security_health",
        outcome: security.outcome,
        value: security.value,
        locator: security.locator,
        snippet: security.value,
        confidence: security.outcome === "not_assessed" ? 0 : 1,
        collectionMethod: "home_fetch_final_url",
        url: security.value,
      })
    : [];
  const phoneEvidence = writePhone
    ? await writeCheckEvidence(input.store, input.auditId, home?.id ?? null, {
        key: "phone_cta_visibility",
        outcome: phoneOutcome,
        value: signals?.phone?.value,
        locator: signals?.phone?.locator,
        snippet: signals?.phone?.snippet,
        confidence:
          phoneOutcome === "not_assessed"
            ? 0
            : signals?.phone?.kind === "tel_link"
              ? 0.95
              : 0.7,
        collectionMethod: "home_html_parse",
        url: signals?.phone?.kind === "tel_link" ? signals.phone.value : home?.url,
      })
    : [];
  const conversionEvidence = writeConversion
    ? await writeCheckEvidence(input.store, input.auditId, home?.id ?? null, {
        key: "quote_booking_cta_visibility",
        outcome: conversionOutcome,
        value: signals?.conversion?.value,
        locator: signals?.conversion?.locator,
        snippet: signals?.conversion?.snippet,
        confidence:
          conversionOutcome === "not_assessed"
            ? 0
            : signals?.conversion?.kind === "booking_host"
              ? 0.9
              : 0.85,
        collectionMethod: "home_html_parse",
        url: signals?.conversion?.kind === "booking_host"
          ? signals.conversion.value
          : home?.url,
      })
    : [];
  const seoSnippet = [signals?.seo?.title, signals?.seo?.metaDescription]
    .filter(Boolean)
    .join(" | ")
    .slice(0, 80);
  const seoEvidence = writeSeo
    ? await writeCheckEvidence(input.store, input.auditId, home?.id ?? null, {
        key: "seo_ai_search_readiness",
        outcome: seoOutcome,
        value:
          seoOutcome === "fail" && signals?.seo?.noindex
            ? "noindex"
            : (signals?.seo?.title || signals?.seo?.metaDescription || seoOutcome).slice(
                0,
                64,
              ),
        locator: "head",
        snippet: seoSnippet || seoOutcome,
        confidence: seoOutcome === "not_assessed" ? 0 : 0.95,
        collectionMethod: "home_html_parse",
        url: home?.url,
      })
    : [];
  const credentialsEvidence = writeCredentials
    ? await writeCheckEvidence(input.store, input.auditId, home?.id ?? null, {
        key: "license_insurance",
        outcome: credentialsOutcome,
        value: signals?.credentials?.value,
        locator: signals?.credentials?.locator,
        snippet: signals?.credentials?.snippet,
        confidence:
          credentialsOutcome === "not_assessed"
            ? 0
            : signals?.credentials?.kind === "credential_word"
              ? 0.85
              : signals?.credentials?.kind === "license_number"
                ? 0.7
                : 0.65,
        collectionMethod: "home_html_parse",
        url: home?.url,
      })
    : [];
  const serviceAreaEvidence = writeServiceArea
    ? await writeCheckEvidence(input.store, input.auditId, home?.id ?? null, {
        key: "service_area_clarity",
        outcome: serviceAreaOutcome,
        value: signals?.serviceArea?.value,
        locator: signals?.serviceArea?.locator,
        snippet: signals?.serviceArea?.snippet,
        confidence:
          serviceAreaOutcome === "not_assessed"
            ? 0
            : signals?.serviceArea?.kind === "radius"
              ? 0.9
              : 0.8,
        collectionMethod: "home_html_parse",
        url: home?.url,
      })
    : [];
  const processEvidence = writeProcess
    ? await writeCheckEvidence(input.store, input.auditId, home?.id ?? null, {
        key: "process_clarity",
        outcome: processOutcome,
        value: signals?.process?.value,
        locator: signals?.process?.locator,
        snippet: signals?.process?.snippet,
        confidence:
          processOutcome === "not_assessed"
            ? 0
            : signals?.process?.kind === "response_time"
              ? 0.85
              : 0.8,
        collectionMethod: "home_html_parse",
        url: home?.url,
      })
    : [];
  const faqEvidence = writeFaq
    ? await writeCheckEvidence(input.store, input.auditId, home?.id ?? null, {
        key: "faq_common_concerns",
        outcome: faqOutcome,
        value: signals?.faq?.value,
        locator: signals?.faq?.locator,
        snippet: signals?.faq?.snippet,
        confidence:
          faqOutcome === "not_assessed"
            ? 0
            : signals?.faq?.kind === "faqpage_jsonld"
              ? 0.95
              : signals?.faq?.kind === "faq_section"
                ? 0.85
                : 0.6,
        collectionMethod: "home_html_parse",
        url: home?.url,
      })
    : [];
  const offerEvidence = writeOffer
    ? await writeCheckEvidence(input.store, input.auditId, home?.id ?? null, {
        key: "offer_differentiation",
        outcome: offerOutcome,
        value: signals?.offer?.value,
        locator: signals?.offer?.locator,
        snippet: signals?.offer?.snippet,
        confidence:
          offerOutcome === "not_assessed"
            ? 0
            : signals?.offer?.kind === "guarantee" ||
                signals?.offer?.kind === "financing"
              ? 0.85
              : 0.8,
        collectionMethod: "home_html_parse",
        url: home?.url,
      })
    : [];
  const performanceEvidence = writePerformance
    ? await writeCheckEvidence(input.store, input.auditId, home?.id ?? null, {
        key: "website_performance",
        outcome: performance.outcome,
        value:
          typeof performance.signal?.score === "number"
            ? String(performance.signal.score)
            : performance.signal?.reason_code,
        locator: "categories.performance.score",
        snippet:
          typeof performance.signal?.score === "number"
            ? `performance score ${performance.signal.score}`
            : performance.signal?.reason_code,
        confidence: performance.outcome === "not_assessed" ? 0 : 0.95,
        collectionMethod: "browserless_performance",
        url: home?.url,
        extraMetadata: {
          score: performance.signal?.score,
          lcp_ms: performance.signal?.lcp_ms,
          tbt_ms: performance.signal?.tbt_ms,
          cls: performance.signal?.cls,
          reason_code: performance.signal?.reason_code,
        },
      })
    : [];

  const realRows: CriterionInput[] = [];
  if (writeSecurity) {
    realRows.push(
      criterionRow(
        REAL_HOME_CHECKS.security_health,
        security.outcome,
        securityPoints ?? 0,
        {
          protocol: security.signal?.protocol,
          final_url: security.value,
        },
        securityEvidence,
      ),
    );
  }
  if (writePhone) {
    realRows.push(
      criterionRow(
        REAL_HOME_CHECKS.phone_cta_visibility,
        phoneOutcome,
        phonePoints ?? 0,
        {
          kind: signals?.phone?.kind,
          locator: signals?.phone?.locator,
          prominent: signals?.phone?.prominent,
        },
        phoneEvidence,
      ),
    );
  }
  if (writeConversion) {
    realRows.push(
      criterionRow(
        REAL_HOME_CHECKS.quote_booking_cta_visibility,
        conversionOutcome,
        conversionPoints ?? 0,
        {
          kind: signals?.conversion?.kind,
          locator: signals?.conversion?.locator,
          prominent: signals?.conversion?.prominent,
        },
        conversionEvidence,
      ),
    );
  }
  if (writeSeo) {
    realRows.push(
      criterionRow(
        REAL_HOME_CHECKS.seo_ai_search_readiness,
        seoOutcome,
        seoPoints ?? 0,
        {
          title: signals?.seo?.title,
          title_ok: signals?.seo?.titleOk,
          meta_description: signals?.seo?.metaDescription,
          meta_ok: signals?.seo?.metaOk,
          noindex: signals?.seo?.noindex,
        },
        seoEvidence,
      ),
    );
  }
  if (writeCredentials) {
    realRows.push(
      criterionRow(
        REAL_HOME_CHECKS.license_insurance,
        credentialsOutcome,
        credentialsPoints ?? 0,
        {
          kind: signals?.credentials?.kind,
          locator: signals?.credentials?.locator,
          prominent: signals?.credentials?.prominent,
        },
        credentialsEvidence,
      ),
    );
  }
  if (writeServiceArea) {
    realRows.push(
      criterionRow(
        REAL_HOME_CHECKS.service_area_clarity,
        serviceAreaOutcome,
        serviceAreaPoints ?? 0,
        {
          kind: signals?.serviceArea?.kind,
          locator: signals?.serviceArea?.locator,
          prominent: signals?.serviceArea?.prominent,
        },
        serviceAreaEvidence,
      ),
    );
  }
  if (writeProcess) {
    realRows.push(
      criterionRow(
        REAL_HOME_CHECKS.process_clarity,
        processOutcome,
        processPoints ?? 0,
        {
          kind: signals?.process?.kind,
          locator: signals?.process?.locator,
          prominent: signals?.process?.prominent,
        },
        processEvidence,
      ),
    );
  }
  if (writeFaq) {
    realRows.push(
      criterionRow(
        REAL_HOME_CHECKS.faq_common_concerns,
        faqOutcome,
        faqPoints ?? 0,
        {
          kind: signals?.faq?.kind,
          locator: signals?.faq?.locator,
          prominent: signals?.faq?.prominent,
          pair_count: signals?.faq?.pairCount,
        },
        faqEvidence,
      ),
    );
  }
  if (writeOffer) {
    realRows.push(
      criterionRow(
        REAL_HOME_CHECKS.offer_differentiation,
        offerOutcome,
        offerPoints ?? 0,
        {
          kind: signals?.offer?.kind,
          locator: signals?.offer?.locator,
          prominent: signals?.offer?.prominent,
        },
        offerEvidence,
      ),
    );
  }
  if (writePerformance) {
    realRows.push(
      criterionRow(
        REAL_HOME_CHECKS.website_performance,
        performance.outcome,
        performancePoints ?? 0,
        {
          score: performance.signal?.score,
          lcp_ms: performance.signal?.lcp_ms,
          tbt_ms: performance.signal?.tbt_ms,
          cls: performance.signal?.cls,
          reason_code: performance.signal?.reason_code,
        },
        performanceEvidence,
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

  const all = [...realRows, ...mockRows];
  await input.store.upsertCriteria(input.auditId, all);

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
    if (assessedCount === 0 && !rows.some((row) => isRealHomeCheck(row.criterion_key))) {
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
