const missingAttachmentService = require('../services/missingAttachmentService');
// Optional import for notification service (may not exist in production)
let notificationService;
try {
  notificationService = require('../services/notificationService');
} catch (error) {
  console.log('⚠️ Notification service not available in controller:', error.message);
  notificationService = null;
}
const { MissingAttachmentConfig } = require('../models/MissingAttachmentConfig');
const { UploadLink } = require('../models/UploadLink');
const Company = require('../models/Company');
const multer = require('multer');
const path = require('path');

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'application/pdf'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JPG, PNG, and PDF files are allowed.'), false);
    }
  }
}).single('receipt');

/**
 * Get missing attachment configuration for a company
 */
const getConfig = async (req, res) => {
  try {
    const companyId = req.company.id;
    
    let config = await MissingAttachmentConfig.findOne({ companyId });
    
    // Create default config if none exists
    if (!config) {
      config = await MissingAttachmentConfig.create({
        companyId,
        gstThreshold: 82.50,
        enabled: true,
        smsEnabled: true,
        emailEnabled: false,
        linkExpiryDays: 7,
        maxDailyNotifications: 50,
        notificationFrequency: 'immediate'
      });
    }
    
    res.json({
      success: true,
      data: config
    });
  } catch (error) {
    console.error('❌ Error getting missing attachment config:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get configuration',
      error: error.message
    });
  }
};

/**
 * Update missing attachment configuration
 */
const updateConfig = async (req, res) => {
  try {
    const companyId = req.company.id;
    const {
      gstThreshold,
      enabled,
      smsEnabled,
      emailEnabled,
      phoneNumber,
      emailAddress,
      linkExpiryDays,
      maxDailyNotifications,
      notificationFrequency
    } = req.body;
    
    // Validate input
    if (gstThreshold !== undefined && (gstThreshold < 0 || gstThreshold > 999999.99)) {
      return res.status(400).json({
        success: false,
        message: 'GST threshold must be between 0 and 999,999.99'
      });
    }
    
    if (linkExpiryDays !== undefined && (linkExpiryDays < 1 || linkExpiryDays > 30)) {
      return res.status(400).json({
        success: false,
        message: 'Link expiry days must be between 1 and 30'
      });
    }
    
    // Update or create configuration
    const [config, created] = await MissingAttachmentConfig.findOrCreate({
      where: { companyId },
      defaults: {
        companyId,
        gstThreshold: gstThreshold || 82.50,
        enabled: enabled !== undefined ? enabled : true,
        smsEnabled: smsEnabled !== undefined ? smsEnabled : true,
        emailEnabled: emailEnabled !== undefined ? emailEnabled : false,
        phoneNumber,
        emailAddress,
        linkExpiryDays: linkExpiryDays || 7,
        maxDailyNotifications: maxDailyNotifications || 50,
        notificationFrequency: notificationFrequency || 'immediate'
      }
    });
    
    if (!created) {
      await config.update({
        gstThreshold: gstThreshold !== undefined ? gstThreshold : config.gstThreshold,
        enabled: enabled !== undefined ? enabled : config.enabled,
        smsEnabled: smsEnabled !== undefined ? smsEnabled : config.smsEnabled,
        emailEnabled: emailEnabled !== undefined ? emailEnabled : config.emailEnabled,
        phoneNumber: phoneNumber !== undefined ? phoneNumber : config.phoneNumber,
        emailAddress: emailAddress !== undefined ? emailAddress : config.emailAddress,
        linkExpiryDays: linkExpiryDays !== undefined ? linkExpiryDays : config.linkExpiryDays,
        maxDailyNotifications: maxDailyNotifications !== undefined ? maxDailyNotifications : config.maxDailyNotifications,
        notificationFrequency: notificationFrequency !== undefined ? notificationFrequency : config.notificationFrequency
      });
    }
    
    res.json({
      success: true,
      data: config,
      message: created ? 'Configuration created successfully' : 'Configuration updated successfully'
    });
  } catch (error) {
    console.error('❌ Error updating missing attachment config:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update configuration',
      error: error.message
    });
  }
};

