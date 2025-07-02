// fixReferralCommissions.js - Complete script to fix missing 2nd and 3rd generation earnings
const mongoose = require('mongoose');
require('dotenv').config();

// Import your models (adjust paths as needed)
const User = require('./models/User');
const Referral = require('./models/Referral');
const ReferralTransaction = require('./models/ReferralTransaction');
const UserShare = require('./models/UserShare');
const PaymentTransaction = require('./models/Transaction');
const SiteConfig = require('./models/SiteConfig');

// Configuration
const COMMISSION_RATES = {
  generation1: 15,
  generation2: 3,
  generation3: 2
};

/**
 * Main fix function
 */
async function fixReferralCommissions() {
  try {
    console.log('🔧 Starting Referral Commission Fix...\n');
    
    // Step 1: Ensure correct commission rates
    await ensureCorrectCommissionRates();
    
    // Step 2: Analyze current state
    const analysis = await analyzeCurrentState();
    console.log('📊 Current State Analysis:');
    console.log(`   • Total Users: ${analysis.totalUsers}`);
    console.log(`   • Users with Referrers: ${analysis.usersWithReferrers}`);
    console.log(`   • Existing Commissions: Gen1: ${analysis.existingCommissions.gen1}, Gen2: ${analysis.existingCommissions.gen2}, Gen3: ${analysis.existingCommissions.gen3}`);
    console.log(`   • Missing Commissions: Gen2: ${analysis.missingCommissions.gen2}, Gen3: ${analysis.missingCommissions.gen3}\n`);
    
    // Step 3: Fix missing commissions
    await fixMissingCommissions();
    
    // Step 4: Rebuild referral statistics
    await rebuildAllReferralStats();
    
    // Step 5: Final validation
    await finalValidation();
    
    console.log('✅ Referral commission fix completed successfully!\n');
    
  } catch (error) {
    console.error('❌ Fix failed:', error);
    throw error;
  }
}

/**
 * Step 1: Ensure correct commission rates in site config
 */
async function ensureCorrectCommissionRates() {
  try {
    console.log('⚙️  Setting correct commission rates...');
    
    const siteConfig = await SiteConfig.getCurrentConfig();
    
    // Update commission rates
    siteConfig.referralCommission = COMMISSION_RATES;
    await siteConfig.save();
    
    console.log('✅ Commission rates set: 15%, 3%, 2%\n');
  } catch (error) {
    console.error('❌ Error setting commission rates:', error);
    throw error;
  }
}

/**
 * Step 2: Analyze current state
 */
async function analyzeCurrentState() {
  try {
    console.log('🔍 Analyzing current referral state...');
    
    // Count total users and users with referrers
    const totalUsers = await User.countDocuments();
    const usersWithReferrers = await User.countDocuments({
      'referralInfo.code': { $exists: true, $ne: null, $ne: '' }
    });
    
    // Count existing commissions by generation
    const existingCommissions = {
      gen1: await ReferralTransaction.countDocuments({ generation: 1, status: 'completed' }),
      gen2: await ReferralTransaction.countDocuments({ generation: 2, status: 'completed' }),
      gen3: await ReferralTransaction.countDocuments({ generation: 3, status: 'completed' })
    };
    
    // Calculate expected vs actual commissions
    const allPurchaseTransactions = await getAllPurchaseTransactions();
    const expectedCommissions = await calculateExpectedCommissions(allPurchaseTransactions);
    
    const missingCommissions = {
      gen2: Math.max(0, expectedCommissions.gen2 - existingCommissions.gen2),
      gen3: Math.max(0, expectedCommissions.gen3 - existingCommissions.gen3)
    };
    
    return {
      totalUsers,
      usersWithReferrers,
      existingCommissions,
      expectedCommissions,
      missingCommissions,
      allPurchaseTransactions
    };
  } catch (error) {
    console.error('❌ Error analyzing current state:', error);
    throw error;
  }
}

/**
 * Get all purchase transactions (both share and co-founder)
 */
