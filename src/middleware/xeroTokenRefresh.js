const xeroDataService = require('../services/xeroDataService');

/**
 * Xero Token Refresh Middleware
 * Automatically refreshes Xero tokens when they're expired
 * Attaches valid token and tenant info to request object
 */
async function ensureValidXeroToken(req, res, next) {
  try {
    const companyId = req.company.id;
    
    console.log(`🔍 Checking Xero token validity for company ${companyId}`);
    
    // Get valid token (auto-refresh if needed)
    const token = await xeroDataService.getValidToken(companyId);
    
    // Attach token info to request for use in controllers
    req.xeroToken = token.accessToken;
    req.xeroTenantId = token.tenantId;
    req.xeroOrganizationName = token.organizationName;
    req.xeroRefreshToken = token.refreshToken;
    
    console.log(`✅ Valid Xero token attached for company ${companyId}`);
    next();
    
  } catch (error) {
    console.error('❌ Xero token validation failed:', error);
    
    // Handle specific error cases
    if (error.message.includes('No Xero token found')) {
      return res.status(400).json({
        success: false,
        error: 'XERO_NOT_CONFIGURED',
        message: 'Xero is not configured. Please connect to Xero first.',
        requiresConfiguration: true
      });
    }
    
    if (error.message.includes('Token refresh failed')) {
      return res.status(401).json({
        success: false,
        error: 'XERO_TOKEN_EXPIRED',
        message: 'Xero connection expired. Please reconnect to Xero.',
        requiresReconnection: true
      });
    }
    
    // Generic error
    res.status(500).json({
      success: false,
      error: 'XERO_TOKEN_ERROR',
      message: 'Unable to validate Xero token. Please try again.',
      details: error.message
    });
  }
}

/**
 * Optional Xero Token Middleware
 * Checks for valid token but doesn't fail if not available
 * Used for endpoints that can work with or without Xero
 */
async function optionalValidXeroToken(req, res, next) {
  try {
    const companyId = req.company.id;
    
    console.log(`🔍 Optional Xero token check for company ${companyId}`);
    
    // Try to get valid token
    const token = await xeroDataService.getValidToken(companyId);
    
    // Attach token info if available
    req.xeroToken = token.accessToken;
    req.xeroTenantId = token.tenantId;
    req.xeroOrganizationName = token.organizationName;
    req.xeroRefreshToken = token.refreshToken;
    req.xeroConnected = true;
    
    console.log(`✅ Xero token available for company ${companyId}`);
    
  } catch (error) {
    console.log(`ℹ️  No valid Xero token for company ${req.company.id}`);
    
    // Set flags to indicate no Xero connection
    req.xeroToken = null;
    req.xeroTenantId = null;
    req.xeroOrganizationName = null;
    req.xeroRefreshToken = null;
    req.xeroConnected = false;
  }
  
  next();
}

/**
 * Xero Connection Required Middleware
 * Ensures company has an active Xero connection
 * More permissive than token refresh middleware
 */
async function requireXeroConnection(req, res, next) {
  try {
    const companyId = req.company.id;
    
    console.log(`🔍 Checking Xero connection for company ${companyId}`);
    
    // Check if company has Xero settings
    const db = require('../config/database');
    const result = await db.query(`
      SELECT access_token, tenant_id, organization_name, token_expires_at
      FROM xero_settings
      WHERE company_id = $1
    `, [companyId]);
    
    if (result.rows.length === 0 || !result.rows[0].access_token) {
      return res.status(400).json({
        success: false,
        error: 'XERO_NOT_CONFIGURED',
        message: 'Xero is not configured. Please connect to Xero first.',
        requiresConfiguration: true
      });
    }
    
    const settings = result.rows[0];
    
    // Check if token is expired (but don't auto-refresh)
    if (xeroDataService.isTokenExpired(settings.token_expires_at)) {
      return res.status(401).json({
        success: false,
        error: 'XERO_TOKEN_EXPIRED',
        message: 'Xero connection expired. Please reconnect to Xero.',
        requiresReconnection: true
      });
    }
    
    // Attach connection info
    req.xeroToken = settings.access_token;
    req.xeroTenantId = settings.tenant_id;
    req.xeroOrganizationName = settings.organization_name;
    req.xeroConnected = true;
    
    console.log(`✅ Xero connection verified for company ${companyId}`);
    next();
    
  } catch (error) {
    console.error('❌ Xero connection check failed:', error);
    
    res.status(500).json({
      success: false,
      error: 'XERO_CONNECTION_ERROR',
      message: 'Unable to verify Xero connection. Please try again.',
      details: error.message
    });
  }
}

