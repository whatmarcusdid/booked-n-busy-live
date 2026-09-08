-- Ring 1: artifacts table (PRD 18.10) + private storage bucket.
-- Retention/deletion automation is deferred; retention_class is a placeholder.

CREATE TABLE IF NOT EXISTS artifacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id UUID NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
  audit_page_id UUID REFERENCES audit_pages(id) ON DELETE SET NULL,
  storage_key TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL,
  size INTEGER NOT NULL CHECK (size >= 0),
  checksum TEXT NOT NULL,
  viewport TEXT NOT NULL,
  retention_class TEXT NOT NULL DEFAULT 'pending_policy'
);

CREATE INDEX idx_artifacts_audit_id ON artifacts(audit_id);
CREATE INDEX idx_artifacts_audit_page_id ON artifacts(audit_page_id);

ALTER TABLE evidence
  ADD COLUMN IF NOT EXISTS artifact_id UUID REFERENCES artifacts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_evidence_artifact_id ON evidence(artifact_id);

ALTER TABLE artifacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON artifacts
  FOR ALL TO service_role USING (true);

-- Private bucket: public=false is required. Do not flip this.
-- No anon/authenticated storage.objects policies are created for this bucket.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'audit-artifacts',
  'audit-artifacts',
  false,
  5000000,
  ARRAY['image/png']
)
ON CONFLICT (id) DO UPDATE
SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE POLICY "Service role audit artifacts"
  ON storage.objects
  FOR ALL
  TO service_role
  USING (bucket_id = 'audit-artifacts')
  WITH CHECK (bucket_id = 'audit-artifacts');
