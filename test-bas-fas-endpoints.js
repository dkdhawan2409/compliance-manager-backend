#!/usr/bin/env node

/**
 * BAS/FAS Endpoints Test Script
 * 
 * This script tests all BAS and FAS endpoints to verify they are properly registered
 * and responding correctly.
 * 
 * Usage:
 *   node test-bas-fas-endpoints.js <JWT_TOKEN>
 * 
 * Example:
 *   node test-bas-fas-endpoints.js eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
 */

const http = require('http');

const BASE_URL = process.env.API_URL || 'http://localhost:3333';
const JWT_TOKEN = process.argv[2];

if (!JWT_TOKEN) {
  console.error('❌ Error: JWT token is required');
  console.log('Usage: node test-bas-fas-endpoints.js <JWT_TOKEN>');
  console.log('\nTo get a token:');
  console.log('1. Login to the frontend');
  console.log('2. Open DevTools → Application → Local Storage');
  console.log('3. Copy the value of the "token" key');
  process.exit(1);
}

// Endpoints to test
const endpoints = [
  // BAS endpoints
  { method: 'GET', path: '/api/xero/bas-data', name: 'Get BAS Data' },
  { method: 'GET', path: '/api/xero/bas-data/current', name: 'Get Current BAS Data' },
  { method: 'GET', path: '/api/xero/bas-data/summary', name: 'Get BAS Summary' },
  { method: 'GET', path: '/api/xero/bas-data/calculation', name: 'Get BAS Calculation' },
  
  // FAS endpoints
  { method: 'GET', path: '/api/xero/fas-data', name: 'Get FAS Data' },
  { method: 'GET', path: '/api/xero/fas-data/current', name: 'Get Current FAS Data' },
  { method: 'GET', path: '/api/xero/fas-data/summary', name: 'Get FAS Summary' },
  { method: 'GET', path: '/api/xero/fas-data/calculation', name: 'Get FAS Calculation' },
  { method: 'GET', path: '/api/xero/fas-data/categories', name: 'Get FBT Categories' },
  
  // Supporting endpoints
  { method: 'GET', path: '/api/xero/status', name: 'Get Connection Status' },
  { method: 'GET', path: '/api/xero/organizations', name: 'Get Organizations' },
];

/**
 * Make HTTP request
 */
function makeRequest(method, path) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port || 3333,
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Authorization': `Bearer ${JWT_TOKEN}`,
        'Content-Type': 'application/json'
      }
    };

    const req = http.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const jsonData = JSON.parse(data);
          resolve({
            status: res.statusCode,
            statusMessage: res.statusMessage,
            data: jsonData
          });
        } catch (e) {
          resolve({
            status: res.statusCode,
            statusMessage: res.statusMessage,
            data: data,
            parseError: true
          });
        }
      });
    });

    req.on('error', (e) => {
      reject(e);
    });

    req.end();
  });
}

/**
 * Test endpoint
 */
async function testEndpoint(endpoint) {
  try {
    console.log(`\n🧪 Testing: ${endpoint.name}`);
    console.log(`   ${endpoint.method} ${endpoint.path}`);
    
    const result = await makeRequest(endpoint.method, endpoint.path);
    
    if (result.status === 200) {
      console.log(`   ✅ SUCCESS - Status: ${result.status}`);
      if (result.data && result.data.success) {
        console.log(`   📊 Data: ${result.data.message || 'OK'}`);
      }
      return { success: true, endpoint: endpoint.name, status: result.status };
    } else if (result.status === 401) {
      console.log(`   ⚠️  UNAUTHORIZED - Status: ${result.status}`);
      console.log(`   💡 This is expected if Xero is not connected`);
      return { success: false, endpoint: endpoint.name, status: result.status, expected: true };
    } else if (result.status === 400) {
      console.log(`   ⚠️  BAD REQUEST - Status: ${result.status}`);
      console.log(`   💡 This is expected if Xero is not configured`);
      console.log(`   📋 Message: ${result.data?.message || result.data?.error || 'N/A'}`);
      return { success: false, endpoint: endpoint.name, status: result.status, expected: true };
    } else {
      console.log(`   ❌ FAILED - Status: ${result.status}`);
      console.log(`   📋 Message: ${result.data?.message || result.data?.error || result.statusMessage}`);
      return { success: false, endpoint: endpoint.name, status: result.status };
    }
  } catch (error) {
    console.log(`   ❌ ERROR - ${error.message}`);
    return { success: false, endpoint: endpoint.name, error: error.message };
  }
}

/**
 * Run all tests
 */
async function runTests() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  BAS/FAS Endpoints Test Suite');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`\n🔧 Testing against: ${BASE_URL}`);
  console.log(`🔐 Using JWT token: ${JWT_TOKEN.substring(0, 20)}...`);
  
  const results = [];
  
  for (const endpoint of endpoints) {
    const result = await testEndpoint(endpoint);
    results.push(result);
    
    // Small delay between requests to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  // Summary
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  Test Summary');
  console.log('═══════════════════════════════════════════════════════════');
  
  const successful = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success && !r.expected).length;
  const expected = results.filter(r => r.expected).length;
  const total = results.length;
  
  console.log(`\n✅ Successful: ${successful}/${total}`);
  console.log(`⚠️  Expected failures (not connected): ${expected}/${total}`);
  console.log(`❌ Unexpected failures: ${failed}/${total}`);
  
  if (failed > 0) {
    console.log('\n❌ Failed Endpoints:');
    results.filter(r => !r.success && !r.expected).forEach(r => {
      console.log(`   - ${r.endpoint}: ${r.error || `Status ${r.status}`}`);
    });
  }
  
  if (expected > 0) {
    console.log('\n💡 Note: Some endpoints returned 401/400, which is expected when:');
    console.log('   - Xero OAuth has not been completed');
    console.log('   - Xero tokens have expired');
    console.log('   - Company has not connected to Xero');
    console.log('\n   To test with real data:');
    console.log('   1. Connect to Xero via the frontend (/xero page)');
    console.log('   2. Complete the OAuth flow');
    console.log('   3. Run this test again');
  }
  
  console.log('\n═══════════════════════════════════════════════════════════\n');
  
  // Exit with appropriate code
  process.exit(failed > 0 ? 1 : 0);
}

// Run tests
runTests().catch(error => {
  console.error('\n❌ Fatal error running tests:', error);
  process.exit(1);
});

