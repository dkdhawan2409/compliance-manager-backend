# Xero OAuth Settings Assignment Fix

## Problem

When attempting to assign Xero client credentials to all companies using the `/api/companies/admin/xero-client-all` endpoint, the operation failed with:
- **successful**: 0
- **failed**: 41
- **updatedCount**: 0

## Root Cause

The issue was caused by a database structure problem:

1. The code was trying to `INSERT INTO xero_settings` with `ON CONFLICT (company_id)`
2. However, `xero_settings` was actually a **VIEW**, not a table
3. The underlying table `xero_connections` had a unique constraint on `(company_id, tenant_id)` combination, not just `company_id`
4. This caused the error: **"there is no unique or exclusion constraint matching the ON CONFLICT specification"**

## Solution

### 1. Created New Table: `xero_oauth_settings`

Created a dedicated table specifically for OAuth credentials (client_id, client_secret, redirect_uri):

```sql
CREATE TABLE xero_oauth_settings (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL UNIQUE,
  client_id TEXT NOT NULL,
  client_secret TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
);
```

**Key Features:**
- ✅ Has a PRIMARY KEY on `id`
- ✅ Has a UNIQUE constraint on `company_id` (required for `ON CONFLICT`)
- ✅ Foreign key to `companies` table
- ✅ Stores OAuth credentials separately from connection data

### 2. Updated `xero_settings` View

Updated the view to use FULL OUTER JOIN to show both OAuth settings and connections:

```sql
CREATE OR REPLACE VIEW xero_settings AS
SELECT 
  COALESCE(xc.id, xos.id * 10000) as id,
  COALESCE(xc.company_id, xos.company_id) as company_id,
  COALESCE(xos.client_id, xc.client_id) as client_id,
  COALESCE(xos.client_secret, xc.client_secret) as client_secret,
  COALESCE(xos.redirect_uri, xc.redirect_uri) as redirect_uri,
  COALESCE(xc.created_at, xos.created_at) as created_at,
  COALESCE(xc.updated_at, xos.updated_at) as updated_at,
  xc.access_token_encrypted AS access_token,
  xc.refresh_token_encrypted AS refresh_token,
  xc.access_token_expires_at AS token_expires_at,
  xc.primary_organization_name AS organization_name,
  xc.xero_user_id,
  xc.authorized_tenants AS tenant_data,
  xc.tenant_id,
  xc.authorized_tenants
FROM xero_oauth_settings xos
FULL OUTER JOIN xero_connections xc ON xos.company_id = xc.company_id;
```

**Benefits:**
- ✅ Shows OAuth settings even if no connection exists yet
- ✅ Shows connections with their OAuth settings
- ✅ Maintains backward compatibility with existing code reading from `xero_settings`

### 3. Updated Code

Updated the following files to use `xero_oauth_settings` table for OAuth credential operations:

#### `src/controllers/companyController.js`
- Updated `upsertCompanyXeroCredentials()` function to INSERT/UPDATE in `xero_oauth_settings`

#### `src/controllers/plugAndPlayXeroController.js`
- Updated `applyXeroSettingsToAllCompanies()` to use `xero_oauth_settings`
- Updated `autoLinkToNewCompany()` to use `xero_oauth_settings`

## Results

After the fix:

### ✅ All 41 Companies Successfully Updated

```
Total companies: 41
Companies with OAuth settings: 41
Success rate: 100.0%
```

### ✅ Proper Data Storage

All companies now have:
- ✅ Client ID: `E57D7FD5C2C34B0FAD6A27C37D234008`
- ✅ Client Secret: Encrypted and stored securely
- ✅ Redirect URI: `https://compliance-manager-frontend.onrender.com/redirecturl`

### ✅ Backward Compatibility Maintained

- Existing code reading from `xero_settings` view continues to work
- The view properly combines OAuth settings with connection data
- No breaking changes to existing functionality

## API Endpoint Now Works

The endpoint `/api/companies/admin/xero-client-all` now successfully:

1. ✅ Accepts OAuth credentials (clientId, clientSecret, redirectUri)
2. ✅ Encrypts the client secret
3. ✅ Stores credentials in `xero_oauth_settings` table
4. ✅ Uses `ON CONFLICT (company_id) DO UPDATE` for upsert functionality
5. ✅ Returns success status with updated count

## Database Schema Improvements

### Before:
- ❌ No proper table for OAuth settings
- ❌ View without INSERT/UPDATE capability
- ❌ No unique constraint for ON CONFLICT

### After:
- ✅ Dedicated `xero_oauth_settings` table
- ✅ Proper constraints and foreign keys
- ✅ View for backward compatibility
- ✅ Supports upsert operations

## Testing

Verified with comprehensive tests:
- ✅ Individual company assignment
- ✅ Bulk assignment to all companies
- ✅ View functionality
- ✅ Backward compatibility
- ✅ No linter errors

## Files Modified

1. `src/controllers/companyController.js` - Updated `upsertCompanyXeroCredentials()`
2. `src/controllers/plugAndPlayXeroController.js` - Updated multiple functions
3. Database: Created `xero_oauth_settings` table and updated `xero_settings` view

## Migration Script

If deploying to production, run this migration:

```sql
-- Create xero_oauth_settings table
CREATE TABLE IF NOT EXISTS xero_oauth_settings (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL UNIQUE,
  client_id TEXT NOT NULL,
  client_secret TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
);

-- Drop and recreate the view
DROP VIEW IF EXISTS xero_settings CASCADE;

CREATE OR REPLACE VIEW xero_settings AS
SELECT 
  COALESCE(xc.id, xos.id * 10000) as id,
  COALESCE(xc.company_id, xos.company_id) as company_id,
  COALESCE(xos.client_id, xc.client_id) as client_id,
  COALESCE(xos.client_secret, xc.client_secret) as client_secret,
  COALESCE(xos.redirect_uri, xc.redirect_uri) as redirect_uri,
  COALESCE(xc.created_at, xos.created_at) as created_at,
  COALESCE(xc.updated_at, xos.updated_at) as updated_at,
  xc.access_token_encrypted AS access_token,
  xc.refresh_token_encrypted AS refresh_token,
  xc.access_token_expires_at AS token_expires_at,
  xc.primary_organization_name AS organization_name,
  xc.xero_user_id,
  xc.authorized_tenants AS tenant_data,
  xc.tenant_id,
  xc.authorized_tenants
FROM xero_oauth_settings xos
FULL OUTER JOIN xero_connections xc ON xos.company_id = xc.company_id;
```

## Summary

The Xero OAuth settings assignment is now working perfectly. All 41 companies have been successfully configured with the correct credentials, and the system is ready for production use. The fix maintains backward compatibility while providing a robust solution for managing OAuth credentials separately from connection data.

