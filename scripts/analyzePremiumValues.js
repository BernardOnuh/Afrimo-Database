'use strict';

/**
 * analyzePremiumValues.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Analyzes existing Premium shares to find the standard ownershipPct and earningKobo
 * ─────────────────────────────────────────────────────────────────────────────
 */

require('dotenv').config();
const mongoose = require('mongoose');

const PaymentTransaction = require('../models/Transaction');
const UserShare = require('../models/UserShare');

async function main() {
  console.log('🔌  Connecting to MongoDB…');
  await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
  console.log('✅  Connected\n');

  // Get all completed premium shares from PT
  console.log('📥  Analyzing PaymentTransaction Premium shares…\n');
  const ptPremium = await PaymentTransaction.find({
    type: 'share',
    status: 'completed',
    packageLabel: { $in: ['Premium', 'premium'] }
  }).lean();

  if (ptPremium.length > 0) {
    console.log('💎  PaymentTransaction - Premium Shares:\n');
    
    const ownership = {};
    const earning = {};
    
    for (const doc of ptPremium) {
      const ownerPct = parseFloat(doc.ownershipPct) || 0;
      const earning_ = parseFloat(doc.earningKobo) || 0;
      
      const ownKey = ownerPct.toString();
      const earnKey = earning_.toString();
      
      ownership[ownKey] = (ownership[ownKey] || 0) + 1;
      earning[earnKey] = (earning[earnKey] || 0) + 1;
    }

    console.log('   ownershipPct distribution:');
    const sortedOwn = Object.entries(ownership).sort((a, b) => b[1] - a[1]);
    for (const [val, count] of sortedOwn.slice(0, 10)) {
      const pct = ((count / ptPremium.length) * 100).toFixed(1);
      console.log(`     ${val}: ${count} (${pct}%)`);
    }

    console.log('\n   earningKobo distribution:');
    const sortedEarn = Object.entries(earning).sort((a, b) => b[1] - a[1]);
    for (const [val, count] of sortedEarn.slice(0, 10)) {
      const pct = ((count / ptPremium.length) * 100).toFixed(1);
      console.log(`     ${val}: ${count} (${pct}%)`);
    }
    
    console.log(`\n   Total premium completed shares: ${ptPremium.length}`);
  } else {
    console.log('⚠️   No completed premium shares found in PaymentTransaction\n');
  }

  // Get all completed premium shares from UserShare
  console.log('\n📥  Analyzing UserShare Premium shares…\n');
  
  const usDocs = await UserShare.find({
    'transactions.packageLabel': { $in: ['Premium', 'premium'] }
  }).lean();

  const usPremium = [];
  for (const doc of usDocs) {
    for (const tx of (doc.transactions || [])) {
      if (tx.packageLabel === 'Premium' || tx.packageLabel === 'premium') {
        if (tx.status === 'completed') {
          usPremium.push(tx);
        }
      }
    }
  }

  if (usPremium.length > 0) {
    console.log('💎  UserShare - Premium Shares:\n');
    
    const ownership = {};
    const earning = {};
    
    for (const tx of usPremium) {
      const ownerPct = parseFloat(tx.ownershipPct) || 0;
      const earning_ = parseFloat(tx.earningKobo) || 0;
      
      const ownKey = ownerPct.toString();
      const earnKey = earning_.toString();
      
      ownership[ownKey] = (ownership[ownKey] || 0) + 1;
      earning[earnKey] = (earning[earnKey] || 0) + 1;
    }

    console.log('   ownershipPct distribution:');
    const sortedOwn = Object.entries(ownership).sort((a, b) => b[1] - a[1]);
    for (const [val, count] of sortedOwn.slice(0, 10)) {
      const pct = ((count / usPremium.length) * 100).toFixed(1);
      console.log(`     ${val}: ${count} (${pct}%)`);
    }

    console.log('\n   earningKobo distribution:');
    const sortedEarn = Object.entries(earning).sort((a, b) => b[1] - a[1]);
    for (const [val, count] of sortedEarn.slice(0, 10)) {
      const pct = ((count / usPremium.length) * 100).toFixed(1);
      console.log(`     ${val}: ${count} (${pct}%)`);
    }
    
    console.log(`\n   Total premium completed shares: ${usPremium.length}`);
  } else {
    console.log('⚠️   No completed premium shares found in UserShare\n');
  }

  console.log('\n---\n');
  console.log('💡  Use the most common values above to set in updateSharesToPremium.js\n');

  await mongoose.disconnect();
}

main().catch(err => {
  console.error('Error:', err.message);
  mongoose.disconnect();
  process.exit(1);
});