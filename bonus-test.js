#!/usr/bin/env node

const mongoose = require('mongoose');
require('dotenv').config();

// Import the models we know exist
const User = require('./models/User');
const UserShare = require('./models/UserShare');
const Share = require('./models/Share');

const args = process.argv.slice(2);

if (args.length < 2) {
  console.log('\n=== Simple Award Shares CLI ===');
  console.log('\nUsage: node simple-award.js <user-email-or-id> <shares> [reason]');
  console.log('\nExamples:');
  console.log('  node simple-award.js user@example.com 100');
  console.log('  node simple-award.js user@example.com 50 "Bonus reward"');
  console.log('  node simple-award.js --dry-run user@example.com 100');
  console.log('');
  process.exit(1);
}

// Check for dry run flag
const isDryRun = args.includes('--dry-run');
const filteredArgs = args.filter(arg => arg !== '--dry-run');

const userIdentifier = filteredArgs[0];
const sharesAmount = parseInt(filteredArgs[1]);
const reason = filteredArgs[2] || 'CLI Award';

if (isNaN(sharesAmount) || sharesAmount <= 0) {
  console.error('❌ Shares amount must be a positive number');
  process.exit(1);
}

if (sharesAmount > 10000) {
  console.error('❌ Cannot award more than 10,000 shares at once (safety limit)');
  process.exit(1);
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

async function main() {
  try {
    // Connect to database
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Find user
    let user = null;
    
    // Try by ObjectId first
    if (mongoose.Types.ObjectId.isValid(userIdentifier)) {
      user = await User.findById(userIdentifier);
    }
    
    // Try by email if not found
    if (!user) {
      user = await User.findOne({ email: userIdentifier });
    }
    
    // Try by username if still not found
    if (!user) {
      user = await User.findOne({ userName: userIdentifier });
    }

    if (!user) {
      console.error(`❌ User not found: ${userIdentifier}`);
      process.exit(1);
    }

    console.log(`✅ Found user: ${user.name} (${user.email})`);

    // Find current user shares
    let userShare = await UserShare.findOne({ user: user._id });
    const currentShares = userShare ? userShare.totalShares : 0;
    console.log(`📊 Current shares: ${currentShares}`);

    // Get current share price
    const sharePrice = await getCurrentSharePrice();
    const totalValue = sharesAmount * sharePrice;

    console.log('\n📋 Award Details:');
    console.log(`   User: ${user.name} (${user.email})`);
    console.log(`   Shares to award: ${sharesAmount}`);
    console.log(`   Price per share: ₦${sharePrice.toLocaleString()}`);
    console.log(`   Total value: ₦${totalValue.toLocaleString()}`);
    console.log(`   Reason: ${reason}`);
    console.log(`   New total shares: ${currentShares + sharesAmount}`);

    if (isDryRun) {
      console.log('\n🔍 DRY RUN - No changes will be made');
      console.log('✅ Dry run completed successfully');
      return;
    }

    // Confirm before proceeding
    console.log('\n⚠️  This will permanently award shares to the user.');
    console.log('   Press Ctrl+C to cancel, or wait 5 seconds to continue...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Create or update UserShare
    if (!userShare) {
      userShare = new UserShare({
        user: user._id,
        totalShares: 0,
        transactions: []
      });
      console.log('📝 Creating new UserShare record');
    }

    // Generate transaction ID (using similar format to your controller)
    const crypto = require('crypto');
    const transactionId = `TXN-${crypto.randomBytes(4).toString('hex').toUpperCase()}-${Date.now().toString().slice(-6)}`;

    // Create transaction record
    const transaction = {
      transactionId,
      shares: sharesAmount,
      pricePerShare: sharePrice,
      currency: 'naira',
      totalAmount: totalValue,
      paymentMethod: 'paystack', // Use valid enum value (same as controller)
      status: 'completed',
      createdAt: new Date(),
      paymentReference: `CLI_AWARD_${Date.now()}`,
      tierBreakdown: {
        tier1: sharesAmount, // Default all to tier1 for admin actions
        tier2: 0,
        tier3: 0
      },
      adminAction: true,
      adminNote: `CLI Award: ${reason}`
    };

    // Update shares using the addShares method (similar to your controller)
    await UserShare.addShares(user._id, sharesAmount, transaction);

    // Update global share counts (similar to your controller)
    try {
      const shareConfig = await Share.getCurrentConfig();
      if (shareConfig) {
        shareConfig.sharesSold += sharesAmount;
        shareConfig.tierSales.tier1Sold += sharesAmount;
        await shareConfig.save();
        console.log('📈 Updated global share statistics');
      }
    } catch (error) {
      console.warn('⚠️  Could not update global share statistics:', error.message);
    }

    console.log('\n✅ Shares awarded successfully!');
    console.log(`   Transaction ID: ${transactionId}`);
    console.log(`   Shares awarded: ${sharesAmount}`);
    console.log(`   Total value: ₦${totalValue.toLocaleString()}`);
    console.log(`   New total shares: ${currentShares + sharesAmount}`);

    // Optional: Send email notification (if you want to enable this)
    try {
      const { sendEmail } = require('./utils/emailService');
      
      if (user.email) {
        await sendEmail({
          email: user.email,
          subject: 'AfriMobile - Shares Added to Your Account',
          html: `
            <h2>Shares Added</h2>
            <p>Dear ${user.name},</p>
            <p>We are pleased to inform you that ${sharesAmount} shares have been added to your account via CLI admin action.</p>
            <p>Transaction Reference: ${transactionId}</p>
            <p>Total Value: ₦${totalValue.toLocaleString()}</p>
            <p>Thank you for being part of AfriMobile!</p>
            <p>Reason: ${reason}</p>
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