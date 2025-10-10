const axios = require('axios');
const crypto = require('crypto');
const db = require('../config/database');

/**
 * Xero OAuth2 Controller - Proper Implementation
 * 
 * Implements the standard Xero OAuth2 flow:
 * 1. Single app with CLIENT_ID and CLIENT_SECRET
 * 2. Backend redirects to Xero authorize URL
 * 3. Token exchange and refresh handling
 * 4. Tenant management and persistence
 */

// Xero OAuth2 Configuration
const XERO_CONFIG = {
  CLIENT_ID: process.env.XERO_CLIENT_ID,
  CLIENT_SECRET: process.env.XERO_CLIENT_SECRET,
  REDIRECT_URI: process.env.XERO_REDIRECT_URI || 'https://compliance-manager-frontend.onrender.com/redirecturl',
  SCOPES: [
    'offline_access',
    'openid',
    'profile', 
    'email',
    'accounting.transactions',
    'accounting.settings',
    'accounting.reports.read',
    'accounting.contacts'
  ].join(' '),
  AUTHORIZE_URL: 'https://login.xero.com/identity/connect/authorize',
  TOKEN_URL: 'https://identity.xero.com/connect/token',
  CONNECTIONS_URL: 'https://api.xero.com/connections'
};

/**
 * Get authorization URL for frontend to handle redirect
 */
const getAuthUrl = async (req, res) => {
  try {
    const companyId = req.company.id;
    
    console.log('🔗 Getting Xero auth URL for company:', companyId);

    // Validate configuration
    if (!XERO_CONFIG.CLIENT_ID || !XERO_CONFIG.CLIENT_SECRET) {
      return res.status(500).json({
        success: false,
        message: 'Xero OAuth2 not configured. Please set XERO_CLIENT_ID and XERO_CLIENT_SECRET environment variables.',
        errorCode: 'OAUTH_NOT_CONFIGURED'
      });
    }

    // Generate secure state parameter
    const state = crypto.randomBytes(32).toString('hex');
    
    // Store state in database with company association
    await db.query(
      'INSERT INTO xero_oauth_states (state, company_id, created_at) VALUES ($1, $2, NOW())',
      [state, companyId]
    );

    // Build authorization URL
    const authUrl = new URL(XERO_CONFIG.AUTHORIZE_URL);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('client_id', XERO_CONFIG.CLIENT_ID);
    authUrl.searchParams.set('redirect_uri', XERO_CONFIG.REDIRECT_URI);
    authUrl.searchParams.set('scope', XERO_CONFIG.SCOPES);
    authUrl.searchParams.set('state', state);

    console.log('✅ Generated auth URL for company:', companyId);

    return res.json({
      success: true,
      data: {
        authUrl: authUrl.toString(),
        state: state,
        redirectUri: XERO_CONFIG.REDIRECT_URI
      }
    });

  } catch (error) {
    console.error('❌ Error getting auth URL:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to generate authorization URL',
      error: error.message
    });
  }
};

/**
 * Initialize OAuth2 flow - redirect user to Xero
 */
const connectXero = async (req, res) => {
  try {
    const companyId = req.company.id;
    
    console.log('🚀 Starting Xero OAuth2 flow for company:', companyId);

    // Get company-specific Xero settings from database
    const result = await db.query(
      'SELECT client_id, client_secret, redirect_uri FROM xero_settings WHERE company_id = $1',
      [companyId]
    );

    let clientId, clientSecret, redirectUri;

    if (result.rows.length > 0) {
      // Use company-specific settings
      const settings = result.rows[0];
      clientId = settings.client_id;
      clientSecret = settings.client_secret;
      
      // Override redirect URI based on environment
      const isDevelopment = process.env.NODE_ENV !== 'production';
      if (isDevelopment) {
        // For development, use production redirect URI since Xero app only has production URL registered
        redirectUri = 'https://compliance-manager-frontend.onrender.com/redirecturl';
        console.log('🔧 Development mode: Using production redirect URI (Xero app limitation)');
      } else {
        redirectUri = settings.redirect_uri || XERO_CONFIG.REDIRECT_URI;
        console.log('🔧 Production mode: Using configured redirect URI');
      }
      
      console.log('✅ Using company-specific Xero credentials');
    } else {
      // Fallback to global environment variables
      clientId = XERO_CONFIG.CLIENT_ID;
      clientSecret = XERO_CONFIG.CLIENT_SECRET;
      
      // Override redirect URI based on environment
      const isDevelopment = process.env.NODE_ENV !== 'production';
      if (isDevelopment) {
        // For development, use production redirect URI since Xero app only has production URL registered
        redirectUri = 'https://compliance-manager-frontend.onrender.com/redirecturl';
        console.log('🔧 Development mode: Using production redirect URI (Xero app limitation - fallback)');
      } else {
        redirectUri = XERO_CONFIG.REDIRECT_URI;
        console.log('🔧 Production mode: Using global redirect URI (fallback)');
      }
      
      console.log('⚠️  Using global environment variables (fallback)');
    }

    // Validate configuration
    if (!clientId || !clientSecret) {
      return res.status(500).json({
        success: false,
        message: 'Xero OAuth2 not configured. Please ask your administrator to configure Xero client credentials for your company.',
        errorCode: 'OAUTH_NOT_CONFIGURED'
      });
    }

    // Generate state for CSRF protection
    const state = crypto.randomBytes(32).toString('hex');
    
    // Store state in database with company ID
    await db.query(
      'INSERT INTO xero_oauth_states (state, company_id, created_at) VALUES ($1, $2, NOW()) ON CONFLICT (state) DO UPDATE SET company_id = $2, created_at = NOW()',
      [state, companyId]
    );

    // Build authorization URL
    const authParams = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: XERO_CONFIG.SCOPES,
      state: state
    });

    const authorizeUrl = `${XERO_CONFIG.AUTHORIZE_URL}?${authParams.toString()}`;
    
    console.log('🔗 Generated authorization URL');
    console.log('📍 Redirect URI:', redirectUri);
    console.log('🔐 State:', state);

    // Return authorization URL to frontend (don't redirect directly)
    res.json({
      success: true,
      authUrl: authorizeUrl,
      message: 'Authorization URL generated successfully'
    });
    
  } catch (error) {
    console.error('❌ Connect Xero Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to initialize Xero connection',
      error: error.message
    });
  }
};

