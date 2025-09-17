// XeroCredentialNotification.jsx - Notification component for missing credentials
import React from 'react';
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent
} from '@/components/ui';
import {
  AlertTriangle,
  Users,
  ExternalLink,
  Mail,
  Phone,
  Building2
} from 'lucide-react';

const XeroCredentialNotification = ({ 
  show = false, 
  onContactAdmin, 
  onDirectConnect, 
  onDismiss 
}) => {
  if (!show) return null;

  return (
    <Card className="border-yellow-200 bg-yellow-50">
      <CardContent className="p-6">
        <div className="flex items-start space-x-3">
          <AlertTriangle className="h-6 w-6 text-yellow-600 mt-1" />
          <div className="flex-1">
            <h3 className="font-medium text-yellow-800 mb-2">
              Xero Credentials Required
            </h3>
            <div className="text-yellow-700 mb-4">
              Your account does not have the required Client ID or Client Secret configured for login. 
              Please contact your Super Admin to have the credentials added to your account. 
              Meanwhile, you can proceed by directly connecting to Xero for login.
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Contact Admin Option */}
              <div className="bg-white p-4 rounded-lg border border-yellow-200">
                <h4 className="font-medium flex items-center mb-2">
                  <Users className="h-4 w-4 mr-2" />
                  Contact Super Admin
                </h4>
                <p className="text-sm text-gray-600 mb-3">
                  Ask your Super Admin to configure Xero credentials for your account.
                </p>
                <div className="space-y-2">
                  <Button 
                    size="sm" 
                    variant="outline" 
                    className="w-full"
                    onClick={onContactAdmin}
                  >
                    <Mail className="h-4 w-4 mr-1" />
                    Send Request Email
                  </Button>
                  <Button 
                    size="sm" 
                    variant="outline" 
                    className="w-full"
                  >
                    <Phone className="h-4 w-4 mr-1" />
                    Call Support
                  </Button>
                </div>
              </div>

              {/* Direct Connect Option */}
              <div className="bg-white p-4 rounded-lg border border-yellow-200">
                <h4 className="font-medium flex items-center mb-2">
                  <ExternalLink className="h-4 w-4 mr-2" />
                  Direct Connection
                </h4>
                <p className="text-sm text-gray-600 mb-3">
                  Connect directly to Xero to bypass the credential requirement.
                </p>
                <Button 
                  size="sm" 
                  className="w-full"
                  onClick={onDirectConnect}
                >
                  <Building2 className="h-4 w-4 mr-1" />
                  Connect to Xero
                  <ExternalLink className="h-3 w-3 ml-1" />
                </Button>
              </div>
            </div>

            {/* Dismiss Button */}
            {onDismiss && (
              <div className="mt-4 text-center">
                <Button 
                  size="sm" 
                  variant="ghost" 
                  onClick={onDismiss}
                  className="text-yellow-700 hover:text-yellow-800"
                >
                  Dismiss this message
                </Button>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

// Hook for managing credential notification state
export const useXeroCredentialNotification = (userRole, apiBaseUrl, authToken) => {
  const [showNotification, setShowNotification] = React.useState(false);
  const [credentialStatus, setCredentialStatus] = React.useState(null);

  React.useEffect(() => {
    if (userRole === 'admin') {
      checkCredentials();
    }
  }, [userRole]);

  const checkCredentials = async () => {
    try {
      const response = await fetch(`${apiBaseUrl}/api/xero/admin/check-credentials`, {
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        const data = await response.json();
        setCredentialStatus(data.data);
        setShowNotification(!data.data.hasCredentials);
      }
    } catch (error) {
      console.error('Error checking credentials:', error);
    }
  };

  const handleContactAdmin = () => {
    // Create email template
    const subject = encodeURIComponent('Request: Xero Credentials Configuration');
    const body = encodeURIComponent(`
Dear Super Admin,

I am requesting configuration of Xero credentials for my admin account.

Current Status:
- User Role: Admin
- Account: ${userRole}
- Request: Please configure Client ID and Client Secret for Xero integration

This will allow me to connect my Xero account and access accounting data through the dashboard.

Thank you for your assistance.

Best regards
    `);
    
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  };

  const handleDirectConnect = async () => {
    try {
      const response = await fetch(`${apiBaseUrl}/api/xero/login`, {
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        }
      });

      const data = await response.json();

      if (response.ok && data.data?.authUrl) {
        window.location.href = data.data.authUrl;
      } else {
        throw new Error(data.message || 'Failed to connect to Xero');
      }
    } catch (error) {
      console.error('Error connecting to Xero:', error);
      alert('Failed to connect to Xero: ' + error.message);
    }
  };

  const handleDismiss = () => {
    setShowNotification(false);
    // Optionally store dismissal in localStorage
    localStorage.setItem('xero-credential-notification-dismissed', 'true');
  };

  return {
    showNotification,
    credentialStatus,
    handleContactAdmin,
    handleDirectConnect,
    handleDismiss,
    checkCredentials
  };
};

export default XeroCredentialNotification;
