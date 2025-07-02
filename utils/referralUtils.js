// referralUtils.js - COMPLETE FIXED VERSION for co-founder share conversion with existing system
const User = require('../models/User');
const Referral = require('../models/Referral');
const ReferralTransaction = require('../models/ReferralTransaction');
const UserShare = require('../models/UserShare');
const PaymentTransaction = require('../models/Transaction');
const SiteConfig = require('../models/SiteConfig');
const CoFounderShare = require('../models/CoFounderShare');

// CONFIGURATION: 1 Co-founder share = 29 regular shares
const COFOUNDER_TO_SHARES_RATIO = 29;

/**
 * Process referral commissions for a transaction (FIXED for co-founder shares)
 * @param {string} userId - User ID who made the purchase 
 * @param {number} purchaseAmount - Transaction amount
 * @param {string} purchaseType - Type of purchase (share, cofounder, etc.)
 * @param {string} transactionId - Transaction ID (MongoDB ObjectId)
 * @returns {object} - Processing result
 */
const processReferralCommission = async (userId, purchaseAmount, purchaseType = 'share', transactionId = null) => {
  try {
    console.log(`\n🎯 [FIXED] Processing referral commission for user: ${userId}`);
    console.log(`💰 Purchase amount: ${purchaseAmount}, Type: ${purchaseType}, Transaction: ${transactionId}`);
    
    // Input validation
    if (!userId || !purchaseAmount || !transactionId) {
      console.log('❌ Missing required parameters for referral processing');
      return { success: false, message: 'Missing required parameters' };
    }
    
    // Get the purchaser
    const purchaser = await User.findById(userId);
    if (!purchaser) {
      console.log('❌ Purchaser not found');
      return { success: false, message: 'Purchaser not found' };
    }
    
    // Check if user has a referrer
    if (!purchaser.referralInfo || !purchaser.referralInfo.code) {
      console.log('❌ User has no referrer, skipping commission');
      return { success: false, message: 'User has no referrer' };
    }
    
    console.log(`👤 Purchaser: ${purchaser.userName}, Referred by: ${purchaser.referralInfo.code}`);
    
    // Get site config for commission rates
    const siteConfig = await SiteConfig.getCurrentConfig();
    const commissionRates = siteConfig.referralCommission || {
      generation1: 15,
      generation2: 3,
      generation3: 2
    };

    console.log(`📊 Commission rates: Gen1: ${commissionRates.generation1}%, Gen2: ${commissionRates.generation2}%, Gen3: ${commissionRates.generation3}%`);

    // FIXED: Determine currency and source model based on purchase type
    let currency = 'naira'; // Default currency
    let sourceModel = 'UserShare'; // Default source model
    
    if (purchaseType === 'cofounder') {
      sourceModel = 'PaymentTransaction';
      
      try {
        // FIXED: Find the transaction to get currency info
        const transaction = await PaymentTransaction.findById(transactionId);
        if (transaction && transaction.currency) {
          currency = transaction.currency;
          console.log(`💱 Found currency from transaction: ${currency}`);
        }
      } catch (error) {
        console.log('⚠️  Could not determine currency from transaction, using default naira');
      }
    }
    
    console.log(`💱 Using currency: ${currency}, Source model: ${sourceModel}`);
    
    // FIXED: Check for existing commissions to prevent duplicates
    const existingCommissions = await ReferralTransaction.find({
      referredUser: userId,
      sourceTransaction: transactionId,
      sourceTransactionModel: sourceModel,
      status: 'completed'
    });
    
    if (existingCommissions.length > 0) {
      console.log(`⏭️  Commissions already processed for this transaction (${existingCommissions.length} found)`);
      return { 
        success: false, 
        message: 'Commissions already processed for this transaction',
        existingCommissions: existingCommissions.length
      };
    }
    
    // Process up to 3 generations of referrals
    let currentUser = purchaser;
    let commissionsCreated = 0;
    const createdCommissions = [];
    
    for (let generation = 1; generation <= 3; generation++) {
      try {
        // Check if current user has a referrer
        if (!currentUser.referralInfo || !currentUser.referralInfo.code) {
          console.log(`⏹️  No referrer found for generation ${generation}, stopping`);
          break;
        }
        
        // Find the referrer
        const referrer = await User.findOne({ userName: currentUser.referralInfo.code });
        
        if (!referrer) {
          console.log(`❌ Referrer not found: ${currentUser.referralInfo.code} (Generation ${generation})`);
          break;
        }
        
        console.log(`\n👥 Generation ${generation} referrer: ${referrer.userName} (ID: ${referrer._id})`);
        
        // FIXED: Double-check for existing commission for this specific generation
        const existingGenCommission = await ReferralTransaction.findOne({
          beneficiary: referrer._id,
          referredUser: userId, // Always the original purchaser
          sourceTransaction: transactionId,
          sourceTransactionModel: sourceModel,
          generation: generation,
          status: 'completed'
        });
        
        if (existingGenCommission) {
          console.log(`⏭️  Commission already exists for Generation ${generation}, skipping`);
          currentUser = referrer; // Move to next generation
          continue;
        }
        
        // Calculate commission
        const commissionRate = commissionRates[`generation${generation}`];
        if (!commissionRate || commissionRate <= 0) {
          console.log(`⏭️  No commission rate for generation ${generation}, skipping`);
          currentUser = referrer;
          continue;
        }
        
        const commissionAmount = (purchaseAmount * commissionRate) / 100;
        
        console.log(`💵 Gen ${generation} calculation: ${purchaseAmount} × ${commissionRate}% = ${commissionAmount}`);
        
        // FIXED: Enhanced referral transaction data
        const referralTxData = {
          beneficiary: referrer._id,
          referredUser: userId, // IMPORTANT: Always the original purchaser
          amount: commissionAmount,
          currency: currency,
          generation: generation,
          purchaseType: purchaseType,
          sourceTransaction: transactionId,
          sourceTransactionModel: sourceModel,
          status: 'completed',
          createdAt: new Date(),
          commissionDetails: {
            baseAmount: purchaseAmount,
            commissionRate: commissionRate,
            calculatedAt: new Date(),
            referrerUserName: referrer.userName,
            purchaserUserName: purchaser.userName,
            generationChain: `Gen${generation}: ${referrer.userName}`
          }
        };
        
        // FIXED: Add enhanced metadata for co-founder transactions
        if (purchaseType === 'cofounder') {
          try {
            const transaction = await PaymentTransaction.findById(transactionId);
            if (transaction && transaction.shares) {
              const coFounderShare = await CoFounderShare.findOne();
              const shareToRegularRatio = coFounderShare?.shareToRegularRatio || 29;
              
              referralTxData.metadata = {
                coFounderShares: transaction.shares,
                equivalentRegularShares: transaction.shares * shareToRegularRatio,
                shareToRegularRatio: shareToRegularRatio,
                originalAmount: purchaseAmount,
                commissionRate: commissionRate,
                transactionType: 'co-founder',
                paymentMethod: transaction.paymentMethod || 'unknown'
              };
              
              console.log(`🔄 Co-founder metadata: ${transaction.shares} co-founder shares = ${transaction.shares * shareToRegularRatio} regular shares`);
            }
          } catch (metadataError) {
            console.log('⚠️  Could not add co-founder metadata:', metadataError.message);
          }
        }
        
        // Create referral transaction
        const referralTransaction = new ReferralTransaction(referralTxData);
        await referralTransaction.save();
        
        commissionsCreated++;
        createdCommissions.push({
          generation,
          beneficiary: referrer.userName,
          amount: commissionAmount,
          currency,
          transactionId: referralTransaction._id
        });
        
        console.log(`✅ Created Generation ${generation} commission: ${commissionAmount} ${currency} for ${referrer.userName}`);
        
        // FIXED: Update referrer stats immediately with better error handling
        try {
          await updateReferrerStats(referrer._id, commissionAmount, generation, userId);
          console.log(`📊 Updated stats for ${referrer.userName} (Gen ${generation})`);
        } catch (statsError) {
          console.error(`❌ Error updating stats for ${referrer.userName}:`, statsError.message);
          // Continue processing even if stats update fails
        }
        
        // Move to next generation - IMPORTANT: Use the referrer as the current user for next iteration
        currentUser = referrer;
        
      } catch (generationError) {
        console.error(`❌ Error processing generation ${generation}:`, generationError.message);
        break; // Stop processing further generations if there's an error
      }
    }
    
    console.log(`\n🎉 [FIXED] Referral commission processing completed: ${commissionsCreated} commissions created`);
    
    // FIXED: Return detailed success response
    return { 
      success: true, 
      commissionsCreated: commissionsCreated,
      commissions: createdCommissions,
      message: `${commissionsCreated} referral commissions created successfully`,
      transactionId: transactionId,
      purchaseType: purchaseType,
      totalAmount: purchaseAmount,
      currency: currency
    };
    
  } catch (error) {
    console.error('❌ [FIXED] Error processing referral commission:', error);
    return { 
      success: false, 
      message: error.message,
      error: process.env.NODE_ENV === 'development' ? error.stack : undefined
    };
  }
};

