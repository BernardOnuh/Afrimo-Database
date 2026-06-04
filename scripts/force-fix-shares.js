// force-fix-shares.js
// Run: node scripts/force-fix-shares.js --dry-run --verbose

require('dotenv').config();
const mongoose = require('mongoose');

const PaymentTransaction = require('../models/Transaction');
const UserShare = require('../models/UserShare');

async function forceFixShares() {
  console.log('🔌 Connecting to MongoDB...');
  await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
  console.log('✅ Connected\n');

  const DRY_RUN = process.argv.includes('--dry-run');
  const VERBOSE = process.argv.includes('--verbose');
  const SPECIFIC_TXN = process.argv.find(arg => arg.startsWith('TXN-'));

  // Get all UserShare documents
  const allUserShares = await UserShare.find({}).lean();
  
  const transactionsToFix = [];
  
  for (const us of allUserShares) {
    for (const tx of us.transactions || []) {
      if (tx.status !== 'completed') continue;
      if (SPECIFIC_TXN && tx.transactionId !== SPECIFIC_TXN) continue;
      
      // Find corresponding PaymentTransaction
      const pt = await PaymentTransaction.findOne({ 
        transactionId: tx.transactionId,
        status: 'completed'
      }).lean();
      
      const usShares = Number(tx.shares) || 1;
      const ptShares = Number(pt?.shares) || 1;
      
      // Check if PT needs update (shares differ OR values not multiplied)
      let needsFix = false;
      let reason = '';
      
      if (ptShares !== usShares) {
        needsFix = true;
        reason = `Shares mismatch: PT=${ptShares}, US=${usShares}`;
      } else if (pt && pt.ownershipPct) {
        // Check if ownership is correctly multiplied
        const ownershipPerShare = pt.ownershipPct / ptShares;
        const expectedOwnership = ownershipPerShare * usShares;
        if (Math.abs(expectedOwnership - pt.ownershipPct) < 0.000001 && usShares > 1) {
          needsFix = true;
          reason = `Ownership not multiplied: has ${pt.ownershipPct} but should be ${expectedOwnership}`;
        }
      }
      
      if (needsFix || (pt && usShares > 1 && ptShares === 1)) {
        // Calculate correct values
        const correctShares = usShares; // Use US shares as source of truth
        let correctOwnershipPct = tx.ownershipPct || 0;
        let correctEarningKobo = tx.earningKobo || 0;
        
        // If PT has shares=1 but US has shares>1, multiply PT values
        if (pt && ptShares === 1 && usShares > 1) {
          correctOwnershipPct = (pt.ownershipPct || 0) * usShares;
          correctEarningKobo = (pt.earningKobo || 0) * usShares;
        }
        
        // If US has the values already, use those
        if (tx.ownershipPct && tx.ownershipPct > 0) {
          correctOwnershipPct = tx.ownershipPct;
          correctEarningKobo = tx.earningKobo;
        }
        
        transactionsToFix.push({
          transactionId: tx.transactionId,
          userId: us.user,
          userEmail: tx.userEmail || us.user?.email,
          current: {
            pt: pt ? {
              shares: ptShares,
              ownershipPct: pt.ownershipPct,
              earningKobo: pt.earningKobo,
              packageLabel: pt.packageLabel,
              tierKey: pt.tierKey
            } : null,
            us: {
              shares: usShares,
              ownershipPct: tx.ownershipPct,
              earningKobo: tx.earningKobo,
              packageLabel: tx.packageLabel,
              tierKey: tx.tierKey
            }
          },
          correct: {
            shares: correctShares,
            ownershipPct: parseFloat(correctOwnershipPct.toFixed(7)),
            earningKobo: Math.round(correctEarningKobo)
          },
          reason: reason
        });
      }
    }
  }
  
  console.log(`📊 Found ${transactionsToFix.length} transactions that need fixing\n`);
  
  if (transactionsToFix.length === 0) {
    console.log('✅ No transactions need fixing!');
    await mongoose.disconnect();
    return;
  }
  
  // Display what will be fixed
  console.log('═'.repeat(70));
  console.log('📝 TRANSACTIONS TO FIX:');
  console.log('═'.repeat(70));
  
  for (const fix of transactionsToFix) {
    console.log(`\n🔷 ${fix.transactionId}`);
    console.log(`   User: ${fix.userEmail || fix.userId}`);
    console.log(`   Reason: ${fix.reason}`);
    console.log(`\n   Current Values:`);
    if (fix.current.pt) {
      console.log(`     PT: shares=${fix.current.pt.shares}, ownership=${(fix.current.pt.ownershipPct * 100).toFixed(5)}%, earning=${fix.current.pt.earningKobo}`);
    } else {
      console.log(`     PT: NOT FOUND`);
    }
    console.log(`     US: shares=${fix.current.us.shares}, ownership=${(fix.current.us.ownershipPct * 100).toFixed(5)}%, earning=${fix.current.us.earningKobo}`);
    console.log(`\n   Correct Values:`);
    console.log(`     shares=${fix.correct.shares}, ownership=${(fix.correct.ownershipPct * 100).toFixed(5)}%, earning=${fix.correct.earningKobo}`);
  }
  
  if (DRY_RUN) {
    console.log('\n⚠️ DRY RUN - No changes will be made');
    console.log('   To apply fixes, run: node scripts/force-fix-shares.js');
    await mongoose.disconnect();
    return;
  }
  
  // Apply fixes
  console.log('\n🔧 Applying fixes...');
  let fixed = 0;
  let errors = 0;
  
  for (const fix of transactionsToFix) {
    try {
      // Update PaymentTransaction
      if (fix.current.pt) {
        await PaymentTransaction.updateOne(
          { transactionId: fix.transactionId },
          { 
            $set: {
              shares: fix.correct.shares,
              ownershipPct: fix.correct.ownershipPct,
              earningKobo: fix.correct.earningKobo
            }
          }
        );
        console.log(`   ✅ ${fix.transactionId}: PT updated`);
      } else {
        // Create missing PaymentTransaction
        console.log(`   ⚠️ ${fix.transactionId}: PT missing - need to create`);
      }
      
      // Update UserShare
      await UserShare.updateOne(
        { 'transactions.transactionId': fix.transactionId },
        { 
          $set: {
            'transactions.$.shares': fix.correct.shares,
            'transactions.$.ownershipPct': fix.correct.ownershipPct,
            'transactions.$.earningKobo': fix.correct.earningKobo
          }
        }
      );
      
      fixed++;
      
      if (VERBOSE) {
        console.log(`      Shares: ${fix.current.pt?.shares || fix.current.us.shares} → ${fix.correct.shares}`);
        console.log(`      Ownership: ${((fix.current.pt?.ownershipPct || fix.current.us.ownershipPct) * 100).toFixed(5)}% → ${(fix.correct.ownershipPct * 100).toFixed(5)}%`);
        console.log(`      Earning: ${fix.current.pt?.earningKobo || fix.current.us.earningKobo} → ${fix.correct.earningKobo}`);
      }
      
    } catch (err) {
      console.error(`   ❌ ${fix.transactionId}: ${err.message}`);
      errors++;
    }
  }
  
  // Recalculate user totals
  console.log('\n🔄 Recalculating user totals...');
  const userIds = [...new Set(transactionsToFix.map(fix => fix.userId.toString()))];
  
  for (const userId of userIds) {
    const userShare = await UserShare.findOne({ user: userId });
    if (userShare) {
      let totalOwnership = 0;
      let totalEarning = 0;
      for (const tx of userShare.transactions) {
        if (tx.status === 'completed') {
          totalOwnership += (tx.ownershipPct || 0);
          totalEarning += (tx.earningKobo || 0);
        }
      }
      await UserShare.updateOne(
        { user: userId },
        { 
          $set: {
            totalOwnershipPct: parseFloat(totalOwnership.toFixed(7)),
            totalEarningKobo: totalEarning
          }
        }
      );
    }
  }
  
  console.log(`   ✅ Recalculated totals for ${userIds.length} users`);
  
  // Summary
  console.log('\n' + '═'.repeat(70));
  console.log('📊 FIX SUMMARY');
  console.log('═'.repeat(70));
  console.log(`   ✅ Fixed: ${fixed} transactions`);
  console.log(`   ❌ Errors: ${errors}`);
  console.log(`   👥 Users affected: ${userIds.length}`);
  
  console.log('\n✅ ALL FIXES COMPLETE!');
  console.log('\n💡 Verify with: node auditTransactions.js --only completed');
  
  await mongoose.disconnect();
}

