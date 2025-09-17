// AdminXeroLogin.jsx - Admin component with credential validation
import React, { useState, useEffect } from 'react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Button,
  Alert,
  AlertDescription,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle
} from '@/components/ui';
import {
  Building2,
  AlertCircle,
  ExternalLink,
  Loader2,
  CheckCircle,
  XCircle,
  Users,
  Phone,
  Mail
} from 'lucide-react';

const AdminXeroLogin = ({ apiBaseUrl, authToken, userRole, onCredentialCheck }) => {
  const [credentialStatus, setCredentialStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showMissingCredentialsDialog, setShowMissingCredentialsDialog] = useState(false);

  useEffect(() => {
    if (userRole === 'admin') {
      checkCredentials();
    }
  }, [userRole]);

  const checkCredentials = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch(`${apiBaseUrl}/api/xero/admin/check-credentials`, {
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        }
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Failed to check credentials');
      }

      setCredentialStatus(data.data);
      
      // Notify parent component
      if (onCredentialCheck) {
        onCredentialCheck(data.data);
      }

      // Show dialog if credentials are missing
      if (!data.data.hasCredentials) {
        setShowMissingCredentialsDialog(true);
      }

    } catch (error) {
      console.error('Error checking credentials:', error);
      setError(error.message);
    } finally {
      setLoading(false);
    }
  };

  const connectToXero = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch(`${apiBaseUrl}/api/xero/login`, {
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        }
      });

      const data = await response.json();

      if (!response.ok) {
        // Check if it's the specific missing credentials error
        if (data.errorCode === 'ADMIN_CREDENTIALS_MISSING') {
          setShowMissingCredentialsDialog(true);
          return;
        }
        throw new Error(data.message || 'Failed to connect to Xero');
      }

      if (data.success && data.data.authUrl) {
        // Redirect to Xero OAuth
        window.location.href = data.data.authUrl;
      }
    } catch (error) {
      console.error('Error connecting to Xero:', error);
      setError(error.message);
    } finally {
      setLoading(false);
    }
  };

  const CredentialStatusCard = () => {
    if (loading && !credentialStatus) {
      return (
        <Card>
          <CardContent className="flex items-center justify-center p-6">
            <Loader2 className="h-6 w-6 animate-spin mr-2" />
            <span>Checking Xero credentials...</span>
          </CardContent>
        </Card>
      );
    }

    if (!credentialStatus) return null;

    return (
      <Card className={credentialStatus.hasCredentials ? 'border-green-200' : 'border-yellow-200'}>
        <CardHeader>
          <CardTitle className="flex items-center">
            {credentialStatus.hasCredentials ? (
              <CheckCircle className="h-5 w-5 text-green-600 mr-2" />
            ) : (
              <AlertCircle className="h-5 w-5 text-yellow-600 mr-2" />
            )}
            Xero Integration Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span>Credentials Status:</span>
              <span className={`font-medium ${credentialStatus.hasCredentials ? 'text-green-600' : 'text-yellow-600'}`}>
                {credentialStatus.hasCredentials ? 'Configured' : 'Missing'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>User Role:</span>
              <span className="font-medium">Admin</span>
            </div>
            <div className="text-sm text-gray-600">
              {credentialStatus.message}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  };

  const MissingCredentialsDialog = () => (
    <Dialog open={showMissingCredentialsDialog} onOpenChange={setShowMissingCredentialsDialog}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center">
            <AlertCircle className="h-5 w-5 text-yellow-600 mr-2" />
            Xero Credentials Required
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <Alert className="border-yellow-200 bg-yellow-50">
            <AlertCircle className="h-4 w-4 text-yellow-600" />
            <AlertDescription className="text-yellow-800">
              Your account does not have the required Client ID or Client Secret configured for login. 
              Please contact your Super Admin to have the credentials added to your account. 
              Meanwhile, you can proceed by directly connecting to Xero for login.
            </AlertDescription>
          </Alert>

          <div className="bg-gray-50 p-4 rounded-lg space-y-3">
            <h4 className="font-medium flex items-center">
              <Users className="h-4 w-4 mr-2" />
              Contact Your Super Admin
            </h4>
            <p className="text-sm text-gray-600">
              Please ask your Super Admin to configure Xero credentials for your account through the admin panel.
            </p>
            <div className="flex space-x-2">
              <Button size="sm" variant="outline" className="flex-1">
                <Mail className="h-4 w-4 mr-1" />
                Send Email
              </Button>
              <Button size="sm" variant="outline" className="flex-1">
                <Phone className="h-4 w-4 mr-1" />
                Call Support
              </Button>
            </div>
          </div>

          <div className="bg-blue-50 p-4 rounded-lg space-y-3">
            <h4 className="font-medium flex items-center">
              <ExternalLink className="h-4 w-4 mr-2" />
              Alternative: Direct Xero Connection
            </h4>
            <p className="text-sm text-gray-600">
              You can still connect directly to Xero using the button below. This will bypass the credential requirement.
            </p>
            <Button 
              onClick={connectToXero} 
              disabled={loading}
              className="w-full"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Connecting...
                </>
              ) : (
                <>
                  <Building2 className="h-4 w-4 mr-2" />
                  Connect to Xero Directly
                  <ExternalLink className="h-3 w-3 ml-1" />
                </>
              )}
            </Button>
          </div>

          <div className="flex justify-end">
            <Button 
              variant="outline" 
              onClick={() => setShowMissingCredentialsDialog(false)}
            >
              Close
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );

  // Don't render for non-admin users
  if (userRole !== 'admin') {
    return null;
  }

  return (
    <div className="space-y-6">
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <CredentialStatusCard />

      {/* Main Xero Connection Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center">
            <Building2 className="h-6 w-6 mr-2" />
            Connect to Xero
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <p className="text-gray-600">
              Connect your Xero account to load your accounting data into the dashboard.
            </p>
            
            {credentialStatus?.hasCredentials ? (
              <Button onClick={connectToXero} disabled={loading} className="w-full">
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Connecting...
                  </>
                ) : (
                  <>
                    <Building2 className="h-4 w-4 mr-2" />
                    Connect Xero Account
                    <ExternalLink className="h-3 w-3 ml-1" />
                  </>
                )}
              </Button>
            ) : (
              <div className="space-y-3">
                <Alert className="border-yellow-200 bg-yellow-50">
                  <AlertCircle className="h-4 w-4 text-yellow-600" />
                  <AlertDescription className="text-yellow-800">
                    Credentials not configured. Contact your Super Admin or connect directly.
                  </AlertDescription>
                </Alert>
                <Button 
                  onClick={() => setShowMissingCredentialsDialog(true)} 
                  variant="outline" 
                  className="w-full"
                >
                  <AlertCircle className="h-4 w-4 mr-2" />
                  View Options
                </Button>
              </div>
            )}

            <div className="text-xs text-gray-500 text-center">
              Your role: <strong>Admin</strong> • 
              Status: <strong>{credentialStatus?.hasCredentials ? 'Ready' : 'Needs Setup'}</strong>
            </div>
          </div>
        </CardContent>
      </Card>

      <MissingCredentialsDialog />
    </div>
  );
};

export default AdminXeroLogin;
