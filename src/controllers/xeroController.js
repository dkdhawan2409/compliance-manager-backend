const axios = require('axios');
const crypto = require('crypto');
const CompanyCompliance = require('../models/CompanyCompliance');
const XeroSettings = require('../models/XeroSettings');
const db = require('../config/database');

/**
 * Check if company is enrolled (has compliance details)
 * NOTE: This check has been disabled - Xero integration now works independently
 */
const isCompanyEnrolled = async (companyId) => {
  // Disabled compliance requirement - Xero integration works independently
  return true;
};

/**
 * Build OAuth2 authorization URL
 */
const buildAuthUrl = async (req, res, next) => {
  try {
    console.log('🔍 Building Xero Auth URL for company:', req.company.id);
    
    // Check if user is super admin
    if (req.company.role === 'admin') {
      console.log('❌ Super admin cannot setup Xero accounts');
      return res.status(403).json({
        success: false,
        message: 'Super admins cannot setup Xero accounts. Only regular companies can setup Xero integration.'
      });
    }

    // Company enrollment check disabled - Xero integration works independently
    const companyId = req.company.id;

    // Get company's Xero settings
    console.log('🔍 Getting Xero settings for company:', companyId);
    const xeroSettings = await XeroSettings.getByCompanyId(companyId);
    if (!xeroSettings) {
      console.log('❌ Xero settings not configured for company:', companyId);
      return res.status(400).json({
        success: false,
        message: 'Xero settings not configured for this company. Please configure Xero settings first.'
      });
    }

    console.log('🔍 Xero settings found, generating state...');
    const state = crypto.randomBytes(16).toString('hex');
    
    // Store the state in the database
    console.log('🔍 Storing state in database:', state);
    await db.query(
      'INSERT INTO xero_oauth_states (state, company_id) VALUES ($1, $2)',
      [state, companyId]
    );
    console.log('✅ State stored successfully');
    
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: xeroSettings.client_id,
      redirect_uri: xeroSettings.redirect_uri,
      scope: 'openid profile email accounting.transactions accounting.contacts accounting.settings offline_access',
      state: state
    });

    const authUrl = `https://login.xero.com/identity/connect/authorize?${params.toString()}`;
    console.log('✅ Authorization URL generated successfully');
    
    res.json({
      success: true,
      message: 'Authorization URL generated successfully',
      data: {
        authUrl,
        state
      }
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
    const state = crypto.randomBytes(16).toString('hex');
    await db.query(
      'INSERT INTO xero_oauth_states (state, company_id) VALUES ($1, $2)',
      [state, companyId]
    );
    res.json({ success: true, state });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to create state', error: error.message });
  }
};

/**
 * Handle OAuth2 callback and exchange code for tokens
 */
