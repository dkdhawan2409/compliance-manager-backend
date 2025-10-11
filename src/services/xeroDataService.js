const axios = require('axios');
const db = require('../config/database');
const XeroSettings = require('../models/XeroSettings');

/**
 * Xero Data Service - Centralized service for all Xero API calls
 * Handles token management, data fetching, and caching
 */
class XeroDataService {
  
  /**
   * Validate that a company has access to a specific tenant
   * @param {number} companyId - Company ID
   * @param {string} requestedTenantId - Tenant ID to validate
   * @returns {Promise<string>} Validated tenant ID
   */
  async validateTenantAccess(companyId, requestedTenantId) {
    try {
      const settings = await XeroSettings.getSettings(companyId);
      
      if (!settings) {
        throw new Error('No Xero settings found. Please connect to Xero first.');
      }
      
      // Get authorized tenants
      let authorizedTenants = [];
      if (settings.authorized_tenants && settings.authorized_tenants.length > 0) {
        authorizedTenants = settings.authorized_tenants;
      } else if (settings.tenant_data) {
        // Fallback to old tenant_data format
        try {
          authorizedTenants = JSON.parse(settings.tenant_data);
          if (!Array.isArray(authorizedTenants)) {
            authorizedTenants = [authorizedTenants];
          }
        } catch (error) {
          console.log('⚠️  Could not parse tenant_data, using empty array');
          authorizedTenants = [];
        }
      }
      
      // If no requested tenant ID, use the first authorized tenant
      if (!requestedTenantId) {
        if (authorizedTenants.length === 0) {
          throw new Error('No Xero organizations found. Please reconnect to Xero.');
        }
        const firstTenant = authorizedTenants[0];
        console.log(`📋 No tenant ID specified, using first authorized tenant: ${firstTenant.name || firstTenant.tenantName}`);
        return firstTenant.tenantId || firstTenant.id;
      }
      
      // Find the requested tenant in authorized tenants
      const authorizedTenant = authorizedTenants.find(tenant => 
        tenant.tenantId === requestedTenantId || 
        tenant.id === requestedTenantId
      );
      
      if (!authorizedTenant) {
        console.log(`⚠️  Requested tenant ${requestedTenantId} not found in authorized tenants`);
        if (authorizedTenants.length > 0) {
          const fallbackTenant = authorizedTenants[0];
          console.log(`📋 Falling back to first authorized tenant: ${fallbackTenant.name || fallbackTenant.tenantName}`);
          return fallbackTenant.tenantId || fallbackTenant.id;
        }
        throw new Error(`Tenant ${requestedTenantId} is not authorized for this company.`);
      }
      
      console.log(`✅ Validated tenant access: ${authorizedTenant.name || authorizedTenant.tenantName}`);
      return authorizedTenant.tenantId || authorizedTenant.id;
      
    } catch (error) {
      console.error('❌ Error validating tenant access:', error);
      throw error;
    }
  }

  /**
   * Get valid Xero token for a company, auto-refresh if expired
   * @param {number} companyId - Company ID
   * @returns {Promise<Object>} Token object with accessToken, refreshToken, tenantId
   */
  async getValidToken(companyId) {
    try {
      const settings = await XeroSettings.getSettings(companyId);
      
      if (!settings || !settings.access_token) {
        throw new Error('No Xero token found. Please connect to Xero first.');
      }
      
      // Check if token is expired
      if (this.isTokenExpired(settings.token_expires_at)) {
        console.log('🔄 Xero token expired, refreshing...');
        return await this.refreshToken(companyId, settings);
      }
      
      return {
        accessToken: settings.access_token,
        refreshToken: settings.refresh_token,
        tenantId: settings.tenant_id,
        organizationName: settings.organization_name
      };
      
    } catch (error) {
      console.error('❌ Error getting valid token:', error);
      throw error;
    }
  }
  
