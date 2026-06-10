const User = require('../models/User');
const Withdrawal = require('../models/Withdrawal');
const TransactionV2 = require('../models/TransactionV2');
const UserShareV2 = require('../models/UserShareV2');

// controllers/adminAnalyticsController.js

exports.getOverview = async (req, res) => {
  try {
    const { year, month } = req.query;

    console.log('Filter params:', { year, month });

    const getDateRangeForFilter = () => {
      if (!year && !month) return null;

      let startDate, endDate;

      if (year && month) {
        const y = parseInt(year);
        const m = parseInt(month) - 1;
        startDate = new Date(y, m, 1, 0, 0, 0);
        endDate   = new Date(y, m + 1, 1, 0, 0, 0);
      } else if (year && !month) {
        const y = parseInt(year);
        startDate = new Date(y, 0, 1, 0, 0, 0);
        endDate   = new Date(y + 1, 0, 1, 0, 0, 0);
      }

      return { startDate, endDate };
    };

    const filterRange = getDateRangeForFilter();

    // ── Build period stats from V2 ────────────────────────────────────────
    const buildPeriodStats = async (startDate, endDate) => {
      const dateFilter = { $gte: startDate, $lt: endDate };

      // Completed V2 transactions in range
      const transactions = await TransactionV2.find({
        createdAt: dateFilter,
        status: 'completed'
      }).lean();

      const txCount        = transactions.length;
      const txAmount       = transactions.reduce((sum, tx) => sum + (tx.totalAmount || 0), 0);
      const totalOwnershipPct = transactions.reduce((sum, tx) => sum + (tx.ownershipPct || 0), 0);

      // New users in range
      const newUsers = await User.countDocuments({ createdAt: dateFilter });

      // Completed withdrawals in range
      const withdrawals = await Withdrawal.find({
        createdAt: dateFilter,
        status: { $in: ['completed', 'paid'] }
      }).lean();

      const wdCount  = withdrawals.length;
      const wdAmount = withdrawals.reduce((sum, wd) => sum + (wd.amount || 0), 0);

      return {
        transactions: { count: txCount, amount: txAmount },
        newUsers,
        sharesSold: txCount,           // each completed V2 tx = 1 purchase unit
        totalOwnershipPct,
        withdrawals: { count: wdCount, amount: wdAmount }
      };
    };

    // ── Build all-time (or filtered) summary stats from V2 ───────────────
    const buildAllTimeStats = async (startDate = null, endDate = null) => {
      const matchCondition = {};
      if (startDate && endDate) {
        matchCondition.createdAt = { $gte: startDate, $lt: endDate };
      }

      const [transactions, withdrawals, users] = await Promise.all([
        TransactionV2.find({ ...matchCondition, status: 'completed' }).lean(),
        Withdrawal.find({
          ...matchCondition,
          status: { $in: ['completed', 'paid'] }
        }).lean(),
        User.find(matchCondition).lean()
      ]);

      return {
        totalUsers       : users.length,
        totalTransactions: transactions.length,
        totalRevenue     : transactions.reduce((sum, tx) => sum + (tx.totalAmount || 0), 0),
        totalSharesSold  : transactions.length,
        totalOwnershipPct: transactions.reduce((sum, tx) => sum + (tx.ownershipPct || 0), 0),
        totalWithdrawals : {
          count : withdrawals.length,
          amount: withdrawals.reduce((sum, wd) => sum + (wd.amount || 0), 0)
        }
      };
    };

    // ── Helper: build recent activity from V2 ─────────────────────────────
    const buildRecentActivity = async (txFilter = {}, wdFilter = {}) => {
      const [rawTransactions, rawWithdrawals] = await Promise.all([
        TransactionV2.find(txFilter)
          .sort({ createdAt: -1 })
          .limit(40)
          .populate('userId', 'name email userName')
          .lean(),
        Withdrawal.find({
          ...wdFilter,
          status: { $in: ['completed', 'paid', 'pending', 'processing', 'failed', 'rejected'] }
        })
          .sort({ createdAt: -1 })
          .limit(40)
          .populate('user', 'name email userName')
          .lean()
      ]);

      const taggedTransactions = rawTransactions.map(tx => ({
        ...tx,
        activityType: 'transaction',
        // Normalise amount field name: V2 uses totalAmount
        amount: tx.totalAmount || tx.amount || 0,
        userId: tx.userId
      }));

      const taggedWithdrawals = rawWithdrawals.map(wd => ({
        ...wd,
        activityType  : 'withdrawal',
        userId        : wd.user,
        withdrawalType: wd.withdrawalType || (wd.paymentDetails ? 'bank' : 'crypto')
      }));

      return [...taggedTransactions, ...taggedWithdrawals]
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, 40);
    };

    let daily, weekly, monthly, yearly;
    let allTimeStats;
    let recentActivity;
    let recentUsers;

    if (filterRange) {
      // ── FILTERED VIEW ──────────────────────────────────────────────────
      const { startDate, endDate } = filterRange;

      const periodStats = await buildPeriodStats(startDate, endDate);
      daily = weekly = monthly = yearly = periodStats;

      allTimeStats = await buildAllTimeStats(startDate, endDate);

      const dateFilter = { createdAt: { $gte: startDate, $lt: endDate } };
      recentActivity = await buildRecentActivity(dateFilter, dateFilter);

      recentUsers = await User.find({ createdAt: { $gte: startDate, $lt: endDate } })
        .sort({ createdAt: -1 })
        .limit(10)
        .select('name email userName createdAt phone')
        .lean();

    } else {
      // ── DEFAULT VIEW — current periods ────────────────────────────────
      const now          = new Date();
      const currentYear  = now.getFullYear();
      const currentMonth = now.getMonth();
      const currentDate  = now.getDate();

      const dailyRange = {
        start: new Date(currentYear, currentMonth, currentDate, 0, 0, 0),
        end  : new Date(currentYear, currentMonth, currentDate + 1, 0, 0, 0)
      };

      const weeklyStart = new Date(now);
      weeklyStart.setDate(now.getDate() - now.getDay());
      weeklyStart.setHours(0, 0, 0, 0);
      const weeklyRange = {
        start: weeklyStart,
        end  : new Date(weeklyStart.getTime() + 7 * 24 * 60 * 60 * 1000)
      };

      const monthlyRange = {
        start: new Date(currentYear, currentMonth, 1),
        end  : new Date(currentYear, currentMonth + 1, 1)
      };

      const yearlyRange = {
        start: new Date(currentYear, 0, 1),
        end  : new Date(currentYear + 1, 0, 1)
      };

      [daily, weekly, monthly, yearly] = await Promise.all([
        buildPeriodStats(dailyRange.start,   dailyRange.end),
        buildPeriodStats(weeklyRange.start,  weeklyRange.end),
        buildPeriodStats(monthlyRange.start, monthlyRange.end),
        buildPeriodStats(yearlyRange.start,  yearlyRange.end)
      ]);

      allTimeStats = await buildAllTimeStats();

      recentActivity = await buildRecentActivity({}, {});

      recentUsers = await User.find()
        .sort({ createdAt: -1 })
        .limit(10)
        .select('name email userName createdAt phone')
        .lean();
    }

    res.json({
      success: true,
      data: {
        daily,
        weekly,
        monthly,
        yearly,
        allTime: allTimeStats,
        recentActivity,
        recentUsers,
        filterApplied: filterRange ? { year, month } : null
      }
    });

  } catch (error) {
    console.error('Admin analytics overview error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch analytics',
      error  : error.message
    });
  }
};