const handleCallback = async (req, res, next) => {
  try {
    console.log('🔍 Xero Callback Debug - Request body:', req.body);
    const { code, state } = req.body;
    if (!code || !state) {
      console.log('❌ Missing code or state:', { code: !!code, state: !!state });
      return res.status(400).json({ success: false, message: 'Code and state are required' });
    }

    console.log('🔍 Looking up company by state:', state);
    // 1. Lookup company by state
    const result = await db.query('SELECT company_id FROM xero_oauth_states WHERE state = $1', [state]);
    console.log('🔍 State lookup result:', result.rows);
    if (result.rows.length === 0) {
      console.log('❌ Invalid or expired state');
      return res.status(400).json({ success: false, message: 'Invalid or expired state' });
    }
    const companyId = result.rows[0].company_id;
    console.log('🔍 Found company ID:', companyId);

    // 2. Delete the state (one-time use)
    await db.query('DELETE FROM xero_oauth_states WHERE state = $1', [state]);
    console.log('🔍 Deleted state from database');

    // 3. Get Xero settings for this company
    console.log('🔍 Getting Xero settings for company:', companyId);
    const xeroSettings = await XeroSettings.getByCompanyId(companyId);
    console.log('🔍 Xero settings found:', !!xeroSettings);
    if (!xeroSettings) {
      console.log('❌ Xero settings not configured for company:', companyId);
      return res.status(400).json({ success: false, message: 'Xero settings not configured for this company.' });
    }

    // 4. Exchange code for tokens
    console.log('🔍 Exchanging code for tokens...');
    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: xeroSettings.redirect_uri
    });

    console.log('🔍 Token exchange params:', {
      grant_type: 'authorization_code',
      code: code ? 'present' : 'missing',
      redirect_uri: xeroSettings.redirect_uri
    });

    const response = await axios.post('https://identity.xero.com/connect/token', params, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${Buffer.from(`${xeroSettings.client_id}:${xeroSettings.client_secret}`).toString('base64')}`
      }
    });

    console.log('🔍 Token exchange successful');
    const tokens = {
      accessToken: response.data.access_token,
      refreshToken: response.data.refresh_token,
      expiresIn: response.data.expires_in,
      tokenType: response.data.token_type
    };

    // 5. Get available tenants/organizations
    console.log('🔍 Getting available tenants...');
    const tenantsResponse = await axios.get('https://api.xero.com/connections', {
      headers: {
        'Authorization': `Bearer ${tokens.accessToken}`,
        'Content-Type': 'application/json'
      }
    });

    const tenants = tenantsResponse.data;
    console.log('🔍 Found tenants:', tenants.length);

    console.log('✅ Xero callback completed successfully');
    res.json({
      success: true,
      message: 'Xero authentication successful',
      data: {
        tokens,
        tenants,
        companyId
      }
    });
  } catch (error) {
    console.error('❌ OAuth Callback Error:', error);
    console.error('❌ Error details:', {
      message: error.message,
      response: error.response?.data,
      status: error.response?.status,
      stack: error.stack
    });
    
    // Provide more specific error messages
    let errorMessage = 'Failed to complete OAuth flow';
    if (error.response?.status === 400) {
      errorMessage = 'Invalid authorization code or redirect URI';
    } else if (error.response?.status === 401) {
      errorMessage = 'Invalid client credentials';
    } else if (error.response?.status === 403) {
      errorMessage = 'Access denied by Xero';
    }
    
    res.status(500).json({
      success: false,
      message: errorMessage,
      error: error.message,
      details: error.response?.data || null
    });
  }
};

/**
 * Get Xero data (invoices, contacts, etc.)
 */
const getXeroData = async (req, res, next) => {
  try {
    const { resourceType } = req.params;
    const { accessToken, tenantId } = req.body;

    if (!accessToken || !tenantId) {
      return res.status(400).json({
        success: false,
        message: 'Access token and tenant ID are required'
      });
    }

    // Validate resource type
    const validResourceTypes = [
      'invoices', 
      'contacts', 
      'bank-transactions', 
      'accounts', 
      'items',
      'tax-rates',
      'tracking-categories',
      'organization'
    ];
    
    if (!validResourceTypes.includes(resourceType)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid resource type',
        error: `Resource type must be one of: ${validResourceTypes.join(', ')}`
      });
    }

    // Make API request to Xero
    const response = await axios.get(`https://api.xero.com/api.xro/2.0/${resourceType}`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Xero-tenant-id': tenantId,
        'Content-Type': 'application/json'
      }
    });

    res.json({
      success: true,
      message: `${resourceType} retrieved successfully`,
      data: response.data
    });

  } catch (error) {
    console.error('Get Xero Data Error:', error);
    
    if (error.response?.status === 401) {
      return res.status(401).json({
        success: false,
        message: 'Authentication failed. Please reconnect your Xero account.',
        error: error.message
      });
    }
    
    if (error.response?.status === 403) {
      return res.status(403).json({
        success: false,
        message: 'Insufficient permissions for this operation.',
        error: error.message
      });
    }
    
    if (error.response?.status === 404) {
      return res.status(404).json({
        success: false,
        message: 'Resource not found.',
        error: error.message
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to get Xero data',
      error: error.message
    });
  }
};

/**
 * Refresh access token
 */
const refreshToken = async (req, res, next) => {
  try {
    const { refreshToken, companyId } = req.body;

    if (!refreshToken || !companyId) {
      return res.status(400).json({
        success: false,
        message: 'Refresh token and company ID are required'
      });
    }

    // Get company's Xero settings
    const xeroSettings = await XeroSettings.getByCompanyId(companyId);
    if (!xeroSettings) {
      return res.status(400).json({
        success: false,
        message: 'Xero settings not configured for this company'
      });
    }

    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken
    });

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

    res.json({
      success: true,
      message: 'Token refreshed successfully',
      data: tokens
    });

  } catch (error) {
    console.error('Refresh Token Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to refresh token',
      error: error.message
    });
  }
};

