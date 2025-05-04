// controller/leaderboardController.js
const User = require('../models/User');
const Referral = require('../models/Referral');
const ReferralTransaction = require('../models/ReferralTransaction');
const Withdrawal = require('../models/Withdrawal');

// Main leaderboard aggregation function
const getTimeFilteredLeaderboard = async (timeFrame, categoryFilter = 'registration', limit = 10) => {
  // Calculate the date threshold based on the time frame
  const now = new Date();
  let dateThreshold = new Date();
  
  switch (timeFrame) {
    case 'daily':
      dateThreshold.setHours(0, 0, 0, 0);
      break;
    case 'weekly':
      const dayOfWeek = now.getDay();
      dateThreshold.setDate(now.getDate() - dayOfWeek);
      dateThreshold.setHours(0, 0, 0, 0);
      break;
    case 'monthly':
      dateThreshold.setDate(1);
      dateThreshold.setHours(0, 0, 0, 0);
      break;
    case 'yearly':
      dateThreshold.setMonth(0, 1);
      dateThreshold.setHours(0, 0, 0, 0);
      break;
    default:
      dateThreshold = null;
  }
  
  let sortField = { createdAt: -1 };
  let matchCriteria = {};
  
  if (dateThreshold) {
    matchCriteria.createdAt = { $gte: dateThreshold };
  }
  
  switch (categoryFilter) {
    case 'referrals':
      sortField = { referralCount: -1 };
      matchCriteria.referralCount = { $gt: 0 };
      break;
    case 'spending':
      sortField = { totalSpent: -1 };
      matchCriteria.totalSpent = { $gt: 0 };
      break;
    case 'cofounder':
      sortField = { 'cofounderShares.totalShares': -1 };
      matchCriteria['cofounderShares.totalShares'] = { $gt: 0 };
      break;
    case 'earnings':
      sortField = { totalEarnings: -1 };
      matchCriteria.totalEarnings = { $gt: 0 };
      break;
    case 'shares':
      sortField = { combinedShares: -1 };
      matchCriteria.combinedShares = { $gt: 0 };
      break;
    default:
      sortField = { createdAt: -1 };
  }
  
  let transactionField = null;
  if (dateThreshold) {
    switch (categoryFilter) {
      case 'referrals':
        transactionField = 'referralData.transactions';
        break;
      case 'spending':
        transactionField = 'transactions';
        break;
      case 'earnings':
        transactionField = 'referralTransactions';
        break;
    }
  }
  
  const aggregatePipeline = [
    {
      $lookup: {
        from: 'usershares',
        localField: '_id',
        foreignField: 'user',
        as: 'shares'
      }
    },
    {
      $lookup: {
        from: 'usercofounderShares',
        localField: '_id',
        foreignField: 'user',
        as: 'cofounderShares'
      }
    },
    {
      $lookup: {
        from: 'referrals',
        localField: '_id',
        foreignField: 'user',
        as: 'referralData'
      }
    },
    {
      $lookup: {
        from: 'referraltransactions',
        localField: '_id',
        foreignField: 'beneficiary',
        as: 'referralTransactions'
      }
    },
    {
      $lookup: {
        from: 'withdrawals',
        localField: '_id',
        foreignField: 'user',
        as: 'withdrawals'
      }
    }
  ];
  
  if (dateThreshold && transactionField) {
    aggregatePipeline.push({
      $addFields: {
        filteredTransactions: {
          $filter: {
            input: `$${transactionField}`,
            as: 'transaction',
            cond: { $gte: ['$$transaction.createdAt', dateThreshold] }
          }
        }
      }
    });
  }
  
  // First, safely access the referral data as an object
  aggregatePipeline.push({
    $addFields: {
      // Safely get the first element from the referralData array
      referralInfo: { 
        $cond: { 
          if: { $gt: [{ $size: "$referralData" }, 0] }, 
          then: { $arrayElemAt: ["$referralData", 0] }, 
          else: {
            totalEarnings: 0,
            totalWithdrawn: 0,
            pendingWithdrawals: 0,
            processingWithdrawals: 0
          } 
        } 
      },
      
      totalShares: { $sum: '$shares.totalShares' },
      totalCofounderShares: { $sum: '$cofounderShares.totalShares' },
      combinedShares: { 
        $sum: [
          { $sum: '$shares.totalShares' }, 
          { $sum: '$cofounderShares.totalShares' }
        ]
      },
      
      withdrawalAmount: {
        $sum: {
          $map: {
            input: {
              $filter: {
                input: '$withdrawals',
                as: 'withdrawal',
                cond: { 
                  $and: [
                    { $in: ['$$withdrawal.status', ['paid', 'approved']] }, // Only completed withdrawals
                    ...(dateThreshold ? [{ $gte: ['$$withdrawal.createdAt', dateThreshold] }] : [])
                  ]
                }
              }
            },
            as: 'validWithdrawal',
            in: '$$validWithdrawal.amount'
          }
        }
      },

      processingWithdrawalsAmount: {
        $sum: {
          $map: {
            input: {
              $filter: {
                input: '$withdrawals',
                as: 'withdrawal',
                cond: { 
                  $and: [
                    { $eq: ['$$withdrawal.status', 'processing'] },
                    ...(dateThreshold ? [{ $gte: ['$$withdrawal.createdAt', dateThreshold] }] : [])
                  ]
                }
              }
            },
            as: 'processingWithdrawal',
            in: '$$processingWithdrawal.amount'
          }
        }
      },
      
      pendingWithdrawalsAmount: {
        $sum: {
          $map: {
            input: {
              $filter: {
                input: '$withdrawals',
                as: 'withdrawal',
                cond: { 
                  $and: [
                    { $eq: ['$$withdrawal.status', 'pending'] },
                    ...(dateThreshold ? [{ $gte: ['$$withdrawal.createdAt', dateThreshold] }] : [])
                  ]
                }
              }
            },
            as: 'pendingWithdrawal',
            in: '$$pendingWithdrawal.amount'
          }
        }
      },
      
      totalSpent: { 
        $sum: [
          { $sum: '$shares.transactions.totalAmount' },
          { $sum: '$cofounderShares.transactions.totalAmount' }
        ]
      }
    }
  });
  
  // Now calculate the derived fields
  aggregatePipeline.push({
    $addFields: {
      // Use the referralInfo object to safely access fields
      referralCount: { $ifNull: ["$referralInfo.referredUsers", 0] },
      totalEarnings: { $ifNull: ["$referralInfo.totalEarnings", 0] },
      
      ...(dateThreshold && transactionField === 'referralTransactions' ? {
        periodEarnings: { $sum: '$filteredTransactions.amount' }
      } : {}),
      
      ...(dateThreshold && transactionField === 'transactions' ? {
        periodSpending: { $sum: '$filteredTransactions.totalAmount' }
      } : {}),
      
      ...(dateThreshold && transactionField === 'referralData.transactions' ? {
        periodReferrals: { $size: '$filteredTransactions' }
      } : {}),
    }
  });
  
  // Calculate the current balance
  aggregatePipeline.push({
    $addFields: {
      // Sort field for time period filtering
      ...(dateThreshold && transactionField === 'referralTransactions' ? {
        sortField: '$periodEarnings'
      } : {}),
      
      ...(dateThreshold && transactionField === 'transactions' ? {
        sortField: '$periodSpending'
      } : {}),
      
      ...(dateThreshold && transactionField === 'referralData.transactions' ? {
        sortField: '$periodReferrals'
      } : {}),
      
      // Calculate available balance using the properly accessed fields
      currentBalance: { 
        $subtract: [
          { $ifNull: ["$referralInfo.totalEarnings", 0] },
          {
            $add: [
              { $ifNull: ["$referralInfo.totalWithdrawn", 0] },
              { $ifNull: ["$referralInfo.pendingWithdrawals", 0] },
              { $ifNull: ["$referralInfo.processingWithdrawals", 0] }
            ]
          }
        ]
      }
    }
  });
  
  // Final stages for filtering, sorting, limiting and projection
  aggregatePipeline.push(
    { $match: matchCriteria },
    dateThreshold && transactionField 
      ? { $sort: { sortField: -1 } } 
      : { $sort: sortField },
    { $limit: limit },
    {
      $project: {
        _id: 1,
        name: 1,
        userName: 1,
        totalShares: 1,
        totalCofounderShares: 1,
        combinedShares: 1,
        referralCount: 1,
        totalEarnings: 1,
        currentBalance: 1,
        withdrawalAmount: 1,
        pendingWithdrawalsAmount: 1,
        processingWithdrawalsAmount: 1,
        totalSpent: 1,
        createdAt: 1,
        ...(dateThreshold && transactionField === 'referralTransactions' ? {
          periodEarnings: 1
        } : {}),
        ...(dateThreshold && transactionField === 'transactions' ? {
          periodSpending: 1
        } : {}),
        ...(dateThreshold && transactionField === 'referralData.transactions' ? {
          periodReferrals: 1
        } : {})
      }
    }
  );
  
  return await User.aggregate(aggregatePipeline.filter(Boolean));
};