/**
 * Handle OAuth2 callback from Xero
 */
const handleCallback = async (req, res) => {
  try {
    // Handle both GET (query params) and POST (body) requests
    const { code, state, error: oauthError } = req.method === 'GET' ? req.query : req.body;
    
    console.log('📞 Xero OAuth2 callback received');
    console.log('🔧 Request method:', req.method);
    console.log('🔧 Request URL:', req.url);
    console.log('🔧 Request headers:', req.headers);
    console.log('🔧 Request body:', req.body);
    console.log('🔧 Request query:', req.query);
    console.log('🔐 State:', state);
    console.log('📋 Code:', code ? 'Present' : 'Missing');
    
    // Handle OAuth errors
    if (oauthError) {
      console.error('❌ OAuth error from Xero:', oauthError);
      // Set CORS headers before redirect
      res.header('Access-Control-Allow-Origin', 'https://compliance-manager-frontend.onrender.com');
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.header('Access-Control-Allow-Credentials', 'true');
      return res.redirect(`${process.env.FRONTEND_URL || 'https://compliance-manager-frontend.onrender.com'}/integrations/xero?error=oauth_denied`);
    }

    if (!code || !state) {
      console.error('❌ Missing code or state in callback');
      // Set CORS headers before redirect
      res.header('Access-Control-Allow-Origin', 'https://compliance-manager-frontend.onrender.com');
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.header('Access-Control-Allow-Credentials', 'true');
      return res.redirect(`${process.env.FRONTEND_URL || 'https://compliance-manager-frontend.onrender.com'}/integrations/xero?error=missing_parameters`);
    }

    // Validate state and get company ID
    const stateResult = await db.query(
      'SELECT company_id FROM xero_oauth_states WHERE state = $1 AND created_at > NOW() - INTERVAL \'10 minutes\'',
      [state]
    );

    if (stateResult.rows.length === 0) {
      console.error('❌ Invalid or expired state');
      // Set CORS headers before redirect
      res.header('Access-Control-Allow-Origin', 'https://compliance-manager-frontend.onrender.com');
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.header('Access-Control-Allow-Credentials', 'true');
      return res.redirect(`${process.env.FRONTEND_URL || 'https://compliance-manager-frontend.onrender.com'}/integrations/xero?error=invalid_state`);
    }

    const companyId = stateResult.rows[0].company_id;
    console.log('✅ State validated for company:', companyId);

    // Get company-specific Xero settings
    const settingsResult = await db.query(
      'SELECT client_id, client_secret, redirect_uri FROM xero_settings WHERE company_id = $1',
      [companyId]
    );

    let clientId, clientSecret, redirectUri;

    if (settingsResult.rows.length > 0) {
      // Use company-specific settings
      const settings = settingsResult.rows[0];
      clientId = settings.client_id;
      clientSecret = settings.client_secret;
      
      // Override redirect URI based on environment
      const isDevelopment = process.env.NODE_ENV !== 'production';
      if (isDevelopment) {
        // For development, use production redirect URI since Xero app only has production URL registered
        redirectUri = 'https://compliance-manager-frontend.onrender.com/redirecturl';
        console.log('🔧 Development mode: Using production redirect URI for token exchange (Xero app limitation)');
      } else {
        redirectUri = settings.redirect_uri || XERO_CONFIG.REDIRECT_URI;
        console.log('🔧 Production mode: Using configured redirect URI for token exchange');
      }
      
      console.log('✅ Using company-specific credentials for token exchange');
    } else {
      // Fallback to global environment variables
      clientId = XERO_CONFIG.CLIENT_ID;
      clientSecret = XERO_CONFIG.CLIENT_SECRET;
      
      // Override redirect URI based on environment
      const isDevelopment = process.env.NODE_ENV !== 'production';
      if (isDevelopment) {
        // For development, use production redirect URI since Xero app only has production URL registered
        redirectUri = 'https://compliance-manager-frontend.onrender.com/redirecturl';
        console.log('🔧 Development mode: Using production redirect URI for token exchange (Xero app limitation - fallback)');
      } else {
        redirectUri = XERO_CONFIG.REDIRECT_URI;
        console.log('🔧 Production mode: Using global redirect URI for token exchange (fallback)');
      }
      console.log('⚠️  Using global credentials for token exchange (fallback)');
    }

    if (!clientId || !clientSecret) {
      console.error('❌ Missing client credentials for token exchange');
      // Set CORS headers before redirect
      res.header('Access-Control-Allow-Origin', 'https://compliance-manager-frontend.onrender.com');
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.header('Access-Control-Allow-Credentials', 'true');
      return res.redirect(`${process.env.FRONTEND_URL || 'https://compliance-manager-frontend.onrender.com'}/integrations/xero?error=missing_credentials`);
    }

    // Exchange authorization code for tokens
    const tokenParams = new URLSearchParams({
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: redirectUri
    });

    const tokenResponse = await axios.post(XERO_CONFIG.TOKEN_URL, tokenParams, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`
      }
    });

    const tokens = tokenResponse.data;
    console.log('✅ Tokens received from Xero');
    console.log('🔐 Access token length:', tokens.access_token?.length || 0);
    console.log('🔄 Refresh token length:', tokens.refresh_token?.length || 0);
    console.log('⏰ Expires in:', tokens.expires_in, 'seconds');

    // Get tenant connections
    const connectionsResponse = await axios.get(XERO_CONFIG.CONNECTIONS_URL, {
      headers: {
        'Authorization': `Bearer ${tokens.access_token}`,
        'Content-Type': 'application/json'
      }
    });

    const tenants = connectionsResponse.data;
    console.log(`✅ Retrieved ${tenants.length} tenant(s)`);
    console.log('🏢 Tenant names:', tenants.map(t => t.tenantName || t.organisationName));

    // Calculate token expiry
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);
    console.log('📅 Token expires at:', expiresAt.toISOString());

    // Fetch organization details for each tenant
    console.log('🏢 Fetching organization details...');
    const organizationDetails = [];
    
    for (const tenant of tenants) {
      try {
        const orgResponse = await axios.get(`https://api.xero.com/api.xro/2.0/Organisation`, {
          headers: {
            'Authorization': `Bearer ${tokens.access_token}`,
            'Xero-tenant-id': tenant.tenantId,
            'Accept': 'application/json'
          }
        });
        
        const orgData = orgResponse.data.Organisations?.[0];
        if (orgData) {
          organizationDetails.push({
            ...tenant,
            organizationName: orgData.Name,
            organizationCountry: orgData.CountryCode,
            organizationTaxNumber: orgData.TaxNumber,
            organizationLegalName: orgData.LegalName,
            organizationShortCode: orgData.ShortCode
          });
          console.log(`✅ Fetched organization: ${orgData.Name} (${tenant.tenantId})`);
        } else {
          organizationDetails.push(tenant);
          console.log(`⚠️  No organization data for tenant: ${tenant.tenantId}`);
        }
      } catch (error) {
        console.error(`❌ Error fetching organization for tenant ${tenant.tenantId}:`, error.message);
        organizationDetails.push(tenant);
      }
    }

    // Prepare authorized tenants data in new format
    const authorizedTenants = organizationDetails.map(tenant => ({
      id: tenant.tenantId,
      tenantId: tenant.tenantId,
      name: tenant.organizationName || tenant.tenantName || tenant.organisationName || 'Unknown Organization',
      tenantName: tenant.tenantName || tenant.organisationName || 'Unknown Organization',
      organizationName: tenant.organizationName || tenant.tenantName || tenant.organisationName || 'Unknown Organization',
      connectionId: tenant.id || null,
      organizationCountry: tenant.organizationCountry,
      organizationTaxNumber: tenant.organizationTaxNumber,
      organizationLegalName: tenant.organizationLegalName,
      organizationShortCode: tenant.organizationShortCode
    }));

    // Store tokens and tenant info with organization details
    console.log('💾 Saving tokens and organization data to database for company:', companyId);
    await db.query(`
      INSERT INTO xero_settings (
        company_id, 
        client_id, 
        client_secret, 
        redirect_uri,
        access_token, 
        refresh_token, 
        token_expires_at,
        xero_user_id,
        tenant_data,
        authorized_tenants,
        tenant_id,
        organization_name,
        created_at, 
        updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), NOW())
      ON CONFLICT (company_id) 
      DO UPDATE SET 
        access_token = $5,
        refresh_token = $6,
        token_expires_at = $7,
        xero_user_id = $8,
        tenant_data = $9,
        authorized_tenants = $10,
        tenant_id = $11,
        organization_name = $12,
        updated_at = NOW()
    `, [
      companyId,
      clientId,
      clientSecret,
      redirectUri,
      tokens.access_token,
      tokens.refresh_token,
      expiresAt,
      tokens.xero_userid || null,
      JSON.stringify(organizationDetails),
      JSON.stringify(authorizedTenants),
      organizationDetails[0]?.tenantId || null,
      organizationDetails[0]?.organizationName || null,
      organizationDetails
    ]);

    // Clean up state
    await db.query('DELETE FROM xero_oauth_states WHERE state = $1', [state]);

    console.log('✅ Xero OAuth2 flow completed successfully');
    console.log('💾 Tokens saved to database');
    console.log('🧹 OAuth state cleaned up');

    // Trigger initial data sync in background
    if (organizationDetails.length > 0) {
      console.log('🔄 Triggering initial data sync in background...');
      const xeroSyncService = require('../services/xeroSyncService');
      
      // Run sync in background without blocking the response
      xeroSyncService.syncInitialData(companyId, tokens.access_token, organizationDetails[0].tenantId)
        .then(result => {
          console.log(`✅ Initial sync completed for company ${companyId}:`, result);
        })
        .catch(error => {
          console.error(`❌ Initial sync failed for company ${companyId}:`, error);
        });
    }

    // Handle response based on request method
    if (req.method === 'GET') {
      // GET request - redirect to frontend (OAuth redirect flow)
      const baseUrl = `${process.env.FRONTEND_URL || 'https://compliance-manager-frontend.onrender.com'}/integrations/xero`;
      const params = new URLSearchParams({
        success: 'connected',
        autoload: 'true',
        tenant_count: tenants.length.toString()
      });
      
      if (tenants.length > 1) {
        params.append('multiple_tenants', 'true');
      }
      
      const redirectUrl = `${baseUrl}?${params.toString()}`;
      
      // Set CORS headers before redirect
      res.header('Access-Control-Allow-Origin', 'https://compliance-manager-frontend.onrender.com');
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.header('Access-Control-Allow-Credentials', 'true');
      
      console.log('🔄 Redirecting to frontend with auto-load trigger:', redirectUrl);
      res.redirect(redirectUrl);
    } else {
      // POST request - return JSON (API call from frontend)
      console.log('📤 Returning JSON response for POST callback');
      res.json({
        success: true,
        data: {
          tokens: {
            accessToken: tokens.access_token,
            refreshToken: tokens.refresh_token,
            expiresIn: tokens.expires_in,
            tokenType: tokens.token_type || 'Bearer'
          },
          tenants: organizationDetails.map(t => ({
            id: t.tenantId,
            name: t.organizationName || t.tenantName || t.organisationName,
            organizationName: t.organizationName || t.organisationName,
            tenantName: t.tenantName,
            tenantId: t.tenantId,
            country: t.organizationCountry,
            taxNumber: t.organizationTaxNumber,
            legalName: t.organizationLegalName,
            shortCode: t.organizationShortCode
          })),
          companyId: companyId.toString()
        }
      });
    }

  } catch (error) {
    console.error('❌ OAuth2 Callback Error:', error);
    
    let errorMessage = 'oauth_failed';
    if (error.response?.data?.error === 'invalid_grant') {
      errorMessage = 'invalid_grant';
    } else if (error.response?.data?.error === 'invalid_client') {
      errorMessage = 'invalid_client';
    }
    
    if (req.method === 'GET') {
      // Set CORS headers before redirect
      res.header('Access-Control-Allow-Origin', 'https://compliance-manager-frontend.onrender.com');
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.header('Access-Control-Allow-Credentials', 'true');
      
      res.redirect(`${process.env.FRONTEND_URL || 'https://compliance-manager-frontend.onrender.com'}/integrations/xero?error=${errorMessage}`);
    } else {
      res.status(400).json({
        success: false,
        message: errorMessage,
        error: error.message
      });
    }
  }
};

