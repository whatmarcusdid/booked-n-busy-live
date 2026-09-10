-- Remove the pre-idempotency overload of create_audit_with_lead.
-- CREATE OR REPLACE in 20260907233000 added a new signature instead of
-- replacing the original, so hosted currently has both. This drops only
-- the original (no p_idempotency_key_hash) function.

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
  p_public_status_token_hash TEXT
);
