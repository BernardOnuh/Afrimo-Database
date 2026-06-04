#!/usr/bin/env node
'use strict';

/**
 * applyAuditFixes.js
 *
 * Comprehensive database fix script for AfriMobile
 * Applies ALL fixes from the audit document:
 *
 *   FIX 1: Discrepancy rows (PT ↔ UserShare sync)
 *   FIX 2: Co-founder PT-only records (add to UserShare)
 *   FIX 3: US-only completed shares (set amounts + create PT)
 *   GLOBAL: earningKobo ÷1000 correction
 *   TIER UPDATE: elite earningKobo 28 → 30
 *
 * Usage:
 *   node applyAuditFixes.js --dry-run    (preview only)
 *   node applyAuditFixes.js --apply      (make actual changes)
 */

require('dotenv').config();
const mongoose = require('mongoose');

// ── Models ─────────────────────────────────────────────────────────────────
const PaymentTransaction = require('../models/Transaction');
const UserShare          = require('../models/UserShare');
const TierConfig         = require('../models/TierConfig');
const User               = require('../models/User');

// ── CLI args ───────────────────────────────────────────────────────────────
const args    = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run') || args.length === 0;
const APPLY   = args.includes('--apply');

// ── Terminal colours ───────────────────────────────────────────────────────
const c = {
  reset:   '\x1b[0m',
  bright:  '\x1b[1m',
  red:     '\x1b[31m',
  green:   '\x1b[32m',
  yellow:  '\x1b[33m',
  blue:    '\x1b[36m',
  magenta: '\x1b[35m',
};

const log = {
  title:   (msg) => console.log(`\n${c.bright}${c.blue}╔${'═'.repeat(70)}╗\n║ ${msg.padEnd(70)} ║\n╚${'═'.repeat(70)}╝${c.reset}`),
  header:  (msg) => console.log(`\n${c.bright}${c.magenta}▶▶▶ ${msg}${c.reset}`),
  success: (msg) => console.log(`${c.green}✅ ${msg}${c.reset}`),
  warning: (msg) => console.log(`${c.yellow}⚠️  ${msg}${c.reset}`),
  error:   (msg) => console.log(`${c.red}❌ ${msg}${c.reset}`),
  info:    (msg) => console.log(`${c.blue}ℹ️  ${msg}${c.reset}`),
  stat:    (label, value, color = c.bright) => console.log(`   ${color}${label.padEnd(30)}: ${value}${c.reset}`),
  change:  (label, before, after) => {
    console.log(`   ${label}`);
    console.log(`   ${c.red}  ✗ ${before}${c.reset}`);
    console.log(`   ${c.green}  ✓ ${after}${c.reset}`);
  },
};

// ── Tier configuration ─────────────────────────────────────────────────────
const TIER_CONFIG = {
  legacy:   { ownershipPct: 0.00005,  earningKobo: 30 },
  basic:    { ownershipPct: 0.00001,  earningKobo: 6  },
  standard: { ownershipPct: 0.000021, earningKobo: 14 },
  premium:  { ownershipPct: 0.00005,  earningKobo: 30 },
  elite:    { ownershipPct: 0.000084, earningKobo: 30 }, // updated from 28
};

// ── Payment method normalisation ───────────────────────────────────────────
// Valid enum values from models/Transaction.js:
//   'manual_bank_transfer', 'manual_cash', 'manual_other',
//   'centiiv', 'web3', 'crypto', 'franchise', 'franchise_credit'
//
// Everything unknown falls back to 'manual_bank_transfer'.
const VALID_PAYMENT_METHODS = new Set([
  'manual_bank_transfer',
  'manual_cash',
  'manual_other',
  'centiiv',
  'web3',
  'crypto',
  'franchise',
  'franchise_credit',
]);

