const express = require('express'); 
const router = express.Router(); 
const referralController = require('../controller/referralController'); 
const { protect, adminProtect } = require('../middleware/auth');  

// Import the new audit utilities
const { 
  runAuditEndpoint, 
  quickFixCriticalIssues, 
  checkUserReferralStatus 
} = require('../runReferralAudit');

const {
  quickScan,
  quickFix,
  checkSpecificUser
} = require('../immediateReferralFix');

// =========================
// EXISTING USER ROUTES
// =========================

// Get referral code (username) and stats
router.get('/stats', protect, referralController.getReferralStats);

// Get referral tree (people you've referred)
router.get('/tree', protect, referralController.getReferralTree);

// Get referral earnings (for self)
router.get('/earnings', protect, referralController.getReferralEarnings);

// Generate custom invite link
router.post('/generate-invite', protect, referralController.generateCustomInviteLink);

// Validate invite link
router.get('/validate-invite/:inviteCode', referralController.validateInviteLink);

// =========================
// EXISTING ADMIN ROUTES
// =========================

// Get any user's referral earnings (admin only)
// Example: /api/referral/admin/earnings?userName=johnsmith
// OR: /api/referral/admin/earnings?email=john@example.com
router.get('/admin/earnings', protect, adminProtect, referralController.getReferralEarnings);

// Admin route to adjust referral commission settings
router.post('/settings', protect, adminProtect, referralController.updateReferralSettings);

// Admin route to sync referral data for a specific user
router.post('/admin/sync/:userId', protect, adminProtect, referralController.syncUserReferralData);

// =========================
// NEW REFERRAL AUDIT & FIX ROUTES
// =========================

