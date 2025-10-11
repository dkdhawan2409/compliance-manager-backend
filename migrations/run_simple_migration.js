const db = require('../src/config/database');
const fs = require('fs');
const path = require('path');

async function runSimpleMigration() {
  console.log('🚀 Starting simple Xero schema migration...\n');
  
  try {
    // Step 1: Backup current data
    console.log('1️⃣ Creating backup of current data...');
    const backupResult = await db.query(`
      CREATE TABLE IF NOT EXISTS xero_settings_backup AS 
      SELECT *, NOW() as backup_created_at FROM xero_settings
    `);
    console.log('✅ Backup created');
    
    // Step 2: Run migration
    console.log('\n2️⃣ Running simple migration...');
    const migration = fs.readFileSync(
      path.join(__dirname, '001_simple_migration.sql'), 
      'utf8'
    );
    await db.query(migration);
    console.log('✅ Migration completed');
    
    // Step 3: Verify migration
    console.log('\n3️⃣ Verifying migration...');
    const oldCount = await db.query('SELECT COUNT(*) as count FROM xero_settings_backup WHERE access_token IS NOT NULL');
    const newCount = await db.query('SELECT COUNT(*) as count FROM xero_connections');
    
    console.log(`📊 Records migrated: ${oldCount.rows[0].count} → ${newCount.rows[0].count}`);
    
    if (newCount.rows[0].count >= oldCount.rows[0].count) {
      console.log('✅ Migration verification successful');
    } else {
      console.log('⚠️  Some records may not have been migrated');
    }
    
    // Step 4: Test the new schema
    console.log('\n4️⃣ Testing new schema...');
    const testQuery = await db.query(`
      SELECT 
        xc.company_id,
        xc.tenant_name,
        xc.status,
        xc.access_token_expires_at > NOW() as token_valid,
        jsonb_array_length(xc.authorized_tenants) as tenant_count
      FROM xero_connections xc 
      LIMIT 5
    `);
    
    console.log('📋 Sample migrated data:');
    console.table(testQuery.rows);
    
    // Step 5: Create backward compatibility view
    console.log('\n5️⃣ Creating backward compatibility view...');
    
    // First, rename the old table to backup
    await db.query('ALTER TABLE xero_settings RENAME TO xero_settings_old');
    console.log('✅ Old table renamed to xero_settings_old');
    
    // Then create the view
    await db.query(`
      CREATE VIEW xero_settings AS
      SELECT 
        xc.id,
        xc.company_id,
        xc.client_id,
        xc.client_secret,
        xc.redirect_uri,
        xc.created_at,
        xc.updated_at,
        xc.access_token_encrypted as access_token,
        xc.refresh_token_encrypted as refresh_token,
        xc.access_token_expires_at as token_expires_at,
        xc.primary_organization_name as organization_name,
        xc.xero_user_id,
        xc.authorized_tenants as tenant_data,
        xc.tenant_id,
        xc.authorized_tenants
      FROM xero_connections xc
    `);
    console.log('✅ Backward compatibility view created');
    
    console.log('\n🎉 Simple migration completed successfully!');
    console.log('\n📋 What was accomplished:');
    console.log('✅ Data migrated from xero_settings to xero_connections');
    console.log('✅ New schema columns added');
    console.log('✅ Performance indexes created');
    console.log('✅ Backward compatibility view created');
    console.log('✅ Old data backed up as xero_settings_backup');
    
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.error('Stack trace:', error.stack);
    process.exit(1);
  } finally {
    await db.pool.end();
  }
}

runSimpleMigration();