/**
 * Get notification service configuration status
 */
const getNotificationStatus = async (req, res) => {
  try {
    const companyId = req.company.id;
    
    // Get company's notification configuration
    const config = await MissingAttachmentConfig.findOne({ companyId });
    
    // Get notification service configuration status
    const notificationConfig = notificationService.getConfigurationStatus();
    
    // Validate phone number if provided
    let phoneNumberValid = false;
    if (config?.phoneNumber) {
      phoneNumberValid = notificationService.validatePhoneNumber(config.phoneNumber);
    }
    
    // Validate email address if provided
    let emailAddressValid = false;
    if (config?.emailAddress) {
      emailAddressValid = notificationService.validateEmail(config.emailAddress);
    }
    
    const smsEnabled = config?.smsEnabled ?? config?.enableSMS ?? false;
    const emailEnabled = config?.emailEnabled ?? config?.enableEmail ?? false;

    res.json({
      success: true,
      data: {
        // Company notification settings
        company: {
          enableSMS: smsEnabled,
          enableEmail: emailEnabled,
          smsEnabled,
          emailEnabled,
          phoneNumber: config?.phoneNumber || null,
          emailAddress: config?.emailAddress || null,
          phoneNumberValid: phoneNumberValid,
          emailAddressValid: emailAddressValid
        },
        // Notification service configuration
        service: {
          twilio: notificationConfig.twilio,
          email: notificationConfig.email
        },
        // Overall status
        status: {
          smsAvailable: notificationConfig.twilio.configured && phoneNumberValid && smsEnabled,
          emailAvailable: notificationConfig.email.configured && emailAddressValid && emailEnabled,
          fullyConfigured: notificationConfig.twilio.configured && notificationConfig.email.configured
        }
      }
    });
  } catch (error) {
    console.error('❌ Error getting notification status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get notification status',
      error: error.message
    });
  }
};

/**
 * Detect missing attachments for a company
 */
const detectMissingAttachments = async (req, res) => {
  try {
    const companyId = req.company.id;
    const { tenantId } = req.query;
    
    console.log(`🔍 Detecting missing attachments for company ${companyId}`);
    
    const missingAttachments = await missingAttachmentService.detectMissingAttachments(companyId, tenantId);
    
    res.json({
      success: true,
      data: {
        totalTransactions: missingAttachments.length,
        highRiskCount: missingAttachments.filter(t => t.moneyAtRisk.riskLevel === 'HIGH').length,
        lowRiskCount: missingAttachments.filter(t => t.moneyAtRisk.riskLevel === 'LOW').length,
        transactions: missingAttachments
      },
      message: `Found ${missingAttachments.length} transactions without attachments`
    });
  } catch (error) {
    console.error('❌ Error detecting missing attachments:', error);
    
    // Handle specific Xero token expiry errors with appropriate status codes
    if (error.message.includes('refresh token has expired') || 
        error.message.includes('Refresh token has expired') ||
        error.message.includes('invalid_grant')) {
      return res.status(401).json({
        success: false,
        message: 'Xero connection has expired. Please reconnect to Xero to continue.',
        error: 'XERO_TOKEN_EXPIRED',
        requiresReconnection: true
      });
    }
    
    // Handle Xero configuration errors
    if (error.message.includes('Xero settings not found') || 
        error.message.includes('Xero not connected') ||
        error.message.includes('Please configure Xero Flow integration')) {
      return res.status(400).json({
        success: false,
        message: 'Xero integration not configured. Please connect to Xero first.',
        error: 'XERO_NOT_CONFIGURED',
        requiresConfiguration: true
      });
    }
    
    // Handle Xero API permission errors
    if (error.message.includes('Insufficient permissions') || 
        error.message.includes('unauthorized_client') ||
        error.message.includes('invalid_client')) {
      return res.status(403).json({
        success: false,
        message: 'Xero app permissions are insufficient. Please check your Xero app configuration.',
        error: 'XERO_PERMISSIONS_ERROR',
        requiresPermissionUpdate: true
      });
    }
    
    // Handle other Xero API errors
    if (error.message.includes('Xero API') || 
        error.message.includes('Xero server error') ||
        error.message.includes('Xero tenant not found')) {
      return res.status(502).json({
        success: false,
        message: 'Xero service is temporarily unavailable. Please try again later.',
        error: 'XERO_SERVICE_ERROR',
        isTemporary: true
      });
    }
    
    // Default to 500 for unexpected errors
    res.status(500).json({
      success: false,
      message: 'Failed to detect missing attachments',
      error: error.message
    });
  }
};

