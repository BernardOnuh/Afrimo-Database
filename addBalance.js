require('dotenv').config();
const mongoose = require('mongoose');
const Referral = require('./models/Referral'); // adjust path if different

const email = 'onuhbernard4@gmail.com';
const AMOUNT = 40000;

mongoose.connect(process.env.MONGODB_URI).then(async () => {
  const usersCollection = mongoose.connection.db.collection('users');
  const user = await usersCollection.findOne({ email });

  if (!user) {
    console.log('User not found:', email);
    return mongoose.connection.close();
  }

  let referral = await Referral.findOne({ user: user._id });

  if (referral) {
    console.log('--- BEFORE ---');
    console.log({
      totalEarnings: referral.totalEarnings,
      totalWithdrawn: referral.totalWithdrawn,
      pendingWithdrawals: referral.pendingWithdrawals,
      processingWithdrawals: referral.processingWithdrawals
    });

    referral.totalEarnings = (referral.totalEarnings || 0) + AMOUNT;
    await referral.save();

    console.log('--- AFTER ---');
    console.log({
      totalEarnings: referral.totalEarnings,
      totalWithdrawn: referral.totalWithdrawn,
      pendingWithdrawals: referral.pendingWithdrawals,
      processingWithdrawals: referral.processingWithdrawals
    });
  } else {
    console.log('No Referral doc found for this user — attempting to create one.');
    try {
      referral = await Referral.create({
        user: user._id,
        totalEarnings: AMOUNT
      });
      console.log('--- CREATED ---');
      console.log(referral);
    } catch (err) {
      console.log('Could not create Referral doc — likely missing required fields.');
      console.log('Validation error:', err.message);
      console.log('Share this error and your Referral schema so we can fix the create call.');
    }
  }

  mongoose.connection.close();
}).catch(console.error);
