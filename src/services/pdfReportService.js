const PDFDocument = require('pdfkit');

// Labels for BAS and FAS fields to keep PDFs easy to read
const BAS_FIELD_LABELS = {
  G1: 'Total Sales (G1)',
  G2: 'Export Sales (G2)',
  G3: 'GST Free Sales (G3)',
  G10: 'Capital Purchases (G10)',
  G11: 'Non-Capital Purchases (G11)',
  '1A': 'GST on Sales (1A)',
  '1B': 'GST on Purchases (1B)',
  W1: 'Total Wages (W1)',
  W2: 'PAYG Withholding (W2)'
};

const FAS_FIELD_LABELS = {
  A1: 'Total Fringe Benefits (A1)',
  A2: 'Reportable Fringe Benefits (A2)',
  A3: 'Reportable Benefits Amount (A3)',
  A4: 'GST Credits (A4)',
  A5: 'FBT Payable (A5)',
  A6: 'FBT Rate (A6)',
  A7: 'Type 1 Benefits (A7)',
  A8: 'Type 2 Benefits (A8)',
  A9: 'Employee Contribution (A9)'
};

const formatCurrency = (value) => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return 'N/A';
  }
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(Number(value));
};

const formatPercentage = (value) => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return 'N/A';
  }
  return `${Number(value).toFixed(2)}%`;
};

const createDocumentBuffer = (render) =>
  new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      margin: 50,
      size: 'A4',
      info: {
        Title: 'Compliance Report',
        Author: 'Compliance Management System'
      }
    });
    const buffers = [];

    doc.on('data', (chunk) => buffers.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);

    render(doc);
    doc.end();
  });

const addSectionHeading = (doc, text) => {
  doc.moveDown();
  doc.font('Helvetica-Bold').fontSize(14).text(text);
  doc.moveDown(0.5);
  doc.font('Helvetica').fontSize(11);
};

const addKeyValueList = (doc, entries) => {
  entries.forEach(({ label, value }) => {
    doc.font('Helvetica-Bold').text(`${label}:`, { continued: true });
    doc.font('Helvetica').text(` ${value}`);
  });
};

const addFieldTable = (doc, labelMap, data = {}) => {
  Object.entries(labelMap).forEach(([key, label]) => {
    if (data[key] === undefined || data[key] === null) {
      return;
    }

    const value =
      key === 'A6' ? formatPercentage(data[key]) : formatCurrency(data[key]);

    doc.font('Helvetica-Bold').text(`${label}:`, { continued: true });
    doc.font('Helvetica').text(` ${value}`);
  });
};

const generateBASReportPdf = async ({
  companyName,
  basData,
  summary = {},
  metadata = {}
}) => {
  const generatedAt = metadata.generatedAt || new Date().toISOString();
  const preparedBy = metadata.preparedBy || 'Automated System';
  const notes = metadata.notes || 'Generated via Compliance Management System.';

  return createDocumentBuffer((doc) => {
    doc.font('Helvetica-Bold').fontSize(18).text('Business Activity Statement (BAS)', {
      align: 'center'
    });

    doc.moveDown();
    doc.font('Helvetica').fontSize(12).text(`Company: ${companyName || 'Unknown Company'}`);
    doc.text(`Reporting Period: ${basData?.BAS_Period || 'Not specified'}`);
    doc.text(`Generated At: ${generatedAt}`);
    doc.text(`Prepared By: ${preparedBy}`);

    addSectionHeading(doc, 'Key Figures');
    addFieldTable(doc, BAS_FIELD_LABELS, basData?.BAS_Fields || {});

    addSectionHeading(doc, 'Summary Overview');
    addKeyValueList(doc, [
      { label: 'Total Sales', value: formatCurrency(summary.totalSales) },
      { label: 'GST on Sales', value: formatCurrency(summary.totalGST) },
      { label: 'Net GST', value: formatCurrency(summary.netGST) },
      { label: 'Total Wages', value: formatCurrency(summary.totalWages) },
      { label: 'PAYG Withholding', value: formatCurrency(summary.paygWithholding) }
    ]);

    addSectionHeading(doc, 'System Notes');
    doc.text(notes, {
      align: 'left'
    });

    if (metadata.disclaimer) {
      addSectionHeading(doc, 'Disclaimer');
      doc.text(metadata.disclaimer, {
        align: 'left'
      });
    }
  });
};

const generateFASReportPdf = async ({
  companyName,
  fasData,
  summary = {},
  metadata = {}
}) => {
  const generatedAt = metadata.generatedAt || new Date().toISOString();
  const preparedBy = metadata.preparedBy || 'Automated System';
  const notes = metadata.notes || 'Generated via Compliance Management System.';

  return createDocumentBuffer((doc) => {
    doc.font('Helvetica-Bold').fontSize(18).text('Fringe Benefits Tax Activity Statement (FAS)', {
      align: 'center'
    });

    doc.moveDown();
    doc.font('Helvetica').fontSize(12).text(`Company: ${companyName || 'Unknown Company'}`);
    doc.text(`Reporting Period: ${fasData?.FAS_Period || 'Not specified'}`);
    doc.text(`Generated At: ${generatedAt}`);
    doc.text(`Prepared By: ${preparedBy}`);

    addSectionHeading(doc, 'Key Figures');
    addFieldTable(doc, FAS_FIELD_LABELS, fasData?.FAS_Fields || {});

    addSectionHeading(doc, 'Summary Overview');
    addKeyValueList(doc, [
      { label: 'Total Fringe Benefits', value: formatCurrency(summary.totalFringeBenefits) },
      { label: 'FBT Payable', value: formatCurrency(summary.fbtPayable) },
      { label: 'FBT Rate', value: summary.fbtRate !== undefined ? formatPercentage(summary.fbtRate) : 'N/A' },
      { label: 'Reportable Benefits', value: formatCurrency(summary.reportableBenefits) }
    ]);

    addSectionHeading(doc, 'System Notes');
    doc.text(notes, {
      align: 'left'
    });

    if (metadata.disclaimer) {
      addSectionHeading(doc, 'Disclaimer');
      doc.text(metadata.disclaimer, {
        align: 'left'
      });
    }
  });
};

module.exports = {
  generateBASReportPdf,
  generateFASReportPdf
};
