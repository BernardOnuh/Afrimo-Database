const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const User = require('./models/User');
const Withdrawal = require('./models/Withdrawal');
const Referral = require('./models/Referral');

mongoose.connect(process.env.MONGODB_URI).then(async () => {
  const user = await User.findOne({ email: 'iprestyno100@gmail.com' }).lean();
  
  if (!user) {
    console.log('User not found');
    mongoose.connection.close();
    return;
  }

  console.log('\n--- USER INFO ---');
  console.log('Name:', user.name);
  console.log('Email:', user.email);
  console.log('ID:', user._id);

  const referral = await Referral.findOne({ user: user._id }).lean();
  console.log('\n--- WALLET BALANCE ---');
  console.log('Total Earnings:       ₦', referral?.totalEarnings?.toLocaleString() || 0);
  console.log('Available Balance:    ₦', referral?.availableBalance?.toLocaleString() || 0);
  console.log('Pending Withdra:  ₦', referral?.pendingWithdrawals?.toLocaleString() || 0);
  console.log('Processing Withdrawals: ₦', referral?.processingWithdrawals?.toLocaleString() || 0);
  console.log('Total Withdrawn:      ₦', referral?.totalWithdrawn?.toLocaleString() || 0);

  const withdrawals = await Withdrawal.find({ user: user._id })
    .select('status amount withdrawalType createdAt bankName accountName accountNumber')
    .sort({ createdAt: -1 })
    .lean();

  console.log('\n--- ALL WITHDRAWALS (' + withdrawals.length + ') ---');
  withdrawals.forEach((w, i) => {
    console.log(`\n[${i+1}]`, {
      id: w._id,
      amount: `₦${w.amount?.toLocaleString()}`,
      status: w.status,
      type: w.withdrawalType || 'undefined',
      date: w.createdAt?.toISOString().split('T')[0],
      bankName: w.bankName || 'N/A',
      accountName: w.accountName || 'N/A',
      accountNumber: w.accountNumber || 'N/A',
    });
  });

  mongoose.connection.close();
}).catch(console.error);
