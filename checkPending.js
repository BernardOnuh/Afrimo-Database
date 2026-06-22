const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const User = require('./models/User');
const Withdrawal = require('./models/Withdrawal');

mongoose.connect(process.env.MONGODB_URI).then(async () => {
  const pending = await Withdrawal.find({ 
    status: { $in: ['pending', 'processing', 'approved'] } 
  })
    .populate('user', 'name email')
    .select('status amount withdrawalType createdAt user bankName accountName accountNumber')
    .sort({ createdAt: -1 })
    .lean();

  console.log('\nTotal pending/processing withdrawals:', pending.length);
  console.log('Total amount:', pending.reduce((sum, w) => sum + w.amount, 0).toLocaleString());
  console.log('\n--- DETAILS ---\n');

  pending.forEach((w, i) => {
    console.log(`[${i+1}]`, {
      id: w._id,
      user: w.user?.email || 'no user',
      name: w.user?.name || 'no name',
      amount: `₦${w.amount?.toLocaleString()}`,
    type: w.withdrawalType || 'undefined',
      status: w.status,
      date: w.createdAt?.toISOString().split('T')[0],
      bankName: w.bankName || 'N/A',
      accountName: w.accountName || 'N/A',
    });
  });

  mongoose.connection.close();
}).catch(console.error);
