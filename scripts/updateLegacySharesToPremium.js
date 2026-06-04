'use strict';

/**
 * updateLegacySharesWithMultiplier.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Updates legacy shares in BOTH PaymentTransaction and UserShare with values
 * multiplied by the number of shares purchased.
 *
 * Formula:
 *   ownershipPct = 0.00005 × shares
 *   earningKobo = 30 × shares
 *
 * Example: If user bought 2 shares:
 *   ownershipPct = 0.00005 × 2 = 0.0001
 *   earningKobo = 30 × 2 = 60
 *
 * Usage:
 *   node updateLegacySharesWithMultiplier.js                ← dry-run
 *   node updateLegacySharesWithMultiplier.js --confirm      ← apply updates
 * ─────────────────────────────────────────────────────────────────────────────
 */

require('dotenv').config();
const mongoose = require('mongoose');

const PaymentTransaction = require('../models/Transaction');
const UserShare = require('../models/UserShare');

const args = process.argv.slice(2);
const CONFIRM = args.includes('--confirm');
const DRY_RUN = !CONFIRM;

// Base premium values (per share)
const BASE_VALUES = {
  ownershipPct: 0.00005,
  earningKobo: 30
};

const startDate = new Date('2025-01-01');
const endDate = new Date('2026-02-25T23:59:59Z');

