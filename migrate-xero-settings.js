#!/usr/bin/env node

/**
 * Xero Settings Migration
 * Ensures the xero_settings table has all required columns
 */

const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function runMigration() {
  const client = await pool.connect();
  
  try {
    console.log('🗄️ Running Xero Settings Migration...');

    // Create table if it doesn't exist
    await client.query(`
      CREATE TABLE IF NOT EXISTS xero_settings (
        id SERIAL PRIMARY KEY,
        company_id INTEGER NOT NULL UNIQUE REFERENCES companies(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Add all possible columns (will skip if they exist)
    const columns = [
      'client_id VARCHAR(255)',
      'client_secret VARCHAR(255)', 
      'redirect_uri VARCHAR(500)',
      'access_token TEXT',
      'refresh_token TEXT',
      'token_expires_at TIMESTAMP',
      'username VARCHAR(255)',
      'password VARCHAR(255)',
      'organization_name VARCHAR(255)'
    ];

    for (const column of columns) {
      const columnName = column.split(' ')[0];
      try {
        await client.query(`ALTER TABLE xero_settings ADD COLUMN ${column}`);
        console.log(`✅ Added column: ${columnName}`);
      } catch (error) {
        if (error.message.includes('already exists')) {
          console.log(`⚠️ Column already exists: ${columnName}`);
        } else {
          console.error(`❌ Error adding column ${columnName}:`, error.message);
        }
      }
    }

    // Create OAuth states table
    await client.query(`
      CREATE TABLE IF NOT EXISTS xero_oauth_states (
        id SERIAL PRIMARY KEY,
        state VARCHAR(255) UNIQUE NOT NULL,
        company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create indexes
    // Skip index creation - xero_settings is now a view
    console.log('Skipping index creation on xero_settings (now a view)');
    await client.query(`CREATE INDEX IF NOT EXISTS idx_xero_oauth_states_state ON xero_oauth_states(state)`);

    console.log('✅ Xero Settings Migration completed successfully');
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  runMigration().catch(console.error);
}

module.exports = { runMigration };


