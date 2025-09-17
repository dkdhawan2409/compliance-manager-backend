const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const xeroController = require('../controllers/xeroController');
const auth = require('../middleware/auth');

// Xero-specific rate limiter - more permissive for development
const xeroLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === 'development' ? 500 : 50, // more permissive in development
  message: {
    success: false,
    message: 'Too many Xero API requests, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// OAuth2 Authentication
router.get('/login', auth, xeroController.buildAuthUrl);
router.post('/callback', xeroController.handleCallback);
router.get('/callback', xeroController.handleCallback); // Add GET route for OAuth2 callback

// Company Information
router.get('/company-info', auth, xeroController.getCompanyInfo);

// Connection Status
router.get('/connection-status', auth, xeroController.getConnectionStatus);

// Token Management
router.post('/refresh-token', xeroController.refreshToken);

// Data Access - Individual Resources
router.post('/data/:resourceType', auth, xeroController.getXeroData);

// Comprehensive Data Endpoints
router.get('/dashboard-data', auth, xeroController.getDashboardData);
// router.get('/lightweight-dashboard', auth, xeroController.getLightweightDashboard); // TODO: Implement this function
router.get('/financial-summary', auth, xeroController.getFinancialSummary);
router.get('/financial-summary-optimized', auth, xeroController.getFinancialSummaryOptimized);
router.get('/all-invoices', auth, xeroController.getAllInvoices);
router.get('/all-contacts', auth, xeroController.getAllContacts);
router.get('/all-bank-transactions', auth, xeroController.getAllBankTransactions);
router.get('/all-accounts', auth, xeroController.getAllAccounts);
router.get('/all-items', auth, xeroController.getAllItems);
router.get('/all-tax-rates', auth, xeroController.getAllTaxRates);
router.get('/all-tracking-categories', auth, xeroController.getAllTrackingCategories);
router.get('/organization-details', auth, xeroController.getOrganizationDetails);

// Additional Xero API Endpoints
router.get('/all-purchase-orders', auth, xeroController.getAllPurchaseOrders);
router.get('/all-receipts', auth, xeroController.getAllReceipts);
router.get('/all-credit-notes', auth, xeroController.getAllCreditNotes);
router.get('/all-manual-journals', auth, xeroController.getAllManualJournals);
router.get('/all-prepayments', auth, xeroController.getAllPrepayments);
router.get('/all-overpayments', auth, xeroController.getAllOverpayments);
router.get('/all-quotes', auth, xeroController.getAllQuotes);
router.get('/reports', auth, xeroController.getAllReports);

// Xero Settings Management
router.post('/settings', xeroLimiter, auth, xeroController.createXeroSettings);
router.get('/settings', xeroLimiter, auth, xeroController.getXeroSettings);
router.delete('/settings', xeroLimiter, auth, xeroController.deleteXeroSettings);
router.get('/settings/all', xeroLimiter, auth, xeroController.getAllXeroSettings);
router.post('/settings/update-redirect-uris', xeroLimiter, auth, xeroController.updateAllRedirectUris);

// Super Admin - Company Management for Xero
router.get('/admin/companies', xeroLimiter, auth, xeroController.getCompaniesForXeroManagement);

// Admin - Credential Status Check
router.get('/admin/check-credentials', auth, xeroController.checkAdminCredentials);

// Xero-specific state creation for OAuth
router.post('/create-auth-state', auth, xeroController.createXeroAuthState);
router.get('/auth-state/:state', auth, xeroController.getXeroAuthState);

module.exports = router; 