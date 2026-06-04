// bulk-fix-transactions.js
// Run: node scripts/bulk-fix-transactions.js

require('dotenv').config();
const mongoose = require('mongoose');

const PaymentTransaction = require('../models/Transaction');
const UserShare = require('../models/UserShare');
const TierConfig = require('../models/TierConfig');

// ============================================
// TIER DEFINITIONS (Based on your specs)
// ============================================

const TIERS = {
  // Share Tiers
  basic: {
    name: 'Basic',
    type: 'share',
    priceMin: 0,
    priceMax: 30000,
    priceNGN: 30000,
    priceUSD: 30,
    percentPerShare: 0.00001,    // 0.001%
    earningPerPhone: 6,           // 6 kobo
    sharesIncluded: 1
  },
  standard: {
    name: 'Standard',
    type: 'share',
    priceMin: 30001,
    priceMax: 50000,
    priceNGN: 50000,
    priceUSD: 50,
    percentPerShare: 0.000021,    // 0.0021%
    earningPerPhone: 14,          // 14 kobo
    sharesIncluded: 1
  },
  premium: {
    name: 'Premium',
    type: 'share',
    priceMin: 50001,
    priceMax: Infinity,
    priceNGN: 100000,
    priceUSD: 100,
    percentPerShare: 0.00005,     // 0.005%
    earningPerPhone: 30,          // 30 kobo
    sharesIncluded: 1
  },
  
  // Co-Founder Tiers
  elites: {
    name: 'Elites',
    type: 'co-founder',
    priceMin: 900000,
    priceMax: 1500000,
    priceNGN: 1000000,
    priceUSD: 1000,
    percentPerShare: 0.000021,    // 0.0021% per share
    earningPerPhone: 14,          // 14 kobo per share
    sharesIncluded: 22
  },
  platinum: {
    name: 'Platinum',
    type: 'co-founder',
    priceMin: 1500001,
    priceMax: 3500000,
    priceNGN: 2500000,
    priceUSD: 2500,
    percentPerShare: 0.00005,     // 0.005% per share
    earningPerPhone: 30,          // 30 kobo per share
    sharesIncluded: 27
  },
  supreme: {
    name: 'Supreme',
    type: 'co-founder',
    priceMin: 3500001,
    priceMax: Infinity,
    priceNGN: 5000000,
    priceUSD: 5000,
    percentPerShare: 0.00005,     // 0.005% per share
    earningPerPhone: 30,          // 30 kobo per share
    sharesIncluded: 60
  }
};

// Legacy tier mapping (old ObjectId -> new tierKey)
const LEGACY_TIER_MAP = {
  '69ccd0dc680f6f2a96815a49': 'premium',  // Old Premium ObjectId
  '69ccd0dc680f6f2a96815a48': 'standard', // Old Standard ObjectId
  '69ccd0dc680f6f2a96815a47': 'basic',    // Old Basic ObjectId
};

// Date after which new pricing applies (Feb 25, 2026)
const NEW_PRICING_DATE = new Date('2026-02-25');

// ============================================
// Helper Functions
// ============================================

function determineTierByAmount(amount, currency, createdAt, type) {
  const amountNGN = currency === 'naira' ? amount : amount * 1500; // Approx conversion if needed
  const isAfterNewPricing = new Date(createdAt) >= NEW_PRICING_DATE;
  
  // For share type
  if (type === 'share' || type === 'regular') {
    // Legacy pricing (before Feb 25)
    if (!isAfterNewPricing) {
      if (amountNGN >= 90000) return TIERS.premium;
      if (amountNGN >= 45000) return TIERS.standard;
      return TIERS.basic;
    }
    
    // New pricing (after Feb 25)
    if (amountNGN > 50000) return TIERS.premium;
    if (amountNGN > 30000) return TIERS.standard;
    return TIERS.basic;
  }
  
  // For co-founder type
  if (type === 'co-founder') {
    if (amountNGN > 3500000) return TIERS.supreme;
    if (amountNGN > 1500000) return TIERS.platinum;
    return TIERS.elites;
  }
  
  return null;
}

