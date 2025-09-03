#!/usr/bin/env node

/**
 * Fix User Balance Discrepancy Script
 * Reverses phantom pending withdrawals and corrects referral balance
 * 
 * Usage:
 * node fixUserBalance.js --email iprestyno100@gmail.com --amount 160000 --confirm
 * node fixUserBalance.js --id 67ed72fa66d6c39624415709 --amount 160000 --confirm
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
  type: { type: String, enum: ['earning', 'withdrawal', 'bonus', 'penalty', 'correction'] },
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
async function fixUserBalanceDiscrepancy(searchCriteria, amountToFix, confirm) {
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
      user = await User.findOne({ email: searchCriteria.email });
    } else if (searchCriteria.id) {
      if (mongoose.Types.ObjectId.isValid(searchCriteria.id)) {
        user = await User.findById(searchCriteria.id);
      } else {
        console.error(`${colors.red}❌ Invalid user ID format${colors.reset}`);
        return;
      }
    }

    if (!user) {
      console.error(`${colors.red}❌ User not found${colors.reset}`);
      return;
    }

    console.log(`${colors.green}✅ Found user: ${user.name} (${user.email})${colors.reset}`);
    console.log(`${colors.blue}🆔 User ID: ${user._id}${colors.reset}\n`);

    // Get current referral data
    const referralData = await Referral.findOne({ user: user._id });
    if (!referralData) {
      console.error(`${colors.red}❌ No referral data found for this user${colors.reset}`);
      return;
    }

    // Get actual pending withdrawals
    const actualPendingWithdrawals = await Withdrawal.find({
      user: user._id,
      status: { $in: ['pending', 'processing'] }
    });

    const actualPendingAmount = actualPendingWithdrawals.reduce((sum, w) => sum + w.amount, 0);

    // Display current state
    console.log(`${colors.magenta}${colors.bright}📊 CURRENT BALANCE STATE:${colors.reset}`);
    console.log(`   Total Earnings: ${formatCurrency(referralData.totalEarnings || 0)}`);
    console.log(`   Total Withdrawn: ${formatCurrency(referralData.totalWithdrawn || 0)}`);
    console.log(`   Pending Withdrawals (DB): ${formatCurrency(referralData.pendingWithdrawals || 0)}`);
    console.log(`   Processing Withdrawals (DB): ${formatCurrency(referralData.processingWithdrawals || 0)}`);
    console.log(`   Actual Pending/Processing: ${formatCurrency(actualPendingAmount)}`);
    
    const currentAvailable = (referralData.totalEarnings || 0) - 
                            (referralData.totalWithdrawn || 0) - 
                            (referralData.pendingWithdrawals || 0) - 
                            (referralData.processingWithdrawals || 0);
    console.log(`   Current Available Balance: ${formatCurrency(currentAvailable)}`);

    // Identify discrepancy
    const discrepancy = (referralData.pendingWithdrawals || 0) - actualPendingAmount;
    console.log(`\n${colors.yellow}${colors.bright}🔍 DISCREPANCY ANALYSIS:${colors.reset}`);
    console.log(`   Database Pending: ${formatCurrency(referralData.pendingWithdrawals || 0)}`);
    console.log(`   Actual Pending: ${formatCurrency(actualPendingAmount)}`);
    console.log(`   Discrepancy: ${formatCurrency(discrepancy)}`);

    if (Math.abs(discrepancy) < 0.01) {
      console.log(`${colors.green}✅ No discrepancy found. Balances are already correct.${colors.reset}`);
      return;
    }

    if (amountToFix && Math.abs(discrepancy - amountToFix) > 0.01) {
      console.log(`${colors.red}❌ Specified amount ${formatCurrency(amountToFix)} doesn't match discrepancy ${formatCurrency(discrepancy)}${colors.reset}`);
      console.log(`${colors.yellow}💡 Use --amount ${discrepancy} to fix the actual discrepancy${colors.reset}`);
      return;
    }

    const fixAmount = amountToFix || discrepancy;

    // Show what will be changed
    console.log(`\n${colors.blue}${colors.bright}🔧 PROPOSED CORRECTION:${colors.reset}`);
    console.log(`   Action: Reverse phantom pending withdrawal`);
    console.log(`   Amount to correct: ${formatCurrency(fixAmount)}`);
    console.log(`   Current Pending Withdrawals: ${formatCurrency(referralData.pendingWithdrawals || 0)}`);
    console.log(`   New Pending Withdrawals: ${formatCurrency((referralData.pendingWithdrawals || 0) - fixAmount)}`);
    console.log(`   Current Available Balance: ${formatCurrency(currentAvailable)}`);
    console.log(`   New Available Balance: ${formatCurrency(currentAvailable + fixAmount)}`);

    // Safety check - require confirmation
    if (!confirm) {
      console.log(`\n${colors.yellow}${colors.bright}⚠️  DRY RUN MODE${colors.reset}`);
      console.log(`${colors.yellow}This is a preview. No changes have been made.${colors.reset}`);
      console.log(`${colors.cyan}To apply these changes, add --confirm flag:${colors.reset}`);
      console.log(`node fixUserBalance.js --email ${user.email} --amount ${fixAmount} --confirm`);
      return;
    }

    // Confirm action
    console.log(`\n${colors.red}${colors.bright}⚠️  CONFIRMATION REQUIRED${colors.reset}`);
    console.log(`${colors.red}You are about to modify user balance data!${colors.reset}`);
    console.log(`${colors.yellow}User: ${user.name} (${user.email})${colors.reset}`);
    console.log(`${colors.yellow}Amount: ${formatCurrency(fixAmount)}${colors.reset}`);
    console.log(`${colors.yellow}Action: Reverse phantom pending withdrawal${colors.reset}`);

    // Start transaction
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      console.log(`\n${colors.blue}🔄 Applying corrections...${colors.reset}`);

      // Update referral balance
      const updateResult = await Referral.findOneAndUpdate(
        { user: user._id },
        {
          $inc: {
            pendingWithdrawals: -fixAmount  // Remove from pending withdrawals
            // The amount automatically becomes available again
          }
        },
        { session, new: true }
      );

      if (!updateResult) {
        throw new Error('Failed to update referral balance');
      }

      // Create a correction transaction record
      const correctionTransaction = new ReferralTransaction({
        user: user._id,
        type: 'correction',
        amount: fixAmount,
        description: `Balance correction: Reversed phantom pending withdrawal of ${formatCurrency(fixAmount)}`,
        status: 'completed',
        reference: `BALANCE_CORRECTION_${Date.now()}`
      });

      await correctionTransaction.save({ session });

      // Commit transaction
      await session.commitTransaction();
      session.endSession();

      console.log(`${colors.green}✅ Correction applied successfully!${colors.reset}`);

      // Show updated balances
      const updatedReferralData = await Referral.findOne({ user: user._id });
      const newAvailableBalance = (updatedReferralData.totalEarnings || 0) - 
                                 (updatedReferralData.totalWithdrawn || 0) - 
                                 (updatedReferralData.pendingWithdrawals || 0) - 
                                 (updatedReferralData.processingWithdrawals || 0);

      console.log(`\n${colors.green}${colors.bright}✅ UPDATED BALANCE STATE:${colors.reset}`);
      console.log(`   Total Earnings: ${formatCurrency(updatedReferralData.totalEarnings || 0)}`);
      console.log(`   Total Withdrawn: ${formatCurrency(updatedReferralData.totalWithdrawn || 0)}`);
      console.log(`   Pending Withdrawals: ${formatCurrency(updatedReferralData.pendingWithdrawals || 0)}`);
      console.log(`   Processing Withdrawals: ${formatCurrency(updatedReferralData.processingWithdrawals || 0)}`);
      console.log(`   Available Balance: ${formatCurrency(newAvailableBalance)}`);

      console.log(`\n${colors.cyan}📝 CORRECTION SUMMARY:${colors.reset}`);
      console.log(`   User: ${user.name}`);
      console.log(`   Amount Corrected: ${formatCurrency(fixAmount)}`);
      console.log(`   Balance Increase: ${formatCurrency(fixAmount)}`);
      console.log(`   New Available Balance: ${formatCurrency(newAvailableBalance)}`);
      console.log(`   Correction Reference: ${correctionTransaction.reference}`);
      console.log(`   Timestamp: ${formatDate(new Date())}`);

      console.log(`\n${colors.green}${colors.bright}🎯 CORRECTION COMPLETED SUCCESSFULLY${colors.reset}`);
      console.log(`${colors.blue}The user can now make new withdrawals with their corrected balance.${colors.reset}`);

    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      throw error;
    }

  } catch (error) {
    console.error(`${colors.red}❌ Balance correction failed:${colors.reset}`, error.message);
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
  const options = {
    searchCriteria: {},
    amount: null,
    confirm: false
  };
  
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    const value = args[i + 1];
    
    switch (key) {
      case '--email':
        options.searchCriteria.email = value;
        break;
      case '--id':
        options.searchCriteria.id = value;
        break;
      case '--amount':
        options.amount = parseFloat(value);
        break;
      case '--confirm':
        options.confirm = true;
        i--; // --confirm doesn't have a value
        break;
      default:
        if (key === '--confirm') {
          options.confirm = true;
          i--;
        } else {
          console.log(`${colors.yellow}Unknown parameter: ${key}${colors.reset}`);
        }
        break;
    }
  }
  
  return options;
}

// Show usage
function showUsage() {
  console.log(`${colors.cyan}${colors.bright}User Balance Correction Tool${colors.reset}`);
  console.log(`${colors.yellow}Fixes discrepancies between referral balance and actual withdrawal records${colors.reset}\n`);
  console.log(`${colors.cyan}Usage:${colors.reset}`);
  console.log('  node fixUserBalance.js --email user@example.com [--amount AMOUNT] [--confirm]');
  console.log('  node fixUserBalance.js --id USER_ID [--amount AMOUNT] [--confirm]');
  console.log(`\n${colors.yellow}For Iprete Johnson O. case:${colors.reset}`);
  console.log('  node fixUserBalance.js --email iprestyno100@gmail.com --amount 160000 --confirm');
  console.log('  node fixUserBalance.js --id 67ed72fa66d6c39624415709 --amount 160000 --confirm');
  console.log(`\n${colors.cyan}Parameters:${colors.reset}`);
  console.log('  --email    User email address');
  console.log('  --id       User MongoDB ObjectId');
  console.log('  --amount   Specific amount to correct (optional - auto-detected if not provided)');
  console.log('  --confirm  Apply changes (without this flag, shows preview only)');
  console.log(`\n${colors.red}Warning: Always run without --confirm first to preview changes!${colors.reset}`);
}

// Main execution
const options = parseArgs();

if (!options.searchCriteria.email && !options.searchCriteria.id) {
  showUsage();
  process.exit(1);
}

fixUserBalanceDiscrepancy(options.searchCriteria, options.amount, options.confirm).then(() => {
  console.log(`\n${colors.green}✅ Script completed successfully${colors.reset}`);
  process.exit(0);
}).catch((error) => {
  console.error(`${colors.red}💥 Script failed:${colors.reset}`, error.message);
  process.exit(1);
});

module.exports = { fixUserBalanceDiscrepancy };