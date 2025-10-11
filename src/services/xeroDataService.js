const axios = require('axios');
const db = require('../config/database');
const xeroAuthService = require('./xeroAuthService');

/**
 * Xero Data Service - Unified Data Fetching and Caching
 * Handles all Xero API calls, data caching, and organization-specific data fetching
 */
class XeroDataService {

  constructor() {
    this.baseUrl = 'https://api.xero.com';
    this.cacheExpiry = {
      'invoices': 15 * 60 * 1000, // 15 minutes
      'contacts': 30 * 60 * 1000, // 30 minutes
      'bas_data': 60 * 60 * 1000, // 1 hour
      'fas_data': 60 * 60 * 1000, // 1 hour
      'financial_summary': 30 * 60 * 1000, // 30 minutes
      'dashboard_data': 15 * 60 * 1000 // 15 minutes
    };
  }

  /**
   * Fetch data from Xero API with automatic token refresh
   * @param {string} endpoint - API endpoint
   * @param {string} accessToken - Access token
   * @param {string} tenantId - Tenant ID
   * @param {Object} params - Query parameters
   * @returns {Promise<Object>} API response
   */
  async fetchFromXero(endpoint, accessToken, tenantId, params = {}, options = {}) {
    try {
      const { companyId, retryOnUnauthorized = true } = options;

      console.log(`📡 Fetching from Xero API: ${endpoint} for tenant ${tenantId}`);

      const url = `${this.baseUrl}${endpoint}`;
      const config = {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Xero-tenant-id': tenantId,
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        params
      };

      const response = await axios.get(url, config);
      
      console.log(`✅ Successfully fetched from Xero API: ${endpoint}`);
      return response.data;

    } catch (error) {
      const status = error.response?.status;
      console.error(`❌ Error fetching from Xero API (${endpoint}):`, {
        status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        message: error.message
      });

      if (status === 401 && companyId && retryOnUnauthorized) {
        console.warn(`⚠️  Received 401 from Xero for company ${companyId}. Attempting token refresh...`);
        try {
          const refreshed = await xeroAuthService.refreshAccessToken(companyId);
          const newAccessToken = refreshed?.access_token || await xeroAuthService.getValidAccessToken(companyId);
          return await this.fetchFromXero(endpoint, newAccessToken, tenantId, params, {
            companyId,
            retryOnUnauthorized: false
          });
        } catch (refreshError) {
          const refreshStatus = refreshError.response?.status;
          const refreshData = refreshError.response?.data;
          const refreshMessage = refreshError.message || 'Xero token expired. Please reconnect to Xero.';
          console.error(`❌ Failed to refresh Xero token for company ${companyId}:`, {
            message: refreshMessage,
            status: refreshStatus,
            data: refreshData
          });
          throw new Error(refreshMessage);
        }
      }

      if (status === 401) {
        throw new Error('Xero token expired. Please reconnect to Xero.');
      }

      if (status === 403) {
        throw new Error('Access denied to Xero organization. Please check your permissions.');
      }

      throw error;
    }
  }

  /**
   * Get cached data
   * @param {number} companyId - Company ID
   * @param {string} tenantId - Tenant ID
   * @param {string} dataType - Data type
   * @returns {Promise<Object|null>} Cached data or null
   */
  async getCachedData(companyId, tenantId, dataType) {
    try {
      const result = await db.query(`
        SELECT data, cached_at, expires_at 
        FROM xero_data_cache 
        WHERE company_id = $1 AND tenant_id = $2 AND data_type = $3
        AND (expires_at IS NULL OR expires_at > NOW())
      `, [companyId, tenantId, dataType]);

      if (result.rows.length === 0) {
        return null;
      }

      const cacheEntry = result.rows[0];
      console.log(`📦 Using cached data for ${dataType} (cached at: ${cacheEntry.cached_at})`);
      
      return cacheEntry.data;

    } catch (error) {
      console.error('❌ Error getting cached data:', error);
      return null;
    }
  }

  /**
   * Cache data
   * @param {number} companyId - Company ID
   * @param {string} tenantId - Tenant ID
   * @param {string} dataType - Data type
   * @param {Object} data - Data to cache
   * @param {number} ttlMinutes - Time to live in minutes
   */
  async cacheData(companyId, tenantId, dataType, data, ttlMinutes = 30) {
    try {
      const expiresAt = new Date(Date.now() + (ttlMinutes * 60 * 1000));

      await db.query(`
        INSERT INTO xero_data_cache (company_id, tenant_id, data_type, data, expires_at, cached_at)
        VALUES ($1, $2, $3, $4, $5, NOW())
        ON CONFLICT (company_id, tenant_id, data_type)
        DO UPDATE SET
          data = EXCLUDED.data,
          expires_at = EXCLUDED.expires_at,
          cached_at = NOW(),
          updated_at = NOW()
      `, [companyId, tenantId, dataType, data, expiresAt]);

      console.log(`💾 Cached ${dataType} data for company ${companyId}, tenant ${tenantId}`);

    } catch (error) {
      console.error('❌ Error caching data:', error);
      // Don't throw - caching is not critical
    }
  }