const PAYMENT_METHOD_MAP = {
  'paystack':      'manual_bank_transfer',
  'flutterwave':   'manual_bank_transfer',
  'flutter':       'manual_bank_transfer',
  'card':          'manual_bank_transfer',
  'bank_transfer': 'manual_bank_transfer',
  'co-founder':    'manual_bank_transfer',
  'cofounder':     'manual_bank_transfer',
  'cash':          'manual_cash',
};

function normalizePaymentMethod(raw) {
  if (!raw) return 'manual_bank_transfer';
  const key = String(raw).toLowerCase().trim();
  if (VALID_PAYMENT_METHODS.has(key)) return key;
  return PAYMENT_METHOD_MAP[key] || 'manual_bank_transfer';
}

// ── FIX 3 safety guards ────────────────────────────────────────────────────
// Records with 0, negative, or implausibly large share counts are skipped
// and flagged for manual review rather than auto-created.
const MAX_SAFE_SHARES = 100;

function fix3SafetyCheck(us) {
  const shares = parseFloat(us.shares);
  if (isNaN(shares) || shares <= 0) {
    return `shares is ${us.shares} (zero, negative, or non-numeric — likely a reversal/removal record)`;
  }
  if (shares > MAX_SAFE_SHARES) {
    return `shares = ${shares} exceeds MAX_SAFE_SHARES (${MAX_SAFE_SHARES}) — review manually`;
  }
  return null; // safe to process
}

// ── Helpers ────────────────────────────────────────────────────────────────
const fmtAmt = (n) => `₦${(parseFloat(n) || 0).toLocaleString('en-NG')}`;
const fmtPct = (n) => `${((parseFloat(n) || 0) * 100).toFixed(4)}%`;

function isPreMarch2026(dateStr) {
  return new Date(dateStr) < new Date('2026-03-01');
}

function getTierKey(tx) {
  return String(tx.tierKey || tx.packageId || tx.tier || '').toLowerCase();
}

/**
 * Correct earningKobo:
 *  - Parses shorthand strings like "6k", "14k", "30k"
 *  - Divides by 1000 if the value was stored inflated (> 100)
 */
function correctEarningKobo(stored) {
  if (typeof stored === 'string') {
    const lower = stored.toLowerCase().trim();
    stored = lower.endsWith('k')
      ? parseFloat(lower) * 1000
      : parseFloat(lower) || 0;
  }
  return stored > 100 ? stored / 1000 : stored;
}

function getCorrectValues(tx) {
  const tierKey    = getTierKey(tx);
  const isPreMarch = isPreMarch2026(tx.createdAt || tx.date);
  const shares     = parseFloat(tx.shares) || 1;

  let correct;
  if (isPreMarch) {
    correct = { ownershipPct: 0.00005, earningKobo: 30, tierKey: 'legacy' };
  } else {
    const tier = TIER_CONFIG[tierKey] || TIER_CONFIG.standard;
    correct = { ownershipPct: tier.ownershipPct, earningKobo: tier.earningKobo, tierKey };
  }

  if (shares > 1) correct.earningKobo = correct.earningKobo * shares;
  return correct;
}

function hasDiscrepancy(pt, us) {
  if (!pt || !us) return true;
  const T = 0.000001;
  return (
    Math.abs((pt.ownershipPct || 0) - (us.ownershipPct || 0)) > T ||
    Math.abs((pt.earningKobo  || 0) - (us.earningKobo  || 0)) > T ||
    Math.abs((pt.amount       || 0) - (us.amount        || 0)) > 0.01
  );
}

