const db = require('../config/database');

class XeroSettings {
  /**
   * Create Xero settings for a company
   */
  static async createSettings(companyId, settings) {
    try {
      const { clientId, clientSecret, redirectUri, username, password, organizationName, accessToken } = settings;
      
      // Build dynamic query based on provided fields
      let query, params;
      
      if (username && password) {
        // Credential-based authentication
        query = `
          INSERT INTO xero_settings (company_id, username, password, organization_name, created_at, updated_at)
          VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          ON CONFLICT (company_id) 
          DO UPDATE SET 
            username = EXCLUDED.username,
            password = EXCLUDED.password,
            organization_name = EXCLUDED.organization_name,
            updated_at = CURRENT_TIMESTAMP
          RETURNING *
        `;
        params = [companyId, username, password, organizationName];
      } else if (accessToken) {
        // Token-based authentication
        query = `
          INSERT INTO xero_settings (company_id, access_token, created_at, updated_at)
          VALUES ($1, $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          ON CONFLICT (company_id) 
          DO UPDATE SET 
            access_token = EXCLUDED.access_token,
            updated_at = CURRENT_TIMESTAMP
          RETURNING *
        `;
        params = [companyId, accessToken];
      } else if (clientId && clientSecret) {
        // OAuth-based authentication
        query = `
          INSERT INTO xero_settings (company_id, client_id, client_secret, redirect_uri, created_at, updated_at)
          VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          ON CONFLICT (company_id) 
          DO UPDATE SET 
            client_id = EXCLUDED.client_id,
            client_secret = EXCLUDED.client_secret,
            redirect_uri = EXCLUDED.redirect_uri,
            updated_at = CURRENT_TIMESTAMP
          RETURNING *
        `;
        params = [companyId, clientId, clientSecret, redirectUri];
      } else {
        throw new Error('Invalid settings: must provide either credentials, token, or OAuth settings');
      }
      
      const result = await db.query(query, params);
      return result.rows[0];
    } catch (error) {
      console.error('Error creating Xero settings:', error);
      throw error;
    }
  }

  /**
   * Get Xero settings by company ID
   */
  static async getByCompanyId(companyId) {
    try {
      const query = `
        SELECT * FROM xero_settings 
        WHERE company_id = $1
      `;
      
      const result = await db.query(query, [companyId]);
      return result.rows[0] || null;
    } catch (error) {
      console.error('Error getting Xero settings:', error);
      throw error;
    }
  }

  /**
   * Update Xero settings for a company
   */
  static async updateSettings(companyId, settings) {
    try {
      const { clientId, clientSecret, redirectUri } = settings;
      
      const query = `
        UPDATE xero_settings 
        SET 
          client_id = $2,
          client_secret = $3,
          redirect_uri = $4,
          updated_at = CURRENT_TIMESTAMP
        WHERE company_id = $1
        RETURNING *
      `;
      
      const result = await db.query(query, [companyId, clientId, clientSecret, redirectUri]);
      return result.rows[0];
    } catch (error) {
      console.error('Error updating Xero settings:', error);
      throw error;
    }
  }

  /**
   * Delete Xero settings for a company
   */
  static async deleteSettings(companyId) {
    try {
      const query = `
        DELETE FROM xero_settings 
        WHERE company_id = $1
        RETURNING *
      `;
      
      const result = await db.query(query, [companyId]);
      return result.rows[0];
    } catch (error) {
      console.error('Error deleting Xero settings:', error);
      throw error;
    }
  }

  /**
   * Get all Xero settings (for admin)
   */
  static async getAllSettings() {
    try {
      const query = `
        SELECT 
          xs.*,
          c.company_name,
          c.email
        FROM xero_settings xs
        JOIN companies c ON xs.company_id = c.id
        ORDER BY xs.created_at DESC
      `;
      
      const result = await db.query(query);
      return result.rows;
    } catch (error) {
      console.error('Error getting all Xero settings:', error);
      throw error;
    }
  }

  /**
   * Find Xero settings by criteria (similar to Sequelize findOne)
   */
  static async findOne(where) {
    try {
      let query = 'SELECT * FROM xero_settings WHERE ';
      const conditions = [];
      const values = [];
      let paramIndex = 1;

      for (const [key, value] of Object.entries(where)) {
        const dbKey = key.replace(/([A-Z])/g, '_$1').toLowerCase();
        conditions.push(`${dbKey} = $${paramIndex++}`);
        values.push(value);
      }

      query += conditions.join(' AND ');

      const result = await db.query(query, values);
      return result.rows[0] || null;
    } catch (error) {
      console.error('Error finding Xero settings:', error);
      throw error;
    }
  }

