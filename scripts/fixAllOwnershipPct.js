#!/usr/bin/env node

/**
 * Fix Ownership Percentage for ALL Users
 * Uses earningKobo as fallback when amount is missing
 * Handles required 'amount' field by setting to 0
 */

require('dotenv').config();
const mongoose = require('mongoose');
const UserShare = require('../models/UserShare');
const SharePackage = require('../models/SharePackage');
const User = require('../models/User');

// ============================================================================
// PACKAGE METADATA
// ============================================================================

const PACKAGE_METADATA = {
  'Basic':    { type: 'share',      ownershipPct: 0.00001,   earningKobo: 6000  },
  'Standard': { type: 'share',      ownershipPct: 0.000021,  earningKobo: 14000 },
  'Premium':  { type: 'share',      ownershipPct: 0.00005,   earningKobo: 30000 },
  'Elite':    { type: 'co-founder', ownershipPct: 0.000462,  earningKobo: 14000 },
  'Platinum': { type: 'co-founder', ownershipPct: 0.00135,   earningKobo: 14000 },
  'Supreme':  { type: 'co-founder', ownershipPct: 0.003,     earningKobo: 14000 },
};

const AMOUNT_TO_PACKAGE = {
  20000: 'Basic', 25000: 'Basic', 30000: 'Basic', 35000: 'Basic', 40000: 'Basic',
  45000: 'Standard', 50000: 'Standard', 55000: 'Standard', 60000: 'Standard',
  65000: 'Premium', 70000: 'Premium', 75000: 'Premium', 80000: 'Premium',
  85000: 'Premium', 90000: 'Premium', 95000: 'Premium', 100000: 'Premium',
  150000: 'Premium', 200000: 'Premium',
  500000: 'Elite', 800000: 'Elite', 1000000: 'Elite',
  1450000: 'Platinum', 2500000: 'Platinum',
  3000000: 'Supreme', 3480000: 'Supreme', 4350000: 'Supreme',
  5000000: 'Supreme', 7000000: 'Supreme',
};

const EARNING_TO_PACKAGE = {
  30: 'Premium',
  6000: 'Basic',
  14000: 'Standard',
  30000: 'Premium',
};

// ============================================================================
// HELPER
// ============================================================================

function getPackageForTransaction(tx) {
  if (tx.packageLabel && PACKAGE_METADATA[tx.packageLabel]) {
    return PACKAGE_METADATA[tx.packageLabel];
  }
  
  if (tx.amount) {
    const mappedLabel = AMOUNT_TO_PACKAGE[tx.amount];
    if (mappedLabel && PACKAGE_METADATA[mappedLabel]) {
      return PACKAGE_METADATA[mappedLabel];
    }
  }
  
  if (tx.earningKobo) {
    const mappedLabel = EARNING_TO_PACKAGE[tx.earningKobo];
    if (mappedLabel && PACKAGE_METADATA[mappedLabel]) {
      return PACKAGE_METADATA[mappedLabel];
    }
  }
  
  if (tx.type === 'co-founder') {
    return PACKAGE_METADATA['Supreme'];
  }
  
  return PACKAGE_METADATA['Premium'];
}

function getUserName(userShare) {
  if (userShare.user && typeof userShare.user === 'object') {
    return userShare.user.name || userShare.user.email || 'Unknown';
  }
  return userShare.user?.toString() || 'Unknown';
}

// ============================================================================
// MAIN
// ============================================================================

