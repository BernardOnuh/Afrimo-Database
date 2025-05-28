// referralCronJobs.js
const cron = require('node-cron');
const mongoose = require('mongoose');

async function fixAllUsersReferralEarnings() {
  try {
    console.log('\n======================================');
    console.log('REFERRAL EARNINGS SYNC JOB STARTED');
    console.log('======================================');
    
    // Import models
    const User = require('./models/User');
    const Referral = require('./models/Referral');
    const ReferralTransaction = require('./models/ReferralTransaction');
    const UserShare = require('./models/UserShare');
    const SiteConfig = require('./models/SiteConfig');

    // Get commission rates from site config
    const siteConfig = await SiteConfig.getCurrentConfig();
    
    let commissionRates;
    if (!siteConfig || !siteConfig.referralCommission) {
      commissionRates = {
        generation1: 15,
        generation2: 3,
        generation3: 2
      };
    } else {
      commissionRates = siteConfig.referralCommission;
    }

    console.log(`Gen1: ${commissionRates.generation1}%, Gen2: ${commissionRates.generation2}%, Gen3: ${commissionRates.generation3}%`);

    // Find all users who could potentially be referrers
    const allPotentialReferrers = await User.find({ userName: { $exists: true, $ne: null } });
    console.log(`Processing ${allPotentialReferrers.length} potential referrers`);

    const stats = {
      totalProcessed: 0,
      usersWithReferrals: 0,
      totalReferralTransactions: 0,
      totalEarningsGenerated: 0,
      processingErrors: 0
    };

    // Process each potential referrer
    for (const referrer of allPotentialReferrers) {
      try {
        const gen1Users = await User.find({ 'referralInfo.code': referrer.userName });
        
        if (gen1Users.length === 0) {
          stats.totalProcessed++;
          continue;
        }

        stats.usersWithReferrals++;
        
        const userStats = {
          gen1Earnings: 0,
          gen2Earnings: 0,
          gen3Earnings: 0,
          totalEarnings: 0,
          transactions: 0
        };

        // Clean up existing referral transactions for this user
        await ReferralTransaction.deleteMany({ beneficiary: referrer._id });

        // PROCESS GENERATION 1 USERS
        for (const user of gen1Users) {
          const userShare = await UserShare.findOne({ user: user._id });
          
          if (!userShare || userShare.totalShares === 0) continue;
          
          const completedTransactions = userShare.transactions.filter(tx => tx.status === 'completed');
          
          if (completedTransactions.length === 0) continue;
          
          // Process each completed transaction
          for (const transaction of completedTransactions) {
            const commissionAmount = (transaction.totalAmount * commissionRates.generation1) / 100;
            
            try {
              const referralTx = new ReferralTransaction({
                beneficiary: referrer._id,
                referredUser: user._id,
                amount: commissionAmount,
                currency: transaction.currency,
                generation: 1,
                purchaseType: 'share', 
                sourceTransactionModel: 'UserShare',
                status: 'completed',
                createdAt: new Date()
              });
              
              await referralTx.save();
              
              userStats.transactions++;
              userStats.gen1Earnings += commissionAmount;
              userStats.totalEarnings += commissionAmount;
              
              stats.totalReferralTransactions++;
              stats.totalEarningsGenerated += commissionAmount;
            } catch (error) {
              console.error(`Gen 1 referral transaction error: ${error.message}`);
              stats.processingErrors++;
            }
          }
          
          // GENERATION 2 REFERRALS
          const gen2Users = await User.find({ 'referralInfo.code': user.userName });
          
          if (gen2Users.length > 0) {
            for (const gen2User of gen2Users) {
              const gen2UserShare = await UserShare.findOne({ user: gen2User._id });
              
              if (!gen2UserShare || gen2UserShare.totalShares === 0) continue;
              
              const gen2CompletedTransactions = gen2UserShare.transactions.filter(tx => tx.status === 'completed');
              
              if (gen2CompletedTransactions.length === 0) continue;
              
              for (const gen2Transaction of gen2CompletedTransactions) {
                const gen2CommissionAmount = (gen2Transaction.totalAmount * commissionRates.generation2) / 100;
                
                try {
                  const gen2ReferralTx = new ReferralTransaction({
                    beneficiary: referrer._id,
                    referredUser: gen2User._id,
                    amount: gen2CommissionAmount,
                    currency: gen2Transaction.currency,
                    generation: 2,
                    purchaseType: 'share',
                    sourceTransactionModel: 'UserShare',
                    status: 'completed',
                    createdAt: new Date()
                  });
                  
                  await gen2ReferralTx.save();
                  
                  userStats.transactions++;
                  userStats.gen2Earnings += gen2CommissionAmount;
                  userStats.totalEarnings += gen2CommissionAmount;
                  
                  stats.totalReferralTransactions++;
                  stats.totalEarningsGenerated += gen2CommissionAmount;
                } catch (error) {
                  console.error(`Gen 2 referral transaction error: ${error.message}`);
                  stats.processingErrors++;
                }
                
                // GENERATION 3 REFERRALS
                const gen3Users = await User.find({ 'referralInfo.code': gen2User.userName });
                
                if (gen3Users.length > 0) {
                  for (const gen3User of gen3Users) {
                    const gen3UserShare = await UserShare.findOne({ user: gen3User._id });
                    
                    if (!gen3UserShare || gen3UserShare.totalShares === 0) continue;
                    
                    const gen3CompletedTransactions = gen3UserShare.transactions.filter(tx => tx.status === 'completed');
                    
                    if (gen3CompletedTransactions.length === 0) continue;
                    
                    for (const gen3Transaction of gen3CompletedTransactions) {
                      const gen3CommissionAmount = (gen3Transaction.totalAmount * commissionRates.generation3) / 100;
                      
                      try {
                        const gen3ReferralTx = new ReferralTransaction({
                          beneficiary: referrer._id,
                          referredUser: gen3User._id,
                          amount: gen3CommissionAmount,
                          currency: gen3Transaction.currency,
                          generation: 3,
                          purchaseType: 'share',
                          sourceTransactionModel: 'UserShare',
                          status: 'completed',
                          createdAt: new Date()
                        });
                        
                        await gen3ReferralTx.save();
                        
                        userStats.transactions++;
                        userStats.gen3Earnings += gen3CommissionAmount;
                        userStats.totalEarnings += gen3CommissionAmount;
                        
                        stats.totalReferralTransactions++;
                        stats.totalEarningsGenerated += gen3CommissionAmount;
                      } catch (error) {
                        console.error(`Gen 3 referral transaction error: ${error.message}`);
                        stats.processingErrors++;
                      }
                    }
                  }
                }
              }
            }
          }
        }

        // UPDATE REFERRAL STATS
        let referralStats = await Referral.findOne({ user: referrer._id });
        
        // Count Gen 2 users
        let gen2Count = 0;
        for (const gen1User of gen1Users) {
          const count = await User.countDocuments({ 'referralInfo.code': gen1User.userName });
          gen2Count += count;
        }
        
        // Count Gen 3 users
        let gen3Count = 0;
        for (const gen1User of gen1Users) {
          const gen2Users = await User.find({ 'referralInfo.code': gen1User.userName });
          for (const gen2User of gen2Users) {
            const count = await User.countDocuments({ 'referralInfo.code': gen2User.userName });
            gen3Count += count;
          }
        }
        
        if (referralStats) {
          referralStats.referredUsers = gen1Users.length;
          referralStats.totalEarnings = userStats.totalEarnings;
          referralStats.generation1 = { count: gen1Users.length, earnings: userStats.gen1Earnings };
          referralStats.generation2 = { count: gen2Count, earnings: userStats.gen2Earnings };
          referralStats.generation3 = { count: gen3Count, earnings: userStats.gen3Earnings };
          
          await referralStats.save();
        } else {
          const newReferralStats = new Referral({
            user: referrer._id,
            referredUsers: gen1Users.length,
            totalEarnings: userStats.totalEarnings,
            generation1: { count: gen1Users.length, earnings: userStats.gen1Earnings },
            generation2: { count: gen2Count, earnings: userStats.gen2Earnings },
            generation3: { count: gen3Count, earnings: userStats.gen3Earnings }
          });
          
          await newReferralStats.save();
        }

      } catch (error) {
        console.error(`Error processing user ${referrer.userName}: ${error.message}`);
        stats.processingErrors++;
      }
      
      stats.totalProcessed++;
    }
    
    console.log('======================================');
    console.log('REFERRAL SYNC SUMMARY:');
    console.log(`Users processed: ${stats.totalProcessed}`);
    console.log(`Users with referrals: ${stats.usersWithReferrals}`);
    console.log(`Transactions created: ${stats.totalReferralTransactions}`);
    console.log(`Total earnings: ${stats.totalEarningsGenerated}`);
    console.log(`Errors: ${stats.processingErrors}`);
    console.log('======================================\n');
    
    return stats;
  } catch (error) {
    console.error('Error in referral earnings sync:', error);
    throw error;
  }
}

