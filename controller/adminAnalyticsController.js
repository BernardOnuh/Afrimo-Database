const User = require('../models/User');
const Transaction = require('../models/Transaction');
const Withdrawal = require('../models/Withdrawal');
const UserShare = require('../models/UserShare');

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
        endDate = new Date(y, m + 1, 1, 0, 0, 0);
      } else if (year && !month) {
        const y = parseInt(year);
        startDate = new Date(y, 0, 1, 0, 0, 0);
        endDate = new Date(y + 1, 0, 1, 0, 0, 0);
      }
      
      return { startDate, endDate };
    };
    
    const filterRange = getDateRangeForFilter();
    
    // Updated: Build stats using percent-based model
    const buildPeriodStats = async (startDate, endDate) => {
      // Get completed transactions
      const transactions = await Transaction.find({
        createdAt: { $gte: startDate, $lt: endDate },
        status: 'completed'
      }).lean();
      
      const txCount = transactions.length;
      const txAmount = transactions.reduce((sum, tx) => sum + (tx.amount || 0), 0);
      
      // Get new users
      const newUsers = await User.countDocuments({ 
        createdAt: { $gte: startDate, $lt: endDate } 
      });
      
      // For shares sold - now using ownershipPct instead of share count
      // Each transaction represents 1 "unit" (package purchase) with a certain ownership %
      const sharesSold = transactions.length; // Each transaction = 1 share unit
      
      // For total ownership % calculation (optional - can be useful)
      const totalOwnershipPct = transactions.reduce((sum, tx) => sum + (tx.ownershipPct || 0), 0);
      
      // Get completed withdrawals
      const withdrawals = await Withdrawal.find({
        createdAt: { $gte: startDate, $lt: endDate },
        status: { $in: ['completed', 'paid'] }
      }).lean();
      
      const wdCount = withdrawals.length;
      const wdAmount = withdrawals.reduce((sum, wd) => sum + (wd.amount || 0), 0);
      
      return {
        transactions: { count: txCount, amount: txAmount },
        newUsers,
        sharesSold,  // Now represents number of completed transactions/purchases
        totalOwnershipPct,  // Added: total ownership percentage for the period
        withdrawals: { count: wdCount, amount: wdAmount }
      };
    };
    
    // Updated: Build all-time stats
    const buildAllTimeStats = async (startDate = null, endDate = null) => {
      const matchCondition = {};
      if (startDate && endDate) {
        matchCondition.createdAt = { $gte: startDate, $lt: endDate };
      }
      
      const transactions = await Transaction.find({
        ...matchCondition,
        status: 'completed'
      }).lean();
      
      const withdrawals = await Withdrawal.find({
        ...matchCondition,
        status: { $in: ['completed', 'paid'] }
      }).lean();
      
      const users = await User.find(matchCondition).lean();
      
      return {
        totalUsers: users.length,
        totalTransactions: transactions.length,
        totalRevenue: transactions.reduce((sum, tx) => sum + (tx.amount || 0), 0),
        totalSharesSold: transactions.length, // Each completed transaction = 1 share unit
        totalOwnershipPct: transactions.reduce((sum, tx) => sum + (tx.ownershipPct || 0), 0),
        totalWithdrawals: {
          count: withdrawals.length,
          amount: withdrawals.reduce((sum, wd) => sum + (wd.amount || 0), 0)
        }
      };
    };
    
    let daily, weekly, monthly, yearly;
    let allTimeStats;
    let recentActivity;
    let recentUsers;
    
    if (filterRange) {
      // FILTERED VIEW
      const { startDate, endDate } = filterRange;
      const periodStats = await buildPeriodStats(startDate, endDate);
      daily = weekly = monthly = yearly = periodStats;
      
      allTimeStats = await buildAllTimeStats(startDate, endDate);
      
      // Filtered recent activity
      const [rawTransactions, rawWithdrawals] = await Promise.all([
        Transaction.find({ createdAt: { $gte: startDate, $lt: endDate } })
          .sort({ createdAt: -1 })
          .limit(40)
          .populate('userId', 'name email userName')
          .lean(),
        Withdrawal.find({ 
          createdAt: { $gte: startDate, $lt: endDate },
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
        // Map userId to consistent field
        userId: tx.userId
      }));
      
      const taggedWithdrawals = rawWithdrawals.map(wd => ({ 
        ...wd, 
        activityType: 'withdrawal',
        userId: wd.user,
        withdrawalType: wd.withdrawalType || (wd.paymentDetails ? 'bank' : 'crypto')
      }));
      
      recentActivity = [...taggedTransactions, ...taggedWithdrawals]
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, 40);
      
      recentUsers = await User.find({ createdAt: { $gte: startDate, $lt: endDate } })
        .sort({ createdAt: -1 })
        .limit(10)
        .select('name email userName createdAt phone')
        .lean();
        
    } else {
      // DEFAULT VIEW - Current periods
      const now = new Date();
      const currentYear = now.getFullYear();
      const currentMonth = now.getMonth();
      const currentDate = now.getDate();
      
      const dailyRange = {
        start: new Date(currentYear, currentMonth, currentDate, 0, 0, 0),
        end: new Date(currentYear, currentMonth, currentDate + 1, 0, 0, 0)
      };
      
      const weeklyStart = new Date(now);
      weeklyStart.setDate(now.getDate() - now.getDay());
      weeklyStart.setHours(0, 0, 0, 0);
      const weeklyRange = {
        start: weeklyStart,
        end: new Date(weeklyStart.getTime() + 7 * 24 * 60 * 60 * 1000)
      };
      
      const monthlyRange = {
        start: new Date(currentYear, currentMonth, 1),
        end: new Date(currentYear, currentMonth + 1, 1)
      };
      
      const yearlyRange = {
        start: new Date(currentYear, 0, 1),
        end: new Date(currentYear + 1, 0, 1)
      };
      
      [daily, weekly, monthly, yearly] = await Promise.all([
        buildPeriodStats(dailyRange.start, dailyRange.end),
        buildPeriodStats(weeklyRange.start, weeklyRange.end),
        buildPeriodStats(monthlyRange.start, monthlyRange.end),
        buildPeriodStats(yearlyRange.start, yearlyRange.end)
      ]);
      
      allTimeStats = await buildAllTimeStats();
      
      // Recent activity (last 40 overall)
      const [rawTransactions, rawWithdrawals] = await Promise.all([
        Transaction.find()
          .sort({ createdAt: -1 })
          .limit(40)
          .populate('userId', 'name email userName')
          .lean(),
        Withdrawal.find({ 
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
        userId: tx.userId
      }));
      
      const taggedWithdrawals = rawWithdrawals.map(wd => ({ 
        ...wd, 
        activityType: 'withdrawal',
        userId: wd.user,
        withdrawalType: wd.withdrawalType || (wd.paymentDetails ? 'bank' : 'crypto')
      }));
      
      recentActivity = [...taggedTransactions, ...taggedWithdrawals]
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, 40);
      
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
      error: error.message 
    });
  }
};

