#!/usr/bin/env node

/**
 * Xero OAuth2 Migration
 * Updates database schema to support proper OAuth2 flow
 */

const db = require('../config/database');

async function runOAuth2Migration() {
  try {
    console.log('🗄️ Running Xero OAuth2 Migration...');

    // Update xero_settings table for OAuth2 support
    await db.query(`
      CREATE TABLE IF NOT EXISTS xero_settings (
        id SERIAL PRIMARY KEY,
        company_id INTEGER NOT NULL UNIQUE REFERENCES companies(id) ON DELETE CASCADE,
        client_id VARCHAR(255),
        client_secret VARCHAR(255),
        redirect_uri VARCHAR(500),
        access_token TEXT,
        refresh_token TEXT,
        token_expires_at TIMESTAMP,
        xero_user_id VARCHAR(255),
        tenant_data JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Add new columns if they don't exist
    const newColumns = [
      'xero_user_id VARCHAR(255)',
      'tenant_data JSONB'
    ];

    for (const column of newColumns) {
      const columnName = column.split(' ')[0];
      try {
        await db.query(`ALTER TABLE xero_settings ADD COLUMN ${column}`);
        console.log(`✅ Added column: ${columnName}`);
      } catch (error) {
        if (error.message.includes('already exists')) {
          console.log(`⚠️ Column already exists: ${columnName}`);
        } else {
          console.error(`❌ Error adding column ${columnName}:`, error.message);
        }
      }
    }

    // Create OAuth states table for CSRF protection
    await db.query(`
      CREATE TABLE IF NOT EXISTS xero_oauth_states (
        id SERIAL PRIMARY KEY,
        state VARCHAR(255) UNIQUE NOT NULL,
        company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create indexes for performance
    // Skip index creation - xero_settings is now a view
    console.log('Skipping index creation on xero_settings (now a view)');
    await db.query(`CREATE INDEX IF NOT EXISTS idx_xero_oauth_states_state ON xero_oauth_states(state)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_xero_oauth_states_company_id ON xero_oauth_states(company_id)`);

    // Clean up old expired states
    await db.query(`DELETE FROM xero_oauth_states WHERE created_at < NOW() - INTERVAL '1 hour'`);

    console.log('✅ Xero OAuth2 Migration completed successfully');

  } catch (error) {
    console.error('❌ OAuth2 Migration failed:', error);
    throw error;
  }
}

if (require.main === module) {
  runOAuth2Migration()
    .then(() => {
      console.log('🎉 Migration completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Migration failed:', error);
      process.exit(1);
    });
}

module.exports = { runOAuth2Migration };
