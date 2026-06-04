'use strict';

require('dotenv').config();
const mongoose = require('mongoose');
const PaymentTransaction = require('../models/Transaction');
const UserShare = require('../models/UserShare');

async function main() {
  console.log('🔌  Connecting to MongoDB…');
  await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
  console.log('✅  Connected\n');

  const startDate = new Date('2025-01-01');
  const endDate = new Date('2026-02-25T23:59:59Z');

  // Check PT values
  console.log('💎  PaymentTransaction Premium Shares (2025-01-01 to 2026-02-25)\n');
  
  const ptShares = await PaymentTransaction.find({
    type: 'share',
    packageLabel: 'Premium',
    createdAt: { $gte: startDate, $lte: endDate }
  }).lean();

  console.log(`Total: ${ptShares.length}\n`);

  // Check ownershipPct distribution
  const ownership = {};
  const earning = {};
  
  for (const doc of ptShares) {
    const own = parseFloat(doc.ownershipPct) || 0;
    const earn = parseFloat(doc.earningKobo) || 0;
    
    ownership[own] = (ownership[own] || 0) + 1;
    earning[earn] = (earning[earn] || 0) + 1;
  }

  console.log('ownershipPct distribution:');
  const sortedOwn = Object.entries(ownership).sort((a, b) => b[1] - a[1]);
  for (const [val, count] of sortedOwn) {
    const pct = ((count / ptShares.length) * 100).toFixed(1);
    console.log(`  ${val}: ${count} (${pct}%)`);
  }

  console.log('\nearningKobo distribution:');
  const sortedEarn = Object.entries(earning).sort((a, b) => b[1] - a[1]);
  for (const [val, count] of sortedEarn) {
    const pct = ((count / ptShares.length) * 100).toFixed(1);
    console.log(`  ${val}: ${count} (${pct}%)`);
  }

  console.log('\n---\n');

  // Check US values
  console.log('💎  UserShare Premium Shares (2025-01-01 to 2026-02-25)\n');

  const usDocs = await UserShare.find({
    'transactions.packageLabel': 'Premium'
  }).lean();

  const usPremium = [];
  for (const doc of usDocs) {
    for (const tx of (doc.transactions || [])) {
      if (tx.packageLabel === 'Premium' && tx.createdAt) {
        const created = new Date(tx.createdAt);
        if (created >= startDate && created <= endDate) {
          usPremium.push(tx);
        }
      }
    }
  }

  console.log(`Total: ${usPremium.length}\n`);

  if (usPremium.length > 0) {
    const usOwnership = {};
    const usEarning = {};
    
    for (const tx of usPremium) {
      const own = parseFloat(tx.ownershipPct) || 0;
      const earn = parseFloat(tx.earningKobo) || 0;
      
      usOwnership[own] = (usOwnership[own] || 0) + 1;
      usEarning[earn] = (usEarning[earn] || 0) + 1;
    }

    console.log('ownershipPct distribution:');
    const sortedUsOwn = Object.entries(usOwnership).sort((a, b) => b[1] - a[1]);
    for (const [val, count] of sortedUsOwn) {
      const pct = ((count / usPremium.length) * 100).toFixed(1);
      console.log(`  ${val}: ${count} (${pct}%)`);
    }

    console.log('\nearningKobo distribution:');
    const sortedUsEarn = Object.entries(usEarning).sort((a, b) => b[1] - a[1]);
    for (const [val, count] of sortedUsEarn) {
      const pct = ((count / usPremium.length) * 100).toFixed(1);
      console.log(`  ${val}: ${count} (${pct}%)`);
    }
  }

  console.log('\n---\n');

  // Summary
  console.log('✅  Summary:\n');
  console.log(`  PT Premium shares: ${ptShares.length}`);
  console.log(`  US Premium shares: ${usPremium.length}`);
  
  const targetOwn = 0.00005;
  const targetEarn = 30;
  
  const ptMatching = ptShares.filter(doc => 
    Math.abs((parseFloat(doc.ownershipPct) || 0) - targetOwn) < 0.000001 &&
    Math.abs((parseFloat(doc.earningKobo) || 0) - targetEarn) < 0.01
  ).length;
  
  const usMatching = usPremium.filter(tx =>
    Math.abs((parseFloat(tx.ownershipPct) || 0) - targetOwn) < 0.000001 &&
    Math.abs((parseFloat(tx.earningKobo) || 0) - targetEarn) < 0.01
  ).length;

  console.log(`  PT with target values (0.00005, 30): ${ptMatching}/${ptShares.length}`);
  console.log(`  US with target values (0.00005, 30): ${usMatching}/${usPremium.length}`);

  await mongoose.disconnect();
}

main().catch(err => {
  console.error('Error:', err.message);
  mongoose.disconnect();
  process.exit(1);
});