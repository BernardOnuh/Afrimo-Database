

/**
 * Fix ONLY completed transactions that have zero ownershipPct/earningKobo
 * This does NOT touch pending transactions (admin can still cancel/reject)
 * 
 * Run: node scripts/fixCompletedTransactions.js
 * Dry run: node scripts/fixCompletedTransactions.js --dry-run
 */

require('dotenv').config();
const mongoose = require('mongoose');

const Transaction = require('../models/Transaction');
const UserShare = require('../models/UserShare');

// ============================================================================
// HELPER FUNCTIONS - Calculate based on amount and tier
// ============================================================================

function calculateOwnershipFromAmount(amount, tier, transactionId = '') {
  // Check if it's co-founder by transaction ID prefix
  const isCoFounder = transactionId?.startsWith('CFD') || transactionId?.startsWith('FSP');
  
  // Tier-based mapping
  const tierMap = {
    'basic': 0.00001,
    'standard': 0.000021,
    'premium': 0.000042,
    'elite': 0.000462,
    'platinum': 0.00135,
    'supreme': 0.003
  };
  
  if (tier && tierMap[tier.toLowerCase()]) {
    return tierMap[tier.toLowerCase()];
  }
  
  // For co-founder transactions
  if (isCoFounder) {
    if (amount >= 3000000) return 0.003;
    if (amount >= 1450000) return 0.00135;
    if (amount >= 800000) return 0.000462;
    return 0.000462; // Default for co-founder
  }
  
  // For regular share transactions
  if (amount >= 200000) return 0.000084;
  if (amount >= 100000) return 0.000042;
  if (amount >= 50000) return 0.000021;
  if (amount >= 30000) return 0.00001;
  return 0.00001; // Default
}

function calculateEarningFromAmount(amount, tier, transactionId = '') {
  // Check if it's co-founder by transaction ID prefix
  const isCoFounder = transactionId?.startsWith('CFD') || transactionId?.startsWith('FSP');
  
  // Tier-based mapping
  const tierMap = {
    'basic': 6000,
    'standard': 14000,
    'premium': 28000,
    'elite': 14000,
    'platinum': 14000,
    'supreme': 14000
  };
  
  if (tier && tierMap[tier.toLowerCase()]) {
    return tierMap[tier.toLowerCase()];
  }
  
  // For co-founder transactions
  if (isCoFounder) {
    return 14000;
  }
  
  // For regular share transactions
  if (amount >= 100000) return 28000;
  if (amount >= 50000) return 14000;
  if (amount >= 30000) return 6000;
  return 6000; // Default
}

function getPackageLabel(amount, tier, transactionId = '') {
  const isCoFounder = transactionId?.startsWith('CFD') || transactionId?.startsWith('FSP');
  
  if (tier) {
    return tier.charAt(0).toUpperCase() + tier.slice(1);
  }
  
  if (isCoFounder) {
    if (amount >= 3000000) return 'Supreme';
    if (amount >= 1450000) return 'Platinum';
    return 'Elite';
  }
  
  if (amount >= 200000) return 'Elite';
  if (amount >= 100000) return 'Premium';
  if (amount >= 50000) return 'Standard';
  return 'Basic';
}

// ============================================================================
// MAIN FIX FUNCTION
// ============================================================================

