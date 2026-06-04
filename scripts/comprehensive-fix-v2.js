// comprehensive-fix-v2.js
// Run: node scripts/comprehensive-fix-v2.js --dry-run --verbose

require('dotenv').config();
const mongoose = require('mongoose');

const PaymentTransaction = require('../models/Transaction');
const UserShare = require('../models/UserShare');

async function findAllMismatches() {
  console.log('🔌 Connecting to MongoDB...');
  await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
  console.log('✅ Connected\n');

  // Get all completed transactions
  const allPT = await PaymentTransaction.find({ status: 'completed' }).lean();
  const allUS = await UserShare.find({}).lean();
  
  // Build UserShare map
  const usMap = new Map();
  for (const us of allUS) {
    for (const tx of us.transactions || []) {
      if (tx.status === 'completed') {
        usMap.set(tx.transactionId, { 
          tx: tx, 
          userDoc: us,
          userId: us.user
        });
      }
    }
  }
  
  console.log(`📊 PaymentTransactions: ${allPT.length}`);
  console.log(`📊 UserShare transactions: ${usMap.size}`);
  console.log('═'.repeat(60));
  
  const mismatches = [];
  
  for (const pt of allPT) {
    const us = usMap.get(pt.transactionId);
    
    if (!us) {
      mismatches.push({
        type: 'PT_ONLY',
        transactionId: pt.transactionId,
        pt: pt,
        us: null,
        issues: ['Missing in UserShare']
      });
      continue;
    }
    
    const issues = [];
    
    // Compare shares (convert both to numbers)
    const ptShares = Number(pt.shares) || 1;
    const usShares = Number(us.tx.shares) || 1;
    
    if (ptShares !== usShares) {
      issues.push({ field: 'shares', pt: ptShares, us: usShares });
    }
    
    // Calculate expected values based on the larger share count
    const maxShares = Math.max(ptShares, usShares);
    const minShares = Math.min(ptShares, usShares);
    
    // Calculate per-share values from whichever has shares=1
    let ownershipPerShare = null;
    let earningPerShare = null;
    
    if (ptShares === 1 && pt.ownershipPct && pt.earningKobo) {
      ownershipPerShare = pt.ownershipPct;
      earningPerShare = pt.earningKobo;
    } else if (usShares === 1 && us.tx.ownershipPct && us.tx.earningKobo) {
      ownershipPerShare = us.tx.ownershipPct;
      earningPerShare = us.tx.earningKobo;
    } else {
      // If both have shares > 1, calculate average per share
      ownershipPerShare = (pt.ownershipPct || 0) / ptShares;
      earningPerShare = (pt.earningKobo || 0) / ptShares;
    }
    
    if (ownershipPerShare) {
      const expectedOwnership = ownershipPerShare * maxShares;
      const currentOwnership = Math.max(pt.ownershipPct || 0, us.tx.ownershipPct || 0);
      
      if (Math.abs(expectedOwnership - currentOwnership) > 0.000001) {
        issues.push({ 
          field: 'ownershipPct', 
          pt: pt.ownershipPct, 
          us: us.tx.ownershipPct,
          expected: expectedOwnership,
          calculation: `${ownershipPerShare} × ${maxShares} = ${expectedOwnership}`
        });
      }
    }
    
    if (earningPerShare) {
      const expectedEarning = earningPerShare * maxShares;
      const currentEarning = Math.max(pt.earningKobo || 0, us.tx.earningKobo || 0);
      
      if (expectedEarning !== currentEarning) {
        issues.push({ 
          field: 'earningKobo', 
          pt: pt.earningKobo, 
          us: us.tx.earningKobo,
          expected: expectedEarning,
          calculation: `${earningPerShare} × ${maxShares} = ${expectedEarning}`
        });
      }
    }
    
    // Compare payment method (normalize)
    const ptMethod = normalizePaymentMethod(pt.paymentMethod);
    const usMethod = normalizePaymentMethod(us.tx.paymentMethod);
    if (ptMethod !== usMethod) {
      issues.push({ field: 'paymentMethod', pt: pt.paymentMethod, us: us.tx.paymentMethod });
    }
    
    // Compare type
    const ptType = pt.type || 'share';
    const usType = us.tx.type || 'share';
    if (ptType !== usType) {
      issues.push({ field: 'type', pt: ptType, us: usType });
    }
    
    // Compare tier/label
    const ptTier = pt.packageLabel || pt.tierKey;
    const usTier = us.tx.packageLabel || us.tx.tierKey;
    if (ptTier !== usTier) {
      issues.push({ field: 'packageLabel', pt: ptTier, us: usTier });
    }
    
    if (issues.length > 0) {
      mismatches.push({
        type: 'MISMATCH',
        transactionId: pt.transactionId,
        pt: pt,
        us: us.tx,
        userEmail: pt.userEmail || us.tx.userEmail,
        issues: issues,
        maxShares: maxShares
      });
    }
  }
  
  // Also find US-only transactions
  for (const [txId, us] of usMap) {
    const pt = allPT.find(p => p.transactionId === txId);
    if (!pt) {
      mismatches.push({
        type: 'US_ONLY',
        transactionId: txId,
        pt: null,
        us: us.tx,
        userEmail: us.tx.userEmail,
        issues: ['Missing in PaymentTransaction']
      });
    }
  }
  
  return mismatches;
}