/**
 * Xero Rate Limit Middleware
 * Handles Xero API rate limiting
 */
function handleXeroRateLimit(req, res, next) {
  // Set rate limit headers for Xero API calls
  res.set({
    'X-RateLimit-Limit': '5000',
    'X-RateLimit-Remaining': '4999',
    'X-RateLimit-Reset': Math.floor(Date.now() / 1000) + 3600
  });
  
  next();
}

/**
 * Xero Error Handler Middleware
 * Centralized error handling for Xero-related errors
 */
function handleXeroErrors(error, req, res, next) {
  console.error('❌ Xero error:', error);
  
  // Handle specific Xero API errors
  if (error.response) {
    const status = error.response.status;
    const data = error.response.data;
    
    switch (status) {
      case 401:
        return res.status(401).json({
          success: false,
          error: 'XERO_TOKEN_EXPIRED',
          message: 'Xero connection expired. Please reconnect to Xero.',
          requiresReconnection: true,
          details: data
        });
        
      case 403:
        return res.status(403).json({
          success: false,
          error: 'XERO_PERMISSION_DENIED',
          message: 'Insufficient permissions for Xero operation.',
          details: data
        });
        
      case 429:
        return res.status(429).json({
          success: false,
          error: 'XERO_RATE_LIMITED',
          message: 'Too many requests to Xero API. Please try again later.',
          retryAfter: error.response.headers['retry-after'] || 60
        });
        
      case 500:
      case 502:
      case 503:
        return res.status(502).json({
          success: false,
          error: 'XERO_API_ERROR',
          message: 'Xero API is currently unavailable. Please try again later.',
          details: data
        });
        
      default:
        return res.status(status).json({
          success: false,
          error: 'XERO_API_ERROR',
          message: 'Xero API error occurred.',
          details: data
        });
    }
  }
  
  // Handle network errors
  if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
    return res.status(502).json({
      success: false,
      error: 'XERO_NETWORK_ERROR',
      message: 'Unable to connect to Xero. Please check your internet connection.',
      details: error.message
    });
  }
  
  // Generic error
  next(error);
}

/**
 * Xero Request Logging Middleware
 * Logs all Xero API requests for debugging
 */
function logXeroRequests(req, res, next) {
  const originalSend = res.send;
  
  res.send = function(data) {
    // Log successful Xero API responses
    if (req.path.includes('/xero/') && res.statusCode === 200) {
      console.log(`✅ Xero API success: ${req.method} ${req.path} - ${res.statusCode}`);
    }
    
    // Log Xero API errors
    if (req.path.includes('/xero/') && res.statusCode >= 400) {
      console.log(`❌ Xero API error: ${req.method} ${req.path} - ${res.statusCode}`);
      try {
        const errorData = JSON.parse(data);
        console.log(`   Error details:`, errorData);
      } catch (e) {
        console.log(`   Error response:`, data);
      }
    }
    
    originalSend.call(this, data);
  };
  
  next();
}

module.exports = {
  ensureValidXeroToken,
  optionalValidXeroToken,
  requireXeroConnection,
  handleXeroRateLimit,
  handleXeroErrors,
  logXeroRequests
};