/**
 * Get current connection status and tenants
 */
const getConnectionStatus = async (req, res) => {
  try {
    const companyId = req.company.id;
    
    const result = await db.query(
      'SELECT * FROM xero_settings WHERE company_id = $1',
      [companyId]
    );

    if (result.rows.length === 0) {
      return res.json({
        success: true,
        data: {
          connected: false,
          message: 'Not connected to Xero'
        }
      });
    }

    const settings = result.rows[0];
    const now = new Date();
    const hasTokens = !!(settings.access_token && settings.refresh_token);
    const hasExpiry = !!settings.token_expires_at;
    const tokenExpiry = hasExpiry ? new Date(settings.token_expires_at) : null;
    
    // More lenient token validation - allow 5 minute buffer
    const bufferTime = 5 * 60 * 1000; // 5 minutes in milliseconds
    const isTokenValid = hasTokens && (!hasExpiry || (tokenExpiry && tokenExpiry > new Date(now.getTime() + bufferTime)));
    const hasCredentials = !!(settings.client_id && settings.client_secret);

    // Parse tenant data - try new authorized_tenants column first, then fallback to tenant_data
    let tenants = [];
    try {
      // Try new authorized_tenants column first
      if (settings.authorized_tenants) {
        tenants = typeof settings.authorized_tenants === 'string' 
          ? JSON.parse(settings.authorized_tenants) 
          : settings.authorized_tenants;
        console.log('✅ Retrieved tenant data from authorized_tenants:', tenants.length, 'tenants');
      } else if (settings.tenant_data) {
        // Fallback to old tenant_data column
        tenants = JSON.parse(settings.tenant_data);
        console.log('✅ Retrieved tenant data from tenant_data (fallback):', tenants.length, 'tenants');
      } else {
        console.warn('⚠️ No tenant data found in database (neither authorized_tenants nor tenant_data)');
      }
    } catch (e) {
      console.error('❌ Failed to parse tenant data:', e);
      tenants = [];
    }

    // If no tenants found and we have a valid token, try to fetch from Xero API
    if ((!tenants || tenants.length === 0) && isTokenValid && settings.access_token) {
      console.log('🔄 No tenants in database, fetching from Xero API in connection status...');
      try {
        const tenantsResponse = await axios.get('https://api.xero.com/connections', {
          headers: { 
            Authorization: `Bearer ${settings.access_token}`, 
            'Content-Type': 'application/json' 
          }
        });

        if (tenantsResponse.data && tenantsResponse.data.length > 0) {
          tenants = tenantsResponse.data.map(conn => ({
            id: conn.tenantId,
            tenantId: conn.tenantId,
            name: conn.tenantName || 'Unknown Organization',
            tenantName: conn.tenantName || 'Unknown Organization',
            organizationName: conn.tenantName || 'Unknown Organization',
            connectionId: conn.id
          }));

          // Save to database for future requests
          await db.query(
            'UPDATE xero_settings SET authorized_tenants = $1 WHERE company_id = $2',
            [JSON.stringify(tenants), companyId]
          );
          
          console.log(`✅ Fetched and saved ${tenants.length} tenants from Xero API in connection status`);
        }
      } catch (apiError) {
        console.error('❌ Failed to fetch tenants from Xero API in connection status:', apiError.message);
        // Don't fail the entire request if tenant fetch fails
      }
    }

    // Add cache-busting headers
    res.set({
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    });

    console.log('📊 Connection status response:', {
      connected: isTokenValid,
      hasTokens,
      isTokenValid,
      tenantsCount: tenants.length,
      hasCredentials,
      tenantNames: tenants.map(t => t.tenantName || t.organisationName),
      tokenExpiry: settings.token_expires_at,
      currentTime: new Date().toISOString()
    });

    res.json({
      success: true,
      data: {
        connected: isTokenValid, // Only connected if token is valid
        isTokenValid: isTokenValid,
        expiresAt: settings.token_expires_at,
        tenants: tenants.map(t => ({
          tenantId: t.tenantId,
          tenantName: t.tenantName,
          organisationName: t.organisationName,
          organizationName: t.organizationName || t.organisationName,
          organizationCountry: t.organizationCountry,
          organizationTaxNumber: t.organizationTaxNumber,
          organizationLegalName: t.organizationLegalName,
          organizationShortCode: t.organizationShortCode
        })),
        primaryOrganization: settings.organization_name ? {
          id: settings.tenant_id,
          name: settings.organization_name
        } : null,
        xeroUserId: settings.xero_user_id,
        hasExpiredTokens: hasTokens && !isTokenValid, // Has tokens but they're expired
        hasCredentials: hasCredentials,
        needsOAuth: hasCredentials && !hasTokens, // Has credentials but no tokens yet
        timestamp: new Date().toISOString(), // Add timestamp for debugging
        // Add debug info
        debug: {
          hasTokens,
          hasExpiry,
          tokenExpiry: settings.token_expires_at,
          currentTime: new Date().toISOString(),
          isTokenValid
        }
      }
    });

  } catch (error) {
    console.error('❌ Get Connection Status Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get connection status',
      error: error.message
    });
  }
};

