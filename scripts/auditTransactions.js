'use strict';

/**
 * auditTransactions.js  (v4 - WITH FIX CAPABILITIES)
 * 
 * Install Excel support: npm install xlsx
 * Or use CSV fallback automatically
 */

require('dotenv').config();
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

// Try to load Excel support, but don't fail if not available
let XLSX = null;
try {
  XLSX = require('xlsx');
  console.log('✅ Excel support loaded (xlsx)');
} catch (e) {
  console.log('⚠️ Excel support not available. Install with: npm install xlsx');
  console.log('   Falling back to CSV export only\n');
}

// ── Model imports ─────────────────────────────────────────────────────────────
const possibleUserPaths = [
  '../models/User',
  '../models/user',
  '../models/users/User',
];
let User;
for (const p of possibleUserPaths) {
  try { User = require(p); break; } catch (_) { }
}
if (!User) console.warn('⚠️ User model not found');

const PaymentTransaction = require('../models/Transaction');
const UserShare = require('../models/UserShare');

let TierConfig;
try { TierConfig = require('../models/TierConfig'); } catch (_) { }

let ShareModel;
try { ShareModel = require('../models/Share'); } catch (_) { }

// ── CLI args ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const flagVal = (f) => { const i = args.indexOf(f); return i !== -1 ? args[i + 1] : null; };
const hasFlag = (f) => args.includes(f);

const ONLY = flagVal('--only') || null;
const TYPE_FILTER = flagVal('--type') || null;
const STATUSES = ONLY ? [ONLY] : ['completed', 'pending', 'failed'];

// New flags for fixing
const EXPORT_FIX = hasFlag('--export-fix');
const EXPORT_CSV = hasFlag('--export-csv');
const APPLY_FIX = hasFlag('--apply-fix');
const FIX_FILE = flagVal('--apply-fix') || flagVal('--fix-file');
const DRY_RUN = hasFlag('--dry-run');
const FIX_TRANSACTION = flagVal('--fix-transaction');
const SET_FIELDS = [];

