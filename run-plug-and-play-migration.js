#!/usr/bin/env node

/**
 * Migration Script: Create plug_and_play_xero_settings table
 * 
 * This script creates the plug_and_play_xero_settings table and related
 * objects needed for the Xero plug-and-play integration.
 * 
 * Usage: node run-plug-and-play-migration.js
 */

const fs = require('fs');
const path = require('path');
const db = require('./src/config/database');

async function runMigration() {
  console.log('🚀 Starting plug-and-play Xero settings migration...');
  
  try {
    // Read the migration SQL file
    const migrationPath = path.join(__dirname, 'migrations', '004_create_plug_and_play_xero_settings.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
    
    console.log('📄 Read migration file:', migrationPath);
    
    // Execute the migration
    console.log('⚙️  Executing migration...');
    await db.query(migrationSQL);
    
    console.log('✅ Migration completed successfully!');
    
    // Verify the table was created
    const tableCheck = await db.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name = 'plug_and_play_xero_settings'
    `);
    
    if (tableCheck.rows.length > 0) {
      console.log('✅ Table plug_and_play_xero_settings created successfully');
    } else {
      console.error('❌ Table plug_and_play_xero_settings was not created');
      process.exit(1);
    }
    
    // Check if xero_oauth_states table exists
    const oauthTableCheck = await db.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name = 'xero_oauth_states'
    `);
    
    if (oauthTableCheck.rows.length > 0) {
      console.log('✅ Table xero_oauth_states created successfully');
    } else {
      console.error('❌ Table xero_oauth_states was not created');
      process.exit(1);
    }
    
    // Check if view exists
    const viewCheck = await db.query(`
      SELECT table_name 
      FROM information_schema.views 
      WHERE table_schema = 'public' 
      AND table_name = 'xero_settings'
    `);
    
    if (viewCheck.rows.length > 0) {
      console.log('✅ View xero_settings created successfully');
    } else {
      console.warn('⚠️  View xero_settings was not created (may already exist)');
    }
    
    // Display table structure
    console.log('\n📊 Table structure:');
    const columnsResult = await db.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'plug_and_play_xero_settings'
      ORDER BY ordinal_position
    `);
    
    console.table(columnsResult.rows);
    
    console.log('\n🎉 Migration completed successfully!');
    console.log('\nNext steps:');
    console.log('1. Your Xero OAuth callback should now work properly');
    console.log('2. Test the OAuth flow by connecting to Xero');
    console.log('3. Check the database to verify settings are being saved');
    
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    console.error('Error details:', error.message);
    
    if (error.code === 'ENOENT') {
      console.error('\n📁 Migration file not found. Please ensure the file exists:');
      console.error('   backend/migrations/004_create_plug_and_play_xero_settings.sql');
    } else if (error.code === '42P07') {
      console.warn('\n⚠️  Table or object already exists. This is OK if you re-run the migration.');
      console.log('✅ Migration considered successful');
      process.exit(0);
    } else {
      console.error('\n💡 Troubleshooting tips:');
      console.error('   - Check your database connection settings in .env');
      console.error('   - Ensure PostgreSQL is running');
      console.error('   - Verify database user has CREATE TABLE permissions');
      console.error('   - Check the migration SQL file for syntax errors');
    }
    
    process.exit(1);
  }
}

// Run the migration
runMigration();