  /**
   * Create the xero_settings table
   */
  static async createTable() {
    try {
      const query = `
        CREATE TABLE IF NOT EXISTS xero_settings (
          id SERIAL PRIMARY KEY,
          company_id INTEGER NOT NULL UNIQUE REFERENCES companies(id) ON DELETE CASCADE,
          client_id VARCHAR(255) NOT NULL,
          client_secret VARCHAR(255) NOT NULL,
          redirect_uri VARCHAR(500) NOT NULL,
          access_token TEXT,
          refresh_token TEXT,
          token_expires_at TIMESTAMP,
          tenant_id VARCHAR(255),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `;
      
      await db.query(query);
      
      // Create index for faster lookups
      await db.query(`
        CREATE INDEX IF NOT EXISTS idx_xero_settings_company_id ON xero_settings(company_id)
      `);
      
      console.log('Xero settings table created successfully');
    } catch (error) {
      console.error('Error creating xero_settings table:', error);
      throw error;
    }
  }

  /**
   * Add token columns if they don't exist (for existing tables)
   */
  static async addTokenColumns() {
    try {
      // Check if access_token column exists
      const checkQuery = `
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'xero_settings' AND column_name = 'access_token'
      `;
      
      const result = await db.query(checkQuery);
      
      if (result.rows.length === 0) {
        // Add token columns
        await db.query(`
          ALTER TABLE xero_settings 
          ADD COLUMN access_token TEXT,
          ADD COLUMN refresh_token TEXT,
          ADD COLUMN token_expires_at TIMESTAMP
        `);
        
        console.log('Token columns added to xero_settings table');
      } else {
        console.log('Token columns already exist in xero_settings table');
      }
    } catch (error) {
      console.error('Error adding token columns:', error);
      throw error;
    }
  }

  /**
   * Add tenant_id column if it doesn't exist (for existing tables)
   */
  static async addTenantIdColumn() {
    try {
      // Check if tenant_id column exists
      const checkQuery = `
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'xero_settings' AND column_name = 'tenant_id'
      `;
      
      const result = await db.query(checkQuery);
      
      if (result.rows.length === 0) {
        // Add tenant_id column
        await db.query(`
          ALTER TABLE xero_settings 
          ADD COLUMN tenant_id VARCHAR(255)
        `);
        
        console.log('Tenant ID column added to xero_settings table');
      } else {
        console.log('Tenant ID column already exists in xero_settings table');
      }
    } catch (error) {
      console.error('Error adding tenant_id column:', error);
      throw error;
    }
  }

  /**
   * Add credential columns if they don't exist (for existing tables)
   */
  static async addCredentialColumns() {
    try {
      // Check if username column exists
      const checkQuery = `
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'xero_settings' AND column_name = 'username'
      `;
      
      const result = await db.query(checkQuery);
      
      if (result.rows.length === 0) {
        // Add credential columns
        await db.query(`
          ALTER TABLE xero_settings 
          ADD COLUMN username VARCHAR(255),
          ADD COLUMN password VARCHAR(255),
          ADD COLUMN organization_name VARCHAR(255)
        `);
        
        // Make existing columns nullable since we now support multiple auth methods
        await db.query(`
          ALTER TABLE xero_settings 
          ALTER COLUMN client_id DROP NOT NULL,
          ALTER COLUMN client_secret DROP NOT NULL,
          ALTER COLUMN redirect_uri DROP NOT NULL
        `);
        
        console.log('Credential columns added to xero_settings table');
      } else {
        console.log('Credential columns already exist in xero_settings table');
      }
    } catch (error) {
      console.error('Error adding credential columns:', error);
      throw error;
    }
  }

