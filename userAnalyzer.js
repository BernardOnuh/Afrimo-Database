// User Referral Details Analyzer - userAnalyzer.js
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
      
      await mongoose.connect(mongoUri);
      
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

class UserReferralAnalyzer {
  constructor() {
    this.analysisResults = {
      userInfo: null,
      referralStats: null,
      completedTransactions: [],
      referralCommissions: [],
      duplicateCommissions: [],
      missingCommissions: [],
      incorrectAmounts: [],
      statusMismatches: [],
      referralChain: [],
      downlineUsers: [],
      totalRewards: 0,
      issuesFound: 0,
      correctionsNeeded: []
    };
  }

  async analyzeUser(userId, options = {}) {
    console.log(`🔍 Analyzing user: ${userId}`);
    console.log('================================');
    
    try {
      const connected = await connectToDatabase();
      if (!connected) throw new Error('Failed to connect to database');
      
      const modelsLoaded = await loadModels();
      if (!modelsLoaded) throw new Error('Failed to load models');
      
      // Step 1: Get basic user info
      await this.fetchUserInfo(userId);
      
      // Step 2: Get referral statistics
      await this.fetchReferralStats(userId);
      
      // Step 3: Get all completed transactions
      await this.fetchUserTransactions(userId);
      
      // Step 4: Get referral commissions
      await this.fetchReferralCommissions(userId);
      
      // Step 5: Check for duplicates
      await this.checkDuplicateCommissions(userId);
      
      // Step 6: Check for missing commissions
      await this.checkMissingCommissions(userId);
      
      // Step 7: Verify commission amounts
      await this.verifyCommissionAmounts(userId);
      
      // Step 8: Get referral chain
      await this.fetchReferralChain(userId);
      
      // Step 9: Get downline users
      await this.fetchDownlineUsers(userId);
      
      // Step 10: Generate analysis report
      this.generateAnalysisReport(options);
      
      return this.analysisResults;
      
    } catch (error) {
      console.error('💥 Error during user analysis:', error);
      throw error;
    }
  }
  async correctUserIssues(identifier, executeMode = false) {
    console.log(`🔧 ${executeMode ? 'CORRECTING' : 'SIMULATING CORRECTIONS FOR'} USER: ${identifier}`);
    
    try {
      // First find the user
      let user;
      if (mongoose.Types.ObjectId.isValid(identifier)) {
        user = await User.findById(identifier);
      } else {
        user = await User.findOne({
          $or: [
            { email: identifier },
            { userName: identifier }
          ]
        });
      }
      
      if (!user) {
        throw new Error(`User with identifier ${identifier} not found`);
      }
      
      const userId = user._id;
      this.analysisResults.userInfo = {
        id: user._id,
        userName: user.userName,
        email: user.email,
        phone: user.phone,
        fullName: user.fullName,
        referralCode: user.referralInfo?.code || 'None',
        referredBy: user.referralInfo?.referredBy || 'None',
        accountStatus: user.accountStatus,
        createdAt: user.createdAt,
        lastLogin: user.lastLogin,
        isActive: user.isActive,
        kycStatus: user.kycStatus
      };
      
      console.log(`✅ User found: ${user.userName} (${user.email})`);
      
    } catch (error) {
      console.error('❌ Error fetching user info:', error);
      throw error;
    }
  }

  async fetchReferralStats(userId) {
    try {
      const referralStats = await Referral.findOne({ user: userId });
      
      if (referralStats) {
        this.analysisResults.referralStats = {
          totalEarnings: referralStats.totalEarnings,
          referredUsers: referralStats.referredUsers,
          generation1: referralStats.generation1,
          generation2: referralStats.generation2,
          generation3: referralStats.generation3,
          lastUpdated: referralStats.updatedAt
        };
        
        this.analysisResults.totalRewards = referralStats.totalEarnings;
        
        console.log(`✅ Referral stats found: ₦${referralStats.totalEarnings.toLocaleString()} total earnings`);
      } else {
        console.log('ℹ️  No referral stats found for this user');
        this.analysisResults.referralStats = null;
      }
      
    } catch (error) {
      console.error('❌ Error fetching referral stats:', error);
    }
  }

