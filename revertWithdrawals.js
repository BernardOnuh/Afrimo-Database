#!/usr/bin/env node

/**
 * WITHDRAWAL REVERSAL SCRIPT
 * Direct MongoDB script to safely revert pending/processing withdrawals
 * 
 * Usage:
 *   node revertWithdrawals.js --dryRun      (preview only)
 *   node revertWithdrawals.js --execute     (actual reversal)
 *   node revertWithdrawals.js --user=email  (single user)
 */

const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') }); // ✅ FIXED

// Models
const User = require(path.join(__dirname, 'models', 'User'));
const Withdrawal = require(path.join(__dirname, 'models', 'Withdrawal'));
const Referral = require(path.join(__dirname, 'models', 'Referral'));
const WithdrawalAuditLog = require(path.join(__dirname, 'models', 'WithdrawalAuditLog'));

// Color output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

const log = {
  error: (msg) => console.error(`${colors.red}${colors.bright}❌ ${msg}${colors.reset}`),
  success: (msg) => console.log(`${colors.green}${colors.bright}✅ ${msg}${colors.reset}`),
  info: (msg) => console.log(`${colors.blue}ℹ  ${msg}${colors.reset}`),
  warning: (msg) => console.log(`${colors.yellow}⚠  ${msg}${colors.reset}`),
  section: (msg) => console.log(`\n${colors.cyan}${colors.bright}═══════════════════════════════════${colors.reset}\n${colors.bright}${msg}${colors.reset}\n${colors.cyan}═══════════════════════════════════${colors.reset}\n`),
  table: (data) => console.table(data)
};

// Parse command line arguments
const args = process.argv.slice(2);
const isDryRun = args.includes('--dryRun') || args.includes('--dry-run');
const isExecute = args.includes('--execute');
const userIdentifier = args.find(arg => arg.startsWith('--user='))?.split('=')[1];
const skipConfirm = args.includes('--skip-confirm');

if (!isDryRun && !isExecute) {
  log.error('Please specify --dryRun or --execute');
  console.log(`
${colors.bright}Usage:${colors.reset}
  node revertWithdrawals.js --dryRun              Preview all reversals
  node revertWithdrawals.js --execute             Execute all reversals
  node revertWithdrawals.js --dryRun --user=email Preview for specific user
  node revertWithdrawals.js --execute --user=email Execute for specific user
  node revertWithdrawals.js --execute --skip-confirm Skip confirmation
  `);
  process.exit(1);
}

/**
 * Find user by ID, email, or username
 */
async function findUserByIdentifier(identifier) {
  if (mongoose.Types.ObjectId.isValid(identifier)) {
    const user = await User.findById(identifier);
    if (user) return user;
  }
  return User.findOne({
    $or: [
      { email: identifier },
      { username: identifier }
    ]
  });
}

/**
 * Get confirmation from user
 */
async function getConfirmation(message) {
  if (skipConfirm) {
    log.info('(Skipping confirmation)');
    return true;
  }

  const readline = require('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question(`${colors.yellow}${message} (yes/no): ${colors.reset}`, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'yes' || answer.toLowerCase() === 'y');
    });
  });
}

/**
 * Main reversal function
 */