// ── Transaction detail — reads from V2 (falls back to V1 for older records) ──

const TransactionV1 = require('../models/Transaction');   // V1 kept for fallback
const UserShare     = require('../models/UserShare');      // V1 UserShare fallback

/**
 * @desc    Get transaction detail (full user info, payment proof, referrer, etc.)
 * @route   GET /api/admin/analytics/transaction/:transactionId
 * @access  Private (Admin)
 */
exports.getTransactionDetail = async (req, res) => {
  try {
    const { transactionId } = req.params;

    // ── Try V2 first ──────────────────────────────────────────────────────
    let transaction = await TransactionV2.findOne({ transactionId })
      .populate('userId', 'name email phone userName referralCode referredBy createdAt onboardingAgreed')
      .lean();

    if (transaction) {
      return await buildDetailResponseV2(res, transaction);
    }

    // ── Fall back to V1 ───────────────────────────────────────────────────
    transaction = await TransactionV1.findOne({ transactionId })
      .populate('userId', 'name email phone userName referralCode referredBy createdAt onboardingAgreed')
      .lean();

    if (!transaction) {
      // Last resort: try by Mongo _id
      transaction = await TransactionV2.findById(transactionId)
        .populate('userId', 'name email phone userName referralCode referredBy createdAt onboardingAgreed')
        .lean();
    }

    if (!transaction) {
      return res.status(404).json({ success: false, message: 'Transaction not found' });
    }

    // Determine which builder to use based on which collection it came from
    return await buildDetailResponseV2(res, transaction);

  } catch (error) {
    console.error('Transaction detail error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch transaction detail',
      error  : error.message
    });
  }
};

