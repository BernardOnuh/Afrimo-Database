// referralAuditAndFix.js - Complete audit and fix script for referral rewards
const mongoose = require('mongoose');
const User = require('./models/User');
const Referral = require('./models/Referral');
const ReferralTransaction = require('./models/ReferralTransaction');
const UserShare = require('./models/UserShare');
const PaymentTransaction = require('./models/Transaction');
const SiteConfig = require('./models/SiteConfig');
const CoFounderShare = require('./models/CoFounderShare');

class ReferralAudit {
  constructor() {
    this.auditResults = {
      totalUsers: 0,
      usersWithReferralIssues: 0,
      duplicateCommissions: [],
      incorrectCommissions: [],
      missingCommissions: [],
      statusMismatches: [],
      currencyIssues: [],
      fixedCommissions: [],
      errors: []
    };
    
    this.COMMISSION_RATES = {
      generation1: 15,
      generation2: 3,
      generation3: 2
    };
    
    this.COFOUNDER_TO_REGULAR_RATIO = 29;
  }

  // Main audit function
  async runCompleteAudit(options = {}) {
    try {
      console.log('🔍 Starting comprehensive referral audit...');
      
      // Step 1: Ensure correct commission rates
      await this.ensureCorrectCommissionRates();
      
      // Step 2: Get all users with transactions
      const usersWithTransactions = await this.getAllUsersWithTransactions();
      this.auditResults.totalUsers = usersWithTransactions.length;
      
      console.log(`📊 Found ${usersWithTransactions.length} users with transactions`);
      
      // Step 3: Audit each user
      for (const user of usersWithTransactions) {
        await this.auditUserReferrals(user, options.dryRun);
      }
      
      // Step 4: Fix duplicate commissions
      await this.fixDuplicateCommissions(options.dryRun);
      
      // Step 5: Recalculate all referral stats
      await this.recalculateAllReferralStats(options.dryRun);
      
      // Step 6: Generate detailed report
      await this.generateDetailedReport();
      
      return this.auditResults;
      
    } catch (error) {
      console.error('❌ Error during audit:', error);
      this.auditResults.errors.push({
        type: 'AUDIT_ERROR',
        message: error.message,
        stack: error.stack
      });
      return this.auditResults;
    }
  }

  // Ensure commission rates are correct
  async ensureCorrectCommissionRates() {
    try {
      const siteConfig = await SiteConfig.getCurrentConfig();
      
      const correctRates = {
        generation1: 15,
        generation2: 3,
        generation3: 2
      };
      
      if (!siteConfig.referralCommission || 
          JSON.stringify(siteConfig.referralCommission) !== JSON.stringify(correctRates)) {
        
        console.log('⚙️  Updating commission rates to correct values...');
        siteConfig.referralCommission = correctRates;
        await siteConfig.save();
        console.log('✅ Commission rates updated');
      }
      
      this.COMMISSION_RATES = correctRates;
    } catch (error) {
      console.error('❌ Error updating commission rates:', error);
    }
  }

  // Get all users who have made transactions
  async getAllUsersWithTransactions() {
    try {
      // Get users from UserShare transactions
      const userShareUsers = await UserShare.aggregate([
        { $unwind: '$transactions' },
        { $match: { 'transactions.status': 'completed' } },
        { $group: { _id: '$user' } }
      ]);
      
      // Get users from PaymentTransaction (co-founder)
      const paymentTransactionUsers = await PaymentTransaction.aggregate([
        { $match: { status: 'completed', type: 'co-founder' } },
        { $group: { _id: '$userId' } }
      ]);
      
      // Combine and deduplicate
      const allUserIds = new Set([
        ...userShareUsers.map(u => u._id.toString()),
        ...paymentTransactionUsers.map(u => u._id.toString())
      ]);
      
      // Get full user objects
      const users = await User.find({
        _id: { $in: Array.from(allUserIds) }
      }).select('_id userName email referralInfo');
      
      return users;
    } catch (error) {
      console.error('❌ Error getting users with transactions:', error);
      return [];
    }
  }

