# 🚀 Localhost Quick Start Guide

## ✅ Your Backend is Configured for Localhost!

Everything is set up and ready to go. Here's what you need to know:

---

## 📍 Your URLs

| Service | URL |
|---------|-----|
| **Backend** | http://localhost:3333 |
| **API Base** | http://localhost:3333/api |
| **Frontend** | http://localhost:3001 |
| **Xero Callback** | http://localhost:3333/xero-callback |

---

## 🏃‍♂️ Running the Backend

```bash
# Navigate to backend directory
cd /Users/harbor/Desktop/compliance-management-system/backend

# Start the development server
npm run dev

# The server will start on http://localhost:3333
```

---

## ✅ Verify Setup

Run the test script to verify everything is working:

```bash
node test-localhost-setup.js
```

**Expected Output:**
```
✅ All checks passed! Your localhost setup is ready.
Configuration Checks: 7/7 passed
Endpoint Tests: 2/2 passed
Total: 9/9 checks passed
```

---

## 🔧 Frontend Setup (Quick)

### 1. Create API Client (`src/config/api.ts`)

```typescript
import axios from 'axios';

const API_BASE_URL = 'http://localhost:3333/api';

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
});

apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('authToken');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export default apiClient;
```

### 2. Create `.env.local` in Frontend

```bash
# For React
REACT_APP_API_URL=http://localhost:3333/api

# For Vite
VITE_API_URL=http://localhost:3333/api
```

### 3. Use in Components

```typescript
import { apiClient } from './config/api';

// Example: Connect to Xero
const response = await apiClient.get('/xero/login');
window.location.href = response.data.data.authUrl;
```

---

## 🔑 Xero OAuth Setup

### Update Xero Developer Console

1. Go to: https://developer.xero.com/app/manage
2. Click on your app
3. Add redirect URI: **`http://localhost:3333/xero-callback`**
4. Save changes

**⚠️ Important:** The redirect URI must **exactly match** (including the port)

---

## 🧪 Test the Integration

### 1. Start Backend
```bash
npm run dev
```

### 2. Test Endpoints
```bash
curl http://localhost:3333/health
curl http://localhost:3333/api/health
```

### 3. Start Frontend (in your frontend directory)
```bash
npm start
# Should run on http://localhost:3001
```

### 4. Test Xero OAuth Flow
1. Login to your app
2. Go to Xero Integration page
3. Click "Connect to Xero"
4. Authorize on Xero
5. You should be redirected back with organization data

---

## 📚 Complete Documentation

For detailed documentation, see:

- **`FRONTEND_XERO_INTEGRATION_GUIDE.md`** - Complete frontend integration with code examples
- **`LOCALHOST_SETUP_COMPLETE.md`** - Detailed setup information and troubleshooting

---

## 🐛 Troubleshooting

### Backend not responding?
```bash
# Check if it's running
curl http://localhost:3333/health

# If not, start it
npm run dev
```

### CORS Error?
Check `.env` has:
```bash
FRONTEND_URL=http://localhost:3001
CORS_ORIGIN=http://localhost:3001
```

### Xero OAuth Fails?
1. Check `.env`: `XERO_REDIRECT_URI=http://localhost:3333/xero-callback`
2. Verify same URI in Xero Developer Console
3. Restart backend after changing `.env`

### Port Already in Use?
```bash
# Kill process on port 3333
kill -9 $(lsof -ti:3333)

# Or change PORT in .env
```

---

## 📝 Quick Commands

```bash
# Start backend
npm run dev

# Test setup
node test-localhost-setup.js

# View logs
npm run dev | tee backend.log

# Check .env configuration
cat .env

# Restore production config
cp .env.backup .env
```

---

## 🎯 Current Configuration

Your `.env` is configured for **localhost development**:

✅ `PORT=3333`
✅ `NODE_ENV=development`
✅ `XERO_REDIRECT_URI=http://localhost:3333/xero-callback`
✅ `FRONTEND_URL=http://localhost:3001`

---

## 🔄 Switch Back to Production

When deploying to production:

1. Update `.env`:
```bash
XERO_REDIRECT_URI=https://compliance-manager-frontend.onrender.com/redirecturl
FRONTEND_URL=https://compliance-manager-frontend.onrender.com
NODE_ENV=production
```

2. Update Xero Developer Console with production URIs
3. Restart server

---

## ✨ What's New

- ✅ Backend configured for localhost (port 3333)
- ✅ Xero OAuth redirect updated for localhost
- ✅ Complete frontend integration guide
- ✅ Automated test script for verification
- ✅ Detailed troubleshooting documentation

---

## 💡 Tips

1. **Always restart backend** after changing `.env`
2. **Match Xero URIs exactly** between `.env` and Developer Console
3. **Use the test script** to verify setup: `node test-localhost-setup.js`
4. **Check browser console** (F12) for frontend errors
5. **Check terminal** for backend errors

---

## 📞 Need Help?

1. Run: `node test-localhost-setup.js`
2. Check: `FRONTEND_XERO_INTEGRATION_GUIDE.md`
3. Review: Backend terminal logs
4. Check: Browser console (F12)

---

**Setup Date**: October 10, 2025
**Status**: ✅ Ready for Development
**Backend**: http://localhost:3333
**API**: http://localhost:3333/api

