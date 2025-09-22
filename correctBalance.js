#!/usr/bin/env node

/**
 * Balance Correction Script
 * Corrects pending withdrawal discrepancies for users
 * 
 * Usage:
 * node correctBalance.js --email abiodunelizab@gmail.com --reset-pending
 * node correctBalance.js --id 67f10ac39daa275070779fb9 --set-pending 0
 * node correctBalance.js --email user@example.com --recalculate
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

// Main correction function
async function correctUserBalance(searchCriteria, action) {
  try {
    console.log(`${colors.cyan}${colors.bright}🔧 USER BALANCE CORRECTION TOOL${colors.reset}\n`);

    // Connect to MongoDB
    const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.DATABASE_URL;
    if (!mongoUri) {
      console.error(`${colors.red}❌ No MongoDB connection string found${colors.reset}`);
      process.exit(1);
    }

    console.log(`${colors.yellow}⏳ Connecting to database...${colors.reset}`);
    await mongoose.connect(mongoUri);
    console.log(`${colors.green}✅ Connected to MongoDB${colors.reset}\n`);

    // Find user
    let user = null;
    if (searchCriteria.email) {
      user = await User.findOne({ email: new RegExp(searchCriteria.email, 'i') });
    } else if (searchCriteria.id && mongoose.Types.ObjectId.isValid(searchCriteria.id)) {
      user = await User.findById(searchCriteria.id);
    }

    if (!user) {
      console.error(`${colors.red}❌ User not found${colors.reset}`);
      return;
    }

    console.log(`${colors.green}✅ Found user: ${user.name} (${user.email})${colors.reset}`);
    console.log(`${colors.blue}🆔 User ID: ${user._id}${colors.reset}\n`);

    // Get current referral data
    let referralData = await Referral.findOne({ user: user._id });
    if (!referralData) {
      console.error(`${colors.red}❌ No referral data found for this user${colors.reset}`);
      return;
    }

    // Get actual withdrawal data
    const withdrawals = await Withdrawal.find({ user: user._id });
    const actualPending = withdrawals.filter(w => w.status === 'pending').reduce((sum, w) => sum + w.amount, 0);
    const actualProcessing = withdrawals.filter(w => w.status === 'processing').reduce((sum, w) => sum + w.amount, 0);
    const actualPaid = withdrawals.filter(w => w.status === 'paid').reduce((sum, w) => sum + w.amount, 0);

    // Show current state
    console.log(`${colors.magenta}${colors.bright}📊 CURRENT STATE:${colors.reset}`);
    console.log(`   Total Earnings: ${formatCurrency(referralData.totalEarnings || 0)}`);
    console.log(`   Total Withdrawn: ${formatCurrency(referralData.totalWithdrawn || 0)}`);
    console.log(`   DB Pending: ${formatCurrency(referralData.pendingWithdrawals || 0)}`);
    console.log(`   DB Processing: ${formatCurrency(referralData.processingWithdrawals || 0)}`);
    console.log(`   Actual Pending: ${formatCurrency(actualPending)}`);
    console.log(`   Actual Processing: ${formatCurrency(actualProcessing)}`);
    console.log(`   Actual Paid: ${formatCurrency(actualPaid)}`);
    
    const currentBalance = (referralData.totalEarnings || 0) - (referralData.totalWithdrawn || 0) - (referralData.pendingWithdrawals || 0) - (referralData.processingWithdrawals || 0);
    console.log(`   Current Available Balance: ${formatCurrency(currentBalance)}\n`);

    // Prepare update based on action
    let updateData = {};
    let description = '';

    if (action.resetPending) {
      updateData.pendingWithdrawals = 0;
      description = 'Reset pending withdrawals to ₦0';
    } else if (action.setPending !== undefined) {
      updateData.pendingWithdrawals = action.setPending;
      description = `Set pending withdrawals to ${formatCurrency(action.setPending)}`;
    } else if (action.recalculate) {
      updateData.pendingWithdrawals = actualPending;
      updateData.processingWithdrawals = actualProcessing;
      updateData.totalWithdrawn = actualPaid;
      description = 'Recalculate all balances from actual withdrawal records';
    }

    if (Object.keys(updateData).length === 0) {
      console.error(`${colors.red}❌ No action specified${colors.reset}`);
      return;
    }

    console.log(`${colors.yellow}${colors.bright}🔄 PROPOSED CHANGES:${colors.reset}`);
    console.log(`   Action: ${description}`);
    
    // Show what will change
    Object.keys(updateData).forEach(key => {
      const fieldName = key === 'pendingWithdrawals' ? 'Pending Withdrawals' :
                       key === 'processingWithdrawals' ? 'Processing Withdrawals' :
                       key === 'totalWithdrawn' ? 'Total Withdrawn' : key;
      const currentValue = referralData[key] || 0;
      const newValue = updateData[key];
      console.log(`   ${fieldName}: ${formatCurrency(currentValue)} → ${formatCurrency(newValue)}`);
    });

    const newBalance = (referralData.totalEarnings || 0) - 
                      (updateData.totalWithdrawn || referralData.totalWithdrawn || 0) - 
                      (updateData.pendingWithdrawals || referralData.pendingWithdrawals || 0) - 
                      (updateData.processingWithdrawals || referralData.processingWithdrawals || 0);
    
    console.log(`   New Available Balance: ${formatCurrency(currentBalance)} → ${formatCurrency(newBalance)}`);
    console.log(`   Balance Change: ${formatCurrency(newBalance - currentBalance)}\n`);

    // Confirm before proceeding
    if (!action.force) {
      console.log(`${colors.red}${colors.bright}⚠️  CONFIRMATION REQUIRED${colors.reset}`);
      console.log(`${colors.yellow}This will modify the user's balance records.${colors.reset}`);
      console.log(`${colors.yellow}Add --force flag to proceed with the changes.${colors.reset}\n`);
      console.log(`${colors.cyan}Example: node correctBalance.js --email ${user.email} --reset-pending --force${colors.reset}`);
      return;
    }

    // Perform the update
    console.log(`${colors.green}${colors.bright}💾 APPLYING CHANGES...${colors.reset}`);
    
    const result = await Referral.updateOne(
      { user: user._id },
      { $set: updateData }
    );

    if (result.modifiedCount > 0) {
      console.log(`${colors.green}✅ Balance correction applied successfully${colors.reset}`);
      
      // Log the correction as a referral transaction
      const correctionTransaction = new ReferralTransaction({
        user: user._id,
        type: 'bonus', // Using bonus type for corrections
        amount: newBalance - currentBalance,
        description: `Balance correction: ${description}`,
        status: 'completed',
        reference: `CORRECTION_${Date.now()}`
      });
      
      await correctionTransaction.save();
      console.log(`${colors.blue}📝 Correction logged in transaction history${colors.reset}`);

      // Show final state
      const updatedReferral = await Referral.findOne({ user: user._id });
      const finalBalance = (updatedReferral.totalEarnings || 0) - (updatedReferral.totalWithdrawn || 0) - (updatedReferral.pendingWithdrawals || 0) - (updatedReferral.processingWithdrawals || 0);
      
      console.log(`\n${colors.green}${colors.bright}🎉 CORRECTION COMPLETED${colors.reset}`);
      console.log(`   User: ${user.name} (${user.email})`);
      console.log(`   Final Available Balance: ${formatCurrency(finalBalance)}`);
      console.log(`   Pending Withdrawals: ${formatCurrency(updatedReferral.pendingWithdrawals || 0)}`);
      console.log(`   Processing Withdrawals: ${formatCurrency(updatedReferral.processingWithdrawals || 0)}`);
    } else {
      console.log(`${colors.yellow}⚠️  No changes were made (values may already be correct)${colors.reset}`);
    }

  } catch (error) {
    console.error(`${colors.red}❌ Correction failed:${colors.reset}`, error.message);
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
  const action = {};
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    switch (arg) {
      case '--email': 
        options.email = args[i + 1]; 
        i++; 
        break;
      case '--id': 
        options.id = args[i + 1]; 
        i++; 
        break;
      case '--reset-pending':
        action.resetPending = true;
        break;
      case '--set-pending':
        action.setPending = parseFloat(args[i + 1]);
        i++;
        break;
      case '--recalculate':
        action.recalculate = true;
        break;
      case '--force':
        action.force = true;
        break;
      default:
        if (arg.startsWith('--')) {
          console.log(`${colors.yellow}Unknown parameter: ${arg}${colors.reset}`);
        }
        break;
    }
  }
  
  return { options, action };
}

// Show usage
function showUsage() {
  console.log(`${colors.cyan}${colors.bright}Balance Correction Tool${colors.reset}`);
  console.log(`${colors.cyan}Usage:${colors.reset}`);
  console.log('');
  console.log(`${colors.white}Find user:${colors.reset}`);
  console.log('  --email user@example.com    Find by email');
  console.log('  --id 67f10ac39daa275070779fb9    Find by user ID');
  console.log('');
  console.log(`${colors.white}Actions:${colors.reset}`);
  console.log('  --reset-pending             Set pending withdrawals to ₦0');
  console.log('  --set-pending AMOUNT        Set pending withdrawals to specific amount');
  console.log('  --recalculate              Recalculate all balances from withdrawal records');
  console.log('');
  console.log(`${colors.white}Options:${colors.reset}`);
  console.log('  --force                    Skip confirmation and apply changes');
  console.log('');
  console.log(`${colors.green}Examples:${colors.reset}`);
  console.log('  # Preview changes (safe - no modifications)');
  console.log('  node correctBalance.js --email abiodunelizab@gmail.com --reset-pending');
  console.log('');
  console.log('  # Apply the fix (adds --force to actually make changes)');
  console.log('  node correctBalance.js --email abiodunelizab@gmail.com --reset-pending --force');
  console.log('');
  console.log('  # Set specific pending amount');
  console.log('  node correctBalance.js --email user@example.com --set-pending 15000 --force');
  console.log('');
  console.log('  # Recalculate everything from scratch');
  console.log('  node correctBalance.js --email user@example.com --recalculate --force');
}

// Main execution
const { options, action } = parseArgs();

if (!options.email && !options.id) {
  showUsage();
  process.exit(1);
}

if (!action.resetPending && action.setPending === undefined && !action.recalculate) {
  console.error(`${colors.red}❌ No action specified${colors.reset}`);
  showUsage();
  process.exit(1);
}

correctUserBalance(options, action).then(() => {
  console.log(`\n${colors.green}✅ Balance correction process completed${colors.reset}`);
  process.exit(0);
}).catch((error) => {
  console.error(`${colors.red}💥 Balance correction failed:${colors.reset}`, error.message);
  process.exit(1);
});

module.exports = { correctUserBalance };