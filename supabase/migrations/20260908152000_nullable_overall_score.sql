-- overall_score is null when no pillar was measured.
-- Local only. Marcus applies hosted migrations himself.

ALTER TABLE report_revisions
  ALTER COLUMN overall_score DROP NOT NULL;