/**
 * Refresh access token
 */
const refreshToken = async (companyId) => {
  try {
    const result = await db.query(
      'SELECT refresh_token, client_id, client_secret FROM xero_settings WHERE company_id = $1',
      [companyId]
    );

    if (result.rows.length === 0) {
      throw new Error('No Xero settings found for company');
    }

    const settings = result.rows[0];
    
    // Check if refresh token exists and is valid
    if (!settings.refresh_token) {
      throw new Error('No refresh token available. User needs to re-authorize.');
    }
    
    const refreshParams = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: settings.refresh_token
    });

    const refreshResponse = await axios.post(XERO_CONFIG.TOKEN_URL, refreshParams, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${Buffer.from(`${settings.client_id}:${settings.client_secret}`).toString('base64')}`
      }
    });

    const newTokens = refreshResponse.data;
    const newExpiresAt = new Date(Date.now() + newTokens.expires_in * 1000);

    // Update tokens in database
    await db.query(
      `UPDATE xero_settings 
       SET access_token = $1, refresh_token = $2, token_expires_at = $3, updated_at = NOW() 
       WHERE company_id = $4`,
      [newTokens.access_token, newTokens.refresh_token, newExpiresAt, companyId]
    );

    console.log('✅ Tokens refreshed successfully for company:', companyId);
    return {
      success: true,
      accessToken: newTokens.access_token,
      refreshToken: newTokens.refresh_token,
      expiresAt: newExpiresAt
    };

  } catch (error) {
    console.error('❌ Token refresh failed:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

/**
 * Get Xero data with automatic token refresh
 */
const getXeroData = async (req, res) => {
  try {
    const companyId = req.company.id;
    const { dataType } = req.params;
    const { tenantId } = req.query;

    // Get current tokens
    const result = await db.query(
      'SELECT * FROM xero_settings WHERE company_id = $1',
      [companyId]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Not connected to Xero. Please connect first.',
        errorCode: 'NOT_CONNECTED'
      });
    }

    const settings = result.rows[0];
    let accessToken = settings.access_token;
    
    // Check if we have valid tokens
    if (!accessToken || !settings.refresh_token || !settings.token_expires_at) {
      return res.status(401).json({
        success: false,
        message: 'No valid tokens found. Please authorize with Xero first.',
        errorCode: 'NO_TOKENS',
        action: 'reauthorize_required'
      });
    }

    // Development mode: If using simulated tokens, serve demo data directly
    if (process.env.NODE_ENV !== 'production' && accessToken.includes('eyJhbGciOiJSUzI1NiIs')) {
      try {
        const demoController = require('./demoXeroController');
        console.log(`🎭 Detected simulated token for ${req.params.dataType}, serving demo data...`);
        
        const mockReq = { ...req, params: { dataType: req.params.dataType } };
        const mockRes = {
          json: (data) => {
            console.log(`✅ Serving demo ${req.params.dataType} data (simulated token mode)`);
            return res.json({
              ...data,
              meta: {
                ...data.meta,
                isDemoData: true,
                simulatedTokenMode: true,
                note: 'Demo data served - complete real OAuth for live Xero data'
              }
            });
          },
          status: (code) => ({ json: (data) => res.status(code).json(data) })
        };
        
        return demoController.getDemoData(mockReq, mockRes);
      } catch (demoError) {
        console.error('Demo data fallback failed:', demoError);
      }
    }
    
    // Check if token needs refresh
    const now = new Date();
    const tokenExpiry = new Date(settings.token_expires_at);
    
    if (tokenExpiry <= now) {
      console.log('🔄 Token expired, refreshing...');
      try {
        const refreshResult = await refreshToken(companyId);
        
        if (!refreshResult.success) {
          return res.status(401).json({
            success: false,
            message: 'Token refresh failed. Please reconnect to Xero.',
            errorCode: 'REFRESH_FAILED',
            action: 'reauthorize_required'
          });
        }
        
        accessToken = refreshResult.accessToken;
      } catch (error) {
        console.error('❌ Token refresh error:', error.message);
        return res.status(401).json({
          success: false,
          message: 'Token refresh failed. Please authorize with Xero again.',
          errorCode: 'REFRESH_FAILED',
          action: 'reauthorize_required'
        });
      }
    }

    // Determine tenant ID
    let selectedTenantId = tenantId;
    if (!selectedTenantId) {
      // Use first available tenant
      const tenants = JSON.parse(settings.tenant_data || '[]');
      if (tenants.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'No Xero organizations found',
          errorCode: 'NO_TENANTS'
        });
      }
      selectedTenantId = tenants[0].tenantId;
    }

    // Fetch data from Xero API
    const dataEndpoints = {
      invoices: 'Invoices',
      contacts: 'Contacts',
      accounts: 'Accounts',
      organization: 'Organisation',
      'bank-transactions': 'BankTransactions',
      items: 'Items',
      'tax-rates': 'TaxRates',
      'tracking-categories': 'TrackingCategories',
      'purchase-orders': 'PurchaseOrders',
      receipts: 'Receipts',
      'credit-notes': 'CreditNotes',
      'manual-journals': 'ManualJournals',
      prepayments: 'Prepayments',
      overpayments: 'Overpayments',
      quotes: 'Quotes',
      reports: 'Reports'
    };

    const endpoint = dataEndpoints[dataType];
    if (!endpoint) {
      return res.status(400).json({
        success: false,
        message: `Invalid data type: ${dataType}`,
        validTypes: Object.keys(dataEndpoints)
      });
    }

    // Build query parameters for Xero API
    const queryParams = new URLSearchParams();
    
    // Add common query parameters if provided
    if (req.query.where) queryParams.append('where', req.query.where);
    if (req.query.order) queryParams.append('order', req.query.order);
    if (req.query.page) queryParams.append('page', req.query.page);
    if (req.query.includeArchived) queryParams.append('includeArchived', req.query.includeArchived);
    if (req.query.IDs) queryParams.append('IDs', req.query.IDs);
    if (req.query.ContactIDs) queryParams.append('ContactIDs', req.query.ContactIDs);
    
    const queryString = queryParams.toString();
    const apiUrl = `https://api.xero.com/api.xero/2.0/${endpoint}${queryString ? `?${queryString}` : ''}`;
    
    console.log(`🔍 Fetching ${dataType} from:`, apiUrl);

    const xeroResponse = await axios.get(apiUrl, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'xero-tenant-id': selectedTenantId,
        'Accept': 'application/json',
        'User-Agent': 'Compliance-Management-System/1.0'
      },
      timeout: 30000 // 30 second timeout
    });

    console.log(`✅ Retrieved ${dataType} data for tenant:`, selectedTenantId);

    // Extract the actual data from Xero's response structure
    let actualData = xeroResponse.data;
    let dataCount = 0;
    
    // Xero API typically returns data in a wrapper object
    if (actualData && actualData[endpoint]) {
      actualData = actualData[endpoint];
      dataCount = Array.isArray(actualData) ? actualData.length : 1;
    } else if (Array.isArray(actualData)) {
      dataCount = actualData.length;
    } else if (actualData) {
      dataCount = 1;
    }

    console.log(`✅ Retrieved ${dataCount} ${dataType} record(s) for tenant:`, selectedTenantId);

    res.json({
      success: true,
      message: `${dataType} data retrieved successfully`,
      data: actualData,
      meta: {
        tenantId: selectedTenantId,
        dataType: dataType,
        count: dataCount,
        endpoint: endpoint,
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error(`❌ Get ${req.params.dataType} Error:`, error);
    
    if (error.response?.status === 401) {
      // Try token refresh once
      console.log('🔄 401 error, attempting token refresh...');
      try {
        const refreshResult = await refreshToken(req.company.id);
        if (refreshResult.success) {
          console.log('✅ Token refreshed, retrying request...');
          // Retry the request with new token (only once to avoid infinite loops)
          const retryResponse = await axios.get(`https://api.xero.com/api.xero/2.0/${endpoint}`, {
            headers: {
              'Authorization': `Bearer ${refreshResult.accessToken}`,
              'xero-tenant-id': selectedTenantId,
              'Accept': 'application/json'
            }
          });
          
          console.log(`✅ Retrieved ${dataType} data for tenant after refresh:`, selectedTenantId);
          return res.json({
            success: true,
            message: `${dataType} data retrieved successfully`,
            data: retryResponse.data,
            meta: {
              tenantId: selectedTenantId,
              dataType: dataType,
              count: Array.isArray(retryResponse.data[endpoint]) ? retryResponse.data[endpoint].length : 1,
              refreshed: true
            }
          });
        }
      } catch (refreshError) {
        console.error('❌ Token refresh failed:', refreshError.message);
      }
      
      return res.status(401).json({
        success: false,
        message: 'Xero authorization expired. Please reconnect.',
        errorCode: 'AUTH_EXPIRED',
        action: 'reauthorize_required'
      });
    }

    // Handle different types of errors
    let errorMessage = `Failed to retrieve ${req.params.dataType}`;
    let errorCode = 'FETCH_FAILED';
    let statusCode = 500;

    if (error.response) {
      // Xero API returned an error
      statusCode = error.response.status;
      const xeroError = error.response.data;
      
      switch (error.response.status) {
        case 400:
          errorMessage = 'Invalid request to Xero API';
          errorCode = 'INVALID_REQUEST';
          break;
        case 403:
          errorMessage = 'Access forbidden - check Xero app permissions';
          errorCode = 'FORBIDDEN';
          break;
        case 404:
          errorMessage = `${dataType} data not found`;
          errorCode = 'NOT_FOUND';
          break;
        case 429:
          errorMessage = 'Xero API rate limit exceeded';
          errorCode = 'RATE_LIMITED';
          break;
        case 500:
          errorMessage = 'Xero API server error';
          errorCode = 'XERO_SERVER_ERROR';
          break;
        default:
          errorMessage = xeroError?.message || error.message || errorMessage;
      }
      
      console.error(`❌ Xero API Error (${error.response.status}):`, xeroError);
    } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
      errorMessage = 'Cannot connect to Xero API';
      errorCode = 'CONNECTION_FAILED';
      statusCode = 503;
    }

    // For development/demo purposes - if we have simulated tokens but get auth errors,
    // try to serve demo data instead of failing
    if (error.response?.status === 401 && process.env.NODE_ENV !== 'production') {
      try {
        const demoController = require('./demoXeroController');
        console.log(`🎭 Auth failed for ${req.params.dataType}, serving demo data...`);
        
        // Create a mock request object for demo controller
        const mockReq = { ...req, params: { dataType: req.params.dataType } };
        const mockRes = {
          json: (data) => {
            console.log(`✅ Serving demo ${req.params.dataType} data`);
            return res.json({
              ...data,
              meta: {
                ...data.meta,
                isDemoData: true,
                note: 'Demo data served due to auth failure - complete real OAuth for live data'
              }
            });
          },
          status: (code) => ({ json: (data) => res.status(code).json(data) })
        };
        
        return demoController.getDemoData(mockReq, mockRes);
      } catch (demoError) {
        console.error('Demo data fallback failed:', demoError);
      }
    }

    res.status(statusCode).json({
      success: false,
      message: errorMessage,
      errorCode: errorCode,
      error: error.message,
      meta: {
        dataType: req.params.dataType,
        tenantId: selectedTenantId,
        timestamp: new Date().toISOString()
      }
    });
  }
};

