// referralUtils.js - Updated to handle co-founder share conversion with existing system
const User = require('../models/User');
const Referral = require('../models/Referral');
const ReferralTransaction = require('../models/ReferralTransaction');
const UserShare = require('../models/UserShare');
const PaymentTransaction = require('../models/Transaction');
const SiteConfig = require('../models/SiteConfig');

// CONFIGURATION: 1 Co-founder share = 29 regular shares
const COFOUNDER_TO_SHARES_RATIO = 29;

/**
 * Process referral commissions for a transaction (Updated signature to match controller calls)
 * @param {string} userId - User ID who made the purchase 
 * @param {number} amount - Transaction amount
 * @param {string} purchaseType - Type of purchase (share, cofounder, etc.)
 * @param {string} transactionId - Transaction ID
 * @returns {object} - Processing result
 */
const processReferralCommission = async (
  userId,
  amount,
  purchaseType = 'share', 
  transactionId = null
) => {
  try {
    // Get the purchaser
    const purchaser = await User.findById(userId);
    if (!purchaser || !purchaser.referralInfo || !purchaser.referralInfo.code) {
      console.log('User has no referrer, skipping commission');
      return { success: false, message: 'User has no referrer' };
    }
    
    // Get site config for commission rates
    const siteConfig = await SiteConfig.getCurrentConfig();
    
    // Ensure commission rates exist and are set to the correct values
    if (!siteConfig.referralCommission) {
      siteConfig.referralCommission = {
        generation1: 15, // 15% for first generation
        generation2: 3,  // 3% for second generation
        generation3: 2   // 2% for third generation
      };
      await siteConfig.save();
      console.log('Created default commission rates: 15%, 3%, 2%');
    }
    
    const commissionRates = siteConfig.referralCommission;

    // Handle co-founder purchase amount calculation
    let effectivePurchaseAmount = amount;
    let currency = 'USD'; // Default currency
    
    if (purchaseType === 'cofounder') {
      // Get actual transaction to determine currency
      const transaction = await PaymentTransaction.findById(transactionId);
      if (transaction) {
        currency = transaction.currency === 'naira' ? 'naira' : 'usdt';
        
        console.log(`Processing co-founder referral commission: Amount: ${amount}, Currency: ${currency}`);
      }
    }
    
    console.log(`Processing referral commission for purchase: ${effectivePurchaseAmount} by user: ${purchaser.userName}`);
    console.log(`Purchase type: ${purchaseType}, Referral code: ${purchaser.referralInfo.code}`);
    
    // Find direct referrer (Generation 1)
    const gen1Referrer = await User.findOne({ userName: purchaser.referralInfo.code });
    
    if (!gen1Referrer) {
      console.log(`Referrer with username ${purchaser.referralInfo.code} not found`);
      return { success: false, message: 'Referrer not found' };
    }
    
    console.log(`Found Generation 1 referrer: ${gen1Referrer.userName}`);
    
    // Calculate and create Generation 1 commission
    const gen1Commission = (effectivePurchaseAmount * commissionRates.generation1) / 100;
    
    const gen1Transaction = new ReferralTransaction({
      beneficiary: gen1Referrer._id,
      referredUser: userId,
      amount: gen1Commission,
      currency: currency,
      generation: 1,
      purchaseType: purchaseType,
      sourceTransaction: transactionId,
      sourceTransactionModel: purchaseType === 'cofounder' ? 'PaymentTransaction' : 'UserShare',
      status: 'completed',
      createdAt: new Date()
    });
    
    await gen1Transaction.save();
    console.log(`Created Generation 1 commission: ${gen1Commission} for ${purchaseType} purchase`);
    
    // Update referrer stats
    let gen1Stats = await Referral.findOne({ user: gen1Referrer._id });
    
    if (!gen1Stats) {
      gen1Stats = new Referral({
        user: gen1Referrer._id,
        referredUsers: 1,
        totalEarnings: gen1Commission,
        generation1: { count: 1, earnings: gen1Commission },
        generation2: { count: 0, earnings: 0 },
        generation3: { count: 0, earnings: 0 }
      });
    } else {
      gen1Stats.totalEarnings += gen1Commission;
      gen1Stats.generation1.earnings += gen1Commission;
    }
    
    await gen1Stats.save();
    
    // Look for Generation 2 referrer
    if (gen1Referrer.referralInfo && gen1Referrer.referralInfo.code) {
      const gen2Referrer = await User.findOne({ userName: gen1Referrer.referralInfo.code });
      
      if (gen2Referrer) {
        console.log(`Found Generation 2 referrer: ${gen2Referrer.userName}`);
        
        // Calculate and create Generation 2 commission
        const gen2Commission = (effectivePurchaseAmount * commissionRates.generation2) / 100;
        
        const gen2Transaction = new ReferralTransaction({
          beneficiary: gen2Referrer._id,
          referredUser: userId,
          amount: gen2Commission,
          currency: currency,
          generation: 2,
          purchaseType: purchaseType,
          sourceTransaction: transactionId,
          sourceTransactionModel: purchaseType === 'cofounder' ? 'PaymentTransaction' : 'UserShare',
          status: 'completed',
          createdAt: new Date()
        });
        
        await gen2Transaction.save();
        console.log(`Created Generation 2 commission: ${gen2Commission} for ${purchaseType} purchase`);
        
        // Update gen2 stats
        let gen2Stats = await Referral.findOne({ user: gen2Referrer._id });
        
        if (!gen2Stats) {
          gen2Stats = new Referral({
            user: gen2Referrer._id,
            referredUsers: 0,
            totalEarnings: gen2Commission,
            generation1: { count: 0, earnings: 0 },
            generation2: { count: 1, earnings: gen2Commission },
            generation3: { count: 0, earnings: 0 }
          });
        } else {
          gen2Stats.totalEarnings += gen2Commission;
          gen2Stats.generation2.earnings += gen2Commission;
          gen2Stats.generation2.count += 1;
        }
        
        await gen2Stats.save();
        
        // Look for Generation 3 referrer
        if (gen2Referrer.referralInfo && gen2Referrer.referralInfo.code) {
          const gen3Referrer = await User.findOne({ userName: gen2Referrer.referralInfo.code });
          
          if (gen3Referrer) {
            console.log(`Found Generation 3 referrer: ${gen3Referrer.userName}`);
            
            // Calculate and create Generation 3 commission
            const gen3Commission = (effectivePurchaseAmount * commissionRates.generation3) / 100;
            
            const gen3Transaction = new ReferralTransaction({
              beneficiary: gen3Referrer._id,
              referredUser: userId,
              amount: gen3Commission,
              currency: currency,
              generation: 3,
              purchaseType: purchaseType,
              sourceTransaction: transactionId,
              sourceTransactionModel: purchaseType === 'cofounder' ? 'PaymentTransaction' : 'UserShare',
              status: 'completed',
              createdAt: new Date()
            });
            
            await gen3Transaction.save();
            console.log(`Created Generation 3 commission: ${gen3Commission} for ${purchaseType} purchase`);
            
            // Update gen3 stats
            let gen3Stats = await Referral.findOne({ user: gen3Referrer._id });
            
            if (!gen3Stats) {
              gen3Stats = new Referral({
                user: gen3Referrer._id,
                referredUsers: 0,
                totalEarnings: gen3Commission,
                generation1: { count: 0, earnings: 0 },
                generation2: { count: 0, earnings: 0 },
                generation3: { count: 1, earnings: gen3Commission }
              });
            } else {
              gen3Stats.totalEarnings += gen3Commission;
              gen3Stats.generation3.earnings += gen3Commission;
              gen3Stats.generation3.count += 1;
            }
            
            await gen3Stats.save();
          }
        }
      }
    }
    
    return { success: true };
  } catch (error) {
    console.error('Error processing referral commission:', error);
    return { success: false, message: error.message };
  }
};

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
 * Rollback referral commissions for a canceled transaction (Updated signature)
 * @param {string} userId - The user ID who made the purchase
 * @param {string} transactionId - The transaction ID
 * @param {number} amount - The transaction amount
 * @param {string} currency - The currency used (naira or usdt)
 * @param {string} purchaseType - The type of transaction (share, cofounder, etc.)
 * @param {string} sourceModel - The source model name
 * @returns {Promise<Object>} - Result of the rollback operation
 */
