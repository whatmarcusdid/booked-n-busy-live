-- One live booking session per audit.
--
-- The original unique index on audit_id made a double-clicked CTA
-- idempotent by refusing a second row forever. After a session expires or
-- is consumed (mark-booked / Calendar reconciliation), the customer needs a
-- fresh session. A partial unique index on (audit_id) WHERE consumed_at IS
-- NULL cannot encode expiry: NOW() is not IMMUTABLE, so it cannot appear
-- in an index predicate.
--
-- Exclusion on the unconsumed validity window is the equivalent DB-level
-- constraint: two unconsumed sessions whose [created_at, expires_at) ranges
-- overlap cannot exist for the same audit. An expired session's range is
-- in the past, so a new session starting now is allowed. A consumed
-- session is excluded from the constraint entirely.
--
-- Local only. Marcus applies hosted migrations himself.

CREATE EXTENSION IF NOT EXISTS btree_gist;

DROP INDEX IF EXISTS idx_booking_sessions_audit_id;

ALTER TABLE booking_sessions
  DROP CONSTRAINT IF EXISTS booking_sessions_one_live_per_audit;

ALTER TABLE booking_sessions
  ADD CONSTRAINT booking_sessions_one_live_per_audit
  EXCLUDE USING gist (
    audit_id WITH =,
    tstzrange(created_at, expires_at, '[)') WITH &&
  )
  WHERE (consumed_at IS NULL);

COMMENT ON CONSTRAINT booking_sessions_one_live_per_audit ON booking_sessions IS
  'At most one unexpired, unconsumed booking session per audit.';
