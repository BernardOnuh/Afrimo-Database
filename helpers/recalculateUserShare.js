// helpers/recalculateUserShare.js

const TransactionV2 = require('../models/TransactionV2');
const UserShareV2   = require('../models/UserShareV2');

const recalculateUserShare = async (userId) => {
  const txs = await TransactionV2.find({ userId }).lean();

  let regularOwnershipPct   = 0;
  let cofounderOwnershipPct = 0;
  let pendingOwnershipPct   = 0;
  let totalEarningKobo      = 0;
  let totalInvestedNaira    = 0;
  let totalInvestedUSDT     = 0;

  for (const tx of txs) {
    const pct      = parseFloat(tx.ownershipPct)  || 0;
    const earn     = parseFloat(tx.earningKobo)   || 0;
    const amt      = parseFloat(tx.totalAmount)   || 0;
    const currency = (tx.currency || 'naira').toLowerCase();

    if (tx.status === 'completed') {
      if (currency === 'naira') totalInvestedNaira += amt;
      else                      totalInvestedUSDT  += amt;

      totalEarningKobo += earn;

      if (tx.type === 'co-founder') cofounderOwnershipPct += pct;
      else                          regularOwnershipPct   += pct;

    } else if (tx.status === 'pending') {
      pendingOwnershipPct += pct;
    }
    // failed / rejected / cancelled contribute nothing
  }

  const totalOwnershipPct = parseFloat(
    (regularOwnershipPct + cofounderOwnershipPct).toFixed(7)
  );

  const updated = await UserShareV2.findOneAndUpdate(
    { user: userId },
    {
      user                  : userId,
      totalOwnershipPct,
      regularOwnershipPct   : +regularOwnershipPct.toFixed(7),
      cofounderOwnershipPct : +cofounderOwnershipPct.toFixed(7),
      pendingOwnershipPct   : +pendingOwnershipPct.toFixed(7),
      totalEarningKobo,
      totalInvestedNaira,
      totalInvestedUSDT,
      transactionCount      : txs.length,
      lastRecalculatedAt    : new Date()
    },
    { upsert: true, new: true }
  );

  return updated;
};

module.exports = recalculateUserShare;