/**
 * FIXED: Helper function to update referrer statistics
 */
async function updateReferrerStats(referrerId, commissionAmount, generation, referredUserId) {
  try {
    console.log(`📊 [FIXED] Updating stats for referrer ${referrerId}, Gen ${generation}`);
    
    // Find or create referral stats
    let referralStats = await Referral.findOne({ user: referrerId });
    
    if (!referralStats) {
      referralStats = new Referral({
        user: referrerId,
        referredUsers: 0,
        totalEarnings: 0,
        generation1: { count: 0, earnings: 0 },
        generation2: { count: 0, earnings: 0 },
        generation3: { count: 0, earnings: 0 }
      });
    }
    
    // FIXED: Always update earnings
    referralStats.totalEarnings += commissionAmount;
    referralStats[`generation${generation}`].earnings += commissionAmount;
    
    // FIXED: Update count logic - only increment if this is a new user for this generation
    const existingTransactionCount = await ReferralTransaction.countDocuments({
      beneficiary: referrerId,
      referredUser: referredUserId,
      generation: generation,
      status: 'completed'
    });
    
    // If this is the first transaction from this user for this generation, increment count
    if (existingTransactionCount === 1) { // This is the first transaction
      referralStats[`generation${generation}`].count += 1;
      console.log(`📈 Incremented Gen${generation} count for ${referrerId} (new user)`);
      
      // FIXED: Only update referredUsers count for generation 1 (direct referrals)
      if (generation === 1) {
        // Get total unique generation 1 users
        const totalUniqueGen1Users = await ReferralTransaction.distinct('referredUser', {
          beneficiary: referrerId,
          generation: 1,
          status: 'completed'
        });
        referralStats.referredUsers = totalUniqueGen1Users.length;
        console.log(`📈 Updated total referred users for ${referrerId}: ${referralStats.referredUsers}`);
      }
    } else {
      console.log(`📊 Existing user transaction for Gen${generation} - only updating earnings`);
    }
    
    await referralStats.save();
    console.log(`✅ Updated stats for ${referrerId}: Gen${generation} earnings: ${referralStats[`generation${generation}`].earnings}`);
    
  } catch (error) {
    console.error('❌ Error updating referrer stats:', error);
    throw error; // Rethrow to handle in calling function
  }
}