  /**
   * Sequelize-style upsert method
   */
  static async upsert(data) {
    try {
      const { companyId, clientId, clientSecret, redirectUri, accessToken, refreshToken, tokenExpiresAt, tenants, updatedAt } = data;
      
      const query = `
        INSERT INTO xero_settings (company_id, client_id, client_secret, redirect_uri, access_token, refresh_token, token_expires_at, tenants, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP, $9)
        ON CONFLICT (company_id) 
        DO UPDATE SET 
          client_id = EXCLUDED.client_id,
          client_secret = EXCLUDED.client_secret,
          redirect_uri = EXCLUDED.redirect_uri,
          access_token = EXCLUDED.access_token,
          refresh_token = EXCLUDED.refresh_token,
          token_expires_at = EXCLUDED.token_expires_at,
          tenants = EXCLUDED.tenants,
          updated_at = EXCLUDED.updated_at
        RETURNING *
      `;
      
      const result = await db.query(query, [companyId, clientId, clientSecret, redirectUri, accessToken, refreshToken, tokenExpiresAt, tenants, updatedAt]);
      const row = result.rows[0];
      
      // Return in Sequelize format
      return [row, !row.id]; // [instance, created]
    } catch (error) {
      console.error('Error upserting Xero settings:', error);
      throw error;
    }
  }

  /**
   * Sequelize-style destroy method
   */
  static async destroy(options) {
    try {
      const { where } = options;
      let query = 'DELETE FROM xero_settings WHERE ';
      const conditions = [];
      const values = [];
      let paramIndex = 1;

      for (const [key, value] of Object.entries(where)) {
        const dbKey = key.replace(/([A-Z])/g, '_$1').toLowerCase();
        conditions.push(`${dbKey} = $${paramIndex++}`);
        values.push(value);
      }

      query += conditions.join(' AND ');

      const result = await db.query(query, values);
      return result.rowCount; // Return number of deleted rows
    } catch (error) {
      console.error('Error destroying Xero settings:', error);
      throw error;
    }
  }

  /**
   * Sequelize-style findOne with attributes
   */
  static async findOne(options) {
    try {
      const { where, attributes } = options;
      let query = 'SELECT ';
      
      if (attributes && attributes.exclude) {
        // Get all columns except excluded ones
        const allColumns = ['id', 'company_id', 'client_id', 'client_secret', 'redirect_uri', 'access_token', 'refresh_token', 'token_expires_at', 'tenant_id', 'tenants', 'created_at', 'updated_at'];
        const excludedColumns = attributes.exclude.map(col => col.replace(/([A-Z])/g, '_$1').toLowerCase());
        const selectedColumns = allColumns.filter(col => !excludedColumns.includes(col));
        query += selectedColumns.join(', ');
      } else {
        query += '*';
      }
      
      query += ' FROM xero_settings WHERE ';
      const conditions = [];
      const values = [];
      let paramIndex = 1;

      for (const [key, value] of Object.entries(where)) {
        const dbKey = key.replace(/([A-Z])/g, '_$1').toLowerCase();
        conditions.push(`${dbKey} = $${paramIndex++}`);
        values.push(value);
      }

      query += conditions.join(' AND ');

      const result = await db.query(query, values);
      const row = result.rows[0];
      
      if (!row) return null;
      
      // Add Sequelize-style methods
      row.toJSON = () => row;
      row.update = async (updateData) => {
        const updateQuery = `
          UPDATE xero_settings 
          SET ${Object.keys(updateData).map((key, index) => `${key.replace(/([A-Z])/g, '_$1').toLowerCase()} = $${index + 2}`).join(', ')}, updated_at = CURRENT_TIMESTAMP
          WHERE id = $1
          RETURNING *
        `;
        const updateValues = [row.id, ...Object.values(updateData)];
        const updateResult = await db.query(updateQuery, updateValues);
        return updateResult.rows[0];
      };
      
      return row;
    } catch (error) {
      console.error('Error finding Xero settings:', error);
      throw error;
    }
  }

  /**
   * Get settings for a company
   */
  static async getSettings(companyId) {
    try {
      const result = await db.query(
        'SELECT * FROM xero_settings WHERE company_id = $1',
        [companyId]
      );
      
      return result.rows[0] || null;
    } catch (error) {
      console.error('Error getting Xero settings:', error);
      throw error;
    }
  }

  /**
   * Update tokens for a company
   */
  static async updateTokens(companyId, tokens) {
    try {
      const { accessToken, refreshToken, tokenExpiresAt } = tokens;
      
      const result = await db.query(`
        UPDATE xero_settings 
        SET access_token = $1, 
            refresh_token = $2, 
            token_expires_at = $3,
            updated_at = CURRENT_TIMESTAMP
        WHERE company_id = $4
        RETURNING *
      `, [accessToken, refreshToken, tokenExpiresAt, companyId]);
      
      return result.rows[0];
    } catch (error) {
      console.error('Error updating Xero tokens:', error);
      throw error;
    }
  }
}

module.exports = XeroSettings; 