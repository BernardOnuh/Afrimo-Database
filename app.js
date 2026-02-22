const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
const cron = require('node-cron');
const fs = require('fs');
const setupSwagger = require('./middleware/swagger');

// Enhanced logging setup
const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');

require('dotenv').config();

// Enhanced Logger Configuration
const createLogger = () => {
  const logFormat = winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  );

  return winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: logFormat,
    transports: [
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.colorize(),
          winston.format.simple()
        )
      }),
      new DailyRotateFile({
        filename: 'logs/application-%DATE%.log',
        datePattern: 'YYYY-MM-DD',
        maxFiles: '30d',
        maxSize: '20m'
      })
    ]
  });
};

// Initialize logger (fallback to console if winston fails)
let logger;
try {
  // Ensure logs directory exists
  if (!fs.existsSync('logs')) {
    fs.mkdirSync('logs', { recursive: true });
  }
  logger = createLogger();
} catch (error) {
  console.warn('⚠️ Advanced logging not available, using console');
  logger = console;
}

// Initialize express app
const app = express();

// Enhanced configuration object
const AppConfig = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT) || 5000,
  IS_PRODUCTION: (process.env.NODE_ENV || 'development') === 'production',
  IS_DEVELOPMENT: (process.env.NODE_ENV || 'development') === 'development'
};

// Trust proxy for production deployments
if (AppConfig.IS_PRODUCTION) {
  app.set('trust proxy', 1);
}

// Global mongoose settings
mongoose.set('strictQuery', true);

// Display important environment variables
console.log('======================================');
console.log(`NODE_ENV: ${AppConfig.NODE_ENV}`);
console.log(`LENCO_API_KEY configured: ${process.env.LENCO_API_KEY ? 'Yes' : 'No'}`);
console.log(`MONGODB_URI configured: ${process.env.MONGODB_URI ? 'Yes' : 'No'}`);
console.log(`BNB_RPC_URL configured: ${process.env.BNB_RPC_URL ? 'Yes' : 'No'}`);
console.log(`Storage Method: MongoDB + Legacy File System`);
console.log(`Enhanced Features: Logging, Compression, Security, Share Resale Marketplace`);
console.log('======================================');

// Enhanced CORS configuration
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    const allowedOrigins = [
      'http://localhost:3000',
      'http://localhost:3001', 
      'http://localhost:5000',
      'http://localhost:5001',
      'http://localhost:8080',
      'https://afrimobile-d240af77c383.herokuapp.com',
      'https://www.afrimobil.com',
      'https://afrimobil.com',
      'https://www.afrimobiletech.com',
      'https://afrimobiletech.com',
      'https://your-frontend-domain.netlify.app',
      // Add from environment variable
      ...(process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : [])
    ];
    
    // In development, allow all localhost origins
    if (AppConfig.IS_DEVELOPMENT) {
      const localhostRegex = /^https?:\/\/localhost(:\d+)?$/;
      if (localhostRegex.test(origin)) {
        return callback(null, true);
      }
    }
    
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.log(`CORS blocked origin: ${origin}`);
      // In development, allow it anyway
      if (AppConfig.IS_DEVELOPMENT) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: [
    'Origin',
    'X-Requested-With',
    'Content-Type',
    'Accept',
    'Authorization',
    'Cache-Control',
    'X-Access-Token',
    'X-API-Key',
    'X-Client-Version'
  ],
  exposedHeaders: ['X-Total-Count', 'X-RateLimit-Remaining'],
  optionsSuccessStatus: 200,
  maxAge: 86400 // 24 hours
};

// Apply CORS middleware early - FIXED: Removed duplicate
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// Enhanced Security middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://js.paystack.co"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https:", "blob:"],
      connectSrc: ["'self'", "https:", "wss:"],
      mediaSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameSrc: ["'self'", "https://js.paystack.co"],
      baseUri: ["'self'"],
      formAction: ["'self'"]
    }
  },
  hsts: AppConfig.IS_PRODUCTION ? {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  } : false
}));

// Enhanced Rate limiting - FIXED: Increased limits
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: AppConfig.IS_PRODUCTION ? 1000 : 10000, // Increased from 100 to 1000 in production
  message: {
    success: false,
    message: 'Too many requests from this IP, please try again later',
    retryAfter: 15 * 60
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req, res) => {
    const skipPaths = ['/', '/health', '/api/health', '/api/cors-test', '/api/simple-test'];
    return skipPaths.includes(req.path) || req.path.startsWith('/health');
  },
  keyGenerator: (req) => {
    return req.ip || req.connection.remoteAddress;
  }
});

app.use(limiter);

// Compression middleware
app.use(compression({
  level: 6,
  threshold: 1024,
  filter: (req, res) => {
    if (req.headers['x-no-compression']) return false;
    return compression.filter(req, res);
  }
}));