/**
 * Process new user referral (to update referral counts when a user signs up)
 * @param {string} userId - The ID of the new user
 * @returns {Promise<Object>} - Result of the referral processing
 */
const processNewUserReferral = async (userId) => {
  try {
    // Find the user who registered
    const user = await User.findById(userId);
    
    if (!user) {
      return {
        success: false,
        message: 'User not found'
      };
    }
    
    // Check if user was referred
    if (!user.referralInfo || !user.referralInfo.code) {
      return {
        success: false,
        message: 'User was not referred by anyone'
      };
    }
    
    console.log(`Processing new user referral for user ${userId} with referral code ${user.referralInfo.code}`);
    
    // Find direct referrer (Gen 1)
    const referrer = await User.findOne({ userName: user.referralInfo.code });
    
    if (!referrer) {
      return {
        success: false,
        message: 'Referrer not found'
      };
    }
    
    // Update Gen 1 referrer's stats
    let referralStats = await Referral.findOne({ user: referrer._id });
    
    if (!referralStats) {
      referralStats = new Referral({
        user: referrer._id,
        referredUsers: 1,
        totalEarnings: 0,
        generation1: { count: 1, earnings: 0 },
        generation2: { count: 0, earnings: 0 },
        generation3: { count: 0, earnings: 0 }
      });
    } else {
      // Check if this user is already counted
      const existingReferralTx = await ReferralTransaction.findOne({
        beneficiary: referrer._id,
        referredUser: userId
      });
      
      if (!existingReferralTx) {
        referralStats.referredUsers += 1;
        referralStats.generation1.count += 1;
      }
    }
    
    await referralStats.save();
    
    // Process Gen 2 (referrer's referrer)
    if (referrer.referralInfo && referrer.referralInfo.code) {
      const gen2Referrer = await User.findOne({ userName: referrer.referralInfo.code });
      
      if (gen2Referrer) {
        let gen2Stats = await Referral.findOne({ user: gen2Referrer._id });
        
        if (!gen2Stats) {
          gen2Stats = new Referral({
            user: gen2Referrer._id,
            referredUsers: 0, // Direct referrals only
            totalEarnings: 0,
            generation1: { count: 0, earnings: 0 },
            generation2: { count: 1, earnings: 0 },
            generation3: { count: 0, earnings: 0 }
          });
        } else {
          // Check if this user is already counted
          const existingGen2Tx = await ReferralTransaction.findOne({
            beneficiary: gen2Referrer._id,
            referredUser: userId
          });
          
          if (!existingGen2Tx) {
            gen2Stats.generation2.count += 1;
          }
        }
        
        await gen2Stats.save();
        
        // Process Gen 3 (referrer's referrer's referrer)
        if (gen2Referrer.referralInfo && gen2Referrer.referralInfo.code) {
          const gen3Referrer = await User.findOne({ userName: gen2Referrer.referralInfo.code });
          
          if (gen3Referrer) {
            let gen3Stats = await Referral.findOne({ user: gen3Referrer._id });
            
            if (!gen3Stats) {
              gen3Stats = new Referral({
                user: gen3Referrer._id,
                referredUsers: 0, // Direct referrals only
                totalEarnings: 0,
                generation1: { count: 0, earnings: 0 },
                generation2: { count: 0, earnings: 0 },
                generation3: { count: 1, earnings: 0 }
              });
            } else {
              // Check if this user is already counted
              const existingGen3Tx = await ReferralTransaction.findOne({
                beneficiary: gen3Referrer._id,
                referredUser: userId
              });
              
              if (!existingGen3Tx) {
                gen3Stats.generation3.count += 1;
              }
            }
            
            await gen3Stats.save();
          }
        }
      }
    }
    
    return {
      success: true,
      message: 'New user referral processed successfully'
    };
  } catch (error) {
    console.error('Error processing new user referral:', error);
    return {
      success: false,
      message: 'Error processing new user referral',
      error: error.message
    };
  }
};

