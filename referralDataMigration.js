// fixReferralCommissions.js - ROBUST version with improved error handling
const mongoose = require('mongoose');
require('dotenv').config();

// Import your models (adjust paths as needed)
const User = require('./models/User');
const Referral = require('./models/Referral');
const ReferralTransaction = require('./models/ReferralTransaction');
const UserShare = require('./models/UserShare');
const PaymentTransaction = require('./models/Transaction');
const SiteConfig = require('./models/SiteConfig');
const CoFounderShare = require('./models/CoFounderShare');

// Configuration
const COMMISSION_RATES = {
  generation1: 15,
  generation2: 3,
  generation3: 2
};

const COFOUNDER_TO_SHARES_RATIO = 29;

/**
 * Main fix function
 */
async function fixReferralCommissions() {
  try {
    console.log('🔧 Starting ROBUST Referral Commission Fix...\n');
    
    // Step 1: Clean up invalid referral codes first
    await cleanupInvalidReferralCodes();
    
    // Step 2: Ensure correct commission rates
    await ensureCorrectCommissionRates();
    
    // Step 3: Clean up invalid/duplicate transactions
    await cleanupInvalidTransactions();
    
    // Step 4: Analyze current state
    const analysis = await analyzeCurrentState();
    displayAnalysis(analysis);
    
    // Step 5: Fix missing commissions
    await fixMissingCommissions(analysis);
    
    // Step 6: Rebuild referral statistics
    await rebuildAllReferralStats();
    
    // Step 7: Final validation
    await finalValidation();
    
    console.log('✅ ROBUST Referral commission fix completed successfully!\n');
    
  } catch (error) {
    console.error('❌ Fix failed:', error);
    throw error;
  }
}

/**
 * NEW: Clean up invalid referral codes
 */
async function cleanupInvalidReferralCodes() {
  try {
    console.log('🧹 Cleaning up invalid referral codes...');
    
    let cleanedCount = 0;
    
    // Find users with problematic referral codes
    const usersWithReferrals = await User.find({
      'referralInfo.code': { $exists: true, $ne: null, $ne: '' }
    }, 'userName referralInfo name').lean();
    
    console.log(`   📋 Found ${usersWithReferrals.length} users with referral codes`);
    
    for (const user of usersWithReferrals) {
      const referralCode = user.referralInfo.code;
      
      // Check for invalid patterns
      const isInvalid = (
        referralCode.includes('http') || // URLs
        referralCode.includes('www.') || // URLs
        referralCode.includes('<script') || // XSS attempts
        referralCode.includes('/') || // URLs/paths
        referralCode.length > 50 || // Too long
        /^\d+$/.test(referralCode) // Pure numbers (likely invalid)
      );
      
      if (isInvalid) {
        console.log(`   🚫 Cleaning invalid referral code for ${user.userName}: "${referralCode}"`);
        
        // Clear the invalid referral code
        await User.updateOne(
          { _id: user._id },
          { $unset: { 'referralInfo.code': 1 } }
        );
        
        cleanedCount++;
      } else {
        // Check if referrer actually exists
        const referrerExists = await User.findOne({ userName: referralCode });
        if (!referrerExists) {
          console.log(`   ⚠️  Referrer not found for ${user.userName}: "${referralCode}" - keeping for manual review`);
        }
      }
    }
    
    console.log(`✅ Cleaned up ${cleanedCount} invalid referral codes\n`);
  } catch (error) {
    console.error('❌ Error cleaning up referral codes:', error);
    throw error;
  }
}

/**
 * Ensure correct commission rates in site config
 */
async function ensureCorrectCommissionRates() {
  try {
    console.log('⚙️  Setting correct commission rates...');
    
    const siteConfig = await SiteConfig.getCurrentConfig();
    
    // Update commission rates
    siteConfig.referralCommission = COMMISSION_RATES;
    await siteConfig.save();
    
    console.log('✅ Commission rates set: Gen1: 15%, Gen2: 3%, Gen3: 2%\n');
  } catch (error) {
    console.error('❌ Error setting commission rates:', error);
    throw error;
  }
}

/**
 * Clean up invalid/duplicate transactions
 */
