// controllers/adminCompleteOverviewController.js
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const UserShare = require('../models/UserShare');
const CoFounderShare = require('../models/CoFounderShare');
const Referral = require('../models/Referral');
const ReferralTransaction = require('../models/ReferralTransaction');
const ShareListing = require('../models/Sharelisting');
const SharePurchaseOffer = require('../models/Sharepurchaseoffer');
const ShareTransferRecord = require('../models/Sharetransferrecord');
const Withdrawal = require('../models/Withdrawal');
const CryptoWallet = require('../models/CryptoWallet');
const UserWithdrawalRestriction = require('../models/UserWithdrawalRestriction');
const WithdrawalSettings = require('../models/WithdrawalSettings');
const PaymentConfig = require('../models/PaymentConfig');
const PaymentProof = require('../models/PaymentProof');
const SiteConfig = require('../models/SiteConfig');
const TierConfig = require('../models/TierConfig');
const SharePackage = require('../models/SharePackage');
const Share = require('../models/Share');
const AdminAuditLog = require('../models/AdminAuditLog');
const AdminSettings = require('../models/AdminSettings');
const Executive = require('../models/Executive');
const CoFounderInstallmentPlan = require('../models/CoFounderInstallmentPlan');
const InstallmentPlan = require('../models/InstallmentPlan');
const Payment = require('../models/Payment');
const CryptoExchangeRate = require('../models/CryptoExchangeRate');
const SharePercentageListing = require('../models/SharePercentageListing');

/**
 * ===================================================================
 * COMPLETE PROJECT OVERVIEW - AGGREGATES FROM ALL 30+ MODELS
 * ===================================================================
 * ONE ENDPOINT. EVERY MODEL. FULL VISIBILITY.
 */
