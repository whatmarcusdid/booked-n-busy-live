-- Admin magic-link tokens + immutable review decisions.
-- Local only. Marcus applies hosted migrations himself.

CREATE TABLE IF NOT EXISTS admin_magic_links (
  token_hash TEXT PRIMARY KEY,
  email_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS admin_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id UUID NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
  decision TEXT NOT NULL CHECK (
    decision IN ('approve', 'reject', 'needs_changes')
  ),
  note TEXT,
  reviewer_email_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS admin_reviews_audit_id_idx ON admin_reviews (audit_id);

ALTER TABLE admin_magic_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON admin_magic_links
  FOR ALL TO service_role USING (true);

CREATE POLICY "Service role full access" ON admin_reviews
  FOR ALL TO service_role USING (true);