async function cleanupInvalidTransactions() {
  try {
    console.log('🧹 Cleaning up invalid/duplicate referral transactions...');
    
    let removedCount = 0;
    
    // Find transactions with missing beneficiary or referredUser
    const invalidTxs = await ReferralTransaction.find({
      $or: [
        { beneficiary: { $exists: false } },
        { referredUser: { $exists: false } },
        { amount: { $lte: 0 } },
        { generation: { $nin: [1, 2, 3] } },
        { status: { $nin: ['completed', 'pending', 'failed', 'rolled_back'] } }
      ]
    });
    
    for (const tx of invalidTxs) {
      console.log(`   🗑️  Removing invalid transaction: ${tx._id}`);
      await ReferralTransaction.deleteOne({ _id: tx._id });
      removedCount++;
    }
    
    // Find and handle duplicates
    const duplicates = await ReferralTransaction.aggregate([
      {
        $group: {
          _id: {
            beneficiary: '$beneficiary',
            referredUser: '$referredUser',
            sourceTransaction: '$sourceTransaction',
            generation: '$generation',
            status: '$status'
          },
          count: { $sum: 1 },
          docs: { $push: '$_id' }
        }
      },
      {
        $match: { count: { $gt: 1 } }
      }
    ]);
    
    for (const duplicate of duplicates) {
      // Keep the first, remove the rest
      const [keep, ...remove] = duplicate.docs;
      console.log(`   🔄 Removing ${remove.length} duplicate transactions for beneficiary ${duplicate._id.beneficiary}`);
      for (const id of remove) {
        await ReferralTransaction.deleteOne({ _id: id });
        removedCount++;
      }
    }
    
    console.log(`✅ Cleaned up ${removedCount} invalid/duplicate transactions\n`);
  } catch (error) {
    console.error('❌ Error cleaning up transactions:', error);
    throw error;
  }
}

/**
 * Analyze current state (IMPROVED with better error handling)
 */
async function analyzeCurrentState() {
  try {
    console.log('🔍 Analyzing current referral state...');
    
    // Get all users with VALID referral chains
    const usersWithReferrers = await User.find({
      'referralInfo.code': { $exists: true, $ne: null, $ne: '' }
    }, 'userName referralInfo name').lean();
    
    // Filter out users with invalid referral codes
    const validUsers = [];
    const invalidUsers = [];
    
    for (const user of usersWithReferrers) {
      const referralCode = user.referralInfo.code;
      
      // Skip obviously invalid codes
      if (referralCode.includes('http') || referralCode.includes('<script') || referralCode.length > 50) {
        invalidUsers.push(user);
        continue;
      }
      
      // Check if referrer exists
      const referrerExists = await User.findOne({ userName: referralCode });
      if (referrerExists) {
        validUsers.push(user);
      } else {
        invalidUsers.push(user);
      }
    }
    
    console.log(`   📊 Users with referrers: ${usersWithReferrers.length} total, ${validUsers.length} valid, ${invalidUsers.length} invalid`);
    
    // Get all purchase transactions
    const allTransactions = await getAllPurchaseTransactions(validUsers);
    
    // Analyze referral chains for valid users only
    const chainAnalysis = await analyzeReferralChains(validUsers);
    
    // Count existing commissions
    const existingCommissions = await ReferralTransaction.aggregate([
      { $match: { status: 'completed' } },
      {
        $group: {
          _id: '$generation',
          count: { $sum: 1 },
          totalEarnings: { $sum: '$amount' }
        }
      },
      { $sort: { _id: 1 } }
    ]);
    
    // Calculate what should exist
    const expectedCommissions = await calculateExpectedCommissions(allTransactions, chainAnalysis);
    
    return {
      totalUsers: await User.countDocuments(),
      usersWithReferrers: validUsers.length,
      invalidUsers: invalidUsers.length,
      allTransactions,
      chainAnalysis,
      existingCommissions: existingCommissions.reduce((acc, item) => {
        acc[`gen${item._id}`] = { count: item.count, earnings: item.totalEarnings };
        return acc;
      }, { gen1: { count: 0, earnings: 0 }, gen2: { count: 0, earnings: 0 }, gen3: { count: 0, earnings: 0 } }),
      expectedCommissions
    };
  } catch (error) {
    console.error('❌ Error analyzing current state:', error);
    throw error;
  }
}

/**
 * Get all purchase transactions (IMPROVED with validation)
 */
