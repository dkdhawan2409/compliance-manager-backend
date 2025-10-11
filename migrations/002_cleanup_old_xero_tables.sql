-- Migration 002: Cleanup Old Xero Tables
-- This script removes the old xero_settings table after successful migration

BEGIN;

-- Step 1: Verify migration was successful
-- Check that all active connections were migrated
DO $$
DECLARE
    old_count INTEGER;
    new_count INTEGER;
BEGIN
    -- Count active connections in old table
    SELECT COUNT(*) INTO old_count 
    FROM xero_settings 
    WHERE access_token IS NOT NULL 
      AND refresh_token IS NOT NULL 
      AND company_id IS NOT NULL;
    
    -- Count connections in new table
    SELECT COUNT(*) INTO new_count 
    FROM xero_connections;
    
    -- Verify migration was successful
    IF new_count < old_count THEN
        RAISE EXCEPTION 'Migration verification failed: % records in old table, % records in new table', old_count, new_count;
    END IF;
    
    RAISE NOTICE 'Migration verification successful: % records migrated', new_count;
END $$;

-- Step 2: Backup old table (rename instead of drop for safety)
ALTER TABLE xero_settings RENAME TO xero_settings_backup;

-- Step 3: Create a view for backward compatibility (temporary)
CREATE VIEW xero_settings AS
SELECT 
    xc.id,
    xc.company_id,
    xc.client_id,
    xc.client_secret,
    xc.redirect_uri,
    xc.created_at,
    xc.updated_at,
    xc.access_token,
    xc.refresh_token,
    xc.token_expires_at,
    xc.primary_organization_name as organization_name,
    xc.xero_user_id,
    xc.authorized_tenants as tenant_data, -- Map to old column name
    xc.tenant_id,
    xc.authorized_tenants
FROM xero_connections xc;

-- Step 4: Add comment explaining the migration
COMMENT ON VIEW xero_settings IS 'Backward compatibility view for xero_settings. Data has been migrated to xero_connections table.';

COMMIT;