exports.getCompleteProjectOverview = async (req, res) => {
  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    // ============ SECTION 1: USER MANAGEMENT ============
    const userStats = {
      total: await User.countDocuments(),
      active: await User.countDocuments({ isBanned: false, isVerified: true }),
      banned: await User.countDocuments({ isBanned: true }),
      unverified: await User.countDocuments({ isVerified: false }),
      admins: await User.countDocuments({ isAdmin: true }),
      executives: await Executive.countDocuments(),
      newLast7Days: await User.countDocuments({ createdAt: { $gte: sevenDaysAgo } }),
      newLast30Days: await User.countDocuments({ createdAt: { $gte: thirtyDaysAgo } }),
      
      // KYC Status Breakdown
      kycStatus: {
        pending: await User.countDocuments({ kycStatus: 'pending' }),
        verified: await User.countDocuments({ kycStatus: 'verified' }),
        failed: await User.countDocuments({ kycStatus: 'failed' }),
        not_started: await User.countDocuments({ kycStatus: 'not_started' })
      },
      
      // Withdrawal Restrictions
      restrictedUsers: await UserWithdrawalRestriction.countDocuments({ 
        isRestricted: true 
      }),
      
      // Recent Registrations (for dashboard feed)
      recent: await User.find()
        .sort({ createdAt: -1 })
        .limit(10)
        .select('_id userName email isAdmin isBanned kycStatus createdAt')
    };

    // ============ SECTION 2: REGULAR SHARES ============
    const siteConfig = await SiteConfig.getCurrentConfig();
    const sharePricing = siteConfig.sharePricing || {
      tier1: { shares: 2000, priceNaira: 50000, priceUSDT: 50 },
      tier2: { shares: 3000, priceNaira: 70000, priceUSDT: 70 },
      tier3: { shares: 5000, priceNaira: 80000, priceUSDT: 80 }
    };

    // Get all completed regular transactions
    const regularTransactions = await Transaction.find({
      type: 'regular',
      status: 'completed'
    });

    // Calculate shares sold per tier
    const sharesSold = { tier1: 0, tier2: 0, tier3: 0 };
    regularTransactions.forEach(tx => {
      if (tx.tierBreakdown) {
        sharesSold.tier1 += tx.tierBreakdown.tier1 || 0;
        sharesSold.tier2 += tx.tierBreakdown.tier2 || 0;
        sharesSold.tier3 += tx.tierBreakdown.tier3 || 0;
      }
    });

    // User share holdings
    const allUserShares = await UserShare.find({});
    const totalRegularSharesOwned = allUserShares.reduce((sum, u) => sum + (u.totalShares || 0), 0);
    const regularInvestorCount = allUserShares.filter(u => u.totalShares > 0).length;

    // Share packages available
    const sharePackages = await SharePackage.find({ isActive: true });

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
      packages: sharePackages,
      tierConfig: await TierConfig.find().sort({ tier: 1 }),
      
      // Sales performance
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

    // ============ SECTION 3: CO-FOUNDER SHARES ============
    const coFounderConfig = siteConfig.coFounderPricing || {
      priceNaira: 100000,
      priceUSDT: 100,
      totalShares: 1000
    };

    const coFounderTransactions = await Transaction.find({
      type: 'co-founder',
      status: 'completed'
    });

    const coFounderSharesSold = coFounderTransactions.reduce((sum, tx) => 
      sum + (tx.shares || 0), 0
    );

    const allCoFounderShares = await CoFounderShare.find({});
    const totalCoFounderSharesOwned = allCoFounderShares.reduce((sum, u) => 
      sum + (u.totalShares || 0), 0
    );

    // Installment plans
    const coFounderInstallmentPlans = await CoFounderInstallmentPlan.find({})
      .populate('userId', 'userName email');

    const activeInstallmentPlans = coFounderInstallmentPlans.filter(p => 
      p.status === 'active'
    ).length;

    const completedInstallmentPlans = coFounderInstallmentPlans.filter(p => 
      p.status === 'completed'
    ).length;

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
      
      // Installment plans
      installmentPlans: {
        total: coFounderInstallmentPlans.length,
        active: activeInstallmentPlans,
        completed: completedInstallmentPlans,
        defaulted: coFounderInstallmentPlans.filter(p => p.status === 'defaulted').length,
        pending: coFounderInstallmentPlans.filter(p => p.status === 'pending').length,
        recent: coFounderInstallmentPlans.slice(0, 5)
      }
    };

    // ============ SECTION 4: FINANCIAL OVERVIEW ============
    const allCompletedTransactions = await Transaction.find({ status: 'completed' });
    
    let revenue = {
      naira: 0,
      usdt: 0,
      byMethod: {},
      byType: { regular: 0, cofounder: 0, installment: 0 },
      byCurrency: { naira: 0, usdt: 0, usd: 0 },
      monthly: {},
      daily: {}
    };

    // Process transactions
    allCompletedTransactions.forEach(tx => {
      const currency = (tx.currency || 'naira').toLowerCase();
      const amount = tx.totalAmount || tx.amount || 0;
      const date = new Date(tx.createdAt).toISOString().split('T')[0];
      const month = new Date(tx.createdAt).toISOString().slice(0, 7);
      
      // By currency
      if (currency === 'naira' || currency === 'ngn') {
        revenue.naira += amount;
        revenue.byCurrency.naira += amount;
      } else if (currency === 'usdt' || currency === 'usd') {
        revenue.usdt += amount;
        revenue.byCurrency.usdt += amount;
      }
      
      // By payment method
      const method = tx.paymentMethod || 'unknown';
      revenue.byMethod[method] = (revenue.byMethod[method] || 0) + amount;
      
      // By type
      if (tx.type === 'co-founder') {
        revenue.byType.cofounder += amount;
      } else if (tx.type === 'installment') {
        revenue.byType.installment += amount;
      } else {
        revenue.byType.regular += amount;
      }
      
      // Monthly
      revenue.monthly[month] = (revenue.monthly[month] || 0) + amount;
      
      // Daily (last 30 days only)
      if (new Date(tx.createdAt) >= thirtyDaysAgo) {
        revenue.daily[date] = (revenue.daily[date] || 0) + amount;
      }
    });

    // Payment configurations
    const paymentConfig = await PaymentConfig.findOne({});
    
    // Payment proofs pending verification
    const pendingPaymentProofs = await PaymentProof.countDocuments({ 
      status: 'pending' 
    });

    const financials = {
      revenue,
      pendingPaymentProofs,
      paymentConfig: paymentConfig || {},
      exchangeRates: await CryptoExchangeRate.find().sort({ updatedAt: -1 }).limit(10)
    };

    // ============ SECTION 5: REFERRAL SYSTEM ============
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
      
      // Users with referrals
      usersWithReferrals: await Referral.countDocuments({ referredUsers: { $gt: 0 } }),
      
      // Top referrers
      topReferrers: await Referral.find({ totalEarnings: { $gt: 0 } })
        .sort({ totalEarnings: -1 })
        .limit(10)
        .populate('user', 'userName email')
        .select('totalEarnings generation1 generation2 generation3'),
      
      // Recent referral commissions
      recentCommissions: await ReferralTransaction.find({ status: 'completed' })
        .sort({ createdAt: -1 })
        .limit(10)
        .populate('beneficiary', 'userName')
        .populate('referredUser', 'userName')
    };

    // ============ SECTION 6: WITHDRAWAL SYSTEM ============
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
      
      settings: await WithdrawalSettings.findOne({}),
      
      restrictions: {
        total: await UserWithdrawalRestriction.countDocuments({ isRestricted: true }),
        permanent: await UserWithdrawalRestriction.countDocuments({ restrictionType: 'permanent' }),
        temporary: await UserWithdrawalRestriction.countDocuments({ restrictionType: 'temporary' })
      }
    };

    // ============ SECTION 7: MARKETPLACE & OTC ============
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
        
        // By share type
        regular: await ShareListing.countDocuments({ shareType: 'regular', status: 'active' }),
        cofounder: await ShareListing.countDocuments({ shareType: 'cofounder', status: 'active' }),
        
        // Volume
        totalSharesListed: await ShareListing.aggregate([
          { $match: { status: 'active' } },
          { $group: { _id: null, total: { $sum: '$sharesAvailable' } } }
        ]).then(r => r[0]?.total || 0),
        
        recent: await ShareListing.find({ status: 'active' })
          .sort({ createdAt: -1 })
          .limit(10)
          .populate('seller', 'userName')
      },
      
      offers: {
        total: await SharePurchaseOffer.countDocuments(),
        pending: await SharePurchaseOffer.countDocuments({ status: 'pending' }),
        accepted: await SharePurchaseOffer.countDocuments({ status: 'accepted' }),
        inPayment: await SharePurchaseOffer.countDocuments({ status: 'in_payment' }),
        completed: await SharePurchaseOffer.countDocuments({ status: 'completed' }),
        cancelled: await SharePurchaseOffer.countDocuments({ status: 'cancelled' }),
        disputed: await SharePurchaseOffer.countDocuments({ status: 'disputed' }),
        
        // Stuck transactions (no update > 48 hours)
        stuck: await SharePurchaseOffer.countDocuments({
          status: { $in: ['accepted', 'in_payment'] },
          updatedAt: { $lt: new Date(Date.now() - 48 * 60 * 60 * 1000) }
        })
      },
      
      transfers: {
        total: await ShareTransferRecord.countDocuments(),
        completed: await ShareTransferRecord.countDocuments({ status: 'completed' }),
        pending: await ShareTransferRecord.countDocuments({ status: 'pending' })
      },
      
      percentageListings: {
        total: await SharePercentageListing.countDocuments(),
        active: await SharePercentageListing.countDocuments({ status: 'active' })
      }
    };

    // Stuck transactions for admin attention
    marketplaceStats.stuckTransactions = await SharePurchaseOffer.find({
      status: { $in: ['accepted', 'in_payment'] },
      updatedAt: { $lt: new Date(Date.now() - 48 * 60 * 60 * 1000) }
    })
    .populate('buyer', 'userName email')
    .populate('seller', 'userName email')
    .limit(20);

    // ============ SECTION 8: INSTALLMENT PLANS ============
    const installmentStats = {
      regular: {
        total: await InstallmentPlan.countDocuments(),
        active: await InstallmentPlan.countDocuments({ status: 'active' }),
        completed: await InstallmentPlan.countDocuments({ status: 'completed' }),
        defaulted: await InstallmentPlan.countDocuments({ status: 'defaulted' }),
        totalValue: (await InstallmentPlan.aggregate([
          { $match: { status: { $in: ['active', 'completed'] } } },
          { $group: { _id: null, total: { $sum: '$totalAmount' } } }
        ]))[0]?.total || 0
      },
      
      cofounder: {
        total: coFounderInstallmentPlans.length,
        active: activeInstallmentPlans,
        completed: completedInstallmentPlans,
        defaulted: coFounderInstallmentPlans.filter(p => p.status === 'defaulted').length
      }
    };

    // ============ SECTION 9: ADMIN ACTIVITY ============
    const adminActivity = {
      auditLogs: {
        total: await AdminAuditLog.countDocuments(),
        last7Days: await AdminAuditLog.countDocuments({ 
          createdAt: { $gte: sevenDaysAgo } 
        }),
        byAction: await AdminAuditLog.aggregate([
          { $group: { _id: '$action', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 10 }
        ]),
        recent: await AdminAuditLog.find()
          .sort({ createdAt: -1 })
          .limit(20)
          .populate('admin', 'userName email')
          .populate('targetUser', 'userName email')
      },
      
      settings: await AdminSettings.findOne({})
    };

    // ============ SECTION 10: SYSTEM HEALTH ============
    const systemHealth = {
      status: 'HEALTHY',
      timestamp: new Date(),
      checks: {
        referralSystem: {
          status: referralStats.duplicateCommissions < 10 ? 'HEALTHY' : 'ISSUE',
          issues: referralStats.duplicateCommissions >= 10 ? 
            [`${referralStats.duplicateCommissions} duplicate commissions found`] : []
        },
        withdrawalQueue: {
          status: withdrawalStats.bank.pending < 20 ? 'HEALTHY' : 'ATTENTION',
          issues: withdrawalStats.bank.pending >= 20 ?
            [`${withdrawalStats.bank.pending} pending withdrawals`] : []
        },
        kycQueue: {
          status: userStats.kycStatus.pending < 50 ? 'HEALTHY' : 'ATTENTION',
          issues: userStats.kycStatus.pending >= 50 ?
            [`${userStats.kycStatus.pending} pending KYC verifications`] : []
        },
        marketplace: {
          status: marketplaceStats.offers.stuck < 5 ? 'HEALTHY' : 'ATTENTION',
          issues: marketplaceStats.offers.stuck >= 5 ?
            [`${marketplaceStats.offers.stuck} stuck transactions >48hrs`] : []
        },
        installmentPlans: {
          status: installmentStats.regular.defaulted < 10 ? 'HEALTHY' : 'ATTENTION',
          issues: installmentStats.regular.defaulted >= 10 ?
            [`${installmentStats.regular.defaulted} defaulted installment plans`] : []
        }
      },
      
      // Summary of all issues requiring attention
      issuesSummary: [
        ...(referralStats.duplicateCommissions >= 10 ? 
          [{ severity: 'high', module: 'referral', message: `${referralStats.duplicateCommissions} duplicate commissions` }] : []),
        ...(withdrawalStats.bank.pending >= 20 ? 
          [{ severity: 'medium', module: 'withdrawal', message: `${withdrawalStats.bank.pending} pending withdrawals` }] : []),
        ...(userStats.kycStatus.pending >= 50 ? 
          [{ severity: 'medium', module: 'kyc', message: `${userStats.kycStatus.pending} pending KYC` }] : []),
        ...(marketplaceStats.offers.stuck >= 5 ? 
          [{ severity: 'high', module: 'marketplace', message: `${marketplaceStats.offers.stuck} stuck transactions` }] : []),
        ...(installmentStats.regular.defaulted >= 10 ? 
          [{ severity: 'low', module: 'installment', message: `${installmentStats.regular.defaulted} defaulted plans` }] : [])
      ]
    };

    // ============ FINAL RESPONSE - EVERYTHING IN ONE PLACE ============
    res.status(200).json({
      success: true,
      timestamp: new Date(),
      generatedBy: req.user?.userName || 'admin',
      
      // ===== COMPLETE PROJECT SNAPSHOT =====
      overview: {
        users: userStats,
        regularShares,
        coFounderShares,
        financials,
        referral: referralStats,
        withdrawals: withdrawalStats,
        marketplace: marketplaceStats,
        installmentPlans: installmentStats,
        adminActivity,
        systemHealth
      },
      
      // ===== QUICK SUMMARY CARDS (For Dashboard UI) =====
      summary: {
        totalUsers: userStats.total,
        newUsersToday: await User.countDocuments({ 
          createdAt: { $gte: new Date().setHours(0,0,0,0) } 
        }),
        totalRevenue: `₦${revenue.naira.toLocaleString()}`,
        totalRevenueUSDT: `$${revenue.usdt.toLocaleString()}`,
        sharesSold: sharesSold.tier1 + sharesSold.tier2 + sharesSold.tier3,
        coFounderSharesSold,
        pendingWithdrawals: withdrawalStats.bank.pending,
        pendingKYCs: userStats.kycStatus.pending,
        activeListings: marketplaceStats.listings.active,
        pendingOffers: marketplaceStats.offers.pending,
        stuckTransactions: marketplaceStats.offers.stuck,
        pendingCommissions: referralStats.pendingCommissions,
        activeInstallments: installmentStats.regular.active + installmentStats.cofounder.active
      }
    });

  } catch (error) {
    console.error('COMPLETE OVERVIEW ERROR:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate complete project overview',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
      timestamp: new Date()
    });
  }
};