/**
 * Process commission for a single referrer (Legacy function - keeping for compatibility)
 * @param {string} beneficiaryId - Referrer ID who receives the commission
 * @param {string} referredUserId - User who made the purchase
 * @param {number} amount - Transaction amount
 * @param {string} currency - Currency (naira or usdt)
 * @param {number} commissionRate - Commission rate percentage
 * @param {number} generation - Referral generation (1, 2, or 3)
 * @param {string} purchaseType - Type of purchase
 * @param {string} sourceTransaction - Original transaction ID
 * @param {string} sourceTransactionModel - Source model for the transaction
 * @param {object} shareDetails - Details about shares and conversion
 */
const processCommission = async (
  beneficiaryId,
  referredUserId,
  amount,
  currency,
  commissionRate,
  generation,
  purchaseType,
  sourceTransaction,
  sourceTransactionModel,
  shareDetails = {}
) => {
  try {
    // Calculate commission amount
    const commissionAmount = (amount * commissionRate) / 100;
    
    // Only create transaction record if commission amount is positive
    if (commissionAmount <= 0) {
      console.log(`Skipping zero commission for ${beneficiaryId}, generation ${generation}`);
      return;
    }
    
    // Check if commission already exists for this source transaction
    const existingCommission = await ReferralTransaction.findOne({
      beneficiary: beneficiaryId,
      sourceTransaction,
      sourceTransactionModel,
      generation
    });
    
    if (existingCommission) {
      console.log(`Commission already processed for ${sourceTransaction}, beneficiary ${beneficiaryId}, generation ${generation}`);
      return;
    }
    
    // Create referral transaction record with enhanced details
    const transactionData = {
      beneficiary: beneficiaryId,
      referredUser: referredUserId,
      amount: commissionAmount,
      currency,
      generation,
      purchaseType,
      sourceTransaction,
      sourceTransactionModel,
      status: 'completed' // Mark commission as completed immediately
    };
    
    // Add share conversion details if available
    if (shareDetails.actualShares !== undefined) {
      transactionData.metadata = {
        actualShares: shareDetails.actualShares,
        equivalentShares: shareDetails.equivalentShares,
        conversionRatio: shareDetails.conversionRatio,
        originalAmount: amount,
        commissionRate: commissionRate
      };
    }
    
    const transaction = new ReferralTransaction(transactionData);
    await transaction.save();
    
    // Update referral stats
    let referral = await Referral.findOne({ user: beneficiaryId });
    
    if (!referral) {
      // Create new referral record if not exists
      referral = new Referral({
        user: beneficiaryId,
        referredUsers: 0,
        totalEarnings: 0,
        generation1: { count: 0, earnings: 0 },
        generation2: { count: 0, earnings: 0 },
        generation3: { count: 0, earnings: 0 }
      });
    }
    
    // If this is the first transaction from this referredUser for this generation,
    // increment the count
    const existingTransactions = await ReferralTransaction.find({
      beneficiary: beneficiaryId,
      referredUser: referredUserId,
      generation,
      status: 'completed'
    }).sort({ createdAt: 1 });
    
    if (existingTransactions.length === 1 && 
        existingTransactions[0]._id.toString() === transaction._id.toString()) {
      referral[`generation${generation}`].count += 1;
      
      // Only update referredUsers count for generation 1
      if (generation === 1) {
        referral.referredUsers = await calculateTotalReferredUsers(beneficiaryId);
      }
    }
    
    // Add earnings
    referral[`generation${generation}`].earnings += commissionAmount;
    referral.totalEarnings += commissionAmount;
    
    // Save referral stats
    await referral.save();
    
    // Log the commission with conversion details
    if (shareDetails.actualShares !== undefined) {
      console.log(`[Referral Commission] Gen ${generation} for ${beneficiaryId}: ${currency} ${commissionAmount.toFixed(2)} (${commissionRate}% of ${amount}) - Based on ${shareDetails.actualShares} ${purchaseType} shares = ${shareDetails.equivalentShares} equivalent shares`);
    } else {
      console.log(`[Referral Commission] Gen ${generation} for ${beneficiaryId}: ${currency} ${commissionAmount.toFixed(2)} (${commissionRate}% of ${amount})`);
    }
    
    // Return the transaction
    return transaction;
  } catch (error) {
    console.error('Error processing individual commission:', error);
    throw error;
  }
};

