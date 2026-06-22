const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const Withdrawal = require('./models/Withdrawal');
const User = require('./models/User');

mongoose.connect(process.env.MONGODB_URI).then(async () => {
  // Pending withdrawals waiting to go out
  const pending = await Withdrawal.find({ 
    status: { $in: ['pending', 'processing'] },
    withdrawalType: 'bank'
  }).populate('user', 'name email').lean();

  const pendingTotal = pending.reduce((sum, w) => sum + w.amount, 0);

  // Recent failures that may need retry
  const recentFailed = await Withdrawal.find({
    status: 'failed',
    rejectionReason: 'Insufficient Balance in Debit Account',
    withdrawalType: 'bank'
  }).populate('user', 'name email').lean();

  const failedTotal = recentFailed.reduce((sum, w) => sum + w.amount, 0);

  console.log('\n--- PENDING (waiting to be paid) ---');
  console.log('Count:', pending.length);
  console.log('Total:', `₦${pendingTotal.toLocaleString()}`);
  pending.forEach((w, i) => {
    console.log(`[${i+1}] ${w.user?.email} — ₦${w.amount?.toLocaleString()} (${w.status})`);
  });

  console.log('\n--- FAILED DUE TO INSUFFICIENT LENCO BALANCE ---');
  console.log('Count:', recentFailed.length);
  console.log('Total:', `₦${failedTotal.toLocaleString()}`);
  recentFailed.forEach((w, i) => {
    console.log(`[${i+1}] ${w.user?.email} — ₦${w.amount?.toLocaleString()} on ${w.createdAt?.toISOString().split('T')[0]}`);
  });

  console.log('\n--- SUMMARY ---');
  console.log(`Minimum to top up Lenco: ₦${pendingTotal.toLocaleString()}`);
  console.log(`To also retry failed:    ₦${(pendingTotal + failedTotal).toLocaleString()}`);

  mongoose.connection.close();
}).catch(console.error);
