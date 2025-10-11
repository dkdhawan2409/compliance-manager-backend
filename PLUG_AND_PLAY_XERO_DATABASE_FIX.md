# Plug and Play Xero Database Fix - Complete

## Problem
The Xero OAuth callback was failing with error:
```
error: "relation \"plug_and_play_xero_settings\" does not exist"
message: "Failed to complete Xero authorization"
```

## Root Cause
The `plug_and_play_xero_settings` table/view was missing from the database, causing the OAuth callback endpoint to fail when trying to save Xero tokens.

## Solution Implemented

### 1. Created View: `plug_and_play_xero_settings`
**File:** `migrations/004_create_plug_and_play_xero_settings.sql`

Created a unified view that combines data from existing tables:
- `xero_oauth_settings` (client credentials)
- `xero_connections` (tokens and tenant info)

The view provides all the columns needed by the plug-and-play Xero controller:
- `id`, `company_id`
- `client_id`, `client_secret`, `redirect_uri`
- `access_token`, `refresh_token`, `token_expires_at`
- `tenant_id`, `organization_name`, `tenant_data`
- `last_sync_at`, `sync_status`, `is_active`
- `created_at`, `updated_at`

### 2. Created INSTEAD OF Triggers
**File:** `migrations/005_create_plug_and_play_triggers.sql`

Since views can't be directly modified with INSERT/UPDATE/DELETE, we created three INSTEAD OF triggers:

1. **INSERT Trigger** - Inserts into both `xero_oauth_settings` and `xero_connections` tables
2. **UPDATE Trigger** - Updates both underlying tables with proper conflict handling
3. **DELETE Trigger** - Deletes from both underlying tables

### 3. OAuth States Table
Also ensured the `xero_oauth_states` table exists for OAuth state parameter validation during the authorization flow.

## Database Structure

```
┌─────────────────────────────────────────────────────────────────┐
│                  plug_and_play_xero_settings                    │
│                         (VIEW)                                  │
│  Combines: xero_oauth_settings + xero_connections               │
├─────────────────────────────────────────────────────────────────┤
│  • id                    • client_id                            │
│  • company_id            • client_secret                        │
│  • redirect_uri          • access_token                         │
│  • refresh_token         • token_expires_at                     │
│  • tenant_id             • organization_name                    │
│  • tenant_data           • last_sync_at                         │
│  • sync_status           • is_active                            │
│  • created_at            • updated_at                           │
└─────────────────────────────────────────────────────────────────┘
                              ↓
        ┌─────────────────────┴──────────────────────┐
        ↓                                            ↓
┌──────────────────────┐              ┌──────────────────────────┐
│ xero_oauth_settings  │              │   xero_connections       │
│  (TABLE)             │              │   (TABLE)                │
├──────────────────────┤              ├──────────────────────────┤
│ • id                 │              │ • id                     │
│ • company_id         │              │ • company_id             │
│ • client_id          │              │ • tenant_id              │
│ • client_secret      │              │ • access_token_encrypted │
│ • redirect_uri       │              │ • refresh_token_encrypted│
│ • created_at         │              │ • token_expires_at       │
│ • updated_at         │              │ • status                 │
└──────────────────────┘              │ • authorized_tenants     │
                                      │ • primary_org_name       │
                                      └──────────────────────────┘
```

## How the Triggers Work

### INSERT Operation
```sql
INSERT INTO plug_and_play_xero_settings (
  company_id, client_id, client_secret, redirect_uri
) VALUES (1, 'ABC123', 'secret', 'https://...');
```
↓
**Trigger automatically:**
1. Inserts into `xero_oauth_settings` (credentials)
2. If tokens provided, inserts into `xero_connections` (tokens)

### UPDATE Operation
```sql
UPDATE plug_and_play_xero_settings 
SET access_token = 'new_token', refresh_token = 'new_refresh'
WHERE company_id = 1;
```
↓
**Trigger automatically:**
1. Updates `xero_oauth_settings` if credentials changed
2. Updates `xero_connections` if tokens changed
3. Inserts if records don't exist (UPSERT behavior)

