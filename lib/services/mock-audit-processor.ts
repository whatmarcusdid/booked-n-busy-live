/**
 * Mock Audit Processor
 * Development-only utility for simulating the audit processing workflow
 * DO NOT USE IN PRODUCTION
 */

import { createAdminClient } from "../supabase/admin";

const AUDIT_STATES = [
  "submitted",
  "validating",
  "discovering",
  "rendering",
  "collecting_signals",
  "scoring",
  "generating_report",
  "validating_report",
  "complete",
] as const;

type AuditState = (typeof AUDIT_STATES)[number];

const PILLARS = [
  { key: "trust_signals", name: "Trust Signals" },
  { key: "lead_conversion", name: "Lead Conversion" },
  { key: "growth_infrastructure", name: "Growth Infrastructure" },
] as const;

const CRITERIA_BY_PILLAR = {
  trust_signals: [
    { key: "professionalism", name: "Professional Appearance", weight: 0.3 },
    { key: "credentials", name: "Credentials & Certifications", weight: 0.25 },
    { key: "reviews_testimonials", name: "Reviews & Testimonials", weight: 0.25 },
    { key: "security", name: "Security Indicators", weight: 0.2 },
  ],
  lead_conversion: [
    { key: "cta_clarity", name: "Call-to-Action Clarity", weight: 0.3 },
    { key: "contact_forms", name: "Contact Forms", weight: 0.25 },
    { key: "conversion_paths", name: "Conversion Paths", weight: 0.25 },
    { key: "social_proof", name: "Social Proof", weight: 0.2 },
  ],
  growth_infrastructure: [
    { key: "seo_basics", name: "SEO Fundamentals", weight: 0.3 },
    { key: "mobile_friendly", name: "Mobile Responsiveness", weight: 0.25 },
    { key: "page_speed", name: "Page Load Speed", weight: 0.25 },
    { key: "local_seo", name: "Local SEO", weight: 0.2 },
  ],
};

/**
 * Generate a random score between min and max
 */
function randomScore(min = 0.5, max = 0.95): number {
  return Math.round((Math.random() * (max - min) + min) * 100) / 100;
}

/**
 * Delay execution for specified milliseconds
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Transition audit to a new state
 */
async function transitionState(
  auditId: string,
  fromState: AuditState | null,
  toState: AuditState,
): Promise<void> {
  const supabase = createAdminClient();

  // Update audit current_state
  const { error: updateError } = await supabase
    .from("audits")
    .update({ current_state: toState })
    .eq("id", auditId);

  if (updateError) {
    throw new Error(`Failed to update audit state: ${updateError.message}`);
  }

  // Insert state transition
  const { error: transitionError } = await supabase
    .from("audit_state_transitions")
    .insert({
      audit_id: auditId,
      from_state: fromState,
      to_state: toState,
    });

  if (transitionError) {
    throw new Error(
      `Failed to insert state transition: ${transitionError.message}`,
    );
  }

  // Insert appropriate event
  await supabase.from("audit_events").insert({
    audit_id: auditId,
    event_type: `state_changed_to_${toState}`,
    event_data: {
      from_state: fromState,
      to_state: toState,
      timestamp: new Date().toISOString(),
    },
  });
}

/**
 * Create mock audit pages
 */
async function createMockPages(auditId: string, websiteUrl: string) {
  const supabase = createAdminClient();

  const pages = [
    { url: websiteUrl, page_type: "home", title: "Home" },
    { url: `${websiteUrl}/about`, page_type: "about", title: "About Us" },
    { url: `${websiteUrl}/services`, page_type: "services", title: "Services" },
    { url: `${websiteUrl}/contact`, page_type: "contact", title: "Contact" },
  ];

  for (const page of pages) {
    await supabase.from("audit_pages").insert({
      audit_id: auditId,
      ...page,
      meta_description: `Mock description for ${page.title}`,
      metadata: { mock: true },
    });
  }
}

/**
 * Create mock evidence
 */
async function createMockEvidence(auditId: string) {
  const supabase = createAdminClient();

  const evidenceItems = [
    {
      evidence_type: "screenshot",
      description: "Homepage screenshot",
      metadata: { page: "home", mock: true },
    },
    {
      evidence_type: "lighthouse_report",
      description: "Performance metrics",
      metadata: {
        performance: randomScore(0.6, 0.9),
        accessibility: randomScore(0.7, 0.95),
        mock: true,
      },
    },
  ];

  for (const evidence of evidenceItems) {
    await supabase.from("evidence").insert({
      audit_id: auditId,
      ...evidence,
    });
  }
}

/**
 * Create mock criterion results
 */
async function createMockCriterionResults(auditId: string) {
  const supabase = createAdminClient();

  for (const pillar of PILLARS) {
    const criteria = CRITERIA_BY_PILLAR[pillar.key];

    for (const criterion of criteria) {
      const score = randomScore(0.5, 0.95);

      await supabase.from("criterion_results").insert({
        audit_id: auditId,
        criterion_key: criterion.key,
        criterion_name: criterion.name,
        pillar: pillar.key,
        score,
        weight: criterion.weight,
        findings: {
          score,
          passed: score >= 0.7,
          issues: score < 0.7 ? ["Needs improvement"] : [],
          recommendations: ["Mock recommendation"],
          mock: true,
        },
      });
    }
  }
}

