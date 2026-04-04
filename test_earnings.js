require('dotenv').config();
const mongoose = require('mongoose');

mongoose.connect(process.env.MONGODB_URI).then(async () => {
  const User = require('./models/User');
  const UserShare = require('./models/UserShare');

  const PRICE_MAP = {
    25000: { earningKobo: 6000, ownershipPct: 0.00001 },
    30000: { earningKobo: 6000, ownershipPct: 0.00001 },
    35000: { earningKobo: 6000, ownershipPct: 0.00001 },
    40000: { earningKobo: 14000, ownershipPct: 0.000021 },
    50000: { earningKobo: 14000, ownershipPct: 0.000021 },
    55000: { earningKobo: 14000, ownershipPct: 0.000021 },
    70000: { earningKobo: 30000, ownershipPct: 0.00005 },
    75000: { earningKobo: 30000, ownershipPct: 0.00005 },
    100000: { earningKobo: 30000, ownershipPct: 0.00005 },
    500000: { earningKobo: 14000, ownershipPct: 0.000021 },
    700000: { earningKobo: 14000, ownershipPct: 0.000021 },
    800000: { earningKobo: 14000, ownershipPct: 0.000462 },
    1000000: { earningKobo: 14000, ownershipPct: 0.000462 },
    30: { earningKobo: 6000, ownershipPct: 0.00001 },
    40: { earningKobo: 14000, ownershipPct: 0.000021 },
    50: { earningKobo: 14000, ownershipPct: 0.000021 },
    75: { earningKobo: 30000, ownershipPct: 0.00005 },
    100: { earningKobo: 30000, ownershipPct: 0.00005 },
  };

  // Test specific users
  const emails = ['onuhbernard4@gmail.com'];
  
  // Also grab 3 random users with shares
  const randomUsers = await UserShare.find({ totalShares: { $gt: 0 } }).limit(3).lean();

  for (const us of randomUsers) {
    const user = await User.findById(us.user).lean();
    if (user) emails.push(user.email);
  }

  for (const email of emails) {
    const user = await User.findOne({ email }).lean();
    if (!user) continue;
    const us = await UserShare.findOne({ user: user._id }).lean();
    if (!us) { console.log(email, '| NO USERSHARE'); continue; }

    const completed = (us.transactions || []).filter(t => t.status === 'completed');
    let totalEarnings = 0;
    let totalOwnershipPct = 0;
    completed.forEach(t => {
      const pps = t.pricePerShare || 0;
      const mapping = PRICE_MAP[pps] || { earningKobo: 6000, ownershipPct: 0.00001 };
      totalEarnings += mapping.earningKobo * (t.shares || 0);
      totalOwnershipPct += mapping.ownershipPct * (t.shares || 0);
    });

    console.log(email, '| totalShares:', us.totalShares, '| completedTxs:', completed.length, '| earnings:', totalEarnings/1000 + 'k', '| ownership:', totalOwnershipPct.toFixed(7) + '%');
  }

  process.exit(0);
});
