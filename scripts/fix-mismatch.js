// fix-mismatch.js
// Run: node scripts/fix-mismatch.js --txn TXN-205C5C6B-605173 --field packageLabel --value Premium

//node scripts/fix-mismatch.js --txn TXN-205C5C6B-605173 --field tierKey --value 69ccd0dc680f6f2a96815a49

require('dotenv').config();
const mongoose = require('mongoose');

const PaymentTransaction = require('../models/Transaction');
const UserShare = require('../models/UserShare');

// Parse CLI args
const args = process.argv.slice(2);
const getArg = (flag) => {
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] : null;
};

const TXN_ID = getArg('--txn') || getArg('--transaction');
const FIELD = getArg('--field');
const VALUE = getArg('--value');
const DRY_RUN = args.includes('--dry-run');

async function fixTransaction(txnId, field, newValue, dryRun = false) {
  console.log('\n' + '═'.repeat(60));
  console.log(`🔧 FIXING TRANSACTION: ${txnId}`);
  console.log(`   Field: ${field} → "${newValue}"`);
  console.log(`   Dry run: ${dryRun ? 'YES' : 'NO'}`);
  console.log('═'.repeat(60));

  // Find current values
  const ptTx = await PaymentTransaction.findOne({ transactionId: txnId });
  const usDoc = await UserShare.findOne({ 'transactions.transactionId': txnId });
  const usTx = usDoc?.transactions.find(t => t.transactionId === txnId);

  if (!ptTx && !usTx) {
    console.log('❌ Transaction not found in either source');
    return false;
  }

  // Show current values
  console.log('\n📋 CURRENT VALUES:');
  if (ptTx) {
    console.log(`   PaymentTransaction.${field}: ${JSON.stringify(ptTx[field])}`);
  }
  if (usTx) {
    console.log(`   UserShare.${field}: ${JSON.stringify(usTx[field])}`);
  }

  if (dryRun) {
    console.log('\n⚠️ DRY RUN - No changes made');
    console.log(`   Would update ${field} to "${newValue}"`);
    return true;
  }

  // Update PaymentTransaction
  let ptUpdated = false;
  if (ptTx && ptTx[field] != newValue) {
    await PaymentTransaction.updateOne(
      { transactionId: txnId },
      { $set: { [field]: newValue } }
    );
    ptUpdated = true;
    console.log(`   ✅ PaymentTransaction.${field} updated`);
  }

  // Update UserShare
  let usUpdated = false;
  if (usTx && usTx[field] != newValue) {
    const updatePath = `transactions.$.${field}`;
    await UserShare.updateOne(
      { 'transactions.transactionId': txnId },
      { $set: { [updatePath]: newValue } }
    );
    usUpdated = true;
    console.log(`   ✅ UserShare.${field} updated`);
  }

  if (!ptUpdated && !usUpdated) {
    console.log('   ⏭️ No changes needed - values already match');
  }

  // Recalculate user totals if needed
  if (usUpdated && usDoc) {
    let totalOwnershipPct = 0;
    let totalEarningKobo = 0;
    for (const tx of usDoc.transactions) {
      if (tx.status === 'completed') {
        totalOwnershipPct += (tx.ownershipPct || 0);
        totalEarningKobo += (tx.earningKobo || 0);
      }
    }
    await UserShare.updateOne(
      { user: usDoc.user },
      { 
        $set: { 
          totalOwnershipPct: parseFloat(totalOwnershipPct.toFixed(7)),
          totalEarningKobo: totalEarningKobo
        } 
      }
    );
    console.log(`   ✅ User totals recalculated`);
  }

  console.log('\n✅ Fix complete!');
  return true;
}

async function main() {
  console.log('🔌 Connecting to MongoDB...');
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
  
  if (!mongoUri) {
    console.error('❌ No database connection string found');
    process.exit(1);
  }
  
  await mongoose.connect(mongoUri);
  console.log('✅ Connected\n');

  if (TXN_ID && FIELD && VALUE !== null) {
    await fixTransaction(TXN_ID, FIELD, VALUE, DRY_RUN);
  } else {
    console.log('Usage:');
    console.log('  node scripts/fix-mismatch.js --txn TXN-XXX --field packageLabel --value Legacy');
    console.log('  node scripts/fix-mismatch.js --txn TXN-XXX --field tierKey --value 69ccd0dc680f6f2a96815a49');
    console.log('  node scripts/fix-mismatch.js --txn TXN-XXX --field packageLabel --value Premium --dry-run');
  }

  await mongoose.disconnect();
  console.log('\n🔌 Disconnected');
}

main().catch(err => {
  console.error('❌ Error:', err.message);
  mongoose.disconnect();
  process.exit(1);
});