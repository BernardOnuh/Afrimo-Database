const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cron = require('node-cron');
const fs = require('fs');

require('dotenv').config();

// Initialize express app
const app = express();

// 🔧 FIX 1: Trust proxy for Heroku (ADD THIS)
app.set('trust proxy', 1);

// 🔧 FIX 2: Global mongoose settings (ADD THIS BEFORE CONNECTION)
mongoose.set('strictQuery', true);
mongoose.set('bufferCommands', false);
mongoose.set('bufferMaxEntries', 0);

// Display important environment variables
console.log('======================================');
console.log(`NODE_ENV: ${process.env.NODE_ENV}`);
console.log(`LENCO_API_KEY configured: ${process.env.LENCO_API_KEY ? 'Yes' : 'No'}`);
console.log(`Storage Method: MongoDB + Legacy File System`);
console.log('======================================');

// Enhanced CORS configuration
const corsOptions = {
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    
    const allowedOrigins = [
      'http://localhost:3000',
      'http://localhost:3001', 
      'http://localhost:5000',
      'http://localhost:8080',
      'https://afrimobile-d240af77c383.herokuapp.com/',
      'https://www.afrimobil.com',
      'https://afrimobil.com',
      'https://www.afrimobiletech.com',
      'https://afrimobiletech.com',
      'https://your-frontend-domain.netlify.app',
    ];
    
    if (process.env.NODE_ENV === 'development') {
      const localhostRegex = /^http:\/\/localhost:\d+$/;
      if (localhostRegex.test(origin)) {
        return callback(null, true);
      }
    }
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      console.warn(`CORS blocked origin: ${origin}`);
      callback(new Error('Not allowed by CORS'));
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
    'X-Access-Token'
  ],
  exposedHeaders: ['X-Total-Count'],
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// Security middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https:"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"]
    }
  }
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: 'Too many requests from this IP, please try again after 15 minutes',
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  skip: (req, res) => {
    // Skip rate limiting for health checks
    return req.path === '/' || req.path.startsWith('/health');
  }
});

app.use(limiter);

// Database connection with health monitor integration
const connectDB = async () => {
  try {
    const mongoUri = process.env.MONGODB_URI || 
                    process.env.MONGO_URI || 
                    process.env.DATABASE_URL ||
                    'mongodb://localhost:27017/afrimobile';
    
    // Updated MongoDB connection options for Heroku
    const options = {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      maxPoolSize: 5, // Reduced for Heroku
      minPoolSize: 1,
      serverSelectionTimeoutMS: 30000, // Increased from 5000ms
      socketTimeoutMS: 75000, // Increased from 45000ms
      connectTimeoutMS: 30000,
      heartbeatFrequencyMS: 30000, // Increased from 10000ms
      maxIdleTimeMS: 60000, // Increased from 30000ms
      retryWrites: true,
      retryReads: true,
      keepAlive: true,
      keepAliveInitialDelay: 300000,
      // 🔧 REMOVED: bufferMaxEntries: 0 (this was causing the error)
    };
    
    await mongoose.connect(mongoUri, options);
    
    console.log('✅ Connected to MongoDB');
    console.log(`📊 Database: ${mongoose.connection.name}`);
    console.log(`🔗 Connection URI: ${mongoUri.split('@')[1] || 'localhost'}`);
    
    // Re-enable buffering after successful connection
    mongoose.set('bufferCommands', true);
    
    // Initialize health monitor after database connection
    initializeHealthMonitor();
    
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
    console.error('🔄 Retrying connection in 10 seconds...');
    
    setTimeout(() => {
      console.log('🔄 Attempting to reconnect to database...');
      connectDB();
    }, 10000); // Increased retry interval
  }
};

// Your existing database event listeners (keep as is)
mongoose.connection.on('connected', () => {
  console.log('🔗 Mongoose connected to MongoDB');
});