/**
 * Get company information for Xero integration
 */
const getCompanyInfo = async (req, res, next) => {
  try {
    const companyId = req.company.id;
    const isEnrolled = await isCompanyEnrolled(companyId);

    const companyData = {
      id: req.company.id,
      companyName: req.company.companyName,
      email: req.company.email,
      role: req.company.role,
      isEnrolled,
      enrollmentStatus: {
        isEnrolled,
        message: 'Xero integration is now independent of compliance enrollment'
      }
    };

    // If enrolled, get compliance details
    if (isEnrolled) {
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
      } catch (error) {
        console.error('Error fetching compliance details:', error);
      }
    }

    res.json({
      success: true,
      message: 'Company information retrieved successfully',
      data: companyData
    });
  } catch (error) {
    console.error('Get Company Info Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve company information',
      error: error.message
    });
  }
};

/**
 * Create or update Xero settings for a company
 */
const createXeroSettings = async (req, res, next) => {
  try {
    console.log('🔍 DEBUG: createXeroSettings called');
    console.log('🔍 DEBUG: req.body:', req.body);
    
    const companyId = req.company.id;
    const { clientId, clientSecret, redirectUri } = req.body;

    if (!clientId || !clientSecret || !redirectUri) {
      return res.status(400).json({
        success: false,
        message: 'Client ID, Client Secret, and Redirect URI are required'
      });
    }

    // Validate redirect URI format
    try {
      new URL(redirectUri);
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid redirect URI format'
      });
    }

    const settings = await XeroSettings.createSettings(companyId, {
      clientId,
      clientSecret,
      redirectUri
    });

    res.json({
      success: true,
      message: 'Xero settings saved successfully',
      data: {
        id: settings.id,
        companyId: settings.company_id,
        clientId: settings.client_id,
        redirectUri: settings.redirect_uri,
        createdAt: settings.created_at,
        updatedAt: settings.updated_at
      }
    });

  } catch (error) {
    console.error('Create Xero Settings Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to save Xero settings',
      error: error.message
    });
  }
};

/**
 * Get Xero settings for a company
 */
const getXeroSettings = async (req, res, next) => {
  try {
    const companyId = req.company.id;
    const settings = await XeroSettings.getByCompanyId(companyId);

    if (!settings) {
      return res.status(404).json({
        success: false,
        message: 'Xero settings not found for this company'
      });
    }

    res.json({
      success: true,
      message: 'Xero settings retrieved successfully',
      data: {
        id: settings.id,
        companyId: settings.company_id,
        clientId: settings.client_id,
        redirectUri: settings.redirect_uri,
        createdAt: settings.created_at,
        updatedAt: settings.updated_at
      }
    });

  } catch (error) {
    console.error('Get Xero Settings Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get Xero settings',
      error: error.message
    });
  }
};

/**
 * Delete Xero settings for a company
 */
const deleteXeroSettings = async (req, res, next) => {
  try {
    const companyId = req.company.id;
    const settings = await XeroSettings.deleteSettings(companyId);

    if (!settings) {
      return res.status(404).json({
        success: false,
        message: 'Xero settings not found for this company'
      });
    }

    res.json({
      success: true,
      message: 'Xero settings deleted successfully',
      data: {
        id: settings.id,
        companyId: settings.company_id
      }
    });

  } catch (error) {
    console.error('Delete Xero Settings Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete Xero settings',
      error: error.message
    });
  }
};

/**
 * Get all Xero settings (admin only)
 */
const getAllXeroSettings = async (req, res, next) => {
  try {
    // Check if user is admin
    if (req.company.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Admin privileges required.'
      });
    }

    const settings = await XeroSettings.getAllSettings();

    res.json({
      success: true,
      message: 'All Xero settings retrieved successfully',
      data: settings.map(setting => ({
        id: setting.id,
        companyId: setting.company_id,
        companyName: setting.company_name,
        email: setting.email,
        clientId: setting.client_id,
        redirectUri: setting.redirect_uri,
        createdAt: setting.created_at,
        updatedAt: setting.updated_at
      }))
    });

  } catch (error) {
    console.error('Get All Xero Settings Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get all Xero settings',
      error: error.message
    });
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
  createXeroAuthState
}; 