-- Decision #10: scheduled retention purge.
-- Screenshots (artifacts + Storage) after RETENTION_ARTIFACT_DAYS (default 90).
-- Structured evidence / revisions / operational logs after RETENTION_DATA_DAYS
-- (default 365). Scores, leads, meetings, and admin notes are retained
-- indefinitely and are not targeted by this job.
--
-- artifacts had no created_at; age-based deletion needs one. Existing rows
-- are backfilled from the parent audit so they keep their real age.

ALTER TABLE artifacts
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ;

UPDATE artifacts AS a
SET created_at = audits.created_at
FROM audits
WHERE a.audit_id = audits.id
  AND a.created_at IS NULL;

UPDATE artifacts
SET created_at = NOW()
WHERE created_at IS NULL;

ALTER TABLE artifacts
  ALTER COLUMN created_at SET DEFAULT NOW();

ALTER TABLE artifacts
  ALTER COLUMN created_at SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_artifacts_created_at
  ON artifacts (created_at);

CREATE TABLE IF NOT EXISTS retention_purge_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_name TEXT NOT NULL CHECK (
    job_name IN ('artifacts', 'structured_data')
  ),
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  rows_deleted INTEGER NOT NULL DEFAULT 0 CHECK (rows_deleted >= 0),
  objects_deleted INTEGER NOT NULL DEFAULT 0 CHECK (objects_deleted >= 0),
  cutoff_used TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN ('success', 'partial', 'failed')
  ),
  error_detail TEXT
);

CREATE INDEX IF NOT EXISTS idx_retention_purge_runs_started_at
  ON retention_purge_runs (started_at DESC);

ALTER TABLE retention_purge_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON retention_purge_runs
  FOR ALL TO service_role USING (true);
