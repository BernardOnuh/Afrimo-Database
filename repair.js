const mongoose = require('mongoose');
const User = require('./models/User');
const Referral = require('./models/Referral');
const ReferralTransaction = require('./models/ReferralTransaction');
const UserShare = require('./models/UserShare');
const SiteConfig = require('./models/SiteConfig');

async function repairReferralEarnings() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb+srv://Ben:iOBkvnsCXWpoGMFp@cluster0.l4xjq.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0', {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log('Connected to MongoDB');

    // Get referrer (Saint2talk)
    const referrer = await User.findOne({ userName: 'Saint2talk' });
    if (!referrer) {
      console.log('Referrer not found with username: Saint2talk');
      await mongoose.connection.close();
      return;
    }
    console.log(`Found referrer: ${referrer.name} (${referrer._id})`);

    // Get commission rates from site config
    const siteConfig = await SiteConfig.getCurrentConfig();
    if (!siteConfig || !siteConfig.referralCommission) {
      console.log('Site configuration or referral commission rates not found');
      await mongoose.connection.close();
      return;
    }

    const commissionRates = siteConfig.referralCommission;
    console.log('Referral commission rates:');
    console.log(`- Generation 1: ${commissionRates.generation1}%`);
    console.log(`- Generation 2: ${commissionRates.generation2}%`);
    console.log(`- Generation 3: ${commissionRates.generation3}%`);

    // Get users referred by Saint2talk
    const referredUsers = await User.find({ 'referralInfo.code': 'Saint2talk' });
    console.log(`Found ${referredUsers.length} referred users`);

    // Process each referred user
    let totalEarnings = 0;
    let processedCount = 0;
    
    for (const user of referredUsers) {
      console.log(`\nProcessing user: ${user.name} (${user.email})`);
      
      // Get user's share transactions that are completed
      const userShare = await UserShare.findOne({ user: user._id });
      
      if (!userShare || userShare.totalShares === 0) {
        console.log('  No shares found for this user, skipping');
        continue;
      }
      
      const completedTransactions = userShare.transactions.filter(tx => tx.status === 'completed');
      
      if (completedTransactions.length === 0) {
        console.log('  No completed transactions found for this user, skipping');
        continue;
      }
      
      console.log(`  Found ${completedTransactions.length} completed transactions`);
      
      // Process each completed transaction
      for (const transaction of completedTransactions) {
        // Check if referral commission already exists
        const existingCommission = await ReferralTransaction.findOne({
          beneficiary: referrer._id,
          referredUser: user._id,
          sourceTransaction: transaction.transactionId,
          generation: 1
        });
        
        if (existingCommission) {
          console.log(`  Commission already exists for transaction ${transaction.transactionId}, skipping`);
          continue;
        }
        
        // Calculate commission
        const commissionAmount = (transaction.totalAmount * commissionRates.generation1) / 100;
        console.log(`  Transaction: ${transaction.transactionId}, Amount: ${transaction.totalAmount} ${transaction.currency}`);
        console.log(`  Commission Amount (${commissionRates.generation1}%): ${commissionAmount} ${transaction.currency}`);
        
        // Create referral transaction
        const referralTx = new ReferralTransaction({
          beneficiary: referrer._id,
          referredUser: user._id,
          amount: commissionAmount,
          currency: transaction.currency,
          generation: 1,
          purchaseType: 'share',
          sourceTransaction: transaction.transactionId,
          sourceTransactionModel: 'UserShare',
          status: 'completed'
        });
        
        await referralTx.save();
        console.log(`  Created referral commission transaction: ${referralTx._id}`);
        
        totalEarnings += commissionAmount;
        processedCount++;
      }
    }
    
    // Update referrer's referral stats
    const referralStats = await Referral.findOne({ user: referrer._id });
    
    if (referralStats) {
      // Update existing stats
      referralStats.generation1.earnings += totalEarnings;
      referralStats.totalEarnings += totalEarnings;
      await referralStats.save();
    } else {
      // Create new stats record
      const newReferralStats = new Referral({
        user: referrer._id,
        referredUsers: referredUsers.length,
        totalEarnings: totalEarnings,
        generation1: { count: referredUsers.length, earnings: totalEarnings },
        generation2: { count: 0, earnings: 0 },
        generation3: { count: 0, earnings: 0 }
      });
      await newReferralStats.save();
    }
    
    console.log('\nReferral earnings repair summary:');
    console.log(`- Total transactions processed: ${processedCount}`);
    console.log(`- Total earnings generated: ${totalEarnings}`);
    
    // Verify the updated referral stats
    const updatedReferralStats = await Referral.findOne({ user: referrer._id });
    console.log('\nUpdated referral stats:');
    console.log(`- Total earnings: ${updatedReferralStats.totalEarnings}`);
    console.log(`- Generation 1: ${JSON.stringify(updatedReferralStats.generation1)}`);
    console.log(`- Generation 2: ${JSON.stringify(updatedReferralStats.generation2)}`);
    console.log(`- Generation 3: ${JSON.stringify(updatedReferralStats.generation3)}`);
    
    await mongoose.connection.close();
    console.log('MongoDB connection closed');
  } catch (error) {
    console.error('Error repairing referral earnings:', error);
    if (mongoose.connection.readyState !== 0) {
      await mongoose.connection.close();
    }
  }
}

// Run the function
repairReferralEarnings()
  .then(() => console.log('Repair process completed'))
  .catch(error => console.error('Repair failed:', error));