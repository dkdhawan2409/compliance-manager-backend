const express = require('express');
const router = express.Router();
const xeroController = require('../controllers/xeroController');
const authMiddleware = require('../middleware/auth');

// OAuth Routes (no authentication required)
router.get('/connect', authMiddleware, xeroController.connect);
router.get('/callback', xeroController.callback);

// Apply authentication middleware to all other routes
router.use(authMiddleware);

// Status and Organization Routes
router.get('/status', xeroController.getStatus);
router.get('/tenants', xeroController.getTenants);

// Data Routes (all support tenantId query parameter)
router.get('/invoices', xeroController.getInvoices);
router.get('/contacts', xeroController.getContacts);
router.get('/bas-data', xeroController.getBASData);
router.get('/bas-data/pdf', xeroController.generateBASPDF);
router.get('/fas-data', xeroController.getFASData);
router.get('/fas-data/pdf', xeroController.generateFASPDF);
router.get('/financial-summary', xeroController.getFinancialSummary);
router.get('/dashboard', xeroController.getDashboardData);

// Management Routes
router.delete('/cache', xeroController.clearCache);
router.delete('/disconnect', xeroController.disconnect);

module.exports = router;