/**
 * Get available tenants for company
 */
const getTenants = async (req, res) => {
  try {
    const companyId = req.company.id;
    
    // Get xero settings with authorized_tenants
    const result = await db.query(
      'SELECT authorized_tenants, access_token, tenant_data FROM xero_settings WHERE company_id = $1',
      [companyId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Not connected to Xero. Please connect first.'
      });
    }

    const settings = result.rows[0];
    
    // Try new authorized_tenants column first
    let tenants = [];
    try {
      if (settings.authorized_tenants) {
        tenants = typeof settings.authorized_tenants === 'string' 
          ? JSON.parse(settings.authorized_tenants) 
          : settings.authorized_tenants;
      }
    } catch (parseError) {
      console.log('⚠️ Error parsing authorized_tenants:', parseError.message);
    }

    // If no tenants in new column, try old tenant_data column for backward compatibility
    if (!tenants || tenants.length === 0) {
      try {
        if (settings.tenant_data) {
          const oldTenants = JSON.parse(settings.tenant_data);
          if (oldTenants && oldTenants.length > 0) {
            // Migrate to new format and save
            tenants = oldTenants.map(t => ({
              id: t.tenantId,
              tenantId: t.tenantId,
              name: t.tenantName || t.organisationName || 'Unknown Organization',
              tenantName: t.tenantName || t.organisationName || 'Unknown Organization',
              organizationName: t.tenantName || t.organisationName || 'Unknown Organization'
            }));
            
            // Save to new column
            await db.query(
              'UPDATE xero_settings SET authorized_tenants = $1 WHERE company_id = $2',
              [JSON.stringify(tenants), companyId]
            );
            console.log(`📦 Migrated ${tenants.length} tenants from tenant_data to authorized_tenants`);
          }
        }
      } catch (oldParseError) {
        console.log('⚠️ Error parsing tenant_data:', oldParseError.message);
      }
    }

    // If still no tenants and we have a token, fetch from Xero API
    if ((!tenants || tenants.length === 0) && settings.access_token) {
      console.log('🔄 No tenants in database, fetching from Xero API...');
      try {
        const tenantsResponse = await axios.get('https://api.xero.com/connections', {
          headers: { 
            Authorization: `Bearer ${settings.access_token}`, 
            'Content-Type': 'application/json' 
          }
        });

        if (tenantsResponse.data && tenantsResponse.data.length > 0) {
          tenants = tenantsResponse.data.map(conn => ({
            id: conn.tenantId,
            tenantId: conn.tenantId,
            name: conn.tenantName || 'Unknown Organization',
            tenantName: conn.tenantName || 'Unknown Organization',
            organizationName: conn.tenantName || 'Unknown Organization',
            connectionId: conn.id
          }));

          // Save to database
          await db.query(
            'UPDATE xero_settings SET authorized_tenants = $1 WHERE company_id = $2',
            [JSON.stringify(tenants), companyId]
          );
          
          console.log(`✅ Fetched and saved ${tenants.length} tenants from Xero API`);
        }
      } catch (apiError) {
        console.error('❌ Failed to fetch tenants from Xero API:', apiError.message);
        
        // If API call fails, return empty but don't error out
        return res.json({
          success: true,
          data: [],
          message: 'No organizations found. Please reconnect to Xero.',
          needsReconnection: true
        });
      }
    }

    // Return tenants in standardized format
    res.json({
      success: true,
      data: tenants.map(t => ({
        id: t.id || t.tenantId,
        tenantId: t.tenantId || t.id,
        name: t.name || t.tenantName || t.organizationName || 'Unknown Organization',
        tenantName: t.tenantName || t.name || 'Unknown Organization',
        organisationName: t.organizationName || t.name || 'Unknown Organization',
        organizationName: t.organizationName || t.name || 'Unknown Organization'
      })),
      message: `Retrieved ${tenants.length} Xero organization(s)`
    });

  } catch (error) {
    console.error('❌ Get Tenants Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get Xero organizations',
      error: error.message
    });
  }
};