// getTransactionDetail remains the same - it already handles percent-based data correctly
exports.getTransactionDetail = async (req, res) => {
  try {
    const { transactionId } = req.params;

    const transaction = await Transaction.findOne({ transactionId })
      .populate('userId', 'name email phone userName referralCode referredBy createdAt onboardingAgreed')
      .lean();

    if (!transaction) {
      const txById = await Transaction.findById(transactionId)
        .populate('userId', 'name email phone userName referralCode referredBy createdAt onboardingAgreed')
        .lean();
      if (!txById) {
        return res.status(404).json({ success: false, message: 'Transaction not found' });
      }
      return await buildDetailResponse(res, txById);
    }

    return await buildDetailResponse(res, transaction);
  } catch (error) {
    console.error('Transaction detail error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch transaction detail', error: error.message });
  }
};

async function buildDetailResponse(res, transaction) {
  const user = transaction.userId;
  
  let referrer = null;
  if (user?.referredBy) {
    referrer = await User.findById(user.referredBy).select('_id name email phone userName').lean();
  }

  let userShareData = null;
  if (user?._id) {
    const userShare = await UserShare.findOne({ user: user._id }).lean();
    if (userShare) {
      const matchingTx = userShare.transactions?.find(t => t.transactionId === transaction.transactionId);
      userShareData = {
        totalOwnershipPct: userShare.totalOwnershipPct,
        coFounderOwnershipPct: userShare.coFounderOwnershipPct,
        matchingTransaction: matchingTx || null
      };
    }
  }

  // Log the actual values for debugging
  console.log('Transaction data:', {
    transactionId: transaction.transactionId,
    status: transaction.status,
    ownershipPct: transaction.ownershipPct,
    earningKobo: transaction.earningKobo,
    tier: transaction.tier,
    amount: transaction.amount
  });

  res.json({
    success: true,
    data: {
      transaction: {
        transactionId: transaction.transactionId,
        type: transaction.type,
        amount: transaction.amount,
        currency: transaction.currency,
        status: transaction.status,
        paymentMethod: transaction.paymentMethod,
        paymentProof: transaction.paymentProof || transaction.paymentProofCloudinaryUrl || null,
        paymentProofCloudinaryId: transaction.paymentProofCloudinaryId,
        tier: transaction.tier,
        // Return whatever is in the database, even if 0 or null
        ownershipPct: transaction.ownershipPct !== undefined && transaction.ownershipPct !== null 
          ? transaction.ownershipPct 
          : null,
        earningKobo: transaction.earningKobo !== undefined && transaction.earningKobo !== null 
          ? transaction.earningKobo 
          : null,
        tierBreakdown: transaction.tierBreakdown,
        reference: transaction.reference,
        createdAt: transaction.createdAt,
        updatedAt: transaction.updatedAt,
      },
      user: user ? {
        _id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        userName: user.userName,
        referralCode: user.referralCode,
        onboardingAgreed: user.onboardingAgreed,
        joinedAt: user.createdAt,
      } : null,
      referrer: referrer ? {
        _id: referrer._id,
        name: referrer.name,
        email: referrer.email,
        phone: referrer.phone,
        userName: referrer.userName,
      } : null,
      userShareData,
    }
  });
}



