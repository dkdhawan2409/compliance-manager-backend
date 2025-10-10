const db = require('../config/database');
const xeroDataService = require('./xeroDataService');

/**
 * Xero Sync Service - Handles data synchronization with Xero
 * Manages initial sync, periodic sync, and sync history tracking
 */
class XeroSyncService {
  
  /**
   * Perform initial data sync after Xero authorization
   * @param {number} companyId - Company ID
   * @param {string} accessToken - Xero access token
   * @param {string} tenantId - Xero tenant ID
   */
  async syncInitialData(companyId, accessToken, tenantId) {
    const syncStartTime = Date.now();
    
    try {
      console.log(`🔄 Starting initial sync for company ${companyId}...`);
      
      // Track sync start
      await this.logSyncStart(companyId, 'initial_sync', 'started');
      
      let recordsSynced = 0;
      const syncResults = {};
      
      // 1. Fetch and cache organizations
      try {
        console.log('📋 Syncing organizations...');
        const organizations = await xeroDataService.fetchOrganizations(accessToken, tenantId);
        if (organizations) {
          await xeroDataService.cacheData(companyId, tenantId, 'organizations', organizations, 24); // Cache for 24 hours
          syncResults.organizations = 1;
          recordsSynced += 1;
        }
      } catch (error) {
        console.error('❌ Error syncing organizations:', error);
        syncResults.organizations = { error: error.message };
      }
      
      // 2. Fetch and cache contacts
      try {
        console.log('👥 Syncing contacts...');
        const contacts = await xeroDataService.fetchContacts(accessToken, tenantId, { page: 1 });
        if (contacts && contacts.length > 0) {
          await xeroDataService.cacheData(companyId, tenantId, 'contacts', contacts, 6); // Cache for 6 hours
          syncResults.contacts = contacts.length;
          recordsSynced += contacts.length;
        }
      } catch (error) {
        console.error('❌ Error syncing contacts:', error);
        syncResults.contacts = { error: error.message };
      }
      
      // 3. Fetch and cache accounts
      try {
        console.log('💰 Syncing accounts...');
        const accounts = await xeroDataService.fetchAccounts(accessToken, tenantId);
        if (accounts && accounts.length > 0) {
          await xeroDataService.cacheData(companyId, tenantId, 'accounts', accounts, 12); // Cache for 12 hours
          syncResults.accounts = accounts.length;
          recordsSynced += accounts.length;
        }
      } catch (error) {
        console.error('❌ Error syncing accounts:', error);
        syncResults.accounts = { error: error.message };
      }
      
      // 4. Fetch current period BAS/GST data
      try {
        console.log('📊 Syncing current BAS data...');
        const basData = await xeroDataService.fetchBASReport(accessToken, tenantId, {
          fromDate: xeroDataService.getCurrentQuarterStart(),
          toDate: xeroDataService.getCurrentQuarterEnd()
        });
        if (basData && basData.length > 0) {
          await xeroDataService.cacheData(companyId, tenantId, 'bas_current', basData, 2); // Cache for 2 hours
          syncResults.bas_current = basData.length;
          recordsSynced += basData.length;
        }
      } catch (error) {
        console.error('❌ Error syncing BAS data:', error);
        syncResults.bas_current = { error: error.message };
      }
      
      // 5. Fetch recent invoices (last 30 days)
      try {
        console.log('📄 Syncing recent invoices...');
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        
        const invoices = await xeroDataService.fetchInvoices(accessToken, tenantId, {
          where: `Date >= DateTime(${thirtyDaysAgo.toISOString().split('T')[0]})`,
          statuses: 'AUTHORISED,PAID'
        });
        if (invoices && invoices.length > 0) {
          await xeroDataService.cacheData(companyId, tenantId, 'invoices_recent', invoices, 4); // Cache for 4 hours
          syncResults.invoices_recent = invoices.length;
          recordsSynced += invoices.length;
        }
      } catch (error) {
        console.error('❌ Error syncing recent invoices:', error);
        syncResults.invoices_recent = { error: error.message };
      }
      
      const syncDuration = Date.now() - syncStartTime;
      
      // Log successful sync
      await this.logSyncComplete(companyId, 'initial_sync', 'success', recordsSynced, null, syncDuration, syncResults);
      
      console.log(`✅ Initial sync completed for company ${companyId}. Records synced: ${recordsSynced}, Duration: ${syncDuration}ms`);
      
      return {
        success: true,
        recordsSynced,
        syncDuration,
        results: syncResults
      };
      
    } catch (error) {
      const syncDuration = Date.now() - syncStartTime;
      console.error(`❌ Initial sync failed for company ${companyId}:`, error);
      
      // Log failed sync
      await this.logSyncComplete(companyId, 'initial_sync', 'failed', 0, error.message, syncDuration);
      
      throw error;
    }
  }
  