  /**
   * Get invoices with caching
   * @param {number} companyId - Company ID
   * @param {string} tenantId - Tenant ID
   * @param {Object} options - Query options
   * @returns {Promise<Object>} Invoices data
   */
  async getInvoices(companyId, tenantId, options = {}) {
    try {
      const { useCache = true, fromDate, toDate, status } = options;

      // Check cache first
      if (useCache) {
        const cachedData = await this.getCachedData(companyId, tenantId, 'invoices');
        if (cachedData) {
          return cachedData;
        }
      }

      // Get valid access token
      const accessToken = await xeroAuthService.getValidAccessToken(companyId);

      // Build query parameters
      const params = {};
      if (fromDate) params.date = `>=${fromDate}`;
      if (toDate) params.date = `${params.date || ''}<=${toDate}`;
      if (status) params.status = status;

      // Fetch from Xero
      const data = await this.fetchFromXero(
        '/accounting.xro/2.0/Invoices',
        accessToken,
        tenantId,
        params,
        { companyId }
      );

      // Cache the result
      await this.cacheData(companyId, tenantId, 'invoices', data, 15); // 15 minutes

      return data;

    } catch (error) {
      console.error('❌ Error getting invoices:', error);
      throw error;
    }
  }

  /**
   * Get contacts with caching
   * @param {number} companyId - Company ID
   * @param {string} tenantId - Tenant ID
   * @param {Object} options - Query options
   * @returns {Promise<Object>} Contacts data
   */
  async getContacts(companyId, tenantId, options = {}) {
    try {
      const { useCache = true, includeArchived = false } = options;

      // Check cache first
      if (useCache) {
        const cachedData = await this.getCachedData(companyId, tenantId, 'contacts');
        if (cachedData) {
          return cachedData;
        }
      }

      // Get valid access token
      const accessToken = await xeroAuthService.getValidAccessToken(companyId);

      // Build query parameters
      const params = {};
      if (!includeArchived) params.includeArchived = 'false';

      // Fetch from Xero
      const data = await this.fetchFromXero(
        '/accounting.xro/2.0/Contacts',
        accessToken,
        tenantId,
        params,
        { companyId }
      );

      // Cache the result
      await this.cacheData(companyId, tenantId, 'contacts', data, 30); // 30 minutes

      return data;

    } catch (error) {
      console.error('❌ Error getting contacts:', error);
      throw error;
    }
  }

  /**
   * Get BAS report data
   * @param {number} companyId - Company ID
   * @param {string} tenantId - Tenant ID
   * @param {Object} options - Query options
   * @returns {Promise<Object>} BAS data
   */
  async getBASData(companyId, tenantId, options = {}) {
    try {
      const { useCache = true, fromDate, toDate } = options;

      // Check cache first
      if (useCache) {
        const cachedData = await this.getCachedData(companyId, tenantId, 'bas_data');
        if (cachedData) {
          return cachedData;
        }
      }

      // Get valid access token
      const accessToken = await xeroAuthService.getValidAccessToken(companyId);

      // Build query parameters
      const params = {};
      if (fromDate) params.fromDate = fromDate;
      if (toDate) params.toDate = toDate;

      // Fetch from Xero (using reports endpoint for BAS)
      const data = await this.fetchFromXero(
        '/accounting.xro/2.0/Reports/BAS',
        accessToken,
        tenantId,
        params,
        { companyId }
      );

      // Cache the result
      await this.cacheData(companyId, tenantId, 'bas_data', data, 60); // 1 hour

      return data;

    } catch (error) {
      console.error('❌ Error getting BAS data:', error);
      throw error;
    }
  }

  /**
   * Get FAS report data
   * @param {number} companyId - Company ID
   * @param {string} tenantId - Tenant ID
   * @param {Object} options - Query options
   * @returns {Promise<Object>} FAS data
   */
  async getFASData(companyId, tenantId, options = {}) {
    try {
      const { useCache = true, fromDate, toDate } = options;

      // Check cache first
      if (useCache) {
        const cachedData = await this.getCachedData(companyId, tenantId, 'fas_data');
        if (cachedData) {
          return cachedData;
        }
      }

      // Get valid access token
      const accessToken = await xeroAuthService.getValidAccessToken(companyId);

      // Build query parameters
      const params = {};
      if (fromDate) params.fromDate = fromDate;
      if (toDate) params.toDate = toDate;

      // Fetch from Xero (using reports endpoint for FAS)
      const data = await this.fetchFromXero(
        '/accounting.xro/2.0/Reports/FAS',
        accessToken,
        tenantId,
        params,
        { companyId }
      );

      // Cache the result
      await this.cacheData(companyId, tenantId, 'fas_data', data, 60); // 1 hour

      return data;

    } catch (error) {
      console.error('❌ Error getting FAS data:', error);
      throw error;
    }
  }

