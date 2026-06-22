#!/usr/bin/env node
/**
 * BALANCE FIX SCRIPT
 * Fixes two issues:
 *   1. Negative pendingWithdrawals / processingWithdrawals (double-decrement bug)
 *   2. undefined availableBalance (field never computed/stored)
 *
 * Usage:
 *   node fixAllBalances.js --dryRun     (preview only)
 *   node fixAllBalances.js --execute    (apply fixes)
 */

const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const User = require('./models/User');
const Referral = require('./models/Referral');

const args = process.argv.slice(2);
const isDryRun = args.includes('--dryRun') || args.includes('--dry-run');
const isExecute = args.includes('--execute');

if (!isDryRun && !isExecute) {
  console.error('Please specify --dryRun or --execute');
  process.exit(1);
}

/**
 * Compute correct availableBalance from source of truth fields:
 *   availableBalance = totalEarnings - totalWithdrawn
 * We clamp to 0 if negative (means they've been overpaid, not our problem here)
 */
function computeCorrectBalance(referral) {
  const totalEarnings = referral.totalEarnings || 0;
  const totalWithdrawn = referral.totalWithdrawn || 0;
  const available = totalEarnings - totalWithdrawn;
  return Math.max(0, available);
}

async function run() {
  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI not set');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✅ Connected to MongoDB\n');

  // Find all broken referral records
  const broken = await Referral.find({
    $or: [
      { pendingWithdrawals: { $lt: 0 } },
      { processingWithdrawals: { $lt: 0 } },
      { availableBalance: { $exists: false } },
      { availableBalance: null }
    ]
  }).populate('user', 'name email').lean();

  // Also find any with undefined availableBalance even if balances look ok
  const undefinedBalance = await Referral.find({
    availableBalance: { $exists: false }
  }).populate('user', 'name email').lean();

  // Merge and deduplicate
  const allMap = {};
  [...broken, ...undefinedBalance].forEach(r => {
    allMap[r._id.toString()] = r;
  });
  const all = Object.values(allMap);

  console.log(`Found ${all.length} referral records to fix:\n`);

  const fixes = all.map(r => {
    const correctAvailable = computeCorrectBalance(r);
    const fix = {
      referralId: r._id,
      userId: r.user?._id,
      email: r.user?.email || 'unknown',
      name: r.user?.name || 'unknown',
      before: {
        pendingWithdrawals: r.pendingWithdrawals,
        processingWithdrawals: r.processingWithdrawals,
        availableBalance: r.availableBalance,
        totalEarnings: r.totalEarnings,
        totalWithdrawn: r.totalWithdrawn,
      },
      after: {
        pendingWithdrawals: r.pendingWithdrawals < 0 ? 0 : (r.pendingWithdrawals || 0),
        processingWithdrawals: r.processingWithdrawals < 0 ? 0 : (r.processingWithdrawals || 0),
        availableBalance: correctAvailable,
      }
    };
    return fix;
  });

  // Print preview
  fixes.forEach((f, i) => {
    console.log(`[${i + 1}] ${f.email} — ${f.name}`);
    console.log(`     totalEarnings:            ₦${(f.before.totalEarnings || 0).toLocaleString()}`);
    console.log(`     totalWithdrawn:           ₦${(f.before.totalWithdrawn || 0).toLocaleString()}`);
    console.log(`     pendingWithdrawals:       ₦${(f.before.pendingWithdrawals || 0).toLocaleString()} → ₦${f.after.pendingWithdrawals.toLocaleString()}`);
    console.log(`     processingWithdrawals:    ₦${(f.before.processingWithdrawals || 0).toLocaleString()} → ₦${f.after.processingWithdrawals.toLocaleString()}`);
    console.log(`     availableBalance:         ₦${(f.before.availableBalance || 'undefined')} → ₦${f.after.availableBalance.toLocaleString()}`);
    console.log();
  });

  if (isDryRun) {
    console.log('⚠  DRY RUN — no changes made.');
    await mongoose.connection.close();
    return;
  }

  // Execute fixes
  console.log('Applying fixes...\n');
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    for (const f of fixes) {
      await Referral.findByIdAndUpdate(
        f.referralId,
        {
          $set: {
            pendingWithdrawals: f.after.pendingWithdrawals,
            processingWithdrawals: f.after.processingWithdrawals,
            availableBalance: f.after.availableBalance,
            updatedAt: new Date()
          }
        },
        { session }
      );
      console.log(`✅ Fixed: ${f.email}`);
    }

    await session.commitTransaction();
    session.endSession();

    console.log(`\n✅ All ${fixes.length} records fixed successfully.`);
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    console.error('❌ Error during fix, transaction rolled back:', err);
    process.exit(1);
  }

  await mongoose.connection.close();
  console.log('✅ Done.');
}

run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});