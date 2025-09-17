// RoleBasedXeroIntegration.jsx - Main component that handles different user roles
import React, { useState, useEffect } from 'react';
import {
  Card,
  CardContent,
  Alert,
  AlertDescription
} from '@/components/ui';
import {
  Shield,
  Building2,
  Users,
  AlertCircle,
  Loader2
} from 'lucide-react';

// Import role-specific components
import SuperAdminXeroManagement from './SuperAdminXeroManagement';
import AdminXeroLogin from './AdminXeroLogin';
import XeroIntegration from './XeroIntegration'; // Your existing component

const RoleBasedXeroIntegration = ({ 
  apiBaseUrl, 
  authToken, 
  userRole, 
  companyData 
}) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [credentialStatus, setCredentialStatus] = useState(null);

  useEffect(() => {
    // Initialize based on role
    setLoading(false);
  }, [userRole]);

  const handleCredentialCheck = (status) => {
    setCredentialStatus(status);
  };

  const getRoleIcon = () => {
    switch (userRole) {
      case 'superadmin':
        return <Shield className="h-6 w-6 text-purple-600" />;
      case 'admin':
        return <Users className="h-6 w-6 text-blue-600" />;
      default:
        return <Building2 className="h-6 w-6 text-green-600" />;
    }
  };

  const getRoleTitle = () => {
    switch (userRole) {
      case 'superadmin':
        return 'Super Admin - Xero Management';
      case 'admin':
        return 'Admin - Xero Integration';
      default:
        return 'Company - Xero Integration';
    }
  };

  const getRoleDescription = () => {
    switch (userRole) {
      case 'superadmin':
        return 'Manage Xero credentials for all companies and users.';
      case 'admin':
        return 'Connect your Xero account to access accounting data.';
      default:
        return 'Connect your company Xero account to load data in your dashboard.';
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center p-8">
          <Loader2 className="h-6 w-6 animate-spin mr-2" />
          <span>Loading Xero integration...</span>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      {/* Role Header */}
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center space-x-3">
            {getRoleIcon()}
            <div>
              <h1 className="text-xl font-semibold">{getRoleTitle()}</h1>
              <p className="text-gray-600">{getRoleDescription()}</p>
            </div>
          </div>
          
          {companyData && (
            <div className="mt-4 pt-4 border-t border-gray-200">
              <div className="text-sm text-gray-600">
                <strong>Company:</strong> {companyData.name} • 
                <strong>Role:</strong> {userRole.charAt(0).toUpperCase() + userRole.slice(1)} • 
                <strong>Email:</strong> {companyData.email}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Role-specific Content */}
      {userRole === 'superadmin' && (
        <SuperAdminXeroManagement 
          apiBaseUrl={apiBaseUrl}
          authToken={authToken}
        />
      )}

      {userRole === 'admin' && (
        <AdminXeroLogin
          apiBaseUrl={apiBaseUrl}
          authToken={authToken}
          userRole={userRole}
          onCredentialCheck={handleCredentialCheck}
        />
      )}

      {userRole !== 'superadmin' && userRole !== 'admin' && (
        <XeroIntegration
          apiBaseUrl={apiBaseUrl}
          authToken={authToken}
        />
      )}

      {/* Additional Info for Admin after credential check */}
      {userRole === 'admin' && credentialStatus?.hasCredentials && (
        <Card>
          <CardContent className="p-4">
            <Alert className="border-green-200 bg-green-50">
              <AlertCircle className="h-4 w-4 text-green-600" />
              <AlertDescription className="text-green-800">
                Great! Your Xero credentials are configured. You can now connect to Xero and access your accounting data.
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>
      )}

      {/* Role-specific Help */}
      <Card>
        <CardContent className="p-4">
          <h3 className="font-medium mb-2">Need Help?</h3>
          <div className="text-sm text-gray-600 space-y-1">
            {userRole === 'superadmin' && (
              <>
                <p>• Configure Xero credentials for companies and admin users</p>
                <p>• Monitor connection status across all accounts</p>
                <p>• Manage Xero app settings and permissions</p>
              </>
            )}
            {userRole === 'admin' && (
              <>
                <p>• If credentials are missing, contact your Super Admin</p>
                <p>• You can still connect directly to Xero if needed</p>
                <p>• Once connected, your accounting data will appear in the dashboard</p>
              </>
            )}
            {userRole !== 'superadmin' && userRole !== 'admin' && (
              <>
                <p>• Click "Connect Xero" to link your accounting data</p>
                <p>• Your data is secure and only visible to your company</p>
                <p>• You can disconnect at any time from the settings</p>
              </>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default RoleBasedXeroIntegration;
