// App-RoleBased.jsx - Example implementation of role-based Xero integration
import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import RoleBasedXeroIntegration from './components/RoleBasedXeroIntegration';
import XeroCredentialNotification, { useXeroCredentialNotification } from './components/XeroCredentialNotification';
import XeroCallback from './components/XeroCallback';

// Mock auth hook - replace with your actual auth system
const useAuth = () => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Simulate loading user data
    const token = localStorage.getItem('authToken');
    if (token) {
      // In real app, verify token and get user data
      const userData = JSON.parse(localStorage.getItem('userData') || '{}');
      setUser(userData);
    }
    setLoading(false);
  }, []);

  return { user, loading, token: localStorage.getItem('authToken') };
};

// Main Dashboard Component
const Dashboard = () => {
  const { user, token } = useAuth();
  const apiBaseUrl = process.env.REACT_APP_API_BASE_URL || 'https://compliance-manager-backend.onrender.com';
  
  // Use the credential notification hook for admin users
  const {
    showNotification,
    credentialStatus,
    handleContactAdmin,
    handleDirectConnect,
    handleDismiss
  } = useXeroCredentialNotification(user?.role, apiBaseUrl, token);

  if (!user || !token) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">
            Dashboard - {user.name}
          </h1>
          <p className="text-gray-600">
            Role: {user.role?.charAt(0).toUpperCase() + user.role?.slice(1)}
          </p>
        </div>

        {/* Show credential notification for admin users */}
        {user.role === 'admin' && (
          <div className="mb-6">
            <XeroCredentialNotification
              show={showNotification}
              onContactAdmin={handleContactAdmin}
              onDirectConnect={handleDirectConnect}
              onDismiss={handleDismiss}
            />
          </div>
        )}

        {/* Role-based Xero Integration */}
        <RoleBasedXeroIntegration
          apiBaseUrl={apiBaseUrl}
          authToken={token}
          userRole={user.role}
          companyData={user}
        />
      </div>
    </div>
  );
};

// Login Component (simplified)
const Login = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      const response = await fetch(`${process.env.REACT_APP_API_BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ email, password })
      });

      const data = await response.json();

      if (response.ok) {
        localStorage.setItem('authToken', data.data.token);
        localStorage.setItem('userData', JSON.stringify(data.data.company));
        window.location.href = '/dashboard';
      } else {
        alert(data.message || 'Login failed');
      }
    } catch (error) {
      console.error('Login error:', error);
      alert('Login failed: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full space-y-8">
        <div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
            Sign in to your account
          </h2>
        </div>
        <form className="mt-8 space-y-6" onSubmit={handleLogin}>
          <div>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email address"
              className="relative block w-full px-3 py-2 border border-gray-300 rounded-md placeholder-gray-500 text-gray-900 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
            />
          </div>
          <div>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              className="relative block w-full px-3 py-2 border border-gray-300 rounded-md placeholder-gray-500 text-gray-900 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
            />
          </div>
          <div>
            <button
              type="submit"
              disabled={loading}
              className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
            >
              {loading ? 'Signing in...' : 'Sign in'}
            </button>
          </div>
        </form>

        {/* Demo Role Buttons */}
        <div className="mt-6 space-y-2">
          <p className="text-center text-sm text-gray-600">Demo Logins:</p>
          <div className="flex space-x-2">
            <button
              onClick={() => {
                setEmail('superadmin@example.com');
                setPassword('password');
              }}
              className="flex-1 py-1 px-2 text-xs bg-purple-100 text-purple-800 rounded"
            >
              Super Admin
            </button>
            <button
              onClick={() => {
                setEmail('admin@example.com');
                setPassword('password');
              }}
              className="flex-1 py-1 px-2 text-xs bg-blue-100 text-blue-800 rounded"
            >
              Admin
            </button>
            <button
              onClick={() => {
                setEmail('company@example.com');
                setPassword('password');
              }}
              className="flex-1 py-1 px-2 text-xs bg-green-100 text-green-800 rounded"
            >
              Company
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// Main App Component
function App() {
  return (
    <Router>
      <Routes>
        {/* Login Route */}
        <Route path="/login" element={<Login />} />
        
        {/* Dashboard Route */}
        <Route path="/dashboard" element={<Dashboard />} />
        
        {/* Xero OAuth Callback Route - CRITICAL */}
        <Route path="/redirecturl" element={<XeroCallback />} />
        
        {/* Default Route */}
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </Router>
  );
}

export default App;