// ADD THIS MISSING FUNCTION
/**
 * @desc    Get transaction detail (full user info, payment proof, referrer, etc.)
 * @route   GET /api/admin/analytics/transaction/:transactionId
 * @access  Private (Admin)
 */
exports.getTransactionDetail = async (req, res) => {
  try {
    const { transactionId } = req.params;

    const transaction = await Transaction.findOne({ transactionId })
      .populate('userId', 'name email phone userName referralCode referredBy createdAt onboardingAgreed')
      .lean();

    if (!transaction) {
      const txById = await Transaction.findById(transactionId)
        .populate('userId', 'name email phone userName referralCode referredBy createdAt onboardingAgreed')
        .lean();
      if (!txById) {
        return res.status(404).json({ success: false, message: 'Transaction not found' });
      }
      return await buildDetailResponse(res, txById);
    }

    return await buildDetailResponse(res, transaction);
  } catch (error) {
    console.error('Transaction detail error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch transaction detail', error: error.message });
  }
};

// Helper function for transaction detail
async function buildDetailResponse(res, transaction) {
  const user = transaction.userId;
  
  let referrer = null;
  if (user?.referredBy) {
    referrer = await User.findById(user.referredBy).select('name email phone userName').lean();
  }

  let userShareData = null;
  if (user?._id) {
    const userShare = await UserShare.findOne({ user: user._id }).lean();
    if (userShare) {
      const matchingTx = userShare.transactions?.find(t => t.transactionId === transaction.transactionId);
      userShareData = {
        totalShares: userShare.totalShares,
        coFounderShares: userShare.coFounderShares,
        matchingTransaction: matchingTx || null
      };
    }
  }

  res.json({
    success: true,
    data: {
      transaction: {
        transactionId: transaction.transactionId,
        type: transaction.type,
        amount: transaction.amount,
        currency: transaction.currency,
        status: transaction.status,
        paymentMethod: transaction.paymentMethod,
        paymentProof: transaction.paymentProof,
        paymentProofCloudinaryId: transaction.paymentProofCloudinaryId,
        tier: transaction.tier,
        shares: transaction.shares,
        tierBreakdown: transaction.tierBreakdown,
        reference: transaction.reference,
        createdAt: transaction.createdAt,
        updatedAt: transaction.updatedAt,
      },
      user: user ? {
        _id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        userName: user.userName,
        referralCode: user.referralCode,
        onboardingAgreed: user.onboardingAgreed,
        joinedAt: user.createdAt,
      } : null,
      referrer: referrer ? {
        name: referrer.name,
        email: referrer.email,
        phone: referrer.phone,
        userName: referrer.userName,
      } : null,
      userShareData,
    }
  });
}