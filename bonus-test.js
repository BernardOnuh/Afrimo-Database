// awardUserBalance.js
// Save this file and run it using Node.js: node awardUserBalance.js

const mongoose = require('mongoose');
const User = require('./models/User');
const Referral = require('./models/Referral');
const ReferralTransaction = require('./models/ReferralTransaction');

async function awardUserBalance() {
  try {
    console.log('Starting user balance award process...');
    
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb+srv://Ben:iOBkvnsCXWpoGMFp@cluster0.l4xjq.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0', {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log('Connected to MongoDB');

    // Get user input
    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    const questions = () => {
      return new Promise((resolve) => {
        rl.question('\nEnter user email or username: ', (userIdentifier) => {
          rl.question('\nEnter amount to award (default 20000): ', (amount) => {
            rl.question('\nEnter reason for award (optional): ', (reason) => {
              rl.close();
              resolve({
                userIdentifier: userIdentifier.trim(),
                amount: amount.trim() || '20000',
                reason: reason.trim() || 'Admin bonus award'
              });
            });
          });
        });
      });
    };
    
    const { userIdentifier, amount, reason } = await questions();
    const awardAmount = parseFloat(amount);
    
    if (isNaN(awardAmount) || awardAmount <= 0) {
      console.log('Invalid amount. Exiting...');
      await mongoose.connection.close();
      return;
    }
    
    // Find the user
    let user;
    if (userIdentifier.includes('@')) {
      user = await User.findOne({ email: userIdentifier });
    } else {
      user = await User.findOne({ userName: userIdentifier });
    }
    
    if (!user) {
      console.log(`User not found: ${userIdentifier}`);
      await mongoose.connection.close();
      return;
    }
    
    console.log(`\nFound user: ${user.name} (${user.email})`);
    console.log(`Award amount: ₦${awardAmount.toLocaleString()}`);
    console.log(`Reason: ${reason}`);
    
    // Get confirmation
    const rl2 = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    const confirmation = await new Promise((resolve) => {
      rl2.question('\nProceed with award? (yes/no): ', (answer) => {
        rl2.close();
        resolve(answer.toLowerCase());
      });
    });
    
    if (confirmation !== 'yes') {
      console.log('Award cancelled by user');
      await mongoose.connection.close();
      return;
    }
    
    // Create a referral transaction for the award
    const transaction = new ReferralTransaction({
      user: user._id,
      beneficiary: user._id,
      type: 'bonus',  // Keep the type as bonus
      amount: awardAmount,
      // Omit currency as it might have a default value or not be required for bonus type
      description: reason,
      status: 'completed',
      reference: `BONUS-${Date.now()}`,
      generation: 1,  // Required field
      referredUser: user._id,  // Required field - self-referral for bonus
      purchaseType: 'share',  // Use 'share' since 'bonus' is not a valid enum value
      sourceTransactionModel: 'UserShare'  // Use 'UserShare' which seems to be a valid enum value
    });
    
    await transaction.save();
    
    // Update or create referral stats
    let referralStats = await Referral.findOne({ user: user._id });
    
    if (referralStats) {
      referralStats.totalEarnings = (referralStats.totalEarnings || 0) + awardAmount;
      await referralStats.save();
    } else {
      referralStats = new Referral({
        user: user._id,
        referredUsers: 0,
        totalEarnings: awardAmount,
        generation1: { count: 0, earnings: 0 },
        generation2: { count: 0, earnings: 0 },
        generation3: { count: 0, earnings: 0 }
      });
      await referralStats.save();
    }
    
    console.log('\n----- AWARD SUMMARY -----');
    console.log(`User: ${user.name} (${user.email})`);
    console.log(`Amount awarded: ₦${awardAmount.toLocaleString()}`);
    console.log(`New total earnings: ₦${referralStats.totalEarnings.toLocaleString()}`);
    console.log(`Transaction ID: ${transaction._id}`);
    console.log(`Reference: ${transaction.reference}`);
    
    // Save results to file
    const fs = require('fs');
    const results = {
      date: new Date(),
      user: {
        id: user._id,
        name: user.name,
        email: user.email
      },
      award: {
        amount: awardAmount,
        reason: reason,
        transactionId: transaction._id,
        reference: transaction.reference
      },
      newBalance: referralStats.totalEarnings
    };
    
    fs.writeFileSync(`user_award_${user._id}_${Date.now()}.json`, JSON.stringify(results, null, 2));
    console.log('\nResults saved to file');
    
    await mongoose.connection.close();
    console.log('MongoDB connection closed');
    console.log('\nBonus successfully awarded!');
    
  } catch (error) {
    console.error('Error awarding user balance:', error);
    if (mongoose.connection.readyState !== 0) {
      await mongoose.connection.close();
    }
    throw error;
  }
}

// Run the function
console.log('👨‍💼 User Balance Award Tool');
console.log('========================');
awardUserBalance()
  .then(() => console.log('\nProcess completed'))
  .catch(error => console.error('\nProcess failed:', error));