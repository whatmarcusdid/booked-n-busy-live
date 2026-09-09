-- Decision #11 rule 8: a non-home-service business is an UNQUALIFIED LEAD,
-- not an unsupported site. Its site is still scanned and scored normally, so
-- qualification must live on `leads` and must never be inferred from
-- `audits.current_state`.

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS qualification_status TEXT NOT NULL DEFAULT 'pending';

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS qualification_reason TEXT;

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS qualified_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'leads_qualification_status_allowed'
  ) THEN
    ALTER TABLE leads
      ADD CONSTRAINT leads_qualification_status_allowed
      CHECK (qualification_status IN ('pending', 'qualified', 'unqualified'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_leads_qualification_status
  ON leads (qualification_status);

COMMENT ON COLUMN leads.qualification_status IS
  'Decision #11 rule 8. Lead fit for the home-service ICP. Independent of audits.current_state: an unqualified lead still receives a fully scanned and scored audit.';

-- Decision #11 rule 10: after one bounded automatic retry the audit terminates
-- as Failed and the customer is offered a MANUAL retry. A manual retry starts a
-- genuinely new execution (a new audits row), because the append-only
-- idx_audit_state_transitions_audit_id_to_state index makes it impossible for a
-- terminal audit to re-traverse its own states. These columns record lineage so
-- a retry chain stays observable rather than looking like an unrelated audit.

ALTER TABLE audits
  ADD COLUMN IF NOT EXISTS retry_of_audit_id UUID REFERENCES audits(id) ON DELETE SET NULL;

ALTER TABLE audits
  ADD COLUMN IF NOT EXISTS retry_attempt INTEGER NOT NULL DEFAULT 0;

-- Unique, not just indexed: at most one manual retry execution per source
-- audit, so a double-submitted retry cannot fan out into parallel executions.
CREATE UNIQUE INDEX IF NOT EXISTS idx_audits_retry_of_audit_id
  ON audits (retry_of_audit_id)
  WHERE retry_of_audit_id IS NOT NULL;

COMMENT ON COLUMN audits.retry_of_audit_id IS
  'Decision #11 rule 10. The failed audit this execution was manually retried from. Unique, so one failed audit yields at most one retry execution.';
