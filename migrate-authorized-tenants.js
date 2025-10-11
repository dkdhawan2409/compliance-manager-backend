const db = require('./src/config/database');

async function migrateAuthorizedTenants() {
  console.log('🔄 Starting authorized_tenants migration...\n');
  
  try {
    // Step 1: Ensure column exists
    console.log('1️⃣ Ensuring authorized_tenants column exists...');
    await db.query(`
      ALTER TABLE xero_settings 
      ADD COLUMN IF NOT EXISTS authorized_tenants JSONB DEFAULT '[]'::jsonb
    `);
    console.log('✅ Column created/verified');
    
    // Step 2: Check current state
    console.log('\n2️⃣ Checking current data state...');
    const checkResult = await db.query(`
      SELECT 
        COUNT(*) as total_records,
        COUNT(CASE WHEN authorized_tenants IS NOT NULL AND authorized_tenants != '[]'::jsonb THEN 1 END) as has_authorized_tenants,
        COUNT(CASE WHEN tenant_data IS NOT NULL AND tenant_data != '' THEN 1 END) as has_tenant_data
      FROM xero_settings
    `);
    
    const stats = checkResult.rows[0];
    console.log(`📊 Total records: ${stats.total_records}`);
    console.log(`📊 Records with authorized_tenants: ${stats.has_authorized_tenants}`);
    console.log(`📊 Records with tenant_data: ${stats.has_tenant_data}`);
    
    // Step 3: Migrate from tenant_data to authorized_tenants
    console.log('\n3️⃣ Migrating tenant_data to authorized_tenants...');
    const migrateResult = await db.query(`
      UPDATE xero_settings 
      SET authorized_tenants = tenant_data::jsonb
      WHERE (authorized_tenants IS NULL OR authorized_tenants = '[]'::jsonb)
        AND tenant_data IS NOT NULL 
        AND tenant_data != ''
        AND tenant_data != 'null'
    `);
    
    console.log(`✅ Migrated ${migrateResult.rowCount} records`);
    
    // Step 4: Clean up corrupted data
    console.log('\n4️⃣ Cleaning up corrupted data...');
    const corruptedResult = await db.query(`
      SELECT company_id, tenant_data 
      FROM xero_settings 
      WHERE tenant_data IS NOT NULL 
        AND tenant_data != ''
        AND tenant_data != 'null'
        AND (authorized_tenants IS NULL OR authorized_tenants = '[]'::jsonb)
    `);
    
    let fixedCount = 0;
    for (const row of corruptedResult.rows) {
      try {
        // Try to parse the tenant_data
        const tenantData = JSON.parse(row.tenant_data);
        
        // Update with parsed data
        await db.query(`
          UPDATE xero_settings 
          SET authorized_tenants = $1::jsonb
          WHERE company_id = $2
        `, [JSON.stringify(tenantData), row.company_id]);
        
        fixedCount++;
      } catch (error) {
        console.log(`⚠️  Could not parse tenant_data for company ${row.company_id}: ${error.message}`);
        
        // Set to empty array if parsing fails
        await db.query(`
          UPDATE xero_settings 
          SET authorized_tenants = '[]'::jsonb
          WHERE company_id = $1
        `, [row.company_id]);
      }
    }
    
    console.log(`✅ Fixed ${fixedCount} corrupted records`);
    
    // Step 5: Create index
    console.log('\n5️⃣ Creating index for performance...');
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_xero_connections_authorized_tenants 
      ON xero_connections USING GIN (authorized_tenants)
    `);
    console.log('✅ Index created');
    
    // Step 6: Verify final state
    console.log('\n6️⃣ Verifying final state...');
    const finalResult = await db.query(`
      SELECT 
        COUNT(*) as total_records,
        COUNT(CASE WHEN authorized_tenants IS NOT NULL AND authorized_tenants != '[]'::jsonb THEN 1 END) as has_authorized_tenants,
        COUNT(CASE WHEN authorized_tenants::text LIKE '%"tenantId"%' THEN 1 END) as has_tenant_ids
      FROM xero_settings
    `);
    
    const finalStats = finalResult.rows[0];
    console.log(`📊 Final state:`);
    console.log(`   Total records: ${finalStats.total_records}`);
    console.log(`   Records with authorized_tenants: ${finalStats.has_authorized_tenants}`);
    console.log(`   Records with tenant IDs: ${finalStats.has_tenant_ids}`);
    
    // Step 7: Show sample data
    console.log('\n7️⃣ Sample authorized_tenants data:');
    const sampleResult = await db.query(`
      SELECT company_id, authorized_tenants 
      FROM xero_settings 
      WHERE authorized_tenants IS NOT NULL 
        AND authorized_tenants != '[]'::jsonb
      LIMIT 3
    `);
    
    sampleResult.rows.forEach((row, index) => {
      console.log(`   Company ${row.company_id}: ${JSON.stringify(row.authorized_tenants, null, 2)}`);
    });
    
    console.log('\n🎉 Migration completed successfully!');
    
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.error('Stack trace:', error.stack);
  } finally {
    await db.pool.end();
  }
}

migrateAuthorizedTenants();
