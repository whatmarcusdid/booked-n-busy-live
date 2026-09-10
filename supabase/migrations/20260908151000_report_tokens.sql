-- Public report tokens: store SHA-256(token) only. Unique when present.
-- Expiry is 30 days from publication (set at publish time).
-- Local only. Marcus applies hosted migrations himself.

ALTER TABLE report_revisions
  ADD COLUMN IF NOT EXISTS public_report_token_hash TEXT,
  ADD COLUMN IF NOT EXISTS public_report_token_expires_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS report_revisions_public_report_token_hash_uidx
  ON report_revisions (public_report_token_hash)
  WHERE public_report_token_hash IS NOT NULL;
