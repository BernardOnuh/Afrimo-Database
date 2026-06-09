'use strict';

/**
 * registerMatchedTransactions.js  (v4 — Tier-based ownership & earning)
 * ─────────────────────────────────────────────────────────────────────────────
 * Registers transactions that exist in BOTH PaymentTransaction (PT) and
 * UserShare (US), within the date range and amount cap.
 *
 * Source-of-truth rules:
 *   ✅ UNIFORM   (PT = US) → use PT values
 *   ⚠️  MISMATCH (PT ≠ US) → use US values as source of truth
 *
 * Share Tier pricing (ownershipPct & earningKobo assigned by amount):
 *   Basic    ₦0      – ₦30,000  → 0.00001%  | 6 kobo
 *   Standard ₦31,000 – ₦50,000  → 0.000021% | 14 kobo
 *   Premium  ₦51,000 – ₦100,000 → 0.00005%  | 30 kobo
 *
 * Hard filters (all must pass):
 *   • Exists in BOTH PT and UserShare
 *   • status = "completed" in both
 *   • createdAt between 2025-01-01 and 2026-02-28
 *   • Normalized amount ₦0 – ₦100,000
 *   • Not already in TransactionV2
 *   • userId resolves to a real user
 *
 * Flags:
 *   --mismatches-only   Register only PT≠US transactions (skip uniform)
 *
 * Usage:
 *   node scripts/registerMatchedTransactions.js --token eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY3NDVmNzUyY2U1MmRkNjNjMDc1ODM3MCIsImlhdCI6MTc4MDg4MTI1NSwiZXhwIjoxNzgxNDg2MDU1fQ.HF4ZuDUxb_NNnGHUBqLZYKKxCvp1BUOcTqfsdQfOQxg --api-url http://localhost:5001
 *   node scripts/registerMatchedTransactions.js --token <jwt> --api-url http://localhost:5001 --mismatches-only
 * ─────────────────────────────────────────────────────────────────────────────
 */

require('dotenv').config();
const mongoose = require('mongoose');
const axios    = require('axios');
const fs       = require('fs');
const path     = require('path');

const PaymentTransaction = require('../models/Transaction');
const TransactionV2      = require('../models/TransactionV2');
const UserShare          = require('../models/UserShare');
const User               = require('../models/User');

// ── CLI args ──────────────────────────────────────────────────────────────────
const args    = process.argv.slice(2);
const flagVal = (f) => { const i = args.indexOf(f); return i !== -1 ? args[i + 1] : null; };

const ADMIN_TOKEN     = flagVal('--token') || process.env.ADMIN_TOKEN;
const API_URL         = flagVal('--api-url') || process.env.API_URL || 'http://localhost:5000';
const MISMATCHES_ONLY = args.includes('--mismatches-only');

if (!ADMIN_TOKEN) {
  console.error('❌  Admin JWT token required.');
  console.error('    Usage: node scripts/registerMatchedTransactions.js --token <jwt> --api-url <url> [--mismatches-only]');
  process.exit(1);
}

// ── Hard filters ──────────────────────────────────────────────────────────────
const DATE_START = new Date('2026-03-01T00:00:00.000Z');
const DATE_END   = new Date(); // today
const MIN_AMOUNT = 0;
const MAX_AMOUNT = 100000;

// ── Share Tiers ───────────────────────────────────────────────────────────────
//   Ownership % stored as a decimal fraction (e.g. 0.00001 = 0.001%)
//   Earning stored in kobo (integer)
const SHARE_TIERS = [
  { label: 'Basic',    minAmount: 0,      maxAmount: 30000,  ownershipPct: 0.00001,  earningKobo: 6  },
  { label: 'Standard', minAmount: 31000,  maxAmount: 50000,  ownershipPct: 0.000021, earningKobo: 14 },
  { label: 'Premium',  minAmount: 51000,  maxAmount: 100000, ownershipPct: 0.00005,  earningKobo: 30 },
];

