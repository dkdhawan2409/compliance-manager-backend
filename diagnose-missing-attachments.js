#!/usr/bin/env node

/**
 * Diagnostic script for missing attachments feature
 * This script checks why missing attachments are not loading data
 */

const db = require('./src/config/database');

async function diagnoseMissingAttachments() {
  console.log('🔍 Diagnosing Missing Attachments Feature...\n');
  
  try {
    // 1. Check if xero_settings table has the required columns
    console.log('1️⃣ Checking xero_settings table structure...');
    const columnsQuery = `
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'xero_settings'
      ORDER BY ordinal_position;
    `;
    const columnsResult = await db.query(columnsQuery);
    
    console.log('   Columns in xero_settings table:');
    columnsResult.rows.forEach(col => {
      console.log(`   - ${col.column_name} (${col.data_type})`);
    });
    
    const requiredColumns = ['tenant_id', 'organization_name', 'tenant_data', 'access_token', 'refresh_token'];
    const existingColumns = columnsResult.rows.map(r => r.column_name);
    const missingColumns = requiredColumns.filter(col => !existingColumns.includes(col));
    
    if (missingColumns.length > 0) {
      console.log('   ❌ Missing required columns:', missingColumns.join(', '));
      console.log('   ⚠️  Need to run database migration!');
    } else {
      console.log('   ✅ All required columns exist\n');
    }
    
    // 2. Check companies with Xero settings
    console.log('2️⃣ Checking companies with Xero settings...');
    const settingsQuery = `
      SELECT 
        xs.id,
        xs.company_id,
        c.company_name,
        xs.client_id IS NOT NULL as has_client_id,
        xs.client_secret IS NOT NULL as has_client_secret,
        xs.access_token IS NOT NULL as has_access_token,
        xs.refresh_token IS NOT NULL as has_refresh_token,
        xs.tenant_id,
        xs.organization_name,
        xs.token_expires_at,
        xs.created_at,
        xs.updated_at,
        CASE 
          WHEN xs.updated_at IS NOT NULL THEN EXTRACT(day FROM (NOW() - xs.updated_at))
          WHEN xs.created_at IS NOT NULL THEN EXTRACT(day FROM (NOW() - xs.created_at))
          ELSE NULL
        END as token_age_days
      FROM xero_settings xs
      LEFT JOIN companies c ON c.id = xs.company_id
      ORDER BY xs.company_id;
    `;
    
    const settingsResult = await db.query(settingsQuery);
    
    if (settingsResult.rows.length === 0) {
      console.log('   ⚠️  No companies have Xero settings configured');
    } else {
      console.log(`   Found ${settingsResult.rows.length} company(ies) with Xero settings:\n`);
      
      settingsResult.rows.forEach((setting, index) => {
        console.log(`   Company #${index + 1}:`);
        console.log(`   - ID: ${setting.company_id}`);
        console.log(`   - Name: ${setting.company_name || 'N/A'}`);
        console.log(`   - Organization: ${setting.organization_name || '❌ NOT SET'}`);
        console.log(`   - Tenant ID: ${setting.tenant_id || '❌ NOT SET'}`);
        console.log(`   - Has Client ID: ${setting.has_client_id ? '✅' : '❌'}`);
        console.log(`   - Has Client Secret: ${setting.has_client_secret ? '✅' : '❌'}`);
        console.log(`   - Has Access Token: ${setting.has_access_token ? '✅' : '❌'}`);
        console.log(`   - Has Refresh Token: ${setting.has_refresh_token ? '✅' : '❌'}`);
        console.log(`   - Token Age: ${setting.token_age_days ? Math.floor(setting.token_age_days) + ' days' : 'Unknown'}`);
        console.log(`   - Token Expires: ${setting.token_expires_at || 'N/A'}`);
        
        // Diagnose issues
        const issues = [];
        if (!setting.organization_name) issues.push('Missing organization_name');
        if (!setting.tenant_id) issues.push('Missing tenant_id');
        if (!setting.has_access_token) issues.push('Missing access_token');
        if (!setting.has_refresh_token) issues.push('Missing refresh_token');
        if (setting.token_age_days && setting.token_age_days > 60) issues.push('Refresh token likely expired (>60 days old)');
        
        if (issues.length > 0) {
          console.log(`   ⚠️  Issues: ${issues.join(', ')}`);
          console.log(`   💡 Solution: Disconnect and reconnect to Xero`);
        } else {
          console.log(`   ✅ Configuration looks good`);
        }
        console.log('');
      });
    }
    
    // 3. Check missing_attachment_configs
    console.log('3️⃣ Checking missing attachment configurations...');
    const configQuery = `
      SELECT 
        mac.id,
        mac.company_id,
        c.company_name,
        mac.gst_threshold,
        mac.enabled,
        mac.sms_enabled,
        mac.email_enabled
      FROM missing_attachment_configs mac
      LEFT JOIN companies c ON c.id = mac.company_id
      ORDER BY mac.company_id;
    `;
    
    const configResult = await db.query(configQuery);
    
    if (configResult.rows.length === 0) {
      console.log('   ⚠️  No missing attachment configs found');
    } else {
      console.log(`   Found ${configResult.rows.length} configuration(s):\n`);
      configResult.rows.forEach((config, index) => {
        console.log(`   Config #${index + 1}:`);
        console.log(`   - Company ID: ${config.company_id}`);
        console.log(`   - Company Name: ${config.company_name || 'N/A'}`);
        console.log(`   - GST Threshold: $${config.gst_threshold}`);
        console.log(`   - Enabled: ${config.enabled ? '✅' : '❌'}`);
        console.log(`   - SMS Enabled: ${config.sms_enabled ? '✅' : '❌'}`);
        console.log(`   - Email Enabled: ${config.email_enabled ? '✅' : '❌'}`);
        console.log('');
      });
    }
    
    // 4. Test token refresh capability
    console.log('4️⃣ Checking if tokens need refresh...');
    const needsRefreshQuery = `
      SELECT 
        xs.company_id,
        c.company_name,
        xs.token_expires_at,
        CASE 
          WHEN xs.token_expires_at IS NOT NULL AND xs.token_expires_at < NOW() THEN true
          ELSE false
        END as token_expired
      FROM xero_settings xs
      LEFT JOIN companies c ON c.id = xs.company_id
      WHERE xs.access_token IS NOT NULL;
    `;
    
    const refreshResult = await db.query(needsRefreshQuery);
    
    if (refreshResult.rows.length > 0) {
      refreshResult.rows.forEach(row => {
        if (row.token_expired) {
          console.log(`   ⚠️  Company ${row.company_id} (${row.company_name}): Access token EXPIRED`);
          console.log(`      Token expired at: ${row.token_expires_at}`);
        } else {
          console.log(`   ✅ Company ${row.company_id} (${row.company_name}): Access token valid until ${row.token_expires_at}`);
        }
      });
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('📋 SUMMARY & RECOMMENDATIONS:');
    console.log('='.repeat(60));
    
    // Provide recommendations
    if (missingColumns.length > 0) {
      console.log('\n❌ CRITICAL: Missing database columns');
      console.log('   Run: npm run migrate');
      console.log('   Or restart the server to auto-run migrations');
    }
    
    const noTenantId = settingsResult.rows.some(s => !s.tenant_id);
    const noOrgName = settingsResult.rows.some(s => !s.organization_name);
    
    if (noTenantId || noOrgName) {
      console.log('\n⚠️  WARNING: Some companies missing tenant_id or organization_name');
      console.log('   These companies need to disconnect and reconnect to Xero');
      console.log('   This will populate the missing fields');
    }
    
    const expiredTokens = refreshResult.rows.filter(r => r.token_expired);
    if (expiredTokens.length > 0) {
      console.log('\n⚠️  WARNING: Some companies have expired access tokens');
      console.log('   These will be auto-refreshed on next API call if refresh token is valid');
    }
    
    const oldRefreshTokens = settingsResult.rows.filter(s => s.token_age_days && s.token_age_days > 60);
    if (oldRefreshTokens.length > 0) {
      console.log('\n❌ CRITICAL: Some companies have expired refresh tokens (>60 days)');
      console.log('   These companies MUST disconnect and reconnect to Xero');
      console.log('   Affected companies:', oldRefreshTokens.map(s => `${s.company_id} (${s.company_name})`).join(', '));
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('✅ Diagnosis complete!\n');
    
  } catch (error) {
    console.error('\n❌ Error during diagnosis:', error);
    console.error('Error details:', error.message);
  } finally {
    await db.pool.end();
  }
}

// Run diagnosis
if (require.main === module) {
  diagnoseMissingAttachments().catch(console.error);
}

module.exports = { diagnoseMissingAttachments };

