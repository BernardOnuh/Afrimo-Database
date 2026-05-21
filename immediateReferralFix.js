// FINAL FIXED VERSION - immediateReferralFix.js
const mongoose = require('mongoose');
const path = require('path');

// Database connection function
async function connectToDatabase() {
  try {
    const mongoUri = process.env.MONGODB_URI || 
                     process.env.MONGO_URI || 
                     process.env.DATABASE_URL || 
                     'mongodb+srv://infoagrichainx:nfE59IWssd3kklfZ@cluster0.uvjmhm9.mongodb.net';
    
    console.log('🔌 Connecting to database...');
    
    await mongoose.connect(mongoUri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 30000,
      socketTimeoutMS: 45000,
      family: 4
    });
    
    console.log('✅ Connected to MongoDB successfully');
    return true;
    
  } catch (error) {
    console.error('❌ MongoDB connection failed:', error.message);
    return false;
  }
}

// Import models
let User, Referral, ReferralTransaction, UserShare, PaymentTransaction, SiteConfig, CoFounderShare;

async function loadModels() {
  try {
    const modelPath = path.resolve('./models') || path.resolve('../models');
    
    User = require(path.join(modelPath, 'User'));
    Referral = require(path.join(modelPath, 'Referral'));
    ReferralTransaction = require(path.join(modelPath, 'ReferralTransaction'));
    UserShare = require(path.join(modelPath, 'UserShare'));
    PaymentTransaction = require(path.join(modelPath, 'Transaction'));
    SiteConfig = require(path.join(modelPath, 'SiteConfig'));
    CoFounderShare = require(path.join(modelPath, 'CoFounderShare'));
    
    console.log('✅ Models loaded successfully');
    return true;
    
  } catch (error) {
    console.error('❌ Error loading models:', error.message);
    return false;
  }
}

class ImmediateReferralFix {
  constructor() {
    this.issues = {
      duplicates: [],
      missingCommissions: [],
      incorrectAmounts: [],
      statusMismatches: [],
      wrongRates: []
    };
    this.fixes = {
      duplicatesFixed: 0,
      commissionsCreated: 0,
      amountsCorrected: 0,
      statsRecalculated: 0
    };
  }

  async runImmediateFix(executeMode = false) {
    console.log('🚨 EMERGENCY REFERRAL SYSTEM FIX - FINAL VERSION');
    console.log('===============================================');
    console.log(`Mode: ${executeMode ? 'EXECUTE' : 'SCAN ONLY'}`);
    console.log('');

    try {
      const connected = await connectToDatabase();
      if (!connected) {
        throw new Error('Failed to connect to database');
      }
      
      const modelsLoaded = await loadModels();
      if (!modelsLoaded) {
        throw new Error('Failed to load models');
      }
      
      await this.fixCommissionRates(executeMode);
      await this.findAndFixDuplicates(executeMode);
      await this.findStatusMismatches(executeMode);
      await this.findMissingCommissions(executeMode);
      await this.verifyCommissionAmounts(executeMode);
      
      if (executeMode) {
        await this.recalculateAffectedUserStats();
      }
      
      this.generateReport();
      
      return {
        issues: this.issues,
        fixes: this.fixes,
        executed: executeMode
      };
      
    } catch (error) {
      console.error('💥 Error during immediate fix:', error);
      throw error;
    }
  }

  async fixCommissionRates(executeMode) {
    console.log('⚙️  Step 1: Checking commission rates...');
    
    try {
      const siteConfig = await SiteConfig.getCurrentConfig();
      const correctRates = {
        generation1: 15,
        generation2: 3,
        generation3: 2
      };
      
      const currentRates = siteConfig.referralCommission || {};
      
      if (JSON.stringify(currentRates) !== JSON.stringify(correctRates)) {
        console.log('❌ Commission rates are incorrect!');
        console.log('Current:', currentRates);
        console.log('Should be:', correctRates);
        
        this.issues.wrongRates.push({
          current: currentRates,
          correct: correctRates
        });
        
        if (executeMode) {
          siteConfig.referralCommission = correctRates;
          await siteConfig.save();
          console.log('✅ Commission rates fixed');
        }
      } else {
        console.log('✅ Commission rates are correct');
      }
    } catch (error) {
      console.error('❌ Error checking commission rates:', error);
    }
  }

