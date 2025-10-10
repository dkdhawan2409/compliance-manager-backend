const xeroDataService = require('../services/xeroDataService');
const xeroSyncService = require('../services/xeroSyncService');

/**
 * BAS Controller - Handles BAS (Business Activity Statement) data operations
 * Provides endpoints for fetching, syncing, and managing BAS data from Xero
 */
class BASController {
  
  /**
   * Get BAS data for a company
   * GET /api/xero/bas-data
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getBASData(req, res) {
    try {
      const companyId = req.company.id;
      const { fromDate, toDate, useCache = true } = req.query;
      
      console.log(`📊 Getting BAS data for company ${companyId}`);
      
      // Get valid Xero token
      const token = await xeroDataService.getValidToken(companyId);
      
      // Check cache first if requested
      let basData = null;
      if (useCache === 'true') {
        const cachedData = await xeroDataService.getCachedData(companyId, token.tenantId, 'bas_data');
        if (cachedData) {
          console.log('✅ Using cached BAS data');
          return res.json({
            success: true,
            data: cachedData.data,
            cached: true,
            cachedAt: cachedData.expiresAt,
            message: 'BAS data retrieved from cache'
          });
        }
      }
      
      // Fetch fresh data from Xero
      console.log('🔄 Fetching fresh BAS data from Xero...');
      basData = await xeroDataService.fetchBASReport(token.accessToken, token.tenantId, {
        fromDate,
        toDate
      });
      
      // Cache the data for future requests
      await xeroDataService.cacheData(companyId, token.tenantId, 'bas_data', basData, 2); // Cache for 2 hours
      
      res.json({
        success: true,
        data: basData,
        cached: false,
        message: 'BAS data fetched from Xero successfully'
      });
      
    } catch (error) {
      console.error('❌ Error getting BAS data:', error);
      
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
        error: 'BAS_DATA_FETCH_FAILED',
        message: error.message
      });
    }
  }
  
  /**
   * Get current period BAS data
   * GET /api/xero/bas-data/current
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getCurrentBASData(req, res) {
    try {
      const companyId = req.company.id;
      
      console.log(`📊 Getting current BAS data for company ${companyId}`);
      
      // Get valid Xero token
      const token = await xeroDataService.getValidToken(companyId);
      
      // Check cache first
      const cachedData = await xeroDataService.getCachedData(companyId, token.tenantId, 'bas_current');
      if (cachedData) {
        console.log('✅ Using cached current BAS data');
        return res.json({
          success: true,
          data: cachedData.data,
          cached: true,
          cachedAt: cachedData.expiresAt,
          period: {
            fromDate: xeroDataService.getCurrentQuarterStart(),
            toDate: xeroDataService.getCurrentQuarterEnd()
          },
          message: 'Current BAS data retrieved from cache'
        });
      }
      
      // Fetch current period data from Xero
      console.log('🔄 Fetching current BAS data from Xero...');
      const basData = await xeroDataService.fetchBASReport(token.accessToken, token.tenantId, {
        fromDate: xeroDataService.getCurrentQuarterStart(),
        toDate: xeroDataService.getCurrentQuarterEnd()
      });
      
      // Cache the data
      await xeroDataService.cacheData(companyId, token.tenantId, 'bas_current', basData, 2);
      
      res.json({
        success: true,
        data: basData,
        cached: false,
        period: {
          fromDate: xeroDataService.getCurrentQuarterStart(),
          toDate: xeroDataService.getCurrentQuarterEnd()
        },
        message: 'Current BAS data fetched from Xero successfully'
      });
      
    } catch (error) {
      console.error('❌ Error getting current BAS data:', error);
      
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
        error: 'CURRENT_BAS_DATA_FETCH_FAILED',
        message: error.message
      });
    }
  }
  
  /**
   * Sync BAS data manually
   * POST /api/xero/sync/bas
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async syncBASData(req, res) {
    try {
      const companyId = req.company.id;
      const { fromDate, toDate } = req.body;
      
      console.log(`🔄 Manual BAS sync for company ${companyId}`);
      
      // Perform sync
      const syncResult = await xeroSyncService.syncDataType(companyId, 'bas_data', {
        fromDate,
        toDate
      });
      
      res.json({
        success: true,
        message: 'BAS data synced successfully',
        syncResult
      });
      
    } catch (error) {
      console.error('❌ Error syncing BAS data:', error);
      
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
        error: 'BAS_SYNC_FAILED',
        message: error.message
      });
    }
  }
  
  /**
   * Get BAS data summary for dashboard
   * GET /api/xero/bas-data/summary
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getBASSummary(req, res) {
    try {
      const companyId = req.company.id;
      
      console.log(`📊 Getting BAS summary for company ${companyId}`);
      
      // Get valid Xero token
      const token = await xeroDataService.getValidToken(companyId);
      
      // Get current BAS data
      const basData = await xeroDataService.fetchBASReport(token.accessToken, token.tenantId, {
        fromDate: xeroDataService.getCurrentQuarterStart(),
        toDate: xeroDataService.getCurrentQuarterEnd()
      });
      
      // Process BAS data into summary format
      const summary = this.processBASSummary(basData);
      
      res.json({
        success: true,
        data: summary,
        period: {
          fromDate: xeroDataService.getCurrentQuarterStart(),
          toDate: xeroDataService.getCurrentQuarterEnd()
        },
        message: 'BAS summary generated successfully'
      });
      
    } catch (error) {
      console.error('❌ Error getting BAS summary:', error);
      
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
        error: 'BAS_SUMMARY_FETCH_FAILED',
        message: error.message
      });
    }
  }
  
  /**
   * Get BAS calculation details
   * GET /api/xero/bas-data/calculation
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getBASCalculation(req, res) {
    try {
      const companyId = req.company.id;
      const { fromDate, toDate } = req.query;
      
      console.log(`🧮 Getting BAS calculation for company ${companyId}`);
      
      // Get valid Xero token
      const token = await xeroDataService.getValidToken(companyId);
      
      // Get invoices and bills for the period
      const [invoices, bills] = await Promise.all([
        xeroDataService.fetchInvoices(token.accessToken, token.tenantId, {
          where: `Date >= DateTime(${fromDate || xeroDataService.getCurrentQuarterStart()}) AND Date <= DateTime(${toDate || xeroDataService.getCurrentQuarterEnd()})`,
          statuses: 'AUTHORISED,PAID'
        }),
        xeroDataService.fetchBills(token.accessToken, token.tenantId, {
          where: `Date >= DateTime(${fromDate || xeroDataService.getCurrentQuarterStart()}) AND Date <= DateTime(${toDate || xeroDataService.getCurrentQuarterEnd()})`,
          statuses: 'AUTHORISED,PAID'
        })
      ]);
      
      // Calculate BAS components
      const calculation = xeroDataService.calculateGSTComponents(invoices, bills);
      
      res.json({
        success: true,
        data: {
          calculation,
          period: {
            fromDate: fromDate || xeroDataService.getCurrentQuarterStart(),
            toDate: toDate || xeroDataService.getCurrentQuarterEnd()
          },
          sourceData: {
            invoices: invoices.length,
            bills: bills.length
          }
        },
        message: 'BAS calculation completed successfully'
      });
      
    } catch (error) {
      console.error('❌ Error getting BAS calculation:', error);
      
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
        error: 'BAS_CALCULATION_FAILED',
        message: error.message
      });
    }
  }
  
  // Helper methods
  
  /**
   * Process BAS data into summary format
   * @param {Array} basData - Raw BAS data from Xero
   * @returns {Object} Processed summary
   */
  processBASSummary(basData) {
    if (!basData || basData.length === 0) {
      return {
        totalSales: 0,
        totalGST: 0,
        netGST: 0,
        hasData: false
      };
    }
    
    const report = basData[0]; // Use first report
    const rows = report.Rows || [];
    
    let totalSales = 0;
    let totalGST = 0;
    let netGST = 0;
    
    // Process report rows to extract key figures
    rows.forEach(row => {
      if (row.Cells) {
        row.Cells.forEach(cell => {
          if (cell.Value) {
            const value = parseFloat(cell.Value) || 0;
            
            // Look for GST-related line items
            if (cell.Value && typeof cell.Value === 'string') {
              const cellValue = cell.Value.toLowerCase();
              
              if (cellValue.includes('gst') || cellValue.includes('sales') || cellValue.includes('total')) {
                if (cellValue.includes('sales') || cellValue.includes('total')) {
                  totalSales += value;
                } else if (cellValue.includes('gst')) {
                  totalGST += value;
                }
              }
            }
          }
        });
      }
    });
    
    netGST = totalGST; // Simplified for now
    
    return {
      totalSales,
      totalGST,
      netGST,
      hasData: true,
      reportName: report.ReportName,
      reportDate: report.ReportDate
    };
  }
}

module.exports = new BASController();
