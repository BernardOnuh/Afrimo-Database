// controller/projectController.js  (percentage-based rewrite)

const Share        = require('../models/Share');
const CoFounderShare = require('../models/CoFounderShare');
const User         = require('../models/User');
const UserShare    = require('../models/UserShare');
const PaymentTransaction = require('../models/Transaction');
const Referral     = require('../models/Referral');

// ─── helpers ─────────────────────────────────────────────────────────────────

/** Sum ownershipPct from completed transactions in a PaymentTransaction array */
const sumOwnership = (txs) =>
  txs.filter(t => t.status === 'completed')
     .reduce((sum, t) => sum + (t.ownershipPct || 0), 0);

/** Sum earningKobo from completed transactions */
const sumEarnings = (txs) =>
  txs.filter(t => t.status === 'completed')
     .reduce((sum, t) => sum + (t.earningKobo || 0), 0);

// ─────────────────────────────────────────────────────────────────────────────

/**
 * @desc  Get overall project statistics
 * @route GET /api/project/stats
 * @access Public
 */
exports.getProjectStats = async (req, res) => {
  try {
    const [totalUsers, ownershipAgg, cofounderOwnershipAgg, userShareAgg] = await Promise.all([
      User.countDocuments(),

      // Total ownership % sold – regular shares
      PaymentTransaction.aggregate([
        { $match: { type: 'share', status: 'completed' } },
        {
          $group: {
            _id: null,
            totalOwnershipPct : { $sum: { $ifNull: ['$ownershipPct',  0] } },
            totalEarningKobo  : { $sum: { $ifNull: ['$earningKobo',   0] } },
            totalAmountNaira  : {
              $sum: { $cond: [{ $eq: ['$currency', 'naira'] }, { $ifNull: ['$amount', 0] }, 0] }
            },
            totalAmountUSDT   : {
              $sum: { $cond: [{ $eq: ['$currency', 'usdt']  }, { $ifNull: ['$amount', 0] }, 0] }
            },
            uniqueUsers: { $addToSet: '$userId' },
            count: { $sum: 1 }
          }
        }
      ]),

      // Total ownership % sold – co-founder shares
      PaymentTransaction.aggregate([
        { $match: { type: 'co-founder', status: 'completed' } },
        {
          $group: {
            _id: null,
            totalOwnershipPct : { $sum: { $ifNull: ['$ownershipPct', 0] } },
            totalEarningKobo  : { $sum: { $ifNull: ['$earningKobo',  0] } },
            totalAmountNaira  : {
              $sum: { $cond: [{ $eq: ['$currency', 'naira'] }, { $ifNull: ['$amount', 0] }, 0] }
            },
            totalAmountUSDT   : {
              $sum: { $cond: [{ $eq: ['$currency', 'usdt']  }, { $ifNull: ['$amount', 0] }, 0] }
            },
            uniqueUsers: { $addToSet: '$userId' },
            count: { $sum: 1 }
          }
        }
      ]),

      // How many UserShare docs hold at least some ownership
      UserShare.aggregate([
        { $match: { totalOwnershipPct: { $gt: 0 } } },
        { $count: 'total' }
      ])
    ]);

    const reg  = ownershipAgg[0]          || { totalOwnershipPct: 0, totalEarningKobo: 0, totalAmountNaira: 0, totalAmountUSDT: 0, uniqueUsers: [], count: 0 };
    const cf   = cofounderOwnershipAgg[0] || { totalOwnershipPct: 0, totalEarningKobo: 0, totalAmountNaira: 0, totalAmountUSDT: 0, uniqueUsers: [], count: 0 };
    const shareholders = userShareAgg[0]?.total || 0;

    const totalOwnershipSold      = +(reg.totalOwnershipPct + cf.totalOwnershipPct).toFixed(7);
    const totalOwnershipAvailable = +(100 - totalOwnershipSold).toFixed(7);

    // Unique shareholders across both types
    const allShareholderIds = new Set([
      ...reg.uniqueUsers.map(String),
      ...cf.uniqueUsers.map(String)
    ]);

    res.status(200).json({
      success: true,
      stats: {
        users: {
          total: totalUsers,
          totalShareholders: allShareholderIds.size,
          regularShareholders: reg.uniqueUsers.length,
          cofounderShareholders: cf.uniqueUsers.length
        },

        ownership: {
          // percentages
          totalSold           : totalOwnershipSold,
          totalAvailable      : totalOwnershipAvailable,
          regularSharesSold   : +reg.totalOwnershipPct.toFixed(7),
          cofounderSharesSold : +cf.totalOwnershipPct.toFixed(7),
          // formatted
          totalSoldFormatted      : totalOwnershipSold.toFixed(7)  + '%',
          totalAvailableFormatted : totalOwnershipAvailable.toFixed(7) + '%',
        },

        earnings: {
          totalEarningKobo          : reg.totalEarningKobo + cf.totalEarningKobo,
          regularEarningKobo        : reg.totalEarningKobo,
          cofounderEarningKobo      : cf.totalEarningKobo,
          // human-readable Naira (100 kobo = ₦1)
          totalEarningNaira         : ((reg.totalEarningKobo + cf.totalEarningKobo) / 100).toFixed(2),
        },

        transactions: {
          regularCount    : reg.count,
          cofounderCount  : cf.count,
          totalCount      : reg.count + cf.count
        },

        totalValues: {
          naira : { regular: reg.totalAmountNaira, cofounder: cf.totalAmountNaira, total: reg.totalAmountNaira + cf.totalAmountNaira },
          usdt  : { regular: reg.totalAmountUSDT,  cofounder: cf.totalAmountUSDT,  total: reg.totalAmountUSDT  + cf.totalAmountUSDT  }
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

// ─────────────────────────────────────────────────────────────────────────────

/**
 * @desc  Get user-specific project statistics
 * @route GET /api/project/user-stats
 * @access Private
 *
 * Source-of-truth priority:
 *   1. PaymentTransaction  — always has full package data (ownershipPct, earningKobo, amount)
 *   2. UserShare.transactions — fallback for records not in PaymentTransaction (admin grants, legacy)
 *
 * This avoids the zero-ownership bug that occurs when older UserShare transaction
 * records were created before ownershipPct was added to the package schema.
 */
exports.getUserProjectStats = async (req, res) => {
  try {
    const userId = req.user.id;

    const EMPTY_STATS = {
      ownership: {
        totalOwnershipPct     : 0,
        regularOwnershipPct   : 0,
        cofounderOwnershipPct : 0,
        pendingOwnershipPct   : 0,
        formattedOwnership    : '0.0000000%',
        formattedPending      : '0.0000000%'
      },
      earnings: {
        totalEarningKobo    : 0,
        regularEarningKobo  : 0,
        cofounderEarningKobo: 0,
        totalEarningNaira   : '0.00'
      },
      transactions: { regular: 0, cofounder: 0, total: 0, completed: 0, pending: 0, failed: 0 },
      investment  : { totalNaira: 0, totalUSDT: 0 },
      referrals   : {
        totalReferred: 0, totalEarnings: 0,
        generation1: { count: 0, earnings: 0 },
        generation2: { count: 0, earnings: 0 },
        generation3: { count: 0, earnings: 0 }
      }
    };

    const [regularPTxs, cofounderPTxs, userShare, referralStats] = await Promise.all([
      PaymentTransaction.find({ userId, type: 'share'      }).lean(),
      PaymentTransaction.find({ userId, type: 'co-founder' }).lean(),
      UserShare.findOne({ user: userId }).lean(),
      Referral.findOne({ user: userId })
    ]);

    const hasAnyData = regularPTxs.length || cofounderPTxs.length || userShare;
    if (!hasAnyData) {
      return res.status(200).json({ success: true, stats: EMPTY_STATS });
    }

    const ptxIds = new Set([
      ...regularPTxs.map(t => t.transactionId),
      ...cofounderPTxs.map(t => t.transactionId)
    ]);

    const legacyTxs = (userShare?.transactions || []).filter(
      t => !ptxIds.has(t.transactionId)
    );

    // ── accumulators ─────────────────────────────────────────────────────────
    let regularOwnershipPct   = 0, cofounderOwnershipPct = 0, pendingOwnershipPct = 0;
    let regularEarningKobo    = 0, cofounderEarningKobo  = 0;
    let completedCount = 0, pendingCount = 0, failedCount = 0;
    let totalNaira = 0, totalUSDT = 0;

    // type counts derived directly from source arrays + legacy
    const legacyRegularCount   = legacyTxs.filter(t => !(t.type === 'co-founder' || t.paymentMethod === 'co-founder')).length;
    const legacyCofounderCount = legacyTxs.filter(t =>   t.type === 'co-founder' || t.paymentMethod === 'co-founder' ).length;

    const regularCount   = regularPTxs.length   + legacyRegularCount;
    const cofounderCount = cofounderPTxs.length + legacyCofounderCount;

    const processTx = (tx, isCofounder) => {
      const status   = tx.status;
      const pct      = parseFloat(tx.ownershipPct)  || 0;
      const earn     = parseFloat(tx.earningKobo)   || 0;
      const amt      = parseFloat(tx.amount ?? tx.totalAmount ?? 0) || 0;
      const currency = tx.currency || 'naira';

      if (status === 'completed') {
        completedCount++;
        if (isCofounder) {
          cofounderOwnershipPct += pct;
          cofounderEarningKobo  += earn;
        } else {
          regularOwnershipPct += pct;
          regularEarningKobo  += earn;
        }
        if (currency === 'naira') totalNaira += amt;
        else if (currency === 'usdt') totalUSDT += amt;

      } else if (status === 'pending') {
        pendingCount++;
        pendingOwnershipPct += pct;

      } else {
        failedCount++;
      }
    };

    regularPTxs.forEach(t   => processTx(t, false));
    cofounderPTxs.forEach(t => processTx(t, true));
    legacyTxs.forEach(t => {
      const isCf = t.type === 'co-founder' || t.paymentMethod === 'co-founder';
      processTx(t, isCf);
    });

    // ── totals ────────────────────────────────────────────────────────────────
    const totalOwnershipPct = parseFloat((regularOwnershipPct + cofounderOwnershipPct).toFixed(7));
    const totalEarningKobo  = regularEarningKobo + cofounderEarningKobo;

    const refStats = referralStats || {
      totalEarnings: 0, referredUsers: 0,
      generation1: { count: 0, earnings: 0 },
      generation2: { count: 0, earnings: 0 },
      generation3: { count: 0, earnings: 0 }
    };

    res.status(200).json({
      success: true,
      stats: {
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
          totalEarningNaira : (totalEarningKobo / 100).toFixed(2)
        },
        transactions: {
          regular   : regularCount,    // now = PTx count + legacy count, not inflated by status loop
          cofounder : cofounderCount,
          total     : regularCount + cofounderCount,
          completed : completedCount,
          pending   : pendingCount,
          failed    : failedCount
        },
        investment: { totalNaira, totalUSDT },
        referrals: {
          totalReferred : refStats.referredUsers || 0,
          totalEarnings : refStats.totalEarnings || 0,
          generation1   : refStats.generation1   || { count: 0, earnings: 0 },
          generation2   : refStats.generation2   || { count: 0, earnings: 0 },
          generation3   : refStats.generation3   || { count: 0, earnings: 0 }
        },
        summary: {
          ownership        : `${totalOwnershipPct.toFixed(7)}% total (${regularOwnershipPct.toFixed(7)}% regular + ${cofounderOwnershipPct.toFixed(7)}% co-founder)`,
          pendingOwnership : pendingOwnershipPct > 0 ? `${pendingOwnershipPct.toFixed(7)}% pending verification` : null,
          investmentSummary: `₦${totalNaira.toLocaleString()} + $${totalUSDT.toLocaleString()}`,
          statusBreakdown  : `${completedCount} completed, ${pendingCount} pending, ${failedCount} failed`
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

// ─────────────────────────────────────────────────────────────────────────────

/**
 * @desc  Get detailed project analytics (Admin only)
 * @route GET /api/project/analytics
 * @access Private (Admin)
 */
exports.getProjectAnalytics = async (req, res) => {
  try {
    const admin = await User.findById(req.user.id);
    if (!admin?.isAdmin) {
      return res.status(403).json({ success: false, message: 'Unauthorized: Admin access required' });
    }

    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);

    const [paymentMethodStats, cofounderPaymentStats, userGrowth, topHolders] = await Promise.all([

      // Ownership % breakdown by payment method – regular
      PaymentTransaction.aggregate([
        { $match: { type: 'share', status: 'completed' } },
        {
          $group: {
            _id             : '$paymentMethod',
            count           : { $sum: 1 },
            totalOwnershipPct: { $sum: { $ifNull: ['$ownershipPct', 0] } },
            totalEarningKobo : { $sum: { $ifNull: ['$earningKobo',  0] } },
            totalAmount     : { $sum: { $ifNull: ['$amount', 0] } }
          }
        },
        { $sort: { totalOwnershipPct: -1 } }
      ]),

      // Ownership % breakdown by payment method – co-founder
      PaymentTransaction.aggregate([
        { $match: { type: 'co-founder', status: 'completed' } },
        {
          $group: {
            _id             : '$paymentMethod',
            count           : { $sum: 1 },
            totalOwnershipPct: { $sum: { $ifNull: ['$ownershipPct', 0] } },
            totalEarningKobo : { $sum: { $ifNull: ['$earningKobo',  0] } },
            totalAmount     : { $sum: { $ifNull: ['$amount', 0] } }
          }
        },
        { $sort: { totalOwnershipPct: -1 } }
      ]),

      // User registration growth – last 12 months
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

      // Top 10 shareholders by ownership %
      UserShare.find({ totalOwnershipPct: { $gt: 0 } })
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
          regular   : paymentMethodStats,
          cofounder : cofounderPaymentStats
        },
        topHolders: topHolders.map(h => ({
          user           : h.user,
          ownershipPct   : +h.totalOwnershipPct.toFixed(7),
          formatted      : h.totalOwnershipPct.toFixed(7) + '%',
          earningNaira   : (h.totalEarningKobo / 100).toFixed(2)
        })),
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