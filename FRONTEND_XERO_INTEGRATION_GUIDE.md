# Frontend Xero Integration Guide

This guide provides complete frontend implementation details for integrating with the updated Xero backend that now properly saves organization and tenant data.

## 🏠 Localhost Setup

### Backend Configuration (This Repository)

1. **Update your existing `.env` file** for localhost development:

```bash
# Server Configuration
PORT=3333
NODE_ENV=development

# Database Configuration (keep your existing database settings)
DB_HOST=dpg-d1sia5nfte5s73fqq74g-a.oregon-postgres.render.com
DB_PORT=5432
DB_NAME=compliance_manager
DB_USER=compliance_manager_user
DB_PASSWORD=hcW7GQEmPXD6GJATSB55kvYb98cuUbVM

# JWT Configuration (keep your existing settings)
JWT_SECRET=ad94487608cbb42709f2de9c75f7fa5592be6c9ca5da3ba0cc49586700110674
JWT_EXPIRES_IN=7d

# Security
BCRYPT_SALT_ROUNDS=12

# CORS - Frontend URL for localhost
CORS_ORIGIN=http://localhost:3001
FRONTEND_URL=http://localhost:3001

# Xero OAuth2 Configuration
XERO_CLIENT_ID=8113118D16A84C8199677E98E3D8A446
XERO_CLIENT_SECRET=7orP8-c5dcSdusqbOS9CdNm2GvYCVACiM8c_b1P2tP8tAzyZ

# 🚨 IMPORTANT: For localhost development, change this to:
XERO_REDIRECT_URI=http://localhost:3333/xero-callback

# For production, use:
# XERO_REDIRECT_URI=https://compliance-manager-frontend.onrender.com/redirecturl

# OpenAI Configuration (optional)
OPENAI_API_KEY=your_openai_key

# Email Configuration (optional)
SENDGRID_API_KEY=your_sendgrid_key
EMAIL_FROM=noreply@yourdomain.com
```

**⚠️ Important Notes:**
- Your backend runs on port **3333** (not 5000)
- Your frontend should run on **http://localhost:3001**
- You must update the `XERO_REDIRECT_URI` in **both** your `.env` file **AND** Xero Developer Console

2. **Start the backend server**:

```bash
# Install dependencies
npm install

# Run in development mode with auto-reload
npm run dev
```

The backend will be available at: **`http://localhost:3333`**

### Frontend Configuration

1. **Create API client configuration** in your frontend project:

```typescript
// src/config/api.ts or src/utils/api.ts

import axios from 'axios';

// API Base URL for localhost development
const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:3333/api';

// Create axios instance with default config
export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: true, // Important for CORS with credentials
});

// Add request interceptor to attach JWT token
apiClient.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('authToken');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Add response interceptor for error handling
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Handle unauthorized - redirect to login
      localStorage.removeItem('authToken');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export default apiClient;
```

2. **Create `.env.local` file** in your frontend root:

```bash
# React/Vite Frontend Environment Variables
REACT_APP_API_URL=http://localhost:3333/api

# For Vite, use:
# VITE_API_URL=http://localhost:3333/api
```

3. **Update package.json** (if using Create React App):

```json
{
  "proxy": "http://localhost:3333"
}
```

### Testing Localhost Setup

1. **Test backend health**:
```bash
curl http://localhost:3333/health
```

Expected response:
```json
{
  "success": true,
  "message": "Server is running",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

2. **Test API endpoint**:
```bash
curl http://localhost:3333/api/health
```

Expected response:
```json
{
  "success": true,
  "message": "API server is running",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "version": "1.0.0"
}
```

### Xero OAuth Setup for Localhost

1. **Go to Xero Developer Portal**: https://developer.xero.com/app/manage
2. **Select your app** (or create new one if needed)
3. **Add localhost redirect URI**:
   - Click "Add Redirect URI"
   - Add: `http://localhost:3333/xero-callback`
   - Click "Save"
4. **Update your `.env` file**:
   ```bash
   XERO_REDIRECT_URI=http://localhost:3333/xero-callback
   ```
5. **Restart your backend server** after changing `.env`

**🔴 Common Mistake**: The Xero redirect URI in your `.env` file **must exactly match** the one in Xero Developer Console (including protocol, port, and path).

---

## 🎯 Overview of Changes

The backend now saves the following additional data after OAuth:
- ✅ `tenant_id` - Xero organization identifier
- ✅ `organization_name` - Xero organization name
- ✅ `tenant_data` - Complete tenant information (JSONB)

