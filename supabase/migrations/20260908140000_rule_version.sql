-- M5: durable rubric version on scored rows.
-- Existing rows pick up DEFAULT 'v1'; app writes the column going forward.

ALTER TABLE criterion_results
  ADD COLUMN IF NOT EXISTS rule_version TEXT NOT NULL DEFAULT 'v1';

ALTER TABLE pillar_results
  ADD COLUMN IF NOT EXISTS rule_version TEXT NOT NULL DEFAULT 'v1';
