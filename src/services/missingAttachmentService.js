const crypto = require('crypto');
const cryptoJS = require('crypto-js');
const axios = require('axios');
const Company = require('../models/Company');
const { UploadLink } = require('../models/UploadLink');
const { MissingAttachmentConfig } = require('../models/MissingAttachmentConfig');
const emailService = require('./emailService');
const notificationService = require('./notificationService');
const db = require('../config/database');

class MissingAttachmentService {
  constructor() {
    this.defaultThreshold = 82.50; // Default GST threshold
    this.linkExpiryDays = 7;
    this.db = db;
    this.tokenEncryptionKey = process.env.XERO_TOKEN_ENCRYPTION_KEY || 'default-encryption-key-change-in-production-32-chars';
  }

  // Decrypt sensitive data - handles both encrypted and plain text tokens
  decrypt(encryptedText) {
    if (!encryptedText) return null;
    
    // Check if the text looks like a JWT token (starts with eyJ)
    if (encryptedText.startsWith('eyJ')) {
      console.log('🔍 Token appears to be plain text JWT, returning as-is');
      return encryptedText;
    }
    
    // Try to decrypt as encrypted text
    try {
      const bytes = cryptoJS.AES.decrypt(encryptedText, this.tokenEncryptionKey);
      const decrypted = bytes.toString(cryptoJS.enc.Utf8);
      
      // Check if decryption produced valid output
      if (decrypted && decrypted.length > 0) {
        console.log('✅ Successfully decrypted token');
        return decrypted;
      } else {
        console.log('⚠️ Decryption produced empty result, treating as plain text');
        return encryptedText;
      }
    } catch (error) {
      console.log('⚠️ Decryption failed, treating as plain text:', error.message);
      return encryptedText;
    }
  }

  /**
   * Detect missing attachments during Xero sync
   * @param {string} companyId - Company ID
   * @param {string} tenantId - Xero tenant ID (optional - will use company's tenant)
   * @returns {Promise<Array>} Array of transactions missing attachments
   */
  async detectMissingAttachments(companyId, tenantId = null) {
    try {
      console.log(`🔍 Detecting missing attachments for company ${companyId}`);
      
      // SECURITY: Ensure we only fetch data for the specified company
      if (!companyId) {
        throw new Error('Company ID is required for data isolation');
      }

      // Get Xero settings from the new Xero Flow integration
      const result = await db.query(
        'SELECT client_id, client_secret, redirect_uri, access_token, refresh_token, token_expires_at, tenant_id, organization_name, tenant_data FROM xero_settings WHERE company_id = $1',
        [companyId]
      );
      
      const xeroSettings = result.rows.length > 0 ? result.rows[0] : null;
      if (!xeroSettings) {
        throw new Error(`Xero settings not found for company ${companyId}. Please configure Xero Flow integration first.`);
      }

      // Check if we have a valid access token
      if (!xeroSettings.access_token) {
        throw new Error(`Xero access token not found for company ${companyId}. Please complete Xero Flow connection first.`);
      }

      // Check if refresh token exists (required for token refresh)
      if (!xeroSettings.refresh_token) {
        throw new Error(`Xero refresh token not found for company ${companyId}. Please reconnect to Xero Flow to get new tokens.`);
      }

      // Check if refresh token might be expired (Xero refresh tokens expire after 60 days)
      // Use created_at if available, otherwise fall back to updated_at
      const tokenCreatedAt = xeroSettings.created_at || xeroSettings.updated_at;
      const refreshTokenAge = tokenCreatedAt ? new Date() - new Date(tokenCreatedAt) : null;
      const refreshTokenAgeDays = refreshTokenAge ? Math.floor(refreshTokenAge / (1000 * 60 * 60 * 24)) : null;
      
      console.log(`🔍 Refresh token age check for company ${companyId}:`, {
        createdAt: xeroSettings.created_at,
        updatedAt: xeroSettings.updated_at,
        ageInDays: refreshTokenAgeDays,
        isPotentiallyExpired: refreshTokenAgeDays && refreshTokenAgeDays > 55
      });
      
      // Only block if token is definitely expired (more than 65 days to be safe)
      // This gives some buffer beyond Xero's 60-day limit
      if (refreshTokenAgeDays && refreshTokenAgeDays > 65) {
        console.error(`❌ Refresh token for company ${companyId} is ${refreshTokenAgeDays} days old - definitely expired`);
        throw new Error(`Xero refresh token has expired (created ${refreshTokenAgeDays} days ago). Please reconnect to Xero Flow to get new tokens.`);
      } else if (refreshTokenAgeDays && refreshTokenAgeDays > 55) {
        console.warn(`⚠️ Refresh token for company ${companyId} is ${refreshTokenAgeDays} days old and may expire soon. Will attempt refresh if needed.`);
      }

      // SECURITY: Always use the company's own tenant ID from their settings
      // Never allow override of tenant ID to prevent cross-company data access
      const effectiveTenantId = xeroSettings.tenant_id;
      if (!effectiveTenantId) {
        throw new Error(`Xero tenant ID not found for company ${companyId}. Please reconnect to Xero Flow.`);
      }

      // Log for audit trail
      console.log(`🔒 Data isolation: Company ${companyId} accessing tenant ${effectiveTenantId}`);

      // Check if token is expired and try to refresh if needed
      const tokenExpiryTime = xeroSettings.token_expires_at ? new Date(xeroSettings.token_expires_at) : null;
      const currentTime = new Date();
      const tokenExpiresIn = tokenExpiryTime ? (tokenExpiryTime.getTime() - currentTime.getTime()) / 1000 : null;
      
      console.log(`🔍 Token expiry check for company ${companyId}:`, {
        hasExpiryTime: !!tokenExpiryTime,
        expiresAt: tokenExpiryTime?.toISOString(),
        expiresInSeconds: tokenExpiresIn,
        isExpired: tokenExpiryTime && tokenExpiryTime <= currentTime
      });
      
      if (tokenExpiryTime && tokenExpiryTime <= currentTime) {
        console.log(`🔄 Xero token expired for company ${companyId}, attempting to refresh...`);
        try {
          await this.refreshXeroToken(companyId, xeroSettings);
          // Reload settings after refresh
          const refreshedResult = await db.query(
            'SELECT access_token, refresh_token, token_expires_at, tenant_id FROM xero_settings WHERE company_id = $1',
            [companyId]
          );
          if (refreshedResult.rows.length > 0 && refreshedResult.rows[0].access_token) {
            xeroSettings.access_token = refreshedResult.rows[0].access_token;
            xeroSettings.refresh_token = refreshedResult.rows[0].refresh_token;
            xeroSettings.token_expires_at = refreshedResult.rows[0].token_expires_at;
            xeroSettings.tenant_id = refreshedResult.rows[0].tenant_id;
            console.log(`✅ Token refreshed successfully for company ${companyId}`);
          } else {
            throw new Error('Failed to retrieve refreshed token from database');
          }
        } catch (refreshError) {
          console.error(`❌ Failed to refresh Xero token for company ${companyId}:`, refreshError);
          
          // Provide more specific error messages based on the refresh error
          if (refreshError.message.includes('Refresh token has expired')) {
            throw new Error(`Xero refresh token has expired for company ${companyId}. Please reconnect to Xero Flow to get new tokens.`);
          } else if (refreshError.message.includes('Invalid client credentials')) {
            throw new Error(`Invalid Xero client credentials for company ${companyId}. Please check Xero app configuration.`);
          } else if (refreshError.message.includes('Missing client credentials')) {
            throw new Error(`Missing Xero client credentials for company ${companyId}. Please reconfigure Xero integration.`);
          } else {
            throw new Error(`Xero token expired and refresh failed for company ${companyId}. Please reconnect to Xero Flow.`);
          }
        }
      } else if (tokenExpiresIn && tokenExpiresIn < 300) { // Refresh if expires in less than 5 minutes
        console.log(`🔄 Xero token expires soon (${Math.round(tokenExpiresIn)}s) for company ${companyId}, refreshing proactively...`);
        try {
          await this.refreshXeroToken(companyId, xeroSettings);
          // Reload settings after refresh
          const refreshedResult = await db.query(
            'SELECT access_token, refresh_token, token_expires_at, tenant_id FROM xero_settings WHERE company_id = $1',
            [companyId]
          );
          if (refreshedResult.rows.length > 0 && refreshedResult.rows[0].access_token) {
            xeroSettings.access_token = refreshedResult.rows[0].access_token;
            xeroSettings.refresh_token = refreshedResult.rows[0].refresh_token;
            xeroSettings.token_expires_at = refreshedResult.rows[0].token_expires_at;
            xeroSettings.tenant_id = refreshedResult.rows[0].tenant_id;
            console.log(`✅ Token refreshed proactively for company ${companyId}`);
          }
        } catch (refreshError) {
          console.warn(`⚠️ Proactive token refresh failed for company ${companyId}, continuing with current token:`, refreshError.message);
        }
      }

      console.log(`🔍 Fetching real Xero data for company ${companyId}, tenant ${effectiveTenantId}`);
      console.log(`🔍 Access token present: ${!!xeroSettings.access_token}`);
      console.log(`🔍 Tenant ID present: ${!!effectiveTenantId}`);

      // Validate required data before proceeding
      if (!xeroSettings.access_token) {
        throw new Error(`Access token is missing for company ${companyId}. Please reconnect to Xero Flow.`);
      }
      if (!effectiveTenantId) {
        throw new Error(`Tenant ID is missing for company ${companyId}. Please reconnect to Xero Flow.`);
      }

      // Fetch all transactions from Xero (company-specific)
      const transactions = await this.fetchAllTransactions(xeroSettings.access_token, effectiveTenantId, companyId);
      
      // Filter transactions without attachments
      const missingAttachments = transactions.filter(transaction => {
        return !transaction.HasAttachments || transaction.HasAttachments === false;
      });

      console.log(`📎 Found ${missingAttachments.length} transactions without attachments`);
      
      // Calculate money at risk for each transaction
      const transactionsWithRisk = missingAttachments.map(transaction => {
        const moneyAtRisk = this.calculateMoneyAtRisk(transaction);
        return {
          ...transaction,
          moneyAtRisk,
          companyId,
          tenantId
        };
      });

      return transactionsWithRisk;
    } catch (error) {
      console.error('❌ Error detecting missing attachments:', error);
      throw error;
    }
  }

