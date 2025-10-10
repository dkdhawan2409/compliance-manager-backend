const xeroDataService = require('../services/xeroDataService');
const xeroSyncService = require('../services/xeroSyncService');

/**
 * FAS Controller - Handles FAS (Fringe Benefits Statement) data operations
 * Provides endpoints for fetching, syncing, and managing FAS data from Xero
 */
class FASController {
  
  /**
   * Get FAS data for a company
   * GET /api/xero/fas-data
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getFASData(req, res) {
    try {
      const companyId = req.company.id;
      const { fromDate, toDate, useCache = true } = req.query;
      
      console.log(`📊 Getting FAS data for company ${companyId}`);
      
      // Get valid Xero token
      const token = await xeroDataService.getValidToken(companyId);
      
      // Check cache first if requested
      let fasData = null;
      if (useCache === 'true') {
        const cachedData = await xeroDataService.getCachedData(companyId, token.tenantId, 'fas_data');
        if (cachedData) {
          console.log('✅ Using cached FAS data');
          return res.json({
            success: true,
            data: cachedData.data,
            cached: true,
            cachedAt: cachedData.expiresAt,
            message: 'FAS data retrieved from cache'
          });
        }
      }
      
      // Fetch fresh data from Xero (FAS is typically calculated from employee benefits)
      console.log('🔄 Fetching FAS data from Xero...');
      fasData = await this.fetchFASDataFromXero(token.accessToken, token.tenantId, {
        fromDate,
        toDate
      });
      
      // Cache the data for future requests
      await xeroDataService.cacheData(companyId, token.tenantId, 'fas_data', fasData, 2); // Cache for 2 hours
      
      res.json({
        success: true,
        data: fasData,
        cached: false,
        message: 'FAS data fetched from Xero successfully'
      });
      
    } catch (error) {
      console.error('❌ Error getting FAS data:', error);
      
      // Handle specific Xero API errors
      if (error.message.includes('Token refresh failed')) {
        return res.status(401).json({
          success: false,
          error: 'XERO_TOKEN_EXPIRED',
          message: 'Xero connection expired. Please reconnect to Xero.',
          requiresReconnection: true
        });
      }
      
      if (error.message.includes('No Xero token found')) {
        return res.status(400).json({
          success: false,
          error: 'XERO_NOT_CONFIGURED',
          message: 'Xero is not configured. Please connect to Xero first.',
          requiresConfiguration: true
        });
      }
      
      res.status(500).json({
        success: false,
        error: 'FAS_DATA_FETCH_FAILED',
        message: error.message
      });
    }
  }
  
  /**
   * Get current period FAS data
   * GET /api/xero/fas-data/current
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getCurrentFASData(req, res) {
    try {
      const companyId = req.company.id;
      
      console.log(`📊 Getting current FAS data for company ${companyId}`);
      
      // Get valid Xero token
      const token = await xeroDataService.getValidToken(companyId);
      
      // Check cache first
      const cachedData = await xeroDataService.getCachedData(companyId, token.tenantId, 'fas_current');
      if (cachedData) {
        console.log('✅ Using cached current FAS data');
        return res.json({
          success: true,
          data: cachedData.data,
          cached: true,
          cachedAt: cachedData.expiresAt,
          period: {
            fromDate: xeroDataService.getCurrentQuarterStart(),
            toDate: xeroDataService.getCurrentQuarterEnd()
          },
          message: 'Current FAS data retrieved from cache'
        });
      }
      
      // Fetch current period data from Xero
      console.log('🔄 Fetching current FAS data from Xero...');
      const fasData = await this.fetchFASDataFromXero(token.accessToken, token.tenantId, {
        fromDate: xeroDataService.getCurrentQuarterStart(),
        toDate: xeroDataService.getCurrentQuarterEnd()
      });
      
      // Cache the data
      await xeroDataService.cacheData(companyId, token.tenantId, 'fas_current', fasData, 2);
      
      res.json({
        success: true,
        data: fasData,
        cached: false,
        period: {
          fromDate: xeroDataService.getCurrentQuarterStart(),
          toDate: xeroDataService.getCurrentQuarterEnd()
        },
        message: 'Current FAS data fetched from Xero successfully'
      });
      
    } catch (error) {
      console.error('❌ Error getting current FAS data:', error);
      
      if (error.message.includes('Token refresh failed')) {
        return res.status(401).json({
          success: false,
          error: 'XERO_TOKEN_EXPIRED',
          message: 'Xero connection expired. Please reconnect to Xero.',
          requiresReconnection: true
        });
      }
      
      if (error.message.includes('No Xero token found')) {
        return res.status(400).json({
          success: false,
          error: 'XERO_NOT_CONFIGURED',
          message: 'Xero is not configured. Please connect to Xero first.',
          requiresConfiguration: true
        });
      }
      
      res.status(500).json({
        success: false,
        error: 'CURRENT_FAS_DATA_FETCH_FAILED',
        message: error.message
      });
    }
  }
  
  /**
   * Sync FAS data manually
   * POST /api/xero/sync/fas
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async syncFASData(req, res) {
    try {
      const companyId = req.company.id;
      const { fromDate, toDate } = req.body;
      
      console.log(`🔄 Manual FAS sync for company ${companyId}`);
      
      // Perform sync
      const syncResult = await xeroSyncService.syncDataType(companyId, 'fas_data', {
        fromDate,
        toDate
      });
      
      res.json({
        success: true,
        message: 'FAS data synced successfully',
        syncResult
      });
      
    } catch (error) {
      console.error('❌ Error syncing FAS data:', error);
      
      if (error.message.includes('Token refresh failed')) {
        return res.status(401).json({
          success: false,
          error: 'XERO_TOKEN_EXPIRED',
          message: 'Xero connection expired. Please reconnect to Xero.',
          requiresReconnection: true
        });
      }
      
      if (error.message.includes('No Xero token found')) {
        return res.status(400).json({
          success: false,
          error: 'XERO_NOT_CONFIGURED',
          message: 'Xero is not configured. Please connect to Xero first.',
          requiresConfiguration: true
        });
      }
      
      res.status(500).json({
        success: false,
        error: 'FAS_SYNC_FAILED',
        message: error.message
      });
    }
  }
  
  /**
   * Get FAS data summary for dashboard
   * GET /api/xero/fas-data/summary
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getFASSummary(req, res) {
    try {
      const companyId = req.company.id;
      
      console.log(`📊 Getting FAS summary for company ${companyId}`);
      
      // Get valid Xero token
      const token = await xeroDataService.getValidToken(companyId);
      
      // Get current FAS data
      const fasData = await this.fetchFASDataFromXero(token.accessToken, token.tenantId, {
        fromDate: xeroDataService.getCurrentQuarterStart(),
        toDate: xeroDataService.getCurrentQuarterEnd()
      });
      
      // Process FAS data into summary format
      const summary = this.processFASSummary(fasData);
      
      res.json({
        success: true,
        data: summary,
        period: {
          fromDate: xeroDataService.getCurrentQuarterStart(),
          toDate: xeroDataService.getCurrentQuarterEnd()
        },
        message: 'FAS summary generated successfully'
      });
      
    } catch (error) {
      console.error('❌ Error getting FAS summary:', error);
      
      if (error.message.includes('Token refresh failed')) {
        return res.status(401).json({
          success: false,
          error: 'XERO_TOKEN_EXPIRED',
          message: 'Xero connection expired. Please reconnect to Xero.',
          requiresReconnection: true
        });
      }
      
      if (error.message.includes('No Xero token found')) {
        return res.status(400).json({
          success: false,
          error: 'XERO_NOT_CONFIGURED',
          message: 'Xero is not configured. Please connect to Xero first.',
          requiresConfiguration: true
        });
      }
      
      res.status(500).json({
        success: false,
        error: 'FAS_SUMMARY_FETCH_FAILED',
        message: error.message
      });
    }
  }
  
  /**
   * Get FAS calculation details
   * GET /api/xero/fas-data/calculation
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getFASCalculation(req, res) {
    try {
      const companyId = req.company.id;
      const { fromDate, toDate } = req.query;
      
      console.log(`🧮 Getting FAS calculation for company ${companyId}`);
      
      // Get valid Xero token
      const token = await xeroDataService.getValidToken(companyId);
      
      // Get employee-related transactions for the period
      const [bills, bankTransactions] = await Promise.all([
        xeroDataService.fetchBills(token.accessToken, token.tenantId, {
          where: `Date >= DateTime(${fromDate || xeroDataService.getCurrentQuarterStart()}) AND Date <= DateTime(${toDate || xeroDataService.getCurrentQuarterEnd()})`,
          statuses: 'AUTHORISED,PAID'
        }),
        xeroDataService.fetchBankTransactions(token.accessToken, token.tenantId, {
          fromDate: fromDate || xeroDataService.getCurrentQuarterStart(),
          toDate: toDate || xeroDataService.getCurrentQuarterEnd()
        })
      ]);
      
      // Calculate FAS components from employee benefits
      const calculation = this.calculateFASComponents(bills, bankTransactions);
      
      res.json({
        success: true,
        data: {
          calculation,
          period: {
            fromDate: fromDate || xeroDataService.getCurrentQuarterStart(),
            toDate: toDate || xeroDataService.getCurrentQuarterEnd()
          },
          sourceData: {
            bills: bills.length,
            bankTransactions: bankTransactions.length
          }
        },
        message: 'FAS calculation completed successfully'
      });
      
    } catch (error) {
      console.error('❌ Error getting FAS calculation:', error);
      
      if (error.message.includes('Token refresh failed')) {
        return res.status(401).json({
          success: false,
          error: 'XERO_TOKEN_EXPIRED',
          message: 'Xero connection expired. Please reconnect to Xero.',
          requiresReconnection: true
        });
      }
      
      if (error.message.includes('No Xero token found')) {
        return res.status(400).json({
          success: false,
          error: 'XERO_NOT_CONFIGURED',
          message: 'Xero is not configured. Please connect to Xero first.',
          requiresConfiguration: true
        });
      }
      
      res.status(500).json({
        success: false,
        error: 'FAS_CALCULATION_FAILED',
        message: error.message
      });
    }
  }
  
  /**
   * Get FBT (Fringe Benefits Tax) categories
   * GET /api/xero/fas-data/categories
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getFBTCategories(req, res) {
    try {
      const companyId = req.company.id;
      
      console.log(`📊 Getting FBT categories for company ${companyId}`);
      
      // Get valid Xero token
      const token = await xeroDataService.getValidToken(companyId);
      
      // Get accounts that might be related to fringe benefits
      const accounts = await xeroDataService.fetchAccounts(token.accessToken, token.tenantId);
      
      // Filter accounts for FBT-related categories
      const fbtCategories = this.identifyFBTCategories(accounts);
      
      res.json({
        success: true,
        data: fbtCategories,
        message: 'FBT categories retrieved successfully'
      });
      
    } catch (error) {
      console.error('❌ Error getting FBT categories:', error);
      
      if (error.message.includes('Token refresh failed')) {
        return res.status(401).json({
          success: false,
          error: 'XERO_TOKEN_EXPIRED',
          message: 'Xero connection expired. Please reconnect to Xero.',
          requiresReconnection: true
        });
      }
      
      if (error.message.includes('No Xero token found')) {
        return res.status(400).json({
          success: false,
          error: 'XERO_NOT_CONFIGURED',
          message: 'Xero is not configured. Please connect to Xero first.',
          requiresConfiguration: true
        });
      }
      
      res.status(500).json({
        success: false,
        error: 'FBT_CATEGORIES_FETCH_FAILED',
        message: error.message
      });
    }
  }
  
  // Helper methods
  
  /**
   * Fetch FAS data from Xero (calculated from employee benefits)
   * @param {string} accessToken - Xero access token
   * @param {string} tenantId - Xero tenant ID
   * @param {Object} params - Fetch parameters
   * @returns {Promise<Object>} FAS data
   */
  async fetchFASDataFromXero(accessToken, tenantId, params = {}) {
    try {
      const { fromDate, toDate } = params;
      const startDate = fromDate || xeroDataService.getCurrentQuarterStart();
      const endDate = toDate || xeroDataService.getCurrentQuarterEnd();
      
      // Get employee-related transactions for the period
      const [bills, bankTransactions] = await Promise.all([
        xeroDataService.fetchBills(accessToken, tenantId, {
          where: `Date >= DateTime(${startDate}) AND Date <= DateTime(${endDate})`,
          statuses: 'AUTHORISED,PAID'
        }),
        xeroDataService.fetchBankTransactions(accessToken, tenantId, {
          fromDate: startDate,
          toDate: endDate
        })
      ]);
      
      // Calculate FAS components
      const fasData = this.calculateFASComponents(bills, bankTransactions);
      
      return [{
        ReportName: 'FAS Report (Calculated)',
        ReportDate: new Date().toISOString().split('T')[0],
        ReportID: 'calculated-fas',
        ...fasData
      }];
      
    } catch (error) {
      console.error('❌ Error fetching FAS data from Xero:', error);
      throw error;
    }
  }
  