/**
 * Process missing attachments and send notifications
 */
const processMissingAttachments = async (req, res) => {
  try {
    const companyId = req.company.id;
    
    console.log(`🔄 Processing missing attachments for company ${companyId}`);
    
    const results = await missingAttachmentService.processMissingAttachments(companyId);
    
    res.json({
      success: true,
      data: results,
      message: `Processed ${results.totalTransactions} transactions, sent ${results.smssSent} SMS notifications`
    });
  } catch (error) {
    console.error('❌ Error processing missing attachments:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process missing attachments',
      error: error.message
    });
  }
};

/**
 * Get upload links for a company
 */
const getUploadLinks = async (req, res) => {
  try {
    const companyId = req.company.id;
    const { page = 1, limit = 20, status = 'all' } = req.query;
    
    const whereClause = { companyId };
    
    if (status === 'active') {
      whereClause.used = false;
      whereClause.expiresAt = { $gt: new Date() };
    } else if (status === 'used') {
      whereClause.used = true;
    } else if (status === 'expired') {
      whereClause.used = false;
      whereClause.expiresAt = { $lt: new Date() };
    }
    
    const offset = (page - 1) * limit;
    
    const { count, rows } = await UploadLink.findAndCountAll({
      where: whereClause,
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [['createdAt', 'DESC']]
    });
    
    res.json({
      success: true,
      data: {
        links: rows,
        pagination: {
          total: count,
          page: parseInt(page),
          limit: parseInt(limit),
          pages: Math.ceil(count / limit)
        }
      }
    });
  } catch (error) {
    console.error('❌ Error getting upload links:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get upload links',
      error: error.message
    });
  }
};

/**
 * Get upload page (minimal, no login required)
 */
const getUploadPage = async (req, res) => {
  try {
    const { linkId } = req.params;
    const { token } = req.query;
    
    if (!linkId || !token) {
      return res.status(400).json({
        success: false,
        message: 'Missing link ID or token'
      });
    }
    
    const uploadLink = await UploadLink.findOne({
      linkId,
      token,
      used: false,
      expiresAt: { $gt: new Date() }
    });
    
    if (!uploadLink) {
      return res.status(404).json({
        success: false,
        message: 'Invalid or expired upload link'
      });
    }

    // SECURITY: Get company information for this upload link
    const company = await Company.findById(uploadLink.companyId);
    if (!company) {
      return res.status(404).json({
        success: false,
        message: 'Company not found for this upload link'
      });
    }

    // Log access for audit trail
    console.log(`🔒 Upload link accessed: ${linkId} for company ${uploadLink.companyId} (${company.companyName})`);
    console.log(`🔒 Transaction: ${uploadLink.transactionType} ${uploadLink.transactionId}`);
    
    res.json({
      success: true,
      data: {
        linkId: uploadLink.linkId,
        transactionId: uploadLink.transactionId,
        transactionType: uploadLink.transactionType,
        companyName: company.companyName,
        expiresAt: uploadLink.expiresAt,
        allowedFileTypes: ['image/jpeg', 'image/png', 'application/pdf'],
        maxFileSize: '10MB'
      }
    });
  } catch (error) {
    console.error('❌ Error getting upload page:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to load upload page',
      error: error.message
    });
  }
};

/**
 * Handle file upload
 */
