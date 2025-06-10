// controller/leaderboardController.js
const User = require('../models/User');
const Referral = require('../models/Referral');
const ReferralTransaction = require('../models/ReferralTransaction');
const Withdrawal = require('../models/Withdrawal');
const AdminSettings = require('../models/AdminSettings');
const { invalidateCache } = require('../middleware/visibilityMiddleware');

// Optional dependencies - will be loaded if they exist
let LeaderboardSnapshot, LocationAnalytics, AdminAuditLog, CacheService, adminValidation;

try {
  LeaderboardSnapshot = require('../models/LeaderboardSnapshot');
} catch (e) {
  console.log('LeaderboardSnapshot model not found - admin features will be limited');
}

try {
  LocationAnalytics = require('../models/LocationAnalytics');
} catch (e) {
  console.log('LocationAnalytics model not found - location analytics disabled');
}

try {
  AdminAuditLog = require('../models/AdminAuditLog');
} catch (e) {
  console.log('AdminAuditLog model not found - audit logging disabled');
}

try {
  CacheService = require('../services/cacheService');
} catch (e) {
  console.log('CacheService not found - caching disabled');
  // Create a fallback cache service
  CacheService = {
    getLeaderboard: async () => null,
    setLeaderboard: async () => false,
    get: async () => null,
    set: async () => false,
    invalidateUserCache: async () => false
  };
}

try {
  adminValidation = require('../validation/adminValidation');
} catch (e) {
  console.log('Admin validation not found - using basic validation');
  // Create fallback validation
  adminValidation = {
    leaderboardQuerySchema: { validate: (data) => ({ error: null, value: data }) },
    visibilityUpdateSchema: { validate: (data) => ({ error: null, value: data }) },
    bulkUpdateSchema: { validate: (data) => ({ error: null, value: data }) }
  };
}

const { leaderboardQuerySchema, visibilityUpdateSchema, bulkUpdateSchema } = adminValidation;

// ====================
// EXISTING PUBLIC LEADERBOARD METHODS (PRESERVED)
// ====================

// Main leaderboard aggregation function (existing - preserved)
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

// Wrapper function for non-time-filtered leaderboards (existing - preserved)
const getFilteredLeaderboard = async (categoryFilter = 'registration', limit = 10) => {
  return getTimeFilteredLeaderboard(null, categoryFilter, limit);
};

// ====================
// NEW ADMIN LEADERBOARD METHODS
// ====================

// Admin leaderboard aggregation with enhanced filtering and visibility controls
const getAdminLeaderboard = async (filters) => {
  const {
    type = 'earners',
    period = 'all_time',
    limit = 50,
    offset = 0,
    state,
    city,
    search,
    show_earnings = true,
    show_balance = true
  } = filters;

  // Build date filter
  let dateFilter = {};
  if (period !== 'all_time') {
    const now = new Date();
    let startDate = new Date();
    
    switch (period) {
      case 'daily':
        startDate.setHours(0, 0, 0, 0);
        break;
      case 'weekly':
        startDate.setDate(now.getDate() - now.getDay());
        startDate.setHours(0, 0, 0, 0);
        break;
      case 'monthly':
        startDate.setDate(1);
        startDate.setHours(0, 0, 0, 0);
        break;
    }
    dateFilter.createdAt = { $gte: startDate };
  }

  // Build match criteria
  const matchCriteria = {
    'status.isActive': true,
    isBanned: { $ne: true },
    ...dateFilter
  };

  if (state) matchCriteria['location.state'] = state;
  if (city) matchCriteria['location.city'] = city;
  if (search) {
    matchCriteria.$or = [
      { name: { $regex: search, $options: 'i' } },
      { userName: { $regex: search, $options: 'i' } }
    ];
  }

  // Determine sort field based on type
  let sortField = {};
  switch (type) {
    case 'earners':
      sortField = { 'earnings.total': -1 };
      break;
    case 'shares':
      sortField = { 'stats.totalShares': -1 };
      break;
    case 'referrals':
      sortField = { 'stats.totalReferrals': -1 };
      break;
    case 'cofounders':
      sortField = { 'stats.totalCofounders': -1 };
      break;
    default:
      sortField = { 'earnings.total': -1 };
  }

  const pipeline = [
    { $match: matchCriteria },
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
        from: 'referrals',
        localField: '_id',
        foreignField: 'user',
        as: 'referralData'
      }
    },
    {
      $addFields: {
        rank: { $sum: 1 }, // Will be recalculated after sorting
        totalShares: { $sum: '$shares.totalShares' },
        totalReferrals: { $ifNull: [{ $arrayElemAt: ['$referralData.totalReferrals', 0] }, 0] },
        totalCofounders: { $ifNull: ['$stats.totalCofounders', 0] }
      }
    },
    { $sort: sortField },
    {
      $group: {
        _id: null,
        users: { $push: '$$ROOT' },
        total: { $sum: 1 }
      }
    },
    {
      $project: {
        users: {
          $map: {
            input: { $slice: ['$users', offset, limit] },
            as: 'user',
            in: {
              $mergeObjects: [
                '$$user',
                {
                  rank: { $add: [{ $indexOfArray: ['$users', '$$user'] }, 1] },
                  // Conditionally include earnings based on visibility
                  totalEarnings: {
                    $cond: {
                      if: { $and: [show_earnings, '$$user.earnings.visible'] },
                      then: '$$user.earnings.total',
                      else: null
                    }
                  },
                  // Conditionally include balance based on visibility
                  availableBalance: {
                    $cond: {
                      if: { $and: [show_balance, '$$user.availableBalance.visible'] },
                      then: '$$user.availableBalance.amount',
                      else: null
                    }
                  }
                }
              ]
            }
          }
        },
        total: 1,
        totalPages: { $ceil: { $divide: ['$total', limit] } },
        currentPage: { $add: [{ $divide: [offset, limit] }, 1] }
      }
    }
  ];

  const result = await User.aggregate(pipeline);
  return result[0] || { users: [], total: 0, totalPages: 0, currentPage: 1 };
};

