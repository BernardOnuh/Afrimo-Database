// runReferralAudit.js - Script to run the referral audit and fix issues
const mongoose = require('mongoose');
const { ReferralAudit, runReferralAudit } = require('./referralAuditAndFix');

// Add this as an endpoint in your main app or run as standalone script
const runAuditEndpoint = async (req, res) => {
  try {
    const { dryRun = true, userId = null, generateReport = true } = req.body || {};
    const adminId = req.user?.id;
    
    // Check if admin (if running as endpoint)
    if (req.user) {
      const User = require('../models/User');
      const admin = await User.findById(adminId);
      if (!admin || !admin.isAdmin) {
        return res.status(403).json({
          success: false,
          message: 'Unauthorized: Admin access required'
        });
      }
    }
    
    console.log('🚀 Starting Referral Audit Process...');
    console.log(`Mode: ${dryRun ? 'DRY RUN' : 'EXECUTE FIXES'}`);
    console.log(`Target: ${userId ? `Single user (${userId})` : 'All users'}`);
    
    const auditor = new ReferralAudit();
    
    let results;
    if (userId) {
      // Audit single user
      results = await auditSingleUser(auditor, userId, dryRun);
    } else {
      // Audit all users
      results = await auditor.runCompleteAudit({ dryRun });
    }
    
    // Generate detailed CSV report if requested
    let reportPath = null;
    if (generateReport) {
      reportPath = await generateCSVReport(results);
    }
    
    // If running as endpoint, return JSON response
    if (res) {
      return res.status(200).json({
        success: true,
        message: `Audit completed. ${dryRun ? 'Dry run - no changes made.' : 'Fixes applied.'}`,
        results: {
          summary: {
            totalUsers: results.totalUsers,
            duplicates: results.duplicateCommissions.length,
            missing: results.missingCommissions.length,
            incorrect: results.incorrectCommissions.length,
            fixed: results.fixedCommissions.length,
            errors: results.errors.length
          },
          details: results,
          reportPath
        }
      });
    }
    
    return results;
    
  } catch (error) {
    console.error('💥 Error running audit:', error);
    
    if (res) {
      return res.status(500).json({
        success: false,
        message: 'Audit failed',
        error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
      });
    }
    
    throw error;
  }
};

// Audit single user function
async function auditSingleUser(auditor, userId, dryRun = true) {
  try {
    const User = require('../models/User');
    const user = await User.findById(userId);
    
    if (!user) {
      throw new Error('User not found');
    }
    
    console.log(`🎯 Auditing single user: ${user.userName} (${userId})`);
    
    // Initialize auditor
    await auditor.ensureCorrectCommissionRates();
    
    // Audit this specific user
    await auditor.auditUserReferrals(user, dryRun);
    
    // Fix any duplicates found for this user
    const userDuplicates = auditor.auditResults.duplicateCommissions.filter(d => d.userId === userId);
    if (userDuplicates.length > 0 && !dryRun) {
      await auditor.fixDuplicateCommissions(false);
    }
    
    // Recalculate stats for this user
    if (!dryRun) {
      await auditor.recalculateUserReferralStats(userId);
    }
    
    return auditor.auditResults;
    
  } catch (error) {
    console.error(`💥 Error auditing user ${userId}:`, error);
    throw error;
  }
}

// Generate CSV report
async function generateCSVReport(results) {
  try {
    const fs = require('fs');
    const path = require('path');
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const reportDir = path.join(process.cwd(), 'reports');
    
    // Ensure reports directory exists
    if (!fs.existsSync(reportDir)) {
      fs.mkdirSync(reportDir, { recursive: true });
    }
    
    const reportPath = path.join(reportDir, `referral_audit_${timestamp}.csv`);
    
    // Create CSV content
    let csvContent = 'Type,User ID,User Name,Transaction ID,Generation,Beneficiary,Expected Amount,Actual Amount,Difference,Currency,Issue\n';
    
    // Add duplicate commissions
    results.duplicateCommissions.forEach(item => {
      csvContent += `DUPLICATE,${item.userId},${item.userName},${item.transactionId},${item.generation},${item.beneficiary},0,${item.totalDuplicateAmount},${item.totalDuplicateAmount},Unknown,${item.count} duplicates found\n`;
    });
    
    // Add missing commissions
    results.missingCommissions.forEach(item => {
      csvContent += `MISSING,${item.userId},${item.userName},${item.transactionId},${item.generation},${item.beneficiary},${item.expectedAmount},0,${item.expectedAmount},${item.currency},Commission not created\n`;
    });
    
    // Add incorrect commissions
    results.incorrectCommissions.forEach(item => {
      csvContent += `INCORRECT,${item.userId},${item.userName},${item.transactionId},${item.generation},${item.beneficiary},${item.expectedAmount},${item.actualAmount},${item.difference},Unknown,${item.issue || 'Amount mismatch'}\n`;
    });
    
    // Add fixed commissions
    results.fixedCommissions.forEach(item => {
      csvContent += `FIXED,${item.userId},${item.userName},${item.transactionId || 'N/A'},${item.generation || 'N/A'},${item.beneficiary || 'N/A'},${item.amount || 0},${item.amount || 0},0,Unknown,${item.type}\n`;
    });
    
    // Write to file
    fs.writeFileSync(reportPath, csvContent);
    
    console.log(`📊 Report generated: ${reportPath}`);
    return reportPath;
    
  } catch (error) {
    console.error('❌ Error generating CSV report:', error);
    return null;
  }
}