  // Audit referrals for a specific user
  async auditUserReferrals(user, dryRun = true) {
    try {
      console.log(`\n👤 Auditing user: ${user.userName} (${user._id})`);
      
      // Get all transactions for this user
      const userTransactions = await this.getUserAllTransactions(user._id);
      
      if (userTransactions.length === 0) {
        console.log('  📭 No transactions found');
        return;
      }
      
      console.log(`  📊 Found ${userTransactions.length} transactions`);
      
      // Check if user has referrer
      if (!user.referralInfo || !user.referralInfo.code) {
        console.log('  🚫 User has no referrer, skipping');
        return;
      }
      
      console.log(`  👥 User referred by: ${user.referralInfo.code}`);
      
      // Audit each transaction
      for (const transaction of userTransactions) {
        await this.auditUserTransaction(user, transaction, dryRun);
      }
      
    } catch (error) {
      console.error(`❌ Error auditing user ${user._id}:`, error);
      this.auditResults.errors.push({
        type: 'USER_AUDIT_ERROR',
        userId: user._id,
        userName: user.userName,
        message: error.message
      });
    }
  }

  // Get all transactions for a user (both regular and co-founder)
  async getUserAllTransactions(userId) {
    try {
      const transactions = [];
      
      // Get regular share transactions
      const userShares = await UserShare.findOne({ user: userId });
      if (userShares && userShares.transactions) {
        for (const tx of userShares.transactions) {
          if (tx.status === 'completed') {
            transactions.push({
              id: tx.transactionId || tx._id,
              type: 'regular',
              amount: tx.totalAmount,
              currency: tx.currency,
              shares: tx.shares,
              date: tx.createdAt,
              sourceModel: 'UserShare',
              originalTransaction: tx
            });
          }
        }
      }
      
      // Get co-founder transactions
      const coFounderTransactions = await PaymentTransaction.find({
        userId: userId,
        type: 'co-founder',
        status: 'completed'
      });
      
      for (const tx of coFounderTransactions) {
        transactions.push({
          id: tx._id,
          type: 'cofounder',
          amount: tx.amount,
          currency: tx.currency,
          shares: tx.shares,
          date: tx.createdAt,
          sourceModel: 'PaymentTransaction',
          originalTransaction: tx
        });
      }
      
      return transactions.sort((a, b) => new Date(a.date) - new Date(b.date));
    } catch (error) {
      console.error(`❌ Error getting transactions for user ${userId}:`, error);
      return [];
    }
  }

  // Audit a specific transaction for referral commissions
  async auditUserTransaction(user, transaction, dryRun = true) {
    try {
      console.log(`    💰 Auditing ${transaction.type} transaction: ${transaction.amount} ${transaction.currency}`);
      
      // Get existing referral transactions for this source transaction
      const existingReferrals = await ReferralTransaction.find({
        referredUser: user._id,
        sourceTransaction: transaction.id,
        sourceTransactionModel: transaction.sourceModel
      });
      
      console.log(`    📋 Found ${existingReferrals.length} existing referral transactions`);
      
      // Check for duplicates
      await this.checkForDuplicates(user, transaction, existingReferrals);
      
      // Calculate what the correct commissions should be
      const correctCommissions = await this.calculateCorrectCommissions(user, transaction);
      
      console.log(`    🎯 Should have ${correctCommissions.length} commissions`);
      
      // Compare existing vs correct
      await this.compareCommissions(user, transaction, existingReferrals, correctCommissions, dryRun);
      
    } catch (error) {
      console.error(`❌ Error auditing transaction ${transaction.id}:`, error);
    }
  }

