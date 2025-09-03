#!/usr/bin/env node

/**
 * User Balance & Withdrawal Audit Script
 * Comprehensive audit tool for investigating user balance discrepancies
 * 
 * Usage:
 * node auditUser.js --email iprete@example.com
 * node auditUser.js --name "Iprete Johnson O."
 * node auditUser.js --username "Ipresino"
 * node auditUser.js --id userId
 */

const mongoose = require('mongoose');
require('dotenv').config();

// Define schemas
const withdrawalSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  amount: { type: Number, required: true },
  status: {
    type: String,
    enum: ['pending', 'processing', 'paid', 'failed', 'rejected', 'approved'],
    default: 'pending'
  },
  paymentMethod: { type: String, enum: ['bank', 'crypto', 'mobile_money'], required: true },
  paymentDetails: { type: Object, required: true },
  transactionReference: String,
  clientReference: String,
  notes: String,
  rejectionReason: String,
  adminNotes: String,
  createdAt: { type: Date, default: Date.now },
  processedAt: Date,
  approvedAt: Date,
  rejectedAt: Date,
  failedAt: Date,
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  rejectedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  paidBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
});

const userSchema = new mongoose.Schema({
  name: String,
  email: String,
  username: String,
  profileImage: String,
  createdAt: Date,
  isAdmin: Boolean
});

const referralSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  totalEarnings: { type: Number, default: 0 },
  totalWithdrawn: { type: Number, default: 0 },
  pendingWithdrawals: { type: Number, default: 0 },
  processingWithdrawals: { type: Number, default: 0 }
});

const referralTransactionSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  type: { type: String, enum: ['earning', 'withdrawal', 'bonus', 'penalty'] },
  amount: Number,
  description: String,
  status: { type: String, enum: ['completed', 'pending', 'failed'] },
  reference: String,
  createdAt: { type: Date, default: Date.now }
});

// Create models
const Withdrawal = mongoose.model('Withdrawal', withdrawalSchema);
const User = mongoose.model('User', userSchema);
const Referral = mongoose.model('Referral', referralSchema);
const ReferralTransaction = mongoose.model('ReferralTransaction', referralTransactionSchema);

// Color codes
const colors = {
  reset: '\x1b[0m', red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  blue: '\x1b[34m', magenta: '\x1b[35m', cyan: '\x1b[36m', white: '\x1b[37m', bright: '\x1b[1m'
};

