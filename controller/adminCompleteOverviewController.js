// controller/adminCompleteOverviewController.js
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const UserShare = require('../models/UserShare');
const CoFounderShare = require('../models/CoFounderShare');
const Referral = require('../models/Referral');
const ReferralTransaction = require('../models/ReferralTransaction');
const ShareListing = require('../models/Sharelisting');
const SharePurchaseOffer = require('../models/Sharepurchaseoffer');
const Withdrawal = require('../models/Withdrawal');
const CryptoWallet = require('../models/CryptoWallet');
const UserWithdrawalRestriction = require('../models/UserWithdrawalRestriction');
const PaymentProof = require('../models/PaymentProof');
const SiteConfig = require('../models/SiteConfig');
const CoFounderInstallmentPlan = require('../models/CoFounderInstallmentPlan');
const InstallmentPlan = require('../models/InstallmentPlan');
const AdminAuditLog = require('../models/AdminAuditLog');

// ===================================================================
// COMPLETE PROJECT OVERVIEW
// ===================================================================
exports.getCompleteProjectOverview = async (req, res) => {
  try {
    console.log('🚀 Generating complete project overview...');
    
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // ============ USERS ============
    const userStats = {
      total: await User.countDocuments(),
      active: await User.countDocuments({ isBanned: false, isVerified: true }),
      banned: await User.countDocuments({ isBanned: true }),
      unverified: await User.countDocuments({ isVerified: false }),
      admins: await User.countDocuments({ isAdmin: true }),
      executives: 0, // Executive model not imported
      newLast7Days: await User.countDocuments({ createdAt: { $gte: sevenDaysAgo } }),
      newLast30Days: await User.countDocuments({ createdAt: { $gte: thirtyDaysAgo } }),
      newUsersToday: await User.countDocuments({ createdAt: { $gte: today } }),
      restrictedUsers: await UserWithdrawalRestriction.countDocuments({ isRestricted: true }),
      
      kycStatus: {
        pending: await User.countDocuments({ kycStatus: 'pending' }),
        verified: await User.countDocuments({ kycStatus: 'verified' }),
        failed: await User.countDocuments({ kycStatus: 'failed' }),
        not_started: await User.countDocuments({ kycStatus: 'not_started' })
      },
      
      kyc: {
        activeLinks: 0, // KYCLink model doesn't exist
        completionRate: await (async () => {
          const total = await User.countDocuments();
          const verified = await User.countDocuments({ kycStatus: 'verified' });
          return total > 0 ? ((verified / total) * 100).toFixed(1) : 0;
        })()
      }
    };

    // ============ SITE CONFIG ============
    let siteConfig;
    try {
      siteConfig = await SiteConfig.getCurrentConfig();
    } catch (error) {
      console.log('SiteConfig error:', error.message);
      siteConfig = {
        sharePricing: {
          tier1: { shares: 2000, priceNaira: 50000, priceUSDT: 50 },
          tier2: { shares: 3000, priceNaira: 70000, priceUSDT: 70 },
          tier3: { shares: 5000, priceNaira: 80000, priceUSDT: 80 }
        },
        coFounderPricing: {
          priceNaira: 100000,
          priceUSDT: 100,
          totalShares: 1000
        },
        referralCommission: {
          generation1: 15,
          generation2: 3,
          generation3: 2
        }
      };
    }

    // ============ REGULAR SHARES ============
    const sharePricing = siteConfig.sharePricing || {
      tier1: { shares: 2000, priceNaira: 50000, priceUSDT: 50 },
      tier2: { shares: 3000, priceNaira: 70000, priceUSDT: 70 },
      tier3: { shares: 5000, priceNaira: 80000, priceUSDT: 80 }
    };

    const regularTransactions = await Transaction.find({
      type: 'regular',
      status: 'completed'
    });

    const sharesSold = { tier1: 0, tier2: 0, tier3: 0 };
    regularTransactions.forEach(tx => {
      if (tx.tierBreakdown) {
        sharesSold.tier1 += tx.tierBreakdown.tier1 || 0;
        sharesSold.tier2 += tx.tierBreakdown.tier2 || 0;
        sharesSold.tier3 += tx.tierBreakdown.tier3 || 0;
      } else {
        sharesSold.tier1 += tx.shares || 0;
      }
    });

    const allUserShares = await UserShare.find({});
    const totalRegularSharesOwned = allUserShares.reduce((sum, u) => sum + (u.totalShares || 0), 0);
    const regularInvestorCount = allUserShares.filter(u => u.totalShares > 0).length;

    const regularShares = {
      pricing: sharePricing,
      sold: sharesSold,
      available: {
        tier1: Math.max(0, sharePricing.tier1.shares - sharesSold.tier1),
        tier2: Math.max(0, sharePricing.tier2.shares - sharesSold.tier2),
        tier3: Math.max(0, sharePricing.tier3.shares - sharesSold.tier3)
      },
      totalOwned: totalRegularSharesOwned,
      investors: regularInvestorCount,
      packages: [], // SharePackage model not imported
      
      salesPerformance: {
        tier1: {
          sold: sharesSold.tier1,
          total: sharePricing.tier1.shares,
          percentage: ((sharesSold.tier1 / sharePricing.tier1.shares) * 100).toFixed(1)
        },
        tier2: {
          sold: sharesSold.tier2,
          total: sharePricing.tier2.shares,
          percentage: ((sharesSold.tier2 / sharePricing.tier2.shares) * 100).toFixed(1)
        },
        tier3: {
          sold: sharesSold.tier3,
          total: sharePricing.tier3.shares,
          percentage: ((sharesSold.tier3 / sharePricing.tier3.shares) * 100).toFixed(1)
        }
      }
    };

    // ============ CO-FOUNDER SHARES ============
    const coFounderConfig = siteConfig.coFounderPricing || {
      priceNaira: 100000,
      priceUSDT: 100,
      totalShares: 1000
    };

    const coFounderTransactions = await Transaction.find({
      type: 'co-founder',
      status: 'completed'
    });

    const coFounderSharesSold = coFounderTransactions.reduce((sum, tx) => sum + (tx.shares || 0), 0);
    
    const allCoFounderShares = await CoFounderShare.find({});
    const totalCoFounderSharesOwned = allCoFounderShares.reduce((sum, u) => sum + (u.totalShares || 0), 0);
    
    const coFounderInstallmentPlans = await CoFounderInstallmentPlan.find({});

    const coFounderShares = {
      pricing: {
        naira: coFounderConfig.priceNaira,
        usdt: coFounderConfig.priceUSDT
      },
      totalShares: coFounderConfig.totalShares || 1000,
      sold: coFounderSharesSold,
      remaining: Math.max(0, (coFounderConfig.totalShares || 1000) - coFounderSharesSold),
      totalOwned: totalCoFounderSharesOwned,
      investors: await CoFounderShare.countDocuments({ totalShares: { $gt: 0 } }),
      soldPercentage: ((coFounderSharesSold / (coFounderConfig.totalShares || 1000)) * 100).toFixed(1),
      
      installmentPlans: {
        total: coFounderInstallmentPlans.length,
        active: coFounderInstallmentPlans.filter(p => p.status === 'active').length,
        completed: coFounderInstallmentPlans.filter(p => p.status === 'completed').length,
        defaulted: coFounderInstallmentPlans.filter(p => p.status === 'defaulted').length,
        pending: coFounderInstallmentPlans.filter(p => p.status === 'pending').length
      }
    };

    // ============ FINANCIALS ============
    const allCompletedTransactions = await Transaction.find({ status: 'completed' });
    
    let revenue = {
      naira: 0,
      usdt: 0,
      byMethod: {},
      byType: { regular: 0, cofounder: 0, installment: 0 },
      byCurrency: { naira: 0, usdt: 0 },
      monthly: {},
      daily: {}
    };

    allCompletedTransactions.forEach(tx => {
      const currency = (tx.currency || 'naira').toLowerCase();
      const amount = tx.totalAmount || tx.amount || 0;
      const date = new Date(tx.createdAt).toISOString().split('T')[0];
      const month = new Date(tx.createdAt).toISOString().slice(0, 7);
      
      if (currency === 'naira' || currency === 'ngn') {
        revenue.naira += amount;
        revenue.byCurrency.naira += amount;
      } else if (currency === 'usdt' || currency === 'usd') {
        revenue.usdt += amount;
        revenue.byCurrency.usdt += amount;
      }
      
      const method = tx.paymentMethod || 'unknown';
      revenue.byMethod[method] = (revenue.byMethod[method] || 0) + amount;
      
      if (tx.type === 'co-founder') {
        revenue.byType.cofounder += amount;
      } else if (tx.type === 'installment') {
        revenue.byType.installment += amount;
      } else {
        revenue.byType.regular += amount;
      }
      
      revenue.monthly[month] = (revenue.monthly[month] || 0) + amount;
      
      if (new Date(tx.createdAt) >= thirtyDaysAgo) {
        revenue.daily[date] = (revenue.daily[date] || 0) + amount;
      }
    });

    const financials = {
      revenue,
      pendingPaymentProofs: await PaymentProof.countDocuments({ status: 'pending' }),
      exchangeRates: [] // CryptoExchangeRate model not imported
    };

    // ============ WITHDRAWALS ============
    const withdrawalStats = {
      bank: {
        total: await Withdrawal.countDocuments(),
        pending: await Withdrawal.countDocuments({ status: 'pending' }),
        processing: await Withdrawal.countDocuments({ status: 'processing' }),
        completed: await Withdrawal.countDocuments({ status: 'completed' }),
        failed: await Withdrawal.countDocuments({ status: 'failed' }),
        cancelled: await Withdrawal.countDocuments({ status: 'cancelled' }),
        totalAmount: (await Withdrawal.aggregate([
          { $match: { status: 'completed' } },
          { $group: { _id: null, total: { $sum: '$amount' } } }
        ]))[0]?.total || 0
      },
      crypto: {
        totalWallets: await CryptoWallet.countDocuments(),
        verifiedWallets: await CryptoWallet.countDocuments({ isVerified: true }),
        pendingWithdrawals: await Withdrawal.countDocuments({ 
          paymentMethod: 'crypto',
          status: { $in: ['pending', 'processing'] }
        })
      },
      restrictions: {
        total: await UserWithdrawalRestriction.countDocuments({ isRestricted: true }),
        permanent: await UserWithdrawalRestriction.countDocuments({ restrictionType: 'permanent' }),
        temporary: await UserWithdrawalRestriction.countDocuments({ restrictionType: 'temporary' })
      }
    };

    // ============ REFERRALS ============
    const totalReferralEarnings = await ReferralTransaction.aggregate([
      { $match: { status: 'completed' } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);

    const referralStats = {
      totalEarnings: totalReferralEarnings[0]?.total || 0,
      totalTransactions: await ReferralTransaction.countDocuments(),
      pendingCommissions: await ReferralTransaction.countDocuments({ status: 'pending' }),
      completedCommissions: await ReferralTransaction.countDocuments({ status: 'completed' }),
      duplicateCommissions: await ReferralTransaction.countDocuments({ status: 'duplicate' }),
      rolledBack: await ReferralTransaction.countDocuments({ status: 'rolled_back' }),
      
      commissionRates: siteConfig.referralCommission || {
        generation1: 15,
        generation2: 3,
        generation3: 2
      },
      
      usersWithReferrals: await Referral.countDocuments({ referredUsers: { $gt: 0 } }),
      
      topReferrers: await Referral.find({ totalEarnings: { $gt: 0 } })
        .sort({ totalEarnings: -1 })
        .limit(10)
        .lean(),
      
      recentCommissions: await ReferralTransaction.find({ status: 'completed' })
        .sort({ createdAt: -1 })
        .limit(10)
        .lean()
    };

    // ============ MARKETPLACE ============
    const marketplaceStats = {
      listings: {
        total: await ShareListing.countDocuments(),
        active: await ShareListing.countDocuments({ 
          status: 'active',
          expiresAt: { $gt: new Date() },
          sharesAvailable: { $gt: 0 }
        }),
        sold: await ShareListing.countDocuments({ status: 'sold' }),
        cancelled: await ShareListing.countDocuments({ status: 'cancelled' }),
        expired: await ShareListing.countDocuments({ status: 'expired' }),
        regular: await ShareListing.countDocuments({ shareType: 'regular', status: 'active' }),
        cofounder: await ShareListing.countDocuments({ shareType: 'cofounder', status: 'active' }),
        totalSharesListed: (await ShareListing.aggregate([
          { $match: { status: 'active', sharesAvailable: { $gt: 0 } } },
          { $group: { _id: null, total: { $sum: '$sharesAvailable' } } }
        ]))[0]?.total || 0
      },
      offers: {
        total: await SharePurchaseOffer.countDocuments(),
        pending: await SharePurchaseOffer.countDocuments({ status: 'pending' }),
        accepted: await SharePurchaseOffer.countDocuments({ status: 'accepted' }),
        inPayment: await SharePurchaseOffer.countDocuments({ status: 'in_payment' }),
        completed: await SharePurchaseOffer.countDocuments({ status: 'completed' }),
        cancelled: await SharePurchaseOffer.countDocuments({ status: 'cancelled' }),
        disputed: await SharePurchaseOffer.countDocuments({ status: 'disputed' }),
        stuck: await SharePurchaseOffer.countDocuments({
          status: { $in: ['accepted', 'in_payment'] },
          updatedAt: { $lt: new Date(Date.now() - 48 * 60 * 60 * 1000) }
        })
      },
      transfers: {
        total: 0, // ShareTransferRecord model not imported
        completed: 0,
        pending: 0
      },
      stuckTransactions: await SharePurchaseOffer.find({
        status: { $in: ['accepted', 'in_payment'] },
        updatedAt: { $lt: new Date(Date.now() - 48 * 60 * 60 * 1000) }
      }).limit(10)
    };

    // ============ INSTALLMENTS ============
    const regularInstallmentPlans = await InstallmentPlan.find({});
    
    const installmentStats = {
      regular: {
        total: regularInstallmentPlans.length,
        active: regularInstallmentPlans.filter(p => p.status === 'active').length,
        completed: regularInstallmentPlans.filter(p => p.status === 'completed').length,
        defaulted: regularInstallmentPlans.filter(p => p.status === 'defaulted').length,
        totalValue: (await InstallmentPlan.aggregate([
          { $match: { status: { $in: ['active', 'completed'] } } },
          { $group: { _id: null, total: { $sum: '$totalAmount' } } }
        ]))[0]?.total || 0
      },
      cofounder: {
        total: coFounderInstallmentPlans.length,
        active: coFounderInstallmentPlans.filter(p => p.status === 'active').length,
        completed: coFounderInstallmentPlans.filter(p => p.status === 'completed').length,
        defaulted: coFounderInstallmentPlans.filter(p => p.status === 'defaulted').length
      }
    };

    // ============ RECENT ACTIVITY ============
    const recentActivity = {
      users: await User.find()
        .sort({ createdAt: -1 })
        .limit(10)
        .select('_id userName email isAdmin isBanned kycStatus createdAt'),
      
      transactions: await Transaction.find()
        .sort({ createdAt: -1 })
        .limit(10)
        .select('transactionId type shares totalAmount amount currency paymentMethod status createdAt'),
      
      referrals: await ReferralTransaction.find({ status: 'completed' })
        .sort({ createdAt: -1 })
        .limit(10)
        .lean(),
      
      withdrawals: await Withdrawal.find()
        .sort({ createdAt: -1 })
        .limit(10)
        .lean(),
      
      marketplace: await SharePurchaseOffer.find()
        .sort({ createdAt: -1 })
        .limit(10)
        .lean()
    };

    // ============ ADMIN ACTIVITY ============
    const adminActivity = {
      auditLogs: {
        total: await AdminAuditLog.countDocuments(),
        last7Days: await AdminAuditLog.countDocuments({ createdAt: { $gte: sevenDaysAgo } }),
        byAction: await AdminAuditLog.aggregate([
          { $group: { _id: '$action', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 10 }
        ]),
        recent: await AdminAuditLog.find()
          .sort({ createdAt: -1 })
          .limit(20)
          .lean()
      }
    };

    // ============ SYSTEM HEALTH ============
    const issuesSummary = [];
    
    if (referralStats.duplicateCommissions >= 10) {
      issuesSummary.push({ severity: 'high', module: 'referral', message: `${referralStats.duplicateCommissions} duplicate commissions found` });
    }
    if (withdrawalStats.bank.pending >= 20) {
      issuesSummary.push({ severity: 'medium', module: 'withdrawal', message: `${withdrawalStats.bank.pending} pending withdrawals` });
    }
    if (userStats.kycStatus.pending >= 50) {
      issuesSummary.push({ severity: 'medium', module: 'kyc', message: `${userStats.kycStatus.pending} pending KYC verifications` });
    }
    if (marketplaceStats.offers.stuck >= 5) {
      issuesSummary.push({ severity: 'high', module: 'marketplace', message: `${marketplaceStats.offers.stuck} stuck transactions >48hrs` });
    }
    if (installmentStats.regular.defaulted >= 10) {
      issuesSummary.push({ severity: 'low', module: 'installment', message: `${installmentStats.regular.defaulted} defaulted installment plans` });
    }

    const systemHealth = {
      status: issuesSummary.length === 0 ? 'HEALTHY' : 'ATTENTION_NEEDED',
      issuesSummary,
      checks: {
        referralSystem: {
          status: referralStats.duplicateCommissions < 10 ? 'HEALTHY' : 'ISSUE',
          issues: referralStats.duplicateCommissions >= 10 ? [`${referralStats.duplicateCommissions} duplicate commissions`] : []
        },
        withdrawalQueue: {
          status: withdrawalStats.bank.pending < 20 ? 'HEALTHY' : 'ATTENTION',
          issues: withdrawalStats.bank.pending >= 20 ? [`${withdrawalStats.bank.pending} pending withdrawals`] : []
        },
        kycQueue: {
          status: userStats.kycStatus.pending < 50 ? 'HEALTHY' : 'ATTENTION',
          issues: userStats.kycStatus.pending >= 50 ? [`${userStats.kycStatus.pending} pending KYC`] : []
        },
        marketplace: {
          status: marketplaceStats.offers.stuck < 5 ? 'HEALTHY' : 'ATTENTION',
          issues: marketplaceStats.offers.stuck >= 5 ? [`${marketplaceStats.offers.stuck} stuck transactions`] : []
        }
      }
    };

    // ============ QUICK SUMMARY CARDS ============
    const summary = {
      totalUsers: userStats.total,
      newUsersToday: userStats.newUsersToday,
      totalRevenue: `₦${revenue.naira.toLocaleString()}`,
      totalRevenueUSDT: `$${revenue.usdt.toLocaleString()}`,
      sharesSold: sharesSold.tier1 + sharesSold.tier2 + sharesSold.tier3,
      coFounderSharesSold: coFounderSharesSold,
      pendingWithdrawals: withdrawalStats.bank.pending,
      pendingKYCs: userStats.kycStatus.pending,
      activeListings: marketplaceStats.listings.active,
      pendingOffers: marketplaceStats.offers.pending,
      stuckTransactions: marketplaceStats.offers.stuck,
      pendingCommissions: referralStats.pendingCommissions,
      activeInstallments: installmentStats.regular.active + installmentStats.cofounder.active
    };

    // ============ FINAL RESPONSE ============
    res.status(200).json({
      success: true,
      timestamp: new Date(),
      overview: {
        users: userStats,
        regularShares,
        coFounderShares,
        financials,
        withdrawals: withdrawalStats,
        referral: referralStats,
        marketplace: marketplaceStats,
        installmentPlans: installmentStats,
        adminActivity,
        systemHealth,
        recentActivity
      },
      summary
    });

  } catch (error) {
    console.error('❌ COMPLETE OVERVIEW ERROR:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate complete project overview',
      error: error.message,
      timestamp: new Date()
    });
  }
};

// ===================================================================
// COMPLETE USER OVERVIEW
// ===================================================================
exports.getCompleteUserOverview = async (req, res) => {
  try {
    const { userId } = req.params;
    
    const user = await User.findById(userId).select('-password -resetPasswordToken -resetPasswordExpire');
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Profile
    const profile = {
      id: user._id,
      userName: user.userName,
      email: user.email,
      name: user.name,
      phoneNumber: user.phoneNumber,
      walletAddress: user.walletAddress,
      isAdmin: user.isAdmin,
      isBanned: user.isBanned,
      isVerified: user.isVerified,
      kycStatus: user.kycStatus,
      referralCode: user.referralInfo?.code,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      accountAge: Math.floor((Date.now() - new Date(user.createdAt)) / (1000 * 60 * 60 * 24)) + ' days'
    };

    // Holdings
    const userShares = await UserShare.findOne({ user: userId });
    const coFounderShares = await CoFounderShare.findOne({ user: userId });

    const holdings = {
      regular: {
        totalShares: userShares?.totalShares || 0,
        transactions: userShares?.transactions?.length || 0
      },
      coFounder: {
        totalShares: coFounderShares?.totalShares || 0,
        isCoFounder: (coFounderShares?.totalShares || 0) > 0
      }
    };

    // Transactions
    const transactions = await Transaction.find({ userId })
      .sort({ createdAt: -1 })
      .limit(100);

    const regularTransactions = transactions.filter(t => t.type !== 'co-founder');
    const coFounderTransactions = transactions.filter(t => t.type === 'co-founder');

    const transactionSummary = {
      total: transactions.length,
      regular: {
        count: regularTransactions.length,
        totalShares: regularTransactions.reduce((sum, t) => sum + (t.shares || 0), 0),
        totalAmount: regularTransactions.reduce((sum, t) => sum + (t.totalAmount || t.amount || 0), 0),
        recent: regularTransactions.slice(0, 20)
      },
      coFounder: {
        count: coFounderTransactions.length,
        totalShares: coFounderTransactions.reduce((sum, t) => sum + (t.shares || 0), 0),
        totalAmount: coFounderTransactions.reduce((sum, t) => sum + (t.totalAmount || t.amount || 0), 0),
        recent: coFounderTransactions.slice(0, 20)
      }
    };

    // Referral
    const referrer = user.referralInfo?.code 
      ? await User.findOne({ userName: user.referralInfo.code }).select('userName email')
      : null;

    const referralStats = await Referral.findOne({ user: userId });
    
    const commissionsEarned = await ReferralTransaction.find({ 
      beneficiary: userId,
      status: 'completed'
    }).lean();

    const commissionsGenerated = await ReferralTransaction.find({ 
      referredUser: userId 
    }).lean();

    const referredUsers = await User.find({ 
      'referralInfo.code': user.userName 
    }).select('_id userName email createdAt isVerified isBanned');

    // Generation 2 & 3
    let generation2 = [], generation3 = [];
    if (referredUsers.length > 0) {
      const gen1Usernames = referredUsers.map(u => u.userName);
      generation2 = await User.find({ 
        'referralInfo.code': { $in: gen1Usernames } 
      }).select('_id userName email createdAt isVerified isBanned');
    }
    if (generation2.length > 0) {
      const gen2Usernames = generation2.map(u => u.userName);
      generation3 = await User.find({ 
        'referralInfo.code': { $in: gen2Usernames } 
      }).select('_id userName email createdAt isVerified isBanned');
    }

    const referral = {
      referrer,
      stats: referralStats || {
        totalEarnings: 0,
        generation1: { count: 0, earnings: 0 },
        generation2: { count: 0, earnings: 0 },
        generation3: { count: 0, earnings: 0 }
      },
      downline: {
        totals: {
          gen1: referredUsers.length,
          gen2: generation2.length,
          gen3: generation3.length,
          all: referredUsers.length + generation2.length + generation3.length
        },
        generation1: referredUsers,
        generation2,
        generation3
      },
      commissions: {
        earned: commissionsEarned,
        generated: commissionsGenerated
      }
    };

    // Withdrawals
    const withdrawals = await Withdrawal.find({ user: userId }).sort({ createdAt: -1 });
    const cryptoWallets = await CryptoWallet.find({ user: userId });
    const withdrawalRestrictions = await UserWithdrawalRestriction.findOne({ user: userId });

    const withdrawalSummary = {
      bank: {
        total: withdrawals.length,
        completed: withdrawals.filter(w => w.status === 'completed').length,
        pending: withdrawals.filter(w => ['pending', 'processing'].includes(w.status)).length,
        totalAmount: withdrawals.filter(w => w.status === 'completed').reduce((sum, w) => sum + (w.amount || 0), 0),
        history: withdrawals.slice(0, 20)
      },
      crypto: {
        wallets: cryptoWallets,
        hasVerifiedWallet: cryptoWallets.some(w => w.isVerified)
      },
      restrictions: withdrawalRestrictions,
      availableBalance: referralStats?.totalEarnings || 0
    };

    // KYC
    const kyc = {
      status: user.kycStatus || 'not_started',
      links: [],
      activeLink: null
    };

    // Marketplace
    const listings = await ShareListing.find({ seller: userId }).sort({ createdAt: -1 });
    const offersAsBuyer = await SharePurchaseOffer.find({ buyer: userId })
      .sort({ createdAt: -1 });
    const offersAsSeller = await SharePurchaseOffer.find({ seller: userId })
      .sort({ createdAt: -1 });

    const marketplace = {
      listings: {
        total: listings.length,
        active: listings.filter(l => l.status === 'active' && l.sharesAvailable > 0).length,
        history: listings.slice(0, 20)
      },
      offers: {
        asBuyer: {
          total: offersAsBuyer.length,
          pending: offersAsBuyer.filter(o => ['pending', 'accepted', 'in_payment'].includes(o.status)).length,
          completed: offersAsBuyer.filter(o => o.status === 'completed').length,
          history: offersAsBuyer.slice(0, 20)
        },
        asSeller: {
          total: offersAsSeller.length,
          pending: offersAsSeller.filter(o => ['pending', 'accepted', 'in_payment'].includes(o.status)).length,
          completed: offersAsSeller.filter(o => o.status === 'completed').length,
          history: offersAsSeller.slice(0, 20)
        }
      }
    };

    // Payments
    const payments = await PaymentProof.find({ userId }).sort({ createdAt: -1 }).limit(50);

    // Installment Plans
    const installmentPlans = await InstallmentPlan.find({ userId }).sort({ createdAt: -1 });
    const coFounderInstallmentPlans = await CoFounderInstallmentPlan.find({ userId }).sort({ createdAt: -1 });

    // Admin Audit
    const adminAuditLogs = await AdminAuditLog.find({ targetUser: userId })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    // Summary
    const summary = {
      totalShares: (userShares?.totalShares || 0) + (coFounderShares?.totalShares || 0),
      totalSpent: regularTransactions.reduce((sum, t) => sum + (t.totalAmount || t.amount || 0), 0) +
                  coFounderTransactions.reduce((sum, t) => sum + (t.totalAmount || t.amount || 0), 0),
      referralEarnings: referralStats?.totalEarnings || 0,
      pendingWithdrawals: withdrawals.filter(w => ['pending', 'processing'].includes(w.status)).length,
      activeListings: listings.filter(l => l.status === 'active' && l.sharesAvailable > 0).length,
      pendingOffers: offersAsBuyer.filter(o => ['pending', 'accepted', 'in_payment'].includes(o.status)).length +
                    offersAsSeller.filter(o => ['pending', 'accepted', 'in_payment'].includes(o.status)).length,
      joinedDate: user.createdAt,
      lastActive: user.updatedAt
    };

    res.status(200).json({
      success: true,
      user: {
        profile,
        holdings,
        transactions: transactionSummary,
        referral,
        withdrawals: withdrawalSummary,
        kyc,
        marketplace,
        payments: payments.slice(0, 20),
        installmentPlans: {
          regular: installmentPlans,
          coFounder: coFounderInstallmentPlans
        },
        adminAudit: adminAuditLogs,
        summary
      }
    });

  } catch (error) {
    console.error('❌ USER OVERVIEW ERROR:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate user overview',
      error: error.message
    });
  }
};