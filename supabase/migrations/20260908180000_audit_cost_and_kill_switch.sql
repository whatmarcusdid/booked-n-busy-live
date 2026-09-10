-- Per-audit cost attribution and the cost/wall-clock kill switches.

-- One row per paid operation. `operation_key` is the idempotency key: a
-- replayed durable-workflow step re-inserts the same key and is ignored, so
-- the total can never be inflated by retriggering.
CREATE TABLE IF NOT EXISTS audit_cost_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id UUID NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
  operation_key TEXT NOT NULL,
  category TEXT NOT NULL,
  quantity NUMERIC(12, 4) NOT NULL DEFAULT 1,
  amount_usd NUMERIC(12, 6) NOT NULL,
  -- 'provider_metadata' when the provider reported real usage,
  -- 'configured_estimate' when we fell back to a conservative per-unit rate.
  pricing_source TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_cost_entries_operation
  ON audit_cost_entries (audit_id, operation_key);

CREATE INDEX IF NOT EXISTS idx_audit_cost_entries_audit_id
  ON audit_cost_entries (audit_id);

ALTER TABLE audit_cost_entries ENABLE ROW LEVEL SECURITY;

-- Durable execution start, so the wall-clock ceiling is measured from the
-- same instant on every workflow step regardless of which instance runs it.
ALTER TABLE audits
  ADD COLUMN IF NOT EXISTS workflow_started_at TIMESTAMPTZ;

-- Denormalized observability fields, written when the audit reaches a
-- terminal state. Kept on `audits` so the admin list can show cost and
-- duration without aggregating the ledger per row.
ALTER TABLE audits
  ADD COLUMN IF NOT EXISTS cost_usd NUMERIC(12, 6);

ALTER TABLE audits
  ADD COLUMN IF NOT EXISTS elapsed_ms BIGINT;

ALTER TABLE audits
  ADD COLUMN IF NOT EXISTS kill_switch_reason TEXT;

COMMENT ON TABLE audit_cost_entries IS
  'Per-operation cost ledger backing the $1.00 per-audit kill switch.';
COMMENT ON COLUMN audits.kill_switch_reason IS
  'COST_CEILING_EXCEEDED or WALL_CLOCK_CEILING_EXCEEDED when a ceiling terminated the audit.';