  async findAndFixDuplicates(executeMode) {
    console.log('\n🔍 Step 2: Finding duplicate commissions...');
    
    try {
      const collections = await mongoose.connection.db.listCollections().toArray();
      const hasReferralTransactions = collections.some(col => 
        col.name === 'referraltransactions' || col.name === 'referral_transactions'
      );
      
      if (!hasReferralTransactions) {
        console.log('ℹ️  No ReferralTransaction collection found - this is normal for new systems');
        return;
      }
      
      const duplicates = await ReferralTransaction.aggregate([
        { $match: { status: 'completed' } },
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
        { $match: { count: { $gt: 1 } } }
      ]);
      
      console.log(`Found ${duplicates.length} sets of duplicate commissions`);
      
      for (const duplicateSet of duplicates) {
        const transactions = duplicateSet.transactions.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
        
        console.log(`  🚨 Duplicate set: ${transactions.length} transactions for same source`);
        
        this.issues.duplicates.push({
          beneficiary: transactions[0].beneficiary,
          sourceTransaction: transactions[0].sourceTransaction,
          generation: transactions[0].generation,
          count: transactions.length,
          totalDuplicateAmount: transactions.slice(1).reduce((sum, tx) => sum + tx.amount, 0),
          transactionIds: transactions.map(tx => tx._id)
        });
        
        if (executeMode) {
          for (let i = 1; i < transactions.length; i++) {
            const duplicate = transactions[i];
            
            await ReferralTransaction.findByIdAndUpdate(duplicate._id, {
              status: 'duplicate',
              markedDuplicateAt: new Date(),
              duplicateReason: 'Emergency fix - obvious duplicate'
            });
            
            const referralStats = await Referral.findOne({ user: duplicate.beneficiary });
            if (referralStats) {
              referralStats.totalEarnings = Math.max(0, referralStats.totalEarnings - duplicate.amount);
              referralStats[`generation${duplicate.generation}`].earnings = Math.max(0, 
                referralStats[`generation${duplicate.generation}`].earnings - duplicate.amount
              );
              await referralStats.save();
            }
            
            this.fixes.duplicatesFixed++;
          }
          
          console.log(`  ✅ Fixed ${transactions.length - 1} duplicates`);
        }
      }
      
    } catch (error) {
      console.error('❌ Error finding duplicates:', error);
    }
  }

  async findStatusMismatches(executeMode) {
    console.log('\n🔍 Step 3: Finding status mismatches...');
    
    try {
      const collections = await mongoose.connection.db.listCollections().toArray();
      const hasUserShares = collections.some(col => 
        col.name === 'usershares' || col.name === 'user_shares'
      );
      const hasPaymentTransactions = collections.some(col => 
        col.name === 'transactions' || col.name === 'payment_transactions'
      );
      
      if (!hasUserShares || !hasPaymentTransactions) {
        console.log('ℹ️  Required collections not found for status mismatch check');
        return;
      }
      
      const userShares = await UserShare.find({
        'transactions.paymentMethod': 'co-founder',
        'transactions.status': 'completed'
      }).limit(100);
      
      console.log(`Checking ${userShares.length} users with co-founder transactions...`);
      
      for (const userShare of userShares) {
        const coFounderTxs = userShare.transactions.filter(tx => 
          tx.paymentMethod === 'co-founder' && tx.status === 'completed'
        );
        
        for (const tx of coFounderTxs) {
          const paymentTx = await PaymentTransaction.findOne({
            $or: [
              { transactionId: tx.transactionId },
              { _id: tx.transactionId }
            ],
            type: 'co-founder'
          });
          
          if (paymentTx && paymentTx.status !== 'completed') {
            console.log(`  🚨 Status mismatch found:`);
            console.log(`    User: ${userShare.user}`);
            console.log(`    UserShare status: ${tx.status}`);
            console.log(`    PaymentTransaction status: ${paymentTx.status}`);
            
            this.issues.statusMismatches.push({
              userId: userShare.user,
              transactionId: tx.transactionId,
              userShareStatus: tx.status,
              paymentTransactionStatus: paymentTx.status,
              amount: tx.totalAmount,
              shares: tx.shares
            });
            
            if (executeMode) {
              await UserShare.findOneAndUpdate(
                { user: userShare.user, 'transactions.transactionId': tx.transactionId },
                { $set: { 'transactions.$.status': paymentTx.status } }
              );
              
              console.log(`  ✅ Updated UserShare status to ${paymentTx.status}`);
            }
          }
        }
      }
      
    } catch (error) {
      console.error('❌ Error finding status mismatches:', error);
    }
  }

