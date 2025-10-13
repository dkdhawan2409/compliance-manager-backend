const twilio = require('twilio');
const NotificationSetting = require('../models/NotificationSetting');
// Optional import for nodemailer (may not exist in production)
let nodemailer;
try {
  nodemailer = require('nodemailer');
} catch (error) {
  console.log('⚠️ Nodemailer not available:', error.message);
  nodemailer = null;
}

class NotificationService {
  constructor() {
    // Twilio configuration
    this.twilioAccountSid = process.env.TWILIO_ACCOUNT_SID;
    this.twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;
    this.twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER;
    
    // Email configuration
    this.emailHost = process.env.EMAIL_HOST || 'smtp.gmail.com';
    this.emailPort = process.env.EMAIL_PORT || 587;
    this.emailUser = process.env.EMAIL_USER;
    this.emailPassword = process.env.EMAIL_PASSWORD;
    
    // Initialize Twilio client if credentials are available
    if (this.twilioAccountSid && this.twilioAuthToken) {
      this.twilioClient = twilio(this.twilioAccountSid, this.twilioAuthToken);
    }
    
    // Initialize email transporter if credentials are available and nodemailer exists
    if (this.emailUser && this.emailPassword && nodemailer) {
      this.emailTransporter = nodemailer.createTransporter({
        host: this.emailHost,
        port: this.emailPort,
        secure: false,
        auth: {
          user: this.emailUser,
          pass: this.emailPassword
        }
      });
    }
  }

  async ensureTwilioClient() {
    if (this.twilioClient && this.twilioPhoneNumber) {
      return true;
    }

    try {
      const twilioConfig = await NotificationSetting.getTwilioSettings();
      if (twilioConfig?.accountSid && twilioConfig?.authToken) {
        this.twilioAccountSid = twilioConfig.accountSid;
        this.twilioAuthToken = twilioConfig.authToken;
        this.twilioPhoneNumber = twilioConfig.fromNumber || twilioConfig.phoneNumber || this.twilioPhoneNumber;
        this.twilioClient = twilio(this.twilioAccountSid, this.twilioAuthToken);
        return true;
      }
    } catch (error) {
      console.error('❌ Failed to load Twilio settings from database:', error);
    }

    return false;
  }

  /**
   * Send SMS notification using Twilio
   * @param {string} phoneNumber - Recipient phone number
   * @param {string} message - SMS message content
   * @returns {Promise<Object>} Twilio response
   */
  async sendSMS(phoneNumber, message) {
    try {
      const hasClient = await this.ensureTwilioClient();
      if (!hasClient) {
        throw new Error('Twilio not configured. Please set environment variables or configure Twilio credentials in the admin notification settings.');
      }

      if (!this.twilioPhoneNumber) {
        throw new Error('Twilio phone number not configured. Please set TWILIO_PHONE_NUMBER environment variable or provide a From Number in the admin notification settings.');
      }

      console.log(`📱 Sending SMS to ${phoneNumber}: ${message.substring(0, 50)}...`);

      const result = await this.twilioClient.messages.create({
        body: message,
        from: this.twilioPhoneNumber,
        to: phoneNumber
      });

      console.log(`✅ SMS sent successfully. SID: ${result.sid}`);
      return {
        success: true,
        sid: result.sid,
        status: result.status,
        message: 'SMS sent successfully'
      };

    } catch (error) {
      console.error('❌ Failed to send SMS:', error);
      return {
        success: false,
        error: error.message,
        message: 'Failed to send SMS'
      };
    }
  }

  /**
   * Send email notification
   * @param {string} to - Recipient email address
   * @param {string} subject - Email subject
   * @param {string} htmlContent - HTML email content
   * @param {string} textContent - Plain text email content
   * @returns {Promise<Object>} Email sending result
   */
  async sendEmail(to, subject, htmlContent, textContent = '') {
    try {
      if (!nodemailer) {
        throw new Error('Nodemailer not available. Email service is disabled.');
      }
      
      if (!this.emailTransporter) {
        throw new Error('Email not configured. Please set EMAIL_USER and EMAIL_PASSWORD environment variables.');
      }

      console.log(`📧 Sending email to ${to}: ${subject}`);

      const mailOptions = {
        from: this.emailUser,
        to: to,
        subject: subject,
        html: htmlContent,
        text: textContent
      };

      const result = await this.emailTransporter.sendMail(mailOptions);
      
      console.log(`✅ Email sent successfully. Message ID: ${result.messageId}`);
      return {
        success: true,
        messageId: result.messageId,
        message: 'Email sent successfully'
      };

    } catch (error) {
      console.error('❌ Failed to send email:', error);
      return {
        success: false,
        error: error.message,
        message: 'Failed to send email'
      };
    }
  }

