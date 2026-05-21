require('dotenv').config();
const mongoose = require('mongoose');

mongoose.connect(process.env.MONGODB_URI).then(async () => {
  const User = require('./models/User');
  const Tx = require('./models/Transaction');
  const UserShare = require('./models/UserShare');

  const user = await User.findOne({ email: 'onuhbernard4@gmail.com' }).lean();
  console.log('User id:', user._id);

  // Check all transactions regardless of status
  const allTxs = await Tx.find({ userId: user._id }).lean();
  console.log('All transactions for this userId:', allTxs.length);
  allTxs.forEach(t => console.log(t.transactionId, '| status:', t.status, '| type:', t.type, '| shares:', t.shares));

  // Check UserShare record
  const userShare = await UserShare.findOne({ user: user._id }).lean();
  console.log('\nUserShare totalShares:', userShare?.totalShares);
  console.log('UserShare transactions count:', userShare?.transactions?.length);
  if (userShare?.transactions?.length > 0) {
    userShare.transactions.slice(0, 3).forEach(t => {
      console.log(t.transactionId, '| status:', t.status, '| shares:', t.shares, '| paymentMethod:', t.paymentMethod);
    });
  }

  process.exit(0);
});