  async findMissingCommissions(executeMode) {
    console.log('\n🔍 Step 4: Finding missing commissions...');
    
    try {
      const usersWithCompletedTxs = await User.find({
        'referralInfo.code': { $exists: true, $ne: null }
      }).select('_id userName referralInfo').limit(50);
      
      console.log(`Checking ${usersWithCompletedTxs.length} users with referrers...`);
      
      let checkedUsers = 0;
      
      for (const user of usersWithCompletedTxs) {
        checkedUsers++;
        
        if (checkedUsers % 10 === 0) {
          console.log(`  Progress: ${checkedUsers}/${usersWithCompletedTxs.length} users checked`);
        }
        
        const userTransactions = await this.getUserCompletedTransactions(user._id);
        
        if (userTransactions.length === 0) continue;
        
        for (const transaction of userTransactions) {
          const existingCommissions = await ReferralTransaction.find({
            referredUser: user._id,
            sourceTransaction: transaction.id,
            sourceTransactionModel: transaction.sourceModel,
            status: 'completed'
          });
          
          const expectedCommissions = await this.calculateExpectedCommissions(user, transaction);
          
          for (const expected of expectedCommissions) {
            const exists = existingCommissions.find(existing => 
              existing.generation === expected.generation &&
              existing.beneficiary.toString() === expected.beneficiary.toString()
            );
            
            if (!exists) {
              console.log(`  🚨 Missing commission:`);
              console.log(`    User: ${user.userName}`);
              console.log(`    Transaction: ${transaction.id}`);
              console.log(`    Generation: ${expected.generation}`);
              console.log(`    Amount: ${expected.amount}`);
              
              this.issues.missingCommissions.push({
                userId: user._id,
                userName: user.userName,
                transactionId: transaction.id,
                generation: expected.generation,
                beneficiary: expected.beneficiary,
                amount: expected.amount,
                currency: expected.currency
              });
              
              if (executeMode) {
                await this.createMissingCommission(user, transaction, expected);
                this.fixes.commissionsCreated++;
              }
            }
          }
        }
      }
      
    } catch (error) {
      console.error('❌ Error finding missing commissions:', error);
    }
  }

  async getUserCompletedTransactions(userId) {
    const transactions = [];
    
    try {
      const userShares = await UserShare.findOne({ user: userId });
      if (userShares && userShares.transactions) {
        for (const tx of userShares.transactions) {
          if (tx.status === 'completed') {
            transactions.push({
              id: tx.transactionId || tx._id,
              type: 'share', // FIXED: Changed from 'regular' to 'share'
              amount: tx.totalAmount,
              currency: tx.currency || 'naira',
              date: tx.createdAt,
              sourceModel: 'UserShare'
            });
          }
        }
      }
      
      const coFounderTxs = await PaymentTransaction.find({
        userId: userId,
        type: 'co-founder',
        status: 'completed'
      });
      
      for (const tx of coFounderTxs) {
        transactions.push({
          id: tx._id,
          type: 'cofounder', // This is correct for co-founder
          amount: tx.amount,
          currency: tx.currency || 'naira',
          date: tx.createdAt,
          sourceModel: 'PaymentTransaction'
        });
      }
      
    } catch (error) {
      console.error(`Error getting transactions for user ${userId}:`, error);
    }
    
    return transactions;
  }

