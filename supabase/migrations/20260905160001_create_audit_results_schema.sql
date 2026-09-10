-- Ring 1: Audit Results Schema Extension
-- Additional tables for storing audit processing results

-- audit_pages table: discovered pages during crawl
CREATE TABLE IF NOT EXISTS audit_pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id UUID NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  page_type TEXT NOT NULL,
  title TEXT,
  meta_description TEXT,
  discovered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB,
  UNIQUE(audit_id, url)
);

CREATE INDEX idx_audit_pages_audit_id ON audit_pages(audit_id);
CREATE INDEX idx_audit_pages_page_type ON audit_pages(page_type);

-- evidence table: screenshots and other evidence collected
CREATE TABLE IF NOT EXISTS evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id UUID NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
  evidence_type TEXT NOT NULL,
  url TEXT,
  file_path TEXT,
  description TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_evidence_audit_id ON evidence(audit_id);
CREATE INDEX idx_evidence_type ON evidence(evidence_type);

-- criterion_results table: individual criterion scores
CREATE TABLE IF NOT EXISTS criterion_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id UUID NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
  criterion_key TEXT NOT NULL,
  criterion_name TEXT NOT NULL,
  pillar TEXT NOT NULL,
  score NUMERIC(3,2) NOT NULL CHECK (score >= 0 AND score <= 1),
  weight NUMERIC(3,2) NOT NULL CHECK (weight >= 0 AND weight <= 1),
  findings JSONB,
  evidence_ids UUID[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(audit_id, criterion_key)
);

CREATE INDEX idx_criterion_results_audit_id ON criterion_results(audit_id);
CREATE INDEX idx_criterion_results_pillar ON criterion_results(pillar);

-- pillar_results table: aggregated pillar scores
CREATE TABLE IF NOT EXISTS pillar_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id UUID NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
  pillar_key TEXT NOT NULL,
  pillar_name TEXT NOT NULL,
  score NUMERIC(3,2) NOT NULL CHECK (score >= 0 AND score <= 1),
  criteria_count INTEGER NOT NULL,
  summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(audit_id, pillar_key)
);

CREATE INDEX idx_pillar_results_audit_id ON pillar_results(audit_id);

-- report_revisions table: generated report versions
CREATE TABLE IF NOT EXISTS report_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id UUID NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
  revision_number INTEGER NOT NULL,
  overall_score NUMERIC(3,2) NOT NULL CHECK (overall_score >= 0 AND overall_score <= 1),
  executive_summary TEXT,
  publication_status TEXT NOT NULL DEFAULT 'draft',
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB,
  UNIQUE(audit_id, revision_number)
);

CREATE INDEX idx_report_revisions_audit_id ON report_revisions(audit_id);
CREATE INDEX idx_report_revisions_publication_status ON report_revisions(publication_status);

-- recommendations table: actionable recommendations
CREATE TABLE IF NOT EXISTS recommendations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id UUID NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
  report_revision_id UUID REFERENCES report_revisions(id) ON DELETE CASCADE,
  priority TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  pillar TEXT NOT NULL,
  estimated_impact TEXT,
  implementation_difficulty TEXT,
  sort_order INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_recommendations_audit_id ON recommendations(audit_id);
CREATE INDEX idx_recommendations_report_revision_id ON recommendations(report_revision_id);
CREATE INDEX idx_recommendations_priority ON recommendations(priority);

-- RLS Policies
ALTER TABLE audit_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE criterion_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE pillar_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE recommendations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON audit_pages FOR ALL TO service_role USING (true);
CREATE POLICY "Service role full access" ON evidence FOR ALL TO service_role USING (true);
CREATE POLICY "Service role full access" ON criterion_results FOR ALL TO service_role USING (true);
CREATE POLICY "Service role full access" ON pillar_results FOR ALL TO service_role USING (true);
CREATE POLICY "Service role full access" ON report_revisions FOR ALL TO service_role USING (true);
CREATE POLICY "Service role full access" ON recommendations FOR ALL TO service_role USING (true);
