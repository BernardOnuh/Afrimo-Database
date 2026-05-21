#!/usr/bin/env node

const mongoose = require('mongoose');
require('dotenv').config();

// Import the models we know exist
const User = require('./models/User');
const UserShare = require('./models/UserShare');
const Share = require('./models/Share');

const args = process.argv.slice(2);

if (args.length < 2) {
  console.log('\n=== Simple Remove Shares CLI ===');
  console.log('\nUsage: node simple-remove.js <user-email-or-id> <shares> [reason]');
  console.log('\nExamples:');
  console.log('  node simple-remove.js user@example.com 100');
  console.log('  node simple-remove.js user@example.com 50 "Correction for overpayment"');
  console.log('  node simple-remove.js --dry-run user@example.com 100');
  console.log('  node simple-remove.js --by-transaction TXN-ABC123-456789');
  console.log('');
  process.exit(1);
}

// Check for dry run flag
const isDryRun = args.includes('--dry-run');
const byTransaction = args.includes('--by-transaction');
const filteredArgs = args.filter(arg => arg !== '--dry-run' && arg !== '--by-transaction');

let userIdentifier, sharesAmount, reason, transactionId;

if (byTransaction) {
  transactionId = filteredArgs[0];
  reason = filteredArgs[1] || 'CLI Transaction Reversal';
} else {
  userIdentifier = filteredArgs[0];
  sharesAmount = parseInt(filteredArgs[1]);
  reason = filteredArgs[2] || 'CLI Share Removal';

  if (isNaN(sharesAmount) || sharesAmount <= 0) {
    console.error('❌ Shares amount must be a positive number');
    process.exit(1);
  }

  if (sharesAmount > 10000) {
    console.error('❌ Cannot remove more than 10,000 shares at once (safety limit)');
    process.exit(1);
  }
}

async function getCurrentSharePrice() {
  try {
    const shareConfig = await Share.getCurrentConfig();
    if (shareConfig && shareConfig.currentPrices && shareConfig.currentPrices.tier1) {
      return shareConfig.currentPrices.tier1.priceNaira || 1000;
    }
    return 1000; // Default fallback
  } catch (error) {
    console.warn('⚠️  Could not fetch current share price, using default (₦1000)');
    return 1000;
  }
}

async function findUserByTransaction(transactionId) {
  try {
    const userShare = await UserShare.findOne({
      'transactions.transactionId': transactionId
    }).populate('user');
    
    if (!userShare) {
      return null;
    }

    const transaction = userShare.transactions.find(t => t.transactionId === transactionId);
    return {
      user: userShare.user,
      userShare: userShare,
      transaction: transaction
    };
  } catch (error) {
    console.error('Error finding transaction:', error.message);
    return null;
  }
}

