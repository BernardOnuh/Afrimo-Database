require('dotenv').config();
const mongoose = require('mongoose');

mongoose.connect(process.env.MONGODB_URI).then(async () => {
  const UserShare = require('./models/UserShare');

  const allUserShares = await UserShare.find({}).lean();
  console.log('Total users with UserShare records:', allUserShares.length);

  let usersWithCompleted = 0;
  let usersWithNoCompleted = 0;
  let totalCompletedTxs = 0;
  let totalPendingTxs = 0;

  allUserShares.forEach(us => {
    const completed = (us.transactions || []).filter(t => t.status === 'completed');
    const pending = (us.transactions || []).filter(t => t.status === 'pending');
    totalCompletedTxs += completed.length;
    totalPendingTxs += pending.length;
    if (completed.length > 0) usersWithCompleted++;
    else usersWithNoCompleted++;
  });

  console.log('Users with completed transactions in UserShare:', usersWithCompleted);
  console.log('Users with NO completed transactions in UserShare:', usersWithNoCompleted);
  console.log('Total completed txs across all users:', totalCompletedTxs);
  console.log('Total pending txs across all users:', totalPendingTxs);

  // Sample a few completed UserShare transactions to check field availability
  const sample = allUserShares.find(us => us.transactions.some(t => t.status === 'completed'));
  if (sample) {
    const completedSample = sample.transactions.filter(t => t.status === 'completed').slice(0, 3);
    console.log('\nSample completed UserShare transactions:');
    completedSample.forEach(t => console.log(JSON.stringify(t, null, 2)));
  }

  process.exit(0);
});