  /**
   * Send missing attachment notification via SMS and Email
   * @param {Object} config - Company notification configuration
   * @param {Array} missingAttachments - Array of missing attachment records
   * @param {string} companyName - Company name
   * @returns {Promise<Object>} Notification results
   */
  async sendMissingAttachmentNotification(config, missingAttachments, companyName) {
    const results = {
      sms: null,
      email: null,
      totalMissing: missingAttachments.length
    };

    // Prepare notification content
    const missingCount = missingAttachments.length;
    const baseMessage = `${companyName}: ${missingCount} transaction(s) missing attachments`;
    
    // SMS message (limited to 160 characters)
    const smsMessage = `${baseMessage}. Login to upload receipts: ${process.env.FRONTEND_URL || 'https://compliance-manager-frontend.onrender.com'}`;
    
    // Email content
    const emailSubject = `Missing Attachments Alert - ${companyName}`;
    const emailHtml = this.generateMissingAttachmentEmailHtml(missingAttachments, companyName, missingCount);
    const emailText = this.generateMissingAttachmentEmailText(missingAttachments, companyName, missingCount);

    const smsEnabled = config.enableSMS ?? config.smsEnabled ?? false;
    const emailEnabled = config.enableEmail ?? config.emailEnabled ?? false;

    // Send SMS if enabled and phone number is provided
    if (smsEnabled && config.phoneNumber) {
      console.log(`📱 Sending SMS notification for ${missingCount} missing attachments`);
      results.sms = await this.sendSMS(config.phoneNumber, smsMessage);
    } else {
      console.log('📱 SMS notification skipped - not enabled or no phone number');
      results.sms = {
        success: false,
        message: 'SMS notification disabled or no phone number configured'
      };
    }

    // Send Email if enabled and email address is provided
    if (emailEnabled && config.emailAddress) {
      console.log(`📧 Sending email notification for ${missingCount} missing attachments`);
      results.email = await this.sendEmail(config.emailAddress, emailSubject, emailHtml, emailText);
    } else {
      console.log('📧 Email notification skipped - not enabled or no email address');
      results.email = {
        success: false,
        message: 'Email notification disabled or no email address configured'
      };
    }

    return results;
  }