// Enhanced Database connection function
const connectDB = async () => {
  try {
    if (mongoose.connection.readyState === 1) {
      console.log('✅ Already connected to MongoDB');
      return true;
    }

    console.log('🔄 Attempting to connect to MongoDB...');
    
    const mongoUri = process.env.MONGODB_URI || 
                    process.env.MONGO_URI || 
                    process.env.DATABASE_URL;
    
    if (!mongoUri) {
      throw new Error('No MongoDB connection string found in environment variables');
    }

    console.log('📍 MongoDB URI found:', mongoUri.includes('@') ? 'mongodb+srv://***:***@' + mongoUri.split('@')[1] : mongoUri);
    
    // Enhanced connection options
    const options = {
      // Essential connection options (still required)
      useNewUrlParser: true,
      useUnifiedTopology: true,
      
      // Timeout settings
      serverSelectionTimeoutMS: 15000, // 15 seconds
      socketTimeoutMS: 45000,          // 45 seconds  
      connectTimeoutMS: 15000,         // 15 seconds
      
      // Connection pool settings (enhanced)
      maxPoolSize: AppConfig.IS_PRODUCTION ? 20 : 10,
      minPoolSize: AppConfig.IS_PRODUCTION ? 5 : 1,
      maxIdleTimeMS: 30000,
      
      // Retry settings
      retryWrites: true,
      retryReads: true,
      
      // Additional production optimizations
      ...(AppConfig.IS_PRODUCTION && {
        readPreference: 'secondaryPreferred',
        readConcern: { level: 'majority' },
        writeConcern: { w: 'majority', j: true }
      })
    };
    
    console.log('⏳ Connecting to database...');
    
    await mongoose.connect(mongoUri, options);
    
    console.log('✅ Successfully connected to MongoDB');
    console.log(`📊 Database: ${mongoose.connection.name}`);
    console.log(`🏠 Host: ${mongoose.connection.host}`);
    console.log(`🔌 Connection state: ${mongoose.connection.readyState}`);
    
    // Set up enhanced connection monitoring
    setupDatabaseMonitoring();
    
    return true;
    
  } catch (error) {
    console.error('\n❌ Database connection failed:');
    console.error('Error message:', error.message);
    
    // Enhanced error diagnosis
    if (error.message.includes('ENOTFOUND')) {
      console.error('🌐 DNS resolution failed - check your MongoDB URI');
    } else if (error.message.includes('authentication failed')) {
      console.error('🔐 Authentication failed - check username/password');
    } else if (error.message.includes('timeout')) {
      console.error('⏰ Connection timeout - check network connectivity');
    } else if (error.message.includes('not supported')) {
      console.error('🔧 Deprecated connection options detected');
    }
    
    console.error('🔄 Will retry connection in 10 seconds...');
    
    setTimeout(() => {
      console.log('🔄 Retrying database connection...');
      connectDB();
    }, 10000);
    
    return false;
  }
};

// Enhanced Database monitoring setup
function setupDatabaseMonitoring() {
  // Connection health monitoring
  setInterval(async () => {
    try {
      if (mongoose.connection.readyState === 1) {
        await mongoose.connection.db.admin().ping();
      }
    } catch (error) {
      logger.warn('Database health check failed', { error: error.message });
    }
  }, 30000); // Check every 30 seconds

  // Enhanced event listeners
  mongoose.connection.on('connected', () => {
    console.log('🔗 Mongoose connected to MongoDB');
    logger.info('Database connected successfully');
  });

  mongoose.connection.on('error', (err) => {
    console.error('❌ Mongoose connection error:', err.message);
    logger.error('Database connection error', { error: err.message });
  });

  mongoose.connection.on('disconnected', () => {
    console.log('🔌 Mongoose disconnected from MongoDB');
    logger.warn('Database disconnected');
    
    // Auto-reconnect attempt
    setTimeout(() => {
      if (mongoose.connection.readyState === 0) {
        console.log('🔄 Attempting automatic reconnection...');
        connectDB();
      }
    }, 5000);
  });

  mongoose.connection.on('reconnected', () => {
    console.log('🔄 Mongoose reconnected to MongoDB');
    logger.info('Database reconnected successfully');
  });
}

// Enhanced Middleware
app.use(express.json({ 
  limit: '10mb',
  verify: (req, res, buf) => {
    req.rawBody = buf; // Store raw body for webhook verification
  }
}));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Enhanced timeout middleware with request ID
app.use((req, res, next) => {
  // Generate unique request ID for tracing
  req.id = require('crypto').randomUUID();
  
  req.setTimeout(25000, () => {
    const err = new Error('Request timeout');
    err.status = 408;
    next(err);
  });
  
  res.setTimeout(25000, () => {
    if (!res.headersSent) {
      res.status(408).json({
        success: false,
        message: 'Request timeout - operation took too long',
        requestId: req.id,
        timestamp: new Date().toISOString()
      });
    }
  });
  
  // Enhanced response helpers
  res.success = (data, message = 'Success', meta = {}) => {
    res.json({
      success: true,
      message,
      data,
      meta: {
        timestamp: new Date().toISOString(),
        requestId: req.id,
        ...meta
      }
    });
  };

  res.error = (message = 'Error', status = 500, details = null) => {
    res.status(status).json({
      success: false,
      message,
      ...(details && { details }),
      meta: {
        timestamp: new Date().toISOString(),
        requestId: req.id
      }
    });
  };
  
  next();
});

// Enhanced Logging middleware
if (AppConfig.IS_DEVELOPMENT) {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined', {
    stream: {
      write: (message) => logger.info(message.trim())
    }
  }));
}

// Request logging for debugging
app.use((req, res, next) => {
  logger.debug('Request received', {
    method: req.method,
    url: req.url,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    requestId: req.id
  });
  next();
});

// Add debugging middleware to log all requests in development - NEW
if (AppConfig.IS_DEVELOPMENT) {
  app.use('/api', (req, res, next) => {
    console.log(`🔍 API Request: ${req.method} ${req.path}`);
    console.log(`🔍 Origin: ${req.get('Origin')}`);
    console.log(`🔍 User-Agent: ${req.get('User-Agent')}`);
    console.log(`🔍 Content-Type: ${req.get('Content-Type')}`);
    console.log(`🔍 Database State: ${mongoose.connection.readyState}`);
    next();
  });
}

// Enhanced Static file serving
const staticOptions = {
  maxAge: AppConfig.IS_PRODUCTION ? '1d' : '1h',
  etag: true,
  lastModified: true,
  index: false,
  setHeaders: function (res, filePath, stat) {
    res.set({
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'X-Served-By': 'AfriMobile-API-Enhanced',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': AppConfig.IS_PRODUCTION ? 'public, max-age=86400' : 'no-cache'
    });
  }
};

app.use('/uploads', express.static(path.join(__dirname, 'uploads'), staticOptions));
app.use('/cofounder-payment-proofs', express.static(path.join(__dirname, 'uploads', 'cofounder-payment-proofs'), staticOptions));

// Setup Swagger documentation
setupSwagger(app);

// Add a simple test endpoint that bypasses most middleware - NEW
app.get('/api/simple-test', (req, res) => {
  res.json({
    success: true,
    message: 'Simple test endpoint working',
    timestamp: new Date().toISOString(),
    headers: {
      origin: req.get('Origin'),
      userAgent: req.get('User-Agent'),
      contentType: req.get('Content-Type')
    },
    database: {
      connected: mongoose.connection.readyState === 1,
      state: mongoose.connection.readyState
    }
  });
});

