// referralDataMigration.js - Script to fix existing referral data before upgrade
const mongoose = require('mongoose');
const User = require('./models/User');
const Referral = require('./models/Referral');
const ReferralTransaction = require('./models/ReferralTransaction');
const UserShare = require('./models/UserShare');
const PaymentTransaction = require('./models/Transaction');
const SiteConfig = require('./models/SiteConfig');
const CoFounderShare = require('./models/CoFounderShare');

// Configuration
const COFOUNDER_TO_SHARES_RATIO = 29;
const COMMISSION_RATES = {
  generation1: 15,
  generation2: 3,
  generation3: 2
};

/**
 * Main migration function
 */
async function migrateReferralData() {
  try {
    console.log('🔄 Starting referral data migration...\n');
    
    // Step 1: Update site config with correct commission rates
    await updateSiteConfig();
    
    // Step 2: Clean existing referral transactions (optional - remove if you want to keep existing data)
    await cleanExistingReferralData();
    
    // Step 3: Process all completed co-founder transactions
    await processCoFounderTransactions();
    
    // Step 4: Process all completed regular share transactions
    await processRegularShareTransactions();
    
    // Step 5: Rebuild all referral statistics
    await rebuildReferralStatistics();
    
    // Step 6: Validate and report results
    await validateAndReport();
    
    console.log('✅ Referral data migration completed successfully!\n');
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  }
}

/**
 * Step 1: Update site configuration with correct commission rates
 */
async function updateSiteConfig() {
  try {
    console.log('📝 Updating site configuration...');
    
    const siteConfig = await SiteConfig.getCurrentConfig();
    
    // Ensure commission rates are set correctly
    siteConfig.referralCommission = COMMISSION_RATES;
    await siteConfig.save();
    
    console.log('✅ Site configuration updated with commission rates: 15%, 3%, 2%\n');
  } catch (error) {
    console.error('❌ Error updating site config:', error);
    throw error;
  }
}

/**
 * Step 2: Clean existing referral data (optional)
 */
async function cleanExistingReferralData() {
  try {
    console.log('🧹 Cleaning existing referral data...');
    
    // Ask user if they want to clean existing data
    const shouldClean = process.env.CLEAN_EXISTING_DATA === 'true';
    
    if (shouldClean) {
      await ReferralTransaction.deleteMany({});
      await Referral.deleteMany({});
      console.log('✅ Existing referral data cleaned');
    } else {
      console.log('⏭️  Skipping cleanup - keeping existing data');
    }
    
    console.log('');
  } catch (error) {
    console.error('❌ Error cleaning existing data:', error);
    throw error;
  }
}

/**
 * Step 3: Process all completed co-founder transactions
 */
async function processCoFounderTransactions() {
  try {
    console.log('🔄 Processing co-founder transactions...');
    
    // Get all completed co-founder transactions
    const coFounderTransactions = await PaymentTransaction.find({
      type: 'co-founder',
      status: 'completed'
    }).populate('userId', 'name userName email referralInfo');
    
    console.log(`Found ${coFounderTransactions.length} completed co-founder transactions`);
    
    let processedCount = 0;
    let skippedCount = 0;
    
    for (const transaction of coFounderTransactions) {
      try {
        // Check if user was referred
        const user = transaction.userId;
        if (!user || !user.referralInfo || !user.referralInfo.code) {
          skippedCount++;
          continue;
        }
        
        // Check if referral transactions already exist for this transaction
        const existingReferrals = await ReferralTransaction.find({
          sourceTransaction: transaction._id,
          sourceTransactionModel: 'PaymentTransaction'
        });
        
        if (existingReferrals.length > 0) {
          console.log(`⏭️  Skipping transaction ${transaction._id} - referrals already exist`);
          skippedCount++;
          continue;
        }
        
        // Process referral commissions for this transaction
        const result = await processTransactionReferrals(
          user._id,
          transaction.amount,
          'cofounder',
          transaction._id,
          'PaymentTransaction',
          transaction.currency,
          transaction.shares
        );
        
        if (result.success) {
          processedCount++;
          console.log(`✅ Processed co-founder transaction ${transaction._id} - ${result.commissionsCreated} commissions created`);
        } else {
          console.log(`⚠️  Failed to process transaction ${transaction._id}: ${result.message}`);
          skippedCount++;
        }
        
      } catch (txError) {
        console.error(`❌ Error processing transaction ${transaction._id}:`, txError.message);
        skippedCount++;
      }
    }
    
    console.log(`✅ Co-founder transactions processed: ${processedCount} successful, ${skippedCount} skipped\n`);
    
  } catch (error) {
    console.error('❌ Error processing co-founder transactions:', error);
    throw error;
  }
}