This enables the frontend to display organization names and properly load BAS/FAS data.

---

## 📋 Required Frontend Changes

### 1. **Update Xero Callback Handler** (`/redirecturl` route)

The callback URL now includes tenant information in the success response.

#### **Before:**
```typescript
// Old callback handler - missing tenant data extraction
const XeroCallback = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  
  useEffect(() => {
    const success = searchParams.get('success');
    const error = searchParams.get('error');
    
    if (success === 'true') {
      navigate('/xero-success');
    } else {
      navigate('/xero-error');
    }
  }, [searchParams, navigate]);
  
  return <div>Processing...</div>;
};
```

#### **After (UPDATED):**
```typescript
import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast'; // or your toast library

interface XeroTenant {
  tenantId: string;
  tenantName: string;
  tenantType: string;
  createdDateUtc: string;
  updatedDateUtc: string;
}

const XeroCallback = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [isProcessing, setIsProcessing] = useState(true);
  
  useEffect(() => {
    const processCallback = async () => {
      try {
        const success = searchParams.get('success');
        const companyId = searchParams.get('companyId');
        const tenantsParam = searchParams.get('tenants');
        const error = searchParams.get('error');
        const errorDetails = searchParams.get('errorDetails');
        const errorCode = searchParams.get('errorCode');
        const helpUrl = searchParams.get('helpUrl');
        
        if (success === 'true') {
          // Parse tenant data
          let tenants: XeroTenant[] = [];
          if (tenantsParam) {
            try {
              tenants = JSON.parse(decodeURIComponent(tenantsParam));
            } catch (parseError) {
              console.error('Failed to parse tenant data:', parseError);
            }
          }
          
          // Extract primary tenant information
          const primaryTenant = tenants[0];
          const organizationName = primaryTenant?.tenantName || 'Unknown Organization';
          const tenantId = primaryTenant?.tenantId || '';
          
          console.log('✅ Xero connected successfully!');
          console.log('📊 Organization:', organizationName);
          console.log('🆔 Tenant ID:', tenantId);
          console.log('🏢 Total organizations:', tenants.length);
          
          // Store tenant information in localStorage or state management
          localStorage.setItem('xeroConnected', 'true');
          localStorage.setItem('xeroOrganizationName', organizationName);
          localStorage.setItem('xeroTenantId', tenantId);
          localStorage.setItem('xeroTenants', JSON.stringify(tenants));
          
          // Show success message with organization name
          toast.success(`Successfully connected to ${organizationName}!`);
          
          // Redirect to Xero integration page or dashboard
          navigate('/xero-integration', { 
            state: { 
              justConnected: true,
              organizationName,
              tenantId,
              tenants 
            } 
          });
          
        } else {
          // Handle errors
          console.error('❌ Xero connection failed:', error);
          console.error('📋 Error details:', errorDetails);
          console.error('🔢 Error code:', errorCode);
          
          // Show user-friendly error message
          let errorMessage = error || 'Failed to connect to Xero';
          
          // Handle specific error codes
          if (errorCode === 'invalid_grant') {
            errorMessage = 'Authorization expired. Please try connecting again.';
          } else if (errorCode === 'invalid_client') {
            errorMessage = 'Invalid Xero credentials. Please contact support.';
          } else if (errorCode === 'invalid_redirect_uri') {
            errorMessage = 'Xero configuration error. Please contact support.';
          }
          
          toast.error(errorMessage);
          
          // Redirect to error page with details
          navigate('/xero-integration', { 
            state: { 
              error: errorMessage,
              errorDetails,
              errorCode,
              helpUrl 
            } 
          });
        }
      } catch (error) {
        console.error('Error processing Xero callback:', error);
        toast.error('Failed to process Xero connection');
        navigate('/xero-integration');
      } finally {
        setIsProcessing(false);
      }
    };
    
    processCallback();
  }, [searchParams, navigate]);
  
  if (isProcessing) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <h2 className="text-xl font-semibold">Connecting to Xero...</h2>
          <p className="text-gray-600 mt-2">Please wait while we complete the connection</p>
        </div>
      </div>
    );
  }
  
  return null;
};

export default XeroCallback;
```

---

### 2. **Update Xero Integration Page**

Display the connected organization name and handle reconnection for expired tokens.