// Enhanced Database status endpoint
app.get('/api/db-status', (req, res) => {
  const dbState = mongoose.connection.readyState;
  const states = {
    0: 'disconnected',
    1: 'connected', 
    2: 'connecting',
    3: 'disconnecting'
  };
  
  res.json({
    success: dbState === 1,
    database: {
      state: dbState,
      status: states[dbState],
      name: mongoose.connection.name,
      host: mongoose.connection.host,
      readyState: dbState,
      // Enhanced connection info
      collections: mongoose.connection.collections ? Object.keys(mongoose.connection.collections).length : 0,
      models: mongoose.connection.models ? Object.keys(mongoose.connection.models).length : 0
    },
    environment: {
      NODE_ENV: AppConfig.NODE_ENV,
      hasMongodbUri: !!process.env.MONGODB_URI,
      hasMongoUri: !!process.env.MONGO_URI,
      hasDatabaseUrl: !!process.env.DATABASE_URL,
      isProduction: AppConfig.IS_PRODUCTION
    },
    server: {
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      version: process.version,
      pid: process.pid
    },
    timestamp: new Date().toISOString()
  });
});

// Enhanced API monitoring middleware - FIXED: Made database dependency less strict
app.use('/api', (req, res, next) => {
  // Allow certain endpoints to work without database
  const allowedWithoutDB = [
    '/api/cors-test', 
    '/api/system/info', 
    '/api/simple-test',
    '/api/db-status',
    '/api/system/health-status'
  ];
  
  if (mongoose.connection.readyState !== 1 && !allowedWithoutDB.includes(req.path)) {
    return res.status(503).json({
      success: false,
      message: 'Database connection unavailable',
      retryAfter: 30,
      requestId: req.id,
      timestamp: new Date().toISOString()
    });
  }
  
  // CORS is already handled by the main middleware above
  // Just handle OPTIONS requests if they somehow get here
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  next();
});

// ============================================================================
// API ROUTES - All application endpoints
// ============================================================================

// Existing routes
app.use('/api/users', require('./routes/userRoutes'));
app.use('/api/shares', require('./routes/shareRoutes'));
app.use('/api/cofounder', require('./routes/coFounderShareRoutes'));
app.use('/api/project', require('./routes/projectRoutes'));
app.use('/api/leaderboard', require('./routes/leaderboardRoutes'));
app.use('/api/referral', require('./routes/referralRoutes'));
app.use('/api/admin/referrals', require('./routes/adminReferralRoutes'));
app.use('/api/payment', require('./routes/paymentRoutes'));
app.use('/api/withdrawal', require('./routes/withdrawalRoutes'));
app.use('/api/exchange-rates', require('./routes/exchangeRateRoutes'));
app.use('/api/management', require('./routes/managementRoutes'));
// DISABLED: Installment payment functionality removed (Feb 2026)
// app.use('/api/shares/installment', require('./routes/installmentRoutes'));
// app.use('/api/shares/cofounder/installment', require('./routes/coFounderInstallmentRoutes'));
app.use('/api/share-packages', require('./routes/sharePackageRoutes'));
app.use('/api/admin/analytics', require('./routes/adminAnalyticsRoutes'));
app.use('/api/shares/tiers', require('./routes/tierRoutes'));

// ============================================================================
// NEW: Share Resale & OTC Marketplace Routes (Feb 2026)
// ============================================================================
// Enables peer-to-peer share trading with automatic transfers
// Documentation: GET http://localhost:5000/api-docs#/Share%20Marketplace
// Features:
//   - Public marketplace browsing
//   - Create share listings
//   - Make/accept purchase offers  
//   - Multiple payment methods (bank transfer, crypto)
//   - Automatic share transfer on payment confirmation
app.use('/api/shares', require('./routes/shareListings'));
app.use('/api/executives',  require('./routes/executiveRoutes')); 
// ============================================================================
// END API ROUTES
// ============================================================================

// Enhanced Health Monitor System Endpoints
app.get('/api/system/health-status', async (req, res) => {
  try {
    const healthMonitor = global.healthMonitor;
    if (!healthMonitor) {
      return res.status(503).json({
        success: false,
        message: 'Health monitor not initialized',
        requestId: req.id
      });
    }
    
    const status = healthMonitor.getMonitorStatus();
    res.success({
      ...status,
      server: {
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        cpu: process.cpuUsage(),
        version: process.version,
        platform: process.platform,
        environment: AppConfig.NODE_ENV
      },
      database: {
        connected: mongoose.connection.readyState === 1,
        state: mongoose.connection.readyState,
        host: mongoose.connection.host,
        name: mongoose.connection.name
      }
    }, 'Health status retrieved successfully');
  } catch (error) {
    res.error('Health status check failed', 500, error.message);
  }
});

// Enhanced debug endpoints
app.get('/api/cors-test', (req, res) => {
  res.success({
    message: 'CORS is working!',
    origin: req.get('Origin'),
    userAgent: req.get('User-Agent'),
    environment: AppConfig.NODE_ENV,
    headers: req.headers,
    ip: req.ip
  }, 'CORS test successful');
});

// Enhanced system info endpoint
app.get('/api/system/info', (req, res) => {
  res.success({
    server: {
      version: '2.0.0-enhanced',
      environment: AppConfig.NODE_ENV,
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      cpu: process.cpuUsage(),
      platform: process.platform,
      nodeVersion: process.version,
      pid: process.pid
    },
    features: [
      'Enhanced MongoDB Connection Management',
      'Advanced Logging with Rotation',
      'Request Tracing',
      'Enhanced Security Headers',
      'Compression Support',
      'Health Monitoring',
      'Auto-Reconnection',
      'Crypto Withdrawal System',
      'Automated USDT Processing',
      'Share Resale & OTC Marketplace (NEW)'
    ],
    database: {
      connected: mongoose.connection.readyState === 1,
      state: mongoose.connection.readyState,
      collections: mongoose.connection.collections ? Object.keys(mongoose.connection.collections).length : 0
    }
  }, 'System information retrieved');
});