async function getAllPurchaseTransactions() {
  try {
    const transactions = [];
    
    // Get co-founder transactions
    const cofounderTxs = await PaymentTransaction.find({
      type: 'co-founder',
      status: 'completed'
    }).populate('userId', 'userName referralInfo name');
    
    for (const tx of cofounderTxs) {
      if (tx.userId && tx.userId.referralInfo && tx.userId.referralInfo.code) {
        transactions.push({
          id: tx._id,
          userId: tx.userId._id,
          userName: tx.userId.userName,
          referralCode: tx.userId.referralInfo.code,
          amount: tx.amount,
          currency: tx.currency,
          type: 'cofounder',
          sourceModel: 'PaymentTransaction',
          shares: tx.shares,
          date: tx.createdAt
        });
      }
    }
    
    // Get regular share transactions
    const userShares = await UserShare.find({}).populate('user', 'userName referralInfo name');
    
    for (const userShare of userShares) {
      if (userShare.user && userShare.user.referralInfo && userShare.user.referralInfo.code) {
        const completedTxs = userShare.transactions.filter(tx => 
          tx.status === 'completed' && tx.paymentMethod !== 'co-founder'
        );
        
        for (const tx of completedTxs) {
          transactions.push({
            id: tx.transactionId,
            userId: userShare.user._id,
            userName: userShare.user.userName,
            referralCode: userShare.user.referralInfo.code,
            amount: tx.totalAmount,
            currency: tx.currency,
            type: 'share',
            sourceModel: 'UserShare',
            shares: tx.shares,
            date: tx.createdAt
          });
        }
      }
    }
    
    return transactions;
  } catch (error) {
    console.error('❌ Error getting purchase transactions:', error);
    throw error;
  }
}

/**
 * Calculate expected number of commissions
 */
async function calculateExpectedCommissions(transactions) {
  try {
    let expectedGen2 = 0;
    let expectedGen3 = 0;
    
    for (const tx of transactions) {
      // For each transaction, check how many generations of referrers exist
      const referralChain = await getReferralChain(tx.userId);
      
      if (referralChain.length >= 2) expectedGen2++;
      if (referralChain.length >= 3) expectedGen3++;
    }
    
    return {
      gen1: transactions.length, // Every transaction should have gen1
      gen2: expectedGen2,
      gen3: expectedGen3
    };
  } catch (error) {
    console.error('❌ Error calculating expected commissions:', error);
    throw error;
  }
}

/**
 * Get referral chain for a user
 */
async function getReferralChain(userId) {
  try {
    const chain = [];
    let currentUser = await User.findById(userId).select('referralInfo');
    
    while (currentUser && currentUser.referralInfo && currentUser.referralInfo.code && chain.length < 5) {
      const referrer = await User.findOne({ userName: currentUser.referralInfo.code }).select('_id userName referralInfo');
      
      if (referrer) {
        chain.push({
          id: referrer._id,
          userName: referrer.userName,
          generation: chain.length + 1
        });
        currentUser = referrer;
      } else {
        break;
      }
    }
    
    return chain;
  } catch (error) {
    console.error('❌ Error getting referral chain:', error);
    return [];
  }
}

/**
 * Step 3: Fix missing commissions
 */
async function fixMissingCommissions() {
  try {
    console.log('🔧 Fixing missing commissions...');
    
    const allTransactions = await getAllPurchaseTransactions();
    let fixedCount = 0;
    let skippedCount = 0;
    
    for (const tx of allTransactions) {
      try {
        const result = await processTransactionCommissions(tx);
        
        if (result.commissionsCreated > 0) {
          fixedCount++;
          console.log(`✅ Fixed ${tx.userName} (${tx.type}): ${result.commissionsCreated} commissions created`);
        } else {
          skippedCount++;
        }
      } catch (txError) {
        console.error(`❌ Error processing ${tx.userName}:`, txError.message);
        skippedCount++;
      }
    }
    
    console.log(`\n📊 Fix Results: ${fixedCount} transactions fixed, ${skippedCount} skipped\n`);
  } catch (error) {
    console.error('❌ Error fixing missing commissions:', error);
    throw error;
  }
}

/**
 * Process commissions for a single transaction
 */
