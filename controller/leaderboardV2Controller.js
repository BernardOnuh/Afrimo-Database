// controllers/leaderboardV2Controller.js

const User = require('../models/User');
const TransactionV2 = require('../models/TransactionV2');
const UserShareV2 = require('../models/UserShareV2');
const Referral = require('../models/Referral');
const TierConfig = require('../models/TierConfig');

/**
 * Format currency for display
 */
const formatCurrency = (amount) => {
  if (amount === null || amount === undefined || isNaN(amount)) {
    return '₦0';
  }
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  }).format(amount);
};

/**
 * Get date filter based on time frame
 */
const getDateFilter = (timeFrame) => {
  const now = new Date();
  
  switch (timeFrame) {
    case 'daily':
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      return { $gte: startOfDay };
    case 'weekly':
      const startOfWeek = new Date(now);
      startOfWeek.setDate(now.getDate() - now.getDay());
      startOfWeek.setHours(0, 0, 0, 0);
      return { $gte: startOfWeek };
    case 'monthly':
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      return { $gte: startOfMonth };
    case 'yearly':
      const startOfYear = new Date(now.getFullYear(), 0, 1);
      return { $gte: startOfYear };
    default:
      return null;
  }
};

/**
 * MAIN LEADERBOARD ENDPOINT
 * GET /api/leaderboard-v2
 * Query params: type, timeFrame, page, limit, search
 */
