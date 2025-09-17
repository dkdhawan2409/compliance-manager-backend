// SuperAdminXeroManagement.jsx - Super Admin component for managing Xero credentials
import React, { useState, useEffect } from 'react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Button,
  Badge,
  Alert,
  AlertDescription,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  Label,
  Textarea
} from '@/components/ui';
import {
  Shield,
  Users,
  Settings,
  CheckCircle,
  XCircle,
  Plus,
  Edit,
  AlertTriangle,
  Loader2,
  Building2
} from 'lucide-react';

const SuperAdminXeroManagement = ({ apiBaseUrl, authToken }) => {
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selectedCompany, setSelectedCompany] = useState(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [credentials, setCredentials] = useState({
    clientId: '',
    clientSecret: '',
    redirectUri: ''
  });

  useEffect(() => {
    loadCompanies();
  }, []);

  const loadCompanies = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch(`${apiBaseUrl}/api/xero/admin/companies`, {
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        }
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Failed to load companies');
      }

      setCompanies(data.data || []);
    } catch (error) {
      console.error('Error loading companies:', error);
      setError(error.message);
    } finally {
      setLoading(false);
    }
  };

  const saveCredentials = async () => {
    if (!selectedCompany || !credentials.clientId || !credentials.clientSecret) {
      setError('Please fill in all required fields');
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const response = await fetch(`${apiBaseUrl}/api/xero/settings`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          companyId: selectedCompany.id,
          clientId: credentials.clientId,
          clientSecret: credentials.clientSecret,
          redirectUri: credentials.redirectUri || `${window.location.origin}/redirecturl`
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Failed to save credentials');
      }

      // Success
      setIsDialogOpen(false);
      setCredentials({ clientId: '', clientSecret: '', redirectUri: '' });
      setSelectedCompany(null);
      await loadCompanies(); // Refresh the list

      alert('Xero credentials saved successfully!');
    } catch (error) {
      console.error('Error saving credentials:', error);
      setError(error.message);
    } finally {
      setLoading(false);
    }
  };

  const openCredentialDialog = (company) => {
    setSelectedCompany(company);
    setCredentials({
      clientId: '',
      clientSecret: '',
      redirectUri: `${window.location.origin}/redirecturl`
    });
    setIsDialogOpen(true);
    setError(null);
  };

  const getStatusBadge = (company) => {
    if (company.xeroConfigured) {
      return <Badge className="bg-green-100 text-green-800">Configured</Badge>;
    } else if (company.hasXeroCredentials) {
      return <Badge className="bg-yellow-100 text-yellow-800">Partial</Badge>;
    } else {
      return <Badge className="bg-red-100 text-red-800">Not Configured</Badge>;
    }
  };

  const getStatusIcon = (company) => {
    if (company.xeroConfigured) {
      return <CheckCircle className="h-5 w-5 text-green-600" />;
    } else {
      return <XCircle className="h-5 w-5 text-red-600" />;
    }
  };

  if (loading && companies.length === 0) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center p-8">
          <Loader2 className="h-6 w-6 animate-spin mr-2" />
          <span>Loading companies...</span>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center">
            <Shield className="h-6 w-6 mr-2" />
            Super Admin - Xero Credential Management
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-600">
                {companies.length}
              </div>
              <div className="text-sm text-gray-600">Total Companies</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-green-600">
                {companies.filter(c => c.xeroConfigured).length}
              </div>
              <div className="text-sm text-gray-600">Xero Configured</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-red-600">
                {companies.filter(c => !c.xeroConfigured).length}
              </div>
              <div className="text-sm text-gray-600">Needs Configuration</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Error Alert */}
      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Companies Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center">
            <Users className="h-5 w-5 mr-2" />
            Company Xero Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Status</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Last Updated</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {companies.map((company) => (
                <TableRow key={company.id}>
                  <TableCell>
                    <div className="flex items-center space-x-2">
                      {getStatusIcon(company)}
                      {getStatusBadge(company)}
                    </div>
                  </TableCell>
                  <TableCell className="font-medium">{company.name}</TableCell>
                  <TableCell>{company.email}</TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {company.role === 'admin' ? 'Admin' : 'Company'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {company.lastUpdated 
                      ? new Date(company.lastUpdated).toLocaleDateString()
                      : 'Never'
                    }
                  </TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => openCredentialDialog(company)}
                      disabled={loading}
                    >
                      {company.xeroConfigured ? (
                        <>
                          <Edit className="h-4 w-4 mr-1" />
                          Update
                        </>
                      ) : (
                        <>
                          <Plus className="h-4 w-4 mr-1" />
                          Configure
                        </>
                      )}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {companies.length === 0 && !loading && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8">
                    <div className="text-gray-500">
                      <Building2 className="h-8 w-8 mx-auto mb-2 opacity-50" />
                      No companies found
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Credential Configuration Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              Configure Xero Credentials for {selectedCompany?.name}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="clientId">Client ID *</Label>
              <Input
                id="clientId"
                value={credentials.clientId}
                onChange={(e) => setCredentials(prev => ({
                  ...prev,
                  clientId: e.target.value
                }))}
                placeholder="Enter Xero Client ID"
              />
            </div>
            <div>
              <Label htmlFor="clientSecret">Client Secret *</Label>
              <Input
                id="clientSecret"
                type="password"
                value={credentials.clientSecret}
                onChange={(e) => setCredentials(prev => ({
                  ...prev,
                  clientSecret: e.target.value
                }))}
                placeholder="Enter Xero Client Secret"
              />
            </div>
            <div>
              <Label htmlFor="redirectUri">Redirect URI</Label>
              <Input
                id="redirectUri"
                value={credentials.redirectUri}
                onChange={(e) => setCredentials(prev => ({
                  ...prev,
                  redirectUri: e.target.value
                }))}
                placeholder="Redirect URI (optional)"
              />
            </div>
            
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                These credentials will allow the company to connect their Xero account.
                Make sure you're using the correct Client ID and Client Secret from your Xero Developer Console.
              </AlertDescription>
            </Alert>

            <div className="flex space-x-2 pt-4">
              <Button 
                onClick={saveCredentials} 
                disabled={loading || !credentials.clientId || !credentials.clientSecret}
                className="flex-1"
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Settings className="h-4 w-4 mr-2" />
                    Save Credentials
                  </>
                )}
              </Button>
              <Button 
                variant="outline" 
                onClick={() => setIsDialogOpen(false)}
                disabled={loading}
              >
                Cancel
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default SuperAdminXeroManagement;