  /**
   * Process FAS data into summary format
   * @param {Array} fasData - Raw FAS data
   * @returns {Object} Processed summary
   */
  processFASSummary(fasData) {
    if (!fasData || fasData.length === 0) {
      return {
        totalFringeBenefits: 0,
        totalFBT: 0,
        hasData: false
      };
    }
    
    const report = fasData[0]; // Use first report
    
    return {
      totalFringeBenefits: report.TotalFringeBenefits || 0,
      totalFBT: report.TotalFBT || 0,
      hasData: true,
      reportName: report.ReportName,
      reportDate: report.ReportDate,
      categories: report.Categories || []
    };
  }
  
  /**
   * Calculate FAS components from bills and bank transactions
   * @param {Array} bills - Bill data
   * @param {Array} bankTransactions - Bank transaction data
   * @returns {Object} FAS calculation results
   */
  calculateFASComponents(bills, bankTransactions) {
    let totalFringeBenefits = 0;
    let totalFBT = 0;
    const categories = {
      motorVehicles: 0,
      entertainment: 0,
      meals: 0,
      accommodation: 0,
      other: 0
    };
    
    // Process bills for employee benefits
    bills.forEach(bill => {
      if (bill.Contact && bill.Contact.IsEmployee) {
        const lineItems = bill.LineItems || [];
        lineItems.forEach(item => {
          if (item.AccountCode && item.Total) {
            const amount = parseFloat(item.Total) || 0;
            totalFringeBenefits += amount;
            
            // Categorize based on account code or description
            const accountCode = item.AccountCode.toLowerCase();
            const description = (item.Description || '').toLowerCase();
            
            if (accountCode.includes('motor') || description.includes('car') || description.includes('vehicle')) {
              categories.motorVehicles += amount;
            } else if (accountCode.includes('entertain') || description.includes('entertain')) {
              categories.entertainment += amount;
            } else if (accountCode.includes('meal') || description.includes('meal') || description.includes('food')) {
              categories.meals += amount;
            } else if (accountCode.includes('accommodat') || description.includes('hotel') || description.includes('travel')) {
              categories.accommodation += amount;
            } else {
              categories.other += amount;
            }
          }
        });
      }
    });
    
    // Process bank transactions for employee payments
    bankTransactions.forEach(transaction => {
      if (transaction.Contact && transaction.Contact.IsEmployee) {
        const amount = parseFloat(transaction.Total) || 0;
        if (amount > 0) { // Only positive amounts (benefits given)
          totalFringeBenefits += amount;
          categories.other += amount;
        }
      }
    });
    
    // Calculate FBT (simplified calculation - actual FBT calculation is more complex)
    totalFBT = totalFringeBenefits * 0.47; // 47% FBT rate (simplified)
    
    return {
      TotalFringeBenefits: totalFringeBenefits,
      TotalFBT: totalFBT,
      Categories: categories,
      CalculatedFromTransactions: true
    };
  }
  