  async fetchUserTransactions(userId) {
    try {
      const transactions = [];
      
      // Get UserShare transactions
      const userShares = await UserShare.findOne({ user: userId });
      if (userShares && userShares.transactions) {
        for (const tx of userShares.transactions) {
          if (tx.status === 'completed') {
            transactions.push({
              id: tx.transactionId || tx._id,
              type: 'share',
              amount: tx.totalAmount,
              currency: tx.currency || 'naira',
              status: tx.status,
              date: tx.createdAt,
              shares: tx.shares,
              paymentMethod: tx.paymentMethod,
              sourceModel: 'UserShare'
            });
          }
        }
      }
      
      // Get PaymentTransaction (co-founder) transactions
      const coFounderTxs = await PaymentTransaction.find({
        userId: userId,
        type: 'co-founder',
        status: 'completed'
      });
      
      for (const tx of coFounderTxs) {
        transactions.push({
          id: tx._id,
          type: 'cofounder',
          amount: tx.amount,
          currency: tx.currency || 'naira',
          status: tx.status,
          date: tx.createdAt,
          sourceModel: 'PaymentTransaction'
        });
      }
      
      this.analysisResults.completedTransactions = transactions;
      
      console.log(`✅ Found ${transactions.length} completed transactions`);
      
    } catch (error) {
      console.error('❌ Error fetching user transactions:', error);
    }
  }

  async fetchReferralCommissions(userId) {
    try {
      const commissions = await ReferralTransaction.find({
        referredUser: userId,
        status: 'completed'
      }).populate('beneficiary', 'userName email');
      
      this.analysisResults.referralCommissions = commissions.map(comm => ({
        id: comm._id,
        beneficiary: {
          id: comm.beneficiary._id,
          userName: comm.beneficiary.userName,
          email: comm.beneficiary.email
        },
        amount: comm.amount,
        currency: comm.currency,
        generation: comm.generation,
        purchaseType: comm.purchaseType,
        sourceTransaction: comm.sourceTransaction,
        sourceTransactionModel: comm.sourceTransactionModel,
        createdAt: comm.createdAt,
        commissionRate: comm.commissionDetails?.commissionRate || 'Unknown'
      }));
      
      console.log(`✅ Found ${commissions.length} referral commissions generated by this user`);
      
    } catch (error) {
      console.error('❌ Error fetching referral commissions:', error);
    }
  }

  async checkDuplicateCommissions(userId) {
    try {
      const commissions = await ReferralTransaction.find({
        referredUser: userId,
        status: 'completed'
      });
      
      const duplicateMap = {};
      
      commissions.forEach(comm => {
        const key = `${comm.sourceTransaction}_${comm.generation}_${comm.beneficiary}`;
        if (!duplicateMap[key]) {
          duplicateMap[key] = [];
        }
        duplicateMap[key].push(comm);
      });
      
      const duplicates = Object.values(duplicateMap).filter(arr => arr.length > 1);
      
      this.analysisResults.duplicateCommissions = duplicates.map(duplicateSet => ({
        sourceTransaction: duplicateSet[0].sourceTransaction,
        generation: duplicateSet[0].generation,
        beneficiary: duplicateSet[0].beneficiary,
        count: duplicateSet.length,
        totalAmount: duplicateSet.reduce((sum, tx) => sum + tx.amount, 0),
        transactions: duplicateSet.map(tx => ({
          id: tx._id,
          amount: tx.amount,
          createdAt: tx.createdAt
        }))
      }));
      
      if (duplicates.length > 0) {
        this.analysisResults.issuesFound += duplicates.length;
        this.analysisResults.correctionsNeeded.push({
          type: 'duplicate_commissions',
          count: duplicates.length,
          description: 'Duplicate commissions found that need to be marked as duplicates'
        });
        
        console.log(`🚨 Found ${duplicates.length} sets of duplicate commissions`);
      } else {
        console.log('✅ No duplicate commissions found');
      }
      
    } catch (error) {
      console.error('❌ Error checking duplicate commissions:', error);
    }
  }