/**
 * ===================================================================
 * COMPLETE USER ACTIVITY - ALL MODELS FOR A SINGLE USER
 * ===================================================================
 */
exports.getCompleteUserOverview = async (req, res) => {
  try {
    const { userId } = req.params;
    
    const user = await User.findById(userId).select('-password');
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // 1. User Profile & Status
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

    // 2. Share Holdings
    const userShares = await UserShare.findOne({ user: userId });
    const coFounderShares = await CoFounderShare.findOne({ user: userId });

    // 3. All Transactions
    const transactions = await Transaction.find({ userId })
      .sort({ createdAt: -1 })
      .limit(100);

    const regularTransactions = transactions.filter(t => t.type !== 'co-founder');
    const coFounderTransactions = transactions.filter(t => t.type === 'co-founder');

    // 4. Referral Network
    const referrer = user.referralInfo?.code 
      ? await User.findOne({ userName: user.referralInfo.code }).select('userName email')
      : null;

    const referralStats = await Referral.findOne({ user: userId });
    
    const commissionsEarned = await ReferralTransaction.find({ 
      beneficiary: userId,
      status: 'completed'
    }).populate('referredUser', 'userName email');

    const commissionsGenerated = await ReferralTransaction.find({ 
      referredUser: userId 
    }).populate('beneficiary', 'userName email');

    // Downline (people they referred)
    const referredUsers = await User.find({ 
      'referralInfo.code': user.userName 
    }).select('_id userName email createdAt isVerified isBanned');

    // Generation 2
    let generation2 = [];
    if (referredUsers.length > 0) {
      const gen1Usernames = referredUsers.map(u => u.userName);
      generation2 = await User.find({ 
        'referralInfo.code': { $in: gen1Usernames } 
      }).select('_id userName email createdAt isVerified isBanned');
    }

    // Generation 3
    let generation3 = [];
    if (generation2.length > 0) {
      const gen2Usernames = generation2.map(u => u.userName);
      generation3 = await User.find({ 
        'referralInfo.code': { $in: gen2Usernames } 
      }).select('_id userName email createdAt isVerified isBanned');
    }

    // 5. Withdrawals
    const withdrawals = await Withdrawal.find({ user: userId }).sort({ createdAt: -1 });
    const cryptoWallets = await CryptoWallet.find({ user: userId });
    const withdrawalRestrictions = await UserWithdrawalRestriction.findOne({ user: userId });

    // 6. Payment Proofs
    const paymentProofs = await PaymentProof.find({ userId })
      .sort({ createdAt: -1 });

    // 7. Marketplace Activity
    const listings = await ShareListing.find({ seller: userId })
      .sort({ createdAt: -1 });

    const offersAsBuyer = await SharePurchaseOffer.find({ buyer: userId })
      .populate('seller', 'userName email')
      .sort({ createdAt: -1 });

    const offersAsSeller = await SharePurchaseOffer.find({ seller: userId })
      .populate('buyer', 'userName email')
      .sort({ createdAt: -1 });

    const transfers = await ShareTransferRecord.find({
      $or: [{ fromUser: userId }, { toUser: userId }]
    }).sort({ createdAt: -1 });

    // 8. Installment Plans
    const installmentPlans = await InstallmentPlan.find({ userId })
      .sort({ createdAt: -1 });

    const coFounderInstallmentPlans = await CoFounderInstallmentPlan.find({ userId })
      .sort({ createdAt: -1 });

    // 9. Payments Made
    const payments = await Payment.find({ userId })
      .sort({ createdAt: -1 });

    // 10. Admin Audit Log (if user was ever targeted)
    const adminAuditLogs = await AdminAuditLog.find({ targetUser: userId })
      .populate('admin', 'userName email')
      .sort({ createdAt: -1 })
      .limit(50);

    // ===== COMPLETE USER RESPONSE =====
    res.status(200).json({
      success: true,
      user: {
        profile,
        holdings: {
          regular: {
            totalShares: userShares?.totalShares || 0,
            transactions: userShares?.transactions?.length || 0,
            details: userShares?.transactions?.slice(-10) || []
          },
          coFounder: {
            totalShares: coFounderShares?.totalShares || 0,
            isCoFounder: (coFounderShares?.totalShares || 0) > 0,
            details: coFounderShares || null
          },
          totalCombined: (userShares?.totalShares || 0) + (coFounderShares?.totalShares || 0)
        },
        
        transactions: {
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
        },
        
        referral: {
          referrer: referrer ? {
            id: referrer._id,
            userName: referrer.userName,
            email: referrer.email
          } : null,
          
          stats: referralStats || {
            totalEarnings: 0,
            referredUsers: 0,
            generation1: { count: 0, earnings: 0 },
            generation2: { count: 0, earnings: 0 },
            generation3: { count: 0, earnings: 0 }
          },
          
          downline: {
            generation1: referredUsers.map(u => ({
              id: u._id,
              userName: u.userName,
              email: u.email,
              verified: u.isVerified,
              banned: u.isBanned,
              joined: u.createdAt
            })),
            generation2: generation2.map(u => ({
              id: u._id,
              userName: u.userName,
              email: u.email,
              verified: u.isVerified,
              banned: u.isBanned,
              joined: u.createdAt
            })),
            generation3: generation3.map(u => ({
              id: u._id,
              userName: u.userName,
              email: u.email,
              verified: u.isVerified,
              banned: u.isBanned,
              joined: u.createdAt
            })),
            totals: {
              gen1: referredUsers.length,
              gen2: generation2.length,
              gen3: generation3.length,
              all: referredUsers.length + generation2.length + generation3.length
            }
          },
          
          commissions: {
            earned: commissionsEarned.map(c => ({
              id: c._id,
              amount: c.amount,
              currency: c.currency,
              generation: c.generation,
              from: c.referredUser?.userName || 'Unknown',
              purchaseType: c.purchaseType,
              date: c.createdAt
            })),
            generated: commissionsGenerated.map(c => ({
              id: c._id,
              amount: c.amount,
              currency: c.currency,
              generation: c.generation,
              to: c.beneficiary?.userName || 'Unknown',
              purchaseType: c.purchaseType,
              date: c.createdAt
            }))
          }
        },
        
        withdrawals: {
          bank: {
            total: withdrawals.length,
            completed: withdrawals.filter(w => w.status === 'completed').length,
            pending: withdrawals.filter(w => ['pending', 'processing'].includes(w.status)).length,
            totalAmount: withdrawals
              .filter(w => w.status === 'completed')
              .reduce((sum, w) => sum + (w.amount || 0), 0),
            history: withdrawals.slice(0, 20)
          },
          crypto: {
            wallets: cryptoWallets,
            hasVerifiedWallet: cryptoWallets.some(w => w.isVerified)
          },
          restrictions: withdrawalRestrictions || null,
          availableBalance: referralStats?.totalEarnings || 0
        },
        
        paymentProofs: paymentProofs.map(p => ({
          id: p._id,
          transactionId: p.transactionId,
          url: p.url,
          status: p.status,
          createdAt: p.createdAt,
          verifiedAt: p.verifiedAt
        })),
        
        marketplace: {
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
          },
          transfers: transfers.slice(0, 20)
        },
        
        installmentPlans: {
          regular: installmentPlans,
          coFounder: coFounderInstallmentPlans,
          totalActive: [...installmentPlans, ...coFounderInstallmentPlans]
            .filter(p => p.status === 'active').length,
          totalCompleted: [...installmentPlans, ...coFounderInstallmentPlans]
            .filter(p => p.status === 'completed').length
        },
        
        payments: payments.slice(0, 50),
        
        adminAudit: adminAuditLogs,
        
        // Quick summary for dashboard cards
        summary: {
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
        }
      }
    });

  } catch (error) {
    console.error('USER OVERVIEW ERROR:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get complete user overview',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};