async function fixCompletedTransactions() {
  const isDryRun = process.argv.includes('--dry-run');
  
  try {
    console.log('=' .repeat(60));
    console.log('FIX COMPLETED TRANSACTIONS WITH ZERO VALUES');
    console.log('=' .repeat(60));
    console.log(`Mode: ${isDryRun ? 'DRY RUN (no changes)' : 'LIVE (will update database)'}\n`);
    
    // Connect to database
    console.log('Connecting to database...');
    await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
    console.log('✅ Connected.\n');

    // Find completed transactions with zero or missing values
    const transactions = await Transaction.find({
      status: 'completed',
      $or: [
        { ownershipPct: 0 },
        { ownershipPct: { $exists: false } },
        { ownershipPct: null },
        { earningKobo: 0 },
        { earningKobo: { $exists: false } },
        { earningKobo: null }
      ]
    });
    
    console.log(`📊 Found ${transactions.length} completed transactions that need fixing.\n`);
    
    if (transactions.length === 0) {
      console.log('✨ No transactions need fixing!');
      await mongoose.disconnect();
      return;
    }
    
    let fixed = 0;
    let skipped = 0;
    const updates = [];
    
    for (const tx of transactions) {
      // Skip if transaction has valid values already
      if (tx.ownershipPct > 0 && tx.earningKobo > 0) {
        skipped++;
        continue;
      }
      
      // Calculate correct values
      const ownershipPct = calculateOwnershipFromAmount(tx.amount, tx.tier, tx.transactionId);
      const earningKobo = calculateEarningFromAmount(tx.amount, tx.tier, tx.transactionId);
      const packageLabel = getPackageLabel(tx.amount, tx.tier, tx.transactionId);
      
      const ownershipPercent = (ownershipPct * 100).toFixed(6);
      const earningNaira = (earningKobo / 100).toFixed(2);
      
      console.log(`[${tx.transactionId}]`);
      console.log(`   Amount: ₦${tx.amount.toLocaleString()}`);
      console.log(`   Tier: ${tx.tier || 'N/A'}`);
      console.log(`   Type: ${tx.transactionId?.startsWith('CFD') ? 'co-founder' : 'share'}`);
      console.log(`   → Ownership: ${ownershipPercent}%`);
      console.log(`   → Earning: ₦${earningNaira} per phone`);
      console.log(`   → Package: ${packageLabel}`);
      console.log('');
      
      updates.push({
        transactionId: tx.transactionId,
        oldOwnership: tx.ownershipPct,
        newOwnership: ownershipPct,
        oldEarning: tx.earningKobo,
        newEarning: earningKobo
      });
      
      if (!isDryRun) {
        // Update the transaction
        await Transaction.updateOne(
          { _id: tx._id },
          { 
            $set: { 
              ownershipPct: ownershipPct,
              earningKobo: earningKobo,
              packageLabel: packageLabel
            } 
          }
        );
        fixed++;
      } else {
        fixed++;
      }
    }
    
    console.log('-'.repeat(60));
    console.log(`📈 Summary:`);
    console.log(`   Fixed: ${fixed}`);
    console.log(`   Skipped (already had values): ${skipped}`);
    console.log(`   Total processed: ${transactions.length}`);
    
    // If not dry run, also recalculate UserShare totals
    if (!isDryRun && fixed > 0) {
      console.log('\n🔄 Recalculating UserShare totals...');
      
      // Get all unique user IDs from fixed transactions
      const userIds = [...new Set(transactions.map(tx => tx.userId.toString()))];
      console.log(`   Found ${userIds.length} users to update`);
      
      let usersUpdated = 0;
      
      for (const userId of userIds) {
        // Get all completed transactions for this user
        const userTransactions = await Transaction.find({
          userId: userId,
          status: 'completed'
        });
        
        let totalOwnershipPct = 0;
        let totalEarningKobo = 0;
        
        userTransactions.forEach(tx => {
          totalOwnershipPct += tx.ownershipPct || 0;
          totalEarningKobo += tx.earningKobo || 0;
        });
        
        // Round to avoid floating point errors
        totalOwnershipPct = parseFloat(totalOwnershipPct.toFixed(10));
        
        // Update UserShare
        const userShare = await UserShare.findOne({ user: userId });
        
        if (userShare) {
          userShare.totalOwnershipPct = totalOwnershipPct;
          userShare.totalEarningKobo = totalEarningKobo;
          await userShare.save();
          usersUpdated++;
          console.log(`   ✅ User ${userId}: ${(totalOwnershipPct * 100).toFixed(6)}% | ${totalEarningKobo} kobo`);
        } else {
          // Create new UserShare if doesn't exist
          const newUserShare = new UserShare({
            user: userId,
            totalOwnershipPct: totalOwnershipPct,
            totalEarningKobo: totalEarningKobo,
            transactions: []
          });
          await newUserShare.save();
          usersUpdated++;
          console.log(`   ✅ Created UserShare for ${userId}: ${(totalOwnershipPct * 100).toFixed(6)}%`);
        }
      }
      
      console.log(`   ✅ Updated ${usersUpdated} UserShare records`);
    }
    
    console.log('\n' + '=' .repeat(60));
    if (isDryRun) {
      console.log('⚠️  DRY RUN COMPLETE - No changes were made to the database');
      console.log('\nTo apply these fixes, run:');
      console.log('   node scripts/fixCompletedTransactions.js');
    } else {
      console.log('✅ FIX COMPLETE - All completed transactions have been updated');
      console.log(`   Updated ${fixed} transactions`);
      console.log(`   Pending transactions were NOT touched (they will get values when approved)`);
    }
    console.log('=' .repeat(60));
    
    // Show sample of what was updated
    if (updates.length > 0 && !isDryRun) {
      console.log('\n📝 Sample of updated transactions:');
      updates.slice(0, 5).forEach(update => {
        console.log(`   ${update.transactionId}: ${update.oldOwnership || 0}% → ${(update.newOwnership * 100).toFixed(6)}%`);
      });
      if (updates.length > 5) {
        console.log(`   ... and ${updates.length - 5} more`);
      }
    }
    
  } catch (err) {
    console.error('\n❌ Error:', err.message);
    if (err.stack) console.error(err.stack);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('\n🔌 Database disconnected');
  }
}

// Run the script
fixCompletedTransactions();