// Enhanced Root route - Health check
app.get('/', (req, res) => {
  res.success({
    message: 'AfriMobile API - Enhanced Version',
    version: '2.0.0-enhanced',
    environment: AppConfig.NODE_ENV,
    database: {
      connected: mongoose.connection.readyState === 1,
      status: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
    },
    features: {
      enhancedLogging: true,
      compression: true,
      healthMonitoring: !!global.healthMonitor,
      requestTracing: true,
      enhancedSecurity: true,
      cryptoWithdrawals: true,
      shareResaleMarketplace: true
    },
    endpoints: {
      health: '/api/system/health-status',
      dbStatus: '/api/db-status',
      corsTest: '/api/cors-test',
      systemInfo: '/api/system/info',
      simpleTest: '/api/simple-test',
      docs: '/api-docs'
    }
  }, 'AfriMobile API is running successfully');
});

// Enhanced Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error caught by global handler:', err.stack);
  
  // Log detailed error information
  logger.error('Global error handler', {
    error: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    requestId: req.id
  });

  // Handle specific error types
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      success: false,
      message: 'Validation Error',
      details: err.errors,
      requestId: req.id,
      timestamp: new Date().toISOString()
    });
  }

  if (err.name === 'CastError') {
    return res.status(400).json({
      success: false,
      message: 'Invalid ID format',
      requestId: req.id,
      timestamp: new Date().toISOString()
    });
  }

  if (err.code === 11000) {
    return res.status(409).json({
      success: false,
      message: 'Duplicate entry',
      requestId: req.id,
      timestamp: new Date().toISOString()
    });
  }

  // Default error response
  res.status(err.status || 500).json({
    success: false,
    message: AppConfig.IS_PRODUCTION ? 'Internal server error' : err.message,
    ...(AppConfig.IS_DEVELOPMENT && { stack: err.stack }),
    requestId: req.id,
    timestamp: new Date().toISOString()
  });
});

// Enhanced 404 handler
app.use((req, res) => {
  logger.warn('404 - Resource not found', {
    method: req.method,
    url: req.url,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    requestId: req.id
  });

  res.status(404).json({
    success: false,
    message: 'Resource not found',
    path: req.url,
    method: req.method,
    suggestions: req.url.includes('api') ? [
      'Check the API documentation at /api-docs',
      'Verify the endpoint URL and method',
      'Ensure you have the correct API version'
    ] : [
      'This might be a frontend route',
      'Check if the file exists',
      'Verify the URL is correct'
    ],
    requestId: req.id,
    timestamp: new Date().toISOString()
  });
});

// Enhanced Background Jobs Manager
class BackgroundJobsManager {
  constructor() {
    this.jobs = [];
    this.isRunning = false;
  }

  addJob(name, jobInstance) {
    this.jobs.push({ name, job: jobInstance });
    logger.info(`Background job registered: ${name}`);
  }

  startAll() {
    if (this.isRunning) return;
    
    console.log('======================================');
    console.log('Starting background jobs...');
    
    this.jobs.forEach(({ name, job }) => {
      try {
        if (job && typeof job.start === 'function') {
          job.start();
          logger.info(`✅ Started job: ${name}`);
        }
      } catch (error) {
        console.error(`❌ Failed to start job: ${name}`, error.message);
        logger.error(`Failed to start background job: ${name}`, { error: error.message });
      }
    });
    
    this.isRunning = true;
    console.log('✅ Background jobs started');
    console.log('======================================');
  }

  stopAll() {
    this.jobs.forEach(({ name, job }) => {
      try {
        if (job && typeof job.stop === 'function') {
          job.stop();
          logger.info(`Stopped job: ${name}`);
        }
      } catch (error) {
        logger.error(`Failed to stop job: ${name}`, { error: error.message });
      }
    });
    
    this.isRunning = false;
    logger.info('All background jobs stopped');
  }

  getStatus() {
    return {
      totalJobs: this.jobs.length,
      isRunning: this.isRunning,
      jobs: this.jobs.map(({ name }) => ({ name, status: this.isRunning ? 'running' : 'stopped' }))
    };
  }
}

const jobsManager = new BackgroundJobsManager();

