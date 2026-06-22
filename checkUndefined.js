const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const User = require('./models/User');
const Withdrawal = require('./models/Withdrawal');

mongoose.connect(process.env.MONGODB_URI).then(async () => {
  const undefinedType = await Withdrawal.find({ withdrawalType: { $exists: false } })
    .populate('user', 'name email')
    .select('status amount createdAt user bankName accountName accountNumber')
    .lean();

  console.log('Total undefined type:', undefinedType.length);
  undefinedType.slice(0, 20).forEach((w, i) => {
    console.log(`\n[${i+1}]`, {
      id: w._id,
      user: w.user?.email || 'no user',
      name: w.user?.name || 'no name',
      amount: w.amount,
      status: w.status,
      date: w.createdAt,
      bankName: w.bankName || 'N/A',
      accountName: w.accountName || 'N/A',
      accountNumber: w.accountNumber || 'N/A',
    });
  });

  mongoose.connection.close();
}).catch(console.error);
