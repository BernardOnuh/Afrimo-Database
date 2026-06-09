// controller/projectController.js

const User           = require('../models/User');
const Referral       = require('../models/Referral');
const TierConfig     = require('../models/TierConfig');
const TransactionV2  = require('../models/TransactionV2');
const UserShareV2    = require('../models/UserShareV2');

// ─────────────────────────────────────────────────────────────────────────────

exports.getProjectStats = async (req, res) => {
  try {
    const [totalUsers, regularAgg, cofounderAgg, totalShareholders] = await Promise.all([

      User.countDocuments(),

      TransactionV2.aggregate([
        { $match: { type: { $in: ['share', 'regular'] }, status: 'completed' } },
        {
          $group: {
            _id: null,
            totalOwnershipPct : { $sum: { $ifNull: ['$ownershipPct', 0] } },
            totalEarningKobo  : { $sum: { $ifNull: ['$earningKobo',  0] } },
            totalAmountNaira  : {
              $sum: { $cond: [{ $eq: ['$currency', 'naira'] }, { $ifNull: ['$totalAmount', 0] }, 0] }
            },
            totalAmountUSDT: {
              $sum: { $cond: [{ $eq: ['$currency', 'usdt'] }, { $ifNull: ['$totalAmount', 0] }, 0] }
            },
            uniqueUsers: { $addToSet: '$userId' },
            count: { $sum: 1 }
          }
        }
      ]),

      TransactionV2.aggregate([
        { $match: { type: 'co-founder', status: 'completed' } },
        {
          $group: {
            _id: null,
            totalOwnershipPct : { $sum: { $ifNull: ['$ownershipPct', 0] } },
            totalEarningKobo  : { $sum: { $ifNull: ['$earningKobo',  0] } },
            totalAmountNaira  : {
              $sum: { $cond: [{ $eq: ['$currency', 'naira'] }, { $ifNull: ['$totalAmount', 0] }, 0] }
            },
            totalAmountUSDT: {
              $sum: { $cond: [{ $eq: ['$currency', 'usdt'] }, { $ifNull: ['$totalAmount', 0] }, 0] }
            },
            uniqueUsers: { $addToSet: '$userId' },
            count: { $sum: 1 }
          }
        }
      ]),

      UserShareV2.countDocuments({ totalOwnershipPct: { $gt: 0 } })
    ]);

    const reg = regularAgg[0]   || { totalOwnershipPct: 0, totalEarningKobo: 0, totalAmountNaira: 0, totalAmountUSDT: 0, uniqueUsers: [], count: 0 };
    const cf  = cofounderAgg[0] || { totalOwnershipPct: 0, totalEarningKobo: 0, totalAmountNaira: 0, totalAmountUSDT: 0, uniqueUsers: [], count: 0 };

    const totalOwnershipSold      = +(reg.totalOwnershipPct + cf.totalOwnershipPct).toFixed(7);
    const totalOwnershipAvailable = +(100 - totalOwnershipSold).toFixed(7);

    const allShareholderIds = new Set([
      ...reg.uniqueUsers.map(String),
      ...cf.uniqueUsers.map(String)
    ]);

    res.status(200).json({
      success: true,
      stats: {
        users: {
          total                : totalUsers,
          totalShareholders    : allShareholderIds.size,
          regularShareholders  : reg.uniqueUsers.length,
          cofounderShareholders: cf.uniqueUsers.length
        },
        ownership: {
          totalSold              : totalOwnershipSold,
          totalAvailable         : totalOwnershipAvailable,
          regularSharesSold      : +reg.totalOwnershipPct.toFixed(7),
          cofounderSharesSold    : +cf.totalOwnershipPct.toFixed(7),
          totalSoldFormatted     : totalOwnershipSold.toFixed(7)      + '%',
          totalAvailableFormatted: totalOwnershipAvailable.toFixed(7) + '%'
        },
        earnings: {
          totalEarningKobo    : reg.totalEarningKobo + cf.totalEarningKobo,
          regularEarningKobo  : reg.totalEarningKobo,
          cofounderEarningKobo: cf.totalEarningKobo,
          totalEarningNaira   : ((reg.totalEarningKobo + cf.totalEarningKobo) / 100).toFixed(2)
        },
        transactions: {
          regularCount  : reg.count,
          cofounderCount: cf.count,
          totalCount    : reg.count + cf.count
        },
        totalValues: {
          naira: { regular: reg.totalAmountNaira, cofounder: cf.totalAmountNaira, total: reg.totalAmountNaira + cf.totalAmountNaira },
          usdt : { regular: reg.totalAmountUSDT,  cofounder: cf.totalAmountUSDT,  total: reg.totalAmountUSDT  + cf.totalAmountUSDT  }
        }
      }
    });

  } catch (error) {
    console.error('Error fetching project stats:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch project statistics', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
  }
};

// ─────────────────────────────────────────────────────────────────────────────

const _buildUserStats = async (userId, referralStats) => {
  const [snapshot, txs] = await Promise.all([
    UserShareV2.findOne({ user: userId }).lean(),
    TransactionV2.find({ userId }).sort({ createdAt: -1 }).lean()
  ]);

  const EMPTY = {
    ownership: {
      totalOwnershipPct    : 0, regularOwnershipPct  : 0,
      cofounderOwnershipPct: 0, pendingOwnershipPct  : 0,
      formattedOwnership   : '0.0000000%', formattedPending: '0.0000000%'
    },
    earnings: {
      totalEarningKobo: 0, regularEarningKobo  : 0,
      cofounderEarningKobo: 0, totalEarningNaira: '0.00'
    },
    transactions: { regular: 0, cofounder: 0, total: 0, completed: 0, pending: 0, failed: 0 },
    investment: {
      totalNaira: 0, totalUSDT: 0,
      completedNaira: 0, completedUSDT: 0,
      pendingNaira: 0, pendingUSDT: 0
    }
  };

  if (!snapshot && txs.length === 0) return EMPTY;

  // ── accumulators ────────────────────────────────────────────────────────────
  let regularOwnershipPct = 0, cofounderOwnershipPct = 0, pendingOwnershipPct = 0;
  let regularEarningKobo  = 0, cofounderEarningKobo  = 0;
  let completedCount = 0, pendingCount = 0, failedCount = 0;
  let totalNaira = 0,    totalUSDT = 0;
  let completedNaira = 0, completedUSDT = 0;
  let pendingNaira = 0,   pendingUSDT = 0;
  let regularCompleted = 0, regularPending = 0, regularFailed = 0;
  let cofounderCompleted = 0, cofounderPending = 0, cofounderFailed = 0;

  for (const tx of txs) {
    const isCofounder = tx.type === 'co-founder';
    const status      = tx.status;
    const pct         = parseFloat(tx.ownershipPct) || 0;
    const earn        = parseFloat(tx.earningKobo)  || 0;
    const amt         = parseFloat(tx.totalAmount)  || 0;
    const currency    = (tx.currency || 'naira').toLowerCase();

    // always count committed money
    if (currency === 'naira') totalNaira += amt;
    else if (currency === 'usdt') totalUSDT += amt;

    if (status === 'completed') {
      completedCount++;
      if (currency === 'naira') completedNaira += amt;
      else if (currency === 'usdt') completedUSDT += amt;

      if (isCofounder) { cofounderCompleted++; cofounderOwnershipPct += pct; cofounderEarningKobo += earn; }
      else             { regularCompleted++;   regularOwnershipPct   += pct; regularEarningKobo   += earn; }

    } else if (status === 'pending') {
      pendingCount++;
      if (currency === 'naira') pendingNaira += amt;
      else if (currency === 'usdt') pendingUSDT += amt;
      pendingOwnershipPct += pct;
      isCofounder ? cofounderPending++ : regularPending++;

    } else {
      // failed / cancelled / rejected
      failedCount++;
      isCofounder ? cofounderFailed++ : regularFailed++;
    }
  }

  const regularCount   = regularCompleted   + regularPending   + regularFailed;
  const cofounderCount = cofounderCompleted + cofounderPending + cofounderFailed;
  const totalOwnershipPct = parseFloat((regularOwnershipPct + cofounderOwnershipPct).toFixed(7));
  const totalEarningKobo  = regularEarningKobo + cofounderEarningKobo;

  const refStats = referralStats || {
    totalEarnings: 0, referredUsers: 0,
    generation1: { count: 0, earnings: 0 },
    generation2: { count: 0, earnings: 0 },
    generation3: { count: 0, earnings: 0 }
  };

  return {
    ownership: {
      totalOwnershipPct,
      regularOwnershipPct      : +regularOwnershipPct.toFixed(7),
      cofounderOwnershipPct    : +cofounderOwnershipPct.toFixed(7),
      pendingOwnershipPct      : +pendingOwnershipPct.toFixed(7),
      formattedOwnership       : totalOwnershipPct.toFixed(7) + '%',
      formattedPending         : (+pendingOwnershipPct.toFixed(7)) + '%'
    },
    earnings: {
      totalEarningKobo,
      regularEarningKobo,
      cofounderEarningKobo,
      totalEarningNaira: (totalEarningKobo / 100).toFixed(2)
    },
    transactions: {
      regular  : regularCount,
      cofounder: cofounderCount,
      total    : regularCount + cofounderCount,
      completed: completedCount,
      pending  : pendingCount,
      failed   : failedCount
    },
    investment: {
      totalNaira, totalUSDT,
      completedNaira, completedUSDT,
      pendingNaira, pendingUSDT
    },
    referrals: {
      totalReferred: refStats.referredUsers || 0,
      totalEarnings: refStats.totalEarnings || 0,
      generation1  : refStats.generation1   || { count: 0, earnings: 0 },
      generation2  : refStats.generation2   || { count: 0, earnings: 0 },
      generation3  : refStats.generation3   || { count: 0, earnings: 0 }
    },
    summary: {
      ownership        : `${totalOwnershipPct.toFixed(7)}% total (${regularOwnershipPct.toFixed(7)}% regular + ${cofounderOwnershipPct.toFixed(7)}% co-founder)`,
      pendingOwnership : pendingOwnershipPct > 0 ? `${pendingOwnershipPct.toFixed(7)}% pending verification` : null,
      investmentSummary: `₦${totalNaira.toLocaleString()} total (₦${completedNaira.toLocaleString()} confirmed + ₦${pendingNaira.toLocaleString()} pending)`,
      statusBreakdown  : `${completedCount} completed, ${pendingCount} pending, ${failedCount} failed`
    }
  };
};

// ─────────────────────────────────────────────────────────────────────────────

exports.getUserProjectStats = async (req, res) => {
  try {
    const referralStats = await Referral.findOne({ user: req.user.id });
    const stats = await _buildUserStats(req.user.id, referralStats);
    res.status(200).json({ success: true, stats });
  } catch (error) {
    console.error('Error fetching user project stats:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch user project statistics', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
  }
};

// ─────────────────────────────────────────────────────────────────────────────

exports.getProjectAnalytics = async (req, res) => {
  try {
    const admin = await User.findById(req.user.id);
    if (!admin?.isAdmin) {
      return res.status(403).json({ success: false, message: 'Unauthorized: Admin access required' });
    }

    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);

    const [paymentMethodStats, cofounderPaymentStats, userGrowth, topHolders] = await Promise.all([

      TransactionV2.aggregate([
        { $match: { type: { $in: ['share', 'regular'] }, status: 'completed' } },
        {
          $group: {
            _id              : '$paymentMethod',
            count            : { $sum: 1 },
            totalOwnershipPct: { $sum: { $ifNull: ['$ownershipPct', 0] } },
            totalEarningKobo : { $sum: { $ifNull: ['$earningKobo',  0] } },
            totalAmount      : { $sum: { $ifNull: ['$totalAmount',  0] } }
          }
        },
        { $sort: { totalOwnershipPct: -1 } }
      ]),

      TransactionV2.aggregate([
        { $match: { type: 'co-founder', status: 'completed' } },
        {
          $group: {
            _id              : '$paymentMethod',
            count            : { $sum: 1 },
            totalOwnershipPct: { $sum: { $ifNull: ['$ownershipPct', 0] } },
            totalEarningKobo : { $sum: { $ifNull: ['$earningKobo',  0] } },
            totalAmount      : { $sum: { $ifNull: ['$totalAmount',  0] } }
          }
        },
        { $sort: { totalOwnershipPct: -1 } }
      ]),

      User.aggregate([
        { $match: { createdAt: { $gte: twelveMonthsAgo } } },
        {
          $group: {
            _id  : { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } },
            count: { $sum: 1 }
          }
        },
        { $sort: { '_id.year': 1, '_id.month': 1 } }
      ]),

      UserShareV2.find({ totalOwnershipPct: { $gt: 0 } })
        .sort({ totalOwnershipPct: -1 })
        .limit(10)
        .populate('user', 'name email username')
        .select('user totalOwnershipPct totalEarningKobo')
        .lean()
    ]);

    res.status(200).json({
      success: true,
      analytics: {
        paymentMethods: {
          regular  : paymentMethodStats,
          cofounder: cofounderPaymentStats
        },
        topHolders: topHolders.map(h => ({
          user        : h.user,
          ownershipPct: +h.totalOwnershipPct.toFixed(7),
          formatted   : h.totalOwnershipPct.toFixed(7) + '%',
          earningNaira: (h.totalEarningKobo / 100).toFixed(2)
        })),
        userGrowth
      }
    });

  } catch (error) {
    console.error('Error fetching project analytics:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch project analytics', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
  }
};

// ─────────────────────────────────────────────────────────────────────────────

exports.getAdminUserProjectStats = async (req, res) => {
  try {
    const admin = await User.findById(req.user.id);
    if (!admin?.isAdmin) {
      return res.status(403).json({ success: false, message: 'Unauthorized: Admin access required' });
    }

    const targetUser = await User.findById(req.params.userId)
      .select('name email username createdAt isAdmin').lean();
    if (!targetUser) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const referralStats = await Referral.findOne({ user: req.params.userId });
    const stats = await _buildUserStats(req.params.userId, referralStats);

    res.status(200).json({ success: true, user: targetUser, stats });
  } catch (error) {
    console.error('Error fetching admin user project stats:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch user project statistics', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
  }
};

// ─────────────────────────────────────────────────────────────────────────────

exports.getAdminUserTransactionBreakdown = async (req, res) => {
  try {
    const admin = await User.findById(req.user.id);
    if (!admin?.isAdmin) {
      return res.status(403).json({ success: false, message: 'Admin access required' });
    }

    const targetUser = await User.findById(req.params.userId)
      .select('name email username createdAt').lean();
    if (!targetUser) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const txs = await TransactionV2.find({ userId: req.params.userId })
      .sort({ createdAt: -1 })
      .lean();

    const completed = txs.filter(t => t.status === 'completed');
    const pending   = txs.filter(t => t.status === 'pending');
    const failed    = txs.filter(t => !['completed', 'pending'].includes(t.status));

    const formatTx = (t) => ({
      transactionId: t.transactionId,
      type         : t.type,
      status       : t.status,
      paymentMethod: (t.paymentMethod || '').replace('manual_', '').replace('admin_override', 'admin'),
      currency     : t.currency || 'naira',
      amount       : t.totalAmount || 0,
      ownershipPct : t.ownershipPct || 0,
      earningKobo  : t.earningKobo  || 0,
      earningNaira : ((t.earningKobo || 0) / 100).toFixed(2),
      tierKey      : t.tierKey || null,
      shares       : t.shares  || null,
      date         : t.createdAt,
      paymentProof : t.paymentProof || null
    });

    const completedNaira = completed
      .filter(t => (t.currency || 'naira') === 'naira')
      .reduce((s, t) => s + (t.totalAmount || 0), 0);
    const completedUSDT = completed
      .filter(t => t.currency === 'usdt')
      .reduce((s, t) => s + (t.totalAmount || 0), 0);

    res.status(200).json({
      success: true,
      user: targetUser,
      summary: {
        total    : txs.length,
        completed: completed.length,
        pending  : pending.length,
        failed   : failed.length,
        completedNaira,
        completedUSDT,
        byPaymentMethod: completed.reduce((acc, t) => {
          const method = (t.paymentMethod || 'unknown').replace('manual_', '').replace('admin_override', 'admin');
          if (!acc[method]) acc[method] = { count: 0, totalNaira: 0, totalUSDT: 0 };
          acc[method].count++;
          if ((t.currency || 'naira') === 'naira') acc[method].totalNaira += (t.totalAmount || 0);
          else acc[method].totalUSDT += (t.totalAmount || 0);
          return acc;
        }, {})
      },
      transactions: {
        completed: completed.map(formatTx),
        pending  : pending.map(formatTx),
        failed   : failed.map(formatTx)
      }
    });

  } catch (error) {
    console.error('Error fetching transaction breakdown:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch transaction breakdown' });
  }
};