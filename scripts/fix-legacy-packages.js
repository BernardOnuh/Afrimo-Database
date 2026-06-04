// fix-legacy-packages.js
require('dotenv').config();
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

const LEGACY_CUTOFF = new Date('2026-02-25');
const LEGACY_EARNING_PER_SHARE = 30;      // 30 Kobo per share
const LEGACY_OWNERSHIP_PCT = 0.00005;     // 0.00005% per share
const LEGACY_PACKAGE_LABEL = 'Legacy';

// Helper to format date
const fmtDate = (d) => d ? new Date(d).toISOString().split('T')[0] : 'unknown';

async function fixLegacyPackages(dryRun = true) {
  console.log('\n' + '═'.repeat(80));
  console.log(dryRun ? '🔍 DRY RUN MODE - No changes will be made' : '⚡ LIVE UPDATE MODE - Database will be modified');
  console.log('═'.repeat(80));
  console.log(`📅 Legacy cutoff date: ${LEGACY_CUTOFF.toISOString().split('T')[0]}`);
  console.log(`💰 Earning: ${LEGACY_EARNING_PER_SHARE} Kobo per share`);
  console.log(`📊 Ownership: ${(LEGACY_OWNERSHIP_PCT * 100).toFixed(5)}% per share`);
  console.log(`🏷️  Package Label: "${LEGACY_PACKAGE_LABEL}"\n`);

  const PaymentTransaction = require('../models/Transaction');
  const UserShare = require('../models/UserShare');

  // Find ALL completed transactions before cutoff
  const query = {
    status: 'completed',
    createdAt: { $lt: LEGACY_CUTOFF }
  };

  const ptDocs = await PaymentTransaction.find(query).sort({ createdAt: 1 }).lean();
  console.log(`📊 Found ${ptDocs.length} completed transactions before ${LEGACY_CUTOFF.toISOString().split('T')[0]}\n`);

  const updates = [];
  let noChange = 0;

  for (const tx of ptDocs) {
    const shares = parseFloat(tx.shares) || 1;
    const proposedEarning = shares * LEGACY_EARNING_PER_SHARE;
    const proposedOwnership = shares * LEGACY_OWNERSHIP_PCT;
    
    const currentEarning = parseFloat(tx.earningKobo) || 0;
    const currentOwnership = parseFloat(tx.ownershipPct) || 0;
    const currentLabel = tx.packageLabel || tx.tierKey || '';
    
    const needsUpdate = (
      Math.abs(currentEarning - proposedEarning) > 0.01 ||
      Math.abs(currentOwnership - proposedOwnership) > 0.00000001 ||
      currentLabel !== LEGACY_PACKAGE_LABEL
    );
    
    if (needsUpdate) {
      updates.push({
        transactionId: tx.transactionId,
        type: tx.type,
        shares,
        date: tx.createdAt,
        currentEarning,
        proposedEarning,
        currentOwnership,
        proposedOwnership,
        currentLabel,
        proposedLabel: LEGACY_PACKAGE_LABEL,
        amount: tx.amount,
        currency: tx.currency
      });
    } else {
      noChange++;
    }
  }

  // Display updates
  console.log('📝 TRANSACTIONS TO BE UPDATED:\n');
  console.log('─'.repeat(80));
  
  for (const u of updates) {
    console.log(`\n🔷 ${u.transactionId} (${u.type}) - ${fmtDate(u.date)}`);
    console.log(`   Shares: ${u.shares}`);
    console.log(`   Amount: ${u.currency === 'naira' ? '₦' : '$'}${u.amount?.toLocaleString() || '0'}`);
    
    if (u.currentEarning !== u.proposedEarning) {
      console.log(`   Earning: ${u.currentEarning.toLocaleString()} → ${u.proposedEarning} Kobo`);
    }
    if (u.currentOwnership !== u.proposedOwnership) {
      console.log(`   Ownership: ${(u.currentOwnership * 100).toFixed(7)}% → ${(u.proposedOwnership * 100).toFixed(7)}%`);
    }
    if (u.currentLabel !== u.proposedLabel) {
      console.log(`   Label: "${u.currentLabel || '—'}" → "${u.proposedLabel}"`);
    }
  }

  console.log('\n' + '═'.repeat(80));
  console.log(`📊 SUMMARY:`);
  console.log(`   Total pre-${LEGACY_CUTOFF.toISOString().split('T')[0]} transactions: ${ptDocs.length}`);
  console.log(`   🔄 Need update: ${updates.length}`);
  console.log(`   ✓  Already correct: ${noChange}`);
  
  // Calculate impact
  const shareCount = updates.filter(u => u.type !== 'co-founder').length;
  const cofounderCount = updates.filter(u => u.type === 'co-founder').length;
  console.log(`\n📈 BREAKDOWN:`);
  console.log(`   Share transactions: ${shareCount}`);
  console.log(`   Co-founder transactions: ${cofounderCount}`);

  // Save dry run report
  if (dryRun && updates.length > 0) {
    const reportPath = path.join(process.cwd(), 'legacy-dry-run-report.json');
    fs.writeFileSync(reportPath, JSON.stringify({
      generatedAt: new Date().toISOString(),
      dryRun: true,
      cutoff: LEGACY_CUTOFF,
      totalTransactions: ptDocs.length,
      updatesNeeded: updates.length,
      updates
    }, null, 2));
    console.log(`\n📄 Dry run report saved to: ${reportPath}`);
    
    console.log(`\n⚠️  This is a DRY RUN. No changes were made to the database.`);
    console.log(`   To apply updates, run: node fix-legacy-packages.js --apply`);
  }

  // Execute updates if live mode
  if (!dryRun && updates.length > 0) {
    console.log(`\n⚡ Executing updates...`);
    let successCount = 0;
    let errorCount = 0;
    
    for (const u of updates) {
      try {
        // Update PaymentTransaction
        await PaymentTransaction.updateOne(
          { transactionId: u.transactionId },
          {
            $set: {
              earningKobo: u.proposedEarning,
              ownershipPct: u.proposedOwnership,
              packageLabel: u.proposedLabel,
              tierKey: u.proposedLabel,
              adminNotes: `[LEGACY UPDATE ${new Date().toISOString()}] Set to legacy package: ${u.shares} share(s) @ ${LEGACY_EARNING_PER_SHARE} Kobo, ${(LEGACY_OWNERSHIP_PCT * 100).toFixed(5)}% each. Previous: earning=${u.currentEarning}, ownership=${(u.currentOwnership * 100).toFixed(7)}%, label="${u.currentLabel}"`
            }
          }
        );
        
        // Update matching UserShare records
        await UserShare.updateMany(
          { 'transactions.transactionId': u.transactionId },
          {
            $set: {
              'transactions.$.earningKobo': u.proposedEarning,
              'transactions.$.ownershipPct': u.proposedOwnership,
              'transactions.$.packageLabel': u.proposedLabel,
              'transactions.$.tierKey': u.proposedLabel
            }
          }
        );
        
        successCount++;
        process.stdout.write(`\r   ✅ Updated: ${successCount}/${updates.length}`);
      } catch (err) {
        errorCount++;
        console.error(`\n   ❌ Failed: ${u.transactionId} - ${err.message}`);
      }
    }
    
    console.log(`\n`);
    console.log('═'.repeat(80));
    console.log(`✅ UPDATE COMPLETE`);
    console.log(`   Successful: ${successCount}`);
    console.log(`   Failed: ${errorCount}`);
    
    // Save update log
    const logPath = path.join(process.cwd(), 'legacy-update-log.json');
    fs.writeFileSync(logPath, JSON.stringify({
      executedAt: new Date().toISOString(),
      dryRun: false,
      cutoff: LEGACY_CUTOFF,
      totalUpdated: successCount,
      updates: updates.map(u => ({
        transactionId: u.transactionId,
        type: u.type,
        shares: u.shares,
        previous: { earning: u.currentEarning, ownership: u.currentOwnership, label: u.currentLabel },
        new: { earning: u.proposedEarning, ownership: u.proposedOwnership, label: u.proposedLabel }
      }))
    }, null, 2));
    console.log(`\n📄 Update log saved to: ${logPath}`);
  }
  
  if (!dryRun && updates.length === 0) {
    console.log(`\n✅ No updates needed. All pre-Feb 25 transactions already have correct legacy values.`);
  }
  
  console.log('═'.repeat(80) + '\n');
}

