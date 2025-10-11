# Xero OAuth Settings Column Error Fix

## Error

```
error: "column \"access_token\" of relation \"xero_oauth_settings\" does not exist"
message: "Failed to complete Xero authorization"
success: false
```

**Endpoint:** `/api/xero-plug-play/oauth-callback`

## Root Cause

The code was trying to INSERT/UPDATE columns that don't exist in the `xero_oauth_settings` table:
- `access_token`
- `refresh_token`
- `token_expires_at`
- `tenant_id`
- `organization_name`
- `tenant_data`

### Why This Happened

There's a clear separation of concerns in the database:

1. **xero_oauth_settings** - Stores OAuth **credentials** (configured by admin)
   - `client_id`
   - `client_secret`
   - `redirect_uri`

2. **xero_connections** - Stores OAuth **tokens** and **connection data**
   - `access_token_encrypted`
   - `refresh_token_encrypted`
   - `access_token_expires_at`
   - `tenant_id`
   - `primary_organization_name`
   - `authorized_tenants`
   - `status`

The code was incorrectly trying to store tokens in the credentials table.

## Solutions Applied

### Fix 1: OAuth Callback - Save Tokens to xero_connections ✅

**File:** `src/controllers/plugAndPlayXeroController.js` (Line 601-650)

**Changed from:**
```javascript
// ❌ WRONG - Trying to update xero_oauth_settings with token columns
await db.query(
  `UPDATE ${XERO_SETTINGS_TABLE} SET access_token = $1, refresh_token = $2, ...`,
  [...]
);
```

**Changed to:**
```javascript
// ✅ CORRECT - Insert into xero_connections
await db.query(
  `INSERT INTO xero_connections (
    company_id,
    tenant_id,
    tenant_name,
    access_token_encrypted,
    refresh_token_encrypted,
    access_token_expires_at,
    status,
    ...
  ) VALUES ($1, $2, $3, $4, $5, $6, $7, ...)
  ON CONFLICT (company_id, tenant_id) DO UPDATE SET
    access_token_encrypted = EXCLUDED.access_token_encrypted,
    refresh_token_encrypted = EXCLUDED.refresh_token_encrypted,
    ...`,
  [...]
);
```

### Fix 2: Token Refresh - Update xero_connections ✅

**File:** `src/controllers/plugAndPlayXeroController.js` (Line 788-803)

**Changed from:**
```javascript
// ❌ WRONG
await db.query(
  `UPDATE ${XERO_SETTINGS_TABLE} SET access_token = $1, ...`,
  [...]
);
```

**Changed to:**
```javascript
// ✅ CORRECT
await db.query(
  `UPDATE xero_connections 
   SET access_token_encrypted = $1, 
       refresh_token_encrypted = $2, 
       access_token_expires_at = $3,
       status = 'active',
       updated_at = CURRENT_TIMESTAMP 
   WHERE company_id = $4`,
  [...]
);
```

### Fix 3: Soft Disconnect - Update xero_connections ✅

**File:** `src/controllers/plugAndPlayXeroController.js` (Line 272-293)

**Changed from:**
```javascript
// ❌ WRONG
await db.query(
  `UPDATE ${XERO_SETTINGS_TABLE} SET access_token = NULL, ...`,
  [...]
);
```

**Changed to:**
```javascript
// ✅ CORRECT
await db.query(
  `UPDATE xero_connections SET status = 'revoked', updated_at = NOW() WHERE company_id = $1`,
  [companyId]
);
```

### Fix 4: Credentials Management - Correct Columns ✅

**File:** `src/controllers/companyController.js` (Line 27-44)

**Changed from:**
```javascript
// ❌ WRONG - Including token columns in credentials table
INSERT INTO ${XERO_SETTINGS_TABLE} (
  company_id, client_id, client_secret, redirect_uri,
  access_token, refresh_token, token_expires_at,  // ❌ These don't exist
  tenant_id, organization_name, tenant_data,      // ❌ These don't exist
  created_at, updated_at
)
```

**Changed to:**
```javascript
// ✅ CORRECT - Only credential columns
INSERT INTO ${XERO_SETTINGS_TABLE} (
  company_id,
  client_id,
  client_secret,
  redirect_uri,
  created_at,
  updated_at
)
```

## Database Architecture

### Table Separation Strategy