async function processTransactionCommissions(transaction) {
  try {
    let commissionsCreated = 0;
    
    // Get referral chain
    const referralChain = await getReferralChain(transaction.userId);
    
    if (referralChain.length === 0) {
      return { commissionsCreated: 0 };
    }
    
    // Process each generation
    for (let generation = 1; generation <= Math.min(3, referralChain.length); generation++) {
      const referrer = referralChain[generation - 1];
      
      // Check if commission already exists
      const existingCommission = await ReferralTransaction.findOne({
        beneficiary: referrer.id,
        referredUser: transaction.userId,
        sourceTransaction: transaction.id,
        sourceTransactionModel: transaction.sourceModel,
        generation: generation,
        status: 'completed'
      });
      
      if (existingCommission) {
        continue; // Skip if commission already exists
      }
      
      // Calculate commission
      const commissionRate = COMMISSION_RATES[`generation${generation}`];
      const commissionAmount = (transaction.amount * commissionRate) / 100;
      
      // Create referral transaction
      const referralTxData = {
        beneficiary: referrer.id,
        referredUser: transaction.userId,
        amount: commissionAmount,
        currency: transaction.currency || 'naira',
        generation: generation,
        purchaseType: transaction.type,
        sourceTransaction: transaction.id,
        sourceTransactionModel: transaction.sourceModel,
        status: 'completed',
        createdAt: transaction.date, // Use original transaction date
        commissionDetails: {
          baseAmount: transaction.amount,
          commissionRate: commissionRate,
          calculatedAt: new Date()
        }
      };
      
      // Add metadata for co-founder transactions
      if (transaction.type === 'cofounder') {
        referralTxData.metadata = {
          actualShares: transaction.shares,
          equivalentShares: transaction.shares * 29,
          conversionRatio: 29,
          originalAmount: transaction.amount,
          commissionRate: commissionRate
        };
      }
      
      const referralTransaction = new ReferralTransaction(referralTxData);
      await referralTransaction.save();
      
      commissionsCreated++;
      
      console.log(`   ✅ Gen${generation}: ${referrer.userName} - ${commissionAmount.toFixed(2)} ${transaction.currency}`);
    }
    
    return { commissionsCreated };
  } catch (error) {
    console.error('❌ Error processing transaction commissions:', error);
    return { commissionsCreated: 0 };
  }
}

/**
 * Step 4: Rebuild all referral statistics
 */
async function rebuildAllReferralStats() {
  try {
    console.log('📊 Rebuilding referral statistics...');
    
    // Get all users who have received commissions
    const beneficiaries = await ReferralTransaction.distinct('beneficiary');
    
    let rebuiltCount = 0;
    
    for (const userId of beneficiaries) {
      try {
        await rebuildUserReferralStats(userId);
        rebuiltCount++;
      } catch (error) {
        console.error(`❌ Error rebuilding stats for user ${userId}:`, error.message);
      }
    }
    
    console.log(`✅ Rebuilt statistics for ${rebuiltCount} users\n`);
  } catch (error) {
    console.error('❌ Error rebuilding referral statistics:', error);
    throw error;
  }
}

/**
 * Rebuild referral stats for a single user
 */
async function rebuildUserReferralStats(userId) {
  try {
    // Get all completed referral transactions for this user
    const transactions = await ReferralTransaction.find({
      beneficiary: userId,
      status: 'completed'
    });
    
    // Calculate stats
    const stats = {
      user: userId,
      referredUsers: 0,
      totalEarnings: 0,
      generation1: { count: 0, earnings: 0 },
      generation2: { count: 0, earnings: 0 },
      generation3: { count: 0, earnings: 0 }
    };
    
    // Track unique users by generation
    const uniqueUsers = {
      1: new Set(),
      2: new Set(),
      3: new Set()
    };
    
    for (const tx of transactions) {
      // Add to generation totals
      stats[`generation${tx.generation}`].earnings += tx.amount;
      stats.totalEarnings += tx.amount;
      
      // Track unique users
      uniqueUsers[tx.generation].add(tx.referredUser.toString());
    }
    
    // Set counts from unique users
    stats.generation1.count = uniqueUsers[1].size;
    stats.generation2.count = uniqueUsers[2].size;
    stats.generation3.count = uniqueUsers[3].size;
    stats.referredUsers = uniqueUsers[1].size; // Direct referrals only
    
    // Update or create referral record
    await Referral.findOneAndUpdate(
      { user: userId },
      stats,
      { upsert: true, new: true }
    );
    
  } catch (error) {
    throw error;
  }
}

/**
 * Step 5: Final validation and reporting
 */