// MAIN APP STARTUP FUNCTION (keeping your exact structure)
async function startApp() {
  try {
    console.log('🚀 Starting AfriMobile API - Enhanced Version...');
    
    // Step 1: Connect to database FIRST
    const dbConnected = await connectDB();
    
    if (!dbConnected) {
      console.error('❌ Failed to connect to database. App will still start but with limited functionality.');
      logger.error('Database connection failed during startup');
    }
    
    // Step 2: Initialize health monitor after DB connection
   
    
    // Step 3: Start the server
    const PORT = AppConfig.PORT;
    const server = app.listen(PORT, () => {
      console.log('\n**********************************************');
      console.log(`🚀 Server running in ${AppConfig.NODE_ENV} mode on port ${PORT}`);
      console.log(`📚 API Documentation: http://localhost:${PORT}/api-docs`);
      console.log(`🏠 Health Check: http://localhost:${PORT}/`);
      console.log(`📊 DB Status: http://localhost:${PORT}/api/db-status`);
      console.log(`🔍 CORS Test: http://localhost:${PORT}/api/cors-test`);
      console.log(`🧪 Simple Test: http://localhost:${PORT}/api/simple-test`);
      console.log(`ℹ️  System Info: http://localhost:${PORT}/api/system/info`);
      console.log(`🏥 Health Status: http://localhost:${PORT}/api/system/health-status`);
      console.log('**********************************************\n');
      
      logger.info('Server started successfully', {
        port: PORT,
        environment: AppConfig.NODE_ENV,
        processId: process.pid,
        memoryUsage: process.memoryUsage()
      });
      
      // Store server reference for graceful shutdown
      global.server = server;
    });

    // Enhanced server timeout configuration
    server.timeout = 30000;
    server.keepAliveTimeout = 61000;
    server.headersTimeout = 62000;
    
    // Step 4: Start background jobs AFTER everything is ready
    if (dbConnected) {
      setTimeout(async () => {
        console.log('======================================');
        console.log('Starting background jobs...');
        
        try {
          // Admin setup
          const { setUserAsAdmin, grantAdminRights } = require('./controller/userController');
          await setUserAsAdmin();
          await grantAdminRights();
          console.log('✅ Admin setup completed');
          logger.info('Admin setup completed successfully');
        } catch (error) {
          console.error('⚠️ Admin setup failed:', error.message);
          logger.error('Admin setup failed', { error: error.message });
        }
        
        // ========== START CRYPTO WITHDRAWAL CRON JOBS (NEW) ==========
        try {
          const User = require('./models/User');
          const Withdrawal = require('./models/Withdrawal');
          const Referral = require('./models/Referral');
          const ReferralTransaction = require('./models/ReferralTransaction');
          const Payment = require('./models/Payment');
          const { sendEmail } = require('./utils/emailService');
          const ethers = require('ethers');
          const mongoose = require('mongoose');

          const BNB_CONFIG = {
            rpcUrl: process.env.BNB_RPC_URL || 'https://bsc-dataseed.binance.org/',
            chainId: 56,
            USDT_CONTRACT: '0x55d398326f99059fF775485246999027B3197955',
            USDT_DECIMALS: 18
          };

          // ========== PROCESS CRYPTO WITHDRAWALS CRON JOB (Every 5 minutes) ==========
          const processCryptoCron = {
            job: cron.schedule('*/5 * * * *', async () => {
              try {
                console.log('[CRYPTO-CRON] Starting crypto withdrawal processing...');
                logger.info('[CRYPTO-CRON] Processing pending crypto withdrawals');

                if (!global.adminCryptoWallet) {
                  console.log('[CRYPTO-CRON] Admin wallet not configured, skipping processing');
                  return;
                }

                const pending = await Withdrawal.find({
                  withdrawalType: 'crypto',
                  status: 'pending'
                }).limit(10);

                if (pending.length === 0) {
                  console.log('[CRYPTO-CRON] No pending crypto withdrawals');
                  return;
                }

                console.log(`[CRYPTO-CRON] Found ${pending.length} pending withdrawals`);

                const provider = new ethers.providers.JsonRpcProvider(BNB_CONFIG.rpcUrl);
                const privateKey = Buffer.from(global.adminCryptoWallet.encryptedPrivateKey, 'base64').toString();
                const signer = new ethers.Wallet(privateKey, provider);

                let processed = 0;
                let failed = 0;

                for (const withdrawal of pending) {
                  try {
                    console.log(`[CRYPTO-CRON] Processing withdrawal ${withdrawal._id}...`);
                    withdrawal.status = 'processing';
                    await withdrawal.save();

                    const usdtContract = new ethers.Contract(
                      BNB_CONFIG.USDT_CONTRACT,
                      [
                        'function transfer(address to, uint256 amount) public returns (bool)',
                        'function balanceOf(address) view returns (uint256)'
                      ],
                      signer
                    );

                    const amountWei = ethers.utils.parseUnits(
                      withdrawal.cryptoDetails.amountUSDT.toString(),
                      BNB_CONFIG.USDT_DECIMALS
                    );

                    const balance = await usdtContract.balanceOf(signer.address);
                    if (balance.lt(amountWei)) {
                      throw new Error('Insufficient USDT balance in admin wallet');
                    }

                    const tx = await usdtContract.transfer(withdrawal.cryptoDetails.walletAddress, amountWei);
                    const receipt = await tx.wait();

                    withdrawal.status = 'paid';
                    withdrawal.cryptoDetails.transactionHash = receipt.transactionHash;
                    withdrawal.cryptoDetails.blockNumber = receipt.blockNumber;
                    withdrawal.processedAt = new Date();
                    await withdrawal.save();

                    await Referral.findOneAndUpdate(
                      { user: withdrawal.user },
                      {
                        $inc: {
                          pendingWithdrawals: -withdrawal.amount,
                          totalWithdrawn: withdrawal.amount
                        }
                      }
                    );

                    const transaction = new ReferralTransaction({
                      user: withdrawal.user,
                      type: 'crypto_withdrawal',
                      amount: -withdrawal.amount,
                      description: `USDT withdrawal: ${withdrawal.cryptoDetails.amountUSDT} USDT to ${withdrawal.cryptoDetails.walletAddress}`,
                      status: 'completed',
                      reference: receipt.transactionHash
                    });
                    await transaction.save();

                    const user = await User.findById(withdrawal.user);
                    try {
                      await sendEmail({
                        email: user.email,
                        subject: '✅ Crypto Withdrawal Completed!',
                        html: `
                          <h2>Your Withdrawal Has Been Sent!</h2>
                          <p>Hello ${user.name},</p>
                          <p>Your ${withdrawal.cryptoDetails.amountUSDT} USDT withdrawal has been successfully transferred.</p>
                          <p><strong>Transaction Hash:</strong> <code>${receipt.transactionHash}</code></p>
                          <p><strong>Recipient Wallet:</strong> <code>${withdrawal.cryptoDetails.walletAddress}</code></p>
                          <p><strong>Amount in NGN:</strong> ₦${withdrawal.amount.toLocaleString()}</p>
                          <p>You can view the transaction on <a href="https://bscscan.com/tx/${receipt.transactionHash}">BscScan</a></p>
                          <p>Thank you for using AfriMobile!</p>
                        `
                      });
                    } catch (emailError) {
                      console.error('[CRYPTO-CRON] Failed to send email:', emailError.message);
                      logger.warn('[CRYPTO-CRON] Email notification failed', { error: emailError.message });
                    }

                    console.log(`[CRYPTO-CRON] ✅ Processed withdrawal ${withdrawal._id}`);
                    processed++;
                  } catch (error) {
                    console.error(`[CRYPTO-CRON] ❌ Failed to process ${withdrawal._id}:`, error.message);
                    logger.error('[CRYPTO-CRON] Failed to process withdrawal', {
                      withdrawalId: withdrawal._id,
                      error: error.message
                    });

                    withdrawal.status = 'failed';
                    withdrawal.failureReason = error.message;
                    await withdrawal.save();

                    await Referral.findOneAndUpdate(
                      { user: withdrawal.user },
                      { $inc: { pendingWithdrawals: -withdrawal.amount } }
                    );

                    failed++;
                  }
                }

                console.log(`[CRYPTO-CRON] Completed: ${processed} success, ${failed} failed`);
                logger.info('[CRYPTO-CRON] Processing cycle completed', { processed, failed });
              } catch (error) {
                console.error('[CRYPTO-CRON] Error in crypto processing cron:', error.message);
                logger.error('[CRYPTO-CRON] Cron job error', { error: error.message, stack: error.stack });
              }
            }),
            start: function() {
              console.log('[CRYPTO-CRON] Crypto processing job started (every 5 minutes)');
            },
            stop: function() {
              this.job.stop();
              console.log('[CRYPTO-CRON] Crypto processing job stopped');
            }
          };

          // ========== VERIFY CRYPTO TRANSACTIONS CRON JOB (Every hour) ==========
          const verifyCryptoCron = {
            job: cron.schedule('0 * * * *', async () => {
              try {
                console.log('[CRYPTO-CRON] Starting transaction verification...');
                logger.info('[CRYPTO-CRON] Verifying paid crypto withdrawals');

                const provider = new ethers.providers.JsonRpcProvider(BNB_CONFIG.rpcUrl);

                const paidWithdrawals = await Withdrawal.find({
                  withdrawalType: 'crypto',
                  status: 'paid',
                  'cryptoDetails.transactionHash': { $exists: true }
                }).limit(20);

                console.log(`[CRYPTO-CRON] Verifying ${paidWithdrawals.length} transactions`);

                for (const withdrawal of paidWithdrawals) {
                  try {
                    const receipt = await provider.getTransactionReceipt(withdrawal.cryptoDetails.transactionHash);

                    if (receipt) {
                      if (receipt.status === 1) {
                        withdrawal.cryptoDetails.blockNumber = receipt.blockNumber;
                        await withdrawal.save();
                        console.log(`[CRYPTO-CRON] ✅ Verified transaction ${withdrawal._id}`);
                      } else if (receipt.status === 0) {
                        console.log(`[CRYPTO-CRON] ⚠️ Transaction failed for ${withdrawal._id}`);
                        withdrawal.status = 'failed';
                        withdrawal.failureReason = 'Transaction failed on blockchain';
                        await withdrawal.save();
                      }
                    }
                  } catch (error) {
                    console.error(`[CRYPTO-CRON] Error verifying ${withdrawal._id}:`, error.message);
                  }
                }

                console.log('[CRYPTO-CRON] Verification cycle completed');
                logger.info('[CRYPTO-CRON] Transaction verification completed', { 
                  count: paidWithdrawals.length 
                });
              } catch (error) {
                console.error('[CRYPTO-CRON] Error in verification cron:', error.message);
                logger.error('[CRYPTO-CRON] Verification cron error', { error: error.message });
              }
            }),
            start: function() {
              console.log('[CRYPTO-CRON] Verification job started (every 1 hour)');
            },
            stop: function() {
              this.job.stop();
              console.log('[CRYPTO-CRON] Verification job stopped');
            }
          };

          // Add crypto jobs to manager
          jobsManager.addJob('processCryptoWithdrawals', processCryptoCron);
          jobsManager.addJob('verifyCryptoTransactions', verifyCryptoCron);

          console.log('✅ Crypto withdrawal cron jobs initialized');
          logger.info('Crypto withdrawal cron jobs initialized successfully');
        } catch (error) {
          console.error('❌ Error initializing crypto cron jobs:', error.message);
          logger.error('Failed to initialize crypto cron jobs', { error: error.message });
        }
        // ========== END CRYPTO WITHDRAWAL CRON JOBS ==========

        // Start withdrawal verification cron jobs
        try {
          const withdrawalCronJobs = require('./withdrawalCronJobs');
          jobsManager.addJob('verifyProcessingWithdrawals', withdrawalCronJobs.verifyProcessingWithdrawals);
          jobsManager.addJob('verifyPendingWithdrawals', withdrawalCronJobs.verifyPendingWithdrawals);
          
          withdrawalCronJobs.verifyProcessingWithdrawals.start();
          withdrawalCronJobs.verifyPendingWithdrawals.start();
          console.log('✅ Bank withdrawal cron jobs started');
          logger.info('Bank withdrawal verification jobs started');
        } catch (error) {
          console.error('❌ Error starting bank withdrawal cron jobs:', error.message);
          logger.error('Failed to start bank withdrawal cron jobs', { error: error.message });
        }
        
        // Start installment and referral jobs if in production
        if (AppConfig.IS_PRODUCTION) {
          try {
            // DISABLED: Installment schedulers removed (Feb 2026)
            // const installmentScheduler = require('./utils/installmentScheduler');
            // installmentScheduler.scheduleInstallmentPenalties();
            // const coFounderInstallmentScheduler = require('./utils/coFounderInstallmentScheduler');
            // coFounderInstallmentScheduler.scheduleCoFounderInstallmentPenalties();
            console.log('ℹ️ Installment schedulers disabled');
            
            // Referral sync jobs
            const referralCronJobs = require('./referralCronJobs');
            // Add referral jobs to manager if they have start/stop methods
            console.log('✅ Referral sync jobs configured');
            
            logger.info('Production background jobs initialized');
          } catch (error) {
            console.error('⚠️ Some production jobs failed to initialize:', error.message);
            logger.warn('Production jobs initialization incomplete', { error: error.message });
          }
        } else {
          console.log('ℹ️ Development mode: Some background jobs disabled');
        }
        
        // Start the jobs manager
        jobsManager.startAll();
        
        console.log('✅ Background jobs initialization complete');
        console.log('======================================');
        logger.info('Application startup completed successfully');
      }, 3000);
    }
    
  } catch (error) {
    console.error('💥 Failed to start application:', error);
    logger.error('Application startup failed', { error: error.message, stack: error.stack });
    process.exit(1);
  }
}