// Enhanced Initialize health monitoring system with better error handling
function initializeHealthMonitor() {
  // Only start in non-test environments and when database is connected
  if (process.env.NODE_ENV !== 'test' && mongoose.connection.readyState === 1) {
    try {
      console.log('🏥 Initializing System Health Monitor...');
      
      // Import and start the health monitor
      const healthMonitor = require('./scripts/systemHealthMonitor');
      
      // Check if health monitor module is properly loaded
      if (!healthMonitor || typeof healthMonitor.startMonitoring !== 'function') {
        throw new Error('Health monitor module not properly loaded or missing startMonitoring function');
      }
      
      healthMonitor.startMonitoring();
      
      console.log('✅ System Health Monitor started successfully');
      console.log(`⏰ Check interval: ${process.env.HEALTH_CHECK_INTERVAL || 15} minutes`);
      console.log(`🔧 Auto-fix: ${process.env.AUTO_FIX_ENABLED !== 'false' ? 'ENABLED' : 'DISABLED'}`);
      
      // Store reference for graceful shutdown
      global.healthMonitor = healthMonitor;
      
      // Delayed status check
      setTimeout(() => {
        try {
          const status = healthMonitor.getMonitorStatus();
          console.log(`📈 Health Monitor Status: ${status.isRunning ? 'Running' : 'Stopped'}`);
          if (status.runCount > 0) {
            console.log(`📊 Completed ${status.runCount} health checks`);
            console.log(`🕒 Last run: ${status.lastRun || 'Never'}`);
          }
        } catch (error) {
          console.error('❌ Error getting health monitor status:', error.message);
        }
      }, 3000);
      
    } catch (error) {
      console.error('❌ Failed to start Health Monitor:', error.message);
      console.error('📋 Health Monitor Error Details:', error.stack);
      console.log('🔄 The application will continue running without the health monitor');
      
      // Set a flag to indicate health monitor is disabled
      global.healthMonitor = null;
    }
  } else if (mongoose.connection.readyState !== 1) {
    console.log('⏳ Database not ready - Health Monitor will start after connection');
  } else {
    console.log('🧪 Test environment detected - Health Monitor disabled');
  }
}

// Enhanced database event listeners
mongoose.connection.on('connected', () => {
  console.log('🔗 Mongoose connected to MongoDB');
});

mongoose.connection.on('error', (err) => {
  console.error('❌ Mongoose connection error:', err.message);
});

mongoose.connection.on('disconnected', () => {
  console.log('🔌 Mongoose disconnected from MongoDB');
  // Try to reconnect after disconnection
  setTimeout(() => {
    if (mongoose.connection.readyState === 0) {
      console.log('🔄 Attempting to reconnect...');
      connectDB();
    }
  }, 5000);
});

// Handle MongoDB connection issues gracefully
process.on('SIGINT', async () => {
  try {
    await mongoose.connection.close();
    console.log('✅ MongoDB connection closed through app termination');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error closing MongoDB connection:', error);
    process.exit(1);
  }
});

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// 🔧 FIX 5: Add timeout middleware (ADD THIS AFTER express.json)
app.use((req, res, next) => {
  // Set request timeout to 25 seconds (less than Heroku's 30s limit)
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
        timestamp: new Date().toISOString()
      });
    }
  });
  
  next();
});


// Logging middleware
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

// Development CORS
if (process.env.NODE_ENV === 'development') {
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', '*');
    res.header('Access-Control-Allow-Headers', '*');
    next();
  });
  console.log('🔓 Development mode: Permissive CORS enabled');
}

// Static file serving
console.log('📁 Setting up legacy file serving (MongoDB storage active for new uploads)');

app.use('/uploads', (req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  
  console.log(`[legacy-serve] Legacy file request: ${req.path}`);
  console.log(`[legacy-serve] Note: New files are served from MongoDB via controllers`);
  
  next();
}, express.static(path.join(__dirname, 'uploads'), {
  maxAge: '1d',
  etag: true,
  lastModified: true,
  setHeaders: function (res, path, stat) {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.set('X-Served-By', 'AfriMobile-API-Legacy');
  }
}));

app.use('/cofounder-payment-proofs', (req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  
  console.log(`[cofounder-legacy] Legacy co-founder file request: ${req.path}`);
  console.log(`[cofounder-legacy] Note: New files are served from MongoDB via controllers`);
  next();
}, express.static(path.join(__dirname, 'uploads', 'cofounder-payment-proofs'), {
  maxAge: '1d',
  etag: true,
  lastModified: true,
  setHeaders: function (res, path, stat) {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.set('X-Served-By', 'AfriMobile-API-CoFounder-Legacy');
  }
}));

// Setup Swagger documentation
setupSwagger(app);

// API monitoring middleware
app.use('/api', (req, res, next) => {
  // Check if MongoDB is connected
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({
      success: false,
      message: 'Database connection unavailable',
      retryAfter: 30,
      timestamp: new Date().toISOString()
    });
  }
  
  // Your existing API monitoring middleware
  res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, Cache-Control, X-Access-Token');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.path.includes('shares') && (req.method === 'POST' || req.path.includes('manual') || req.path.includes('upload'))) {
    console.log(`[api-monitor] File upload request: ${req.method} ${req.path}`);
    console.log(`[api-monitor] Timestamp: ${new Date().toISOString()}`);
    console.log(`[api-monitor] Storage: MongoDB (new uploads) + Legacy file system (old files)`);
  }
  next();
});

// API Routes
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
app.use('/api/shares/installment', require('./routes/installmentRoutes'));
app.use('/api/shares/cofounder/installment', require('./routes/coFounderInstallmentRoutes'));