/**
 * Disconnect from Xero
 */
const disconnect = async (req, res) => {
  try {
    const companyId = req.company.id;
    
    // Only clear OAuth tokens and user data, preserve client credentials
    await db.query(`
      UPDATE xero_settings 
      SET 
        access_token = NULL,
        refresh_token = NULL,
        token_expires_at = NULL,
        xero_user_id = NULL,
        tenant_data = NULL,
        authorized_tenants = NULL,
        updated_at = NOW()
      WHERE company_id = $1
    `, [companyId]);
    
    console.log('🔌 Disconnected from Xero for company:', companyId, '(preserved client credentials)');
    
    res.json({
      success: true,
      message: 'Disconnected from Xero successfully. Client credentials preserved.'
    });

  } catch (error) {
    console.error('❌ Disconnect Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to disconnect from Xero',
      error: error.message
    });
  }
};

// Additional controller methods for new routes

const getOrganizations = async (req, res) => {
  try {
    const companyId = req.company.id;
    const xeroDataService = require('../services/xeroDataService');
    const token = await xeroDataService.getValidToken(companyId);
    
    const organizations = await xeroDataService.fetchOrganizations(token.accessToken, token.tenantId);
    
    res.json({
      success: true,
      data: organizations,
      message: 'Organizations retrieved successfully'
    });
  } catch (error) {
    console.error('❌ Error getting organizations:', error);
    res.status(500).json({
      success: false,
      error: 'ORGANIZATIONS_FETCH_FAILED',
      message: error.message
    });
  }
};

