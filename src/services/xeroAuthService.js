const axios = require('axios');
const crypto = require('crypto');
const db = require('../config/database');

/**
 * Xero Authentication Service - Unified OAuth and Token Management
 * Handles all Xero authentication, token management, and organization access
 */
class XeroAuthService {
  
  constructor() {
    this.config = {
      clientId: process.env.XERO_CLIENT_ID,
      clientSecret: process.env.XERO_CLIENT_SECRET,
      redirectUri: process.env.XERO_REDIRECT_URI || 'https://compliance-manager-frontend.onrender.com/redirecturl',
      scopes: [
        'offline_access',
        'openid',
        'profile', 
        'email',
        'accounting.transactions',
        'accounting.settings',
        'accounting.reports.read',
        'accounting.contacts'
      ].join(' '),
      authorizeUrl: 'https://login.xero.com/identity/connect/authorize',
      tokenUrl: 'https://identity.xero.com/connect/token',
      connectionsUrl: 'https://api.xero.com/connections'
    };
  }

  /**
   * Generate OAuth authorization URL
   * @param {number} companyId - Company ID
   * @returns {Promise<string>} Authorization URL
   */
  async generateAuthUrl(companyId) {
    try {
      console.log(`🔗 Generating OAuth URL for company ${companyId}`);
      
      if (!this.config.clientId || !this.config.clientSecret) {
        throw new Error('Xero OAuth2 not configured. Please set XERO_CLIENT_ID and XERO_CLIENT_SECRET environment variables.');
      }

      // Generate secure state parameter
      const state = crypto.randomBytes(32).toString('hex');
      
      // Store state for validation
      await db.query(
        'INSERT INTO xero_oauth_states (company_id, state, created_at) VALUES ($1, $2, NOW())',
        [companyId, state]
      );

      const authUrl = new URL(this.config.authorizeUrl);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('client_id', this.config.clientId);
      authUrl.searchParams.set('redirect_uri', this.config.redirectUri);
      authUrl.searchParams.set('scope', this.config.scopes);
      authUrl.searchParams.set('state', state);

      console.log(`✅ Generated OAuth URL for company ${companyId}`);
      return authUrl.toString();

    } catch (error) {
      console.error('❌ Error generating auth URL:', error);
      throw error;
    }
  }

