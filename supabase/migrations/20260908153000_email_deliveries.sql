-- Transactional email deliveries + webhook dedupe.
-- Local only. Marcus applies hosted migrations himself.

CREATE TABLE IF NOT EXISTS email_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id UUID NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
  report_revision_id UUID NOT NULL REFERENCES report_revisions(id) ON DELETE CASCADE,
  delivery_purpose TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (
    status IN ('queued', 'sent', 'delivered', 'bounced', 'failed')
  ),
  provider_message_id TEXT,
  to_email_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (audit_id, report_revision_id, delivery_purpose)
);

CREATE INDEX IF NOT EXISTS email_deliveries_provider_message_id_idx
  ON email_deliveries (provider_message_id)
  WHERE provider_message_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS email_webhook_events (
  event_id TEXT PRIMARY KEY,
  delivery_id UUID REFERENCES email_deliveries(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE email_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_webhook_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON email_deliveries
  FOR ALL TO service_role USING (true);

CREATE POLICY "Service role full access" ON email_webhook_events
  FOR ALL TO service_role USING (true);