const uploadReceipt = async (req, res) => {
  upload(req, res, async (err) => {
    if (err) {
      return res.status(400).json({
        success: false,
        message: err.message
      });
    }
    
    try {
      const { linkId } = req.params;
      const { token } = req.body;
      
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: 'No file uploaded'
        });
      }
      
      const result = await missingAttachmentService.processFileUpload(linkId, token, req.file);
      
      res.json({
        success: true,
        data: result,
        message: 'Receipt uploaded successfully'
      });
    } catch (error) {
      console.error('❌ Error uploading receipt:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to upload receipt',
        error: error.message
      });
    }
  });
};

/**
 * Get missing attachment statistics
 */
const getStatistics = async (req, res) => {
  try {
    const companyId = req.company.id;
    const { days = 30 } = req.query;
    
    const since = new Date();
    since.setDate(since.getDate() - parseInt(days));
    
    const totalLinks = await UploadLink.count({
      companyId,
      createdAt: { $gte: since }
    });
    
    const usedLinks = await UploadLink.count({
      companyId,
      used: true,
      createdAt: { $gte: since }
    });
    
    const expiredLinks = await UploadLink.count({
      companyId,
      used: false,
      expiresAt: { $lt: new Date() },
      createdAt: { $gte: since }
    });
    
    const config = await MissingAttachmentConfig.findOne({ companyId });
    
    res.json({
      success: true,
      data: {
        period: `${days} days`,
        totalLinks,
        usedLinks,
        expiredLinks,
        activeLinks: totalLinks - usedLinks - expiredLinks,
        conversionRate: totalLinks > 0 ? ((usedLinks / totalLinks) * 100).toFixed(2) : 0,
        totalNotificationsSent: config?.totalNotificationsSent || 0,
        totalTransactionsProcessed: config?.totalTransactionsProcessed || 0
      }
    });
  } catch (error) {
    console.error('❌ Error getting statistics:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get statistics',
      error: error.message
    });
  }
};

/**
 * Clean up expired upload links
 */
const cleanupExpiredLinks = async (req, res) => {
  try {
    const { days = 30 } = req.query;
    
    console.log(`🧹 Cleaning up expired links older than ${days} days`);
    
    const results = await missingAttachmentService.cleanupExpiredLinks(parseInt(days));
    
    res.json({
      success: true,
      data: results,
      message: `Cleaned up ${results.deletedCount} expired upload links`
    });
  } catch (error) {
    console.error('❌ Error cleaning up expired links:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to clean up expired links',
      error: error.message
    });
  }
};

/**
 * Get duplicate link statistics
 */
const getDuplicateStats = async (req, res) => {
  try {
    const companyId = req.company.id;
    
    const stats = await missingAttachmentService.getDuplicateStats(companyId);
    
    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('❌ Error getting duplicate stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get duplicate statistics',
      error: error.message
    });
  }
};

/**
 * Check Xero token expiry status
 */
const checkTokenStatus = async (req, res) => {
  try {
    const companyId = req.company.id;
    
    const tokenStatus = await missingAttachmentService.checkTokenExpiryStatus(companyId);
    
    res.json({
      success: true,
      data: tokenStatus
    });
  } catch (error) {
    console.error('❌ Error checking token status:', error);
    
    // Handle specific Xero connection errors
    if (error.message.includes('Xero settings not found') || 
        error.message.includes('Xero not connected')) {
      return res.status(400).json({
        success: false,
        message: 'Xero integration not configured. Please connect to Xero first.',
        error: 'XERO_NOT_CONFIGURED',
        requiresConfiguration: true
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Failed to check token status',
      error: error.message
    });
  }
};

module.exports = {
  getConfig,
  updateConfig,
  getNotificationStatus,
  detectMissingAttachments,
  processMissingAttachments,
  getUploadLinks,
  getUploadPage,
  uploadReceipt,
  getStatistics,
  cleanupExpiredLinks,
  getDuplicateStats,
  checkTokenStatus
};