async function fixAllUserShares() {
  const isDryRun = process.argv.includes('--dry-run');
  
  try {
    console.log('Connecting to database...');
    await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
    console.log('Connected.\n');

    const packages = await SharePackage.find({ active: true }).lean();
    console.log(`Found ${packages.length} active share packages.`);
    
    packages.forEach(pkg => {
      if (!PACKAGE_METADATA[pkg.label]) {
        PACKAGE_METADATA[pkg.label] = {
          type: pkg.type || 'share',
          ownershipPct: pkg.ownershipPct || 0,
          earningKobo: pkg.earningKobo || 0
        };
        if (pkg.earningKobo) {
          EARNING_TO_PACKAGE[pkg.earningKobo] = pkg.label;
        }
      }
    });

    const allUserShares = await UserShare.find({}).populate('user', 'name email');
    console.log(`Found ${allUserShares.length} UserShare documents.\n`);

    let totalFixed = 0;
    let totalTransactionsFixed = 0;
    const results = [];

    for (const userShare of allUserShares) {
      let userFixed = false;
      let transactionsFixed = 0;
      
      const userName = getUserName(userShare);
      
      // 🔥 FIX: Ensure ALL transactions have an amount field
      let needsAmountFix = false;
      for (const transaction of userShare.transactions) {
        if (transaction.amount === undefined || transaction.amount === null) {
          transaction.amount = 0; // Set default amount
          needsAmountFix = true;
        }
      }
      
      // Fix ownershipPct for completed transactions
      for (const transaction of userShare.transactions) {
        // Skip if already has ownershipPct
        if (transaction.ownershipPct && transaction.ownershipPct > 0) {
          continue;
        }
        
        // Skip non-completed
        if (transaction.status !== 'completed') {
          continue;
        }
        
        const pkg = getPackageForTransaction(transaction);
        
        if (pkg && pkg.ownershipPct > 0) {
          transaction.ownershipPct = pkg.ownershipPct;
          
          if (!transaction.earningKobo && pkg.earningKobo) {
            transaction.earningKobo = pkg.earningKobo;
          }
          
          if (transaction.type !== 'co-founder' && pkg.type === 'co-founder') {
            transaction.type = 'co-founder';
          }
          
          if (!transaction.packageLabel) {
            for (const [label, metadata] of Object.entries(PACKAGE_METADATA)) {
              if (metadata.ownershipPct === pkg.ownershipPct) {
                transaction.packageLabel = label;
                break;
              }
            }
          }
          
          userFixed = true;
          transactionsFixed++;
        }
      }
      
      if (userFixed || needsAmountFix) {
        // Recalculate totals
        const completedTransactions = userShare.transactions.filter(
          t => t.status === 'completed'
        );
        
        const oldTotalOwnership = userShare.totalOwnershipPct;
        const oldTotalEarning = userShare.totalEarningKobo;
        
        const regularOwnership = completedTransactions
          .filter(t => t.type !== 'co-founder')
          .reduce((sum, t) => sum + (t.ownershipPct || 0), 0);
          
        const cofounderOwnership = completedTransactions
          .filter(t => t.type === 'co-founder')
          .reduce((sum, t) => sum + (t.ownershipPct || 0), 0);
        
        userShare.totalOwnershipPct = parseFloat((regularOwnership + cofounderOwnership).toFixed(10));
        userShare.totalEarningKobo = parseFloat(
          completedTransactions.reduce((sum, t) => sum + (t.earningKobo || 0), 0).toFixed(2)
        );
        
        if (!isDryRun) {
          // 🔥 Use markModified to ensure Mongoose detects changes
          userShare.markModified('transactions');
          await userShare.save({ validateModifiedOnly: true });
        }
        
        console.log(
          `✅ ${userName}: ${transactionsFixed} txns fixed | ` +
          `${(oldTotalOwnership * 100).toFixed(7)}% → ${(userShare.totalOwnershipPct * 100).toFixed(7)}%`
        );
        
        totalFixed++;
        totalTransactionsFixed += transactionsFixed;
        
        results.push({
          userName,
          transactionsFixed,
          oldOwnership: oldTotalOwnership,
          newOwnership: userShare.totalOwnershipPct,
        });
      }
    }

    // Summary
    console.log('\n═══════════════════════════════════════════════════════');
    console.log(`FIX ${isDryRun ? 'DRY RUN' : 'COMPLETE'}`);
    console.log('═══════════════════════════════════════════════════════');
    console.log(`Users fixed: ${totalFixed}`);
    console.log(`Transactions fixed: ${totalTransactionsFixed}`);
    console.log('═══════════════════════════════════════════════════════\n');

    if (results.length > 0) {
      results.forEach(r => {
        console.log(
          `${r.userName}: ${r.transactionsFixed} txns | ` +
          `${(r.oldOwnership * 100).toFixed(7)}% → ${(r.newOwnership * 100).toFixed(7)}%`
        );
      });
    }

    if (isDryRun) {
      console.log('\n🔍 DRY RUN. To apply: node scripts/fixAllOwnershipPct.js\n');
    } else {
      console.log('\n✅ All UserShare documents have been fixed!\n');
    }

  } catch (error) {
    console.error('\n❌ Failed:', error.message);
    if (error.stack) console.error(error.stack);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from database.');
  }
}

fixAllUserShares();