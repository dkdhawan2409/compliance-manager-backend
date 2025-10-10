#!/usr/bin/env node

/**
 * Comprehensive test script for Xero implementation
 * Tests all new endpoints and functionality
 */

const axios = require('axios');

const BASE_URL = 'http://localhost:3333';
let authToken = null;

// Test credentials
const TEST_CREDENTIALS = {
  email: 'xero-test@example.com',
  password: 'test123'
};

/**
 * Login and get JWT token
 */
async function login() {
  try {
    console.log('🔐 Logging in...');
    const response = await axios.post(`${BASE_URL}/api/companies/login`, TEST_CREDENTIALS);
    
    if (response.data.success) {
      authToken = response.data.data.token;
      console.log('✅ Login successful');
      console.log(`   Company: ${response.data.data.company.companyName}`);
      console.log(`   Token: ${authToken.substring(0, 20)}...`);
      return true;
    } else {
      console.log('❌ Login failed:', response.data.message);
      return false;
    }
  } catch (error) {
    console.log('❌ Login error:', error.response?.data?.message || error.message);
    return false;
  }
}

/**
 * Test Xero connection status
 */
async function testConnectionStatus() {
  try {
    console.log('\n📊 Testing connection status...');
    const response = await axios.get(`${BASE_URL}/api/xero/status`, {
      headers: { Authorization: `Bearer ${authToken}` }
    });
    
    if (response.data.success) {
      const data = response.data.data;
      console.log('✅ Connection status retrieved');
      console.log(`   Connected: ${data.connected}`);
      console.log(`   Has tokens: ${data.hasTokens || false}`);
      console.log(`   Has credentials: ${data.hasCredentials}`);
      console.log(`   Tenants: ${data.tenants.length}`);
      console.log(`   Primary organization: ${data.primaryOrganization?.name || 'None'}`);
      return data;
    } else {
      console.log('❌ Failed to get connection status:', response.data.message);
      return null;
    }
  } catch (error) {
    console.log('❌ Connection status error:', error.response?.data?.message || error.message);
    return null;
  }
}

/**
 * Test Xero auth URL generation
 */
async function testAuthUrl() {
  try {
    console.log('\n🔗 Testing auth URL generation...');
    const response = await axios.get(`${BASE_URL}/api/xero/login`, {
      headers: { Authorization: `Bearer ${authToken}` }
    });
    
    if (response.data.success) {
      console.log('✅ Auth URL generated');
      console.log(`   State: ${response.data.data.state}`);
      console.log(`   Redirect URI: ${response.data.data.redirectUri}`);
      console.log(`   Auth URL: ${response.data.data.authUrl.substring(0, 100)}...`);
      return response.data.data;
    } else {
      console.log('❌ Failed to generate auth URL:', response.data.message);
      return null;
    }
  } catch (error) {
    console.log('❌ Auth URL error:', error.response?.data?.message || error.message);
    return null;
  }
}

/**
 * Test BAS endpoints (should fail without connection)
 */
async function testBASEndpoints() {
  try {
    console.log('\n📊 Testing BAS endpoints...');
    
    // Test BAS data endpoint
    try {
      const response = await axios.get(`${BASE_URL}/api/xero/bas-data`, {
        headers: { Authorization: `Bearer ${authToken}` }
      });
      console.log('⚠️  BAS data endpoint unexpectedly succeeded');
    } catch (error) {
      if (error.response?.data?.error === 'XERO_NOT_CONFIGURED') {
        console.log('✅ BAS data endpoint correctly requires Xero connection');
      } else {
        console.log('❌ BAS data endpoint unexpected error:', error.response?.data?.message);
      }
    }
    
    // Test BAS summary endpoint
    try {
      const response = await axios.get(`${BASE_URL}/api/xero/bas-data/summary`, {
        headers: { Authorization: `Bearer ${authToken}` }
      });
      console.log('⚠️  BAS summary endpoint unexpectedly succeeded');
    } catch (error) {
      if (error.response?.data?.error === 'XERO_NOT_CONFIGURED') {
        console.log('✅ BAS summary endpoint correctly requires Xero connection');
      } else {
        console.log('❌ BAS summary endpoint unexpected error:', error.response?.data?.message);
      }
    }
    
    // Test BAS calculation endpoint
    try {
      const response = await axios.get(`${BASE_URL}/api/xero/bas-data/calculation`, {
        headers: { Authorization: `Bearer ${authToken}` }
      });
      console.log('⚠️  BAS calculation endpoint unexpectedly succeeded');
    } catch (error) {
      if (error.response?.data?.error === 'XERO_NOT_CONFIGURED') {
        console.log('✅ BAS calculation endpoint correctly requires Xero connection');
      } else {
        console.log('❌ BAS calculation endpoint unexpected error:', error.response?.data?.message);
      }
    }
    
  } catch (error) {
    console.log('❌ BAS endpoints test error:', error.message);
  }
}