// Run for specific transaction if provided
async function fixSpecificTransaction(txId) {
  console.log(`🔧 Fixing specific transaction: ${txId}`);
  
  const pt = await PaymentTransaction.findOne({ transactionId: txId });
  const usDoc = await UserShare.findOne({ 'transactions.transactionId': txId });
  const usTx = usDoc?.transactions.find(t => t.transactionId === txId);
  
  if (!pt && !usTx) {
    console.log('❌ Transaction not found');
    return;
  }
  
  const usShares = Number(usTx?.shares) || 1;
  const ptShares = Number(pt?.shares) || 1;
  const correctShares = Math.max(usShares, ptShares);
  
  // Calculate correct values
  let correctOwnership = 0;
  let correctEarning = 0;
  
  if (pt && ptShares === 1 && usShares > 1) {
    correctOwnership = (pt.ownershipPct || 0) * usShares;
    correctEarning = (pt.earningKobo || 0) * usShares;
  } else if (usTx && usTx.ownershipPct) {
    correctOwnership = usTx.ownershipPct;
    correctEarning = usTx.earningKobo;
  }
  
  console.log(`\n📝 ${txId}:`);
  console.log(`   PT shares: ${ptShares}, US shares: ${usShares} → Correct: ${correctShares}`);
  console.log(`   PT ownership: ${(pt?.ownershipPct * 100).toFixed(5)}%`);
  console.log(`   US ownership: ${(usTx?.ownershipPct * 100).toFixed(5)}%`);
  console.log(`   Correct ownership: ${(correctOwnership * 100).toFixed(5)}%`);
  console.log(`   PT earning: ${pt?.earningKobo}`);
  console.log(`   US earning: ${usTx?.earningKobo}`);
  console.log(`   Correct earning: ${correctEarning}`);
  
  const DRY_RUN = process.argv.includes('--dry-run');
  
  if (DRY_RUN) {
    console.log('\n⚠️ DRY RUN - No changes made');
    return;
  }
  
  // Apply fixes
  if (pt) {
    await PaymentTransaction.updateOne(
      { transactionId: txId },
      { 
        $set: {
          shares: correctShares,
          ownershipPct: parseFloat(correctOwnership.toFixed(7)),
          earningKobo: Math.round(correctEarning)
        }
      }
    );
    console.log('\n   ✅ PT updated');
  }
  
  if (usTx) {
    await UserShare.updateOne(
      { 'transactions.transactionId': txId },
      { 
        $set: {
          'transactions.$.shares': correctShares,
          'transactions.$.ownershipPct': parseFloat(correctOwnership.toFixed(7)),
          'transactions.$.earningKobo': Math.round(correctEarning)
        }
      }
    );
    console.log('   ✅ US updated');
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
      { 
        $set: {
          totalOwnershipPct: parseFloat(totalOwnership.toFixed(7)),
          totalEarningKobo: totalEarning
        }
      }
    );
    console.log('   ✅ User totals recalculated');
  }
  
  console.log('\n✅ Fix complete!');
}

// Main
const specificTxn = process.argv.find(arg => arg.startsWith('TXN-'));
if (specificTxn && !process.argv.includes('--all')) {
  forceFixShares().catch(console.error);
} else {
  forceFixShares().catch(console.error);
}