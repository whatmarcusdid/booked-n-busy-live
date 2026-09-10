-- Decision #2: service-mix fields on leads and audits.
-- Nullable, no backfill, no default. Existing rows stay null. Intake UI is
-- unchanged; the create-audit RPC accepts these when a caller supplies them.

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS primary_trade TEXT;

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS secondary_trades TEXT[];

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS business_model TEXT;

ALTER TABLE audits
  ADD COLUMN IF NOT EXISTS audit_focus TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'leads_business_model_allowed'
  ) THEN
    ALTER TABLE leads
      ADD CONSTRAINT leads_business_model_allowed
      CHECK (
        business_model IN (
          'single_trade',
          'dual_trade',
          'multi_trade_home_services'
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'audits_audit_focus_allowed'
  ) THEN
    ALTER TABLE audits
      ADD CONSTRAINT audits_audit_focus_allowed
      CHECK (
        audit_focus IN (
          'plumbing',
          'hvac',
          'electrical',
          'overall_website_conversion'
        )
      );
  END IF;
END $$;

COMMENT ON COLUMN leads.primary_trade IS
  'Decision #2. Primary trade label when supplied by a caller. Optional; intake does not collect it yet.';

COMMENT ON COLUMN leads.secondary_trades IS
  'Decision #2. Additional trades when supplied. Optional text array; null when absent.';

COMMENT ON COLUMN leads.business_model IS
  'Decision #2. single_trade | dual_trade | multi_trade_home_services. Null when not supplied.';

COMMENT ON COLUMN audits.audit_focus IS
  'Decision #2. plumbing | hvac | electrical | overall_website_conversion. Null when not supplied.';

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
  p_primary_trade TEXT DEFAULT NULL,
  p_secondary_trades TEXT[] DEFAULT NULL,
  p_business_model TEXT DEFAULT NULL,
  p_audit_focus TEXT DEFAULT NULL,
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
    service_area,
    primary_trade,
    secondary_trades,
    business_model
  ) VALUES (
    p_email_hash,
    p_email,
    p_first_name,
    p_business_name,
    p_phone,
    p_trade,
    p_service_area,
    p_primary_trade,
    p_secondary_trades,
    p_business_model
  )
  ON CONFLICT (email_hash) DO UPDATE SET
    email = COALESCE(EXCLUDED.email, leads.email),
    first_name = EXCLUDED.first_name,
    business_name = EXCLUDED.business_name,
    phone = COALESCE(EXCLUDED.phone, leads.phone),
    trade = COALESCE(EXCLUDED.trade, leads.trade),
    service_area = COALESCE(EXCLUDED.service_area, leads.service_area),
    primary_trade = COALESCE(EXCLUDED.primary_trade, leads.primary_trade),
    secondary_trades = COALESCE(EXCLUDED.secondary_trades, leads.secondary_trades),
    business_model = COALESCE(EXCLUDED.business_model, leads.business_model),
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
      current_state,
      audit_focus
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
      p_audit_focus
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
      idempotency_key_hash,
      audit_focus
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
      p_idempotency_key_hash,
      p_audit_focus
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

-- Adding parameters creates a NEW overload rather than replacing the old
-- one. Drop the pre-service-mix signature so PostgREST has one match.
DROP FUNCTION IF EXISTS public.create_audit_with_lead(
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
  p_idempotency_key_hash TEXT
);
