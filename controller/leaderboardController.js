// controller/leaderboardController.js
const User = require('../models/User');
const Referral = require('../models/Referral');
const ReferralTransaction = require('../models/ReferralTransaction');
const Withdrawal = require('../models/Withdrawal');

// Helper function to get leaderboard with time filter
const getTimeFilteredLeaderboard = async (timeFrame, categoryFilter = 'registration', limit = 10) => {
  // Calculate the date threshold based on the time frame
  const now = new Date();
  let dateThreshold = new Date();
  
  switch (timeFrame) {
    case 'daily':
      // Set to beginning of current day (midnight)
      dateThreshold.setHours(0, 0, 0, 0);
      break;
    case 'weekly':
      // Set to beginning of current week (Sunday)
      const dayOfWeek = now.getDay(); // 0 = Sunday, 1 = Monday, etc.
      dateThreshold.setDate(now.getDate() - dayOfWeek); // Go back to Sunday
      dateThreshold.setHours(0, 0, 0, 0);
      break;
    case 'monthly':
      // Set to beginning of current month
      dateThreshold.setDate(1);
      dateThreshold.setHours(0, 0, 0, 0);
      break;
    case 'yearly':
      // Set to beginning of current year
      dateThreshold.setMonth(0, 1); // January 1st
      dateThreshold.setHours(0, 0, 0, 0);
      break;
    default:
      // No time filter, return all results
      dateThreshold = null;
  }
  
  // Default sort is by registration date
  let sortField = { createdAt: -1 };
  let matchCriteria = {};
  
  // Apply date filter if specified
  if (dateThreshold) {
    matchCriteria.createdAt = { $gte: dateThreshold };
  }
  
  // Apply category filter
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
      // Registration (default)
      sortField = { createdAt: -1 };
  }
  
  // For time-based leaderboards, we need to look at transactions within the timeframe
  let transactionField = null;
  if (dateThreshold) {
    switch (categoryFilter) {
      case 'referrals':
        // We'll need to count referrals added during this period
        transactionField = 'referralData.transactions';
        break;
      case 'spending':
        // We'll need to sum transactions during this period
        transactionField = 'transactions';
        break;
      case 'earnings':
        // We'll need to sum earnings during this period
        transactionField = 'referralTransactions';
        break;
    }
  }
  
  // Aggregate pipeline to join user data with their shares, referrals, and earnings
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
  
  // If time filtering is applied and we have a transaction field to filter by
  if (dateThreshold && transactionField) {
    // Add filtering to only include transactions within the time period
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
  
  // Continue with the standard aggregation pipeline
  aggregatePipeline.push(
    {
      $addFields: {
        // Share-related metrics
        totalShares: { $sum: '$shares.totalShares' },
        totalCofounderShares: { $sum: '$cofounderShares.totalShares' },
        combinedShares: { 
          $sum: [
            { $sum: '$shares.totalShares' }, 
            { $sum: '$cofounderShares.totalShares' }
          ]
        },
        
        // Referral metrics
        referralCount: { $sum: '$referralData.referredUsers' },
        
        // Financial metrics for all time
        totalEarnings: { $sum: '$referralData.totalEarnings' },
        
        // For time-filtered data, use the filtered transactions
        ...(dateThreshold && transactionField === 'referralTransactions' ? {
          periodEarnings: { $sum: '$filteredTransactions.amount' }
        } : {}),
        
        ...(dateThreshold && transactionField === 'transactions' ? {
          periodSpending: { $sum: '$filteredTransactions.totalAmount' }
        } : {}),
        
        ...(dateThreshold && transactionField === 'referralData.transactions' ? {
          periodReferrals: { $size: '$filteredTransactions' }
        } : {}),
        
        // Withdrawal calculations
        withdrawalAmount: {
          $sum: {
            $map: {
              input: {
                $filter: {
                  input: '$withdrawals',
                  as: 'withdrawal',
                  cond: { 
                    $and: [
                      { $in: ['$$withdrawal.status', ['paid', 'approved', 'processing']] },
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
        
        totalSpent: { 
          $sum: [
            { $sum: '$shares.transactions.totalAmount' },
            { $sum: '$cofounderShares.transactions.totalAmount' }
          ]
        }
      }
    },
    {
      $addFields: {
        // For time-filtered data, use the period metrics as the primary sort field
        ...(dateThreshold && transactionField === 'referralTransactions' ? {
          sortField: '$periodEarnings'
        } : {}),
        
        ...(dateThreshold && transactionField === 'transactions' ? {
          sortField: '$periodSpending'
        } : {}),
        
        ...(dateThreshold && transactionField === 'referralData.transactions' ? {
          sortField: '$periodReferrals'
        } : {}),
        
        // Current balance after withdrawals
        currentBalance: { 
          $subtract: [
            { $sum: '$referralData.totalEarnings' },
            { $ifNull: ['$withdrawalAmount', 0] }
          ]
        }
      }
    }
  );
  
  // Apply the match criteria
  aggregatePipeline.push(
    { $match: matchCriteria }
  );
  
  // For time-based filters, use the period-specific sort field if available
  if (dateThreshold && transactionField) {
    aggregatePipeline.push(
      { $sort: { sortField: -1 } }
    );
  } else {
    aggregatePipeline.push(
      { $sort: sortField }
    );
  }
  
  // Limit the results
  aggregatePipeline.push(
    { $limit: limit }
  );
  
  // Project only needed fields
  aggregatePipeline.push({
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
      totalSpent: 1,
      createdAt: 1,
      // Include time-period specific fields if applicable
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
  });
  
  // Execute the aggregation
  const leaderboard = await User.aggregate(aggregatePipeline);
  
  return leaderboard;
};

// Get daily leaderboard
exports.getDailyLeaderboard = async (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit) : 10;
    const filter = req.query.filter || 'earnings'; // Default to earnings for daily leaderboard
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

// Get weekly leaderboard
exports.getWeeklyLeaderboard = async (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit) : 10;
    const filter = req.query.filter || 'earnings'; // Default to earnings for weekly leaderboard
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

// Get monthly leaderboard
exports.getMonthlyLeaderboard = async (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit) : 10;
    const filter = req.query.filter || 'earnings'; // Default to earnings for monthly leaderboard
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

// Get yearly leaderboard
exports.getYearlyLeaderboard = async (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit) : 10;
    const filter = req.query.filter || 'earnings'; // Default to earnings for yearly leaderboard
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

// Update the main getLeaderboard function to also support time filtering
exports.getLeaderboard = async (req, res) => {
  try {
    const filter = req.query.filter || 'registration';
    const timeFrame = req.query.timeFrame || null; // Can be daily, weekly, monthly, yearly, or null
    const limit = req.query.limit ? parseInt(req.query.limit) : 10;
    
    let leaderboard;
    
    if (timeFrame) {
      leaderboard = await getTimeFilteredLeaderboard(timeFrame, filter, limit);
    } else {
      leaderboard = await getFilteredLeaderboard(filter, limit);
    }
    
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

// Get registration leaderboard
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

// Get referral leaderboard
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

// Get spending leaderboard
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

// Get cofounder leaderboard
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

// Get top earners leaderboard
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

// Get top shareholders leaderboard
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