```typescript
import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { apiClient } from '../config/api'; // Import the configured API client

interface XeroConnectionInfo {
  isConnected: boolean;
  organizationName: string | null;
  tenantId: string | null;
  tenants: any[];
}

const XeroIntegrationPage = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);
  const [connectionInfo, setConnectionInfo] = useState<XeroConnectionInfo>({
    isConnected: false,
    organizationName: null,
    tenantId: null,
    tenants: []
  });

  // Load connection info from localStorage and backend
  useEffect(() => {
    loadConnectionInfo();
    
    // Check if just connected
    if (location.state?.justConnected) {
      setConnectionInfo({
        isConnected: true,
        organizationName: location.state.organizationName,
        tenantId: location.state.tenantId,
        tenants: location.state.tenants || []
      });
    }
    
    // Check if there was an error
    if (location.state?.error) {
      toast.error(location.state.error);
    }
  }, [location]);

  const loadConnectionInfo = async () => {
    try {
      // Check localStorage first
      const isConnected = localStorage.getItem('xeroConnected') === 'true';
      const organizationName = localStorage.getItem('xeroOrganizationName');
      const tenantId = localStorage.getItem('xeroTenantId');
      const tenantsStr = localStorage.getItem('xeroTenants');
      
      if (isConnected && organizationName && tenantId) {
        setConnectionInfo({
          isConnected: true,
          organizationName,
          tenantId,
          tenants: tenantsStr ? JSON.parse(tenantsStr) : []
        });
      } else {
        // Verify with backend
        await checkBackendConnection();
      }
    } catch (error) {
      console.error('Error loading connection info:', error);
    }
  };

  const checkBackendConnection = async () => {
    try {
      // No need to manually add token - apiClient handles it automatically
      const response = await apiClient.get('/xero/settings');
      
      if (response.data.success && response.data.data.isConnected) {
        const tenants = response.data.data.tenants || [];
        const primaryTenant = tenants[0];
        
        setConnectionInfo({
          isConnected: true,
          organizationName: primaryTenant?.tenantName || primaryTenant?.organizationName,
          tenantId: primaryTenant?.tenantId,
          tenants: tenants
        });
        
        // Update localStorage
        if (primaryTenant) {
          localStorage.setItem('xeroConnected', 'true');
          localStorage.setItem('xeroOrganizationName', primaryTenant.tenantName || primaryTenant.organizationName);
          localStorage.setItem('xeroTenantId', primaryTenant.tenantId);
          localStorage.setItem('xeroTenants', JSON.stringify(tenants));
        }
      }
    } catch (error: any) {
      if (error.response?.status === 401) {
        // Token expired
        toast.error('Session expired. Please log in again.');
        navigate('/login');
      }
    }
  };

  const handleConnectXero = async () => {
    try {
      setIsLoading(true);
      
      // Get auth URL from backend - apiClient adds the token automatically
      const response = await apiClient.get('/xero/login');
      
      if (response.data.success) {
        // Redirect to Xero OAuth page
        window.location.href = response.data.data.authUrl;
      } else {
        toast.error(response.data.message || 'Failed to initiate Xero connection');
      }
    } catch (error: any) {
      console.error('Error connecting to Xero:', error);
      
      // Handle specific errors
      if (error.response?.data?.error === 'XERO_TOKEN_EXPIRED') {
        toast.error('Xero connection expired. Please reconnect.');
      } else if (error.response?.data?.requiresConfiguration) {
        toast.error('Xero is not configured. Please contact support.');
      } else {
        toast.error('Failed to connect to Xero. Please try again.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleDisconnectXero = async () => {
    if (!window.confirm('Are you sure you want to disconnect from Xero?')) {
      return;
    }
    
    try {
      setIsLoading(true);
      
      // Optional: Call backend to revoke tokens - apiClient adds the token automatically
      await apiClient.post('/xero/disconnect');
      
      // Clear localStorage
      localStorage.removeItem('xeroConnected');
      localStorage.removeItem('xeroOrganizationName');
      localStorage.removeItem('xeroTenantId');
      localStorage.removeItem('xeroTenants');
      
      setConnectionInfo({
        isConnected: false,
        organizationName: null,
        tenantId: null,
        tenants: []
      });
      
      toast.success('Disconnected from Xero successfully');
    } catch (error) {
      console.error('Error disconnecting from Xero:', error);
      toast.error('Failed to disconnect from Xero');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-6">
      <h1 className="text-3xl font-bold mb-6">Xero Integration</h1>
      
      {connectionInfo.isConnected ? (
        <div className="bg-green-50 border border-green-200 rounded-lg p-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold text-green-800 mb-2">
                ✅ Connected to Xero
              </h2>
              <p className="text-green-700">
                <strong>Organization:</strong> {connectionInfo.organizationName}
              </p>
              <p className="text-green-600 text-sm mt-1">
                <strong>Tenant ID:</strong> {connectionInfo.tenantId}
              </p>
              {connectionInfo.tenants.length > 1 && (
                <p className="text-green-600 text-sm mt-1">
                  You have access to {connectionInfo.tenants.length} organizations
                </p>
              )}
            </div>
            <button
              onClick={handleDisconnectXero}
              disabled={isLoading}
              className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
            >
              {isLoading ? 'Disconnecting...' : 'Disconnect'}
            </button>
          </div>
          
          {/* Show BAS/FAS data sections here */}
          <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-white p-4 rounded shadow">
              <h3 className="font-semibold mb-2">📊 BAS Data</h3>
              <p className="text-sm text-gray-600">
                View and manage BAS compliance data from {connectionInfo.organizationName}
              </p>
              <button 
                onClick={() => navigate('/xero/bas-data')}
                className="mt-2 text-blue-600 hover:underline text-sm"
              >
                View BAS Data →
              </button>
            </div>
            
            <div className="bg-white p-4 rounded shadow">
              <h3 className="font-semibold mb-2">📈 FAS Data</h3>
              <p className="text-sm text-gray-600">
                View and manage FAS compliance data from {connectionInfo.organizationName}
              </p>
              <button 
                onClick={() => navigate('/xero/fas-data')}
                className="mt-2 text-blue-600 hover:underline text-sm"
              >
                View FAS Data →
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
          <h2 className="text-xl font-semibold text-blue-800 mb-2">
            Connect to Xero
          </h2>
          <p className="text-blue-700 mb-4">
            Connect your Xero account to automatically sync compliance data and manage BAS/FAS reporting.
          </p>
          <button
            onClick={handleConnectXero}
            disabled={isLoading}
            className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-semibold"
          >
            {isLoading ? 'Connecting...' : 'Connect to Xero'}
          </button>
        </div>
      )}
      
      {/* Token expiry warning */}
      <div className="mt-6 bg-yellow-50 border border-yellow-200 rounded-lg p-4">
        <h3 className="font-semibold text-yellow-800 mb-2">⚠️ Important Note</h3>
        <p className="text-yellow-700 text-sm">
          Xero refresh tokens expire after 60 days of inactivity. If you see errors loading data, 
          please disconnect and reconnect to Xero to refresh your connection.
        </p>
      </div>
    </div>
  );
};

export default XeroIntegrationPage;
```