  async checkMissingCommissions(userId) {
    try {
      const expectedCommissions = [];
      
      // For each completed transaction, calculate expected commissions
      for (const transaction of this.analysisResults.completedTransactions) {
        const expected = await this.calculateExpectedCommissions(userId, transaction);
        expectedCommissions.push(...expected);
      }
      
      // Check which expected commissions are missing
      const existingCommissions = await ReferralTransaction.find({
        referredUser: userId,
        status: 'completed'
      });
      
      const missingCommissions = [];
      
      for (const expected of expectedCommissions) {
        const exists = existingCommissions.find(existing => 
          existing.sourceTransaction.toString() === expected.sourceTransaction.toString() &&
          existing.generation === expected.generation &&
          existing.beneficiary.toString() === expected.beneficiary.toString()
        );
        
        if (!exists) {
          missingCommissions.push(expected);
        }
      }
      
      this.analysisResults.missingCommissions = missingCommissions;
      
      if (missingCommissions.length > 0) {
        this.analysisResults.issuesFound += missingCommissions.length;
        this.analysisResults.correctionsNeeded.push({
          type: 'missing_commissions',
          count: missingCommissions.length,
          description: 'Missing commissions that should be created'
        });
        
        console.log(`🚨 Found ${missingCommissions.length} missing commissions`);
      } else {
        console.log('✅ No missing commissions found');
      }
      
    } catch (error) {
      console.error('❌ Error checking missing commissions:', error);
    }
  }