/**
 * Step 4: Process all completed regular share transactions
 */
async function processRegularShareTransactions() {
  try {
    console.log('🔄 Processing regular share transactions...');
    
    // Get all users with share transactions
    const userShares = await UserShare.find({}).populate('user', 'name userName email referralInfo');
    
    let processedCount = 0;
    let skippedCount = 0;
    let totalTransactions = 0;
    
    for (const userShare of userShares) {
      try {
        const user = userShare.user;
        if (!user || !user.referralInfo || !user.referralInfo.code) {
          continue; // Skip users without referrals
        }
        
        // Process each completed transaction
        const completedTransactions = userShare.transactions.filter(t => 
          t.status === 'completed' && 
          t.paymentMethod !== 'co-founder' // Skip co-founder transactions (already processed)
        );
        
        for (const transaction of completedTransactions) {
          totalTransactions++;
          
          // Check if referral transactions already exist
          const existingReferrals = await ReferralTransaction.find({
            sourceTransaction: transaction.transactionId,
            sourceTransactionModel: 'UserShare'
          });
          
          if (existingReferrals.length > 0) {
            skippedCount++;
            continue;
          }
          
          // Process referral commissions
          const result = await processTransactionReferrals(
            user._id,
            transaction.totalAmount,
            'share',
            transaction.transactionId,
            'UserShare',
            transaction.currency,
            transaction.shares
          );
          
          if (result.success) {
            processedCount++;
          } else {
            skippedCount++;
          }
        }
        
      } catch (userError) {
        console.error(`❌ Error processing user ${userShare.user._id}:`, userError.message);
      }
    }
    
    console.log(`✅ Regular share transactions processed: ${processedCount} successful, ${skippedCount} skipped (${totalTransactions} total)\n`);
    
  } catch (error) {
    console.error('❌ Error processing regular share transactions:', error);
    throw error;
  }
}

/**
 * Helper function to process referral commissions for a single transaction
 */
async function processTransactionReferrals(userId, amount, purchaseType, transactionId, sourceModel, currency, shares) {
  try {
    // Find the user who made the purchase
    const user = await User.findById(userId);
    if (!user || !user.referralInfo || !user.referralInfo.code) {
      return { success: false, message: 'User not referred' };
    }
    
    let commissionsCreated = 0;
    let currentUser = user;
    
    // Process up to 3 generations
    for (let generation = 1; generation <= 3; generation++) {
      if (!currentUser.referralInfo || !currentUser.referralInfo.code) {
        break; // No more referrers
      }
      
      // Find the referrer
      const referrer = await User.findOne({ userName: currentUser.referralInfo.code });
      if (!referrer) {
        break; // Referrer not found
      }
      
      // Calculate commission
      const commissionRate = COMMISSION_RATES[`generation${generation}`];
      const commissionAmount = (amount * commissionRate) / 100;
      
      // Create referral transaction with enhanced metadata
      const referralTxData = {
        beneficiary: referrer._id,
        referredUser: userId,
        amount: commissionAmount,
        currency: currency || 'naira',
        generation: generation,
        purchaseType: purchaseType,
        sourceTransaction: transactionId,
        sourceTransactionModel: sourceModel,
        status: 'completed',
        commissionDetails: {
          baseAmount: amount,
          commissionRate: commissionRate,
          calculatedAt: new Date()
        }
      };
      
      // Add metadata for co-founder transactions
      if (purchaseType === 'cofounder') {
        referralTxData.metadata = {
          actualShares: shares,
          equivalentShares: shares * COFOUNDER_TO_SHARES_RATIO,
          conversionRatio: COFOUNDER_TO_SHARES_RATIO,
          originalAmount: amount,
          commissionRate: commissionRate
        };
      }
      
      const referralTransaction = new ReferralTransaction(referralTxData);
      await referralTransaction.save();
      
      commissionsCreated++;
      
      // Move to next generation
      currentUser = referrer;
    }
    
    return {
      success: true,
      commissionsCreated: commissionsCreated
    };
    
  } catch (error) {
    return {
      success: false,
      message: error.message
    };
  }
}

/**
 * Step 5: Rebuild all referral statistics
 */
async function rebuildReferralStatistics() {
  try {
    console.log('🔄 Rebuilding referral statistics...');
    
    // Get all users who have received referral commissions
    const beneficiaries = await ReferralTransaction.distinct('beneficiary');
    
    console.log(`Found ${beneficiaries.length} users with referral earnings`);
    
    let rebuiltCount = 0;
    
    for (const userId of beneficiaries) {
      try {
        // Calculate stats for this user
        const stats = await calculateUserReferralStats(userId);
        
        // Update or create referral record
        await Referral.findOneAndUpdate(
          { user: userId },
          stats,
          { upsert: true, new: true }
        );
        
        rebuiltCount++;
        
      } catch (userError) {
        console.error(`❌ Error rebuilding stats for user ${userId}:`, userError.message);
      }
    }
    
    console.log(`✅ Referral statistics rebuilt for ${rebuiltCount} users\n`);
    
  } catch (error) {
    console.error('❌ Error rebuilding referral statistics:', error);
    throw error;
  }
}