function calculateValues(tier, shares = 1) {
  return {
    ownershipPct: (tier.percentPerShare || 0) * shares,
    earningKobo: (tier.earningPerPhone || 0) * shares,
    sharesCount: shares,
    pricePerShare: tier.priceNGN / (tier.sharesIncluded || 1)
  };
}

async function fixTransaction(tx, dryRun = false) {
  const tierKey = tx.tierKey || tx.packageId;
  const amount = tx.amount || 0;
  const currency = tx.currency || 'naira';
  const createdAt = tx.createdAt;
  const type = tx.type || 'share';
  const currentShares = tx.shares || 1;
  
  // Determine correct tier based on amount and date
  let correctTier = null;
  
  // Check if it's a legacy ObjectId tierKey
  if (LEGACY_TIER_MAP[tierKey]) {
    const mappedTier = LEGACY_TIER_MAP[tierKey];
    correctTier = TIERS[mappedTier];
  }
  
  // If not legacy or legacy not found, determine by amount
  if (!correctTier) {
    correctTier = determineTierByAmount(amount, currency, createdAt, type);
  }
  
  if (!correctTier) {
    console.log(`   ⚠️ Could not determine tier for ${tx.transactionId}`);
    return null;
  }
  
  // Calculate correct values based on shares
  const shares = currentShares;
  const values = calculateValues(correctTier, shares);
  
  const updates = {
    tierKey: correctTier.name.toLowerCase(),
    packageId: correctTier.name.toLowerCase(),
    packageLabel: correctTier.name,
    ownershipPct: values.ownershipPct,
    earningKobo: values.earningKobo,
    pricePerShare: values.pricePerShare,
    shares: shares
  };
  
  // For co-founder, also set type correctly
  if (correctTier.type === 'co-founder') {
    updates.type = 'co-founder';
  } else {
    updates.type = 'share';
  }
  
  // Check if update is needed
  const needsUpdate = 
    tx.tierKey !== updates.tierKey ||
    tx.packageLabel !== updates.packageLabel ||
    Math.abs((tx.ownershipPct || 0) - updates.ownershipPct) > 0.000001 ||
    (tx.earningKobo || 0) !== updates.earningKobo;
  
  if (!needsUpdate) {
    return null;
  }
  
  if (dryRun) {
    return {
      transactionId: tx.transactionId,
      old: {
        tierKey: tx.tierKey,
        packageLabel: tx.packageLabel,
        ownershipPct: tx.ownershipPct,
        earningKobo: tx.earningKobo,
        shares: tx.shares
      },
      new: updates
    };
  }
  
  // Update PaymentTransaction
  await PaymentTransaction.updateOne(
    { transactionId: tx.transactionId },
    { $set: updates }
  );
  
  // Update UserShare
  await UserShare.updateOne(
    { 'transactions.transactionId': tx.transactionId },
    { $set: {
        'transactions.$.tierKey': updates.tierKey,
        'transactions.$.packageId': updates.packageId,
        'transactions.$.packageLabel': updates.packageLabel,
        'transactions.$.ownershipPct': updates.ownershipPct,
        'transactions.$.earningKobo': updates.earningKobo,
        'transactions.$.pricePerShare': updates.pricePerShare,
        'transactions.$.shares': updates.shares,
        'transactions.$.type': updates.type
      }}
  );
  
  return {
    transactionId: tx.transactionId,
    old: {
      tierKey: tx.tierKey,
      packageLabel: tx.packageLabel,
      ownershipPct: tx.ownershipPct,
      earningKobo: tx.earningKobo,
      shares: tx.shares
    },
    new: updates
  };
}

async function recalculateUserTotals(userId) {
  const userShare = await UserShare.findOne({ user: userId });
  if (!userShare) return;
  
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
  
  return { totalOwnershipPct, totalEarningKobo };
}

// ============================================
// Main Function
// ============================================