// Wrapper function for non-time-filtered leaderboards
const getFilteredLeaderboard = async (categoryFilter = 'registration', limit = 10) => {
  return getTimeFilteredLeaderboard(null, categoryFilter, limit);
};

// Time-based leaderboards
exports.getDailyLeaderboard = async (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit) : 10;
    const filter = req.query.filter || 'earnings';
    const leaderboard = await getTimeFilteredLeaderboard('daily', filter, limit);
    
    res.status(200).json({
      success: true,
      timeFrame: 'daily',
      filter,
      leaderboard
    });
  } catch (error) {
    console.error('Error fetching daily leaderboard:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch daily leaderboard',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

exports.getWeeklyLeaderboard = async (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit) : 10;
    const filter = req.query.filter || 'earnings';
    const leaderboard = await getTimeFilteredLeaderboard('weekly', filter, limit);
    
    res.status(200).json({
      success: true,
      timeFrame: 'weekly',
      filter,
      leaderboard
    });
  } catch (error) {
    console.error('Error fetching weekly leaderboard:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch weekly leaderboard',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

exports.getMonthlyLeaderboard = async (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit) : 10;
    const filter = req.query.filter || 'earnings';
    const leaderboard = await getTimeFilteredLeaderboard('monthly', filter, limit);
    
    res.status(200).json({
      success: true,
      timeFrame: 'monthly',
      filter,
      leaderboard
    });
  } catch (error) {
    console.error('Error fetching monthly leaderboard:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch monthly leaderboard',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

exports.getYearlyLeaderboard = async (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit) : 10;
    const filter = req.query.filter || 'earnings';
    const leaderboard = await getTimeFilteredLeaderboard('yearly', filter, limit);
    
    res.status(200).json({
      success: true,
      timeFrame: 'yearly',
      filter,
      leaderboard
    });
  } catch (error) {
    console.error('Error fetching yearly leaderboard:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch yearly leaderboard',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Category-based leaderboards
exports.getLeaderboard = async (req, res) => {
  try {
    const filter = req.query.filter || 'registration';
    const timeFrame = req.query.timeFrame || null;
    const limit = req.query.limit ? parseInt(req.query.limit) : 10;
    
    const leaderboard = timeFrame 
      ? await getTimeFilteredLeaderboard(timeFrame, filter, limit)
      : await getFilteredLeaderboard(filter, limit);
    
    res.status(200).json({
      success: true,
      filter,
      timeFrame: timeFrame || 'all-time',
      leaderboard
    });
  } catch (error) {
    console.error('Error fetching leaderboard:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch leaderboard',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

exports.getRegistrationLeaderboard = async (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit) : 10;
    const leaderboard = await getFilteredLeaderboard('registration', limit);
    
    res.status(200).json({
      success: true,
      filter: 'registration',
      leaderboard
    });
  } catch (error) {
    console.error('Error fetching registration leaderboard:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch leaderboard',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

exports.getReferralLeaderboard = async (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit) : 10;
    const leaderboard = await getFilteredLeaderboard('referrals', limit);
    
    res.status(200).json({
      success: true,
      filter: 'referrals',
      leaderboard
    });
  } catch (error) {
    console.error('Error fetching referral leaderboard:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch leaderboard',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

exports.getSpendingLeaderboard = async (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit) : 10;
    const leaderboard = await getFilteredLeaderboard('spending', limit);
    
    res.status(200).json({
      success: true,
      filter: 'spending',
      leaderboard
    });
  } catch (error) {
    console.error('Error fetching spending leaderboard:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch leaderboard',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

exports.getCofounderLeaderboard = async (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit) : 10;
    const leaderboard = await getFilteredLeaderboard('cofounder', limit);
    
    res.status(200).json({
      success: true,
      filter: 'cofounder',
      leaderboard
    });
  } catch (error) {
    console.error('Error fetching cofounder leaderboard:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch leaderboard',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

exports.getEarningsLeaderboard = async (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit) : 10;
    const leaderboard = await getFilteredLeaderboard('earnings', limit);
    
    res.status(200).json({
      success: true,
      filter: 'earnings',
      leaderboard
    });
  } catch (error) {
    console.error('Error fetching earnings leaderboard:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch leaderboard',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

exports.getSharesLeaderboard = async (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit) : 10;
    const leaderboard = await getFilteredLeaderboard('shares', limit);
    
    res.status(200).json({
      success: true,
      filter: 'shares',
      leaderboard
    });
  } catch (error) {
    console.error('Error fetching shares leaderboard:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch leaderboard',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};