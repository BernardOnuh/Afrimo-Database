'use strict';

/**
 * syncSharesAndEarnings.js (v2)
 * ─────────────────────────────────────────────────────────────────────────────
 * Bi-directional sync: fixes shares AND earningKobo mismatches
 *
 * PaymentTransaction is source of truth for both shares AND earningKobo.
 * For each transaction where PT and US differ:
 *   1. Update PT.shares → US.shares (align with actual share count in UserShare)
 *   2. Update US.earningKobo → PT.earningKobo (align earnings with PT)
 *
 * Usage:
 *   node syncSharesAndEarnings.js                    ← dry-run (shows what would change)
 *   node syncSharesAndEarnings.js --confirm          ← actually apply changes
 *   node syncSharesAndEarnings.js --confirm --only completed
 * ─────────────────────────────────────────────────────────────────────────────
 */

require('dotenv').config();
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

// ── Model imports ─────────────────────────────────────────────────────────────
const PaymentTransaction = require('../models/Transaction');
const UserShare = require('../models/UserShare');

// ── CLI args ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const CONFIRM = args.includes('--confirm');
const STATUS_FILTER = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const DRY_RUN = !CONFIRM;

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmtDate = (d) => d ? new Date(d).toISOString().replace('T', ' ').slice(0, 19) : '—';
const fmtAmt = (n) => (parseFloat(n) || 0).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('🔌  Connecting to MongoDB…');
  await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
  console.log('✅  Connected\n');

  console.log(`📊  Mode: ${DRY_RUN ? '🔍 DRY-RUN (no changes)' : '⚠️  LIVE UPDATE'}`);
  if (STATUS_FILTER) console.log(`    Filter: status=${STATUS_FILTER}`);
  console.log('');

  // ── Load all PaymentTransaction records ──────────────────────────────────────
  console.log('📥  Loading PaymentTransaction…');
  const ptQuery = {};
  if (STATUS_FILTER) ptQuery.status = STATUS_FILTER;

  let ptDocs;
  try {
    ptDocs = await PaymentTransaction.find(ptQuery).populate('userId', 'name email').lean();
  } catch (err) {
    ptDocs = await PaymentTransaction.find(ptQuery).lean();
  }
  console.log(`    ${ptDocs.length} records\n`);

  // ── Load all UserShare documents ────────────────────────────────────────────
  console.log('📥  Loading UserShare…');
  let usDocs;
  try {
    usDocs = await UserShare.find({}).populate('user', 'name email').lean();
  } catch (err) {
    usDocs = await UserShare.find({}).lean();
  }
  console.log(`    ${usDocs.length} documents\n`);

  // ── Build map of US transactions ────────────────────────────────────────────
  const usMap = {}; // txId -> { usShares, usEarningKobo, userId, userName, usDocId }
  for (const usDoc of usDocs) {
    const txList = usDoc.transactions || [];
    for (const tx of txList) {
      const txId = tx.transactionId;
      usMap[txId] = {
        usShares: parseFloat(tx.shares) || 1,
        usEarningKobo: parseFloat(tx.earningKobo) || 0,
        userId: usDoc.user?._id || usDoc.user || usDoc.userId,
        userName: usDoc.user?.name || usDoc.user?.email || usDoc.userName || 'Unknown',
        usDocId: usDoc._id,
        usTxIndex: txList.indexOf(tx),
      };
    }
  }

  console.log(`📦  Indexed ${Object.keys(usMap).length} UserShare transactions\n`);

  // ── Find mismatches ────────────────────────────────────────────────────────
  const mismatches = [];

  for (const ptDoc of ptDocs) {
    const txId = ptDoc.transactionId;
    const usData = usMap[txId];

    if (!usData) continue; // No matching UserShare

    const ptShares = parseFloat(ptDoc.shares) || 1;
    const ptEarning = parseFloat(ptDoc.earningKobo) || 0;

    // Check for differences
    const sharesMatch = Math.abs(ptShares - usData.usShares) < 0.001;
    const earningMatch = Math.abs(ptEarning - usData.usEarningKobo) < 0.01;

    if (!sharesMatch || !earningMatch) {
      mismatches.push({
        txId,
        ptDocId: ptDoc._id,
        usDocId: usData.usDocId,
        usTxIndex: usData.usTxIndex,
        ptShares,
        usShares: usData.usShares,
        ptEarning,
        usEarning: usData.usEarningKobo,
        status: ptDoc.status || 'unknown',
        amount: ptDoc.amount || 0,
        userName: usData.userName,
        needsSharesUpdate: !sharesMatch,
        needsEarningUpdate: !earningMatch,
      });
    }
  }

  if (mismatches.length === 0) {
    console.log('✅  No mismatches found. PT and US are in sync.\n');
    await mongoose.disconnect();
    return;
  }

  console.log(`⚠️   Found ${mismatches.length} mismatch(es):\n`);

  // ── Display changes ───────────────────────────────────────────────────────────
  for (const m of mismatches) {
    console.log(`  📌  ${m.txId}`);
    console.log(`      User: ${m.userName}`);
    console.log(`      Status: ${m.status} | Amount: ₦${fmtAmt(m.amount)}`);

    if (m.needsSharesUpdate) {
      console.log(`      Shares: PT[${m.ptShares}] → US[${m.usShares}]`);
    } else {
      console.log(`      Shares: ✓ match (${m.ptShares})`);
    }

    if (m.needsEarningUpdate) {
      console.log(`      earningKobo: PT[${m.ptEarning}] vs US[${m.usEarning}] → US will update to [${m.ptEarning}]`);
    } else {
      console.log(`      earningKobo: ✓ match (${m.ptEarning})`);
    }
    console.log('');
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  const sharesUpdates = mismatches.filter(m => m.needsSharesUpdate).length;
  const earningUpdates = mismatches.filter(m => m.needsEarningUpdate).length;

  console.log(`📊  Summary:`);
  console.log(`    Shares to fix: ${sharesUpdates}`);
  console.log(`    Earnings to fix: ${earningUpdates}`);
  console.log(`    Total records affected: ${mismatches.length}\n`);

  if (DRY_RUN) {
    console.log('🔍  DRY-RUN MODE: No changes applied.\n');
    console.log('To apply these changes, run:\n');
    console.log(`    node syncSharesAndEarnings.js --confirm${STATUS_FILTER ? ` --only ${STATUS_FILTER}` : ''}\n`);
    await mongoose.disconnect();
    return;
  }

  // ── Apply updates ───────────────────────────────────────────────────────────
  console.log('⏳  Applying updates...\n');

  const results = {
    ptSuccess: 0,
    ptFailed: 0,
    usSuccess: 0,
    usFailed: 0,
    errors: [],
  };

  for (const m of mismatches) {
    try {
      // Update PaymentTransaction.shares (if needed)
      if (m.needsSharesUpdate) {
        await PaymentTransaction.updateOne(
          { _id: m.ptDocId },
          {
            $set: {
              shares: m.usShares,
              updatedAt: new Date(),
              syncLog: {
                syncedAt: new Date(),
                previousShares: m.ptShares,
                newShares: m.usShares,
                action: 'synced-shares-from-usershare',
              },
            },
          }
        );
        results.ptSuccess++;
        console.log(`  ✅  ${m.txId} → PT.shares updated (${m.ptShares} → ${m.usShares})`);
      }

      // Update UserShare.earningKobo (if needed)
      if (m.needsEarningUpdate) {
        const updatePath = `transactions.${m.usTxIndex}.earningKobo`;
        await UserShare.updateOne(
          { _id: m.usDocId },
          {
            $set: {
              [updatePath]: m.ptEarning,
              updatedAt: new Date(),
            },
          }
        );
        results.usSuccess++;
        console.log(`  ✅  ${m.txId} → US.earningKobo updated (${m.usEarning} → ${m.ptEarning})`);
      }
    } catch (err) {
      results.ptFailed++;
      results.usFailed++;
      results.errors.push({ txId: m.txId, error: err.message });
      console.log(`  ❌  ${m.txId} failed: ${err.message}`);
    }
  }

  console.log('');
  console.log(`✅  Complete:`);
  console.log(`    PaymentTransaction updates: ${results.ptSuccess} success, ${results.ptFailed} failed`);
  console.log(`    UserShare updates: ${results.usSuccess} success, ${results.usFailed} failed`);

  if (results.errors.length > 0) {
    console.log('\n⚠️   Errors:');
    for (const err of results.errors) {
      console.log(`    ${err.txId}: ${err.error}`);
    }
  }

  console.log('');
  await mongoose.disconnect();
}

main().catch(err => {
  console.error('❌  Error:', err.message);
  console.error(err.stack);
  mongoose.disconnect();
  process.exit(1);
});