  /**
   * Identify FBT categories from accounts
   * @param {Array} accounts - Account data
   * @returns {Array} FBT categories
   */
  identifyFBTCategories(accounts) {
    const fbtCategories = [];
    
    accounts.forEach(account => {
      const accountName = (account.Name || '').toLowerCase();
      const accountCode = (account.Code || '').toLowerCase();
      
      if (this.isFBTAccount(accountName, accountCode)) {
        fbtCategories.push({
          id: account.AccountID,
          name: account.Name,
          code: account.Code,
          type: account.Type,
          category: this.categorizeFBTAccount(accountName, accountCode)
        });
      }
    });
    
    return fbtCategories;
  }
  
  /**
   * Check if account is FBT-related
   * @param {string} accountName - Account name
   * @param {string} accountCode - Account code
   * @returns {boolean} True if FBT-related
   */
  isFBTAccount(accountName, accountCode) {
    const fbtKeywords = [
      'fringe', 'benefit', 'fbt', 'motor', 'vehicle', 'car',
      'entertainment', 'meal', 'accommodation', 'travel',
      'employee', 'staff', 'company', 'corporate'
    ];
    
    return fbtKeywords.some(keyword => 
      accountName.includes(keyword) || accountCode.includes(keyword)
    );
  }
  
  /**
   * Categorize FBT account
   * @param {string} accountName - Account name
   * @param {string} accountCode - Account code
   * @returns {string} FBT category
   */
  categorizeFBTAccount(accountName, accountCode) {
    if (accountName.includes('motor') || accountName.includes('vehicle') || accountName.includes('car')) {
      return 'motorVehicles';
    } else if (accountName.includes('entertain')) {
      return 'entertainment';
    } else if (accountName.includes('meal') || accountName.includes('food')) {
      return 'meals';
    } else if (accountName.includes('accommodat') || accountName.includes('hotel') || accountName.includes('travel')) {
      return 'accommodation';
    } else {
      return 'other';
    }
  }
}

module.exports = new FASController();
