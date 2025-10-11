#!/usr/bin/env node

/**
 * Test BAS Data Endpoint
 * 
 * This script tests the /api/xero/bas-data endpoint to see if it's working
 */

const axios = require('axios');

const BASE_URL = 'https://compliance-manager-backend.onrender.com/api';
const LOCAL_URL = 'http://localhost:3333/api';

async function testBASEndpoint() {
  console.log('🧪 Testing BAS Data Endpoint...\n');
  
  // Test both production and local endpoints
  const endpoints = [
    { name: 'Production', url: BASE_URL },
    { name: 'Local', url: LOCAL_URL }
  ];
  
  for (const endpoint of endpoints) {
    console.log(`📍 Testing ${endpoint.name} endpoint: ${endpoint.url}`);
    
    try {
      // Test without authentication first
      console.log('  🔍 Testing without authentication...');
      const response = await axios.get(`${endpoint.url}/xero/bas-data`, {
        timeout: 10000
      });
      
      console.log(`  ✅ Response status: ${response.status}`);
      console.log(`  📊 Response data:`, response.data);
      
    } catch (error) {
      if (error.response) {
        console.log(`  ❌ Response status: ${error.response.status}`);
        console.log(`  📝 Error message: ${error.response.data?.message || error.response.statusText}`);
        
        if (error.response.status === 401) {
          console.log('  ℹ️  401 Unauthorized - This is expected without authentication');
        } else if (error.response.status === 404) {
          console.log('  ❌ 404 Not Found - Endpoint might not be registered');
        } else {
          console.log('  ⚠️  Other error - Check backend logs');
        }
      } else if (error.code === 'ECONNREFUSED') {
        console.log('  ❌ Connection refused - Backend not running locally');
      } else {
        console.log(`  ❌ Network error: ${error.message}`);
      }
    }
    
    console.log('');
  }
  
  console.log('🏁 Test completed!');
}

// Run the test
testBASEndpoint().catch(console.error);
