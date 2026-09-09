-- Scoring band versioning (PRD "Scoring weights and thresholds").
--
-- The three provisional bands (80-100 Strong Foundation, 50-79 Needs
-- Improvement, 0-49 Critical Gaps) are explicitly pending calibration against
-- the 30-audit validation distribution. Pinning the band version on every
-- report revision means recalibrating the boundaries cannot rewrite what a
-- historical report told a customer, and lets pilot analysis group results by
-- the boundaries actually in force at scan time.
--
-- Kept as a real column rather than a metadata key so it is queryable, the
-- same reason rule_version is a column.

ALTER TABLE report_revisions
  ADD COLUMN IF NOT EXISTS scoring_band_version TEXT NOT NULL DEFAULT 'sb-v1';

-- The band the composite score fell into, denormalized alongside the score so
-- historical band membership survives a future boundary change.
ALTER TABLE report_revisions
  ADD COLUMN IF NOT EXISTS score_band TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'report_revisions_score_band_check'
  ) THEN
    ALTER TABLE report_revisions
      ADD CONSTRAINT report_revisions_score_band_check
      CHECK (
        score_band IS NULL
        OR score_band IN ('strong_foundation', 'needs_improvement', 'critical_gaps')
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_report_revisions_score_band
  ON report_revisions (score_band)
  WHERE score_band IS NOT NULL;