---

### 3. **Handle Expired Token Errors**

The apiClient already includes error handling, but you can add Xero-specific handling:

```typescript
// Add this to your src/config/api.ts file (update the apiClient)

import axios from 'axios';
import { toast } from 'react-hot-toast';

// API Base URL for localhost development
const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:3333/api';

// Create axios instance with default config
export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: true,
});

// Add request interceptor to attach JWT token
apiClient.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('authToken');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Add response interceptor for error handling (including Xero errors)
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    const errorData = error.response?.data;
    
    // Handle Xero-specific errors
    if (errorData?.error === 'XERO_TOKEN_EXPIRED' || errorData?.requiresReconnection) {
      // Clear Xero connection info
      localStorage.removeItem('xeroConnected');
      localStorage.removeItem('xeroOrganizationName');
      localStorage.removeItem('xeroTenantId');
      localStorage.removeItem('xeroTenants');
      
      // Show reconnection prompt
      toast.error('Xero connection expired. Please reconnect to Xero.', {
        duration: 5000,
      });
      
      // Optional: Redirect to Xero integration page
      setTimeout(() => {
        window.location.href = '/xero-integration';
      }, 2000);
    } else if (errorData?.error === 'XERO_NOT_CONFIGURED' || errorData?.requiresConfiguration) {
      toast.error('Xero is not configured. Please connect to Xero first.');
    } else if (error.response?.status === 401) {
      // Handle unauthorized - redirect to login
      localStorage.removeItem('authToken');
      window.location.href = '/login';
    }
    
    return Promise.reject(error);
  }
);

export default apiClient;
```

---

### 4. **Display Organization Name in Dashboard/Header**

