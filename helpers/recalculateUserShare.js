// helpers/recalculateUserShare.js
const TransactionV2 = require('../models/TransactionV2');
const UserShareV2   = require('../models/UserShareV2');

/**
 * Recomputes UserShareV2 snapshot from all TransactionV2 records for a user.
 * Call this after any create / update / delete on TransactionV2.
 */
async function recalculateUserShare(userId) {
  const txs = await TransactionV2.find({ userId }).lean();

  let totalOwnershipPct     = 0;
  let regularOwnershipPct   = 0;
  let cofounderOwnershipPct = 0;
  let pendingOwnershipPct   = 0;
  let totalEarningKobo      = 0;
  let totalInvestedNaira    = 0;
  let totalInvestedUSDT     = 0;

  for (const tx of txs) {
    const pct    = parseFloat(tx.ownershipPct)  || 0;
    const earn   = parseFloat(tx.earningKobo)   || 0;
    const amount = parseFloat(tx.totalAmount)   || 0;
    const cur    = (tx.currency || 'naira').toLowerCase();

    if (tx.status === 'completed') {
      totalOwnershipPct += pct;
      totalEarningKobo  += earn;

      if (tx.type === 'co-founder') {
        cofounderOwnershipPct += pct;
      } else {
        regularOwnershipPct += pct;
      }

      if (cur === 'usdt') totalInvestedUSDT  += amount;
      else                totalInvestedNaira += amount;

    } else if (tx.status === 'pending') {
      pendingOwnershipPct += pct;
    }
  }

  const snapshot = await UserShareV2.findOneAndUpdate(
    { user: userId },
    {
      totalOwnershipPct,
      regularOwnershipPct,
      cofounderOwnershipPct,
      pendingOwnershipPct,
      totalEarningKobo,
      totalInvestedNaira,
      totalInvestedUSDT,
      transactionCount   : txs.length,
      lastRecalculatedAt : new Date()
    },
    { upsert: true, new: true }
  );

  return snapshot;
}

module.exports = recalculateUserShare;