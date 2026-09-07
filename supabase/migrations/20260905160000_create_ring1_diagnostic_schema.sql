-- Ring 1: Diagnostic Submission Schema
-- This migration creates the core tables for the website diagnostic workflow

-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- leads table: stores lead information with hashed email for deduplication
CREATE TABLE IF NOT EXISTS leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email_hash TEXT NOT NULL UNIQUE,
  first_name TEXT NOT NULL,
  business_name TEXT,
  phone TEXT,
  trade TEXT,
  service_area TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_leads_email_hash ON leads(email_hash);
CREATE INDEX idx_leads_created_at ON leads(created_at DESC);

-- audits table: stores website audit requests
CREATE TABLE IF NOT EXISTS audits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  website_url TEXT NOT NULL,
  business_name TEXT NOT NULL,
  primary_concern TEXT,
  team_size TEXT,
  platform TEXT,
  referral_source TEXT,
  consent_report_delivery BOOLEAN NOT NULL DEFAULT false,
  consent_follow_up BOOLEAN NOT NULL DEFAULT false,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_term TEXT,
  utm_content TEXT,
  landing_variant TEXT,
  public_status_token_hash TEXT NOT NULL UNIQUE,
  current_state TEXT NOT NULL DEFAULT 'submitted',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audits_lead_id ON audits(lead_id);
CREATE INDEX idx_audits_public_status_token_hash ON audits(public_status_token_hash);
CREATE INDEX idx_audits_current_state ON audits(current_state);
CREATE INDEX idx_audits_created_at ON audits(created_at DESC);

-- audit_state_transitions table: tracks state changes for audits
CREATE TABLE IF NOT EXISTS audit_state_transitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id UUID NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
  from_state TEXT,
  to_state TEXT NOT NULL,
  transitioned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB
);

CREATE INDEX idx_audit_state_transitions_audit_id ON audit_state_transitions(audit_id);
CREATE INDEX idx_audit_state_transitions_transitioned_at ON audit_state_transitions(transitioned_at DESC);

-- audit_events table: stores events related to audits
CREATE TABLE IF NOT EXISTS audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id UUID NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  event_data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_events_audit_id ON audit_events(audit_id);
CREATE INDEX idx_audit_events_event_type ON audit_events(event_type);
CREATE INDEX idx_audit_events_created_at ON audit_events(created_at DESC);

-- Update triggers for updated_at timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_leads_updated_at
  BEFORE UPDATE ON leads
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_audits_updated_at
  BEFORE UPDATE ON audits
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- RLS Policies: Initially disabled for service role access
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE audits ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_state_transitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;

-- Service role can do everything (bypass RLS automatically)
-- Public users have no access (all operations via API with service role)
CREATE POLICY "Service role full access" ON leads FOR ALL TO service_role USING (true);
CREATE POLICY "Service role full access" ON audits FOR ALL TO service_role USING (true);
CREATE POLICY "Service role full access" ON audit_state_transitions FOR ALL TO service_role USING (true);
CREATE POLICY "Service role full access" ON audit_events FOR ALL TO service_role USING (true);

-- Function to create audit with full transaction atomicity
CREATE OR REPLACE FUNCTION create_audit_with_lead(
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
)
RETURNS TABLE(
  audit_id UUID,
  lead_id UUID,
  is_new_lead BOOLEAN
) AS $$
DECLARE
  v_lead_id UUID;
  v_audit_id UUID;
  v_is_new_lead BOOLEAN;
BEGIN
  -- Insert or get existing lead
  INSERT INTO leads (
    email_hash,
    first_name,
    business_name,
    phone,
    trade,
    service_area
  ) VALUES (
    p_email_hash,
    p_first_name,
    p_business_name,
    p_phone,
    p_trade,
    p_service_area
  )
  ON CONFLICT (email_hash) DO UPDATE SET
    first_name = EXCLUDED.first_name,
    business_name = EXCLUDED.business_name,
    phone = COALESCE(EXCLUDED.phone, leads.phone),
    trade = COALESCE(EXCLUDED.trade, leads.trade),
    service_area = COALESCE(EXCLUDED.service_area, leads.service_area),
    updated_at = NOW()
  RETURNING id, (xmax = 0) INTO v_lead_id, v_is_new_lead;

  -- Create audit
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

  -- Create initial state transition
  INSERT INTO audit_state_transitions (
    audit_id,
    from_state,
    to_state
  ) VALUES (
    v_audit_id,
    NULL,
    'submitted'
  );

  -- Create audit_form_completed event
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

  RETURN QUERY SELECT v_audit_id, v_lead_id, v_is_new_lead;
END;
$$ LANGUAGE plpgsql;
