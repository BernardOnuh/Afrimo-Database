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

// Add additional routes here as your application grows
// app.use('/api/transactions', require('./routes/transactionRoutes'));
// app.use('/api/wallets', require('./routes/walletRoutes'));

// Simple test cron job to verify cron is working (runs every minute)
cron.schedule('* * * * *', () => {
  console.log('======================================');
  console.log('TEST CRON: This should run every minute');
  console.log('Current time:', new Date().toISOString());
  console.log('======================================');
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
  
  // Start withdrawal verification cron jobs
  console.log('======================================');
  console.log('ATTEMPTING TO START WITHDRAWAL CRON JOBS');
  console.log(`Current NODE_ENV: ${process.env.NODE_ENV}`);
  
  try {
    const withdrawalCronJobs = require('./withdrawalCronJobs');
    console.log('Withdrawal cron jobs module loaded successfully');
    withdrawalCronJobs.startAll();
  } catch (error) {
    console.error('ERROR LOADING WITHDRAWAL CRON JOBS:', error);
    console.error(error.stack);
  }
  
  console.log('======================================');
} else {
  console.log('Not in production environment, skipping production-only cron jobs');
  console.log('To force cron jobs to run, set NODE_ENV=production');
  
  // Uncomment this section to force cron jobs to run in any environment
  /*
  console.log('======================================');
  console.log('FORCE STARTING WITHDRAWAL CRON JOBS (DEVELOPMENT MODE)');
  
  try {
    const withdrawalCronJobs = require('./withdrawalCronJobs');
    console.log('Withdrawal cron jobs module loaded successfully');
    withdrawalCronJobs.startAll();
  } catch (error) {
    console.error('ERROR LOADING WITHDRAWAL CRON JOBS:', error);
    console.error(error.stack);
  }
  
  console.log('======================================');
  */
}

// One-time immediate check for withdrawals when app starts
setTimeout(async () => {
  console.log('======================================');
  console.log('Running immediate one-time withdrawal verification check...');
  try {
    const Withdrawal = require('./models/Withdrawal');
    const processingWithdrawals = await Withdrawal.find({ status: 'processing' });
    console.log(`Found ${processingWithdrawals.length} processing withdrawals`);
    
    if (processingWithdrawals.length > 0) {
      console.log('Processing withdrawals:');
      processingWithdrawals.forEach(w => {
        console.log(`- ID: ${w._id}, ClientRef: ${w.clientReference}, Status: ${w.status}, Created: ${w.createdAt}`);
      });
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
  console.log(`Server running in ${process.env.NODE_ENV || 'development'} mode on port ${PORT}`);
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  
  // Stop cron jobs if running
  if (process.env.NODE_ENV === 'production') {
    try {
      const withdrawalCronJobs = require('./withdrawalCronJobs');
      withdrawalCronJobs.stopAll();
    } catch (error) {
      console.error('Error stopping withdrawal cron jobs:', error);
    }
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