  /**
   * Generate HTML email content for missing attachments
   * @param {Array} missingAttachments - Array of missing attachment records
   * @param {string} companyName - Company name
   * @param {number} missingCount - Number of missing attachments
   * @returns {string} HTML email content
   */
  generateMissingAttachmentEmailHtml(missingAttachments, companyName, missingCount) {
    const frontendUrl = process.env.FRONTEND_URL || 'https://compliance-manager-frontend.onrender.com';
    
    let transactionsHtml = '';
    missingAttachments.slice(0, 10).forEach((attachment, index) => {
      transactionsHtml += `
        <tr style="border-bottom: 1px solid #eee;">
          <td style="padding: 12px; text-align: left;">${index + 1}</td>
          <td style="padding: 12px; text-align: left;">${attachment.transaction_id || 'N/A'}</td>
          <td style="padding: 12px; text-align: left;">$${(attachment.amount || 0).toFixed(2)}</td>
          <td style="padding: 12px; text-align: left;">${attachment.date || 'N/A'}</td>
          <td style="padding: 12px; text-align: left;">${attachment.description || 'No description'}</td>
        </tr>
      `;
    });

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Missing Attachments Alert</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #f4f4f4; padding: 20px; border-radius: 5px; margin-bottom: 20px; }
          .alert { background: #fff3cd; border: 1px solid #ffeaa7; padding: 15px; border-radius: 5px; margin-bottom: 20px; }
          table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
          th { background: #f8f9fa; padding: 12px; text-align: left; border-bottom: 2px solid #dee2e6; }
          .button { display: inline-block; background: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; margin: 20px 0; }
          .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; font-size: 12px; color: #666; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1 style="margin: 0; color: #333;">Missing Attachments Alert</h1>
            <p style="margin: 5px 0 0 0; color: #666;">Compliance Management System</p>
          </div>
          
          <div class="alert">
            <h2 style="margin: 0 0 10px 0; color: #856404;">⚠️ Action Required</h2>
            <p style="margin: 0; font-size: 16px;">
              <strong>${companyName}</strong> has <strong>${missingCount}</strong> transaction(s) missing required attachments.
            </p>
          </div>

          <h3>Missing Attachments Summary</h3>
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Transaction ID</th>
                <th>Amount</th>
                <th>Date</th>
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              ${transactionsHtml}
            </tbody>
          </table>

          ${missingCount > 10 ? `<p><strong>Note:</strong> Showing first 10 of ${missingCount} missing attachments.</p>` : ''}

          <div style="text-align: center;">
            <a href="${frontendUrl}/missing-attachments" class="button">Upload Missing Receipts</a>
          </div>

          <div class="footer">
            <p>This is an automated notification from your Compliance Management System.</p>
            <p>Please log in to upload the missing receipts to maintain compliance.</p>
            <p>If you have any questions, please contact your system administrator.</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  /**
   * Generate plain text email content for missing attachments
   * @param {Array} missingAttachments - Array of missing attachment records
   * @param {string} companyName - Company name
   * @param {number} missingCount - Number of missing attachments
   * @returns {string} Plain text email content
   */
  generateMissingAttachmentEmailText(missingAttachments, companyName, missingCount) {
    const frontendUrl = process.env.FRONTEND_URL || 'https://compliance-manager-frontend.onrender.com';
    
    let transactionsText = '';
    missingAttachments.slice(0, 10).forEach((attachment, index) => {
      transactionsText += `${index + 1}. Transaction: ${attachment.transaction_id || 'N/A'} | Amount: $${(attachment.amount || 0).toFixed(2)} | Date: ${attachment.date || 'N/A'}\n`;
    });

    return `
MISSING ATTACHMENTS ALERT
Compliance Management System

⚠️ ACTION REQUIRED

${companyName} has ${missingCount} transaction(s) missing required attachments.

MISSING ATTACHMENTS SUMMARY:
${transactionsText}

${missingCount > 10 ? `Note: Showing first 10 of ${missingCount} missing attachments.\n` : ''}

To upload missing receipts, please visit:
${frontendUrl}/missing-attachments

This is an automated notification from your Compliance Management System.
Please log in to upload the missing receipts to maintain compliance.

If you have any questions, please contact your system administrator.
    `.trim();
  }

  /**
   * Validate phone number format
   * @param {string} phoneNumber - Phone number to validate
   * @returns {boolean} True if valid format
   */
  validatePhoneNumber(phoneNumber) {
    if (!phoneNumber || typeof phoneNumber !== 'string') {
      return false;
    }
    
    // Remove all non-digit characters except +
    const cleaned = phoneNumber.replace(/[^\d+]/g, '');
    
    // Check if it's a valid international format (+ followed by 7-15 digits)
    if (cleaned.startsWith('+')) {
      const digits = cleaned.substring(1);
      return /^\d{7,15}$/.test(digits);
    }
    
    // Check if it's a valid national format (7-15 digits, may start with 0)
    return /^\d{7,15}$/.test(cleaned);
  }

  /**
   * Validate email address format
   * @param {string} email - Email address to validate
   * @returns {boolean} True if valid format
   */
  validateEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  /**
   * Check if notification service is properly configured
   * @returns {Object} Configuration status
   */
  getConfigurationStatus() {
    return {
      twilio: {
        configured: !!(this.twilioAccountSid && this.twilioAuthToken && this.twilioPhoneNumber),
        hasAccountSid: !!this.twilioAccountSid,
        hasAuthToken: !!this.twilioAuthToken,
        hasPhoneNumber: !!this.twilioPhoneNumber
      },
      email: {
        configured: !!(nodemailer && this.emailUser && this.emailPassword),
        hasUser: !!this.emailUser,
        hasPassword: !!this.emailPassword,
        host: this.emailHost,
        port: this.emailPort,
        nodemailerAvailable: !!nodemailer
      }
    };
  }
}

module.exports = new NotificationService();