/**
 * Helper function to calculate total unique referred users
 * @param {string} userId - User ID
 */
const calculateTotalReferredUsers = async (userId) => {
  try {
    // Find unique users in generation 1
    const generation1Users = await ReferralTransaction.distinct('referredUser', {
      beneficiary: userId,
      generation: 1,
      status: 'completed'
    });
    
    // Return count of unique users
    return generation1Users.length;
  } catch (error) {
    console.error('Error calculating total referred users:', error);
    return 0;
  }
};

/**
 * Calculate total earnings for a user from all generations
 * @param {string} userId - User ID
 */
const calculateTotalEarnings = async (userId) => {
  try {
    const result = await ReferralTransaction.aggregate([
      {
        $match: {
          beneficiary: userId,
          status: 'completed'
        }
      },
      {
        $group: {
          _id: null,
          totalEarnings: { $sum: '$amount' },
          gen1Earnings: {
            $sum: {
              $cond: [{ $eq: ['$generation', 1] }, '$amount', 0]
            }
          },
          gen2Earnings: {
            $sum: {
              $cond: [{ $eq: ['$generation', 2] }, '$amount', 0]
            }
          },
          gen3Earnings: {
            $sum: {
              $cond: [{ $eq: ['$generation', 3] }, '$amount', 0]
            }
          }
        }
      }
    ]);
    
    if (result.length === 0) {
      return {
        totalEarnings: 0,
        generation1: 0,
        generation2: 0,
        generation3: 0
      };
    }
    
    return {
      totalEarnings: result[0].totalEarnings,
      generation1: result[0].gen1Earnings,
      generation2: result[0].gen2Earnings,
      generation3: result[0].gen3Earnings
    };
  } catch (error) {
    console.error('Error calculating total earnings:', error);
    return {
      totalEarnings: 0,
      generation1: 0,
      generation2: 0,
      generation3: 0
    };
  }
};

/**
 * Get user's total share count including co-founder conversion
 * @param {string} userId - User ID
 * @returns {object} Total shares breakdown
 */
const getUserTotalShares = async (userId) => {
  try {
    // Get regular shares
    const userShares = await UserShare.findOne({ user: userId });
    const regularShares = userShares ? userShares.totalShares : 0;

    // Get co-founder shares
    const coFounderTransactions = await PaymentTransaction.find({
      userId: userId,
      type: 'co-founder',
      status: 'completed'
    });
    
    const coFounderShares = coFounderTransactions.reduce((total, txn) => {
      return total + (txn.shares || 0);
    }, 0);

    // Convert co-founder shares to equivalent regular shares
    const equivalentSharesFromCoFounder = coFounderShares * COFOUNDER_TO_SHARES_RATIO;
    const totalEquivalentShares = regularShares + equivalentSharesFromCoFounder;

    return {
      regularShares,
      coFounderShares,
      equivalentSharesFromCoFounder,
      totalEquivalentShares,
      conversionRatio: COFOUNDER_TO_SHARES_RATIO,
      breakdown: {
        regularShares: {
          count: regularShares,
          transactions: userShares ? userShares.transactions.filter(t => t.status === 'completed').length : 0
        },
        coFounderShares: {
          count: coFounderShares,
          transactions: coFounderTransactions.length,
          equivalentRegularShares: equivalentSharesFromCoFounder
        }
      }
    };

  } catch (error) {
    console.error('Error calculating user total shares:', error);
    return {
      regularShares: 0,
      coFounderShares: 0,
      equivalentSharesFromCoFounder: 0,
      totalEquivalentShares: 0,
      conversionRatio: COFOUNDER_TO_SHARES_RATIO,
      error: error.message,
      breakdown: {
        regularShares: { count: 0, transactions: 0 },
        coFounderShares: { count: 0, transactions: 0, equivalentRegularShares: 0 }
      }
    };
  }
};

/**
 * Sync referral statistics for a user
 * @param {string} userId - User ID
 */
