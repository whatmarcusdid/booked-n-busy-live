-- Optional answers collected on the "prepare for your findings call"
-- screen. Local only. Marcus applies hosted migrations himself.
--
-- Option wording is stored as plain text so it can change later
-- without a migration. No foreign keys beyond audit and lead.
CREATE TABLE IF NOT EXISTS pre_call_answers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id UUID NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  finding_answer TEXT,
  result_answer TEXT,
  timing_answer TEXT,
  submitted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_pre_call_answers_audit_id
  ON pre_call_answers (audit_id);

CREATE INDEX IF NOT EXISTS idx_pre_call_answers_lead_id
  ON pre_call_answers (lead_id);

ALTER TABLE pre_call_answers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON pre_call_answers
  FOR ALL TO service_role USING (true);

COMMENT ON TABLE pre_call_answers IS
  'Optional pre-call answers collected before scheduling a findings call.';
