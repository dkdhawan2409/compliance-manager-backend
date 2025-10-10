#!/usr/bin/env node

/**
 * Test Script: Localhost Setup Verification
 * 
 * This script tests if your backend is properly configured for localhost development
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

console.log(`\n${colors.bright}${colors.cyan}================================================${colors.reset}`);
console.log(`${colors.bright}${colors.cyan}  Localhost Setup Verification${colors.reset}`);
console.log(`${colors.bright}${colors.cyan}================================================${colors.reset}\n`);

// Read .env file
function readEnvFile() {
  console.log(`${colors.blue}📋 Checking .env configuration...${colors.reset}`);
  
  try {
    const envPath = path.join(__dirname, '.env');
    const envContent = fs.readFileSync(envPath, 'utf8');
    
    const config = {};
    envContent.split('\n').forEach(line => {
      const match = line.match(/^([^#=]+)=(.*)$/);
      if (match) {
        const key = match[1].trim();
        const value = match[2].trim();
        config[key] = value;
      }
    });
    
    return config;
  } catch (error) {
    console.log(`${colors.red}❌ Failed to read .env file${colors.reset}`);
    return null;
  }
}

// Test HTTP endpoint
function testEndpoint(url, description) {
  return new Promise((resolve) => {
    http.get(url, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.success) {
            console.log(`${colors.green}✅ ${description}: Working${colors.reset}`);
            resolve(true);
          } else {
            console.log(`${colors.yellow}⚠️  ${description}: Unexpected response${colors.reset}`);
            resolve(false);
          }
        } catch (error) {
          console.log(`${colors.red}❌ ${description}: Invalid JSON response${colors.reset}`);
          resolve(false);
        }
      });
    }).on('error', (error) => {
      console.log(`${colors.red}❌ ${description}: ${error.message}${colors.reset}`);
      resolve(false);
    });
  });
}

// Validate .env settings
function validateEnvConfig(config) {
  console.log(`\n${colors.blue}🔍 Validating .env configuration...${colors.reset}\n`);
  
  const checks = [
    {
      key: 'PORT',
      expected: '3333',
      description: 'Server Port'
    },
    {
      key: 'NODE_ENV',
      expected: 'development',
      description: 'Environment Mode'
    },
    {
      key: 'XERO_REDIRECT_URI',
      contains: 'localhost:3333',
      description: 'Xero Redirect URI (localhost)'
    },
    {
      key: 'FRONTEND_URL',
      contains: 'localhost',
      description: 'Frontend URL (localhost)'
    },
    {
      key: 'JWT_SECRET',
      required: true,
      description: 'JWT Secret'
    },
    {
      key: 'XERO_CLIENT_ID',
      required: true,
      description: 'Xero Client ID'
    },
    {
      key: 'XERO_CLIENT_SECRET',
      required: true,
      description: 'Xero Client Secret'
    }
  ];
  
  let passed = 0;
  let failed = 0;
  
  checks.forEach(check => {
    const value = config[check.key];
    
    if (check.required) {
      if (value && value.trim() !== '' && !value.includes('your_')) {
        console.log(`${colors.green}✅ ${check.description}: Configured${colors.reset}`);
        passed++;
      } else {
        console.log(`${colors.red}❌ ${check.description}: Not configured${colors.reset}`);
        failed++;
      }
    } else if (check.expected) {
      if (value === check.expected) {
        console.log(`${colors.green}✅ ${check.description}: ${value}${colors.reset}`);
        passed++;
      } else {
        console.log(`${colors.yellow}⚠️  ${check.description}: ${value} (expected: ${check.expected})${colors.reset}`);
        failed++;
      }
    } else if (check.contains) {
      if (value && value.includes(check.contains)) {
        console.log(`${colors.green}✅ ${check.description}: ${value}${colors.reset}`);
        passed++;
      } else {
        console.log(`${colors.yellow}⚠️  ${check.description}: ${value} (should contain: ${check.contains})${colors.reset}`);
        failed++;
      }
    }
  });
  
  return { passed, failed };
}

// Main test function
async function runTests() {
  // Step 1: Read .env
  const config = readEnvFile();
  
  if (!config) {
    console.log(`${colors.red}\n❌ Cannot proceed without .env file${colors.reset}\n`);
    process.exit(1);
  }
  
  console.log(`${colors.green}✅ .env file found${colors.reset}\n`);
  
  // Step 2: Validate .env
  const { passed, failed } = validateEnvConfig(config);
  
  // Step 3: Test endpoints
  console.log(`\n${colors.blue}🧪 Testing backend endpoints...${colors.reset}\n`);
  
  const port = config.PORT || '3333';
  const healthResult = await testEndpoint(`http://localhost:${port}/health`, 'Health Endpoint');
  const apiHealthResult = await testEndpoint(`http://localhost:${port}/api/health`, 'API Health Endpoint');
  
  // Summary
  console.log(`\n${colors.bright}${colors.cyan}================================================${colors.reset}`);
  console.log(`${colors.bright}${colors.cyan}  Test Results${colors.reset}`);
  console.log(`${colors.bright}${colors.cyan}================================================${colors.reset}\n`);
  
  const totalChecks = passed + failed + 2; // +2 for endpoint tests
  const endpointsPassed = (healthResult ? 1 : 0) + (apiHealthResult ? 1 : 0);
  const totalPassed = passed + endpointsPassed;
  
  console.log(`${colors.bright}Configuration Checks:${colors.reset} ${passed}/${passed + failed} passed`);
  console.log(`${colors.bright}Endpoint Tests:${colors.reset} ${endpointsPassed}/2 passed`);
  console.log(`${colors.bright}Total:${colors.reset} ${totalPassed}/${totalChecks} checks passed\n`);
  
  if (totalPassed === totalChecks) {
    console.log(`${colors.green}${colors.bright}✅ All checks passed! Your localhost setup is ready.${colors.reset}\n`);
  } else if (endpointsPassed === 2) {
    console.log(`${colors.yellow}${colors.bright}⚠️  Server is running but configuration has warnings.${colors.reset}\n`);
  } else if (endpointsPassed === 0) {
    console.log(`${colors.red}${colors.bright}❌ Backend server is not responding. Is it running?${colors.reset}`);
    console.log(`${colors.cyan}   Start it with: npm run dev${colors.reset}\n`);
  } else {
    console.log(`${colors.yellow}${colors.bright}⚠️  Some checks failed. Please review the issues above.${colors.reset}\n`);
  }
  
  // Next steps
  console.log(`${colors.bright}Next Steps:${colors.reset}`);
  console.log(`1. Make sure backend is running: ${colors.cyan}npm run dev${colors.reset}`);
  console.log(`2. Configure frontend to use: ${colors.cyan}http://localhost:${port}/api${colors.reset}`);
  console.log(`3. Update Xero Developer Console with: ${colors.cyan}${config.XERO_REDIRECT_URI}${colors.reset}`);
  console.log(`4. See ${colors.cyan}FRONTEND_XERO_INTEGRATION_GUIDE.md${colors.reset} for frontend setup\n`);
  console.log(`${colors.cyan}Backend URL: http://localhost:${port}${colors.reset}`);
  console.log(`${colors.cyan}API Base URL: http://localhost:${port}/api${colors.reset}\n`);
}

// Run tests
runTests().catch(error => {
  console.error(`${colors.red}Error running tests:${colors.reset}`, error);
  process.exit(1);
});