  /**
   * Refresh Xero access token
   * @param {number} companyId - Company ID
   * @param {Object} settings - Current Xero settings
   * @returns {Promise<Object>} New token object
   */
  async refreshToken(companyId, settings) {
    try {
      const params = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: settings.refresh_token,
        client_id: process.env.XERO_CLIENT_ID,
        client_secret: process.env.XERO_CLIENT_SECRET
      });
      
      const response = await axios.post('https://identity.xero.com/connect/token', params, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });
      
      const tokens = {
        accessToken: response.data.access_token,
        refreshToken: response.data.refresh_token,
        expiresIn: response.data.expires_in
      };
      
      // Update database with new tokens
      await db.query(`
        UPDATE xero_settings 
        SET access_token = $1, 
            refresh_token = $2, 
            token_expires_at = $3,
            updated_at = CURRENT_TIMESTAMP
        WHERE company_id = $4
      `, [
        tokens.accessToken,
        tokens.refreshToken,
        new Date(Date.now() + tokens.expiresIn * 1000),
        companyId
      ]);
      
      console.log('✅ Xero token refreshed successfully');
      
      return {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        tenantId: settings.tenant_id,
        organizationName: settings.organization_name
      };
      
    } catch (error) {
      console.error('❌ Error refreshing token:', error);
      
      // If refresh fails, clear tokens to force re-authentication
      await db.query(`
        UPDATE xero_settings 
        SET access_token = NULL, 
            refresh_token = NULL, 
            token_expires_at = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE company_id = $1
      `, [companyId]);
      
      throw new Error('Token refresh failed. Please reconnect to Xero.');
    }
  }
  
  /**
   * Fetch organizations from Xero API
   * @param {string} accessToken - Xero access token
   * @param {string} tenantId - Xero tenant ID
   * @returns {Promise<Object>} Organization data
   */
  async fetchOrganizations(accessToken, tenantId) {
    try {
      const response = await axios.get(`https://api.xero.com/api.xro/2.0/Organisation`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Xero-tenant-id': tenantId,
          'Accept': 'application/json'
        }
      });
      
      const organizations = response.data.Organisations || [];
      return organizations.length > 0 ? organizations[0] : null;
      
    } catch (error) {
      console.error('❌ Error fetching organizations:', error);
      throw new Error(`Failed to fetch organizations: ${error.message}`);
    }
  }
  
  /**
   * Fetch BAS/GST report from Xero
   * @param {string} accessToken - Xero access token
   * @param {string} tenantId - Xero tenant ID
   * @param {Object} params - Report parameters
   * @returns {Promise<Object>} BAS report data
   */
  async fetchBASReport(accessToken, tenantId, params = {}) {
    try {
      const { fromDate, toDate } = params;
      
      // Use Xero's Reports API for GST/BAS
      const response = await axios.get(`https://api.xero.com/api.xro/2.0/Reports/GSTReport`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Xero-tenant-id': tenantId,
          'Accept': 'application/json'
        },
        params: {
          fromDate: fromDate || this.getCurrentQuarterStart(),
          toDate: toDate || this.getCurrentQuarterEnd()
        }
      });
      
      return response.data.Reports || [];
      
    } catch (error) {
      console.error('❌ Error fetching BAS report:', error);
      
      // Fallback: try to get data from transactions if reports fail
      console.log('🔄 Falling back to transaction-based BAS calculation...');
      return await this.calculateBASFromTransactions(accessToken, tenantId, params);
    }
  }
  
  /**
   * Fetch GST report (same as BAS in Australia)
   * @param {string} accessToken - Xero access token
   * @param {string} tenantId - Xero tenant ID
   * @param {Object} params - Report parameters
   * @returns {Promise<Object>} GST report data
   */
  async fetchGSTReport(accessToken, tenantId, params = {}) {
    return await this.fetchBASReport(accessToken, tenantId, params);
  }
  
  /**
   * Calculate BAS from transactions (fallback method)
   * @param {string} accessToken - Xero access token
   * @param {string} tenantId - Xero tenant ID
   * @param {Object} params - Report parameters
   * @returns {Promise<Object>} Calculated BAS data
   */
  async calculateBASFromTransactions(accessToken, tenantId, params = {}) {
    try {
      const { fromDate, toDate } = params;
      const startDate = fromDate || this.getCurrentQuarterStart();
      const endDate = toDate || this.getCurrentQuarterEnd();
      
      // Get invoices and bills for the period
      const [invoices, bills] = await Promise.all([
        this.fetchInvoices(accessToken, tenantId, {
          where: `Date >= DateTime(${startDate}) AND Date <= DateTime(${endDate})`,
          statuses: 'AUTHORISED,PAID'
        }),
        this.fetchBills(accessToken, tenantId, {
          where: `Date >= DateTime(${startDate}) AND Date <= DateTime(${endDate})`,
          statuses: 'AUTHORISED,PAID'
        })
      ]);
      
      // Calculate GST components
      const basData = this.calculateGSTComponents(invoices, bills);
      
      return [{
        ReportName: 'GST Report (Calculated)',
        ReportDate: new Date().toISOString().split('T')[0],
        ReportID: 'calculated-bas',
        ...basData
      }];
      
    } catch (error) {
      console.error('❌ Error calculating BAS from transactions:', error);
      throw error;
    }
  }
  
  /**
   * Fetch invoices from Xero
   * @param {string} accessToken - Xero access token
   * @param {string} tenantId - Xero tenant ID
   * @param {Object} filters - Filter parameters
   * @returns {Promise<Array>} Invoice data
   */
  async fetchInvoices(accessToken, tenantId, filters = {}) {
    try {
      const params = {
        page: filters.page || 1,
        order: filters.order || 'Date DESC'
      };
      
      if (filters.where) params.where = filters.where;
      if (filters.statuses) params.statuses = filters.statuses;
      if (filters.contactIDs) params.contactIDs = filters.contactIDs;
      
      const response = await axios.get(`https://api.xero.com/api.xro/2.0/Invoices`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Xero-tenant-id': tenantId,
          'Accept': 'application/json'
        },
        params
      });
      
      return response.data.Invoices || [];
      
    } catch (error) {
      console.error('❌ Error fetching invoices:', error);
      throw error;
    }
  }
  
  /**
   * Fetch bills from Xero
   * @param {string} accessToken - Xero access token
   * @param {string} tenantId - Xero tenant ID
   * @param {Object} filters - Filter parameters
   * @returns {Promise<Array>} Bill data
   */
  async fetchBills(accessToken, tenantId, filters = {}) {
    try {
      const params = {
        page: filters.page || 1,
        order: filters.order || 'Date DESC'
      };
      
      if (filters.where) params.where = filters.where;
      if (filters.statuses) params.statuses = filters.statuses;
      if (filters.contactIDs) params.contactIDs = filters.contactIDs;
      
      const response = await axios.get(`https://api.xero.com/api.xro/2.0/Bills`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Xero-tenant-id': tenantId,
          'Accept': 'application/json'
        },
        params
      });
      
      return response.data.Bills || [];
      
    } catch (error) {
      console.error('❌ Error fetching bills:', error);
      throw error;
    }
  }
  
  /**
   * Fetch contacts from Xero
   * @param {string} accessToken - Xero access token
   * @param {string} tenantId - Xero tenant ID
   * @param {Object} filters - Filter parameters
   * @returns {Promise<Array>} Contact data
   */
  async fetchContacts(accessToken, tenantId, filters = {}) {
    try {
      const params = {};
      
      if (filters.page) params.page = filters.page;
      if (filters.order) params.order = filters.order;
      if (filters.where) params.where = filters.where;
      if (filters.includeArchived) params.includeArchived = filters.includeArchived;
      
      const response = await axios.get(`https://api.xero.com/api.xro/2.0/Contacts`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Xero-tenant-id': tenantId,
          'Accept': 'application/json'
        },
        params
      });
      
      return response.data.Contacts || [];
      
    } catch (error) {
      console.error('❌ Error fetching contacts:', error);
      throw error;
    }
  }
  
  /**
   * Fetch accounts from Xero
   * @param {string} accessToken - Xero access token
   * @param {string} tenantId - Xero tenant ID
   * @returns {Promise<Array>} Account data
   */
  async fetchAccounts(accessToken, tenantId) {
    try {
      const response = await axios.get(`https://api.xero.com/api.xro/2.0/Accounts`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Xero-tenant-id': tenantId,
          'Accept': 'application/json'
        }
      });
      
      return response.data.Accounts || [];
      
    } catch (error) {
      console.error('❌ Error fetching accounts:', error);
      throw error;
    }
  }
  
  /**
   * Fetch bank transactions from Xero
   * @param {string} accessToken - Xero access token
   * @param {string} tenantId - Xero tenant ID
   * @param {Object} filters - Filter parameters
   * @returns {Promise<Array>} Bank transaction data
   */
  async fetchBankTransactions(accessToken, tenantId, filters = {}) {
    try {
      const params = {
        page: filters.page || 1,
        order: filters.order || 'Date DESC'
      };
      
      if (filters.where) params.where = filters.where;
      if (filters.fromDate) params.fromDate = filters.fromDate;
      if (filters.toDate) params.toDate = filters.toDate;
      
      const response = await axios.get(`https://api.xero.com/api.xro/2.0/BankTransactions`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Xero-tenant-id': tenantId,
          'Accept': 'application/json'
        },
        params
      });
      
      return response.data.BankTransactions || [];
      
    } catch (error) {
      console.error('❌ Error fetching bank transactions:', error);
      throw error;
    }
  }
  
  /**
   * Fetch balance sheet from Xero
   * @param {string} accessToken - Xero access token
   * @param {string} tenantId - Xero tenant ID
   * @param {string} date - Balance sheet date
   * @returns {Promise<Object>} Balance sheet data
   */
  async fetchBalanceSheet(accessToken, tenantId, date = null) {
    try {
      const params = date ? { date } : {};
      
      const response = await axios.get(`https://api.xero.com/api.xro/2.0/Reports/BalanceSheet`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Xero-tenant-id': tenantId,
          'Accept': 'application/json'
        },
        params
      });
      
      return response.data.Reports || [];
      
    } catch (error) {
      console.error('❌ Error fetching balance sheet:', error);
      throw error;
    }
  }
  
  /**
   * Fetch profit and loss from Xero
   * @param {string} accessToken - Xero access token
   * @param {string} tenantId - Xero tenant ID
   * @param {string} fromDate - Start date
   * @param {string} toDate - End date
   * @returns {Promise<Object>} P&L data
   */
  async fetchProfitLoss(accessToken, tenantId, fromDate = null, toDate = null) {
    try {
      const params = {};
      if (fromDate) params.fromDate = fromDate;
      if (toDate) params.toDate = toDate;
      
      const response = await axios.get(`https://api.xero.com/api.xro/2.0/Reports/ProfitAndLoss`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Xero-tenant-id': tenantId,
          'Accept': 'application/json'
        },
        params
      });
      
      return response.data.Reports || [];
      
    } catch (error) {
      console.error('❌ Error fetching profit and loss:', error);
      throw error;
    }
  }
  
  /**
   * Cache data in database
   * @param {number} companyId - Company ID
   * @param {string} tenantId - Xero tenant ID
   * @param {string} dataType - Type of data being cached
   * @param {Object} data - Data to cache
   * @param {number} expiryHours - Hours until cache expires (default: 1)
   */
  async cacheData(companyId, tenantId, dataType, data, expiryHours = 1) {
    try {
      const expiresAt = new Date(Date.now() + (expiryHours * 60 * 60 * 1000));
      
      await db.query(`
        INSERT INTO xero_data_cache (company_id, tenant_id, data_type, data, expires_at)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (company_id, tenant_id, data_type)
        DO UPDATE SET 
          data = $4,
          expires_at = $5,
          last_synced_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      `, [companyId, tenantId, dataType, JSON.stringify(data), expiresAt]);
      
      console.log(`✅ Cached ${dataType} for company ${companyId}`);
      
    } catch (error) {
      console.error('❌ Error caching data:', error);
      // Don't throw error for cache failures
    }
  }
  
  /**
   * Get cached data from database
   * @param {number} companyId - Company ID
   * @param {string} tenantId - Xero tenant ID
   * @param {string} dataType - Type of data to retrieve
   * @returns {Promise<Object|null>} Cached data or null if not found/expired
   */
  async getCachedData(companyId, tenantId, dataType) {
    try {
      const result = await db.query(`
        SELECT data, expires_at
        FROM xero_data_cache
        WHERE company_id = $1 AND tenant_id = $2 AND data_type = $3
        AND (expires_at IS NULL OR expires_at > NOW())
      `, [companyId, tenantId, dataType]);
      
      if (result.rows.length === 0) {
        return null;
      }
      
      const cachedData = result.rows[0];
      return {
        data: JSON.parse(cachedData.data),
        expiresAt: cachedData.expires_at
      };
      
    } catch (error) {
      console.error('❌ Error getting cached data:', error);
      return null;
    }
  }
  
  // Helper methods
  
  /**
   * Check if token is expired
   * @param {Date|string} expiresAt - Token expiration date
   * @returns {boolean} True if expired
   */
  isTokenExpired(expiresAt) {
    if (!expiresAt) return true;
    
    const expiryDate = new Date(expiresAt);
    const now = new Date();
    
    // Add 5 minute buffer to avoid edge cases
    expiryDate.setMinutes(expiryDate.getMinutes() - 5);
    
    return now >= expiryDate;
  }
  
  /**
   * Get current quarter start date
   * @returns {string} Date in YYYY-MM-DD format
   */
  getCurrentQuarterStart() {
    const now = new Date();
    const month = now.getMonth();
    const year = now.getFullYear();
    
    let quarterStart;
    if (month < 3) quarterStart = new Date(year, 0, 1);
    else if (month < 6) quarterStart = new Date(year, 3, 1);
    else if (month < 9) quarterStart = new Date(year, 6, 1);
    else quarterStart = new Date(year, 9, 1);
    
    return quarterStart.toISOString().split('T')[0];
  }
  
  /**
   * Get current quarter end date
   * @returns {string} Date in YYYY-MM-DD format
   */
  getCurrentQuarterEnd() {
    const now = new Date();
    const month = now.getMonth();
    const year = now.getFullYear();
    
    let quarterEnd;
    if (month < 3) quarterEnd = new Date(year, 2, 31);
    else if (month < 6) quarterEnd = new Date(year, 5, 30);
    else if (month < 9) quarterEnd = new Date(year, 8, 30);
    else quarterEnd = new Date(year, 11, 31);
    
    return quarterEnd.toISOString().split('T')[0];
  }
  
  /**
   * Calculate GST components from invoices and bills
   * @param {Array} invoices - Invoice data
   * @param {Array} bills - Bill data
   * @returns {Object} GST calculation results
   */
  calculateGSTComponents(invoices, bills) {
    let totalSales = 0;
    let totalSalesGST = 0;
    let totalPurchases = 0;
    let totalPurchasesGST = 0;
    
    // Calculate from invoices (sales)
    invoices.forEach(invoice => {
      if (invoice.Type === 'ACCREC') { // Sales invoice
        totalSales += invoice.Total || 0;
        totalSalesGST += invoice.TotalTax || 0;
      }
    });
    
    // Calculate from bills (purchases)
    bills.forEach(bill => {
      if (bill.Type === 'ACCPAY') { // Purchase bill
        totalPurchases += bill.Total || 0;
        totalPurchasesGST += bill.TotalTax || 0;
      }
    });
    
    const netGST = totalSalesGST - totalPurchasesGST;
    
    return {
      TotalSales: totalSales,
      SalesGST: totalSalesGST,
      TotalPurchases: totalPurchases,
      PurchasesGST: totalPurchasesGST,
      NetGST: netGST,
      CalculatedFromTransactions: true
    };
  }
}

module.exports = new XeroDataService();
