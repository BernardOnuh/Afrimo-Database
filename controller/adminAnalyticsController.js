const User = require('../models/User');
const Transaction = require('../models/Transaction');
const Withdrawal = require('../models/Withdrawal');
const UserShare = require('../models/UserShare');

exports.getOverview = async (req, res) => {
  try {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = new Date(startOfDay);
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfYear = new Date(now.getFullYear(), 0, 1);

    const buildPeriodStats = async (since) => {
      const [txAgg, newUsers, sharesAgg, wdAgg] = await Promise.all([
        Transaction.aggregate([
          { $match: { createdAt: { $gte: since }, status: 'completed' } },
          { $group: { _id: null, count: { $sum: 1 }, amount: { $sum: '$amount' } } }
        ]),
        User.countDocuments({ createdAt: { $gte: since } }),
        UserShare.aggregate([
          { $unwind: '$transactions' },
          { $match: { 'transactions.date': { $gte: since }, 'transactions.status': 'completed' } },
          { $group: { _id: null, count: { $sum: '$transactions.shares' } } }
        ]),
        Withdrawal.aggregate([
          { $match: { createdAt: { $gte: since }, status: { $in: ['completed', 'paid'] } } },
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

    const [daily, weekly, monthly, yearly, totalUsers, totalTxAgg, totalSharesAgg, totalWdAgg, recentTransactions, recentUsers] = await Promise.all([
      buildPeriodStats(startOfDay),
      buildPeriodStats(startOfWeek),
      buildPeriodStats(startOfMonth),
      buildPeriodStats(startOfYear),
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
      ]),
      Transaction.find().sort({ createdAt: -1 }).limit(20).populate('userId', 'name email userName').lean(),
      User.find().sort({ createdAt: -1 }).limit(10).select('name email userName createdAt phone').lean()
    ]);

    res.json({
      success: true,
      data: {
        daily,
        weekly,
        monthly,
        yearly,
        allTime: {
          totalUsers,
          totalTransactions: totalTxAgg[0]?.count || 0,
          totalRevenue: totalTxAgg[0]?.amount || 0,
          totalSharesSold: totalSharesAgg[0]?.count || 0,
          totalWithdrawals: { count: totalWdAgg[0]?.count || 0, amount: totalWdAgg[0]?.amount || 0 }
        },
        recentTransactions,
        recentUsers
      }
    });
  } catch (error) {
    console.error('Admin analytics overview error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch analytics', error: error.message });
  }
};
