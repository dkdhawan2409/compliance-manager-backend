const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const companyRoutes = require('./routes/companyRoutes');
const cronjobSettingRoutes = require('./routes/cronjobSettingRoutes');
const complianceDeadlinesRoutes = require('./routes/complianceDeadlinesRoutes');
const openaiRoutes = require('./routes/openaiRoutes');
const openaiSettingRoutes = require('./routes/openaiSettingRoutes');
const xeroRoutes = require('./routes/xeroRoutes');
const errorHandler = require('./middleware/errorHandler');
const { runMigrations } = require('./utils/migrate');
const { validateProductionUrls } = require('./config/environment');

const app = express();

// Validate production URLs on startup
try {
  validateProductionUrls();
} catch (error) {
  console.error('❌ Production URL validation failed:', error.message);
  if (process.env.NODE_ENV === 'production') {
    console.error('🚨 CRITICAL: Production URLs contain localhost. Server cannot start safely.');
    process.exit(1);
  } else {
    console.log('⚠️  Development mode - continuing with localhost URLs');
  }
}

// Run migrations on startup with better error handling
runMigrations().catch(error => {
  console.error('❌ Migration failed during startup:', error.message);
  console.log('⚠️  Server will start without running migrations');
  console.log('💡 You can run migrations manually later');
});

// Security middleware
app.use(helmet());

// CORS configuration - production-safe with localhost restrictions
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    // In production, never allow localhost origins
    if (process.env.NODE_ENV === 'production' && origin.includes('localhost')) {
      console.error('❌ CORS blocked localhost origin in production:', origin);
      return callback(new Error('Localhost origins not allowed in production'), false);
    }
    
    const allowedOrigins = process.env.NODE_ENV === 'production' 
      ? [
          'https://compliance-manager-frontend.onrender.com',
          'https://compliance-manager-frontend.onrender.com/',
          'https://compliance-manager-frontend.onrender.com/redirecturl',
          'https://compliance-manager-frontend.onrender.com/xero-callback'
        ]
      : [
          'http://localhost:3001',
          'http://localhost:3000',
          'http://localhost:5173',
          'https://compliance-manager-frontend.onrender.com',
          'https://compliance-manager-frontend.onrender.com/',
          'https://compliance-manager-frontend.onrender.com/redirecturl',
          'https://compliance-manager-frontend.onrender.com/xero-callback'
        ];
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      console.log('⚠️ CORS blocked origin:', origin);
      if (process.env.NODE_ENV === 'production') {
        callback(new Error('Origin not allowed in production'), false);
      } else {
        callback(null, true); // Allow all origins in development for debugging
      }
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposedHeaders: ['Location', 'X-RateLimit-Limit', 'X-RateLimit-Remaining']
}));

// Rate limiting - more permissive in development
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === 'development' ? 2000 : 100, // more permissive in development
  message: {
    success: false,
    message: 'Too many requests, please try again later.'
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});
app.use(limiter);

// Body parsing middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Compression middleware
app.use(compression());

// Logging middleware
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined'));
}

// Health check endpoints
app.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Server is running',
    timestamp: new Date().toISOString()
  });
});

app.get('/api/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'API server is running',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// Development-only rate limit reset endpoint
if (process.env.NODE_ENV === 'development') {
  app.post('/api/reset-rate-limit', (req, res) => {
    // This will reset the rate limit for the current IP
    res.status(200).json({
      success: true,
      message: 'Rate limit reset for development',
      timestamp: new Date().toISOString()
    });
  });
}

// Redirect duplicate /api/ routes to correct paths (must be BEFORE API routes)
app.all('/api/api/*', (req, res) => {
  const newPath = req.originalUrl.replace('/api/api/', '/api/');
  console.log(`🔄 Redirecting ${req.originalUrl} to ${newPath}`);
  res.redirect(307, newPath);
});

// API routes
app.use('/api/companies', companyRoutes);
app.use('/api/cronjob-settings', cronjobSettingRoutes);
app.use('/api/compliance-deadlines', complianceDeadlinesRoutes);
app.use('/api/openai', openaiRoutes);
app.use('/api/openai-admin', openaiSettingRoutes);
app.use('/api/xero', xeroRoutes);

// Redirect URL handler for frontend OAuth redirects
app.get('/redirecturl', (req, res) => {
  console.log('🔄 Redirect URL accessed:', req.url);
  console.log('🔍 Query parameters:', req.query);
  
  // This endpoint is for handling OAuth redirects from the frontend
  // The actual redirect should happen in the Xero callback, not here
  res.status(200).json({
    success: true,
    message: 'Redirect URL endpoint accessed',
    query: req.query,
    timestamp: new Date().toISOString()
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found'
  });
});

// Error handling middleware
app.use(errorHandler);

const PORT = process.env.PORT || 5000;

const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Set server timeout to handle long-running requests
server.timeout = 60000; // 60 seconds timeout for server
server.keepAliveTimeout = 65000; // Keep-alive timeout
server.headersTimeout = 66000; // Headers timeout

module.exports = app;