  /**
   * Exchange authorization code for tokens
   * @param {string} code - Authorization code
   * @param {string} state - State parameter
   * @returns {Promise<Object>} Token response
   */
  async exchangeCodeForTokens(code, state) {
    try {
      console.log('🔄 Exchanging authorization code for tokens...');

      // Validate state parameter
      const stateResult = await db.query(
        'SELECT company_id FROM xero_oauth_states WHERE state = $1 AND created_at > NOW() - INTERVAL \'10 minutes\'',
        [state]
      );

      if (stateResult.rows.length === 0) {
        throw new Error('Invalid or expired state parameter');
      }

      const companyId = stateResult.rows[0].company_id;

      // Exchange code for tokens
      const tokenResponse = await axios.post(this.config.tokenUrl, {
        grant_type: 'authorization_code',
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        code: code,
        redirect_uri: this.config.redirectUri
      }, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });

      const tokens = tokenResponse.data;
      console.log('✅ Successfully exchanged code for tokens');

      // Fetch authorized tenants
      const tenantsResponse = await axios.get(this.config.connectionsUrl, {
        headers: {
          'Authorization': `Bearer ${tokens.access_token}`,
          'Content-Type': 'application/json'
        }
      });

      const authorizedTenants = tenantsResponse.data.map(conn => ({
        id: conn.tenantId,
        tenantId: conn.tenantId,
        name: conn.tenantName || 'Unknown Organization',
        tenantName: conn.tenantName || 'Unknown Organization',
        organizationName: conn.tenantName || 'Unknown Organization',
        connectionId: conn.id
      }));

      // Save connection to database
      await this.saveConnection(companyId, tokens, authorizedTenants);

      // Clean up state
      await db.query('DELETE FROM xero_oauth_states WHERE state = $1', [state]);

      return {
        success: true,
        companyId,
        tokens,
        authorizedTenants
      };

    } catch (error) {
      console.error('❌ Error exchanging code for tokens:', error);
      throw error;
    }
  }

  /**
   * Save Xero connection to database
   * @param {number} companyId - Company ID
   * @param {Object} tokens - Token data
   * @param {Array} authorizedTenants - Authorized tenants
   */
  async saveConnection(companyId, tokens, authorizedTenants) {
    try {
      console.log(`💾 Saving Xero connection for company ${companyId}`);

      const expiresAt = new Date(Date.now() + (tokens.expires_in * 1000));
      
      // Use the first tenant as the primary connection
      const primaryTenant = authorizedTenants[0];

      await db.query(`
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
          token_created_at,
          created_at,
          updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW(), NOW())
        ON CONFLICT (company_id) DO UPDATE SET
          tenant_id = EXCLUDED.tenant_id,
          tenant_name = EXCLUDED.tenant_name,
          access_token_encrypted = EXCLUDED.access_token_encrypted,
          refresh_token_encrypted = EXCLUDED.refresh_token_encrypted,
          access_token_expires_at = EXCLUDED.access_token_expires_at,
          status = 'active',
          authorized_tenants = EXCLUDED.authorized_tenants,
          selected_tenant_id = EXCLUDED.selected_tenant_id,
          primary_organization_name = EXCLUDED.primary_organization_name,
          xero_user_id = EXCLUDED.xero_user_id,
          token_created_at = EXCLUDED.token_created_at,
          updated_at = NOW()
      `, [
        companyId,
        primaryTenant?.tenantId || null,
        primaryTenant?.tenantName || 'Unknown Organization',
        tokens.access_token, // Store as plain text for now (should be encrypted)
        tokens.refresh_token, // Store as plain text for now (should be encrypted)
        expiresAt,
        'active',
        companyId,
        this.config.clientId,
        this.config.clientSecret,
        this.config.redirectUri,
        JSON.stringify(authorizedTenants),
        primaryTenant?.tenantId || null,
        primaryTenant?.tenantName || 'Unknown Organization',
        tokens.id_token ? this.extractUserIdFromToken(tokens.id_token) : null,
        new Date()
      ]);

      console.log(`✅ Saved Xero connection for company ${companyId}`);

    } catch (error) {
      console.error('❌ Error saving connection:', error);
      throw error;
    }
  }

  /**
   * Refresh access token
   * @param {number} companyId - Company ID
   * @returns {Promise<Object>} New tokens
   */
  async refreshAccessToken(companyId) {
    try {
      console.log(`🔄 Refreshing token for company ${companyId}`);

      const result = await db.query(
        'SELECT * FROM xero_connections WHERE company_id = $1',
        [companyId]
      );

      if (result.rows.length === 0) {
        throw new Error('No Xero connection found for company');
      }

      const connection = result.rows[0];

      if (!connection.refresh_token_encrypted) {
        throw new Error('No refresh token available');
      }

      const refreshResponse = await axios.post(this.config.tokenUrl, {
        grant_type: 'refresh_token',
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        refresh_token: connection.refresh_token_encrypted
      }, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });

      const newTokens = refreshResponse.data;
      const expiresAt = new Date(Date.now() + (newTokens.expires_in * 1000));

      // Update tokens in database
      await db.query(`
        UPDATE xero_connections 
        SET 
          access_token_encrypted = $1,
          refresh_token_encrypted = $2,
          access_token_expires_at = $3,
          token_created_at = NOW(),
          updated_at = NOW()
        WHERE company_id = $4
      `, [
        newTokens.access_token,
        newTokens.refresh_token,
        expiresAt,
        companyId
      ]);

      console.log(`✅ Refreshed token for company ${companyId}`);

      return {
        access_token: newTokens.access_token,
        refresh_token: newTokens.refresh_token,
        expires_at: expiresAt
      };

    } catch (error) {
      console.error('❌ Error refreshing token:', error);
      throw error;
    }
  }

  /**
   * Get valid access token (refresh if needed)
   * @param {number} companyId - Company ID
   * @returns {Promise<string>} Valid access token
   */
  async getValidAccessToken(companyId) {
    try {
      const result = await db.query(
        'SELECT * FROM xero_connections WHERE company_id = $1',
        [companyId]
      );

      if (result.rows.length === 0) {
        throw new Error('No Xero connection found');
      }

      const connection = result.rows[0];

      // Check if token is expired (with 5 minute buffer)
      const bufferTime = 5 * 60 * 1000; // 5 minutes
      const isExpired = new Date(connection.access_token_expires_at) <= new Date(Date.now() + bufferTime);

      if (isExpired) {
        console.log(`🔄 Token expired for company ${companyId}, refreshing...`);
        const newTokens = await this.refreshAccessToken(companyId);
        return newTokens.access_token;
      }

      return connection.access_token_encrypted;

    } catch (error) {
      console.error('❌ Error getting valid token:', error);
      throw error;
    }
  }

  /**
   * Validate tenant access
   * @param {number} companyId - Company ID
   * @param {string} requestedTenantId - Tenant ID to validate
   * @returns {Promise<string>} Validated tenant ID
   */
  async validateTenantAccess(companyId, requestedTenantId) {
    try {
      const result = await db.query(
        'SELECT authorized_tenants FROM xero_connections WHERE company_id = $1',
        [companyId]
      );

      if (result.rows.length === 0) {
        throw new Error('No Xero connection found');
      }

      const authorizedTenants = result.rows[0].authorized_tenants || [];

      if (authorizedTenants.length === 0) {
        throw new Error('No authorized tenants found. Please reconnect to Xero.');
      }

      // If no tenant specified, use first authorized tenant
      if (!requestedTenantId) {
        return authorizedTenants[0].tenantId || authorizedTenants[0].id;
      }

      // Find requested tenant
      const authorizedTenant = authorizedTenants.find(tenant => 
        tenant.tenantId === requestedTenantId || tenant.id === requestedTenantId
      );

      if (!authorizedTenant) {
        console.log(`⚠️  Tenant ${requestedTenantId} not found, falling back to first authorized tenant`);
        return authorizedTenants[0].tenantId || authorizedTenants[0].id;
      }

      return requestedTenantId;

    } catch (error) {
      console.error('❌ Error validating tenant access:', error);
      throw error;
    }
  }

  /**
   * Get connection status
   * @param {number} companyId - Company ID
   * @returns {Promise<Object>} Connection status
   */
  async getConnectionStatus(companyId) {
    try {
      const result = await db.query(
        'SELECT * FROM xero_connections WHERE company_id = $1',
        [companyId]
      );

      if (result.rows.length === 0) {
        return {
          connected: false,
          isTokenValid: false,
          hasCredentials: !!(this.config.clientId && this.config.clientSecret),
          needsOAuth: true,
          message: 'Not connected to Xero'
        };
      }

      const connection = result.rows[0];
      const now = new Date();
      const tokenExpiry = new Date(connection.access_token_expires_at);
      const bufferTime = 5 * 60 * 1000; // 5 minutes
      const isTokenValid = tokenExpiry > new Date(now.getTime() + bufferTime);

      const authorizedTenants = connection.authorized_tenants || [];

      return {
        connected: isTokenValid,
        isTokenValid,
        expiresAt: connection.access_token_expires_at,
        tenants: authorizedTenants,
        primaryOrganization: connection.primary_organization_name ? {
          id: connection.tenant_id,
          name: connection.primary_organization_name
        } : null,
        xeroUserId: connection.xero_user_id,
        hasExpiredTokens: !isTokenValid && !!connection.access_token_encrypted,
        hasCredentials: !!(this.config.clientId && this.config.clientSecret),
        needsOAuth: false,
        message: authorizedTenants.length === 0 && isTokenValid 
          ? "Connected to Xero but no organizations found. Please check your Xero account has organizations or reconnect to refresh the connection."
          : undefined
      };

    } catch (error) {
      console.error('❌ Error getting connection status:', error);
      throw error;
    }
  }

  /**
   * Disconnect Xero
   * @param {number} companyId - Company ID
   */
  async disconnect(companyId) {
    try {
      console.log(`🔌 Disconnecting Xero for company ${companyId}`);

      await db.query(`
        UPDATE xero_connections 
        SET 
          access_token_encrypted = NULL,
          refresh_token_encrypted = NULL,
          access_token_expires_at = NULL,
          status = 'disconnected',
          authorized_tenants = '[]'::jsonb,
          updated_at = NOW()
        WHERE company_id = $1
      `, [companyId]);

      // Clear cache
      await db.query('DELETE FROM xero_data_cache WHERE company_id = $1', [companyId]);

      console.log(`✅ Disconnected Xero for company ${companyId}`);

    } catch (error) {
      console.error('❌ Error disconnecting:', error);
      throw error;
    }
  }

  /**
   * Extract user ID from JWT token
   * @param {string} token - JWT token
   * @returns {string|null} User ID
   */
  extractUserIdFromToken(token) {
    try {
      const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
      return payload.sub || payload.user_id || null;
    } catch (error) {
      console.warn('⚠️  Could not extract user ID from token:', error.message);
      return null;
    }
  }
}

module.exports = new XeroAuthService();
