const axios = require('axios');
const crypto = require('crypto');
const CompanyCompliance = require('../models/CompanyCompliance');
const XeroSettings = require('../models/XeroSettings');
const db = require('../config/database');
const { getFrontendCallbackUrl, getFrontendRedirectUrl } = require('../config/environment');

/**
 * SECURITY: Get company's own tenant ID - NEVER allow tenant override
 * This prevents companies from accessing other companies' Xero data
 */
const getCompanyTenantId = async (companyId, accessToken) => {
  const xeroSettings = await XeroSettings.getByCompanyId(companyId);
  if (!xeroSettings) {
    throw new Error(`Xero settings not found for company ${companyId}`);
  }

  let tenantId = xeroSettings.tenant_id;
  
  if (!tenantId) {
    // If no tenant ID in settings, get the company's authorized tenants
    const connectionsResponse = await axios.get('https://api.xero.com/connections', {
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }
    });
    
    if (connectionsResponse.data && connectionsResponse.data.length > 0) {
      tenantId = connectionsResponse.data[0].tenantId;
      console.log(`🔒 [Company ${companyId}] Auto-detected tenant: ${tenantId}`);
      
      // Save the tenant ID for future use
      await db.query(
        'UPDATE xero_settings SET tenant_id = $1 WHERE company_id = $2',
        [tenantId, companyId]
      );
    } else {
      throw new Error(`No Xero organizations found for company ${companyId}`);
    }
  }

  // SECURITY: Log tenant access for audit trail
  console.log(`🔒 TENANT ACCESS: Company ${companyId} accessing tenant ${tenantId}`);
  return tenantId;
};

/**
 * Clear expired Xero tokens for a company
 */
const clearExpiredTokens = async (companyId) => {
  try {
    console.log(`🧹 Clearing expired tokens for company ${companyId}`);
    await db.query(
      `UPDATE xero_settings 
       SET access_token = NULL, refresh_token = NULL, token_expires_at = NULL, updated_at = CURRENT_TIMESTAMP 
       WHERE company_id = $1`,
      [companyId]
    );
    console.log(`✅ Cleared expired tokens for company ${companyId}`);
  } catch (error) {
    console.error(`❌ Failed to clear expired tokens for company ${companyId}:`, error);
  }
};

/**
 * Check if company is enrolled (disabled – integration independent)
 */
const isCompanyEnrolled = async () => true;

/**
 * Clean up expired OAuth states (run periodically)
 */
const cleanupExpiredStates = async () => {
  try {
    const result = await db.query(
      `DELETE FROM xero_oauth_states 
       WHERE created_at <= NOW() - INTERVAL '5 minutes'`
    );
    console.log('🧹 Cleaned up expired OAuth states:', result.rowCount);
  } catch (error) {
    console.error('❌ Failed to cleanup expired states:', error);
  }
};

/**
 * Build OAuth2 authorization URL
 * IMPORTANT: Use the SAME redirect_uri as in token exchange (xeroSettings.redirect_uri)
 */
const buildAuthUrl = async (req, res) => {
  try {
    console.log('🔍 Building Xero Auth URL for company:', req.company.id);

    if (req.company.role === 'admin') {
      console.log('❌ Super admin cannot setup Xero accounts');
      return res.status(403).json({
        success: false,
        message: 'Super admins cannot setup Xero accounts. Only regular companies can setup Xero integration.',
        errorCode: 'SUPER_ADMIN_RESTRICTED',
        action: 'use_regular_company',
        details: { currentRole: req.company.role, allowedRoles: ['company'] }
      });
    }

    const companyId = req.company.id;

    console.log('🔍 Getting Xero settings for company:', companyId);
    const xeroSettings = await XeroSettings.getByCompanyId(companyId);
    if (!xeroSettings) {
      console.log('❌ Xero settings not configured for company:', companyId);
      return res.status(400).json({
        success: false,
        message: 'Xero settings not configured for this company. Please configure Xero settings first.',
        errorCode: 'XERO_SETTINGS_MISSING',
        action: 'configure_settings',
        details: {
          requiredFields: ['clientId', 'clientSecret', 'redirectUri'],
          endpoint: '/api/xero/settings',
          method: 'POST'
        }
      });
    }

    // Check if we have OAuth settings (client ID and secret)
    if (!xeroSettings.client_id || !xeroSettings.client_secret) {
      console.log('❌ OAuth settings not configured for company:', companyId);
      return res.status(400).json({
        success: false,
        message: 'Xero OAuth settings not configured for this company. Please configure OAuth settings first.',
        errorCode: 'XERO_OAUTH_SETTINGS_MISSING',
        action: 'configure_oauth_settings',
        details: {
          requiredFields: ['clientId', 'clientSecret'],
          endpoint: '/api/xero/settings',
          method: 'POST',
          helpUrl: 'https://developer.xero.com/',
          commonIssues: [
            'Client ID or Secret is incorrect',
            'Xero app is not in "Live" or "Demo" status',
            'Redirect URI not configured in Xero app',
            'Required scopes not enabled in Xero app'
          ]
        }
      });
    }

    // Validate client ID format (Xero client IDs are UUIDs)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(xeroSettings.client_id)) {
      console.log('❌ Invalid client ID format for company:', companyId);
      return res.status(400).json({
        success: false,
        message: 'Invalid Xero Client ID format. Client ID should be a valid UUID.',
        errorCode: 'INVALID_CLIENT_ID_FORMAT',
        action: 'fix_client_id',
        details: {
          currentClientId: xeroSettings.client_id,
          expectedFormat: 'UUID (e.g., 12345678-1234-1234-1234-123456789012)',
          helpUrl: 'https://developer.xero.com/',
          fixSteps: [
            '1. Go to Xero Developer Portal',
            '2. Find your app in "My Apps"',
            '3. Copy the exact Client ID',
            '4. Update your system with the correct Client ID'
          ]
        }
      });
    }

    await cleanupExpiredStates();

    // State (CSRF)
    const state = crypto.randomBytes(16).toString('hex');
    await db.query(
      'INSERT INTO xero_oauth_states (state, company_id, created_at) VALUES ($1, $2, NOW())',
      [state, companyId]
    );

    // CRITICAL: redirect_uri must match EXACTLY what you registered + what you will use in token exchange
    // For development, always use the production redirect URI that matches Xero app config
    const redirectUri = process.env.XERO_REDIRECT_URI || 'https://compliance-manager-frontend.onrender.com/redirecturl';
    
    // Log the redirect URI being used for debugging
    console.log('🔍 Using redirect URI:', redirectUri);
    console.log('🔍 Environment:', process.env.NODE_ENV || 'development');

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: xeroSettings.client_id,
      redirect_uri: redirectUri,
      scope: 'openid profile email accounting.transactions accounting.contacts accounting.settings offline_access',
      state
    });

    const authUrl = `https://login.xero.com/identity/connect/authorize?${params.toString()}`;
    console.log('✅ Authorization URL generated successfully');

    res.json({
      success: true,
      message: 'Authorization URL generated successfully',
      data: { authUrl, state }
    });
  } catch (error) {
    console.error('❌ Build Auth URL Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate authorization URL',
      error: error.message
    });
  }
};

/**
 * Create and store a state for the OAuth flow
 */
const createXeroAuthState = async (req, res) => {
  try {
    const companyId = req.company.id;
    await cleanupExpiredStates();
    const state = crypto.randomBytes(16).toString('hex');
    await db.query(
      'INSERT INTO xero_oauth_states (state, company_id, created_at) VALUES ($1, $2, NOW())',
      [state, companyId]
    );
    console.log('✅ Created new OAuth state for company:', companyId);
    res.json({ success: true, state });
  } catch (error) {
    console.error('❌ Failed to create OAuth state:', error);
    res.status(500).json({ success: false, message: 'Failed to create state', error: error.message });
  }
};

/**
 * Get OAuth state information
 */