const syncData = async (req, res) => {
  try {
    const companyId = req.company.id;
    const { dataType } = req.body;
    
    const xeroSyncService = require('../services/xeroSyncService');
    const result = await xeroSyncService.syncDataType(companyId, dataType, req.body);
    
    res.json({
      success: true,
      message: `${dataType} data synced successfully`,
      syncResult: result
    });
  } catch (error) {
    console.error('❌ Error syncing data:', error);
    res.status(500).json({
      success: false,
      error: 'DATA_SYNC_FAILED',
      message: error.message
    });
  }
};

const syncAllData = async (req, res) => {
  try {
    const companyId = req.company.id;
    
    const xeroSyncService = require('../services/xeroSyncService');
    const result = await xeroSyncService.syncAllData(companyId);
    
    res.json({
      success: true,
      message: 'All data synced successfully',
      syncResult: result
    });
  } catch (error) {
    console.error('❌ Error syncing all data:', error);
    res.status(500).json({
      success: false,
      error: 'FULL_SYNC_FAILED',
      message: error.message
    });
  }
};

const getInvoices = async (req, res) => {
  try {
    const companyId = req.company.id;
    const xeroDataService = require('../services/xeroDataService');
    const token = await xeroDataService.getValidToken(companyId);
    
    const invoices = await xeroDataService.fetchInvoices(token.accessToken, token.tenantId, req.query);
    
    res.json({
      success: true,
      data: invoices,
      message: 'Invoices retrieved successfully'
    });
  } catch (error) {
    console.error('❌ Error getting invoices:', error);
    res.status(500).json({
      success: false,
      error: 'INVOICES_FETCH_FAILED',
      message: error.message
    });
  }
};