/**
 * Returns the tier for a given normalized amount.
 * Returns null if amount is outside all tiers (shouldn't happen given MAX_AMOUNT filter).
 */
const getTier = (normalizedAmount) => {
  return SHARE_TIERS.find(t => normalizedAmount >= t.minAmount && normalizedAmount <= t.maxAmount) || null;
};

// ── Fields compared between PT and US ────────────────────────────────────────
const COMPARABLE = [
  'type', 'tierKey', 'packageLabel', 'status',
  'amount', 'currency', 'paymentMethod',
  'shares', 'ownershipPct', 'earningKobo',
];

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Normalizes truncated amounts.
 * Values stored without trailing zeros (e.g. 25, 75, 50, 100) get × 1000.
 * 25 → 25,000 | 75 → 75,000 | 100 → 100,000
 * Anything already ≥ 1,000 passes through unchanged.
 */
const normalizeAmount = (amt) => {
  const num = parseFloat(amt) || 0;
  if (num <= 0) return 0;
  if (num < 1000) {
    const normalized = num * 1000;
    console.log(`    ⚙️   Amount normalized: ${num} → ₦${normalized.toLocaleString()}`);
    return normalized;
  }
  return num;
};

const normaliseRow = (raw, source, userId) => {
  const amt = parseFloat(raw.amount ?? raw.totalAmount ?? 0) || 0;
  return {
    source,
    transactionId : raw.transactionId || 'N/A',
    userId        : (userId || raw.userId || '').toString(),
    type          : raw.type || 'share',
    tierKey       : raw.tierKey || raw.packageId || '',
    packageLabel  : raw.packageLabel || '',
    status        : (raw.status || '').toLowerCase(),
    amount        : amt,
    currency      : (raw.currency || 'naira').toLowerCase(),
    paymentMethod : (raw.paymentMethod || '').replace(/^manual_/, '').replace('admin_override', 'admin'),
    shares        : parseFloat(raw.shares) || 1,
    ownershipPct  : parseFloat(raw.ownershipPct) || 0,
    earningKobo   : parseFloat(raw.earningKobo)  || 0,
  };
};

// Returns array of mismatched field names (empty = uniform)
const getDiff = (ptRow, usRow) => {
  const issues = [];
  for (const f of COMPARABLE) {
    const va = ptRow[f], vb = usRow[f];
    if (typeof va === 'number' && typeof vb === 'number') {
      if (Math.abs(va - vb) > 0.01) issues.push(f);
    } else if (String(va ?? '').toLowerCase() !== String(vb ?? '').toLowerCase()) {
      issues.push(f);
    }
  }
  return issues;
};

