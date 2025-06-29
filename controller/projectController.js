// controller/projectController.js

// Add these imports at the top of the file
const Share = require('../models/Share');
const CoFounderShare = require('../models/CoFounderShare');
const User = require('../models/User');
const UserShare = require('../models/UserShare');
const PaymentTransaction = require('../models/Transaction');
const Referral = require('../models/Referral');

/**
 * @desc    Get overall project statistics
 * @route   GET /api/project/stats
 * @access  Public
 */
exports.getProjectStats = async (req, res) => {
  try {
    // Get share configurations
    const shareConfig = await Share.getCurrentConfig();
    const cofounderShareConfig = await CoFounderShare.findOne();
    
    // Get the share-to-regular ratio
    const shareToRegularRatio = cofounderShareConfig?.shareToRegularRatio || 29;
    
    // CRITICAL FIX: Calculate ACTUALLY VERIFIED co-founder shares
    // Don't trust the cofounderShareConfig.sharesSold - verify from actual completed transactions
    const PaymentTransaction = require('../models/Transaction');
    
    // Get all COMPLETED co-founder transactions from PaymentTransaction model
    const completedCoFounderTransactions = await PaymentTransaction.find({
      type: 'co-founder',
      status: 'completed'  // Only count truly verified transactions
    });
    
    // Calculate actual verified co-founder shares sold
    const actualCoFounderSharesSold = completedCoFounderTransactions.reduce((total, tx) => {
      return total + (tx.shares || 0);
    }, 0);
    
    console.log('=== PROJECT STATS DEBUG ===');
    console.log(`CoFounder config sharesSold: ${cofounderShareConfig?.sharesSold || 0}`);
    console.log(`Actual verified co-founder shares: ${actualCoFounderSharesSold}`);
    console.log(`Completed co-founder transactions: ${completedCoFounderTransactions.length}`);
    
    // Calculate equivalent regular shares from VERIFIED co-founder purchases
    const equivalentRegularSharesFromCoFounder = actualCoFounderSharesSold * shareToRegularRatio;
    
    // Get user counts
    const totalUsers = await User.countDocuments();
    
    // CORRECTED: Count shareholders based on ACTUALLY OWNED shares
    // Need to aggregate from UserShare transactions with proper verification
    const userSharesAgg = await UserShare.aggregate([
      {
        $addFields: {
          // Calculate actual owned shares for each user
          actualOwnedShares: {
            $reduce: {
              input: "$transactions",
              initialValue: 0,
              in: {
                $cond: {
                  if: { $eq: ["$$this.status", "completed"] },
                  then: {
                    $cond: {
                      if: { $eq: ["$$this.paymentMethod", "co-founder"] },
                      // For co-founder transactions, we need to verify against PaymentTransaction
                      // For now, we'll be conservative and not count them unless explicitly verified
                      then: "$$value", // Don't count co-founder shares here - we'll handle separately
                      else: { $add: ["$$value", { $ifNull: ["$$this.shares", 0] }] }
                    }
                  },
                  else: "$$value"
                }
              }
            }
          },
          // Calculate co-founder shares (need separate verification)
          coFounderSharesFromUserShare: {
            $reduce: {
              input: "$transactions",
              initialValue: 0,
              in: {
                $cond: {
                  if: { 
                    $and: [
                      { $eq: ["$$this.status", "completed"] },
                      { $eq: ["$$this.paymentMethod", "co-founder"] }
                    ]
                  },
                  then: { $add: ["$$value", { $ifNull: ["$$this.coFounderShares", { $ifNull: ["$$this.shares", 0] }] }] },
                  else: "$$value"
                }
              }
            }
          }
        }
      }
    ]);
    
    // Now we need to verify co-founder shares against PaymentTransaction
    let totalVerifiedCoFounderSharesAcrossUsers = 0;
    let totalRegularSharesAcrossUsers = 0;
    let usersWithRegularShares = 0;
    let usersWithCoFounderShares = 0;
    let totalShareHolders = 0;
    
    for (const userShare of userSharesAgg) {
      const userId = userShare.user;
      
      // Get regular shares (already verified from UserShare)
      const regularShares = userShare.actualOwnedShares || 0;
      if (regularShares > 0) {
        usersWithRegularShares++;
        totalRegularSharesAcrossUsers += regularShares;
      }
      
      // Verify co-founder shares against PaymentTransaction
      const userCoFounderTx = await PaymentTransaction.find({
        userId: userId,
        type: 'co-founder',
        status: 'completed'
      });
      
      const verifiedCoFounderShares = userCoFounderTx.reduce((sum, tx) => sum + (tx.shares || 0), 0);
      
      if (verifiedCoFounderShares > 0) {
        usersWithCoFounderShares++;
        totalVerifiedCoFounderSharesAcrossUsers += verifiedCoFounderShares;
      }
      
      // Count as shareholder if they have any verified shares
      if (regularShares > 0 || verifiedCoFounderShares > 0) {
        totalShareHolders++;
      }
    }
    
    console.log(`Total regular shares across users: ${totalRegularSharesAcrossUsers}`);
    console.log(`Total verified co-founder shares across users: ${totalVerifiedCoFounderSharesAcrossUsers}`);
    console.log(`Users with regular shares: ${usersWithRegularShares}`);
    console.log(`Users with co-founder shares: ${usersWithCoFounderShares}`);
    console.log(`Total shareholders: ${totalShareHolders}`);
    
    // CORRECTED: Use actual verified numbers instead of config numbers
    const totalDirectSharesSold = shareConfig.sharesSold; // This should match totalRegularSharesAcrossUsers
    const totalEffectiveSharesSold = totalRegularSharesAcrossUsers + equivalentRegularSharesFromCoFounder;
    const totalEffectiveSharesAvailable = shareConfig.totalShares - totalEffectiveSharesSold;
    
    // Calculate tier availability after co-founder allocations
    let remainingCoFounderShares = equivalentRegularSharesFromCoFounder;
    let coFounderAllocatedToTier1 = 0;
    let coFounderAllocatedToTier2 = 0;
    let coFounderAllocatedToTier3 = 0;
    
    // Allocate co-founder equivalent shares starting from tier1
    if (remainingCoFounderShares > 0) {
      const tier1Available = shareConfig.currentPrices.tier1.shares - shareConfig.tierSales.tier1Sold;
      coFounderAllocatedToTier1 = Math.min(remainingCoFounderShares, tier1Available);
      remainingCoFounderShares -= coFounderAllocatedToTier1;
    }
    
    if (remainingCoFounderShares > 0) {
      const tier2Available = shareConfig.currentPrices.tier2.shares - shareConfig.tierSales.tier2Sold;
      coFounderAllocatedToTier2 = Math.min(remainingCoFounderShares, tier2Available);
      remainingCoFounderShares -= coFounderAllocatedToTier2;
    }
    
    if (remainingCoFounderShares > 0) {
      const tier3Available = shareConfig.currentPrices.tier3.shares - shareConfig.tierSales.tier3Sold;
      coFounderAllocatedToTier3 = Math.min(remainingCoFounderShares, tier3Available);
      remainingCoFounderShares -= coFounderAllocatedToTier3;
    }
    
    // Calculate total values based on ACTUAL sales
    const regularShareValueNaira = 
      (shareConfig.tierSales.tier1Sold * shareConfig.currentPrices.tier1.priceNaira) +
      (shareConfig.tierSales.tier2Sold * shareConfig.currentPrices.tier2.priceNaira) +
      (shareConfig.tierSales.tier3Sold * shareConfig.currentPrices.tier3.priceNaira);
    
    const regularShareValueUSDT = 
      (shareConfig.tierSales.tier1Sold * shareConfig.currentPrices.tier1.priceUSDT) +
      (shareConfig.tierSales.tier2Sold * shareConfig.currentPrices.tier2.priceUSDT) +
      (shareConfig.tierSales.tier3Sold * shareConfig.currentPrices.tier3.priceUSDT);
    
    // Calculate co-founder value based on ACTUAL verified sales
    const cofounderValueNaira = cofounderShareConfig ? 
      cofounderShareConfig.pricing.priceNaira * actualCoFounderSharesSold : 0;
    const cofounderValueUSDT = cofounderShareConfig ? 
      cofounderShareConfig.pricing.priceUSDT * actualCoFounderSharesSold : 0;
    
    const totalValueNaira = regularShareValueNaira + cofounderValueNaira;
    const totalValueUSDT = regularShareValueUSDT + cofounderValueUSDT;
    
    // Calculate actual tier availability
    const tierAvailability = {
      tier1: Math.max(0, shareConfig.currentPrices.tier1.shares - shareConfig.tierSales.tier1Sold - coFounderAllocatedToTier1),
      tier2: Math.max(0, shareConfig.currentPrices.tier2.shares - shareConfig.tierSales.tier2Sold - coFounderAllocatedToTier2),
      tier3: Math.max(0, shareConfig.currentPrices.tier3.shares - shareConfig.tierSales.tier3Sold - coFounderAllocatedToTier3)
    };
    
    res.status(200).json({
      success: true,
      stats: {
        users: {
          total: totalUsers,
          totalShareHolders: totalShareHolders, // CORRECTED: Based on actual ownership
          regularShareHolders: usersWithRegularShares,
          cofounderShareHolders: usersWithCoFounderShares
        },
        regularShares: {
          directSold: totalDirectSharesSold,
          actualSoldToUsers: totalRegularSharesAcrossUsers, // NEW: What users actually own
          available: tierAvailability.tier1 + tierAvailability.tier2 + tierAvailability.tier3,
          total: shareConfig.totalShares,
          tierSales: shareConfig.tierSales,
          tierAvailability: tierAvailability
        },
        cofounderShares: {
          configSold: cofounderShareConfig?.sharesSold || 0, // What config says
          actualSold: actualCoFounderSharesSold, // CORRECTED: What's actually verified
          actualOwnedByUsers: totalVerifiedCoFounderSharesAcrossUsers, // What users actually own
          available: cofounderShareConfig ? cofounderShareConfig.totalShares - actualCoFounderSharesSold : 0,
          total: cofounderShareConfig ? cofounderShareConfig.totalShares : 0,
          equivalentRegularShares: equivalentRegularSharesFromCoFounder,
          shareToRegularRatio: shareToRegularRatio
        },
        combinedAnalysis: {
          totalEffectiveSharesSold: totalEffectiveSharesSold,
          totalEffectiveSharesAvailable: totalEffectiveSharesAvailable,
          percentageSold: ((totalEffectiveSharesSold / shareConfig.totalShares) * 100).toFixed(2),
          cofounderAllocation: {
            tier1: coFounderAllocatedToTier1,
            tier2: coFounderAllocatedToTier2,
            tier3: coFounderAllocatedToTier3
          },
          // NEW: Reality check
          realityCheck: {
            regularShareDiscrepancy: totalDirectSharesSold - totalRegularSharesAcrossUsers,
            coFounderShareDiscrepancy: (cofounderShareConfig?.sharesSold || 0) - actualCoFounderSharesSold,
            explanation: totalDirectSharesSold !== totalRegularSharesAcrossUsers || 
                        (cofounderShareConfig?.sharesSold || 0) !== actualCoFounderSharesSold ?
              "There are discrepancies between config and actual verified ownership" :
              "Config matches actual verified ownership"
          }
        },
        totalValues: {
          naira: {
            regularShares: regularShareValueNaira,
            cofounderShares: cofounderValueNaira, // CORRECTED: Based on actual sales
            total: totalValueNaira
          },
          usdt: {
            regularShares: regularShareValueUSDT,
            cofounderShares: cofounderValueUSDT, // CORRECTED: Based on actual sales
            total: totalValueUSDT
          }
        },
        // NEW: Debugging info
        debug: {
          completedCoFounderTransactions: completedCoFounderTransactions.length,
          configVsActualCoFounder: {
            config: cofounderShareConfig?.sharesSold || 0,
            actual: actualCoFounderSharesSold,
            difference: (cofounderShareConfig?.sharesSold || 0) - actualCoFounderSharesSold
          },
          userAggregationResults: {
            totalUsersProcessed: userSharesAgg.length,
            totalRegularShares: totalRegularSharesAcrossUsers,
            totalVerifiedCoFounderShares: totalVerifiedCoFounderSharesAcrossUsers
          }
        }
      }
    });
  } catch (error) {
    console.error('Error fetching project stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch project statistics',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Get user-specific project statistics
 * @route   GET /api/project/user-stats
 * @access  Private
 */
exports.getUserProjectStats = async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Get user's share data using the corrected model
    const userShares = await UserShare.findOne({ user: userId });
    
    // Get share breakdown
    const shareBreakdown = userShares ? userShares.getShareBreakdown() : {
      directRegularShares: 0,
      coFounderShares: 0,
      equivalentRegularShares: 0,
      totalEffectiveShares: 0
    };
    
    // Get user's transaction history
    const regularTransactions = userShares ? 
      userShares.transactions.filter(t => t.status === 'completed' && t.paymentMethod !== 'co-founder').length : 0;
    
    const cofounderTransactions = userShares ? 
      userShares.transactions.filter(t => t.status === 'completed' && t.paymentMethod === 'co-founder').length : 0;
    
    // Calculate total investment value
    let totalInvestmentNaira = 0;
    let totalInvestmentUSDT = 0;
    
    if (userShares) {
      for (const transaction of userShares.transactions) {
        if (transaction.status === 'completed') {
          if (transaction.currency === 'naira') {
            totalInvestmentNaira += transaction.totalAmount;
          } else if (transaction.currency === 'usdt') {
            totalInvestmentUSDT += transaction.totalAmount;
          }
        }
      }
    }
    
    // Get referral stats
    const referralStats = await Referral.findOne({ user: userId }) || { 
      totalEarnings: 0, 
      referredUsers: 0,
      generation1: { count: 0, earnings: 0 },
      generation2: { count: 0, earnings: 0 },
      generation3: { count: 0, earnings: 0 }
    };
    
    // Get current co-founder ratio for equivalence calculations
    const cofounderConfig = await CoFounderShare.findOne();
    const shareToRegularRatio = cofounderConfig?.shareToRegularRatio || 29;
    
    // Calculate co-founder equivalence
    const totalEquivalentCoFounderShares = Math.floor(shareBreakdown.totalEffectiveShares / shareToRegularRatio);
    const remainingRegularShares = shareBreakdown.totalEffectiveShares % shareToRegularRatio;
    
    res.status(200).json({
      success: true,
      stats: {
        shares: {
          direct: shareBreakdown.directRegularShares,
          cofounder: shareBreakdown.coFounderShares,
          equivalentFromCofounder: shareBreakdown.equivalentRegularShares,
          totalEffective: shareBreakdown.totalEffectiveShares,
          cofounderEquivalence: {
            equivalentCoFounderShares: totalEquivalentCoFounderShares,
            remainingRegularShares: remainingRegularShares,
            shareToRegularRatio: shareToRegularRatio,
            explanation: totalEquivalentCoFounderShares > 0 ? 
              `Your ${shareBreakdown.totalEffectiveShares} total shares = ${totalEquivalentCoFounderShares} co-founder equivalent${totalEquivalentCoFounderShares !== 1 ? 's' : ''}${remainingRegularShares > 0 ? ` + ${remainingRegularShares} regular` : ''}` :
              shareBreakdown.totalEffectiveShares > 0 ? 
                `Your ${shareBreakdown.totalEffectiveShares} shares (need ${shareToRegularRatio - shareBreakdown.totalEffectiveShares} more for 1 co-founder equivalent)` :
                'No shares yet'
          }
        },
        transactions: {
          regular: regularTransactions,
          cofounder: cofounderTransactions,
          total: regularTransactions + cofounderTransactions
        },
        investment: {
          totalNaira: totalInvestmentNaira,
          totalUSDT: totalInvestmentUSDT
        },
        referrals: {
          totalReferred: referralStats.referredUsers || 0,
          totalEarnings: referralStats.totalEarnings || 0,
          generation1: referralStats.generation1 || { count: 0, earnings: 0 },
          generation2: referralStats.generation2 || { count: 0, earnings: 0 },
          generation3: referralStats.generation3 || { count: 0, earnings: 0 }
        }
      }
    });
  } catch (error) {
    console.error('Error fetching user project stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch user project statistics',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Get detailed project analytics (Admin only)
 * @route   GET /api/project/analytics
 * @access  Private (Admin)
 */
exports.getProjectAnalytics = async (req, res) => {
  try {
    const adminId = req.user.id;
    
    // Check if admin
    const admin = await User.findById(adminId);
    if (!admin || !admin.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized: Admin access required'
      });
    }
    
    // Use the comprehensive stats from Share model
    const shareStats = await Share.getComprehensiveStats();
    
    // Get payment method breakdown
    const paymentMethodStats = await UserShare.aggregate([
      { $unwind: '$transactions' },
      { $match: { 'transactions.status': 'completed' } },
      {
        $group: {
          _id: '$transactions.paymentMethod',
          count: { $sum: 1 },
          totalAmount: { $sum: '$transactions.totalAmount' },
          totalShares: { $sum: '$transactions.shares' }
        }
      }
    ]);
    
    // Get co-founder payment method breakdown
    const cofounderPaymentStats = await PaymentTransaction.aggregate([
      { $match: { type: 'co-founder', status: 'completed' } },
      {
        $group: {
          _id: '$paymentMethod',
          count: { $sum: 1 },
          totalAmount: { $sum: '$amount' },
          totalShares: { $sum: '$shares' }
        }
      }
    ]);
    
    // Get user growth over time (last 12 months)
    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
    
    const userGrowth = await User.aggregate([
      { $match: { createdAt: { $gte: twelveMonthsAgo } } },
      {
        $group: {
          _id: {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' }
          },
          count: { $sum: 1 }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } }
    ]);
    
    res.status(200).json({
      success: true,
      analytics: {
        shareStats,
        paymentMethods: {
          regular: paymentMethodStats,
          cofounder: cofounderPaymentStats
        },
        userGrowth
      }
    });
  } catch (error) {
    console.error('Error fetching project analytics:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch project analytics',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};