async function main() {
  try {
    // Connect to database
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    let user = null;
    let userShare = null;
    let originalTransaction = null;

    if (byTransaction) {
      // Find by transaction ID
      const result = await findUserByTransaction(transactionId);
      if (!result) {
        console.error(`❌ Transaction not found: ${transactionId}`);
        process.exit(1);
      }
      
      user = result.user;
      userShare = result.userShare;
      originalTransaction = result.transaction;
      sharesAmount = originalTransaction.shares;
      
      console.log(`✅ Found transaction: ${transactionId}`);
      console.log(`   User: ${user.name} (${user.email})`);
      console.log(`   Shares: ${sharesAmount}`);
      console.log(`   Original reason: ${originalTransaction.adminNote || 'N/A'}`);
      
    } else {
      // Find user by identifier
      if (mongoose.Types.ObjectId.isValid(userIdentifier)) {
        user = await User.findById(userIdentifier);
      }
      
      if (!user) {
        user = await User.findOne({ email: userIdentifier });
      }
      
      if (!user) {
        user = await User.findOne({ userName: userIdentifier });
      }

      if (!user) {
        console.error(`❌ User not found: ${userIdentifier}`);
        process.exit(1);
      }

      console.log(`✅ Found user: ${user.name} (${user.email})`);

      // Find current user shares
      userShare = await UserShare.findOne({ user: user._id });
    }

    if (!userShare) {
      console.error(`❌ No shares found for user: ${user.name}`);
      process.exit(1);
    }

    const currentShares = userShare.totalShares;
    console.log(`📊 Current shares: ${currentShares}`);

    // Check if user has enough shares to remove
    if (currentShares < sharesAmount) {
      console.error(`❌ Cannot remove ${sharesAmount} shares. User only has ${currentShares} shares.`);
      process.exit(1);
    }

    // Get current share price (or use original transaction price if available)
    let sharePrice = await getCurrentSharePrice();
    if (originalTransaction && originalTransaction.pricePerShare) {
      sharePrice = originalTransaction.pricePerShare;
      console.log(`📊 Using original transaction price: ₦${sharePrice.toLocaleString()}`);
    }

    const totalValue = sharesAmount * sharePrice;

    console.log('\n📋 Removal Details:');
    console.log(`   User: ${user.name} (${user.email})`);
    console.log(`   Shares to remove: ${sharesAmount}`);
    console.log(`   Price per share: ₦${sharePrice.toLocaleString()}`);
    console.log(`   Total value: ₦${totalValue.toLocaleString()}`);
    console.log(`   Reason: ${reason}`);
    console.log(`   New total shares: ${currentShares - sharesAmount}`);
    if (originalTransaction) {
      console.log(`   Original transaction: ${originalTransaction.transactionId}`);
    }

    if (isDryRun) {
      console.log('\n🔍 DRY RUN - No changes will be made');
      console.log('✅ Dry run completed successfully');
      return;
    }

    // Confirm before proceeding
    console.log('\n⚠️  This will permanently remove shares from the user.');
    console.log('   Press Ctrl+C to cancel, or wait 5 seconds to continue...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Generate transaction ID for the removal
    const crypto = require('crypto');
    const removalTransactionId = `RMV-${crypto.randomBytes(4).toString('hex').toUpperCase()}-${Date.now().toString().slice(-6)}`;

    // Create removal transaction record
    const removalTransaction = {
      transactionId: removalTransactionId,
      shares: -sharesAmount, // Negative for removal
      pricePerShare: sharePrice,
      currency: 'naira',
      totalAmount: -totalValue, // Negative for removal
      paymentMethod: 'paystack', // Use valid enum value (same as your award script)
      status: 'completed',
      createdAt: new Date(),
      paymentReference: `CLI_REMOVAL_${Date.now()}`,
      tierBreakdown: {
        tier1: -sharesAmount, // Negative for removal
        tier2: 0,
        tier3: 0
      },
      adminAction: true,
      adminNote: `CLI Removal: ${reason}`,
      originalTransaction: originalTransaction ? originalTransaction.transactionId : null
    };

    // Remove shares by adding negative transaction
    userShare.totalShares -= sharesAmount;
    userShare.transactions.push(removalTransaction);
    await userShare.save();

    // Update global share counts
    try {
      const shareConfig = await Share.getCurrentConfig();
      if (shareConfig) {
        shareConfig.sharesSold = Math.max(0, shareConfig.sharesSold - sharesAmount);
        shareConfig.tierSales.tier1Sold = Math.max(0, shareConfig.tierSales.tier1Sold - sharesAmount);
        await shareConfig.save();
        console.log('📉 Updated global share statistics');
      }
    } catch (error) {
      console.warn('⚠️  Could not update global share statistics:', error.message);
    }

    console.log('\n✅ Shares removed successfully!');
    console.log(`   Transaction ID: ${removalTransactionId}`);
    console.log(`   Shares removed: ${sharesAmount}`);
    console.log(`   Total value: ₦${totalValue.toLocaleString()}`);
    console.log(`   New total shares: ${currentShares - sharesAmount}`);

    // Optional: Send email notification
    try {
      const { sendEmail } = require('./utils/emailService');
      
      if (user.email) {
        await sendEmail({
          email: user.email,
          subject: 'AfriMobile - Shares Removed from Your Account',
          html: `
            <h2>Shares Removed</h2>
            <p>Dear ${user.name},</p>
            <p>We are writing to inform you that ${sharesAmount} shares have been removed from your account via admin action.</p>
            <p>Transaction Reference: ${removalTransactionId}</p>
            <p>Total Value: ₦${totalValue.toLocaleString()}</p>
            <p>Current Total Shares: ${currentShares - sharesAmount}</p>
            <p>Reason: ${reason}</p>
            ${originalTransaction ? `<p>Original Transaction: ${originalTransaction.transactionId}</p>` : ''}
            <p>If you have any questions, please contact support.</p>
            <p>Thank you for your understanding.</p>
          `
        });
        console.log('📧 Email notification sent to user');
      }
    } catch (emailError) {
      console.warn('⚠️  Could not send email notification:', emailError.message);
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    if (process.env.NODE_ENV === 'development') {
      console.error(error.stack);
    }
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    console.log('🔌 Database connection closed');
  }
}

// Handle process termination
process.on('SIGINT', async () => {
  console.log('\n\n👋 Operation cancelled by user');
  if (mongoose.connection.readyState === 1) {
    await mongoose.connection.close();
  }
  process.exit(0);
});

main();