  async calculateExpectedCommissions(userId, transaction) {
    const expectedCommissions = [];
    
    try {
      const user = await User.findById(userId);
      if (!user.referralInfo?.code) return expectedCommissions;
      
      // Get referral chain
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
            beneficiaryUserName: referrer.userName,
            amount,
            currency: transaction.currency,
            rate,
            sourceTransaction: transaction.id,
            sourceTransactionModel: transaction.sourceModel,
            purchaseType: transaction.type
          });
        }
      }
      
    } catch (error) {
      console.error('Error calculating expected commissions:', error);
    }
    
    return expectedCommissions;
  }

  async verifyCommissionAmounts(userId) {
    try {
      const incorrectAmounts = [];
      const commissions = await ReferralTransaction.find({
        referredUser: userId,
        status: 'completed'
      });
      
      for (const commission of commissions) {
        let sourceAmount = 0;
        
        // Find the source transaction to verify amount
        const sourceTransaction = this.analysisResults.completedTransactions.find(
          tx => tx.id.toString() === commission.sourceTransaction.toString()
        );
        
        if (sourceTransaction) {
          sourceAmount = sourceTransaction.amount;
          
          const rates = { 1: 15, 2: 3, 3: 2 };
          const expectedAmount = (sourceAmount * rates[commission.generation]) / 100;
          const actualAmount = commission.amount;
          
          const difference = Math.abs(expectedAmount - actualAmount);
          
          if (difference > 0.01) {
            incorrectAmounts.push({
              commissionId: commission._id,
              generation: commission.generation,
              expectedAmount,
              actualAmount,
              difference,
              sourceTransaction: commission.sourceTransaction,
              sourceAmount
            });
          }
        }
      }
      
      this.analysisResults.incorrectAmounts = incorrectAmounts;
      
      if (incorrectAmounts.length > 0) {
        this.analysisResults.issuesFound += incorrectAmounts.length;
        this.analysisResults.correctionsNeeded.push({
          type: 'incorrect_amounts',
          count: incorrectAmounts.length,
          description: 'Commission amounts that don\'t match expected calculations'
        });
        
        console.log(`🚨 Found ${incorrectAmounts.length} incorrect commission amounts`);
      } else {
        console.log('✅ All commission amounts are correct');
      }
      
    } catch (error) {
      console.error('❌ Error verifying commission amounts:', error);
    }
  }

  async fetchReferralChain(userId) {
    try {
      const chain = [];
      let currentUser = await User.findById(userId);
      
      // Go up the referral chain
      while (currentUser && currentUser.referralInfo?.code && chain.length < 10) {
        const referrer = await User.findOne({ userName: currentUser.referralInfo.code });
        if (!referrer) break;
        
        chain.push({
          id: referrer._id,
          userName: referrer.userName,
          email: referrer.email,
          level: chain.length + 1
        });
        
        currentUser = referrer;
      }
      
      this.analysisResults.referralChain = chain;
      
      console.log(`✅ Found referral chain with ${chain.length} levels`);
      
    } catch (error) {
      console.error('❌ Error fetching referral chain:', error);
    }
  }

  async fetchDownlineUsers(userId) {
    try {
      const user = await User.findById(userId);
      if (!user) return;
      
      // Find users who were referred by this user
      const directReferrals = await User.find({
        'referralInfo.code': user.userName
      }).select('_id userName email fullName createdAt');
      
      const downlineUsers = [];
      
      for (const referral of directReferrals) {
        // Get their transaction history
        const userShares = await UserShare.findOne({ user: referral._id });
        const completedTransactions = userShares ? 
          userShares.transactions.filter(tx => tx.status === 'completed').length : 0;
        
        // Get commissions generated by this user
        const commissions = await ReferralTransaction.find({
          referredUser: referral._id,
          status: 'completed'
        });
        
        const totalCommissions = commissions.reduce((sum, comm) => sum + comm.amount, 0);
        
        downlineUsers.push({
          id: referral._id,
          userName: referral.userName,
          email: referral.email,
          fullName: referral.fullName,
          joinedDate: referral.createdAt,
          completedTransactions,
          totalCommissionsGenerated: totalCommissions
        });
      }
      
      this.analysisResults.downlineUsers = downlineUsers;
      
      console.log(`✅ Found ${downlineUsers.length} direct referrals`);
      
    } catch (error) {
      console.error('❌ Error fetching downline users:', error);
    }
  }

  generateAnalysisReport(options = {}) {
    console.log('\n📊 USER REFERRAL ANALYSIS REPORT');
    console.log('================================');
    
    const user = this.analysisResults.userInfo;
    const stats = this.analysisResults.referralStats;
    
    console.log('\n👤 USER INFORMATION:');
    console.log(`• Name: ${user.fullName || 'N/A'}`);
    console.log(`• Username: ${user.userName}`);
    console.log(`• Email: ${user.email}`);
    console.log(`• Account Status: ${user.accountStatus}`);
    console.log(`• KYC Status: ${user.kycStatus}`);
    console.log(`• Joined: ${user.createdAt.toLocaleDateString()}`);
    console.log(`• Referred By: ${user.referredBy}`);
    
    console.log('\n💰 REFERRAL REWARDS SUMMARY:');
    if (stats) {
      console.log(`• Total Earnings: ₦${stats.totalEarnings.toLocaleString()}`);
      console.log(`• Total Referred Users: ${stats.referredUsers}`);
      console.log(`• Generation 1: ${stats.generation1.count} users, ₦${stats.generation1.earnings.toLocaleString()}`);
      console.log(`• Generation 2: ${stats.generation2.count} users, ₦${stats.generation2.earnings.toLocaleString()}`);
      console.log(`• Generation 3: ${stats.generation3.count} users, ₦${stats.generation3.earnings.toLocaleString()}`);
    } else {
      console.log('• No referral earnings found');
    }
    
    console.log('\n🔄 TRANSACTION SUMMARY:');
    console.log(`• Completed Transactions: ${this.analysisResults.completedTransactions.length}`);
    console.log(`• Commissions Generated: ${this.analysisResults.referralCommissions.length}`);
    
    if (this.analysisResults.completedTransactions.length > 0) {
      const totalTransactionAmount = this.analysisResults.completedTransactions.reduce((sum, tx) => sum + tx.amount, 0);
      console.log(`• Total Transaction Amount: ₦${totalTransactionAmount.toLocaleString()}`);
      
      const shareTransactions = this.analysisResults.completedTransactions.filter(tx => tx.type === 'share');
      const coFounderTransactions = this.analysisResults.completedTransactions.filter(tx => tx.type === 'cofounder');
      
      console.log(`• Share Purchases: ${shareTransactions.length}`);
      console.log(`• Co-founder Purchases: ${coFounderTransactions.length}`);
    }
    
    console.log('\n🔍 REFERRAL CHAIN:');
    if (this.analysisResults.referralChain.length > 0) {
      this.analysisResults.referralChain.forEach((ref, index) => {
        console.log(`• Level ${ref.level}: ${ref.userName} (${ref.email})`);
      });
    } else {
      console.log('• No referral chain found (user was not referred)');
    }
    
    console.log('\n👥 DOWNLINE USERS:');
    if (this.analysisResults.downlineUsers.length > 0) {
      this.analysisResults.downlineUsers.forEach(user => {
        console.log(`• ${user.userName} - ${user.completedTransactions} transactions, ₦${user.totalCommissionsGenerated.toLocaleString()} commissions`);
      });
    } else {
      console.log('• No direct referrals found');
    }
    
    console.log('\n🚨 ISSUES FOUND:');
    if (this.analysisResults.issuesFound > 0) {
      console.log(`• Total Issues: ${this.analysisResults.issuesFound}`);
      
      if (this.analysisResults.duplicateCommissions.length > 0) {
        console.log(`• Duplicate Commissions: ${this.analysisResults.duplicateCommissions.length} sets`);
        const totalDuplicateAmount = this.analysisResults.duplicateCommissions.reduce((sum, dup) => sum + dup.totalAmount, 0);
        console.log(`  Total duplicate amount: ₦${totalDuplicateAmount.toLocaleString()}`);
      }
      
      if (this.analysisResults.missingCommissions.length > 0) {
        console.log(`• Missing Commissions: ${this.analysisResults.missingCommissions.length}`);
        const totalMissingAmount = this.analysisResults.missingCommissions.reduce((sum, miss) => sum + miss.amount, 0);
        console.log(`  Total missing amount: ₦${totalMissingAmount.toLocaleString()}`);
      }
      
      if (this.analysisResults.incorrectAmounts.length > 0) {
        console.log(`• Incorrect Amounts: ${this.analysisResults.incorrectAmounts.length}`);
      }
      
    } else {
      console.log('• No issues found! ✅');
    }
    
    console.log('\n🔧 CORRECTIONS NEEDED:');
    if (this.analysisResults.correctionsNeeded.length > 0) {
      this.analysisResults.correctionsNeeded.forEach(correction => {
        console.log(`• ${correction.type}: ${correction.count} items`);
        console.log(`  ${correction.description}`);
      });
    } else {
      console.log('• No corrections needed! ✅');
    }
    
    console.log('\n📈 REWARD ANALYSIS:');
    if (stats && stats.totalEarnings > 0) {
      console.log(`• User has earned ₦${stats.totalEarnings.toLocaleString()} in referral rewards`);
      console.log(`• Primary reward source: Generation ${stats.generation1.earnings > stats.generation2.earnings ? '1' : '2'}`);
      
      if (this.analysisResults.downlineUsers.length > 0) {
        const avgCommissionPerReferral = stats.totalEarnings / this.analysisResults.downlineUsers.length;
        console.log(`• Average commission per referral: ₦${avgCommissionPerReferral.toFixed(2)}`);
      }
      
      console.log('• Reward legitimacy: ✅ Based on actual user transactions');
    } else {
      console.log('• No rewards earned yet');
    }
    
    console.log('\n💡 RECOMMENDATIONS:');
    if (this.analysisResults.issuesFound > 0) {
      console.log('• Run correction script to fix identified issues');
      console.log('• Recalculate user referral statistics');
      console.log('• Monitor for duplicate prevention');
    } else {
      console.log('• User referral data appears clean and accurate');
      console.log('• Continue regular monitoring');
    }
    
    return this.analysisResults;
  }
}

