-- Migration 001: Simple migration to unified Xero schema
-- This script migrates data from xero_settings to xero_connections

BEGIN;

-- Step 1: Add missing columns to xero_connections
ALTER TABLE xero_connections ADD COLUMN IF NOT EXISTS client_id TEXT;
ALTER TABLE xero_connections ADD COLUMN IF NOT EXISTS client_secret TEXT;
ALTER TABLE xero_connections ADD COLUMN IF NOT EXISTS redirect_uri TEXT;
ALTER TABLE xero_connections ADD COLUMN IF NOT EXISTS authorized_tenants JSONB DEFAULT '[]'::jsonb;
ALTER TABLE xero_connections ADD COLUMN IF NOT EXISTS selected_tenant_id TEXT;
ALTER TABLE xero_connections ADD COLUMN IF NOT EXISTS primary_organization_name TEXT;
ALTER TABLE xero_connections ADD COLUMN IF NOT EXISTS xero_user_id TEXT;
ALTER TABLE xero_connections ADD COLUMN IF NOT EXISTS last_sync_at TIMESTAMP;
ALTER TABLE xero_connections ADD COLUMN IF NOT EXISTS token_created_at TIMESTAMP DEFAULT NOW();

-- Step 2: Migrate data from xero_settings to xero_connections
-- Map the data to the existing column structure
INSERT INTO xero_connections (
    company_id,
    tenant_id,
    tenant_name,
    access_token_encrypted,
    refresh_token_encrypted,
    access_token_expires_at,
    status,
    created_by,
    client_id,
    client_secret,
    redirect_uri,
    authorized_tenants,
    selected_tenant_id,
    primary_organization_name,
    xero_user_id,
    last_sync_at,
    token_created_at,
    created_at,
    updated_at
)
SELECT 
    xs.company_id,
    xs.tenant_id,
    COALESCE(xs.organization_name, 'Unknown Organization') as tenant_name,
    xs.access_token,  -- Store as encrypted (we'll handle encryption later)
    xs.refresh_token, -- Store as encrypted (we'll handle encryption later)
    xs.token_expires_at,
    CASE 
        WHEN xs.access_token IS NOT NULL AND xs.token_expires_at > NOW() THEN 'active'
        WHEN xs.access_token IS NOT NULL AND xs.token_expires_at <= NOW() THEN 'expired'
        ELSE 'inactive'
    END,
    xs.company_id, -- Use company_id as created_by
    xs.client_id,
    xs.client_secret,
    xs.redirect_uri,
    COALESCE(xs.authorized_tenants, '[]'::jsonb),
    xs.tenant_id,
    COALESCE(xs.organization_name, 'Unknown Organization') as primary_organization_name,
    xs.xero_user_id,
    xs.updated_at,
    xs.created_at,
    xs.created_at,
    xs.updated_at
FROM xero_settings xs
WHERE xs.access_token IS NOT NULL 
  AND xs.refresh_token IS NOT NULL
  AND xs.company_id IS NOT NULL;

-- Step 3: Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_xero_connections_company ON xero_connections(company_id);
CREATE INDEX IF NOT EXISTS idx_xero_connections_status ON xero_connections(status);
CREATE INDEX IF NOT EXISTS idx_xero_connections_tenant ON xero_connections(tenant_id);
CREATE INDEX IF NOT EXISTS idx_xero_connections_expiry ON xero_connections(access_token_expires_at);
CREATE INDEX IF NOT EXISTS idx_xero_authorized_tenants ON xero_connections USING GIN (authorized_tenants);

-- Step 4: Update xero_data_cache table
CREATE INDEX IF NOT EXISTS idx_xero_cache_lookup ON xero_data_cache(company_id, tenant_id, data_type);
CREATE INDEX IF NOT EXISTS idx_xero_cache_expiry ON xero_data_cache(expires_at);
CREATE INDEX IF NOT EXISTS idx_xero_cache_company ON xero_data_cache(company_id);

COMMIT;
