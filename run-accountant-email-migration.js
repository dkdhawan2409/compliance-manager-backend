#!/usr/bin/env node

/**
 * Migration Script: Add accountant_email to companies table
 * 
 * Usage: node run-accountant-email-migration.js
 */

const fs = require('fs');
const path = require('path');
const db = require('./src/config/database');

async function runMigration() {
  console.log('🚀 Running accountant_email migration...');
  
  try {
    // Read the migration SQL file
    const migrationPath = path.join(__dirname, 'migrations', '006_add_accountant_email.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
    
    console.log('📄 Read migration file:', migrationPath);
    
    // Execute the migration
    console.log('⚙️  Executing migration...');
    await db.query(migrationSQL);
    
    console.log('✅ Migration completed successfully!');
    
    // Verify the column was added
    const columnCheck = await db.query(`
      SELECT column_name, data_type, character_maximum_length, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'companies'
      AND column_name = 'accountant_email'
    `);
    
    if (columnCheck.rows.length > 0) {
      console.log('✅ Column accountant_email added successfully');
      console.log('Column details:', columnCheck.rows[0]);
    } else {
      console.error('❌ Column accountant_email was not created');
      process.exit(1);
    }
    
    // Check index
    const indexCheck = await db.query(`
      SELECT indexname
      FROM pg_indexes
      WHERE tablename = 'companies'
      AND indexname = 'idx_companies_accountant_email'
    `);
    
    if (indexCheck.rows.length > 0) {
      console.log('✅ Index idx_companies_accountant_email created successfully');
    }
    
    console.log('\n🎉 Migration completed successfully!');
    console.log('\nNext steps:');
    console.log('1. Update backend API to handle accountant_email field');
    console.log('2. Add accountant email input to frontend Profile page');
    console.log('3. Test saving and retrieving accountant email');
    
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    console.error('Error details:', error.message);
    
    if (error.code === 'ENOENT') {
      console.error('\n📁 Migration file not found. Please ensure the file exists:');
      console.error('   backend/migrations/006_add_accountant_email.sql');
    } else if (error.code === '42701') {
      console.warn('\n⚠️  Column already exists. This is OK if you re-run the migration.');
      console.log('✅ Migration considered successful');
      process.exit(0);
    } else {
      console.error('\n💡 Troubleshooting tips:');
      console.error('   - Check your database connection settings in .env');
      console.error('   - Ensure PostgreSQL is running');
      console.error('   - Verify database user has ALTER TABLE permissions');
    }
    
    process.exit(1);
  }
}

// Run the migration
runMigration();