// Quick fix function for critical issues
async function quickFixCriticalIssues(dryRun = true) {
  try {
    console.log('🚨 Running Quick Fix for Critical Issues...');
    
    const ReferralTransaction = require('../models/ReferralTransaction');
    const Referral = require('../models/Referral');
    
    // 1. Fix obvious duplicates (same beneficiary, same source transaction, same generation)
    console.log('🔍 Finding obvious duplicates...');
    
    const duplicates = await ReferralTransaction.aggregate([
      {
        $match: { status: 'completed' }
      },
      {
        $group: {
          _id: {
            beneficiary: '$beneficiary',
            sourceTransaction: '$sourceTransaction',
            generation: '$generation',
            referredUser: '$referredUser'
          },
          count: { $sum: 1 },
          transactions: { $push: '$$ROOT' }
        }
      },
      {
        $match: { count: { $gt: 1 } }
      }
    ]);
    
    console.log(`Found ${duplicates.length} sets of duplicates`);
    
    let fixedDuplicates = 0;
    
    for (const duplicateSet of duplicates) {
      const transactions = duplicateSet.transactions.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
      
      // Keep the first transaction, mark others as duplicates
      for (let i = 1; i < transactions.length; i++) {
        const duplicate = transactions[i];
        
        if (!dryRun) {
          await ReferralTransaction.findByIdAndUpdate(duplicate._id, {
            status: 'duplicate',
            markedDuplicateAt: new Date(),
            duplicateReason: 'Quick fix - obvious duplicate'
          });
          
          // Subtract from referrer stats
          const referralStats = await Referral.findOne({ user: duplicate.beneficiary });
          if (referralStats) {
            referralStats.totalEarnings = Math.max(0, referralStats.totalEarnings - duplicate.amount);
            referralStats[`generation${duplicate.generation}`].earnings = Math.max(0, 
              referralStats[`generation${duplicate.generation}`].earnings - duplicate.amount
            );
            await referralStats.save();
          }
        }
        
        fixedDuplicates++;
        console.log(`${dryRun ? '[DRY RUN]' : ''} Fixed duplicate: ${duplicate._id}`);
      }
    }
    
    // 2. Fix commission rates (ensure 15%, 3%, 2%)
    console.log('⚙️ Checking commission rates...');
    
    const SiteConfig = require('../models/SiteConfig');
    const siteConfig = await SiteConfig.getCurrentConfig();
    
    const correctRates = {
      generation1: 15,
      generation2: 3,
      generation3: 2
    };
    
    if (!siteConfig.referralCommission || 
        JSON.stringify(siteConfig.referralCommission) !== JSON.stringify(correctRates)) {
      
      if (!dryRun) {
        siteConfig.referralCommission = correctRates;
        await siteConfig.save();
      }
      
      console.log(`${dryRun ? '[DRY RUN]' : ''} Updated commission rates to 15%, 3%, 2%`);
    }
    
    console.log(`🎉 Quick fix completed. Fixed ${fixedDuplicates} duplicate commissions.`);
    
    return {
      duplicatesFixed: fixedDuplicates,
      commissionRatesUpdated: true
    };
    
  } catch (error) {
    console.error('❌ Error in quick fix:', error);
    throw error;
  }
}

