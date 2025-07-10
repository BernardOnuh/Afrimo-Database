// EMERGENCY REFERRAL DATA RECOVERY SCRIPT
// This script will rebuild all referral data from existing transactions

const mongoose = require('mongoose');
const User = require('../models/User');
const Referral = require('../models/Referral');
const ReferralTransaction = require('../models/ReferralTransaction');
const UserShare = require('../models/UserShare');
const PaymentTransaction = require('../models/Transaction');
const SiteConfig = require('../models/SiteConfig');

/**
 * Connect to MongoDB database
 */
async function connectDB() {
  try {
    const mongoUri = process.env.MONGODB_URI || 
                     process.env.MONGO_URI || 
                     process.env.DATABASE_URL ||
                     'mongodb+srv://infoagrichainx:nfE59IWssd3kklfZ@cluster0.uvjmhm9.mongodb.net';
    
    console.log('🔗 Connecting to MongoDB...');
    await mongoose.connect(mongoUri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('✅ Connected to MongoDB');
  } catch (error) {
    console.error('❌ MongoDB connection failed:', error.message);
    process.exit(1);
  }
}

/**
 * Gracefully disconnect from MongoDB
 */
async function disconnectDB() {
  try {
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB');
  } catch (error) {
    console.error('❌ Error disconnecting from MongoDB:', error.message);
  }
}

/**
 * COMPLETE REFERRAL DATA RECOVERY
 * This function will:
 * 1. Clear all existing referral data
 * 2. Rebuild referral stats from all transactions
 * 3. Recreate referral commission records
 * 4. Fix any discrepancies
 */
async function emergencyReferralRecovery() {
  try {
    console.log('🚨 STARTING EMERGENCY REFERRAL DATA RECOVERY...');
    
    // Step 1: Get commission rates
    const siteConfig = await SiteConfig.getCurrentConfig();
    const commissionRates = siteConfig.referralCommission || {
      generation1: 15,
      generation2: 3,
      generation3: 2
    };
    
    console.log('📊 Commission rates:', commissionRates);
    
    // Step 2: Clear ALL existing referral data (fresh start)
    console.log('🧹 Clearing existing referral data...');
    await ReferralTransaction.deleteMany({});
    await Referral.deleteMany({});
    
    // Step 3: Get all users with referral codes
    const usersWithReferrers = await User.find({
      'referralInfo.code': { $exists: true, $ne: null }
    });
    
    console.log(`👥 Found ${usersWithReferrers.length} users with referrers`);
    
    const recoveryResults = {
      usersProcessed: 0,
      commissionsCreated: 0,
      totalEarningsRecovered: 0,
      errors: []
    };
    
    // Step 4: Process each user who has made purchases
    for (const user of usersWithReferrers) {
      try {
        console.log(`\n👤 Processing user: ${user.userName} (${user.email})`);
        
        // Get all completed transactions for this user
        const userShares = await UserShare.findOne({ user: user._id });
        const coFounderTransactions = await PaymentTransaction.find({
          userId: user._id,
          type: 'co-founder',
          status: 'completed'
        });
        
        let totalUserPurchases = 0;
        const allTransactions = [];
        
        // Regular share purchases
        if (userShares && userShares.transactions) {
          const completedShareTx = userShares.transactions.filter(tx => tx.status === 'completed');
          for (const tx of completedShareTx) {
            allTransactions.push({
              type: 'share',
              amount: tx.totalAmount,
              transactionId: tx.transactionId,
              date: tx.createdAt,
              shares: tx.shares
            });
            totalUserPurchases += tx.totalAmount;
          }
        }
        
        // Co-founder purchases
        for (const tx of coFounderTransactions) {
          allTransactions.push({
            type: 'cofounder',
            amount: tx.amount,
            transactionId: tx._id.toString(),
            date: tx.createdAt,
            shares: tx.shares
          });
          totalUserPurchases += tx.amount;
        }
        
        if (allTransactions.length === 0) {
          console.log(`  ⏭️  No completed transactions found for ${user.userName}`);
          continue;
        }
        
        console.log(`  💰 Found ${allTransactions.length} completed transactions totaling $${totalUserPurchases}`);
        
        // Step 5: Process referral commissions for this user's purchases
        await processUserReferralCommissions(user, allTransactions, commissionRates, recoveryResults);
        
        recoveryResults.usersProcessed++;
        
      } catch (userError) {
        console.error(`❌ Error processing user ${user.userName}:`, userError.message);
        recoveryResults.errors.push({
          user: user.userName,
          error: userError.message
        });
      }
    }
    
    // Step 6: Rebuild referral statistics for all users
    console.log('\n📈 Rebuilding referral statistics...');
    await rebuildAllReferralStats();
    
    // Step 7: Summary
    console.log('\n🎉 EMERGENCY RECOVERY COMPLETED!');
    console.log('📊 Recovery Results:', {
      usersProcessed: recoveryResults.usersProcessed,
      commissionsCreated: recoveryResults.commissionsCreated,
      totalEarningsRecovered: `$${recoveryResults.totalEarningsRecovered.toFixed(2)}`,
      errors: recoveryResults.errors.length
    });
    
    if (recoveryResults.errors.length > 0) {
      console.log('⚠️  Errors encountered:');
      recoveryResults.errors.forEach(error => {
        console.log(`  - ${error.user}: ${error.error}`);
      });
    }
    
    return recoveryResults;
    
  } catch (error) {
    console.error('💥 EMERGENCY RECOVERY FAILED:', error);
    throw error;
  }
}

/**
 * Process referral commissions for a user's transactions
 */
async function processUserReferralCommissions(user, transactions, commissionRates, results) {
  const referrerCode = user.referralInfo.code;
  
  // Find Generation 1 referrer
  const gen1Referrer = await User.findOne({ userName: referrerCode });
  if (!gen1Referrer) {
    console.log(`  ⚠️  Gen1 referrer '${referrerCode}' not found`);
    return;
  }
  
  console.log(`  🔗 Gen1 referrer: ${gen1Referrer.userName}`);
  
  // Find Generation 2 referrer
  let gen2Referrer = null;
  if (gen1Referrer.referralInfo && gen1Referrer.referralInfo.code) {
    gen2Referrer = await User.findOne({ userName: gen1Referrer.referralInfo.code });
    if (gen2Referrer) {
      console.log(`  🔗 Gen2 referrer: ${gen2Referrer.userName}`);
    }
  }
  
  // Find Generation 3 referrer
  let gen3Referrer = null;
  if (gen2Referrer && gen2Referrer.referralInfo && gen2Referrer.referralInfo.code) {
    gen3Referrer = await User.findOne({ userName: gen2Referrer.referralInfo.code });
    if (gen3Referrer) {
      console.log(`  🔗 Gen3 referrer: ${gen3Referrer.userName}`);
    }
  }
  
  // Process each transaction
  for (const transaction of transactions) {
    console.log(`    💸 Processing ${transaction.type} transaction: $${transaction.amount}`);
    
    // Generation 1 Commission
    const gen1Commission = (transaction.amount * commissionRates.generation1) / 100;
    await createReferralTransaction({
      beneficiary: gen1Referrer._id,
      referredUser: user._id,
      amount: gen1Commission,
      generation: 1,
      purchaseType: transaction.type,
      sourceTransaction: transaction.transactionId,
      metadata: {
        originalAmount: transaction.amount,
        commissionRate: commissionRates.generation1,
        shares: transaction.shares
      }
    });
    
    console.log(`      💵 Gen1 commission: $${gen1Commission.toFixed(2)} → ${gen1Referrer.userName}`);
    results.commissionsCreated++;
    results.totalEarningsRecovered += gen1Commission;
    
    // Generation 2 Commission
    if (gen2Referrer) {
      const gen2Commission = (transaction.amount * commissionRates.generation2) / 100;
      await createReferralTransaction({
        beneficiary: gen2Referrer._id,
        referredUser: user._id,
        amount: gen2Commission,
        generation: 2,
        purchaseType: transaction.type,
        sourceTransaction: transaction.transactionId,
        metadata: {
          originalAmount: transaction.amount,
          commissionRate: commissionRates.generation2,
          shares: transaction.shares
        }
      });
      
      console.log(`      💵 Gen2 commission: $${gen2Commission.toFixed(2)} → ${gen2Referrer.userName}`);
      results.commissionsCreated++;
      results.totalEarningsRecovered += gen2Commission;
    }
    
    // Generation 3 Commission
    if (gen3Referrer) {
      const gen3Commission = (transaction.amount * commissionRates.generation3) / 100;
      await createReferralTransaction({
        beneficiary: gen3Referrer._id,
        referredUser: user._id,
        amount: gen3Commission,
        generation: 3,
        purchaseType: transaction.type,
        sourceTransaction: transaction.transactionId,
        metadata: {
          originalAmount: transaction.amount,
          commissionRate: commissionRates.generation3,
          shares: transaction.shares
        }
      });
      
      console.log(`      💵 Gen3 commission: $${gen3Commission.toFixed(2)} → ${gen3Referrer.userName}`);
      results.commissionsCreated++;
      results.totalEarningsRecovered += gen3Commission;
    }
  }
}

/**
 * Create a referral transaction record
 */
async function createReferralTransaction(data) {
  const referralTx = new ReferralTransaction({
    beneficiary: data.beneficiary,
    referredUser: data.referredUser,
    amount: data.amount,
    currency: 'USD',
    generation: data.generation,
    purchaseType: data.purchaseType,
    sourceTransaction: data.sourceTransaction,
    sourceTransactionModel: data.purchaseType === 'cofounder' ? 'PaymentTransaction' : 'UserShare',
    status: 'completed',
    metadata: data.metadata,
    createdAt: new Date()
  });
  
  await referralTx.save();
}

/**
 * Rebuild referral statistics for all users
 */
async function rebuildAllReferralStats() {
  // Get all users who have earned commissions
  const beneficiaries = await ReferralTransaction.distinct('beneficiary');
  
  console.log(`📊 Rebuilding stats for ${beneficiaries.length} beneficiaries...`);
  
  for (const beneficiaryId of beneficiaries) {
    try {
      // Calculate earnings by generation
      const earnings = await ReferralTransaction.aggregate([
        {
          $match: {
            beneficiary: mongoose.Types.ObjectId(beneficiaryId),
            status: 'completed'
          }
        },
        {
          $group: {
            _id: '$generation',
            totalEarnings: { $sum: '$amount' },
            transactionCount: { $sum: 1 }
          }
        }
      ]);
      
      // Calculate referred user counts by generation
      const referredCounts = await ReferralTransaction.aggregate([
        {
          $match: {
            beneficiary: mongoose.Types.ObjectId(beneficiaryId),
            status: 'completed'
          }
        },
        {
          $group: {
            _id: {
              generation: '$generation',
              referredUser: '$referredUser'
            }
          }
        },
        {
          $group: {
            _id: '$_id.generation',
            uniqueUsers: { $sum: 1 }
          }
        }
      ]);
      
      // Create or update referral stats
      let referralStats = await Referral.findOne({ user: beneficiaryId });
      
      if (!referralStats) {
        referralStats = new Referral({
          user: beneficiaryId,
          referredUsers: 0,
          totalEarnings: 0,
          generation1: { count: 0, earnings: 0 },
          generation2: { count: 0, earnings: 0 },
          generation3: { count: 0, earnings: 0 }
        });
      }
      
      // Reset stats
      referralStats.totalEarnings = 0;
      referralStats.generation1 = { count: 0, earnings: 0 };
      referralStats.generation2 = { count: 0, earnings: 0 };
      referralStats.generation3 = { count: 0, earnings: 0 };
      
      // Apply earnings
      for (const earning of earnings) {
        referralStats.totalEarnings += earning.totalEarnings;
        referralStats[`generation${earning._id}`].earnings = earning.totalEarnings;
      }
      
      // Apply counts
      for (const count of referredCounts) {
        referralStats[`generation${count._id}`].count = count.uniqueUsers;
        
        // Direct referrals count (generation 1)
        if (count._id === 1) {
          referralStats.referredUsers = count.uniqueUsers;
        }
      }
      
      await referralStats.save();
      
      const user = await User.findById(beneficiaryId);
      console.log(`  ✅ Updated stats for ${user?.userName}: $${referralStats.totalEarnings.toFixed(2)} total earnings`);
      
    } catch (statError) {
      console.error(`❌ Error updating stats for ${beneficiaryId}:`, statError.message);
    }
  }
}

/**
 * Quick verification function to check recovery results
 */
async function verifyRecoveryResults() {
  console.log('\n🔍 VERIFYING RECOVERY RESULTS...');
  
  const totalCommissions = await ReferralTransaction.countDocuments({ status: 'completed' });
  const totalEarnings = await ReferralTransaction.aggregate([
    { $match: { status: 'completed' } },
    { $group: { _id: null, total: { $sum: '$amount' } } }
  ]);
  
  const usersWithEarnings = await Referral.countDocuments({ totalEarnings: { $gt: 0 } });
  
  console.log('✅ Verification Results:');
  console.log(`  💰 Total commission transactions: ${totalCommissions}`);
  console.log(`  💵 Total earnings distributed: $${totalEarnings[0]?.total?.toFixed(2) || 0}`);
  console.log(`  👥 Users with earnings: ${usersWithEarnings}`);
  
  // Show top earners
  const topEarners = await Referral.find({ totalEarnings: { $gt: 0 } })
    .populate('user', 'userName email')
    .sort({ totalEarnings: -1 })
    .limit(10);
  
  console.log('\n🏆 Top 10 Earners:');
  topEarners.forEach((referral, index) => {
    console.log(`  ${index + 1}. ${referral.user.userName}: $${referral.totalEarnings.toFixed(2)}`);
  });
}

/**
 * Main execution function with proper DB connection handling
 */
async function runRecoveryScript() {
  try {
    // Connect to database
    await connectDB();
    
    // Run the recovery
    const results = await emergencyReferralRecovery();
    
    // Verify results
    await verifyRecoveryResults();
    
    console.log('\n🎉 RECOVERY COMPLETED SUCCESSFULLY!');
    return results;
    
  } catch (error) {
    console.error('💥 RECOVERY FAILED:', error);
    throw error;
  } finally {
    // Always disconnect from database
    await disconnectDB();
  }
}

// Export functions for use in controller
module.exports = {
  connectDB,
  disconnectDB,
  emergencyReferralRecovery,
  verifyRecoveryResults,
  runRecoveryScript
};

// If running as standalone script
if (require.main === module) {
  runRecoveryScript()
    .then(() => {
      console.log('\n✅ Script execution completed');
      process.exit(0);
    })
    .catch(error => {
      console.error('❌ Script execution failed:', error);
      process.exit(1);
    });
}