async function revertWithdrawals() {
  try {
    // Connect to MongoDB
    log.section('CONNECTING TO DATABASE');
    
    if (!process.env.MONGODB_URI) {
      log.error('MONGODB_URI not set in environment variables');
      process.exit(1);
    }

    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    log.success('Connected to MongoDB');

    // Determine scope
    let query = { status: { $in: ['pending', 'processing'] } };
    let scope = 'all users';
    let targetUser = null;

    if (userIdentifier) {
      targetUser = await findUserByIdentifier(userIdentifier);
      if (!targetUser) {
        log.error(`User not found: ${userIdentifier}`);
        await mongoose.connection.close();
        process.exit(1);
      }
      query.user = targetUser._id;
      scope = `${targetUser.name} (${targetUser.email})`;
      log.success(`Found user: ${targetUser.name}`);
    }

    // Get pending withdrawals
    log.section('ANALYZING PENDING WITHDRAWALS');
    log.info(`Searching for pending/processing withdrawals for ${scope}...`);

    const withdrawals = await Withdrawal.find(query)
      .populate('user', 'name email username')
      .sort({ createdAt: 1 });

    if (withdrawals.length === 0) {
      log.success(`No pending withdrawals found for ${scope}`);
      await mongoose.connection.close();
      process.exit(0);
    }

    log.success(`Found ${withdrawals.length} pending withdrawals`);

    // Analyze data
    const analysis = {
      totalCount: withdrawals.length,
      totalAmount: withdrawals.reduce((sum, w) => sum + w.amount, 0),
      byStatus: {
        pending: withdrawals.filter(w => w.status === 'pending').length,
        processing: withdrawals.filter(w => w.status === 'processing').length
      },
      byType: {
        bank: withdrawals.filter(w => w.withdrawalType === 'bank').length,
        crypto: withdrawals.filter(w => w.withdrawalType === 'crypto').length
      },
      userRefunds: {}
    };

    // Calculate per-user refunds
    for (const w of withdrawals) {
      if (!w.user) continue;
      const uid = w.user._id.toString();
      if (!analysis.userRefunds[uid]) {
        analysis.userRefunds[uid] = {
          userId: w.user._id,
          name: w.user.name,
          email: w.user.email,
          refundAmount: 0,
          withdrawalCount: 0,
          byStatus: { pending: 0, processing: 0 }
        };
      }
      analysis.userRefunds[uid].refundAmount += w.amount;
      analysis.userRefunds[uid].withdrawalCount += 1;
      analysis.userRefunds[uid].byStatus[w.status] = (analysis.userRefunds[uid].byStatus[w.status] || 0) + 1;
    }

    // Display analysis
    console.log(`\n${colors.bright}SUMMARY:${colors.reset}`);
    console.log(`  Total Withdrawals: ${analysis.totalCount}`);
    console.log(`  Total Amount: ₦${analysis.totalAmount.toLocaleString()}`);
    console.log(`  By Status: Pending=${analysis.byStatus.pending}, Processing=${analysis.byStatus.processing}`);
    console.log(`  By Type: Bank=${analysis.byType.bank}, Crypto=${analysis.byType.crypto}`);
    console.log(`  Affected Users: ${Object.keys(analysis.userRefunds).length}`);

    // Show sample withdrawals
    log.section('SAMPLE WITHDRAWALS');
    const samples = withdrawals.slice(0, 5).map(w => ({
      id: w._id.toString().substring(0, 8) + '...',
      user: w.user?.email || 'Unknown',
      amount: `₦${w.amount.toLocaleString()}`,
      type: w.withdrawalType,
      status: w.status,
      age: Math.floor((Date.now() - w.createdAt) / (1000 * 60 * 60 * 24)) + 'd'
    }));
    log.table(samples);

    if (withdrawals.length > 5) {
      log.info(`... and ${withdrawals.length - 5} more withdrawals`);
    }

    // Show top affected users
    const topUsers = Object.values(analysis.userRefunds)
      .sort((a, b) => b.refundAmount - a.refundAmount)
      .slice(0, 5);

    if (topUsers.length > 0) {
      log.section('TOP AFFECTED USERS');
      const userTable = topUsers.map(u => ({
        name: u.name,
        email: u.email,
        refundAmount: `₦${u.refundAmount.toLocaleString()}`,
        withdrawals: u.withdrawalCount
      }));
      log.table(userTable);
    }

    // Dry run mode
    if (isDryRun) {
      log.section('DRY RUN MODE');
      log.warning('This is a preview only. No changes will be made.');
      await mongoose.connection.close();
      process.exit(0);
    }

    // Ask for confirmation
    log.section('CONFIRMATION REQUIRED');
    const confirmed = await getConfirmation(
      `${colors.red}IMPORTANT:${colors.reset} This will CANCEL ${analysis.totalCount} withdrawals and refund ₦${analysis.totalAmount.toLocaleString()}. Continue?`
    );

    if (!confirmed) {
      log.info('Reversal cancelled by user');
      await mongoose.connection.close();
      process.exit(0);
    }

    // Execute reversal
    log.section('EXECUTING REVERSAL');
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // Step 1: Update all withdrawals to cancelled
      log.info('Cancelling withdrawals...');
      const updateResult = await Withdrawal.updateMany(
        query,
        {
          $set: {
            status: 'cancelled',
            rejectionReason: 'Administrative reversal via script',
            adminNotes: `Reverted at ${new Date().toISOString()} via automated script`,
            updatedAt: new Date()
          }
        },
        { session }
      );

      log.success(`Updated ${updateResult.modifiedCount} withdrawals`);

      // Step 2: Refund amounts to users
      log.info('Refunding amounts to users...');
      let refundedUserCount = 0;

      for (const [userId, refundData] of Object.entries(analysis.userRefunds)) {
        const pendingRefund = withdrawals
          .filter(w => w.user?._id.toString() === userId && w.status === 'pending')
          .reduce((sum, w) => sum + w.amount, 0);

        const processingRefund = withdrawals
          .filter(w => w.user?._id.toString() === userId && w.status === 'processing')
          .reduce((sum, w) => sum + w.amount, 0);

        const updateObj = { $inc: {}, updatedAt: new Date() };

        if (pendingRefund > 0) {
          updateObj.$inc.pendingWithdrawals = -pendingRefund;
        }
        if (processingRefund > 0) {
          updateObj.$inc.processingWithdrawals = -processingRefund;
        }

        if (Object.keys(updateObj.$inc).length > 0) {
          await Referral.findOneAndUpdate(
            { user: userId },
            updateObj,
            { session }
          );
          refundedUserCount++;
        }
      }

      log.success(`Refunded ${refundedUserCount} users`);

      // Step 3: Create audit log
      log.info('Creating audit log entry...');
      await WithdrawalAuditLog.create(
        [{
          action: 'BULK_WITHDRAWAL_REVERSAL_SCRIPT',
          performedBy: null, // Script execution
          targetUser: userIdentifier ? targetUser._id : null,
          reason: 'Administrative reversal via automated script',
          metadata: {
            totalCancelled: analysis.totalCount,
            totalAmountRefunded: analysis.totalAmount,
            affectedUsers: Object.keys(analysis.userRefunds).length,
            executedAt: new Date(),
            scriptExecution: true
          },
          ip: null
        }],
        { session }
      );

      log.success('Audit log created');

      // Commit transaction
      await session.commitTransaction();
      session.endSession();

      log.success('Transaction committed');
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      throw error;
    }

    // Final summary
    log.section('REVERSAL COMPLETE');
    console.log(`${colors.green}${colors.bright}✅ SUCCESS!${colors.reset}`);
    console.log(`\n${colors.bright}Summary:${colors.reset}`);
    console.log(`  Withdrawals Cancelled: ${analysis.totalCount}`);
    console.log(`  Total Amount Refunded: ₦${analysis.totalAmount.toLocaleString()}`);
    console.log(`  Users Affected: ${Object.keys(analysis.userRefunds).length}`);
    console.log(`  Executed At: ${new Date().toLocaleString()}`);

    // Verify
    log.section('VERIFICATION');
    log.info('Verifying reversal...');

    const remainingPending = await Withdrawal.countDocuments({
      ...query,
      status: { $in: ['pending', 'processing'] }
    });

    const totalCancelled = await Withdrawal.countDocuments({
      ...query,
      status: 'cancelled'
    });

    console.log(`\n${colors.bright}Verification:${colors.reset}`);
    console.log(`  Remaining Pending: ${remainingPending} (should be 0)`);
    console.log(`  Total Cancelled: ${totalCancelled}`);

    if (remainingPending === 0) {
      log.success('✓ All pending withdrawals have been cancelled');
    } else {
      log.warning(`⚠ ${remainingPending} withdrawals still pending (unexpected)`);
    }

    await mongoose.connection.close();
    log.success('Database connection closed');

  } catch (error) {
    log.error('Error during reversal:');
    console.error(error);
    process.exit(1);
  }
}

// Run the script
revertWithdrawals().catch(error => {
  log.error('Fatal error:');
  console.error(error);
  process.exit(1);
});