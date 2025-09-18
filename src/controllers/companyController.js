const Company = require('../models/Company');
const CompanyCompliance = require('../models/CompanyCompliance');
const { generateToken } = require('../utils/jwt');
const { complianceDetailsSchema } = require('../utils/validation');

// Register new company
const register = async (req, res, next) => {
  try {
    const company = await Company.create(req.body);
    const token = generateToken({ id: company.id });

    res.status(201).json({
      success: true,
      message: 'Company registered successfully',
      data: {
        company: company.toJSON(),
        token
      }
    });
  } catch (error) {
    next(error);
  }
};

// Register new super admin
const registerSuperAdmin = async (req, res, next) => {
  try {
    const company = await Company.create({ ...req.body, role: 'superadmin' });
    const token = generateToken({ id: company.id });

    res.status(201).json({
      success: true,
      message: 'Super Admin registered successfully',
      data: {
        company: company.toJSON(),
        token
      }
    });
  } catch (error) {
    next(error);
  }
};

// Login company
const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const company = await Company.findByEmail(email);

    if (!company) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    const isPasswordValid = await company.verifyPassword(password);

    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    const token = generateToken({ id: company.id });
    console.log(company);
    res.status(200).json({
      success: true,
      message: 'Login successful',
      data: {
        company: company.toJSON(),
        token,
        superadmin: company.role === 'superadmin', // Add superadmin flag
        role: company.role // Add role to response
      }
    });
  } catch (error) {
    next(error);
  }
};

// Update compliance details
const updateComplianceDetails = async (req, res, next) => {
  try {
    const updatedCompany = await Company.updateComplianceDetails(req.company.id, req.body);
    res.status(200).json({
      success: true,
      message: 'Compliance details updated successfully',
      data: updatedCompany.toJSON()
    });
  } catch (error) {
    next(error);
  }
};

// Update profile
const updateProfile = async (req, res, next) => {
  try {
    const updatedCompany = await Company.updateProfile(req.company.id, req.body);
    res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      data: updatedCompany.toJSON()
    });
  } catch (error) {
    next(error);
  }
};

// Create or update compliance details for the authenticated company
const upsertComplianceDetails = async (req, res, next) => {
  try {
    // Validate request body
    const { error } = complianceDetailsSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(detail => ({
          field: detail.path.join('.'),
          message: detail.message
        }))
      });
    }
    // Check if compliance record exists
    let compliance = await CompanyCompliance.getByCompanyId(req.company.id);
    if (compliance) {
      compliance = await CompanyCompliance.update(req.company.id, req.body);
    } else {
      compliance = await CompanyCompliance.create(req.company.id, req.body);
    }
    res.status(200).json({
      success: true,
      message: 'Compliance details saved',
      data: compliance.toJSON()
    });
  } catch (error) {
    next(error);
  }
};

// Get compliance details for the authenticated company
const getComplianceDetails = async (req, res, next) => {
  try {
    const compliance = await CompanyCompliance.getByCompanyId(req.company.id);
    if (!compliance) {
      return res.status(404).json({ success: false, message: 'Compliance details not found' });
    }
    res.json({ success: true, data: compliance.toJSON() });
  } catch (error) {
    next(error);
  }
};

// Get all companies (Super Admin only, paginated)
const getAllCompanies = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    const offset = (page - 1) * limit;

    // Get total count (excluding superadmins)
    const countResult = await Company.db.query("SELECT COUNT(*) FROM companies WHERE role != 'superadmin'");
    const total = parseInt(countResult.rows[0].count, 10);

    // Get paginated companies
    const companies = await Company.getAll({ limit, offset });

    res.status(200).json({
      success: true,
      data: companies.map(company => company.toJSON()),
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    next(error);
  }
};

// Get all companies (no pagination, excluding superadmins)
const getAllCompaniesNoPagination = async (req, res, next) => {
  try {
    const companies = await Company.getAllNoPagination();
    res.status(200).json({
      success: true,
      data: companies.map(company => company.toJSON())
    });
  } catch (error) {
    next(error);
  }
};

// Get compliance details for any company (Super Admin only)
const getComplianceDetailsByCompanyId = async (req, res, next) => {
  try {
    const { companyId } = req.params;
    const compliance = await CompanyCompliance.getByCompanyId(companyId);
    if (!compliance) {
      return res.status(404).json({ success: false, message: 'Compliance details not found' });
    }
    res.json({ success: true, data: compliance.toJSON() });
  } catch (error) {
    next(error);
  }
};

