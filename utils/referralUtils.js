// referralUtils.js
const User = require('../models/User');
const Referral = require('../models/Referral');
const ReferralTransaction = require('../models/ReferralTransaction');
const UserShare = require('../models/UserShare');
const PaymentTransaction = require('../models/Transaction');
const SiteConfig = require('../models/SiteConfig');

/**
 * Process referral commissions for a transaction
 * @param {string} userId - User ID who made the purchase 
 * @param {string} transactionId - Transaction ID
 * @param {number} amount - Transaction amount
 * @param {string} currency - Currency (naira or usdt)
 * @param {string} purchaseType - Type of purchase (share, cofounder, etc.)
 * @param {string} sourceModel - Source model for the transaction
 * @returns {object} - Processing result
 */
const processReferralCommission = async (
  userId,
  transactionId,
  amount,
  currency,
  purchaseType,
  sourceModel
) => {
  try {
    // First check if transaction is completed
    let transactionStatus = 'unknown';
    
    // Check transaction status based on sourceModel
    if (sourceModel === 'UserShare') {
      const userShare = await UserShare.findOne({
        'transactions.transactionId': transactionId
      });
      
      if (userShare) {
        const transaction = userShare.transactions.find(
          t => t.transactionId === transactionId || t.txHash === transactionId
        );
        
        if (transaction) {
          transactionStatus = transaction.status;
          if (transaction.status !== 'completed') {
            console.log(`Skipping referral processing for non-completed transaction: ${transactionId}`);
            return {
              success: false,
              message: 'Transaction not completed, referral commission not processed'
            };
          }
        } else {
          console.log(`Transaction not found in UserShare: ${transactionId}`);
          return {
            success: false,
            message: 'Transaction not found in UserShare'
          };
        }
      } else {
        console.log(`UserShare record not found for transaction: ${transactionId}`);
        return {
          success: false,
          message: 'UserShare record not found'
        };
      }
    } else if (sourceModel === 'PaymentTransaction') {
      const transaction = await PaymentTransaction.findById(transactionId);
      
      if (transaction) {
        transactionStatus = transaction.status;
        if (transaction.status !== 'completed') {
          console.log(`Skipping referral processing for non-completed payment: ${transactionId}`);
          return {
            success: false,
            message: 'Payment not completed, referral commission not processed'
          };
        }
      } else {
        console.log(`PaymentTransaction not found: ${transactionId}`);
        return {
          success: false,
          message: 'PaymentTransaction not found'
        };
      }
    }
    
    console.log(`Processing referral commission for ${sourceModel} transaction ${transactionId} with status ${transactionStatus}`);
    
    // Find the user who made the purchase
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
    
    // Find referrer (Gen 1)
    const referrer = await User.findOne({ userName: user.referralInfo.code });
    
    if (!referrer) {
      return {
        success: false,
        message: 'Referrer not found'
      };
    }
    
    // Get commission rates from site config
    const siteConfig = await SiteConfig.getCurrentConfig();
    
    // Ensure commission rates exist and are set to the correct values
    if (!siteConfig.referralCommission) {
      // Set default values if they don't exist
      siteConfig.referralCommission = {
        generation1: 15, // 15% for first generation
        generation2: 3,  // 3% for second generation
        generation3: 2   // 2% for third generation
      };
      await siteConfig.save();
      console.log('Created default commission rates: 15%, 3%, 2%');
    } else {
      // Check if rates match expected values, update if needed
      const expectedRates = {
        generation1: 15,
        generation2: 3,
        generation3: 2
      };
      
      let ratesChanged = false;
      
      if (siteConfig.referralCommission.generation1 !== expectedRates.generation1) {
        siteConfig.referralCommission.generation1 = expectedRates.generation1;
        ratesChanged = true;
      }
      
      if (siteConfig.referralCommission.generation2 !== expectedRates.generation2) {
        siteConfig.referralCommission.generation2 = expectedRates.generation2;
        ratesChanged = true;
      }
      
      if (siteConfig.referralCommission.generation3 !== expectedRates.generation3) {
        siteConfig.referralCommission.generation3 = expectedRates.generation3;
        ratesChanged = true;
      }
      
      if (ratesChanged) {
        await siteConfig.save();
        console.log('Updated commission rates to: 15%, 3%, 2%');
      }
    }
    
    const commissionRates = siteConfig.referralCommission;
    
    console.log('Using commission rates:', commissionRates);
    
    // Process Gen 1 commission (direct referrer)
    await processCommission(
      referrer._id,
      userId,
      amount,
      currency,
      commissionRates.generation1,
      1,
      purchaseType,
      transactionId,
      sourceModel
    );
    
    // Find Gen 2 referrer (who referred the referrer)
    if (referrer.referralInfo && referrer.referralInfo.code) {
      const gen2Referrer = await User.findOne({ userName: referrer.referralInfo.code });
      
      if (gen2Referrer) {
        await processCommission(
          gen2Referrer._id,
          userId,
          amount,
          currency,
          commissionRates.generation2,
          2,
          purchaseType,
          transactionId,
          sourceModel
        );
        
        // Find Gen 3 referrer
        if (gen2Referrer.referralInfo && gen2Referrer.referralInfo.code) {
          const gen3Referrer = await User.findOne({ userName: gen2Referrer.referralInfo.code });
          
          if (gen3Referrer) {
            await processCommission(
              gen3Referrer._id,
              userId,
              amount,
              currency,
              commissionRates.generation3,
              3,
              purchaseType,
              transactionId,
              sourceModel
            );
          }
        }
      }
    }
    
    return {
      success: true,
      message: 'Referral commissions processed successfully'
    };
  } catch (error) {
    console.error('Error processing referral commission:', error);
    return {
      success: false,
      message: 'Error processing referral commission',
      error: error.message
    };
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
 * Process commission for a single referrer
 * @param {string} beneficiaryId - Referrer ID who receives the commission
 * @param {string} referredUserId - User who made the purchase
 * @param {number} amount - Transaction amount
 * @param {string} currency - Currency (naira or usdt)
 * @param {number} commissionRate - Commission rate percentage
 * @param {number} generation - Referral generation (1, 2, or 3)
 * @param {string} purchaseType - Type of purchase
 * @param {string} sourceTransaction - Original transaction ID
 * @param {string} sourceTransactionModel - Source model for the transaction
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
  sourceTransactionModel
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
    
    // Create referral transaction record
    const transaction = new ReferralTransaction({
      beneficiary: beneficiaryId,
      referredUser: referredUserId,
      amount: commissionAmount,
      currency,
      generation,
      purchaseType,
      sourceTransaction,
      sourceTransactionModel,
      status: 'completed' // Mark commission as completed immediately
    });
    
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
 * Rollback referral commissions for a canceled transaction
 * @param {string} userId - The user ID who made the purchase
 * @param {string} transactionId - The transaction ID
 * @param {number} amount - The transaction amount
 * @param {string} currency - The currency used (naira or usdt)
 * @param {string} purchaseType - The type of transaction (share, etc.)
 * @param {string} sourceModel - The source model name
 * @returns {Promise<Object>} - Result of the rollback operation
 */
const rollbackReferralCommission = async (userId, transactionId, amount, currency, purchaseType, sourceModel) => {
  try {
    // Check if user exists and was referred
    const user = await User.findById(userId);
    
    if (!user || !user.referralInfo || !user.referralInfo.code) {
      return {
        success: true,
        message: 'No referral to rollback'
      };
    }
    
    // Find the referral transactions that need to be rolled back
    const referralTransactions = await ReferralTransaction.find({
      sourceTransaction: transactionId,
      sourceTransactionModel: sourceModel,
      status: 'completed'
    });
    
    if (!referralTransactions || referralTransactions.length === 0) {
      return {
        success: true,
        message: 'No referral transactions found for this transaction'
      };
    }
    
    console.log(`Found ${referralTransactions.length} referral transactions to rollback for transaction ${transactionId}`);
    
    // For each referral transaction, rollback the commission
    for (const referralTx of referralTransactions) {
      // Mark the transaction as rolled back
      referralTx.status = 'rolled_back';
      referralTx.notes = `Rolled back due to transaction cancellation on ${new Date().toISOString()}`;
      await referralTx.save();
      
      // Update referral stats for the beneficiary
      await updateReferralStatsAfterRollback(
        referralTx.beneficiary,
        referralTx.amount,
        referralTx.generation
      );
    }
    
    return {
      success: true,
      message: `Successfully rolled back ${referralTransactions.length} referral commission(s)`,
      rollbackCount: referralTransactions.length
    };
  } catch (error) {
    console.error('Error rolling back referral commission:', error);
    return {
      success: false,
      message: `Failed to rollback referral commission: ${error.message}`
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

// Export functions
module.exports = {
  processReferralCommission,
  processNewUserReferral, // Added this function export
  processCommission,
  syncReferralStats,
  calculateTotalEarnings,
  calculateTotalReferredUsers,
  rollbackReferralCommission,
  updateReferralStatsAfterRollback
};