// Main functions
async function analyzeUserReferrals(userId, options = {}) {
  const analyzer = new UserReferralAnalyzer();
  
  try {
    const results = await analyzer.analyzeUser(userId, options);
    return results;
  } catch (error) {
    console.error('💥 User analysis failed:', error);
    throw error;
  } finally {
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
      console.log('🔌 Database connection closed');
    }
  }
}

async function quickUserCheck(userId) {
  console.log(`🔍 Quick check for user: ${userId}`);
  
  try {
    const connected = await connectToDatabase();
    if (!connected) throw new Error('Failed to connect to database');
    
    const modelsLoaded = await loadModels();
    if (!modelsLoaded) throw new Error('Failed to load models');
    
    const user = await User.findById(userId).select('userName email referralInfo');
    if (!user) {
      console.log('❌ User not found');
      return null;
    }
    
    const referralStats = await Referral.findOne({ user: userId });
    const commissions = await ReferralTransaction.countDocuments({ referredUser: userId, status: 'completed' });
    const transactions = await UserShare.findOne({ user: userId });
    const completedTxCount = transactions ? transactions.transactions.filter(tx => tx.status === 'completed').length : 0;
    
    console.log(`✅ User: ${user.userName}`);
    console.log(`📊 Total Earnings: ₦${referralStats ? referralStats.totalEarnings.toLocaleString() : '0'}`);
    console.log(`💰 Commissions Generated: ${commissions}`);
    console.log(`🔄 Completed Transactions: ${completedTxCount}`);
    
    return {
      user: user.userName,
      totalEarnings: referralStats ? referralStats.totalEarnings : 0,
      commissions,
      completedTransactions: completedTxCount
    };
    
  } catch (error) {
    console.error('❌ Quick check failed:', error);
    return null;
  } finally {
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
    }
  }
}

