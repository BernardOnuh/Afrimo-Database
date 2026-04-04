require('dotenv').config();
const mongoose = require('mongoose');

mongoose.connect(process.env.MONGODB_URI).then(async () => {
  const User = require('./models/User');
  const Tx = require('./models/Transaction');

  const user = await User.findOne({ email: 'onuhbernard4@gmail.com' }).lean();
  if (!user) { console.log('User not found'); process.exit(1); }

  console.log('User:', user.name, '|', user.email, '| id:', user._id);

  const txs = await Tx.find({ userId: user._id, status: 'completed' }).lean();
  console.log('Completed transactions:', txs.length);

  let totalEarnings = 0;
  let totalOwnershipPct = 0;

  txs.forEach(t => {
    const earning = (t.earningKobo || 0) * (t.shares || 0);
    const ownership = (t.ownershipPct || 0) * (t.shares || 0);
    totalEarnings += earning;
    totalOwnershipPct += ownership;
    console.log(
      t.transactionId,
      '| type:', t.type,
      '| shares:', t.shares,
      '| earningKobo:', t.earningKobo,
      '| ownershipPct:', t.ownershipPct,
      '| line earning:', earning,
      '| line ownership:', ownership
    );
  });

  console.log('\n--- TOTALS ---');
  console.log('Total Earnings:', totalEarnings, '(' + (totalEarnings/1000) + 'k)');
  console.log('Total Ownership:', totalOwnershipPct.toFixed(7) + '%');

  process.exit(0);
});