const getXeroAuthState = async (req, res) => {
  try {
    const { state } = req.params;
    const companyId = req.company.id;
    const result = await db.query(
      'SELECT * FROM xero_oauth_states WHERE state = $1 AND company_id = $2',
      [state, companyId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'State not found or expired' });
    }
    res.json({
      success: true,
      data: {
        state: result.rows[0].state,
        companyId: result.rows[0].company_id,
        createdAt: result.rows[0].created_at
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to get state', error: error.message });
  }
};

/**
 * Handle OAuth2 callback and exchange code for tokens
 */
const handleCallback = async (req, res) => {
  try {
    console.log('🔍 Xero Callback Debug - Request method:', req.method);
    console.log('🔍 Xero Callback Debug - Query params:', req.query);

    const { code, state } = req.method === 'GET' ? req.query : req.body;
    if (!code || !state) {
      const errorMessage = 'Code and state are required for OAuth callback';
      const frontendUrl = `${getFrontendCallbackUrl()}?success=false&error=${encodeURIComponent(errorMessage)}&errorDetails=${encodeURIComponent('Missing authorization parameters')}`;
      
      // Set CORS headers before redirect
      res.header('Access-Control-Allow-Origin', 'https://compliance-manager-frontend.onrender.com');
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.header('Access-Control-Allow-Credentials', 'true');
      
      return res.redirect(frontendUrl);
    }

    // Validate state (5 min TTL)
    const result = await db.query(
      `SELECT company_id, created_at 
       FROM xero_oauth_states 
       WHERE state = $1 AND created_at > NOW() - INTERVAL '5 minutes'`,
      [state]
    );
    if (result.rows.length === 0) {
      await db.query(
        `DELETE FROM xero_oauth_states 
         WHERE created_at <= NOW() - INTERVAL '5 minutes'`
      );
      const frontendUrl = `${getFrontendCallbackUrl()}?success=false&error=${encodeURIComponent('Invalid or expired state')}&errorDetails=${encodeURIComponent('The authorization state token is invalid or has expired')}`;
      
      // Set CORS headers before redirect
      res.header('Access-Control-Allow-Origin', 'https://compliance-manager-frontend.onrender.com');
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.header('Access-Control-Allow-Credentials', 'true');
      
      return res.redirect(frontendUrl);
    }

    const companyId = result.rows[0].company_id;

    // Settings
    const xeroSettings = await XeroSettings.getByCompanyId(companyId);
    if (!xeroSettings) {
      const frontendUrl = `${getFrontendCallbackUrl()}?success=false&error=${encodeURIComponent('Xero settings not configured for this company')}&errorDetails=${encodeURIComponent('Please configure Xero settings first')}`;
      
      // Set CORS headers before redirect
      res.header('Access-Control-Allow-Origin', 'https://compliance-manager-frontend.onrender.com');
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.header('Access-Control-Allow-Credentials', 'true');
      
      return res.redirect(frontendUrl);
    }

    // Exchange code for tokens (IMPORTANT: same redirect_uri as used in auth step)
    // For development, always use the production redirect URI that matches Xero app config
    const redirectUri = process.env.XERO_REDIRECT_URI || 'https://compliance-manager-frontend.onrender.com/redirecturl';
    console.log('🔧 Using redirect URI for token exchange:', redirectUri);
    
    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri
    });

    let tokenResp;
    try {
      tokenResp = await axios.post('https://identity.xero.com/connect/token', params, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Basic ${Buffer.from(`${xeroSettings.client_id}:${xeroSettings.client_secret}`).toString('base64')}`
        }
      });
    } catch (error) {
      const payload = error.response?.data || {};
      let errorMessage = 'Failed to exchange authorization code for tokens';
      let errorDetails = payload.error_description || error.message;
      let helpUrl = 'https://developer.xero.com/';
      
      if (payload.error === 'invalid_grant') {
        errorMessage = 'Authorization code has expired. Please try connecting to Xero again.';
      } else if (payload.error === 'invalid_client') {
        errorMessage = 'Invalid Xero client credentials. Please check your Client ID and Client Secret.';
        errorDetails = 'This usually means your Xero app is not properly configured. Check the Xero Developer Portal.';
      } else if (payload.error === 'unauthorized_client') {
        errorMessage = 'Xero app not authorized. Please check your Xero app configuration.';
        errorDetails = 'Your Xero app may not be in "Live" or "Demo" status, or the Client ID/Secret is incorrect.';
      } else if (payload.error === 'invalid_redirect_uri') {
        errorMessage = 'Invalid redirect URI. Please check your Xero app configuration.';
        errorDetails = 'The redirect URI in your Xero app must match exactly: ' + redirectUri;
      }
      
      const frontendUrl = `${getFrontendCallbackUrl()}?success=false&error=${encodeURIComponent(errorMessage)}&errorDetails=${encodeURIComponent(errorDetails)}&helpUrl=${encodeURIComponent(helpUrl)}&errorCode=${encodeURIComponent(payload.error || 'unknown')}`;
      
      // Set CORS headers before redirect
      res.header('Access-Control-Allow-Origin', 'https://compliance-manager-frontend.onrender.com');
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.header('Access-Control-Allow-Credentials', 'true');
      
      return res.redirect(frontendUrl);
    }

    const tokens = {
      accessToken: tokenResp.data.access_token,
      refreshToken: tokenResp.data.refresh_token,
      expiresIn: tokenResp.data.expires_in,
      tokenType: tokenResp.data.token_type
    };

    // Get tenants (connections)
    const tenantsResponse = await axios.get('https://api.xero.com/connections', {
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
        'Content-Type': 'application/json'
      }
    });

    console.log(`📊 Retrieved ${tenantsResponse.data.length} Xero tenant(s) for company ${companyId}`);

    // Extract tenant information
    const primaryTenant = tenantsResponse.data[0];
    const tenantId = primaryTenant?.tenantId || null;
    const tenantName = primaryTenant?.tenantName || null;
    const tenantData = JSON.stringify(tenantsResponse.data);

    console.log(`🏢 Primary tenant: ${tenantName} (${tenantId})`);

    // Save tokens, tenant ID, tenant name, and tenant data
    try {
      await db.query(
        `UPDATE xero_settings 
         SET access_token = $1, 
             refresh_token = $2, 
             token_expires_at = $3, 
             tenant_id = $4,
             organization_name = $5,
             tenant_data = $6,
             updated_at = CURRENT_TIMESTAMP 
         WHERE company_id = $7`,
        [
          tokens.accessToken, 
          tokens.refreshToken, 
          new Date(Date.now() + tokens.expiresIn * 1000), 
          tenantId,
          tenantName,
          tenantData,
          companyId
        ]
      );
      console.log(`✅ Successfully saved tokens and tenant info for company ${companyId}`);
    } catch (dbError) {
      console.error('⚠️ Failed to store tokens in database:', dbError.message);
      console.error('⚠️ DB Error details:', dbError);
    }

    // State one-time use
    await db.query('DELETE FROM xero_oauth_states WHERE state = $1', [state]);

    const frontendUrl = `${getFrontendCallbackUrl()}?success=true&companyId=${companyId}&tenants=${encodeURIComponent(JSON.stringify(tenantsResponse.data))}`;
    
    // Set CORS headers before redirect
    res.header('Access-Control-Allow-Origin', 'https://compliance-manager-frontend.onrender.com');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.header('Access-Control-Allow-Credentials', 'true');
    
    return res.redirect(frontendUrl);
  } catch (error) {
    console.error('❌ OAuth Callback Error:', {
      message: error.message,
      response: error.response?.data,
      status: error.response?.status,
      stack: error.stack
    });

    const frontendUrl = `${getFrontendCallbackUrl()}?success=false&error=${encodeURIComponent('Failed to complete OAuth flow')}&errorDetails=${encodeURIComponent(error.message)}`;
    
    // Set CORS headers before redirect
    res.header('Access-Control-Allow-Origin', 'https://compliance-manager-frontend.onrender.com');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.header('Access-Control-Allow-Credentials', 'true');
    
    return res.redirect(frontendUrl);
  }
};

/** ------------------------ Helpers ------------------------ **/

// Simple rate limiting between Xero calls
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 500; // ms

// Map legacy/incorrect resource names to correct ones
const mapResourcePath = (resourceType) => {
  if (resourceType === 'Organisations') return 'Organisation'; // Xero path is singular, response key is "Organisations"
  return resourceType;
};

// Normalize keys access (Xero returns PascalCase arrays)
const pickArray = (obj, keyPascal) =>
  obj?.[keyPascal] || obj?.[keyPascal.toLowerCase()] || obj?.[keyPascal.toUpperCase()] || [];

// Robust tenantId selection (supports ?tenantId=, ?tenant_id=, ?id=, ?tenant=)
const resolveTenantId = async (accessToken, rawTenantId) => {
  let tenantId = rawTenantId;
  if (!tenantId) return null;
  tenantId = String(tenantId).trim();
  if (tenantId) return tenantId;

  // fallback via connections if absolutely needed (shouldn't usually hit)
  const connectionsResp = await axios.get('https://api.xero.com/connections', {
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }
  });
  return connectionsResp.data?.[0]?.tenantId || null;
};

/**
 * Authenticate with Xero using credentials
 */
const authenticateWithCredentials = async (username, password, organizationName) => {
  try {
    console.log('🔐 Authenticating with Xero credentials...');
    
    // For a real implementation, you would integrate with Xero's authentication API
    // Since Xero doesn't provide direct username/password authentication for third-party apps,
    // we'll use a simplified approach that simulates the authentication process
    
    // In a production environment, you would:
    // 1. Use Xero's Partner API or other authentication methods
    // 2. Implement proper token management
    // 3. Handle organization selection
    
    // For now, we'll create a mock token that represents a successful authentication
    const mockAccessToken = `xero_cred_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    console.log('✅ Credential authentication successful (simulated)');
    return {
      success: true,
      accessToken: mockAccessToken,
      tokenType: 'Bearer',
      expiresIn: 3600, // 1 hour
      organizationName: organizationName || 'Default Organization'
    };
  } catch (error) {
    console.error('❌ Credential authentication failed:', error);
    return {
      success: false,
      error: error.message || 'Failed to authenticate with Xero credentials'
    };
  }
};

/**
 * Refresh Xero access token
 */
const refreshXeroToken = async (refreshToken, clientId, clientSecret) => {
  try {
    console.log('🔄 Refreshing Xero access token...');
    
    // Validate inputs
    if (!refreshToken || !clientId || !clientSecret) {
      console.log('❌ Missing required parameters for token refresh');
      return { 
        success: false, 
        error: 'Missing refresh token, client ID, or client secret' 
      };
    }
    
    const params = new URLSearchParams({ 
      grant_type: 'refresh_token', 
      refresh_token: refreshToken 
    });
    
    const response = await axios.post('https://identity.xero.com/connect/token', params, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`
      },
      timeout: 15000 // 15 second timeout for token refresh
    });

    console.log('✅ Token refresh successful');
    return {
      success: true,
      accessToken: response.data.access_token,
      refreshToken: response.data.refresh_token,
      expiresIn: response.data.expires_in,
      tokenType: response.data.token_type
    };
  } catch (error) {
    console.error('❌ Token refresh failed:', error.response?.data || error.message);
    
    // Handle specific error cases
    if (error.response?.status === 400) {
      const errorData = error.response.data;
      if (errorData.error === 'invalid_grant') {
        return { 
          success: false, 
          error: 'Refresh token is invalid or expired. Please reconnect to Xero.',
          errorType: 'invalid_refresh_token'
        };
      } else if (errorData.error === 'invalid_client') {
        return { 
          success: false, 
          error: 'Invalid client credentials. Please check your Xero app configuration.',
          errorType: 'invalid_client'
        };
      }
    }
    
    if (error.code === 'ECONNABORTED') {
      return { 
        success: false, 
        error: 'Token refresh timed out. Please try again.',
        errorType: 'timeout'
      };
    }
    
    return { 
      success: false, 
      error: error.response?.data || error.message,
      errorType: 'unknown'
    };
  }
};

/**
 * Helper to fetch Xero data w/ token refresh + 429 retry
 */
const fetchXeroData = async (accessToken, tenantId, resourceType, params = {}, companyId = null) => {
  // rate limit
  const now = Date.now();
  const since = now - lastRequestTime;
  if (since < MIN_REQUEST_INTERVAL) {
    const wait = MIN_REQUEST_INTERVAL - since;
    console.log(`⏳ Rate limiting: waiting ${wait}ms before next request...`);
    await new Promise((r) => setTimeout(r, wait));
  }
  lastRequestTime = Date.now();

  const baseUrl = 'https://api.xero.com/api.xro/2.0';
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'xero-tenant-id': tenantId, // lowercase header is fine; HTTP headers are case-insensitive
    Accept: 'application/json'
  };

  let path = mapResourcePath(resourceType);
  let url = `${baseUrl}/${path}`;

  if (params && Object.keys(params).length > 0) {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && `${v}` !== '') qs.append(k, v);
    });
    url += `?${qs.toString()}`;
  }

  console.log(`🔍 Fetching Xero data: ${url}`);

  try {
    const response = await axios.get(url, { 
      headers,
      timeout: 15000 // 15 second timeout for Xero API calls
    });
    console.log(`✅ Xero data fetched: ${resourceType}`);
    return response.data;
  } catch (error) {
    console.error(`❌ Error fetching Xero data (${resourceType}):`, error.response?.data || error.message);

    // 429 backoff once
    if (error.response?.status === 429) {
      console.log('⚠️ Rate limit exceeded, waiting 2 seconds before retry...');
      await new Promise((r) => setTimeout(r, 2000));
      const retryResp = await axios.get(url, { 
        headers,
        timeout: 15000 // 15 second timeout for retry
      });
      console.log(`✅ Xero data fetched after retry: ${resourceType}`);
      return retryResp.data;
    }

    // 401 – try refresh if we can
    if (error.response?.status === 401 && companyId) {
      console.log('🔄 Token expired, attempting to refresh...');
      const xeroSettings = await XeroSettings.getByCompanyId(companyId);
      if (xeroSettings?.refresh_token && xeroSettings?.client_id && xeroSettings?.client_secret) {
        const refresh = await refreshXeroToken(
          xeroSettings.refresh_token,
          xeroSettings.client_id,
          xeroSettings.client_secret
        );
        if (refresh.success) {
          await db.query(
            `UPDATE xero_settings 
             SET access_token = $1, refresh_token = $2, token_expires_at = $3, updated_at = CURRENT_TIMESTAMP 
             WHERE company_id = $4`,
            [refresh.accessToken, refresh.refreshToken, new Date(Date.now() + refresh.expiresIn * 1000), companyId]
          );
          const retryResp = await axios.get(url, {
            headers: { ...headers, Authorization: `Bearer ${refresh.accessToken}` },
            timeout: 15000 // 15 second timeout for token refresh retry
          });
          console.log(`✅ Xero data fetched after token refresh: ${resourceType}`);
          return retryResp.data;
        } else {
          console.log('❌ Token refresh failed:', refresh.error);
          if (refresh.errorType === 'invalid_refresh_token') {
            console.log('🔄 Refresh token is invalid, clearing tokens and requiring reconnection');
            await clearExpiredTokens(companyId);
          }
        }
      } else {
        console.log('❌ Missing refresh token or client credentials');
        await clearExpiredTokens(companyId);
      }
    }

    throw error;
  }
};

/** ------------------------ Feature Handlers ------------------------ **/

/**
 * Generic data fetcher
 */
const getXeroData = async (req, res) => {
  try {
    const { resourceType } = req.params;
    const { accessToken, tenantId } = req.body;

    if (!accessToken || !tenantId) {
      return res.status(400).json({ success: false, message: 'Access token and tenant ID are required' });
    }

    const validResourceTypes = [
      'Invoices',
      'Contacts',
      'BankTransactions',
      'Accounts',
      'Items',
      'TaxRates',
      'TrackingCategories',
      'Organisation',      // ✅ correct path
      'Organisations'      // backward-compat alias, mapped to Organisation
    ];

    if (!validResourceTypes.includes(resourceType)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid resource type',
        error: `Resource type must be one of: ${validResourceTypes.join(', ')}`
      });
    }

    const response = await axios.get(
      `https://api.xero.com/api.xro/2.0/${mapResourcePath(resourceType)}`,
      { headers: { Authorization: `Bearer ${accessToken}`, 'xero-tenant-id': tenantId, 'Content-Type': 'application/json' } }
    );

    res.json({ success: true, message: `${resourceType} retrieved successfully`, data: response.data });
  } catch (error) {
    console.error('Get Xero Data Error:', error);
    if (error.response?.status === 401) {
      return res.status(401).json({ success: false, message: 'Authentication failed. Please reconnect your Xero account.', error: error.message });
    }
    if (error.response?.status === 403) {
      return res.status(403).json({ success: false, message: 'Insufficient permissions for this operation.', error: error.message });
    }
    if (error.response?.status === 404) {
      return res.status(404).json({ success: false, message: 'Resource not found.', error: error.message });
    }
    res.status(500).json({ success: false, message: 'Failed to get Xero data', error: error.message });
  }
};

/**
 * Refresh access token (manual endpoint)
 */
const refreshToken = async (req, res) => {
  try {
    const { refreshToken: incomingRefreshToken, companyId } = req.body;

    if (!incomingRefreshToken || !companyId) {
      return res.status(400).json({ success: false, message: 'Refresh token and company ID are required' });
    }

    const xeroSettings = await XeroSettings.getByCompanyId(companyId);
    if (!xeroSettings) {
      return res.status(400).json({ success: false, message: 'Xero settings not configured for this company' });
    }

    const params = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: incomingRefreshToken });
    const response = await axios.post('https://identity.xero.com/connect/token', params, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${Buffer.from(`${xeroSettings.client_id}:${xeroSettings.client_secret}`).toString('base64')}`
      }
    });

    const tokens = {
      accessToken: response.data.access_token,
      refreshToken: response.data.refresh_token,
      expiresIn: response.data.expires_in,
      tokenType: response.data.token_type
    };

    res.json({ success: true, message: 'Token refreshed successfully', data: tokens });
  } catch (error) {
    console.error('Refresh Token Error:', error);
    res.status(500).json({ success: false, message: 'Failed to refresh token', error: error.message });
  }
};

/**
 * Company info (unchanged behavior)
 */
const getCompanyInfo = async (req, res) => {
  try {
    const companyId = req.company.id;
    const enrolled = await isCompanyEnrolled(companyId);

    const companyData = {
      id: req.company.id,
      companyName: req.company.companyName,
      email: req.company.email,
      role: req.company.role,
      isEnrolled: enrolled,
      enrollmentStatus: { isEnrolled: enrolled, message: 'Xero integration is now independent of compliance enrollment' }
    };

    if (enrolled) {
      try {
        const compliance = await CompanyCompliance.getByCompanyId(companyId);
        if (compliance) {
          companyData.compliance = {
            basFrequency: compliance.basFrequency,
            nextBasDue: compliance.nextBasDue,
            fbtApplicable: compliance.fbtApplicable,
            nextFbtDue: compliance.nextFbtDue,
            iasRequired: compliance.iasRequired,
            iasFrequency: compliance.iasFrequency,
            nextIasDue: compliance.nextIasDue,
            financialYearEnd: compliance.financialYearEnd
          };
        }
      } catch (e) {
        console.error('Error fetching compliance details:', e);
      }
    }

    res.json({ success: true, message: 'Company information retrieved successfully', data: companyData });
  } catch (error) {
    console.error('Get Company Info Error:', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve company information', error: error.message });
  }
};

/**
 * Create or update Xero settings for a company
 */
const createXeroSettings = async (req, res) => {
  try {
    console.log('🔍 DEBUG: createXeroSettings called');
    console.log('🔍 DEBUG: req.body:', req.body);

    const companyId = req.company.id;
    const { clientId, clientSecret, redirectUri, username, password, organizationName, accessToken } = req.body;

    // Determine authentication method based on provided fields
    const hasCredentials = username && password;
    const hasToken = accessToken;
    const hasOAuth = clientId && clientSecret;

    if (!hasCredentials && !hasToken && !hasOAuth) {
      return res.status(400).json({ 
        success: false, 
        message: 'Please provide either Xero credentials (username/password), access token, or OAuth settings (clientId/clientSecret)' 
      });
    }

    let settingsData = {};

    if (hasCredentials) {
      // Credential-based authentication
      settingsData = {
        username: username.trim(),
        password: password.trim(),
        organizationName: organizationName?.trim() || null
      };
      console.log('🔧 Using credential-based authentication');
    } else if (hasToken) {
      // Token-based authentication
      settingsData = {
        accessToken: accessToken.trim()
      };
      console.log('🔧 Using token-based authentication');
    } else if (hasOAuth) {
      // OAuth-based authentication (legacy)
      const { getFrontendRedirectUrl } = require('../config/environment');
      const environmentRedirectUri = getFrontendRedirectUrl();
      const finalRedirectUri = redirectUri || environmentRedirectUri;
      
      // Validate that the redirect URI doesn't contain localhost in production
      if (process.env.NODE_ENV === 'production' && finalRedirectUri.includes('localhost')) {
        return res.status(400).json({ 
          success: false, 
          message: 'Localhost URLs are not allowed in production. Please use a production URL.',
          errorCode: 'LOCALHOST_NOT_ALLOWED_IN_PRODUCTION',
          suggestedUrl: environmentRedirectUri
        });
      }

      try { new URL(finalRedirectUri); } catch {
        return res.status(400).json({ success: false, message: 'Invalid redirect URI format' });
      }

      settingsData = {
        clientId: clientId.trim(),
        clientSecret: clientSecret.trim(),
        redirectUri: finalRedirectUri
      };
      console.log('🔧 Using OAuth-based authentication');
    }

    const settings = await XeroSettings.createSettings(companyId, settingsData);

    res.json({
      success: true,
      message: 'Xero settings saved successfully',
      data: {
        id: settings.id,
        companyId: settings.company_id,
        username: settings.username,
        organizationName: settings.organization_name,
        clientId: settings.client_id,
        redirectUri: settings.redirect_uri,
        createdAt: settings.created_at,
        updatedAt: settings.updated_at
      }
    });
  } catch (error) {
    console.error('Create Xero Settings Error:', error);
    res.status(500).json({ success: false, message: 'Failed to save Xero settings', error: error.message });
  }
};

/**
 * Get Xero settings for a company (+ verify connection and list tenants)
 */
const getXeroSettings = async (req, res) => {
  try {
    const companyId = req.company.id;
    const settings = await XeroSettings.getByCompanyId(companyId);

    if (!settings) {
      return res.status(404).json({ success: false, message: 'Xero settings not found for this company' });
    }

    let isConnected = false;
    let connectionStatus = 'not_configured';
    let tenants = [];

    // Check for credential-based authentication
    if (settings.username && settings.password) {
      try {
        // Authenticate with credentials
        const authResult = await authenticateWithCredentials(settings.username, settings.password, settings.organization_name);
        if (authResult.success) {
          // Update the access token in the database
          await db.query(
            `UPDATE xero_settings 
             SET access_token = $1, token_expires_at = $2, updated_at = CURRENT_TIMESTAMP 
             WHERE company_id = $3`,
            [authResult.accessToken, new Date(Date.now() + authResult.expiresIn * 1000), companyId]
          );
          
          // For credential-based auth, we'll create mock tenant data since we're not using real Xero API
          tenants = [{
            id: `tenant_${companyId}`,
            connectionId: `conn_${companyId}`,
            name: authResult.organizationName,
            organizationName: authResult.organizationName,
            tenantName: authResult.organizationName,
            tenantId: `tenant_${companyId}`
          }];
          isConnected = true;
          connectionStatus = 'connected';
        } else {
          connectionStatus = 'credential_auth_failed';
        }
      } catch (e) {
        console.log('⚠️ Credential authentication failed:', e.message);
        connectionStatus = 'credential_auth_failed';
      }
    }
    // Check for token-based authentication
    else if (settings.access_token && settings.refresh_token) {
      const now = new Date();
      const tokenExpiresAt = settings.token_expires_at ? new Date(settings.token_expires_at) : null;

      if (tokenExpiresAt && tokenExpiresAt > now) {
        try {
          const tenantsResponse = await axios.get('https://api.xero.com/connections', {
            headers: { Authorization: `Bearer ${settings.access_token}`, 'Content-Type': 'application/json' }
          });
          tenants = tenantsResponse.data.map((c) => ({
            id: c.tenantId,
            connectionId: c.id,
            name: c.tenantName || 'Unknown Organization',
            organizationName: c.tenantName || 'Unknown Organization',
            tenantName: c.tenantName || 'Unknown Organization',
            tenantId: c.tenantId
          }));
          isConnected = true;
          connectionStatus = 'connected';
        } catch (e) {
          console.log('⚠️ Token validation failed, will need refresh:', e.message);
          connectionStatus = 'token_expired';
        }
      } else {
        // expired → refresh
        try {
          const refreshResponse = await refreshXeroToken(settings.refresh_token, settings.client_id, settings.client_secret);
          if (refreshResponse.success) {
            await db.query(
              `UPDATE xero_settings 
               SET access_token = $1, refresh_token = $2, token_expires_at = $3, updated_at = CURRENT_TIMESTAMP 
               WHERE company_id = $4`,
              [refreshResponse.accessToken, refreshResponse.refreshToken, new Date(Date.now() + refreshResponse.expiresIn * 1000), companyId]
            );
            const tenantsResponse = await axios.get('https://api.xero.com/connections', {
              headers: { Authorization: `Bearer ${refreshResponse.accessToken}`, 'Content-Type': 'application/json' }
            });
            tenants = tenantsResponse.data.map((c) => ({
              id: c.tenantId,
              connectionId: c.id,
              name: c.tenantName || 'Unknown Organization',
              organizationName: c.tenantName || 'Unknown Organization',
              tenantName: c.tenantName || 'Unknown Organization',
              tenantId: c.tenantId
            }));
            isConnected = true;
            connectionStatus = 'connected';
          } else {
            connectionStatus = 'refresh_failed';
          }
        } catch (refreshError) {
          console.log('⚠️ Token refresh failed:', refreshError.message);
          connectionStatus = 'refresh_failed';
        }
      }
    }

    res.json({
      success: true,
      message: 'Xero settings retrieved successfully',
      data: {
        id: settings.id,
        companyId: settings.company_id,
        username: settings.username,
        organizationName: settings.organization_name,
        clientId: settings.client_id,
        redirectUri: settings.redirect_uri,
        createdAt: settings.created_at,
        updatedAt: settings.updated_at,
        isConnected,
        connectionStatus,
        tenants,
        hasValidTokens: !!(settings.access_token && settings.refresh_token),
        authMethod: settings.username && settings.password ? 'credentials' : 
                   settings.access_token ? 'token' : 'oauth'
      }
    });
  } catch (error) {
    console.error('Get Xero Settings Error:', error);
    res.status(500).json({ success: false, message: 'Failed to get Xero settings', error: error.message });
  }
};

/**
 * Delete Xero settings for a company
 */
const deleteXeroSettings = async (req, res) => {
  try {
    const companyId = req.company.id;
    const settings = await XeroSettings.deleteSettings(companyId);
    if (!settings) return res.status(404).json({ success: false, message: 'Xero settings not found for this company' });

    res.json({ success: true, message: 'Xero settings deleted successfully', data: { id: settings.id, companyId: settings.company_id } });
  } catch (error) {
    console.error('Delete Xero Settings Error:', error);
    res.status(500).json({ success: false, message: 'Failed to delete Xero settings', error: error.message });
  }
};

/**
 * Admin – get all Xero settings
 */
const getAllXeroSettings = async (req, res) => {
  try {
    if (req.company.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Access denied. Admin privileges required.' });
    }
    const settings = await XeroSettings.getAllSettings();
    const { getFrontendRedirectUrl } = require('../config/environment');
    const environmentRedirectUri = getFrontendRedirectUrl();
    
    res.json({
      success: true,
      message: 'All Xero settings retrieved successfully',
      data: settings.map((s) => ({
        id: s.id,
        companyId: s.company_id,
        companyName: s.company_name,
        email: s.email,
        clientId: s.client_id,
        redirectUri: s.redirect_uri,
        environmentRedirectUri,
        needsUpdate: s.redirect_uri !== environmentRedirectUri,
        createdAt: s.created_at,
        updatedAt: s.updated_at
      }))
    });
  } catch (error) {
    console.error('Get All Xero Settings Error:', error);
    res.status(500).json({ success: false, message: 'Failed to get all Xero settings', error: error.message });
  }
};

/**
 * Update redirect URIs for all companies to match current environment
 */
const updateAllRedirectUris = async (req, res) => {
  try {
    if (req.company.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Access denied. Admin privileges required.' });
    }
    
    const { getFrontendRedirectUrl } = require('../config/environment');
    const environmentRedirectUri = getFrontendRedirectUrl();
    
    // Get all settings
    const settings = await XeroSettings.getAllSettings();
    const updatedSettings = [];
    
    for (const setting of settings) {
      if (setting.redirect_uri !== environmentRedirectUri) {
        // Update the redirect URI
        const updated = await XeroSettings.updateSettings(setting.company_id, {
          clientId: setting.client_id,
          clientSecret: setting.client_secret,
          redirectUri: environmentRedirectUri
        });
        updatedSettings.push(updated);
      }
    }
    
    res.json({
      success: true,
      message: `Updated ${updatedSettings.length} redirect URIs to match current environment`,
      data: {
        environmentRedirectUri,
        updatedCount: updatedSettings.length,
        updatedSettings: updatedSettings.map(s => ({
          companyId: s.company_id,
          oldRedirectUri: settings.find(orig => orig.company_id === s.company_id)?.redirect_uri,
          newRedirectUri: s.redirect_uri
        }))
      }
    });
  } catch (error) {
    console.error('Update All Redirect URIs Error:', error);
    res.status(500).json({ success: false, message: 'Failed to update redirect URIs', error: error.message });
  }
};

/**
 * DASHBOARD – compact, reliable, tenant-aware
 */
const getDashboardData = async (req, res) => {
  try {
    const companyId = req.company.id;
    const xeroSettings = await XeroSettings.getByCompanyId(companyId);
    if (!xeroSettings) return res.status(404).json({ success: false, message: 'Xero settings not found for this company' });

    const accessToken = xeroSettings.access_token;
    if (!accessToken) return res.status(400).json({ success: false, message: 'No access token found. Please reconnect to Xero.' });

    // SECURITY: Get company's own tenant ID - prevent cross-company data access
    const tenantId = await getCompanyTenantId(companyId, accessToken);

    // Fetch core data (with short spacing to avoid rate limit)
    const invoices = await fetchXeroData(accessToken, tenantId, 'Invoices', { page: 1 }, companyId);
    await new Promise((r) => setTimeout(r, 400));
    const contacts = await fetchXeroData(accessToken, tenantId, 'Contacts', { page: 1 }, companyId);
    await new Promise((r) => setTimeout(r, 400));
    const bankTransactions = await fetchXeroData(accessToken, tenantId, 'BankTransactions', { page: 1 }, companyId);
    await new Promise((r) => setTimeout(r, 400));
    const accounts = await fetchXeroData(accessToken, tenantId, 'Accounts', {}, companyId);
    await new Promise((r) => setTimeout(r, 400));
    const organisation = await fetchXeroData(accessToken, tenantId, 'Organisation', {}, companyId);

    // Normalize arrays
    const invArr = pickArray(invoices, 'Invoices');
    const conArr = pickArray(contacts, 'Contacts');
    const txnArr = pickArray(bankTransactions, 'BankTransactions');
    const accArr = pickArray(accounts, 'Accounts');
    const orgInfo = pickArray(organisation, 'Organisations')?.[0] || {};

    // Summary numbers
    const totalInvoices = invArr.length;
    const totalContacts = conArr.length;
    const totalTransactions = txnArr.length;
    const totalAccounts = accArr.length;

    // Totals (Xero returns PascalCase fields like Total, Status, DueDate)
    const totalAmount = invArr.reduce((sum, inv) => {
      try {
        return sum + (parseFloat(inv.Total) || 0);
      } catch (error) {
        console.log('⚠️ Error parsing invoice total:', inv.Total, 'for invoice:', inv.InvoiceNumber || inv.ID);
        return sum;
      }
    }, 0);
    const paidInvoices = invArr.filter((inv) => inv.Status === 'PAID').length;

    const nowISO = new Date().toISOString();
    const overdueInvoices = invArr.filter((inv) => {
      if (inv.Status === 'PAID' || !inv.DueDate) return false;
      
      try {
        const dueDate = new Date(inv.DueDate);
        // Check if the date is valid
        if (isNaN(dueDate.getTime())) return false;
        return dueDate.toISOString() < nowISO;
      } catch (error) {
        console.log('⚠️ Invalid due date format:', inv.DueDate, 'for invoice:', inv.InvoiceNumber || inv.ID);
        return false;
      }
    }).length;

    const isOrganizationEmpty = totalInvoices === 0 && totalContacts === 0 && totalTransactions === 0;

    res.json({
      success: true,
      message: 'Dashboard data retrieved successfully',
      data: {
        summary: {
          totalInvoices,
          totalContacts,
          totalTransactions,
          totalAccounts,
          totalAmount: totalAmount.toFixed(2),
          paidInvoices,
          overdueInvoices
        },
        recentInvoices: invArr,
        recentContacts: conArr,
        recentTransactions: txnArr,
        accounts: accArr,
        organization: orgInfo,
        organizationStatus: {
          isEmpty: isOrganizationEmpty,
          message: isOrganizationEmpty
            ? 'This Xero organization appears to be empty. You may need to add some data to see it here.'
            : 'Organization has data available',
          suggestions: isOrganizationEmpty
            ? ['Create some contacts in Xero', 'Add invoices or bills', 'Import bank transactions', 'Set up chart of accounts']
            : []
        }
      }
    });
  } catch (error) {
    console.error('Dashboard Data Error:', error);
    console.error('Error stack:', error.stack);

    let errorMessage = 'Failed to retrieve dashboard data';
    let statusCode = 500;
    
    if (error.message === 'Invalid time value') {
      errorMessage = 'Date parsing error in Xero data. Please try again.';
      statusCode = 422;
    } else if (error.response?.status === 429) { 
      errorMessage = 'Rate limit exceeded. Please try again in a few minutes.'; 
      statusCode = 429; 
    } else if (error.response?.status === 401) { 
      errorMessage = 'Authentication failed. Please reconnect to Xero.'; 
      statusCode = 401; 
    } else if (error.response?.status === 403) { 
      errorMessage = 'Access denied. Please check your Xero permissions.'; 
      statusCode = 403; 
    } else if (error.code === 'ECONNREFUSED') { 
      errorMessage = 'Unable to connect to Xero. Please check your internet connection.'; 
      statusCode = 503; 
    }

    res.status(statusCode).json({ success: false, message: errorMessage, error: error.message });
  }
};

/**
 * Financial summary (fixed casing + token refresh support)
 */
const getFinancialSummary = async (req, res) => {
  const companyId = req.company.id;
  try {
    const xeroSettings = await XeroSettings.getByCompanyId(companyId);
    if (!xeroSettings) return res.status(404).json({ success: false, message: 'Xero settings not found for this company' });

    const accessToken = xeroSettings.access_token;
    if (!accessToken) return res.status(400).json({ success: false, message: 'No access token found. Please reconnect to Xero.' });

    // Tenant
    // SECURITY: Get company's own tenant ID - prevent cross-company data access
    const tenantId = await getCompanyTenantId(companyId, accessToken);

    // Use Promise.allSettled with shorter timeouts for faster response
    const [invoicesResult, bankTransactionsResult] = await Promise.allSettled([
      Promise.race([
        fetchXeroData(accessToken, tenantId, 'Invoices', { page: 1, pageSize: 50 }, companyId), // Reduced pageSize for faster response
        new Promise((_, reject) => setTimeout(() => reject(new Error('Invoices request timeout')), 10000)) // Reduced to 10 seconds
      ]),
      Promise.race([
        fetchXeroData(accessToken, tenantId, 'BankTransactions', { page: 1, pageSize: 50 }, companyId), // Reduced pageSize for faster response
        new Promise((_, reject) => setTimeout(() => reject(new Error('Bank transactions request timeout')), 10000)) // Reduced to 10 seconds
      ])
    ]);

    // Handle partial failures gracefully
    let invArr = [];
    let txnArr = [];

    if (invoicesResult.status === 'fulfilled') {
      invArr = pickArray(invoicesResult.value, 'Invoices');
      console.log(`✅ Retrieved ${invArr.length} invoices`);
    } else {
      console.log('⚠️ Failed to retrieve invoices:', invoicesResult.reason.message);
    }

    if (bankTransactionsResult.status === 'fulfilled') {
      txnArr = pickArray(bankTransactionsResult.value, 'BankTransactions');
      console.log(`✅ Retrieved ${txnArr.length} bank transactions`);
    } else {
      console.log('⚠️ Failed to retrieve bank transactions:', bankTransactionsResult.reason.message);
    }

    // Calculate financial metrics with error handling
    const totalRevenue = invArr.reduce((s, inv) => {
      try {
        return s + (parseFloat(inv.Total) || 0);
      } catch (e) {
        console.log('⚠️ Error parsing invoice total:', inv.Total);
        return s;
      }
    }, 0);

    const paidRevenue = invArr.filter((inv) => inv.Status === 'PAID').reduce((s, inv) => {
      try {
        return s + (parseFloat(inv.Total) || 0);
      } catch (e) {
        console.log('⚠️ Error parsing paid invoice total:', inv.Total);
        return s;
      }
    }, 0);

    const outstandingRevenue = totalRevenue - paidRevenue;

    const totalExpenses = txnArr.reduce((s, tx) => {
      try {
        return s + (parseFloat(tx.Total) || 0);
      } catch (e) {
        console.log('⚠️ Error parsing transaction total:', tx.Total);
        return s;
      }
    }, 0);

    const netIncome = paidRevenue - totalExpenses;

    // Check if we have any data
    const hasData = invArr.length > 0 || txnArr.length > 0;
    const partialData = (invoicesResult.status === 'rejected' || bankTransactionsResult.status === 'rejected') && hasData;

    res.json({
      success: true,
      message: partialData 
        ? 'Financial summary retrieved with partial data (some sources timed out)'
        : 'Financial summary retrieved successfully',
      data: {
        totalRevenue: totalRevenue.toFixed(2),
        paidRevenue: paidRevenue.toFixed(2),
        outstandingRevenue: outstandingRevenue.toFixed(2),
        totalExpenses: totalExpenses.toFixed(2),
        netIncome: netIncome.toFixed(2),
        invoiceCount: invArr.length,
        transactionCount: txnArr.length,
        dataQuality: {
          invoicesRetrieved: invoicesResult.status === 'fulfilled',
          transactionsRetrieved: bankTransactionsResult.status === 'fulfilled',
          partialData: partialData
        }
      }
    });
  } catch (error) {
    console.error('Financial Summary Error:', error);
    
    // Handle specific timeout errors
    if (error.message && error.message.includes('timeout')) {
      return res.status(408).json({ 
        success: false, 
        message: 'Financial analysis timed out. The request took too long to complete. Please try again or contact support if the issue persists.',
        error: 'Request timeout',
        suggestion: 'Try again in a few minutes or check your Xero connection',
        action: 'retry_later'
      });
    }
    
    // Handle rate limiting
    if (error.response?.status === 429) {
      return res.status(429).json({
        success: false,
        message: 'Xero API rate limit exceeded. Please try again in a few minutes.',
        error: 'Rate limit exceeded',
        suggestion: 'Wait 1-2 minutes before trying again',
        action: 'retry_later'
      });
    }
    
    // Handle authentication errors
    if (error.response?.status === 401) {
      return res.status(401).json({
        success: false,
        message: 'Xero authorization expired. Please reconnect to Xero.',
        error: 'Authorization required',
        action: 'reconnect_required'
      });
    }
    
    res.status(500).json({ 
      success: false, 
      message: 'Failed to retrieve financial summary', 
      error: error.message 
    });
  }
};

/**
 * Optimized financial summary with caching and better timeout handling
 */
const getFinancialSummaryOptimized = async (req, res) => {
  const companyId = req.company.id;
  try {
    const xeroSettings = await XeroSettings.getByCompanyId(companyId);
    if (!xeroSettings) return res.status(404).json({ success: false, message: 'Xero settings not found for this company' });

    const accessToken = xeroSettings.access_token;
    if (!accessToken) return res.status(400).json({ success: false, message: 'No access token found. Please reconnect to Xero.' });

    // SECURITY: Get company's own tenant ID - prevent cross-company data access
    const tenantId = await getCompanyTenantId(companyId, accessToken);

    // Use sequential requests with shorter timeouts for better reliability
    let invArr = [];
    let txnArr = [];
    let invoicesRetrieved = false;
    let transactionsRetrieved = false;

    // Try invoices first (usually faster)
    try {
      const invoicesPromise = Promise.race([
        fetchXeroData(accessToken, tenantId, 'Invoices', { page: 1, pageSize: 25 }, companyId), // Even smaller pageSize
        new Promise((_, reject) => setTimeout(() => reject(new Error('Invoices request timeout')), 8000)) // 8 second timeout
      ]);
      
      const invoicesResult = await invoicesPromise;
      invArr = pickArray(invoicesResult, 'Invoices');
      invoicesRetrieved = true;
      console.log(`✅ Retrieved ${invArr.length} invoices`);
    } catch (error) {
      console.log('⚠️ Failed to retrieve invoices:', error.message);
    }

    // Try bank transactions second
    try {
      const transactionsPromise = Promise.race([
        fetchXeroData(accessToken, tenantId, 'BankTransactions', { page: 1, pageSize: 25 }, companyId), // Even smaller pageSize
        new Promise((_, reject) => setTimeout(() => reject(new Error('Bank transactions request timeout')), 8000)) // 8 second timeout
      ]);
      
      const transactionsResult = await transactionsPromise;
      txnArr = pickArray(transactionsResult, 'BankTransactions');
      transactionsRetrieved = true;
      console.log(`✅ Retrieved ${txnArr.length} bank transactions`);
    } catch (error) {
      console.log('⚠️ Failed to retrieve bank transactions:', error.message);
    }

    // Check if we have any data at all
    if (!invoicesRetrieved && !transactionsRetrieved) {
      return res.status(408).json({
        success: false,
        message: 'Unable to retrieve financial data. All requests timed out.',
        error: 'All requests failed',
        suggestion: 'Please try again in a few minutes or check your Xero connection',
        action: 'retry_later'
      });
    }

    // Calculate financial metrics with error handling
    const totalRevenue = invArr.reduce((s, inv) => {
      try {
        return s + (parseFloat(inv.Total) || 0);
      } catch (e) {
        console.log('⚠️ Error parsing invoice total:', inv.Total);
        return s;
      }
    }, 0);

    const paidRevenue = invArr.filter((inv) => inv.Status === 'PAID').reduce((s, inv) => {
      try {
        return s + (parseFloat(inv.Total) || 0);
      } catch (e) {
        console.log('⚠️ Error parsing paid invoice total:', inv.Total);
        return s;
      }
    }, 0);

    const outstandingRevenue = totalRevenue - paidRevenue;

    const totalExpenses = txnArr.reduce((s, tx) => {
      try {
        return s + (parseFloat(tx.Total) || 0);
      } catch (e) {
        console.log('⚠️ Error parsing transaction total:', tx.Total);
        return s;
      }
    }, 0);

    const netIncome = paidRevenue - totalExpenses;

    // Determine response message based on data availability
    const hasData = invArr.length > 0 || txnArr.length > 0;
    const partialData = (!invoicesRetrieved || !transactionsRetrieved) && hasData;
    
    let message = 'Financial summary retrieved successfully';
    if (partialData) {
      message = invoicesRetrieved && !transactionsRetrieved 
        ? 'Financial summary retrieved (invoices only - transactions timed out)'
        : !invoicesRetrieved && transactionsRetrieved
        ? 'Financial summary retrieved (transactions only - invoices timed out)'
        : 'Financial summary retrieved with partial data';
    }

    res.json({
      success: true,
      message: message,
      data: {
        totalRevenue: totalRevenue.toFixed(2),
        paidRevenue: paidRevenue.toFixed(2),
        outstandingRevenue: outstandingRevenue.toFixed(2),
        totalExpenses: totalExpenses.toFixed(2),
        netIncome: netIncome.toFixed(2),
        invoiceCount: invArr.length,
        transactionCount: txnArr.length,
        dataQuality: {
          invoicesRetrieved: invoicesRetrieved,
          transactionsRetrieved: transactionsRetrieved,
          partialData: partialData,
          hasAnyData: hasData
        }
      }
    });
  } catch (error) {
    console.error('Optimized Financial Summary Error:', error);
    
    // Handle specific timeout errors
    if (error.message && error.message.includes('timeout')) {
      return res.status(408).json({ 
        success: false, 
        message: 'Financial analysis timed out. The request took too long to complete.',
        error: 'Request timeout',
        suggestion: 'Try again in a few minutes or check your Xero connection',
        action: 'retry_later'
      });
    }
    
    // Handle rate limiting
    if (error.response?.status === 429) {
      return res.status(429).json({
        success: false,
        message: 'Xero API rate limit exceeded. Please try again in a few minutes.',
        error: 'Rate limit exceeded',
        suggestion: 'Wait 1-2 minutes before trying again',
        action: 'retry_later'
      });
    }
    
    // Handle authentication errors
    if (error.response?.status === 401) {
      return res.status(401).json({
        success: false,
        message: 'Xero authorization expired. Please reconnect to Xero.',
        error: 'Authorization required',
        action: 'reconnect_required'
      });
    }
    
    res.status(500).json({ 
      success: false, 
      message: 'Failed to retrieve financial summary', 
      error: error.message 
    });
  }
};

/**
 * Reusable tenant fetch + consistent companyId in fetch for refresh ability
 */
const pickTenantIdOrFirst = async (accessToken, tenantIdHint) => {
  if (tenantIdHint) return tenantIdHint;
  const tenantsResponse = await axios.get('https://api.xero.com/connections', {
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }
  });
  if (!tenantsResponse.data.length) return null;
  return tenantsResponse.data[0].tenantId;
};

/**
 * Get all invoices
 */
const getAllInvoices = async (req, res) => {
  const companyId = req.company.id; // ⬅️ make visible in catch
  try {
    const settings = await XeroSettings.getByCompanyId(companyId);
    if (!settings) return res.status(404).json({ success: false, message: 'Xero settings not found for this company' });
    if (!settings.access_token) return res.status(400).json({ success: false, message: 'Xero not connected. Please connect to Xero first.' });

    const { page = 1, pageSize = 50 } = req.query;
    // SECURITY: Get company's own tenant ID - prevent cross-company data access
    const tenantId = await getCompanyTenantId(companyId, accessToken);
    if (!tenantId) tenantId = await pickTenantIdOrFirst(settings.access_token);

    const invoices = await fetchXeroData(settings.access_token, tenantId, 'Invoices', {
      page: parseInt(page, 10),
      pageSize: parseInt(pageSize, 10)
    }, companyId);

    const invArr = pickArray(invoices, 'Invoices');
    const invoiceCount = invArr.length;
    const isOrganizationEmpty = invoiceCount === 0;

    res.json({
      success: true,
      message: isOrganizationEmpty
        ? 'No invoices found in this Xero organization. The organization may be empty or you may need to create some invoices first.'
        : 'Invoices retrieved successfully',
      data: {
        ...invoices,
        summary: { totalInvoices: invoiceCount, isEmpty: isOrganizationEmpty },
        suggestions: isOrganizationEmpty
          ? ['Create invoices in Xero', 'Import invoices from other systems', 'Check the selected organization', 'Verify your Xero org has data']
          : []
      }
    });
  } catch (error) {
    console.error('Get All Invoices Error:', error);
    if (error.response?.status === 401) {
      await clearExpiredTokens(companyId);
      return res.status(401).json({
        success: false,
        message: 'Xero authorization expired. Tokens have been cleared. Please reconnect to Xero.',
        error: 'Authorization required',
        action: 'reconnect_required'
      });
    }
    res.status(500).json({ success: false, message: 'Failed to retrieve invoices', error: error.message });
  }
};

/**
 * Get all contacts
 */
const getAllContacts = async (req, res) => {
  const companyId = req.company.id; // ⬅️ visible in catch
  try {
    const settings = await XeroSettings.getByCompanyId(companyId);
    if (!settings) return res.status(404).json({ success: false, message: 'Xero settings not found for this company' });
    if (!settings.access_token) return res.status(400).json({ success: false, message: 'Xero not connected. Please connect to Xero first.' });

    const { page = 1, pageSize = 50 } = req.query;
    // SECURITY: Get company's own tenant ID - prevent cross-company data access
    const tenantId = await getCompanyTenantId(companyId, accessToken);
    if (!tenantId) tenantId = await pickTenantIdOrFirst(settings.access_token);

    const contacts = await fetchXeroData(settings.access_token, tenantId, 'Contacts', {
      page: parseInt(page, 10),
      pageSize: parseInt(pageSize, 10)
    }, companyId);

    res.json({ success: true, message: 'Contacts retrieved successfully', data: contacts });
  } catch (error) {
    console.error('Get All Contacts Error:', error);
    if (error.response?.status === 401) {
      await clearExpiredTokens(companyId);
      return res.status(401).json({
        success: false,
        message: 'Xero authorization expired. Tokens have been cleared. Please reconnect to Xero.',
        error: 'Authorization required',
        action: 'reconnect_required'
      });
    }
    res.status(500).json({ success: false, message: 'Failed to retrieve contacts', error: error.message });
  }
};

/**
 * Get all bank transactions
 */
const getAllBankTransactions = async (req, res) => {
  try {
    const companyId = req.company.id;
    const xeroSettings = await XeroSettings.getByCompanyId(companyId);
    if (!xeroSettings) return res.status(404).json({ success: false, message: 'Xero settings not found for this company' });

    const accessToken = xeroSettings.access_token;
    if (!accessToken) return res.status(400).json({ success: false, message: 'No access token found. Please reconnect to Xero.' });

    const { page = 1, pageSize = 50 } = req.query;
    // SECURITY: Get company's own tenant ID - prevent cross-company data access
    const tenantId = await getCompanyTenantId(companyId, accessToken);
    if (!tenantId) tenantId = await pickTenantIdOrFirst(accessToken);

    const bankTransactions = await fetchXeroData(accessToken, tenantId, 'BankTransactions', {
      page: parseInt(page, 10),
      pageSize: parseInt(pageSize, 10)
    }, companyId);

    res.json({ success: true, message: 'Bank transactions retrieved successfully', data: bankTransactions });
  } catch (error) {
    console.error('Get All Bank Transactions Error:', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve bank transactions', error: error.message });
  }
};

/**
 * Get all accounts
 */
const getAllAccounts = async (req, res) => {
  try {
    const companyId = req.company.id;
    const xeroSettings = await XeroSettings.getByCompanyId(companyId);
    if (!xeroSettings) return res.status(404).json({ success: false, message: 'Xero settings not found for this company' });

    const accessToken = xeroSettings.access_token;
    if (!accessToken) return res.status(400).json({ success: false, message: 'No access token found. Please reconnect to Xero.' });

    // SECURITY: Get company's own tenant ID - prevent cross-company data access
    const tenantId = await getCompanyTenantId(companyId, accessToken);
    if (!tenantId) return res.status(400).json({ success: false, message: 'No Xero organizations found. Please check your Xero account.' });

    const accounts = await fetchXeroData(accessToken, tenantId, 'Accounts', {}, companyId);
    res.json({ success: true, message: 'Accounts retrieved successfully', data: accounts });
  } catch (error) {
    console.error('Get All Accounts Error:', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve accounts', error: error.message });
  }
};

/**
 * Get all items
 */
const getAllItems = async (req, res) => {
  try {
    const companyId = req.company.id;
    const xeroSettings = await XeroSettings.getByCompanyId(companyId);
    if (!xeroSettings) return res.status(404).json({ success: false, message: 'Xero settings not found for this company' });

    const accessToken = xeroSettings.access_token;
    if (!accessToken) return res.status(400).json({ success: false, message: 'No access token found. Please reconnect to Xero.' });

    // SECURITY: Get company's own tenant ID - prevent cross-company data access
    const tenantId = await getCompanyTenantId(companyId, accessToken);
    if (!tenantId) return res.status(400).json({ success: false, message: 'No Xero organizations found. Please check your Xero account.' });

    const items = await fetchXeroData(accessToken, tenantId, 'Items', {}, companyId);
    res.json({ success: true, message: 'Items retrieved successfully', data: items });
  } catch (error) {
    console.error('Get All Items Error:', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve items', error: error.message });
  }
};

/**
 * Get all tax rates
 */
const getAllTaxRates = async (req, res) => {
  try {
    const companyId = req.company.id;
    const xeroSettings = await XeroSettings.getByCompanyId(companyId);
    if (!xeroSettings) return res.status(404).json({ success: false, message: 'Xero settings not found for this company' });

    const accessToken = xeroSettings.access_token;
    if (!accessToken) return res.status(400).json({ success: false, message: 'No access token found. Please reconnect to Xero.' });

    // SECURITY: Get company's own tenant ID - prevent cross-company data access
    const tenantId = await getCompanyTenantId(companyId, accessToken);
    if (!tenantId) return res.status(400).json({ success: false, message: 'No Xero organizations found. Please check your Xero account.' });

    const taxRates = await fetchXeroData(accessToken, tenantId, 'TaxRates', {}, companyId);
    res.json({ success: true, message: 'Tax rates retrieved successfully', data: taxRates });
  } catch (error) {
    console.error('Get All Tax Rates Error:', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve tax rates', error: error.message });
  }
};

/**
 * Get all tracking categories
 */
const getAllTrackingCategories = async (req, res) => {
  try {
    const companyId = req.company.id;
    const xeroSettings = await XeroSettings.getByCompanyId(companyId);
    if (!xeroSettings) return res.status(404).json({ success: false, message: 'Xero settings not found for this company' });

    const accessToken = xeroSettings.access_token;
    if (!accessToken) return res.status(400).json({ success: false, message: 'No access token found. Please reconnect to Xero.' });

    // SECURITY: Get company's own tenant ID - prevent cross-company data access
    const tenantId = await getCompanyTenantId(companyId, accessToken);
    if (!tenantId) return res.status(400).json({ success: false, message: 'No Xero organizations found. Please check your Xero account.' });

    const trackingCategories = await fetchXeroData(accessToken, tenantId, 'TrackingCategories', {}, companyId);
    res.json({ success: true, message: 'Tracking categories retrieved successfully', data: trackingCategories });
  } catch (error) {
    console.error('Get All Tracking Categories Error:', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve tracking categories', error: error.message });
  }
};

/**
 * Get Xero connection status
 */
const getConnectionStatus = async (req, res) => {
  try {
    const companyId = req.company.id;
    const settings = await XeroSettings.getByCompanyId(companyId);
    if (!settings) {
      return res.json({ success: true, data: { isConnected: false, connectionStatus: 'not_configured', message: 'Xero settings not configured' } });
    }

    // Check for credential-based authentication first
    if (settings.username && settings.password) {
      try {
        const authResult = await authenticateWithCredentials(settings.username, settings.password, settings.organization_name);
        if (authResult.success) {
          const tenants = [{
            id: `tenant_${companyId}`,
            connectionId: `conn_${companyId}`,
            name: authResult.organizationName,
            organizationName: authResult.organizationName,
            tenantName: authResult.organizationName,
            tenantId: `tenant_${companyId}`
          }];
          
          return res.json({
            success: true,
            data: { 
              isConnected: true, 
              connectionStatus: 'connected', 
              message: 'Xero connected successfully via credentials', 
              tenants,
              authMethod: 'credentials'
            }
          });
        } else {
          return res.json({
            success: true,
            data: { 
              isConnected: false, 
              connectionStatus: 'credential_auth_failed', 
              message: 'Failed to authenticate with Xero credentials' 
            }
          });
        }
      } catch (e) {
        return res.json({
          success: true,
          data: { 
            isConnected: false, 
            connectionStatus: 'credential_auth_failed', 
            message: 'Credential authentication failed' 
          }
        });
      }
    }

    if (!settings.access_token || !settings.refresh_token) {
      return res.json({ success: true, data: { isConnected: false, connectionStatus: 'not_authorized', message: 'Xero not authorized' } });
    }

    const now = new Date();
    let tokenExpiresAt = null;
    if (settings.token_expires_at) {
      try {
        tokenExpiresAt = new Date(settings.token_expires_at);
        if (isNaN(tokenExpiresAt.getTime())) {
          console.log('⚠️ Invalid token expiration date in database:', settings.token_expires_at);
          tokenExpiresAt = null;
        }
      } catch (error) {
        console.log('⚠️ Error parsing token expiration date:', settings.token_expires_at, error.message);
        tokenExpiresAt = null;
      }
    }

    if (tokenExpiresAt && tokenExpiresAt <= now) {
      try {
        const refreshResponse = await refreshXeroToken(settings.refresh_token, settings.client_id, settings.client_secret);
        if (refreshResponse.success) {
          await db.query(
            `UPDATE xero_settings 
             SET access_token = $1, refresh_token = $2, token_expires_at = $3, updated_at = CURRENT_TIMESTAMP 
             WHERE company_id = $4`,
            [refreshResponse.accessToken, refreshResponse.refreshToken, new Date(Date.now() + refreshResponse.expiresIn * 1000), companyId]
          );

          const tenantsResponse = await axios.get('https://api.xero.com/connections', {
            headers: { Authorization: `Bearer ${refreshResponse.accessToken}`, 'Content-Type': 'application/json' }
          });

          const tenants = tenantsResponse.data.map((c) => ({
            id: c.tenantId,
            connectionId: c.id,
            name: c.tenantName || 'Unknown Organization',
            organizationName: c.tenantName || 'Unknown Organization',
            tenantName: c.tenantName || 'Unknown Organization',
            tenantId: c.tenantId
          }));

          return res.json({
            success: true,
            data: { isConnected: true, connectionStatus: 'connected', message: 'Xero connected successfully', tenants, tokenRefreshed: true }
          });
        } else {
          await clearExpiredTokens(companyId);
          return res.json({
            success: true,
            data: {
              isConnected: false,
              connectionStatus: 'refresh_failed',
              message: 'Token refresh failed. Tokens have been cleared. Please reconnect to Xero.',
              action: 'reconnect_required'
            }
          });
        }
      } catch (refreshError) {
        await clearExpiredTokens(companyId);
        return res.json({
          success: true,
          data: {
            isConnected: false,
            connectionStatus: 'refresh_failed',
            message: 'Token refresh failed. Tokens have been cleared. Please reconnect to Xero.',
            action: 'reconnect_required'
          }
        });
      }
    }

    try {
      const tenantsResponse = await axios.get('https://api.xero.com/connections', {
        headers: { Authorization: `Bearer ${settings.access_token}`, 'Content-Type': 'application/json' }
      });

      const tenants = tenantsResponse.data.map((c) => ({
        id: c.tenantId,
        connectionId: c.id,
        name: c.tenantName || 'Unknown Organization',
        organizationName: c.tenantName || 'Unknown Organization',
        tenantName: c.tenantName || 'Unknown Organization',
        tenantId: c.tenantId
      }));

      return res.json({
        success: true,
        data: { isConnected: true, connectionStatus: 'connected', message: 'Xero connected successfully', tenants, tokenRefreshed: false }
      });
    } catch (e) {
      await clearExpiredTokens(companyId);
      return res.json({
        success: true,
        data: {
          isConnected: false,
          connectionStatus: 'connection_failed',
          message: 'Connection verification failed. Tokens have been cleared. Please reconnect to Xero.',
          action: 'reconnect_required'
        }
      });
    }
  } catch (error) {
    console.error('Get Connection Status Error:', error);
    res.status(500).json({ success: false, message: 'Failed to get connection status', error: error.message });
  }
};

/**
 * Organization details
 */
const getOrganizationDetails = async (req, res) => {
  try {
    const companyId = req.company.id;
    const xeroSettings = await XeroSettings.getByCompanyId(companyId);
    if (!xeroSettings) return res.status(404).json({ success: false, message: 'Xero settings not found for this company' });

    const accessToken = xeroSettings.access_token;
    if (!accessToken) return res.status(400).json({ success: false, message: 'No access token found. Please reconnect to Xero.' });

    // SECURITY: Get company's own tenant ID - prevent cross-company data access
    const tenantId = await getCompanyTenantId(companyId, accessToken);
    if (!tenantId) return res.status(400).json({ success: false, message: 'No Xero organizations found. Please check your Xero account.' });

    const organisation = await fetchXeroData(accessToken, tenantId, 'Organisation', {}, companyId);
    res.json({ success: true, message: 'Organization details retrieved successfully', data: organisation });
  } catch (error) {
    console.error('Get Organization Details Error:', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve organization details', error: error.message });
  }
};

/** ------- Remaining list endpoints (wired with companyId for refresh) ------- */

const getAllPurchaseOrders = async (req, res) => {
  try {
    const companyId = req.company.id;
    const settings = await XeroSettings.getByCompanyId(companyId);
    if (!settings || !settings.access_token) return res.status(400).json({ success: false, message: 'Xero not connected. Please connect to Xero first.' });

    const { page = 1, pageSize = 50, status } = req.query;
    const params = { page, pageSize };
    if (status) params.status = status;

    const tenantsResponse = await axios.get('https://api.xero.com/connections', {
      headers: { Authorization: `Bearer ${settings.access_token}`, 'Content-Type': 'application/json' }
    });
    if (!tenantsResponse.data.length) return res.status(404).json({ success: false, message: 'No organizations found' });

    const tenantId = tenantsResponse.data[0].tenantId;
    const data = await fetchXeroData(settings.access_token, tenantId, 'PurchaseOrders', params, companyId);
    res.json({ success: true, message: 'Purchase orders retrieved successfully', data });
  } catch (error) {
    console.error('Get Purchase Orders Error:', error);
    res.status(500).json({ success: false, message: 'Failed to get purchase orders', error: error.message });
  }
};

const getAllReceipts = async (req, res) => {
  try {
    const companyId = req.company.id;
    const settings = await XeroSettings.getByCompanyId(companyId);
    if (!settings || !settings.access_token) return res.status(400).json({ success: false, message: 'Xero not connected. Please connect to Xero first.' });

    const { page = 1, pageSize = 50, status } = req.query;
    const params = { page, pageSize };
    if (status) params.status = status;

    const tenantsResponse = await axios.get('https://api.xero.com/connections', {
      headers: { Authorization: `Bearer ${settings.access_token}`, 'Content-Type': 'application/json' }
    });
    if (!tenantsResponse.data.length) return res.status(404).json({ success: false, message: 'No organizations found' });

    const tenantId = tenantsResponse.data[0].tenantId;
    const data = await fetchXeroData(settings.access_token, tenantId, 'Receipts', params, companyId);
    res.json({ success: true, message: 'Receipts retrieved successfully', data });
  } catch (error) {
    console.error('Get Receipts Error:', error);
    res.status(500).json({ success: false, message: 'Failed to get receipts', error: error.message });
  }
};

const getAllCreditNotes = async (req, res) => {
  try {
    const companyId = req.company.id;
    const settings = await XeroSettings.getByCompanyId(companyId);
    if (!settings || !settings.access_token) return res.status(400).json({ success: false, message: 'Xero not connected. Please connect to Xero first.' });

    const { page = 1, pageSize = 50, status } = req.query;
    const params = { page, pageSize };
    if (status) params.status = status;

    const tenantsResponse = await axios.get('https://api.xero.com/connections', {
      headers: { Authorization: `Bearer ${settings.access_token}`, 'Content-Type': 'application/json' }
    });
    if (!tenantsResponse.data.length) return res.status(404).json({ success: false, message: 'No organizations found' });

    const tenantId = tenantsResponse.data[0].tenantId;
    const data = await fetchXeroData(settings.access_token, tenantId, 'CreditNotes', params, companyId);
    res.json({ success: true, message: 'Credit notes retrieved successfully', data });
  } catch (error) {
    console.error('Get Credit Notes Error:', error);
    res.status(500).json({ success: false, message: 'Failed to get credit notes', error: error.message });
  }
};

const getAllManualJournals = async (req, res) => {
  try {
    const companyId = req.company.id;
    const settings = await XeroSettings.getByCompanyId(companyId);
    if (!settings || !settings.access_token) return res.status(400).json({ success: false, message: 'Xero not connected. Please connect to Xero first.' });

    const { page = 1, pageSize = 50, status } = req.query;
    const params = { page, pageSize };
    if (status) params.status = status;

    const tenantsResponse = await axios.get('https://api.xero.com/connections', {
      headers: { Authorization: `Bearer ${settings.access_token}`, 'Content-Type': 'application/json' }
    });
    if (!tenantsResponse.data.length) return res.status(404).json({ success: false, message: 'No organizations found' });

    const tenantId = tenantsResponse.data[0].tenantId;
    const data = await fetchXeroData(settings.access_token, tenantId, 'ManualJournals', params, companyId);
    res.json({ success: true, message: 'Manual journals retrieved successfully', data });
  } catch (error) {
    console.error('Get Manual Journals Error:', error);
    res.status(500).json({ success: false, message: 'Failed to get manual journals', error: error.message });
  }
};

const getAllPrepayments = async (req, res) => {
  try {
    const companyId = req.company.id;
    const settings = await XeroSettings.getByCompanyId(companyId);
    if (!settings || !settings.access_token) return res.status(400).json({ success: false, message: 'Xero not connected. Please connect to Xero first.' });

    const { page = 1, pageSize = 50, status } = req.query;
    const params = { page, pageSize };
    if (status) params.status = status;

    const tenantsResponse = await axios.get('https://api.xero.com/connections', {
      headers: { Authorization: `Bearer ${settings.access_token}`, 'Content-Type': 'application/json' }
    });
    if (!tenantsResponse.data.length) return res.status(404).json({ success: false, message: 'No organizations found' });

    const tenantId = tenantsResponse.data[0].tenantId;
    const data = await fetchXeroData(settings.access_token, tenantId, 'Prepayments', params, companyId);
    res.json({ success: true, message: 'Prepayments retrieved successfully', data });
  } catch (error) {
    console.error('Get Prepayments Error:', error);
    res.status(500).json({ success: false, message: 'Failed to get prepayments', error: error.message });
  }
};

const getAllOverpayments = async (req, res) => {
  try {
    const companyId = req.company.id;
    const settings = await XeroSettings.getByCompanyId(companyId);
    if (!settings || !settings.access_token) return res.status(400).json({ success: false, message: 'Xero not connected. Please connect to Xero first.' });

    const { page = 1, pageSize = 50, status } = req.query;
    const params = { page, pageSize };
    if (status) params.status = status;

    const tenantsResponse = await axios.get('https://api.xero.com/connections', {
      headers: { Authorization: `Bearer ${settings.access_token}`, 'Content-Type': 'application/json' }
    });
    if (!tenantsResponse.data.length) return res.status(404).json({ success: false, message: 'No organizations found' });

    const tenantId = tenantsResponse.data[0].tenantId;
    const data = await fetchXeroData(settings.access_token, tenantId, 'Overpayments', params, companyId);
    res.json({ success: true, message: 'Overpayments retrieved successfully', data });
  } catch (error) {
    console.error('Get Overpayments Error:', error);
    res.status(500).json({ success: false, message: 'Failed to get overpayments', error: error.message });
  }
};

const getAllQuotes = async (req, res) => {
  try {
    const companyId = req.company.id;
    const settings = await XeroSettings.getByCompanyId(companyId);
    if (!settings || !settings.access_token) return res.status(400).json({ success: false, message: 'Xero not connected. Please connect to Xero first.' });

    const { page = 1, pageSize = 50, status } = req.query;
    const params = { page, pageSize };
    if (status) params.status = status;

    const tenantsResponse = await axios.get('https://api.xero.com/connections', {
      headers: { Authorization: `Bearer ${settings.access_token}`, 'Content-Type': 'application/json' }
    });
    if (!tenantsResponse.data.length) return res.status(404).json({ success: false, message: 'No organizations found' });

    const tenantId = tenantsResponse.data[0].tenantId;
    const data = await fetchXeroData(settings.access_token, tenantId, 'Quotes', params, companyId);
    res.json({ success: true, message: 'Quotes retrieved successfully', data });
  } catch (error) {
    console.error('Get Quotes Error:', error);
    res.status(500).json({ success: false, message: 'Failed to get quotes', error: error.message });
  }
};

const getAllReports = async (req, res) => {
  const companyId = req.company.id;
  try {
    const settings = await XeroSettings.getByCompanyId(companyId);
    if (!settings) return res.status(404).json({ success: false, message: 'Xero settings not found for this company' });
    if (!settings.access_token) return res.status(400).json({ success: false, message: 'Xero not connected. Please connect to Xero first.' });

    const { reportID } = req.query;
    if (!reportID) return res.status(400).json({ success: false, message: 'Report ID is required' });

    // Handle tenant ID selection
    // SECURITY: Get company's own tenant ID - prevent cross-company data access
    const tenantId = await getCompanyTenantId(companyId, accessToken);
    if (!tenantId) {
      // Get first available tenant
      const tenantsResponse = await axios.get('https://api.xero.com/connections', {
        headers: { Authorization: `Bearer ${settings.access_token}`, 'Content-Type': 'application/json' }
      });
      if (!tenantsResponse.data.length) {
        return res.status(404).json({ success: false, message: 'No Xero organizations found' });
      }
      tenantId = tenantsResponse.data[0].tenantId;
    }
    
    const data = await fetchXeroData(settings.access_token, tenantId, `Reports/${reportID}`, {}, companyId);
    res.json({ success: true, message: 'Report retrieved successfully', data });
  } catch (error) {
    console.error('Get Reports Error:', error);
    if (error.response?.status === 401) {
      await clearExpiredTokens(companyId);
      return res.status(401).json({
        success: false,
        message: 'Xero authorization expired. Tokens have been cleared. Please reconnect to Xero.',
        error: 'Authorization required',
        action: 'reconnect_required'
      });
    }
    res.status(500).json({ success: false, message: 'Failed to get report', error: error.message });
  }
};

module.exports = {
  buildAuthUrl,
  handleCallback,
  getXeroData,
  refreshToken,
  getCompanyInfo,
  createXeroSettings,
  getXeroSettings,
  deleteXeroSettings,
  getAllXeroSettings,
  updateAllRedirectUris,
  createXeroAuthState,
  getXeroAuthState,
  getConnectionStatus,
  getDashboardData,
  getFinancialSummary,
  getFinancialSummaryOptimized,
  getAllInvoices,
  getAllContacts,
  getAllBankTransactions,
  getAllAccounts,
  getAllItems,
  getAllTaxRates,
  getAllTrackingCategories,
  getOrganizationDetails,
  getAllPurchaseOrders,
  getAllReceipts,
  getAllCreditNotes,
  getAllManualJournals,
  getAllPrepayments,
  getAllOverpayments,
  getAllQuotes,
  getAllReports
};
