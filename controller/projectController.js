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
    // Run all independent queries in parallel
    const [shareConfig, cofounderShareConfig, totalUsers, cofounderTxAgg, userShareStats] = await Promise.all([
      Share.getCurrentConfig(),
      CoFounderShare.findOne(),
      User.countDocuments(),
      // Aggregate co-founder transactions in ONE query instead of N+1
      PaymentTransaction.aggregate([
        { $match: { type: 'co-founder', status: 'completed' } },
        {
          $group: {
            _id: null,
            totalShares: { $sum: { $ifNull: ['$shares', 0] } },
            count: { $sum: 1 },
            uniqueUsers: { $addToSet: '$userId' }
          }
        }
      ]),
      // Aggregate user shares in ONE query
      UserShare.aggregate([
        { $unwind: '$transactions' },
        { $match: { 'transactions.status': 'completed' } },
        {
          $group: {
            _id: '$user',
            regularShares: {
              $sum: {
                $cond: [
                  { $ne: ['$transactions.paymentMethod', 'co-founder'] },
                  { $ifNull: ['$transactions.shares', 0] },
                  0
                ]
              }
            },
            cofounderShares: {
              $sum: {
                $cond: [
                  { $eq: ['$transactions.paymentMethod', 'co-founder'] },
                  { $ifNull: ['$transactions.coFounderShares', { $ifNull: ['$transactions.shares', 0] }] },
                  0
                ]
              }
            }
          }
        },
        {
          $group: {
            _id: null,
            totalRegularShares: { $sum: '$regularShares' },
            totalCofounderShares: { $sum: '$cofounderShares' },
            usersWithRegular: { $sum: { $cond: [{ $gt: ['$regularShares', 0] }, 1, 0] } },
            usersWithCofounder: { $sum: { $cond: [{ $gt: ['$cofounderShares', 0] }, 1, 0] } },
            totalShareholders: { $sum: 1 }
          }
        }
      ])
    ]);

    const shareToRegularRatio = cofounderShareConfig?.shareToRegularRatio || 29;

    // Extract aggregation results
    const cfAgg = cofounderTxAgg[0] || { totalShares: 0, count: 0, uniqueUsers: [] };
    const actualCoFounderSharesSold = cfAgg.totalShares;
    const equivalentRegularSharesFromCoFounder = actualCoFounderSharesSold * shareToRegularRatio;

    const usAgg = userShareStats[0] || { totalRegularShares: 0, totalCofounderShares: 0, usersWithRegular: 0, usersWithCofounder: 0, totalShareholders: 0 };

    const totalDirectSharesSold = shareConfig.sharesSold;
    const totalEffectiveSharesSold = usAgg.totalRegularShares + equivalentRegularSharesFromCoFounder;
    const totalEffectiveSharesAvailable = shareConfig.totalShares - totalEffectiveSharesSold;

    // Calculate tier availability
    let remainingCF = equivalentRegularSharesFromCoFounder;
    const tiers = ['tier1', 'tier2', 'tier3'];
    const cfAlloc = { tier1: 0, tier2: 0, tier3: 0 };

    for (const tier of tiers) {
      if (remainingCF <= 0) break;
      const available = shareConfig.currentPrices[tier].shares - shareConfig.tierSales[`${tier}Sold`];
      cfAlloc[tier] = Math.min(remainingCF, available);
      remainingCF -= cfAlloc[tier];
    }

    const tierAvailability = {};
    for (const tier of tiers) {
      tierAvailability[tier] = Math.max(0, shareConfig.currentPrices[tier].shares - shareConfig.tierSales[`${tier}Sold`] - cfAlloc[tier]);
    }

    // Calculate values
    const regularShareValueNaira = tiers.reduce((sum, t) => sum + shareConfig.tierSales[`${t}Sold`] * shareConfig.currentPrices[t].priceNaira, 0);
    const regularShareValueUSDT = tiers.reduce((sum, t) => sum + shareConfig.tierSales[`${t}Sold`] * shareConfig.currentPrices[t].priceUSDT, 0);
    const cofounderValueNaira = cofounderShareConfig ? cofounderShareConfig.pricing.priceNaira * actualCoFounderSharesSold : 0;
    const cofounderValueUSDT = cofounderShareConfig ? cofounderShareConfig.pricing.priceUSDT * actualCoFounderSharesSold : 0;

    // Get new tier config for percentage display
    const tierConfig = Share.getTierConfig();

    res.status(200).json({
      success: true,
      stats: {
        users: {
          total: totalUsers,
          totalShareHolders: usAgg.totalShareholders,
          regularShareHolders: usAgg.usersWithRegular
        },
        shares: {
          totalPercentageSold: shareConfig.totalPercentageSold || 0,
          tierSales: shareConfig.tierSales,
          tiers: tierConfig
        },
        combinedAnalysis: {
          totalEffectiveSharesSold,
          totalEffectiveSharesAvailable,
          percentageSold: ((totalEffectiveSharesSold / shareConfig.totalShares) * 100).toFixed(2)
        },
        totalValues: {
          naira: { total: regularShareValueNaira + cofounderValueNaira },
          usdt: { total: regularShareValueUSDT + cofounderValueUSDT }
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
    
    // Get user's share data
    const userShares = await UserShare.findOne({ user: userId });
    
    if (!userShares) {
      return res.status(200).json({
        success: true,
        stats: {
          shares: {
            direct: 0,
            cofounder: 0,
            equivalentFromCofounder: 0,
            totalEffective: 0,
            pending: {
              directPending: 0,
              cofounderPending: 0,
              equivalentPendingFromCofounder: 0,
              totalPending: 0
            },
            cofounderEquivalence: {
              equivalentCoFounderShares: 0,
              remainingRegularShares: 0,
              shareToRegularRatio: 29,
              explanation: "No shares yet"
            }
          },
          transactions: {
            regular: 0,
            cofounder: 0,
            total: 0,
            pending: 0,
            completed: 0
          },
          investment: {
            totalNaira: 0,
            totalUSDT: 0
          },
          referrals: {
            totalReferred: 0,
            totalEarnings: 0,
            generation1: { count: 0, earnings: 0 },
            generation2: { count: 0, earnings: 0 },
            generation3: { count: 0, earnings: 0 }
          }
        }
      });
    }
    
    // Get co-founder transactions from PaymentTransaction model for verification
    const PaymentTransaction = require('../models/Transaction');
    const coFounderPaymentTransactions = await PaymentTransaction.find({
      userId: userId,
      type: 'co-founder'
    });
    
    console.log('=== USER PROJECT STATS DEBUG ===');
    console.log(`User ID: ${userId}`);
    console.log(`UserShare transactions: ${userShares.transactions.length}`);
    console.log(`PaymentTransaction co-founder: ${coFounderPaymentTransactions.length}`);
    
    // Get current co-founder ratio
    const cofounderConfig = await CoFounderShare.findOne();
    const shareToRegularRatio = cofounderConfig?.shareToRegularRatio || 29;
    
    // CORRECTED CALCULATION: Verify each transaction properly
    let directRegularShares = 0;           // Owned regular shares
    let coFounderShares = 0;               // Owned co-founder shares
    let pendingDirectRegularShares = 0;    // Pending regular shares
    let pendingCoFounderShares = 0;        // Pending co-founder shares
    
    let regularTransactions = 0;
    let cofounderTransactions = 0;
    let completedTransactions = 0;
    let pendingTransactions = 0;
    
    let totalInvestmentNaira = 0;
    let totalInvestmentUSDT = 0;
    
    // Process each transaction with proper verification
    userShares.transactions.forEach((transaction, index) => {
      console.log(`\n--- Transaction ${index + 1} ---`);
      console.log(`ID: ${transaction.transactionId}`);
      console.log(`Method: ${transaction.paymentMethod}`);
      console.log(`UserShare Status: ${transaction.status}`);
      console.log(`Shares: ${transaction.shares}`);
      console.log(`CoFounder Shares: ${transaction.coFounderShares || 'N/A'}`);
      
      if (transaction.paymentMethod === 'co-founder') {
        // Co-founder transaction - verify against PaymentTransaction
        cofounderTransactions++;
        
        const paymentTx = coFounderPaymentTransactions.find(
          pt => pt.transactionId === transaction.transactionId || 
                pt._id.toString() === transaction.transactionId
        );
        
        const actualStatus = paymentTx ? paymentTx.status : 'not_found';
        console.log(`PaymentTransaction Status: ${actualStatus}`);
        
        if (paymentTx && paymentTx.status === 'completed') {
          // ACTUALLY COMPLETED - count as owned
          const shareCount = transaction.coFounderShares || transaction.shares || 0;
          coFounderShares += shareCount;
          completedTransactions++;
          console.log(`✅ OWNED co-founder shares: ${shareCount}`);
          
          // Count investment value for completed transactions
          if (transaction.status === 'completed') {
            if (transaction.currency === 'naira') {
              totalInvestmentNaira += transaction.totalAmount;
            } else if (transaction.currency === 'usdt') {
              totalInvestmentUSDT += transaction.totalAmount;
            }
          }
        } else {
          // NOT ACTUALLY COMPLETED - count as pending
          const shareCount = transaction.coFounderShares || transaction.shares || 0;
          pendingCoFounderShares += shareCount;
          pendingTransactions++;
          console.log(`⏳ PENDING co-founder shares: ${shareCount}`);
        }
      } else {
        // Regular share transaction
        regularTransactions++;
        
        if (transaction.status === 'completed') {
          directRegularShares += transaction.shares || 0;
          completedTransactions++;
          console.log(`✅ OWNED regular shares: ${transaction.shares || 0}`);
          
          // Count investment value
          if (transaction.currency === 'naira') {
            totalInvestmentNaira += transaction.totalAmount;
          } else if (transaction.currency === 'usdt') {
            totalInvestmentUSDT += transaction.totalAmount;
          }
        } else {
          pendingDirectRegularShares += transaction.shares || 0;
          pendingTransactions++;
          console.log(`⏳ PENDING regular shares: ${transaction.shares || 0}`);
        }
      }
    });
    
    // Calculate derived values for OWNED shares
    const equivalentRegularFromCofounder = coFounderShares * shareToRegularRatio;
    const totalEffectiveShares = directRegularShares + equivalentRegularFromCofounder;
    
    // Calculate derived values for PENDING shares
    const equivalentPendingFromCofounder = pendingCoFounderShares * shareToRegularRatio;
    const totalPendingShares = pendingDirectRegularShares + equivalentPendingFromCofounder;
    
    // Calculate co-founder equivalence for owned shares
    const totalEquivalentCoFounderShares = Math.floor(totalEffectiveShares / shareToRegularRatio);
    const remainingRegularShares = totalEffectiveShares % shareToRegularRatio;
    
    // Generate explanation
    let explanation = "";
    if (totalEffectiveShares === 0 && totalPendingShares === 0) {
      explanation = "No shares yet";
    } else if (totalEffectiveShares === 0 && totalPendingShares > 0) {
      explanation = `You have ${totalPendingShares} shares pending verification`;
    } else if (totalEquivalentCoFounderShares > 0) {
      explanation = `Your ${totalEffectiveShares} owned shares = ${totalEquivalentCoFounderShares} co-founder equivalent${totalEquivalentCoFounderShares !== 1 ? 's' : ''}${remainingRegularShares > 0 ? ` + ${remainingRegularShares} regular` : ''}`;
    } else if (totalEffectiveShares > 0) {
      explanation = `Your ${totalEffectiveShares} owned share${totalEffectiveShares !== 1 ? 's' : ''} (need ${shareToRegularRatio - totalEffectiveShares} more for 1 co-founder equivalent)`;
    }
    
    // Add pending info
    if (totalPendingShares > 0) {
      if (totalEffectiveShares > 0) {
        explanation += `. Plus ${totalPendingShares} shares pending verification`;
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
    
    console.log('\n=== FINAL USER STATS ===');
    console.log(`OWNED Regular Shares: ${directRegularShares}`);
    console.log(`OWNED Co-founder Shares: ${coFounderShares}`);
    console.log(`Equivalent from Co-founder: ${equivalentRegularFromCofounder}`);
    console.log(`Total OWNED Effective Shares: ${totalEffectiveShares}`);
    console.log(`PENDING Regular Shares: ${pendingDirectRegularShares}`);
    console.log(`PENDING Co-founder Shares: ${pendingCoFounderShares}`);
    console.log(`Total PENDING Shares: ${totalPendingShares}`);
    console.log('===============================\n');
    
    res.status(200).json({
      success: true,
      stats: {
        shares: {
          // OWNED SHARES (verified and counted)
          direct: directRegularShares,
          cofounder: coFounderShares,
          equivalentFromCofounder: equivalentRegularFromCofounder,
          totalEffective: totalEffectiveShares,
          
          // PENDING SHARES (awaiting verification)
          pending: {
            directPending: pendingDirectRegularShares,
            cofounderPending: pendingCoFounderShares,
            equivalentPendingFromCofounder: equivalentPendingFromCofounder,
            totalPending: totalPendingShares
          },
          
          // CO-FOUNDER EQUIVALENCE (for owned shares only)
          cofounderEquivalence: {
            equivalentCoFounderShares: totalEquivalentCoFounderShares,
            remainingRegularShares: remainingRegularShares,
            shareToRegularRatio: shareToRegularRatio,
            explanation: explanation
          }
        },
        
        transactions: {
          regular: regularTransactions,
          cofounder: cofounderTransactions,
          total: regularTransactions + cofounderTransactions,
          completed: completedTransactions,
          pending: pendingTransactions
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
        },
        
        // NEW: Summary for clarity
        summary: {
          ownedSharesTotal: totalEffectiveShares,
          pendingSharesTotal: totalPendingShares,
          investmentSummary: `₦${totalInvestmentNaira.toLocaleString()} + $${totalInvestmentUSDT}`,
          statusBreakdown: `${completedTransactions} completed, ${pendingTransactions} pending transactions`,
          ownership: totalEffectiveShares > 0 ? 
            `You own ${directRegularShares} regular + ${coFounderShares} co-founder shares (${equivalentRegularFromCofounder} regular equivalent) = ${totalEffectiveShares} total` :
            "No verified shares yet"
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