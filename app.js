const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cron = require('node-cron');
const fs = require('fs'); // Added for enhanced file handling

// Load environment variables
require('dotenv').config();

// Import custom middleware
const setupSwagger = require('./middleware/swagger');

// Initialize express app
const app = express();

// Display important environment variables (without exposing sensitive data)
console.log('======================================');
console.log(`NODE_ENV: ${process.env.NODE_ENV}`);
console.log(`LENCO_API_KEY configured: ${process.env.LENCO_API_KEY ? 'Yes' : 'No'}`);
console.log(`Storage Method: MongoDB + Legacy File System`);
console.log('======================================');

// ========================================
// ENHANCED CORS CONFIGURATION
// ========================================

// Enhanced CORS configuration
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    // List of allowed origins
    const allowedOrigins = [
      'http://localhost:3000',
      'http://localhost:3001', 
      'http://localhost:5000',
      'http://localhost:8080',
      'https://afrimo-database.onrender.com',
      'https://www.afrimobil.com',  // ← ADD THIS LINE
      'https://afrimobil.com',      // ← AND THIS (without www)
      'https://www.afrimobiletech.com',  // ← ADD THIS LINE
      'https://afrimobiletech.com',      // ← AND THIS (without www)
      'https://your-frontend-domain.netlify.app', // If using Netlify
      // Add more domains as needed
    ];
    
    // In development, allow all localhost origins
    if (process.env.NODE_ENV === 'development') {
      const localhostRegex = /^http:\/\/localhost:\d+$/;
      if (localhostRegex.test(origin)) {
        return callback(null, true);
      }
    }
    
    // Check if origin is in allowed list
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      console.warn(`CORS blocked origin: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true, // Allow cookies and authentication headers
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
  exposedHeaders: ['X-Total-Count'], // Expose custom headers to frontend
  optionsSuccessStatus: 200 // Some legacy browsers choke on 204
};

// Apply CORS with options
app.use(cors(corsOptions));

// Add preflight handling for complex requests
app.options('*', cors(corsOptions));

// ========================================
// SECURITY MIDDLEWARE WITH UPDATED HELMET
// ========================================

// Updated helmet configuration to be less restrictive for file serving
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }, // Allow cross-origin resource access
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
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again after 15 minutes'
});

// Apply rate limiting to all routes
app.use(limiter);

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log('MongoDB Connected'))
.catch(err => {
  console.error(`Error connecting to MongoDB: ${err.message}`);
  process.exit(1);
});

// Middleware
app.use(express.json({ limit: '10mb' })); // Increased limit for MongoDB storage
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Logging middleware
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

// For development - very permissive CORS
if (process.env.NODE_ENV === 'development') {
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', '*');
    res.header('Access-Control-Allow-Headers', '*');
    next();
  });
  
  console.log('🔓 Development mode: Permissive CORS enabled');
}

// ====================================
// SIMPLIFIED STATIC FILE SERVING (LEGACY SUPPORT)
// ====================================

console.log('📁 Setting up legacy file serving (MongoDB storage active for new uploads)');

// Simplified static file serving for legacy files
app.use('/uploads', (req, res, next) => {
  // Add CORS headers for file serving
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  
  console.log(`[legacy-serve] Legacy file request: ${req.path}`);
  console.log(`[legacy-serve] Note: New files are served from MongoDB via controllers`);
  
  // This will only serve old files that exist on disk
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

// Simplified co-founder payment proofs route (legacy support)
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

// ========================================
// SIMPLIFIED API MONITORING MIDDLEWARE
// ========================================

// Simplified API monitoring for MongoDB storage
app.use('/api', (req, res, next) => {
  // Ensure CORS headers are present on all API routes
  res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, Cache-Control, X-Access-Token');
  
  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  // Log file-related requests (now using MongoDB storage)
  if (req.path.includes('shares') && (req.method === 'POST' || req.path.includes('manual') || req.path.includes('upload'))) {
    console.log(`[api-monitor] File upload request: ${req.method} ${req.path}`);
    console.log(`[api-monitor] Timestamp: ${new Date().toISOString()}`);
    console.log(`[api-monitor] Storage: MongoDB (new uploads) + Legacy file system (old files)`);
  }
  next();
});

// ========================================
// API ROUTES
// ========================================

// Routes
app.use('/api/users', require('./routes/userRoutes'));
app.use('/api/shares', require('./routes/shareRoutes'));
app.use('/api/cofounder', require('./routes/coFounderShareRoutes')); // Fixed to use same base path

// New routes for project stats, leaderboard, and referrals
app.use('/api/project', require('./routes/projectRoutes'));
app.use('/api/leaderboard', require('./routes/leaderboardRoutes'));
app.use('/api/referral', require('./routes/referralRoutes'));
app.use('/api/admin/referrals', require('./routes/adminReferralRoutes'));
app.use('/api/payment', require('./routes/paymentRoutes'));
app.use('/api/withdrawal', require('./routes/withdrawalRoutes'));
app.use('/api/exchange-rates', require('./routes/exchangeRateRoutes'));

// Add installment payment routes
app.use('/api/shares/installment', require('./routes/installmentRoutes'));

// ========================================
// CO-FOUNDER INSTALLMENT ROUTES (NEW)
// ========================================

// Add co-founder installment routes
app.use('/api/shares/cofounder/installment', require('./routes/coFounderInstallmentRoutes'));

// ========================================
// DEBUG AND MONITORING ENDPOINTS
// ========================================

// Add CORS test endpoint
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

// Updated file access test endpoint
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

// Updated file system debugging endpoint
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
    
    // Check disk space if possible
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
    
    // Check both directories (legacy files only)
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
          
          // Sort by modification time (newest first)
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

// Enhanced manual referral sync endpoint with better error handling
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

// Add a debug endpoint to check referral data structure
app.get('/api/referral/debug/:userId?', async (req, res) => {
  try {
    const User = require('./models/User');
    const UserShare = require('./models/UserShare');
    const ReferralTransaction = require('./models/ReferralTransaction');
    const Referral = require('./models/Referral');
    
    const { userId } = req.params;
    
    if (userId) {
      // Debug specific user
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
      // General debug info
      const totalUsers = await User.countDocuments();
      const usersWithUserNames = await User.countDocuments({ userName: { $exists: true, $ne: null } });
      const totalUserShares = await UserShare.countDocuments();
      const totalReferralTransactions = await ReferralTransaction.countDocuments();
      const totalReferrals = await Referral.countDocuments();
      
      // Sample data
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

// ========================================
// CO-FOUNDER INSTALLMENT DEBUG ENDPOINTS (NEW)
// ========================================

// Add manual co-founder installment penalty check endpoint
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

// Add co-founder installment statistics endpoint
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

    // Calculate financial stats
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

// ========================================
// CRON JOBS SETUP
// ========================================

// Simple test cron job to verify cron is working (runs every minute)
cron.schedule('* * * * *', () => {
  console.log('\n======================================');
  console.log('TEST CRON: This should run every minute');
  console.log('Current time:', new Date().toISOString());
  console.log('======================================\n');
});

// Create a simple test job that just logs withdrawals (runs every minute)
cron.schedule('* * * * *', async () => {
  console.log('\n**********************************************');
  console.log('*  TEST WITHDRAWAL JOB RUNNING              *');
  console.log('*  ' + new Date().toISOString() + '  *');
  console.log('**********************************************');
  
  try {
    // Just find withdrawals and log them
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

// Schedule tasks
// Setup monthly penalties for overdue installments
if (process.env.NODE_ENV === 'production') {
  console.log('Setting up production-only cron jobs...');
  
  const installmentScheduler = require('./utils/installmentScheduler');
  installmentScheduler.scheduleInstallmentPenalties();
  console.log('Installment penalty scheduler initialized');
  
  // Add daily check for late installment payments
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

  // ========================================
  // CO-FOUNDER INSTALLMENT SCHEDULER SETUP (NEW)
  // ========================================
  
  console.log('\n======================================');
  console.log('SETTING UP CO-FOUNDER INSTALLMENT SCHEDULER');
  console.log('======================================');

  try {
    const coFounderInstallmentScheduler = require('./utils/coFounderInstallmentScheduler');
    
    // Setup co-founder installment penalties (production only)
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
  console.log('ℹ️  Co-founder installment scheduler disabled in development mode');
  console.log('🔧 To test manually, use: POST /api/cofounder/installment/manual-penalty-check');
}

// REFERRAL SYNC CRON JOBS SETUP
console.log('\n======================================');
console.log('SETTING UP REFERRAL SYNC CRON JOBS');
console.log('======================================');

try {
  const referralCronJobs = require('./referralCronJobs');
  
  // Start referral sync jobs - runs in all environments for testing
  // Change to production-only if needed: if (process.env.NODE_ENV === 'production')
  referralCronJobs.startReferralJobs();
  console.log('✅ Referral sync cron jobs started');
  console.log('📅 Daily sync: 2:00 AM');
  console.log('📅 Weekly comprehensive sync: Sunday 3:00 AM');
  console.log('🔧 Manual trigger: POST /api/referral/sync-earnings');
  console.log('🐛 Debug endpoint: GET /api/referral/debug');
  
} catch (error) {
  console.error('❌ ERROR LOADING REFERRAL CRON JOBS:', error.message);
  console.error(error.stack);
}

console.log('======================================\n');

// FORCE START WITHDRAWAL VERIFICATION CRON JOBS REGARDLESS OF ENVIRONMENT
console.log('======================================');
console.log('FORCE STARTING WITHDRAWAL CRON JOBS');
console.log(`Current NODE_ENV: ${process.env.NODE_ENV}`);

try {
  const withdrawalCronJobs = require('./withdrawalCronJobs');
  console.log('Withdrawal cron jobs module loaded successfully');
  
  // Force start the processing job directly
  withdrawalCronJobs.verifyProcessingWithdrawals.start();
  console.log('Processing withdrawals job started');
  
  // Force start the pending job directly
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
    // Only proceed if LENCO_API_KEY is configured
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
        
        // Try a direct API call to Lenco for the first withdrawal
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
}, 5000); // Run 5 seconds after startup

// ========================================
// STATIC FILES & PRODUCTION SETUP
// ========================================

// Serve static assets if in production
if (process.env.NODE_ENV === 'production') {
  // Set static folder
  app.use(express.static('client/build'));
  
  app.get('*', (req, res) => {
    res.sendFile(path.resolve(__dirname, 'client', 'build', 'index.html'));
  });
}

// ========================================
// API ENDPOINTS
// ========================================

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
    // Add co-founder installment system info
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
        '/cofounder-payment-proofs/' // Alternative route
      ]
    }
  });
});

// Add a test route for manually checking Lenco API
app.get('/api/test-lenco/:reference', async (req, res) => {
  try {
    console.log('Testing Lenco API directly...');
    const { reference } = req.params;
    
    // Log API key status
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

// ========================================
// ERROR HANDLING
// ========================================

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

// ========================================
// SERVER STARTUP
// ========================================

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
  
  // Add co-founder installment specific endpoints
  console.log('\n🏛️ Co-Founder Installment Endpoints:');
  console.log(`   Stats: http://localhost:${PORT}/api/cofounder/installment/stats`);
  console.log(`   Manual Check: http://localhost:${PORT}/api/cofounder/installment/manual-penalty-check`);
  console.log(`   Calculate: http://localhost:${PORT}/api/shares/cofounder/installment/calculate`);
  console.log(`   Create: http://localhost:${PORT}/api/shares/cofounder/installment/create`);
  console.log(`   Plans: http://localhost:${PORT}/api/shares/cofounder/installment/plans`);
  console.log(`   Pay: http://localhost:${PORT}/api/shares/cofounder/installment/paystack/pay`);
  console.log(`   Verify: http://localhost:${PORT}/api/shares/cofounder/installment/paystack/verify`);
  
  // Add file serving info
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
  console.log('\n🎯 Quick Test URLs:');
  console.log(`   Health: https://afrimo-database.onrender.com/`);
  console.log(`   CORS: https://afrimo-database.onrender.com/api/cors-test`);
  console.log(`   Files: https://afrimo-database.onrender.com/api/debug/files`);
  console.log(`   Docs: https://afrimo-database.onrender.com/api-docs`);
  console.log(`   CoFounder Stats: https://afrimo-database.onrender.com/api/cofounder/installment/stats`);
  console.log(`   Manual Check: https://afrimo-database.onrender.com/api/cofounder/installment/manual-penalty-check`);
  console.log(`   File Test: https://afrimo-database.onrender.com/api/test-file-access`);
  console.log('');
});

// ========================================
// ENHANCED GRACEFUL SHUTDOWN
// ========================================

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  
  // Stop cron jobs if running
  try {
    const withdrawalCronJobs = require('./withdrawalCronJobs');
    withdrawalCronJobs.stopAll();
    
    // REMOVED: referral cron jobs stop to allow continuous tracking
    // const referralCronJobs = require('./referralCronJobs');
    // referralCronJobs.stopReferralJobs();
    
    // Stop co-founder installment scheduler
    const coFounderInstallmentScheduler = require('./utils/coFounderInstallmentScheduler');
    coFounderInstallmentScheduler.stopAll();
    
    console.log('✅ Cron jobs stopped (withdrawal, installment, co-founder installment)');
    console.log('ℹ️  Referral cron jobs continue running for tracking purposes');
  } catch (error) {
    console.error('❌ Error stopping cron jobs:', error);
  }
  
  server.close(() => {
    console.log('HTTP server closed');
    mongoose.connection.close(false, () => {
      console.log('MongoDB connection closed');
      process.exit(0);
    });
  });
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  console.error('Stack:', err.stack);
  process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// For testing purposes
module.exports = app;