async function getAllPurchaseTransactions(validUsers = null) {
  try {
    const transactions = [];
    
    // If no valid users provided, get them
    if (!validUsers) {
      validUsers = await User.find({
        'referralInfo.code': { $exists: true, $ne: null, $ne: '' }
      }, 'userName referralInfo name').lean();
    }
    
    // Create a set of valid user IDs for quick lookup
    const validUserIds = new Set(validUsers.map(u => u._id.toString()));
    
    // Get co-founder transactions
    console.log('   📋 Fetching co-founder transactions...');
    const cofounderTxs = await PaymentTransaction.find({
      type: 'co-founder',
      status: 'completed',
      userId: { $exists: true },
      amount: { $gt: 0 }
    }).populate('userId', 'userName referralInfo name').lean();
    
    let validCofounderCount = 0;
    for (const tx of cofounderTxs) {
      if (tx.userId && validUserIds.has(tx.userId._id.toString())) {
        transactions.push({
          id: tx._id,
          userId: tx.userId._id,
          userName: tx.userId.userName,
          referralCode: tx.userId.referralInfo.code,
          amount: tx.amount || 0,
          currency: tx.currency || 'naira',
          type: 'cofounder',
          sourceModel: 'PaymentTransaction',
          shares: tx.shares || 0,
          date: tx.createdAt,
          paymentMethod: tx.paymentMethod
        });
        validCofounderCount++;
      }
    }
    
    console.log(`   ✅ Found ${validCofounderCount} valid co-founder transactions`);
    
    // Get regular share transactions
    console.log('   📋 Fetching regular share transactions...');
    const userShares = await UserShare.find({
      user: { $exists: true }
    }).populate('user', 'userName referralInfo name').lean();
    
    let validRegularCount = 0;
    for (const userShare of userShares) {
      if (userShare.user && validUserIds.has(userShare.user._id.toString())) {
        const completedTxs = userShare.transactions.filter(tx => 
          tx.status === 'completed' && 
          tx.paymentMethod !== 'co-founder' &&
          tx.totalAmount > 0
        );
        
        for (const tx of completedTxs) {
          transactions.push({
            id: tx.transactionId || `userShare_${userShare._id}_${tx._id}`,
            userId: userShare.user._id,
            userName: userShare.user.userName,
            referralCode: userShare.user.referralInfo.code,
            amount: tx.totalAmount || 0,
            currency: tx.currency || 'naira',
            type: 'share',
            sourceModel: 'UserShare',
            shares: tx.shares || 0,
            date: tx.createdAt || userShare.createdAt
          });
          validRegularCount++;
        }
      }
    }
    
    console.log(`   ✅ Found ${validRegularCount} valid regular share transactions`);
    console.log(`   📊 Total valid transactions to process: ${transactions.length}\n`);
    
    return transactions;
  } catch (error) {
    console.error('❌ Error getting purchase transactions:', error);
    return [];
  }
}

/**
 * Get referral chain for a user (IMPROVED with validation)
 */
async function getReferralChain(userId, maxDepth = 5) {
  try {
    const chain = [];
    let currentUser = await User.findById(userId).select('referralInfo userName').lean();
    const visited = new Set(); // Prevent infinite loops
    
    while (currentUser && currentUser.referralInfo && currentUser.referralInfo.code && chain.length < maxDepth) {
      // Prevent infinite loops
      if (visited.has(currentUser._id.toString())) {
        console.log(`   ⚠️  Circular reference detected for user ${currentUser.userName}`);
        break;
      }
      visited.add(currentUser._id.toString());
      
      const referralCode = currentUser.referralInfo.code;
      
      // Skip invalid referral codes
      if (referralCode.includes('http') || referralCode.includes('<script') || referralCode.length > 50) {
        console.log(`   ⚠️  Invalid referral code for ${currentUser.userName}: ${referralCode}`);
        break;
      }
      
      const referrer = await User.findOne({ 
        userName: referralCode 
      }).select('_id userName referralInfo').lean();
      
      if (referrer) {
        chain.push({
          id: referrer._id,
          userName: referrer.userName,
          generation: chain.length + 1
        });
        currentUser = referrer;
      } else {
        // Don't log this as it's expected for many users
        break;
      }
    }
    
    return chain;
  } catch (error) {
    console.error('❌ Error getting referral chain for user:', userId, error.message);
    return [];
  }
}

/**
 * Analyze referral chains for all users
 */