/**
 * Create mock pillar results
 */
async function createMockPillarResults(auditId: string) {
  const supabase = createAdminClient();

  for (const pillar of PILLARS) {
    const criteria = CRITERIA_BY_PILLAR[pillar.key];
    const score = randomScore(0.6, 0.9);

    await supabase.from("pillar_results").insert({
      audit_id: auditId,
      pillar_key: pillar.key,
      pillar_name: pillar.name,
      score,
      criteria_count: criteria.length,
      summary: `Mock summary for ${pillar.name}`,
    });
  }
}

/**
 * Create mock report revision
 */
async function createMockReport(auditId: string) {
  const supabase = createAdminClient();

  const overallScore = randomScore(0.65, 0.88);

  const { data: report, error } = await supabase
    .from("report_revisions")
    .insert({
      audit_id: auditId,
      revision_number: 1,
      overall_score: overallScore,
      executive_summary: `This website diagnostic reveals an overall performance score of ${Math.round(overallScore * 100)}%. Key areas for improvement have been identified across trust signals, lead conversion, and growth infrastructure.`,
      publication_status: "review_required",
      metadata: { mock: true },
    })
    .select()
    .single();

  if (error || !report) {
    throw new Error(`Failed to create report: ${error?.message}`);
  }

  return report.id;
}

/**
 * Create mock recommendations
 */
async function createMockRecommendations(
  auditId: string,
  reportRevisionId: string,
) {
  const supabase = createAdminClient();

  const recommendations = [
    {
      priority: "high",
      title: "Improve Mobile Responsiveness",
      description:
        "Your website needs optimization for mobile devices. Consider implementing responsive design patterns to ensure a consistent experience across all screen sizes.",
      pillar: "growth_infrastructure",
      estimated_impact: "high",
      implementation_difficulty: "medium",
      sort_order: 1,
    },
    {
      priority: "high",
      title: "Add Clear Call-to-Action Buttons",
      description:
        "Make it easier for visitors to take action by adding prominent, well-placed call-to-action buttons on key pages.",
      pillar: "lead_conversion",
      estimated_impact: "high",
      implementation_difficulty: "low",
      sort_order: 2,
    },
    {
      priority: "medium",
      title: "Optimize Page Load Speed",
      description:
        "Reduce page load times by optimizing images, minimizing CSS/JS, and leveraging browser caching.",
      pillar: "growth_infrastructure",
      estimated_impact: "medium",
      implementation_difficulty: "medium",
      sort_order: 3,
    },
  ];

  for (const rec of recommendations) {
    await supabase.from("recommendations").insert({
      audit_id: auditId,
      report_revision_id: reportRevisionId,
      ...rec,
    });
  }
}

/**
 * Process an audit through all states with mock data
 * FOR DEVELOPMENT USE ONLY
 */
export async function processMockAudit(auditId: string): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Mock processor cannot be used in production");
  }

  const supabase = createAdminClient();

  // Get audit details
  const { data: audit, error: auditError } = await supabase
    .from("audits")
    .select("id, website_url, current_state")
    .eq("id", auditId)
    .single();

  if (auditError || !audit) {
    throw new Error(`Audit not found: ${auditId}`);
  }

  // Start from current state
  const currentIndex = AUDIT_STATES.indexOf(
    audit.current_state as AuditState,
  );
  if (currentIndex === -1) {
    throw new Error(`Invalid current state: ${audit.current_state}`);
  }

  // Process through remaining states
  for (let i = currentIndex + 1; i < AUDIT_STATES.length; i++) {
    const fromState = AUDIT_STATES[i - 1];
    const toState = AUDIT_STATES[i];

    console.log(`[Mock Processor] ${auditId}: ${fromState} -> ${toState}`);

    // Simulate processing delay
    await delay(500);

    // Transition to new state
    await transitionState(auditId, fromState, toState);

    // Create mock data at specific states
    if (toState === "discovering") {
      await createMockPages(auditId, audit.website_url);
    }

    if (toState === "rendering") {
      await createMockEvidence(auditId);
    }

    if (toState === "scoring") {
      await createMockCriterionResults(auditId);
      await createMockPillarResults(auditId);
    }

    if (toState === "generating_report") {
      const reportId = await createMockReport(auditId);
      await createMockRecommendations(auditId, reportId);
    }

    if (toState === "complete") {
      await supabase.from("audit_events").insert({
        audit_id: auditId,
        event_type: "processing_completed",
        event_data: {
          duration_ms: 5000,
          timestamp: new Date().toISOString(),
          mock: true,
        },
      });
    }
  }

  console.log(`[Mock Processor] ${auditId}: Processing complete`);
}