// Enhanced Graceful shutdown handling
async function gracefulShutdown(signal) {
  console.log(`🛑 ${signal} received, shutting down gracefully...`);
  logger.info(`Graceful shutdown initiated by ${signal}`);
  
  // Stop accepting new requests
  if (global.server) {
    global.server.close(() => {
      console.log('✅ HTTP server closed');
      logger.info('HTTP server closed');
    });
  }
  
  // Stop background jobs
  try {
    jobsManager.stopAll();
    console.log('✅ Background jobs stopped');
  } catch (error) {
    console.error('❌ Error stopping background jobs:', error);
    logger.error('Error stopping background jobs', { error: error.message });
  }
  
  // Stop health monitor
  try {
    if (global.healthMonitor && typeof global.healthMonitor.stopMonitoring === 'function') {
      global.healthMonitor.stopMonitoring();
      console.log('✅ Health monitor stopped');
    }
  } catch (error) {
    console.error('❌ Error stopping health monitor:', error);
    logger.error('Error stopping health monitor', { error: error.message });
  }
  
  // Close database connection
  try {
    await mongoose.connection.close();
    console.log('✅ Database connection closed');
    logger.info('Database connection closed');
  } catch (error) {
    console.error('❌ Error closing database:', error);
    logger.error('Error closing database connection', { error: error.message });
  }
  
  console.log('👋 Process terminated gracefully');
  logger.info('Process terminated gracefully');
  process.exit(0);
}