  // Check for duplicate commissions
  async checkForDuplicates(user, transaction, existingReferrals) {
    try {
      // Group by generation and beneficiary
      const groups = {};
      
      for (const referral of existingReferrals) {
        const key = `${referral.generation}_${referral.beneficiary}`;
        
        if (!groups[key]) {
          groups[key] = [];
        }
        groups[key].push(referral);
      }
      
      // Check for groups with multiple entries (duplicates)
      for (const [key, referrals] of Object.entries(groups)) {
        if (referrals.length > 1) {
          console.log(`    🚨 DUPLICATE found: ${referrals.length} commissions for ${key}`);
          
          this.auditResults.duplicateCommissions.push({
            userId: user._id,
            userName: user.userName,
            transactionId: transaction.id,
            generation: referrals[0].generation,
            beneficiary: referrals[0].beneficiary,
            count: referrals.length,
            referralIds: referrals.map(r => r._id),
            totalDuplicateAmount: referrals.slice(1).reduce((sum, r) => sum + r.amount, 0)
          });
        }
      }
    } catch (error) {
      console.error('❌ Error checking duplicates:', error);
    }
  }

  // Calculate what the correct commissions should be
  async calculateCorrectCommissions(user, transaction) {
    try {
      const correctCommissions = [];
      
      // Get referrer chain
      const referrerChain = await this.getReferrerChain(user._id);
      
      for (let generation = 1; generation <= 3; generation++) {
        if (generation > referrerChain.length) break;
        
        const referrer = referrerChain[generation - 1];
        const commissionRate = this.COMMISSION_RATES[`generation${generation}`];
        
        if (!commissionRate || commissionRate <= 0) continue;
        
        const commissionAmount = (transaction.amount * commissionRate) / 100;
        
        correctCommissions.push({
          generation,
          beneficiary: referrer._id,
          beneficiaryUserName: referrer.userName,
          amount: commissionAmount,
          currency: transaction.currency,
          commissionRate
        });
      }
      
      return correctCommissions;
    } catch (error) {
      console.error('❌ Error calculating correct commissions:', error);
      return [];
    }
  }

  // Get referrer chain for a user
  async getReferrerChain(userId) {
    try {
      const chain = [];
      let currentUser = await User.findById(userId);
      
      for (let generation = 1; generation <= 3; generation++) {
        if (!currentUser || !currentUser.referralInfo || !currentUser.referralInfo.code) {
          break;
        }
        
        const referrer = await User.findOne({ userName: currentUser.referralInfo.code });
        
        if (!referrer) break;
        
        chain.push(referrer);
        currentUser = referrer;
      }
      
      return chain;
    } catch (error) {
      console.error('❌ Error getting referrer chain:', error);
      return [];
    }
  }

  // Compare existing commissions with correct ones
  async compareCommissions(user, transaction, existingReferrals, correctCommissions, dryRun) {
    try {
      // Check for missing commissions
      for (const correct of correctCommissions) {
        const existing = existingReferrals.find(e => 
          e.generation === correct.generation && 
          e.beneficiary.toString() === correct.beneficiary.toString() &&
          e.status === 'completed'
        );
        
        if (!existing) {
          console.log(`    🚨 MISSING commission: Gen${correct.generation} for ${correct.beneficiaryUserName}`);
          
          this.auditResults.missingCommissions.push({
            userId: user._id,
            userName: user.userName,
            transactionId: transaction.id,
            transactionType: transaction.type,
            generation: correct.generation,
            beneficiary: correct.beneficiary,
            beneficiaryUserName: correct.beneficiaryUserName,
            expectedAmount: correct.amount,
            currency: correct.currency
          });
          
          // Create missing commission if not dry run
          if (!dryRun) {
            await this.createMissingCommission(user, transaction, correct);
          }
        } else {
          // Check if amount is correct
          const amountDiff = Math.abs(existing.amount - correct.amount);
          if (amountDiff > 0.01) { // Allow for small rounding differences
            console.log(`    🚨 INCORRECT amount: Gen${correct.generation}, Expected: ${correct.amount}, Found: ${existing.amount}`);
            
            this.auditResults.incorrectCommissions.push({
              userId: user._id,
              userName: user.userName,
              transactionId: transaction.id,
              generation: correct.generation,
              beneficiary: correct.beneficiary,
              beneficiaryUserName: correct.beneficiaryUserName,
              expectedAmount: correct.amount,
              actualAmount: existing.amount,
              difference: amountDiff,
              referralTransactionId: existing._id
            });
          }
        }
      }
      
      // Check for extra commissions
      for (const existing of existingReferrals) {
        if (existing.status !== 'completed') continue;
        
        const shouldExist = correctCommissions.find(c => 
          c.generation === existing.generation && 
          c.beneficiary.toString() === existing.beneficiary.toString()
        );
        
        if (!shouldExist) {
          console.log(`    🚨 EXTRA commission: Gen${existing.generation} for ${existing.beneficiary}`);
          
          this.auditResults.incorrectCommissions.push({
            userId: user._id,
            userName: user.userName,
            transactionId: transaction.id,
            generation: existing.generation,
            beneficiary: existing.beneficiary,
            actualAmount: existing.amount,
            expectedAmount: 0,
            difference: existing.amount,
            referralTransactionId: existing._id,
            issue: 'EXTRA_COMMISSION'
          });
        }
      }
      
    } catch (error) {
      console.error('❌ Error comparing commissions:', error);
    }
  }

