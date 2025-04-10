const mongoose = require('mongoose');
const User = require('./models/User');
const Referral = require('./models/Referral');
const ReferralTransaction = require('./models/ReferralTransaction');
const UserShare = require('./models/UserShare');
const SiteConfig = require('./models/SiteConfig');

async function fixAllUsersReferralEarnings() {
  try {
    console.log('Starting global referral earnings fix for all users...');
    
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb+srv://Ben:iOBkvnsCXWpoGMFp@cluster0.l4xjq.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0', {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log('Connected to MongoDB');

    // Get commission rates from site config
    const siteConfig = await SiteConfig.getCurrentConfig();
    
    let commissionRates;
    if (!siteConfig || !siteConfig.referralCommission) {
      console.log('Site configuration or referral commission rates not found');
      console.log('Creating default commission rates');
      // Default commission rates if not found
      commissionRates = {
        generation1: 5, // 5% for first generation
        generation2: 2, // 2% for second generation
        generation3: 1  // 1% for third generation
      };
    } else {
      commissionRates = siteConfig.referralCommission;
    }

    console.log('Referral commission rates:');
    console.log(`- Generation 1: ${commissionRates.generation1}%`);
    console.log(`- Generation 2: ${commissionRates.generation2}%`);
    console.log(`- Generation 3: ${commissionRates.generation3}%`);

    // Find all users who could potentially be referrers (anyone with a username)
    const allPotentialReferrers = await User.find({ userName: { $exists: true, $ne: null } });
    console.log(`Found ${allPotentialReferrers.length} potential referrers`);

    // Overall statistics
    const stats = {
      totalProcessed: 0,
      usersWithReferrals: 0,
      totalReferralTransactions: 0,
      totalEarningsGenerated: 0,
      processingErrors: 0
    };

    // Process each potential referrer
    for (const referrer of allPotentialReferrers) {
      console.log(`\n[${stats.totalProcessed + 1}/${allPotentialReferrers.length}] Processing user: ${referrer.name} (${referrer.userName})`);
      
      try {
        // Find users who have this person as their referrer
        const gen1Users = await User.find({ 'referralInfo.code': referrer.userName });
        
        if (gen1Users.length === 0) {
          console.log(`  No referred users found for ${referrer.userName}, skipping`);
          stats.totalProcessed++;
          continue;
        }

        console.log(`  Found ${gen1Users.length} generation 1 referred users`);
        stats.usersWithReferrals++;

        // Individual user statistics
        const userStats = {
          userName: referrer.userName,
          referredUsers: gen1Users.length,
          gen1Earnings: 0,
          gen2Earnings: 0,
          gen3Earnings: 0,
          totalEarnings: 0,
          transactions: 0
        };

        // Clean up existing referral transactions for this user
        await ReferralTransaction.deleteMany({ beneficiary: referrer._id });
        console.log(`  Cleaned up existing referral transactions for ${referrer.userName}`);

        // PROCESS GENERATION 1 USERS
        console.log(`  Processing Generation 1 users for ${referrer.userName}...`);
        for (const user of gen1Users) {
          console.log(`    Processing user: ${user.name} (${user.email})`);
          
          // Get user's share transactions that are completed
          const userShare = await UserShare.findOne({ user: user._id });
          
          if (!userShare || userShare.totalShares === 0) {
            console.log('      No shares found for this user, skipping');
            continue;
          }
          
          const completedTransactions = userShare.transactions.filter(tx => tx.status === 'completed');
          
          if (completedTransactions.length === 0) {
            console.log('      No completed transactions found for this user, skipping');
            continue;
          }
          
          console.log(`      Found ${completedTransactions.length} completed transactions`);
          
          // Process each completed transaction
          for (const transaction of completedTransactions) {
            // Calculate commission (generation 1)
            const commissionAmount = (transaction.totalAmount * commissionRates.generation1) / 100;
            
            try {
              // Create referral transaction without sourceTransaction field
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
              console.error(`      Error creating Gen 1 referral transaction: ${error.message}`);
              stats.processingErrors++;
            }
          }
          
          // LOOK FOR GENERATION 2 REFERRALS
          const gen2Users = await User.find({ 'referralInfo.code': user.userName });
          
          if (gen2Users.length > 0) {
            console.log(`      Found ${gen2Users.length} Generation 2 users referred by ${user.userName}`);
            
            // Process Generation 2 users
            for (const gen2User of gen2Users) {
              // Get Gen 2 user's share transactions
              const gen2UserShare = await UserShare.findOne({ user: gen2User._id });
              
              if (!gen2UserShare || gen2UserShare.totalShares === 0) continue;
              
              const gen2CompletedTransactions = gen2UserShare.transactions.filter(tx => tx.status === 'completed');
              
              if (gen2CompletedTransactions.length === 0) continue;
              
              // Process each Gen 2 completed transaction
              for (const gen2Transaction of gen2CompletedTransactions) {
                // Calculate Gen 2 commission
                const gen2CommissionAmount = (gen2Transaction.totalAmount * commissionRates.generation2) / 100;
                
                try {
                  // Create Gen 2 referral transaction
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
                  console.error(`        Error creating Gen 2 referral transaction: ${error.message}`);
                  stats.processingErrors++;
                }
                
                // LOOK FOR GENERATION 3 REFERRALS
                const gen3Users = await User.find({ 'referralInfo.code': gen2User.userName });
                
                if (gen3Users.length > 0) {
                  // Process Generation 3 users
                  for (const gen3User of gen3Users) {
                    // Get Gen 3 user's share transactions
                    const gen3UserShare = await UserShare.findOne({ user: gen3User._id });
                    
                    if (!gen3UserShare || gen3UserShare.totalShares === 0) continue;
                    
                    const gen3CompletedTransactions = gen3UserShare.transactions.filter(tx => tx.status === 'completed');
                    
                    if (gen3CompletedTransactions.length === 0) continue;
                    
                    // Process each Gen 3 completed transaction
                    for (const gen3Transaction of gen3CompletedTransactions) {
                      // Calculate Gen 3 commission
                      const gen3CommissionAmount = (gen3Transaction.totalAmount * commissionRates.generation3) / 100;
                      
                      try {
                        // Create Gen 3 referral transaction
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
                        console.error(`          Error creating Gen 3 referral transaction: ${error.message}`);
                        stats.processingErrors++;
                      }
                    }
                  }
                }
              }
            }
          }
        }

        // UPDATE REFERRAL STATS for this user
        console.log(`  Updating referral stats for ${referrer.userName}...`);
        
        // First find or create the referral stats record
        let referralStats = await Referral.findOne({ user: referrer._id });
        
        if (referralStats) {
          // Update existing stats
          referralStats.referredUsers = gen1Users.length;
          referralStats.totalEarnings = userStats.totalEarnings;
          
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
          
          referralStats.generation1 = { count: gen1Users.length, earnings: userStats.gen1Earnings };
          referralStats.generation2 = { count: gen2Count, earnings: userStats.gen2Earnings };
          referralStats.generation3 = { count: gen3Count, earnings: userStats.gen3Earnings };
          
          await referralStats.save();
        } else {
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
          
          // Create new stats record
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

        console.log(`  Completed processing for ${referrer.userName}:`);
        console.log(`    - Total earnings: ${userStats.totalEarnings}`);
        console.log(`    - Gen 1 earnings: ${userStats.gen1Earnings}`);
        console.log(`    - Gen 2 earnings: ${userStats.gen2Earnings}`);
        console.log(`    - Gen 3 earnings: ${userStats.gen3Earnings}`);
        console.log(`    - Transactions created: ${userStats.transactions}`);
      } catch (error) {
        console.error(`  Error processing user ${referrer.userName}: ${error.message}`);
        stats.processingErrors++;
      }
      
      stats.totalProcessed++;
    }
    
    // SUMMARY
    console.log('\n----- GLOBAL FIX SUMMARY -----');
    console.log(`Total users processed: ${stats.totalProcessed}`);
    console.log(`Users with referrals: ${stats.usersWithReferrals}`);
    console.log(`Total referral transactions created: ${stats.totalReferralTransactions}`);
    console.log(`Total earnings generated: ${stats.totalEarningsGenerated}`);
    console.log(`Processing errors encountered: ${stats.processingErrors}`);
    
    // Save results to a file for reference
    const fs = require('fs');
    fs.writeFileSync('referral_fix_results.json', JSON.stringify({
      date: new Date(),
      commissionRates,
      stats
    }, null, 2));
    console.log('\nResults saved to referral_fix_results.json');
    
    await mongoose.connection.close();
    console.log('MongoDB connection closed');
    
    return stats;
  } catch (error) {
    console.error('Error fixing global referral earnings:', error);
    if (mongoose.connection.readyState !== 0) {
      await mongoose.connection.close();
    }
    throw error;
  }
}

// Run the function
fixAllUsersReferralEarnings()
  .then((stats) => console.log('Global fix process completed successfully'))
  .catch(error => console.error('Global fix process failed:', error));