async function main() {
  console.log('🔌  Connecting to MongoDB…');
  await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
  console.log('✅  Connected\n');

  console.log(`📊  Configuration:`);
  console.log(`    Mode: ${DRY_RUN ? '🔍 DRY-RUN' : '⚠️  LIVE UPDATE'}`);
  console.log(`    Date range: 2025-01-01 to 2026-02-25`);
  console.log(`    Base values (per share):`);
  console.log(`      ownershipPct: ${BASE_VALUES.ownershipPct}`);
  console.log(`      earningKobo: ${BASE_VALUES.earningKobo}`);
  console.log(`    Formula: ownershipPct × shares, earningKobo × shares\n`);

  // ── Load all UserShare with Premium shares in date range ──────────────────
  console.log('📥  Loading UserShare Premium shares…');
  const usDocs = await UserShare.find({
    'transactions.packageLabel': 'Premium'
  }).lean();

  // Build map of transactions with their share counts
  const updateMap = {}; // txId -> { shares, ownershipPct, earningKobo, usDocId, txIndex }

  for (const usDoc of usDocs) {
    const txList = usDoc.transactions || [];
    for (let i = 0; i < txList.length; i++) {
      const tx = txList[i];
      if ((tx.packageLabel === 'Premium' || tx.packageLabel === 'premium') && tx.transactionId) {
        const created = new Date(tx.createdAt);
        if (created >= startDate && created <= endDate) {
          const shares = parseFloat(tx.shares) || 1;
          const ownershipPct = BASE_VALUES.ownershipPct * shares;
          const earningKobo = BASE_VALUES.earningKobo * shares;

          updateMap[tx.transactionId] = {
            shares,
            ownershipPct,
            earningKobo,
            usDocId: usDoc._id,
            txIndex: i,
            currentOwnership: tx.ownershipPct || 0,
            currentEarning: tx.earningKobo || 0
          };
        }
      }
    }
  }

  console.log(`    Found ${Object.keys(updateMap).length} Premium transactions\n`);

  // ── Load matching PaymentTransaction records ───────────────────────────────
  console.log('📥  Loading PaymentTransaction records…');
  const ptDocs = await PaymentTransaction.find({
    type: 'share',
    transactionId: { $in: Object.keys(updateMap) },
    createdAt: {
      $gte: startDate,
      $lte: endDate
    }
  }).lean();

  console.log(`    Found ${ptDocs.length} matching PT records\n`);

  if (ptDocs.length === 0) {
    console.log('✅  No records to update!\n');
    await mongoose.disconnect();
    return;
  }

  // ── Display samples ───────────────────────────────────────────────────────
  console.log('📍  Sample updates:\n');
  const samples = ptDocs.slice(0, 5);
  for (const doc of samples) {
    const usData = updateMap[doc.transactionId];
    if (usData) {
      console.log(`    ${doc.transactionId}`);
      console.log(`      Shares: ${usData.shares}`);
      console.log(`      PT ownershipPct: ${doc.ownershipPct || 0} → ${usData.ownershipPct.toFixed(8)}`);
      console.log(`      PT earningKobo: ${doc.earningKobo || 0} → ${usData.earningKobo}`);
      console.log(`      US ownershipPct: ${usData.currentOwnership} → ${usData.ownershipPct.toFixed(8)}`);
      console.log(`      US earningKobo: ${usData.currentEarning} → ${usData.earningKobo}`);
      console.log('');
    }
  }

  if (samples.length < ptDocs.length) {
    console.log(`    ... and ${ptDocs.length - samples.length} more\n`);
  }

  // Summary of multipliers
  const multipliers = {};
  for (const data of Object.values(updateMap)) {
    const key = `${data.shares}x`;
    if (!multipliers[key]) multipliers[key] = 0;
    multipliers[key]++;
  }

  console.log('📊  Share count distribution:\n');
  for (const [mult, count] of Object.entries(multipliers).sort()) {
    console.log(`    ${mult}: ${count} transactions`);
  }
  console.log('');

  if (DRY_RUN) {
    console.log('🔍  DRY-RUN: No changes applied.\n');
    console.log('To apply these updates, run:\n');
    console.log('    node updateLegacySharesWithMultiplier.js --confirm\n');
    await mongoose.disconnect();
    return;
  }

  // ── Apply updates ─────────────────────────────────────────────────────────
  console.log('⏳  Applying updates...\n');

  let ptSuccess = 0;
  let ptFailed = 0;
  let usSuccess = 0;
  let usFailed = 0;
  const errors = [];

  // Update PaymentTransaction documents
  for (const doc of ptDocs) {
    const usData = updateMap[doc.transactionId];
    if (!usData) continue;

    try {
      const result = await PaymentTransaction.updateOne(
        { _id: doc._id },
        {
          $set: {
            packageLabel: 'Premium',
            ownershipPct: usData.ownershipPct,
            earningKobo: usData.earningKobo,
            updatedAt: new Date(),
            'shareMultiplierLog.timestamp': new Date(),
            'shareMultiplierLog.shares': usData.shares,
            'shareMultiplierLog.baseOwnership': BASE_VALUES.ownershipPct,
            'shareMultiplierLog.baseEarning': BASE_VALUES.earningKobo,
            'shareMultiplierLog.calculatedOwnership': usData.ownershipPct,
            'shareMultiplierLog.calculatedEarning': usData.earningKobo,
            'shareMultiplierLog.previousOwnership': doc.ownershipPct || 0,
            'shareMultiplierLog.previousEarning': doc.earningKobo || 0
          }
        }
      );

      if (result.modifiedCount > 0) {
        ptSuccess++;
      } else {
        ptFailed++;
      }
    } catch (err) {
      ptFailed++;
      errors.push({ txId: doc.transactionId, type: 'PT', error: err.message });
    }
  }

  // Update UserShare documents
  for (const [txId, usData] of Object.entries(updateMap)) {
    try {
      const updatePath = `transactions.${usData.txIndex}`;
      const result = await UserShare.updateOne(
        { _id: usData.usDocId },
        {
          $set: {
            [`${updatePath}.packageLabel`]: 'Premium',
            [`${updatePath}.ownershipPct`]: usData.ownershipPct,
            [`${updatePath}.earningKobo`]: usData.earningKobo,
            updatedAt: new Date()
          }
        }
      );

      if (result.modifiedCount > 0) {
        usSuccess++;
      } else {
        useFailed++;
      }
    } catch (err) {
      usFailed++;
      errors.push({ txId, type: 'US', error: err.message });
    }
  }

  console.log(`✅  Update Complete:\n`);
  console.log(`    PaymentTransaction: ${ptSuccess} updated, ${ptFailed} failed`);
  console.log(`    UserShare: ${usSuccess} updated, ${usFailed} failed`);

  if (errors.length > 0) {
    console.log(`\n⚠️   Errors (${errors.length}):`);
    for (const err of errors.slice(0, 5)) {
      console.log(`    ${err.txId} (${err.type}): ${err.error}`);
    }
    if (errors.length > 5) {
      console.log(`    ... and ${errors.length - 5} more`);
    }
  }

  console.log('');
  await mongoose.disconnect();
}

main().catch(err => {
  console.error('Error:', err.message);
  mongoose.disconnect();
  process.exit(1);
});