// Parse --set key=value pairs
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--set' && args[i + 1]) {
    const pair = args[i + 1];
    const [key, value] = pair.split('=');
    if (key && value !== undefined) {
      let parsedValue = value;
      // Try to parse as number if it looks like one
      if (!isNaN(value) && value.trim() !== '') {
        parsedValue = parseFloat(value);
      }
      SET_FIELDS.push({ key, value: parsedValue });
    }
    i++;
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────
const fmtDate = (d) => d ? new Date(d).toISOString().replace('T', ' ').slice(0, 19) : '—';
const fmtAmt = (n) => (parseFloat(n) || 0).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtPct = (n) => ((parseFloat(n) || 0) * 100).toFixed(7) + '%';
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// CSV escape helper
const csvEscape = (v) => {
  if (v === undefined || v === null) return '';
  const s = String(v).replace(/"/g, '""');
  return /[",\n\r]/.test(s) ? `"${s}"` : s;
};

// ── Amount resolution (same as v3) ──────────────────────────────────────────
const resolveAmount = (raw, tierConfig, legacyShareMap) => {
  let amt = parseFloat(raw.amount ?? raw.totalAmount ?? 0) || 0;
  if (amt > 0) return amt;

  const tierKey = raw.tierKey || raw.packageId || raw.tier || '';
  const shares = parseFloat(raw.shares) || 1;
  const cur = (raw.currency || 'naira').toLowerCase();

  if (tierKey && tierConfig?.tiers) {
    const tier = tierConfig.tiers?.get?.(tierKey);
    if (tier) {
      const price = cur === 'usdt' ? (tier.priceUSD || 0) : (tier.priceNGN || 0);
      if (price > 0) return price * shares;
    }
  }

  if (tierKey && legacyShareMap && legacyShareMap.size > 0) {
    const legacy = legacyShareMap.get(tierKey);
    if (legacy) {
      const price = cur === 'usdt'
        ? (legacy.priceUSDT || legacy.priceUsdt || legacy.priceUsd || legacy.usdtPrice || 0)
        : (legacy.priceNaira || legacy.price || legacy.priceNGN || legacy.nairaPrice || legacy.amount || legacy.cost || 0);
      if (price > 0) return price * shares;
    }
  }

  const pps = parseFloat(raw.pricePerShare) || 0;
  if (pps > 0) return pps * shares;

  return 0;
};

const normalise = (raw, source, userId, userName, userEmail, tierConfig, legacyShareMap) => ({
  source,
  transactionId: raw.transactionId || 'N/A',
  userId: (userId || raw.userId || '').toString(),
  userName: userName || 'Unknown',
  userEmail: userEmail || '',
  type: raw.type || 'share',
  tierKey: raw.tierKey || raw.packageId || '',
  packageLabel: raw.packageLabel || '',
  status: (raw.status || '').toLowerCase(),
  amount: resolveAmount(raw, tierConfig, legacyShareMap),
  currency: (raw.currency || 'naira').toLowerCase(),
  paymentMethod: (raw.paymentMethod || '').replace(/^manual_/, '').replace('admin_override', 'admin'),
  shares: parseFloat(raw.shares) || 1,
  ownershipPct: parseFloat(raw.ownershipPct) || 0,
  earningKobo: parseFloat(raw.earningKobo) || 0,
  hasProof: !!(raw.paymentProofCloudinaryUrl || raw.paymentProofPath || raw.hasProof),
  adminAction: !!(raw.adminAction),
  adminNote: raw.adminNotes || raw.adminNote || '',
  createdAt: fmtDate(raw.createdAt),
  updatedAt: fmtDate(raw.updatedAt || raw.createdAt),
  verifiedAt: fmtDate(raw.verifiedAt || null),
});

// ── Apply fixes to database ─────────────────────────────────────────────────
async function applyFixToTransaction(transactionId, updates, dryRun = false) {
  console.log(`\n📝 ${dryRun ? '[DRY RUN] ' : ''}Fixing transaction: ${transactionId}`);
  
  const results = {
    transactionId,
    paymentTransaction: { found: false, updated: false },
    userShare: { found: false, updated: false },
    errors: []
  };
  
  // Build update object
  const updateFields = {};
  for (const { key, value } of updates) {
    if (key === 'amount') {
      updateFields.amount = value;
      updateFields.totalAmount = value;
    } else if (key === 'ownershipPct') {
      updateFields.ownershipPct = value;
    } else if (key === 'earningKobo') {
      updateFields.earningKobo = value;
    } else if (key === 'shares') {
      updateFields.shares = value;
    } else if (key === 'tierKey') {
      updateFields.tierKey = value;
      updateFields.packageId = value;
    } else if (key === 'packageLabel') {
      updateFields.packageLabel = value;
    } else if (key === 'status') {
      updateFields.status = value;
    } else if (key === 'currency') {
      updateFields.currency = value;
    } else if (key === 'paymentMethod') {
      updateFields.paymentMethod = value;
    } else {
      updateFields[key] = value;
    }
  }
  
  updateFields.adminNotes = `[FIXED ${new Date().toISOString()}] ${updateFields.adminNotes || ''}`;
  
  if (dryRun) {
    console.log(`   Would update:`, JSON.stringify(updateFields, null, 2));
    results.paymentTransaction.found = true;
    results.userShare.found = true;
    return results;
  }
  
  // Update PaymentTransaction
  try {
    const ptResult = await PaymentTransaction.updateOne(
      { transactionId },
      { $set: updateFields }
    );
    results.paymentTransaction.found = ptResult.matchedCount > 0;
    results.paymentTransaction.updated = ptResult.modifiedCount > 0;
    if (results.paymentTransaction.updated) {
      console.log(`   ✅ PaymentTransaction updated`);
    } else if (results.paymentTransaction.found) {
      console.log(`   ⏭️ PaymentTransaction already matches`);
    }
  } catch (err) {
    results.errors.push(`PaymentTransaction: ${err.message}`);
    console.log(`   ❌ PaymentTransaction error: ${err.message}`);
  }
  
  // Update UserShare
  try {
    const userShare = await UserShare.findOne({ 'transactions.transactionId': transactionId });
    if (userShare) {
      results.userShare.found = true;
      
      const txIndex = userShare.transactions.findIndex(t => t.transactionId === transactionId);
      if (txIndex !== -1) {
        let modified = false;
        for (const [key, value] of Object.entries(updateFields)) {
          if (key === 'amount') {
            if (userShare.transactions[txIndex].amount !== value) {
              userShare.transactions[txIndex].amount = value;
              userShare.transactions[txIndex].totalAmount = value;
              modified = true;
            }
          } else if (key === 'totalAmount') {
            if (userShare.transactions[txIndex].totalAmount !== value) {
              userShare.transactions[txIndex].totalAmount = value;
              modified = true;
            }
          } else if (key === 'tierKey') {
            if (userShare.transactions[txIndex].tierKey !== value) {
              userShare.transactions[txIndex].tierKey = value;
              userShare.transactions[txIndex].packageId = value;
              modified = true;
            }
          } else if (key !== 'verifiedBy' && key !== 'verifiedAt' && key !== 'adminNotes') {
            if (userShare.transactions[txIndex][key] !== value) {
              userShare.transactions[txIndex][key] = value;
              modified = true;
            }
          }
        }
        
        if (modified) {
          // Recalculate user totals
          let totalOwnershipPct = 0;
          let totalEarningKobo = 0;
          for (const tx of userShare.transactions) {
            if (tx.status === 'completed') {
              totalOwnershipPct += (tx.ownershipPct || 0);
              totalEarningKobo += (tx.earningKobo || 0);
            }
          }
          userShare.totalOwnershipPct = parseFloat(totalOwnershipPct.toFixed(7));
          userShare.totalEarningKobo = totalEarningKobo;
          
          await userShare.save();
          results.userShare.updated = true;
          console.log(`   ✅ UserShare updated, recalculated totals: ${totalOwnershipPct.toFixed(7)}%`);
        } else {
          console.log(`   ⏭️ UserShare already matches`);
        }
      }
    }
  } catch (err) {
    results.errors.push(`UserShare: ${err.message}`);
    console.log(`   ❌ UserShare error: ${err.message}`);
  }
  
  return results;
}

// ── Export to CSV (always works, no Excel needed) ───────────────────────────
async function exportToCSV(tierConfig, legacyShareMap) {
  console.log('\n📊 Exporting transactions to CSV for editing...');
  
  // Load all data
  const ptDocs = await PaymentTransaction.find({}).populate('userId', 'name email username').lean();
  const usDocs = await UserShare.find({}).populate('user', 'name email username').lean();
  
  // Build records
  const records = [];
  const seenIds = new Set();
  
  // Add PaymentTransaction records
  for (const doc of ptDocs) {
    if (TYPE_FILTER && doc.type !== TYPE_FILTER) continue;
    if (ONLY && doc.status !== ONLY) continue;
    
    const row = normalise(
      doc, 'PaymentTransaction',
      doc.userId?._id || doc.userId,
      doc.userId?.name || 'Unknown',
      doc.userId?.email || '',
      tierConfig, legacyShareMap
    );
    
    seenIds.add(row.transactionId);
    records.push({
      ACTION: 'KEEP',
      transactionId: row.transactionId,
      source: row.source,
      userEmail: row.userEmail,
      userName: row.userName,
      type: row.type,
      tierKey: row.tierKey,
      packageLabel: row.packageLabel,
      status: row.status,
      amount: row.amount,
      currency: row.currency,
      paymentMethod: row.paymentMethod,
      shares: row.shares,
      ownershipPct: row.ownershipPct,
      earningKobo: row.earningKobo,
      createdAt: row.createdAt,
      adminNote: row.adminNote,
    });
  }
  
  // Add UserShare-only records
  for (const doc of usDocs) {
    for (const tx of doc.transactions || []) {
      if (TYPE_FILTER && tx.type !== TYPE_FILTER) continue;
      if (ONLY && tx.status !== ONLY) continue;
      if (seenIds.has(tx.transactionId)) continue;
      
      const enrichedTx = {
        ...tx,
        currency: tx.currency || doc.currency || 'naira',
        amount: parseFloat(tx.amount ?? tx.totalAmount ?? 0) || 0,
      };
      
      const row = normalise(
        enrichedTx, 'UserShare-Only',
        doc.user?._id || doc.user,
        doc.user?.name || 'Unknown',
        doc.user?.email || '',
        tierConfig, legacyShareMap
      );
      
      records.push({
        ACTION: 'CREATE',
        transactionId: row.transactionId,
        source: row.source,
        userEmail: row.userEmail,
        userName: row.userName,
        type: row.type,
        tierKey: row.tierKey,
        packageLabel: row.packageLabel,
        status: row.status,
        amount: row.amount,
        currency: row.currency,
        paymentMethod: row.paymentMethod,
        shares: row.shares,
        ownershipPct: row.ownershipPct,
        earningKobo: row.earningKobo,
        createdAt: row.createdAt,
        adminNote: row.adminNote,
      });
    }
  }
  
  // Write CSV
  const headers = Object.keys(records[0] || {});
  const csvRows = [headers.map(h => csvEscape(h)).join(',')];
  
  for (const record of records) {
    const row = headers.map(h => csvEscape(record[h] || '')).join(',');
    csvRows.push(row);
  }
  
  const filename = `audit-export-${Date.now()}.csv`;
  fs.writeFileSync(filename, csvRows.join('\n'));
  
  console.log(`✅ Exported to ${filename}`);
  console.log(`📊 Total records: ${records.length}`);
  console.log(`\n📝 Edit the CSV file, then run:`);
  console.log(`   node auditTransactions.js --apply-fix ${filename}`);
  
  // Also create instructions file
  const instructions = `# HOW TO USE THIS CSV FILE

## ACTION column options:
- KEEP    - Do nothing (default)
- UPDATE  - Update this transaction (edit the values in this row)
- DELETE  - Remove this transaction from both sources
- CREATE  - Create new PaymentTransaction from this UserShare record

## For UPDATE:
1. Change ACTION column to "UPDATE"
2. Edit any values in this row to the correct values
3. Save the file
4. Run: node auditTransactions.js --apply-fix ${filename}

## Important Notes:
- Do NOT change the transactionId
- amount is in Naira or USDT (depending on currency)
- ownershipPct is a decimal (e.g., 0.0012345 = 0.12345%)
- earningKobo is in kobo (₦1 = 100 kobo)
- status can be: completed, pending, failed

## Quick reference for tier prices:
`;
  
  // Add tier info to instructions
  if (tierConfig?.tiers) {
    for (const [key, tier] of tierConfig.tiers) {
      instructions.push(`\n${key}: ${tier.name} - ₦${tier.priceNGN} / $${tier.priceUSD} - ${(tier.percentPerShare * 100).toFixed(4)}% per share`);
    }
  }
  
  fs.writeFileSync(filename.replace('.csv', '-instructions.txt'), instructions);
  console.log(`📝 Instructions saved to ${filename.replace('.csv', '-instructions.txt')}`);
  
  return filename;
}

// ── Export to Excel (if available) ───────────────────────────────────────────
async function exportToExcel(tierConfig, legacyShareMap) {
  if (!XLSX) {
    console.log('⚠️ Excel not available, falling back to CSV export...');
    return await exportToCSV(tierConfig, legacyShareMap);
  }
  
  console.log('\n📊 Exporting transactions to Excel for editing...');
  
  // Load all data
  const ptDocs = await PaymentTransaction.find({}).populate('userId', 'name email username').lean();
  const usDocs = await UserShare.find({}).populate('user', 'name email username').lean();
  
  // Build records
  const records = [];
  const seenIds = new Set();
  
  // Add PaymentTransaction records
  for (const doc of ptDocs) {
    if (TYPE_FILTER && doc.type !== TYPE_FILTER) continue;
    if (ONLY && doc.status !== ONLY) continue;
    
    const row = normalise(
      doc, 'PaymentTransaction',
      doc.userId?._id || doc.userId,
      doc.userId?.name || 'Unknown',
      doc.userId?.email || '',
      tierConfig, legacyShareMap
    );
    
    seenIds.add(row.transactionId);
    records.push({
      ACTION: 'KEEP',
      transactionId: row.transactionId,
      source: row.source,
      userEmail: row.userEmail,
      userName: row.userName,
      current_type: row.type,
      current_tierKey: row.tierKey,
      current_packageLabel: row.packageLabel,
      current_status: row.status,
      current_amount: row.amount,
      current_currency: row.currency,
      current_paymentMethod: row.paymentMethod,
      current_shares: row.shares,
      current_ownershipPct: row.ownershipPct,
      current_earningKobo: row.earningKobo,
      current_createdAt: row.createdAt,
      FIX_type: row.type,
      FIX_tierKey: row.tierKey,
      FIX_packageLabel: row.packageLabel,
      FIX_status: row.status,
      FIX_amount: row.amount,
      FIX_currency: row.currency,
      FIX_paymentMethod: row.paymentMethod,
      FIX_shares: row.shares,
      FIX_ownershipPct: row.ownershipPct,
      FIX_earningKobo: row.earningKobo,
      note: '',
    });
  }
  
  // Add UserShare-only records
  for (const doc of usDocs) {
    for (const tx of doc.transactions || []) {
      if (TYPE_FILTER && tx.type !== TYPE_FILTER) continue;
      if (ONLY && tx.status !== ONLY) continue;
      if (seenIds.has(tx.transactionId)) continue;
      
      const enrichedTx = {
        ...tx,
        currency: tx.currency || doc.currency || 'naira',
        amount: parseFloat(tx.amount ?? tx.totalAmount ?? 0) || 0,
      };
      
      const row = normalise(
        enrichedTx, 'UserShare-Only',
        doc.user?._id || doc.user,
        doc.user?.name || 'Unknown',
        doc.user?.email || '',
        tierConfig, legacyShareMap
      );
      
      records.push({
        ACTION: 'CREATE',
        transactionId: row.transactionId,
        source: row.source,
        userEmail: row.userEmail,
        userName: row.userName,
        current_type: row.type,
        current_tierKey: row.tierKey,
        current_packageLabel: row.packageLabel,
        current_status: row.status,
        current_amount: row.amount,
        current_currency: row.currency,
        current_paymentMethod: row.paymentMethod,
        current_shares: row.shares,
        current_ownershipPct: row.ownershipPct,
        current_earningKobo: row.earningKobo,
        current_createdAt: row.createdAt,
        FIX_type: row.type,
        FIX_tierKey: row.tierKey,
        FIX_packageLabel: row.packageLabel,
        FIX_status: row.status,
        FIX_amount: row.amount,
        FIX_currency: row.currency,
        FIX_paymentMethod: row.paymentMethod,
        FIX_shares: row.shares,
        FIX_ownershipPct: row.ownershipPct,
        FIX_earningKobo: row.earningKobo,
        note: 'Only in UserShare',
      });
    }
  }
  
  // Create workbook
  const wb = XLSX.utils.book_new();
  
  // Transactions sheet
  const ws = XLSX.utils.json_to_sheet(records);
  XLSX.utils.book_append_sheet(wb, ws, 'Transactions');
  
  // Instructions sheet
  const instructions = [
    ['=== INSTRUCTIONS ==='],
    [''],
    ['ACTION column options:'],
    ['  KEEP    - Do nothing (default)'],
    ['  UPDATE  - Update this transaction with your FIX_* values'],
    ['  DELETE  - Remove this transaction from both sources'],
    ['  CREATE  - Create new PaymentTransaction from this UserShare record'],
    [''],
    ['For UPDATE: Edit any FIX_* column'],
    ['For CREATE: Edit FIX_* columns to set values for new PaymentTransaction'],
    [''],
    ['Important:'],
    ['1. Do NOT change transactionId'],
    ['2. amount is in Naira or USDT'],
    ['3. ownershipPct is a decimal (e.g., 0.0012345)'],
    ['4. earningKobo is in kobo (₦1 = 100 kobo)'],
  ];
  const wsInstr = XLSX.utils.aoa_to_sheet(instructions);
  XLSX.utils.book_append_sheet(wb, wsInstr, 'Instructions');
  
  // Tier reference sheet
  const tierRef = [['Tier Key', 'Name', 'Price NGN', 'Price USDT', '% per Share', 'Earning per Phone (kobo)']];
  if (tierConfig?.tiers) {
    for (const [key, tier] of tierConfig.tiers) {
      tierRef.push([key, tier.name, tier.priceNGN, tier.priceUSD, tier.percentPerShare, tier.earningPerPhone]);
    }
  }
  const wsRef = XLSX.utils.aoa_to_sheet(tierRef);
  XLSX.utils.book_append_sheet(wb, wsRef, 'Tier Reference');
  
  const filename = `audit-fixable-${Date.now()}.xlsx`;
  XLSX.writeFile(wb, filename);
  console.log(`✅ Exported to ${filename}`);
  console.log(`📊 Total records: ${records.length}`);
  console.log(`\n📝 Edit the file, then run:`);
  console.log(`   node auditTransactions.js --apply-fix ${filename}`);
  
  return filename;
}

// ── Apply fixes from CSV/Excel file ─────────────────────────────────────────
async function applyFixesFromFile(filename, dryRun = false) {
  console.log(`\n📥 Loading fixes from ${filename}...`);
  
  let records = [];
  const ext = path.extname(filename).toLowerCase();
  
  if (ext === '.csv') {
    // Parse CSV
    const content = fs.readFileSync(filename, 'utf8');
    const lines = content.split('\n').filter(l => l.trim());
    const headers = lines[0].split(',').map(h => h.replace(/^"|"$/g, '').trim());
    
    for (let i = 1; i < lines.length; i++) {
      const values = [];
      let inQuote = false;
      let current = '';
      
      for (let j = 0; j < lines[i].length; j++) {
        const char = lines[i][j];
        if (char === '"') {
          inQuote = !inQuote;
        } else if (char === ',' && !inQuote) {
          values.push(current.replace(/^"|"$/g, ''));
          current = '';
        } else {
          current += char;
        }
      }
      values.push(current.replace(/^"|"$/g, ''));
      
      const record = {};
      headers.forEach((h, idx) => { record[h] = values[idx]; });
      records.push(record);
    }
  } else if (ext === '.xlsx') {
    if (!XLSX) {
      console.error('❌ Excel support not available. Please install xlsx or use CSV export.');
      process.exit(1);
    }
    const workbook = XLSX.readFile(filename);
    const sheet = workbook.Sheets['Transactions'];
    records = XLSX.utils.sheet_to_json(sheet);
  } else {
    console.error(`❌ Unsupported file type: ${ext}. Use .csv or .xlsx`);
    process.exit(1);
  }
  
  const results = {
    updated: [],
    deleted: [],
    created: [],
    errors: [],
    dryRun
  };
  
  for (const record of records) {
    const action = record.ACTION || 'KEEP';
    const txId = record.transactionId;
    
    if (!txId || txId === 'N/A') {
      results.errors.push(`Skipped: missing transactionId`);
      continue;
    }
    
    if (action === 'UPDATE') {
      // Build updates from FIX_* fields
      const updates = [];
      for (const [key, value] of Object.entries(record)) {
        if (key.startsWith('FIX_') && value !== undefined && value !== '' && value !== 'null') {
          const fieldName = key.substring(4);
          const currentKey = `current_${fieldName}`;
          const currentValue = record[currentKey];
          
          let parsedValue = value;
          if (!isNaN(value) && value.trim() !== '') {
            parsedValue = parseFloat(value);
          }
          
          if (String(parsedValue) !== String(currentValue)) {
            updates.push({ key: fieldName, value: parsedValue });
          }
        }
      }
      
      if (updates.length > 0) {
        console.log(`\n📝 ${txId}: ${updates.length} change(s)`);
        const result = await applyFixToTransaction(txId, updates, dryRun);
        if (result.paymentTransaction.updated || result.userShare.updated) {
          results.updated.push({ txId, updates });
        }
        if (result.errors.length) {
          results.errors.push(...result.errors);
        }
      }
    } else if (action === 'DELETE') {
      if (!dryRun) {
        await PaymentTransaction.deleteOne({ transactionId: txId });
        await UserShare.updateOne(
          { 'transactions.transactionId': txId },
          { $pull: { transactions: { transactionId: txId } } }
        );
        console.log(`   🗑️ Deleted: ${txId}`);
      } else {
        console.log(`   🗑️ Would delete: ${txId}`);
      }
      results.deleted.push(txId);
    } else if (action === 'CREATE') {
      if (!dryRun) {
        const user = await User.findOne({ email: record.userEmail });
        if (user) {
          const newTx = {
            transactionId: txId,
            userId: user._id,
            type: record.FIX_type || record.current_type,
            tierKey: record.FIX_tierKey || record.current_tierKey,
            packageLabel: record.FIX_packageLabel || record.current_packageLabel,
            status: record.FIX_status || record.current_status || 'completed',
            amount: parseFloat(record.FIX_amount || record.current_amount || 0),
            currency: record.FIX_currency || record.current_currency || 'naira',
            paymentMethod: record.FIX_paymentMethod || record.current_paymentMethod || 'manual',
            shares: parseFloat(record.FIX_shares || record.current_shares || 1),
            ownershipPct: parseFloat(record.FIX_ownershipPct || record.current_ownershipPct || 0),
            earningKobo: parseFloat(record.FIX_earningKobo || record.current_earningKobo || 0),
            adminNotes: `Created from audit fix`,
            verifiedBy: 'system-audit',
            verifiedAt: new Date(),
          };
          await PaymentTransaction.create(newTx);
          console.log(`   ✨ Created PaymentTransaction: ${txId}`);
          results.created.push(txId);
        } else {
          results.errors.push(`User not found for ${txId}: ${record.userEmail}`);
        }
      } else {
        console.log(`   ✨ Would create: ${txId}`);
        results.created.push(txId);
      }
    }
  }
  
  // Summary
  console.log('\n' + '═'.repeat(50));
  console.log(`📊 FIX SUMMARY ${dryRun ? '(DRY RUN - no changes made)' : ''}`);
  console.log('═'.repeat(50));
  console.log(`   ✅ Updated: ${results.updated.length}`);
  console.log(`   🗑️ Deleted: ${results.deleted.length}`);
  console.log(`   ✨ Created: ${results.created.length}`);
  console.log(`   ❌ Errors: ${results.errors.length}`);
  
  if (results.errors.length > 0) {
    console.log('\nErrors:');
    results.errors.forEach(e => console.log(`   - ${e}`));
  }
  
  return results;
}

// ── Fix single transaction via CLI ─────────────────────────────────────────
async function fixSingleTransaction(txId, updates) {
  console.log(`\n🔧 Fixing transaction: ${txId}`);
  console.log(`   Updates:`, updates);
  
  if (DRY_RUN) {
    console.log(`   [DRY RUN] Would apply these changes`);
    return;
  }
  
  const result = await applyFixToTransaction(txId, updates, false);
  
  if (result.paymentTransaction.updated || result.userShare.updated) {
    console.log(`\n✅ Transaction ${txId} fixed successfully`);
  } else {
    console.log(`\n⚠️ No changes made to ${txId}`);
  }
}

// ── Build report (same as v3) ───────────────────────────────────────────────
function buildReport(ptRows, usRows, statusFilter) {
  const allIds = new Set([
    ...Object.keys(ptRows).filter(id => !statusFilter || ptRows[id].status === statusFilter),
    ...Object.keys(usRows).filter(id => !statusFilter || usRows[id].status === statusFilter),
  ]);

  const report = { summary: {}, inBothSources: [], ptOnly: [], usOnly: [], discrepancies: [], completeness: [] };

  for (const txId of allIds) {
    const ptRow = ptRows[txId];
    const usRow = usRows[txId];
    const ptOk = ptRow && (!statusFilter || ptRow.status === statusFilter);
    const usOk = usRow && (!statusFilter || usRow.status === statusFilter);

    if (ptOk && usOk) {
      const issues = diff(ptRow, usRow);
      const entry = { transactionId: txId, ptRow, usRow, discrepancies: issues, isUniform: issues.length === 0 };
      report.inBothSources.push(entry);
      if (issues.length) report.discrepancies.push(entry);
    } else if (ptOk) {
      report.ptOnly.push({ ...ptRow, isUniform: null, discrepancyFields: 'PT only' });
    } else if (usOk) {
      report.usOnly.push({ ...usRow, isUniform: null, discrepancyFields: 'US only' });
    }
  }

  report.summary = {
    totalUniqueTransactions: report.inBothSources.length + report.ptOnly.length + report.usOnly.length,
    inBothSources: report.inBothSources.length,
    uniform: report.inBothSources.filter(r => r.isUniform).length,
    withDiscrepancies: report.discrepancies.length,
    ptOnly: report.ptOnly.length,
    usOnly: report.usOnly.length,
  };
  return report;
}

// ── Diff function ───────────────────────────────────────────────────────────
const COMPARABLE = ['type', 'tierKey', 'packageLabel', 'status', 'amount', 'currency', 'paymentMethod', 'shares', 'ownershipPct', 'earningKobo'];

const diff = (a, b) => {
  const issues = [];
  for (const f of COMPARABLE) {
    const va = a[f], vb = b[f];
    if (typeof va === 'number' && typeof vb === 'number') {
      if (Math.abs(va - vb) > 0.01) issues.push({ field: f, ptVal: va, usVal: vb });
    } else if (String(va ?? '').toLowerCase() !== String(vb ?? '').toLowerCase()) {
      issues.push({ field: f, ptVal: va, usVal: vb });
    }
  }
  return issues;
};

// ── Write report (simplified for v4) ────────────────────────────────────────
function writeReport(report, statusLabel, generated, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  
  // Simple CSV output for now (full HTML same as v3)
  const csvRows = [
    ...report.ptOnly,
    ...report.usOnly,
    ...report.inBothSources.flatMap(e => [
      { ...e.ptRow, isUniform: e.isUniform, discrepancyFields: e.discrepancies.map(d => d.field).join(';') },
      { ...e.usRow, isUniform: e.isUniform, discrepancyFields: e.discrepancies.map(d => d.field).join(';') },
    ]),
  ];
  
  const fields = ['source', 'transactionId', 'userName', 'userEmail', 'type', 'tierKey', 'packageLabel', 'status', 'amount', 'currency', 'paymentMethod', 'shares', 'ownershipPct', 'earningKobo', 'createdAt'];
  const csv = [fields.join(','), ...csvRows.map(r => fields.map(f => csvEscape(r[f] ?? '')).join(','))].join('\n');
  
  const slug = `audit-${statusLabel}`;
  fs.writeFileSync(path.join(outDir, `${slug}.csv`), csv, 'utf8');
  
  const s = report.summary;
  console.log(`  ✅ [${statusLabel.toUpperCase()}] total=${s.totalUniqueTransactions} both=${s.inBothSources} uniform=${s.uniform} mismatch=${s.withDiscrepancies} pt-only=${s.ptOnly} us-only=${s.usOnly}`);
}

// ── Main function ──────────────────────────────────────────────────────────
async function main() {
  console.log('🔌 Connecting to MongoDB...');
  await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
  console.log('✅ Connected\n');
  
  // Load configurations
  let tierConfig = null;
  if (TierConfig) {
    try {
      tierConfig = typeof TierConfig.getCurrentConfig === 'function'
        ? await TierConfig.getCurrentConfig()
        : await TierConfig.findOne().lean();
      console.log(`📦 TierConfig loaded — ${tierConfig?.tiers?.size ?? 0} tiers`);
    } catch (err) {
      console.warn('⚠️ TierConfig load failed:', err.message);
    }
  }
  
  const legacyShareMap = new Map();
  if (ShareModel) {
    try {
      const shareDocs = await ShareModel.find({}).lean();
      for (const doc of shareDocs) {
        legacyShareMap.set(doc._id.toString(), doc);
      }
      console.log(`📦 Legacy Share model loaded — ${legacyShareMap.size} records`);
    } catch (err) {
      console.warn('⚠️ Legacy Share model load failed:', err.message);
    }
  }
  
  // Handle fix operations
  if (FIX_TRANSACTION) {
    await fixSingleTransaction(FIX_TRANSACTION, SET_FIELDS);
    await mongoose.disconnect();
    return;
  }
  
  if (EXPORT_FIX) {
    await exportToExcel(tierConfig, legacyShareMap);
    await mongoose.disconnect();
    return;
  }
  
  if (EXPORT_CSV) {
    await exportToCSV(tierConfig, legacyShareMap);
    await mongoose.disconnect();
    return;
  }
  
  if (APPLY_FIX && FIX_FILE) {
    await applyFixesFromFile(FIX_FILE, DRY_RUN);
    await mongoose.disconnect();
    return;
  }
  
  // Normal audit mode
  console.log('📥 Loading PaymentTransaction...');
  const ptQuery = {};
  if (TYPE_FILTER) ptQuery.type = TYPE_FILTER;
  
  let ptDocs;
  try {
    ptDocs = await PaymentTransaction.find(ptQuery).populate('userId', 'name email username').lean();
  } catch (err) {
    ptDocs = await PaymentTransaction.find(ptQuery).lean();
  }
  console.log(`    ${ptDocs.length} records`);
  
  console.log('📥 Loading UserShare...');
  let usDocs;
  try {
    usDocs = await UserShare.find({}).populate('user', 'name email username').lean();
  } catch (err) {
    usDocs = await UserShare.find({}).lean();
  }
  console.log(`    ${usDocs.length} user documents\n`);
  
  // Normalise data
  const ptRows = {};
  for (const doc of ptDocs) {
    const row = normalise(doc, 'PaymentTransaction', doc.userId?._id || doc.userId, doc.userId?.name || 'Unknown', doc.userId?.email || '', tierConfig, legacyShareMap);
    ptRows[row.transactionId] = row;
  }
  
  const usRows = {};
  for (const doc of usDocs) {
    for (const tx of doc.transactions || []) {
      if (TYPE_FILTER && tx.type !== TYPE_FILTER) continue;
      const enrichedTx = { ...tx, currency: tx.currency || doc.currency || 'naira', amount: parseFloat(tx.amount ?? tx.totalAmount ?? 0) || 0 };
      const row = normalise(enrichedTx, 'UserShare', doc.user?._id || doc.user, doc.user?.name || 'Unknown', doc.user?.email || '', tierConfig, legacyShareMap);
      usRows[row.transactionId] = row;
    }
  }
  
  const generated = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  const outBase = path.join(process.cwd(), 'audit-output');
  
  console.log('📊 Building reports...\n');
  
  for (const status of STATUSES) {
    const report = buildReport(ptRows, usRows, status);
    writeReport(report, status, generated, path.join(outBase, `audit-${status}`));
  }
  
  if (!ONLY) {
    const all = buildReport(ptRows, usRows, null);
    writeReport(all, 'all', generated, path.join(outBase, 'audit-all'));
  }
  
  console.log('\n✅ Done. Output folder:', outBase);
  console.log('\n💡 To fix discrepancies:');
  console.log('   1. Export: node auditTransactions.js --export-csv');
  console.log('   2. Edit the CSV file (change ACTION to UPDATE and fix values)');
  console.log('   3. Apply: node auditTransactions.js --apply-fix your-file.csv --dry-run');
  console.log('   4. Apply for real: node auditTransactions.js --apply-fix your-file.csv');
  
  await mongoose.disconnect();
}

// Run it
main().catch(err => {
  console.error('❌ Error:', err.message);
  console.error(err.stack);
  mongoose.disconnect();
  process.exit(1);
});