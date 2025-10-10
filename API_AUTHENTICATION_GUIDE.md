# API Authentication Guide - Localhost

## 🔐 Why You're Getting "Access denied. No token provided."

The Xero endpoints require **JWT authentication**. You need to login first to get a token.

---

## 🚀 Quick Start

### Option 1: Use the Test Script (Easiest)

```bash
node test-xero-connection-localhost.js
```

The script will:
1. Ask for your login credentials
2. Get a JWT token automatically
3. Test the Xero connection
4. Provide you with the Xero authorization URL

---

### Option 2: Manual API Testing with curl

#### Step 1: Login to Get JWT Token

```bash
curl -X POST http://localhost:3333/api/companies/login \
  -H "Content-Type: application/json" \
  -d '{
    "username": "your_username",
    "password": "your_password"
  }'
```

**Response:**
```json
{
  "success": true,
  "message": "Login successful",
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "company": { ... }
  }
}
```

**Save the token** from the response!

#### Step 2: Get Xero Authorization URL

```bash
curl http://localhost:3333/api/xero/login \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"
```

**Response:**
```json
{
  "success": true,
  "data": {
    "authUrl": "https://login.xero.com/identity/connect/authorize?..."
  }
}
```

#### Step 3: Open the Authorization URL

1. Copy the `authUrl` from the response
2. Open it in your browser
3. Authorize the application on Xero
4. You'll be redirected back to `http://localhost:3333/xero-callback`

#### Step 4: Check Connection Status

```bash
curl http://localhost:3333/api/xero/status \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"
```

---

## 📋 All Xero Endpoints (Require Authentication)

All these endpoints need the `Authorization: Bearer <token>` header:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/xero/login` | GET | Get Xero authorization URL |
| `/api/xero/connect` | GET | Connect to Xero (same as login) |
| `/api/xero/status` | GET | Check Xero connection status |
| `/api/xero/settings` | GET | Get Xero settings |
| `/api/xero/settings` | POST | Save Xero settings |
| `/api/xero/tenants` | GET | Get connected Xero organizations |
| `/api/xero/disconnect` | DELETE | Disconnect from Xero |
| `/api/xero/refresh-token` | POST | Refresh Xero access token |

---

## 🧪 Testing Authentication

### Test 1: Health Check (No Auth Required)
```bash
curl http://localhost:3333/health
# ✅ Should return: {"success":true,"message":"Server is running"}
```

### Test 2: Login (Get Token)
```bash
curl -X POST http://localhost:3333/api/companies/login \
  -H "Content-Type: application/json" \
  -d '{"username":"test_user","password":"test_password"}'
```

### Test 3: Xero Status (Requires Token)
```bash
curl http://localhost:3333/api/xero/status \
  -H "Authorization: Bearer <YOUR_TOKEN>"
```

---

## 🔑 Creating a Test User

If you don't have a user account, create one:

```bash
# Check if you have any test users
node -e "
const db = require('./src/config/database');
db.query('SELECT id, username, email FROM companies LIMIT 5')
  .then(result => {
    console.log('Available users:');
    console.table(result.rows);
    process.exit(0);
  })
  .catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
  });
"
```

Or create a new test user with a script:

```bash
node create-test-user.js
```

---

## 💡 Frontend Integration

### Using the API Client

```typescript
import { apiClient } from './config/api';

// Login
const loginResponse = await apiClient.post('/companies/login', {
  username: 'user@example.com',
  password: 'password'
});

const token = loginResponse.data.data.token;
localStorage.setItem('authToken', token);

// Now apiClient will automatically use the token for all requests
// Get Xero auth URL
const xeroResponse = await apiClient.get('/xero/login');
window.location.href = xeroResponse.data.data.authUrl;
```

### Manual axios Request

```typescript
import axios from 'axios';

// Login first
const loginResponse = await axios.post('http://localhost:3333/api/companies/login', {
  username: 'user@example.com',
  password: 'password'
});

const token = loginResponse.data.data.token;

// Use token for Xero requests
const xeroResponse = await axios.get('http://localhost:3333/api/xero/login', {
  headers: {
    Authorization: `Bearer ${token}`
  }
});

console.log('Xero Auth URL:', xeroResponse.data.data.authUrl);
```

---

## 🐛 Common Issues

### Issue: "Access denied. No token provided."
**Cause**: Request doesn't include Authorization header
**Fix**: Add `Authorization: Bearer <token>` header to your request

### Issue: "Invalid token" or 401 Unauthorized
**Cause**: Token is expired or invalid
**Fix**: Login again to get a new token

### Issue: "User not found" during login
**Cause**: No user account exists
**Fix**: Create a test user or check your credentials

### Issue: Token works in curl but not in browser
**Cause**: CORS or browser security settings
**Fix**: Ensure your frontend is running on `http://localhost:3001` and includes `withCredentials: true`

---

## 📝 Example: Complete Xero Connection Flow

```bash
# 1. Login
TOKEN=$(curl -s -X POST http://localhost:3333/api/companies/login \
  -H "Content-Type: application/json" \
  -d '{"username":"test","password":"test"}' \
  | jq -r '.data.token')

echo "Token: $TOKEN"

# 2. Get Xero auth URL
AUTH_URL=$(curl -s http://localhost:3333/api/xero/login \
  -H "Authorization: Bearer $TOKEN" \
  | jq -r '.data.authUrl')

echo "Open this URL: $AUTH_URL"

# 3. After authorizing on Xero, check status
curl -s http://localhost:3333/api/xero/status \
  -H "Authorization: Bearer $TOKEN" \
  | jq '.'
```

---

## 🎯 Quick Commands

```bash
# Run interactive test script
node test-xero-connection-localhost.js

# Test health (no auth needed)
curl http://localhost:3333/health

# Test API health (no auth needed)
curl http://localhost:3333/api/health

# Login and save token
curl -X POST http://localhost:3333/api/companies/login \
  -H "Content-Type: application/json" \
  -d '{"username":"YOUR_USERNAME","password":"YOUR_PASSWORD"}'

# Test with token
curl http://localhost:3333/api/xero/status \
  -H "Authorization: Bearer YOUR_TOKEN"
```

---

## 📚 Related Documentation

- **`LOCALHOST_QUICK_START.md`** - Quick start guide
- **`FRONTEND_XERO_INTEGRATION_GUIDE.md`** - Frontend integration
- **`test-xero-connection-localhost.js`** - Interactive test script

---

## ✅ Checklist

- [ ] Backend is running on http://localhost:3333
- [ ] You have valid login credentials
- [ ] You can get a JWT token by logging in
- [ ] You include the token in Authorization header
- [ ] Xero redirect URI is set to `http://localhost:3333/xero-callback`
- [ ] Xero Developer Console has the localhost redirect URI

---

**Last Updated**: October 10, 2025
**Server**: http://localhost:3333
**API Base**: http://localhost:3333/api

