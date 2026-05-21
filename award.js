#!/usr/bin/env node

const mongoose = require('mongoose');
require('dotenv').config();

// Import the models
const User = require('./models/User');
const Referral = require('./models/Referral');
const ReferralTransaction = require('./models/ReferralTransaction');

const args = process.argv.slice(2);

if (args.length < 2) {
  console.log('\n=== Award Withdrawable Earnings CLI ===');
  console.log('\nUsage: node award-withdrawable.js <user-email-or-id> <amount> [reason]');
  console.log('\nExamples:');
  console.log('  node award-withdrawable.js user@example.com 50000');
  console.log('  node award-withdrawable.js user@example.com 25000 "Bonus reward"');
  console.log('  node award-withdrawable.js --dry-run user@example.com 50000');
  console.log('');
  process.exit(1);
}

// Check for dry run flag
const isDryRun = args.includes('--dry-run');
const filteredArgs = args.filter(arg => arg !== '--dry-run');

const userIdentifier = filteredArgs[0];
const amount = parseFloat(filteredArgs[1]);
const reason = filteredArgs[2] || 'Admin Bonus Award';

if (isNaN(amount) || amount <= 0) {
  console.error('❌ Amount must be a positive number');
  process.exit(1);
}

if (amount > 1000000) {
  console.error('❌ Cannot award more than ₦1,000,000 at once (safety limit)');
  process.exit(1);
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

    console.log(`✅ Found user: ${user.name || user.email} (${user.email})`);

    // Find or create referral record
    let referralStats = await Referral.findOne({ user: user._id });
    
    if (!referralStats) {
      // Create new referral record if it doesn't exist
      referralStats = new Referral({
        user: user._id,
        totalEarnings: 0,
        generation1: {
          count: 0,
          earnings: 0
        },
        generation2: {
          count: 0,
          earnings: 0
        },
        generation3: {
          count: 0,
          earnings: 0
        }
      });
      console.log('📝 Creating new referral record for user');
    }

    const currentEarnings = referralStats.totalEarnings || 0;
    const newTotalEarnings = currentEarnings + amount;

    console.log('\n📋 Award Details:');
    console.log(`   User: ${user.name || user.email} (${user.email})`);
    console.log(`   Amount to award: ₦${amount.toLocaleString()}`);
    console.log(`   Current earnings: ₦${currentEarnings.toLocaleString()}`);
    console.log(`   New total earnings: ₦${newTotalEarnings.toLocaleString()}`);
    console.log(`   Reason: ${reason}`);

    if (isDryRun) {
      console.log('\n🔍 DRY RUN - No changes will be made');
      console.log('✅ Dry run completed successfully');
      return;
    }

    // Confirm before proceeding
    console.log('\n⚠️  This will permanently award withdrawable earnings to the user.');
    console.log('   Press Ctrl+C to cancel, or wait 5 seconds to continue...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Generate transaction ID
    const crypto = require('crypto');
    const transactionId = `REF-${crypto.randomBytes(4).toString('hex').toUpperCase()}-${Date.now().toString().slice(-6)}`;

    // Generate a dummy source transaction ID for admin awards
    const sourceTransactionId = `ADMIN-${crypto.randomBytes(4).toString('hex').toUpperCase()}-${Date.now().toString().slice(-6)}`;

    // Create referral transaction record
    const referralTransaction = new ReferralTransaction({
      transactionId,
      beneficiary: user._id,
      referrer: user._id, // Self-referral for admin awards
      referredUser: user._id, // Required field - self for admin awards
      sourceTransaction: sourceTransactionId, // Required field - dummy transaction for admin awards
      amount: amount,
      type: 'admin_award',
      generation: 1, // Default to generation 1
      sharesPurchased: 0,
      reason: reason,
      createdAt: new Date(),
      adminAction: true,
      adminNote: `Admin Award: ${reason}`
    });

    await referralTransaction.save();
    console.log('💰 Created referral transaction record');

    // Update referral stats
    referralStats.totalEarnings = newTotalEarnings;
    
    // Add to generation 1 earnings (you can modify this logic as needed)
    if (!referralStats.generation1) {
      referralStats.generation1 = { count: 0, earnings: 0 };
    }
    referralStats.generation1.earnings += amount;

    await referralStats.save();
    console.log('📊 Updated referral statistics');

    console.log('\n✅ Withdrawable earnings awarded successfully!');
    console.log(`   Transaction ID: ${transactionId}`);
    console.log(`   Amount awarded: ₦${amount.toLocaleString()}`);
    console.log(`   New total earnings: ₦${newTotalEarnings.toLocaleString()}`);
    console.log(`   💡 User can now withdraw these earnings`);

    // Optional: Send email notification
    try {
      const { sendEmail } = require('./utils/emailService');
      
      if (user.email) {
        await sendEmail({
          email: user.email,
          subject: 'AfriMobile - Withdrawable Earnings Added',
          html: `
            <h2>Withdrawable Earnings Added</h2>
            <p>Dear ${user.name || user.email},</p>
            <p>Great news! ₦${amount.toLocaleString()} has been added to your withdrawable earnings.</p>
            <p>Transaction Reference: ${transactionId}</p>
            <p>Amount Added: ₦${amount.toLocaleString()}</p>
            <p>Total Withdrawable Earnings: ₦${newTotalEarnings.toLocaleString()}</p>
            <p>Reason: ${reason}</p>
            <p>You can now withdraw these earnings from your account dashboard.</p>
            <p>Thank you for being part of AfriMobile!</p>
          `
        });
        console.log('📧 Email notification sent to user');
      }
    } catch (emailError) {
      console.warn('⚠️  Could not send email notification:', emailError.message);
    }

    // Show withdrawal instructions
    console.log('\n💡 Next Steps:');
    console.log('   1. User can log into their account');
    console.log('   2. Navigate to earnings/withdrawal section');
    console.log('   3. Request withdrawal of available earnings');
    console.log('   4. Provide bank account details if not already set');

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