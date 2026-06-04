'use strict';

require('dotenv').config();
const mongoose = require('mongoose');
const PaymentTransaction = require('../models/Transaction');

async function main() {
  console.log('🔌  Connecting to MongoDB…');
  await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
  console.log('✅  Connected\n');

  const startDate = new Date('2025-01-01');
  const endDate = new Date('2026-02-25T23:59:59Z');

  // Get ALL shares in date range
  const allShares = await PaymentTransaction.find({
    type: 'share',
    createdAt: {
      $gte: startDate,
      $lte: endDate
    }
  }).lean();

  console.log(`Total shares in date range: ${allShares.length}\n`);

  // Group by packageLabel
  const byLabel = {};
  for (const doc of allShares) {
    const label = doc.packageLabel === undefined ? '(undefined)' : String(doc.packageLabel);
    if (!byLabel[label]) byLabel[label] = 0;
    byLabel[label]++;
  }

  console.log('Distribution by packageLabel:\n');
  for (const [label, count] of Object.entries(byLabel)) {
    console.log(`  "${label}": ${count}`);
  }

  console.log('\n---\n');

  // Test different queries
  console.log('Testing queries:\n');

  const q1 = await PaymentTransaction.countDocuments({
    type: 'share',
    createdAt: { $gte: startDate, $lte: endDate },
    packageLabel: 'Premium'
  });
  console.log(`  packageLabel == 'Premium': ${q1}`);

  const q2 = await PaymentTransaction.countDocuments({
    type: 'share',
    createdAt: { $gte: startDate, $lte: endDate },
    packageLabel: { $ne: 'Premium' }
  });
  console.log(`  packageLabel != 'Premium': ${q2}`);

  const q3 = await PaymentTransaction.countDocuments({
    type: 'share',
    createdAt: { $gte: startDate, $lte: endDate },
    packageLabel: { $exists: false }
  });
  console.log(`  packageLabel doesn't exist: ${q3}`);

  const q4 = await PaymentTransaction.countDocuments({
    type: 'share',
    createdAt: { $gte: startDate, $lte: endDate },
    $or: [
      { packageLabel: { $ne: 'Premium' } },
      { packageLabel: { $exists: false } }
    ]
  });
  console.log(`  (packageLabel != 'Premium' OR doesn't exist): ${q4}`);

  console.log('\n---\n');

  // Show sample records
  console.log('Sample non-Premium records:\n');
  const samples = await PaymentTransaction.find({
    type: 'share',
    createdAt: { $gte: startDate, $lte: endDate },
    packageLabel: { $ne: 'Premium' }
  }).limit(5).lean();

  for (const doc of samples) {
    console.log(`  ${doc.transactionId}`);
    console.log(`    packageLabel: ${JSON.stringify(doc.packageLabel)}`);
    console.log(`    ownershipPct: ${doc.ownershipPct}`);
    console.log(`    earningKobo: ${doc.earningKobo}`);
    console.log('');
  }

  await mongoose.disconnect();
}

main().catch(err => {
  console.error('Error:', err.message);
  mongoose.disconnect();
  process.exit(1);
});