const PDFDocument = require('pdfkit');

/**
 * Enhanced PDF Generation Service for BAS and FAS Reports
 * Creates comprehensive, detailed ATO-compliant reports
 */
class PDFGenerationService {
  
  /**
   * Generate Comprehensive BAS Report PDF
   * @param {Object} basData - BAS data from Xero
   * @param {Object} options - Report options (companyName, period, etc.)
   * @returns {PDFDocument} PDF document stream
   */
  generateBASReport(basData, options = {}) {
    const { companyName = 'Unknown Company', fromDate, toDate, quarter } = options;
    
    const doc = new PDFDocument({ 
      size: 'A4', 
      margin: 50,
      bufferPages: true
    });
    
    // PAGE 1: Cover Page & Executive Summary
    this.addCoverPage(doc, 'Business Activity Statement (BAS)', companyName, fromDate, toDate, quarter);
    
    // Calculate summary statistics
    const summary = this.calculateBASSummary(basData);
    this.addExecutiveSummary(doc, summary, 'BAS');
    
    // PAGE 2: GST Report Detailed Breakdown (only if data exists)
    if (basData.gstReport && this.hasContent(basData.gstReport)) {
      doc.addPage();
      this.addDetailedHeader(doc, 'GST Analysis & Breakdown');
      this.addGSTDetailedSection(doc, basData.gstReport, summary);
    }
    
    // PAGE 3: Sales Analysis (only if sales invoices exist)
    const salesInvoices = basData.invoices?.Invoices?.filter(inv => inv.Type === 'ACCREC') || [];
    if (salesInvoices.length > 0) {
      doc.addPage();
      this.addDetailedHeader(doc, 'Sales & Revenue Analysis');
      this.addSalesAnalysis(doc, salesInvoices);
    }
    
    // PAGE 4: Purchase Analysis (only if purchase invoices exist)
    const purchaseInvoices = basData.invoices?.Invoices?.filter(inv => inv.Type === 'ACCPAY') || [];
    if (purchaseInvoices.length > 0) {
      doc.addPage();
      this.addDetailedHeader(doc, 'Purchase & Expense Analysis');
      this.addPurchaseAnalysis(doc, purchaseInvoices);
    }
    
    // PAGE 5: Profit & Loss Statement (only if data exists)
    if (basData.profitLoss && this.hasContent(basData.profitLoss)) {
      doc.addPage();
      this.addDetailedHeader(doc, 'Profit & Loss Statement');
      this.addProfitLossDetailed(doc, basData.profitLoss);
    }
    
    // PAGE 6: Balance Sheet (only if data exists)
    if (basData.balanceSheet && this.hasContent(basData.balanceSheet)) {
      doc.addPage();
      this.addDetailedHeader(doc, 'Balance Sheet Summary');
      this.addBalanceSheetDetailed(doc, basData.balanceSheet);
    }
    
    // PAGE 7: Invoices Detailed List (only if invoices exist)
    if (basData.invoices?.Invoices && basData.invoices.Invoices.length > 0) {
      doc.addPage();
      this.addDetailedHeader(doc, 'Invoice Register');
      this.addDetailedInvoiceList(doc, basData.invoices.Invoices);
    }
    
    // PAGE 8: Compliance Notes & Recommendations (always include)
    doc.addPage();
    this.addComplianceNotes(doc, summary, 'BAS');
    
    // Add footer to all buffered pages
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(i);
      this.addFooter(doc, i + 1, range.count);
    }
    