async function buildDetailResponseV2(res, transaction) {
  const User     = require('../models/User');
  const UserShareV2 = require('../models/UserShareV2');

  const user = transaction.userId;

  // ── Referrer ──────────────────────────────────────────────────────────
  let referrer = null;
  if (user?.referredBy) {
    referrer = await User.findById(user.referredBy)
      .select('_id name email phone userName')
      .lean();
  }

  // ── UserShare V2 snapshot ─────────────────────────────────────────────
  let userShareData = null;
  if (user?._id) {
    const snapshot = await UserShareV2.findOne({ user: user._id }).lean();
    if (snapshot) {
      userShareData = {
        totalOwnershipPct    : snapshot.totalOwnershipPct    || 0,
        cofounderOwnershipPct: snapshot.cofounderOwnershipPct || 0,
        regularOwnershipPct  : snapshot.regularOwnershipPct  || 0,
        totalEarningKobo     : snapshot.totalEarningKobo     || 0
      };
    }
  }

  console.log('Transaction data (V2):', {
    transactionId: transaction.transactionId,
    status       : transaction.status,
    ownershipPct : transaction.ownershipPct,
    earningKobo  : transaction.earningKobo,
    tierKey      : transaction.tierKey,
    totalAmount  : transaction.totalAmount
  });

  res.json({
    success: true,
    data: {
      transaction: {
        transactionId : transaction.transactionId,
        type          : transaction.type,
        amount        : transaction.totalAmount ?? transaction.amount ?? null,
        currency      : transaction.currency,
        status        : transaction.status,
        paymentMethod : transaction.paymentMethod,
        paymentProof  : transaction.paymentProof || transaction.paymentProofCloudinaryUrl || null,
        paymentProofCloudinaryId: transaction.paymentProofCloudinaryId || null,
        tierKey       : transaction.tierKey,
        ownershipPct  : transaction.ownershipPct  ?? null,
        earningKobo   : transaction.earningKobo   ?? null,
        shares        : transaction.shares        ?? null,
        reference     : transaction.reference     || null,
        note          : transaction.note          || null,
        createdAt     : transaction.createdAt,
        updatedAt     : transaction.updatedAt
      },
      user: user ? {
        _id            : user._id,
        name           : user.name,
        email          : user.email,
        phone          : user.phone,
        userName       : user.userName,
        referralCode   : user.referralCode,
        onboardingAgreed: user.onboardingAgreed,
        joinedAt       : user.createdAt
      } : null,
      referrer: referrer ? {
        _id     : referrer._id,
        name    : referrer.name,
        email   : referrer.email,
        phone   : referrer.phone,
        userName: referrer.userName
      } : null,
      userShareData,
      source: 'V2'
    }
  });
}