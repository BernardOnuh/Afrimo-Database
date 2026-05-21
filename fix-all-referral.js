require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/User');
const Referral = require('./models/Referral');
const ReferralTransaction = require('./models/ReferralTransaction');
const UserShare = require('./models/UserShare');

async function fetchAllReferralDetails() {
  try {
    console.log('🔍 FETCHING ALL REFERRAL DETAILS...');
    
    const mongoUri = process.env.MONGODB_URI;
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB');

    // Users to investigate
    const userNames = ['DML','Danny73', 'Nkechi2020', 'Adjoa1985','Iykomo84'];

    for (const userName of userNames) {
      console.log(`\n${'='.repeat(80)}`);
      console.log(`👤 ANALYZING: ${userName.toUpperCase()}`);
      console.log(`${'='.repeat(80)}`);

      // Find the user
      const user = await User.findOne({ userName });
      if (!user) {
        console.log(`❌ User ${userName} not found`);
        continue;
      }

      console.log(`📋 USER BASIC INFO:`);
      console.log(`   ID: ${user._id}`);
      console.log(`   Name: ${user.name || 'Not provided'}`);
      console.log(`   Email: ${user.email}`);
      console.log(`   Username: ${user.userName}`);
      console.log(`   Phone: ${user.phoneNumber || 'Not provided'}`);
      console.log(`   Created: ${user.createdAt}`);
      console.log(`   Status: ${user.isActive ? 'Active' : 'Inactive'}`);

      // Referral Info
      console.log(`\n🔗 REFERRAL INFO:`);
      if (user.referralInfo) {
        console.log(`   Referred by: ${user.referralInfo.referrer || user.referralInfo.code || 'Direct signup'}`);
        console.log(`   Referral code: ${user.referralInfo.code || 'None'}`);
        console.log(`   Generation: ${user.referralInfo.generation || 'N/A'}`);
      } else {
        console.log(`   No referral info found`);
      }

      // Find their referrer details
      let referrerUser = null;
      if (user.referralInfo?.code) {
        referrerUser = await User.findOne({ userName: user.referralInfo.code });
        if (referrerUser) {
          console.log(`   Referrer details: ${referrerUser.name} (${referrerUser.email})`);
        }
      } else if (user.referralInfo?.referrer) {
        if (mongoose.Types.ObjectId.isValid(user.referralInfo.referrer)) {
          referrerUser = await User.findById(user.referralInfo.referrer);
        } else {
          referrerUser = await User.findOne({ userName: user.referralInfo.referrer });
        }
        if (referrerUser) {
          console.log(`   Referrer details: ${referrerUser.name} (${referrerUser.userName})`);
        }
      }

      // User's own purchases
      console.log(`\n💰 THEIR PURCHASES:`);
      const userShare = await UserShare.findOne({ user: user._id });
      if (userShare && userShare.transactions) {
        const completedPurchases = userShare.transactions.filter(tx => tx.status === 'completed');
        const pendingPurchases = userShare.transactions.filter(tx => tx.status === 'pending');
        const totalPurchased = completedPurchases.reduce((sum, tx) => sum + tx.totalAmount, 0);
        
        console.log(`   Total transactions: ${userShare.transactions.length}`);
        console.log(`   Completed: ${completedPurchases.length}`);
        console.log(`   Pending: ${pendingPurchases.length}`);
        console.log(`   Total amount purchased: ${totalPurchased.toFixed(2)}`);
        
        if (completedPurchases.length > 0) {
          console.log(`   Purchase details:`);
          completedPurchases.forEach((purchase, idx) => {
            console.log(`      ${idx + 1}. ${purchase.totalAmount} - ${purchase.shares || 'N/A'} shares - ${purchase.createdAt || 'Unknown date'}`);
            console.log(`         Currency: ${purchase.currency || 'USD'}, Type: ${purchase.purchaseType || 'Unknown'}`);
          });
        }
      } else {
        console.log(`   No purchases found`);
      }

      // People they referred
      console.log(`\n👥 PEOPLE THEY REFERRED:`);
      const referredUsers = await User.find({
        $or: [
          { 'referralInfo.code': userName },
          { 'referralInfo.referrer': userName },
          { 'referralInfo.referrer': user._id }
        ]
      });

      console.log(`   Total referred users: ${referredUsers.length}`);
      
      if (referredUsers.length > 0) {
        for (const referredUser of referredUsers) {
          const referredUserShare = await UserShare.findOne({ user: referredUser._id });
          const completedPurchases = referredUserShare ? 
            referredUserShare.transactions.filter(tx => tx.status === 'completed') : [];
          const totalPurchased = completedPurchases.reduce((sum, tx) => sum + tx.totalAmount, 0);
          
          console.log(`   • ${referredUser.userName} (${referredUser.name || 'No name'})`);
          console.log(`     Email: ${referredUser.email}`);
          console.log(`     Joined: ${referredUser.createdAt}`);
          console.log(`     Purchases: ${completedPurchases.length} completed, ${totalPurchased.toFixed(2)} total`);
          
          if (completedPurchases.length > 0) {
            completedPurchases.forEach((purchase, idx) => {
              console.log(`       ${idx + 1}. ${purchase.totalAmount} on ${purchase.createdAt || 'Unknown'}`);
            });
          }
        }
      }

      // Their referral earnings
      console.log(`\n💵 REFERRAL EARNINGS:`);
      
      // Check Referral document
      const referralDoc = await Referral.findOne({ user: user._id });
      if (referralDoc) {
        console.log(`   From Referral document:`);
        console.log(`     Total earnings: ${referralDoc.totalEarnings || 0}`);
        console.log(`     Generation 1: ${referralDoc.generation1?.count || 0} people, ${referralDoc.generation1?.earnings || 0}`);
        console.log(`     Generation 2: ${referralDoc.generation2?.count || 0} people, ${referralDoc.generation2?.earnings || 0}`);
        console.log(`     Generation 3: ${referralDoc.generation3?.count || 0} people, ${referralDoc.generation3?.earnings || 0}`);
        console.log(`     Last updated: ${referralDoc.updatedAt}`);
      } else {
        console.log(`   No Referral document found`);
      }

      // Check ReferralTransaction records
      const referralTransactions = await ReferralTransaction.find({ 
        beneficiary: user._id 
      }).populate('referredUser', 'userName name email').sort({ createdAt: 1 });

      console.log(`\n💳 REFERRAL TRANSACTIONS: ${referralTransactions.length} total`);
      
      if (referralTransactions.length > 0) {
        const gen1Txs = referralTransactions.filter(tx => tx.generation === 1);
        const gen2Txs = referralTransactions.filter(tx => tx.generation === 2);
        const gen3Txs = referralTransactions.filter(tx => tx.generation === 3);
        
        const gen1Total = gen1Txs.reduce((sum, tx) => sum + tx.amount, 0);
        const gen2Total = gen2Txs.reduce((sum, tx) => sum + tx.amount, 0);
        const gen3Total = gen3Txs.reduce((sum, tx) => sum + tx.amount, 0);
        const totalFromTxs = gen1Total + gen2Total + gen3Total;
        
        console.log(`   Generation 1: ${gen1Txs.length} transactions, ${gen1Total.toFixed(2)}`);
        console.log(`   Generation 2: ${gen2Txs.length} transactions, ${gen2Total.toFixed(2)}`);
        console.log(`   Generation 3: ${gen3Txs.length} transactions, ${gen3Total.toFixed(2)}`);
        console.log(`   Total from transactions: ${totalFromTxs.toFixed(2)}`);
        
        // Show individual transactions
        console.log(`\n   📝 Transaction Details:`);
        referralTransactions.forEach((tx, idx) => {
          const referredUserName = tx.referredUser?.userName || 'Unknown';
          console.log(`      ${idx + 1}. ${tx.amount.toFixed(2)} from ${referredUserName} (Gen${tx.generation}) - ${tx.createdAt}`);
          console.log(`         Status: ${tx.status}, Currency: ${tx.currency}, Type: ${tx.purchaseType}`);
        });

        // Check for discrepancies
        if (referralDoc && Math.abs(totalFromTxs - referralDoc.totalEarnings) > 0.01) {
          console.log(`\n   ⚠️  DISCREPANCY FOUND:`);
          console.log(`      Referral doc total: ${referralDoc.totalEarnings}`);
          console.log(`      Transaction total: ${totalFromTxs.toFixed(2)}`);
          console.log(`      Difference: ${(totalFromTxs - referralDoc.totalEarnings).toFixed(2)}`);
        }
      }

      // Check if they appear in other people's referral transactions
      console.log(`\n🔄 TRANSACTIONS WHERE THEY WERE REFERRED:`);
      const transactionsAsReferred = await ReferralTransaction.find({
        referredUser: user._id
      }).populate('beneficiary', 'userName name email');

      if (transactionsAsReferred.length > 0) {
        console.log(`   Found ${transactionsAsReferred.length} transactions where ${userName} was the referred user:`);
        transactionsAsReferred.forEach((tx, idx) => {
          const beneficiaryName = tx.beneficiary?.userName || 'Unknown';
          console.log(`      ${idx + 1}. ${tx.amount.toFixed(2)} to ${beneficiaryName} (Gen${tx.generation}) - ${tx.createdAt}`);
        });
      } else {
        console.log(`   No transactions found where ${userName} was the referred user`);
      }

      // Summary
      console.log(`\n📊 SUMMARY FOR ${userName}:`);
      console.log(`   • Personal purchases: ${userShare ? userShare.transactions.filter(tx => tx.status === 'completed').reduce((sum, tx) => sum + tx.totalAmount, 0).toFixed(2) : '0.00'}`);
      console.log(`   • People referred: ${referredUsers.length}`);
      console.log(`   • Total referral earnings: ${referralTransactions.reduce((sum, tx) => sum + tx.amount, 0).toFixed(2)}`);
      console.log(`   • Referral transactions: ${referralTransactions.length}`);
      console.log(`   • Status: ${referralDoc ? 'Has referral record' : 'No referral record'}`);
    }

    // Overall summary
    console.log(`\n${'='.repeat(80)}`);
    console.log(`📈 OVERALL SUMMARY`);
    console.log(`${'='.repeat(80)}`);

    for (const userName of userNames) {
      const user = await User.findOne({ userName });
      if (!user) continue;

      const userShare = await UserShare.findOne({ user: user._id });
      const referralTxs = await ReferralTransaction.find({ beneficiary: user._id });
      const referredUsers = await User.find({
        $or: [
          { 'referralInfo.code': userName },
          { 'referralInfo.referrer': userName },
          { 'referralInfo.referrer': user._id }
        ]
      });

      const totalPurchased = userShare ? 
        userShare.transactions.filter(tx => tx.status === 'completed').reduce((sum, tx) => sum + tx.totalAmount, 0) : 0;
      const totalEarnings = referralTxs.reduce((sum, tx) => sum + tx.amount, 0);

      console.log(`👤 ${userName}:`);
      console.log(`   Purchased: ${totalPurchased.toFixed(2)} | Referred: ${referredUsers.length} | Earned: ${totalEarnings.toFixed(2)}`);
    }

    await mongoose.connection.close();
    console.log('\n✅ Referral details fetch completed!');
    
  } catch (error) {
    console.error('❌ Error:', error);
    if (mongoose.connection.readyState !== 0) {
      await mongoose.connection.close();
    }
  }
}

// Run the referral details fetch
fetchAllReferralDetails();