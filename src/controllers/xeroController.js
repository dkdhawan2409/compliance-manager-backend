const xeroAuthService = require('../services/xeroAuthService');
const xeroDataService = require('../services/xeroDataService');

/**
 * Xero Controller - Unified API endpoints for Xero integration
 * Handles all Xero-related API requests with proper authentication and organization selection
 */
class XeroController {

  /**
   * Generate OAuth authorization URL
   * GET /api/xero/connect
   */
  async connect(req, res) {
    try {
      const companyId = req.company.id;
      console.log(`🔗 Generating OAuth URL for company ${companyId}`);

      const authUrl = await xeroAuthService.generateAuthUrl(companyId);

      res.json({
        success: true,
        authUrl,
        message: 'Redirect to this URL to connect to Xero'
      });

    } catch (error) {
      console.error('❌ Error in connect:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to generate OAuth URL',
        error: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
  }

  /**
   * Handle OAuth callback
   * GET /api/xero/callback
   */
  async callback(req, res) {
    try {
      const { code, state } = req.query;

      if (!code || !state) {
        return res.status(400).json({
          success: false,
          message: 'Missing authorization code or state parameter'
        });
      }

      console.log('🔄 Processing OAuth callback...');

      const result = await xeroAuthService.exchangeCodeForTokens(code, state);

      // Redirect to frontend with success
      const redirectUrl = `${process.env.FRONTEND_URL || 'https://compliance-manager-frontend.onrender.com'}/redirecturl?success=true&companyId=${result.companyId}`;
      res.redirect(redirectUrl);

    } catch (error) {
      console.error('❌ Error in callback:', error);
      
      // Redirect to frontend with error
      const redirectUrl = `${process.env.FRONTEND_URL || 'https://compliance-manager-frontend.onrender.com'}/redirecturl?success=false&error=${encodeURIComponent(error.message)}`;
      res.redirect(redirectUrl);
    }
  }

  /**
   * Get connection status
   * GET /api/xero/status
   */
  async getStatus(req, res) {
    try {
      const companyId = req.company.id;
      console.log(`📊 Getting Xero status for company ${companyId}`);

      const status = await xeroAuthService.getConnectionStatus(companyId);

      res.json({
        success: true,
        data: status
      });

    } catch (error) {
      console.error('❌ Error getting status:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to get connection status',
        error: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
  }

  /**
   * Get authorized tenants/organizations
   * GET /api/xero/tenants
   */
  async getTenants(req, res) {
    try {
      const companyId = req.company.id;
      console.log(`🏢 Getting tenants for company ${companyId}`);

      const status = await xeroAuthService.getConnectionStatus(companyId);

      res.json({
        success: true,
        data: {
          tenants: status.tenants || [],
          connected: status.connected,
          isTokenValid: status.isTokenValid,
          message: status.message
        }
      });

    } catch (error) {
      console.error('❌ Error getting tenants:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to get tenants',
        error: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
  }

  /**
   * Get invoices
   * GET /api/xero/invoices
   */
  async getInvoices(req, res) {
    try {
      const companyId = req.company.id;
      const { tenantId, useCache = 'true', fromDate, toDate, status } = req.query;

      console.log(`📄 Getting invoices for company ${companyId}, tenant ${tenantId}`);

      // Validate tenant access
      const validatedTenantId = await xeroDataService.validateTenantAccess(companyId, tenantId);

      // Get invoices
      const invoices = await xeroDataService.getInvoices(companyId, validatedTenantId, {
        useCache: useCache === 'true',
        fromDate,
        toDate,
        status
      });

      res.json({
        success: true,
        data: invoices,
        tenantId: validatedTenantId
      });

    } catch (error) {
      console.error('❌ Error getting invoices:', error);
      
      let statusCode = 500;
      let message = error.message || 'Failed to get invoices';

      if (error.message.includes('token expired')) {
        statusCode = 401;
        message = 'Xero connection expired. Please reconnect to Xero.';
      } else if (error.message.includes('authorization expired') || error.message.includes('refresh token invalid')) {
        statusCode = 401;
        message = 'Xero authorization expired. Please reconnect to Xero.';
      } else if (error.message.includes('Access denied')) {
        statusCode = 403;
        message = 'Access denied to Xero organization. Please check your permissions.';
      } else if (error.message.includes('No Xero connection')) {
        statusCode = 404;
        message = 'No Xero connection found. Please connect to Xero first.';
      }

      res.status(statusCode).json({
        success: false,
        message,
        error: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
  }

  /**
   * Get contacts
   * GET /api/xero/contacts
   */
  async getContacts(req, res) {
    try {
      const companyId = req.company.id;
      const { tenantId, useCache = 'true', includeArchived = 'false' } = req.query;

      console.log(`👥 Getting contacts for company ${companyId}, tenant ${tenantId}`);

      // Validate tenant access
      const validatedTenantId = await xeroDataService.validateTenantAccess(companyId, tenantId);

      // Get contacts
      const contacts = await xeroDataService.getContacts(companyId, validatedTenantId, {
        useCache: useCache === 'true',
        includeArchived: includeArchived === 'true'
      });

      res.json({
        success: true,
        data: contacts,
        tenantId: validatedTenantId
      });

    } catch (error) {
      console.error('❌ Error getting contacts:', error);
      
      let statusCode = 500;
      let message = error.message || 'Failed to get contacts';

      if (error.message.includes('token expired')) {
        statusCode = 401;
        message = 'Xero connection expired. Please reconnect to Xero.';
      } else if (error.message.includes('Access denied')) {
        statusCode = 403;
        message = 'Access denied to Xero organization. Please check your permissions.';
      } else if (error.message.includes('No Xero connection')) {
        statusCode = 404;
        message = 'No Xero connection found. Please connect to Xero first.';
      }

      res.status(statusCode).json({
        success: false,
        message,
        error: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
  }

  /**
   * Get BAS data
   * GET /api/xero/bas-data
   */
  async getBASData(req, res) {
    try {
      const companyId = req.company.id;
      const { tenantId, useCache = 'true', fromDate, toDate } = req.query;

      console.log(`📊 Getting BAS data for company ${companyId}, tenant ${tenantId}`);

      // Validate tenant access
      const validatedTenantId = await xeroDataService.validateTenantAccess(companyId, tenantId);

      // Get BAS data
      const basData = await xeroDataService.getBASData(companyId, validatedTenantId, {
        useCache: useCache === 'true',
        fromDate,
        toDate
      });

      res.json({
        success: true,
        data: basData,
        tenantId: validatedTenantId
      });

    } catch (error) {
      console.error('❌ Error getting BAS data:', error);
      
      let statusCode = 500;
      let message = error.message || 'Failed to get BAS data';

      if (error.message.includes('token expired')) {
        statusCode = 401;
        message = 'Xero connection expired. Please reconnect to Xero.';
      } else if (error.message.includes('Access denied')) {
        statusCode = 403;
        message = 'Access denied to Xero organization. Please check your permissions.';
      } else if (error.message.includes('No Xero connection')) {
        statusCode = 404;
        message = 'No Xero connection found. Please connect to Xero first.';
      }

      res.status(statusCode).json({
        success: false,
        message,
        error: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
  }

  /**
   * Get FAS data
   * GET /api/xero/fas-data
   */
  async getFASData(req, res) {
    try {
      const companyId = req.company.id;
      const { tenantId, useCache = 'true', fromDate, toDate } = req.query;

      console.log(`📊 Getting FAS data for company ${companyId}, tenant ${tenantId}`);

      // Validate tenant access
      const validatedTenantId = await xeroDataService.validateTenantAccess(companyId, tenantId);

      // Get FAS data
      const fasData = await xeroDataService.getFASData(companyId, validatedTenantId, {
        useCache: useCache === 'true',
        fromDate,
        toDate
      });

      res.json({
        success: true,
        data: fasData,
        tenantId: validatedTenantId
      });

    } catch (error) {
      console.error('❌ Error getting FAS data:', error);
      
      let statusCode = 500;
      let message = error.message || 'Failed to get FAS data';

      if (error.message.includes('token expired')) {
        statusCode = 401;
        message = 'Xero connection expired. Please reconnect to Xero.';
      } else if (error.message.includes('Access denied')) {
        statusCode = 403;
        message = 'Access denied to Xero organization. Please check your permissions.';
      } else if (error.message.includes('No Xero connection')) {
        statusCode = 404;
        message = 'No Xero connection found. Please connect to Xero first.';
      }

      res.status(statusCode).json({
        success: false,
        message,
        error: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
  }

  /**
   * Get financial summary
   * GET /api/xero/financial-summary
   */
  async getFinancialSummary(req, res) {
    try {
      const companyId = req.company.id;
      const { tenantId, useCache = 'true', fromDate, toDate } = req.query;

      console.log(`💰 Getting financial summary for company ${companyId}, tenant ${tenantId}`);

      // Validate tenant access
      const validatedTenantId = await xeroDataService.validateTenantAccess(companyId, tenantId);

      // Get financial summary
      const financialSummary = await xeroDataService.getFinancialSummary(companyId, validatedTenantId, {
        useCache: useCache === 'true',
        fromDate,
        toDate
      });

      res.json({
        success: true,
        data: financialSummary,
        tenantId: validatedTenantId
      });

    } catch (error) {
      console.error('❌ Error getting financial summary:', error);
      
      let statusCode = 500;
      let message = error.message || 'Failed to get financial summary';

      if (error.message.includes('token expired')) {
        statusCode = 401;
        message = 'Xero connection expired. Please reconnect to Xero.';
      } else if (error.message.includes('Access denied')) {
        statusCode = 403;
        message = 'Access denied to Xero organization. Please check your permissions.';
      } else if (error.message.includes('No Xero connection')) {
        statusCode = 404;
        message = 'No Xero connection found. Please connect to Xero first.';
      }

      res.status(statusCode).json({
        success: false,
        message,
        error: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
  }

  /**
   * Get dashboard data
   * GET /api/xero/dashboard
   */
  async getDashboardData(req, res) {
    try {
      const companyId = req.company.id;
      const { tenantId } = req.query;

      console.log(`📊 Getting dashboard data for company ${companyId}, tenant ${tenantId}`);

      // Validate tenant access
      const validatedTenantId = await xeroDataService.validateTenantAccess(companyId, tenantId);

      // Get dashboard data
      const dashboardData = await xeroDataService.getDashboardData(companyId, validatedTenantId);

      res.json({
        success: true,
        data: dashboardData,
        tenantId: validatedTenantId
      });

    } catch (error) {
      console.error('❌ Error getting dashboard data:', error);
      
      let statusCode = 500;
      let message = error.message || 'Failed to get dashboard data';

      if (error.message.includes('token expired')) {
        statusCode = 401;
        message = 'Xero connection expired. Please reconnect to Xero.';
      } else if (error.message.includes('Access denied')) {
        statusCode = 403;
        message = 'Access denied to Xero organization. Please check your permissions.';
      } else if (error.message.includes('No Xero connection')) {
        statusCode = 404;
        message = 'No Xero connection found. Please connect to Xero first.';
      }

      res.status(statusCode).json({
        success: false,
        message,
        error: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
  }

  /**
   * Clear cache
   * DELETE /api/xero/cache
   */
  async clearCache(req, res) {
    try {
      const companyId = req.company.id;
      const { tenantId, dataType } = req.query;

      console.log(`🗑️  Clearing cache for company ${companyId}${tenantId ? `, tenant ${tenantId}` : ''}${dataType ? `, type ${dataType}` : ''}`);

      await xeroDataService.clearCache(companyId, tenantId, dataType);

      res.json({
        success: true,
        message: 'Cache cleared successfully'
      });

    } catch (error) {
      console.error('❌ Error clearing cache:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to clear cache',
        error: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
  }

  /**
   * Disconnect Xero
   * DELETE /api/xero/disconnect
   */
  async disconnect(req, res) {
    try {
      const companyId = req.company.id;
      console.log(`🔌 Disconnecting Xero for company ${companyId}`);

      await xeroAuthService.disconnect(companyId);

      res.json({
        success: true,
        message: 'Successfully disconnected from Xero'
      });

    } catch (error) {
      console.error('❌ Error disconnecting:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to disconnect from Xero',
        error: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
  }
}

module.exports = new XeroController();
