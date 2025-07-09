// controller/leaderboardController.js
const User = require('../models/User');
const Referral = require('../models/Referral');
const CoFounderShare = require('../models/CoFounderShare');
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

const calculateTotalShares = (regularShares, cofounderShares, ratio = 29) => {
  return regularShares + (cofounderShares * ratio);
};


const { leaderboardQuerySchema, visibilityUpdateSchema, bulkUpdateSchema } = adminValidation;

// ====================
// EXISTING PUBLIC LEADERBOARD METHODS (PRESERVED)
// ====================

// Main leaderboard aggregation function (existing - preserved)
// Replace the existing aggregation pipeline in getTimeFilteredLeaderboard function
// This fixes the cofounder shares lookup issue
const getTimeFilteredLeaderboard = async (timeFrame, categoryFilter = 'registration', limit = Number.MAX_SAFE_INTEGER) => {
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
      sortField = { 'totalCofounderShares': -1 };
      matchCriteria['totalCofounderShares'] = { $gt: 0 };
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
  
  // Get the actual collection name for transactions
  const PaymentTransaction = require('../models/Transaction');
  const actualCollectionName = PaymentTransaction.collection.name;
  
  // Get co-founder share ratio
  let shareToRegularRatio = 29; // Default
  try {
    const CoFounderShare = require('../models/CoFounderShare');
    const coFounderConfig = await CoFounderShare.findOne();
    if (coFounderConfig && coFounderConfig.shareToRegularRatio) {
      shareToRegularRatio = coFounderConfig.shareToRegularRatio;
    }
  } catch (error) {
    console.log('Could not get ratio from CoFounderShare model, using default 29');
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
    // Lookup regular shares
    {
      $lookup: {
        from: 'usershares',
        localField: '_id',
        foreignField: 'user',
        as: 'shares'
      }
    },
    
    // FIXED: Lookup co-founder shares from PaymentTransaction collection only
    {
      $lookup: {
        from: actualCollectionName,
        let: { userId: '$_id' },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$userId', '$$userId'] },
                  { $eq: ['$type', 'co-founder'] },
                  { $eq: ['$status', 'completed'] }
                ]
              }
            }
          }
        ],
        as: 'cofounderTransactions'
      }
    },
    
    // Lookup referral data
    {
      $lookup: {
        from: 'referrals',
        localField: '_id',
        foreignField: 'user',
        as: 'referralData'
      }
    },
    
    // Lookup referral transactions
    {
      $lookup: {
        from: 'referraltransactions',
        localField: '_id',
        foreignField: 'beneficiary',
        as: 'referralTransactions'
      }
    },
    
    // Lookup withdrawals
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
  
  // FIXED: Calculate shares with single source for co-founder shares
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
      
      // Regular shares (from UserShare)
      regularShares: { $sum: '$shares.totalShares' },
      
      // FIXED: Co-founder shares ONLY from PaymentTransaction (single source)
      totalCofounderShares: {
        $sum: '$cofounderTransactions.shares'
      }
    }
  });
  
  // FIXED: Calculate derived fields with single co-founder source
  aggregatePipeline.push({
    $addFields: {
      // FIXED: Convert co-founder shares to regular share equivalent (single source)
      equivalentRegularSharesFromCofounder: {
        $multiply: [
          '$totalCofounderShares',
          shareToRegularRatio
        ]
      },
      
      // FIXED: Calculate TOTAL shares (regular + equivalent from co-founder)
      totalShares: {
        $add: [
          { $sum: '$shares.totalShares' }, // Regular shares
          {
            $multiply: [
              '$totalCofounderShares',
              shareToRegularRatio
            ]
          } // Equivalent regular shares from co-founder
        ]
      },
      
      // FIXED: Combined shares (same as totalShares for consistency)
      combinedShares: {
        $add: [
          { $sum: '$shares.totalShares' }, // Regular shares
          {
            $multiply: [
              '$totalCofounderShares',
              shareToRegularRatio
            ]
          } // Equivalent regular shares from co-founder
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
                    { $in: ['$$withdrawal.status', ['paid', 'approved']] },
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
      
      // FIXED: Total spent including co-founder transactions
      totalSpent: { 
        $add: [
          { 
            $sum: {
              $map: {
                input: { $ifNull: [{ $arrayElemAt: ['$shares.transactions', 0] }, []] },
                as: 'transaction',
                in: { $ifNull: ['$$transaction.totalAmount', 0] }
              }
            }
          },
          { $sum: '$cofounderTransactions.amount' } // Include co-founder transaction amounts
        ]
      }
    }
  });
  
  // Calculate derived fields
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
        // FIXED: Use the corrected totalShares that includes co-founder equivalent
        totalShares: 1,
        // FIXED: Show actual co-founder shares count (single source)
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
        // FIXED: Add breakdown for debugging with single source
        ...(process.env.NODE_ENV === 'development' && {
          shareBreakdown: {
            regularShares: '$regularShares',
            cofounderShares: '$totalCofounderShares', // Single source
            equivalentRegularFromCofounder: '$equivalentRegularSharesFromCofounder',
            totalCalculated: '$totalShares'
          }
        }),
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

const getFilteredLeaderboard = async (categoryFilter = 'registration', limit = Number.MAX_SAFE_INTEGER) => {
  return getTimeFilteredLeaderboard(null, categoryFilter, limit);
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
    const limit = req.query.limit ? parseInt(req.query.limit) : Number.MAX_SAFE_INTEGER;
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
    const limit = req.query.limit ? parseInt(req.query.limit) : Number.MAX_SAFE_INTEGER;
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
    const limit = req.query.limit ? parseInt(req.query.limit) : Number.MAX_SAFE_INTEGER;
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
    const limit = req.query.limit ? parseInt(req.query.limit) : Number.MAX_SAFE_INTEGER;
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
    const limit = req.query.limit ? parseInt(req.query.limit) : Number.MAX_SAFE_INTEGER;
    
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
    const limit = req.query.limit ? parseInt(req.query.limit) : Number.MAX_SAFE_INTEGER;
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
    const limit = req.query.limit ? parseInt(req.query.limit) : Number.MAX_SAFE_INTEGER;
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
    const limit = req.query.limit ? parseInt(req.query.limit) : Number.MAX_SAFE_INTEGER;
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

// Updated getCofounderLeaderboard function with dynamic collection detection
exports.getCofounderLeaderboard = async (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit) : 50;
    
    console.log('Getting cofounder leaderboard with limit:', limit);
    
    // Get the actual collection name used by PaymentTransaction model
    const PaymentTransaction = require('../models/Transaction');
    const actualCollectionName = PaymentTransaction.collection.name;
    
    console.log('Using transaction collection:', actualCollectionName);
    
    // Get the co-founder share ratio
    let shareToRegularRatio = 29; // Default
    try {
      const CoFounderShare = require('../models/CoFounderShare');
      const coFounderConfig = await CoFounderShare.findOne();
      if (coFounderConfig && coFounderConfig.shareToRegularRatio) {
        shareToRegularRatio = coFounderConfig.shareToRegularRatio;
      }
    } catch (error) {
      console.log('Could not get ratio from CoFounderShare model, using default 29');
    }
    
    // FIXED: Updated aggregation pipeline to use ONLY PaymentTransaction for co-founder shares
    const pipeline = [
      // First, get all active users
      {
        $match: {
          'status.isActive': true,
          isBanned: { $ne: true }
        }
      },
      
      // FIXED: Lookup completed co-founder transactions from PaymentTransaction collection ONLY
      {
        $lookup: {
          from: actualCollectionName,
          let: { userId: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$userId', '$$userId'] },
                    { $eq: ['$type', 'co-founder'] },
                    { $eq: ['$status', 'completed'] }
                  ]
                }
              }
            }
          ],
          as: 'cofounderTransactions'
        }
      },
      
      // Lookup regular shares
      {
        $lookup: {
          from: 'usershares',
          localField: '_id',
          foreignField: 'user',
          as: 'shares'
        }
      },
      
      // Lookup referral data for context
      {
        $lookup: {
          from: 'referrals',
          localField: '_id',
          foreignField: 'user',
          as: 'referralData'
        }
      },
      
      // FIXED: Calculate total co-founder shares from SINGLE source only
      {
        $addFields: {
          // Regular shares from UserShare
          regularShares: { $sum: '$shares.totalShares' },
          
          // FIXED: Shares from PaymentTransaction ONLY (single source)
          totalCofounderShares: {
            $sum: '$cofounderTransactions.shares'
          },
          
          // Total earnings for context
          totalEarnings: {
            $ifNull: [
              { $arrayElemAt: ['$referralData.totalEarnings', 0] },
              0
            ]
          },
          
          // Debug info
          transactionCount: { $size: '$cofounderTransactions' }
        }
      },
      
      // FIXED: Calculate equivalent regular shares from single source
      {
        $addFields: {
          // Calculate equivalent regular shares from co-founder shares
          equivalentRegularShares: {
            $multiply: [
              '$totalCofounderShares',
              shareToRegularRatio
            ]
          },
          
          // FIXED: Calculate total shares (regular + co-founder equivalent)
          totalShares: {
            $add: [
              '$regularShares',
              {
                $multiply: [
                  '$totalCofounderShares',
                  shareToRegularRatio
                ]
              }
            ]
          }
        }
      },
      
      // FIXED: Only include users who actually have co-founder shares from PaymentTransaction
      {
        $match: {
          totalCofounderShares: { $gt: 0 }
        }
      },
      
      // Sort by total co-founder shares descending
      {
        $sort: { totalCofounderShares: -1, totalEarnings: -1 }
      },
      
      // Limit results
      {
        $limit: limit
      },
      
      // Project final fields
      {
        $project:         {
          _id: 1,
          name: 1,
          userName: 1,
          regularShares: 1,
          totalCofounderShares: 1,
          totalShares: 1,
          equivalentRegularShares: 1,
          totalEarnings: 1,
          'location.state': 1,
          'location.city': 1,
          createdAt: 1,
          
          // Debug info (only in development)
          ...(process.env.NODE_ENV === 'development' && {
            transactionCount: 1,
            shareBreakdown: {
              regularShares: '$regularShares',
              cofounderShares: '$totalCofounderShares',
              equivalentRegular: '$equivalentRegularShares',
              totalShares: '$totalShares'
            }
          })
        }
      }
    ];
    
    console.log('Executing cofounder aggregation pipeline...');
    const cofounders = await User.aggregate(pipeline);
    
    console.log(`Found ${cofounders.length} cofounders with shares > 0`);
    
    // Enhanced debug info (only in development)
    let debugInfo = {};
    if (process.env.NODE_ENV === 'development') {
      try {
        // Check total completed co-founder transactions
        const totalCompletedTransactions = await PaymentTransaction.countDocuments({
          type: 'co-founder',
          status: 'completed'
        });
        
        const uniqueUsersWithTransactions = await PaymentTransaction.distinct('userId', {
          type: 'co-founder',
          status: 'completed'
        });
        
        debugInfo = {
          actualCollectionName,
          shareToRegularRatio,
          totalCofoundersFound: cofounders.length,
          totalCompletedTransactions,
          uniqueUsersWithTransactions: uniqueUsersWithTransactions.length,
          dataSources: {
            paymentTransactionUsers: uniqueUsersWithTransactions.length,
            singleSourceResults: cofounders.length
          }
        };
        
        console.log('Debug info:', debugInfo);
      } catch (debugError) {
        console.error('Error collecting debug info:', debugError);
      }
    }
    
    res.json({
      success: true,
      data: cofounders.map((user, index) => ({
        ...user,
        rank: index + 1
      })),
      pagination: {
        currentPage: 1,
        totalPages: 1,
        totalItems: cofounders.length,
        hasNext: false,
        hasPrev: false,
        limit: limit
      },
      filter: 'cofounder',
      shareToRegularRatio,
      ...(process.env.NODE_ENV === 'development' && { debug: debugInfo })
    });
    
  } catch (error) {
    console.error('Error fetching cofounder leaderboard:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch cofounder leaderboard',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Alternative simpler diagnostic function to check what data exists
exports.diagnoseCofounderData = async (req, res) => {
  try {
    const diagnostics = {};
    
    // Check CoFounderShare collection
    try {
      const cofounderConfig = await CoFounderShare.findOne();
      diagnostics.cofounderConfig = {
        exists: !!cofounderConfig,
        totalShares: cofounderConfig?.totalShares || 0,
        sharesSold: cofounderConfig?.sharesSold || 0,
        ratio: cofounderConfig?.shareToRegularRatio || 0
      };
    } catch (e) {
      diagnostics.cofounderConfig = { error: e.message };
    }
    
    // Check transactions collection for cofounder transactions
    try {
      const cofounderTransactions = await User.aggregate([
        {
          $lookup: {
            from: 'transactions',
            localField: '_id',
            foreignField: 'userId',
            as: 'transactions'
          }
        },
        {
          $unwind: '$transactions'
        },
        {
          $match: {
            'transactions.type': 'co-founder',
            'transactions.status': 'completed'
          }
        },
        {
          $project: {
            name: 1,
            'transactions.shares': 1,
            'transactions.amount': 1,
            'transactions.currency': 1
          }
        },
        { $limit: 5 }
      ]);
      
      diagnostics.paymentTransactions = {
        count: cofounderTransactions.length,
        sample: cofounderTransactions
      };
    } catch (e) {
      diagnostics.paymentTransactions = { error: e.message };
    }
    
    // Check UserShare collection for cofounder data
    try {
      const usersWithCofounderShares = await User.aggregate([
        {
          $lookup: {
            from: 'usershares',
            localField: '_id',
            foreignField: 'user',
            as: 'userShares'
          }
        },
        {
          $unwind: { path: '$userShares', preserveNullAndEmptyArrays: true }
        },
        {
          $match: {
            $or: [
              { 'userShares.cofounderShares': { $gt: 0 } },
              { 'userShares.transactions.paymentMethod': 'co-founder' }
            ]
          }
        },
        {
          $project: {
            name: 1,
            'userShares.cofounderShares': 1,
            'userShares.totalShares': 1,
            cofounderTransactions: {
              $filter: {
                input: '$userShares.transactions',
                as: 'transaction',
                cond: { $eq: ['$transaction.paymentMethod', 'co-founder'] }
              }
            }
          }
        },
        { $limit: 5 }
      ]);
      
      diagnostics.userSharesWithCofounder = {
        count: usersWithCofounderShares.length,
        sample: usersWithCofounderShares
      };
    } catch (e) {
      diagnostics.userSharesWithCofounder = { error: e.message };
    }
    
    // Check direct cofoundershares collection if it exists
    try {
      const directCofounderShares = await User.aggregate([
        {
          $lookup: {
            from: 'cofoundershares',
            localField: '_id',
            foreignField: 'user',
            as: 'cofounderShares'
          }
        },
        {
          $match: {
            'cofounderShares.totalShares': { $gt: 0 }
          }
        },
        {
          $project: {
            name: 1,
            'cofounderShares.totalShares': 1
          }
        },
        { $limit: 5 }
      ]);
      
      diagnostics.directCofounderShares = {
        count: directCofounderShares.length,
        sample: directCofounderShares
      };
    } catch (e) {
      diagnostics.directCofounderShares = { error: e.message };
    }
    
    res.json({
      success: true,
      diagnostics
    });
    
  } catch (error) {
    console.error('Error in cofounder diagnostics:', error);
    res.status(500).json({
      success: false,
      message: 'Diagnostics failed',
      error: error.message
    });
  }
};

// Alternative simpler diagnostic function to check what data exists
exports.diagnoseCofounderData = async (req, res) => {
  try {
    const diagnostics = {};
    
    // Check CoFounderShare collection
    try {
      const cofounderConfig = await CoFounderShare.findOne();
      diagnostics.cofounderConfig = {
        exists: !!cofounderConfig,
        totalShares: cofounderConfig?.totalShares || 0,
        sharesSold: cofounderConfig?.sharesSold || 0,
        ratio: cofounderConfig?.shareToRegularRatio || 0
      };
    } catch (e) {
      diagnostics.cofounderConfig = { error: e.message };
    }
    
    // Check PaymentTransaction collection for cofounder transactions
    try {
      const PaymentTransaction = require('../models/Transaction'); // Adjust path as needed
      const cofounderTransactions = await PaymentTransaction.find({ 
        type: 'co-founder',
        status: 'completed'
      }).select('userId shares amount currency').limit(5);
      
      diagnostics.paymentTransactions = {
        count: cofounderTransactions.length,
        sample: cofounderTransactions
      };
    } catch (e) {
      diagnostics.paymentTransactions = { error: e.message };
    }
    
    // Check UserShare collection for cofounder data
    try {
      const usersWithCofounderShares = await User.aggregate([
        {
          $lookup: {
            from: 'usershares',
            localField: '_id',
            foreignField: 'user',
            as: 'userShares'
          }
        },
        {
          $unwind: { path: '$userShares', preserveNullAndEmptyArrays: true }
        },
        {
          $match: {
            $or: [
              { 'userShares.cofounderShares': { $gt: 0 } },
              { 'userShares.transactions.paymentMethod': 'co-founder' }
            ]
          }
        },
        {
          $project: {
            name: 1,
            'userShares.cofounderShares': 1,
            'userShares.totalShares': 1,
            cofounderTransactions: {
              $filter: {
                input: '$userShares.transactions',
                as: 'transaction',
                cond: { $eq: ['$$transaction.paymentMethod', 'co-founder'] }
              }
            }
          }
        },
        { $limit: 5 }
      ]);
      
      diagnostics.userSharesWithCofounder = {
        count: usersWithCofounderShares.length,
        sample: usersWithCofounderShares
      };
    } catch (e) {
      diagnostics.userSharesWithCofounder = { error: e.message };
    }
    
    // Check direct cofoundershares collection if it exists
    try {
      const directCofounderShares = await mongoose.connection.db
        .collection('cofoundershares')
        .find({})
        .limit(5)
        .toArray();
      
      diagnostics.directCofounderShares = {
        count: directCofounderShares.length,
        sample: directCofounderShares
      };
    } catch (e) {
      diagnostics.directCofounderShares = { error: e.message };
    }
    
    res.json({
      success: true,
      diagnostics
    });
    
  } catch (error) {
    console.error('Error in cofounder diagnostics:', error);
    res.status(500).json({
      success: false,
      message: 'Diagnostics failed',
      error: error.message
    });
  }
};

// Add this diagnostic function to your leaderboardController.js
exports.diagnoseCofounderDataDetailed = async (req, res) => {
  try {
    const diagnostics = {};
    
    // 1. Check all co-founder transactions directly from PaymentTransaction model
    const PaymentTransaction = require('../models/Transaction'); // Adjust path as needed
    
    const allCofounderTransactions = await PaymentTransaction.find({ 
      type: 'co-founder' 
    }).select('userId shares amount status createdAt transactionId')
     .populate('userId', 'name userName')
     .sort({ createdAt: -1 });
    
    diagnostics.allTransactions = {
      total: allCofounderTransactions.length,
      byStatus: allCofounderTransactions.reduce((acc, t) => {
        acc[t.status] = (acc[t.status] || 0) + 1;
        return acc;
      }, {}),
      details: allCofounderTransactions.map(t => ({
        transactionId: t.transactionId,
        userId: t.userId?._id,
        userName: t.userId?.userName,
        name: t.userId?.name,
        shares: t.shares,
        status: t.status,
        date: t.createdAt
      }))
    };
    
    // 2. Check what collection name is actually used for transactions
    const mongoose = require('mongoose');
    const collections = await mongoose.connection.db.listCollections().toArray();
    const transactionCollections = collections
      .map(c => c.name)
      .filter(name => name.toLowerCase().includes('transaction'));
    
    diagnostics.collectionInfo = {
      allCollections: collections.map(c => c.name),
      transactionCollections: transactionCollections
    };
    
    // 3. Check the actual collection name used by PaymentTransaction model
    const actualCollectionName = PaymentTransaction.collection.name;
    diagnostics.paymentTransactionCollection = actualCollectionName;
    
    // 4. Test aggregation with the correct collection name
    if (actualCollectionName) {
      const testAggregation = await User.aggregate([
        {
          $match: {
            'status.isActive': true
          }
        },
        {
          $lookup: {
            from: actualCollectionName, // Use the actual collection name
            let: { userId: '$_id' },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ['$userId', '$$userId'] },
                      { $eq: ['$type', 'co-founder'] },
                      { $eq: ['$status', 'completed'] }
                    ]
                  }
                }
              }
            ],
            as: 'cofounderTransactions'
          }
        },
        {
          $addFields: {
            totalCofounderShares: { $sum: '$cofounderTransactions.shares' },
            transactionCount: { $size: '$cofounderTransactions' }
          }
        },
        {
          $match: {
            totalCofounderShares: { $gt: 0 }
          }
        },
        {
          $project: {
            name: 1,
            userName: 1,
            totalCofounderShares: 1,
            transactionCount: 1,
            transactionDetails: {
              $map: {
                input: '$cofounderTransactions',
                as: 'transaction',
                in: {
                  shares: '$$transaction.shares',
                  status: '$$transaction.status',
                  transactionId: '$$transaction.transactionId'
                }
              }
            }
          }
        }
      ]);
      
      diagnostics.testAggregationWithCorrectCollection = {
        resultCount: testAggregation.length,
        results: testAggregation
      };
    }
    
    // 5. Check completed transactions grouped by user
    const completedTransactions = await PaymentTransaction.aggregate([
      {
        $match: {
          type: 'co-founder',
          status: 'completed'
        }
      },
      {
        $group: {
          _id: '$userId',
          totalShares: { $sum: '$shares' },
          totalAmount: { $sum: '$amount' },
          transactionCount: { $sum: 1 },
          transactions: {
            $push: {
              transactionId: '$transactionId',
              shares: '$shares',
              amount: '$amount',
              date: '$createdAt'
            }
          }
        }
      },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'user'
        }
      },
      {
        $project: {
          userId: '$_id',
          userName: { $arrayElemAt: ['$user.userName', 0] },
          name: { $arrayElemAt: ['$user.name', 0] },
          totalShares: 1,
          totalAmount: 1,
          transactionCount: 1,
          transactions: 1
        }
      }
    ]);
    
    diagnostics.completedByUser = {
      userCount: completedTransactions.length,
      totalShares: completedTransactions.reduce((sum, u) => sum + u.totalShares, 0),
      users: completedTransactions
    };
    
    res.json({
      success: true,
      diagnostics,
      summary: {
        totalTransactions: allCofounderTransactions.length,
        completedTransactions: allCofounderTransactions.filter(t => t.status === 'completed').length,
        uniqueUsersWithCompletedTransactions: completedTransactions.length,
        actualCollectionName: actualCollectionName,
        shouldShowInLeaderboard: completedTransactions.length
      }
    });
    
  } catch (error) {
    console.error('Error in detailed diagnostics:', error);
    res.status(500).json({
      success: false,
      message: 'Diagnostics failed',
      error: error.message
    });
  }
};

