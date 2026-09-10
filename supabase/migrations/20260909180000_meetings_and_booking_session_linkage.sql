-- Findings-call linkage model (M7).
--
-- `booking_sessions` already exists (20260908190000) as the CTA intent row:
-- hash-only email, one session per audit, no expiry. This migration extends
-- that table rather than replacing it, then adds `meetings` as the booked
-- event that an admin can stub in until Google Calendar reconciliation lands.
--
-- Local only. Marcus applies hosted migrations himself.
--
-- customer_email is the normalized plaintext used later to match a Google
-- attendee. leads.email is the source; we copy it here so reconciliation can
-- look at (email, created_at) without a join. customer_email_hash stays as
-- the existing lookup key. Hash-only legacy leads leave customer_email null.

ALTER TABLE booking_sessions
  ADD COLUMN IF NOT EXISTS customer_email TEXT,
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ NOT NULL
    DEFAULT NOW() + INTERVAL '2 days',
  ADD COLUMN IF NOT EXISTS consumed_at TIMESTAMPTZ;

UPDATE booking_sessions AS session
SET customer_email = leads.email
FROM leads
WHERE session.lead_id = leads.id
  AND session.customer_email IS NULL
  AND leads.email IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_booking_sessions_customer_email_created_at
  ON booking_sessions (customer_email, created_at);

-- Original CREATE TABLE enabled RLS but never granted a policy. Service
-- role bypasses RLS; this matches every other Ring 1 table.
CREATE POLICY "Service role full access" ON booking_sessions
  FOR ALL TO service_role USING (true);

COMMENT ON COLUMN booking_sessions.customer_email IS
  'Normalized plaintext copied from leads.email for Calendar attendee matching.';
COMMENT ON COLUMN booking_sessions.expires_at IS
  'Session matching window. Default two days from creation.';
COMMENT ON COLUMN booking_sessions.consumed_at IS
  'Set when a meetings row is created from this session.';

CREATE TABLE IF NOT EXISTS meetings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id UUID NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  booking_session_id UUID NOT NULL REFERENCES booking_sessions(id) ON DELETE RESTRICT,
  google_event_id TEXT,
  status TEXT NOT NULL CHECK (
    status IN ('booked', 'rescheduled', 'cancelled', 'attended', 'no_show')
  ),
  scheduled_start TIMESTAMPTZ NOT NULL,
  scheduled_end TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One meeting per booking session. The admin stub (and later reconciliation)
-- consumes the session exactly once.
CREATE UNIQUE INDEX IF NOT EXISTS idx_meetings_booking_session_id
  ON meetings (booking_session_id);

CREATE INDEX IF NOT EXISTS idx_meetings_audit_id
  ON meetings (audit_id);

CREATE INDEX IF NOT EXISTS idx_meetings_lead_id
  ON meetings (lead_id);

-- Null google_event_id is the admin stub. Real Calendar ids are unique.
CREATE UNIQUE INDEX IF NOT EXISTS idx_meetings_google_event_id
  ON meetings (google_event_id)
  WHERE google_event_id IS NOT NULL;

CREATE TRIGGER update_meetings_updated_at
  BEFORE UPDATE ON meetings
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE meetings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON meetings
  FOR ALL TO service_role USING (true);

COMMENT ON TABLE meetings IS
  'Findings-call events linked back to the originating audit and lead.';
