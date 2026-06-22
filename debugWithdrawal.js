const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

mongoose.connect(process.env.MONGODB_URI).then(async () => {
  const Withdrawal = require('./models/Withdrawal');

  // Get the most recent failed withdrawal
  const recent = await Withdrawal.find({ status: 'failed' })
    .sort({ createdAt: -1 })
    .limit(5)
    .lean();

  console.log('\n--- RECENT FAILED WITHDRAWALS ---\n');
  recent.forEach((w, i) => {
    console.log(`[${i+1}]`, {
      id: w._id,
      amount: w.amount,
      date: w.createdAt,
      rejectionReason: w.rejectionReason,
      adminNotes: w.adminNotes,
      clientReference: w.clientReference,
    });
  });

  // Check env vars (masked)
  console.log('\n--- ENV CHECK ---');
  console.log('LENCO_API_KEY set:', !!process.env.LENCO_API_KEY);
  console.log('LENCO_ACCOUNT_ID set:', !!process.env.LENCO_ACCOUNT_ID);
  console.log('LENCO_ACCOUNT_ID value:', process.env.LENCO_ACCOUNT_ID);

  mongoose.connection.close();
}).catch(console.error);
