#!/usr/bin/env node

/**
 * Test Xero Connection on Localhost
 * 
 * This script helps you test the Xero connection flow with authentication.
 */

const axios = require('axios');
const readline = require('readline');

const API_BASE = 'http://localhost:3333/api';

// ANSI colors
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function prompt(question) {
  return new Promise((resolve) => {
    rl.question(question, resolve);
  });
}

console.log(`\n${colors.bright}${colors.cyan}================================================${colors.reset}`);
console.log(`${colors.bright}${colors.cyan}  Xero Connection Test - Localhost${colors.reset}`);
console.log(`${colors.bright}${colors.cyan}================================================${colors.reset}\n`);

async function testXeroConnection() {
  try {
    console.log(`${colors.blue}Testing backend connection...${colors.reset}`);
    
    // Test backend health
    const healthResponse = await axios.get(`${API_BASE}/health`);
    if (healthResponse.data.success) {
      console.log(`${colors.green}✅ Backend is running${colors.reset}\n`);
    }
    
    // Ask for credentials
    console.log(`${colors.yellow}To test Xero connection, you need to login first.${colors.reset}`);
    console.log(`${colors.cyan}Please provide your login credentials:${colors.reset}\n`);
    
    const username = await prompt('Username/Email: ');
    const password = await prompt('Password: ');
    
    console.log(`\n${colors.blue}Attempting login...${colors.reset}`);
    
    // Login
    const loginResponse = await axios.post(`${API_BASE}/companies/login`, {
      username,
      password
    });
    
    if (!loginResponse.data.success) {
      console.log(`${colors.red}❌ Login failed: ${loginResponse.data.message}${colors.reset}`);
      rl.close();
      return;
    }
    
    const token = loginResponse.data.data.token;
    console.log(`${colors.green}✅ Login successful!${colors.reset}`);
    console.log(`${colors.cyan}Token: ${token.substring(0, 20)}...${colors.reset}\n`);
    
    // Test Xero connection status
    console.log(`${colors.blue}Checking Xero connection status...${colors.reset}`);
    
    const statusResponse = await axios.get(`${API_BASE}/xero/status`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    console.log(`${colors.green}✅ Xero Status:${colors.reset}`);
    console.log(JSON.stringify(statusResponse.data, null, 2));
    console.log();
    
    // Get Xero auth URL
    console.log(`${colors.blue}Getting Xero authorization URL...${colors.reset}`);
    
    const authUrlResponse = await axios.get(`${API_BASE}/xero/login`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    if (authUrlResponse.data.success) {
      console.log(`${colors.green}✅ Xero auth URL generated!${colors.reset}\n`);
      console.log(`${colors.bright}${colors.cyan}To connect to Xero:${colors.reset}`);
      console.log(`${colors.cyan}1. Open this URL in your browser:${colors.reset}`);
      console.log(`${colors.yellow}${authUrlResponse.data.data.authUrl}${colors.reset}\n`);
      console.log(`${colors.cyan}2. Authorize the application on Xero${colors.reset}`);
      console.log(`${colors.cyan}3. You'll be redirected back to: http://localhost:3333/xero-callback${colors.reset}\n`);
      
      // Save token for later use
      console.log(`${colors.bright}Your JWT Token (save this for API testing):${colors.reset}`);
      console.log(`${colors.yellow}${token}${colors.reset}\n`);
    }
    
  } catch (error) {
    console.error(`${colors.red}❌ Error:${colors.reset}`, error.response?.data || error.message);
    
    if (error.response?.status === 401) {
      console.log(`\n${colors.yellow}💡 Tip: Invalid credentials. Please check your username and password.${colors.reset}`);
    } else if (error.code === 'ECONNREFUSED') {
      console.log(`\n${colors.yellow}💡 Tip: Backend server is not running. Start it with: npm run dev${colors.reset}`);
    }
  } finally {
    rl.close();
  }
}

async function testWithToken() {
  console.log(`${colors.yellow}Test with existing JWT token${colors.reset}\n`);
  
  const token = await prompt('Enter your JWT token: ');
  
  console.log(`\n${colors.blue}Testing with provided token...${colors.reset}`);
  
  try {
    // Test Xero status
    const statusResponse = await axios.get(`${API_BASE}/xero/status`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    console.log(`${colors.green}✅ Token is valid!${colors.reset}\n`);
    console.log(`${colors.bright}Xero Status:${colors.reset}`);
    console.log(JSON.stringify(statusResponse.data, null, 2));
    console.log();
    
    // Get auth URL
    const authUrlResponse = await axios.get(`${API_BASE}/xero/login`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    if (authUrlResponse.data.success) {
      console.log(`${colors.bright}${colors.cyan}Xero Authorization URL:${colors.reset}`);
      console.log(`${colors.yellow}${authUrlResponse.data.data.authUrl}${colors.reset}\n`);
    }
    
  } catch (error) {
    console.error(`${colors.red}❌ Error:${colors.reset}`, error.response?.data || error.message);
    
    if (error.response?.status === 401) {
      console.log(`\n${colors.yellow}💡 Tip: Token is invalid or expired. Please login again.${colors.reset}`);
    }
  } finally {
    rl.close();
  }
}

async function showUsage() {
  console.log(`${colors.bright}Usage Options:${colors.reset}\n`);
  console.log(`${colors.cyan}1. Login and test Xero connection${colors.reset}`);
  console.log(`${colors.cyan}2. Test with existing JWT token${colors.reset}`);
  console.log(`${colors.cyan}3. Use curl commands${colors.reset}\n`);
  
  const choice = await prompt('Choose an option (1-3): ');
  
  if (choice === '1') {
    await testXeroConnection();
  } else if (choice === '2') {
    await testWithToken();
  } else if (choice === '3') {
    console.log(`\n${colors.bright}${colors.cyan}Using curl commands:${colors.reset}\n`);
    console.log(`${colors.yellow}# Step 1: Login${colors.reset}`);
    console.log(`curl -X POST http://localhost:3333/api/companies/login \\
  -H "Content-Type: application/json" \\
  -d '{"username":"your_username","password":"your_password"}'\n`);
    
    console.log(`${colors.yellow}# Step 2: Get Xero auth URL (use token from step 1)${colors.reset}`);
    console.log(`curl http://localhost:3333/api/xero/login \\
  -H "Authorization: Bearer YOUR_TOKEN_HERE"\n`);
    
    console.log(`${colors.yellow}# Step 3: Check Xero status${colors.reset}`);
    console.log(`curl http://localhost:3333/api/xero/status \\
  -H "Authorization: Bearer YOUR_TOKEN_HERE"\n`);
    
    rl.close();
  } else {
    console.log(`${colors.red}Invalid option${colors.reset}`);
    rl.close();
  }
}

// Run the script
showUsage().catch(error => {
  console.error(`${colors.red}Error:${colors.reset}`, error.message);
  rl.close();
  process.exit(1);
});