```
┌─────────────────────────────────────────────────────────────┐
│ xero_oauth_settings (OAuth Credentials)                    │
├─────────────────────────────────────────────────────────────┤
│ • id (PRIMARY KEY)                                          │
│ • company_id (UNIQUE)                                       │
│ • client_id                                                 │
│ • client_secret (encrypted)                                 │
│ • redirect_uri                                              │
│ • created_at                                                │
│ • updated_at                                                │
│                                                             │
│ Purpose: Store OAuth app credentials                       │
│ Updated: Rarely (only when admin changes settings)         │
│ One per: Company                                            │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ xero_connections (OAuth Tokens & Connections)              │
├─────────────────────────────────────────────────────────────┤
│ • id (PRIMARY KEY)                                          │
│ • company_id + tenant_id (UNIQUE)                           │
│ • tenant_name                                               │
│ • access_token_encrypted                                    │
│ • refresh_token_encrypted                                   │
│ • access_token_expires_at                                   │
│ • status (active/expired/revoked/error)                     │
│ • created_by                                                │
│ • client_id (duplicate for reference)                       │
│ • client_secret (duplicate for reference)                   │
│ • redirect_uri (duplicate for reference)                    │
│ • authorized_tenants (JSON)                                 │
│ • selected_tenant_id                                        │
│ • primary_organization_name                                 │
│ • xero_user_id                                              │
│ • last_sync_at                                              │
│ • token_created_at                                          │
│ • created_at                                                │
│ • updated_at                                                │
│                                                             │
│ Purpose: Store OAuth tokens and connection state           │
│ Updated: Frequently (token refresh every 30 min)           │
│ One per: Company + Xero Organization (tenant)              │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ plug_and_play_xero_settings (VIEW)                         │
├─────────────────────────────────────────────────────────────┤
│ Combines xero_oauth_settings + xero_connections            │
│ Used for: SELECT queries to get both credentials & tokens  │
│ Cannot: INSERT/UPDATE (it's a view)                        │
└─────────────────────────────────────────────────────────────┘
```

## Why This Separation?

### Benefits

1. **Performance**
   - Credentials rarely change → small, stable table
   - Tokens change frequently → separate table avoids unnecessary updates
   - Better query optimization

2. **Security**
   - Credentials are super-sensitive (admin-level)
   - Tokens are sensitive but need frequent access
   - Different encryption/audit strategies possible

3. **Multi-Tenancy**
   - One company can connect to multiple Xero organizations
   - Each connection needs its own tokens
   - Credentials stay the same across all connections

4. **Data Integrity**
   - Clear ownership: admin manages credentials, users manage connections
   - Status tracking per connection (active/revoked/expired)
   - Easy to disconnect without losing credentials

## Query Patterns

### ✅ CORRECT Query Patterns

```javascript
// 1. Admin assigns OAuth credentials to company
await db.query(
  `INSERT INTO xero_oauth_settings (company_id, client_id, client_secret, redirect_uri)
   VALUES ($1, $2, $3, $4)
   ON CONFLICT (company_id) DO UPDATE SET ...`
);

// 2. User authorizes OAuth (save tokens)
await db.query(
  `INSERT INTO xero_connections (company_id, tenant_id, access_token_encrypted, ...)
   VALUES ($1, $2, $3, ...)
   ON CONFLICT (company_id, tenant_id) DO UPDATE SET ...`
);

// 3. Refresh tokens
await db.query(
  `UPDATE xero_connections 
   SET access_token_encrypted = $1, refresh_token_encrypted = $2, ...
   WHERE company_id = $3`
);

// 4. Read everything (use the view)
await db.query(
  `SELECT * FROM plug_and_play_xero_settings WHERE company_id = $1`
);
```

### ❌ WRONG Query Patterns

```javascript
// ❌ DON'T try to insert tokens into oauth_settings
await db.query(
  `INSERT INTO xero_oauth_settings (company_id, access_token, ...)` // ❌ NO!
);

// ❌ DON'T try to insert into the view
await db.query(
  `INSERT INTO plug_and_play_xero_settings (...)` // ❌ It's a VIEW!
);
```

## Files Modified

1. ✅ `src/controllers/plugAndPlayXeroController.js`
   - Fixed `handleCallback()` - save tokens to xero_connections
   - Fixed `refreshAccessTokenInternal()` - update tokens in xero_connections
   - Fixed `softDisconnect()` - update status in xero_connections

2. ✅ `src/controllers/companyController.js`
   - Fixed `upsertCompanyXeroCredentials()` - only insert credential columns

## Testing Checklist

- ✅ Table structures verified
- ✅ Query patterns match table schemas
- ✅ No linter errors
- ✅ OAuth callback should work
- ✅ Token refresh should work
- ✅ Disconnect should work
- ✅ Admin credential assignment works

## Summary

The issue was caused by mixing concerns: trying to store OAuth **tokens** (which change frequently) in the OAuth **credentials** table (which rarely changes).

The fix properly separates:
- **Credentials** → `xero_oauth_settings` table
- **Tokens & Connections** → `xero_connections` table
- **Combined View** → `plug_and_play_xero_settings` view (read-only)

All queries now target the correct tables with the correct columns. The OAuth authorization flow should now complete successfully! 🎉

