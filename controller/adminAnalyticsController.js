const User = require('../models/User');
const Transaction = require('../models/Transaction');
const Withdrawal = require('../models/Withdrawal');
const UserShare = require('../models/UserShare');

exports.getOverview = async (req, res) => {
  try {
    const { year, month } = req.query;
    
    console.log('Filter params:', { year, month }); // Debug log
    
    // Function to get date range based on filter
    const getDateRangeForFilter = () => {
      if (!year && !month) return null;
      
      let startDate, endDate;
      
      if (year && month) {
        // Specific month
        const y = parseInt(year);
        const m = parseInt(month) - 1;
        startDate = new Date(y, m, 1, 0, 0, 0);
        endDate = new Date(y, m + 1, 1, 0, 0, 0);
      } else if (year && !month) {
        // Full year
        const y = parseInt(year);
        startDate = new Date(y, 0, 1, 0, 0, 0);
        endDate = new Date(y + 1, 0, 1, 0, 0, 0);
      }
      
      console.log('Date range:', { startDate, endDate }); // Debug log
      return { startDate, endDate };
    };
    
    const filterRange = getDateRangeForFilter();
    
    // Build stats for a specific date range
    const buildPeriodStats = async (startDate, endDate) => {
      const [txAgg, newUsers, sharesAgg, wdAgg] = await Promise.all([
        Transaction.aggregate([
          { $match: { createdAt: { $gte: startDate, $lt: endDate }, status: 'completed' } },
          { $group: { _id: null, count: { $sum: 1 }, amount: { $sum: '$amount' } } }
        ]),
        User.countDocuments({ createdAt: { $gte: startDate, $lt: endDate } }),
        UserShare.aggregate([
          { $unwind: '$transactions' },
          { $match: { 'transactions.date': { $gte: startDate, $lt: endDate }, 'transactions.status': 'completed' } },
          { $group: { _id: null, count: { $sum: '$transactions.shares' } } }
        ]),
        Withdrawal.aggregate([
          { $match: { createdAt: { $gte: startDate, $lt: endDate }, status: { $in: ['completed', 'paid'] } } },
          { $group: { _id: null, count: { $sum: 1 }, amount: { $sum: '$amount' } } }
        ])
      ]);
      
      return {
        transactions: { count: txAgg[0]?.count || 0, amount: txAgg[0]?.amount || 0 },
        newUsers,
        sharesSold: sharesAgg[0]?.count || 0,
        withdrawals: { count: wdAgg[0]?.count || 0, amount: wdAgg[0]?.amount || 0 }
      };
    };
    
    let daily, weekly, monthly, yearly;
    let allTimeStats;
    let recentActivity;
    let recentUsers;
    
    if (filterRange) {
      // FILTERED VIEW - All periods show the same filtered data
      const { startDate, endDate } = filterRange;
      const periodStats = await buildPeriodStats(startDate, endDate);
      daily = weekly = monthly = yearly = periodStats;
      
      // All time stats within filter range
      const [totalUsers, totalTxAgg, totalSharesAgg, totalWdAgg] = await Promise.all([
        User.countDocuments({ createdAt: { $gte: startDate, $lt: endDate } }),
        Transaction.aggregate([
          { $match: { createdAt: { $gte: startDate, $lt: endDate }, status: 'completed' } },
          { $group: { _id: null, count: { $sum: 1 }, amount: { $sum: '$amount' } } }
        ]),
        UserShare.aggregate([
          { $unwind: '$transactions' },
          { $match: { 'transactions.date': { $gte: startDate, $lt: endDate }, 'transactions.status': 'completed' } },
          { $group: { _id: null, count: { $sum: '$transactions.shares' } } }
        ]),
        Withdrawal.aggregate([
          { $match: { createdAt: { $gte: startDate, $lt: endDate }, status: { $in: ['completed', 'paid'] } } },
          { $group: { _id: null, count: { $sum: 1 }, amount: { $sum: '$amount' } } }
        ])
      ]);
      
      allTimeStats = {
        totalUsers,
        totalTransactions: totalTxAgg[0]?.count || 0,
        totalRevenue: totalTxAgg[0]?.amount || 0,
        totalSharesSold: totalSharesAgg[0]?.count || 0,
        totalWithdrawals: {
          count: totalWdAgg[0]?.count || 0,
          amount: totalWdAgg[0]?.amount || 0
        }
      };
      
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
      
      const taggedTransactions = rawTransactions.map(tx => ({ ...tx, activityType: 'transaction' }));
      const taggedWithdrawals = rawWithdrawals.map(wd => ({ 
        ...wd, 
        activityType: 'withdrawal',
        userId: wd.user
      }));
      
      recentActivity = [...taggedTransactions, ...taggedWithdrawals]
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, 40);
      
      // Filtered recent users
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
        start: new Date(currentYear, currentMonth, currentDate),
        end: new Date(currentYear, currentMonth, currentDate + 1)
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
      
      // All-time stats (no filter)
      const [totalUsers, totalTxAgg, totalSharesAgg, totalWdAgg] = await Promise.all([
        User.countDocuments(),
        Transaction.aggregate([
          { $match: { status: 'completed' } },
          { $group: { _id: null, count: { $sum: 1 }, amount: { $sum: '$amount' } } }
        ]),
        UserShare.aggregate([
          { $unwind: '$transactions' },
          { $match: { 'transactions.status': 'completed' } },
          { $group: { _id: null, count: { $sum: '$transactions.shares' } } }
        ]),
        Withdrawal.aggregate([
          { $match: { status: { $in: ['completed', 'paid'] } } },
          { $group: { _id: null, count: { $sum: 1 }, amount: { $sum: '$amount' } } }
        ])
      ]);
      
      allTimeStats = {
        totalUsers,
        totalTransactions: totalTxAgg[0]?.count || 0,
        totalRevenue: totalTxAgg[0]?.amount || 0,
        totalSharesSold: totalSharesAgg[0]?.count || 0,
        totalWithdrawals: {
          count: totalWdAgg[0]?.count || 0,
          amount: totalWdAgg[0]?.amount || 0
        }
      };
      
      // Recent activity (last 40)
      const [rawTransactions, rawWithdrawals] = await Promise.all([
        Transaction.find()
          .sort({ createdAt: -1 })
          .limit(40)
          .populate('userId', 'name email userName')
          .lean(),
        Withdrawal.find({ status: { $in: ['completed', 'paid', 'pending', 'processing', 'failed', 'rejected'] } })
          .sort({ createdAt: -1 })
          .limit(40)
          .populate('user', 'name email userName')
          .lean()
      ]);
      
      const taggedTransactions = rawTransactions.map(tx => ({ ...tx, activityType: 'transaction' }));
      const taggedWithdrawals = rawWithdrawals.map(wd => ({ 
        ...wd, 
        activityType: 'withdrawal',
        userId: wd.user
      }));
      
      recentActivity = [...taggedTransactions, ...taggedWithdrawals]
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, 40);
      
      // Recent users
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
        filterApplied: filterRange ? { year, month } : null // Helpful for debugging
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