const inDateRange = (doc) => {
  const d = new Date(doc.createdAt);
  return d >= DATE_START && d <= DATE_END;
};

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  try {
    console.log('\n📐  SHARE TIER RULES:');
    SHARE_TIERS.forEach(t =>
      console.log(`    ${t.label.padEnd(10)} ₦${t.minAmount.toLocaleString().padStart(7)} – ₦${t.maxAmount.toLocaleString().padStart(7)}  |  ${String(t.ownershipPct).padEnd(10)}  |  ${t.earningKobo} kobo`)
    );
    if (MISMATCHES_ONLY) console.log('\n🎯  Mode: MISMATCHES ONLY\n');

    console.log('\n🔌  Connecting to MongoDB…');
    await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
    console.log('✅  Connected\n');

    // ── Load PaymentTransaction (completed only) ───────────────────────────
    console.log('📥  Loading PaymentTransaction (status=completed)…');
    let ptDocs;
    try {
      ptDocs = await PaymentTransaction.find({ status: 'completed' })
        .populate('userId', 'name email')
        .lean();
    } catch {
      ptDocs = await PaymentTransaction.find({ status: 'completed' }).lean();
    }
    console.log(`    ${ptDocs.length} records loaded`);

    // Build PT map keyed by transactionId
    const ptMap = {};
    for (const doc of ptDocs) {
      if (!doc.transactionId) continue;
      ptMap[doc.transactionId] = {
        doc,
        row: normaliseRow(doc, 'PaymentTransaction', doc.userId?._id || doc.userId),
      };
    }

    // ── Load UserShare (completed transactions only) ───────────────────────
    console.log('📥  Loading UserShare…');
    let usDocs;
    try {
      usDocs = await UserShare.find({}).populate('user', 'name email').lean();
    } catch {
      usDocs = await UserShare.find({}).lean();
    }
    console.log(`    ${usDocs.length} UserShare documents loaded`);

    // Build US map keyed by transactionId
    const usMap = {};
    for (const doc of usDocs) {
      for (const tx of (doc.transactions || [])) {
        if (!tx.transactionId) continue;
        if ((tx.status || '').toLowerCase() !== 'completed') continue;
        usMap[tx.transactionId] = {
          doc,
          tx,
          row: normaliseRow(tx, 'UserShare', doc.user?._id || doc.user || doc.userId),
        };
      }
    }
    console.log(`    ${Object.keys(usMap).length} completed UserShare transactions indexed\n`);

    // ── Load existing TransactionV2 to skip duplicates ─────────────────────
    console.log('📥  Checking existing TransactionV2 records…');
    const existingV2  = await TransactionV2.find({}, { transactionId: 1 }).lean();
    const existingIds = new Set(existingV2.map(t => t.transactionId));
    console.log(`    ${existingIds.size} already registered\n`);

    // ── Filter & classify ──────────────────────────────────────────────────
    console.log('🔍  Applying filters:');
    console.log(`    📅  Date     : ${DATE_START.toISOString().slice(0,10)} → ${DATE_END.toISOString().slice(0,10)}`);
    console.log(`    💰  Amount   : ₦${MIN_AMOUNT.toLocaleString()} – ₦${MAX_AMOUNT.toLocaleString()}`);
    console.log(`    🔗  Eligible : Must exist in BOTH PT and UserShare`);
    if (MISMATCHES_ONLY) {
      console.log(`    🎯  Mode     : MISMATCHES ONLY — uniform transactions will be skipped`);
      console.log(`    ⚠️   Mismatch : Will register using US values + tier-based ownership/earning\n`);
    } else {
      console.log(`    ✅  Uniform  : Will register using PT values + tier-based ownership/earning`);
      console.log(`    ⚠️   Mismatch : Will register using US values + tier-based ownership/earning\n`);
    }

    const toRegister = [];
    const skippedLog = { duplicate: 0, outOfDate: 0, amountExceeded: 0, ptOnly: 0, badUserId: 0, noTier: 0 };

    for (const txId of Object.keys(ptMap)) {
      const { doc: ptDoc, row: ptRow } = ptMap[txId];

      // ── Skip if already in TransactionV2
      if (existingIds.has(txId)) { skippedLog.duplicate++; continue; }

      // ── Must exist in UserShare
      if (!usMap[txId]) { skippedLog.ptOnly++; continue; }

      const { doc: usDoc, tx: usTx, row: usRow } = usMap[txId];

      // ── US must also be completed
      if (usRow.status !== 'completed') { skippedLog.ptOnly++; continue; }

      // ── Date range — use PT createdAt as the date anchor
      if (!inDateRange(ptDoc)) { skippedLog.outOfDate++; continue; }

      // ── Amount — prefer US raw amount as source of truth, fall back to PT
      const rawAmount        = usRow.amount || ptDoc.amount || ptDoc.totalAmount;
      const normalizedAmount = normalizeAmount(rawAmount);
      if (normalizedAmount < MIN_AMOUNT || normalizedAmount > MAX_AMOUNT) {
        skippedLog.amountExceeded++; continue;
      }

      // ── Resolve the share tier based on normalized amount
      const tier = getTier(normalizedAmount);
      if (!tier) { skippedLog.noTier++; continue; }

      // ── userId — prefer PT (has populated User doc), fall back to US
      const resolvedUserId = ptDoc.userId?._id || ptDoc.userId
                          || usDoc.user?._id   || usDoc.user;
      if (!resolvedUserId || resolvedUserId.toString() === '[object Object]') {
        skippedLog.badUserId++; continue;
      }

      // ── Classify: uniform or mismatch
      const discrepancies = getDiff(ptRow, usRow);
      const isUniform     = discrepancies.length === 0;

      // ── Skip uniform transactions if --mismatches-only flag is set
      if (MISMATCHES_ONLY && isUniform) { skippedLog.duplicate++; continue; }

      toRegister.push({
        ptDoc, ptRow,
        usDoc, usTx, usRow,
        normalizedAmount,
        resolvedUserId,
        tier,
        isUniform,
        discrepancies,
      });
    }

    const uniformCount  = toRegister.filter(r => r.isUniform).length;
    const mismatchCount = toRegister.filter(r => !r.isUniform).length;

    console.log('📊  Filter results:');
    console.log(`    ✅  Uniform  (PT = US)    : ${uniformCount}   → using PT values + tier`);
    console.log(`    ⚠️   Mismatch (PT ≠ US)    : ${mismatchCount}  → using US values + tier`);
    console.log(`    📦  Total to register     : ${toRegister.length}`);
    console.log(`    ⏭️   Already in V2         : ${skippedLog.duplicate}`);
    console.log(`    📅  Out of date range     : ${skippedLog.outOfDate}`);
    console.log(`    💰  Amount exceeded       : ${skippedLog.amountExceeded}`);
    console.log(`    🔗  PT only (no US match) : ${skippedLog.ptOnly}`);
    console.log(`    👤  Bad/missing userId    : ${skippedLog.badUserId}`);
    console.log(`    📐  No matching tier      : ${skippedLog.noTier}\n`);

    if (toRegister.length === 0) {
      console.log('✅  No new transactions to register.');
      await mongoose.disconnect();
      return;
    }

    // ── POST to TransactionV2 API ──────────────────────────────────────────
    const results = { success: [], skipped: [], failed: [] };

    const axiosClient = axios.create({
      baseURL : API_URL,
      headers : { 'Authorization': `Bearer ${ADMIN_TOKEN}`, 'Content-Type': 'application/json' },
    });

    console.log(`🚀  Registering ${toRegister.length} transactions…\n`);

    for (const entry of toRegister) {
      const { ptDoc, usTx, normalizedAmount, resolvedUserId, tier, isUniform, discrepancies } = entry;

      // Source of truth for non-tier fields: uniform → PT, mismatch → US
      const src        = isUniform ? ptDoc : usTx;
      const shareCount = parseInt(src.shares || ptDoc.shares) || 1;

      // ownershipPct and earningKobo are ALWAYS derived from the tier, per share
      const ownershipPctPerShare = tier.ownershipPct / shareCount;
      const earningKoboPerShare  = tier.earningKobo  / shareCount;

      const payload = {
        transactionId : ptDoc.transactionId,
        userId        : resolvedUserId,
        type          : src.type          || ptDoc.type          || 'share',
        shares        : shareCount,
        tierKey       : src.tierKey       || src.packageId       || ptDoc.tierKey || ptDoc.packageId || `tier_${tier.label.toLowerCase()}`,
        totalAmount   : normalizedAmount,
        currency      : (src.currency     || ptDoc.currency      || 'naira').toLowerCase(),
        ownershipPct  : ownershipPctPerShare,
        earningKobo   : earningKoboPerShare,
        status        : 'completed',
        paymentMethod : (src.paymentMethod || ptDoc.paymentMethod || 'bank_transfer').replace(/^manual_/, ''),
        note          : isUniform
          ? `audit-matched | pt+us-uniform | tier:${tier.label} | ${ptDoc.createdAt ? new Date(ptDoc.createdAt).toISOString().slice(0,10) : 'unknown'}`
          : `audit-matched | us-override | tier:${tier.label} | fields:${discrepancies.join(',')} | ${ptDoc.createdAt ? new Date(ptDoc.createdAt).toISOString().slice(0,10) : 'unknown'}`,
      };

      const icon  = isUniform ? '✅' : '⚠️ ';
      const tag   = isUniform ? '' : ` [US override: ${discrepancies.join(', ')}]`;
      const tLabel = `[${tier.label} | ${tier.ownershipPct}% | ${tier.earningKobo}k]`;

      try {
        await axiosClient.post('/api/v2/transactions', payload);

        results.success.push({
          transactionId : ptDoc.transactionId,
          userName      : ptDoc.userId?.name || resolvedUserId,
          amount        : normalizedAmount,
          shares        : shareCount,
          tier          : tier.label,
          ownershipPct  : ownershipPctPerShare,
          earningKobo   : earningKoboPerShare,
          isUniform,
          discrepancies,
        });

        console.log(`  ${icon}  ${ptDoc.transactionId} (${ptDoc.userId?.name || resolvedUserId}) — ₦${normalizedAmount.toLocaleString()} ${tLabel}${tag}`);

      } catch (error) {
        if (error.response?.status === 409) {
          results.skipped.push({ transactionId: ptDoc.transactionId, reason: 'Already exists (409)' });
          console.log(`  ⏭️   ${ptDoc.transactionId} — already registered (409)`);
        } else {
          results.failed.push({
            transactionId : ptDoc.transactionId,
            error         : error.response?.data?.message || error.message,
          });
          console.log(`  ❌  ${ptDoc.transactionId} — ${error.response?.data?.message || error.message}`);
        }
      }
    }

    // ── Summary ────────────────────────────────────────────────────────────
    const successUniform  = results.success.filter(r => r.isUniform).length;
    const successMismatch = results.success.filter(r => !r.isUniform).length;
    const totalNaira      = results.success.reduce((s, r) => s + (r.amount || 0), 0);
    const totalShares     = results.success.reduce((s, r) => s + (r.shares || 0), 0);

    // Tier breakdown
    const tierBreakdown = {};
    for (const r of results.success) {
      if (!tierBreakdown[r.tier]) tierBreakdown[r.tier] = { count: 0, total: 0 };
      tierBreakdown[r.tier].count++;
      tierBreakdown[r.tier].total += r.amount || 0;
    }

    console.log(`\n${'─'.repeat(80)}`);
    console.log('\n📋  REGISTRATION SUMMARY\n');
    console.log(`  ✅  Uniform registered      : ${successUniform}`);
    console.log(`  ⚠️   Mismatch registered     : ${successMismatch}  (US values used)`);
    console.log(`  ⏭️   Already existed         : ${results.skipped.length}`);
    console.log(`  ❌  Failed                  : ${results.failed.length}`);
    console.log(`\n  💰  Total Naira registered  : ₦${totalNaira.toLocaleString()}`);
    console.log(`  📦  Total shares            : ${totalShares}`);
    console.log('\n  📐  Tier breakdown:');
    for (const [label, data] of Object.entries(tierBreakdown)) {
      const tierInfo = SHARE_TIERS.find(t => t.label === label);
      console.log(`      ${label.padEnd(10)} ${String(data.count).padStart(3)} transactions  ₦${data.total.toLocaleString().padStart(12)}  |  ${tierInfo?.ownershipPct}% per share  |  ${tierInfo?.earningKobo} kobo per share`);
    }

    if (results.failed.length > 0) {
      console.log('\n  ❌  Failed transactions:');
      results.failed.forEach(f => console.log(`      • ${f.transactionId}: ${f.error}`));
    }

    console.log('\n✅  Done.\n');

    // ── Save JSON report ───────────────────────────────────────────────────
    const reportPath = path.join(process.cwd(), 'registration-report.json');
    fs.writeFileSync(reportPath, JSON.stringify(results, null, 2), 'utf8');
    console.log(`📄  Report saved → ${reportPath}\n`);

    await mongoose.disconnect();

  } catch (err) {
    console.error('❌  Fatal error:', err.message);
    if (err.response?.data) console.error('    API Response:', err.response.data);
    await mongoose.disconnect();
    process.exit(1);
  }
}

main();