const rollbackReferralCommission = async (userId, transactionId, amount, currency, purchaseType, sourceModel) => {
  try {
    console.log(`Rolling back referral commissions for transaction: ${transactionId}`);
    
    // Find all referral transactions for this source transaction
    const referralTransactions = await ReferralTransaction.find({
      sourceTransaction: transactionId,
      sourceTransactionModel: sourceModel,
      status: 'completed'
    });
    
    console.log(`Found ${referralTransactions.length} referral transactions to rollback`);
    
    // Process each referral transaction
    for (const refTx of referralTransactions) {
      // Update referral stats for the beneficiary
      const referralStats = await Referral.findOne({ user: refTx.beneficiary });
      
      if (referralStats) {
        // Subtract earnings
        referralStats.totalEarnings = Math.max(0, referralStats.totalEarnings - refTx.amount);
        
        // Subtract from generation-specific earnings
        const generationKey = `generation${refTx.generation}`;
        if (referralStats[generationKey]) {
          referralStats[generationKey].earnings = Math.max(0, 
            referralStats[generationKey].earnings - refTx.amount
          );
        }
        
        await referralStats.save();
      }
      
      // Mark referral transaction as rolled back
      refTx.status = 'rolled_back';
      refTx.rolledBackAt = new Date();
      await refTx.save();
    }
    
    return {
      success: true,
      message: `Rolled back ${referralTransactions.length} referral commissions`,
      rolledBackCount: referralTransactions.length
    };
  } catch (error) {
    console.error('Error rolling back referral commissions:', error);
    return {
      success: false,
      message: error.message
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

// Export functions (keeping all existing exports and adding new ones)
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
  COFOUNDER_TO_SHARES_RATIO
};