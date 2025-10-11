const db = require('../src/config/database');

async function createCompatibilityView() {
  console.log('🔧 Creating backward compatibility view...\n');
  
  try {
    // Check if migration was already done
    const connectionsCount = await db.query('SELECT COUNT(*) as count FROM xero_connections');
    console.log(`📊 xero_connections has ${connectionsCount.rows[0].count} records`);
    
    if (connectionsCount.rows[0].count === 0) {
      console.log('❌ No data in xero_connections. Migration may not have completed.');
      return;
    }
    
    // Check if xero_settings is a table or view
    const tableInfo = await db.query(`
      SELECT table_type 
      FROM information_schema.tables 
      WHERE table_name = 'xero_settings' 
      AND table_schema = 'public'
    `);
    
    if (tableInfo.rows.length > 0) {
      console.log(`📋 xero_settings is currently a ${tableInfo.rows[0].table_type}`);
      
      if (tableInfo.rows[0].table_type === 'BASE TABLE') {
        // Rename the table to backup
        await db.query('ALTER TABLE xero_settings RENAME TO xero_settings_old');
        console.log('✅ Old table renamed to xero_settings_old');
      } else {
        // Drop the existing view
        await db.query('DROP VIEW xero_settings');
        console.log('✅ Existing view dropped');
      }
    }
    
    // Create the new view
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
    
    // Test the view
    const testQuery = await db.query('SELECT COUNT(*) as count FROM xero_settings');
    console.log(`📊 View test: ${testQuery.rows[0].count} records accessible via xero_settings`);
    
    console.log('\n🎉 Backward compatibility view created successfully!');
    
  } catch (error) {
    console.error('❌ Failed to create compatibility view:', error.message);
    process.exit(1);
  } finally {
    await db.pool.end();
  }
}

createCompatibilityView();
