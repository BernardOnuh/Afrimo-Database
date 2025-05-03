// resetWithdrawalSystem.js
// Save this file and run it using Node.js: node resetWithdrawalSystem.js

const mongoose = require('mongoose');
const User = require('./models/User');
const Referral = require('./models/Referral');
const ReferralTransaction = require('./models/ReferralTransaction');
const Withdrawal = require('./models/Withdrawal');
const Payment = require('./models/Payment');

async function resetWithdrawalSystem() {
  try {
    console.log('Starting withdrawal system reset...');
    
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb+srv://Ben:iOBkvnsCXWpoGMFp@cluster0.l4xjq.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0', {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log('Connected to MongoDB');

    // Get summary of what will be deleted
    const withdrawalCount = await Withdrawal.countDocuments({});
    const referralTxCount = await ReferralTransaction.countDocuments({ type: 'withdrawal' });
    
    console.log(`\nFound ${withdrawalCount} withdrawals and ${referralTxCount} withdrawal-related transactions`);
    
    // Ask for confirmation
    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    const question = () => {
      return new Promise((resolve) => {
        rl.question('\nDo you want to proceed with the reset? Type "RESET-WITHDRAWAL-SYSTEM" to confirm: ', (answer) => {
          resolve(answer);
        });
      });
    };
    
    const confirmation = await question();
    rl.close();
    
    if (confirmation !== 'RESET-WITHDRAWAL-SYSTEM') {
      console.log('Reset cancelled by user');
      await mongoose.connection.close();
      return;
    }
    
    console.log('\nProceeding with reset...');
    
    // Track affected users
    const affectedUsers = new Set();
    
    // 1. Find all withdrawal-related deductions in referral transactions
    const withdrawalTransactions = await ReferralTransaction.find({ type: 'withdrawal' });
    withdrawalTransactions.forEach(tx => affectedUsers.add(tx.user.toString()));
    
    // 2. Delete all withdrawal-related transactions
    const withdrawalTxDeleted = await ReferralTransaction.deleteMany({ type: 'withdrawal' });
    console.log(`Deleted ${withdrawalTxDeleted.deletedCount} withdrawal transactions`);
    
    // 3. Delete all withdrawal records
    const withdrawalsDeleted = await Withdrawal.deleteMany({});
    console.log(`Deleted ${withdrawalsDeleted.deletedCount} withdrawal records`);
    
    // 4. Reset payment details for all users (optional, only if needed)
    // Uncomment the lines below if you want to reset payment details too
    /*
    const paymentReset = await Payment.updateMany(
      {},
      { $unset: { bankAccount: "" } }
    );
    console.log(`Reset payment details for ${paymentReset.modifiedCount} users`);
    */
    
    // 5. Recalculate total earnings for affected users
    let usersUpdated = 0;
    console.log('\nRecalculating earnings for affected users...');
    
    for (const userId of affectedUsers) {
      try {
        // Get all remaining referral transactions for this user
        const userTransactions = await ReferralTransaction.find({ beneficiary: userId });
        
        // Calculate total earnings from remaining transactions
        let totalEarnings = 0;
        let gen1Earnings = 0;
        let gen2Earnings = 0;
        let gen3Earnings = 0;
        
        userTransactions.forEach(tx => {
          totalEarnings += tx.amount;
          
          if (tx.generation === 1) gen1Earnings += tx.amount;
          else if (tx.generation === 2) gen2Earnings += tx.amount;
          else if (tx.generation === 3) gen3Earnings += tx.amount;
        });
        
        // Update the referral stats
        const referralStats = await Referral.findOne({ user: userId });
        if (referralStats) {
          referralStats.totalEarnings = totalEarnings;
          
          // Update generation earnings
          if (referralStats.generation1) {
            referralStats.generation1.earnings = gen1Earnings;
          }
          if (referralStats.generation2) {
            referralStats.generation2.earnings = gen2Earnings;
          }
          if (referralStats.generation3) {
            referralStats.generation3.earnings = gen3Earnings;
          }
          
          await referralStats.save();
          usersUpdated++;
          
          const user = await User.findById(userId);
          console.log(`Updated earnings for ${user.name || user.email}: ₦${totalEarnings.toLocaleString()}`);
        }
      } catch (error) {
        console.error(`Error updating user ${userId}:`, error.message);
      }
    }
    
    // Summary
    console.log('\n----- RESET SUMMARY -----');
    console.log(`Withdrawal records deleted: ${withdrawalsDeleted.deletedCount}`);
    console.log(`Withdrawal transactions deleted: ${withdrawalTxDeleted.deletedCount}`);
    console.log(`Users with updated earnings: ${usersUpdated}`);
    console.log(`Total affected users: ${affectedUsers.size}`);
    
    // Save results to a file
    const fs = require('fs');
    const results = {
      date: new Date(),
      summary: {
        withdrawalsDeleted: withdrawalsDeleted.deletedCount,
        transactionsDeleted: withdrawalTxDeleted.deletedCount,
        usersUpdated: usersUpdated,
        affectedUsers: Array.from(affectedUsers)
      }
    };
    
    fs.writeFileSync('withdrawal_reset_results.json', JSON.stringify(results, null, 2));
    console.log('\nResults saved to withdrawal_reset_results.json');
    
    await mongoose.connection.close();
    console.log('MongoDB connection closed');
    console.log('\nSystem successfully reset to pre-withdrawal state!');
    
  } catch (error) {
    console.error('Error resetting withdrawal system:', error);
    if (mongoose.connection.readyState !== 0) {
      await mongoose.connection.close();
    }
    throw error;
  }
}

// Run the function
resetWithdrawalSystem()
  .then(() => console.log('Reset process completed'))
  .catch(error => console.error('Reset process failed:', error));