// Get location analytics
const getLocationAnalytics = async (type = 'states', parentFilter = null, limit = 10) => {
  const matchStage = { 'status.isActive': true };
  let groupBy = '$location.state';
  
  if (type === 'cities') {
    groupBy = { state: '$location.state', city: '$location.city' };
    if (parentFilter) {
      matchStage['location.state'] = parentFilter;
    }
  }

  const pipeline = [
    { $match: matchStage },
    {
      $group: {
        _id: groupBy,
        totalUsers: { $sum: 1 },
        totalEarnings: { $sum: '$earnings.total' },
        averageEarnings: { $avg: '$earnings.total' },
        topEarner: { $max: '$earnings.total' }
      }
    },
    { $sort: { totalEarnings: -1 } },
    { $limit: limit },
    {
      $addFields: {
        rank: { $add: [{ $indexOfArray: [{ $slice: [{ $sortArray: { input: '$$ROOT', sortBy: { totalEarnings: -1 } } }, limit] }, '$$ROOT'] }, 1] }
      }
    }
  ];

  return await User.aggregate(pipeline);
};

// ====================
// ADMIN CONTROLLER METHODS
// ====================

// Main admin leaderboard endpoint
exports.getAdminLeaderboard = async (req, res) => {
  try {
    if (!CacheService || !AdminAuditLog) {
      return res.status(503).json({
        success: false,
        message: 'Admin features not available - missing dependencies'
      });
    }

    // Validate query parameters
    const { error, value } = leaderboardQuerySchema.validate(req.query);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid query parameters',
        errors: error.details.map(d => d.message)
      });
    }

    // Check cache first
    const cacheKey = `admin_leaderboard:${JSON.stringify(value)}`;
    let cachedData = await CacheService.getLeaderboard(cacheKey);
    
    if (cachedData) {
      return res.json({
        success: true,
        data: cachedData.users,
        pagination: {
          currentPage: cachedData.currentPage,
          totalPages: cachedData.totalPages,
          totalItems: cachedData.total,
          hasNext: cachedData.currentPage < cachedData.totalPages,
          hasPrev: cachedData.currentPage > 1,
          limit: value.limit
        },
        filters: value,
        fromCache: true
      });
    }

    // Get fresh data
    const result = await getAdminLeaderboard(value);
    
    // Cache the result
    await CacheService.setLeaderboard(cacheKey, result, 900); // 15 minutes cache

    // Log admin activity
    if (AdminAuditLog) {
      await AdminAuditLog.create({
        adminId: req.user._id,
        action: 'VIEW_ADMIN_LEADERBOARD',
        details: { filters: value },
        ipAddress: req.ip,
        userAgent: req.get('User-Agent')
      });
    }

    res.json({
      success: true,
      data: result.users,
      pagination: {
        currentPage: result.currentPage,
        totalPages: result.totalPages,
        totalItems: result.total,
        hasNext: result.currentPage < result.totalPages,
        hasPrev: result.currentPage > 1,
        limit: value.limit
      },
      filters: value
    });

  } catch (error) {
    console.error('Error fetching admin leaderboard:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch admin leaderboard',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Get top states analytics
exports.getTopStates = async (req, res) => {
  try {
    const { period = 'all_time', limit = 10 } = req.query;
    
    const cacheKey = `top_states:${period}:${limit}`;
    let cachedData = await CacheService.get(cacheKey);
    
    if (cachedData) {
      return res.json({ success: true, data: cachedData });
    }

    const states = await getLocationAnalytics('states', null, parseInt(limit));
    
    await CacheService.set(cacheKey, states, 1800); // 30 minutes cache

    res.json({ success: true, data: states });

  } catch (error) {
    console.error('Error fetching top states:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch top states',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Get top cities analytics
exports.getTopCities = async (req, res) => {
  try {
    const { state, limit = 10 } = req.query;
    
    const cacheKey = `top_cities:${state || 'all'}:${limit}`;
    let cachedData = await CacheService.get(cacheKey);
    
    if (cachedData) {
      return res.json({ success: true, data: cachedData });
    }

    const cities = await getLocationAnalytics('cities', state, parseInt(limit));
    
    await CacheService.set(cacheKey, cities, 1800); // 30 minutes cache

    res.json({ success: true, data: cities });

  } catch (error) {
    console.error('Error fetching top cities:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch top cities',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Toggle user visibility
exports.toggleUserVisibility = async (req, res) => {
  try {
    if (!AdminAuditLog) {
      return res.status(503).json({
        success: false,
        message: 'Admin audit features not available'
      });
    }

    const { userId } = req.params;
    
    // Validate request body
    const { error, value } = visibilityUpdateSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid request body',
        errors: error.details.map(d => d.message)
      });
    }

    const { field, visible } = value;
    
    // Build update object
    const updateField = field === 'earnings' ? 'earnings.visible' : 'availableBalance.visible';
    const updateData = { [updateField]: visible };

    const user = await User.findByIdAndUpdate(
      userId,
      { $set: updateData },
      { new: true, select: 'name userName earnings.visible availableBalance.visible' }
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Log admin action
    await AdminAuditLog.create({
      adminId: req.user._id,
      action: 'TOGGLE_USER_VISIBILITY',
      targetUserId: userId,
      details: { field, visible, oldValue: !visible },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    // Invalidate related caches
    if (CacheService) {
      await CacheService.invalidateUserCache(userId);
    }

    res.json({
      success: true,
      message: `User ${field} visibility updated successfully`,
      data: user
    });

  } catch (error) {
    console.error('Error toggling user visibility:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update user visibility',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Bulk update users
exports.bulkUpdateUsers = async (req, res) => {
  try {
    // Validate request body
    const { error, value } = bulkUpdateSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid request body',
        errors: error.details.map(d => d.message)
      });
    }

    const { user_ids, updates } = value;

    const result = await User.updateMany(
      { _id: { $in: user_ids } },
      { $set: updates }
    );

    // Log admin action
    await AdminAuditLog.create({
      adminId: req.user._id,
      action: 'BULK_UPDATE_USERS',
      details: { userIds: user_ids, updates, result },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    // Invalidate caches for affected users
    for (const userId of user_ids) {
      await CacheService.invalidateUserCache(userId);
    }

    res.json({
      success: true,
      message: `Successfully updated ${result.modifiedCount} users`,
      data: result
    });

  } catch (error) {
    console.error('Error in bulk update:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update users',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Export leaderboard data
exports.exportLeaderboard = async (req, res) => {
  try {
    const filters = { ...req.query, limit: 10000, offset: 0 }; // Export all data
    const result = await getAdminLeaderboard(filters);

    // Convert to CSV format
    const csvData = result.users.map(user => ({
      Rank: user.rank,
      Name: user.name,
      Username: user.userName,
      'Total Earnings': user.totalEarnings || 'Hidden',
      'Available Balance': user.availableBalance || 'Hidden',
      'Total Shares': user.totalShares,
      'Total Referrals': user.totalReferrals,
      'Total Cofounders': user.totalCofounders,
      State: user.location?.state || '',
      City: user.location?.city || '',
      'Join Date': user.createdAt
    }));

    // Log export action
    await AdminAuditLog.create({
      adminId: req.user._id,
      action: 'EXPORT_LEADERBOARD',
      details: { filters, recordCount: csvData.length },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    res.json({
      success: true,
      data: csvData,
      total_records: csvData.length,
      exported_at: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error exporting leaderboard:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to export leaderboard',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// ====================
// EXISTING PUBLIC METHODS (PRESERVED)
// ====================

// Time-based leaderboards (existing - preserved)
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

// Category-based leaderboards (existing - preserved)
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

// Function to filter leaderboard based on Earnings

exports.getLeaderboardByEarnings = async (filters) => {
  const {
    minEarnings = 0,
    maxEarnings = null,
    limit = 50,
    offset = 0,
    period = 'all_time',
    sortOrder = 'desc'
  } = filters;

  // Build earnings filter
  const earningsFilter = { $gte: minEarnings };
  if (maxEarnings !== null) {
    earningsFilter.$lte = maxEarnings;
  }

  // Build date filter
  let dateFilter = {};
  if (period !== 'all_time') {
    const now = new Date();
    let startDate = new Date();
    
    switch (period) {
      case 'daily':
        startDate.setHours(0, 0, 0, 0);
        break;
      case 'weekly':
        startDate.setDate(now.getDate() - now.getDay());
        startDate.setHours(0, 0, 0, 0);
        break;
      case 'monthly':
        startDate.setDate(1);
        startDate.setHours(0, 0, 0, 0);
        break;
      case 'yearly':
        startDate.setMonth(0, 1);
        startDate.setHours(0, 0, 0, 0);
        break;
    }
    dateFilter.createdAt = { $gte: startDate };
  }

  const pipeline = [
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
        from: 'withdrawals',
        localField: '_id',
        foreignField: 'user',
        as: 'withdrawals'
      }
    },
    {
      $addFields: {
        referralInfo: {
          $cond: {
            if: { $gt: [{ $size: "$referralData" }, 0] },
            then: { $arrayElemAt: ["$referralData", 0] },
            else: { totalEarnings: 0 }
          }
        }
      }
    },
    {
      $addFields: {
        totalEarnings: { $ifNull: ["$referralInfo.totalEarnings", 0] }
      }
    },
    {
      $match: {
        'status.isActive': true,
        totalEarnings: earningsFilter,
        ...dateFilter
      }
    },
    {
      $sort: { totalEarnings: sortOrder === 'desc' ? -1 : 1 }
    },
    {
      $facet: {
        data: [
          { $skip: offset },
          { $limit: limit },
          {
            $project: {
              _id: 1,
              name: 1,
              userName: 1,
              totalEarnings: 1,
              'location.state': 1,
              'location.city': 1,
              'status.isActive': 1,
              createdAt: 1
            }
          }
        ],
        totalCount: [{ $count: "count" }]
      }
    }
  ];

  const result = await User.aggregate(pipeline);
  const users = result[0].data;
  const totalCount = result[0].totalCount[0]?.count || 0;

  return {
    users: users.map((user, index) => ({
      ...user,
      rank: offset + index + 1
    })),
    total: totalCount,
    totalPages: Math.ceil(totalCount / limit),
    currentPage: Math.floor(offset / limit) + 1
  };
};

// Function to filter leaderboard based on available balance

exports.getLeaderboardByBalance = async (filters) => {
  const {
    minBalance = 0,
    maxBalance = null,
    limit = 50,
    offset = 0,
    period = 'all_time',
    sortOrder = 'desc'
  } = filters;

  // Build balance filter
  const balanceFilter = { $gte: minBalance };
  if (maxBalance !== null) {
    balanceFilter.$lte = maxBalance;
  }

  // Build date filter
  let dateFilter = {};
  if (period !== 'all_time') {
    const now = new Date();
    let startDate = new Date();
    
    switch (period) {
      case 'daily':
        startDate.setHours(0, 0, 0, 0);
        break;
      case 'weekly':
        startDate.setDate(now.getDate() - now.getDay());
        startDate.setHours(0, 0, 0, 0);
        break;
      case 'monthly':
        startDate.setDate(1);
        startDate.setHours(0, 0, 0, 0);
        break;
      case 'yearly':
        startDate.setMonth(0, 1);
        startDate.setHours(0, 0, 0, 0);
        break;
    }
    dateFilter.createdAt = { $gte: startDate };
  }

  const pipeline = [
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
        from: 'withdrawals',
        localField: '_id',
        foreignField: 'user',
        as: 'withdrawals'
      }
    },
    {
      $addFields: {
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
        }
      }
    },
    {
      $addFields: {
        totalEarnings: { $ifNull: ["$referralInfo.totalEarnings", 0] },
        totalWithdrawn: { $ifNull: ["$referralInfo.totalWithdrawn", 0] },
        pendingWithdrawals: { $ifNull: ["$referralInfo.pendingWithdrawals", 0] },
        processingWithdrawals: { $ifNull: ["$referralInfo.processingWithdrawals", 0] }
      }
    },
    {
      $addFields: {
        availableBalance: {
          $subtract: [
            "$totalEarnings",
            {
              $add: [
                "$totalWithdrawn",
                "$pendingWithdrawals",
                "$processingWithdrawals"
              ]
            }
          ]
        }
      }
    },
    {
      $match: {
        'status.isActive': true,
        availableBalance: balanceFilter,
        ...dateFilter
      }
    },
    {
      $sort: { availableBalance: sortOrder === 'desc' ? -1 : 1 }
    },
    {
      $facet: {
        data: [
          { $skip: offset },
          { $limit: limit },
          {
            $project: {
              _id: 1,
              name: 1,
              userName: 1,
              totalEarnings: 1,
              availableBalance: 1,
              'location.state': 1,
              'location.city': 1,
              'status.isActive': 1,
              createdAt: 1
            }
          }
        ],
        totalCount: [{ $count: "count" }]
      }
    }
  ];

  const result = await User.aggregate(pipeline);
  const users = result[0].data;
  const totalCount = result[0].totalCount[0]?.count || 0;

  return {
    users: users.map((user, index) => ({
      ...user,
      rank: offset + index + 1
    })),
    total: totalCount,
    totalPages: Math.ceil(totalCount / limit),
    currentPage: Math.floor(offset / limit) + 1
  };
};

// Function to filter Leaderboard based on Location(State and/or City)

exports.getLeaderboardByLocation = async (filters) => {
  const {
    state = null,
    city = null,
    limit = 50,
    offset = 0,
    sortBy = 'totalEarnings',
    sortOrder = 'desc',
    period = 'all_time'
  } = filters;

  // Build location filter
  const locationFilter = {};
  if (state) locationFilter['location.state'] = state;
  if (city) locationFilter['location.city'] = city;

  // Build date filter
  let dateFilter = {};
  if (period !== 'all_time') {
    const now = new Date();
    let startDate = new Date();
    
    switch (period) {
      case 'daily':
        startDate.setHours(0, 0, 0, 0);
        break;
      case 'weekly':
        startDate.setDate(now.getDate() - now.getDay());
        startDate.setHours(0, 0, 0, 0);
        break;
      case 'monthly':
        startDate.setDate(1);
        startDate.setHours(0, 0, 0, 0);
        break;
      case 'yearly':
        startDate.setMonth(0, 1);
        startDate.setHours(0, 0, 0, 0);
        break;
    }
    dateFilter.createdAt = { $gte: startDate };
  }

  // Determine sort field
  let sortField = {};
  switch (sortBy) {
    case 'totalEarnings':
      sortField = { totalEarnings: sortOrder === 'desc' ? -1 : 1 };
      break;
    case 'availableBalance':
      sortField = { availableBalance: sortOrder === 'desc' ? -1 : 1 };
      break;
    case 'totalShares':
      sortField = { totalShares: sortOrder === 'desc' ? -1 : 1 };
      break;
    case 'createdAt':
      sortField = { createdAt: sortOrder === 'desc' ? -1 : 1 };
      break;
    default:
      sortField = { totalEarnings: -1 };
  }

  const pipeline = [
    {
      $match: {
        'status.isActive': true,
        ...locationFilter,
        ...dateFilter
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
        from: 'usershares',
        localField: '_id',
        foreignField: 'user',
        as: 'shares'
      }
    },
    {
      $addFields: {
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
        totalShares: { $sum: '$shares.totalShares' }
      }
    },
    {
      $addFields: {
        totalEarnings: { $ifNull: ["$referralInfo.totalEarnings", 0] },
        availableBalance: {
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
    },
    {
      $sort: sortField
    },
    {
      $facet: {
        data: [
          { $skip: offset },
          { $limit: limit },
          {
            $project: {
              _id: 1,
              name: 1,
              userName: 1,
              totalEarnings: 1,
              availableBalance: 1,
              totalShares: 1,
              'location.state': 1,
              'location.city': 1,
              'status.isActive': 1,
              createdAt: 1
            }
          }
        ],
        totalCount: [{ $count: "count" }],
        locationStats: [
          {
            $group: {
              _id: null,
              totalUsers: { $sum: 1 },
              totalEarnings: { $sum: "$totalEarnings" },
              averageEarnings: { $avg: "$totalEarnings" },
              totalBalance: { $sum: "$availableBalance" }
            }
          }
        ]
      }
    }
  ];

  const result = await User.aggregate(pipeline);
  const users = result[0].data;
  const totalCount = result[0].totalCount[0]?.count || 0;
  const locationStats = result[0].locationStats[0] || {};

  return {
    users: users.map((user, index) => ({
      ...user,
      rank: offset + index + 1
    })),
    total: totalCount,
    totalPages: Math.ceil(totalCount / limit),
    currentPage: Math.floor(offset / limit) + 1,
    locationStats
  };
};

// Function to filter leaderboard by user status

exports.getLeaderboardByStatus = async (filters) => {
  const {
    status = 'active', // 'active', 'inactive', 'suspended'
    limit = 50,
    offset = 0,
    sortBy = 'totalEarnings',
    sortOrder = 'desc',
    period = 'all_time'
  } = filters;

  // Build status filter
  let statusFilter = {};
  switch (status) {
    case 'active':
      statusFilter = {
        'status.isActive': true,
        isBanned: { $ne: true },
        isSuspended: { $ne: true }
      };
      break;
    case 'inactive':
      statusFilter = {
        'status.isActive': false,
        isBanned: { $ne: true }
      };
      break;
    case 'suspended':
      statusFilter = {
        $or: [
          { isBanned: true },
          { isSuspended: true }
        ]
      };
      break;
    default:
      statusFilter = { 'status.isActive': true };
  }

  // Build date filter
  let dateFilter = {};
  if (period !== 'all_time') {
    const now = new Date();
    let startDate = new Date();
    
    switch (period) {
      case 'daily':
        startDate.setHours(0, 0, 0, 0);
        break;
      case 'weekly':
        startDate.setDate(now.getDate() - now.getDay());
        startDate.setHours(0, 0, 0, 0);
        break;
      case 'monthly':
        startDate.setDate(1);
        startDate.setHours(0, 0, 0, 0);
        break;
      case 'yearly':
        startDate.setMonth(0, 1);
        startDate.setHours(0, 0, 0, 0);
        break;
    }
    dateFilter.createdAt = { $gte: startDate };
  }

  // Determine sort field
  let sortField = {};
  switch (sortBy) {
    case 'totalEarnings':
      sortField = { totalEarnings: sortOrder === 'desc' ? -1 : 1 };
      break;
    case 'availableBalance':
      sortField = { availableBalance: sortOrder === 'desc' ? -1 : 1 };
      break;
    case 'totalShares':
      sortField = { totalShares: sortOrder === 'desc' ? -1 : 1 };
      break;
    case 'createdAt':
      sortField = { createdAt: sortOrder === 'desc' ? -1 : 1 };
      break;
    case 'lastActive':
      sortField = { lastActiveAt: sortOrder === 'desc' ? -1 : 1 };
      break;
    default:
      sortField = { totalEarnings: -1 };
  }

  const pipeline = [
    {
      $match: {
        ...statusFilter,
        ...dateFilter
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
        from: 'usershares',
        localField: '_id',
        foreignField: 'user',
        as: 'shares'
      }
    },
    {
      $addFields: {
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
        totalShares: { $sum: '$shares.totalShares' }
      }
    },
    {
      $addFields: {
        totalEarnings: { $ifNull: ["$referralInfo.totalEarnings", 0] },
        availableBalance: {
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
        },
        userStatus: {
          $cond: {
            if: { $or: [{ $eq: ["$isBanned", true] }, { $eq: ["$isSuspended", true] }] },
            then: "suspended",
            else: {
              $cond: {
                if: { $eq: ["$status.isActive", true] },
                then: "active",
                else: "inactive"
              }
            }
          }
        }
      }
    },
    {
      $sort: sortField
    },
    {
      $facet: {
        data: [
          { $skip: offset },
          { $limit: limit },
          {
            $project: {
              _id: 1,
              name: 1,
              userName: 1,
              totalEarnings: 1,
              availableBalance: 1,
              totalShares: 1,
              userStatus: 1,
              'status.isActive': 1,
              isBanned: 1,
              isSuspended: 1,
              'location.state': 1,
              'location.city': 1,
              createdAt: 1,
              lastActiveAt: 1
            }
          }
        ],
        totalCount: [{ $count: "count" }],
        statusStats: [
          {
            $group: {
              _id: "$userStatus",
              count: { $sum: 1 },
              totalEarnings: { $sum: "$totalEarnings" },
              averageEarnings: { $avg: "$totalEarnings" }
            }
          }
        ]
      }
    }
  ];

  const result = await User.aggregate(pipeline);
  const users = result[0].data;
  const totalCount = result[0].totalCount[0]?.count || 0;
  const statusStats = result[0].statusStats || [];

  return {
    users: users.map((user, index) => ({
      ...user,
      rank: offset + index + 1
    })),
    total: totalCount,
    totalPages: Math.ceil(totalCount / limit),
    currentPage: Math.floor(offset / limit) + 1,
    statusStats
  };
};

// Function to filter leaderboard by Number of Shares

exports.getLeaderboardByShares = async (filters) => {
  const {
    minShares = 0,
    maxShares = null,
    limit = 50,
    offset = 0,
    period = 'all_time',
    sortOrder = 'desc',
    shareType = 'all' // 'all', 'regular', 'cofounder'
  } = filters;

  // Build shares filter
  const sharesFilter = { $gte: minShares };
  if (maxShares !== null) {
    sharesFilter.$lte = maxShares;
  }

  // Build date filter
  let dateFilter = {};
  if (period !== 'all_time') {
    const now = new Date();
    let startDate = new Date();
    
    switch (period) {
      case 'daily':
        startDate.setHours(0, 0, 0, 0);
        break;
      case 'weekly':
        startDate.setDate(now.getDate() - now.getDay());
        startDate.setHours(0, 0, 0, 0);
        break;
      case 'monthly':
        startDate.setDate(1);
        startDate.setHours(0, 0, 0, 0);
        break;
      case 'yearly':
        startDate.setMonth(0, 1);
        startDate.setHours(0, 0, 0, 0);
        break;
    }
    dateFilter.createdAt = { $gte: startDate };
  }

  const pipeline = [
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
      $addFields: {
        // Calculate different types of shares
        regularShares: { $sum: '$shares.totalShares' },
        cofounderSharesTotal: { $sum: '$cofounderShares.totalShares' },
        combinedShares: { 
          $add: [
            { $sum: '$shares.totalShares' }, 
            { $sum: '$cofounderShares.totalShares' }
          ]
        },
        
        // Add referral info for additional context
        referralInfo: {
          $cond: {
            if: { $gt: [{ $size: "$referralData" }, 0] },
            then: { $arrayElemAt: ["$referralData", 0] },
            else: { totalEarnings: 0 }
          }
        }
      }
    },
    {
      $addFields: {
        // Determine which share count to use for filtering based on shareType
        filterShareCount: {
          $cond: {
            if: { $eq: [shareType, 'regular'] },
            then: '$regularShares',
            else: {
              $cond: {
                if: { $eq: [shareType, 'cofounder'] },
                then: '$cofounderSharesTotal',
                else: '$combinedShares' // 'all' or default
              }
            }
          }
        },
        
        // Add total earnings for context
        totalEarnings: { $ifNull: ["$referralInfo.totalEarnings", 0] }
      }
    },
    {
      $match: {
        'status.isActive': true,
        isBanned: { $ne: true },
        filterShareCount: sharesFilter,
        ...dateFilter
      }
    },
    {
      $sort: { 
        filterShareCount: sortOrder === 'desc' ? -1 : 1,
        totalEarnings: -1 // Secondary sort by earnings
      }
    },
    {
      $facet: {
        data: [
          { $skip: offset },
          { $limit: limit },
          {
            $project: {
              _id: 1,
              name: 1,
              userName: 1,
              regularShares: 1,
              cofounderSharesTotal: 1,
              combinedShares: 1,
              totalEarnings: 1,
              'location.state': 1,
              'location.city': 1,
              'status.isActive': 1,
              createdAt: 1,
              
              // Include share breakdown for display
              shareBreakdown: {
                regular: '$regularShares',
                cofounder: '$cofounderSharesTotal',
                total: '$combinedShares'
              },
              
              // Include the filtered share count for ranking
              filteredShares: '$filterShareCount'
            }
          }
        ],
        totalCount: [{ $count: "count" }],
        
        // Additional statistics
        stats: [
          {
            $group: {
              _id: null,
              totalShares: { $sum: '$filterShareCount' },
              averageShares: { $avg: '$filterShareCount' },
              maxShares: { $max: '$filterShareCount' },
              minShares: { $min: '$filterShareCount' },
              totalUsers: { $sum: 1 },
              totalEarnings: { $sum: '$totalEarnings' },
              averageEarnings: { $avg: '$totalEarnings' }
            }
          }
        ]
      }
    }
  ];

  const result = await User.aggregate(pipeline);
  const users = result[0].data;
  const totalCount = result[0].totalCount[0]?.count || 0;
  const stats = result[0].stats[0] || {};

  return {
    users: users.map((user, index) => ({
      ...user,
      rank: offset + index + 1
    })),
    total: totalCount,
    totalPages: Math.ceil(totalCount / limit),
    currentPage: Math.floor(offset / limit) + 1,
    shareType,
    statistics: {
      totalShares: stats.totalShares || 0,
      averageShares: Math.round((stats.averageShares || 0) * 100) / 100,
      maxShares: stats.maxShares || 0,
      minShares: stats.minShares || 0,
      totalUsers: stats.totalUsers || 0,
      totalEarnings: Math.round((stats.totalEarnings || 0) * 100) / 100,
      averageEarnings: Math.round((stats.averageEarnings || 0) * 100) / 100
    }
  };
};



exports.getVisibilitySettings = async (req, res) => {
  try {
    let settings = await AdminSettings.findOne();
    
    if (!settings) {
      settings = await AdminSettings.create({
        showEarnings: true,
        showAvailableBalance: true,
        updatedBy: req.user._id
      });
    }
    
    res.json({
      success: true,
      data: {
        showEarnings: settings.showEarnings,
        showAvailableBalance: settings.showAvailableBalance,
        lastUpdated: settings.updatedAt,
        updatedBy: settings.updatedBy
      }
    });
  } catch (error) {
    console.error('Error fetching visibility settings:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch visibility settings'
    });
  }
};

exports.toggleEarningsVisibility = async (req, res) => {
  try {
    const { visible } = req.body;
    
    if (typeof visible !== 'boolean') {
      return res.status(400).json({
        success: false,
        message: 'Visible field must be a boolean'
      });
    }
    
    let settings = await AdminSettings.findOne();
    
    if (!settings) {
      settings = new AdminSettings({
        showEarnings: visible,
        showAvailableBalance: true,
        updatedBy: req.user._id
      });
    } else {
      settings.showEarnings = visible;
      settings.updatedBy = req.user._id;
    }
    
    await settings.save();
    
    // Invalidate cache
    invalidateCache();
    
    // Log admin action if AdminAuditLog exists
    if (AdminAuditLog) {
      await AdminAuditLog.create({
        adminId: req.user._id,
        action: 'TOGGLE_EARNINGS_VISIBILITY',
        details: { visible, previousValue: !visible },
        ipAddress: req.ip,
        userAgent: req.get('User-Agent')
      });
    }
    
    res.json({
      success: true,
      message: `Earnings visibility ${visible ? 'enabled' : 'disabled'}`,
      data: {
        showEarnings: settings.showEarnings,
        showAvailableBalance: settings.showAvailableBalance
      }
    });
  } catch (error) {
    console.error('Error toggling earnings visibility:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to toggle earnings visibility'
    });
  }
};

exports.toggleBalanceVisibility = async (req, res) => {
  try {
    const { visible } = req.body;
    
    if (typeof visible !== 'boolean') {
      return res.status(400).json({
        success: false,
        message: 'Visible field must be a boolean'
      });
    }
    
    let settings = await AdminSettings.findOne();
    
    if (!settings) {
      settings = new AdminSettings({
        showEarnings: true,
        showAvailableBalance: visible,
        updatedBy: req.user._id
      });
    } else {
      settings.showAvailableBalance = visible;
      settings.updatedBy = req.user._id;
    }
    
    await settings.save();
    
    // Invalidate cache
    invalidateCache();
    
    // Log admin action if AdminAuditLog exists
    if (AdminAuditLog) {
      await AdminAuditLog.create({
        adminId: req.user._id,
        action: 'TOGGLE_BALANCE_VISIBILITY',
        details: { visible, previousValue: !visible },
        ipAddress: req.ip,
        userAgent: req.get('User-Agent')
      });
    }
    
    res.json({
      success: true,
      message: `Balance visibility ${visible ? 'enabled' : 'disabled'}`,
      data: {
        showEarnings: settings.showEarnings,
        showAvailableBalance: settings.showAvailableBalance
      }
    });
  } catch (error) {
    console.error('Error toggling balance visibility:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to toggle balance visibility'
    });
  }
};