const getContacts = async (req, res) => {
  try {
    const companyId = req.company.id;
    const xeroDataService = require('../services/xeroDataService');
    const token = await xeroDataService.getValidToken(companyId);
    
    const contacts = await xeroDataService.fetchContacts(token.accessToken, token.tenantId, req.query);
    
    res.json({
      success: true,
      data: contacts,
      message: 'Contacts retrieved successfully'
    });
  } catch (error) {
    console.error('❌ Error getting contacts:', error);
    res.status(500).json({
      success: false,
      error: 'CONTACTS_FETCH_FAILED',
      message: error.message
    });
  }
};

const getAccounts = async (req, res) => {
  try {
    const companyId = req.company.id;
    const xeroDataService = require('../services/xeroDataService');
    const token = await xeroDataService.getValidToken(companyId);
    
    const accounts = await xeroDataService.fetchAccounts(token.accessToken, token.tenantId);
    
    res.json({
      success: true,
      data: accounts,
      message: 'Accounts retrieved successfully'
    });
  } catch (error) {
    console.error('❌ Error getting accounts:', error);
    res.status(500).json({
      success: false,
      error: 'ACCOUNTS_FETCH_FAILED',
      message: error.message
    });
  }
};

const getBills = async (req, res) => {
  try {
    const companyId = req.company.id;
    const xeroDataService = require('../services/xeroDataService');
    const token = await xeroDataService.getValidToken(companyId);
    
    const bills = await xeroDataService.fetchBills(token.accessToken, token.tenantId, req.query);
    
    res.json({
      success: true,
      data: bills,
      message: 'Bills retrieved successfully'
    });
  } catch (error) {
    console.error('❌ Error getting bills:', error);
    res.status(500).json({
      success: false,
      error: 'BILLS_FETCH_FAILED',
      message: error.message
    });
  }
};

const getBankTransactions = async (req, res) => {
  try {
    const companyId = req.company.id;
    const xeroDataService = require('../services/xeroDataService');
    const token = await xeroDataService.getValidToken(companyId);
    
    const transactions = await xeroDataService.fetchBankTransactions(token.accessToken, token.tenantId, req.query);
    
    res.json({
      success: true,
      data: transactions,
      message: 'Bank transactions retrieved successfully'
    });
  } catch (error) {
    console.error('❌ Error getting bank transactions:', error);
    res.status(500).json({
      success: false,
      error: 'BANK_TRANSACTIONS_FETCH_FAILED',
      message: error.message
    });
  }
};

module.exports = {
  getAuthUrl,
  connectXero,
  handleCallback,
  getConnectionStatus,
  getXeroData,
  getTenants,
  disconnect,
  refreshToken,
  getOrganizations,
  syncData,
  syncAllData,
  getInvoices,
  getContacts,
  getAccounts,
  getBills,
  getBankTransactions
};