  /**
   * Get financial summary
   * @param {number} companyId - Company ID
   * @param {string} tenantId - Tenant ID
   * @param {Object} options - Query options
   * @returns {Promise<Object>} Financial summary
   */
  async getFinancialSummary(companyId, tenantId, options = {}) {
    try {
      const { useCache = true, fromDate, toDate } = options;

      // Check cache first
      if (useCache) {
        const cachedData = await this.getCachedData(companyId, tenantId, 'financial_summary');
        if (cachedData) {
          return cachedData;
        }
      }

      // Get valid access token
      const accessToken = await xeroAuthService.getValidAccessToken(companyId);

      // Build query parameters
      const params = {};
      if (fromDate) params.fromDate = fromDate;
      if (toDate) params.toDate = toDate;

      // Fetch from Xero
      const data = await this.fetchFromXero(
        '/accounting.xro/2.0/Reports/ProfitAndLoss',
        accessToken,
        tenantId,
        params,
        { companyId }
      );

      // Cache the result
      await this.cacheData(companyId, tenantId, 'financial_summary', data, 30); // 30 minutes

      return data;

    } catch (error) {
      console.error('❌ Error getting financial summary:', error);
      throw error;
    }
  }

  /**
   * Get dashboard data (combined data for dashboard)
   * @param {number} companyId - Company ID
   * @param {string} tenantId - Tenant ID
   * @returns {Promise<Object>} Dashboard data
   */
  async getDashboardData(companyId, tenantId) {
    try {
      // Check cache first
      const cachedData = await this.getCachedData(companyId, tenantId, 'dashboard_data');
      if (cachedData) {
        return cachedData;
      }

      // Get valid access token
      const accessToken = await xeroAuthService.getValidAccessToken(companyId);

      // Fetch multiple data sources in parallel
      const fetchOptions = { companyId };
      const noRetryOptions = { companyId, retryOnUnauthorized: false };

      const [invoices, contacts, financialSummary] = await Promise.allSettled([
        this.fetchFromXero('/accounting.xro/2.0/Invoices?page=1', accessToken, tenantId, {}, fetchOptions),
        this.fetchFromXero('/accounting.xro/2.0/Contacts?page=1', accessToken, tenantId, {}, noRetryOptions),
        this.fetchFromXero('/accounting.xro/2.0/Reports/ProfitAndLoss', accessToken, tenantId, {}, noRetryOptions)
      ]);

      const dashboardData = {
        invoices: invoices.status === 'fulfilled' ? invoices.value : null,
        contacts: contacts.status === 'fulfilled' ? contacts.value : null,
        financialSummary: financialSummary.status === 'fulfilled' ? financialSummary.value : null,
        lastUpdated: new Date().toISOString()
      };

      // Cache the result
      await this.cacheData(companyId, tenantId, 'dashboard_data', dashboardData, 15); // 15 minutes

      return dashboardData;

    } catch (error) {
      console.error('❌ Error getting dashboard data:', error);
      throw error;
    }
  }

  /**
   * Clear cache for a company/tenant
   * @param {number} companyId - Company ID
   * @param {string} tenantId - Optional tenant ID (clears all if not provided)
   * @param {string} dataType - Optional data type (clears all if not provided)
   */
  async clearCache(companyId, tenantId = null, dataType = null) {
    try {
      let query = 'DELETE FROM xero_data_cache WHERE company_id = $1';
      const params = [companyId];

      if (tenantId) {
        query += ' AND tenant_id = $2';
        params.push(tenantId);
      }

      if (dataType) {
        query += ` AND data_type = $${params.length + 1}`;
        params.push(dataType);
      }

      await db.query(query, params);
      console.log(`🗑️  Cleared cache for company ${companyId}${tenantId ? `, tenant ${tenantId}` : ''}${dataType ? `, type ${dataType}` : ''}`);

    } catch (error) {
      console.error('❌ Error clearing cache:', error);
      throw error;
    }
  }

  /**
   * Validate tenant access and get valid tenant ID
   * @param {number} companyId - Company ID
   * @param {string} requestedTenantId - Requested tenant ID
   * @returns {Promise<string>} Validated tenant ID
   */
  async validateTenantAccess(companyId, requestedTenantId) {
    return await xeroAuthService.validateTenantAccess(companyId, requestedTenantId);
  }
}

module.exports = new XeroDataService();