    doc.end();
    return doc;
  }
  
  /**
   * Generate Comprehensive FAS Report PDF
   * @param {Object} fasData - FAS data from Xero
   * @param {Object} options - Report options (companyName, period, etc.)
   * @returns {PDFDocument} PDF document stream
   */
  generateFASReport(fasData, options = {}) {
    const { companyName = 'Unknown Company', fromDate, toDate, quarter } = options;
    
    const doc = new PDFDocument({ 
      size: 'A4', 
      margin: 50,
      bufferPages: true
    });
    
    // PAGE 1: Cover Page & Executive Summary
    this.addCoverPage(doc, 'Fringe Benefits Tax Activity Statement (FAS)', companyName, fromDate, toDate, quarter);
    
    // Calculate FBT summary statistics
    const summary = this.calculateFASSummary(fasData);
    this.addExecutiveSummary(doc, summary, 'FAS');
    
    // PAGE 2: FBT Detailed Breakdown (only if data exists)
    if ((fasData.fasReport && this.hasContent(fasData.fasReport)) || fasData.fbtSummary) {
      doc.addPage();
      this.addDetailedHeader(doc, 'Fringe Benefits Tax Analysis');
      
      if (fasData.fasReport) {
        this.addFBTDetailedSection(doc, fasData.fasReport, summary);
      } else if (fasData.fbtSummary) {
        this.addFBTSummarySection(doc, fasData.fbtSummary);
      }
    }
    
    // PAGE 3: FBT Categories Breakdown (always include - educational)
    doc.addPage();
    this.addDetailedHeader(doc, 'FBT Categories & Benefits Analysis');
    this.addFBTCategoriesBreakdown(doc, fasData);
    
    // PAGE 4: Employee Benefits Analysis (always include - shows structure)
    doc.addPage();
    this.addDetailedHeader(doc, 'Employee Benefits Summary');
    this.addEmployeeBenefitsAnalysis(doc, fasData);
    
    // PAGE 5: Profit & Loss Context (only if data exists)
    if (fasData.profitLoss && this.hasContent(fasData.profitLoss)) {
      doc.addPage();
      this.addDetailedHeader(doc, 'Profit & Loss Statement');
      this.addProfitLossDetailed(doc, fasData.profitLoss);
    }
    
    // PAGE 6: Balance Sheet (only if data exists)
    if (fasData.balanceSheet && this.hasContent(fasData.balanceSheet)) {
      doc.addPage();
      this.addDetailedHeader(doc, 'Balance Sheet Summary');
      this.addBalanceSheetDetailed(doc, fasData.balanceSheet);
    }
    
    // PAGE 7: Transactions Detail (only if data exists)
    const hasTransactions = (fasData.transactions?.Transactions && fasData.transactions.Transactions.length > 0) ||
                           (fasData.bankTransactions?.BankTransactions && fasData.bankTransactions.BankTransactions.length > 0);
    if (hasTransactions) {
      doc.addPage();
      this.addDetailedHeader(doc, 'Transaction Details');
      this.addTransactionsSummary(doc, fasData.transactions || fasData.bankTransactions);
    }
    
    // PAGE 8: FBT Calculation Worksheet (always include - shows methodology)
    doc.addPage();
    this.addFBTCalculationWorksheet(doc, summary);
    
    // PAGE 9: Compliance Notes & Recommendations (always include)
    doc.addPage();
    this.addComplianceNotes(doc, summary, 'FAS');
    
    // Add footer to all buffered pages
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(i);
      this.addFooter(doc, i + 1, range.count);
    }
    
    doc.end();
    return doc;
  }
  
  /**
   * Add document header
   */
  addHeader(doc, title, companyName) {
    // Title
    doc.fontSize(20).fillColor('#1e40af').font('Helvetica-Bold');
    doc.text(title, 50, 50, { align: 'center' });
    
    // Company Name
    doc.fontSize(14).fillColor('#4b5563').font('Helvetica');
    doc.text(companyName, 50, 80, { align: 'center' });
    
    // Horizontal line
    doc.strokeColor('#e5e7eb').lineWidth(1);
    doc.moveTo(50, 120).lineTo(545, 120).stroke();
  }
  
  /**
   * Add footer with page numbers
   */
  addFooter(doc, pageNumber, totalPages) {
    const bottomMargin = doc.page.height - 50;
    
    doc.fontSize(9).fillColor('#9ca3af').font('Helvetica');
    doc.text(
      `Page ${pageNumber} of ${totalPages}`,
      50,
      bottomMargin,
      { align: 'center', width: 495 }
    );
    
    doc.text(
      'Generated by Compliance Management System',
      50,
      bottomMargin + 15,
      { align: 'center', width: 495 }
    );
  }
  
  /**
   * Add a section with data
   */
  addSection(doc, title, data) {
    // Section title
    doc.fontSize(14).fillColor('#1e40af').font('Helvetica-Bold');
    doc.text(title, 50);
    doc.moveDown(0.5);
    
    // Process report data
    if (data.Reports && Array.isArray(data.Reports)) {
      data.Reports.forEach((report) => {
        if (report.Rows) {
          this.processReportRows(doc, report.Rows);
        }
      });
    } else {
      // If it's not a standard report, try to display key-value pairs
      doc.fontSize(10).fillColor('#374151').font('Helvetica');
      Object.entries(data).slice(0, 20).forEach(([key, value]) => {
        if (typeof value !== 'object') {
          doc.text(`${key}: ${value}`, 70);
        }
      });
    }
    
    doc.moveDown();
  }
  
  /**
   * Process and render report rows
   */
  processReportRows(doc, rows, indent = 0) {
    if (!Array.isArray(rows)) return;
    
    rows.forEach((row) => {
      if (!row) return;
      
      // Handle section headers
      if (row.RowType === 'Section' && row.Title) {
        doc.fontSize(12).fillColor('#1e40af').font('Helvetica-Bold');
        doc.text(row.Title, 50 + (indent * 20));
        doc.moveDown(0.3);
        
        if (Array.isArray(row.Rows)) {
          this.processReportRows(doc, row.Rows, indent + 1);
        }
        return;
      }
      
      // Handle data rows
      if (Array.isArray(row.Cells) && row.Cells.length > 0) {
        doc.fontSize(10).fillColor('#374151').font('Helvetica');
        
        const description = row.Cells[0]?.Value || '';
        const value = row.Cells[row.Cells.length - 1]?.Value || '';
        
        // Format value as currency if it's a number
        let formattedValue = value;
        if (!isNaN(parseFloat(value))) {
          const numValue = parseFloat(value);
          formattedValue = `$${numValue.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        }
        
        // Draw description on left, value on right
        const yPos = doc.y;
        doc.text(description, 50 + (indent * 20), yPos, { width: 350, continued: false });
        doc.text(formattedValue, 420, yPos, { width: 125, align: 'right' });
        doc.moveDown(0.2);
      }
    });
  }
  
  /**
   * Add invoices summary table
   */
  addInvoicesSummary(doc, invoices, title) {
    doc.fontSize(14).fillColor('#1e40af').font('Helvetica-Bold');
    doc.text(title, 50);
    doc.moveDown(0.5);
    
    // Table headers
    doc.fontSize(10).fillColor('#1e40af').font('Helvetica-Bold');
    doc.text('Invoice #', 50, doc.y, { width: 80, continued: true });
    doc.text('Contact', 130, doc.y, { width: 150, continued: true });
    doc.text('Date', 280, doc.y, { width: 80, continued: true });
    doc.text('Amount', 360, doc.y, { width: 90, continued: true });
    doc.text('Status', 450, doc.y, { width: 95 });
    doc.moveDown(0.3);
    
    // Draw line under headers
    doc.strokeColor('#e5e7eb').lineWidth(0.5);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
    doc.moveDown(0.3);
    
    // Invoice data
    doc.fontSize(9).fillColor('#374151').font('Helvetica');
    const invoicesToShow = invoices.slice(0, 20); // Limit to 20 invoices
    
    invoicesToShow.forEach((invoice, index) => {
      const yPos = doc.y;
      
      // Check if we need a new page
      if (yPos > 700) {
        doc.addPage();
        doc.fontSize(10).fillColor('#1e40af').font('Helvetica-Bold');
        doc.text('Invoice #', 50, 50, { width: 80, continued: true });
        doc.text('Contact', 130, 50, { width: 150, continued: true });
        doc.text('Date', 280, 50, { width: 80, continued: true });
        doc.text('Amount', 360, 50, { width: 90, continued: true });
        doc.text('Status', 450, 50, { width: 95 });
        doc.moveDown(0.3);
        doc.fontSize(9).fillColor('#374151').font('Helvetica');
      }
      
      const invoiceNumber = invoice.InvoiceNumber || invoice.InvoiceID || '—';
      const contactName = invoice.Contact?.Name || '—';
      const date = invoice.Date ? new Date(invoice.Date).toLocaleDateString('en-AU') : '—';
      const total = invoice.Total ? `$${parseFloat(invoice.Total).toLocaleString('en-AU', { minimumFractionDigits: 2 })}` : '—';
      const status = invoice.Status || '—';
      
      doc.text(invoiceNumber, 50, doc.y, { width: 80, continued: true });
      doc.text(contactName, 130, doc.y, { width: 150, continued: true });
      doc.text(date, 280, doc.y, { width: 80, continued: true });
      doc.text(total, 360, doc.y, { width: 90, continued: true });
      doc.text(status, 450, doc.y, { width: 95 });
      doc.moveDown(0.4);
      
      // Add a light line between rows
      if (index < invoicesToShow.length - 1) {
        doc.strokeColor('#f3f4f6').lineWidth(0.5);
        doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
        doc.moveDown(0.2);
      }
    });
    
    if (invoices.length > 20) {
      doc.moveDown(0.5);
      doc.fontSize(9).fillColor('#6b7280').font('Helvetica-Oblique');
      doc.text(`Showing 20 of ${invoices.length} total invoices`, 50);
    }
  }

  /**
   * Add enhanced cover page
   */
  addCoverPage(doc, title, companyName, fromDate, toDate, quarter) {
    // Large title
    doc.fontSize(28).fillColor('#1e40af').font('Helvetica-Bold');
    doc.text(title, 50, 100, { align: 'center', width: 495 });
    
    // Company name
    doc.fontSize(18).fillColor('#374151').font('Helvetica');
    doc.text(companyName, 50, 160, { align: 'center', width: 495 });
    
    // Decorative line
    doc.strokeColor('#1e40af').lineWidth(2);
    doc.moveTo(150, 200).lineTo(445, 200).stroke();
    
    // Period box
    doc.rect(100, 230, 395, 120).fillAndStroke('#f3f4f6', '#e5e7eb');
    
    doc.fontSize(14).fillColor('#1e40af').font('Helvetica-Bold');
    doc.text('Reporting Period', 120, 250);
    
    doc.fontSize(12).fillColor('#374151').font('Helvetica');
    doc.text(`From: ${fromDate}`, 120, 275);
    doc.text(`To: ${toDate}`, 120, 295);
    
    if (quarter) {
      doc.text(`Quarter: ${quarter}`, 120, 315);
    }
    
    // Generation info
    doc.fontSize(10).fillColor('#6b7280').font('Helvetica');
    doc.text(`Report Generated: ${new Date().toLocaleString('en-AU')}`, 50, 400, { align: 'center', width: 495 });
    doc.text('Compliance Management System', 50, 420, { align: 'center', width: 495 });
    
    // ATO Compliance notice
    doc.rect(100, 500, 395, 80).fillAndStroke('#fef3c7', '#f59e0b');
    doc.fontSize(10).fillColor('#92400e').font('Helvetica-Bold');
    doc.text('⚠️ ATO COMPLIANCE NOTICE', 120, 515);
    doc.fontSize(9).fillColor('#92400e').font('Helvetica');
    doc.text('This report is generated from Xero data and should be reviewed', 120, 535);
    doc.text('by a qualified accountant before lodging with the ATO.', 120, 550);
  }

  /**
   * Add detailed section header
   */
  addDetailedHeader(doc, title) {
    doc.fontSize(16).fillColor('#1e40af').font('Helvetica-Bold');
    doc.text(title, 50, 50);
    
    doc.strokeColor('#1e40af').lineWidth(1.5);
    doc.moveTo(50, 75).lineTo(545, 75).stroke();
    
    doc.moveDown(2);
  }

  /**
   * Calculate BAS summary statistics
   */
  calculateBASSummary(basData) {
    let totalSales = 0;
    let totalPurchases = 0;
    let gstOnSales = 0;
    let gstOnPurchases = 0;
    let invoiceCount = 0;
    let salesInvoiceCount = 0;
    let purchaseInvoiceCount = 0;
    let overdueCount = 0;

    if (basData.invoices?.Invoices) {
      basData.invoices.Invoices.forEach(invoice => {
        invoiceCount++;
        const subtotal = parseFloat(invoice.SubTotal || 0);
        const tax = parseFloat(invoice.TotalTax || 0);
        
        if (invoice.Type === 'ACCREC') {
          salesInvoiceCount++;
          totalSales += subtotal;
          gstOnSales += tax;
          if (invoice.Status === 'OVERDUE') overdueCount++;
        } else if (invoice.Type === 'ACCPAY') {
          purchaseInvoiceCount++;
          totalPurchases += subtotal;
          gstOnPurchases += tax;
        }
      });
    }

    return {
      totalSales,
      totalPurchases,
      gstOnSales,
      gstOnPurchases,
      netGST: gstOnSales - gstOnPurchases,
      invoiceCount,
      salesInvoiceCount,
      purchaseInvoiceCount,
      overdueCount,
      averageInvoiceValue: invoiceCount > 0 ? (totalSales + totalPurchases) / invoiceCount : 0
    };
  }

  /**
   * Calculate FAS summary statistics
   */
  calculateFASSummary(fasData) {
    // Placeholder FBT calculations - would need actual FBT data
    return {
      totalFBT: 0,
      fbtOnCars: 0,
      fbtOnEntertainment: 0,
      fbtOnOther: 0,
      grossTaxableValue: 0,
      fbtPayable: 0,
      fbtRate: 47, // Current FBT rate
      employeeCount: 0
    };
  }

  /**
   * Add executive summary
   */
  addExecutiveSummary(doc, summary, reportType) {
    doc.fontSize(14).fillColor('#1e40af').font('Helvetica-Bold');
    doc.text('Executive Summary', 50, 620);
    
    doc.strokeColor('#e5e7eb').lineWidth(1);
    doc.moveTo(50, 645).lineTo(545, 645).stroke();
    
    doc.moveDown(1);
    doc.fontSize(10).fillColor('#374151').font('Helvetica');
    
    if (reportType === 'BAS') {
      const rows = [
        ['Total Sales (excl. GST)', this.formatCurrency(summary.totalSales)],
        ['GST on Sales', this.formatCurrency(summary.gstOnSales)],
        ['Total Purchases (excl. GST)', this.formatCurrency(summary.totalPurchases)],
        ['GST on Purchases', this.formatCurrency(summary.gstOnPurchases)],
        ['Net GST Payable', this.formatCurrency(summary.netGST)],
        ['', ''],
        ['Total Invoices Processed', summary.invoiceCount.toString()],
        ['Sales Invoices', summary.salesInvoiceCount.toString()],
        ['Purchase Invoices', summary.purchaseInvoiceCount.toString()],
        ['Overdue Invoices', summary.overdueCount.toString()]
      ];

      rows.forEach(([label, value]) => {
        if (label) {
          const yPos = doc.y;
          doc.font('Helvetica').text(label, 70, yPos, { width: 300 });
          doc.font('Helvetica-Bold').text(value, 380, yPos, { width: 165, align: 'right' });
          doc.moveDown(0.4);
        } else {
          doc.moveDown(0.3);
        }
      });
    } else {
      // FAS summary
      const rows = [
        ['Total FBT Payable', this.formatCurrency(summary.fbtPayable)],
        ['FBT Rate', `${summary.fbtRate}%`],
        ['Gross Taxable Value', this.formatCurrency(summary.grossTaxableValue)],
        ['FBT on Cars', this.formatCurrency(summary.fbtOnCars)],
        ['FBT on Entertainment', this.formatCurrency(summary.fbtOnEntertainment)],
        ['FBT on Other Benefits', this.formatCurrency(summary.fbtOnOther)]
      ];

      rows.forEach(([label, value]) => {
        const yPos = doc.y;
        doc.font('Helvetica').text(label, 70, yPos, { width: 300 });
        doc.font('Helvetica-Bold').text(value, 380, yPos, { width: 165, align: 'right' });
        doc.moveDown(0.4);
      });
    }
  }

  /**
   * Add GST detailed section
   */
  addGSTDetailedSection(doc, gstReport, summary) {
    // GST Summary Box
    doc.rect(50, doc.y, 495, 100).fillAndStroke('#eff6ff', '#3b82f6');
    
    const startY = doc.y + 10;
    doc.fontSize(12).fillColor('#1e40af').font('Helvetica-Bold');
    doc.text('GST Summary - Key Figures', 70, startY);
    
    doc.fontSize(10).fillColor('#374151').font('Helvetica');
    doc.text(`GST Collected (on Sales): ${this.formatCurrency(summary.gstOnSales)}`, 70, startY + 25);
    doc.text(`GST Paid (on Purchases): ${this.formatCurrency(summary.gstOnPurchases)}`, 70, startY + 45);
    
    doc.fontSize(12).fillColor('#1e40af').font('Helvetica-Bold');
    const netGST = summary.netGST;
    const netGSTText = netGST >= 0 ? 'Net GST Payable to ATO' : 'Net GST Refund from ATO';
    doc.text(`${netGSTText}: ${this.formatCurrency(Math.abs(netGST))}`, 70, startY + 70);
    
    doc.moveDown(8);
    
    // Detailed GST Report
    if (gstReport.Reports && gstReport.Reports[0]) {
      this.processReportRows(doc, gstReport.Reports[0].Rows || []);
    }
  }

  /**
   * Add sales analysis
   */
  addSalesAnalysis(doc, salesInvoices) {
    // This method should only be called if salesInvoices exist (checked before page creation)
    if (!salesInvoices || salesInvoices.length === 0) {
      return; // Should not happen, but safeguard
    }

    // Statistics
    const totalSales = salesInvoices.reduce((sum, inv) => sum + parseFloat(inv.SubTotal || 0), 0);
    const totalGST = salesInvoices.reduce((sum, inv) => sum + parseFloat(inv.TotalTax || 0), 0);
    const avgInvoice = totalSales / salesInvoices.length;
    const paid = salesInvoices.filter(inv => inv.Status === 'PAID').length;
    const authorized = salesInvoices.filter(inv => inv.Status === 'AUTHORISED').length;
    const overdue = salesInvoices.filter(inv => inv.Status === 'OVERDUE').length;

    // Stats boxes
    const boxY = 100;
    this.addStatBox(doc, 'Total Sales', this.formatCurrency(totalSales), 50, boxY, 115, 70, '#10b981');
    this.addStatBox(doc, 'GST Collected', this.formatCurrency(totalGST), 175, boxY, 115, 70, '#3b82f6');
    this.addStatBox(doc, 'Invoices', salesInvoices.length.toString(), 300, boxY, 115, 70, '#8b5cf6');
    this.addStatBox(doc, 'Avg Invoice', this.formatCurrency(avgInvoice), 425, boxY, 115, 70, '#f59e0b');
    
    doc.y = boxY + 90;
    
    // Status breakdown
    doc.fontSize(12).fillColor('#1e40af').font('Helvetica-Bold');
    doc.text('Invoice Status Breakdown', 50);
    doc.moveDown(0.5);
    
    doc.fontSize(10).fillColor('#374151').font('Helvetica');
    doc.text(`✅ Paid: ${paid} invoices`, 70);
    doc.text(`📋 Authorized: ${authorized} invoices`, 70);
    doc.text(`⚠️  Overdue: ${overdue} invoices`, 70);
    
    doc.moveDown(2);
    
    // Top customers
    const customerSales = {};
    salesInvoices.forEach(inv => {
      const customer = inv.Contact?.Name || 'Unknown';
      const amount = parseFloat(inv.Total || 0);
      customerSales[customer] = (customerSales[customer] || 0) + amount;
    });
    
    const topCustomers = Object.entries(customerSales)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    
    if (topCustomers.length > 0) {
      doc.fontSize(12).fillColor('#1e40af').font('Helvetica-Bold');
      doc.text('Top 5 Customers', 50);
      doc.moveDown(0.5);
      
      doc.fontSize(10).fillColor('#374151').font('Helvetica');
      topCustomers.forEach(([customer, amount], index) => {
        const yPos = doc.y;
        doc.text(`${index + 1}. ${customer}`, 70, yPos, { width: 300 });
        doc.font('Helvetica-Bold').text(this.formatCurrency(amount), 380, yPos, { width: 165, align: 'right' });
        doc.font('Helvetica').moveDown(0.4);
      });
    }
  }

  /**
   * Add purchase analysis
   */
  addPurchaseAnalysis(doc, purchaseInvoices) {
    // This method should only be called if purchaseInvoices exist (checked before page creation)
    if (!purchaseInvoices || purchaseInvoices.length === 0) {
      return; // Should not happen, but safeguard
    }

    // Statistics
    const totalPurchases = purchaseInvoices.reduce((sum, inv) => sum + parseFloat(inv.SubTotal || 0), 0);
    const totalGST = purchaseInvoices.reduce((sum, inv) => sum + parseFloat(inv.TotalTax || 0), 0);
    const avgPurchase = totalPurchases / purchaseInvoices.length;
    const paid = purchaseInvoices.filter(inv => inv.Status === 'PAID').length;

    // Stats boxes
    const boxY = 100;
    this.addStatBox(doc, 'Total Purchases', this.formatCurrency(totalPurchases), 50, boxY, 115, 70, '#ef4444');
    this.addStatBox(doc, 'GST Paid', this.formatCurrency(totalGST), 175, boxY, 115, 70, '#3b82f6');
    this.addStatBox(doc, 'Invoices', purchaseInvoices.length.toString(), 300, boxY, 115, 70, '#8b5cf6');
    this.addStatBox(doc, 'Avg Purchase', this.formatCurrency(avgPurchase), 425, boxY, 115, 70, '#f59e0b');
    
    doc.y = boxY + 90;
    
    // Top suppliers
    const supplierPurchases = {};
    purchaseInvoices.forEach(inv => {
      const supplier = inv.Contact?.Name || 'Unknown';
      const amount = parseFloat(inv.Total || 0);
      supplierPurchases[supplier] = (supplierPurchases[supplier] || 0) + amount;
    });
    
    const topSuppliers = Object.entries(supplierPurchases)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    
    if (topSuppliers.length > 0) {
      doc.fontSize(12).fillColor('#1e40af').font('Helvetica-Bold');
      doc.text('Top 5 Suppliers', 50);
      doc.moveDown(0.5);
      
      doc.fontSize(10).fillColor('#374151').font('Helvetica');
      topSuppliers.forEach(([supplier, amount], index) => {
        const yPos = doc.y;
        doc.text(`${index + 1}. ${supplier}`, 70, yPos, { width: 300 });
        doc.font('Helvetica-Bold').text(this.formatCurrency(amount), 380, yPos, { width: 165, align: 'right' });
        doc.font('Helvetica').moveDown(0.4);
      });
    }
  }

  /**
   * Add profit & loss detailed
   */
  addProfitLossDetailed(doc, profitLoss) {
    // This method should only be called if data exists (checked before page creation)
    if (profitLoss.Reports && profitLoss.Reports[0] && profitLoss.Reports[0].Rows) {
      this.processReportRows(doc, profitLoss.Reports[0].Rows);
    }
  }

  /**
   * Add balance sheet detailed
   */
  addBalanceSheetDetailed(doc, balanceSheet) {
    // This method should only be called if data exists (checked before page creation)
    if (balanceSheet.Reports && balanceSheet.Reports[0] && balanceSheet.Reports[0].Rows) {
      this.processReportRows(doc, balanceSheet.Reports[0].Rows);
    }
  }

  /**
   * Add detailed invoice list
   */
  addDetailedInvoiceList(doc, invoices) {
    const invoicesToShow = invoices.slice(0, 50);
    
    // Summary stats
    doc.fontSize(10).fillColor('#374151').font('Helvetica');
    doc.text(`Total Invoices: ${invoices.length}`, 50, 100);
    doc.text(`Showing: ${Math.min(50, invoices.length)} invoices`, 50, 115);
    doc.moveDown(2);
    
    // Table
    this.addInvoicesSummary(doc, invoicesToShow, 'Complete Invoice Register');
  }

  /**
   * Add compliance notes
   */
  addComplianceNotes(doc, summary, reportType) {
    doc.fontSize(16).fillColor('#1e40af').font('Helvetica-Bold');
    doc.text('Compliance Notes & Recommendations', 50, 50);
    
    doc.strokeColor('#1e40af').lineWidth(1.5);
    doc.moveTo(50, 75).lineTo(545, 75).stroke();
    
    doc.moveDown(2);
    
    // Important notes box
    doc.rect(50, doc.y, 495, 100).fillAndStroke('#fef3c7', '#f59e0b');
    const notesY = doc.y + 10;
    
    doc.fontSize(11).fillColor('#92400e').font('Helvetica-Bold');
    doc.text('⚠️ IMPORTANT COMPLIANCE INFORMATION', 70, notesY);
    
    doc.fontSize(9).fillColor('#92400e').font('Helvetica');
    doc.text('• This report is auto-generated from Xero data', 70, notesY + 25);
    doc.text('• Review all figures with your accountant before lodging', 70, notesY + 40);
    doc.text('• Ensure all transactions are correctly categorized', 70, notesY + 55);
    doc.text('• Verify GST rates applied to all transactions', 70, notesY + 70);
    
    doc.y = notesY + 120;
    doc.moveDown(2);
    
    // Recommendations
    doc.fontSize(12).fillColor('#1e40af').font('Helvetica-Bold');
    doc.text('Recommendations', 50);
    doc.moveDown(0.5);
    
    doc.fontSize(10).fillColor('#374151').font('Helvetica');
    
    if (reportType === 'BAS') {
      const recommendations = [];
      
      if (summary.overdueCount > 0) {
        recommendations.push(`Review ${summary.overdueCount} overdue invoice(s) - may affect cash flow`);
      }
      
      if (summary.netGST > 10000) {
        recommendations.push('High GST payable - ensure sufficient funds for payment');
      }
      
      if (summary.netGST < 0) {
        recommendations.push('GST refund due - lodge BAS promptly to receive refund');
      }
      
      if (summary.salesInvoiceCount < 5) {
        recommendations.push('Low sales activity - verify all sales are recorded');
      }
      
      recommendations.push('Review all draft invoices and convert to authorized');
      recommendations.push('Reconcile bank accounts before lodging BAS');
      recommendations.push('Verify all suppliers have provided tax invoices');
      
      recommendations.forEach((rec, index) => {
        doc.text(`${index + 1}. ${rec}`, 70, doc.y, { width: 475 });
        doc.moveDown(0.6);
      });
    } else {
      // FAS recommendations
      doc.text('1. Review all employee fringe benefits provided', 70);
      doc.moveDown(0.4);
      doc.text('2. Ensure accurate records of car fringe benefits', 70);
      doc.moveDown(0.4);
      doc.text('3. Verify entertainment expenses are correctly classified', 70);
      doc.moveDown(0.4);
      doc.text('4. Check FBT exemptions and reductions are applied', 70);
      doc.moveDown(0.4);
      doc.text('5. Lodge FAS by the due date to avoid penalties', 70);
    }
    
    // Disclaimer
    doc.moveDown(3);
    doc.rect(50, doc.y, 495, 80).fillAndStroke('#f3f4f6', '#d1d5db');
    const disclaimerY = doc.y + 10;
    
    doc.fontSize(8).fillColor('#6b7280').font('Helvetica-Oblique');
    doc.text('DISCLAIMER:', 70, disclaimerY);
    doc.text('This report is provided for informational purposes only. While every effort has been made to ensure', 70, disclaimerY + 15);
    doc.text('accuracy, this report should not be used as a substitute for professional accounting advice. Always', 70, disclaimerY + 27);
    doc.text('consult with a qualified accountant or tax professional before lodging any statements with the ATO.', 70, disclaimerY + 39);
    doc.text('The Compliance Management System is not liable for any errors or omissions.', 70, disclaimerY + 51);
  }

  /**
   * Add FBT detailed section
   */
  addFBTDetailedSection(doc, fasReport, summary) {
    if (fasReport.Reports && fasReport.Reports[0]) {
      this.processReportRows(doc, fasReport.Reports[0].Rows || []);
    }
  }

  /**
   * Add FBT summary section
   */
  addFBTSummarySection(doc, fbtSummary) {
    doc.fontSize(10).fillColor('#374151').font('Helvetica');
    Object.entries(fbtSummary).forEach(([key, value]) => {
      const yPos = doc.y;
      doc.text(key, 70, yPos, { width: 300 });
      doc.font('Helvetica-Bold').text(String(value), 380, yPos, { width: 165, align: 'right' });
      doc.font('Helvetica').moveDown(0.4);
    });
  }

  /**
   * Add FBT categories breakdown
   */
  addFBTCategoriesBreakdown(doc, fasData) {
    doc.fontSize(12).fillColor('#1e40af').font('Helvetica-Bold');
    doc.text('FBT Benefit Categories', 50, 100);
    doc.moveDown(1);
    
    const categories = [
      { name: 'Car Fringe Benefits', description: 'Vehicles provided to employees for private use', rate: '20% statutory rate or operating cost method' },
      { name: 'Entertainment Benefits', description: 'Meals, drinks, and recreation provided to employees', rate: 'Type 1 or Type 2 entertainment' },
      { name: 'Housing Benefits', description: 'Accommodation provided to employees', rate: 'Market value minus employee contributions' },
      { name: 'Loan Benefits', description: 'Low-interest or interest-free loans to employees', rate: 'Benchmark interest rate' },
      { name: 'Expense Payment Benefits', description: 'Reimbursements and allowances', rate: 'Taxable value of benefit' },
      { name: 'Other Benefits', description: 'Other miscellaneous fringe benefits', rate: 'Case-by-case assessment' }
    ];
    
    categories.forEach(cat => {
      const startY = doc.y;
      
      // Check if we need a new page
      if (startY > 650) {
        doc.addPage();
        doc.y = 50;
      }
      
      doc.rect(50, doc.y, 495, 75).fillAndStroke('#f9fafb', '#e5e7eb');
      
      doc.fontSize(11).fillColor('#1e40af').font('Helvetica-Bold');
      doc.text(cat.name, 70, doc.y + 10);
      
      doc.fontSize(9).fillColor('#374151').font('Helvetica');
      doc.text(cat.description, 70, doc.y + 28, { width: 455 });
      doc.fontSize(8).fillColor('#6b7280').font('Helvetica-Oblique');
      doc.text(`Rate/Method: ${cat.rate}`, 70, doc.y + 50);
      
      doc.y += 85;
    });
  }

  /**
   * Add employee benefits analysis
   */
  addEmployeeBenefitsAnalysis(doc, fasData) {
    doc.fontSize(12).fillColor('#1e40af').font('Helvetica-Bold');
    doc.text('Employee Benefits Overview', 50, 100);
    doc.moveDown(1);
    
    doc.fontSize(10).fillColor('#374151').font('Helvetica');
    doc.text('This section provides an overview of fringe benefits provided to employees', 50);
    doc.text('during the reporting period. All benefits are subject to FBT at 47%.', 50);
    doc.moveDown(2);
    
    // Sample benefits table
    const benefits = [
      ['Benefit Type', 'Employees', 'Gross Value', 'FBT Payable'],
      ['Motor Vehicles', '—', '—', '—'],
      ['Entertainment', '—', '—', '—'],
      ['Housing/Accommodation', '—', '—', '—'],
      ['Loans', '—', '—', '—'],
      ['Other Benefits', '—', '—', '—']
    ];
    
    // Draw table
    const tableY = doc.y;
    const colWidths = [200, 80, 120, 120];
    const rowHeight = 25;
    
    benefits.forEach((row, rowIndex) => {
      const currentY = tableY + (rowIndex * rowHeight);
      
      // Draw cells
      let xPos = 50;
      row.forEach((cell, colIndex) => {
        // Cell background
        if (rowIndex === 0) {
          doc.rect(xPos, currentY, colWidths[colIndex], rowHeight).fillAndStroke('#e0e7ff', '#3b82f6');
        } else {
          doc.rect(xPos, currentY, colWidths[colIndex], rowHeight).stroke('#e5e7eb');
        }
        
        // Cell text
        const fontSize = rowIndex === 0 ? 10 : 9;
        const font = rowIndex === 0 ? 'Helvetica-Bold' : 'Helvetica';
        const color = rowIndex === 0 ? '#1e40af' : '#374151';
        
        doc.fontSize(fontSize).fillColor(color).font(font);
        doc.text(cell, xPos + 5, currentY + 8, { width: colWidths[colIndex] - 10, align: colIndex > 0 ? 'right' : 'left' });
        
        xPos += colWidths[colIndex];
      });
    });
    
    doc.y = tableY + (benefits.length * rowHeight) + 20;
    
    doc.fontSize(9).fillColor('#6b7280').font('Helvetica-Oblique');
    doc.text('Note: Detailed benefit data requires manual input from payroll records', 50);
  }

  /**
   * Add transactions summary
   */
  addTransactionsSummary(doc, transactions) {
    // This method should only be called if transactions exist (checked before page creation)
    if (!transactions || !transactions.Transactions || transactions.Transactions.length === 0) {
      return; // Should not happen, but safeguard
    }
    
    const trans = transactions.Transactions.slice(0, 30);
    
    doc.fontSize(10).fillColor('#374151').font('Helvetica');
    doc.text(`Showing ${trans.length} of ${transactions.Transactions.length} total transactions`, 50, 100);
    doc.moveDown(1);
    
    // Simple transaction list
    trans.forEach((t, index) => {
      if (doc.y > 720) {
        doc.addPage();
        doc.y = 50;
      }
      
      const date = t.Date ? new Date(t.Date).toLocaleDateString('en-AU') : '—';
      const reference = t.Reference || t.TransactionID || '—';
      const amount = t.Total || t.Amount || 0;
      
      doc.fontSize(9).fillColor('#374151').font('Helvetica');
      const yPos = doc.y;
      doc.text(`${index + 1}. ${date}`, 50, yPos, { width: 100 });
      doc.text(reference, 160, yPos, { width: 200 });
      doc.font('Helvetica-Bold').text(this.formatCurrency(amount), 370, yPos, { width: 175, align: 'right' });
      doc.font('Helvetica').moveDown(0.5);
    });
  }

  /**
   * Add FBT calculation worksheet
   */
  addFBTCalculationWorksheet(doc, summary) {
    doc.fontSize(16).fillColor('#1e40af').font('Helvetica-Bold');
    doc.text('FBT Calculation Worksheet', 50, 50);
    
    doc.strokeColor('#1e40af').lineWidth(1.5);
    doc.moveTo(50, 75).lineTo(545, 75).stroke();
    
    doc.moveDown(2);
    
    // Calculation steps
    const calculations = [
      ['Step 1: Gross Taxable Value of Fringe Benefits', ''],
      ['Motor Vehicle Benefits', this.formatCurrency(summary.fbtOnCars || 0)],
      ['Meal Entertainment Benefits', this.formatCurrency(summary.fbtOnEntertainment || 0)],
      ['Other Fringe Benefits', this.formatCurrency(summary.fbtOnOther || 0)],
      ['', ''],
      ['Subtotal - Taxable Value', this.formatCurrency(summary.grossTaxableValue || 0)],
      ['', ''],
      ['Step 2: Apply Gross-Up Factor', ''],
      ['Type 1 Benefits (2.0802)', '—'],
      ['Type 2 Benefits (1.8868)', '—'],
      ['', ''],
      ['Step 3: Calculate FBT Payable', ''],
      ['FBT Rate', '47%'],
      ['FBT Payable', this.formatCurrency(summary.fbtPayable || 0)],
    ];
    
    doc.fontSize(10).fillColor('#374151').font('Helvetica');
    
    calculations.forEach(([label, value]) => {
      if (!label) {
        doc.moveDown(0.3);
        return;
      }
      
      const yPos = doc.y;
      const isMainStep = label.startsWith('Step');
      const isSubtotal = label.includes('Subtotal') || label.includes('FBT Payable');
      
      if (isMainStep) {
        doc.fontSize(11).fillColor('#1e40af').font('Helvetica-Bold');
        doc.text(label, 50, yPos);
        doc.moveDown(0.5);
      } else if (isSubtotal) {
        doc.fontSize(11).fillColor('#1e40af').font('Helvetica-Bold');
        doc.text(label, 70, yPos, { width: 300 });
        doc.text(value, 380, yPos, { width: 165, align: 'right' });
        doc.moveDown(0.6);
      } else {
        doc.fontSize(10).fillColor('#374151').font('Helvetica');
        doc.text(label, 90, yPos, { width: 280 });
        doc.text(value, 380, yPos, { width: 165, align: 'right' });
        doc.moveDown(0.4);
      }
    });
  }

  /**
   * Add stat box
   */
  addStatBox(doc, label, value, x, y, width, height, color) {
    // Box
    doc.rect(x, y, width, height).fillAndStroke('#ffffff', color);
    
    // Label
    doc.fontSize(8).fillColor('#6b7280').font('Helvetica');
    doc.text(label, x + 10, y + 10, { width: width - 20, align: 'center' });
    
    // Value
    doc.fontSize(14).fillColor(color).font('Helvetica-Bold');
    doc.text(value, x + 10, y + 30, { width: width - 20, align: 'center' });
  }

  /**
   * Format currency
   */
  formatCurrency(value) {
    const num = parseFloat(value) || 0;
    return `$${num.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  /**
   * Check if data has meaningful content
   */
  hasContent(data) {
    if (!data) return false;
    
    // Check if it has Reports array with content
    if (data.Reports && Array.isArray(data.Reports)) {
      return data.Reports.some(report => 
        report.Rows && Array.isArray(report.Rows) && report.Rows.length > 0
      );
    }
    
    // Check if it has Rows directly
    if (data.Rows && Array.isArray(data.Rows)) {
      return data.Rows.length > 0;
    }
    
    // Check if it's an object with properties
    if (typeof data === 'object' && data !== null) {
      return Object.keys(data).length > 0;
    }
    
    return false;
  }
}

module.exports = new PDFGenerationService();