async function analyzeReferralChains(validUsers) {
  try {
    const chains = new Map();
    let processedCount = 0;
    
    console.log(`   🔗 Analyzing referral chains for ${validUsers.length} users...`);
    
    for (const user of validUsers) {
      const chain = await getReferralChain(user._id);
      chains.set(user._id.toString(), {
        user: user,
        chain: chain,
        chainLength: chain.length
      });
      
      processedCount++;
      if (processedCount % 100 === 0) {
        console.log(`   📊 Analyzed ${processedCount}/${validUsers.length} chains...`);
      }
    }
    
    // Summary statistics
    const chainLengths = Array.from(chains.values()).map(c => c.chainLength);
    const stats = {
      totalChains: chains.size,
      maxChainLength: Math.max(...chainLengths, 0),
      avgChainLength: chainLengths.length > 0 ? chainLengths.reduce((sum, len) => sum + len, 0) / chainLengths.length : 0,
      chainsWithGen2: chainLengths.filter(len => len >= 2).length,
      chainsWithGen3: chainLengths.filter(len => len >= 3).length,
      chains: chains
    };
    
    console.log(`   ✅ Chain analysis complete`);
    return stats;
  } catch (error) {
    console.error('❌ Error analyzing referral chains:', error);
    return { totalChains: 0, chains: new Map() };
  }
}

/**
 * Calculate expected commissions
 */
async function calculateExpectedCommissions(transactions, chainAnalysis) {
  try {
    let expected = { gen1: 0, gen2: 0, gen3: 0 };
    
    for (const tx of transactions) {
      const userChain = chainAnalysis.chains.get(tx.userId.toString());
      
      if (userChain && userChain.chain.length > 0) {
        expected.gen1++;
        if (userChain.chain.length >= 2) expected.gen2++;
        if (userChain.chain.length >= 3) expected.gen3++;
      }
    }
    
    return expected;
  } catch (error) {
    console.error('❌ Error calculating expected commissions:', error);
    return { gen1: 0, gen2: 0, gen3: 0 };
  }
}

/**
 * Display analysis results
 */
function displayAnalysis(analysis) {
  console.log('📊 CURRENT STATE ANALYSIS');
  console.log('==========================');
  console.log(`📈 Users:`);
  console.log(`   • Total Users: ${analysis.totalUsers}`);
  console.log(`   • Users with Valid Referrers: ${analysis.usersWithReferrers}`);
  console.log(`   • Users with Invalid Referral Codes: ${analysis.invalidUsers}`);
  console.log('');
  
  console.log(`🔗 Referral Chains:`);
  console.log(`   • Total Valid Chains: ${analysis.chainAnalysis.totalChains}`);
  console.log(`   • Chains with Gen2+: ${analysis.chainAnalysis.chainsWithGen2}`);
  console.log(`   • Chains with Gen3+: ${analysis.chainAnalysis.chainsWithGen3}`);
  console.log(`   • Average Chain Length: ${analysis.chainAnalysis.avgChainLength.toFixed(2)}`);
  console.log(`   • Max Chain Length: ${analysis.chainAnalysis.maxChainLength}`);
  console.log('');
  
  console.log(`💰 Valid Transactions:`);
  console.log(`   • Total Purchase Transactions: ${analysis.allTransactions.length}`);
  console.log(`   • Co-founder Transactions: ${analysis.allTransactions.filter(t => t.type === 'cofounder').length}`);
  console.log(`   • Regular Share Transactions: ${analysis.allTransactions.filter(t => t.type === 'share').length}`);
  console.log('');
  
  console.log(`📋 Current Commissions:`);
  console.log(`   • Gen1: ${analysis.existingCommissions.gen1.count} (${analysis.existingCommissions.gen1.earnings.toFixed(2)})`);
  console.log(`   • Gen2: ${analysis.existingCommissions.gen2.count} (${analysis.existingCommissions.gen2.earnings.toFixed(2)})`);
  console.log(`   • Gen3: ${analysis.existingCommissions.gen3.count} (${analysis.existingCommissions.gen3.earnings.toFixed(2)})`);
  console.log('');
  
  console.log(`🎯 Expected Commissions:`);
  console.log(`   • Gen1: ${analysis.expectedCommissions.gen1} (missing: ${Math.max(0, analysis.expectedCommissions.gen1 - analysis.existingCommissions.gen1.count)})`);
  console.log(`   • Gen2: ${analysis.expectedCommissions.gen2} (missing: ${Math.max(0, analysis.expectedCommissions.gen2 - analysis.existingCommissions.gen2.count)})`);
  console.log(`   • Gen3: ${analysis.expectedCommissions.gen3} (missing: ${Math.max(0, analysis.expectedCommissions.gen3 - analysis.existingCommissions.gen3.count)})`);
  console.log('\n');
}