  /**
   * Sync specific data type
   * @param {number} companyId - Company ID
   * @param {string} dataType - Type of data to sync
   * @param {Object} options - Sync options
   */
  async syncDataType(companyId, dataType, options = {}) {
    const syncStartTime = Date.now();
    
    try {
      console.log(`🔄 Syncing ${dataType} for company ${companyId}...`);
      
      const token = await xeroDataService.getValidToken(companyId);
      let data = null;
      let recordsSynced = 0;
      
      switch (dataType) {
        case 'organizations':
          data = await xeroDataService.fetchOrganizations(token.accessToken, token.tenantId);
          if (data) recordsSynced = 1;
          break;
          
        case 'contacts':
          data = await xeroDataService.fetchContacts(token.accessToken, token.tenantId, options);
          recordsSynced = data ? data.length : 0;
          break;
          
        case 'accounts':
          data = await xeroDataService.fetchAccounts(token.accessToken, token.tenantId);
          recordsSynced = data ? data.length : 0;
          break;
          
        case 'bas_data':
          data = await xeroDataService.fetchBASReport(token.accessToken, token.tenantId, options);
          recordsSynced = data ? data.length : 0;
          break;
          
        case 'invoices':
          data = await xeroDataService.fetchInvoices(token.accessToken, token.tenantId, options);
          recordsSynced = data ? data.length : 0;
          break;
          
        case 'bills':
          data = await xeroDataService.fetchBills(token.accessToken, token.tenantId, options);
          recordsSynced = data ? data.length : 0;
          break;
          
        case 'bank_transactions':
          data = await xeroDataService.fetchBankTransactions(token.accessToken, token.tenantId, options);
          recordsSynced = data ? data.length : 0;
          break;
          
        default:
          throw new Error(`Unknown data type: ${dataType}`);
      }
      
      if (data) {
        // Cache the data
        const cacheHours = this.getCacheHours(dataType);
        await xeroDataService.cacheData(companyId, token.tenantId, dataType, data, cacheHours);
      }
      
      const syncDuration = Date.now() - syncStartTime;
      
      // Log successful sync
      await this.logSyncComplete(companyId, dataType, 'success', recordsSynced, null, syncDuration);
      
      console.log(`✅ ${dataType} sync completed for company ${companyId}. Records synced: ${recordsSynced}`);
      
      return {
        success: true,
        dataType,
        recordsSynced,
        syncDuration,
        data
      };
      
    } catch (error) {
      const syncDuration = Date.now() - syncStartTime;
      console.error(`❌ ${dataType} sync failed for company ${companyId}:`, error);
      
      // Log failed sync
      await this.logSyncComplete(companyId, dataType, 'failed', 0, error.message, syncDuration);
      
      throw error;
    }
  }
  
  /**
   * Sync all data types for a company
   * @param {number} companyId - Company ID
   */
  async syncAllData(companyId) {
    const syncStartTime = Date.now();
    
    try {
      console.log(`🔄 Starting full sync for company ${companyId}...`);
      
      const token = await xeroDataService.getValidToken(companyId);
      let totalRecordsSynced = 0;
      const syncResults = {};
      
      // Define data types to sync
      const dataTypes = [
        'organizations',
        'contacts',
        'accounts',
        'bas_data',
        'invoices',
        'bills'
      ];
      
      // Sync each data type
      for (const dataType of dataTypes) {
        try {
          const result = await this.syncDataType(companyId, dataType);
          syncResults[dataType] = result.recordsSynced;
          totalRecordsSynced += result.recordsSynced;
        } catch (error) {
          console.error(`❌ Failed to sync ${dataType}:`, error);
          syncResults[dataType] = { error: error.message };
        }
      }
      
      const syncDuration = Date.now() - syncStartTime;
      
      // Log full sync completion
      await this.logSyncComplete(companyId, 'full_sync', 'success', totalRecordsSynced, null, syncDuration, syncResults);
      
      console.log(`✅ Full sync completed for company ${companyId}. Total records synced: ${totalRecordsSynced}`);
      
      return {
        success: true,
        totalRecordsSynced,
        syncDuration,
        results: syncResults
      };
      
    } catch (error) {
      const syncDuration = Date.now() - syncStartTime;
      console.error(`❌ Full sync failed for company ${companyId}:`, error);
      
      // Log failed sync
      await this.logSyncComplete(companyId, 'full_sync', 'failed', 0, error.message, syncDuration);
      
      throw error;
    }
  }
  