/**
 * Helper function to calculate referral stats for a user
 */
async function calculateUserReferralStats(userId) {
  try {
    // Get all completed referral transactions for this user
    const transactions = await ReferralTransaction.find({
      beneficiary: userId,
      status: 'completed'
    });
    
    // Calculate totals by generation
    const stats = {
      user: userId,
      referredUsers: 0,
      totalEarnings: 0,
      generation1: { count: 0, earnings: 0 },
      generation2: { count: 0, earnings: 0 },
      generation3: { count: 0, earnings: 0 }
    };
    
    // Track unique referred users by generation
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
    
    return stats;
    
  } catch (error) {
    throw error;
  }
}

/**
 * Step 6: Validate and report results
 */
async function validateAndReport() {
  try {
    console.log('📊 Generating migration report...\n');
    
    // Count referral transactions by type
    const coFounderCommissions = await ReferralTransaction.countDocuments({
      purchaseType: 'cofounder',
      status: 'completed'
    });
    
    const shareCommissions = await ReferralTransaction.countDocuments({
      purchaseType: 'share',
      status: 'completed'
    });
    
    // Count by generation
    const gen1Count = await ReferralTransaction.countDocuments({ generation: 1, status: 'completed' });
    const gen2Count = await ReferralTransaction.countDocuments({ generation: 2, status: 'completed' });
    const gen3Count = await ReferralTransaction.countDocuments({ generation: 3, status: 'completed' });
    
    // Calculate total earnings
    const totalEarnings = await ReferralTransaction.aggregate([
      { $match: { status: 'completed' } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    
    // Count users with referral data
    const usersWithReferrals = await Referral.countDocuments();
    
    console.log('📊 MIGRATION REPORT');
    console.log('==================');
    console.log(`📈 Total Referral Commissions: ${coFounderCommissions + shareCommissions}`);
    console.log(`   • Co-founder commissions: ${coFounderCommissions}`);
    console.log(`   • Regular share commissions: ${shareCommissions}`);
    console.log('');
    console.log(`👥 Commissions by Generation:`);
    console.log(`   • Generation 1: ${gen1Count} commissions`);
    console.log(`   • Generation 2: ${gen2Count} commissions`);
    console.log(`   • Generation 3: ${gen3Count} commissions`);
    console.log('');
    console.log(`💰 Total Earnings: ${totalEarnings[0]?.total?.toFixed(2) || 0}`);
    console.log(`👤 Users with Referral Data: ${usersWithReferrals}`);
    console.log('');
    
    // Validate commission rates
    const incorrectRates = await ReferralTransaction.find({
      $or: [
        { generation: 1, 'commissionDetails.commissionRate': { $ne: 15 } },
        { generation: 2, 'commissionDetails.commissionRate': { $ne: 3 } },
        { generation: 3, 'commissionDetails.commissionRate': { $ne: 2 } }
      ]
    }).countDocuments();
    
    if (incorrectRates > 0) {
      console.log(`⚠️  Warning: ${incorrectRates} transactions have incorrect commission rates`);
    } else {
      console.log('✅ All commission rates are correct');
    }
    
    console.log('\n🎉 Migration validation completed!');
    
  } catch (error) {
    console.error('❌ Error during validation:', error);
    throw error;
  }
}

/**
 * Script execution
 */
async function runMigration() {
  try {
    // Connect to MongoDB if not already connected
    if (mongoose.connection.readyState !== 1) {
      console.log('📡 Connecting to MongoDB...');
      await mongoose.connect(process.env.MONGODB_URI || 'mongodb+srv://infoagrichainx:nfE59IWssd3kklfZ@cluster0.uvjmhm9.mongodb.net', {
        useNewUrlParser: true,
        useUnifiedTopology: true
      });
      console.log('✅ Connected to MongoDB\n');
    }
    
    // Run the migration
    await migrateReferralData();
    
    console.log('\n🎉 Migration completed successfully!');
    console.log('You can now update your referralUtils.js and ReferralTransaction model files.');
    
  } catch (error) {
    console.error('\n💥 Migration failed:', error);
    process.exit(1);
  }
}

// Export for use as module or run directly
module.exports = {
  migrateReferralData,
  runMigration
};

// Run if called directly
if (require.main === module) {
  runMigration();
}