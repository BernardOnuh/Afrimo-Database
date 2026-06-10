// helpers/writeToV2.js
const TransactionV2 = require('../models/TransactionV2');
const TierConfig = require('../models/TierConfig');
const recalculateUserShare = require('./recalculateUserShare');

/**
 * Upserts a transaction into TransactionV2 and recalculates the user snapshot.
 *
 * @param {Object} tx — normalized transaction data
 * @returns {Object} — { v2tx, userShareSnapshot }
 */
async function writeToV2(tx) {
  // Get tier config to check if this is a co-founder package
  const config = await TierConfig.getCurrentConfig();
  const tierKey = tx.tierKey || tx.packageId;
  const tier = tierKey ? config.tiers.get(tierKey) : null;
  
  const isCoFounder = (tx.type === 'co-founder') || 
                      (tier && (tier.type === 'co-founder' || tier.type === 'cofounder'));
  
  let shareCount = parseInt(tx.shares) || 1;
  let ownershipPctPerShare = parseFloat(tx.ownershipPct || tx.ownershipPctPerShare) || 0;
  let earningKoboPerShare = parseFloat(tx.earningKobo || tx.earningKoboPerShare) || 0;
  let totalAmountVal = parseFloat(tx.totalAmount) || parseFloat(tx.amount) || 0;
  
  // Store original co-founder values for reference
  let coFounderUnits = null;
  let coFounderOwnershipPct = null;
  let coFounderEarningKobo = null;
  let sharesIncluded = null;
  
  // 🔥 FIX: Convert co-founder packages to regular share equivalents
  if (isCoFounder && tier) {
    // Save original co-founder purchase data
    coFounderUnits = shareCount;
    coFounderOwnershipPct = ownershipPctPerShare;
    coFounderEarningKobo = earningKoboPerShare;
    sharesIncluded = tier.sharesIncluded || 1;
    
    // Convert to regular share equivalents for unified calculation
    // Each co-founder "share" equals X regular shares
    const regularShareCount = shareCount * sharesIncluded;
    const regularOwnershipPct = ownershipPctPerShare * sharesIncluded;
    const regularEarningKobo = earningKoboPerShare * sharesIncluded;
    
    // Update values to regular share equivalents
    shareCount = regularShareCount;
    ownershipPctPerShare = regularOwnershipPct;
    earningKoboPerShare = regularEarningKobo;
    
    // Total amount stays the same (user paid the same)
    // totalAmountVal unchanged
  }
  
  const totalOwnershipPct = ownershipPctPerShare * shareCount;
  const totalEarningKobo = earningKoboPerShare * shareCount;
  const pricePerShare = shareCount > 0 ? totalAmountVal / shareCount : 0;
  
  const doc = {
    transactionId: tx.transactionId,
    userId: tx.userId,
    type: tx.type || 'share',
    shares: shareCount,
    tierKey: tierKey || '',
    pricePerShare,
    ownershipPctPerShare,
    earningKoboPerShare,
    totalAmount: totalAmountVal,
    ownershipPct: totalOwnershipPct,
    earningKobo: totalEarningKobo,
    currency: (tx.currency || 'naira').toLowerCase(),
    status: tx.status || 'pending',
    paymentMethod: tx.paymentMethod,
    paymentProof: tx.paymentProof || tx.paymentProofCloudinaryUrl,
    enteredBy: tx.enteredBy || tx.adminId,
    note: tx.note || tx.adminNote || tx.adminNotes,
    
    // 🔥 Store co-founder metadata if applicable
    coFounderUnits,
    coFounderOwnershipPct,
    coFounderEarningKobo,
    sharesIncluded
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