  /**
   * Fetch all transactions from Xero (invoices, bank transactions, etc.)
   * @param {string} accessToken - Xero access token
   * @param {string} tenantId - Xero tenant ID
   * @param {string} companyId - Company ID (for logging and security)
   * @returns {Promise<Array>} All transactions
   */
  async fetchAllTransactions(accessToken, tenantId, companyId) {
    const transactions = [];
    
    try {
      console.log(`📊 [Company ${companyId}] Fetching all transaction types from Xero for tenant ${tenantId}`);

      // Fetch invoices with pagination
      console.log(`📄 [Company ${companyId}] Fetching invoices...`);
      const invoices = await this.fetchXeroDataWithPagination(accessToken, tenantId, 'Invoices', companyId);
      transactions.push(...invoices.map(inv => ({ 
        ...inv, 
        type: 'Invoice',
        TransactionID: inv.InvoiceID,
        Amount: inv.Total,
        TaxAmount: inv.TotalTax,
        companyId // Add company ID to each transaction for security
      })));

      // Fetch bank transactions with pagination
      console.log(`🏦 [Company ${companyId}] Fetching bank transactions...`);
      const bankTransactions = await this.fetchXeroDataWithPagination(accessToken, tenantId, 'BankTransactions', companyId);
      transactions.push(...bankTransactions.map(bt => ({ 
        ...bt, 
        type: 'BankTransaction',
        TransactionID: bt.BankTransactionID,
        Amount: bt.Total,
        TaxAmount: bt.TotalTax,
        companyId // Add company ID to each transaction for security
      })));

      // Fetch receipts with pagination
      console.log(`🧾 [Company ${companyId}] Fetching receipts...`);
      const receipts = await this.fetchXeroDataWithPagination(accessToken, tenantId, 'Receipts', companyId);
      transactions.push(...receipts.map(r => ({ 
        ...r, 
        type: 'Receipt',
        TransactionID: r.ReceiptID,
        Amount: r.Total,
        TaxAmount: r.TotalTax,
        companyId // Add company ID to each transaction for security
      })));

      // Fetch purchase orders with pagination
      console.log(`📋 [Company ${companyId}] Fetching purchase orders...`);
      const purchaseOrders = await this.fetchXeroDataWithPagination(accessToken, tenantId, 'PurchaseOrders', companyId);
      transactions.push(...purchaseOrders.map(po => ({ 
        ...po, 
        type: 'PurchaseOrder',
        TransactionID: po.PurchaseOrderID,
        Amount: po.Total,
        TaxAmount: po.TotalTax,
        companyId // Add company ID to each transaction for security
      })));

      console.log(`📊 [Company ${companyId}] Total transactions fetched: ${transactions.length}`);
      console.log(`📄 [Company ${companyId}] Invoices: ${invoices.length}`);
      console.log(`🏦 [Company ${companyId}] Bank Transactions: ${bankTransactions.length}`);
      console.log(`🧾 [Company ${companyId}] Receipts: ${receipts.length}`);
      console.log(`📋 [Company ${companyId}] Purchase Orders: ${purchaseOrders.length}`);

      return transactions;
    } catch (error) {
      console.error('❌ Error fetching transactions from Xero:', error);
      
      // If it's a token error, provide helpful message
      if (error.response?.status === 401) {
        throw new Error('Xero access token is invalid or expired. Please reconnect to Xero.');
      } else if (error.response?.status === 403) {
        throw new Error('Insufficient permissions to access Xero data. Please check your Xero app permissions.');
      } else if (error.response?.status === 404) {
        throw new Error('Xero tenant not found. Please reconnect to Xero.');
      }
      
      throw error;
    }
  }

