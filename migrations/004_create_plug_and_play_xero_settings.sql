-- Create plug_and_play_xero_settings view
-- This view provides a unified interface for the plug-and-play Xero controller
-- It maps to the existing xero_oauth_settings and xero_connections tables

-- Drop existing objects to avoid conflicts
DROP VIEW IF EXISTS plug_and_play_xero_settings CASCADE;

-- Create a materialized view that combines xero_oauth_settings and xero_connections
-- This provides all the data the plug-and-play controller needs
CREATE OR REPLACE VIEW plug_and_play_xero_settings AS
SELECT 
  COALESCE(xc.id, xos.id * 10000) AS id,
  COALESCE(xc.company_id, xos.company_id) AS company_id,
  COALESCE(xos.client_id, xc.client_id) AS client_id,
  COALESCE(xos.client_secret, xc.client_secret) AS client_secret,
  COALESCE(xos.redirect_uri, xc.redirect_uri) AS redirect_uri,
  xc.access_token_encrypted AS access_token,
  xc.refresh_token_encrypted AS refresh_token,
  xc.access_token_expires_at AS token_expires_at,
  xc.tenant_id,
  xc.primary_organization_name AS organization_name,
  xc.authorized_tenants AS tenant_data,
  xc.last_sync_at,
  CASE 
    WHEN xc.status IS NOT NULL THEN xc.status
    WHEN xc.access_token_encrypted IS NULL THEN 'never_synced'
    WHEN xc.access_token_expires_at < NOW() THEN 'error'
    ELSE 'active'
  END AS sync_status,
  NULL AS error_message,
  CASE 
    WHEN xc.status = 'active' THEN TRUE
    WHEN xc.access_token_encrypted IS NOT NULL THEN TRUE
    ELSE FALSE
  END AS is_active,
  COALESCE(xc.created_at, xos.created_at) AS created_at,
  COALESCE(xc.updated_at, xos.updated_at) AS updated_at
FROM xero_oauth_settings xos
FULL OUTER JOIN xero_connections xc ON xos.company_id = xc.company_id;

-- Ensure xero_oauth_states table exists (for OAuth flow)
CREATE TABLE IF NOT EXISTS xero_oauth_states (
  id SERIAL PRIMARY KEY,
  state VARCHAR(255) NOT NULL UNIQUE,
  company_id INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_company_oauth_state FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
);

-- Create indexes if they don't exist
CREATE INDEX IF NOT EXISTS idx_xero_oauth_state ON xero_oauth_states(state);
CREATE INDEX IF NOT EXISTS idx_xero_oauth_company_id ON xero_oauth_states(company_id);
CREATE INDEX IF NOT EXISTS idx_xero_oauth_created_at ON xero_oauth_states(created_at);

-- Clean up expired OAuth states (older than 10 minutes)
CREATE OR REPLACE FUNCTION clean_expired_oauth_states()
RETURNS void AS $$
BEGIN
    DELETE FROM xero_oauth_states WHERE created_at < NOW() - INTERVAL '10 minutes';
END;
$$ language 'plpgsql';

COMMENT ON VIEW plug_and_play_xero_settings IS 'Unified view for plug-and-play Xero controller - combines xero_oauth_settings and xero_connections';
COMMENT ON TABLE xero_oauth_states IS 'Temporary storage for OAuth state parameters during authorization flow';
