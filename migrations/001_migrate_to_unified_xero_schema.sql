-- Migration 001: Migrate to Unified Xero Schema
-- This script migrates data from xero_settings to the new unified xero_connections table

BEGIN;

-- Step 1: Update xero_connections table structure to match our design
-- Add missing columns if they don't exist
ALTER TABLE xero_connections ADD COLUMN IF NOT EXISTS client_id TEXT;
ALTER TABLE xero_connections ADD COLUMN IF NOT EXISTS client_secret TEXT;
ALTER TABLE xero_connections ADD COLUMN IF NOT EXISTS redirect_uri TEXT;
ALTER TABLE xero_connections ADD COLUMN IF NOT EXISTS authorized_tenants JSONB DEFAULT '[]'::jsonb;
ALTER TABLE xero_connections ADD COLUMN IF NOT EXISTS selected_tenant_id TEXT;
ALTER TABLE xero_connections ADD COLUMN IF NOT EXISTS primary_organization_name TEXT;
ALTER TABLE xero_connections ADD COLUMN IF NOT EXISTS xero_user_id TEXT;
ALTER TABLE xero_connections ADD COLUMN IF NOT EXISTS connection_status VARCHAR(50) DEFAULT 'active';
ALTER TABLE xero_connections ADD COLUMN IF NOT EXISTS last_sync_at TIMESTAMP;
ALTER TABLE xero_connections ADD COLUMN IF NOT EXISTS token_created_at TIMESTAMP DEFAULT NOW();

-- Rename columns to match our design
ALTER TABLE xero_connections RENAME COLUMN access_token_encrypted TO access_token;
ALTER TABLE xero_connections RENAME COLUMN refresh_token_encrypted TO refresh_token;
ALTER TABLE xero_connections RENAME COLUMN access_token_expires_at TO token_expires_at;
ALTER TABLE xero_connections RENAME COLUMN status TO connection_status;

-- Make access_token and refresh_token NOT NULL (they're encrypted in the old table)
ALTER TABLE xero_connections ALTER COLUMN access_token SET NOT NULL;
ALTER TABLE xero_connections ALTER COLUMN refresh_token SET NOT NULL;
ALTER TABLE xero_connections ALTER COLUMN token_expires_at SET NOT NULL;

-- Step 2: Migrate data from xero_settings to xero_connections
-- Only migrate records that have access tokens (active connections)
INSERT INTO xero_connections (
    company_id,
    tenant_id,
    tenant_name,
    access_token,
    refresh_token,
    token_expires_at,
    client_id,
    client_secret,
    redirect_uri,
    authorized_tenants,
    selected_tenant_id,
    primary_organization_name,
    xero_user_id,
    connection_status,
    last_sync_at,
    token_created_at,
    created_at,
    updated_at
)
SELECT 
    xs.company_id,
    xs.tenant_id,
    xs.organization_name,
    xs.access_token,
    xs.refresh_token,
    xs.token_expires_at,
    xs.client_id,
    xs.client_secret,
    xs.redirect_uri,
    COALESCE(xs.authorized_tenants, '[]'::jsonb),
    xs.tenant_id,
    xs.organization_name,
    xs.xero_user_id,
    CASE 
        WHEN xs.access_token IS NOT NULL AND xs.token_expires_at > NOW() THEN 'active'
        WHEN xs.access_token IS NOT NULL AND xs.token_expires_at <= NOW() THEN 'expired'
        ELSE 'inactive'
    END,
    xs.updated_at,
    xs.created_at,
    xs.created_at,
    xs.updated_at
FROM xero_settings xs
WHERE xs.access_token IS NOT NULL 
  AND xs.refresh_token IS NOT NULL
  AND xs.company_id IS NOT NULL
ON CONFLICT (company_id) DO NOTHING; -- Skip if already exists

-- Step 3: Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_xero_connections_company ON xero_connections(company_id);
CREATE INDEX IF NOT EXISTS idx_xero_connections_status ON xero_connections(connection_status);
CREATE INDEX IF NOT EXISTS idx_xero_connections_tenant ON xero_connections(tenant_id);
CREATE INDEX IF NOT EXISTS idx_xero_connections_expiry ON xero_connections(token_expires_at);
CREATE INDEX IF NOT EXISTS idx_xero_authorized_tenants ON xero_connections USING GIN (authorized_tenants);

-- Step 4: Update xero_data_cache table structure
ALTER TABLE xero_data_cache ADD COLUMN IF NOT EXISTS cached_at TIMESTAMP DEFAULT NOW();

-- Create indexes for xero_data_cache
CREATE INDEX IF NOT EXISTS idx_xero_cache_lookup ON xero_data_cache(company_id, tenant_id, data_type);
CREATE INDEX IF NOT EXISTS idx_xero_cache_expiry ON xero_data_cache(expires_at);
CREATE INDEX IF NOT EXISTS idx_xero_cache_company ON xero_data_cache(company_id);

-- Step 5: Add foreign key constraints
ALTER TABLE xero_connections ADD CONSTRAINT fk_xero_connections_company 
FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;

ALTER TABLE xero_data_cache ADD CONSTRAINT fk_xero_cache_company 
FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;

COMMIT;