exports.getEarningsLeaderboard = async (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit) : Number.MAX_SAFE_INTEGER;
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
    const limit = req.query.limit ? parseInt(req.query.limit) : Number.MAX_SAFE_INTEGER;
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



exports.getLeaderboardByLocation = async (filters) => {
  const {
    country = null,
    state = null,
    city = null,
    limit = 50,
    offset = 0,
    sortBy = 'totalEarnings',
    sortOrder = 'desc',
    period = 'all_time'
  } = filters;

  // Build location filter - check both top-level and nested location fields
  const locationFilter = {};
  
  if (country) {
    locationFilter.$or = [
      { country: country },
      { 'location.country': country }
    ];
  }
  
  if (state) {
    const stateConditions = [
      { state: state },
      { 'location.state': state }
    ];
    
    if (locationFilter.$or) {
      // If country filter already exists, combine with AND
      locationFilter.$and = [
        { $or: locationFilter.$or },
        { $or: stateConditions }
      ];
      delete locationFilter.$or;
    } else {
      locationFilter.$or = stateConditions;
    }
  }
  
  if (city) {
    const cityConditions = [
      { city: city },
      { 'location.city': city }
    ];
    
    if (locationFilter.$and) {
      // If we already have AND conditions, add to them
      locationFilter.$and.push({ $or: cityConditions });
    } else if (locationFilter.$or) {
      // Convert existing OR to AND structure
      locationFilter.$and = [
        { $or: locationFilter.$or },
        { $or: cityConditions }
      ];
      delete locationFilter.$or;
    } else {
      locationFilter.$or = cityConditions;
    }
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
    default:
      sortField = { totalEarnings: -1 };
  }

  const pipeline = [
    {
      $match: {
        'status.isActive': true,
        isBanned: { $ne: true },
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
        
        // FIXED: Include co-founder shares in total calculation
        regularShares: { $sum: '$shares.totalShares' },
        
        // Get co-founder shares
        cofounderShares: { $sum: '$cofounderTransactions.shares' },
        
        // FIXED: Total shares = regular + (cofounder * 29)
        totalShares: {
          $add: [
            { $sum: '$shares.totalShares' },
            {
              $multiply: [
                { $sum: '$cofounderTransactions.shares' },
                29 // shareToRegularRatio
              ]
            }
          ]
        }
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
        // Normalize location fields for consistent output
        userCountry: {
          $cond: {
            if: { $ne: ["$country", null] },
            then: "$country",
            else: "$location.country"
          }
        },
        userState: {
          $cond: {
            if: { $ne: ["$state", null] },
            then: "$state",
            else: "$location.state"
          }
        },
        userCity: {
          $cond: {
            if: { $ne: ["$city", null] },
            then: "$city",
            else: "$location.city"
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
              // Use separate fields to avoid path collision - NO nested location fields
              userCountry: 1,
              userState: 1,
              userCity: 1,
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
              totalBalance: { $sum: "$availableBalance" },
              maxEarnings: { $max: "$totalEarnings" },
              minEarnings: { $min: "$totalEarnings" }
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
      rank: offset + index + 1,
      // Create location object from separate fields
      location: {
        country: user.userCountry,
        state: user.userState,
        city: user.userCity
      }
    })).map(user => {
      // Remove the separate location fields since we've combined them into location object
      const { userCountry, userState, userCity, ...userWithoutSeparateFields } = user;
      return userWithoutSeparateFields;
    }),
    total: totalCount,
    totalPages: Math.ceil(totalCount / limit),
    currentPage: Math.floor(offset / limit) + 1,
    locationStats: {
      totalUsers: locationStats.totalUsers || 0,
      totalEarnings: Math.round((locationStats.totalEarnings || 0) * 100) / 100,
      averageEarnings: Math.round((locationStats.averageEarnings || 0) * 100) / 100,
      totalBalance: Math.round((locationStats.totalBalance || 0) * 100) / 100,
      maxEarnings: Math.round((locationStats.maxEarnings || 0) * 100) / 100,
      minEarnings: Math.round((locationStats.minEarnings || 0) * 100) / 100
    }
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
        from: 'cofoundershares',
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
      $lookup: {
        from: 'transactions', // Use actual collection name
        let: { userId: '$_id' },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$userId', '$$userId'] },
                  { $eq: ['$type', 'co-founder'] },
                  { $eq: ['$status', 'completed'] }
                ]
              }
            }
          }
        ],
        as: 'cofounderTransactions'
      }
    },
    {
      $addFields: {
        // FIXED: Calculate different types of shares including co-founder conversion
        regularShares: { $sum: '$shares.totalShares' },
        
        // Get co-founder shares from both sources
        cofounderSharesFromTransaction: { $sum: '$cofounderShares.totalShares' },
        cofounderSharesFromPaymentTx: { $sum: '$cofounderTransactions.shares' },
        
        // Total co-founder shares
        totalCofounderShares: {
          $add: [
            { $sum: '$cofounderShares.totalShares' },
            { $sum: '$cofounderTransactions.shares' }
          ]
        },
        
        // FIXED: Combined shares = regular + (cofounder * ratio)
        combinedShares: { 
          $add: [
            { $sum: '$shares.totalShares' }, // Regular shares
            {
              $multiply: [
                {
                  $add: [
                    { $sum: '$cofounderShares.totalShares' },
                    { $sum: '$cofounderTransactions.shares' }
                  ]
                },
                29 // shareToRegularRatio - you can make this dynamic
              ]
            }
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

exports.updateVisibilitySettings = async (req, res) => {
  try {
    const { showEarnings, showAvailableBalance } = req.body;
    
    if (typeof showEarnings !== 'boolean' || typeof showAvailableBalance !== 'boolean') {
      return res.status(400).json({
        success: false,
        message: 'Both showEarnings and showAvailableBalance must be boolean values'
      });
    }
    
    let settings = await AdminSettings.findOne();
    
    if (!settings) {
      settings = new AdminSettings({
        showEarnings,
        showAvailableBalance,
        updatedBy: req.user._id
      });
    } else {
      settings.showEarnings = showEarnings;
      settings.showAvailableBalance = showAvailableBalance;
      settings.updatedBy = req.user._id;
    }
    
    await settings.save();
    
    // Invalidate cache
    invalidateCache();
    
    // Log admin action if AdminAuditLog exists
    if (AdminAuditLog) {
      await AdminAuditLog.create({
        adminId: req.user._id,
        action: 'UPDATE_VISIBILITY_SETTINGS',
        details: { showEarnings, showAvailableBalance },
        ipAddress: req.ip,
        userAgent: req.get('User-Agent')
      });
    }
    
    res.json({
      success: true,
      message: 'Visibility settings updated successfully',
      data: {
        showEarnings: settings.showEarnings,
        showAvailableBalance: settings.showAvailableBalance
      }
    });
  } catch (error) {
    console.error('Error updating visibility settings:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update visibility settings'
    });
  }
};


// Add this new function to get location analytics with proper field handling
exports.getLocationAnalyticsFixed = async (type = 'countries', parentFilter = null, limit = 10) => {
  const matchStage = { 
    'status.isActive': true,
    isBanned: { $ne: true }
  };
  
  let groupBy;
  let projectFields = {};
  
  switch (type) {
    case 'countries':
      groupBy = {
        $cond: {
          if: { $ne: ["$country", null] },
          then: "$country",
          else: "$location.country"
        }
      };
      projectFields = { country: '$_id' };
      break;
      
    case 'states':
      groupBy = {
        country: {
          $cond: {
            if: { $ne: ["$country", null] },
            then: "$country",
            else: "$location.country"
          }
        },
        state: {
          $cond: {
            if: { $ne: ["$state", null] },
            then: "$state",
            else: "$location.state"
          }
        }
      };
      
      if (parentFilter) {
        matchStage.$or = [
          { country: parentFilter },
          { 'location.country': parentFilter }
        ];
      }
      
      projectFields = { 
        country: '$_id.country',
        state: '$_id.state'
      };
      break;
      
    case 'cities':
      groupBy = {
        country: {
          $cond: {
            if: { $ne: ["$country", null] },
            then: "$country",
            else: "$location.country"
          }
        },
        state: {
          $cond: {
            if: { $ne: ["$state", null] },
            then: "$state",
            else: "$location.state"
          }
        },
        city: {
          $cond: {
            if: { $ne: ["$city", null] },
            then: "$city",
            else: "$location.city"
          }
        }
      };
      
      if (parentFilter) {
        // parentFilter could be country or state
        matchStage.$or = [
          { state: parentFilter, 'location.state': parentFilter },
          { country: parentFilter, 'location.country': parentFilter }
        ];
      }
      
      projectFields = { 
        country: '$_id.country',
        state: '$_id.state', 
        city: '$_id.city'
      };
      break;
  }

  const pipeline = [
    { $match: matchStage },
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
      $group: {
        _id: groupBy,
        totalUsers: { $sum: 1 },
        totalEarnings: { $sum: '$totalEarnings' },
        averageEarnings: { $avg: '$totalEarnings' },
        topEarner: { $max: '$totalEarnings' }
      }
    },
    { 
      $match: { 
        '_id': { $ne: null },
        ...(type === 'countries' && { '_id': { $ne: '' } }),
        ...(type === 'states' && { '_id.state': { $ne: null, $ne: '' } }),
        ...(type === 'cities' && { '_id.city': { $ne: null, $ne: '' } })
      }
    },
    { $sort: { totalEarnings: -1 } },
    { $limit: limit },
    {
      $project: {
        _id: 0,
        ...projectFields,
        totalUsers: 1,
        totalEarnings: { $round: ['$totalEarnings', 2] },
        averageEarnings: { $round: ['$averageEarnings', 2] },
        topEarner: { $round: ['$topEarner', 2] }
      }
    }
  ];

  return await User.aggregate(pipeline);
};
exports.getLeaderboardByLocation = async (filters) => {
  const {
    country = null,
    state = null,
    city = null,
    limit = 50,
    offset = 0,
    sortBy = 'totalEarnings',
    sortOrder = 'desc',
    period = 'all_time'
  } = filters;

  // Build location filter - check both top-level and nested location fields
  const locationFilter = {};
  
  if (country) {
    locationFilter.$or = [
      { country: country },
      { 'location.country': country }
    ];
  }
  
  if (state) {
    const stateConditions = [
      { state: state },
      { 'location.state': state }
    ];
    
    if (locationFilter.$or) {
      // If country filter already exists, combine with AND
      locationFilter.$and = [
        { $or: locationFilter.$or },
        { $or: stateConditions }
      ];
      delete locationFilter.$or;
    } else {
      locationFilter.$or = stateConditions;
    }
  }
  
  if (city) {
    const cityConditions = [
      { city: city },
      { 'location.city': city }
    ];
    
    if (locationFilter.$and) {
      // If we already have AND conditions, add to them
      locationFilter.$and.push({ $or: cityConditions });
    } else if (locationFilter.$or) {
      // Convert existing OR to AND structure
      locationFilter.$and = [
        { $or: locationFilter.$or },
        { $or: cityConditions }
      ];
      delete locationFilter.$or;
    } else {
      locationFilter.$or = cityConditions;
    }
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
    default:
      sortField = { totalEarnings: -1 };
  }

  const pipeline = [
    {
      $match: {
        'status.isActive': true,
        isBanned: { $ne: true },
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
        },
        // Normalize location fields for consistent output - use different field names to avoid collision
        resolvedCountry: {
          $cond: {
            if: { $ne: ["$country", null] },
            then: "$country",
            else: "$location.country"
          }
        },
        resolvedState: {
          $cond: {
            if: { $ne: ["$state", null] },
            then: "$state",
            else: "$location.state"
          }
        },
        resolvedCity: {
          $cond: {
            if: { $ne: ["$city", null] },
            then: "$city",
            else: "$location.city"
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
              // Use the resolved location fields
              resolvedCountry: 1,
              resolvedState: 1,
              resolvedCity: 1,
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
              totalBalance: { $sum: "$availableBalance" },
              maxEarnings: { $max: "$totalEarnings" },
              minEarnings: { $min: "$totalEarnings" }
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
      _id: user._id,
      name: user.name,
      userName: user.userName,
      totalEarnings: user.totalEarnings,
      availableBalance: user.availableBalance,
      totalShares: user.totalShares,
      // Create clean location object from resolved fields
      location: {
        country: user.resolvedCountry,
        state: user.resolvedState,
        city: user.resolvedCity
      },
      status: user.status,
      createdAt: user.createdAt,
      rank: offset + index + 1
    })),
    total: totalCount,
    totalPages: Math.ceil(totalCount / limit),
    currentPage: Math.floor(offset / limit) + 1,
    locationStats: {
      totalUsers: locationStats.totalUsers || 0,
      totalEarnings: Math.round((locationStats.totalEarnings || 0) * 100) / 100,
      averageEarnings: Math.round((locationStats.averageEarnings || 0) * 100) / 100,
      totalBalance: Math.round((locationStats.totalBalance || 0) * 100) / 100,
      maxEarnings: Math.round((locationStats.maxEarnings || 0) * 100) / 100,
      minEarnings: Math.round((locationStats.minEarnings || 0) * 100) / 100
    }
  };
};

exports.getLeaderboardByLocationFixed = async (filters) => {
  const {
    country = null,
    state = null,
    city = null,
    limit = 50,
    offset = 0,
    sortBy = 'totalEarnings',
    sortOrder = 'desc',
    period = 'all_time'
  } = filters;

  // Build location filter - check both top-level and nested location fields
  const locationFilter = {};
  
  if (country) {
    locationFilter.$or = [
      { country: country },
      { 'location.country': country }
    ];
  }
  
  if (state) {
    const stateConditions = [
      { state: state },
      { 'location.state': state }
    ];
    
    if (locationFilter.$or) {
      locationFilter.$and = [
        { $or: locationFilter.$or },
        { $or: stateConditions }
      ];
      delete locationFilter.$or;
    } else {
      locationFilter.$or = stateConditions;
    }
  }
  
  if (city) {
    const cityConditions = [
      { city: city },
      { 'location.city': city }
    ];
    
    if (locationFilter.$and) {
      locationFilter.$and.push({ $or: cityConditions });
    } else if (locationFilter.$or) {
      locationFilter.$and = [
        { $or: locationFilter.$or },
        { $or: cityConditions }
      ];
      delete locationFilter.$or;
    } else {
      locationFilter.$or = cityConditions;
    }
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
    default:
      sortField = { totalEarnings: -1 };
  }

  const pipeline = [
    {
      $match: {
        'status.isActive': true,
        isBanned: { $ne: true },
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
      $lookup: {
        from: 'transactions', // Use actual collection name  
        let: { userId: '$_id' },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$userId', '$$userId'] },
                  { $eq: ['$type', 'co-founder'] },
                  { $eq: ['$status', 'completed'] }
                ]
              }
            }
          }
        ],
        as: 'cofounderTransactions'
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
        // Use different field names to avoid collision
        resolvedCountry: {
          $cond: {
            if: { $ne: ["$country", null] },
            then: "$country",
            else: "$location.country"
          }
        },
        resolvedState: {
          $cond: {
            if: { $ne: ["$state", null] },
            then: "$state",
            else: "$location.state"
          }
        },
        resolvedCity: {
          $cond: {
            if: { $ne: ["$city", null] },
            then: "$city",
            else: "$location.city"
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
              resolvedCountry: 1,
              resolvedState: 1,
              resolvedCity: 1,
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
              totalBalance: { $sum: "$availableBalance" },
              maxEarnings: { $max: "$totalEarnings" },
              minEarnings: { $min: "$totalEarnings" }
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
      _id: user._id,
      name: user.name,
      userName: user.userName,
      totalEarnings: user.totalEarnings,
      availableBalance: user.availableBalance,
      totalShares: user.totalShares,
      // Create clean location object from resolved fields
      location: {
        country: user.resolvedCountry,
        state: user.resolvedState,
        city: user.resolvedCity
      },
      status: user.status,
      createdAt: user.createdAt,
      rank: offset + index + 1
    })),
    total: totalCount,
    totalPages: Math.ceil(totalCount / limit),
    currentPage: Math.floor(offset / limit) + 1,
    locationStats: {
      totalUsers: locationStats.totalUsers || 0,
      totalEarnings: Math.round((locationStats.totalEarnings || 0) * 100) / 100,
      averageEarnings: Math.round((locationStats.averageEarnings || 0) * 100) / 100,
      totalBalance: Math.round((locationStats.totalBalance || 0) * 100) / 100,
      maxEarnings: Math.round((locationStats.maxEarnings || 0) * 100) / 100,
      minEarnings: Math.round((locationStats.minEarnings || 0) * 100) / 100
    }
  };
};
// Add these functions to your leaderboardController.js file