// Enhanced Signal handlers
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Enhanced uncaught exception handling
process.on('uncaughtException', (err) => {
  console.error('💥 Uncaught Exception:', err);
  console.error('Stack:', err.stack);
  logger.error('Uncaught Exception', { error: err.message, stack: err.stack });
  
  // Attempt graceful shutdown
  gracefulShutdown('UNCAUGHT_EXCEPTION').then(() => {
    process.exit(1);
  }).catch(() => {
    process.exit(1);
  });
});

// Enhanced unhandled promise rejection handling
process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
  logger.error('Unhandled Promise Rejection', { reason, promise });
  
  // In production, attempt graceful shutdown
  if (AppConfig.IS_PRODUCTION) {
    gracefulShutdown('UNHANDLED_REJECTION').then(() => {
      process.exit(1);
    }).catch(() => {
      process.exit(1);
    });
  }
});

// Enhanced process monitoring
if (AppConfig.IS_PRODUCTION) {
  // Monitor memory usage
  setInterval(() => {
    const memUsage = process.memoryUsage();
    const memUsageMB = Math.round(memUsage.heapUsed / 1024 / 1024);
    
    if (memUsageMB > 500) { // Alert if using more than 500MB
      logger.warn('High memory usage detected', { 
        memoryUsageMB: memUsageMB,
        memoryUsage: memUsage 
      });
    }
    
    // Force garbage collection if available and memory is high
    if (global.gc && memUsageMB > 400) {
      global.gc();
      logger.info('Forced garbage collection due to high memory usage');
    }
  }, 60000); // Check every minute
}

// Enhanced startup information display
function displayEnhancedStartupInfo() {
  const baseUrl = AppConfig.IS_PRODUCTION 
    ? 'https://afrimobile-d240af77c383.herokuapp.com'
    : `http://localhost:${AppConfig.PORT}`;

  console.log('\n' + '='.repeat(80));
  console.log('🚀 AFRIMOBILE API - ENHANCED VERSION 2.0');
  console.log('    with Crypto Withdrawals & Share Resale Marketplace');
  console.log('='.repeat(80));
  console.log(`Environment: ${AppConfig.NODE_ENV}`);
  console.log(`Process ID: ${process.pid}`);
  console.log(`Port: ${AppConfig.PORT}`);
  console.log(`Base URL: ${baseUrl}`);
  console.log(`Node Version: ${process.version}`);
  console.log(`Platform: ${process.platform}`);
  console.log('='.repeat(80));
  console.log('📚 ESSENTIAL ENDPOINTS:');
  console.log(`   Health Check: ${baseUrl}/`);
  console.log(`   Database Status: ${baseUrl}/api/db-status`);
  console.log(`   System Health: ${baseUrl}/api/system/health-status`);
  console.log(`   System Info: ${baseUrl}/api/system/info`);
  console.log(`   API Documentation: ${baseUrl}/api-docs`);
  console.log(`   CORS Test: ${baseUrl}/api/cors-test`);
  console.log(`   Simple Test: ${baseUrl}/api/simple-test`);
  console.log('='.repeat(80));
  console.log('💰 CRYPTO WITHDRAWAL ENDPOINTS:');
  console.log(`   Exchange Rates: ${baseUrl}/api/withdrawal/crypto/rates`);
  console.log(`   Setup Wallet: POST ${baseUrl}/api/withdrawal/crypto/wallet/setup`);
  console.log(`   Request Withdrawal: POST ${baseUrl}/api/withdrawal/crypto/request`);
  console.log(`   Withdrawal History: ${baseUrl}/api/withdrawal/crypto/history`);
  console.log(`   Admin Panel: POST ${baseUrl}/api/withdrawal/admin/crypto/wallet/setup`);
  console.log('='.repeat(80));
  console.log('📊 SHARE RESALE & OTC MARKETPLACE ENDPOINTS (NEW):');
  console.log(`   Browse Listings: GET ${baseUrl}/api/shares/listings`);
  console.log(`   View Listing: GET ${baseUrl}/api/shares/listings/{id}`);
  console.log(`   Create Listing: POST ${baseUrl}/api/shares/listings`);
  console.log(`   My Listings: GET ${baseUrl}/api/shares/my-listings`);
  console.log(`   Make Offer: POST ${baseUrl}/api/shares/listings/{id}/offer`);
  console.log(`   Accept Offer: POST ${baseUrl}/api/shares/offers/{id}/accept`);
  console.log(`   Submit Payment: POST ${baseUrl}/api/shares/offers/{id}/payment`);
  console.log(`   Confirm Transfer: POST ${baseUrl}/api/shares/offers/{id}/confirm-payment`);
  console.log(`   Transfer History: GET ${baseUrl}/api/shares/transfer-history`);
  console.log(`   View Offers: GET ${baseUrl}/api/shares/offers`);
  console.log('='.repeat(80));
  console.log('📁 FILE SERVING:');
  console.log(`   General Uploads: ${baseUrl}/uploads/`);
  console.log(`   Payment Proofs: ${baseUrl}/uploads/payment-proofs/`);
  console.log(`   CoFounder Proofs: ${baseUrl}/uploads/cofounder-payment-proofs/`);
  console.log('='.repeat(80));
  console.log('✨ ENHANCED FEATURES:');
  console.log('   ✅ Advanced MongoDB Connection with Auto-Reconnect');
  console.log('   ✅ Winston Logging with Daily Rotation');
  console.log('   ✅ Request Tracing with Unique IDs');
  console.log('   ✅ Enhanced Security Headers');
  console.log('   ✅ Response Compression');
  console.log('   ✅ Advanced Error Handling');
  console.log('   ✅ Health Monitoring System');
  console.log('   ✅ Background Jobs Management');
  console.log('   ✅ Memory Usage Monitoring');
  console.log('   ✅ Graceful Shutdown Handling');
  console.log('   ✅ Fixed CORS Configuration');
  console.log('   ✅ Increased Rate Limits');
  console.log('   ✅ Database-Independent Test Endpoints');
  console.log('   ✅ Crypto Withdrawal System');
  console.log('   ✅ Automated USDT Processing');
  console.log('   ✅ BNB Smart Chain Integration');
  console.log('   ✅ Peer-to-Peer Share Trading (NEW)');
  console.log('   ✅ OTC Marketplace (NEW)');
  console.log('   ✅ Automatic Share Transfers (NEW)');
  console.log('   ✅ Multiple Payment Methods (NEW)');
  console.log('='.repeat(80));
  
  const dbStatus = mongoose.connection.readyState === 1 ? 'Connected' : 'Disconnected';
  const healthStatus = global.healthMonitor ? 'Active' : 'Inactive';
  const jobsStatus = jobsManager.isRunning ? 'Running' : 'Stopped';
  const adminWallet = global.adminCryptoWallet ? 'Configured' : 'Not Configured';
  
  console.log(`🎯 DATABASE: ${dbStatus}`);
  console.log(`🏥 HEALTH MONITOR: ${healthStatus}`);
  console.log(`🔄 BACKGROUND JOBS: ${jobsStatus}`);
  console.log(`💼 ADMIN CRYPTO WALLET: ${adminWallet}`);
  console.log(`📊 MEMORY USAGE: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`);
  console.log('='.repeat(80));
  
  if (AppConfig.IS_DEVELOPMENT) {
    console.log('🔧 DEVELOPMENT MODE FEATURES:');
    console.log('   🔓 Permissive CORS enabled');
    console.log('   📝 Detailed error messages');
    console.log('   🐛 Debug logging enabled');
    console.log('   ⚡ Fast refresh for development');
    console.log('   🔍 Request debugging middleware');
  } else {
    console.log('🏭 PRODUCTION MODE FEATURES:');
    console.log('   🔒 Security headers enforced');
    console.log('   📊 Performance monitoring active');
    console.log('   🗜️ Response compression enabled');
    console.log('   🛡️ Rate limiting enforced');
    console.log('   🤖 Automated crypto withdrawal processing');
  }
  
  console.log('='.repeat(80) + '\n');
}

