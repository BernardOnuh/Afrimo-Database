// helpers/writeToV2.js
const TransactionV2        = require('../models/TransactionV2');
const recalculateUserShare = require('./recalculateUserShare');

/**
 * Upserts a transaction into TransactionV2 and recalculates the user snapshot.
 *
 * @param {Object} tx  — normalized transaction data (see fields below)
 * @returns {Object}   — { v2tx, userShareSnapshot }
 *
 * Accepted fields:
 *   transactionId*, userId*, type*, shares*, tierKey*,
 *   totalAmount*, ownershipPct* (per-share), earningKobo (per-share),
 *   currency*, status, paymentMethod, paymentProof, enteredBy, note
 *
 * ownershipPct and earningKobo passed in are PER-SHARE values.
 * This function derives totals automatically.
 */
async function writeToV2(tx) {
  const shareCount           = parseInt(tx.shares)        || 1;
  const totalAmountVal       = parseFloat(tx.totalAmount) || 0;
  const ownershipPctPerShare = parseFloat(tx.ownershipPct || tx.ownershipPctPerShare) || 0;
  const earningKoboPerShare  = parseFloat(tx.earningKobo  || tx.earningKoboPerShare)  || 0;

  const totalOwnershipPct = ownershipPctPerShare * shareCount;
  const totalEarningKobo  = earningKoboPerShare  * shareCount;
  const pricePerShare     = shareCount > 0 ? totalAmountVal / shareCount : 0;

  const doc = {
    transactionId        : tx.transactionId,
    userId               : tx.userId,
    type                 : tx.type || 'share',
    shares               : shareCount,
    tierKey              : tx.tierKey || tx.packageId || '',
    pricePerShare,
    ownershipPctPerShare,
    earningKoboPerShare,
    totalAmount          : totalAmountVal,
    ownershipPct         : totalOwnershipPct,
    earningKobo          : totalEarningKobo,
    currency             : (tx.currency || 'naira').toLowerCase(),
    status               : tx.status || 'pending',
    paymentMethod        : tx.paymentMethod,
    paymentProof         : tx.paymentProof || tx.paymentProofCloudinaryUrl,
    enteredBy            : tx.enteredBy || tx.adminId,
    note                 : tx.note || tx.adminNote || tx.adminNotes
  };

  const v2tx = await TransactionV2.findOneAndUpdate(
    { transactionId: tx.transactionId },
    doc,
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  const userShareSnapshot = await recalculateUserShare(tx.userId);

  return { v2tx, userShareSnapshot };
}

module.exports = writeToV2;