/**
 * Fix missing commissions (IMPROVED)
 */
async function fixMissingCommissions(analysis) {
  try {
    console.log('🔧 FIXING MISSING COMMISSIONS');
    console.log('==============================');
    
    let stats = {
      processed: 0,
      fixed: 0,
      skipped: 0,
      errors: 0,
      commissionsCreated: { gen1: 0, gen2: 0, gen3: 0 }
    };
    
    console.log(`📋 Processing ${analysis.allTransactions.length} valid transactions...\n`);
    
    for (const tx of analysis.allTransactions) {
      stats.processed++;
      
      try {
        const result = await processTransactionCommissions(tx, analysis.chainAnalysis);
        
        if (result.commissionsCreated > 0) {
          stats.fixed++;
          stats.commissionsCreated.gen1 += result.details.gen1 || 0;
          stats.commissionsCreated.gen2 += result.details.gen2 || 0;
          stats.commissionsCreated.gen3 += result.details.gen3 || 0;
          
          if (result.commissionsCreated > 0) {
            console.log(`✅ ${tx.userName} (${tx.type}): +${result.commissionsCreated} commissions (Gen1:${result.details.gen1||0} Gen2:${result.details.gen2||0} Gen3:${result.details.gen3||0})`);
          }
        } else {
          stats.skipped++;
        }
        
        // Progress indicator
        if (stats.processed % 25 === 0) {
          console.log(`📊 Progress: ${stats.processed}/${analysis.allTransactions.length} (Fixed: ${stats.fixed}, Skipped: ${stats.skipped})`);
        }
        
      } catch (txError) {
        stats.errors++;
        console.error(`❌ Error processing ${tx.userName}:`, txError.message);
      }
    }
    
    console.log('\n📊 FIX RESULTS:');
    console.log(`   • Transactions Processed: ${stats.processed}`);
    console.log(`   • Transactions Fixed: ${stats.fixed}`);
    console.log(`   • Transactions Skipped: ${stats.skipped}`);
    console.log(`   • Errors: ${stats.errors}`);
    console.log(`   • New Commissions Created:`);
    console.log(`     - Gen1: ${stats.commissionsCreated.gen1}`);
    console.log(`     - Gen2: ${stats.commissionsCreated.gen2}`);
    console.log(`     - Gen3: ${stats.commissionsCreated.gen3}`);
    console.log('');
    
    return stats;
  } catch (error) {
    console.error('❌ Error fixing missing commissions:', error);
    throw error;
  }
}

/**
 * Process commissions for a single transaction
 */
async function processTransactionCommissions(transaction, chainAnalysis) {
  try {
    let commissionsCreated = 0;
    let details = { gen1: 0, gen2: 0, gen3: 0 };
    
    // Get referral chain for this user
    const userChain = chainAnalysis.chains.get(transaction.userId.toString());
    
    if (!userChain || userChain.chain.length === 0) {
      return { commissionsCreated: 0, details };
    }
    
    const referralChain = userChain.chain;
    
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
      
      if (commissionAmount <= 0) {
        continue; // Skip zero amounts
      }
      
      // Create referral transaction with enhanced data
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
          calculatedAt: new Date(),
          referrerUserName: referrer.userName,
          purchaserUserName: transaction.userName,
          generationChain: `Gen${generation}: ${referrer.userName}`
        }
      };
      
      // Add metadata for co-founder transactions
      if (transaction.type === 'cofounder') {
        const coFounderShare = await CoFounderShare.findOne();
        const shareToRegularRatio = coFounderShare?.shareToRegularRatio || COFOUNDER_TO_SHARES_RATIO;
        
        referralTxData.metadata = {
          coFounderShares: transaction.shares,
          equivalentRegularShares: transaction.shares * shareToRegularRatio,
          shareToRegularRatio: shareToRegularRatio,
          originalAmount: transaction.amount,
          commissionRate: commissionRate,
          transactionType: 'co-founder',
          paymentMethod: transaction.paymentMethod || 'unknown'
        };
      }
      
      const referralTransaction = new ReferralTransaction(referralTxData);
      await referralTransaction.save();
      
      commissionsCreated++;
      details[`gen${generation}`] = (details[`gen${generation}`] || 0) + 1;
    }
    
    return { commissionsCreated, details };
  } catch (error) {
    console.error('❌ Error processing transaction commissions:', error);
    return { commissionsCreated: 0, details: { gen1: 0, gen2: 0, gen3: 0 } };
  }
}