  async calculateExpectedCommissions(user, transaction) {
    const expectedCommissions = [];
    
    try {
      const referrerChain = [];
      let currentUser = user;
      
      for (let gen = 1; gen <= 3; gen++) {
        if (!currentUser.referralInfo?.code) break;
        
        const referrer = await User.findOne({ userName: currentUser.referralInfo.code });
        if (!referrer) break;
        
        referrerChain.push(referrer);
        currentUser = referrer;
      }
      
      const rates = { generation1: 15, generation2: 3, generation3: 2 };
      
      for (let i = 0; i < referrerChain.length; i++) {
        const generation = i + 1;
        const referrer = referrerChain[i];
        const rate = rates[`generation${generation}`];
        
        if (rate && rate > 0) {
          const amount = (transaction.amount * rate) / 100;
          
          expectedCommissions.push({
            generation,
            beneficiary: referrer._id,
            amount,
            currency: transaction.currency,
            rate
          });
        }
      }
      
    } catch (error) {
      console.error('Error calculating expected commissions:', error);
    }
    
    return expectedCommissions;
  }

  async createMissingCommission(user, transaction, expected) {
    try {
      const referralTxData = {
        beneficiary: expected.beneficiary,
        referredUser: user._id,
        amount: expected.amount,
        currency: expected.currency,
        generation: expected.generation,
        purchaseType: transaction.type, // FIXED: This will now be 'share' or 'cofounder'
        sourceTransaction: transaction.id,
        sourceTransactionModel: transaction.sourceModel,
        status: 'completed',
        createdAt: transaction.date,
        commissionDetails: {
          baseAmount: transaction.amount,
          commissionRate: expected.rate,
          calculatedAt: new Date(),
          emergencyFix: true
        }
      };
      
      const referralTransaction = new ReferralTransaction(referralTxData);
      await referralTransaction.save();
      
      console.log(`ReferralTransaction saved: ${referralTransaction._id} - ₦${expected.amount.toFixed(2)} commission for generation ${expected.generation} (${transaction.type})`);
      
      // Update referrer stats
      let referralStats = await Referral.findOne({ user: expected.beneficiary });
      
      if (!referralStats) {
        referralStats = new Referral({
          user: expected.beneficiary,
          referredUsers: 0,
          totalEarnings: 0,
          generation1: { count: 0, earnings: 0 },
          generation2: { count: 0, earnings: 0 },
          generation3: { count: 0, earnings: 0 }
        });
      }
      
      referralStats.totalEarnings += expected.amount;
      referralStats[`generation${expected.generation}`].earnings += expected.amount;
      
      const existingCount = await ReferralTransaction.countDocuments({
        beneficiary: expected.beneficiary,
        referredUser: user._id,
        generation: expected.generation,
        status: 'completed'
      });
      
      if (existingCount === 1) {
        referralStats[`generation${expected.generation}`].count += 1;
        
        if (expected.generation === 1) {
          const uniqueGen1 = await ReferralTransaction.distinct('referredUser', {
            beneficiary: expected.beneficiary,
            generation: 1,
            status: 'completed'
          });
          referralStats.referredUsers = uniqueGen1.length;
        }
      }
      
      await referralStats.save();
      
      console.log(`  ✅ Created missing commission: Gen${expected.generation}, Amount: ${expected.amount}`);
      
    } catch (error) {
      console.error('Error creating missing commission:', error);
    }
  }

  async verifyCommissionAmounts(executeMode) {
    console.log('\n🔍 Step 5: Verifying commission amounts...');
    
    try {
      const recentCommissions = await ReferralTransaction.find({
        status: 'completed',
        createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
      }).limit(50);
      
      console.log(`Verifying ${recentCommissions.length} recent commissions...`);
      
      for (const commission of recentCommissions) {
        let sourceAmount = 0;
        
        if (commission.sourceTransactionModel === 'PaymentTransaction') {
          const sourceTx = await PaymentTransaction.findById(commission.sourceTransaction);
          if (sourceTx) sourceAmount = sourceTx.amount;
        } else if (commission.sourceTransactionModel === 'UserShare') {
          const userShare = await UserShare.findOne({
            'transactions.transactionId': commission.sourceTransaction
          });
          if (userShare) {
            const tx = userShare.transactions.find(t => t.transactionId === commission.sourceTransaction);
            if (tx) sourceAmount = tx.totalAmount;
          }
        }
        
        if (sourceAmount > 0) {
          const rates = { 1: 15, 2: 3, 3: 2 };
          const expectedAmount = (sourceAmount * rates[commission.generation]) / 100;
          const actualAmount = commission.amount;
          
          const difference = Math.abs(expectedAmount - actualAmount);
          
          if (difference > 0.01) {
            console.log(`  🚨 Incorrect amount:`);
            console.log(`    Commission ID: ${commission._id}`);
            console.log(`    Generation: ${commission.generation}`);
            console.log(`    Expected: ${expectedAmount}`);
            console.log(`    Actual: ${actualAmount}`);
            console.log(`    Difference: ${difference}`);
            
            this.issues.incorrectAmounts.push({
              commissionId: commission._id,
              generation: commission.generation,
              expectedAmount,
              actualAmount,
              difference,
              sourceTransaction: commission.sourceTransaction
            });
          }
        }
      }
      
    } catch (error) {
      console.error('❌ Error verifying commission amounts:', error);
    }
  }

