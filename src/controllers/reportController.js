const pdfReportService = require('../services/pdfReportService');

const sanitizeForFilename = (value, fallback) => {
  if (!value || typeof value !== 'string') {
    return fallback;
  }

  const sanitized = value.replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '');
  return sanitized.length > 0 ? sanitized : fallback;
};

class ReportController {
  async generateBASPdf(req, res) {
    try {
      const { basData, summary, metadata } = req.body || {};

      if (!basData || !basData.BAS_Period || !basData.BAS_Fields) {
        return res.status(400).json({
          success: false,
          message: 'Invalid BAS payload. Expected basData with BAS_Period and BAS_Fields.'
        });
      }

      const companyName =
        metadata?.companyName || req.company?.name || 'Unknown Company';

      const pdfBuffer = await pdfReportService.generateBASReportPdf({
        companyName,
        basData,
        summary: summary || {},
        metadata: {
          ...(metadata || {}),
          generatedAt: metadata?.generatedAt || new Date().toISOString(),
          preparedBy: metadata?.preparedBy || req.company?.contactName || req.company?.email || 'Automated System'
        }
      });

      const periodFragment = sanitizeForFilename(
        basData.BAS_Period,
        'BAS_Report'
      );
      const filename = `BAS_Report_${periodFragment}.pdf`;

      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': pdfBuffer.length
      });

      return res.send(pdfBuffer);
    } catch (error) {
      console.error('❌ Error generating BAS PDF:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to generate BAS PDF.',
        error: error.message
      });
    }
  }

  async generateFASPdf(req, res) {
    try {
      const { fasData, summary, metadata } = req.body || {};

      if (!fasData || !fasData.FAS_Period || !fasData.FAS_Fields) {
        return res.status(400).json({
          success: false,
          message: 'Invalid FAS payload. Expected fasData with FAS_Period and FAS_Fields.'
        });
      }

      const companyName =
        metadata?.companyName || req.company?.name || 'Unknown Company';

      const pdfBuffer = await pdfReportService.generateFASReportPdf({
        companyName,
        fasData,
        summary: summary || {},
        metadata: {
          ...(metadata || {}),
          generatedAt: metadata?.generatedAt || new Date().toISOString(),
          preparedBy: metadata?.preparedBy || req.company?.contactName || req.company?.email || 'Automated System'
        }
      });

      const periodFragment = sanitizeForFilename(
        fasData.FAS_Period,
        'FAS_Report'
      );
      const filename = `FAS_Report_${periodFragment}.pdf`;

      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': pdfBuffer.length
      });

      return res.send(pdfBuffer);
    } catch (error) {
      console.error('❌ Error generating FAS PDF:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to generate FAS PDF.',
        error: error.message
      });
    }
  }
}

module.exports = new ReportController();