// 1. User Status Diagnostic Function
exports.diagnoseCofounderUserStatus = async (req, res) => {
  try {
    const PaymentTransaction = require('../models/Transaction');
    
    // Get all users with completed co-founder transactions
    const uniqueUserIds = await PaymentTransaction.distinct('userId', {
      type: 'co-founder',
      status: 'completed'
    });
    
    console.log('Unique user IDs with completed transactions:', uniqueUserIds);
    
    // Get detailed information about each user
    const userDetails = await User.find({
      _id: { $in: uniqueUserIds }
    }).select('name userName status.isActive isBanned isSuspended createdAt');
    
    // Check which users pass the filter criteria
    const filterResults = userDetails.map(user => {
      const isActive = user.status?.isActive === true;
      const isNotBanned = user.isBanned !== true;
      const passesFilter = isActive && isNotBanned;
      
      return {
        _id: user._id,
        name: user.name,
        userName: user.userName,
        status: {
          isActive: user.status?.isActive,
          isBanned: user.isBanned,
          isSuspended: user.isSuspended
        },
        passesFilter,
        reason: !passesFilter ? 
          (!isActive ? 'Not active' : 'Is banned') : 
          'Passes all filters'
      };
    });
    
    // Get transaction details for each user
    const transactionsByUser = await PaymentTransaction.aggregate([
      {
        $match: {
          type: 'co-founder',
          status: 'completed',
          userId: { $in: uniqueUserIds }
        }
      },
      {
        $group: {
          _id: '$userId',
          totalShares: { $sum: '$shares' },
          transactionCount: { $sum: 1 },
          transactions: {
            $push: {
              transactionId: '$transactionId',
              shares: '$shares',
              amount: '$amount',
              date: '$createdAt'
            }
          }
        }
      }
    ]);
    
    res.json({
      success: true,
      analysis: {
        totalUsersWithTransactions: uniqueUserIds.length,
        userFilterResults: filterResults,
        transactionsByUser: transactionsByUser,
        summary: {
          usersPassingFilter: filterResults.filter(u => u.passesFilter).length,
          usersFailingFilter: filterResults.filter(u => !u.passesFilter).length,
          reasonsForFailure: filterResults
            .filter(u => !u.passesFilter)
            .map(u => ({ user: u.userName, reason: u.reason }))
        }
      }
    });
    
  } catch (error) {
    console.error('Error in user status diagnostic:', error);
    res.status(500).json({
      success: false,
      message: 'User status diagnostic failed',
      error: error.message
    });
  }
};