// Emergency quick scan (safe check) - NO CHANGES MADE
router.get('/admin/audit/quick-scan', protect, adminProtect, async (req, res) => {
  try {
    console.log(`🔍 Admin ${req.user.id} running emergency quick scan`);
    
    const results = await quickScan();
    
    res.status(200).json({
      success: true,
      message: 'Emergency scan completed - no changes made',
      results,
      recommendation: results.issues && Object.values(results.issues).some(arr => arr.length > 0) ? 
        'Issues found - consider running quick fix' : 
        'No critical issues detected'
    });
    
  } catch (error) {
    console.error('Error in emergency quick scan:', error);
    res.status(500).json({
      success: false,
      message: 'Emergency scan failed',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Emergency quick fix - APPLIES CRITICAL FIXES
router.post('/admin/audit/quick-fix', protect, adminProtect, async (req, res) => {
  try {
    const { executeMode = false } = req.body;
    
    console.log(`⚡ Admin ${req.user.id} running emergency quick fix (execute: ${executeMode})`);
    
    const results = executeMode ? await quickFix() : await quickScan();
    
    res.status(200).json({
      success: true,
      message: executeMode ? 
        'Emergency fixes applied successfully' : 
        'Emergency scan completed - set executeMode: true to apply fixes',
      results,
      executed: executeMode,
      warning: executeMode ? 
        'Changes have been applied to the database' : 
        'This was a dry run - no changes made'
    });
    
  } catch (error) {
    console.error('Error in emergency quick fix:', error);
    res.status(500).json({
      success: false,
      message: 'Emergency fix failed',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Full comprehensive referral audit
router.post('/admin/audit/full', protect, adminProtect, async (req, res) => {
  try {
    const { dryRun = true, generateReport = true } = req.body;
    
    console.log(`🚀 Admin ${req.user.id} initiated comprehensive referral audit (dryRun: ${dryRun})`);
    
    return await runAuditEndpoint(req, res);
    
  } catch (error) {
    console.error('Error running comprehensive referral audit:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to run comprehensive audit',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Audit specific user
router.post('/admin/audit/user/:userId', protect, adminProtect, async (req, res) => {
  try {
    const { userId } = req.params;
    const { dryRun = true } = req.body;
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'User ID is required'
      });
    }
    
    console.log(`🎯 Admin ${req.user.id} auditing user ${userId} (dryRun: ${dryRun})`);
    
    // Modify request body to include userId for the audit system
    req.body.userId = userId;
    
    return await runAuditEndpoint(req, res);
    
  } catch (error) {
    console.error('Error auditing specific user:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to audit user',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Check specific user referral status (detailed view)
router.get('/admin/audit/user/:userId/status', protect, adminProtect, async (req, res) => {
  try {
    const { userId } = req.params;
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'User ID is required'
      });
    }
    
    console.log(`🔍 Admin ${req.user.id} checking detailed referral status for user ${userId}`);
    
    const result = await checkSpecificUser(userId);
    
    if (!result) {
      return res.status(404).json({
        success: false,
        message: 'User not found or no referral data'
      });
    }
    
    res.status(200).json({
      success: true,
      message: 'User referral status retrieved',
      data: result
    });
    
  } catch (error) {
    console.error('Error checking user detailed status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to check user status',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Get referral system health overview
router.get('/admin/audit/overview', protect, adminProtect, async (req, res) => {
  try {
    const ReferralTransaction = require('../models/ReferralTransaction');
    const Referral = require('../models/Referral');
    
    console.log(`📊 Admin ${req.user.id} requesting referral system overview`);
    
    // Get basic statistics
    const totalReferralTransactions = await ReferralTransaction.countDocuments();
    const completedCommissions = await ReferralTransaction.countDocuments({ status: 'completed' });
    const duplicateCommissions = await ReferralTransaction.countDocuments({ status: 'duplicate' });
    const rolledBackCommissions = await ReferralTransaction.countDocuments({ status: 'rolled_back' });
    const pendingCommissions = await ReferralTransaction.countDocuments({ status: 'pending' });
    
    // Get potential duplicates (critical issue detection)
    const potentialDuplicates = await ReferralTransaction.aggregate([
      { $match: { status: 'completed' } },
      {
        $group: {
          _id: {
            sourceTransaction: '$sourceTransaction',
            generation: '$generation',
            beneficiary: '$beneficiary',
            referredUser: '$referredUser'
          },
          count: { $sum: 1 }
        }
      },
      { $match: { count: { $gt: 1 } } },
      { $count: 'duplicates' }
    ]);
    
    // Get commission rates
    const SiteConfig = require('../models/SiteConfig');
    const siteConfig = await SiteConfig.getCurrentConfig();
    
    // Calculate total earnings
    const totalEarnings = await ReferralTransaction.aggregate([
      { $match: { status: 'completed' } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    
    // Get recent transactions for monitoring
    const recentTransactions = await ReferralTransaction.find({ status: 'completed' })
      .sort({ createdAt: -1 })
      .limit(5)
      .populate('beneficiary', 'userName email')
      .populate('referredUser', 'userName email');
    
    // Health check flags
    const duplicatesFound = (potentialDuplicates[0]?.duplicates || 0) > 0;
    const commissionRatesCorrect = JSON.stringify(siteConfig.referralCommission) === JSON.stringify({
      generation1: 15,
      generation2: 3,
      generation3: 2
    });
    
    const healthStatus = duplicatesFound || !commissionRatesCorrect ? 'ISSUES_DETECTED' : 'HEALTHY';
    
    res.status(200).json({
      success: true,
      overview: {
        healthStatus,
        statistics: {
          totalReferralTransactions,
          completedCommissions,
          pendingCommissions,
          duplicateCommissions,
          rolledBackCommissions,
          potentialDuplicates: potentialDuplicates[0]?.duplicates || 0,
          totalEarnings: totalEarnings[0]?.total || 0
        },
        commissionRates: siteConfig.referralCommission || {
          generation1: 15,
          generation2: 3,
          generation3: 2
        },
        healthCheck: {
          duplicatesFound,
          commissionRatesCorrect,
          pendingTransactions: pendingCommissions > 0
        },
        recentActivity: recentTransactions.map(tx => ({
          id: tx._id,
          amount: tx.amount,
          currency: tx.currency,
          generation: tx.generation,
          beneficiary: tx.beneficiary?.userName || 'Unknown',
          referredUser: tx.referredUser?.userName || 'Unknown',
          date: tx.createdAt,
          purchaseType: tx.purchaseType
        })),
        recommendations: [
          ...(duplicatesFound ? ['Run quick-fix to remove duplicate commissions'] : []),
          ...(!commissionRatesCorrect ? ['Update commission rates to 15%, 3%, 2%'] : []),
          ...(pendingCommissions > 10 ? ['Review pending transactions'] : []),
          ...(healthStatus === 'HEALTHY' ? ['System appears healthy - regular monitoring recommended'] : [])
        ]
      }
    });
    
  } catch (error) {
    console.error('Error getting referral system overview:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get system overview',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Get detailed user referral report
router.get('/admin/audit/user/:userId/report', protect, adminProtect, async (req, res) => {
  try {
    const { userId } = req.params;
    const ReferralTransaction = require('../models/ReferralTransaction');
    const Referral = require('../models/Referral');
    const UserShare = require('../models/UserShare');
    const PaymentTransaction = require('../models/Transaction');
    const User = require('../models/User');
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'User ID is required'
      });
    }
    
    // Get user info
    const user = await User.findById(userId).select('userName email referralInfo');
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    // Get referral stats
    const referralStats = await Referral.findOne({ user: userId });
    
    // Get all referral transactions (commissions earned by this user)
    const earnedCommissions = await ReferralTransaction.find({
      beneficiary: userId
    }).populate('referredUser', 'userName email').sort({ createdAt: -1 });
    
    // Get all referral transactions (commissions generated by this user's purchases)
    const generatedCommissions = await ReferralTransaction.find({
      referredUser: userId
    }).populate('beneficiary', 'userName email').sort({ createdAt: -1 });
    
    // Get user's transactions
    const userShares = await UserShare.findOne({ user: userId });
    const coFounderTxs = await PaymentTransaction.find({ 
      userId, 
      type: 'co-founder' 
    }).sort({ createdAt: -1 });
    
    const regularTxs = userShares?.transactions.filter(t => t.status === 'completed') || [];
    
    // Get referrer chain
    const referrerChain = [];
    let currentUser = user;
    
    for (let gen = 1; gen <= 3; gen++) {
      if (!currentUser.referralInfo?.code) break;
      
      const referrer = await User.findOne({ userName: currentUser.referralInfo.code })
        .select('userName email');
      
      if (!referrer) break;
      
      referrerChain.push({
        generation: gen,
        userName: referrer.userName,
        email: referrer.email,
        userId: referrer._id
      });
      
      currentUser = referrer;
    }
    
    res.status(200).json({
      success: true,
      report: {
        user: {
          id: userId,
          userName: user.userName,
          email: user.email,
          hasReferrer: !!user.referralInfo?.code,
          referrerCode: user.referralInfo?.code
        },
        referrerChain,
        stats: referralStats || {
          referredUsers: 0,
          totalEarnings: 0,
          generation1: { count: 0, earnings: 0 },
          generation2: { count: 0, earnings: 0 },
          generation3: { count: 0, earnings: 0 }
        },
        transactions: {
          regular: regularTxs.length,
          coFounder: coFounderTxs.length,
          total: regularTxs.length + coFounderTxs.length
        },
        commissions: {
          earned: {
            count: earnedCommissions.length,
            total: earnedCommissions.reduce((sum, c) => sum + (c.status === 'completed' ? c.amount : 0), 0),
            details: earnedCommissions.map(c => ({
              id: c._id,
              amount: c.amount,
              currency: c.currency,
              generation: c.generation,
              referredUser: c.referredUser?.userName || 'Unknown',
              date: c.createdAt,
              status: c.status,
              purchaseType: c.purchaseType
            }))
          },
          generated: {
            count: generatedCommissions.length,
            total: generatedCommissions.reduce((sum, c) => sum + (c.status === 'completed' ? c.amount : 0), 0),
            details: generatedCommissions.map(c => ({
              id: c._id,
              amount: c.amount,
              currency: c.currency,
              generation: c.generation,
              beneficiary: c.beneficiary?.userName || 'Unknown',
              date: c.createdAt,
              status: c.status,
              purchaseType: c.purchaseType
            }))
          }
        }
      }
    });
    
  } catch (error) {
    console.error('Error getting user referral report:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get user referral report',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Recalculate all referral statistics
router.post('/admin/audit/recalculate-stats', protect, adminProtect, async (req, res) => {
  try {
    const { dryRun = true } = req.body;
    
    console.log(`🔢 Admin ${req.user.id} recalculating all referral stats (dryRun: ${dryRun})`);
    
    const ReferralTransaction = require('../models/ReferralTransaction');
    const Referral = require('../models/Referral');
    const mongoose = require('mongoose');
    
    // Get all users who have referral transactions
    const allBeneficiaries = await ReferralTransaction.distinct('beneficiary', {
      status: 'completed'
    });
    
    let recalculatedCount = 0;
    
    for (const beneficiaryId of allBeneficiaries) {
      if (!dryRun) {
        // Calculate earnings by generation
        const earnings = await ReferralTransaction.aggregate([
          {
            $match: {
              beneficiary: mongoose.Types.ObjectId(beneficiaryId),
              status: 'completed'
            }
          },
          {
            $group: {
              _id: '$generation',
              totalEarnings: { $sum: '$amount' }
            }
          }
        ]);
        
        // Calculate counts by generation (unique referred users)
        const counts = await ReferralTransaction.aggregate([
          {
            $match: {
              beneficiary: mongoose.Types.ObjectId(beneficiaryId),
              status: 'completed'
            }
          },
          {
            $group: {
              _id: {
                generation: '$generation',
                referredUser: '$referredUser'
              }
            }
          },
          {
            $group: {
              _id: '$_id.generation',
              uniqueUsers: { $sum: 1 }
            }
          }
        ]);
        
        // Update referral stats
        let referralStats = await Referral.findOne({ user: beneficiaryId });
        
        if (!referralStats) {
          referralStats = new Referral({
            user: beneficiaryId,
            referredUsers: 0,
            totalEarnings: 0,
            generation1: { count: 0, earnings: 0 },
            generation2: { count: 0, earnings: 0 },
            generation3: { count: 0, earnings: 0 }
          });
        }
        
        // Reset stats
        referralStats.totalEarnings = 0;
        referralStats.generation1 = { count: 0, earnings: 0 };
        referralStats.generation2 = { count: 0, earnings: 0 };
        referralStats.generation3 = { count: 0, earnings: 0 };
        
        // Apply calculated earnings
        for (const earning of earnings) {
          referralStats.totalEarnings += earning.totalEarnings;
          referralStats[`generation${earning._id}`].earnings = earning.totalEarnings;
        }
        
        // Apply calculated counts
        for (const count of counts) {
          referralStats[`generation${count._id}`].count = count.uniqueUsers;
          
          if (count._id === 1) {
            referralStats.referredUsers = count.uniqueUsers;
          }
        }
        
        await referralStats.save();
      }
      
      recalculatedCount++;
    }
    
    res.status(200).json({
      success: true,
      message: `${dryRun ? 'Would recalculate' : 'Successfully recalculated'} stats for ${recalculatedCount} users`,
      recalculatedCount,
      dryRun
    });
    
  } catch (error) {
    console.error('Error recalculating referral stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to recalculate referral stats',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

module.exports = router;