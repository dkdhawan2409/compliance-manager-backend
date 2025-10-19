const db = require('../config/database');
const bcrypt = require('bcryptjs');

class Company {
  static db = db;
  constructor(data) {
    this.id = data.id;
    this.companyName = data.company_name;
    this.email = data.email;
    this.mobileNumber = data.mobile_number;
    this.countryCode = data.country_code;
    this.passwordHash = data.password_hash;
    this.role = data.role;
    this.isActive = data.is_active;
    this.createdAt = data.created_at;
    this.updatedAt = data.updated_at;
  }

  // Create a new company
  static async create(companyData) {
    const { name, companyName, email, mobileNumber, countryCode, password, role } = companyData;
    
    // Use name if provided, otherwise use companyName
    const finalCompanyName = name || companyName;
    
    // Hash password
    const saltRounds = parseInt(process.env.BCRYPT_SALT_ROUNDS) || 12;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    const query = `
      INSERT INTO companies (company_name, email, mobile_number, country_code, password_hash, role)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `;
    
    const result = await db.query(query, [finalCompanyName, email, mobileNumber, countryCode || '+61', passwordHash, role || 'company']);
    return new Company(result.rows[0]);
  }

  // Find company by email
  static async findByEmail(email) {
    const query = 'SELECT * FROM companies WHERE email = $1 AND is_active = TRUE';
    const result = await db.query(query, [email]);
    
    if (result.rows.length === 0) {
      return null;
    }
    
    return new Company(result.rows[0]);
  }

  // Find company by ID
  static async findById(id, includeInactive = false) {
    const query = includeInactive
      ? 'SELECT * FROM companies WHERE id = $1'
      : 'SELECT * FROM companies WHERE id = $1 AND is_active = TRUE';
    const result = await db.query(query, [id]);
    if (result.rows.length === 0) {
      return null;
    }
    return new Company(result.rows[0]);
  }

  // Update company compliance details

  // Update company profile
  static async updateProfile(id, profileData, includeInactive = false) {
    const { name, companyName, email, mobileNumber, countryCode, accountantEmail } = profileData;
    
    // Use name if provided, otherwise use companyName
    const finalCompanyName = name || companyName;
    
    const query = includeInactive
      ? `UPDATE companies 
           SET company_name = $1, email = $2, mobile_number = $3, country_code = $4, accountant_email = $5
           WHERE id = $6
           RETURNING *`
      : `UPDATE companies 
           SET company_name = $1, email = $2, mobile_number = $3, country_code = $4, accountant_email = $5
           WHERE id = $6 AND is_active = TRUE
           RETURNING *`;
    const result = await db.query(query, [finalCompanyName, email, mobileNumber, countryCode || '+61', accountantEmail, id]);
    if (result.rows.length === 0) {
      return null;
    }
    return new Company(result.rows[0]);
  }

  static async updateComplianceDetails(id, complianceData) {
    try {
      const CompanyCompliance = require("./CompanyCompliance");
      
      // Check if compliance record exists
      let compliance = await CompanyCompliance.getByCompanyId(id);
      
      if (compliance) {
        // Update existing record
        compliance = await CompanyCompliance.update(id, complianceData);
      } else {
        // Create new record
        compliance = await CompanyCompliance.create(id, complianceData);
      }
      
      // Get updated company data
      const company = await Company.findById(id);
      if (!company) {
        throw new Error("Company not found");
      }
      
      // Return company with compliance data
      return company;
    } catch (error) {
      console.error("Error updating compliance details:", error);
      throw error;
    }
  }

  // Activate or deactivate a company
  static async setActiveStatus(id, isActive) {
    const query = `
      UPDATE companies
      SET is_active = $1
      WHERE id = $2
      RETURNING *
    `;
    const result = await db.query(query, [isActive, id]);
    if (result.rows.length === 0) {
      return null;
    }
    return new Company(result.rows[0]);
  }

  // Verify password
  async verifyPassword(password) {
    return await bcrypt.compare(password, this.passwordHash);
  }

  // Get all companies (excluding superadmins) with pagination
  static async getAll({ limit = 10, offset = 0 } = {}) {
    const query = "SELECT * FROM companies WHERE role != 'superadmin' ORDER BY created_at DESC LIMIT $1 OFFSET $2";
    const result = await db.query(query, [limit, offset]);
    return result.rows.map(row => new Company(row));
  }

  // Get all companies (excluding superadmins) with no pagination
  static async getAllNoPagination() {
    const query = "SELECT * FROM companies WHERE role != 'superadmin' ORDER BY created_at DESC";
    const result = await db.query(query);
    return result.rows.map(row => new Company(row));
  }

  // Convert to JSON (exclude sensitive data)
  toJSON() {
    return {
      id: this.id,
      companyName: this.companyName,
      email: this.email,
      mobileNumber: this.mobileNumber,
      countryCode: this.countryCode,
      role: this.role,
      isActive: this.isActive,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt
    };
  }
}

module.exports = Company;