const syncReferralStats = async (userId) => {
  try {
    // Get user
    const user = await User.findById(userId);
    
    if (!user) {
      return {
        success: false,
        message: 'User not found'
      };
    }
    
    // Ensure commission rates are set correctly
    const siteConfig = await SiteConfig.getCurrentConfig();
    if (!siteConfig.referralCommission || 
        siteConfig.referralCommission.generation1 !== 15 || 
        siteConfig.referralCommission.generation2 !== 3 || 
        siteConfig.referralCommission.generation3 !== 2) {
      
      siteConfig.referralCommission = {
        generation1: 15,
        generation2: 3,
        generation3: 2
      };
      
      await siteConfig.save();
      console.log('Updated commission rates during sync to: 15%, 3%, 2%');
    }
    
    // Calculate counts for each generation
    const gen1Users = await ReferralTransaction.distinct('referredUser', {
      beneficiary: userId,
      generation: 1,
      status: 'completed'
    });
    
    const gen2Users = await ReferralTransaction.distinct('referredUser', {
      beneficiary: userId,
      generation: 2,
      status: 'completed'
    });
    
    const gen3Users = await ReferralTransaction.distinct('referredUser', {
      beneficiary: userId,
      generation: 3,
      status: 'completed'
    });
    
    // Calculate earnings
    const earnings = await calculateTotalEarnings(userId);
    
    // Update or create referral stats
    let referral = await Referral.findOne({ user: userId });
    
    if (!referral) {
      referral = new Referral({
        user: userId,
        referredUsers: gen1Users.length,
        totalEarnings: earnings.totalEarnings,
        generation1: { count: gen1Users.length, earnings: earnings.generation1 },
        generation2: { count: gen2Users.length, earnings: earnings.generation2 },
        generation3: { count: gen3Users.length, earnings: earnings.generation3 }
      });
    } else {
      referral.referredUsers = gen1Users.length;
      referral.totalEarnings = earnings.totalEarnings;
      referral.generation1 = { count: gen1Users.length, earnings: earnings.generation1 };
      referral.generation2 = { count: gen2Users.length, earnings: earnings.generation2 };
      referral.generation3 = { count: gen3Users.length, earnings: earnings.generation3 };
    }
    
    await referral.save();
    
    return {
      success: true,
      message: 'Referral stats synced successfully',
      stats: referral
    };
  } catch (error) {
    console.error('Error syncing referral stats:', error);
    return {
      success: false,
      message: 'Error syncing referral stats',
      error: error.message
    };
  }
};

/**
 * FIXED: Rollback referral commissions for a canceled transaction
 * @param {string} userId - The user ID who made the purchase
 * @param {string} transactionId - The transaction ID (MongoDB ObjectId)
 * @param {number} amount - The transaction amount
 * @param {string} currency - The currency used (naira or usdt)
 * @param {string} purchaseType - The type of transaction (share, cofounder, etc.)
 * @param {string} sourceModel - The source model name
 * @returns {Promise<Object>} - Result of the rollback operation
 */
const rollbackReferralCommission = async (userId, transactionId, amount, currency, purchaseType, sourceModel) => {
  try {
    console.log(`\n🔄 [FIXED] Rolling back referral commissions for transaction: ${transactionId}`);
    console.log(`👤 User: ${userId}, Type: ${purchaseType}, Amount: ${amount} ${currency}`);
    
    // FIXED: Determine correct source model
    const correctSourceModel = purchaseType === 'cofounder' ? 'PaymentTransaction' : sourceModel;
    
    // Find all referral transactions for this source transaction
    const referralTransactions = await ReferralTransaction.find({
      referredUser: userId, // FIXED: Use referredUser instead of sourceTransaction
      sourceTransaction: transactionId,
      sourceTransactionModel: correctSourceModel,
      status: 'completed'
    });
    
    console.log(`📋 Found ${referralTransactions.length} referral transactions to rollback`);
    
    if (referralTransactions.length === 0) {
      console.log('⚠️  No referral transactions found to rollback');
      return {
        success: true,
        message: 'No referral transactions found to rollback',
        rolledBackCount: 0
      };
    }
    
    let rolledBackCount = 0;
    
    // Process each referral transaction
    for (const refTx of referralTransactions) {
      try {
        console.log(`🔄 Rolling back Gen${refTx.generation} commission: ${refTx.amount} ${refTx.currency} for beneficiary ${refTx.beneficiary}`);
        
        // Update referral stats for the beneficiary
        const referralStats = await Referral.findOne({ user: refTx.beneficiary });
        
        if (referralStats) {
          // FIXED: Subtract earnings with safety checks
          const oldTotalEarnings = referralStats.totalEarnings;
          const oldGenEarnings = referralStats[`generation${refTx.generation}`].earnings;
          
          referralStats.totalEarnings = Math.max(0, referralStats.totalEarnings - refTx.amount);
          
          // Subtract from generation-specific earnings
          const generationKey = `generation${refTx.generation}`;
          if (referralStats[generationKey]) {
            referralStats[generationKey].earnings = Math.max(0, 
              referralStats[generationKey].earnings - refTx.amount
            );
          }
          
          await referralStats.save();
          
          console.log(`📉 Updated beneficiary ${refTx.beneficiary} stats:`);
          console.log(`   Total earnings: ${oldTotalEarnings} → ${referralStats.totalEarnings}`);
          console.log(`   Gen${refTx.generation} earnings: ${oldGenEarnings} → ${referralStats[generationKey].earnings}`);
        } else {
          console.log(`⚠️  No referral stats found for beneficiary ${refTx.beneficiary}`);
        }
        
        // FIXED: Mark referral transaction as rolled back (don't delete, preserve audit trail)
        refTx.status = 'rolled_back';
        refTx.rolledBackAt = new Date();
        refTx.rollbackReason = `Transaction ${transactionId} was canceled or reversed`;
        await refTx.save();
        
        rolledBackCount++;
        console.log(`✅ Rolled back referral transaction ${refTx._id}`);
        
      } catch (refTxError) {
        console.error(`❌ Error rolling back individual referral transaction ${refTx._id}:`, refTxError.message);
        // Continue with other transactions even if one fails
      }
    }
    
    console.log(`🎉 [FIXED] Rollback completed: ${rolledBackCount}/${referralTransactions.length} commissions rolled back`);
    
    return {
      success: true,
      message: `Successfully rolled back ${rolledBackCount} referral commissions`,
      rolledBackCount: rolledBackCount,
      totalFound: referralTransactions.length
    };
  } catch (error) {
    console.error('❌ [FIXED] Error rolling back referral commissions:', error);
    return {
      success: false,
      message: error.message,
      error: process.env.NODE_ENV === 'development' ? error.stack : undefined
    };
  }
};