async function main() {
  console.log('🔌 Connecting to MongoDB...');
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
  
  if (!mongoUri) {
    console.error('❌ No database connection string found');
    process.exit(1);
  }
  
  await mongoose.connect(mongoUri);
  console.log('✅ Connected\n');
  
  const DRY_RUN = process.argv.includes('--dry-run');
  const VERBOSE = process.argv.includes('--verbose');
  
  console.log('═'.repeat(70));
  console.log('📊 BULK TRANSACTION FIXER');
  console.log('═'.repeat(70));
  console.log(`   Dry run: ${DRY_RUN ? 'YES (no changes)' : 'NO (will update DB)'}`);
  console.log(`   New pricing applies after: ${NEW_PRICING_DATE.toISOString().split('T')[0]}`);
  console.log('═'.repeat(70));
  
  // Load all completed transactions
  console.log('\n📥 Loading transactions...');
  const transactions = await PaymentTransaction.find({ 
    status: 'completed' 
  }).sort({ createdAt: 1 });
  
  console.log(`   Found ${transactions.length} completed transactions\n`);
  
  const results = {
    updated: [],
    skipped: [],
    errors: []
  };
  
  let processed = 0;
  
  for (const tx of transactions) {
    processed++;
    if (VERBOSE && processed % 50 === 0) {
      console.log(`   Processing: ${processed}/${transactions.length}`);
    }
    
    try {
      const result = await fixTransaction(tx, DRY_RUN);
      if (result) {
        results.updated.push(result);
        if (VERBOSE) {
          console.log(`\n📝 ${result.transactionId}:`);
          console.log(`   ${result.old.packageLabel || 'none'} → ${result.new.packageLabel}`);
          console.log(`   ${(result.old.ownershipPct * 100).toFixed(5)}% → ${(result.new.ownershipPct * 100).toFixed(5)}%`);
        }
      } else {
        results.skipped.push(tx.transactionId);
      }
    } catch (err) {
      results.errors.push({ transactionId: tx.transactionId, error: err.message });
      console.error(`   ❌ Error on ${tx.transactionId}: ${err.message}`);
    }
  }
  
  // Recalculate user totals if not dry run
  if (!DRY_RUN && results.updated.length > 0) {
    console.log('\n🔄 Recalculating user totals...');
    const userIds = new Set();
    for (const update of results.updated) {
      const tx = await PaymentTransaction.findOne({ transactionId: update.transactionId });
      if (tx && tx.userId) {
        userIds.add(tx.userId.toString());
      }
    }
    
    let recalcCount = 0;
    for (const userId of userIds) {
      await recalculateUserTotals(userId);
      recalcCount++;
      if (VERBOSE && recalcCount % 10 === 0) {
        console.log(`   Recalculated ${recalcCount}/${userIds.size} users`);
      }
    }
    console.log(`   ✅ Recalculated totals for ${recalcCount} users`);
  }
  
  // Summary
  console.log('\n' + '═'.repeat(70));
  console.log('📊 FIX SUMMARY');
  console.log('═'.repeat(70));
  console.log(`   Transactions processed: ${transactions.length}`);
  console.log(`   ✅ Updated: ${results.updated.length}`);
  console.log(`   ⏭️ Skipped (already correct): ${results.skipped.length}`);
  console.log(`   ❌ Errors: ${results.errors.length}`);
  
  if (results.updated.length > 0) {
    console.log('\n📝 UPDATES BY TIER:');
    const tierCounts = {};
    for (const update of results.updated) {
      const tier = update.new.packageLabel;
      tierCounts[tier] = (tierCounts[tier] || 0) + 1;
    }
    for (const [tier, count] of Object.entries(tierCounts)) {
      console.log(`   ${tier}: ${count} transactions`);
    }
  }
  
  if (results.errors.length > 0 && VERBOSE) {
    console.log('\n❌ ERRORS:');
    for (const err of results.errors.slice(0, 10)) {
      console.log(`   ${err.transactionId}: ${err.error}`);
    }
  }
  
  if (DRY_RUN) {
    console.log('\n⚠️ This was a DRY RUN. No changes were made to the database.');
    console.log('   To apply changes, run: node scripts/bulk-fix-transactions.js');
  } else {
    console.log('\n✅ ALL FIXES APPLIED!');
    console.log('\n💡 Verify with:');
    console.log('   node auditTransactions.js --only completed');
  }
  
  console.log('\n🔌 Disconnecting...');
  await mongoose.disconnect();
  console.log('✅ Done');
}

// ============================================
// Run
// ============================================

main().catch(err => {
  console.error('❌ Fatal error:', err.message);
  console.error(err.stack);
  mongoose.disconnect();
  process.exit(1);
});