// Health Monitor System Endpoints
app.get('/api/system/health-status', async (req, res) => {
  try {
    const healthMonitor = global.healthMonitor;
    if (!healthMonitor) {
      return res.status(503).json({
        success: false,
        message: 'Health monitor not initialized'
      });
    }
    
    const status = healthMonitor.getMonitorStatus();
    res.json({
      success: true,
      data: {
        ...status,
        server: {
          uptime: process.uptime(),
          memory: process.memoryUsage(),
          cpu: process.cpuUsage(),
          version: process.version,
          platform: process.platform
        },
        database: {
          connected: mongoose.connection.readyState === 1,
          state: mongoose.connection.readyState
        }
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.post('/api/system/health-check', async (req, res) => {
  try {
    console.log('🔍 Manual health check requested');
    const healthMonitor = global.healthMonitor;
    if (!healthMonitor) {
      return res.status(503).json({
        success: false,
        message: 'Health monitor not initialized'
      });
    }
    
    const results = await healthMonitor.runManualCheck();
    res.json({
      success: true,
      message: 'Manual health check completed',
      data: results
    });
  } catch (error) {
    console.error('❌ Manual health check failed:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Debug and monitoring endpoints
app.get('/api/cors-test', (req, res) => {
  res.json({
    success: true,
    message: 'CORS is working!',
    origin: req.get('Origin'),
    userAgent: req.get('User-Agent'),
    headers: req.headers,
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV
  });
});

app.get('/api/test-file-access', (req, res) => {
  res.json({
    success: true,
    message: 'File access test endpoint - MongoDB + Legacy support',
    storage: {
      primary: 'MongoDB (for new uploads)',
      legacy: 'File System (for old files)',
      transition: 'Gradual migration to MongoDB'
    },
    testEndpoints: {
      paymentProof: '/api/shares/payment-proof/:transactionId',
      cofounderPaymentProof: '/cofounder/payment-proof/:transactionId',
      legacyFileServing: '/uploads/payment-proofs/ and /cofounder-payment-proofs/'
    },
    corsHeaders: {
      'Access-Control-Allow-Origin': res.get('Access-Control-Allow-Origin'),
      'Access-Control-Allow-Methods': res.get('Access-Control-Allow-Methods')
    },
    suggestions: [
      'New files are automatically stored in MongoDB',
      'Old files continue to be served from file system',
      'Use controller endpoints for payment proof access',
      'Legacy static routes available for backward compatibility'
    ]
  });
});

app.get('/api/debug/files', (req, res) => {
  try {
    const uploadsDir = path.join(process.cwd(), 'uploads');
    const paymentProofsDir = path.join(uploadsDir, 'payment-proofs');
    const cofounderPaymentProofsDir = path.join(uploadsDir, 'cofounder-payment-proofs');
    
    const result = {
      success: true,
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV,
      storage: {
        primary: 'MongoDB',
        legacy: 'File System',
        status: 'Hybrid mode active'
      },
      paths: {
        cwd: process.cwd(),
        uploadsDir,
        paymentProofsDir,
        cofounderPaymentProofsDir,
        __dirname: __dirname
      },
      exists: {
        uploads: fs.existsSync(uploadsDir),
        paymentProofs: fs.existsSync(paymentProofsDir),
        cofounderPaymentProofs: fs.existsSync(cofounderPaymentProofsDir)
      },
      files: {
        paymentProofs: [],
        cofounderPaymentProofs: []
      },
      diskSpace: null
    };
    
    try {
      const stats = fs.statSync(process.cwd());
      result.diskSpace = {
        accessible: true,
        inode: stats.ino
      };
    } catch (err) {
      result.diskSpace = {
        accessible: false,
        error: err.message
      };
    }
    
    const directories = [
      { path: paymentProofsDir, key: 'paymentProofs', name: 'payment-proofs' },
      { path: cofounderPaymentProofsDir, key: 'cofounderPaymentProofs', name: 'cofounder-payment-proofs' }
    ];
    
    directories.forEach(({ path: dirPath, key, name }) => {
      if (fs.existsSync(dirPath)) {
        try {
          const files = fs.readdirSync(dirPath);
          result.files[key] = files.map(file => {
            const filePath = path.join(dirPath, file);
            try {
              const stats = fs.statSync(filePath);
              return {
                name: file,
                size: stats.size,
                created: stats.birthtime,
                modified: stats.mtime,
                url: `/uploads/${name}/${file}`,
                alternativeUrl: key === 'cofounderPaymentProofs' ? `/cofounder-payment-proofs/${file}` : null,
                ageMinutes: Math.round((Date.now() - stats.mtime.getTime()) / (1000 * 60)),
                isLegacy: true
              };
            } catch (err) {
              return {
                name: file,
                error: err.message,
                isLegacy: true
              };
            }
          });
          
          result.files[key].sort((a, b) => new Date(b.modified) - new Date(a.modified));
        } catch (err) {
          result[`${key}Error`] = `Error reading directory: ${err.message}`;
        }
      }
    });
    
    result.note = "This shows legacy files only. New uploads are stored in MongoDB and accessed via controllers.";
    
    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error checking file system',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Enhanced manual referral sync endpoint
app.post('/api/referral/sync-earnings', async (req, res) => {
  try {
    console.log('\n======================================');
    console.log('MANUAL REFERRAL SYNC TRIGGERED');
    console.log('======================================');
    console.log('Time:', new Date().toISOString());
    
    const referralCronJobs = require('./referralCronJobs');
    
    console.log('Starting referral earnings sync...');
    const stats = await referralCronJobs.fixAllUsersReferralEarnings();
    
    console.log('Referral sync completed successfully!');
    console.log('Final stats:', JSON.stringify(stats, null, 2));
    
    res.json({
      success: true,
      message: 'Referral earnings sync completed successfully',
      stats,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('\n======================================');
    console.error('MANUAL REFERRAL SYNC FAILED');
    console.error('======================================');
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    console.error('======================================');
    
    res.status(500).json({
      success: false,
      message: 'Referral sync failed',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Debug endpoint for referral data
app.get('/api/referral/debug/:userId?', async (req, res) => {
  try {
    const User = require('./models/User');
    const UserShare = require('./models/UserShare');
    const ReferralTransaction = require('./models/ReferralTransaction');
    const Referral = require('./models/Referral');
    
    const { userId } = req.params;
    
    if (userId) {
      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({ success: false, message: 'User not found' });
      }
      
      const userShare = await UserShare.findOne({ user: userId });
      const referralTransactions = await ReferralTransaction.find({ 
        $or: [{ beneficiary: userId }, { referredUser: userId }] 
      });
      const referralStats = await Referral.findOne({ user: userId });
      
      res.json({
        success: true,
        user: {
          id: user._id,
          name: user.name,
          userName: user.userName,
          referralInfo: user.referralInfo
        },
        userShare: userShare ? {
          totalShares: userShare.totalShares,
          transactionCount: userShare.transactions.length,
          completedTransactions: userShare.transactions.filter(tx => tx.status === 'completed').length,
          sampleTransaction: userShare.transactions[0]
        } : null,
        referralTransactions: referralTransactions.length,
        referralStats: referralStats
      });
    } else {
      const totalUsers = await User.countDocuments();
      const usersWithUserNames = await User.countDocuments({ userName: { $exists: true, $ne: null } });
      const totalUserShares = await UserShare.countDocuments();
      const totalReferralTransactions = await ReferralTransaction.countDocuments();
      const totalReferrals = await Referral.countDocuments();
      
      const sampleUser = await User.findOne({ userName: { $exists: true, $ne: null } });
      const sampleUserShare = await UserShare.findOne();
      const sampleReferralTransaction = await ReferralTransaction.findOne();
      
      res.json({
        success: true,
        counts: {
          totalUsers,
          usersWithUserNames,
          totalUserShares,
          totalReferralTransactions,
          totalReferrals
        },
        samples: {
          sampleUser: sampleUser ? {
            id: sampleUser._id,
            userName: sampleUser.userName,
            referralInfo: sampleUser.referralInfo
          } : null,
          sampleUserShare: sampleUserShare ? {
            user: sampleUserShare.user,
            totalShares: sampleUserShare.totalShares,
            transactionCount: sampleUserShare.transactions.length,
            sampleTransaction: sampleUserShare.transactions[0]
          } : null,
          sampleReferralTransaction: sampleReferralTransaction
        }
      });
    }
  } catch (error) {
    console.error('Debug endpoint error:', error);
    res.status(500).json({
      success: false,
      message: 'Debug failed',
      error: error.message
    });
  }
});

// Co-founder installment endpoints
app.post('/api/cofounder/installment/manual-penalty-check', async (req, res) => {
  try {
    console.log('\n======================================');
    console.log('MANUAL CO-FOUNDER INSTALLMENT PENALTY CHECK TRIGGERED');
    console.log('======================================');
    console.log('Time:', new Date().toISOString());
    
    const coFounderInstallmentScheduler = require('./utils/coFounderInstallmentScheduler');
    
    console.log('Starting co-founder installment penalty check...');
    const results = await coFounderInstallmentScheduler.manualPenaltyCheck();
    
    console.log('Co-founder installment penalty check completed successfully!');
    console.log('Results:', JSON.stringify(results, null, 2));
    
    res.json({
      success: true,
      message: 'Co-founder installment penalty check completed successfully',
      results,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('\n======================================');
    console.error('MANUAL CO-FOUNDER INSTALLMENT PENALTY CHECK FAILED');
    console.error('======================================');
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    console.error('======================================');
    
    res.status(500).json({
      success: false,
      message: 'Co-founder installment penalty check failed',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

app.get('/api/cofounder/installment/stats', async (req, res) => {
  try {
    const CoFounderInstallmentPlan = require('./models/CoFounderInstallmentPlan');
    
    const stats = {
      total: await CoFounderInstallmentPlan.countDocuments(),
      pending: await CoFounderInstallmentPlan.countDocuments({ status: 'pending' }),
      active: await CoFounderInstallmentPlan.countDocuments({ status: 'active' }),
      late: await CoFounderInstallmentPlan.countDocuments({ status: 'late' }),
      completed: await CoFounderInstallmentPlan.countDocuments({ status: 'completed' }),
      cancelled: await CoFounderInstallmentPlan.countDocuments({ status: 'cancelled' })
    };

    const allPlans = await CoFounderInstallmentPlan.find({});
    const financialStats = allPlans.reduce((acc, plan) => {
      acc.totalValue += plan.totalPrice;
      acc.totalPaid += plan.totalPaidAmount || 0;
      acc.totalPending += (plan.totalPrice - (plan.totalPaidAmount || 0));
      acc.totalLateFees += plan.currentLateFee || 0;
      return acc;
    }, {
      totalValue: 0,
      totalPaid: 0,
      totalPending: 0,
      totalLateFees: 0
    });

    res.json({
      success: true,
      stats: {
        ...stats,
        ...financialStats,
        completionRate: stats.total > 0 ? ((stats.completed / stats.total) * 100).toFixed(2): 0
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error fetching co-founder installment stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch co-founder installment statistics',
      error: error.message
    });
  }
});

// Test Lenco API endpoint
app.get('/api/test-lenco/:reference', async (req, res) => {
  try {
    console.log('Testing Lenco API directly...');
    const { reference } = req.params;
    
    console.log(`LENCO_API_KEY configured: ${process.env.LENCO_API_KEY ? 'Yes' : 'No'}`);
    
    if (!process.env.LENCO_API_KEY) {
      return res.status(400).json({
        success: false,
        message: 'LENCO_API_KEY not configured in environment variables'
      });
    }
    
    const axios = require('axios');
    const response = await axios.get(`https://api.lenco.co/access/v1/transaction-by-reference/${reference}`, {
      headers: {
        'Authorization': `Bearer ${process.env.LENCO_API_KEY}`
      }
    });
    
    return res.json({
      success: true,
      data: response.data
    });
  } catch (error) {
    console.error('Error testing Lenco API:', error.message);
    if (error.response) {
      console.error('API Response Error:', JSON.stringify(error.response.data, null, 2));
    }
    
    return res.status(500).json({
      success: false,
      message: 'Error testing Lenco API',
      error: error.message
    });
  }
});

// CRON JOBS SETUP
cron.schedule('* * * * *', () => {
  console.log('\n======================================');
  console.log('TEST CRON: This should run every minute');
  console.log('Current time:', new Date().toISOString());
  console.log('======================================\n');
});

cron.schedule('* * * * *', async () => {
  console.log('\n**********************************************');
  console.log('*  TEST WITHDRAWAL JOB RUNNING              *');
  console.log('*  ' + new Date().toISOString() + '  *');
  console.log('**********************************************');
  
  try {
    const Withdrawal = require('./models/Withdrawal');
    const processingWithdrawals = await Withdrawal.find({ status: 'processing' });
    console.log(`Found ${processingWithdrawals.length} processing withdrawals`);
    
    if (processingWithdrawals.length > 0) {
      for (const w of processingWithdrawals) {
        console.log(`- ID: ${w._id}, ClientRef: ${w.clientReference}, Status: ${w.status}`);
      }
    }
  } catch (error) {
    console.error('Error in test job:', error);
    console.error(error.stack);
  }
  
  console.log('**********************************************\n');
});

// Production schedulers
if (process.env.NODE_ENV === 'production') {
  console.log('Setting up production-only cron jobs...');
  
  const installmentScheduler = require('./utils/installmentScheduler');
  installmentScheduler.scheduleInstallmentPenalties();
  console.log('Installment penalty scheduler initialized');
  
  cron.schedule('0 0 * * *', async () => {
    try {
      console.log('Running late installment payment check job...');
      const { checkLatePayments } = require('./controller/installmentController');
      await checkLatePayments({ isCronJob: true });
      console.log('Late installment payment check job completed.');
    } catch (error) {
      console.error('Error in late installment payment check job:', error);
    }
  });

  console.log('\n======================================');
  console.log('SETTING UP CO-FOUNDER INSTALLMENT SCHEDULER');
  console.log('======================================');

  try {
    const coFounderInstallmentScheduler = require('./utils/coFounderInstallmentScheduler');
    
    coFounderInstallmentScheduler.scheduleCoFounderInstallmentPenalties();
    console.log('✅ Co-founder installment penalty scheduler initialized for production');
    console.log('📅 Daily check: 2:00 AM');
    console.log('📅 Weekly comprehensive: Sunday 3:00 AM');
    console.log('📅 Monthly penalties: 1st of month 4:00 AM');
  } catch (error) {
    console.error('❌ ERROR LOADING CO-FOUNDER INSTALLMENT SCHEDULER:', error.message);
    console.error(error.stack);
  }

  console.log('======================================\n');
} else {
  // Continuation from "console.log('🔧 To test manually, use: POST /api/co"

console.log('ℹ️  Co-founder installment scheduler disabled in development mode');
console.log('🔧 To test manually, use: POST /api/cofounder/installment/manual-penalty-check');
}

console.log('\n======================================');
console.log('SETTING UP REFERRAL SYNC CRON JOBS');
console.log('======================================');

console.log('======================================\n');

// FORCE START WITHDRAWAL VERIFICATION CRON JOBS REGARDLESS OF ENVIRONMENT
console.log('======================================');
console.log('FORCE STARTING WITHDRAWAL CRON JOBS');
console.log(`Current NODE_ENV: ${process.env.NODE_ENV}`);

try {
  const withdrawalCronJobs = require('./withdrawalCronJobs');
  console.log('Withdrawal cron jobs module loaded successfully');
  
  withdrawalCronJobs.verifyProcessingWithdrawals.start();
  console.log('Processing withdrawals job started');
  
  withdrawalCronJobs.verifyPendingWithdrawals.start();
  console.log('Pending withdrawals job started');
  
  console.log('All withdrawal verification cron jobs started');
} catch (error) {
  console.error('ERROR LOADING WITHDRAWAL CRON JOBS:', error);
  console.error(error.stack);
}
console.log('======================================\n');

// One-time immediate check for withdrawals when app starts
setTimeout(async () => {
  console.log('======================================');
  console.log('Running immediate one-time withdrawal verification check...');
  try {
    if (!process.env.LENCO_API_KEY) {
      console.error('LENCO_API_KEY is not configured! API calls will fail.');
      return;
    }
    
    const Withdrawal = require('./models/Withdrawal');
    const axios = require('axios');
    
    const processingWithdrawals = await Withdrawal.find({ status: 'processing' });
    console.log(`Found ${processingWithdrawals.length} processing withdrawals`);
    
    if (processingWithdrawals.length > 0) {
      console.log('Processing withdrawals:');
      for (const w of processingWithdrawals) {
        console.log(`- ID: ${w._id}, ClientRef: ${w.clientReference}, Status: ${w.status}, Created: ${w.createdAt}`);
        
        if (processingWithdrawals.indexOf(w) === 0) {
          console.log(`Testing direct API call for withdrawal ${w._id}`);
          try {
            const response = await axios.get(`https://api.lenco.co/access/v1/transaction-by-reference/${w.clientReference}`, {
              headers: {
                'Authorization': `Bearer ${process.env.LENCO_API_KEY}`
              }
            });
            
            console.log('Lenco API Direct Test Response:');
            console.log(JSON.stringify(response.data, null, 2));
          } catch (apiError) {
            console.error('Error in direct API call test:', apiError.message);
            if (apiError.response) {
              console.error('API Response Error:', JSON.stringify(apiError.response.data, null, 2));
            }
          } 
        }
      }
    }
    
    const pendingWithdrawals = await Withdrawal.find({ status: 'pending' });
    console.log(`Found ${pendingWithdrawals.length} pending withdrawals`);
    
    if (pendingWithdrawals.length > 0) {
      console.log('Pending withdrawals:');
      pendingWithdrawals.forEach(w => {
        console.log(`- ID: ${w._id}, ClientRef: ${w.clientReference}, Status: ${w.status}, Created: ${w.createdAt}`);
      });
    }
    
    console.log('Immediate check complete');
  } catch (error) {
    console.error('Error in one-time check:', error);
    console.error(error.stack);
  }
  console.log('======================================\n');
}, 5000);

// Serve static assets if in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static('client/build'));
  
  app.get('*', (req, res) => {
    res.sendFile(path.resolve(__dirname, 'client', 'build', 'index.html'));
  });
}

// Root route - Health check
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'AfriMobile API is running',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    documentation: '/api-docs',
    fileSystem: {
      uploadsExists: fs.existsSync(path.join(process.cwd(), 'uploads')),
      paymentProofsExists: fs.existsSync(path.join(process.cwd(), 'uploads', 'payment-proofs')),
      cofounderPaymentProofsExists: fs.existsSync(path.join(process.cwd(), 'uploads', 'cofounder-payment-proofs'))
    },
    cors: {
      enabled: true,
      origin: req.get('Origin'),
      method: req.method
    },
    healthMonitor: {
      enabled: global.healthMonitor ? true : false,
      status: global.healthMonitor ? 'Running' : 'Disabled',
      endpoints: [
        '/api/system/health-status',
        '/api/system/health-check'
      ]
    },
    coFounderInstallments: {
      enabled: true,
      endpoints: [
        '/api/shares/cofounder/installment/calculate',
        '/api/shares/cofounder/installment/create',
        '/api/shares/cofounder/installment/plans',
        '/api/shares/cofounder/installment/paystack/pay',
        '/api/shares/cofounder/installment/paystack/verify',
        '/api/shares/cofounder/installment/cancel'
      ],
      debugEndpoints: [
        '/api/cofounder/installment/stats',
        '/api/cofounder/installment/manual-penalty-check'
      ]
    },
    fileServingEndpoints: {
      regularPayments: '/uploads/payment-proofs/',
      cofounderPayments: [
        '/uploads/cofounder-payment-proofs/',
        '/cofounder-payment-proofs/'
      ]
    }
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error caught by global handler:', err.stack);
  console.error('Request URL:', req.url);
  console.error('Request method:', req.method);
  console.error('Request headers:', req.headers);
  
  res.status(500).json({
    success: false,
    message: 'Something went wrong!',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined,
    timestamp: new Date().toISOString()
  });
});

// Handle 404 errors
app.use((req, res) => {
  console.log(`404 - Resource not found: ${req.method} ${req.url}`);
  console.log(`Origin: ${req.get('Origin')}`);
  console.log(`User-Agent: ${req.get('User-Agent')}`);
  
  res.status(404).json({
    success: false,
    message: 'Resource not found',
    path: req.url,
    method: req.method,
    timestamp: new Date().toISOString(),
    suggestions: req.url.includes('uploads') || req.url.includes('cofounder-payment-proofs') ? [
      'Check if the file exists: GET /api/debug/files',
      'Verify the file URL format: /uploads/payment-proofs/filename.jpg or /uploads/cofounder-payment-proofs/filename.jpg',
      'Try alternative co-founder route: /cofounder-payment-proofs/filename.jpg',
      'Ensure the file was uploaded successfully'
    ] : [
      'Check the API documentation: /api-docs',
      'Verify the endpoint URL and method',
      'Test CORS: GET /api/cors-test'
    ]
  });
});

// Graceful shutdown handling
async function gracefulShutdown(signal) {
  console.log(`🛑 ${signal} received, shutting down gracefully...`);
  
  // Close HTTP server
  global.server?.close(() => {
    console.log('✅ HTTP server closed');
  });
  
  // Stop health monitor
  try {
    if (global.healthMonitor) {
      global.healthMonitor.stopMonitoring();
      console.log('✅ Health monitor stopped');
    }
  } catch (error) {
    console.error('❌ Error stopping health monitor:', error);
  }
  
  // Stop cron jobs
  try {
    const withdrawalCronJobs = require('./withdrawalCronJobs');
    withdrawalCronJobs.stopAll();
    
    const coFounderInstallmentScheduler = require('./utils/coFounderInstallmentScheduler');
    coFounderInstallmentScheduler.stopAll();
    
    console.log('✅ Cron jobs stopped (withdrawal, installment, co-founder installment)');
    console.log('ℹ️  Referral cron jobs continue running for tracking purposes');
  } catch (error) {
    console.error('❌ Error stopping cron jobs:', error);
  }
  
  // Close database connection
  try {
    await mongoose.connection.close();
    console.log('✅ Database connection closed');
  } catch (error) {
    console.error('❌ Error closing database:', error);
  }
  
  console.log('👋 Process terminated gracefully');
  process.exit(0);
}

// Signal handlers
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('💥 Uncaught Exception:', err);
  console.error('Stack:', err.stack);
  process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
});

// Start server
const PORT = process.env.PORT || 5000;
const server = app.listen(PORT, () => {
  console.log('\n**********************************************');
  console.log(`🚀 Server running in ${process.env.NODE_ENV || 'development'} mode on port ${PORT}`);
  console.log(`📚 API Documentation: http://localhost:${PORT}/api-docs`);
  console.log(`🏠 Health Check: http://localhost:${PORT}/`);
  console.log(`🗂️ File Debug: http://localhost:${PORT}/api/debug/files`);
  console.log(`🔍 CORS Test: http://localhost:${PORT}/api/cors-test`);
  console.log(`📁 Working Directory: ${process.cwd()}`);
  console.log(`📂 Upload Directory: ${path.join(process.cwd(), 'uploads')}`);
  
  // Health Monitor endpoints
  console.log('\n🏥 Health Monitor Endpoints:');
  console.log(`   Status: http://localhost:${PORT}/api/system/health-status`);
  console.log(`   Manual Check: http://localhost:${PORT}/api/system/health-check`);
  
  // Co-founder installment endpoints
  console.log('\n🏛️ Co-Founder Installment Endpoints:');
  console.log(`   Stats: http://localhost:${PORT}/api/cofounder/installment/stats`);
  console.log(`   Manual Check: http://localhost:${PORT}/api/cofounder/installment/manual-penalty-check`);
  console.log(`   Calculate: http://localhost:${PORT}/api/shares/cofounder/installment/calculate`);
  console.log(`   Create: http://localhost:${PORT}/api/shares/cofounder/installment/create`);
  console.log(`   Plans: http://localhost:${PORT}/api/shares/cofounder/installment/plans`);
  console.log(`   Pay: http://localhost:${PORT}/api/shares/cofounder/installment/paystack/pay`);
  console.log(`   Verify: http://localhost:${PORT}/api/shares/cofounder/installment/paystack/verify`);
  
  // File serving info
  console.log('\n📁 File Serving Routes:');
  console.log(`   Regular Payments: http://localhost:${PORT}/uploads/payment-proofs/`);
  console.log(`   Co-founder Payments: http://localhost:${PORT}/uploads/cofounder-payment-proofs/`);
  console.log(`   Co-founder Alt Route: http://localhost:${PORT}/cofounder-payment-proofs/`);
  
  console.log('**********************************************\n');
  
  // Log initial file system state
  const uploadsDir = path.join(process.cwd(), 'uploads');
  const paymentProofsDir = path.join(uploadsDir, 'payment-proofs');
  const cofounderPaymentProofsDir = path.join(uploadsDir, 'cofounder-payment-proofs');
  
  console.log('File System Check on Startup:');
  console.log(`- Uploads directory exists: ${fs.existsSync(uploadsDir)}`);
  console.log(`- Payment-proofs directory exists: ${fs.existsSync(paymentProofsDir)}`);
  console.log(`- Co-founder payment-proofs directory exists: ${fs.existsSync(cofounderPaymentProofsDir)}`);
  
  // Create directories if they don't exist
  const directoriesToCreate = [
    { path: uploadsDir, name: 'uploads' },
    { path: paymentProofsDir, name: 'payment-proofs' },
    { path: cofounderPaymentProofsDir, name: 'cofounder-payment-proofs' }
  ];
  
  directoriesToCreate.forEach(({ path: dirPath, name }) => {
    if (!fs.existsSync(dirPath)) {
      console.log(`Creating ${name} directory...`);
      try {
        fs.mkdirSync(dirPath, { recursive: true });
        console.log(`✅ ${name} directory created successfully`);
      } catch (err) {
        console.error(`❌ Failed to create ${name} directory:`, err.message);
      }
    }
  });
  
  console.log('✅ File system setup complete.');
  console.log('🔐 CORS configuration active');
  console.log('📡 Static file serving enabled:');
  console.log('   - /uploads/payment-proofs/');
  console.log('   - /uploads/cofounder-payment-proofs/');
  console.log('   - /cofounder-payment-proofs/ (alternative)');
  console.log('⏰ Installment schedulers active (regular + co-founder)');
  console.log('🏥 System Health Monitor active');
  console.log('\n🎯 Quick Test URLs:');
  console.log(`   Health: https://afrimobile-d240af77c383.herokuapp.com/`);
  console.log(`   CORS: https://afrimobile-d240af77c383.herokuapp.com/api/cors-test`);
  console.log(`   Files: https://afrimobile-d240af77c383.herokuapp.com/api/debug/files`);
  console.log(`   Docs: https://afrimobile-d240af77c383.herokuapp.com/api-docs`);
  console.log(`   Health Status: https://afrimobile-d240af77c383.herokuapp.com/api/system/health-status`);
  console.log(`   Health Check: https://afrimobile-d240af77c383.herokuapp.com/api/system/health-check`);
  console.log(`   CoFounder Stats: https://afrimobile-d240af77c383.herokuapp.com/api/cofounder/installment/stats`);
  console.log(`   Manual Check: https://afrimobile-d240af77c383.herokuapp.com/api/cofounder/installment/manual-penalty-check`);
  console.log(`   File Test: https://afrimobile-d240af77c383.herokuapp.com/api/test-file-access`);
  console.log('');
  
  // Store server reference for graceful shutdown
  global.server = server;
  server.timeout = 120000; // 2 minutes
});
server.timeout = 30000; // 30 seconds
server.keepAliveTimeout = 61000; // Slightly longer than ALB idle timeout  
server.headersTimeout = 62000; // Slightly longer than keepAliveTimeout

// For testing purposes
module.exports = app;