// Parse command line arguments
const isDryRun = !process.argv.includes('--apply');
const shouldBackup = process.argv.includes('--backup');

async function backupDatabase() {
  console.log('💾 Creating database backup...');
  const backupPath = path.join(process.cwd(), `backup-${new Date().toISOString().replace(/:/g, '-')}`);
  fs.mkdirSync(backupPath, { recursive: true });
  
  const PaymentTransaction = require('../models/Transaction');
  const UserShare = require('../models/UserShare');
  
  const ptBackup = await PaymentTransaction.find({
    status: 'completed',
    createdAt: { $lt: LEGACY_CUTOFF }
  }).lean();
  
  const usBackup = await UserShare.find({}).lean();
  
  fs.writeFileSync(path.join(backupPath, 'payment-transactions-backup.json'), JSON.stringify(ptBackup, null, 2));
  fs.writeFileSync(path.join(backupPath, 'user-share-backup.json'), JSON.stringify(usBackup, null, 2));
  
  console.log(`✅ Backup saved to: ${backupPath}`);
  return backupPath;
}

async function main() {
  console.log('🔌 Connecting to MongoDB...');
  await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
  console.log('✅ Connected\n');
  
  // Create backup if requested or if in live mode
  if (!isDryRun && shouldBackup) {
    await backupDatabase();
  }
  
  if (!isDryRun && !shouldBackup) {
    console.log('⚠️  Running LIVE update without backup. Consider using --backup flag.\n');
  }
  
  await fixLegacyPackages(isDryRun);
  
  await mongoose.disconnect();
  console.log('🔌 Disconnected from MongoDB');
}

main().catch(err => {
  console.error('❌ Error:', err.message);
  console.error(err.stack);
  process.exit(1);
});