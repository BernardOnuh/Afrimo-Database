#!/usr/bin/env node

/**
 * Migration: Legacy Transactions → UserShare Documents
 * 
 * This script:
 * 1. Reads all transactions from the old Transaction collection
 * 2. Groups them by user
 * 3. Creates/updates UserShare documents with proper ownership & earnings
 * 4. Maps both legacy packages AND amounts to new packages
 */

require('dotenv').config();
const mongoose = require('mongoose');

// Models
const UserShare = require('../models/UserShare');
const SharePackage = require('../models/SharePackage');
const Transaction = require('../models/Transaction');

// ============================================================================
// AMOUNT MAPPING (for unrecognized amounts)
// ============================================================================

const AMOUNT_TO_PACKAGE = {
  // Regular shares
  30000: 'Basic',      // 0.00001%
  40000: 'Basic',      // Map to Basic (closest below)
  50000: 'Standard',   // 0.000021%
  60000: 'Standard',   // Map to Standard (closest below)
  75000: 'Premium',    // Map to Premium (closest below)
  100000: 'Premium',   // 0.00005%
  
  // Co-founder shares
  500000: 'Elite',     // 0.000462%
  800000: 'Elite',     // 0.000462%
  1000000: 'Elite',    // Map old ₦1M to Elite
  1450000: 'Platinum', // 0.00135%
  2500000: 'Platinum', // 0.00135%
  3000000: 'Supreme',  // 0.003% (common high amount)
  3480000: 'Supreme',  // 0.003%
  4350000: 'Supreme',  // 0.003%
  5000000: 'Supreme',  // 0.003%
  7000000: 'Supreme'   // 0.003%
};

// Package metadata
const PACKAGES = {
  'Basic':    { type: 'share',      ownershipPct: 0.00001,   earningKobo: 6000  },
  'Standard': { type: 'share',      ownershipPct: 0.000021,  earningKobo: 14000 },
  'Premium':  { type: 'share',      ownershipPct: 0.00005,   earningKobo: 30000 },
  'Elite':    { type: 'co-founder', ownershipPct: 0.000462,  earningKobo: 14000 },
  'Platinum': { type: 'co-founder', ownershipPct: 0.00135,   earningKobo: 14000 },
  'Supreme':  { type: 'co-founder', ownershipPct: 0.003,     earningKobo: 14000 }
};

// ============================================================================
// MAIN MIGRATION
// ============================================================================