// Helper function to check specific user's referral status
async function checkUserReferralStatus(userId) {
  try {
    const User = require('../models/User');
    const UserShare = require('../models/UserShare');
    const PaymentTransaction = require('../models/Transaction');
    const ReferralTransaction = require('../models/ReferralTransaction');
    const Referral = require('../models/Referral');
    
    console.log(`🔍 Checking referral status for user: ${userId}`);
    
    // Get user info
    const user = await User.findById(userId);
    if (!user) {
      console.log('❌ User not found');
      return null;
    }
    
    console.log(`👤 User: ${user.userName}, Email: ${user.email}`);
    console.log(`🔗 Referral code: ${user.referralInfo?.code || 'None'}`);
    
    // Get user's transactions
    const userShares = await UserShare.findOne({ user: userId });
    const coFounderTxs = await PaymentTransaction.find({ userId, type: 'co-founder', status: 'completed' });
    
    const regularTxs = userShares?.transactions.filter(t => t.status === 'completed') || [];
    
    console.log(`📊 Transactions: ${regularTxs.length} regular, ${coFounderTxs.length} co-founder`);
    
    // Get referral commissions generated by this user
    const generatedCommissions = await ReferralTransaction.find({
      referredUser: userId,
      status: 'completed'
    });
    
    console.log(`💰 Generated ${generatedCommissions.length} referral commissions`);
    
    // Get commissions earned by this user (as beneficiary)
    const earnedCommissions = await ReferralTransaction.find({
      beneficiary: userId,
      status: 'completed'
    });
    
    const referralStats = await Referral.findOne({ user: userId });
    
    console.log(`🎯 Earned ${earnedCommissions.length} referral commissions`);
    console.log(`📈 Referral stats:`, referralStats);
    
    // Check for issues
    const issues = [];
    
    // Check if transactions should have generated commissions but didn't
    const totalTransactions = regularTxs.length + coFounderTxs.length;
    if (totalTransactions > 0 && user.referralInfo?.code && generatedCommissions.length === 0) {
      issues.push('Has transactions and referrer but no commissions generated');
    }
    
    // Check for duplicate commissions
    const duplicateGroups = {};
    generatedCommissions.forEach(comm => {
      const key = `${comm.sourceTransaction}_${comm.generation}_${comm.beneficiary}`;
      if (!duplicateGroups[key]) duplicateGroups[key] = [];
      duplicateGroups[key].push(comm);
    });
    
    const duplicates = Object.values(duplicateGroups).filter(group => group.length > 1);
    if (duplicates.length > 0) {
      issues.push(`${duplicates.length} sets of duplicate commissions found`);
    }
    
    console.log(`⚠️ Issues found: ${issues.length}`);
    issues.forEach(issue => console.log(`  - ${issue}`));
    
    return {
      user: {
        id: userId,
        userName: user.userName,
        email: user.email,
        hasReferrer: !!user.referralInfo?.code,
        referrerCode: user.referralInfo?.code
      },
      transactions: {
        regular: regularTxs.length,
        coFounder: coFounderTxs.length,
        total: totalTransactions
      },
      commissions: {
        generated: generatedCommissions.length,
        earned: earnedCommissions.length
      },
      stats: referralStats,
      issues,
      duplicates: duplicates.length
    };
    
  } catch (error) {
    console.error(`❌ Error checking user ${userId}:`, error);
    return null;
  }
}

// Main export for API endpoint
module.exports = {
  runAuditEndpoint,
  auditSingleUser,
  quickFixCriticalIssues,
  checkUserReferralStatus,
  generateCSVReport
};

// Command line execution
if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0];
  
  if (command === 'audit') {
    const dryRun = !args.includes('--execute');
    const userId = args.find(arg => arg.startsWith('--user='))?.split('=')[1];
    
    console.log(`🚀 Running audit...`);
    console.log(`Dry run: ${dryRun}`);
    console.log(`User: ${userId || 'All users'}`);
    
    runReferralAudit({ dryRun })
      .then(results => {
        console.log('✅ Audit completed successfully');
        if (dryRun) {
          console.log('ℹ️ This was a dry run. Use --execute to apply fixes.');
        }
      })
      .catch(error => {
        console.error('💥 Audit failed:', error);
        process.exit(1);
      });
      
  } else if (command === 'quick-fix') {
    const dryRun = !args.includes('--execute');
    
    quickFixCriticalIssues(dryRun)
      .then(results => {
        console.log('✅ Quick fix completed:', results);
      })
      .catch(error => {
        console.error('💥 Quick fix failed:', error);
        process.exit(1);
      });
      
  } else if (command === 'check-user') {
    const userId = args[1];
    if (!userId) {
      console.log('❌ Please provide user ID: node runReferralAudit.js check-user <userId>');
      process.exit(1);
    }
    
    checkUserReferralStatus(userId)
      .then(result => {
        console.log('✅ User check completed');
      })
      .catch(error => {
        console.error('💥 User check failed:', error);
        process.exit(1);
      });
      
  } else {
    console.log('📖 Usage:');
    console.log('  node runReferralAudit.js audit [--execute] [--user=userId]');
    console.log('  node runReferralAudit.js quick-fix [--execute]');
    console.log('  node runReferralAudit.js check-user <userId>');
    console.log('');
    console.log('Options:');
    console.log('  --execute    Apply fixes (default is dry run)');
    console.log('  --user=ID    Audit specific user only');
  }
}