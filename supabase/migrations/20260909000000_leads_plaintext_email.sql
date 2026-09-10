-- Populate leads.email with the plaintext address.
--
-- The column has existed (nullable, no backfill) since
-- 20260907180000, but nothing ever wrote it: the RPC took only
-- p_email_hash. Google Calendar reconciliation matches attendees by email
-- address and cannot match a hash, so the plaintext has to be stored.
--
-- email_hash keeps its existing role. It is the unique dedupe key and the
-- lookup path, and nothing here changes that.
--
-- No backfill: existing hashed-only rows stay as they are. They fill in on
-- their own the next time that lead submits, via the COALESCE below.
--
-- Supersedes a claim in 20260908190000 (booking_sessions), which states that
-- no table here stores a plaintext email and that `leads` holds only
-- `email_hash`. That was true when written and is not any more. Left in place
-- rather than edited, since that migration is already applied; read this as
-- the correction. booking_sessions itself still stores only the hash, and
-- Calendar reconciliation is expected to reach the address by joining to
-- `leads` rather than by copying it into a second table.
--
-- RLS is unaffected: `leads` has row-level security enabled with a single
-- FOR ALL policy granted to service_role and no anon or authenticated
-- policy, so the plaintext is reachable only by the service role that
-- already reads every other column on the row.

CREATE OR REPLACE FUNCTION create_audit_with_lead(
  p_email_hash TEXT,
  p_email TEXT,
  p_first_name TEXT,
  p_business_name TEXT,
  p_phone TEXT,
  p_trade TEXT,
  p_service_area TEXT,
  p_website_url TEXT,
  p_primary_concern TEXT,
  p_team_size TEXT,
  p_platform TEXT,
  p_referral_source TEXT,
  p_consent_report_delivery BOOLEAN,
  p_consent_follow_up BOOLEAN,
  p_utm_source TEXT,
  p_utm_medium TEXT,
  p_utm_campaign TEXT,
  p_utm_term TEXT,
  p_utm_content TEXT,
  p_landing_variant TEXT,
  p_public_status_token_hash TEXT,
  p_idempotency_key_hash TEXT DEFAULT NULL
)
RETURNS TABLE(
  audit_id UUID,
  lead_id UUID,
  is_new_lead BOOLEAN,
  is_new_audit BOOLEAN
) AS $$
DECLARE
  v_lead_id UUID;
  v_audit_id UUID;
  v_is_new_lead BOOLEAN;
BEGIN
  INSERT INTO leads (
    email_hash,
    email,
    first_name,
    business_name,
    phone,
    trade,
    service_area
  ) VALUES (
    p_email_hash,
    p_email,
    p_first_name,
    p_business_name,
    p_phone,
    p_trade,
    p_service_area
  )
  ON CONFLICT (email_hash) DO UPDATE SET
    -- Conflict means the same normalized address, so this only ever fills a
    -- previously hash-only row rather than changing a known address.
    email = COALESCE(EXCLUDED.email, leads.email),
    first_name = EXCLUDED.first_name,
    business_name = EXCLUDED.business_name,
    phone = COALESCE(EXCLUDED.phone, leads.phone),
    trade = COALESCE(EXCLUDED.trade, leads.trade),
    service_area = COALESCE(EXCLUDED.service_area, leads.service_area),
    updated_at = NOW()
  RETURNING id, (xmax = 0) INTO v_lead_id, v_is_new_lead;

  IF p_idempotency_key_hash IS NULL THEN
    INSERT INTO audits (
      lead_id,
      website_url,
      business_name,
      primary_concern,
      team_size,
      platform,
      referral_source,
      consent_report_delivery,
      consent_follow_up,
      utm_source,
      utm_medium,
      utm_campaign,
      utm_term,
      utm_content,
      landing_variant,
      public_status_token_hash,
      current_state
    ) VALUES (
      v_lead_id,
      p_website_url,
      p_business_name,
      p_primary_concern,
      p_team_size,
      p_platform,
      p_referral_source,
      p_consent_report_delivery,
      p_consent_follow_up,
      p_utm_source,
      p_utm_medium,
      p_utm_campaign,
      p_utm_term,
      p_utm_content,
      p_landing_variant,
      p_public_status_token_hash,
      'submitted'
    ) RETURNING id INTO v_audit_id;
  ELSE
    INSERT INTO audits (
      lead_id,
      website_url,
      business_name,
      primary_concern,
      team_size,
      platform,
      referral_source,
      consent_report_delivery,
      consent_follow_up,
      utm_source,
      utm_medium,
      utm_campaign,
      utm_term,
      utm_content,
      landing_variant,
      public_status_token_hash,
      current_state,
      idempotency_key_hash
    ) VALUES (
      v_lead_id,
      p_website_url,
      p_business_name,
      p_primary_concern,
      p_team_size,
      p_platform,
      p_referral_source,
      p_consent_report_delivery,
      p_consent_follow_up,
      p_utm_source,
      p_utm_medium,
      p_utm_campaign,
      p_utm_term,
      p_utm_content,
      p_landing_variant,
      p_public_status_token_hash,
      'submitted',
      p_idempotency_key_hash
    )
    ON CONFLICT (idempotency_key_hash) WHERE (idempotency_key_hash IS NOT NULL)
    DO NOTHING
    RETURNING id INTO v_audit_id;

    IF v_audit_id IS NULL THEN
      SELECT id INTO v_audit_id
      FROM audits
      WHERE idempotency_key_hash = p_idempotency_key_hash;

      RETURN QUERY SELECT v_audit_id, v_lead_id, v_is_new_lead, false;
      RETURN;
    END IF;
  END IF;

  INSERT INTO audit_state_transitions (
    audit_id,
    from_state,
    to_state
  ) VALUES (
    v_audit_id,
    NULL,
    'submitted'
  );

  INSERT INTO audit_events (
    audit_id,
    event_type,
    event_data
  ) VALUES (
    v_audit_id,
    'audit_form_completed',
    jsonb_build_object(
      'timestamp', NOW(),
      'source', 'api'
    )
  );

  RETURN QUERY SELECT v_audit_id, v_lead_id, v_is_new_lead, true;
END;
$$ LANGUAGE plpgsql;

-- Adding a parameter creates a NEW overload rather than replacing the old
-- one, which is how this database ended up with two create_audit_with_lead
-- functions before (cleaned up in 20260908000000). PostgREST resolves an RPC
-- by its exact named-parameter set, so leaving both would make resolution
-- ambiguous. Drop the pre-p_email signature explicitly.
DROP FUNCTION IF EXISTS public.create_audit_with_lead(
  p_email_hash TEXT,
  p_first_name TEXT,
  p_business_name TEXT,
  p_phone TEXT,
  p_trade TEXT,
  p_service_area TEXT,
  p_website_url TEXT,
  p_primary_concern TEXT,
  p_team_size TEXT,
  p_platform TEXT,
  p_referral_source TEXT,
  p_consent_report_delivery BOOLEAN,
  p_consent_follow_up BOOLEAN,
  p_utm_source TEXT,
  p_utm_medium TEXT,
  p_utm_campaign TEXT,
  p_utm_term TEXT,
  p_utm_content TEXT,
  p_landing_variant TEXT,
  p_public_status_token_hash TEXT,
  p_idempotency_key_hash TEXT
);