  /**
   * Fetch data from Xero API with pagination support
   * @param {string} accessToken - Xero access token
   * @param {string} tenantId - Xero tenant ID
   * @param {string} endpoint - Xero API endpoint
   * @param {string} companyId - Company ID (for logging and security)
   * @returns {Promise<Array>} Xero data
   */
  async fetchXeroDataWithPagination(accessToken, tenantId, endpoint, companyId, retryCount = 0) {
    const allData = [];
    let page = 1;
    const pageSize = 100; // Xero's maximum page size
    let hasMoreData = true;
    const maxRetries = 1; // Allow one retry for 401 errors

    try {
      while (hasMoreData) {
        console.log(`📄 [Company ${companyId}] Fetching ${endpoint} page ${page}...`);
        
        try {
          const response = await axios.get(`https://api.xero.com/api.xro/2.0/${endpoint}`, {
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Xero-tenant-id': tenantId,
              'Accept': 'application/json'
            },
            params: {
              page: page,
              pageSize: pageSize
            },
            timeout: 15000 // 15 second timeout
          });

          const data = response.data[endpoint] || [];
          allData.push(...data);

          // Check if we have more data
          hasMoreData = data.length === pageSize;
          page++;

          // Safety check to prevent infinite loops
          if (page > 50) {
            console.warn(`⚠️ Reached maximum page limit (50) for ${endpoint}`);
            break;
          }

          // Add a small delay to avoid rate limiting
          if (hasMoreData) {
            await new Promise(resolve => setTimeout(resolve, 200));
          }
        } catch (apiError) {
          console.error(`❌ API Error for ${endpoint} page ${page}:`, {
            status: apiError.response?.status,
            message: apiError.message,
            data: apiError.response?.data
          });
          
          // Handle different error types
          if (apiError.response?.status === 401) {
            const errorData = apiError.response.data;
            console.error(`🔍 401 Error details for ${endpoint}:`, {
              error: errorData?.error,
              errorDescription: errorData?.error_description,
              fullResponse: errorData,
              retryCount
            });
            
            // Retry logic for 401 errors (might be temporary)
            if (retryCount < maxRetries) {
              console.log(`🔄 Retrying ${endpoint} API call after 401 error (attempt ${retryCount + 1}/${maxRetries + 1})`);
              await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
              return this.fetchXeroDataWithPagination(accessToken, tenantId, endpoint, companyId, retryCount + 1);
            }
            
            // Check for specific token-related errors after retries exhausted
            if (errorData?.error === 'invalid_token' || errorData?.error_description?.includes('token')) {
              throw new Error(`Xero API authentication failed for ${endpoint}. Token may be expired. Please try reconnecting to Xero Flow.`);
            } else if (errorData?.error === 'unauthorized_client') {
              throw new Error(`Xero API authentication failed for ${endpoint}. Client credentials may be invalid. Please check Xero app configuration.`);
            } else {
              throw new Error(`Xero API authentication failed for ${endpoint}. Please reconnect to Xero Flow.`);
            }
          } else if (apiError.response?.status === 403) {
            throw new Error(`Insufficient permissions to access ${endpoint}. Please check Xero app permissions.`);
          } else if (apiError.response?.status === 404) {
            throw new Error(`Xero ${endpoint} endpoint not found. Please check tenant configuration.`);
          } else if (apiError.response?.status >= 500) {
            throw new Error(`Xero server error (${apiError.response.status}) for ${endpoint}. Please try again later.`);
          } else {
            throw new Error(`Failed to fetch ${endpoint} from Xero: ${apiError.message}`);
          }
        }
      }

      console.log(`✅ [Company ${companyId}] Fetched ${allData.length} ${endpoint} from Xero (${page - 1} pages)`);
      return allData;
    } catch (error) {
      console.error(`❌ Error fetching ${endpoint} from Xero:`, error.response?.data || error.message);
      
      // Handle specific Xero API errors
      if (error.response?.status === 401) {
        throw new Error(`Xero API authentication failed for ${endpoint}. Token may be expired.`);
      } else if (error.response?.status === 403) {
        throw new Error(`Insufficient permissions to access ${endpoint}. Check Xero app scopes.`);
      } else if (error.response?.status === 429) {
        throw new Error(`Xero API rate limit exceeded for ${endpoint}. Please try again later.`);
      } else if (error.response?.status === 500) {
        throw new Error(`Xero API server error for ${endpoint}. Please try again later.`);
      }
      
      throw error;
    }
  }

  /**
   * Fetch data from Xero API (single page - legacy method)
   * @param {string} accessToken - Xero access token
   * @param {string} tenantId - Xero tenant ID
   * @param {string} endpoint - Xero API endpoint
   * @returns {Promise<Array>} Xero data
   */
  async fetchXeroData(accessToken, tenantId, endpoint) {
    try {
      const response = await axios.get(`https://api.xero.com/api.xro/2.0/${endpoint}`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Xero-tenant-id': tenantId,
          'Accept': 'application/json'
        }
      });

      return response.data[endpoint] || [];
    } catch (error) {
      console.error(`❌ Error fetching ${endpoint} from Xero:`, error.response?.data || error.message);
      return [];
    }
  }

  /**
   * Calculate money at risk based on configurable threshold
   * @param {Object} transaction - Xero transaction
   * @param {number} threshold - GST threshold (default: 82.50)
   * @returns {Object} Money at risk calculation
   */
  calculateMoneyAtRisk(transaction, threshold = null) {
    const configuredThreshold = threshold || this.defaultThreshold;
    
    // Extract financial values from transaction
    const total = parseFloat(transaction.Total) || 0;
    const totalTax = parseFloat(transaction.TotalTax) || 0;
    const subTotal = parseFloat(transaction.SubTotal) || total - totalTax;
    
    // Calculate risk based on threshold
    const exceedsThreshold = total >= configuredThreshold;
    const riskLevel = exceedsThreshold ? 'HIGH' : 'LOW';
    const potentialPenalty = exceedsThreshold ? total * 0.25 : 0; // 25% penalty estimate
    
    return {
      total,
      totalTax,
      subTotal,
      threshold: configuredThreshold,
      exceedsThreshold,
      riskLevel,
      potentialPenalty: parseFloat(potentialPenalty.toFixed(2)),
      currency: transaction.CurrencyCode || 'AUD'
    };
  }

  /**
   * Find existing upload link or create a new one (prevents duplicates)
   * @param {string} transactionId - Transaction ID
   * @param {string} companyId - Company ID
   * @param {string} tenantId - Xero tenant ID
   * @param {string} transactionType - Transaction type
   * @returns {Promise<Object>} Upload link details
   */
  async findOrCreateUploadLink(transactionId, companyId, tenantId, transactionType) {
    try {
      // First, check for any existing active link for this transaction
      const existingActiveLink = await UploadLink.findOne({
        transactionId,
        companyId,
        used: false,
        expiresAt: { $gt: new Date() }
      });

      if (existingActiveLink) {
        console.log(`🔗 Found existing active upload link for transaction ${transactionId}`);
        return {
          ...existingActiveLink,
          publicUrl: `${process.env.FRONTEND_URL || 'https://compliance-manager-frontend.onrender.com'}/upload-receipt/${existingActiveLink.linkId}?token=${existingActiveLink.token}`
        };
      }

      // Check for expired links that we can extend
      const expiredLink = await UploadLink.findOne({
        transactionId,
        companyId,
        used: false,
        expiresAt: { $lt: new Date() }
      });

      if (expiredLink) {
        console.log(`🔄 Extending expired upload link for transaction ${transactionId}`);
        // Extend the expired link with new expiry date
        const newExpiresAt = new Date();
        newExpiresAt.setDate(newExpiresAt.getDate() + this.linkExpiryDays);
        
        await UploadLink.update(
          { expiresAt: newExpiresAt },
          { linkId: expiredLink.linkId }
        );

        return {
          ...expiredLink,
          expiresAt: newExpiresAt,
          publicUrl: `${process.env.FRONTEND_URL || 'https://compliance-manager-frontend.onrender.com'}/upload-receipt/${expiredLink.linkId}?token=${expiredLink.token}`
        };
      }

      // No existing link found, create a new one
      console.log(`📝 Creating new upload link for transaction ${transactionId}`);
      return await this.generateUploadLink(transactionId, companyId, tenantId, transactionType);
    } catch (error) {
      console.error('❌ Error finding or creating upload link:', error);
      throw error;
    }
  }

  /**
   * Generate single-use upload link for a transaction
   * @param {string} transactionId - Transaction ID
   * @param {string} companyId - Company ID
   * @param {string} tenantId - Xero tenant ID
   * @param {string} transactionType - Transaction type
   * @returns {Promise<Object>} Upload link details
   */
  async generateUploadLink(transactionId, companyId, tenantId, transactionType = 'Invoice') {
    const linkId = crypto.randomUUID();
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + this.linkExpiryDays);
    
    const uploadLink = {
      linkId,
      token,
      transactionId,
      companyId,
      tenantId,
      transactionType,
      expiresAt,
      used: false,
      createdAt: new Date()
    };

    // Store the link in database
    await this.storeUploadLink(uploadLink);
    
    // Generate the public URL
    const baseUrl = process.env.FRONTEND_URL || 'https://compliance-manager-frontend.onrender.com';
    const publicUrl = `${baseUrl}/upload-receipt/${linkId}?token=${token}`;
    
    return {
      ...uploadLink,
      publicUrl
    };
  }

  /**
   * Store upload link in database
   * @param {Object} uploadLink - Upload link details
   */
  async storeUploadLink(uploadLink) {
    try {
      const stored = await UploadLink.create({
        linkId: uploadLink.linkId,
        token: uploadLink.token,
        transactionId: uploadLink.transactionId,
        companyId: uploadLink.companyId,
        tenantId: uploadLink.tenantId,
        expiresAt: uploadLink.expiresAt,
        used: uploadLink.used,
        createdAt: uploadLink.createdAt
      });
      
      console.log('📝 Stored upload link:', stored.linkId);
      return stored;
    } catch (error) {
      console.error('❌ Error storing upload link:', error);
      throw error;
    }
  }

  /**
   * Send SMS notification via Twilio
   * @param {Object} transaction - Transaction details
   * @param {Object} uploadLink - Upload link details
   * @param {string} phoneNumber - Recipient phone number
   * @returns {Promise<Object>} SMS result
   */
  async sendSMSNotification(transaction, uploadLink, phoneNumber) {
    try {
      const twilioAccountSid = process.env.TWILIO_ACCOUNT_SID;
      const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;
      const twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER;

      if (!twilioAccountSid || !twilioAuthToken || !twilioPhoneNumber) {
        throw new Error('Twilio credentials not configured');
      }

      const message = this.generateSMSMessage(transaction, uploadLink);
      
      // Send SMS via Twilio API
      const response = await axios.post(
        `https://api.twilio.com/2010-04-01/Accounts/${twilioAccountSid}/Messages.json`,
        new URLSearchParams({
          To: phoneNumber,
          From: twilioPhoneNumber,
          Body: message
        }),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': `Basic ${Buffer.from(`${twilioAccountSid}:${twilioAuthToken}`).toString('base64')}`
          }
        }
      );

      console.log('📱 SMS sent successfully:', response.data.sid);
      return {
        success: true,
        messageSid: response.data.sid,
        status: response.data.status
      };
    } catch (error) {
      console.error('❌ Error sending SMS:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Generate SMS message content
   * @param {Object} transaction - Transaction details
   * @param {Object} uploadLink - Upload link details
   * @returns {string} SMS message
   */
  generateSMSMessage(transaction, uploadLink) {
    const amount = transaction.moneyAtRisk?.total || transaction.Total || 0;
    const currency = transaction.moneyAtRisk?.currency || 'AUD';
    const transactionType = transaction.type || 'Transaction';
    
    return `🧾 Missing Receipt Alert
${transactionType}: ${currency} ${amount}
Upload your receipt here (expires in ${this.linkExpiryDays} days):
${uploadLink.publicUrl}

Reply STOP to opt out.`;
  }

  /**
   * Process all missing attachments for a company
   * @param {string} companyId - Company ID
   * @returns {Promise<Object>} Processing results
   */
  async processMissingAttachments(companyId) {
    try {
      console.log(`🔄 Processing missing attachments for company ${companyId}`);
      
      const company = await Company.findById(companyId);
      if (!company) {
        throw new Error('Company not found');
      }

      // Get company's Xero settings
      const xeroSettingsQuery = `
        SELECT * FROM xero_settings 
        WHERE company_id = $1 AND connected = true
        LIMIT 1
      `;
      const xeroSettingsResult = await db.query(xeroSettingsQuery, [companyId]);
      
      if (!xeroSettingsResult.rows || xeroSettingsResult.rows.length === 0) {
        throw new Error('Xero not connected for this company');
      }

      const xeroSettings = xeroSettingsResult.rows[0];
      
      // Use the actual tenant ID from Xero settings
      const tenantId = xeroSettings.tenant_id;
      if (!tenantId) {
        throw new Error('Xero tenant ID not found in settings. Please reconnect to Xero.');
      }
      
      // Detect missing attachments
      const missingAttachments = await this.detectMissingAttachments(companyId, tenantId);
      
      const results = {
        companyId,
        totalTransactions: missingAttachments.length,
        highRiskCount: 0,
        lowRiskCount: 0,
        smssSent: 0,
        errors: [],
        processedAt: new Date()
      };

      // Process each missing attachment
      for (const transaction of missingAttachments) {
        try {
          // Count risk levels
          if (transaction.moneyAtRisk.riskLevel === 'HIGH') {
            results.highRiskCount++;
          } else {
            results.lowRiskCount++;
          }

          // Check if upload link already exists for this transaction
          const transactionId = transaction.InvoiceID || transaction.BankTransactionID || transaction.ReceiptID || transaction.PurchaseOrderID;
          
          let uploadLink = await this.findOrCreateUploadLink(transactionId, companyId, tenantId, transaction.type);

          // Get company's missing attachment config
          const config = await MissingAttachmentConfig.findOne({ companyId });
          
          // Send SMS if enabled and phone number configured
          if (config?.smsEnabled && config?.phoneNumber) {
            try {
              await this.sendSMSNotification(transaction, uploadLink, config.phoneNumber);
              results.smssSent++;
            } catch (smsError) {
              console.error('❌ SMS failed, trying email fallback:', smsError);
              results.errors.push({
                transactionId: transaction.InvoiceID,
                error: `SMS failed: ${smsError.message}`
              });
              
              // Email fallback if SMS fails and email is enabled
              if (config?.emailEnabled && config?.emailAddress) {
                try {
                  await emailService.sendMissingAttachmentEmail(transaction, uploadLink, config.emailAddress);
                  console.log('✅ Email fallback sent successfully');
                } catch (emailError) {
                  console.error('❌ Email fallback also failed:', emailError);
                  results.errors.push({
                    transactionId: transaction.InvoiceID,
                    error: `Email fallback failed: ${emailError.message}`
                  });
                }
              }
            }
          }
          
          // Send email if enabled (primary or fallback)
          else if (config?.emailEnabled && config?.emailAddress) {
            try {
              await emailService.sendMissingAttachmentEmail(transaction, uploadLink, config.emailAddress);
              results.smssSent++; // Count as notification sent
            } catch (emailError) {
              console.error('❌ Email notification failed:', emailError);
              results.errors.push({
                transactionId: transaction.InvoiceID,
                error: `Email failed: ${emailError.message}`
              });
            }
          }
        } catch (error) {
          console.error(`❌ Error processing transaction ${transaction.InvoiceID}:`, error);
          results.errors.push({
            transactionId: transaction.InvoiceID,
            error: error.message
          });
        }
      }

      console.log(`✅ Processed ${results.totalTransactions} missing attachments for company ${companyId}`);

      // Send notifications if missing attachments are found
      if (missingAttachments.length > 0) {
        try {
          const notificationResult = await this.sendMissingAttachmentNotifications(companyId, missingAttachments, company.name);
          results.notifications = notificationResult;
        } catch (notificationError) {
          console.error('❌ Error sending notifications:', notificationError);
          results.errors.push({
            type: 'notification',
            error: `Notification failed: ${notificationError.message}`
          });
        }
      }

      return results;
    } catch (error) {
      console.error('❌ Error processing missing attachments:', error);
      throw error;
    }
  }

  /**
   * Send notifications for missing attachments
   * @param {string} companyId - Company ID
   * @param {Array} missingAttachments - Array of missing attachment records
   * @param {string} companyName - Company name
   * @returns {Promise<Object>} Notification results
   */
  async sendMissingAttachmentNotifications(companyId, missingAttachments, companyName) {
    try {
      console.log(`📧 Sending notifications for ${missingAttachments.length} missing attachments to company ${companyId}`);

      // Get company's notification configuration
      const config = await MissingAttachmentConfig.findOne({ companyId });
      if (!config) {
        console.log('📧 No notification configuration found for company');
        return {
          success: false,
          message: 'No notification configuration found'
        };
      }

      // Check if notifications are enabled
      if (!config.enableSMS && !config.enableEmail) {
        console.log('📧 Notifications are disabled for this company');
        return {
          success: false,
          message: 'Notifications are disabled'
        };
      }

      // Validate phone number if SMS is enabled
      if (config.enableSMS && config.phoneNumber && !notificationService.validatePhoneNumber(config.phoneNumber)) {
        console.log('📧 Invalid phone number format, disabling SMS notifications');
        config.enableSMS = false;
      }

      // Validate email address if email is enabled
      if (config.enableEmail && config.emailAddress && !notificationService.validateEmail(config.emailAddress)) {
        console.log('📧 Invalid email address format, disabling email notifications');
        config.enableEmail = false;
      }

      // Send notifications using the notification service
      const notificationConfig = {
        enableSMS: config.enableSMS,
        enableEmail: config.enableEmail,
        phoneNumber: config.phoneNumber,
        emailAddress: config.emailAddress
      };

      const result = await notificationService.sendMissingAttachmentNotification(
        notificationConfig,
        missingAttachments,
        companyName
      );

      console.log(`✅ Notifications sent successfully:`, result);
      return result;

    } catch (error) {
      console.error('❌ Error sending missing attachment notifications:', error);
      return {
        success: false,
        error: error.message,
        message: 'Failed to send notifications'
      };
    }
  }

  /**
   * Validate and process file upload
   * @param {string} linkId - Upload link ID
   * @param {string} token - Security token
   * @param {Object} file - Uploaded file
   * @returns {Promise<Object>} Upload result
   */
  async processFileUpload(linkId, token, file) {
    try {
      // Validate upload link
      const uploadLink = await this.validateUploadLink(linkId, token);
      if (!uploadLink) {
        throw new Error('Invalid or expired upload link');
      }

      // SECURITY: Validate company ownership and log access
      const company = await Company.findById(uploadLink.companyId);
      if (!company) {
        throw new Error('Company not found for this upload link');
      }

      console.log(`🔒 File upload for company ${uploadLink.companyId} (${company.companyName})`);
      console.log(`🔒 Transaction: ${uploadLink.transactionType} ${uploadLink.transactionId}`);
      console.log(`🔒 File: ${file.originalname} (${file.size} bytes)`);

      // Validate file
      this.validateFile(file);

      // Generate presigned POST URL for storage (company-isolated)
      const storageResult = await this.uploadToStorage(file, uploadLink);

      // Attach file to Xero transaction (using company's Xero credentials)
      await this.attachToXeroTransaction(uploadLink, storageResult);

      // Mark link as used and resolved
      await this.markLinkUsed(linkId);

      console.log(`✅ [Company ${uploadLink.companyId}] File upload completed successfully`);

      return {
        success: true,
        message: 'Receipt uploaded successfully',
        fileUrl: storageResult.fileUrl,
        companyId: uploadLink.companyId // Include for audit trail
      };
    } catch (error) {
      console.error('❌ Error processing file upload:', error);
      throw error;
    }
  }

  /**
   * Validate upload link
   * @param {string} linkId - Upload link ID
   * @param {string} token - Security token
   * @returns {Promise<Object|null>} Upload link if valid
   */
  async validateUploadLink(linkId, token) {
    try {
      const uploadLink = await UploadLink.findOne({
        linkId,
        token,
        used: false,
        expiresAt: { $gt: new Date() }
      });
      
      if (!uploadLink) {
        console.log('🔍 Invalid or expired upload link:', linkId);
        return null;
      }
      
      console.log('✅ Valid upload link found:', linkId);
      return uploadLink;
    } catch (error) {
      console.error('❌ Error validating upload link:', error);
      return null;
    }
  }

  /**
   * Validate uploaded file
   * @param {Object} file - Uploaded file
   */
  validateFile(file) {
    const allowedTypes = ['image/jpeg', 'image/png', 'application/pdf'];
    const maxSize = 10 * 1024 * 1024; // 10MB

    if (!allowedTypes.includes(file.mimetype)) {
      throw new Error('Invalid file type. Only JPG, PNG, and PDF files are allowed.');
    }

    if (file.size > maxSize) {
      throw new Error('File too large. Maximum size is 10MB.');
    }
  }

  /**
   * Upload file to storage using presigned POST
   * @param {Object} file - Uploaded file
   * @param {Object} uploadLink - Upload link details
   * @returns {Promise<Object>} Storage result
   */
  async uploadToStorage(file, uploadLink) {
    try {
      // For now, we'll use a simple file storage approach
      // In production, you would use AWS S3, Google Cloud Storage, etc.
      const fs = require('fs');
      const path = require('path');
      
      // SECURITY: Create company-isolated directory structure
      const uploadsDir = path.join(process.cwd(), 'uploads', 'receipts', `company_${uploadLink.companyId}`);
      if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
      }
      
      // Generate unique filename with company isolation
      const fileExtension = path.extname(file.originalname);
      const fileName = `${uploadLink.linkId}_${Date.now()}${fileExtension}`;
      const filePath = path.join(uploadsDir, fileName);

      console.log(`🔒 [Company ${uploadLink.companyId}] Storing file in isolated directory: ${uploadsDir}`);
      
      // Save file to disk
      fs.writeFileSync(filePath, file.buffer);
      
      console.log('📤 File uploaded to storage:', fileName);
      
      // Return file URL (company-isolated path)
      const baseUrl = process.env.BACKEND_URL || 'http://localhost:3333';
      return {
        fileUrl: `${baseUrl}/uploads/receipts/company_${uploadLink.companyId}/${fileName}`,
        key: fileName,
        filePath,
        companyId: uploadLink.companyId // Include for security validation
      };
    } catch (error) {
      console.error('❌ Error uploading file to storage:', error);
      throw new Error('Failed to upload file to storage');
    }
  }

  /**
   * Attach file to Xero transaction
   * @param {Object} uploadLink - Upload link details
   * @param {Object} storageResult - Storage result
   */
  async attachToXeroTransaction(uploadLink, storageResult) {
    try {
      // Get Xero access token for the company
      const xeroSettingsQuery = `
        SELECT * FROM xero_settings 
        WHERE company_id = $1 AND connected = true
        LIMIT 1
      `;
      const xeroSettingsResult = await db.query(xeroSettingsQuery, [uploadLink.companyId]);
      
      if (!xeroSettingsResult.rows || xeroSettingsResult.rows.length === 0) {
        throw new Error('Xero not connected for this company');
      }

      const xeroSettings = xeroSettingsResult.rows[0];
      if (!xeroSettings || !xeroSettings.access_token) {
        throw new Error('Xero not connected for this company');
      }

      // Read the file for upload to Xero
      const fs = require('fs');
      const fileBuffer = fs.readFileSync(storageResult.filePath);
      const fileName = storageResult.key;

      // Determine the Xero endpoint based on transaction type
      let endpoint;
      switch (uploadLink.transactionType) {
        case 'Invoice':
          endpoint = `Invoices/${uploadLink.transactionId}/Attachments/${fileName}`;
          break;
        case 'BankTransaction':
          endpoint = `BankTransactions/${uploadLink.transactionId}/Attachments/${fileName}`;
          break;
        case 'Receipt':
          endpoint = `Receipts/${uploadLink.transactionId}/Attachments/${fileName}`;
          break;
        case 'PurchaseOrder':
          endpoint = `PurchaseOrders/${uploadLink.transactionId}/Attachments/${fileName}`;
          break;
        default:
          throw new Error(`Unsupported transaction type: ${uploadLink.transactionType}`);
      }

      // Upload attachment to Xero
      const response = await axios.put(
        `https://api.xero.com/api.xro/2.0/${endpoint}`,
        fileBuffer,
        {
          headers: {
            'Authorization': `Bearer ${xeroSettings.access_token}`,
            'Xero-tenant-id': uploadLink.tenantId,
            'Content-Type': 'application/octet-stream'
          }
        }
      );

      console.log('📎 Successfully attached file to Xero transaction:', uploadLink.transactionId);
      
      // Update the upload link with file details
      await UploadLink.update({
        fileUrl: storageResult.fileUrl,
        fileName: fileName,
        fileSize: fileBuffer.length
      }, {
        where: { linkId: uploadLink.linkId }
      });

      return {
        success: true,
        attachmentId: response.data?.Attachments?.[0]?.AttachmentID,
        xeroResponse: response.data
      };
    } catch (error) {
      console.error('❌ Error attaching file to Xero transaction:', error.response?.data || error.message);
      
      // Still update the upload link with file details even if Xero attachment fails
      try {
        const fs = require('fs');
        const fileBuffer = fs.readFileSync(storageResult.filePath);
        await UploadLink.update({
          fileUrl: storageResult.fileUrl,
          fileName: storageResult.key,
          fileSize: fileBuffer.length
        }, {
          where: { linkId: uploadLink.linkId }
        });
      } catch (updateError) {
        console.error('❌ Error updating upload link:', updateError);
      }

      // Don't throw error - file is still stored, just not attached to Xero
      console.log('⚠️ File uploaded but not attached to Xero. Manual attachment may be required.');
      return {
        success: false,
        error: error.message,
        fileStored: true
      };
    }
  }

  /**
   * Mark upload link as used
   * @param {string} linkId - Upload link ID
   */
  async markLinkUsed(linkId) {
    try {
      await UploadLink.update(
        { 
          used: true, 
          usedAt: new Date(),
          resolved: true,
          resolvedAt: new Date()
        },
        { linkId }
      );
      
      console.log('✅ Marked link as used:', linkId);
    } catch (error) {
      console.error('❌ Error marking link as used:', error);
      throw error;
    }
  }

  /**
   * Send daily digest email for all companies
   * @returns {Promise<Object>} Digest results
   */
  async sendDailyDigest() {
    try {
      console.log('📊 Sending daily digest emails...');
      
      // Get all companies with email notifications enabled
      const configs = await MissingAttachmentConfig.findAll({
        where: {
          enabled: true,
          emailEnabled: true
        }
      });

      const results = {
        companiesProcessed: 0,
        emailsSent: 0,
        errors: []
      };

      for (const config of configs) {
        try {
          if (!config.emailAddress) {
            continue;
          }

          // SECURITY: Get missing attachments only for this specific company
          console.log(`📊 [Company ${config.companyId}] Generating daily digest...`);
          const missingAttachments = await this.detectMissingAttachments(config.companyId);
          
          const summary = {
            totalTransactions: missingAttachments.length,
            highRiskCount: missingAttachments.filter(t => t.moneyAtRisk.riskLevel === 'HIGH').length,
            lowRiskCount: missingAttachments.filter(t => t.moneyAtRisk.riskLevel === 'LOW').length,
            smssSent: 0 // This would come from daily stats
          };

          // Send digest email
          await emailService.sendDailyDigest(config.emailAddress, missingAttachments, summary);
          
          results.companiesProcessed++;
          results.emailsSent++;
          
          console.log(`✅ Daily digest sent to company ${config.companyId}`);
        } catch (error) {
          console.error(`❌ Error sending digest to company ${config.companyId}:`, error);
          results.errors.push({
            companyId: config.companyId,
            error: error.message
          });
        }
      }

      console.log(`📊 Daily digest complete: ${results.emailsSent} emails sent to ${results.companiesProcessed} companies`);
      return results;
    } catch (error) {
      console.error('❌ Error sending daily digest:', error);
      throw error;
    }
  }

  /**
   * Generate demo missing attachments data for testing
   * @param {string} companyId - Company ID
   * @param {string} tenantId - Xero tenant ID
   * @returns {Array} Demo missing attachments
   */
  generateDemoMissingAttachments(companyId, tenantId) {
    const demoTransactions = [
      {
        InvoiceID: 'DEMO-INV-001',
        type: 'Invoice',
        Total: '150.00',
        TotalTax: '13.64',
        SubTotal: '136.36',
        CurrencyCode: 'AUD',
        HasAttachments: false,
        Date: new Date().toISOString(),
        Contact: { Name: 'Demo Customer 1' }
      },
      {
        BankTransactionID: 'DEMO-BT-002',
        type: 'BankTransaction',
        Total: '45.50',
        TotalTax: '4.14',
        SubTotal: '41.36',
        CurrencyCode: 'AUD',
        HasAttachments: false,
        Date: new Date().toISOString(),
        Contact: { Name: 'Demo Vendor 1' }
      },
      {
        ReceiptID: 'DEMO-REC-003',
        type: 'Receipt',
        Total: '220.00',
        TotalTax: '20.00',
        SubTotal: '200.00',
        CurrencyCode: 'AUD',
        HasAttachments: false,
        Date: new Date().toISOString(),
        Contact: { Name: 'Demo Supplier 1' }
      },
      {
        InvoiceID: 'DEMO-INV-004',
        type: 'Invoice',
        Total: '75.25',
        TotalTax: '6.84',
        SubTotal: '68.41',
        CurrencyCode: 'AUD',
        HasAttachments: false,
        Date: new Date().toISOString(),
        Contact: { Name: 'Demo Customer 2' }
      },
      {
        PurchaseOrderID: 'DEMO-PO-005',
        type: 'PurchaseOrder',
        Total: '95.00',
        TotalTax: '8.64',
        SubTotal: '86.36',
        CurrencyCode: 'AUD',
        HasAttachments: false,
        Date: new Date().toISOString(),
        Contact: { Name: 'Demo Vendor 2' }
      }
    ];

    // Calculate money at risk for each transaction
    const transactionsWithRisk = demoTransactions.map(transaction => {
      const moneyAtRisk = this.calculateMoneyAtRisk(transaction);
      return {
        ...transaction,
        moneyAtRisk,
        companyId,
        tenantId: tenantId || 'demo-tenant'
      };
    });

    console.log(`📎 Generated ${transactionsWithRisk.length} demo transactions without attachments`);
    return transactionsWithRisk;
  }

  /**
   * Refresh Xero access token using refresh token
   * @param {string} companyId - Company ID
   * @param {Object} xeroSettings - Current Xero settings
   * @returns {Promise<Object>} Refreshed token data
   */
  async refreshXeroToken(companyId, xeroSettings, retryCount = 0) {
    const maxRetries = 2;
    
    try {
      if (!xeroSettings.refresh_token) {
        throw new Error('No refresh token available');
      }

      console.log(`🔄 Refreshing Xero access token for company ${companyId}... (attempt ${retryCount + 1}/${maxRetries + 1})`);
      console.log(`🔍 Client ID: ${xeroSettings.client_id ? 'present' : 'missing'}`);
      console.log(`🔍 Refresh token: ${xeroSettings.refresh_token ? 'present' : 'missing'}`);
      console.log(`🔍 Client secret: ${xeroSettings.client_secret ? 'present' : 'missing'}`);

      // Decrypt client secret if it's encrypted
      const clientSecret = this.decrypt(xeroSettings.client_secret) || xeroSettings.client_secret;
      console.log(`🔍 Decrypted client secret: ${clientSecret ? 'present' : 'missing'}`);

      if (!xeroSettings.client_id || !clientSecret) {
        throw new Error('Missing client credentials for token refresh');
      }

      const response = await axios.post('https://identity.xero.com/connect/token', 
        new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: xeroSettings.refresh_token
        }), {
          headers: {
            'Authorization': `Basic ${Buffer.from(`${xeroSettings.client_id}:${clientSecret}`).toString('base64')}`,
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          timeout: 10000 // 10 second timeout
        }
      );

      const tokenData = response.data;
      const expiresAt = new Date();
      expiresAt.setSeconds(expiresAt.getSeconds() + tokenData.expires_in);

      console.log(`🔄 Token refresh response: ${tokenData.access_token ? 'success' : 'failed'}`);

      // Update the database with new tokens
      await this.db.query(
        `UPDATE xero_settings 
         SET access_token = $1, refresh_token = $2, token_expires_at = $3, updated_at = NOW()
         WHERE company_id = $4`,
        [tokenData.access_token, tokenData.refresh_token, expiresAt, companyId]
      );

      console.log(`✅ Xero token refreshed successfully for company ${companyId}`);
      return tokenData;
    } catch (error) {
      console.error(`❌ Error refreshing Xero token for company ${companyId} (attempt ${retryCount + 1}):`, {
        message: error.message,
        status: error.response?.status,
        data: error.response?.data,
        clientId: xeroSettings.client_id ? 'present' : 'missing',
        refreshToken: xeroSettings.refresh_token ? 'present' : 'missing'
      });
      
      // Retry logic for network errors
      if (retryCount < maxRetries && (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT' || error.response?.status >= 500)) {
        console.log(`🔄 Retrying token refresh for company ${companyId} in 2 seconds...`);
        await new Promise(resolve => setTimeout(resolve, 2000));
        return this.refreshXeroToken(companyId, xeroSettings, retryCount + 1);
      }
      
      // Provide more specific error messages
      if (error.response?.status === 400) {
        const errorData = error.response.data;
        if (errorData.error === 'invalid_grant') {
          throw new Error('Refresh token has expired. Please reconnect to Xero Flow.');
        } else if (errorData.error === 'invalid_client') {
          throw new Error('Invalid client credentials. Please check Xero app configuration.');
        }
      }
      
      throw error;
    }
  }

  /**
   * Clean up expired upload links (run periodically)
   * @param {number} daysOld - Remove links older than this many days (default: 30)
   * @returns {Promise<Object>} Cleanup results
   */
  async cleanupExpiredLinks(daysOld = 30) {
    try {
      console.log(`🧹 Cleaning up upload links older than ${daysOld} days...`);
      
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysOld);

      // Count links to be deleted
      const countToDelete = await UploadLink.count({
        expiresAt: { $lt: cutoffDate }
      });

      // Delete expired links
      const result = await this.db.query(
        'DELETE FROM upload_links WHERE expires_at < $1',
        [cutoffDate]
      );

      console.log(`🧹 Cleaned up ${result.rowCount} expired upload links`);
      
      return {
        deletedCount: result.rowCount,
        cutoffDate,
        daysOld
      };
    } catch (error) {
      console.error('❌ Error cleaning up expired links:', error);
      throw error;
    }
  }

  /**
   * Get duplicate link statistics
   * @param {string} companyId - Company ID
   * @returns {Promise<Object>} Duplicate statistics
   */
  async getDuplicateStats(companyId) {
    try {
      const query = `
        SELECT 
          transaction_id,
          COUNT(*) as link_count,
          MAX(created_at) as latest_created,
          MIN(created_at) as first_created
        FROM upload_links 
        WHERE company_id = $1 
        GROUP BY transaction_id 
        HAVING COUNT(*) > 1
        ORDER BY link_count DESC
      `;

      const result = await this.db.query(query, [companyId]);
      
      return {
        duplicateTransactions: result.rows,
        totalDuplicates: result.rows.length,
        companyId
      };
    } catch (error) {
      console.error('❌ Error getting duplicate stats:', error);
      throw error;
    }
  }
}

module.exports = new MissingAttachmentService();
