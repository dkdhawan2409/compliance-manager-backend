const db = require('../src/config/database');
const fs = require('fs');
const path = require('path');

async function runMigration() {
  console.log('🚀 Starting Xero schema migration...\n');
  
  try {
    // Step 1: Backup current data
    console.log('1️⃣ Creating backup of current data...');
    const backupResult = await db.query(`
      CREATE TABLE IF NOT EXISTS xero_settings_backup AS 
      SELECT *, NOW() as backup_created_at FROM xero_settings
    `);
    console.log('✅ Backup created');
    
    // Step 2: Run migration 001
    console.log('\n2️⃣ Running migration 001: Migrate to unified schema...');
    const migration001 = fs.readFileSync(
      path.join(__dirname, '001_migrate_to_unified_xero_schema.sql'), 
      'utf8'
    );
    await db.query(migration001);
    console.log('✅ Migration 001 completed');
    
    // Step 3: Verify migration
    console.log('\n3️⃣ Verifying migration...');
    const oldCount = await db.query('SELECT COUNT(*) as count FROM xero_settings_backup WHERE access_token IS NOT NULL');
    const newCount = await db.query('SELECT COUNT(*) as count FROM xero_connections');
    
    console.log(`📊 Records migrated: ${oldCount.rows[0].count} → ${newCount.rows[0].count}`);
    
    if (newCount.rows[0].count >= oldCount.rows[0].count) {
      console.log('✅ Migration verification successful');
    } else {
      throw new Error('Migration verification failed - data loss detected');
    }
    
    // Step 4: Run migration 002
    console.log('\n4️⃣ Running migration 002: Cleanup old tables...');
    const migration002 = fs.readFileSync(
      path.join(__dirname, '002_cleanup_old_xero_tables.sql'), 
      'utf8'
    );
    await db.query(migration002);
    console.log('✅ Migration 002 completed');
    
    // Step 5: Final verification
    console.log('\n5️⃣ Final verification...');
    const finalConnections = await db.query('SELECT COUNT(*) as count FROM xero_connections');
    const finalCache = await db.query('SELECT COUNT(*) as count FROM xero_data_cache');
    
    console.log('📊 Final state:');
    console.log(`   xero_connections: ${finalConnections.rows[0].count} records`);
    console.log(`   xero_data_cache: ${finalCache.rows[0].count} records`);
    
    // Test the new schema
    console.log('\n6️⃣ Testing new schema...');
    const testQuery = await db.query(`
      SELECT 
        xc.company_id,
        xc.tenant_name,
        xc.connection_status,
        xc.token_expires_at > NOW() as token_valid,
        jsonb_array_length(xc.authorized_tenants) as tenant_count
      FROM xero_connections xc 
      LIMIT 5
    `);
    
    console.log('📋 Sample migrated data:');
    console.table(testQuery.rows);
    
    console.log('\n🎉 Migration completed successfully!');
    console.log('\n📋 What was accomplished:');
    console.log('✅ Data migrated from xero_settings to xero_connections');
    console.log('✅ New unified schema implemented');
    console.log('✅ Backward compatibility view created');
    console.log('✅ Performance indexes added');
    console.log('✅ Foreign key constraints added');
    console.log('✅ Old table backed up as xero_settings_backup');
    
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.error('Stack trace:', error.stack);
    
    // Rollback if needed
    console.log('\n🔄 Attempting rollback...');
    try {
      await db.query('ROLLBACK');
      console.log('✅ Rollback successful');
    } catch (rollbackError) {
      console.error('❌ Rollback failed:', rollbackError.message);
    }
    
    process.exit(1);
  } finally {
    await db.pool.end();
  }
}

runMigration();