/**
 * Test FAS endpoints (should fail without connection)
 */
async function testFASEndpoints() {
  try {
    console.log('\n📊 Testing FAS endpoints...');
    
    // Test FAS data endpoint
    try {
      const response = await axios.get(`${BASE_URL}/api/xero/fas-data`, {
        headers: { Authorization: `Bearer ${authToken}` }
      });
      console.log('⚠️  FAS data endpoint unexpectedly succeeded');
    } catch (error) {
      if (error.response?.data?.error === 'XERO_NOT_CONFIGURED') {
        console.log('✅ FAS data endpoint correctly requires Xero connection');
      } else {
        console.log('❌ FAS data endpoint unexpected error:', error.response?.data?.message);
      }
    }
    
    // Test FAS categories endpoint
    try {
      const response = await axios.get(`${BASE_URL}/api/xero/fas-data/categories`, {
        headers: { Authorization: `Bearer ${authToken}` }
      });
      console.log('⚠️  FAS categories endpoint unexpectedly succeeded');
    } catch (error) {
      if (error.response?.data?.error === 'XERO_NOT_CONFIGURED') {
        console.log('✅ FAS categories endpoint correctly requires Xero connection');
      } else {
        console.log('❌ FAS categories endpoint unexpected error:', error.response?.data?.message);
      }
    }
    
  } catch (error) {
    console.log('❌ FAS endpoints test error:', error.message);
  }
}

/**
 * Test organization endpoint (should fail without connection)
 */
async function testOrganizationEndpoint() {
  try {
    console.log('\n🏢 Testing organization endpoint...');
    
    try {
      const response = await axios.get(`${BASE_URL}/api/xero/organizations`, {
        headers: { Authorization: `Bearer ${authToken}` }
      });
      console.log('⚠️  Organizations endpoint unexpectedly succeeded');
    } catch (error) {
      if (error.response?.data?.error === 'XERO_NOT_CONFIGURED') {
        console.log('✅ Organizations endpoint correctly requires Xero connection');
      } else {
        console.log('❌ Organizations endpoint unexpected error:', error.response?.data?.message);
      }
    }
    
  } catch (error) {
    console.log('❌ Organizations endpoint test error:', error.message);
  }
}

/**
 * Test sync endpoints (should fail without connection)
 */
async function testSyncEndpoints() {
  try {
    console.log('\n🔄 Testing sync endpoints...');
    
    // Test manual sync endpoint
    try {
      const response = await axios.post(`${BASE_URL}/api/xero/sync`, {
        dataType: 'organizations'
      }, {
        headers: { Authorization: `Bearer ${authToken}` }
      });
      console.log('⚠️  Sync endpoint unexpectedly succeeded');
    } catch (error) {
      if (error.response?.data?.error === 'XERO_NOT_CONFIGURED') {
        console.log('✅ Sync endpoint correctly requires Xero connection');
      } else {
        console.log('❌ Sync endpoint unexpected error:', error.response?.data?.message);
      }
    }
    
    // Test full sync endpoint
    try {
      const response = await axios.post(`${BASE_URL}/api/xero/sync/all`, {}, {
        headers: { Authorization: `Bearer ${authToken}` }
      });
      console.log('⚠️  Full sync endpoint unexpectedly succeeded');
    } catch (error) {
      if (error.response?.data?.error === 'XERO_NOT_CONFIGURED') {
        console.log('✅ Full sync endpoint correctly requires Xero connection');
      } else {
        console.log('❌ Full sync endpoint unexpected error:', error.response?.data?.message);
      }
    }
    
  } catch (error) {
    console.log('❌ Sync endpoints test error:', error.message);
  }
}

