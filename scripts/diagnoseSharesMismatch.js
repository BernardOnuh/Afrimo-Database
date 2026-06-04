'use strict';

/**
 * diagnoseSharesMismatch.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Diagnoses why PT.shares isn't syncing with US.shares
 * ─────────────────────────────────────────────────────────────────────────────
 */

require('dotenv').config();
const mongoose = require('mongoose');

const PaymentTransaction = require('../models/Transaction');
const UserShare = require('../models/UserShare');

async function main() {
  console.log('🔌  Connecting to MongoDB…\n');
  await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);

  // Get the specific transaction from your screenshot
  const txId = 'TXN-5150D4C2-611005';

  console.log(`🔍  Diagnosing: ${txId}\n`);

  // ── Check PaymentTransaction ────────────────────────────────────────────────
  console.log('📋  PaymentTransaction:');
  const ptDoc = await PaymentTransaction.findOne({ transactionId: txId }).lean();
  
  if (!ptDoc) {
    console.log('   ❌  NOT FOUND\n');
  } else {
    console.log(`   _id: ${ptDoc._id}`);
    console.log(`   transactionId: ${ptDoc.transactionId}`);
    console.log(`   shares: ${ptDoc.shares} (type: ${typeof ptDoc.shares})`);
    console.log(`   earningKobo: ${ptDoc.earningKobo}`);
    console.log(`   status: ${ptDoc.status}`);
    console.log(`   updatedAt: ${ptDoc.updatedAt}`);
    console.log(`   syncLog: ${ptDoc.syncLog ? JSON.stringify(ptDoc.syncLog) : 'none'}\n`);
  }

  // ── Check UserShare ────────────────────────────────────────────────────────
  console.log('📋  UserShare:');
  let usDoc = await UserShare.findOne({
    'transactions.transactionId': txId
  }).lean();

  if (!usDoc) {
    console.log('   ❌  NOT FOUND\n');
  } else {
    const tx = usDoc.transactions.find(t => t.transactionId === txId);
    console.log(`   _id: ${usDoc._id}`);
    console.log(`   user: ${usDoc.user}`);
    console.log(`   Transaction:`);
    console.log(`     transactionId: ${tx.transactionId}`);
    console.log(`     shares: ${tx.shares} (type: ${typeof tx.shares})`);
    console.log(`     earningKobo: ${tx.earningKobo}`);
    console.log(`     status: ${tx.status}`);
    console.log(`   updatedAt: ${usDoc.updatedAt}\n`);
  }

  // ── Comparison ──────────────────────────────────────────────────────────────
  if (ptDoc && usDoc) {
    const tx = usDoc.transactions.find(t => t.transactionId === txId);
    const ptShares = parseFloat(ptDoc.shares) || 1;
    const usShares = parseFloat(tx.shares) || 1;
    const ptEarning = parseFloat(ptDoc.earningKobo) || 0;
    const usEarning = parseFloat(tx.earningKobo) || 0;

    console.log('⚖️   Comparison:');
    console.log(`   Shares match: ${Math.abs(ptShares - usShares) < 0.001 ? '✓ YES' : '✗ NO'} (PT=${ptShares}, US=${usShares})`);
    console.log(`   EarningKobo match: ${Math.abs(ptEarning - usEarning) < 0.01 ? '✓ YES' : '✗ NO'} (PT=${ptEarning}, US=${usEarning})\n`);

    // Try a test update
    console.log('🧪  Testing direct update:\n');
    try {
      const testResult = await PaymentTransaction.updateOne(
        { _id: ptDoc._id },
        { $set: { shares: usShares, testUpdate: new Date() } }
      );
      console.log(`   Update result: ${JSON.stringify(testResult)}`);
      
      // Verify
      const updated = await PaymentTransaction.findOne({ _id: ptDoc._id }).lean();
      console.log(`   After update - shares: ${updated.shares}`);
      console.log(`   testUpdate field: ${updated.testUpdate}\n`);
    } catch (err) {
      console.log(`   ❌  Update failed: ${err.message}\n`);
    }
  }

  await mongoose.disconnect();
}

main().catch(err => {
  console.error('Error:', err.message);
  mongoose.disconnect();
  process.exit(1);
});