const express = require('express');
const router = express.Router();
const missingAttachmentController = require('../controllers/missingAttachmentController');
const auth = require('../middleware/auth');
const { 
  validateCompanyDataAccess, 
  addCompanyContext,
  validateUploadLinkOwnership,
  validateFileAccess
} = require('../middleware/companyIsolation');

// Configuration routes (require authentication + company isolation)
router.get('/config', auth, addCompanyContext, validateCompanyDataAccess, missingAttachmentController.getConfig);
router.put('/config', auth, addCompanyContext, validateCompanyDataAccess, missingAttachmentController.updateConfig);
router.get('/notification-status', auth, addCompanyContext, validateCompanyDataAccess, missingAttachmentController.getNotificationStatus);

// Detection and processing routes (require authentication + company isolation)
router.get('/detect', auth, addCompanyContext, validateCompanyDataAccess, missingAttachmentController.detectMissingAttachments);
router.post('/process', auth, addCompanyContext, validateCompanyDataAccess, missingAttachmentController.processMissingAttachments);

// Upload link management (require authentication + company isolation)
router.get('/upload-links', auth, addCompanyContext, validateCompanyDataAccess, missingAttachmentController.getUploadLinks);
router.get('/statistics', auth, addCompanyContext, validateCompanyDataAccess, missingAttachmentController.getStatistics);
router.delete('/cleanup', auth, addCompanyContext, validateCompanyDataAccess, missingAttachmentController.cleanupExpiredLinks);
router.get('/duplicates', auth, addCompanyContext, validateCompanyDataAccess, missingAttachmentController.getDuplicateStats);
router.get('/token-status', auth, addCompanyContext, validateCompanyDataAccess, missingAttachmentController.checkTokenStatus);

// Public upload routes (no authentication required)
router.get('/upload/:linkId', missingAttachmentController.getUploadPage);
router.post('/upload/:linkId', missingAttachmentController.uploadReceipt);

// Secure file serving (require authentication + company validation)
router.get('/files/company_:companyId/:fileName', auth, validateFileAccess, (req, res) => {
  const { companyId, fileName } = req.params;
  const path = require('path');
  const filePath = path.join(process.cwd(), 'uploads', 'receipts', `company_${companyId}`, fileName);
  
  console.log(`🔒 [Company ${companyId}] Serving file: ${fileName}`);
  
  // Serve the file if it exists and belongs to the company
  res.sendFile(filePath, (err) => {
    if (err) {
      console.error(`❌ Error serving file for company ${companyId}:`, err);
      res.status(404).json({
        success: false,
        message: 'File not found'
      });
    }
  });
});

module.exports = router;