/**
 * Update referral statistics after a rollback
 * @param {string} beneficiaryId - The ID of the user whose commission was rolled back
 * @param {number} amount - The amount of the commission
 * @param {number} generation - The generation (1, 2, or 3)
 */
const updateReferralStatsAfterRollback = async (beneficiaryId, amount, generation) => {
  try {
    // Get the referral record
    let referral = await Referral.findOne({ user: beneficiaryId });
    
    if (!referral) {
      console.log(`No referral record found for user ${beneficiaryId}`);
      return;
    }
    
    // Update earnings
    referral[`generation${generation}`].earnings -= amount;
    referral.totalEarnings -= amount;
    
    // Ensure values don't go negative
    if (referral[`generation${generation}`].earnings < 0) {
      referral[`generation${generation}`].earnings = 0;
    }
    
    if (referral.totalEarnings < 0) {
      referral.totalEarnings = 0;
    }
    
    // We're not decrementing the counts as the user was still referred,
    // just the commission is being rolled back
    
    // Save the updated referral record
    await referral.save();
    
    // Optionally, fully recalculate stats to ensure accuracy
    await syncReferralStats(beneficiaryId);
    
  } catch (error) {
    console.error('Error updating referral stats after rollback:', error);
    throw error;
  }
};

/**
 * FIXED: Debug function to check referral transaction data
 * @param {string} userId - User ID to debug
 * @param {string} transactionId - Transaction ID to debug
 */
const debugReferralData = async (userId, transactionId = null) => {
  try {
    console.log(`\n🔍 [DEBUG] Checking referral data for user: ${userId}`);
    
    // Check user exists and has referrer
    const user = await User.findById(userId);
    if (!user) {
      console.log('❌ User not found');
      return { error: 'User not found' };
    }
    
    console.log(`👤 User: ${user.userName}, Email: ${user.email}`);
    console.log(`🔗 Referral code: ${user.referralInfo?.code || 'None'}`);
    
    // Find referrer chain
    let currentUser = user;
    const referrerChain = [];
    
    for (let gen = 1; gen <= 3; gen++) {
      if (!currentUser.referralInfo?.code) break;
      
      const referrer = await User.findOne({ userName: currentUser.referralInfo.code });
      if (!referrer) break;
      
      referrerChain.push({
        generation: gen,
        userName: referrer.userName,
        userId: referrer._id,
        email: referrer.email
      });
      
      currentUser = referrer;
    }
    
    console.log(`📊 Referrer chain (${referrerChain.length} levels):`, referrerChain);
    
    // Check existing referral transactions
    const query = { referredUser: userId };
    if (transactionId) {
      query.sourceTransaction = transactionId;
    }
    
    const existingReferrals = await ReferralTransaction.find(query).sort({ createdAt: -1 });
    console.log(`📋 Existing referral transactions: ${existingReferrals.length}`);
    
    existingReferrals.forEach((rt, index) => {
      console.log(`   ${index + 1}. Gen${rt.generation}, Amount: ${rt.amount} ${rt.currency}, Status: ${rt.status}, Beneficiary: ${rt.beneficiary}`);
    });
    
    // Check co-founder transactions
    if (transactionId) {
      const coFounderTx = await PaymentTransaction.findById(transactionId);
      if (coFounderTx) {
        console.log(`💰 Co-founder transaction details:`);
        console.log(`   Shares: ${coFounderTx.shares}, Amount: ${coFounderTx.amount} ${coFounderTx.currency}`);
        console.log(`   Status: ${coFounderTx.status}, Payment method: ${coFounderTx.paymentMethod}`);
      }
    }
    
    // Check site config
    const siteConfig = await SiteConfig.getCurrentConfig();
    console.log(`⚙️  Commission rates:`, siteConfig.referralCommission);
    
    return {
      user: {
        userName: user.userName,
        hasReferrer: !!user.referralInfo?.code,
        referrerCode: user.referralInfo?.code
      },
      referrerChain,
      existingReferrals: existingReferrals.length,
      commissionRates: siteConfig.referralCommission,
      transactions: existingReferrals.map(rt => ({
        generation: rt.generation,
        amount: rt.amount,
        currency: rt.currency,
        status: rt.status,
        createdAt: rt.createdAt
      }))
    };
    
  } catch (error) {
    console.error('❌ [DEBUG] Error in debug function:', error);
    return { error: error.message };
  }
};

