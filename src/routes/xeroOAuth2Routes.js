const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const xeroOAuth2Controller = require('../controllers/xeroOAuth2Controller');

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

module.exports = router;