async function migrate() {
  const isDryRun = process.argv.includes('--dry-run');
  
  try {
    // Connect
    console.log('Connecting to database...');
    await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
    console.log('Connected.\n');

    // Fetch all transactions
    const transactions = await Transaction.find({}).lean();
    console.log(`Found ${transactions.length} legacy transactions.\n`);

    // Fetch all share packages for reference
    const packages = await SharePackage.find({}).lean();
    const packageMap = {};
    packages.forEach(pkg => {
      packageMap[pkg.label] = pkg;
    });

    console.log(`Available packages: ${Object.keys(packageMap).join(', ')}\n`);

    // ========================================================================
    // PROCESS TRANSACTIONS
    // ========================================================================

    let processed = 0, skipped = 0, errors = 0;
    const txsByUser = {};
    const skippedTransactions = [];

    for (const tx of transactions) {
      try {
        // Determine package label
        let packageLabel = null;

        // 1. Try to match by legacy package name
        if (tx.packageLabel) {
          if (packageMap[tx.packageLabel]) {
            packageLabel = tx.packageLabel;
          }
        }

        // 2. Try to match by amount
        if (!packageLabel && tx.amount) {
          const mappedLabel = AMOUNT_TO_PACKAGE[tx.amount];
          if (mappedLabel && packageMap[mappedLabel]) {
            packageLabel = mappedLabel;
          }
        }

        // 3. Fall back: use Premium for regular, Supreme for co-founder
        if (!packageLabel) {
          const isCofoundrer = tx.transactionId?.startsWith('CFD');
          packageLabel = isCofoundrer ? 'Supreme' : 'Premium';
          
          if (!packageMap[packageLabel]) {
            console.log(
              `[SKIP]    ${tx.transactionId} | amount=${tx.amount} | no mapping found`
            );
            skipped++;
            skippedTransactions.push(tx);
            continue;
          }
        }

        const pkg = packageMap[packageLabel];
        if (!pkg) {
          console.log(
            `[SKIP]    ${tx.transactionId} | amount=${tx.amount} | package not found`
          );
          skipped++;
          skippedTransactions.push(tx);
          continue;
        }

        // ====================================================================
        // BUILD TRANSACTION OBJECT FOR NEW USERSHARE
        // ====================================================================

        const newTx = {
          transactionId: tx.transactionId,
          type: pkg.type === 'co-founder' ? 'co-founder' : 'share',
          packageLabel: packageLabel,
          ownershipPct: pkg.ownershipPct || PACKAGES[packageLabel].ownershipPct,
          earningKobo: pkg.earningKobo || PACKAGES[packageLabel].earningKobo,
          amount: tx.amount,
          currency: tx.currency || 'naira',
          paymentMethod: tx.paymentMethod || 'unknown',
          status: 'completed', // Mark migrated transactions as completed
          manualPaymentDetails: tx.manualPaymentDetails,
          paymentProofPath: tx.paymentProofPath,
          paymentProofCloudinaryUrl: tx.paymentProofCloudinaryUrl,
          paymentProofCloudinaryId: tx.paymentProofCloudinaryId,
          paymentProofOriginalName: tx.paymentProofOriginalName,
          paymentProofFileSize: tx.paymentProofFileSize,
          verifiedBy: tx.verifiedBy,
          createdAt: tx.createdAt || new Date()
        };

        // Group by user
        if (!txsByUser[tx.user]) {
          txsByUser[tx.user] = [];
        }
        txsByUser[tx.user].push(newTx);

        // Log based on date
        const isBefore = tx.createdAt < new Date('2025-03-01');
        const prefix = isBefore ? '[LEGACY]' : '[POST]';
        const typeStr = newTx.type === 'co-founder' ? 'co-founder' : 'share';
        const currencyStr = newTx.currency === 'usdt' ? 'usdt' : 'naira';

        console.log(
          `${prefix}  ${tx.transactionId} | ${typeStr} | ${currencyStr} ${tx.amount} | ` +
          `→ ${packageLabel} (${(newTx.ownershipPct * 100).toFixed(5)}%)`
        );

        processed++;

      } catch (err) {
        console.error(`[ERROR]   ${tx.transactionId}:`, err.message);
        errors++;
      }
    }

    console.log(
      '\n════════════════════════════════\n' +
      `Processed:     ${processed}\n` +
      `Skipped:       ${skipped}\n` +
      `Errors:        ${errors}\n` +
      '════════════════════════════════\n'
    );

    // ========================================================================
    // UPDATE USERSHARE DOCUMENTS
    // ========================================================================

    console.log(`Updating UserShare for ${Object.keys(txsByUser).length} users...`);

    let usersUpdated = 0;

    for (const [userId, userTransactions] of Object.entries(txsByUser)) {
      try {
        // Calculate totals
        let totalOwnershipPct = 0;
        let totalEarningKobo = 0;

        userTransactions.forEach(tx => {
          totalOwnershipPct += tx.ownershipPct;
          totalEarningKobo += tx.earningKobo;
        });

        // Round to avoid floating point errors
        totalOwnershipPct = parseFloat(totalOwnershipPct.toFixed(10));

        if (isDryRun) {
          console.log(
            `[DRY] User ${userId}\n` +
            `      totalOwnershipPct = ${(totalOwnershipPct * 100).toFixed(7)}%\n` +
            `      totalEarningKobo  = ${totalEarningKobo}\n` +
            `      transactions      = ${userTransactions.length}`
          );
        } else {
          // Find or create UserShare
          let record = await UserShare.findOne({ user: userId });

          if (!record) {
            record = new UserShare({
              user: userId,
              totalOwnershipPct: 0,
              totalEarningKobo: 0,
              transactions: []
            });
          }

          // Add all transactions
          record.transactions = userTransactions;

          // Update totals
          record.totalOwnershipPct = totalOwnershipPct;
          record.totalEarningKobo = totalEarningKobo;

          // Save
          await record.save();

          console.log(
            `✅ User ${userId} | ownership=${(totalOwnershipPct * 100).toFixed(7)}% | ` +
            `earning=${totalEarningKobo} kobo | transactions=${userTransactions.length}`
          );
        }

        usersUpdated++;

      } catch (err) {
        console.error(`[ERROR]   User ${userId}:`, err.message);
        errors++;
      }
    }

    console.log('\n════════════════════════════════');
    console.log(`Migration ${isDryRun ? 'DRY RUN' : 'COMPLETE'}.`);
    console.log(`Users updated: ${usersUpdated}`);
    console.log('════════════════════════════════\n');

    if (isDryRun) {
      console.log('This was a DRY RUN. To apply:');
      console.log('node scripts/migrateLegacyTransactions.js');
    } else {
      console.log('✅ Migration applied successfully!');
      console.log('All transactions have been migrated to UserShare documents.');
    }

  } catch (err) {
    console.error('\n❌ Migration failed:', err.message);
    if (err.stack) console.error(err.stack);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

// Run
migrate();