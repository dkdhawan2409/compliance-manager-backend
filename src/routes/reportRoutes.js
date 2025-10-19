const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const reportController = require('../controllers/reportController');

router.use(authMiddleware);

router.post('/bas/pdf', reportController.generateBASPdf);
router.post('/fas/pdf', reportController.generateFASPdf);

module.exports = router;