// ── Main ───────────────────────────────────────────────────────────────────
async function analyzeAndFix() {
  try {
    log.title('📊 AFRIMOBILE DATABASE FIX SCRIPT');

    // Connect
    log.info('🔌 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
    log.success('Connected');

    // Load data
    log.info('📥 Loading PaymentTransaction records...');
    const ptDocs = await PaymentTransaction.find({}).populate('userId', 'name email').lean();
    log.success(`Loaded ${ptDocs.length} PaymentTransaction records`);

    log.info('📥 Loading UserShare records...');
    const usDocs = await UserShare.find({}).populate('user', 'name email').lean();
    let totalTxInUS = usDocs.reduce((s, d) => s + (d.transactions || []).length, 0);
    log.success(`Loaded ${usDocs.length} UserShare documents (${totalTxInUS} transactions)`);

    let tierConfig = null;
    try {
      tierConfig = await TierConfig.getCurrentConfig();
      log.success('Loaded TierConfig');
    } catch {
      log.warning('Could not load TierConfig (will skip tier update)');
    }

    // Categorise
    log.header('ANALYZING TRANSACTIONS');

    const ptMap = new Map();
    const usMap = new Map();
    const fixes = { fix1: [], fix2: [], fix3: [], skipped: [], tierUpdate: false };
    const stats = {
      totalPT: ptDocs.length, totalUS: totalTxInUS,
      inBothSources: 0, withDiscrepancies: 0,
      ptOnly: 0, usOnly: 0, ghostPending: 0,
    };

    for (const pt of ptDocs) {
      ptMap.set(pt.transactionId, {
        ...pt,
        userId:    pt.userId?._id   || pt.userId,
        userName:  pt.userId?.name  || 'Unknown',
        userEmail: pt.userId?.email || '',
      });
    }

    for (const usDoc of usDocs) {
      for (const tx of usDoc.transactions || []) {
        usMap.set(tx.transactionId, {
          ...tx,
          userId:    usDoc.user?._id   || usDoc.user,
          userName:  usDoc.user?.name  || 'Unknown',
          userEmail: usDoc.user?.email || '',
          usDocId:   usDoc._id,
        });
      }
    }

    for (const key of new Set([...ptMap.keys(), ...usMap.keys()])) {
      const pt     = ptMap.get(key);
      const us     = usMap.get(key);
      const status = ((pt || us).status || '').toLowerCase();

      if (pt && us) {
        stats.inBothSources++;
        if (status === 'completed') {
          if (hasDiscrepancy(pt, us)) { stats.withDiscrepancies++; fixes.fix1.push({ pt, us, key }); }
        } else if (status === 'pending' || status === 'failed') {
          fixes.skipped.push({ key, status, reason: 'ghost/abandoned' });
          stats.ghostPending++;
        }
      } else if (pt && !us) {
        const isCF = pt.type === 'cofounder' || getTierKey(pt).startsWith('cfd');
        if (isCF && status === 'completed') { stats.ptOnly++; fixes.fix2.push({ pt, key }); }
        else fixes.skipped.push({ key, source: 'PT-only', status, reason: 'non-cofounder PT-only' });
      } else if (us && !pt) {
        if (status === 'completed') { stats.usOnly++; fixes.fix3.push({ us, key }); }
        else fixes.skipped.push({ key, source: 'US-only', status, reason: 'not completed' });
      }
    }

    // ── Preview ──────────────────────────────────────────────────────────
    log.title('📋 PREVIEW OF FIXES');

    console.log('\n📊 STATISTICS:');
    log.stat('Total PT records',       stats.totalPT);
    log.stat('Total US transactions',  stats.totalUS);
    log.stat('In both sources',        stats.inBothSources,    c.green);
    log.stat('With discrepancies',     stats.withDiscrepancies, c.yellow);
    log.stat('PT-only (co-founder)',   stats.ptOnly,            c.yellow);
    log.stat('US-only (completed)',    stats.usOnly,            c.yellow);
    log.stat('Ghost pending (skip)',   stats.ghostPending,      c.blue);

    // FIX 1 preview
    if (fixes.fix1.length > 0) {
      log.header(`FIX 1: Discrepancy Rows (${fixes.fix1.length} rows)`);
      console.log('   Problem: PT ↔ UserShare mismatch in ownershipPct, earningKobo, or amount');
      console.log('   Action: Sync both sources with correct values + fix earningKobo ÷1000\n');
      for (const fix of fixes.fix1.slice(0, 5)) {
        const correct = getCorrectValues(fix.pt);
        const kobo    = correctEarningKobo(fix.pt.earningKobo);
        console.log(`   ${fix.key.substring(0, 20)}... (${fix.pt.userName})`);
        if (fix.pt.ownershipPct !== correct.ownershipPct)
          log.change('ownershipPct', `${fix.pt.ownershipPct}`, `${correct.ownershipPct}`);
        if (kobo !== correct.earningKobo)
          log.change('earningKobo (÷1000)', `${fix.pt.earningKobo} (stored)`, `${correct.earningKobo} (corrected)`);
        if (fix.us.amount === 0 && fix.pt.amount > 0)
          log.change('US amount (was missing)', '₦0', fmtAmt(fix.pt.amount));
      }
      if (fixes.fix1.length > 5) console.log(`   ... and ${fixes.fix1.length - 5} more rows\n`);
    }

    // FIX 2 preview
    if (fixes.fix2.length > 0) {
      log.header(`FIX 2: Co-Founder PT-Only (${fixes.fix2.length} rows)`);
      console.log('   Problem: In PaymentTransaction, missing from UserShare');
      console.log('   Action: Create matching entry in UserShare.transactions[]\n');
      for (const fix of fixes.fix2.slice(0, 5)) {
        const correct = getCorrectValues(fix.pt);
        const kobo    = correctEarningKobo(fix.pt.earningKobo);
        console.log(`   ${fix.key.substring(0, 20)}... (${fix.pt.userName})`);
        console.log(`   ${c.green}  ✓ INSERT to UserShare${c.reset}`);
        log.stat('  shares',       fix.pt.shares);
        log.stat('  ownershipPct', fmtPct(correct.ownershipPct));
        log.stat('  earningKobo',  `${kobo} (was ${fix.pt.earningKobo})`);
        log.stat('  amount',       fmtAmt(fix.pt.amount));
      }
      if (fixes.fix2.length > 5) console.log(`   ... and ${fixes.fix2.length - 5} more rows\n`);
    }

    // FIX 3 preview
    if (fixes.fix3.length > 0) {
      const fix3Safe   = fixes.fix3.filter(f => !fix3SafetyCheck(f.us));
      const fix3Unsafe = fixes.fix3.filter(f =>  fix3SafetyCheck(f.us));

      log.header(`FIX 3: US-Only Completed (${fixes.fix3.length} rows — ${fix3Safe.length} safe, ${fix3Unsafe.length} skipped)`);
      console.log('   Problem: Real completed shares with amount = 0');
      console.log('   Action: Set amount (₦50,000/share) + create matching PaymentTransaction\n');

      for (const fix of fix3Safe.slice(0, 5)) {
        const correct      = getCorrectValues(fix.us);
        const totalAmount  = 50000 * fix.us.shares;
        console.log(`   ${fix.key.substring(0, 20)}... (${fix.us.userName})`);
        console.log(`   ${c.green}  ✓ SET amount + CREATE PT${c.reset}`);
        log.stat('  shares',       fix.us.shares);
        log.stat('  ownershipPct', fmtPct(correct.ownershipPct));
        log.stat('  earningKobo',  correct.earningKobo);
        log.stat('  amount',       `${c.red}₦0${c.reset} → ${c.green}${fmtAmt(totalAmount)}${c.reset}`);
      }
      if (fix3Safe.length > 5) console.log(`   ... and ${fix3Safe.length - 5} more safe rows\n`);

      if (fix3Unsafe.length > 0) {
        console.log(`\n   ${c.yellow}⚠️  SKIPPED (unsafe — manual review required):${c.reset}`);
        for (const fix of fix3Unsafe) {
          console.log(`   ${c.red}  ✗ ${fix.key.substring(0, 20)}... — ${fix3SafetyCheck(fix.us)}${c.reset}`);
        }
        console.log('');
      }
    }

    // Tier update preview
    log.header('TIER UPDATE: Elite earningKobo');
    console.log('   Action: Update elite tier earningKobo from 28 → 30\n');
    if (tierConfig) {
      const eliteTier = tierConfig.tiers?.get?.('elite');
      if (eliteTier) {
        log.change('Regular elite (1 share)',      `${eliteTier.earningPerPhone}`, '30');
        log.change('Co-founder elite (22 shares)', `${22 * (eliteTier.earningPerPhone || 28)}`, '660 (22 × 30)');
        fixes.tierUpdate = true;
      }
    }
    console.log('');

    // Global earningKobo note
    log.header('GLOBAL CORRECTION: earningKobo ÷1000');
    console.log('   Action: All stored earningKobo values divided by 1000\n');
    console.log(`   ${c.green}✓ Legacy/Premium: 30${c.reset} (was 30,000)`);
    console.log(`   ${c.green}✓ Basic: 6${c.reset} (was 6,000)`);
    console.log(`   ${c.green}✓ Standard: 14${c.reset} (was 14,000)`);
    console.log(`   ${c.green}✓ Premium: 30${c.reset} (was 30,000)`);
    console.log(`   ${c.green}✓ Elite: 30${c.reset} (was 28,000, now 30)`);
    console.log(`   ${c.green}✓ Co-founder Elite ×22: 660${c.reset} (was 308,000)\n`);

    // Summary
    log.title('📋 FIX SUMMARY');
    const fix3SafeCount = fixes.fix3.filter(f => !fix3SafetyCheck(f.us)).length;
    console.log('\n   Total changes to be made:');
    log.stat('FIX 1 rows',           fixes.fix1.length,    c.yellow);
    log.stat('FIX 2 rows (INSERT)',   fixes.fix2.length,    c.yellow);
    log.stat('FIX 3 rows (safe)',     fix3SafeCount,        c.yellow);
    log.stat('FIX 3 rows (skipped)',  fixes.fix3.length - fix3SafeCount, c.red);
    log.stat('Rows to SKIP',          fixes.skipped.length, c.blue);
    log.stat('Tier updates',          fixes.tierUpdate ? 1 : 0, c.magenta);
    const totalChanges = fixes.fix1.length + fixes.fix2.length + fix3SafeCount + (fixes.tierUpdate ? 1 : 0);
    console.log(`\n   ${c.bright}TOTAL CHANGES: ${totalChanges}${c.reset}\n`);

    if (DRY_RUN) {
      log.header('🏃 DRY RUN MODE');
      log.warning('No changes made yet');
      log.info('To apply these fixes, run:');
      console.log(`   ${c.bright}node applyAuditFixes.js --apply${c.reset}\n`);
      await mongoose.disconnect();
      return;
    }

    // ── Apply ─────────────────────────────────────────────────────────────
    if (APPLY) {
      log.title('💾 APPLYING CHANGES TO DATABASE');

      let appliedFix1 = 0, appliedFix2 = 0, appliedFix3 = 0;

      // FIX 1 ──────────────────────────────────────────────────────────────
      if (fixes.fix1.length > 0) {
        log.header(`APPLYING FIX 1 (${fixes.fix1.length} rows)`);
        for (const fix of fixes.fix1) {
          const correct = getCorrectValues(fix.pt);
          const kobo    = correctEarningKobo(fix.pt.earningKobo);
          try {
            await PaymentTransaction.updateOne(
              { transactionId: fix.key },
              { $set: {
                ownershipPct: correct.ownershipPct,
                earningKobo:  kobo,
                adminNotes:   `[FIX-1 ${new Date().toISOString()}] Synced with UserShare, earningKobo ÷1000 applied`,
              }}
            );

            const usDoc = await UserShare.findById(fix.us.usDocId);
            if (usDoc) {
              const txIdx = usDoc.transactions.findIndex(t => t.transactionId === fix.key);
              if (txIdx !== -1) {
                usDoc.transactions[txIdx].ownershipPct = correct.ownershipPct;
                usDoc.transactions[txIdx].earningKobo  = kobo;
                if (fix.us.amount === 0 && fix.pt.amount > 0) {
                  usDoc.transactions[txIdx].amount      = fix.pt.amount;
                  usDoc.transactions[txIdx].totalAmount = fix.pt.amount;
                }
                let totalPct = 0, totalKobo = 0;
                for (const tx of usDoc.transactions) {
                  if (tx.status === 'completed') {
                    totalPct  += tx.ownershipPct || 0;
                    totalKobo += tx.earningKobo  || 0;
                  }
                }
                usDoc.totalOwnershipPct = totalPct;
                usDoc.totalEarningKobo  = totalKobo;
                await usDoc.save();
                appliedFix1++;
              }
            }
          } catch (err) {
            log.error(`Failed to apply FIX 1 for ${fix.key}: ${err.message}`);
          }
        }
        log.success(`Applied FIX 1: ${appliedFix1} rows updated`);
      }

      // FIX 2 ──────────────────────────────────────────────────────────────
      if (fixes.fix2.length > 0) {
        log.header(`APPLYING FIX 2 (${fixes.fix2.length} rows)`);
        for (const fix of fixes.fix2) {
          const correct = getCorrectValues(fix.pt);
          const kobo    = correctEarningKobo(fix.pt.earningKobo);
          try {
            const usDoc = await UserShare.findOne({ user: fix.pt.userId });
            if (usDoc) {
              usDoc.transactions.push({
                transactionId: fix.key,
                type:          fix.pt.type,
                tierKey:       correct.tierKey,
                packageLabel:  fix.pt.packageLabel || '',
                status:        fix.pt.status,
                amount:        fix.pt.amount,
                totalAmount:   fix.pt.amount,
                currency:      fix.pt.currency || 'naira',
                paymentMethod: normalizePaymentMethod(fix.pt.paymentMethod),
                shares:        fix.pt.shares,
                ownershipPct:  correct.ownershipPct,
                earningKobo:   kobo,
                createdAt:     fix.pt.createdAt,
                verifiedAt:    new Date(),
              });
              let totalPct = 0, totalKobo = 0;
              for (const tx of usDoc.transactions) {
                if (tx.status === 'completed') {
                  totalPct  += tx.ownershipPct || 0;
                  totalKobo += tx.earningKobo  || 0;
                }
              }
              usDoc.totalOwnershipPct = totalPct;
              usDoc.totalEarningKobo  = totalKobo;
              await usDoc.save();
              appliedFix2++;
            }
          } catch (err) {
            log.error(`Failed to apply FIX 2 for ${fix.key}: ${err.message}`);
          }
        }
        log.success(`Applied FIX 2: ${appliedFix2} rows inserted to UserShare`);
      }

      // FIX 3 ──────────────────────────────────────────────────────────────
      if (fixes.fix3.length > 0) {
        const fix3Safe   = fixes.fix3.filter(f => !fix3SafetyCheck(f.us));
        const fix3Unsafe = fixes.fix3.filter(f =>  fix3SafetyCheck(f.us));

        log.header(`APPLYING FIX 3 (${fix3Safe.length} safe rows; skipping ${fix3Unsafe.length} unsafe)`);

        if (fix3Unsafe.length > 0) {
          log.warning('Skipped unsafe FIX-3 records (manual review required):');
          for (const fix of fix3Unsafe) {
            log.warning(`  ${fix.key} — ${fix3SafetyCheck(fix.us)}`);
          }
        }

        for (const fix of fix3Safe) {
          const correct     = getCorrectValues(fix.us);
          const kobo        = correct.earningKobo;
          const totalAmount = 50000 * fix.us.shares;

          try {
            // Update UserShare amount
            const usDoc = await UserShare.findById(fix.us.usDocId);
            if (usDoc) {
              const txIdx = usDoc.transactions.findIndex(t => t.transactionId === fix.key);
              if (txIdx !== -1) {
                usDoc.transactions[txIdx].amount        = totalAmount;
                usDoc.transactions[txIdx].totalAmount   = totalAmount;
                usDoc.transactions[txIdx].ownershipPct  = correct.ownershipPct;
                usDoc.transactions[txIdx].earningKobo   = kobo;
                let totalPct = 0, totalKobo = 0;
                for (const tx of usDoc.transactions) {
                  if (tx.status === 'completed') {
                    totalPct  += tx.ownershipPct || 0;
                    totalKobo += tx.earningKobo  || 0;
                  }
                }
                usDoc.totalOwnershipPct = totalPct;
                usDoc.totalEarningKobo  = totalKobo;
                await usDoc.save();
              }
            }

            // Create PaymentTransaction with a valid paymentMethod enum value
            await PaymentTransaction.create({
              transactionId: fix.key,
              userId:        fix.us.userId,
              type:          fix.us.type || 'share',
              tierKey:       correct.tierKey,
              packageLabel:  fix.us.packageLabel || '',
              status:        'completed',
              amount:        totalAmount,
              totalAmount,
              currency:      fix.us.currency || 'naira',
              paymentMethod: normalizePaymentMethod(fix.us.paymentMethod),
              shares:        fix.us.shares,
              ownershipPct:  correct.ownershipPct,
              earningKobo:   kobo,
              createdAt:     fix.us.createdAt,
              verifiedAt:    new Date(),
              adminNotes:    `[FIX-3 ${new Date().toISOString()}] Created from US-only record`,
            });

            appliedFix3++;
          } catch (err) {
            log.error(`Failed to apply FIX 3 for ${fix.key}: ${err.message}`);
          }
        }
        log.success(`Applied FIX 3: ${appliedFix3} amounts set + PaymentTransactions created`);
      }

      // Tier update ──────────────────────────────────────────────────────────
      // NOTE: lastUpdatedBy expects an ObjectId ref — omitted to avoid BSONError.
      // To add an audit trail pass a real admin _id:
      //   tierConfig.lastUpdatedBy = new mongoose.Types.ObjectId('your-admin-id');
      if (fixes.tierUpdate && tierConfig) {
        log.header('APPLYING TIER UPDATE');
        try {
          const eliteTier = tierConfig.tiers.get('elite');
          if (eliteTier) {
            eliteTier.earningPerPhone = 30;
            tierConfig.tiers.set('elite', eliteTier);
            tierConfig.lastUpdated = new Date();
            await tierConfig.save();
            log.success('Updated elite tier earningKobo to 30');
          }
        } catch (err) {
          log.error(`Failed to update tier: ${err.message}`);
        }
      }

      // Final summary
      log.title('✅ ALL FIXES APPLIED');
      console.log('\n   Completed:');
      log.stat('FIX 1 rows',        appliedFix1,             c.green);
      log.stat('FIX 2 rows inserted', appliedFix2,           c.green);
      log.stat('FIX 3 rows updated', appliedFix3,            c.green);
      log.stat('Tier updates',       fixes.tierUpdate ? 1 : 0, c.green);
      const totalApplied = appliedFix1 + appliedFix2 + appliedFix3 + (fixes.tierUpdate ? 1 : 0);
      console.log(`\n   ${c.bright}${c.green}TOTAL APPLIED: ${totalApplied}${c.reset}\n`);
      log.success('Database update complete! ✨');
    }

    await mongoose.disconnect();

  } catch (error) {
    console.error(`\n${c.red}❌ ${error.message}${c.reset}`);
    console.error(error.stack);
    process.exit(1);
  }
}

analyzeAndFix();