function normalizePaymentMethod(method) {
  const m = String(method || '').toLowerCase();
  if (m === 'paystack' || m === 'bank_transfer' || m === 'banktransfer') return 'bank_transfer';
  if (m === 'co-founder' || m === 'cofounder') return 'co-founder';
  if (m === 'crypto' || m === 'usdt' || m === 'web3') return 'crypto';
  if (m === 'admin_override' || m === 'admin') return 'admin';
  return m;
}

async function fixTransaction(mismatch, dryRun = false) {
  const { transactionId, pt, us, issues, maxShares } = mismatch;
  
  // Calculate correct values
  let correctShares = maxShares;
  let correctOwnership = null;
  let correctEarning = null;
  
  // Find the issue with ownership/earning
  const ownershipIssue = issues.find(i => i.field === 'ownershipPct');
  const earningIssue = issues.find(i => i.field === 'earningKobo');
  
  if (ownershipIssue && ownershipIssue.expected) {
    correctOwnership = ownershipIssue.expected;
  } else if (pt && us) {
    // Calculate from the record with shares=1 if possible
    const ptShares = Number(pt.shares) || 1;
    const usShares = Number(us.shares) || 1;
    
    if (ptShares === 1) {
      correctOwnership = (pt.ownershipPct || 0) * correctShares;
      correctEarning = (pt.earningKobo || 0) * correctShares;
    } else if (usShares === 1) {
      correctOwnership = (us.ownershipPct || 0) * correctShares;
      correctEarning = (us.earningKobo || 0) * correctShares;
    } else {
      correctOwnership = ((pt.ownershipPct || 0) / ptShares) * correctShares;
      correctEarning = ((pt.earningKobo || 0) / ptShares) * correctShares;
    }
  }
  
  if (dryRun) {
    return {
      transactionId,
      fixes: {
        shares: { old: { pt: pt?.shares, us: us?.shares }, new: correctShares },
        ownershipPct: { old: { pt: pt?.ownershipPct, us: us?.ownershipPct }, new: correctOwnership },
        earningKobo: { old: { pt: pt?.earningKobo, us: us?.earningKobo }, new: correctEarning },
        paymentMethod: issues.find(i => i.field === 'paymentMethod') ? { 
          old: { pt: pt?.paymentMethod, us: us?.paymentMethod }, 
          new: 'bank_transfer' 
        } : null,
        type: issues.find(i => i.field === 'type') ? {
          old: { pt: pt?.type, us: us?.type },
          new: 'share'
        } : null
      }
    };
  }
  
  // Apply fixes
  const updates = {};
  if (correctShares) updates.shares = correctShares;
  if (correctOwnership) updates.ownershipPct = parseFloat(correctOwnership.toFixed(7));
  if (correctEarning) updates.earningKobo = Math.round(correctEarning);
  
  if (Object.keys(updates).length > 0) {
    if (pt) {
      await PaymentTransaction.updateOne(
        { transactionId },
        { $set: updates }
      );
    }
    if (us) {
      await UserShare.updateOne(
        { 'transactions.transactionId': transactionId },
        { $set: {
          'transactions.$.shares': updates.shares,
          'transactions.$.ownershipPct': updates.ownershipPct,
          'transactions.$.earningKobo': updates.earningKobo
        }}
      );
    }
  }
  
  return { transactionId, fixes: updates };
}

