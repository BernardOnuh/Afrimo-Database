const User = require('../models/User');
const Transaction = require('../models/Transaction');
const Withdrawal = require('../models/Withdrawal');
const UserShare = require('../models/UserShare');
const PaymentTransaction = require('../models/Transaction');

exports.getOverview = async (req, res) => {
  try {
    const { year, month } = req.query;
    const now = new Date();
    
    let startOfDay, startOfWeek, startOfMonth, startOfYear;
    
    if (year && month) {
      const y = parseInt(year), m = parseInt(month) - 1;
      startOfDay = new Date(y, m, now.getDate() <= new Date(y, m + 1, 0).getDate() ? now.getDate() : 1);
      startOfWeek = new Date(y, m, 1);
      startOfMonth = new Date(y, m, 1);
      startOfYear = new Date(y, 0, 1);
    } else if (year) {
      const y = parseInt(year);
      startOfDay = new Date(y, now.getMonth(), now.getDate());
      startOfWeek = new Date(y, 0, 1);
      startOfMonth = new Date(y, now.getMonth(), 1);
      startOfYear = new Date(y, 0, 1);
    } else {
      startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      startOfWeek = new Date(startOfDay);
      startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
      startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      startOfYear = new Date(now.getFullYear(), 0, 1);
    }

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

    const [
      daily, weekly, monthly, yearly,
      totalUsers, totalTxAgg, totalSharesAgg, totalWdAgg,
      recentTransactions, recentUsers, recentWithdrawals
    ] = await Promise.all([
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
      Transaction.find()
        .sort({ createdAt: -1 })
        .limit(20)
        .populate('userId', 'name email userName')
        .lean(),
      User.find()
        .sort({ createdAt: -1 })
        .limit(10)
        .select('name email userName createdAt phone')
        .lean(),
      // ✅ NEW: recent withdrawals (all statuses so admin sees pending too)
      Withdrawal.find({ status: { $in: ['completed', 'paid', 'pending', 'failed', 'rejected'] } })
        .sort({ createdAt: -1 })
        .limit(20)
        .populate('userId', 'name email userName')
        .lean()
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
          totalWithdrawals: {
            count: totalWdAgg[0]?.count || 0,
            amount: totalWdAgg[0]?.amount || 0
          }
        },
        recentTransactions,
        recentUsers,
        recentWithdrawals  // ✅ NEW
      }
    });
  } catch (error) {
    console.error('Admin analytics overview error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch analytics', error: error.message });
  }
};

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