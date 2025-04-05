const mongoose = require('mongoose');
const User = require('./models/User');
const Referral = require('./models/Referral');
const ReferralTransaction = require('./models/ReferralTransaction');
const UserShare = require('./models/UserShare');
const SiteConfig = require('./models/SiteConfig');

async function fixAllReferralEarnings() {
  try {
    console.log('Starting comprehensive referral earnings fix...');
    
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

    // APPROACH 1: FULL CLEANUP - Remove existing referral transactions to start clean
    console.log('\nCleaning up existing referral transactions...');
    await ReferralTransaction.deleteMany({ beneficiary: referrer._id });
    console.log('Existing referral transactions removed');

    // Get users referred by Saint2talk (generation 1)
    const gen1Users = await User.find({ 'referralInfo.code': 'Saint2talk' });
    console.log(`Found ${gen1Users.length} generation 1 referred users`);

    // Tracking variables
    let totalTransactionsProcessed = 0;
    let totalEarnings = 0;
    let gen1Earnings = 0;
    let gen2Earnings = 0;
    let gen3Earnings = 0;

    // PROCESS GENERATION 1 USERS
    console.log('\nProcessing Generation 1 users...');
    for (const user of gen1Users) {
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
        console.log(`  Processing transaction: ${transaction.transactionId}`);
        console.log(`  - Amount: ${transaction.totalAmount} ${transaction.currency}`);
        console.log(`  - Shares: ${transaction.shares}`);
        console.log(`  - Date: ${transaction.createdAt}`);
        
        // Calculate commission (generation 1)
        const commissionAmount = (transaction.totalAmount * commissionRates.generation1) / 100;
        console.log(`  - Commission Amount (${commissionRates.generation1}%): ${commissionAmount} ${transaction.currency}`);
        
        try {
          // *IMPORTANT CHANGE* - Instead of using the transactionId string, use the _id of the transaction
          // This addresses the "Cast to ObjectId failed" error
          // Create referral transaction without sourceTransaction for now
          const referralTx = new ReferralTransaction({
            beneficiary: referrer._id,
            referredUser: user._id,
            amount: commissionAmount,
            currency: transaction.currency,
            generation: 1,
            purchaseType: 'share',
            // We'll use a valid ObjectId or remove this field
            // sourceTransaction: transaction._id, // This would work if transaction has _id
            sourceTransactionModel: 'UserShare',
            status: 'completed',
            createdAt: new Date() // Set to current date
          });
          
          await referralTx.save();
          console.log(`  Created Gen 1 referral commission: ${referralTx._id}`);
          
          totalTransactionsProcessed++;
          totalEarnings += commissionAmount;
          gen1Earnings += commissionAmount;
        } catch (error) {
          console.error(`  Error creating Gen 1 referral transaction: ${error.message}`);
          // Continue processing other transactions
        }
      }
      
      // LOOK FOR GENERATION 2 REFERRALS
      // Users who were referred by this Generation 1 user
      const gen2Users = await User.find({ 'referralInfo.code': user.userName });
      
      if (gen2Users.length > 0) {
        console.log(`\n  Found ${gen2Users.length} Generation 2 users referred by ${user.userName}`);
        
        // Process Generation 2 users
        for (const gen2User of gen2Users) {
          console.log(`  Processing Gen 2 user: ${gen2User.name} (${gen2User.email})`);
          
          // Get Gen 2 user's share transactions
          const gen2UserShare = await UserShare.findOne({ user: gen2User._id });
          
          if (!gen2UserShare || gen2UserShare.totalShares === 0) {
            console.log('    No shares found for this Gen 2 user, skipping');
            continue;
          }
          
          const gen2CompletedTransactions = gen2UserShare.transactions.filter(tx => tx.status === 'completed');
          
          if (gen2CompletedTransactions.length === 0) {
            console.log('    No completed transactions found for this Gen 2 user, skipping');
            continue;
          }
          
          console.log(`    Found ${gen2CompletedTransactions.length} completed transactions`);
          
          // Process each Gen 2 completed transaction
          for (const gen2Transaction of gen2CompletedTransactions) {
            // Calculate Gen 2 commission
            const gen2CommissionAmount = (gen2Transaction.totalAmount * commissionRates.generation2) / 100;
            console.log(`    - Gen 2 Commission (${commissionRates.generation2}%): ${gen2CommissionAmount} ${gen2Transaction.currency}`);
            
            try {
              // Create Gen 2 referral transaction - omit sourceTransaction field
              const gen2ReferralTx = new ReferralTransaction({
                beneficiary: referrer._id,
                referredUser: gen2User._id,
                amount: gen2CommissionAmount,
                currency: gen2Transaction.currency,
                generation: 2,
                purchaseType: 'share',
                // sourceTransaction: gen2Transaction._id, // Omit this field to avoid ObjectId errors
                sourceTransactionModel: 'UserShare',
                status: 'completed',
                createdAt: new Date() // Set to current date
              });
              
              await gen2ReferralTx.save();
              console.log(`    Created Gen 2 referral commission: ${gen2ReferralTx._id}`);
              
              totalTransactionsProcessed++;
              totalEarnings += gen2CommissionAmount;
              gen2Earnings += gen2CommissionAmount;
            } catch (error) {
              console.error(`    Error creating Gen 2 referral transaction: ${error.message}`);
              // Continue processing
            }
            
            // LOOK FOR GENERATION 3 REFERRALS
            const gen3Users = await User.find({ 'referralInfo.code': gen2User.userName });
            
            if (gen3Users.length > 0) {
              console.log(`\n    Found ${gen3Users.length} Generation 3 users referred by ${gen2User.userName}`);
              
              // Process Generation 3 users
              for (const gen3User of gen3Users) {
                console.log(`    Processing Gen 3 user: ${gen3User.name} (${gen3User.email})`);
                
                // Get Gen 3 user's share transactions
                const gen3UserShare = await UserShare.findOne({ user: gen3User._id });
                
                if (!gen3UserShare || gen3UserShare.totalShares === 0) {
                  console.log('      No shares found for this Gen 3 user, skipping');
                  continue;
                }
                
                const gen3CompletedTransactions = gen3UserShare.transactions.filter(tx => tx.status === 'completed');
                
                if (gen3CompletedTransactions.length === 0) {
                  console.log('      No completed transactions found for this Gen 3 user, skipping');
                  continue;
                }
                
                console.log(`      Found ${gen3CompletedTransactions.length} completed transactions`);
                
                // Process each Gen 3 completed transaction
                for (const gen3Transaction of gen3CompletedTransactions) {
                  // Calculate Gen 3 commission
                  const gen3CommissionAmount = (gen3Transaction.totalAmount * commissionRates.generation3) / 100;
                  console.log(`      - Gen 3 Commission (${commissionRates.generation3}%): ${gen3CommissionAmount} ${gen3Transaction.currency}`);
                  
                  try {
                    // Create Gen 3 referral transaction - omit sourceTransaction field
                    const gen3ReferralTx = new ReferralTransaction({
                      beneficiary: referrer._id,
                      referredUser: gen3User._id,
                      amount: gen3CommissionAmount,
                      currency: gen3Transaction.currency,
                      generation: 3,
                      purchaseType: 'share',
                      // sourceTransaction: gen3Transaction._id, // Omit this field
                      sourceTransactionModel: 'UserShare',
                      status: 'completed',
                      createdAt: new Date() // Set to current date
                    });
                    
                    await gen3ReferralTx.save();
                    console.log(`      Created Gen 3 referral commission: ${gen3ReferralTx._id}`);
                    
                    totalTransactionsProcessed++;
                    totalEarnings += gen3CommissionAmount;
                    gen3Earnings += gen3CommissionAmount;
                  } catch (error) {
                    console.error(`      Error creating Gen 3 referral transaction: ${error.message}`);
                    // Continue processing
                  }
                }
              }
            }
          }
        }
      }
    }
    
    // UPDATE REFERRAL STATS
    console.log('\nUpdating referral stats for Saint2talk...');
    
    // First find or create the referral stats record
    let referralStats = await Referral.findOne({ user: referrer._id });
    
    if (referralStats) {
      // Update existing stats
      referralStats.referredUsers = gen1Users.length;
      referralStats.totalEarnings = totalEarnings;
      referralStats.generation1 = { 
        count: gen1Users.length, 
        earnings: gen1Earnings 
      };
      
      // Count Gen 2 users
      let gen2Count = 0;
      for (const gen1User of gen1Users) {
        const count = await User.countDocuments({ 'referralInfo.code': gen1User.userName });
        gen2Count += count;
      }
      
      referralStats.generation2 = { 
        count: gen2Count, 
        earnings: gen2Earnings 
      };
      
      // Count Gen 3 users
      let gen3Count = 0;
      for (const gen1User of gen1Users) {
        const gen2Users = await User.find({ 'referralInfo.code': gen1User.userName });
        for (const gen2User of gen2Users) {
          const count = await User.countDocuments({ 'referralInfo.code': gen2User.userName });
          gen3Count += count;
        }
      }
      
      referralStats.generation3 = { 
        count: gen3Count, 
        earnings: gen3Earnings 
      };
      
      await referralStats.save();
      console.log('Updated existing referral stats record');
    } else {
      // Create new stats record
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
      
      const newReferralStats = new Referral({
        user: referrer._id,
        referredUsers: gen1Users.length,
        totalEarnings: totalEarnings,
        generation1: { count: gen1Users.length, earnings: gen1Earnings },
        generation2: { count: gen2Count, earnings: gen2Earnings },
        generation3: { count: gen3Count, earnings: gen3Earnings }
      });
      
      await newReferralStats.save();
      console.log('Created new referral stats record');
    }
    
    // SUMMARY
    console.log('\n--- FIX SUMMARY ---');
    console.log(`Total transactions processed: ${totalTransactionsProcessed}`);
    console.log(`Total earnings generated: ${totalEarnings}`);
    console.log(`Generation 1 earnings: ${gen1Earnings}`);
    console.log(`Generation 2 earnings: ${gen2Earnings}`);
    console.log(`Generation 3 earnings: ${gen3Earnings}`);
    
    // Verify the updated referral stats
    const updatedReferralStats = await Referral.findOne({ user: referrer._id });
    console.log('\nVerifying updated referral stats:');
    console.log(`- Total earnings: ${updatedReferralStats.totalEarnings}`);
    console.log(`- Generation 1: ${JSON.stringify(updatedReferralStats.generation1)}`);
    console.log(`- Generation 2: ${JSON.stringify(updatedReferralStats.generation2)}`);
    console.log(`- Generation 3: ${JSON.stringify(updatedReferralStats.generation3)}`);
    
    // List created transactions
    const createdTransactions = await ReferralTransaction.find({ beneficiary: referrer._id })
      .populate('referredUser', 'name email')
      .sort({ createdAt: -1 });
    
    console.log(`\nTotal referral transactions created: ${createdTransactions.length}`);
    
    if (createdTransactions.length > 0) {
      console.log('\nRecent transactions:');
      createdTransactions.slice(0, 5).forEach(tx => {
        console.log(`- ${tx._id}: ${tx.amount} ${tx.currency} (Gen ${tx.generation}) - ${tx.referredUser.name}`);
      });
    }
    
    await mongoose.connection.close();
    console.log('MongoDB connection closed');
  } catch (error) {
    console.error('Error fixing referral earnings:', error);
    if (mongoose.connection.readyState !== 0) {
      await mongoose.connection.close();
    }
  }
}

// Run the function
fixAllReferralEarnings()
  .then(() => console.log('Fix process completed successfully'))
  .catch(error => console.error('Fix process failed:', error));