  /**
   * Get sync history for a company
   * @param {number} companyId - Company ID
   * @param {number} limit - Number of records to return
   * @returns {Promise<Array>} Sync history records
   */
  async getSyncHistory(companyId, limit = 50) {
    try {
      const result = await db.query(`
        SELECT sync_type, status, records_synced, error_message, 
               sync_duration_ms, synced_at, metadata
        FROM xero_sync_history
        WHERE company_id = $1
        ORDER BY synced_at DESC
        LIMIT $2
      `, [companyId, limit]);
      
      return result.rows;
      
    } catch (error) {
      console.error('❌ Error getting sync history:', error);
      throw error;
    }
  }
  
  /**
   * Get sync statistics for a company
   * @param {number} companyId - Company ID
   * @returns {Promise<Object>} Sync statistics
   */
  async getSyncStats(companyId) {
    try {
      const result = await db.query(`
        SELECT 
          sync_type,
          COUNT(*) as total_syncs,
          COUNT(CASE WHEN status = 'success' THEN 1 END) as successful_syncs,
          COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_syncs,
          AVG(CASE WHEN status = 'success' THEN records_synced END) as avg_records_synced,
          AVG(CASE WHEN status = 'success' THEN sync_duration_ms END) as avg_sync_duration_ms,
          MAX(synced_at) as last_sync
        FROM xero_sync_history
        WHERE company_id = $1
        GROUP BY sync_type
        ORDER BY sync_type
      `, [companyId]);
      
      return result.rows;
      
    } catch (error) {
      console.error('❌ Error getting sync stats:', error);
      throw error;
    }
  }
  
  // Private helper methods
  
  /**
   * Log sync start
   * @param {number} companyId - Company ID
   * @param {string} syncType - Type of sync
   * @param {string} status - Sync status
   */
  async logSyncStart(companyId, syncType, status) {
    try {
      await db.query(`
        INSERT INTO xero_sync_history (company_id, sync_type, status, synced_at)
        VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
      `, [companyId, syncType, status]);
    } catch (error) {
      console.error('❌ Error logging sync start:', error);
      // Don't throw error for logging failures
    }
  }
  
  /**
   * Log sync completion
   * @param {number} companyId - Company ID
   * @param {string} syncType - Type of sync
   * @param {string} status - Sync status
   * @param {number} recordsSynced - Number of records synced
   * @param {string} errorMessage - Error message if failed
   * @param {number} syncDuration - Sync duration in milliseconds
   * @param {Object} metadata - Additional metadata
   */
  async logSyncComplete(companyId, syncType, status, recordsSynced, errorMessage, syncDuration, metadata = null) {
    try {
      await db.query(`
        INSERT INTO xero_sync_history (
          company_id, sync_type, status, records_synced, 
          error_message, sync_duration_ms, synced_at, metadata
        )
        VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP, $7)
      `, [companyId, syncType, status, recordsSynced, errorMessage, syncDuration, JSON.stringify(metadata)]);
    } catch (error) {
      console.error('❌ Error logging sync completion:', error);
      // Don't throw error for logging failures
    }
  }
  
  /**
   * Get cache hours for data type
   * @param {string} dataType - Type of data
   * @returns {number} Hours to cache data
   */
  getCacheHours(dataType) {
    const cacheHours = {
      'organizations': 24,    // Organizations change rarely
      'accounts': 12,         // Chart of accounts changes occasionally
      'contacts': 6,          // Contacts change more frequently
      'invoices': 4,          // Invoices change frequently
      'bills': 4,             // Bills change frequently
      'bank_transactions': 2, // Bank transactions change very frequently
      'bas_data': 2,          // BAS data should be relatively fresh
      'fas_data': 2,          // FAS data should be relatively fresh
      'invoices_recent': 4,   // Recent invoices cache for 4 hours
      'bas_current': 2        // Current BAS cache for 2 hours
    };
    
    return cacheHours[dataType] || 4; // Default to 4 hours
  }
}

module.exports = new XeroSyncService();
