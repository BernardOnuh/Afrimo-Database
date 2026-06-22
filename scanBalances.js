const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const User = require('./models/User');
const Referral = require('./models/Referral');

mongoose.connect(process.env.MONGODB_URI).then(async () => {
  const referrals = await Referral.find({
    $or: [
      { pendingWithdrawals: { $lt: 0 } },
      { processingWithdrawals: { $lt: 0 } },
      { availableBalance: { $lt: 0 } }
    ]
  }).populate('user', 'name email').lean();

  console.log(`\nFound ${referrals.length} users with negative balances:\n`);

  let totalBroken = 0;
  referrals.forEach((r, i) => {
    console.log(`[${i+1}] ${r.user?.email || 'no email'} - ${r.user?.name || 'no name'}`);
    console.log(`     pendingWithdrawals:    ₦${r.pendingWithdrawals?.toLocaleString()}`);
    console.log(`     processingWithdrawals: ₦${r.processingWithdrawals?.toLocaleString()}`);
    console.log(`     availableBalance:      ₦${r.availaance?.toLocaleString()}`);
    console.log(`     totalEarnings:         ₦${r.totalEarnings?.toLocaleString()}`);
    console.log(`     totalWithdrawn:        ₦${r.totalWithdrawn?.toLocaleString()}`);
    console.log();
    totalBroken++;
  });

  console.log(`Total affected users: ${totalBroken}`);
  mongoose.connection.close();
}).catch(console.error);