  // Create missing commission
  async createMissingCommission(user, transaction, correctCommission) {
    try {
      console.log(`    ✅ Creating missing commission: Gen${correctCommission.generation} for ${correctCommission.beneficiaryUserName}`);
      
      const referralTxData = {
        beneficiary: correctCommission.beneficiary,
        referredUser: user._id,
        amount: correctCommission.amount,
        currency: correctCommission.currency,
        generation: correctCommission.generation,
        purchaseType: transaction.type,
        sourceTransaction: transaction.id,
        sourceTransactionModel: transaction.sourceModel,
        status: 'completed',
        createdAt: transaction.date, // Use original transaction date
        commissionDetails: {
          baseAmount: transaction.amount,
          commissionRate: correctCommission.commissionRate,
          calculatedAt: new Date(),
          auditCreated: true,
          originalTransactionDate: transaction.date
        }
      };
      
      const referralTransaction = new ReferralTransaction(referralTxData);
      await referralTransaction.save();
      
      // Update referrer stats
      await this.updateReferrerStatsForNewCommission(
        correctCommission.beneficiary, 
        correctCommission.amount, 
        correctCommission.generation,
        user._id
      );
      
      this.auditResults.fixedCommissions.push({
        type: 'CREATED_MISSING',
        userId: user._id,
        userName: user.userName,
        transactionId: transaction.id,
        generation: correctCommission.generation,
        beneficiary: correctCommission.beneficiary,
        amount: correctCommission.amount,
        referralTransactionId: referralTransaction._id
      });
      
    } catch (error) {
      console.error('❌ Error creating missing commission:', error);
    }
  }

  // Update referrer stats for new commission
  async updateReferrerStatsForNewCommission(beneficiaryId, amount, generation, referredUserId) {
    try {
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
      
      // Update earnings
      referralStats.totalEarnings += amount;
      referralStats[`generation${generation}`].earnings += amount;
      
      // Check if this is a new user for this generation
      const existingCommissionCount = await ReferralTransaction.countDocuments({
        beneficiary: beneficiaryId,
        referredUser: referredUserId,
        generation: generation,
        status: 'completed'
      });
      
      if (existingCommissionCount === 1) { // This is the first commission from this user for this generation
        referralStats[`generation${generation}`].count += 1;
        
        if (generation === 1) {
          // Recalculate total referred users for generation 1
          const uniqueGen1Users = await ReferralTransaction.distinct('referredUser', {
            beneficiary: beneficiaryId,
            generation: 1,
            status: 'completed'
          });
          referralStats.referredUsers = uniqueGen1Users.length;
        }
      }
      
      await referralStats.save();
    } catch (error) {
      console.error('❌ Error updating referrer stats:', error);
    }
  }

