const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cron = require('node-cron');

// Load environment variables
require('dotenv').config();

// Initialize express app
const app = express();

// Display important environment variables (without exposing sensitive data)
console.log('======================================');
console.log(`NODE_ENV: ${process.env.NODE_ENV}`);
console.log(`LENCO_API_KEY configured: ${process.env.LENCO_API_KEY ? 'Yes' : 'No'}`);
console.log('======================================');

// Security middleware
app.use(helmet());

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
app.use(cors());
app.use(express.json({ limit: '1mb' })); // Limit request body size
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Logging middleware
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

// Set up static folder for uploads
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Routes
app.use('/api/users', require('./routes/userRoutes'));
app.use('/api/shares', require('./routes/shareRoutes'));
app.use('/api/shares', require('./routes/coFounderShareRoutes')); // Fixed to use same base path

// New routes for project stats, leaderboard, and referrals
app.use('/api/project', require('./routes/projectRoutes'));
app.use('/api/leaderboard', require('./routes/leaderboardRoutes'));
app.use('/api/referral', require('./routes/referralRoutes'));
app.use('/api/payment', require('./routes/paymentRoutes'));
app.use('/api/withdrawal', require('./routes/withdrawalRoutes'));
app.use('/api/exchange-rates', require('./routes/exchangeRateRoutes'));

// Add installment payment routes
app.use('/api/shares/installment', require('./routes/installmentRoutes'));

// Manual referral sync endpoint
app.post('/api/referral/sync-earnings', async (req, res) => {
  try {
    console.log('Manual referral sync triggered...');
    const referralCronJobs = require('./referralCronJobs');
    const stats = await referralCronJobs.fixAllUsersReferralEarnings();
    
    res.json({
      success: true,
      message: 'Referral earnings sync completed',
      stats
    });
  } catch (error) {
    console.error('Manual referral sync failed:', error);
    res.status(500).json({
      success: false,
      message: 'Referral sync failed',
      error: error.message
    });
  }
});

// Simple test cron job to verify cron is working (runs every minute)
cron.schedule('* * * * *', () => {
  console.log('\n\n');
  console.log('======================================');
  console.log('TEST CRON: This should run every minute');
  console.log('Current time:', new Date().toISOString());
  console.log('======================================');
  console.log('\n\n');
});

// Create a simple test job that just logs withdrawals (runs every minute)
cron.schedule('* * * * *', async () => {
  console.log('\n\n');
  console.log('**********************************************');
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
  
  console.log('**********************************************');
  console.log('\n\n');
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
}

// REFERRAL SYNC CRON JOBS SETUP
console.log('\n======================================');
console.log('SETTING UP REFERRAL SYNC CRON JOBS');
console.log('======================================');

try {
  const referralCronJobs = require('./referralCronJobs');
  
  // Start referral sync jobs (you can change this to production only if needed)
  referralCronJobs.startReferralJobs();
  console.log('Referral sync cron jobs started');
  console.log('- Daily sync: 2:00 AM');
  console.log('- Weekly comprehensive sync: Sunday 3:00 AM');
  console.log('- Manual trigger: POST /api/referral/sync-earnings');
  
} catch (error) {
  console.error('ERROR LOADING REFERRAL CRON JOBS:', error);
  console.error(error.stack);
}

console.log('======================================\n');

// FORCE START WITHDRAWAL VERIFICATION CRON JOBS REGARDLESS OF ENVIRONMENT
console.log('\n\n');
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
console.log('======================================');
console.log('\n\n');

// One-time immediate check for withdrawals when app starts
setTimeout(async () => {
  console.log('\n\n');
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
  console.log('======================================');
  console.log('\n\n');
}, 5000); // Run 5 seconds after startup

// Serve static assets if in production
if (process.env.NODE_ENV === 'production') {
  // Set static folder
  app.use(express.static('client/build'));
  
  app.get('*', (req, res) => {
    res.sendFile(path.resolve(__dirname, 'client', 'build', 'index.html'));
  });
}

// Root route - Health check
app.get('/', (req, res) => {
  res.send('AfriMobile API is running');
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

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    success: false,
    message: 'Something went wrong!',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// Handle 404 errors
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Resource not found'
  });
});

// Start server
const PORT = process.env.PORT || 5000;
const server = app.listen(PORT, () => {
  console.log('\n\n');
  console.log('**********************************************');
  console.log(`Server running in ${process.env.NODE_ENV || 'development'} mode on port ${PORT}`);
  console.log('**********************************************');
  console.log('\n\n');
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  
  // Stop cron jobs if running
  try {
    const withdrawalCronJobs = require('./withdrawalCronJobs');
    withdrawalCronJobs.stopAll();
    
    // Stop referral cron jobs
    const referralCronJobs = require('./referralCronJobs');
    referralCronJobs.stopReferralJobs();
  } catch (error) {
    console.error('Error stopping cron jobs:', error);
  }
  
  server.close(() => {
    console.log('HTTP server closed');
    mongoose.connection.close(false, () => {
      console.log('MongoDB connection closed');
      process.exit(0);
    });
  });
});

// For testing purposes
module.exports = app;