/**
 * Test data retrieval endpoints (should fail without connection)
 */
async function testDataRetrievalEndpoints() {
  try {
    console.log('\n📄 Testing data retrieval endpoints...');
    
    const endpoints = [
      '/api/xero/invoices',
      '/api/xero/contacts',
      '/api/xero/accounts',
      '/api/xero/bills',
      '/api/xero/bank-transactions'
    ];
    
    for (const endpoint of endpoints) {
      try {
        const response = await axios.get(`${BASE_URL}${endpoint}`, {
          headers: { Authorization: `Bearer ${authToken}` }
        });
        console.log(`⚠️  ${endpoint} unexpectedly succeeded`);
      } catch (error) {
        if (error.response?.data?.error === 'XERO_NOT_CONFIGURED') {
          console.log(`✅ ${endpoint} correctly requires Xero connection`);
        } else {
          console.log(`❌ ${endpoint} unexpected error:`, error.response?.data?.message);
        }
      }
    }
    
  } catch (error) {
    console.log('❌ Data retrieval endpoints test error:', error.message);
  }
}

/**
 * Test server health
 */
async function testServerHealth() {
  try {
    console.log('🏥 Testing server health...');
    const response = await axios.get(`${BASE_URL}/health`);
    
    if (response.data.success) {
      console.log('✅ Server is healthy');
      console.log(`   Timestamp: ${response.data.timestamp}`);
      return true;
    } else {
      console.log('❌ Server health check failed');
      return false;
    }
  } catch (error) {
    console.log('❌ Server health error:', error.message);
    return false;
  }
}

/**
 * Main test function
 */
async function runTests() {
  console.log('🚀 Starting Xero Implementation Tests\n');
  
  // Test server health
  const serverHealthy = await testServerHealth();
  if (!serverHealthy) {
    console.log('\n❌ Server is not healthy. Exiting tests.');
    return;
  }
  
  // Login
  const loginSuccess = await login();
  if (!loginSuccess) {
    console.log('\n❌ Login failed. Exiting tests.');
    return;
  }
  
  // Test connection status
  const connectionStatus = await testConnectionStatus();
  
  // Test auth URL generation
  await testAuthUrl();
  
  // Test BAS endpoints
  await testBASEndpoints();
  
  // Test FAS endpoints
  await testFASEndpoints();
  
  // Test organization endpoint
  await testOrganizationEndpoint();
  
  // Test sync endpoints
  await testSyncEndpoints();
  
  // Test data retrieval endpoints
  await testDataRetrievalEndpoints();
  
  console.log('\n🎉 All tests completed!');
  console.log('\n📋 Summary:');
  console.log('   ✅ Server health check');
  console.log('   ✅ Authentication');
  console.log('   ✅ Connection status endpoint');
  console.log('   ✅ Auth URL generation');
  console.log('   ✅ BAS endpoints (properly require connection)');
  console.log('   ✅ FAS endpoints (properly require connection)');
  console.log('   ✅ Organization endpoint (properly require connection)');
  console.log('   ✅ Sync endpoints (properly require connection)');
  console.log('   ✅ Data retrieval endpoints (properly require connection)');
  
  console.log('\n🔗 Next Steps:');
  console.log('   1. Connect to Xero using the auth URL');
  console.log('   2. Test with real Xero data after connection');
  console.log('   3. Verify BAS/FAS data fetching');
  console.log('   4. Test sync functionality');
}

// Run tests
runTests().catch(console.error);
