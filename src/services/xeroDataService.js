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

  formatDateForXero(dateString, endOfDay = false) {
    if (!dateString) return null;

    const isoMatch = typeof dateString === 'string'
      ? dateString.trim().match(/^([0-9]{4})-([0-9]{2})-([0-9]{2})$/)
      : null;

    if (isoMatch) {
      const [, yearStr, monthStr, dayStr] = isoMatch;
      const year = parseInt(yearStr, 10);
      const month = parseInt(monthStr, 10);
      const day = parseInt(dayStr, 10);

      if (!Number.isNaN(year) && !Number.isNaN(month) && !Number.isNaN(day)) {
        if (endOfDay) {
          return `DateTime(${year}, ${month}, ${day}, 23, 59, 59)`;
        }
        return `DateTime(${year}, ${month}, ${day})`;
      }
    }

    const parsed = new Date(dateString);
    if (Number.isNaN(parsed.getTime())) {
      return null;
    }

    const year = parsed.getUTCFullYear();
    const month = parsed.getUTCMonth() + 1;
    const day = parsed.getUTCDate();

    if (endOfDay) {
      return `DateTime(${year}, ${month}, ${day}, 23, 59, 59)`;
    }

    return `DateTime(${year}, ${month}, ${day})`;
  }

  escapeXeroString(value) {
    if (value === null || value === undefined) return '';
    return String(value).replace(/"/g, '\\"');
  }

  normalizeInvoiceFilters(rawFilters = {}) {
    if (!rawFilters || typeof rawFilters !== 'object') {
      return { statuses: [] };
    }

    const filters = { ...rawFilters };
    const statusSet = new Set();

    const collectStatuses = (input) => {
      if (!input) return;
      if (Array.isArray(input)) {
        input.forEach(collectStatuses);
        return;
      }

      const normalized = String(input)
        .split(',')
        .map((val) => val.trim())
        .filter((val) => val.length > 0);

      normalized.forEach((val) => statusSet.add(val.toUpperCase()));
    };

    collectStatuses(filters.status);
    collectStatuses(filters.statuses);
    collectStatuses(filters.statusFilter);

    delete filters.status;
    delete filters.statuses;
    delete filters.statusFilter;

    const toNumber = (value) => {
      if (value === null || value === undefined || value === '') return undefined;
      const num = Number(value);
      return Number.isFinite(num) ? num : undefined;
    };

    const parseBooleanFlag = (value) => {
      if (typeof value === 'boolean') return value;
      if (typeof value === 'string') {
        return ['true', '1', 'yes', 'on'].includes(value.trim().toLowerCase());
      }
      return false;
    };

    const toArray = (value) => {
      if (!value) return undefined;
      if (Array.isArray(value)) {
        const arr = value.map((item) => String(item).trim()).filter((item) => item.length > 0);
        return arr.length > 0 ? arr : undefined;
      }
      if (typeof value === 'string') {
        const arr = value.split(',').map((item) => item.trim()).filter((item) => item.length > 0);
        return arr.length > 0 ? arr : undefined;
      }
      return undefined;
    };

    const normalizeString = (value) => {
      if (typeof value !== 'string') return undefined;
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : undefined;
    };

    const normalized = {
      statuses: Array.from(statusSet),
      contactId: normalizeString(filters.contactId || filters.contactID || filters.contact_id),
      contactIds: toArray(filters.contactIds || filters.contact_ids),
      contactName: normalizeString(filters.contactName || filters.contact_name),
      invoiceNumber: normalizeString(filters.invoiceNumber || filters.number || filters.invoice_number),
      reference: normalizeString(filters.reference || filters.referenceNumber || filters.ref),
      minTotal: toNumber(filters.minTotal || filters.totalMin || filters.amountMin),
      maxTotal: toNumber(filters.maxTotal || filters.totalMax || filters.amountMax),
      overdueOnly: parseBooleanFlag(filters.overdueOnly || filters.overdue || filters.isOverdue),
      type: normalizeString(filters.type || filters.invoiceType),
      search: normalizeString(filters.search || filters.searchTerm || filters.query),
      dueDateFrom: normalizeString(filters.dueDateFrom || filters.due_date_from),
      dueDateTo: normalizeString(filters.dueDateTo || filters.due_date_to),
      updatedSince: normalizeString(filters.updatedSince || filters.updated_since)
    };

    Object.keys(normalized).forEach((key) => {
      if (
        normalized[key] === undefined ||
        normalized[key] === null ||
        (typeof normalized[key] === 'string' && normalized[key].length === 0)
      ) {
        delete normalized[key];
      }
    });

    return normalized;
  }

  combineStatusFilters(statusParam, statusesFromFilters = []) {
    const statusSet = new Set();

    const addStatus = (value) => {
      if (!value) return;
      if (Array.isArray(value)) {
        value.forEach(addStatus);
        return;
      }

      String(value)
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item.length > 0)
        .forEach((item) => statusSet.add(item.toUpperCase()));
    };

    addStatus(statusParam);
    addStatus(statusesFromFilters);

    return Array.from(statusSet);
  }

  hasInvoiceFilters({ fromDate, toDate, statuses, sort, filters }) {
    if (fromDate || toDate || sort) {
      return true;
    }

    if (Array.isArray(statuses) && statuses.length > 0) {
      return true;
    }

    if (!filters) {
      return false;
    }

    return Object.keys(filters).some((key) => {
      const value = filters[key];
      if (value === undefined || value === null) return false;
      if (typeof value === 'string' && value.trim().length === 0) return false;
      if (Array.isArray(value) && value.length === 0) return false;
      if (typeof value === 'boolean') return value; // only true flags remain after normalization
      return true;
    });
  }

  resolvePageSize(pageSize) {
    const parsed = parseInt(pageSize, 10);
    if (Number.isNaN(parsed) || parsed <= 0) {
      return 100;
    }
    return Math.min(parsed, 100);
  }

  buildOrderParam(sort) {
    if (!sort || typeof sort !== 'string') {
      return undefined;
    }

    const [fieldRaw, directionRaw] = sort.split(':');
    const field = fieldRaw ? fieldRaw.trim() : '';
    const direction = directionRaw ? directionRaw.trim().toUpperCase() : 'ASC';

    if (!field) {
      return undefined;
    }

    const normalizedDirection = ['ASC', 'DESC'].includes(direction) ? direction : 'ASC';
    return `${field} ${normalizedDirection}`;
  }

  applyLocalInvoiceFilters(invoices, filters = {}) {
    if (!Array.isArray(invoices) || invoices.length === 0 || !filters) {
      return invoices;
    }

    const {
      search,
      minTotal,
      maxTotal
    } = filters;

    const hasSearch = typeof search === 'string' && search.length > 0;
    const hasMin = typeof minTotal === 'number';
    const hasMax = typeof maxTotal === 'number';

    if (!hasSearch && !hasMin && !hasMax) {
      return invoices;
    }

    const normalizedSearch = hasSearch ? search.toLowerCase() : null;

    return invoices.filter((invoice) => {
      if (hasMin && Number(invoice.Total) < minTotal) {
        return false;
      }

      if (hasMax && Number(invoice.Total) > maxTotal) {
        return false;
      }

      if (normalizedSearch) {
        const haystack = [
          invoice.InvoiceNumber,
          invoice.Reference,
          invoice.Type,
          invoice.Status,
          invoice.Contact?.Name,
          invoice.Contact?.EmailAddress
        ]
          .map((value) => (value ? String(value).toLowerCase() : ''))
          .join(' ');

        if (!haystack.includes(normalizedSearch)) {
          return false;
        }
      }

      return true;
    });
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
   * Fetch all pages for a Xero collection endpoint
   * @param {string} endpoint - API endpoint
   * @param {string} accessToken - Access token
   * @param {string} tenantId - Tenant ID
   * @param {Object} params - Query parameters (without page)
   * @param {Object} options - Additional options ({ resultKey, pageSize, maxPages, companyId })
   * @returns {Promise<Object>} Aggregated API response
   */
  async fetchAllPages(endpoint, accessToken, tenantId, params = {}, options = {}) {
    const {
      companyId,
      resultKey,
      pageSize = 100,
      maxPages = 500,
      logLabel = endpoint
    } = options;

    if (!resultKey) {
      console.warn(`⚠️  fetchAllPages called without resultKey for ${endpoint}. Falling back to single-page fetch.`);
      return this.fetchFromXero(endpoint, accessToken, tenantId, params, { companyId });
    }

    const baseParams = { ...params };
    let currentPage = 1;
    if (baseParams.page) {
      const parsedPage = parseInt(baseParams.page, 10);
      if (!Number.isNaN(parsedPage) && parsedPage > 0) {
        currentPage = parsedPage;
      }
      delete baseParams.page;
    }

    let aggregatedResponse = null;
    const combinedItems = [];
    let pagesFetched = 0;

    while (pagesFetched < maxPages) {
      const pageParams = { ...baseParams, page: currentPage };
      if (!pageParams.pageSize) {
        pageParams.pageSize = pageSize;
      }
      const pageData = await this.fetchFromXero(endpoint, accessToken, tenantId, pageParams, { companyId });
      const items = Array.isArray(pageData?.[resultKey]) ? pageData[resultKey] : [];

      if (!aggregatedResponse) {
        aggregatedResponse = { ...pageData };
      }

      const batchCount = items.length;
      if (batchCount === 0) {
        console.log(`ℹ️  ${logLabel} returned no data on page ${currentPage}. Stopping pagination.`);
        break;
      }

      combinedItems.push(...items);
      pagesFetched += 1;

      if (batchCount < pageSize) {
        console.log(`✅ Completed pagination for ${logLabel}. Pages fetched: ${pagesFetched}, total records: ${combinedItems.length}`);
        break;
      }

      currentPage += 1;

      if (pagesFetched === maxPages) {
        console.warn(`⚠️  Reached maxPages (${maxPages}) while fetching ${logLabel}. Results may be truncated.`);
      }
    }

    if (!aggregatedResponse) {
      aggregatedResponse = {};
    }

    aggregatedResponse[resultKey] = combinedItems;
    aggregatedResponse.pagination = {
      pagesFetched,
      itemCount: combinedItems.length,
      pageSize
    };

    return aggregatedResponse;
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
      const {
        useCache = true,
        fromDate,
        toDate,
        status,
        filters: rawFilters = {},
        sort,
        pageSize
      } = options;

      const normalizedFilters = this.normalizeInvoiceFilters(rawFilters);
      const { statuses: filterStatuses = [], ...otherFilters } = normalizedFilters;
      const statusFilters = this.combineStatusFilters(status, filterStatuses);
      const orderParam = this.buildOrderParam(sort || otherFilters.sort);
      delete otherFilters.sort;

      const shouldUseCache = useCache && !this.hasInvoiceFilters({
        fromDate,
        toDate,
        statuses: statusFilters,
        sort: orderParam,
        filters: otherFilters
      });

      // Check cache first (only for unfiltered/default requests)
      if (shouldUseCache) {
        const cachedData = await this.getCachedData(companyId, tenantId, 'invoices');
        if (cachedData) {
          return cachedData;
        }
      }

      const accessToken = await xeroAuthService.getValidAccessToken(companyId);

      const params = {};
      const whereClauses = [];

      if (fromDate) {
        const formatted = this.formatDateForXero(fromDate);
        if (formatted) {
          whereClauses.push(`Date >= ${formatted}`);
        }
      }

      if (toDate) {
        const formatted = this.formatDateForXero(toDate, true);
        if (formatted) {
          whereClauses.push(`Date <= ${formatted}`);
        }
      }

      if (otherFilters.dueDateFrom) {
        const formatted = this.formatDateForXero(otherFilters.dueDateFrom);
        if (formatted) {
          whereClauses.push(`DueDate >= ${formatted}`);
        }
        delete otherFilters.dueDateFrom;
      }

      if (otherFilters.dueDateTo) {
        const formatted = this.formatDateForXero(otherFilters.dueDateTo, true);
        if (formatted) {
          whereClauses.push(`DueDate <= ${formatted}`);
        }
        delete otherFilters.dueDateTo;
      }

      if (Array.isArray(statusFilters) && statusFilters.length > 0) {
        const statusClause = statusFilters
          .map((code) => `Status=="${this.escapeXeroString(code)}"`)
          .join(' OR ');
        whereClauses.push(`(${statusClause})`);
      }

      if (otherFilters.type) {
        whereClauses.push(`Type=="${this.escapeXeroString(otherFilters.type)}"`);
        delete otherFilters.type;
      }

      if (otherFilters.overdueOnly) {
        whereClauses.push('IsOverdue==true');
        delete otherFilters.overdueOnly;
      }

      if (otherFilters.contactId) {
        whereClauses.push(`Contact.ContactID==Guid("${this.escapeXeroString(otherFilters.contactId)}")`);
        delete otherFilters.contactId;
      }

      if (Array.isArray(otherFilters.contactIds) && otherFilters.contactIds.length > 0) {
        const contactClause = otherFilters.contactIds
          .map((id) => `Contact.ContactID==Guid("${this.escapeXeroString(id)}")`)
          .join(' OR ');
        whereClauses.push(`(${contactClause})`);
        delete otherFilters.contactIds;
      }

      if (otherFilters.contactName) {
        whereClauses.push(`Contact.Name.Contains("${this.escapeXeroString(otherFilters.contactName)}")`);
        delete otherFilters.contactName;
      }

      if (otherFilters.invoiceNumber) {
        whereClauses.push(`InvoiceNumber=="${this.escapeXeroString(otherFilters.invoiceNumber)}"`);
        delete otherFilters.invoiceNumber;
      }

      if (otherFilters.reference) {
        whereClauses.push(`Reference.Contains("${this.escapeXeroString(otherFilters.reference)}")`);
        delete otherFilters.reference;
      }

      if (typeof otherFilters.minTotal === 'number') {
        whereClauses.push(`Total>=${otherFilters.minTotal}`);
      }

      if (typeof otherFilters.maxTotal === 'number') {
        whereClauses.push(`Total<=${otherFilters.maxTotal}`);
      }

      const localFilterPayload = {
        search: otherFilters.search,
        minTotal: otherFilters.minTotal,
        maxTotal: otherFilters.maxTotal
      };

      delete otherFilters.search;
      delete otherFilters.minTotal;
      delete otherFilters.maxTotal;

      if (whereClauses.length > 0) {
        params.where = whereClauses.join(' AND ');
      }

      if (orderParam) {
        params.order = orderParam;
      }

      const effectivePageSize = this.resolvePageSize(pageSize);

      const data = await this.fetchAllPages(
        '/api.xro/2.0/Invoices',
        accessToken,
        tenantId,
        params,
        {
          companyId,
          resultKey: 'Invoices',
          logLabel: 'Invoices',
          pageSize: effectivePageSize
        }
      );

      const invoices = Array.isArray(data?.Invoices) ? data.Invoices : [];
      const filteredInvoices = this.applyLocalInvoiceFilters(invoices, localFilterPayload);

      if (filteredInvoices !== invoices) {
        data.Invoices = filteredInvoices;
      }

      if (!data.pagination) {
        data.pagination = {};
      }

      data.pagination.itemCount = filteredInvoices.length;
      data.pagination.pageSize = effectivePageSize;

      if (shouldUseCache) {
        await this.cacheData(companyId, tenantId, 'invoices', data, 15); // 15 minutes
      }

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

      // Fetch all pages from Xero
      const data = await this.fetchAllPages(
        '/api.xro/2.0/Contacts',
        accessToken,
        tenantId,
        params,
        {
          companyId,
          resultKey: 'Contacts',
          logLabel: 'Contacts'
        }
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
          console.log('✅ Returning cached BAS data');
          return cachedData;
        }
      }

      // Get valid access token
      const accessToken = await xeroAuthService.getValidAccessToken(companyId);

      console.log(`📊 Fetching BAS data from multiple Xero reports for period ${fromDate} to ${toDate}`);

      // BAS data needs to be compiled from multiple Xero endpoints
      // Xero doesn't have a direct BAS report endpoint, so we need to aggregate data

      const gstParams = {};
      if (fromDate) gstParams.fromDate = fromDate;
      if (toDate) gstParams.toDate = toDate;

      const profitLossParams = {};
      if (fromDate) profitLossParams.fromDate = fromDate;
      if (toDate) profitLossParams.toDate = toDate;

      const balanceSheetParams = { periods: '1' };
      if (toDate) {
        balanceSheetParams.date = toDate;
      } else if (fromDate) {
        balanceSheetParams.date = fromDate;
      }

      let gstReport = null;
      try {
        gstReport = await this.fetchFromXero(
          '/api.xro/2.0/Reports/TaxSummary',
          accessToken,
          tenantId,
          gstParams,
          { companyId }
        );
      } catch (error) {
        console.warn('⚠️  Could not fetch GST/Tax Summary report:', error.message);
      }

      // 2. Get Profit & Loss (for business activity summary)
      let profitLoss = null;
      try {
        profitLoss = await this.fetchFromXero(
          '/api.xro/2.0/Reports/ProfitAndLoss',
          accessToken,
          tenantId,
          profitLossParams,
          { companyId }
        );
      } catch (error) {
        console.warn('⚠️  Could not fetch Profit & Loss report:', error.message);
      }

      // 3. Get Balance Sheet (for balance sheet context)
      let balanceSheet = null;
      try {
        balanceSheet = await this.fetchFromXero(
          '/api.xro/2.0/Reports/BalanceSheet',
          accessToken,
          tenantId,
          balanceSheetParams,
          { companyId }
        );
      } catch (error) {
        console.warn('⚠️  Could not fetch Balance Sheet report:', error.message);
      }

      // 4. Get Invoices for the period (for detailed transaction data)
      let invoices = null;
      try {
        const invoiceParams = {
          where: `Status!="DRAFT" AND Status!="DELETED"`,
          order: 'Date DESC'
        };
        if (fromDate) invoiceParams.where += ` AND Date>="${fromDate}"`;
        if (toDate) invoiceParams.where += ` AND Date<="${toDate}"`;

        invoices = await this.fetchAllPages(
          '/api.xro/2.0/Invoices',
          accessToken,
          tenantId,
          invoiceParams,
          {
            companyId,
            resultKey: 'Invoices',
            logLabel: 'Invoices for BAS data'
          }
        );
      } catch (error) {
        console.warn('⚠️  Could not fetch Invoices:', error.message);
      }

      // Compile BAS data from fetched reports
      const basData = {
        period: {
          fromDate,
          toDate
        },
        gstReport,
        profitLoss,
        balanceSheet,
        invoices,
        metadata: {
          fetchedAt: new Date().toISOString(),
          tenantId,
          companyId
        }
      };

      // Cache the result
      await this.cacheData(companyId, tenantId, 'bas_data', basData, 60); // 1 hour

      console.log('✅ BAS data compiled successfully from multiple reports');
      return basData;

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
          console.log('✅ Returning cached FAS data');
          return cachedData;
        }
      }

      // Get valid access token
      const accessToken = await xeroAuthService.getValidAccessToken(companyId);

      console.log(`📊 Fetching FAS data from multiple Xero reports for period ${fromDate} to ${toDate}`);

      // FAS (Fringe Benefits Tax) data needs to be compiled from multiple Xero endpoints
      // Xero doesn't have a direct FAS report endpoint, so we need to aggregate data

      const fbtParams = {};
      if (fromDate) fbtParams.fromDate = fromDate;
      if (toDate) fbtParams.toDate = toDate;

      const profitLossParams = {};
      if (fromDate) profitLossParams.fromDate = fromDate;
      if (toDate) profitLossParams.toDate = toDate;

      const balanceSheetParams = { periods: '1' };
      if (toDate) {
        balanceSheetParams.date = toDate;
      } else if (fromDate) {
        balanceSheetParams.date = fromDate;
      }

      let payrollSummary = null;
      try {
        payrollSummary = await this.fetchFromXero(
          '/api.xro/2.0/Reports/PayrollSummary',
          accessToken,
          tenantId,
          fbtParams,
          { companyId }
        );
      } catch (error) {
        console.warn('⚠️  Could not fetch Payroll Summary report:', error.message);
      }

      // 2. Get Profit & Loss (for business activity summary)
      let profitLoss = null;
      try {
        profitLoss = await this.fetchFromXero(
          '/api.xro/2.0/Reports/ProfitAndLoss',
          accessToken,
          tenantId,
          profitLossParams,
          { companyId }
        );
      } catch (error) {
        console.warn('⚠️  Could not fetch Profit & Loss report:', error.message);
      }

      // 3. Get Balance Sheet (for balance sheet context)
      let balanceSheet = null;
      try {
        balanceSheet = await this.fetchFromXero(
          '/api.xro/2.0/Reports/BalanceSheet',
          accessToken,
          tenantId,
          balanceSheetParams,
          { companyId }
        );
      } catch (error) {
        console.warn('⚠️  Could not fetch Balance Sheet report:', error.message);
      }

      // 4. Get Bank Transactions for the period (for detailed FBT-related transactions)
      let bankTransactions = null;
      try {
        const bankParams = {
          where: `Status!="DELETED"`,
          order: 'Date DESC'
        };
        if (fromDate) bankParams.where += ` AND Date>="${fromDate}"`;
        if (toDate) bankParams.where += ` AND Date<="${toDate}"`;

        bankTransactions = await this.fetchAllPages(
          '/api.xro/2.0/BankTransactions',
          accessToken,
          tenantId,
          bankParams,
          {
            companyId,
            resultKey: 'BankTransactions',
            logLabel: 'Bank Transactions for FAS data'
          }
        );
      } catch (error) {
        console.warn('⚠️  Could not fetch Bank Transactions:', error.message);
      }

      // 5. Get Accounts (for FBT liability accounts)
      let accounts = null;
      try {
        accounts = await this.fetchAllPages(
          '/api.xro/2.0/Accounts',
          accessToken,
          tenantId,
          { where: `Type=="LIABILITY" OR Type=="EXPENSE"` },
          {
            companyId,
            resultKey: 'Accounts',
            logLabel: 'Accounts for FAS data'
          }
        );
      } catch (error) {
        console.warn('⚠️  Could not fetch Accounts:', error.message);
      }

      // Compile FAS data from fetched reports
      const fasData = {
        period: {
          fromDate,
          toDate
        },
        payrollSummary,
        profitLoss,
        balanceSheet,
        bankTransactions,
        accounts,
        metadata: {
          fetchedAt: new Date().toISOString(),
          tenantId,
          companyId,
          note: 'FAS data compiled from multiple Xero reports as Xero does not provide a direct FAS endpoint'
        }
      };

      // Cache the result
      await this.cacheData(companyId, tenantId, 'fas_data', fasData, 60); // 1 hour

      console.log('✅ FAS data compiled successfully from multiple reports');
      return fasData;

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
        '/api.xro/2.0/Reports/ProfitAndLoss',
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
        this.fetchAllPages('/api.xro/2.0/Invoices', accessToken, tenantId, {}, { ...fetchOptions, resultKey: 'Invoices', logLabel: 'Invoices for dashboard' }),
        this.fetchAllPages('/api.xro/2.0/Contacts', accessToken, tenantId, {}, { ...noRetryOptions, resultKey: 'Contacts', logLabel: 'Contacts for dashboard' }),
        this.fetchFromXero('/api.xro/2.0/Reports/ProfitAndLoss', accessToken, tenantId, {}, noRetryOptions)
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