  // Fix duplicate commissions
  async fixDuplicateCommissions(dryRun = true) {
    console.log('\n🔧 Fixing duplicate commissions...');
    
    for (const duplicate of this.auditResults.duplicateCommissions) {
      try {
        console.log(`  Fixing duplicates for user ${duplicate.userName}, transaction ${duplicate.transactionId}`);
        
        if (!dryRun) {
          // Get all duplicate referral transactions
          const duplicateReferrals = await ReferralTransaction.find({
            _id: { $in: duplicate.referralIds }
          }).sort({ createdAt: 1 });
          
          // Keep the first one, mark others as duplicates
          for (let i = 1; i < duplicateReferrals.length; i++) {
            const duplicateRef = duplicateReferrals[i];
            
            // Update referrer stats to subtract the duplicate amount
            await this.subtractFromReferrerStats(
              duplicateRef.beneficiary,
              duplicateRef.amount,
              duplicateRef.generation
            );
            
            // Mark as duplicate (don't delete for audit trail)
            duplicateRef.status = 'duplicate';
            duplicateRef.markedDuplicateAt = new Date();
            duplicateRef.duplicateReason = 'Found during audit - keeping first transaction only';
            await duplicateRef.save();
            
            console.log(`    ✅ Marked duplicate referral ${duplicateRef._id} as duplicate`);
          }
        }
        
        this.auditResults.fixedCommissions.push({
          type: 'FIXED_DUPLICATE',
          userId: duplicate.userId,
          userName: duplicate.userName,
          transactionId: duplicate.transactionId,
          generation: duplicate.generation,
          duplicatesFixed: duplicate.count - 1,
          amountRecovered: duplicate.totalDuplicateAmount
        });
        
      } catch (error) {
        console.error(`❌ Error fixing duplicate for user ${duplicate.userId}:`, error);
      }
    }
  }

  // Subtract amount from referrer stats
  async subtractFromReferrerStats(beneficiaryId, amount, generation) {
    try {
      const referralStats = await Referral.findOne({ user: beneficiaryId });
      
      if (referralStats) {
        referralStats.totalEarnings = Math.max(0, referralStats.totalEarnings - amount);
        referralStats[`generation${generation}`].earnings = Math.max(0, 
          referralStats[`generation${generation}`].earnings - amount
        );
        
        await referralStats.save();
      }
    } catch (error) {
      console.error('❌ Error subtracting from referrer stats:', error);
    }
  }

  // Recalculate all referral stats from scratch
  async recalculateAllReferralStats(dryRun = true) {
    console.log('\n🔢 Recalculating all referral stats...');
    
    try {
      const allBeneficiaries = await ReferralTransaction.distinct('beneficiary', {
        status: 'completed'
      });
      
      console.log(`  Found ${allBeneficiaries.length} users with referral earnings`);
      
      for (const beneficiaryId of allBeneficiaries) {
        if (!dryRun) {
          await this.recalculateUserReferralStats(beneficiaryId);
        }
      }
      
      console.log('  ✅ All referral stats recalculated');
    } catch (error) {
      console.error('❌ Error recalculating referral stats:', error);
    }
  }