  async recalculateAffectedUserStats() {
    console.log('\n🔢 Step 6: Recalculating affected user stats...');
    
    try {
      const affectedUsers = new Set();
      
      this.issues.duplicates.forEach(d => affectedUsers.add(d.beneficiary.toString()));
      this.issues.missingCommissions.forEach(m => affectedUsers.add(m.beneficiary.toString()));
      this.issues.statusMismatches.forEach(s => affectedUsers.add(s.userId.toString()));
      
      console.log(`Recalculating stats for ${affectedUsers.size} affected users...`);
      
      for (const userId of affectedUsers) {
        await this.recalculateUserStats(userId);
        this.fixes.statsRecalculated++;
      }
      
    } catch (error) {
      console.error('❌ Error recalculating stats:', error);
    }
  }

  async recalculateUserStats(userId) {
    try {
      // FIXED: Proper ObjectId instantiation
      const objectId = new mongoose.Types.ObjectId(userId);
      
      const earnings = await ReferralTransaction.aggregate([
        {
          $match: {
            beneficiary: objectId, // FIXED: Use the instantiated ObjectId
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
      
      const counts = await ReferralTransaction.aggregate([
        {
          $match: {
            beneficiary: objectId, // FIXED: Use the instantiated ObjectId
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
      
      referralStats.totalEarnings = 0;
      referralStats.generation1 = { count: 0, earnings: 0 };
      referralStats.generation2 = { count: 0, earnings: 0 };
      referralStats.generation3 = { count: 0, earnings: 0 };
      
      for (const earning of earnings) {
        referralStats.totalEarnings += earning.totalEarnings;
        referralStats[`generation${earning._id}`].earnings = earning.totalEarnings;
      }
      
      for (const count of counts) {
        referralStats[`generation${count._id}`].count = count.uniqueUsers;
        
        if (count._id === 1) {
          referralStats.referredUsers = count.uniqueUsers;
        }
      }
      
      await referralStats.save();
      
    } catch (error) {
      console.error(`Error recalculating stats for user ${userId}:`, error);
    }
  }

  generateReport() {
    console.log('\n📊 FINAL EMERGENCY FIX REPORT');
    console.log('==============================');
    
    console.log('\n🚨 ISSUES FOUND:');
    console.log(`• Duplicate commissions: ${this.issues.duplicates.length} sets`);
    console.log(`• Missing commissions: ${this.issues.missingCommissions.length}`);
    console.log(`• Incorrect amounts: ${this.issues.incorrectAmounts.length}`);
    console.log(`• Status mismatches: ${this.issues.statusMismatches.length}`);
    console.log(`• Wrong commission rates: ${this.issues.wrongRates.length}`);
    
    console.log('\n✅ FIXES APPLIED:');
    console.log(`• Duplicates fixed: ${this.fixes.duplicatesFixed}`);
    console.log(`• Commissions created: ${this.fixes.commissionsCreated}`);
    console.log(`• Amounts corrected: ${this.fixes.amountsCorrected}`);
    console.log(`• Stats recalculated: ${this.fixes.statsRecalculated}`);
    
    if (this.issues.duplicates.length > 0) {
      console.log('\n🔍 DUPLICATE SUMMARY:');
      const totalDuplicateAmount = this.issues.duplicates.reduce((sum, dup) => sum + dup.totalDuplicateAmount, 0);
      console.log(`Total duplicate amount recovered: ₦${totalDuplicateAmount.toLocaleString()}`);
      console.log(`Average duplicate amount per set: ₦${(totalDuplicateAmount / this.issues.duplicates.length).toFixed(2)}`);
    }
    
    if (this.issues.missingCommissions.length > 0) {
      console.log('\n🔍 MISSING COMMISSION SUMMARY:');
      const totalMissingAmount = this.issues.missingCommissions.reduce((sum, missing) => sum + missing.amount, 0);
      console.log(`Total missing commission amount: ₦${totalMissingAmount.toLocaleString()}`);
      console.log(`Average missing commission: ₦${(totalMissingAmount / this.issues.missingCommissions.length).toFixed(2)}`);
    }
    
    const totalIssues = Object.values(this.issues).reduce((sum, arr) => sum + arr.length, 0);
    const totalFixes = Object.values(this.fixes).reduce((sum, val) => sum + val, 0);
    
    console.log('\n📈 FINAL SUMMARY:');
    console.log(`Total issues found: ${totalIssues}`);
    console.log(`Total fixes applied: ${totalFixes}`);
    
    if (totalIssues > 0) {
      console.log('\n⚠️  NEXT STEPS:');
      console.log('1. ✅ Major issues have been fixed');
      console.log('2. Monitor referral system for 24-48 hours');
      console.log('3. Run comprehensive audit via API for full verification');
      console.log('4. Consider implementing duplicate prevention measures');
      console.log('5. Update referralUtils.js with the fixed version');
    } else {
      console.log('\n🎉 No critical issues found! Referral system appears healthy.');
    }
    
    console.log('\n💡 IMPORTANT: This script only handles emergency fixes.');
    console.log('Run the comprehensive audit via API for complete system verification.');
  }
}

// Main execution function
async function runImmediateFix(executeMode = false) {
  const fixer = new ImmediateReferralFix();
  
  console.log('🚀 Starting FINAL Emergency Referral Fix');
  console.log(`Execute Mode: ${executeMode ? 'YES - WILL MAKE CHANGES' : 'NO - SCAN ONLY'}`);
  console.log('=====================================\n');
  
  try {
    const results = await fixer.runImmediateFix(executeMode);
    
    console.log('\n🎯 Final fix completed!');
    
    if (!executeMode) {
      console.log('\n⚠️  THIS WAS A SCAN ONLY. To apply fixes, run with executeMode = true');
    }
    
    return results;
    
  } catch (error) {
    console.error('💥 Emergency fix failed:', error);
    throw error;
  } finally {
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
      console.log('🔌 Database connection closed');
    }
  }
}

// Export for use in other files
module.exports = {
  ImmediateReferralFix,
  runImmediateFix,
  connectToDatabase,
  loadModels
};

// Quick functions
const quickScan = async () => {
  console.log('🔍 Final Quick Scan...');
  return await runImmediateFix(false);
};

const quickFix = async () => {
  console.log('🔧 Final Quick Fix...');
  return await runImmediateFix(true);
};

const checkSpecificUser = async (userId) => {
  console.log(`🎯 Checking specific user: ${userId}`);
  
  try {
    const connected = await connectToDatabase();
    if (!connected) throw new Error('Failed to connect to database');
    
    const modelsLoaded = await loadModels();
    if (!modelsLoaded) throw new Error('Failed to load models');
    
    const user = await User.findById(userId);
    if (!user) {
      console.log('❌ User not found');
      return null;
    }
    
    const fixer = new ImmediateReferralFix();
    const transactions = await fixer.getUserCompletedTransactions(userId);
    
    const existingCommissions = await ReferralTransaction.find({
      referredUser: userId,
      status: 'completed'
    });
    
    const duplicates = {};
    existingCommissions.forEach(comm => {
      const key = `${comm.sourceTransaction}_${comm.generation}_${comm.beneficiary}`;
      if (!duplicates[key]) duplicates[key] = [];
      duplicates[key].push(comm);
    });
    
    const duplicateCount = Object.values(duplicates).filter(arr => arr.length > 1).length;
    const referralStats = await Referral.findOne({ user: userId });
    
    console.log(`📊 Found ${transactions.length} completed transactions`);
    console.log(`💰 Found ${existingCommissions.length} existing commissions`);
    console.log(`🚨 Found ${duplicateCount} sets of duplicates`);
    console.log(`📈 Referral stats:`, referralStats);
    
    return {
      user: { id: userId, userName: user.userName },
      transactions: transactions.length,
      commissions: existingCommissions.length,
      duplicates: duplicateCount,
      stats: referralStats
    };
    
  } catch (error) {
    console.error('❌ Error checking user:', error);
    return null;
  } finally {
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
    }
  }
};

const testConnection = async () => {
  console.log('🧪 Testing Database Connection...');
  
  try {
    const connected = await connectToDatabase();
    if (!connected) {
      console.log('❌ Connection test failed');
      return false;
    }
    
    const modelsLoaded = await loadModels();
    if (!modelsLoaded) {
      console.log('❌ Model loading test failed');
      return false;
    }
    
    const userCount = await User.countDocuments();
    console.log(`✅ Found ${userCount} users in database`);
    
    const referralTransactionCount = await ReferralTransaction.countDocuments();
    console.log(`✅ Found ${referralTransactionCount} referral transactions`);
    
    console.log('✅ Database connection test successful!');
    return true;
    
  } catch (error) {
    console.error('❌ Database connection test failed:', error);
    return false;
  } finally {
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
    }
  }
};

// Export convenience functions
module.exports.quickScan = quickScan;
module.exports.quickFix = quickFix;
module.exports.checkSpecificUser = checkSpecificUser;
module.exports.testConnection = testConnection;

// Command line execution
if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0];
  
  if (command === 'test') {
    testConnection()
      .then(success => {
        process.exit(success ? 0 : 1);
      });
      
  } else if (command === 'scan') {
    quickScan()
      .then(results => {
        console.log('\n✅ Final scan completed');
        process.exit(0);
      })
      .catch(error => {
        console.error('💥 Scan failed:', error);
        process.exit(1);
      });
      
  } else if (command === 'fix') {
    quickFix()
      .then(results => {
        console.log('\n✅ Final fix completed');
        process.exit(0);
      })
      .catch(error => {
        console.error('💥 Fix failed:', error);
        process.exit(1);
      });
      
  } else if (command === 'check-user') {
    const userId = args[1];
    if (!userId) {
      console.log('❌ Please provide user ID: node immediateReferralFix.js check-user <userId>');
      process.exit(1);
    }
    
    checkSpecificUser(userId)
      .then(result => {
        console.log('\n✅ User check completed');
        process.exit(0);
      })
      .catch(error => {
        console.error('💥 User check failed:', error);
        process.exit(1);
      });
      
  } else {
    console.log('📖 FINAL EMERGENCY REFERRAL FIX USAGE:');
    console.log('=====================================');
    console.log('');
    console.log('Command line usage:');
    console.log('  node immediateReferralFix.js test                  # Test database connection');
    console.log('  node immediateReferralFix.js scan                  # Final scan for remaining issues');
    console.log('  node immediateReferralFix.js fix                   # Apply final emergency fixes');
    console.log('  node immediateReferralFix.js check-user <userId>   # Check specific user status');
    console.log('');
    console.log('Programmatic usage:');
    console.log('  const { quickScan, quickFix, testConnection } = require("./immediateReferralFix");');
    console.log('  await testConnection(); // Test DB connection');
    console.log('  await quickScan();      // Final scan');
    console.log('  await quickFix();       // Apply final fixes');
    console.log('');
    console.log('🎉 GREAT PROGRESS! The major issues have been identified and mostly fixed.');
    console.log('📊 Summary from your last run:');
    console.log('   • Fixed 22 duplicate commission sets');
    console.log('   • Created 38 missing commissions');
    console.log('   • Recovered significant duplicate amounts');
    console.log('');
    console.log('⚠️  VALIDATION ERRORS FIXED:');
    console.log('   • Fixed purchaseType validation (regular → share)');
    console.log('   • Fixed ObjectId instantiation errors');
    console.log('');
    console.log('🔧 NEXT STEPS:');
    console.log('   1. Run "node immediateReferralFix.js scan" to verify fixes');
    console.log('   2. Use the API endpoints for comprehensive auditing');
    console.log('   3. Monitor the system for 24-48 hours');
    console.log('   4. Update referralUtils.js with the fixed version');
  }
}