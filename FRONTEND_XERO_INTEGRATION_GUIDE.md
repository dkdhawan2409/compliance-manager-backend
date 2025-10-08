# Frontend Xero Integration Guide

This guide provides complete frontend implementation details for integrating with the updated Xero backend that now properly saves organization and tenant data.

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
import axios from 'axios';
import { toast } from 'react-hot-toast';

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
      const token = localStorage.getItem('authToken'); // Your JWT token
      const response = await axios.get('/api/xero/settings', {
        headers: { Authorization: `Bearer ${token}` }
      });
      
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
      const token = localStorage.getItem('authToken');
      
      // Get auth URL from backend
      const response = await axios.get('/api/xero/login', {
        headers: { Authorization: `Bearer ${token}` }
      });
      
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
      const token = localStorage.getItem('authToken');
      
      // Optional: Call backend to revoke tokens
      await axios.post('/api/xero/disconnect', {}, {
        headers: { Authorization: `Bearer ${token}` }
      });
      
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

Add global error handling for expired Xero tokens:

```typescript
// axios interceptor or error handling utility

import axios from 'axios';
import { toast } from 'react-hot-toast';

// Add response interceptor
axios.interceptors.response.use(
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
        action: {
          label: 'Reconnect',
          onClick: () => {
            window.location.href = '/xero-integration';
          }
        }
      });
    } else if (errorData?.error === 'XERO_NOT_CONFIGURED' || errorData?.requiresConfiguration) {
      toast.error('Xero is not configured. Please connect to Xero first.');
    }
    
    return Promise.reject(error);
  }
);
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
      
      const token = localStorage.getItem('authToken');
      const response = await axios.get('/api/xero/bas-data', {
        headers: { Authorization: `Bearer ${token}` }
      });
      
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
    return <div>Loading BAS data from Xero...</div>;
  }
  
  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded p-4">
        <p className="text-red-800">{error}</p>
        <button 
          onClick={() => window.location.href = '/xero-integration'}
          className="mt-2 text-blue-600 hover:underline"
        >
          Go to Xero Integration
        </button>
      </div>
    );
  }
  
  return (
    <div>
      <h2>BAS Data</h2>
      {/* Render BAS data */}
      <pre>{JSON.stringify(basData, null, 2)}</pre>
    </div>
  );
};
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


