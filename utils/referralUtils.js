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
    const commissionRates = siteConfig.referralCommission;
    
    if (!commissionRates) {
      return {
        success: false,
        message: 'Commission rates not configured'
      };
    }
    
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
      referral.referredUsers = await calculateTotalReferredUsers(beneficiaryId);
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

// Export functions
module.exports = {
  processReferralCommission,
  processCommission,
  syncReferralStats,
  calculateTotalEarnings,
  calculateTotalReferredUsers
};