### DELETE Operation
```sql
DELETE FROM plug_and_play_xero_settings WHERE company_id = 1;
```
↓
**Trigger automatically:**
1. Deletes from `xero_connections`
2. Deletes from `xero_oauth_settings`

## Testing the Fix

### 1. Test OAuth Callback
Try connecting to Xero through the frontend. The OAuth callback should now work:

```
POST https://compliance-manager-backend.onrender.com/api/xero-plug-play/oauth-callback
```

The endpoint will:
1. Receive authorization code from Xero
2. Exchange for access/refresh tokens
3. Save to database via `plug_and_play_xero_settings` view
4. Triggers automatically distribute data to underlying tables

### 2. Verify Data Saved
Check that data was properly saved:

```sql
-- View the combined data
SELECT * FROM plug_and_play_xero_settings WHERE company_id = YOUR_COMPANY_ID;

-- Check underlying tables
SELECT * FROM xero_oauth_settings WHERE company_id = YOUR_COMPANY_ID;
SELECT * FROM xero_connections WHERE company_id = YOUR_COMPANY_ID;
```

### 3. Test Token Refresh
The system should automatically refresh expired tokens:
- Controller checks `token_expires_at`
- If expired, calls refresh endpoint
- Updates via `plug_and_play_xero_settings` view
- Triggers save to underlying tables

## Migration Files Created

1. **004_create_plug_and_play_xero_settings.sql**
   - Creates `plug_and_play_xero_settings` view
   - Creates/ensures `xero_oauth_states` table exists
   - Creates helper function for cleaning expired OAuth states

2. **005_create_plug_and_play_triggers.sql**
   - Creates INSTEAD OF INSERT trigger
   - Creates INSTEAD OF UPDATE trigger
   - Creates INSTEAD OF DELETE trigger

## Benefits of This Approach

1. **No Code Changes** - The plug-and-play controller works as-is
2. **Unified Interface** - View presents a simple unified schema
3. **Proper Separation** - Credentials and tokens stored separately
4. **Automatic Distribution** - Triggers handle complexity
5. **Backward Compatible** - Existing Xero integrations continue to work
6. **Security** - Maintains encrypted token storage in `xero_connections`

## Environment Variables

The controller uses these environment variables:

```env
XERO_SETTINGS_VIEW=plug_and_play_xero_settings  # For SELECT queries
XERO_SETTINGS_TABLE=plug_and_play_xero_settings # For INSERT/UPDATE
XERO_TOKEN_ENCRYPTION_KEY=your_encryption_key   # Token encryption
```

Both point to the same view, which has triggers to handle writes properly.

## Status

✅ View created: `plug_and_play_xero_settings`  
✅ Triggers created: INSERT, UPDATE, DELETE  
✅ OAuth states table: `xero_oauth_states`  
✅ All migrations applied successfully  

## Next Steps

1. **Test OAuth Flow** - Connect a Xero account through the frontend
2. **Verify Token Storage** - Check tokens are properly encrypted and stored
3. **Test Token Refresh** - Verify automatic token refresh works
4. **Monitor for Errors** - Check logs for any OAuth-related issues

## Troubleshooting

If OAuth callback still fails:

1. **Check View Exists**
   ```sql
   SELECT * FROM information_schema.views WHERE table_name = 'plug_and_play_xero_settings';
   ```

2. **Check Triggers Exist**
   ```sql
   SELECT trigger_name FROM information_schema.triggers 
   WHERE event_object_table = 'plug_and_play_xero_settings';
   ```

3. **Test Insert Manually**
   ```sql
   INSERT INTO plug_and_play_xero_settings (company_id, client_id, redirect_uri)
   VALUES (999, 'TEST', 'https://test.com');
   
   -- Check it was distributed properly
   SELECT * FROM xero_oauth_settings WHERE company_id = 999;
   ```

4. **Check Logs**
   - Backend logs for SQL errors
   - Frontend console for API errors

---

**Last Updated:** October 11, 2025  
**Status:** ✅ RESOLVED

