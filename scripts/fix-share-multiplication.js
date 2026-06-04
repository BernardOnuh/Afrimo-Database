// fix-share-multiplication.js
// Run: node scripts/fix-share-multiplication.js --dry-run --verbose

require('dotenv').config();
const mongoose = require('mongoose');

const PaymentTransaction = require('../models/Transaction');
const UserShare = require('../models/UserShare');

async function fixShareMultiplications(dryRun = false, verbose = false) {
  console.log('🔌 Connecting to MongoDB...');
  await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
  console.log('✅ Connected\n');

  // Find all completed transactions where PT and US have different share counts
  const allPT = await PaymentTransaction.find({ status: 'completed' });
  const allUS = await UserShare.find({});
  
  const mismatches = [];
  
  // Build US map
  const usMap = new Map();
  for (const us of allUS) {
    for (const tx of us.transactions) {
      if (tx.status === 'completed') {
        usMap.set(tx.transactionId, { tx, userDoc: us });
      }
    }
  }
  
  // Find mismatches
  for (const pt of allPT) {
    const us = usMap.get(pt.transactionId);
    if (us && pt.shares !== us.tx.shares) {
      mismatches.push({
        transactionId: pt.transactionId,
        pt: pt,
        us: us.tx,
        userDoc: us.userDoc
      });
    }
  }
  
  console.log(`📊 Found ${mismatches.length} transactions with share count mismatches\n`);
  
  if (mismatches.length === 0) {
    console.log('✅ No mismatches found!');
    await mongoose.disconnect();
    return;
  }
  
  const results = {
    fixed: [],
    skipped: [],
    errors: []
  };
  
  for (const mismatch of mismatches) {
    const txId = mismatch.transactionId;
    const ptShares = mismatch.pt.shares || 1;
    const usShares = mismatch.us.shares || 1;
    
    // Use the larger share count (UserShare is usually correct)
    const correctShares = Math.max(ptShares, usShares);
    const tierKey = mismatch.pt.tierKey || mismatch.us.tierKey;
    const ownershipPctPerShare = (mismatch.pt.ownershipPct || 0) / ptShares;
    const earningKoboPerShare = (mismatch.pt.earningKobo || 0) / ptShares;
    
    const correctOwnershipPct = parseFloat((ownershipPctPerShare * correctShares).toFixed(7));
    const correctEarningKobo = Math.round(earningKoboPerShare * correctShares);
    
    if (verbose) {
      console.log(`\n📝 ${txId}:`);
      console.log(`   Shares: PT=${ptShares}, US=${usShares} → Correct=${correctShares}`);
      console.log(`   Ownership: ${(mismatch.pt.ownershipPct * 100).toFixed(5)}% → ${(correctOwnershipPct * 100).toFixed(5)}%`);
      console.log(`   Earning: ${mismatch.pt.earningKobo} kobo → ${correctEarningKobo} kobo`);
    }
    
    if (dryRun) {
      results.fixed.push({
        transactionId: txId,
        shares: { old: ptShares, new: correctShares },
        ownershipPct: { old: mismatch.pt.ownershipPct, new: correctOwnershipPct },
        earningKobo: { old: mismatch.pt.earningKobo, new: correctEarningKobo }
      });
      continue;
    }
    
    try {
      // Update PaymentTransaction
      await PaymentTransaction.updateOne(
        { transactionId: txId },
        { 
          $set: { 
            shares: correctShares,
            ownershipPct: correctOwnershipPct,
            earningKobo: correctEarningKobo
          } 
        }
      );
      
      // Update UserShare
      await UserShare.updateOne(
        { 'transactions.transactionId': txId },
        { 
          $set: { 
            'transactions.$.shares': correctShares,
            'transactions.$.ownershipPct': correctOwnershipPct,
            'transactions.$.earningKobo': correctEarningKobo
          } 
        }
      );
      
      results.fixed.push({
        transactionId: txId,
        shares: { old: ptShares, new: correctShares },
        ownershipPct: { old: mismatch.pt.ownershipPct, new: correctOwnershipPct },
        earningKobo: { old: mismatch.pt.earningKobo, new: correctEarningKobo }
      });
      
    } catch (err) {
      results.errors.push({ transactionId: txId, error: err.message });
      console.error(`   ❌ Error: ${err.message}`);
    }
  }
  
  // Recalculate user totals
  if (!dryRun && results.fixed.length > 0) {
    console.log('\n🔄 Recalculating user totals...');
    const updatedUsers = new Set();
    
    for (const fix of results.fixed) {
      const mismatch = mismatches.find(m => m.transactionId === fix.transactionId);
      if (mismatch && mismatch.userDoc) {
        updatedUsers.add(mismatch.userDoc.user.toString());
      }
    }
    
    for (const userId of updatedUsers) {
      const userShare = await UserShare.findOne({ user: userId });
      if (userShare) {
        let totalOwnershipPct = 0;
        let totalEarningKobo = 0;
        
        for (const tx of userShare.transactions) {
          if (tx.status === 'completed') {
            totalOwnershipPct += (tx.ownershipPct || 0);
            totalEarningKobo += (tx.earningKobo || 0);
          }
        }
        
        await UserShare.updateOne(
          { user: userId },
          { 
            $set: { 
              totalOwnershipPct: parseFloat(totalOwnershipPct.toFixed(7)),
              totalEarningKobo: totalEarningKobo
            } 
          }
        );
      }
    }
    
    console.log(`   ✅ Recalculated totals for ${updatedUsers.size} users`);
  }
  
  // Summary
  console.log('\n' + '═'.repeat(60));
  console.log('📊 FIX SUMMARY');
  console.log('═'.repeat(60));
  console.log(`   Transactions with share mismatches: ${mismatches.length}`);
  console.log(`   ✅ Fixed: ${results.fixed.length}`);
  console.log(`   ❌ Errors: ${results.errors.length}`);
  
  if (results.fixed.length > 0 && !dryRun) {
    console.log('\n📝 SAMPLE FIXES:');
    results.fixed.slice(0, 5).forEach(fix => {
      console.log(`   ${fix.transactionId}:`);
      console.log(`      Shares: ${fix.shares.old} → ${fix.shares.new}`);
      console.log(`      Ownership: ${(fix.ownershipPct.old * 100).toFixed(5)}% → ${(fix.ownershipPct.new * 100).toFixed(5)}%`);
      console.log(`      Earning: ${fix.earningKobo.old} → ${fix.earningKobo.new} kobo`);
    });
  }
  
  if (dryRun) {
    console.log('\n⚠️ This was a DRY RUN. No changes were made.');
    console.log('   To apply fixes, run: node scripts/fix-share-multiplication.js');
  }
  
  await mongoose.disconnect();
  console.log('\n🔌 Disconnected');
}