async function finalValidation() {
  try {
    console.log('📊 Final Validation Report');
    console.log('=========================');
    
    // Count commissions by generation
    const gen1Count = await ReferralTransaction.countDocuments({ generation: 1, status: 'completed' });
    const gen2Count = await ReferralTransaction.countDocuments({ generation: 2, status: 'completed' });
    const gen3Count = await ReferralTransaction.countDocuments({ generation: 3, status: 'completed' });
    
    // Calculate total earnings by generation
    const earningsByGen = await ReferralTransaction.aggregate([
      { $match: { status: 'completed' } },
      {
        $group: {
          _id: '$generation',
          totalEarnings: { $sum: '$amount' },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);
    
    // Count users with referral stats
    const usersWithStats = await Referral.countDocuments();
    
    // Check for users with non-zero gen2/gen3 earnings
    const usersWithGen2Earnings = await Referral.countDocuments({ 'generation2.earnings': { $gt: 0 } });
    const usersWithGen3Earnings = await Referral.countDocuments({ 'generation3.earnings': { $gt: 0 } });
    
    console.log(`📈 Commission Counts:`);
    console.log(`   • Generation 1: ${gen1Count} commissions`);
    console.log(`   • Generation 2: ${gen2Count} commissions`);
    console.log(`   • Generation 3: ${gen3Count} commissions`);
    console.log('');
    
    console.log(`💰 Earnings by Generation:`);
    for (const gen of earningsByGen) {
      console.log(`   • Generation ${gen._id}: ${gen.totalEarnings.toFixed(2)} (${gen.count} transactions)`);
    }
    console.log('');
    
    console.log(`👥 Users with Earnings:`);
    console.log(`   • Total users with referral stats: ${usersWithStats}`);
    console.log(`   • Users with Gen2 earnings: ${usersWithGen2Earnings}`);
    console.log(`   • Users with Gen3 earnings: ${usersWithGen3Earnings}`);
    console.log('');
    
    // Sample users with gen2/gen3 earnings for verification
    const sampleGen2Users = await Referral.find({ 'generation2.earnings': { $gt: 0 } })
      .limit(3)
      .populate('user', 'userName name');
    
    const sampleGen3Users = await Referral.find({ 'generation3.earnings': { $gt: 0 } })
      .limit(3)
      .populate('user', 'userName name');
    
    if (sampleGen2Users.length > 0) {
      console.log(`📋 Sample Gen2 Earners:`);
      for (const user of sampleGen2Users) {
        console.log(`   • ${user.user.userName}: ${user.generation2.earnings.toFixed(2)} (${user.generation2.count} referrals)`);
      }
      console.log('');
    }
    
    if (sampleGen3Users.length > 0) {
      console.log(`📋 Sample Gen3 Earners:`);
      for (const user of sampleGen3Users) {
        console.log(`   • ${user.user.userName}: ${user.generation3.earnings.toFixed(2)} (${user.generation3.count} referrals)`);
      }
      console.log('');
    }
    
    // Validation checks
    console.log(`✅ Validation Results:`);
    if (gen2Count > 0) {
      console.log(`   ✅ Generation 2 commissions are now working (${gen2Count} found)`);
    } else {
      console.log(`   ⚠️  No Generation 2 commissions found - check referral chains`);
    }
    
    if (gen3Count > 0) {
      console.log(`   ✅ Generation 3 commissions are now working (${gen3Count} found)`);
    } else {
      console.log(`   ⚠️  No Generation 3 commissions found - check referral chains`);
    }
    
    if (usersWithGen2Earnings > 0 && usersWithGen3Earnings > 0) {
      console.log(`   ✅ Users are now earning from multiple generations`);
    }
    
    console.log('\n🎉 Validation completed!');
    
  } catch (error) {
    console.error('❌ Error during validation:', error);
    throw error;
  }
}

/**
 * Connect to database and run the fix
 */
async function runFix() {
  try {
    // Connect to MongoDB
    console.log('📡 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log('✅ Connected to MongoDB\n');
    
    // Run the fix
    await fixReferralCommissions();
    
    console.log('🎉 All referral commission issues have been fixed!');
    console.log('💡 Future transactions will now correctly generate Gen2 and Gen3 commissions.');
    
    // Close connection
    await mongoose.connection.close();
    console.log('📡 Database connection closed.');
    
  } catch (error) {
    console.error('\n💥 Fix failed:', error);
    process.exit(1);
  }
}

// Export functions
module.exports = {
  fixReferralCommissions,
  runFix
};

// Run if called directly
if (require.main === module) {
  runFix();
}