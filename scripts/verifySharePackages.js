'use strict';

/**
 * verifySharePackages.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Verifies the package distribution of share transactions in the legacy period
 * (last year through Feb 25, 2026)
 *
 * Usage:
 *   node verifySharePackages.js
 *   node verifySharePackages.js --startDate 2025-01-01
 * ─────────────────────────────────────────────────────────────────────────────
 */

require('dotenv').config();
const mongoose = require('mongoose');

const PaymentTransaction = require('../models/Transaction');

const args = process.argv.slice(2);
const startDateArg = args[args.indexOf('--startDate') + 1] || '2025-01-01';
const endDate = new Date('2026-02-25T23:59:59Z');

async function main() {
  console.log('🔌  Connecting to MongoDB…');
  await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
  console.log('✅  Connected\n');

  const startDate = new Date(startDateArg);

  console.log(`📊  Verifying share packages (${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]})\n`);

  // Get all shares in date range
  const allShares = await PaymentTransaction.find({
    type: 'share',
    createdAt: {
      $gte: startDate,
      $lte: endDate
    }
  }).lean();

  console.log(`Total share transactions: ${allShares.length}\n`);

  // Group by package
  const byPackage = {};
  const byStatus = {};

  for (const doc of allShares) {
    // Handle both string and ObjectId packageIds
    let pkg = doc.packageLabel || doc.packageId || '(undefined)';
    if (pkg && typeof pkg === 'object') {
      pkg = pkg.toString();
    }
    const status = doc.status || 'unknown';

    if (!byPackage[pkg]) byPackage[pkg] = { count: 0, amount: 0, records: [] };
    if (!byStatus[status]) byStatus[status] = { count: 0, amount: 0 };

    byPackage[pkg].count++;
    byPackage[pkg].amount += doc.amount || 0;
    byPackage[pkg].records.push({
      txId: doc.transactionId,
      user: doc.userId,
      amount: doc.amount,
      status: doc.status,
      created: new Date(doc.createdAt).toISOString().split('T')[0]
    });

    byStatus[status].count++;
    byStatus[status].amount += doc.amount || 0;
  }

  console.log('📦  By Package:\n');
  for (const [pkg, data] of Object.entries(byPackage)) {
    const isPremium = pkg.toLowerCase() === 'premium';
    const icon = isPremium ? '✅' : '⚠️ ';
    console.log(`  ${icon} ${pkg}`);
    console.log(`     Count: ${data.count}`);
    console.log(`     Total: ₦${(data.amount || 0).toLocaleString()}`);
    console.log(`     Avg: ₦${(data.count > 0 ? (data.amount / data.count).toFixed(2) : 0)}`);
    console.log('');
  }

  console.log('📊  By Status:\n');
  for (const [status, data] of Object.entries(byStatus)) {
    console.log(`  ${status}: ${data.count} (₦${(data.amount || 0).toLocaleString()})`);
  }
  console.log('');

  // Find non-premium
  const nonPremium = allShares.filter(doc => {
    let pkg = doc.packageLabel || doc.packageId || '';
    // Convert ObjectId to string if needed
    if (pkg && typeof pkg === 'object') {
      pkg = pkg.toString();
    }
    return String(pkg).toLowerCase() !== 'premium';
  });

  if (nonPremium.length > 0) {
    console.log(`⚠️   Non-Premium Shares: ${nonPremium.length}\n`);
    console.log('   These should be marked as Premium:\n');

    const summary = {};
    for (const doc of nonPremium) {
      const pkg = doc.packageLabel || doc.packageId || '(undefined)';
      if (!summary[pkg]) summary[pkg] = 0;
      summary[pkg]++;
    }

    for (const [pkg, count] of Object.entries(summary)) {
      console.log(`   ${pkg}: ${count}`);
    }
    console.log('');

    console.log('   Sample records:');
    for (const doc of nonPremium.slice(0, 5)) {
      console.log(`     ${doc.transactionId} (${doc.packageLabel || doc.packageId || 'undefined'})`);
    }
    if (nonPremium.length > 5) {
      console.log(`     ... and ${nonPremium.length - 5} more`);
    }
    console.log('');

    console.log('   To update these to Premium, run:');
    console.log(`     node updateSharesToPremium.js --confirm --startDate ${startDateArg}\n`);
  } else {
    console.log('✅  All shares are already marked as Premium!\n');
  }

  await mongoose.disconnect();
}

main().catch(err => {
  console.error('Error:', err.message);
  mongoose.disconnect();
  process.exit(1);
});