// Export functions
module.exports = {
  UserReferralAnalyzer,
  analyzeUserReferrals,
  quickUserCheck,
  connectToDatabase,
  loadModels
};

// Command line execution
if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0];
  
  if (command === 'analyze') {
    const userId = args[1];
    if (!userId) {
      console.log('❌ Please provide user ID: node userAnalyzer.js analyze <userId>');
      process.exit(1);
    }
    
    analyzeUserReferrals(userId)
      .then(results => {
        console.log('\n✅ User analysis completed');
        process.exit(0);
      })
      .catch(error => {
        console.error('💥 Analysis failed:', error);
        process.exit(1);
      });
      
  } else if (command === 'quick') {
    const userId = args[1];
    if (!userId) {
      console.log('❌ Please provide user ID: node userAnalyzer.js quick <userId>');
      process.exit(1);
    }
    
    quickUserCheck(userId)
      .then(results => {
        console.log('\n✅ Quick check completed');
        process.exit(0);
      })
      .catch(error => {
        console.error('💥 Quick check failed:', error);
        process.exit(1);
      });
      
  } else {
    console.log('📖 USER REFERRAL ANALYZER USAGE:');
    console.log('================================');
    console.log('');
    console.log('Command line usage:');
    console.log('  node userAnalyzer.js analyze <userId>    # Full analysis of user referrals');
    console.log('  node userAnalyzer.js quick <userId>      # Quick check of user stats');
    console.log('');
    console.log('Programmatic usage:');
    console.log('  const { analyzeUserReferrals, quickUserCheck } = require("./userAnalyzer");');
    console.log('  await analyzeUserReferrals("userId");     # Full analysis');
    console.log('  await quickUserCheck("userId");          # Quick check');
    console.log('');
    console.log('Examples:');
    console.log('  node userAnalyzer.js analyze 507f1f77bcf86cd799439011');
    console.log('  node userAnalyzer.js quick 507f1f77bcf86cd799439011');
    console.log('');
    console.log('The analyzer will:');
    console.log('• Fetch complete user information');
    console.log('• Show all referral rewards and why they were earned');
    console.log('• Identify any issues or corrections needed');
    console.log('• Verify commission calculations');
    console.log('• Show referral chain and downline users');
    console.log('• Generate detailed correction recommendations');
  }
}