```typescript
const DashboardHeader = () => {
  const [xeroOrg, setXeroOrg] = useState<string | null>(null);
  
  useEffect(() => {
    const orgName = localStorage.getItem('xeroOrganizationName');
    setXeroOrg(orgName);
  }, []);
  
  return (
    <header className="bg-white shadow">
      <div className="flex items-center justify-between p-4">
        <h1 className="text-2xl font-bold">Compliance Dashboard</h1>
        {xeroOrg && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600">Connected to:</span>
            <span className="px-3 py-1 bg-green-100 text-green-800 rounded-full text-sm font-medium">
              {xeroOrg}
            </span>
          </div>
        )}
      </div>
    </header>
  );
};
```

---

### 5. **BAS/FAS Data Loading Components**

```typescript
import { useEffect, useState } from 'react';
import { apiClient } from '../config/api'; // Import the configured API client

const BASDataPage = () => {
  const [basData, setBasData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  useEffect(() => {
    loadBASData();
  }, []);
  
  const loadBASData = async () => {
    try {
      setIsLoading(true);
      setError(null);
      
      // apiClient handles authentication automatically
      const response = await apiClient.get('/xero/bas-data');
      
      if (response.data.success) {
        setBasData(response.data.data);
      }
    } catch (error: any) {
      console.error('Error loading BAS data:', error);
      
      // Handle specific errors
      if (error.response?.data?.error === 'XERO_TOKEN_EXPIRED') {
        setError('Xero connection expired. Please reconnect to Xero.');
      } else if (error.response?.data?.error === 'XERO_NOT_CONFIGURED') {
        setError('Xero is not connected. Please connect to Xero first.');
      } else {
        setError('Failed to load BAS data. Please try again.');
      }
    } finally {
      setIsLoading(false);
    }
  };
  
  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-700">Loading BAS data from Xero...</p>
        </div>
      </div>
    );
  }
  
  if (error) {
    return (
      <div className="max-w-2xl mx-auto mt-8">
        <div className="bg-red-50 border border-red-200 rounded-lg p-6">
          <h3 className="text-lg font-semibold text-red-800 mb-2">Error Loading BAS Data</h3>
          <p className="text-red-700 mb-4">{error}</p>
          <button 
            onClick={() => window.location.href = '/xero-integration'}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Go to Xero Integration
          </button>
        </div>
      </div>
    );
  }
  
  return (
    <div className="max-w-6xl mx-auto p-6">
      <h2 className="text-2xl font-bold mb-6">BAS Data</h2>
      <div className="bg-white rounded-lg shadow p-6">
        {/* Render BAS data - customize based on your data structure */}
        <pre className="bg-gray-50 p-4 rounded overflow-auto">
          {JSON.stringify(basData, null, 2)}
        </pre>
      </div>
    </div>
  );
};

export default BASDataPage;
```

---

## 🔧 TypeScript Interfaces

```typescript
// types/xero.ts

export interface XeroTenant {
  id: string;
  tenantId: string;
  tenantName: string;
  tenantType: string;
  createdDateUtc: string;
  updatedDateUtc: string;
  organizationName?: string;
  name?: string;
  connectionId?: string;
}

export interface XeroConnectionStatus {
  isConnected: boolean;
  organizationName: string | null;
  tenantId: string | null;
  tenants: XeroTenant[];
}

export interface XeroCallbackParams {
  success: string;
  companyId?: string;
  tenants?: string;
  error?: string;
  errorDetails?: string;
  errorCode?: string;
  helpUrl?: string;
}

export interface XeroErrorResponse {
  success: false;
  message: string;
  error: string; // 'XERO_TOKEN_EXPIRED' | 'XERO_NOT_CONFIGURED' | etc.
  requiresReconnection?: boolean;
  requiresConfiguration?: boolean;
  isTemporary?: boolean;
}
```

---

## 📝 Summary of Frontend Changes

### **Required Changes:**
1. ✅ Update `/redirecturl` callback handler to extract and store tenant data
2. ✅ Display organization name in UI
3. ✅ Handle expired token errors with reconnection prompts
4. ✅ Add localStorage persistence for connection info
5. ✅ Update error handling for Xero-specific errors

### **Optional Enhancements:**
- Multi-organization selector (if user has multiple Xero orgs)
- Connection status indicator in header/dashboard
- Automatic token refresh attempts before showing errors
- BAS/FAS data caching with organization context

---

## 🧪 Testing Checklist

- [ ] Xero OAuth flow completes successfully
- [ ] Organization name displays after connection
- [ ] Tenant ID is stored in localStorage
- [ ] BAS/FAS data loads correctly
- [ ] Expired token shows reconnection prompt
- [ ] Disconnection clears all stored data
- [ ] Error messages are user-friendly
- [ ] Page refreshes maintain connection state