// 2. Debug Leaderboard Function (shows all users regardless of status)
exports.getCofounderLeaderboardDebug = async (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit) : 50;
    const PaymentTransaction = require('../models/Transaction');
    const actualCollectionName = PaymentTransaction.collection.name;
    
    console.log('Getting ALL cofounder users (debug mode) with limit:', limit);
    
    const pipeline = [
      // Don't filter by status initially - get ALL users
      {
        $lookup: {
          from: actualCollectionName,
          let: { userId: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$userId', '$$userId'] },
                    { $eq: ['$type', 'co-founder'] },
                    { $eq: ['$status', 'completed'] }
                  ]
                }
              }
            }
          ],
          as: 'cofounderTransactions'
        }
      },
      
      // Calculate total co-founder shares from transactions
      {
        $addFields: {
          totalCofounderShares: {
            $sum: '$cofounderTransactions.shares'
          },
          transactionCount: { $size: '$cofounderTransactions' }
        }
      },
      
      // Only include users who have co-founder shares
      {
        $match: {
          totalCofounderShares: { $gt: 0 }
        }
      },
      
      // Lookup referral data
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
          totalEarnings: {
            $ifNull: [
              { $arrayElemAt: ['$referralData.totalEarnings', 0] },
              0
            ]
          }
        }
      },
      
      // Sort by total co-founder shares descending
      {
        $sort: { totalCofounderShares: -1, totalEarnings: -1 }
      },
      
      // Limit results
      {
        $limit: limit
      },
      
      // Project final fields including status information
      {
        $project: {
          _id: 1,
          name: 1,
          userName: 1,
          totalCofounderShares: 1,
          totalEarnings: 1,
          'location.state': 1,
          'location.city': 1,
          createdAt: 1,
          equivalentRegularShares: { 
            $multiply: ['$totalCofounderShares', 29]
          },
          // Include status information for debugging
          'status.isActive': 1,
          isBanned: 1,
          isSuspended: 1,
          transactionCount: 1,
          // Show if user would pass the normal filter
          wouldPassNormalFilter: {
            $and: [
              { $eq: ['$status.isActive', true] },
              { $ne: ['$isBanned', true] }
            ]
          },
          transactionDetails: {
            $map: {
              input: '$cofounderTransactions',
              as: 'transaction',
              in: {
                shares: '$$transaction.shares',
                amount: '$$transaction.amount',
                status: '$$transaction.status',
                transactionId: '$$transaction.transactionId',
                date: '$$transaction.createdAt'
              }
            }
          }
        }
      }
    ];
    
    const allCofounders = await User.aggregate(pipeline);
    
    // Separate users by filter status
    const activeUsers = allCofounders.filter(user => user.wouldPassNormalFilter);
    const inactiveUsers = allCofounders.filter(user => !user.wouldPassNormalFilter);
    
    console.log(`Found ${allCofounders.length} total cofounders (${activeUsers.length} active, ${inactiveUsers.length} inactive)`);
    
    res.json({
      success: true,
      debug: true,
      data: allCofounders.map((user, index) => ({
        ...user,
        rank: index + 1
      })),
      analysis: {
        totalFound: allCofounders.length,
        activeCount: activeUsers.length,
        inactiveCount: inactiveUsers.length,
        inactiveUsers: inactiveUsers.map(user => ({
          _id: user._id,
          name: user.name,
          userName: user.userName,
          isActive: user.status?.isActive,
          isBanned: user.isBanned,
          isSuspended: user.isSuspended,
          totalShares: user.totalCofounderShares,
          reason: !user.status?.isActive ? 'Not active' : 
                  user.isBanned ? 'Is banned' : 'Other issue'
        }))
      },
      pagination: {
        currentPage: 1,
        totalPages: 1,
        totalItems: allCofounders.length,
        hasNext: false,
        hasPrev: false,
        limit: limit
      },
      filter: 'cofounder-debug'
    });
    
  } catch (error) {
    console.error('Error fetching debug cofounder leaderboard:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch debug cofounder leaderboard',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// 3. Fix Inactive Users Function (Admin only)
exports.fixInactiveCofounderUsers = async (req, res) => {
  try {
    const adminId = req.user.id;
    
    // Verify admin
    const admin = await User.findById(adminId);
    if (!admin || !admin.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized: Admin access required'
      });
    }
    
    const PaymentTransaction = require('../models/Transaction');
    
    // Get all users with completed co-founder transactions
    const uniqueUserIds = await PaymentTransaction.distinct('userId', {
      type: 'co-founder',
      status: 'completed'
    });
    
    // Find users who have transactions but are inactive or banned
    const inactiveUsers = await User.find({
      _id: { $in: uniqueUserIds },
      $or: [
        { 'status.isActive': { $ne: true } },
        { isBanned: true }
      ]
    }).select('name userName status isBanned');
    
    if (inactiveUsers.length === 0) {
      return res.json({
        success: true,
        message: 'All co-founder users are already active',
        inactiveUsers: []
      });
    }
    
    // Update inactive users to be active
    const updateResult = await User.updateMany(
      {
        _id: { $in: inactiveUsers.map(u => u._id) }
      },
      {
        $set: {
          'status.isActive': true,
          isBanned: false
        }
      }
    );
    
    res.json({
      success: true,
      message: `Fixed ${updateResult.modifiedCount} inactive co-founder users`,
      inactiveUsers: inactiveUsers.map(u => ({
        id: u._id,
        name: u.name,
        userName: u.userName,
        wasActive: u.status?.isActive,
        wasBanned: u.isBanned
      })),
      updateResult
    });
    
  } catch (error) {
    console.error('Error fixing inactive users:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fix inactive users',
      error: error.message
    });
  }
};