exports.getLeaderboard = async (req, res) => {
  try {
    const {
      type = 'earnings',
      timeFrame = 'all-time',
      page = 1,
      limit = 20,
      search = ''
    } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const parsedLimit = parseInt(limit);

    // Valid leaderboard types
    const validTypes = ['earnings', 'balance', 'shares', 'referrals', 'spent', 'cofounder'];
    if (!validTypes.includes(type)) {
      return res.status(400).json({
        success: false,
        message: `Invalid type. Must be one of: ${validTypes.join(', ')}`
      });
    }

    let leaderboardData = [];
    let totalCount = 0;
    let totals = {};

    // Route to appropriate leaderboard builder
    switch (type) {
      case 'earnings':
        const earningsResult = await buildEarningsLeaderboard(timeFrame, skip, parsedLimit, search);
        leaderboardData = earningsResult.data;
        totalCount = earningsResult.total;
        totals = earningsResult.totals;
        break;
        
      case 'balance':
        const balanceResult = await buildBalanceLeaderboard(skip, parsedLimit, search);
        leaderboardData = balanceResult.data;
        totalCount = balanceResult.total;
        totals = balanceResult.totals;
        break;
        
      case 'shares':
        const sharesResult = await buildSharesLeaderboard(skip, parsedLimit, search);
        leaderboardData = sharesResult.data;
        totalCount = sharesResult.total;
        totals = sharesResult.totals;
        break;
        
      case 'referrals':
        const referralsResult = await buildReferralsLeaderboard(skip, parsedLimit, search);
        leaderboardData = referralsResult.data;
        totalCount = referralsResult.total;
        totals = referralsResult.totals;
        break;
        
      case 'spent':
        const spentResult = await buildSpentLeaderboard(timeFrame, skip, parsedLimit, search);
        leaderboardData = spentResult.data;
        totalCount = spentResult.total;
        totals = spentResult.totals;
        break;
        
      case 'cofounder':
        const cofounderResult = await buildCofounderLeaderboard(skip, parsedLimit, search);
        leaderboardData = cofounderResult.data;
        totalCount = cofounderResult.total;
        totals = cofounderResult.totals;
        break;
    }

    // Get current user's rank if authenticated
    let userRank = null;
    if (req.user && req.user.id) {
      userRank = await getUserRank(type, req.user.id, timeFrame);
    }

    res.status(200).json({
      success: true,
      data: leaderboardData,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalCount / parsedLimit),
        totalCount,
        limit: parsedLimit,
        hasNext: skip + parsedLimit < totalCount
      },
      summary: {
        type,
        timeFrame,
        totals
      },
      userRank: userRank ? { rank: userRank, type, timeFrame } : null
    });
    
  } catch (error) {
    console.error('Error in getLeaderboard:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch leaderboard data',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Build earnings leaderboard (total earnings from all completed transactions)
 */
const buildEarningsLeaderboard = async (timeFrame, skip, limit, search) => {
  const matchConditions = { status: 'completed' };
  
  // Apply time filter if not all-time
  const dateFilter = getDateFilter(timeFrame);
  if (dateFilter) {
    matchConditions.createdAt = dateFilter;
  }
  
  // Apply search filter
  if (search) {
    const users = await User.find({
      $or: [
        { name: { $regex: search, $options: 'i' } },
        { username: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ]
    }).select('_id');
    
    const userIds = users.map(u => u._id);
    if (userIds.length > 0) {
      matchConditions.userId = { $in: userIds };
    } else {
      return { data: [], total: 0, totals: { totalEarnings: 0, totalUsers: 0 } };
    }
  }
  
  // Aggregate earnings by user
  const pipeline = [
    { $match: matchConditions },
    {
      $group: {
        _id: '$userId',
        totalEarnings: { $sum: '$totalAmount' },
        totalEarningsNaira: {
          $sum: { $cond: [{ $eq: ['$currency', 'naira'] }, '$totalAmount', 0] }
        },
        totalEarningsUSDT: {
          $sum: { $cond: [{ $eq: ['$currency', 'usdt'] }, '$totalAmount', 0] }
        },
        transactionCount: { $sum: 1 },
        lastEarningDate: { $max: '$createdAt' }
      }
    },
    { $match: { _id: { $ne: null } } },
    { $sort: { totalEarnings: -1 } },
    { $skip: skip },
    { $limit: limit }
  ];
  
  // Get total count for pagination
  const countPipeline = [
    { $match: matchConditions },
    { $group: { _id: '$userId' } },
    { $count: 'total' }
  ];
  
  const [results, totalCountResult, totalsResult] = await Promise.all([
    TransactionV2.aggregate(pipeline),
    TransactionV2.aggregate(countPipeline),
    TransactionV2.aggregate([
      { $match: matchConditions },
      {
        $group: {
          _id: null,
          totalEarnings: { $sum: '$totalAmount' },
          totalEarningsNaira: {
            $sum: { $cond: [{ $eq: ['$currency', 'naira'] }, '$totalAmount', 0] }
          },
          totalEarningsUSDT: {
            $sum: { $cond: [{ $eq: ['$currency', 'usdt'] }, '$totalAmount', 0] }
          },
          uniqueUsers: { $addToSet: '$userId' }
        }
      }
    ])
  ]);
  
  // Fetch user details
  const userIds = results.map(r => r._id);
  const users = await User.find({ _id: { $in: userIds } })
    .select('name username email phone createdAt avatar');
  
  const userMap = new Map(users.map(u => [u._id.toString(), u]));
  
  const data = results.map((result, index) => {
    const user = userMap.get(result._id.toString());
    return {
      rank: skip + index + 1,
      userId: result._id,
      name: user?.name || 'Unknown User',
      username: user?.username || 'unknown',
      email: user?.email,
      avatar: user?.avatar,
      joinedAt: user?.createdAt,
      metrics: {
        totalEarnings: result.totalEarnings,
        totalEarningsNaira: result.totalEarningsNaira,
        totalEarningsUSDT: result.totalEarningsUSDT,
        formattedEarnings: formatCurrency(result.totalEarnings),
        transactionCount: result.transactionCount,
        lastEarningDate: result.lastEarningDate
      }
    };
  });
  
  const totals = totalsResult[0] || { totalEarnings: 0, totalEarningsNaira: 0, totalEarningsUSDT: 0, uniqueUsers: [] };
  const total = totalCountResult[0]?.total || 0;
  
  return {
    data,
    total,
    totals: {
      totalEarnings: totals.totalEarnings,
      formattedTotalEarnings: formatCurrency(totals.totalEarnings),
      totalUsers: totals.uniqueUsers?.length || 0
    }
  };
};

/**
 * Build balance leaderboard (current available balance from referrals)
 */
const buildBalanceLeaderboard = async (skip, limit, search) => {
  let query = {};
  
  if (search) {
    const users = await User.find({
      $or: [
        { name: { $regex: search, $options: 'i' } },
        { username: { $regex: search, $options: 'i' } }
      ]
    }).select('_id');
    
    const userIds = users.map(u => u._id);
    if (userIds.length > 0) {
      query.user = { $in: userIds };
    } else {
      return { data: [], total: 0, totals: { totalBalance: 0, totalUsers: 0 } };
    }
  }
  
  // Get referral data for balance
  const [referrals, totalCount, totalsResult] = await Promise.all([
    Referral.find(query)
      .populate('user', 'name username email phone createdAt avatar')
      .sort({ totalEarnings: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Referral.countDocuments(query),
    Referral.aggregate([
      { $match: query },
      {
        $group: {
          _id: null,
          totalBalance: { $sum: { $subtract: ['$totalEarnings', { $ifNull: ['$totalWithdrawn', 0] }] } },
          totalEarnings: { $sum: '$totalEarnings' },
          totalWithdrawn: { $sum: { $ifNull: ['$totalWithdrawn', 0] } },
          uniqueUsers: { $addToSet: '$user' }
        }
      }
    ])
  ]);
  
  const data = referrals.map((referral, index) => {
    const availableBalance = (referral.totalEarnings || 0) - (referral.totalWithdrawn || 0) - (referral.pendingWithdrawals || 0) - (referral.processingWithdrawals || 0);
    
    return {
      rank: skip + index + 1,
      userId: referral.user?._id,
      name: referral.user?.name || 'Unknown User',
      username: referral.user?.username || 'unknown',
      email: referral.user?.email,
      avatar: referral.user?.avatar,
      joinedAt: referral.user?.createdAt,
      metrics: {
        totalEarnings: referral.totalEarnings || 0,
        totalWithdrawn: referral.totalWithdrawn || 0,
        pendingWithdrawals: referral.pendingWithdrawals || 0,
        processingWithdrawals: referral.processingWithdrawals || 0,
        availableBalance: Math.max(0, availableBalance),
        formattedBalance: formatCurrency(Math.max(0, availableBalance)),
        formattedTotalEarnings: formatCurrency(referral.totalEarnings || 0)
      }
    };
  });
  
  const totals = totalsResult[0] || { totalBalance: 0, totalEarnings: 0, totalWithdrawn: 0, uniqueUsers: [] };
  
  return {
    data,
    total: totalCount,
    totals: {
      totalBalance: totals.totalBalance,
      formattedTotalBalance: formatCurrency(totals.totalBalance),
      totalEarnings: totals.totalEarnings,
      totalWithdrawn: totals.totalWithdrawn,
      totalUsers: totals.uniqueUsers?.length || 0
    }
  };
};

/**
 * Build shares leaderboard (total ownership percentage)
 */
const buildSharesLeaderboard = async (skip, limit, search) => {
  let query = { totalOwnershipPct: { $gt: 0 } };
  
  if (search) {
    const users = await User.find({
      $or: [
        { name: { $regex: search, $options: 'i' } },
        { username: { $regex: search, $options: 'i' } }
      ]
    }).select('_id');
    
    const userIds = users.map(u => u._id);
    if (userIds.length > 0) {
      query.user = { $in: userIds };
    } else {
      return { data: [], total: 0, totals: { totalOwnershipPct: 0, totalShareholders: 0 } };
    }
  }
  
  const [snapshots, totalCount, totalsResult] = await Promise.all([
    UserShareV2.find(query)
      .populate('user', 'name username email phone createdAt avatar')
      .sort({ totalOwnershipPct: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    UserShareV2.countDocuments(query),
    UserShareV2.aggregate([
      { $match: query },
      {
        $group: {
          _id: null,
          totalOwnershipPct: { $sum: '$totalOwnershipPct' },
          totalRegularOwnershipPct: { $sum: '$regularOwnershipPct' },
          totalCofounderOwnershipPct: { $sum: '$cofounderOwnershipPct' },
          totalEarningKobo: { $sum: '$totalEarningKobo' },
          uniqueUsers: { $addToSet: '$user' }
        }
      }
    ])
  ]);
  
  const config = await TierConfig.getCurrentConfig();
  const shareToRegularRatio = config.coFounderToRegularRatio || 22;
  
  const data = snapshots.map((snapshot, index) => {
    // Calculate approximate share count (if each 0.0001% = 1 share)
    const estimatedShares = Math.round(snapshot.totalOwnershipPct * 10000);
    
    return {
      rank: skip + index + 1,
      userId: snapshot.user?._id,
      name: snapshot.user?.name || 'Unknown User',
      username: snapshot.user?.username || 'unknown',
      email: snapshot.user?.email,
      avatar: snapshot.user?.avatar,
      joinedAt: snapshot.user?.createdAt,
      metrics: {
        totalOwnershipPct: snapshot.totalOwnershipPct,
        formattedOwnership: (snapshot.totalOwnershipPct * 100).toFixed(7) + '%',
        regularOwnershipPct: snapshot.regularOwnershipPct,
        cofounderOwnershipPct: snapshot.cofounderOwnershipPct,
        estimatedShares: estimatedShares,
        equivalentCoFounderShares: Math.floor(estimatedShares / shareToRegularRatio),
        totalEarnings: snapshot.totalEarningKobo / 100,
        formattedEarnings: formatCurrency(snapshot.totalEarningKobo / 100)
      }
    };
  });
  
  const totals = totalsResult[0] || { totalOwnershipPct: 0, totalRegularOwnershipPct: 0, totalCofounderOwnershipPct: 0, totalEarningKobo: 0, uniqueUsers: [] };
  
  return {
    data,
    total: totalCount,
    totals: {
      totalOwnershipPct: totals.totalOwnershipPct,
      formattedTotalOwnership: (totals.totalOwnershipPct * 100).toFixed(7) + '%',
      totalShareholders: totals.uniqueUsers?.length || 0,
      totalEarnings: totals.totalEarningKobo / 100,
      formattedTotalEarnings: formatCurrency(totals.totalEarningKobo / 100)
    }
  };
};

/**
 * Build referrals leaderboard (users with most referrals)
 */
const buildReferralsLeaderboard = async (skip, limit, search) => {
  let matchCondition = {};
  
  if (search) {
    matchCondition = {
      $or: [
        { name: { $regex: search, $options: 'i' } },
        { username: { $regex: search, $options: 'i' } }
      ]
    };
  }
  
  const pipeline = [
    { $match: matchCondition },
    {
      $lookup: {
        from: 'users',
        localField: 'referrals.userId',
        foreignField: '_id',
        as: 'referralDetails'
      }
    },
    {
      $project: {
        name: 1,
        username: 1,
        email: 1,
        phone: 1,
        createdAt: 1,
        avatar: 1,
        referralCount: { $size: { $ifNull: ['$referrals', []] } },
        activeReferrals: {
          $size: {
            $filter: {
              input: { $ifNull: ['$referrals', []] },
              as: 'ref',
              cond: { $eq: ['$$ref.status', 'active'] }
            }
          }
        },
        totalReferralEarnings: { $ifNull: ['$referralEarnings.total', 0] }
      }
    },
    { $match: { referralCount: { $gt: 0 } } },
    { $sort: { referralCount: -1, totalReferralEarnings: -1 } },
    { $skip: skip },
    { $limit: limit }
  ];
  
  const [results, totalCountResult, totalsResult] = await Promise.all([
    User.aggregate(pipeline),
    User.aggregate([
      { $match: matchCondition },
      { $project: { referralCount: { $size: { $ifNull: ['$referrals', []] } } } },
      { $match: { referralCount: { $gt: 0 } } },
      { $count: 'total' }
    ]),
    User.aggregate([
      { $match: matchCondition },
      {
        $group: {
          _id: null,
          totalReferrals: { $sum: { $size: { $ifNull: ['$referrals', []] } } },
          totalReferralEarnings: { $sum: { $ifNull: ['$referralEarnings.total', 0] } },
          uniqueUsersWithReferrals: { $sum: { $cond: [{ $gt: [{ $size: { $ifNull: ['$referrals', []] } }, 0] }, 1, 0] } }
        }
      }
    ])
  ]);
  
  const data = results.map((user, index) => ({
    rank: skip + index + 1,
    userId: user._id,
    name: user.name || 'Unknown User',
    username: user.username || 'unknown',
    email: user.email,
    avatar: user.avatar,
    joinedAt: user.createdAt,
    metrics: {
      referralCount: user.referralCount,
      activeReferrals: user.activeReferrals,
      totalReferralEarnings: user.totalReferralEarnings,
      formattedEarnings: formatCurrency(user.totalReferralEarnings)
    }
  }));
  
  const totals = totalsResult[0] || { totalReferrals: 0, totalReferralEarnings: 0, uniqueUsersWithReferrals: 0 };
  
  return {
    data,
    total: totalCountResult[0]?.total || 0,
    totals: {
      totalReferrals: totals.totalReferrals,
      totalReferralEarnings: totals.totalReferralEarnings,
      formattedTotalEarnings: formatCurrency(totals.totalReferralEarnings),
      totalUsersWithReferrals: totals.uniqueUsersWithReferrals
    }
  };
};

/**
 * Build spent leaderboard (total amount spent on shares)
 */
const buildSpentLeaderboard = async (timeFrame, skip, limit, search) => {
  const matchConditions = { status: 'completed' };
  
  // Apply time filter if not all-time
  const dateFilter = getDateFilter(timeFrame);
  if (dateFilter) {
    matchConditions.createdAt = dateFilter;
  }
  
  // Apply search filter
  if (search) {
    const users = await User.find({
      $or: [
        { name: { $regex: search, $options: 'i' } },
        { username: { $regex: search, $options: 'i' } }
      ]
    }).select('_id');
    
    const userIds = users.map(u => u._id);
    if (userIds.length > 0) {
      matchConditions.userId = { $in: userIds };
    } else {
      return { data: [], total: 0, totals: { totalSpent: 0, totalUsers: 0 } };
    }
  }
  
  const pipeline = [
    { $match: matchConditions },
    {
      $group: {
        _id: '$userId',
        totalSpent: { $sum: '$totalAmount' },
        totalSpentNaira: {
          $sum: { $cond: [{ $eq: ['$currency', 'naira'] }, '$totalAmount', 0] }
        },
        totalSpentUSDT: {
          $sum: { $cond: [{ $eq: ['$currency', 'usdt'] }, '$totalAmount', 0] }
        },
        purchaseCount: { $sum: 1 },
        firstPurchase: { $min: '$createdAt' },
        lastPurchase: { $max: '$createdAt' }
      }
    },
    { $match: { _id: { $ne: null } } },
    { $sort: { totalSpent: -1 } },
    { $skip: skip },
    { $limit: limit }
  ];
  
  const [results, totalCountResult, totalsResult] = await Promise.all([
    TransactionV2.aggregate(pipeline),
    TransactionV2.aggregate([
      { $match: matchConditions },
      { $group: { _id: '$userId' } },
      { $count: 'total' }
    ]),
    TransactionV2.aggregate([
      { $match: matchConditions },
      {
        $group: {
          _id: null,
          totalSpent: { $sum: '$totalAmount' },
          totalSpentNaira: {
            $sum: { $cond: [{ $eq: ['$currency', 'naira'] }, '$totalAmount', 0] }
          },
          totalSpentUSDT: {
            $sum: { $cond: [{ $eq: ['$currency', 'usdt'] }, '$totalAmount', 0] }
          },
          uniqueUsers: { $addToSet: '$userId' }
        }
      }
    ])
  ]);
  
  // Fetch user details
  const userIds = results.map(r => r._id);
  const users = await User.find({ _id: { $in: userIds } })
    .select('name username email phone createdAt avatar');
  
  const userMap = new Map(users.map(u => [u._id.toString(), u]));
  
  const data = results.map((result, index) => {
    const user = userMap.get(result._id.toString());
    return {
      rank: skip + index + 1,
      userId: result._id,
      name: user?.name || 'Unknown User',
      username: user?.username || 'unknown',
      email: user?.email,
      avatar: user?.avatar,
      joinedAt: user?.createdAt,
      metrics: {
        totalSpent: result.totalSpent,
        totalSpentNaira: result.totalSpentNaira,
        totalSpentUSDT: result.totalSpentUSDT,
        formattedSpent: formatCurrency(result.totalSpent),
        purchaseCount: result.purchaseCount,
        firstPurchase: result.firstPurchase,
        lastPurchase: result.lastPurchase
      }
    };
  });
  
  const totals = totalsResult[0] || { totalSpent: 0, totalSpentNaira: 0, totalSpentUSDT: 0, uniqueUsers: [] };
  const total = totalCountResult[0]?.total || 0;
  
  return {
    data,
    total,
    totals: {
      totalSpent: totals.totalSpent,
      formattedTotalSpent: formatCurrency(totals.totalSpent),
      totalUsers: totals.uniqueUsers?.length || 0
    }
  };
};

/**
 * Build co-founder leaderboard (co-founder ownership percentage)
 */
const buildCofounderLeaderboard = async (skip, limit, search) => {
  let query = { cofounderOwnershipPct: { $gt: 0 } };
  
  if (search) {
    const users = await User.find({
      $or: [
        { name: { $regex: search, $options: 'i' } },
        { username: { $regex: search, $options: 'i' } }
      ]
    }).select('_id');
    
    const userIds = users.map(u => u._id);
    if (userIds.length > 0) {
      query.user = { $in: userIds };
    } else {
      return { data: [], total: 0, totals: { totalCofounderOwnershipPct: 0, totalCofounders: 0 } };
    }
  }
  
  const [snapshots, totalCount, totalsResult] = await Promise.all([
    UserShareV2.find(query)
      .populate('user', 'name username email phone createdAt avatar')
      .sort({ cofounderOwnershipPct: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    UserShareV2.countDocuments(query),
    UserShareV2.aggregate([
      { $match: query },
      {
        $group: {
          _id: null,
          totalCofounderOwnershipPct: { $sum: '$cofounderOwnershipPct' },
          uniqueUsers: { $addToSet: '$user' }
        }
      }
    ])
  ]);
  
  // Get co-founder specific transactions for additional metrics
  const userIds = snapshots.map(s => s.user?._id).filter(id => id);
  let cofounderTxs = [];
  if (userIds.length > 0) {
    cofounderTxs = await TransactionV2.find({
      userId: { $in: userIds },
      type: 'co-founder',
      status: 'completed'
    }).lean();
  }
  
  const txMap = new Map();
  cofounderTxs.forEach(tx => {
    const userId = tx.userId.toString();
    if (!txMap.has(userId)) {
      txMap.set(userId, { cofounderShares: 0, totalAmount: 0 });
    }
    const data = txMap.get(userId);
    data.cofounderShares += (tx.shares || 1);
    data.totalAmount += (tx.totalAmount || 0);
  });
  
  const config = await TierConfig.getCurrentConfig();
  const shareToRegularRatio = config.coFounderToRegularRatio || 22;
  
  const data = snapshots.map((snapshot, index) => {
    const txData = txMap.get(snapshot.user?._id?.toString()) || { cofounderShares: 0, totalAmount: 0 };
    const equivalentRegularShares = txData.cofounderShares * shareToRegularRatio;
    
    return {
      rank: skip + index + 1,
      userId: snapshot.user?._id,
      name: snapshot.user?.name || 'Unknown User',
      username: snapshot.user?.username || 'unknown',
      email: snapshot.user?.email,
      avatar: snapshot.user?.avatar,
      joinedAt: snapshot.user?.createdAt,
      metrics: {
        cofounderOwnershipPct: snapshot.cofounderOwnershipPct,
        formattedOwnership: (snapshot.cofounderOwnershipPct * 100).toFixed(7) + '%',
        cofounderShares: txData.cofounderShares,
        totalSpent: txData.totalAmount,
        formattedSpent: formatCurrency(txData.totalAmount),
        equivalentRegularShares: equivalentRegularShares,
        shareToRegularRatio: shareToRegularRatio,
        totalEarnings: snapshot.totalEarningKobo / 100,
        formattedEarnings: formatCurrency(snapshot.totalEarningKobo / 100)
      }
    };
  });
  
  const totals = totalsResult[0] || { totalCofounderOwnershipPct: 0, uniqueUsers: [] };
  
  return {
    data,
    total: totalCount,
    totals: {
      totalCofounderOwnershipPct: totals.totalCofounderOwnershipPct,
      formattedTotalOwnership: (totals.totalCofounderOwnershipPct * 100).toFixed(7) + '%',
      totalCofounders: totals.uniqueUsers?.length || 0
    }
  };
};

/**
 * Get a user's rank in a specific leaderboard category
 */
const getUserRank = async (type, userId, timeFrame = 'all-time') => {
  try {
    let pipeline = [];
    
    switch (type) {
      case 'earnings': {
        const matchConditions = { status: 'completed' };
        const dateFilter = getDateFilter(timeFrame);
        if (dateFilter) matchConditions.createdAt = dateFilter;
        
        pipeline = [
          { $match: matchConditions },
          { $group: { _id: '$userId', totalEarnings: { $sum: '$totalAmount' } } },
          { $sort: { totalEarnings: -1 } },
          { $group: { _id: null, users: { $push: '$$ROOT' } } },
          { $unwind: { path: '$users', includeArrayIndex: 'rank' } },
          { $match: { 'users._id': userId } },
          { $project: { rank: { $add: ['$rank', 1] } } }
        ];
        break;
      }
      
      case 'shares': {
        pipeline = [
          { $match: { totalOwnershipPct: { $gt: 0 } } },
          { $sort: { totalOwnershipPct: -1 } },
          { $group: { _id: null, users: { $push: '$$ROOT' } } },
          { $unwind: { path: '$users', includeArrayIndex: 'rank' } },
          { $match: { 'users.user': userId } },
          { $project: { rank: { $add: ['$rank', 1] } } }
        ];
        break;
      }
      
      case 'referrals': {
        pipeline = [
          { $match: {} },
          { $project: { referralCount: { $size: { $ifNull: ['$referrals', []] } } } },
          { $match: { referralCount: { $gt: 0 } } },
          { $sort: { referralCount: -1 } },
          { $group: { _id: null, users: { $push: '$$ROOT' } } },
          { $unwind: { path: '$users', includeArrayIndex: 'rank' } },
          { $match: { 'users._id': userId } },
          { $project: { rank: { $add: ['$rank', 1] } } }
        ];
        break;
      }
      
      default:
        return null;
    }
    
    const result = await (type === 'earnings' ? TransactionV2 : type === 'shares' ? UserShareV2 : User).aggregate(pipeline);
    return result.length > 0 ? result[0].rank : null;
    
  } catch (error) {
    console.error(`Error getting user rank for ${type}:`, error);
    return null;
  }
};

/**
 * Get top performers across all categories (dashboard widget)
 */
exports.getTopPerformers = async (req, res) => {
  try {
    const [topEarners, topShareholders, topReferrers] = await Promise.all([
      buildEarningsLeaderboard('all-time', 0, 5, ''),
      buildSharesLeaderboard(0, 5, ''),
      buildReferralsLeaderboard(0, 5, '')
    ]);
    
    res.status(200).json({
      success: true,
      data: {
        topEarners: topEarners.data,
        topShareholders: topShareholders.data,
        topReferrers: topReferrers.data
      }
    });
  } catch (error) {
    console.error('Error in getTopPerformers:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch top performers',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Get current user's leaderboard position
 */
exports.getMyPosition = async (req, res) => {
  try {
    const userId = req.user.id;
    const { type = 'earnings', timeFrame = 'all-time' } = req.query;
    
    const validTypes = ['earnings', 'balance', 'shares', 'referrals', 'spent', 'cofounder'];
    if (!validTypes.includes(type)) {
      return res.status(400).json({
        success: false,
        message: `Invalid type. Must be one of: ${validTypes.join(', ')}`
      });
    }
    
    const rank = await getUserRank(type, userId, timeFrame);
    const user = await User.findById(userId).select('name username email phone createdAt avatar');
    
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    
    // Get user's metrics
    let metrics = {};
    const referral = await Referral.findOne({ user: userId });
    const shareSnapshot = await UserShareV2.findOne({ user: userId });
    
    switch (type) {
      case 'earnings': {
        const dateFilter = getDateFilter(timeFrame);
        const matchConditions = { userId, status: 'completed' };
        if (dateFilter) matchConditions.createdAt = dateFilter;
        
        const earnings = await TransactionV2.aggregate([
          { $match: matchConditions },
          { $group: { _id: null, total: { $sum: '$totalAmount' } } }
        ]);
        metrics = {
          totalEarnings: earnings[0]?.total || 0,
          formattedEarnings: formatCurrency(earnings[0]?.total || 0)
        };
        break;
      }
      
      case 'balance':
        metrics = {
          totalEarnings: referral?.totalEarnings || 0,
          totalWithdrawn: referral?.totalWithdrawn || 0,
          availableBalance: Math.max(0, (referral?.totalEarnings || 0) - (referral?.totalWithdrawn || 0) - (referral?.pendingWithdrawals || 0) - (referral?.processingWithdrawals || 0)),
          formattedBalance: formatCurrency(Math.max(0, (referral?.totalEarnings || 0) - (referral?.totalWithdrawn || 0)))
        };
        break;
        
      case 'shares':
        metrics = {
          totalOwnershipPct: shareSnapshot?.totalOwnershipPct || 0,
          formattedOwnership: ((shareSnapshot?.totalOwnershipPct || 0) * 100).toFixed(7) + '%',
          regularOwnershipPct: shareSnapshot?.regularOwnershipPct || 0,
          cofounderOwnershipPct: shareSnapshot?.cofounderOwnershipPct || 0
        };
        break;
        
      case 'referrals':
        metrics = {
          referralCount: user.referrals?.length || 0,
          activeReferrals: user.referrals?.filter(r => r.status === 'active').length || 0,
          totalReferralEarnings: user.referralEarnings?.total || 0,
          formattedEarnings: formatCurrency(user.referralEarnings?.total || 0)
        };
        break;
        
      case 'spent': {
        const spent = await TransactionV2.aggregate([
          { $match: { userId, status: 'completed' } },
          { $group: { _id: null, total: { $sum: '$totalAmount' } } }
        ]);
        metrics = {
          totalSpent: spent[0]?.total || 0,
          formattedSpent: formatCurrency(spent[0]?.total || 0),
          purchaseCount: await TransactionV2.countDocuments({ userId, status: 'completed' })
        };
        break;
      }
      
      case 'cofounder':
        metrics = {
          cofounderOwnershipPct: shareSnapshot?.cofounderOwnershipPct || 0,
          formattedOwnership: ((shareSnapshot?.cofounderOwnershipPct || 0) * 100).toFixed(7) + '%',
          totalEarnings: shareSnapshot?.totalEarningKobo / 100 || 0,
          formattedEarnings: formatCurrency((shareSnapshot?.totalEarningKobo / 100) || 0)
        };
        break;
    }
    
    res.status(200).json({
      success: true,
      data: {
        user: {
          id: user._id,
          name: user.name,
          username: user.username,
          email: user.email,
          avatar: user.avatar,
          joinedAt: user.createdAt
        },
        rank: rank || 'Not ranked',
        type,
        timeFrame,
        metrics
      }
    });
  } catch (error) {
    console.error('Error in getMyPosition:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch your leaderboard position',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

module.exports = {
  getLeaderboard,
  getTopPerformers,
  getMyPosition,
  formatCurrency
};