/**
 * FIXED: Test referral processing function (for debugging)
 * @param {string} userId - User ID to test
 * @param {number} amount - Test amount
 * @param {string} purchaseType - Purchase type to test
 */
const testReferralProcessing = async (userId, amount = 1000, purchaseType = 'cofounder') => {
  try {
    console.log(`\n🧪 [TEST] Testing referral processing for user: ${userId}`);
    console.log(`💰 Test amount: ${amount}, Type: ${purchaseType}`);
    
    // Create a mock transaction for testing
    const mockTransaction = {
      _id: 'test_' + Date.now(),
      userId: userId,
      amount: amount,
      currency: 'naira',
      shares: purchaseType === 'cofounder' ? Math.floor(amount / 1000) : 0,
      type: purchaseType,
      status: 'completed'
    };
    
    console.log(`🎯 Mock transaction created:`, mockTransaction);
    
    // Test the referral processing
    const result = await processReferralCommission(
      userId,
      amount,
      purchaseType,
      mockTransaction._id
    );
    
    console.log(`📋 Test result:`, result);
    
    return {
      success: true,
      testResult: result,
      mockTransaction: mockTransaction
    };
    
  } catch (error) {
    console.error('❌ [TEST] Error in test function:', error);
    return { 
      success: false, 
      error: error.message 
    };
  }
};

/**
 * Get comprehensive referral statistics for a user
 * @param {string} userId - User ID
 */
const getComprehensiveReferralStats = async (userId) => {
  try {
    // Get basic referral stats
    const referralStats = await Referral.findOne({ user: userId });
    
    // Get all referral transactions (as beneficiary)
    const referralTransactions = await ReferralTransaction.find({
      beneficiary: userId,
      status: 'completed'
    }).sort({ createdAt: -1 });
    
    // Get user's share information
    const shareInfo = await getUserTotalShares(userId);
    
    // Calculate earnings by purchase type
    const earningsByType = await ReferralTransaction.aggregate([
      {
        $match: {
          beneficiary: userId,
          status: 'completed'
        }
      },
      {
        $group: {
          _id: '$purchaseType',
          totalEarnings: { $sum: '$amount' },
          transactionCount: { $sum: 1 }
        }
      }
    ]);
    
    // Get referred users details
    const referredUsers = await ReferralTransaction.aggregate([
      {
        $match: {
          beneficiary: userId,
          generation: 1,
          status: 'completed'
        }
      },
      {
        $group: {
          _id: '$referredUser',
          totalSpent: { $sum: '$commissionDetails.baseAmount' },
          transactionCount: { $sum: 1 },
          firstTransaction: { $min: '$createdAt' },
          lastTransaction: { $max: '$createdAt' }
        }
      },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'userInfo'
        }
      }
    ]);
    
    return {
      success: true,
      stats: {
        basic: referralStats || {
          referredUsers: 0,
          totalEarnings: 0,
          generation1: { count: 0, earnings: 0 },
          generation2: { count: 0, earnings: 0 },
          generation3: { count: 0, earnings: 0 }
        },
        transactions: {
          total: referralTransactions.length,
          recent: referralTransactions.slice(0, 10),
          byGeneration: {
            gen1: referralTransactions.filter(t => t.generation === 1).length,
            gen2: referralTransactions.filter(t => t.generation === 2).length,
            gen3: referralTransactions.filter(t => t.generation === 3).length
          }
        },
        earningsByType: earningsByType.reduce((acc, item) => {
          acc[item._id] = {
            earnings: item.totalEarnings,
            transactions: item.transactionCount
          };
          return acc;
        }, {}),
        referredUsers: referredUsers.map(user => ({
          userId: user._id,
          userName: user.userInfo[0]?.userName || 'Unknown',
          email: user.userInfo[0]?.email || 'Unknown',
          totalSpent: user.totalSpent,
          transactionCount: user.transactionCount,
          firstTransaction: user.firstTransaction,
          lastTransaction: user.lastTransaction
        })),
        shareInfo: shareInfo
      }
    };
    
  } catch (error) {
    console.error('Error getting comprehensive referral stats:', error);
    return {
      success: false,
      message: 'Failed to get comprehensive referral stats',
      error: error.message
    };
  }
};

// FIXED: Export all functions including new debug and test functions
module.exports = {
  processReferralCommission,
  processNewUserReferral,
  processCommission,
  syncReferralStats,
  calculateTotalEarnings,
  calculateTotalReferredUsers,
  rollbackReferralCommission,
  updateReferralStatsAfterRollback,
  getUserTotalShares,
  debugReferralData, // NEW: Debug function
  testReferralProcessing, // NEW: Test function
  getComprehensiveReferralStats, // NEW: Comprehensive stats function
  COFOUNDER_TO_SHARES_RATIO
};