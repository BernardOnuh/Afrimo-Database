#!/usr/bin/env node

/**
 * Script to check pending withdrawals and identify users
 * Run with: node checkPendingWithdrawals.js
 */

const mongoose = require('mongoose');
require('dotenv').config();

// Define the Withdrawal schema (based on your controller usage)
const withdrawalSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  amount: {
    type: Number,
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'processing', 'paid', 'failed', 'rejected', 'approved'],
    default: 'pending'
  },
  paymentMethod: {
    type: String,
    enum: ['bank', 'crypto', 'mobile_money'],
    required: true
  },
  paymentDetails: {
    type: Object,
    required: true
  },
  transactionReference: String,
  clientReference: String,
  notes: String,
  rejectionReason: String,
  adminNotes: String,
  createdAt: {
    type: Date,
    default: Date.now
  },
  processedAt: Date,
  approvedAt: Date,
  rejectedAt: Date
});

// Define the User schema (minimal fields needed)
const userSchema = new mongoose.Schema({
  name: String,
  email: String,
  profileImage: String,
  createdAt: Date
});

// Create models
const Withdrawal = mongoose.model('Withdrawal', withdrawalSchema);
const User = mongoose.model('User', userSchema);

// Color codes for console output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  bright: '\x1b[1m'
};

// Helper function to format currency
function formatCurrency(amount) {
  return `₦${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Helper function to format date
function formatDate(date) {
  return new Date(date).toLocaleString('en-US', {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

// Helper function to calculate days ago
function daysAgo(date) {
  const now = new Date();
  const diffTime = Math.abs(now - new Date(date));
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays;
}

// Main function to check pending withdrawals
async function checkPendingWithdrawals() {
  try {
    console.log(`${colors.cyan}${colors.bright}🔍 CHECKING PENDING WITHDRAWALS${colors.reset}\n`);

    // Connect to MongoDB
    const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.DATABASE_URL;
    
    if (!mongoUri) {
      console.error(`${colors.red}❌ No MongoDB connection string found in environment variables${colors.reset}`);
      process.exit(1);
    }

    console.log(`${colors.yellow}⏳ Connecting to database...${colors.reset}`);
    
    await mongoose.connect(mongoUri, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });

    console.log(`${colors.green}✅ Connected to MongoDB${colors.reset}\n`);

    // Query for pending withdrawals
    console.log(`${colors.blue}📊 Fetching pending withdrawals...${colors.reset}`);
    
    const pendingWithdrawals = await Withdrawal.find({ 
      status: { $in: ['pending', 'processing'] }  // Include both pending and processing
    })
    .populate('user', 'name email profileImage createdAt')
    .sort({ createdAt: -1 });

    if (pendingWithdrawals.length === 0) {
      console.log(`${colors.green}✅ No pending withdrawals found!${colors.reset}`);
      return;
    }

    // Display results
    console.log(`${colors.magenta}${colors.bright}📋 FOUND ${pendingWithdrawals.length} PENDING/PROCESSING WITHDRAWAL(S):${colors.reset}\n`);
    
    let totalPendingAmount = 0;
    let totalProcessingAmount = 0;

    // Group by status for better organization
    const byStatus = {
      pending: pendingWithdrawals.filter(w => w.status === 'pending'),
      processing: pendingWithdrawals.filter(w => w.status === 'processing')
    };

    // Display pending withdrawals
    if (byStatus.pending.length > 0) {
      console.log(`${colors.yellow}${colors.bright}⏳ PENDING WITHDRAWALS (${byStatus.pending.length}):${colors.reset}`);
      console.log('='.repeat(80));

      byStatus.pending.forEach((withdrawal, index) => {
        const user = withdrawal.user;
        const amount = withdrawal.amount;
        const daysOld = daysAgo(withdrawal.createdAt);
        
        totalPendingAmount += amount;

        console.log(`${colors.bright}${index + 1}. ${colors.cyan}${user?.name || 'Unknown User'}${colors.reset}`);
        console.log(`   📧 Email: ${user?.email || 'N/A'}`);
        console.log(`   💰 Amount: ${colors.green}${formatCurrency(amount)}${colors.reset}`);
        console.log(`   🏦 Method: ${withdrawal.paymentMethod}`);
        console.log(`   📅 Requested: ${formatDate(withdrawal.createdAt)} (${daysOld} day${daysOld !== 1 ? 's' : ''} ago)`);
        console.log(`   🆔 ID: ${withdrawal._id}`);
        console.log(`   📝 Reference: ${withdrawal.clientReference || 'N/A'}`);
        
        if (withdrawal.paymentDetails) {
          if (withdrawal.paymentMethod === 'bank') {
            console.log(`   🏛️  Bank: ${withdrawal.paymentDetails.bankName || 'N/A'}`);
            console.log(`   🔢 Account: ${withdrawal.paymentDetails.accountNumber || 'N/A'}`);
            console.log(`   👤 Name: ${withdrawal.paymentDetails.accountName || 'N/A'}`);
          }
        }

        if (withdrawal.notes) {
          console.log(`   📝 Notes: ${withdrawal.notes}`);
        }

        // Warning for old withdrawals
        if (daysOld > 7) {
          console.log(`   ${colors.red}⚠️  WARNING: This withdrawal is ${daysOld} days old!${colors.reset}`);
        }

        console.log('');
      });
    }

    // Display processing withdrawals
    if (byStatus.processing.length > 0) {
      console.log(`${colors.blue}${colors.bright}🔄 PROCESSING WITHDRAWALS (${byStatus.processing.length}):${colors.reset}`);
      console.log('='.repeat(80));

      byStatus.processing.forEach((withdrawal, index) => {
        const user = withdrawal.user;
        const amount = withdrawal.amount;
        const daysOld = daysAgo(withdrawal.createdAt);
        
        totalProcessingAmount += amount;

        console.log(`${colors.bright}${index + 1}. ${colors.cyan}${user?.name || 'Unknown User'}${colors.reset}`);
        console.log(`   📧 Email: ${user?.email || 'N/A'}`);
        console.log(`   💰 Amount: ${colors.green}${formatCurrency(amount)}${colors.reset}`);
        console.log(`   🏦 Method: ${withdrawal.paymentMethod}`);
        console.log(`   📅 Requested: ${formatDate(withdrawal.createdAt)} (${daysOld} day${daysOld !== 1 ? 's' : ''} ago)`);
        console.log(`   🆔 ID: ${withdrawal._id}`);
        console.log(`   📝 Reference: ${withdrawal.clientReference || withdrawal.transactionReference || 'N/A'}`);
        
        if (withdrawal.transactionReference) {
          console.log(`   🔗 Transaction Ref: ${withdrawal.transactionReference}`);
        }

        if (withdrawal.notes) {
          console.log(`   📝 Notes: ${withdrawal.notes}`);
        }

        // Warning for old processing withdrawals
        if (daysOld > 3) {
          console.log(`   ${colors.yellow}⚠️  NOTICE: This withdrawal has been processing for ${daysOld} days${colors.reset}`);
        }

        console.log('');
      });
    }

    // Summary
    console.log(`${colors.magenta}${colors.bright}📊 SUMMARY:${colors.reset}`);
    console.log('='.repeat(50));
    console.log(`${colors.yellow}⏳ Pending Withdrawals: ${byStatus.pending.length} (${formatCurrency(totalPendingAmount)})${colors.reset}`);
    console.log(`${colors.blue}🔄 Processing Withdrawals: ${byStatus.processing.length} (${formatCurrency(totalProcessingAmount)})${colors.reset}`);
    console.log(`${colors.bright}📈 Total Amount: ${formatCurrency(totalPendingAmount + totalProcessingAmount)}${colors.reset}`);
    
    // Additional statistics
    const oldWithdrawals = pendingWithdrawals.filter(w => daysAgo(w.createdAt) > 7);
    if (oldWithdrawals.length > 0) {
      console.log(`${colors.red}⚠️  Withdrawals older than 7 days: ${oldWithdrawals.length}${colors.reset}`);
    }

    // Users with multiple pending withdrawals (shouldn't happen based on your logic)
    const userCounts = {};
    pendingWithdrawals.forEach(w => {
      const userId = w.user._id.toString();
      userCounts[userId] = (userCounts[userId] || 0) + 1;
    });

    const multipleWithdrawals = Object.entries(userCounts).filter(([_, count]) => count > 1);
    if (multipleWithdrawals.length > 0) {
      console.log(`${colors.red}⚠️  Users with multiple pending withdrawals: ${multipleWithdrawals.length}${colors.reset}`);
      multipleWithdrawals.forEach(([userId, count]) => {
        const user = pendingWithdrawals.find(w => w.user._id.toString() === userId)?.user;
        console.log(`   - ${user?.name || 'Unknown'} (${user?.email || 'N/A'}): ${count} withdrawals`);
      });
    }

  } catch (error) {
    console.error(`${colors.red}❌ Error checking pending withdrawals:${colors.reset}`, error.message);
    
    if (error.message.includes('ENOTFOUND')) {
      console.error(`${colors.red}🌐 DNS resolution failed - check your MongoDB URI${colors.reset}`);
    } else if (error.message.includes('authentication failed')) {
      console.error(`${colors.red}🔐 Authentication failed - check username/password${colors.reset}`);
    }
  } finally {
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
      console.log(`\n${colors.yellow}🔌 Database connection closed${colors.reset}`);
    }
  }
}

// Additional function to check specific user's withdrawals
async function checkUserWithdrawals(userEmail) {
  try {
    const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.DATABASE_URL;
    
    if (!mongoUri) {
      console.error(`${colors.red}❌ No MongoDB connection string found${colors.reset}`);
      process.exit(1);
    }

    await mongoose.connect(mongoUri, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });

    const user = await User.findOne({ email: userEmail });
    if (!user) {
      console.log(`${colors.red}❌ User not found: ${userEmail}${colors.reset}`);
      return;
    }

    const userWithdrawals = await Withdrawal.find({ 
      user: user._id,
      status: { $in: ['pending', 'processing'] }
    }).sort({ createdAt: -1 });

    console.log(`${colors.cyan}👤 Withdrawals for ${user.name} (${userEmail}):${colors.reset}`);
    
    if (userWithdrawals.length === 0) {
      console.log(`${colors.green}✅ No pending withdrawals${colors.reset}`);
    } else {
      userWithdrawals.forEach((withdrawal, index) => {
        console.log(`${index + 1}. ${formatCurrency(withdrawal.amount)} - ${withdrawal.status} - ${formatDate(withdrawal.createdAt)}`);
      });
    }

  } catch (error) {
    console.error(`${colors.red}❌ Error:${colors.reset}`, error.message);
  } finally {
    await mongoose.connection.close();
  }
}

// Handle command line arguments
const args = process.argv.slice(2);

if (args.length === 0) {
  // Run main function
  checkPendingWithdrawals().then(() => {
    console.log(`\n${colors.green}✅ Script completed successfully${colors.reset}`);
    process.exit(0);
  }).catch((error) => {
    console.error(`${colors.red}💥 Script failed:${colors.reset}`, error.message);
    process.exit(1);
  });
} else if (args[0] === '--user' && args[1]) {
  // Check specific user
  checkUserWithdrawals(args[1]).then(() => {
    process.exit(0);
  }).catch((error) => {
    console.error(`${colors.red}💥 Script failed:${colors.reset}`, error.message);
    process.exit(1);
  });
} else {
  console.log(`${colors.yellow}Usage:${colors.reset}`);
  console.log('  node checkPendingWithdrawals.js                    # Check all pending withdrawals');
  console.log('  node checkPendingWithdrawals.js --user email@example.com  # Check specific user');
  process.exit(1);
}

module.exports = {
  checkPendingWithdrawals,
  checkUserWithdrawals
};