// Parse arguments
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const VERBOSE = args.includes('--verbose');

// Fix specific transaction if provided
const specificTxn = args.find(arg => arg.startsWith('TXN-') || arg.match(/^[0-9a-fA-F]{24}$/));

if (specificTxn) {
  console.log(`🔧 Fixing specific transaction: ${specificTxn}`);
  // We'll handle single transaction fix separately
  fixSingleTransaction(specificTxn, DRY_RUN, VERBOSE);
} else {
  fixShareMultiplications(DRY_RUN, VERBOSE);
}

async function fixSingleTransaction(txId, dryRun, verbose) {
  await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
  
  const pt = await PaymentTransaction.findOne({ transactionId: txId, status: 'completed' });
  const usDoc = await UserShare.findOne({ 'transactions.transactionId': txId });
  const us = usDoc?.transactions.find(t => t.transactionId === txId);
  
  if (!pt && !us) {
    console.log('❌ Transaction not found');
    await mongoose.disconnect();
    return;
  }
  
  const ptShares = pt?.shares || 1;
  const usShares = us?.shares || 1;
  const correctShares = Math.max(ptShares, usShares);
  
  // Calculate per-share values
  const ownershipPerShare = (pt?.ownershipPct || 0) / ptShares;
  const earningPerShare = (pt?.earningKobo || 0) / ptShares;
  
  const correctOwnership = parseFloat((ownershipPerShare * correctShares).toFixed(7));
  const correctEarning = Math.round(earningPerShare * correctShares);
  
  console.log(`\n📝 ${txId}:`);
  console.log(`   PT shares: ${ptShares}, US shares: ${usShares} → Correct: ${correctShares}`);
  console.log(`   Ownership: ${((pt?.ownershipPct || 0) * 100).toFixed(5)}% → ${(correctOwnership * 100).toFixed(5)}%`);
  console.log(`   Earning: ${pt?.earningKobo || 0} kobo → ${correctEarning} kobo`);
  
  if (dryRun) {
    console.log('\n⚠️ DRY RUN - No changes made');
    await mongoose.disconnect();
    return;
  }
  
  // Update both sources
  if (pt) {
    await PaymentTransaction.updateOne(
      { transactionId: txId },
      { $set: { shares: correctShares, ownershipPct: correctOwnership, earningKobo: correctEarning } }
    );
    console.log('   ✅ PaymentTransaction updated');
  }
  
  if (us) {
    await UserShare.updateOne(
      { 'transactions.transactionId': txId },
      { $set: { 'transactions.$.shares': correctShares, 'transactions.$.ownershipPct': correctOwnership, 'transactions.$.earningKobo': correctEarning } }
    );
    console.log('   ✅ UserShare updated');
  }
  
  // Recalculate user totals
  if (usDoc) {
    let totalOwnership = 0;
    let totalEarning = 0;
    for (const tx of usDoc.transactions) {
      if (tx.status === 'completed') {
        totalOwnership += (tx.ownershipPct || 0);
        totalEarning += (tx.earningKobo || 0);
      }
    }
    await UserShare.updateOne(
      { user: usDoc.user },
      { $set: { totalOwnershipPct: parseFloat(totalOwnership.toFixed(7)), totalEarningKobo: totalEarning } }
    );
    console.log('   ✅ User totals recalculated');
  }
  
  console.log('\n✅ Fix complete!');
  await mongoose.disconnect();
}