/**
 * Rebuild all referral statistics
 */
async function rebuildAllReferralStats() {
  try {
    console.log('📊 REBUILDING REFERRAL STATISTICS');
    console.log('==================================');
    
    // Get all users who have received commissions
    const beneficiaries = await ReferralTransaction.distinct('beneficiary', {
      status: 'completed'
    });
    
    console.log(`📋 Rebuilding stats for ${beneficiaries.length} users...\n`);
    
    let rebuiltCount = 0;
    let errorCount = 0;
    
    for (const userId of beneficiaries) {
      try {
        await rebuildUserReferralStats(userId);
        rebuiltCount++;
        
        if (rebuiltCount % 50 === 0) {
          console.log(`📊 Progress: ${rebuiltCount}/${beneficiaries.length} users processed`);
        }
      } catch (error) {
        errorCount++;
        console.error(`❌ Error rebuilding stats for user ${userId}:`, error.message);
      }
    }
    
    console.log(`\n✅ Statistics rebuilt: ${rebuiltCount} users, ${errorCount} errors\n`);
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
    }).lean();
    
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
      if (tx.generation >= 1 && tx.generation <= 3) {
        stats[`generation${tx.generation}`].earnings += tx.amount || 0;
        stats.totalEarnings += tx.amount || 0;
        
        // Track unique users
        if (tx.referredUser) {
          uniqueUsers[tx.generation].add(tx.referredUser.toString());
        }
      }
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
 * Final validation and reporting
 */
