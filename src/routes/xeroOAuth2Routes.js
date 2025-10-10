const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const xeroOAuth2Controller = require('../controllers/xeroOAuth2Controller');
const basController = require('../controllers/basController');
const fasController = require('../controllers/fasController');
const { 
  ensureValidXeroToken, 
  optionalValidXeroToken, 
  requireXeroConnection,
  handleXeroRateLimit,
  handleXeroErrors,
  logXeroRequests
} = require('../middleware/xeroTokenRefresh');

// Settings management (for backward compatibility)
const cleanXeroController = require('../controllers/cleanXeroController');
router.post('/settings', auth, cleanXeroController.saveSettings);
router.get('/settings', auth, cleanXeroController.getSettings);
router.delete('/settings', auth, cleanXeroController.deleteSettings);

// OAuth2 flow routes
router.get('/auth-url', auth, xeroOAuth2Controller.getAuthUrl);
router.get('/login', auth, xeroOAuth2Controller.getAuthUrl); // Alias for auth-url
router.get('/connect', auth, xeroOAuth2Controller.connectXero);
router.post('/callback', xeroOAuth2Controller.handleCallback); // POST route for frontend API calls
router.post('/callback-api', xeroOAuth2Controller.handleCallback); // Alternative POST route
router.post('/oauth-callback', xeroOAuth2Controller.handleCallback); // Another alternative POST route
router.get('/callback', xeroOAuth2Controller.handleCallback); // GET route for OAuth redirects

// Connection management
router.get('/status', auth, xeroOAuth2Controller.getConnectionStatus);
router.get('/tenants', auth, xeroOAuth2Controller.getTenants);
router.delete('/disconnect', auth, xeroOAuth2Controller.disconnect);

// Token management
router.post('/refresh-token', auth, xeroOAuth2Controller.refreshToken);

// Connections endpoint (alias for tenants)
router.get('/connections', auth, xeroOAuth2Controller.getTenants);

// Data access routes
router.get('/data/:dataType', auth, xeroOAuth2Controller.getXeroData);

// Organization data routes
router.get('/organizations', auth, ensureValidXeroToken, xeroOAuth2Controller.getOrganizations);

// BAS data routes
router.get('/bas-data', auth, ensureValidXeroToken, basController.getBASData);
router.get('/bas-data/current', auth, ensureValidXeroToken, basController.getCurrentBASData);
router.get('/bas-data/summary', auth, ensureValidXeroToken, basController.getBASSummary);
router.get('/bas-data/calculation', auth, ensureValidXeroToken, basController.getBASCalculation);
router.post('/sync/bas', auth, ensureValidXeroToken, basController.syncBASData);

// FAS data routes
router.get('/fas-data', auth, ensureValidXeroToken, fasController.getFASData);
router.get('/fas-data/current', auth, ensureValidXeroToken, fasController.getCurrentFASData);
router.get('/fas-data/summary', auth, ensureValidXeroToken, fasController.getFASSummary);
router.get('/fas-data/calculation', auth, ensureValidXeroToken, fasController.getFASCalculation);
router.get('/fas-data/categories', auth, ensureValidXeroToken, fasController.getFBTCategories);
router.post('/sync/fas', auth, ensureValidXeroToken, fasController.syncFASData);

// Manual sync routes
router.post('/sync', auth, ensureValidXeroToken, xeroOAuth2Controller.syncData);
router.post('/sync/all', auth, ensureValidXeroToken, xeroOAuth2Controller.syncAllData);

// Data retrieval with cache
router.get('/invoices', auth, ensureValidXeroToken, xeroOAuth2Controller.getInvoices);
router.get('/contacts', auth, ensureValidXeroToken, xeroOAuth2Controller.getContacts);
router.get('/accounts', auth, ensureValidXeroToken, xeroOAuth2Controller.getAccounts);
router.get('/bills', auth, ensureValidXeroToken, xeroOAuth2Controller.getBills);
router.get('/bank-transactions', auth, ensureValidXeroToken, xeroOAuth2Controller.getBankTransactions);

// Apply Xero-specific middleware
router.use(handleXeroRateLimit);
router.use(logXeroRequests);
router.use(handleXeroErrors);

module.exports = router;