// Edit any company (Super Admin)
const editCompany = async (req, res, next) => {
  try {
    const { companyId } = req.params;
    const { isActive, ...profileFields } = req.body;
    let updatedCompany = null;
    // If isActive is provided, update it first
    if (typeof isActive === 'boolean') {
      updatedCompany = await Company.setActiveStatus(companyId, isActive);
      if (!updatedCompany) {
        return res.status(404).json({ success: false, message: 'Company not found' });
      }
    }
    // Update profile fields (includeInactive = true for super admin)
    updatedCompany = await Company.updateProfile(companyId, profileFields, true);
    if (!updatedCompany) {
      return res.status(404).json({ success: false, message: 'Company not found' });
    }
    res.status(200).json({
      success: true,
      message: 'Company updated successfully',
      data: updatedCompany.toJSON()
    });
  } catch (error) {
    next(error);
  }
};

// Activate or deactivate a company (Super Admin)
const setCompanyActiveStatus = async (req, res, next) => {
  try {
    const { companyId } = req.params;
    const { isActive } = req.body;
    if (typeof isActive !== 'boolean') {
      return res.status(400).json({ success: false, message: 'isActive must be a boolean' });
    }
    const updatedCompany = await Company.setActiveStatus(companyId, isActive);
    if (!updatedCompany) {
      return res.status(404).json({ success: false, message: 'Company not found' });
    }
    res.status(200).json({
      success: true,
      message: `Company has been ${isActive ? 'activated' : 'deactivated'}`,
      data: updatedCompany.toJSON()
    });
  } catch (error) {
    next(error);
  }
};

// Get company information by ID (Super Admin)
const getCompanyById = async (req, res, next) => {
  try {
    const { companyId } = req.params;
    const company = await Company.findById(companyId, true); // includeInactive = true
    if (!company) {
      return res.status(404).json({ success: false, message: 'Company not found' });
    }
    const compliance = await CompanyCompliance.getByCompanyId(companyId);
    
    // Get Xero settings for this company
    const XeroSettings = require('../models/XeroSettings');
    const xeroSettings = await XeroSettings.getByCompanyId(companyId);
    
    res.status(200).json({
      success: true,
      data: {
        company: company.toJSON(),
        compliance: compliance ? compliance.toJSON() : null,
        xeroSettings: xeroSettings ? {
          id: xeroSettings.id,
          clientId: xeroSettings.client_id,
          redirectUri: xeroSettings.redirect_uri,
          hasCredentials: !!(xeroSettings.username && xeroSettings.password),
          hasTokens: !!(xeroSettings.access_token && xeroSettings.refresh_token),
          createdAt: xeroSettings.created_at,
          updatedAt: xeroSettings.updated_at
        } : null
      }
    });
  } catch (error) {
    next(error);
  }
};

// Assign Xero client ID to a company (Super Admin)
const assignXeroClientId = async (req, res, next) => {
  try {
    const { companyId } = req.params;
    const { clientId, clientSecret, redirectUri } = req.body;

    if (!clientId || !clientSecret) {
      return res.status(400).json({
        success: false,
        message: 'Client ID and Client Secret are required'
      });
    }

    // Verify company exists
    const company = await Company.findById(companyId, true);
    if (!company) {
      return res.status(404).json({ success: false, message: 'Company not found' });
    }

    // Create or update Xero settings for the company
    const XeroSettings = require('../models/XeroSettings');
    const settingsData = {
      clientId: clientId.trim(),
      clientSecret: clientSecret.trim(),
      redirectUri: redirectUri?.trim() || null
    };

    const settings = await XeroSettings.createSettings(companyId, settingsData);

    res.status(200).json({
      success: true,
      message: 'Xero client ID assigned successfully',
      data: {
        companyId: companyId,
        companyName: company.companyName,
        clientId: settings.client_id,
        redirectUri: settings.redirect_uri,
        createdAt: settings.created_at,
        updatedAt: settings.updated_at
      }
    });
  } catch (error) {
    next(error);
  }
};

// Remove Xero client ID from a company (Super Admin)
const removeXeroClientId = async (req, res, next) => {
  try {
    const { companyId } = req.params;

    // Verify company exists
    const company = await Company.findById(companyId, true);
    if (!company) {
      return res.status(404).json({ success: false, message: 'Company not found' });
    }

    // Remove Xero settings for the company
    const XeroSettings = require('../models/XeroSettings');
    const deletedSettings = await XeroSettings.deleteSettings(companyId);

    if (!deletedSettings) {
      return res.status(404).json({ success: false, message: 'No Xero settings found for this company' });
    }

    res.status(200).json({
      success: true,
      message: 'Xero client ID removed successfully',
      data: {
        companyId: companyId,
        companyName: company.companyName,
        removedAt: new Date().toISOString()
      }
    });
  } catch (error) {
    next(error);
  }
};