---

## 🚀 Deployment Notes

**For existing users:**
- They will need to disconnect and reconnect to Xero to populate the new organization data
- Add a banner/notification prompting them to reconnect

**For new users:**
- Everything will work automatically on first connection

---

## 📞 Support

If you encounter issues:
1. Check browser console for detailed error logs
2. Verify localStorage has `xeroConnected`, `xeroOrganizationName`, and `xeroTenantId`
3. Check backend logs for OAuth callback processing
4. Ensure database has `organization_name` and `tenant_data` columns

---

## 🚀 Quick Start Guide (Localhost)

### Step 1: Backend Setup

```bash
# Navigate to backend directory
cd /Users/harbor/Desktop/compliance-management-system/backend

# Install dependencies
npm install

# Create .env file (see .env.example)
cp .env.example .env

# Edit .env with your actual values
nano .env

# Start the backend server
npm run dev
```

Backend will run at: **http://localhost:3333**

### Step 2: Test Backend

```bash
# Test health endpoint
curl http://localhost:3333/health

# Test API endpoint
curl http://localhost:3333/api/health
```

### Step 3: Frontend Setup

In your frontend project:

```bash
# Create API configuration
mkdir -p src/config
touch src/config/api.ts

# Add the apiClient code (from section above)
# Copy the code from "Frontend Configuration" section

# Create .env.local
echo "REACT_APP_API_URL=http://localhost:3333/api" > .env.local

# For Vite projects:
echo "VITE_API_URL=http://localhost:3333/api" > .env.local

# Install dependencies if needed
npm install axios react-hot-toast react-router-dom

# Start frontend
npm start
```

### Step 4: Test Integration

1. **Open frontend**: http://localhost:3001
2. **Login** to your application
3. **Navigate to Xero Integration** page
4. **Click "Connect to Xero"**
5. **Authorize** on Xero's page
6. **Verify** you see the organization name after redirect

### Common Issues & Solutions

#### Issue: CORS Error
**Solution**: Ensure backend `.env` has:
```bash
FRONTEND_URL=http://localhost:3001
CORS_ORIGIN=http://localhost:3001
```

#### Issue: 401 Unauthorized
**Solution**: Check if JWT token is being stored and sent correctly

#### Issue: Xero OAuth fails
**Solution**: 
1. Verify Xero redirect URI in `.env`: `http://localhost:3333/xero-callback`
2. Add the same URI in Xero Developer Console
3. Restart backend after changing `.env`
4. Ensure `XERO_CLIENT_ID` and `XERO_CLIENT_SECRET` are correct

#### Issue: Database connection fails
**Solution**: Verify PostgreSQL is running and credentials in `.env` are correct

```bash
# Check PostgreSQL status
psql -U your_db_user -d compliance_management -c "SELECT 1;"
```

---

## 📝 Environment Variables Reference

### Backend (.env)

| Variable | Description | Example |
|----------|-------------|---------|
| `NODE_ENV` | Environment mode | `development` or `production` |
| `PORT` | Server port | `3333` |
| `DB_HOST` | Database host | `localhost` or remote host |
| `DB_PORT` | Database port | `5432` |
| `DB_NAME` | Database name | `compliance_manager` |
| `DB_USER` | Database user | `compliance_manager_user` |
| `DB_PASSWORD` | Database password | `your_password` |
| `JWT_SECRET` | JWT secret key | `your-secret-key` |
| `JWT_EXPIRES_IN` | JWT expiration | `7d` |
| `BCRYPT_SALT_ROUNDS` | Password hashing rounds | `12` |
| `CORS_ORIGIN` | CORS allowed origin | `http://localhost:3001` |
| `FRONTEND_URL` | Frontend URL | `http://localhost:3001` |
| `XERO_CLIENT_ID` | Xero OAuth client ID | From Xero Developer Console |
| `XERO_CLIENT_SECRET` | Xero OAuth secret | From Xero Developer Console |
| `XERO_REDIRECT_URI` | Xero callback URI | `http://localhost:3333/xero-callback` |

### Frontend (.env.local)

| Variable | Description | Example |
|----------|-------------|---------|
| `REACT_APP_API_URL` | Backend API URL (React) | `http://localhost:3333/api` |
| `VITE_API_URL` | Backend API URL (Vite) | `http://localhost:3333/api` |