// Helper functions
function formatCurrency(amount) {
  return `₦${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(date) {
  return new Date(date).toLocaleString('en-US', {
    weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

function daysAgo(date) {
  const now = new Date();
  const diffTime = Math.abs(now - new Date(date));
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

function getStatusColor(status) {
  switch (status.toLowerCase()) {
    case 'paid': return colors.green;
    case 'pending': return colors.yellow;
    case 'processing': return colors.blue;
    case 'failed': case 'rejected': return colors.red;
    case 'approved': return colors.cyan;
    default: return colors.white;
  }
}

// Main audit function
async function auditUser(searchCriteria) {
  try {
    console.log(`${colors.cyan}${colors.bright}🔍 USER BALANCE & WITHDRAWAL AUDIT${colors.reset}\n`);

    // Connect to MongoDB
    const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.DATABASE_URL;
    if (!mongoUri) {
      console.error(`${colors.red}❌ No MongoDB connection string found${colors.reset}`);
      process.exit(1);
    }

    console.log(`${colors.yellow}⏳ Connecting to database...${colors.reset}`);
    await mongoose.connect(mongoUri, { useNewUrlParser: true, useUnifiedTopology: true });
    console.log(`${colors.green}✅ Connected to MongoDB${colors.reset}\n`);

    // Find user with flexible search
    console.log(`${colors.blue}🔍 Searching for user...${colors.reset}`);
    let user = null;
    let searchMethod = '';

    if (searchCriteria.email) {
      user = await User.findOne({ email: new RegExp(searchCriteria.email, 'i') });
      searchMethod = `email: ${searchCriteria.email}`;
    } else if (searchCriteria.name) {
      user = await User.findOne({ name: new RegExp(searchCriteria.name, 'i') });
      searchMethod = `name: ${searchCriteria.name}`;
    } else if (searchCriteria.username) {
      user = await User.findOne({ username: new RegExp(searchCriteria.username, 'i') });
      searchMethod = `username: ${searchCriteria.username}`;
    } else if (searchCriteria.id) {
      if (mongoose.Types.ObjectId.isValid(searchCriteria.id)) {
        user = await User.findById(searchCriteria.id);
        searchMethod = `ID: ${searchCriteria.id}`;
      } else {
        console.error(`${colors.red}❌ Invalid user ID format${colors.reset}`);
        return;
      }
    }

    if (!user) {
      console.error(`${colors.red}❌ User not found using ${searchMethod}${colors.reset}`);
      
      // Try broader search
      console.log(`${colors.yellow}🔍 Trying broader search...${colors.reset}`);
      const searchTerm = searchCriteria.email || searchCriteria.name || searchCriteria.username;
      if (searchTerm) {
        const users = await User.find({
          $or: [
            { name: new RegExp(searchTerm, 'i') },
            { email: new RegExp(searchTerm, 'i') },
            { username: new RegExp(searchTerm, 'i') }
          ]
        }).limit(5);
        
        if (users.length > 0) {
          console.log(`${colors.cyan}📋 Found ${users.length} similar user(s):${colors.reset}`);
          users.forEach((u, i) => {
            console.log(`${i + 1}. ${u.name} (${u.email}) - ID: ${u._id}`);
          });
        }
      }
      return;
    }

    console.log(`${colors.green}✅ Found user: ${user.name} (${user.email})${colors.reset}\n`);

    // === COMPREHENSIVE AUDIT ANALYSIS ===
    console.log(`${colors.magenta}${colors.bright}📊 COMPREHENSIVE USER AUDIT${colors.reset}`);
    console.log('='.repeat(80));

    // User Information
    console.log(`${colors.bright}👤 USER INFORMATION:${colors.reset}`);
    console.log(`   Name: ${user.name}`);
    console.log(`   Email: ${user.email}`);
    console.log(`   Username: ${user.username || 'N/A'}`);
    console.log(`   User ID: ${user._id}`);
    console.log(`   Member Since: ${formatDate(user.createdAt)}`);
    console.log(`   Admin User: ${user.isAdmin ? 'YES' : 'No'}\n`);

    // Get all withdrawals
    const allWithdrawals = await Withdrawal.find({ user: user._id })
      .sort({ createdAt: -1 })
      .populate('approvedBy rejectedBy paidBy', 'name email');

    // Get referral data
    const referralData = await Referral.findOne({ user: user._id });
    
    // Get referral transactions
    const referralTransactions = await ReferralTransaction.find({ user: user._id })
      .sort({ createdAt: -1 })
      .limit(10);

    // === BALANCE ANALYSIS ===
    console.log(`${colors.cyan}${colors.bright}💰 BALANCE ANALYSIS:${colors.reset}`);
    if (referralData) {
      const totalEarnings = referralData.totalEarnings || 0;
      const totalWithdrawn = referralData.totalWithdrawn || 0;
      const pendingWithdrawals = referralData.pendingWithdrawals || 0;
      const processingWithdrawals = referralData.processingWithdrawals || 0;
      const calculatedBalance = totalEarnings - totalWithdrawn - pendingWithdrawals - processingWithdrawals;

      console.log(`   Total Earnings: ${formatCurrency(totalEarnings)}`);
      console.log(`   Total Withdrawn: ${formatCurrency(totalWithdrawn)}`);
      console.log(`   Pending Withdrawals: ${formatCurrency(pendingWithdrawals)}`);
      console.log(`   Processing Withdrawals: ${formatCurrency(processingWithdrawals)}`);
      console.log(`   ${colors.bright}Available Balance: ${formatCurrency(calculatedBalance)}${colors.reset}`);
      
      // Check for the reported ₦160,000 pending
      if (pendingWithdrawals === 160000) {
        console.log(`   ${colors.yellow}⚠️  CONFIRMED: ₦160,000 pending withdrawal matches database${colors.reset}`);
      } else if (pendingWithdrawals > 0) {
        console.log(`   ${colors.red}⚠️  DISCREPANCY: Database shows ${formatCurrency(pendingWithdrawals)} pending, not ₦160,000${colors.reset}`);
      }
    } else {
      console.log(`   ${colors.red}❌ No referral data found for this user${colors.reset}`);
    }

    // === WITHDRAWAL ANALYSIS ===
    console.log(`\n${colors.blue}${colors.bright}📈 WITHDRAWAL ANALYSIS:${colors.reset}`);
    
    if (allWithdrawals.length === 0) {
      console.log(`   ${colors.yellow}📋 No withdrawals found for this user${colors.reset}`);
    } else {
      // Calculate withdrawal totals by status
      const withdrawalsByStatus = allWithdrawals.reduce((acc, w) => {
        acc[w.status] = (acc[w.status] || 0) + w.amount;
        return acc;
      }, {});

      const withdrawalCounts = allWithdrawals.reduce((acc, w) => {
        acc[w.status] = (acc[w.status] || 0) + 1;
        return acc;
      }, {});

      console.log(`   Total Withdrawal Requests: ${allWithdrawals.length}`);
      Object.keys(withdrawalsByStatus).forEach(status => {
        const color = getStatusColor(status);
        console.log(`   ${color}${status.toUpperCase()}:${colors.reset} ${withdrawalCounts[status]} requests - ${formatCurrency(withdrawalsByStatus[status])}`);
      });

      // Check for pending withdrawals specifically
      const pendingWithdrawals = allWithdrawals.filter(w => w.status === 'pending');
      const processingWithdrawals = allWithdrawals.filter(w => w.status === 'processing');
      
      if (pendingWithdrawals.length > 0 || processingWithdrawals.length > 0) {
        console.log(`\n   ${colors.yellow}${colors.bright}⏳ ACTIVE WITHDRAWALS REQUIRING ATTENTION:${colors.reset}`);
        
        [...pendingWithdrawals, ...processingWithdrawals].forEach((w, i) => {
          const daysOld = daysAgo(w.createdAt);
          const statusColor = getStatusColor(w.status);
          console.log(`   ${i + 1}. ${statusColor}${w.status.toUpperCase()}${colors.reset} - ${formatCurrency(w.amount)}`);
          console.log(`      📅 Date: ${formatDate(w.createdAt)} (${daysOld} days ago)`);
          console.log(`      🆔 ID: ${w._id}`);
          console.log(`      📝 Reference: ${w.clientReference || w.transactionReference || 'N/A'}`);
          if (w.paymentDetails && w.paymentDetails.bankName) {
            console.log(`      🏛️  Bank: ${w.paymentDetails.bankName} - ${w.paymentDetails.accountNumber}`);
          }
          if (daysOld > 7) {
            console.log(`      ${colors.red}⚠️  WARNING: This withdrawal is ${daysOld} days old!${colors.reset}`);
          }
          console.log('');
        });
      }
    }

    // === BALANCE RECONCILIATION ===
    console.log(`${colors.magenta}${colors.bright}🔍 BALANCE RECONCILIATION:${colors.reset}`);
    
    if (referralData && allWithdrawals.length > 0) {
      // Calculate actual totals from withdrawal records
      const actualPendingTotal = allWithdrawals
        .filter(w => w.status === 'pending')
        .reduce((sum, w) => sum + w.amount, 0);
        
      const actualProcessingTotal = allWithdrawals
        .filter(w => w.status === 'processing')
        .reduce((sum, w) => sum + w.amount, 0);
        
      const actualPaidTotal = allWithdrawals
        .filter(w => w.status === 'paid')
        .reduce((sum, w) => sum + w.amount, 0);

      console.log(`   Database vs Actual Comparison:`);
      console.log(`   Pending: DB=${formatCurrency(referralData.pendingWithdrawals || 0)} | Actual=${formatCurrency(actualPendingTotal)}`);
      console.log(`   Processing: DB=${formatCurrency(referralData.processingWithdrawals || 0)} | Actual=${formatCurrency(actualProcessingTotal)}`);
      console.log(`   Paid: DB=${formatCurrency(referralData.totalWithdrawn || 0)} | Actual=${formatCurrency(actualPaidTotal)}`);

      // Check for discrepancies
      const pendingDiscrepancy = Math.abs((referralData.pendingWithdrawals || 0) - actualPendingTotal);
      const processingDiscrepancy = Math.abs((referralData.processingWithdrawals || 0) - actualProcessingTotal);
      const paidDiscrepancy = Math.abs((referralData.totalWithdrawn || 0) - actualPaidTotal);

      if (pendingDiscrepancy > 0.01 || processingDiscrepancy > 0.01 || paidDiscrepancy > 0.01) {
        console.log(`\n   ${colors.red}${colors.bright}🚨 DISCREPANCIES DETECTED:${colors.reset}`);
        if (pendingDiscrepancy > 0.01) {
          console.log(`   ${colors.red}❌ Pending mismatch: ${formatCurrency(pendingDiscrepancy)} difference${colors.reset}`);
        }
        if (processingDiscrepancy > 0.01) {
          console.log(`   ${colors.red}❌ Processing mismatch: ${formatCurrency(processingDiscrepancy)} difference${colors.reset}`);
        }
        if (paidDiscrepancy > 0.01) {
          console.log(`   ${colors.red}❌ Paid total mismatch: ${formatCurrency(paidDiscrepancy)} difference${colors.reset}`);
        }
      } else {
        console.log(`   ${colors.green}✅ All balances reconcile correctly${colors.reset}`);
      }

      // Special check for the reported ₦160,000
      if (actualPendingTotal === 160000) {
        console.log(`\n   ${colors.yellow}${colors.bright}🎯 REPORT VERIFICATION:${colors.reset}`);
        console.log(`   ${colors.green}✅ CONFIRMED: ₦160,000 pending withdrawal found in database${colors.reset}`);
        console.log(`   ${colors.blue}📋 This amount matches the reported issue${colors.reset}`);
      } else if (actualPendingTotal > 0) {
        console.log(`\n   ${colors.yellow}${colors.bright}🎯 REPORT VERIFICATION:${colors.reset}`);
        console.log(`   ${colors.yellow}⚠️  Actual pending total is ${formatCurrency(actualPendingTotal)}, not ₦160,000${colors.reset}`);
      }
    }

    // === RECENT REFERRAL TRANSACTIONS ===
    if (referralTransactions.length > 0) {
      console.log(`\n${colors.green}${colors.bright}📊 RECENT REFERRAL TRANSACTIONS (Last 10):${colors.reset}`);
      referralTransactions.forEach((tx, i) => {
        const typeColor = tx.type === 'earning' ? colors.green : 
                         tx.type === 'withdrawal' ? colors.red : colors.blue;
        console.log(`   ${i + 1}. ${typeColor}${tx.type.toUpperCase()}${colors.reset} - ${formatCurrency(tx.amount)}`);
        console.log(`      📅 ${formatDate(tx.createdAt)}`);
        console.log(`      📝 ${tx.description || 'No description'}`);
        if (tx.reference) console.log(`      🔗 ${tx.reference}`);
        console.log('');
      });
    }

    // === RECOMMENDATIONS ===
    console.log(`${colors.cyan}${colors.bright}💡 AUDIT RECOMMENDATIONS:${colors.reset}`);
    
    const pendingWithdrawals = allWithdrawals.filter(w => w.status === 'pending');
    const oldPendingWithdrawals = pendingWithdrawals.filter(w => daysAgo(w.createdAt) > 7);
    
    if (oldPendingWithdrawals.length > 0) {
      console.log(`   ${colors.red}🚨 URGENT: ${oldPendingWithdrawals.length} withdrawal(s) pending for more than 7 days${colors.reset}`);
      console.log(`   ${colors.yellow}👉 ACTION REQUIRED: Review and process these withdrawals immediately${colors.reset}`);
    }
    
    if (pendingWithdrawals.length > 0) {
      console.log(`   ${colors.blue}📋 ${pendingWithdrawals.length} pending withdrawal(s) need admin review${colors.reset}`);
      console.log(`   ${colors.blue}👉 Check Lenco API status for these transactions${colors.reset}`);
    }
    
    if (referralData && (referralData.pendingWithdrawals || 0) > 0) {
      console.log(`   ${colors.yellow}💰 User has ${formatCurrency(referralData.pendingWithdrawals)} in pending withdrawals${colors.reset}`);
      console.log(`   ${colors.yellow}👉 Verify these amounts match actual withdrawal requests${colors.reset}`);
    }

    // Generate audit summary
    console.log(`\n${colors.magenta}${colors.bright}📋 AUDIT SUMMARY:${colors.reset}`);
    console.log(`   User: ${user.name} (${user.email})`);
    console.log(`   Total Withdrawals: ${allWithdrawals.length}`);
    console.log(`   Pending Amount: ${formatCurrency(referralData?.pendingWithdrawals || 0)}`);
    console.log(`   Available Balance: ${formatCurrency((referralData?.totalEarnings || 0) - (referralData?.totalWithdrawn || 0) - (referralData?.pendingWithdrawals || 0) - (referralData?.processingWithdrawals || 0))}`);
    console.log(`   Last Activity: ${allWithdrawals.length > 0 ? formatDate(allWithdrawals[0].createdAt) : 'No withdrawals'}`);
    console.log(`   Audit Status: ${oldPendingWithdrawals.length > 0 ? `${colors.red}REQUIRES ATTENTION${colors.reset}` : `${colors.green}OK${colors.reset}`}`);

  } catch (error) {
    console.error(`${colors.red}❌ Audit failed:${colors.reset}`, error.message);
  } finally {
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
      console.log(`\n${colors.yellow}🔌 Database connection closed${colors.reset}`);
    }
  }
}

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {};
  
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    const value = args[i + 1];
    
    switch (key) {
      case '--email': options.email = value; break;
      case '--name': options.name = value; break;
      case '--username': options.username = value; break;
      case '--id': options.id = value; break;
      default: console.log(`${colors.yellow}Unknown parameter: ${key}${colors.reset}`); break;
    }
  }
  
  return options;
}

// Show usage
function showUsage() {
  console.log(`${colors.cyan}${colors.bright}User Balance & Withdrawal Audit Tool${colors.reset}`);
  console.log(`${colors.cyan}Usage:${colors.reset}`);
  console.log('  node auditUser.js --email user@example.com');
  console.log('  node auditUser.js --name "Iprete Johnson O."');
  console.log('  node auditUser.js --username "Ipresino"');
  console.log('  node auditUser.js --id 65a5b8c9d1e2f3g4h5i6j7k8');
  console.log(`\n${colors.yellow}For the reported case:${colors.reset}`);
  console.log('  node auditUser.js --name "Iprete Johnson O."');
  console.log('  node auditUser.js --username "Ipresino"');
}

// Main execution
const options = parseArgs();

if (!options.email && !options.name && !options.username && !options.id) {
  showUsage();
  process.exit(1);
}

// Special handling for the reported case
if (!options.email && !options.name && !options.username && !options.id) {
  console.log(`${colors.cyan}Running audit for reported case: Iprete Johnson O. (@Ipresino)${colors.reset}\n`);
  options.name = "Iprete Johnson O.";
}

auditUser(options).then(() => {
  console.log(`\n${colors.green}✅ Audit completed successfully${colors.reset}`);
  process.exit(0);
}).catch((error) => {
  console.error(`${colors.red}💥 Audit failed:${colors.reset}`, error.message);
  process.exit(1);
});

module.exports = { auditUser };