-- Ring 1 schema hardening: approved product decisions
-- Local-only. Do not VALIDATE CONSTRAINT in this pass.

-- 2. Raw email on leads (nullable, no backfill)
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS email TEXT;

-- 4. Legacy array on recommendations (already exists on criterion_results)
ALTER TABLE recommendations
  ADD COLUMN IF NOT EXISTS evidence_ids UUID[];

-- 4. Evidence junction tables (write path unchanged in this pass)
CREATE TABLE IF NOT EXISTS criterion_result_evidence (
  criterion_result_id UUID NOT NULL REFERENCES criterion_results(id) ON DELETE CASCADE,
  evidence_id UUID NOT NULL REFERENCES evidence(id) ON DELETE CASCADE,
  PRIMARY KEY (criterion_result_id, evidence_id)
);

CREATE TABLE IF NOT EXISTS recommendation_evidence (
  recommendation_id UUID NOT NULL REFERENCES recommendations(id) ON DELETE CASCADE,
  evidence_id UUID NOT NULL REFERENCES evidence(id) ON DELETE CASCADE,
  PRIMARY KEY (recommendation_id, evidence_id)
);

CREATE INDEX IF NOT EXISTS idx_criterion_result_evidence_evidence_id
  ON criterion_result_evidence(evidence_id);

CREATE INDEX IF NOT EXISTS idx_recommendation_evidence_evidence_id
  ON recommendation_evidence(evidence_id);

ALTER TABLE criterion_result_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE recommendation_evidence ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON criterion_result_evidence
  FOR ALL TO service_role USING (true);

CREATE POLICY "Service role full access" ON recommendation_evidence
  FOR ALL TO service_role USING (true);

-- 1. Pillar model: exactly three keys (NOT VALID — existing mock rows may use legacy keys)
ALTER TABLE pillar_results
  ADD CONSTRAINT pillar_results_pillar_key_allowed
  CHECK (
    pillar_key IN (
      'trust_signals',
      'lead_conversion',
      'growth_infrastructure'
    )
  ) NOT VALID;

ALTER TABLE criterion_results
  ADD CONSTRAINT criterion_results_pillar_allowed
  CHECK (
    pillar IN (
      'trust_signals',
      'lead_conversion',
      'growth_infrastructure'
    )
  ) NOT VALID;

ALTER TABLE recommendations
  ADD CONSTRAINT recommendations_pillar_allowed
  CHECK (
    pillar IN (
      'trust_signals',
      'lead_conversion',
      'growth_infrastructure'
    )
  ) NOT VALID;

-- 5. Distinct audit current_state vs report publication_status
-- Column remains audits.current_state (not renamed to status).
-- Add missing audit outcomes; keep existing processing states.
ALTER TABLE audits
  ADD CONSTRAINT audits_current_state_allowed
  CHECK (
    current_state IN (
      'submitted',
      'validating',
      'discovering',
      'rendering',
      'collecting_signals',
      'scoring',
      'generating_report',
      'validating_report',
      'complete',
      'partial',
      'needs_review',
      'failed',
      'unsupported'
    )
  ) NOT VALID;

-- Keep publication_status 'draft' (not renamed to 'not_ready') to avoid unnecessary churn.
ALTER TABLE report_revisions
  ADD CONSTRAINT report_revisions_publication_status_allowed
  CHECK (
    publication_status IN (
      'draft',
      'review_required',
      'approved',
      'published',
      'revoked',
      'expired'
    )
  ) NOT VALID;