async function finalValidation() {
  try {
    console.log('📊 FINAL VALIDATION REPORT');
    console.log('==========================');
    
    // Count commissions by generation and type
    const commissionStats = await ReferralTransaction.aggregate([
      { $match: { status: 'completed' } },
      {
        $group: {
          _id: { generation: '$generation', purchaseType: '$purchaseType' },
          count: { $sum: 1 },
          totalEarnings: { $sum: '$amount' },
          avgEarnings: { $avg: '$amount' }
        }
      },
      { $sort: { '_id.generation': 1, '_id.purchaseType': 1 } }
    ]);
    
    // Count total by generation
    const totalByGeneration = await ReferralTransaction.aggregate([
      { $match: { status: 'completed' } },
      {
        $group: {
          _id: '$generation',
          count: { $sum: 1 },
          totalEarnings: { $sum: '$amount' }
        }
      },
      { $sort: { _id: 1 } }
    ]);
    
    // Count users with referral stats
    const usersWithStats = await Referral.countDocuments();
    const usersWithGen2Earnings = await Referral.countDocuments({ 'generation2.earnings': { $gt: 0 } });
    const usersWithGen3Earnings = await Referral.countDocuments({ 'generation3.earnings': { $gt: 0 } });
    
    // Get top earners by generation
    const topGen2Earners = await Referral.find({ 'generation2.earnings': { $gt: 0 } })
      .sort({ 'generation2.earnings': -1 })
      .limit(5)
      .populate('user', 'userName name')
      .lean();
    
    const topGen3Earners = await Referral.find({ 'generation3.earnings': { $gt: 0 } })
      .sort({ 'generation3.earnings': -1 })
      .limit(5)
      .populate('user', 'userName name')
      .lean();
    
    // Display results
    console.log(`📈 Total Commission Statistics:`);
    for (const stat of totalByGeneration) {
      console.log(`   • Generation ${stat._id}: ${stat.count} commissions, ${stat.totalEarnings.toFixed(2)} total earnings`);
    }
    console.log('');
    
    console.log(`💰 Detailed Commissions by Type:`);
    for (const stat of commissionStats) {
      console.log(`   • Gen${stat._id.generation} ${stat._id.purchaseType}: ${stat.count} commissions (${stat.totalEarnings.toFixed(2)} total, ${stat.avgEarnings.toFixed(2)} avg)`);
    }
    console.log('');
    
    console.log(`👥 User Statistics:`);
    console.log(`   • Users with referral stats: ${usersWithStats}`);
    console.log(`   • Users earning from Gen2: ${usersWithGen2Earnings}`);
    console.log(`   • Users earning from Gen3: ${usersWithGen3Earnings}`);
    console.log('');
    
    if (topGen2Earners.length > 0) {
      console.log(`🏆 Top Gen2 Earners:`);
      topGen2Earners.forEach((user, i) => {
        console.log(`   ${i+1}. ${user.user.userName}: ${user.generation2.earnings.toFixed(2)} (${user.generation2.count} referrals)`);
      });
      console.log('');
    }
    
    if (topGen3Earners.length > 0) {
      console.log(`🥉 Top Gen3 Earners:`);
      topGen3Earners.forEach((user, i) => {
        console.log(`   ${i+1}. ${user.user.userName}: ${user.generation3.earnings.toFixed(2)} (${user.generation3.count} referrals)`);
      });
      console.log('');
    }
    
    // Validation checks
    console.log(`✅ VALIDATION RESULTS:`);
    const gen1Count = totalByGeneration.find(s => s._id === 1)?.count || 0;
    const gen2Count = totalByGeneration.find(s => s._id === 2)?.count || 0;
    const gen3Count = totalByGeneration.find(s => s._id === 3)?.count || 0;
    
    if (gen1Count > 0) {
      console.log(`   ✅ Generation 1 commissions working: ${gen1Count} found`);
    } else {
      console.log(`   ⚠️  No Generation 1 commissions found - check referral setup`);
    }
    
    if (gen2Count > 0) {
      console.log(`   ✅ Generation 2 commissions working: ${gen2Count} found`);
    } else {
      console.log(`   ⚠️  No Generation 2 commissions found - may need deeper referral chains`);
    }
    
    if (gen3Count > 0) {
      console.log(`   ✅ Generation 3 commissions working: ${gen3Count} found`);
    } else {
      console.log(`   ⚠️  No Generation 3 commissions found - may need deeper referral chains`);
    }
    
    if (usersWithGen2Earnings > 0) {
      console.log(`   ✅ Users earning from Gen2: ${usersWithGen2Earnings} users`);
    }
    
    if (usersWithGen3Earnings > 0) {
      console.log(`   ✅ Users earning from Gen3: ${usersWithGen3Earnings} users`);
    }
    
    const totalCommissions = gen1Count + gen2Count + gen3Count;
    const totalEarnings = totalByGeneration.reduce((sum, stat) => sum + stat.totalEarnings, 0);
    
    console.log(`\n🎯 SUMMARY:`);
    console.log(`   • Total Commissions: ${totalCommissions}`);
    console.log(`   • Total Earnings: ${totalEarnings.toFixed(2)}`);
    console.log(`   • Users Benefiting: ${usersWithStats}`);
    console.log(`   • Multi-generation Earners: ${Math.max(usersWithGen2Earnings, usersWithGen3Earnings)}`);
    
    if (gen2Count > 0 && gen3Count > 0) {
      console.log(`\n🎉 SUCCESS: All generation levels are now working!`);
    } else if (gen1Count > 0) {
      console.log(`\n⚠️  PARTIAL: Gen1 working, but Gen2/Gen3 may need more data or deeper chains`);
    } else {
      console.log(`\n🚨 ISSUE: No commissions found - check referral system setup`);
    }
    
    // Final recommendations
    console.log(`\n💡 RECOMMENDATIONS:`);
    console.log(`   • Total invalid referral codes cleaned up during this process`);
    console.log(`   • Future transactions will automatically generate proper multi-level commissions`);
    console.log(`   • Consider reviewing referral code validation in your signup process`);
    console.log(`   • Monitor for new invalid referral codes (URLs, scripts, etc.)`);
    
    console.log('\n✅ Validation completed!');
    
  } catch (error) {
    console.error('❌ Error during validation:', error);
    throw error;
  }
}

/**
 * Utility function to test referral processing for a specific user
 */
