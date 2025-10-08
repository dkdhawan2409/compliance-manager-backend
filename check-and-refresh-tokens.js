const db = require('./src/config/database');
const axios = require('axios');

async function checkAndRefreshTokens() {
  try {
    console.log('🔍 Checking Xero tokens in database...\n');
    
    // Get all companies with Xero settings
    const result = await db.query(`
      SELECT 
        company_id,
        client_id,
        client_secret,
        access_token IS NOT NULL as has_access_token,
        refresh_token IS NOT NULL as has_refresh_token,
        token_expires_at,
        created_at,
        updated_at,
        organization_name,
        EXTRACT(DAY FROM NOW() - COALESCE(created_at, updated_at)) as token_age_days
      FROM xero_settings
      ORDER BY company_id
    `);
    
    if (result.rows.length === 0) {
      console.log('❌ No Xero settings found in database');
      console.log('\n📋 Action Required:');
      console.log('   1. Login to the app');
      console.log('   2. Go to /xero');
      console.log('   3. Click "Connect to Xero"');
      console.log('   4. Complete the authorization');
      process.exit(0);
    }
    
    console.log(`Found ${result.rows.length} company(ies) with Xero settings:\n`);
    
    for (const row of result.rows) {
      console.log(`Company ID: ${row.company_id}`);
      console.log(`Organization: ${row.organization_name || 'Unknown'}`);
      console.log(`Has Access Token: ${row.has_access_token ? '✅' : '❌'}`);
      console.log(`Has Refresh Token: ${row.has_refresh_token ? '✅' : '❌'}`);
      console.log(`Token Age: ${Math.floor(row.token_age_days)} days`);
      console.log(`Token Expires At: ${row.token_expires_at || 'Unknown'}`);
      
      if (!row.has_refresh_token) {
        console.log('❌ Status: NO REFRESH TOKEN - Must reconnect to Xero\n');
        console.log('📋 Action Required:');
        console.log(`   1. Login as company ${row.company_id}`);
        console.log('   2. Go to /xero');
        console.log('   3. Click "Connect to Xero"');
        console.log('   4. Complete the authorization\n');
        continue;
      }
      
      if (row.token_age_days > 60) {
        console.log('❌ Status: TOKENS EXPIRED (>60 days) - Must reconnect to Xero\n');
        console.log('📋 Action Required:');
        console.log(`   1. Login as company ${row.company_id}`);
        console.log('   2. Go to /xero');
        console.log('   3. Click "Connect to Xero" or "Reconnect"');
        console.log('   4. Complete the authorization\n');
        continue;
      }
      
      if (row.token_age_days > 50) {
        console.log('⚠️  Status: TOKENS OLD (>50 days) - Attempting to refresh...');
        
        // Try to refresh
        try {
          const refreshResult = await db.query(
            'SELECT refresh_token FROM xero_settings WHERE company_id = $1',
            [row.company_id]
          );
          
          if (refreshResult.rows[0] && refreshResult.rows[0].refresh_token) {
            const refreshToken = refreshResult.rows[0].refresh_token;
            
            const params = new URLSearchParams({
              grant_type: 'refresh_token',
              refresh_token: refreshToken
            });
            
            const response = await axios.post('https://identity.xero.com/connect/token', params, {
              headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Authorization': `Basic ${Buffer.from(`${row.client_id}:${row.client_secret}`).toString('base64')}`
              }
            });
            
            // Update tokens
            await db.query(
              `UPDATE xero_settings 
               SET access_token = $1, refresh_token = $2, token_expires_at = $3, updated_at = NOW() 
               WHERE company_id = $4`,
              [
                response.data.access_token,
                response.data.refresh_token,
                new Date(Date.now() + response.data.expires_in * 1000),
                row.company_id
              ]
            );
            
            console.log('✅ Status: TOKENS REFRESHED SUCCESSFULLY!\n');
          }
        } catch (error) {
          console.error('❌ Refresh failed:', error.response?.data || error.message);
          console.log('\n📋 Action Required:');
          console.log(`   1. Login as company ${row.company_id}`);
          console.log('   2. Go to /xero');
          console.log('   3. Click "Connect to Xero" or "Reconnect"');
          console.log('   4. Complete the authorization\n');
        }
      } else {
        console.log('✅ Status: TOKENS ARE VALID\n');
      }
      
      console.log('─'.repeat(60) + '\n');
    }
    
    console.log('\n✅ Token check complete!');
    console.log('\n📝 Summary:');
    console.log('   - If tokens are valid: MissingAttachments should work');
    console.log('   - If tokens need refresh: We attempted automatic refresh');
    console.log('   - If tokens are expired: You MUST reconnect to Xero via /xero page');
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    process.exit(0);
  }
}

checkAndRefreshTokens();