// Assign Xero client ID to ALL companies (Super Admin) - Single Click Solution
const assignXeroClientIdToAllCompanies = async (req, res, next) => {
  try {
    const { clientId, clientSecret, redirectUri } = req.body;

    if (!clientId || !clientSecret) {
      return res.status(400).json({
        success: false,
        message: 'Client ID and Client Secret are required'
      });
    }

    // Get all companies (excluding superadmins)
    const companies = await Company.getAllNoPagination();
    
    const results = [];
    const errors = [];

    for (const company of companies) {
      try {
        // Create or update Xero settings for each company
        const XeroSettings = require('../models/XeroSettings');
        const settingsData = {
          clientId: clientId.trim(),
          clientSecret: clientSecret.trim(),
          redirectUri: redirectUri?.trim() || null
        };

        const settings = await XeroSettings.createSettings(company.id, settingsData);
        results.push({
          companyId: company.id,
          companyName: company.companyName,
          success: true
        });
      } catch (error) {
        errors.push({
          companyId: company.id,
          companyName: company.companyName,
          error: error.message
        });
      }
    }

    res.status(200).json({
      success: true,
      message: `Xero client ID assigned to ${results.length} companies`,
      data: {
        totalCompanies: companies.length,
        successful: results.length,
        failed: errors.length,
        results,
        errors
      }
    });
  } catch (error) {
    next(error);
  }
};

// Get all companies with their Xero settings (Super Admin)
const getAllCompaniesWithXeroSettings = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    const offset = (page - 1) * limit;

    // Get total count (excluding superadmins)
    const countResult = await Company.db.query("SELECT COUNT(*) FROM companies WHERE role != 'superadmin'");
    const total = parseInt(countResult.rows[0].count, 10);

    // Get paginated companies with their Xero settings
    const XeroSettings = require('../models/XeroSettings');
    const query = `
      SELECT 
        c.id,
        c.company_name,
        c.email,
        c.mobile_number,
        c.country_code,
        c.role,
        c.is_active,
        c.created_at,
        c.updated_at,
        xs.id as xero_settings_id,
        xs.client_id,
        xs.redirect_uri,
        xs.username,
        xs.password,
        xs.access_token,
        xs.refresh_token,
        xs.token_expires_at,
        xs.created_at as xero_created_at,
        xs.updated_at as xero_updated_at
      FROM companies c
      LEFT JOIN xero_settings xs ON c.id = xs.company_id
      WHERE c.role != 'superadmin'
      ORDER BY c.created_at DESC
      LIMIT $1 OFFSET $2
    `;

    const result = await Company.db.query(query, [limit, offset]);
    const companies = result.rows.map(row => ({
      id: row.id,
      companyName: row.company_name,
      email: row.email,
      mobileNumber: row.mobile_number,
      countryCode: row.country_code,
      role: row.role,
      isActive: row.is_active,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      xeroSettings: row.xero_settings_id ? {
        id: row.xero_settings_id,
        clientId: row.client_id,
        redirectUri: row.redirect_uri,
        hasCredentials: !!(row.username && row.password),
        hasTokens: !!(row.access_token && row.refresh_token),
        createdAt: row.xero_created_at,
        updatedAt: row.xero_updated_at
      } : null
    }));

    res.status(200).json({
      success: true,
      data: companies,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  register,
  login,
  updateComplianceDetails,
  updateProfile,
  registerSuperAdmin, // Export new function
  getAllCompanies, // Export getAllCompanies
  upsertComplianceDetails, // Export new upsert function
  getComplianceDetails, // Export new get function
  getComplianceDetailsByCompanyId, // Export superadmin function
  editCompany, // Export edit company
  setCompanyActiveStatus, // Export activate/deactivate
  getCompanyById, // Export new getCompanyById
  getAllCompaniesNoPagination,
  assignXeroClientId, // Export new Xero client ID management
  removeXeroClientId, // Export new Xero client ID management
  getAllCompaniesWithXeroSettings, // Export new function
  assignXeroClientIdToAllCompanies, // Export bulk assignment function
};

