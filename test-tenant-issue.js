const axios = require('axios');
const db = require('./src/config/database');

const BASE_URL = 'https://compliance-manager-backend.onrender.com/api';

async function testTenantIssue() {
  console.log('🔍 Testing tenant loading issue...\n');
  
  try {
    // First, let's find a user with tokens but no tenants
    const result = await db.query(`
      SELECT company_id, access_token, token_expires_at, authorized_tenants, tenant_data
      FROM xero_settings 
      WHERE access_token IS NOT NULL 
      ORDER BY token_expires_at DESC 
      LIMIT 1
    `);
    
    if (result.rows.length === 0) {
      console.log('❌ No users with tokens found');
      return;
    }
    
    const user = result.rows[0];
    console.log('📊 Found user with tokens:');
    console.log('Company ID:', user.company_id);
    console.log('Token expires at:', user.token_expires_at);
    console.log('Authorized tenants:', user.authorized_tenants);
    console.log('Tenant data:', user.tenant_data);
    
    // Create a JWT token for this user
    const jwt = require('jsonwebtoken');
    const token = jwt.sign({ id: user.company_id }, process.env.JWT_SECRET || 'fallback-secret', { expiresIn: '7d' });
    
    // Test the status endpoint
    console.log('\n🧪 Testing /api/xero/status endpoint...');
    const statusResponse = await axios.get(`${BASE_URL}/xero/status`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    console.log('📋 Status response:');
    console.log(JSON.stringify(statusResponse.data, null, 2));
    
    // Test the tenants endpoint
    console.log('\n🧪 Testing /api/xero/tenants endpoint...');
    const tenantsResponse = await axios.get(`${BASE_URL}/xero/tenants`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    console.log('📋 Tenants response:');
    console.log(JSON.stringify(tenantsResponse.data, null, 2));
    
    // Check if the token is actually expired
    const now = new Date();
    const tokenExpiry = new Date(user.token_expires_at);
    const isActuallyExpired = tokenExpiry <= now;
    
    console.log('\n🔍 Token analysis:');
    console.log('Current time:', now.toISOString());
    console.log('Token expires:', tokenExpiry.toISOString());
    console.log('Is actually expired:', isActuallyExpired);
    console.log('Time difference (minutes):', (tokenExpiry - now) / (1000 * 60));
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    if (error.response) {
      console.error('Response data:', error.response.data);
    }
  } finally {
    await db.pool.end();
  }
}

testTenantIssue();