// Additional utility functions for enhanced functionality
const EnhancedUtils = {
  // System cleanup utility
  async performSystemCleanup() {
    try {
      logger.info('Starting system cleanup...');
      
      // Clean up old log files (keep last 30 days)
      const logsDir = path.join(process.cwd(), 'logs');
      if (fs.existsSync(logsDir)) {
        const files = fs.readdirSync(logsDir);
        const cutoffTime = Date.now() - (30 * 24 * 60 * 60 * 1000);
        
        for (const file of files) {
          const filePath = path.join(logsDir, file);
          const stats = fs.statSync(filePath);
          
          if (stats.mtime.getTime() < cutoffTime) {
            fs.unlinkSync(filePath);
            logger.info(`Deleted old log file: ${file}`);
          }
        }
      }
      
      // Force garbage collection if available
      if (global.gc) {
        global.gc();
        logger.info('Forced garbage collection');
      }
      
      logger.info('System cleanup completed');
    } catch (error) {
      logger.error('System cleanup failed', { error: error.message });
    }
  },

  // Get comprehensive system stats
  getSystemStats() {
    return {
      system: {
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        cpu: process.cpuUsage(),
        version: process.version,
        platform: process.platform,
        environment: AppConfig.NODE_ENV,
        pid: process.pid
      },
      database: {
        connected: mongoose.connection.readyState === 1,
        state: mongoose.connection.readyState,
        host: mongoose.connection.host,
        name: mongoose.connection.name,
        collections: mongoose.connection.collections ? Object.keys(mongoose.connection.collections).length : 0
      },
      jobs: jobsManager.getStatus(),
      health: {
        monitor: !!global.healthMonitor,
        status: global.healthMonitor ? 'active' : 'inactive'
      },
      crypto: {
        adminWalletConfigured: !!global.adminCryptoWallet,
        processingEnabled: !!global.adminCryptoWallet
      }
    };
  }
};

// Add system cleanup endpoint
app.post('/api/system/cleanup', async (req, res) => {
  try {
    // Add authentication check here if needed
    await EnhancedUtils.performSystemCleanup();
    res.success(null, 'System cleanup completed successfully');
  } catch (error) {
    res.error('System cleanup failed', 500, error.message);
  }
});

// Add comprehensive system stats endpoint
app.get('/api/system/stats', (req, res) => {
  try {
    const stats = EnhancedUtils.getSystemStats();
    res.success(stats, 'System statistics retrieved successfully');
  } catch (error) {
    res.error('Failed to retrieve system statistics', 500, error.message);
  }
});

// Add jobs status endpoint
app.get('/api/system/jobs', (req, res) => {
  try {
    const jobsStatus = jobsManager.getStatus();
    res.success(jobsStatus, 'Jobs status retrieved successfully');
  } catch (error) {
    res.error('Failed to retrieve jobs status', 500, error.message);
  }
});

// Schedule system cleanup if in production
if (AppConfig.IS_PRODUCTION) {
  cron.schedule('0 2 * * 0', async () => { // Every Sunday at 2 AM
    await EnhancedUtils.performSystemCleanup();
  });
}

// Add startup completion hook
process.nextTick(() => {
  setTimeout(() => {
    if (global.server) {
      displayEnhancedStartupInfo();
      logger.info('Enhanced startup information displayed');
    }
  }, 4000); // Display after background jobs are initialized
});

// Start the application
startApp();

// Export for testing purposes
module.exports = app;

// Export enhanced utilities for external use
module.exports.EnhancedUtils = EnhancedUtils;
module.exports.AppConfig = AppConfig;
module.exports.jobsManager = jobsManager;