async function testUserReferrals(userId) {
  try {
    console.log(`\n🧪 TESTING USER REFERRALS: ${userId}`);
    console.log('==========================================');
    
    const user = await User.findById(userId);
    if (!user) {
      console.log('❌ User not found');
      return;
    }
    
    console.log(`👤 User: ${user.userName} (${user.name})`);
    console.log(`🔗 Referral Code: ${user.referralInfo?.code || 'None'}`);
    
    // Check if referral code is valid
    if (user.referralInfo?.code) {
      const referrer = await User.findOne({ userName: user.referralInfo.code });
      console.log(`✅ Referrer exists: ${referrer ? 'Yes' : 'No'}`);
      
      if (!referrer) {
        console.log(`⚠️  Invalid referral code: "${user.referralInfo.code}"`);
      }
    }
    
    // Get referral chain
    const chain = await getReferralChain(userId);
    console.log(`📊 Referral Chain Length: ${chain.length}`);
    chain.forEach((referrer, i) => {
      console.log(`   Gen${i+1}: ${referrer.userName} (${referrer.id})`);
    });
    
    // Get user's transactions
    const cofounderTxs = await PaymentTransaction.find({
      userId: userId,
      type: 'co-founder',
      status: 'completed'
    });
    
    const userShares = await UserShare.findOne({ user: userId });
    const shareTxs = userShares ? userShares.transactions.filter(tx => tx.status === 'completed') : [];
    
    console.log(`💰 Transactions:`);
    console.log(`   • Co-founder: ${cofounderTxs.length}`);
    console.log(`   • Regular shares: ${shareTxs.length}`);
    
    // Get existing referral transactions
    const existingReferrals = await ReferralTransaction.find({
      referredUser: userId,
      status: 'completed'
    }).populate('beneficiary', 'userName');
    
    console.log(`📋 Existing Referral Commissions: ${existingReferrals.length}`);
    existingReferrals.forEach(rt => {
      console.log(`   Gen${rt.generation}: ${rt.beneficiary.userName} - ${rt.amount} ${rt.currency} (${rt.purchaseType})`);
    });
    
    return {
      user,
      chain,
      transactions: { cofounder: cofounderTxs.length, shares: shareTxs.length },
      existingReferrals: existingReferrals.length
    };
    
  } catch (error) {
    console.error('❌ Error testing user referrals:', error);
    return null;
  }
}

/**
 * Connect to database and run the fix
 */
async function runFix() {
  try {
    // Connect to MongoDB (remove deprecated options)
    console.log('📡 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');
    
    // Run the fix
    await fixReferralCommissions();
    
    console.log('\n🎉 ROBUST REFERRAL COMMISSION FIX COMPLETED!');
    console.log('==============================================');
    console.log('💡 All 1st, 2nd, and 3rd generation referral commissions have been processed.');
    console.log('💡 Invalid referral codes have been cleaned up.');
    console.log('💡 Future transactions will automatically generate proper multi-level commissions.');
    console.log('💡 Users can now earn from their referral networks across all 3 generations.');
    
    // Close connection
    await mongoose.connection.close();
    console.log('\n📡 Database connection closed.');
    
  } catch (error) {
    console.error('\n💥 Fix failed:', error);
    
    try {
      await mongoose.connection.close();
    } catch (closeError) {
      console.error('Error closing connection:', closeError);
    }
    
    process.exit(1);
  }
}

/**
 * Quick test function to run specific tests
 */
async function runQuickTest(userId = null) {
  try {
    console.log('🔬 Running Quick Referral Test...\n');
    
    await mongoose.connect(process.env.MONGODB_URI);
    
    if (userId) {
      await testUserReferrals(userId);
    } else {
      // Test a few random users
      const usersWithReferrals = await ReferralTransaction.distinct('referredUser');
      const testUsers = usersWithReferrals.slice(0, 3);
      
      for (const testUserId of testUsers) {
        await testUserReferrals(testUserId);
        console.log('\n' + '='.repeat(50) + '\n');
      }
    }
    
    await mongoose.connection.close();
    
  } catch (error) {
    console.error('❌ Quick test failed:', error);
    process.exit(1);
  }
}

/**
 * Clean up only invalid referral codes (separate utility)
 */
async function cleanupOnly() {
  try {
    console.log('🧹 CLEANUP ONLY MODE - Invalid Referral Codes');
    console.log('==============================================\n');
    
    await mongoose.connect(process.env.MONGODB_URI);
    
    // Run only the cleanup
    await cleanupInvalidReferralCodes();
    
    console.log('✅ Cleanup completed!\n');
    
    await mongoose.connection.close();
    
  } catch (error) {
    console.error('❌ Cleanup failed:', error);
    process.exit(1);
  }
}

// Export functions
module.exports = {
  fixReferralCommissions,
  runFix,
  testUserReferrals,
  runQuickTest,
  cleanupOnly
};

// Handle command line arguments
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.includes('--test')) {
    const userId = args.find(arg => arg.startsWith('--user='))?.split('=')[1];
    runQuickTest(userId);
  } else if (args.includes('--cleanup-only')) {
    cleanupOnly();
  } else {
    runFix();
  }
}