-- Booking sessions created by the single results CTA.
--
-- Written now so the CTA is functional ahead of Google Calendar
-- reconciliation; the calendar columns are added by that later work.
CREATE TABLE IF NOT EXISTS booking_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id UUID NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  -- Hash, not the address. No table in this schema stores a plaintext
  -- email; `leads` holds only `email_hash`, so there is no plaintext to
  -- copy here even if we wanted to.
  customer_email_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One session per audit. Makes a double-clicked CTA idempotent rather than
-- producing two bookings for the same findings call.
CREATE UNIQUE INDEX IF NOT EXISTS idx_booking_sessions_audit_id
  ON booking_sessions (audit_id);

CREATE INDEX IF NOT EXISTS idx_booking_sessions_lead_id
  ON booking_sessions (lead_id);

ALTER TABLE booking_sessions ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE booking_sessions IS
  'Findings-call booking intents created by the results CTA.';
