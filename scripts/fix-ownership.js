// fix-ownership.js
// Run: node scripts/fix-ownership.js
// Sets ALL completed transactions to ownershipPct = 0.00005 (0.005%)

require('dotenv').config();
const mongoose = require('mongoose');

// Import models
const PaymentTransaction = require('../models/Transaction');
const UserShare = require('../models/UserShare');

async function fixOwnership() {
  // Connection string
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
  
  // If .env not working, uncomment and use this:
  // const mongoUri = 'mongodb://localhost:27017/test';
  
  if (!mongoUri) {
    console.error('❌ MONGO_URI or MONGODB_URI not found in .env file');
    console.log('\nPlease add to .env file or hardcode the connection');
    process.exit(1);
  }
  
  console.log('🔌 Connecting to MongoDB...');
  await mongoose.connect(mongoUri);
  console.log('✅ Connected\n');

  // ============================================
  // 1. FIX PAYMENT TRANSACTIONS
  // ============================================
  
  console.log('📝 Fixing PaymentTransaction records...');
  console.log('   Target: ownershipPct = 0.00005 (0.005%)\n');
  
  // Fix ALL completed transactions (both share and co-founder)
  const result = await PaymentTransaction.updateMany(
    { 
      status: 'completed' 
    },
    { 
      $set: { 
        ownershipPct: 0.00005,
        adminNotes: `[FIXED ${new Date().toISOString()}] Set ownershipPct to 0.00005 (0.005%)`
      } 
    }
  );
  
  console.log(`   ✅ Updated ${result.modifiedCount} transactions`);
  console.log(`      ownershipPct = 0.00005 (0.005%)`);

  // ============================================
  // 2. FIX USERSHARE RECORDS
  // ============================================
  
  console.log('\n📝 Fixing UserShare records...');
  
  const userShares = await UserShare.find({});
  let userDocsUpdated = 0;
  let transactionsFixed = 0;
  
  for (const us of userShares) {
    let modified = false;
    
    // Fix each transaction
    for (const tx of us.transactions) {
      if (tx.status === 'completed' && tx.ownershipPct !== 0.00005) {
        const oldValue = tx.ownershipPct;
        tx.ownershipPct = 0.00005;
        tx.adminNote = `[FIXED] ownershipPct from ${oldValue} to 0.00005 (0.005%)`;
        modified = true;
        transactionsFixed++;
      }
    }
    
    if (modified) {
      // Recalculate user totals
      let totalOwnershipPct = 0;
      let totalEarningKobo = 0;
      
      for (const tx of us.transactions) {
        if (tx.status === 'completed') {
          totalOwnershipPct += (tx.ownershipPct || 0);
          totalEarningKobo += (tx.earningKobo || 0);
        }
      }
      
      us.totalOwnershipPct = parseFloat(totalOwnershipPct.toFixed(7));
      us.totalEarningKobo = totalEarningKobo;
      
      await us.save();
      userDocsUpdated++;
    }
  }
  
  console.log(`   ✅ UserShare documents updated: ${userDocsUpdated}`);
  console.log(`   ✅ Transactions fixed in UserShare: ${transactionsFixed}`);

  // ============================================
  // 3. VERIFICATION
  // ============================================
  
  console.log('\n📊 Verifying fixes...');
  
  // Count what's left with wrong values
  const wrongCount = await PaymentTransaction.countDocuments({
    status: 'completed',
    ownershipPct: { $ne: 0.00005 }
  });
  
  if (wrongCount === 0) {
    console.log('   ✅ ALL transactions have ownershipPct = 0.00005 (0.005%)');
  } else {
    console.log(`   ⚠️ Still need fix: ${wrongCount} transactions`);
  }

  // Show sample
  const samples = await PaymentTransaction.find({ status: 'completed' })
    .limit(5)
    .select('transactionId type ownershipPct');
  
  console.log('\n   Sample of fixed transactions:');
  for (const sample of samples) {
    console.log(`      - ${sample.transactionId} (${sample.type}): ${sample.ownershipPct} = ${(sample.ownershipPct * 100).toFixed(5)}%`);
  }

  // ============================================
  // 4. SUMMARY
  // ============================================
  
  console.log('\n' + '═'.repeat(60));
  console.log('📊 FIX SUMMARY');
  console.log('═'.repeat(60));
  console.log(`   ownershipPct = 0.00005 (0.005%)`);
  console.log(`   PaymentTransaction updated: ${result.modifiedCount}`);
  console.log(`   UserShare documents updated: ${userDocsUpdated}`);
  console.log(`   UserShare transactions fixed: ${transactionsFixed}`);
  console.log('═'.repeat(60));
  console.log('\n✅ ALL FIXES COMPLETE!');
  console.log('\n💡 Run verification:');
  console.log('   node auditTransactions.js --only completed');
  
  await mongoose.disconnect();
  console.log('\n🔌 Disconnected');
}

// Run the fix
fixOwnership().catch(err => {
  console.error('❌ Error:', err.message);
  console.error(err.stack);
  process.exit(1);
});