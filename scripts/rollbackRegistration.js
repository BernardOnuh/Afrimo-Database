'use strict';

/**
 * rollbackRegistration.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Deletes TransactionV2 records that were wrongly registered.
 * Targets: transactions with totalAmount > 100,000
 *          AND note containing 'audit-matched' (registered by this script)
 * ─────────────────────────────────────────────────────────────────────────────
 * Usage:
 *   node scripts/rollbackRegistration.js --dry-run          (preview only)
 *   node scripts/rollbackRegistration.js --confirm          (actually delete)
 * ─────────────────────────────────────────────────────────────────────────────
 */

require('dotenv').config();
const mongoose = require('mongoose');
const TransactionV2 = require('../models/TransactionV2');

const args = process.argv.slice(2);
const DRY_RUN = !args.includes('--confirm');

async function main() {
  console.log(DRY_RUN
    ? '🔍  DRY RUN — no deletions will happen. Pass --confirm to delete.\n'
    : '⚠️   LIVE MODE — records WILL be deleted.\n'
  );

  await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
  console.log('✅  Connected to MongoDB\n');

  // Find all records registered by this audit script that exceed ₦100,000
  const targets = await TransactionV2.find({
    note: { $regex: /audit-matched/ },
    totalAmount: { $gt: 100000 }
  }).lean();

  console.log(`🎯  Found ${targets.length} records to roll back (totalAmount > ₦100,000):\n`);

  let totalNaira = 0;
  for (const t of targets) {
    console.log(`  • ${t.transactionId} — ₦${t.totalAmount?.toLocaleString()} (${t.note})`);
    totalNaira += t.totalAmount || 0;
  }

  console.log(`\n  Total to remove: ₦${totalNaira.toLocaleString()} across ${targets.length} records`);

  if (targets.length === 0) {
    console.log('\n✅  Nothing to roll back.');
    await mongoose.disconnect();
    return;
  }

  if (DRY_RUN) {
    console.log('\n⛔  Dry run complete. Run with --confirm to delete these records.');
    await mongoose.disconnect();
    return;
  }

  // Delete them
  const ids = targets.map(t => t._id);
  const result = await TransactionV2.deleteMany({ _id: { $in: ids } });
  console.log(`\n🗑️   Deleted ${result.deletedCount} records.`);

  await mongoose.disconnect();
  console.log('\n✅  Rollback complete.\n');
}

main().catch(err => {
  console.error('❌  Error:', err.message);
  mongoose.disconnect();
  process.exit(1);
});