  // Recalculate referral stats for a specific user
  async recalculateUserReferralStats(userId) {
    try {
      // Calculate earnings by generation
      const earnings = await ReferralTransaction.aggregate([
        {
          $match: {
            beneficiary: mongoose.Types.ObjectId(userId),
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
            beneficiary: mongoose.Types.ObjectId(userId),
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
      
      // Update or create referral stats
      let referralStats = await Referral.findOne({ user: userId });
      
      if (!referralStats) {
        referralStats = new Referral({
          user: userId,
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
      
    } catch (error) {
      console.error(`❌ Error recalculating stats for user ${userId}:`, error);
    }
  }

  // Generate detailed report
  async generateDetailedReport() {
    console.log('\n📊 AUDIT RESULTS SUMMARY');
    console.log('========================');
    console.log(`Total users audited: ${this.auditResults.totalUsers}`);
    console.log(`Users with issues: ${this.auditResults.usersWithReferralIssues}`);
    console.log(`Duplicate commissions found: ${this.auditResults.duplicateCommissions.length}`);
    console.log(`Missing commissions found: ${this.auditResults.missingCommissions.length}`);
    console.log(`Incorrect commissions found: ${this.auditResults.incorrectCommissions.length}`);
    console.log(`Commissions fixed: ${this.auditResults.fixedCommissions.length}`);
    console.log(`Errors encountered: ${this.auditResults.errors.length}`);
    
    // Detailed breakdown
    if (this.auditResults.duplicateCommissions.length > 0) {
      console.log('\n🚨 DUPLICATE COMMISSIONS:');
      this.auditResults.duplicateCommissions.forEach((dup, index) => {
        console.log(`  ${index + 1}. User: ${dup.userName}, Transaction: ${dup.transactionId}, Gen: ${dup.generation}, Count: ${dup.count}, Extra Amount: ${dup.totalDuplicateAmount}`);
      });
    }
    
    if (this.auditResults.missingCommissions.length > 0) {
      console.log('\n❌ MISSING COMMISSIONS:');
      this.auditResults.missingCommissions.forEach((missing, index) => {
        console.log(`  ${index + 1}. User: ${missing.userName}, Transaction: ${missing.transactionId}, Gen: ${missing.generation}, Expected: ${missing.expectedAmount} ${missing.currency}`);
      });
    }
    
    if (this.auditResults.incorrectCommissions.length > 0) {
      console.log('\n⚠️  INCORRECT COMMISSIONS:');
      this.auditResults.incorrectCommissions.forEach((incorrect, index) => {
        console.log(`  ${index + 1}. User: ${incorrect.userName}, Transaction: ${incorrect.transactionId}, Gen: ${incorrect.generation}, Expected: ${incorrect.expectedAmount}, Actual: ${incorrect.actualAmount}, Diff: ${incorrect.difference}`);
      });
    }
    
    if (this.auditResults.fixedCommissions.length > 0) {
      console.log('\n✅ COMMISSIONS FIXED:');
      this.auditResults.fixedCommissions.forEach((fixed, index) => {
        console.log(`  ${index + 1}. Type: ${fixed.type}, User: ${fixed.userName}, Amount: ${fixed.amount || 'N/A'}`);
      });
    }
  }

  // Get users with specific issues for targeted fixes
  async getUsersWithIssues() {
    const usersWithIssues = new Set();
    
    // Add users with duplicates
    this.auditResults.duplicateCommissions.forEach(dup => {
      usersWithIssues.add(dup.userId);
    });
    
    // Add users with missing commissions
    this.auditResults.missingCommissions.forEach(missing => {
      usersWithIssues.add(missing.userId);
    });
    
    // Add users with incorrect commissions
    this.auditResults.incorrectCommissions.forEach(incorrect => {
      usersWithIssues.add(incorrect.userId);
    });
    
    return Array.from(usersWithIssues);
  }
}

// Main execution function
async function runReferralAudit(options = {}) {
  const auditor = new ReferralAudit();
  
  console.log('🚀 Starting Referral System Audit');
  console.log(`Dry Run: ${options.dryRun !== false ? 'YES' : 'NO'}`);
  console.log('=====================================');
  
  const results = await auditor.runCompleteAudit({
    dryRun: options.dryRun !== false // Default to dry run
  });
  
  return results;
}

// Export for use in other files
module.exports = {
  ReferralAudit,
  runReferralAudit
};

// If running directly
if (require.main === module) {
  // Command line execution
  const args = process.argv.slice(2);
  const dryRun = !args.includes('--execute');
  
  runReferralAudit({ dryRun })
    .then(results => {
      console.log('\n🎉 Audit completed!');
      if (dryRun) {
        console.log('ℹ️  This was a dry run. Use --execute flag to apply fixes.');
      }
      process.exit(0);
    })
    .catch(error => {
      console.error('💥 Audit failed:', error);
      process.exit(1);
    });
}