// Create the cron job
const referralSyncJob = cron.schedule('0 2 * * *', async () => {
  // Runs daily at 2 AM
  try {
    await fixAllUsersReferralEarnings();
  } catch (error) {
    console.error('Referral sync cron job failed:', error);
  }
}, {
  scheduled: false // Don't start immediately
});

// Create a weekly comprehensive sync job
const weeklyReferralSyncJob = cron.schedule('0 3 * * 0', async () => {
  // Runs weekly on Sunday at 3 AM
  console.log('Running WEEKLY comprehensive referral sync...');
  try {
    await fixAllUsersReferralEarnings();
  } catch (error) {
    console.error('Weekly referral sync failed:', error);
  }
}, {
  scheduled: false
});

module.exports = {
  // Export the sync function for manual use
  fixAllUsersReferralEarnings,
  
  // Export cron jobs
  referralSyncJob,
  weeklyReferralSyncJob,
  
  // Start all referral cron jobs
  startReferralJobs() {
    console.log('Starting referral sync cron jobs...');
    referralSyncJob.start();
    weeklyReferralSyncJob.start();
    console.log('Referral sync jobs started - Daily at 2 AM, Weekly on Sunday at 3 AM');
  },
  
  // Stop all referral cron jobs
  stopReferralJobs() {
    console.log('Stopping referral sync cron jobs...');
    referralSyncJob.stop();
    weeklyReferralSyncJob.stop();
    console.log('Referral sync jobs stopped');
  }
};