async function main() {
  const DRY_RUN = process.argv.includes('--dry-run');
  const VERBOSE = process.argv.includes('--verbose');
  const SPECIFIC_TXN = process.argv.find(arg => arg.startsWith('TXN-'));
  
  const mismatches = await findAllMismatches();
  
  console.log('\n' + '═'.repeat(60));
  console.log('📊 MISMATCH SUMMARY');
  console.log('═'.repeat(60));
  console.log(`   Total mismatches: ${mismatches.length}`);
  console.log(`   - PT only: ${mismatches.filter(m => m.type === 'PT_ONLY').length}`);
  console.log(`   - US only: ${mismatches.filter(m => m.type === 'US_ONLY').length}`);
  console.log(`   - Data mismatches: ${mismatches.filter(m => m.type === 'MISMATCH').length}`);
  
  if (SPECIFIC_TXN) {
    const specific = mismatches.find(m => m.transactionId === SPECIFIC_TXN);
    if (!specific) {
      console.log(`\n❌ Transaction ${SPECIFIC_TXN} not found in mismatches`);
      await mongoose.disconnect();
      return;
    }
    mismatches.length = 0;
    mismatches.push(specific);
  }
  
  const dataMismatches = mismatches.filter(m => m.type === 'MISMATCH');
  
  if (dataMismatches.length === 0) {
    console.log('\n✅ No data mismatches found!');
    await mongoose.disconnect();
    return;
  }
  
  console.log(`\n📝 DETAILED MISMATCHES:`);
  for (const m of dataMismatches.slice(0, VERBOSE ? undefined : 10)) {
    console.log(`\n   🔷 ${m.transactionId} (${m.userEmail || 'unknown'})`);
    for (const issue of m.issues) {
      if (issue.field === 'shares') {
        console.log(`      Shares: PT=${issue.pt}, US=${issue.us} → Should be ${m.maxShares}`);
      } else if (issue.field === 'ownershipPct') {
        console.log(`      Ownership: PT=${(issue.pt * 100).toFixed(5)}%, US=${(issue.us * 100).toFixed(5)}% → Should be ${(issue.expected * 100).toFixed(5)}%`);
        console.log(`        (${issue.calculation})`);
      } else if (issue.field === 'earningKobo') {
        console.log(`      Earning: PT=${issue.pt}, US=${issue.us} → Should be ${issue.expected}`);
        console.log(`        (${issue.calculation})`);
      } else {
        console.log(`      ${issue.field}: PT="${issue.pt}", US="${issue.us}"`);
      }
    }
  }
  
  if (DRY_RUN) {
    console.log('\n⚠️ DRY RUN - No changes will be made');
    console.log('   To apply fixes, run: node scripts/comprehensive-fix-v2.js');
    await mongoose.disconnect();
    return;
  }
  
  console.log('\n🔧 Applying fixes...');
  const results = [];
  
  for (const mismatch of dataMismatches) {
    const result = await fixTransaction(mismatch, false);
    results.push(result);
    if (VERBOSE) {
      console.log(`   ✅ ${result.transactionId}: Updated shares to ${result.fixes.shares}, ownership to ${(result.fixes.ownershipPct * 100).toFixed(5)}%, earning to ${result.fixes.earningKobo}`);
    }
  }
  
  // Recalculate user totals
  console.log('\n🔄 Recalculating user totals...');
  const userIds = new Set();
  for (const m of dataMismatches) {
    if (m.us?.userId) userIds.add(m.us.userId.toString());
  }
  
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
        { $set: { 
          totalOwnershipPct: parseFloat(totalOwnership.toFixed(7)),
          totalEarningKobo: totalEarning
        }}
      );
    }
  }
  
  console.log(`   ✅ Recalculated totals for ${userIds.size} users`);
  
  console.log('\n' + '═'.repeat(60));
  console.log('📊 FIX SUMMARY');
  console.log('═'.repeat(60));
  console.log(`   ✅ Fixed: ${results.length} transactions`);
  console.log(`   👥 Users affected: ${userIds.size}`);
  console.log('\n✅ ALL FIXES COMPLETE!');
  console.log('\n💡 Verify with: node auditTransactions.js --only completed');
  
  await mongoose.disconnect();
}

main().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});