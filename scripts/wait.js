'use strict';

/**
 * auditTransactions.js  (v3)
 * ─────────────────────────────────────────────────────────────────────────────
 * Produces SEPARATE output files for each transaction status:
 *
 *   audit-output/
 *     audit-completed/   audit-completed.html + .csv
 *     audit-pending/     audit-pending.html   + .csv
 *     audit-failed/      audit-failed.html    + .csv
 *     audit-all/         audit-all.html + .csv + .json
 *
 * Each HTML report has a side-by-side comparison tab showing BOTH the
 * PaymentTransaction row AND the UserShare row — differing cells are
 * highlighted red in both rows immediately.
 *
 * v3 fixes:
 *  - Loads legacy Share model (ObjectId-keyed) to resolve ₦0 amounts
 *    on UserShare-only records whose tierKey is a MongoDB ObjectId string
 *  - enrichedTx inherits parent-doc currency when sub-tx field is missing
 *  - resolveAmount checks: raw fields → TierConfig → legacy Share → pricePerShare
 *  - normalise() receives legacyShareMap so every row gets a real amount
 *
 * Usage:
 *   node auditTransactions.js                     ← all four reports
 *   node auditTransactions.js --only completed
 *   node auditTransactions.js --only pending
 *   node auditTransactions.js --only failed
 *   node auditTransactions.js --type co-founder
 * ─────────────────────────────────────────────────────────────────────────────
 */

require('dotenv').config();
const mongoose = require('mongoose');
const fs       = require('fs');
const path     = require('path');

// ── Model imports ─────────────────────────────────────────────────────────────
// User MUST be required first so Mongoose registers its schema before
// PaymentTransaction / UserShare try to .populate() it.
const possibleUserPaths = [
  '../models/User',
  '../models/user',
  '../models/users/User',
];
let User;
for (const p of possibleUserPaths) {
  try { User = require(p); break; } catch (_) { /* try next */ }
}
if (!User) {
  console.warn('⚠️  User model not found — names will show as "Unknown". populate will be skipped.');
}

const PaymentTransaction = require('../models/Transaction');
const UserShare          = require('../models/UserShare');

let TierConfig;
try { TierConfig = require('../models/TierConfig'); } catch (_) {
  console.warn('⚠️  TierConfig model not found — tier-based amount resolution skipped.');
}

// Legacy Share model — used for ObjectId-keyed tier lookups (pre-TierConfig era)
let ShareModel;
try { ShareModel = require('../models/Share'); } catch (_) {
  console.warn('⚠️  Share model not found — legacy ObjectId tier resolution skipped.');
}

// ── CLI args ──────────────────────────────────────────────────────────────────
const args        = process.argv.slice(2);
const flagVal     = (f) => { const i = args.indexOf(f); return i !== -1 ? args[i + 1] : null; };
const ONLY        = flagVal('--only') || null;
const TYPE_FILTER = flagVal('--type') || null;
const STATUSES    = ONLY ? [ONLY] : ['completed', 'pending', 'failed'];

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmtDate = (d) => d ? new Date(d).toISOString().replace('T', ' ').slice(0, 19) : '—';
const fmtAmt  = (n) => (parseFloat(n) || 0).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtPct  = (n) => ((parseFloat(n) || 0) * 100).toFixed(7) + '%';
const esc     = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Resolve the actual monetary amount for a transaction.
 *
 * Priority:
 *  1. raw.amount or raw.totalAmount (direct fields)
 *  2. TierConfig lookup via string tierKey  (e.g. "basic", "premium")
 *  3. Legacy Share model lookup via ObjectId tierKey (e.g. "69ccd0dc680f6f2a96815a49")
 *  4. raw.pricePerShare × shares fallback
 *
 * @param {object} raw            - raw transaction sub-document or PaymentTransaction doc
 * @param {object} tierConfig     - TierConfig document with .tiers Map
 * @param {Map}    legacyShareMap - Map<objectIdString, ShareDoc> for pre-TierConfig records
 */
const resolveAmount = (raw, tierConfig, legacyShareMap) => {
  // ── 1. Direct amount fields ───────────────────────────────────────────────
  let amt = parseFloat(raw.amount ?? raw.totalAmount ?? 0) || 0;
  if (amt > 0) return amt;

  const tierKey = raw.tierKey || raw.packageId || raw.tier || '';
  const shares  = parseFloat(raw.shares) || 1;
  const cur     = (raw.currency || 'naira').toLowerCase();

  // ── 2. TierConfig (modern string keys) ───────────────────────────────────
  if (tierKey && tierConfig?.tiers) {
    const tier = tierConfig.tiers?.get?.(tierKey);
    if (tier) {
      const price = cur === 'usdt' ? (tier.priceUSD || 0) : (tier.priceNGN || 0);
      if (price > 0) return price * shares;
    }
  }

  // ── 3. Legacy Share model (ObjectId string keys) ──────────────────────────
  if (tierKey && legacyShareMap && legacyShareMap.size > 0) {
    const legacy = legacyShareMap.get(tierKey);
    if (legacy) {
      // Legacy Share docs used various field names for price — try them all
      const price = cur === 'usdt'
        ? (legacy.priceUSDT || legacy.priceUsdt || legacy.priceUsd || legacy.usdtPrice || 0)
        : (legacy.priceNaira || legacy.price || legacy.priceNGN || legacy.nairaPrice ||
           legacy.amount || legacy.cost || 0);
      if (price > 0) return price * shares;
    }
  }

  // ── 4. pricePerShare fallback ─────────────────────────────────────────────
  const pps = parseFloat(raw.pricePerShare) || 0;
  if (pps > 0) return pps * shares;

  return 0;
};

const normalise = (raw, source, userId, userName, userEmail, tierConfig, legacyShareMap) => ({
  source,
  transactionId : raw.transactionId || 'N/A',
  userId        : (userId || raw.userId || '').toString(),
  userName      : userName || 'Unknown',
  userEmail     : userEmail || '',
  type          : raw.type || 'share',
  tierKey       : raw.tierKey || raw.packageId || '',
  packageLabel  : raw.packageLabel || '',
  status        : (raw.status || '').toLowerCase(),
  amount        : resolveAmount(raw, tierConfig, legacyShareMap),
  currency      : (raw.currency || 'naira').toLowerCase(),
  paymentMethod : (raw.paymentMethod || '').replace(/^manual_/, '').replace('admin_override', 'admin'),
  shares        : parseFloat(raw.shares) || 1,
  ownershipPct  : parseFloat(raw.ownershipPct) || 0,
  earningKobo   : parseFloat(raw.earningKobo)  || 0,
  hasProof      : !!(raw.paymentProofCloudinaryUrl || raw.paymentProofPath || raw.hasProof),
  adminAction   : !!(raw.adminAction),
  adminNote     : raw.adminNotes || raw.adminNote || '',
  createdAt     : fmtDate(raw.createdAt),
  updatedAt     : fmtDate(raw.updatedAt || raw.createdAt),
  verifiedAt    : fmtDate(raw.verifiedAt || null),
});

const COMPARABLE = [
  'type', 'tierKey', 'packageLabel', 'status',
  'amount', 'currency', 'paymentMethod',
  'shares', 'ownershipPct', 'earningKobo',
];

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

// ── HTML helpers ──────────────────────────────────────────────────────────────
const STATUS_COLORS = { completed: '#16a34a', pending: '#d97706', failed: '#dc2626', cancelled: '#6b7280' };

const statusBadge = (s) => {
  const c = STATUS_COLORS[s?.toLowerCase()] || '#6b7280';
  return `<span style="background:${c};color:#fff;padding:2px 9px;border-radius:9999px;font-size:11px;font-weight:600">${esc(s || '—')}</span>`;
};

const matchBadge = (ok) =>
  ok ? `<span style="background:#dcfce7;color:#166534;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700">✓ Match</span>`
     : `<span style="background:#fee2e2;color:#991b1b;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700">✗ Mismatch</span>`;

const sourcePill = (src) => {
  const c = src === 'PaymentTransaction' ? '#1d4ed8' : '#7c3aed';
  const l = src === 'PaymentTransaction' ? 'PT' : 'US';
  return `<span style="background:${c};color:#fff;padding:1px 7px;border-radius:4px;font-size:10px;font-weight:700">${l}</span>`;
};

// ── Amount display helper (handles zero gracefully) ───────────────────────────
const displayAmt = (row) => {
  const sym = row.currency === 'usdt' ? '$' : '₦';
  if (!row.amount || row.amount === 0) {
    return `<span style="color:#9ca3af;font-style:italic">${sym}0.00 <span title="Amount could not be resolved from tier data" style="cursor:help">(?)</span></span>`;
  }
  return `${sym}${fmtAmt(row.amount)}`;
};

// ── Side-by-side comparison rows ──────────────────────────────────────────────
function buildComparisonRows(inBothSources) {
  if (!inBothSources.length) {
    return `<tr><td colspan="14" style="padding:20px;text-align:center;color:#9ca3af">No transactions found in both sources for this status.</td></tr>`;
  }

  const base = 'padding:7px 10px;font-size:12px';

  return inBothSources.map(({ ptRow, usRow, discrepancies, isUniform }) => {
    const diffFields = new Set(discrepancies.map(d => d.field));
    const cellStyle = (field, extra = '') =>
      diffFields.has(field)
        ? `${base}${extra};background:#fee2e2;color:#991b1b;font-weight:700`
        : `${base}${extra}`;

    const renderRow = (row, isPT) => {
      const bg = isPT
        ? (isUniform ? '#f0f9ff' : '#fffbeb')
        : (isUniform ? '#faf5ff' : '#fffbeb');
      return `<tr style="background:${bg};border-bottom:1px solid #f3f4f6">
        <td style="${base};font-family:monospace;font-size:11px;white-space:nowrap">
          ${isPT ? `<b>${esc(row.transactionId)}</b>` : ''}
        </td>
        <td style="${base}">${sourcePill(row.source)}</td>
        <td style="${base}">${esc(row.userName)}<br><span style="color:#9ca3af;font-size:10px">${esc(row.userEmail)}</span></td>
        <td style="${cellStyle('type')}">${esc(row.type)}</td>
        <td style="${base}">${statusBadge(row.status)}</td>
        <td style="${cellStyle('amount', ';text-align:right')}">${displayAmt(row)}</td>
        <td style="${cellStyle('currency')}">${esc(row.currency)}</td>
        <td style="${cellStyle('paymentMethod')}">${esc(row.paymentMethod)}</td>
        <td style="${cellStyle('tierKey')}">${esc(row.tierKey) || '—'}</td>
        <td style="${cellStyle('packageLabel')}">${esc(row.packageLabel) || '—'}</td>
        <td style="${cellStyle('shares', ';text-align:center')}">${row.shares}</td>
        <td style="${cellStyle('ownershipPct', ';text-align:right')}">${fmtPct(row.ownershipPct)}</td>
        <td style="${cellStyle('earningKobo', ';text-align:right')}">${(row.earningKobo || 0).toLocaleString()}</td>
        <td style="${base};white-space:nowrap">${esc(row.createdAt)}</td>
      </tr>`;
    };

    const sepRow = `<tr style="background:${isUniform ? '#f0fdf4' : '#fff1f2'};border-bottom:2px solid ${isUniform ? '#86efac' : '#fca5a5'}">
      <td colspan="14" style="padding:3px 10px;font-size:11px">
        ${matchBadge(isUniform)}
        ${!isUniform ? ` &nbsp; Differs on: <b>${discrepancies.map(d => d.field).join(', ')}</b>` : ''}
      </td>
    </tr>`;

    return renderRow(ptRow, true) + renderRow(usRow, false) + sepRow;
  }).join('');
}

// ── Single-source rows (PT-only or US-only) ───────────────────────────────────
function buildSingleRows(rows) {
  if (!rows.length) return `<tr><td colspan="10" style="padding:20px;text-align:center;color:#9ca3af">None.</td></tr>`;
  const b = 'padding:7px 10px;font-size:12px';
  return rows.map(r => `<tr style="background:#fff;border-bottom:1px solid #f3f4f6">
    <td style="${b};font-family:monospace;font-size:11px">${esc(r.transactionId)}</td>
    <td style="${b}">${esc(r.userName)}<br><span style="color:#9ca3af;font-size:10px">${esc(r.userEmail)}</span></td>
    <td style="${b}">${esc(r.type)}</td>
    <td style="${b}">${statusBadge(r.status)}</td>
    <td style="${b};text-align:right">${displayAmt(r)}</td>
    <td style="${b}">${esc(r.paymentMethod)}</td>
    <td style="${b}">${esc(r.tierKey) || '—'}</td>
    <td style="${b}">${esc(r.packageLabel) || '—'}</td>
    <td style="${b};text-align:center">${r.shares}</td>
    <td style="${b};white-space:nowrap">${esc(r.createdAt)}</td>
  </tr>`).join('');
}

// ── Completeness rows ─────────────────────────────────────────────────────────
function buildCompletenessRows(rows) {
  if (!rows.length) return '<tr><td colspan="2" style="padding:20px;text-align:center;color:#9ca3af">No data.</td></tr>';
  return rows.map(c => {
    const pct = parseFloat(c.pct);
    const col = pct >= 90 ? '#16a34a' : pct >= 60 ? '#d97706' : '#dc2626';
    return `<tr style="border-bottom:1px solid #f3f4f6">
      <td style="padding:8px 14px;font-family:monospace;font-size:12px">${esc(c.field)}</td>
      <td style="padding:8px 14px">
        <div style="display:flex;align-items:center;gap:10px">
          <div style="background:#f3f4f6;border-radius:4px;flex:1;height:12px;overflow:hidden">
            <div style="background:${col};width:${Math.min(pct, 100)}%;height:100%;border-radius:4px"></div>
          </div>
          <span style="font-size:12px;font-weight:600;color:${col};min-width:52px">${c.pct}%</span>
          <span style="font-size:11px;color:#9ca3af">${c.populated}/${c.total}</span>
        </div>
      </td>
    </tr>`;
  }).join('');
}

// ── Amount resolution stats row ───────────────────────────────────────────────
function buildAmountStats(rows) {
  const total      = rows.length;
  const hasAmount  = rows.filter(r => r.amount > 0).length;
  const zeroAmount = total - hasAmount;
  if (total === 0) return '';
  return `
    <div style="background:#fefce8;border:1px solid #fde68a;border-radius:8px;padding:14px 18px;margin-bottom:16px;font-size:13px">
      <b>💡 Amount Resolution:</b>
      ${hasAmount} of ${total} records have a resolved amount
      ${zeroAmount > 0
        ? `— <span style="color:#b45309;font-weight:600">${zeroAmount} records still show ₦0.00</span>
           (legacy Paystack transactions where price was never stored; tierKey may be an ObjectId
           not present in the Share model, or the Share model was unavailable during this run)`
        : '— <span style="color:#16a34a;font-weight:600">all amounts resolved ✓</span>'}
    </div>`;
}

// ── HTML page builder ─────────────────────────────────────────────────────────
function buildHTML(report, statusLabel, generated) {
  const s = report.summary;
  const statusColor = STATUS_COLORS[statusLabel] || '#374151';
  const TH = 'padding:9px 10px;background:#f9fafb;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#6b7280;border-bottom:2px solid #e5e7eb;white-space:nowrap;text-align:left';

  const card = (label, value, sub, color) =>
    `<div style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:18px 22px;min-width:140px;flex:1">
       <div style="font-size:26px;font-weight:800;color:${color}">${value}</div>
       <div style="font-size:13px;font-weight:600;color:#374151;margin-top:2px">${label}</div>
       ${sub ? `<div style="font-size:11px;color:#9ca3af;margin-top:3px">${sub}</div>` : ''}
     </div>`;

  const totalRevenue = [...report.ptOnly, ...report.inBothSources.map(e => e.ptRow)]
    .filter(r => r.status === 'completed')
    .reduce((sum, r) => sum + (r.amount || 0), 0);

  // US-only amount totals (for the new stats banner)
  const usOnlyWithAmount  = report.usOnly.filter(r => r.amount > 0);
  const usOnlyTotalNaira  = report.usOnly
    .filter(r => r.currency !== 'usdt')
    .reduce((s, r) => s + r.amount, 0);
  const usOnlyTotalUSDT   = report.usOnly
    .filter(r => r.currency === 'usdt')
    .reduce((s, r) => s + r.amount, 0);
  const usOnlyUnresolved  = report.usOnly.filter(r => r.amount === 0).length;

  const compRows    = buildComparisonRows(report.inBothSources);
  const ptOnlyRows  = buildSingleRows(report.ptOnly);
  const usOnlyRows  = buildSingleRows(report.usOnly);
  const compRows2   = buildCompletenessRows(report.completeness || []);
  const usAmtStats  = buildAmountStats(report.usOnly);

  const discrepancyBlocks = report.discrepancies.length === 0
    ? `<div style="text-align:center;padding:50px;color:#16a34a;font-size:16px;font-weight:600">✅ No mismatches — all matched transactions are uniform.</div>`
    : report.discrepancies.map(entry => `
      <div style="border:1px solid #fca5a5;border-radius:10px;padding:18px;margin-bottom:20px;background:#fff7f7">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;margin-bottom:14px">
          <div>
            <code style="font-size:13px;font-weight:700">${esc(entry.transactionId)}</code>
            <span style="margin-left:10px;font-size:13px;color:#374151;font-weight:600">${esc(entry.ptRow.userName)}</span>
            <span style="margin-left:6px;font-size:12px;color:#9ca3af">${esc(entry.ptRow.userEmail)}</span>
          </div>
          <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
            ${statusBadge(entry.ptRow.status)}
            <span style="background:#fee2e2;color:#dc2626;padding:3px 10px;border-radius:6px;font-size:12px;font-weight:700">
              ${entry.discrepancies.length} field${entry.discrepancies.length > 1 ? 's' : ''} differ
            </span>
          </div>
        </div>
        <table style="width:100%;border-collapse:collapse;margin-bottom:10px">
          <thead><tr>
            <th style="padding:8px 12px;background:#fef2f2;font-size:11px;font-weight:700;text-align:left;border-bottom:1px solid #fecaca;width:160px;text-transform:uppercase">Field</th>
            <th style="padding:8px 12px;background:#eff6ff;font-size:11px;font-weight:700;text-align:left;border-bottom:1px solid #fecaca;text-transform:uppercase">PaymentTransaction (PT)</th>
            <th style="padding:8px 12px;background:#faf5ff;font-size:11px;font-weight:700;text-align:left;border-bottom:1px solid #fecaca;text-transform:uppercase">UserShare (US)</th>
            <th style="padding:8px 12px;background:#fef2f2;font-size:11px;font-weight:700;text-align:left;border-bottom:1px solid #fecaca;text-transform:uppercase">Match?</th>
          </tr></thead>
          <tbody>
            ${COMPARABLE.map(field => {
              const ptVal  = entry.ptRow[field];
              const usVal  = entry.usRow[field];
              const differs = entry.discrepancies.some(d => d.field === field);
              return `<tr style="border-bottom:1px solid #fef2f2${differs ? ';background:#fff5f5' : ''}">
                <td style="padding:7px 12px;font-family:monospace;font-size:12px;font-weight:600;color:${differs ? '#b91c1c' : '#374151'}">${esc(field)}</td>
                <td style="padding:7px 12px;font-size:12px${differs ? ';background:#f0fdf4;color:#15803d;font-weight:700' : ''}">${esc(ptVal ?? '—')}</td>
                <td style="padding:7px 12px;font-size:12px${differs ? ';background:#fff1f2;color:#be123c;font-weight:700' : ''}">${esc(usVal ?? '—')}</td>
                <td style="padding:7px 12px;font-size:12px">${differs
                  ? '<span style="color:#dc2626;font-weight:700">✗ Different</span>'
                  : '<span style="color:#16a34a;font-weight:700">✓ Same</span>'}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
        <div style="font-size:12px;color:#6b7280;display:flex;gap:16px;flex-wrap:wrap">
          <span>Created: <b>${esc(entry.ptRow.createdAt)}</b></span>
          <span>Updated: <b>${esc(entry.ptRow.updatedAt)}</b></span>
          <span>Verified: <b>${esc(entry.ptRow.verifiedAt)}</b></span>
        </div>
      </div>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Audit — ${esc(statusLabel.toUpperCase())} — ${esc(generated)}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f3f4f6;color:#111827}
  table{width:100%;border-collapse:collapse}
  code{background:#f3f4f6;padding:1px 4px;border-radius:3px;font-size:11px}
  .card{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:24px;margin-bottom:24px;overflow:hidden}
  .scroll{overflow-x:auto}
  .tab-btn{padding:8px 18px;border:none;background:#f3f4f6;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;color:#374151;transition:.15s}
  .tab-btn.active{background:#1d4ed8;color:#fff}
  .tab-pane{display:none}.tab-pane.active{display:block}
  @media print{body{background:#fff}.card{border:none}button{display:none}}
</style>
</head>
<body>
<div style="max-width:1500px;margin:0 auto;padding:28px 20px">

  <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:24px;flex-wrap:wrap;gap:12px">
    <div>
      <div style="display:flex;align-items:center;gap:12px">
        <div style="font-size:22px;font-weight:800;color:#111827">Transaction Audit Report</div>
        <span style="background:${statusColor};color:#fff;padding:4px 14px;border-radius:9999px;font-size:13px;font-weight:700;text-transform:uppercase">${esc(statusLabel)}</span>
      </div>
      <div style="font-size:13px;color:#9ca3af;margin-top:5px">
        Generated: ${esc(generated)} &nbsp;·&nbsp; status=<b>${esc(statusLabel)}</b>${TYPE_FILTER ? ` type=<b>${esc(TYPE_FILTER)}</b>` : ''}
        &nbsp;·&nbsp; v3 (legacy Share resolution enabled)
      </div>
    </div>
    <div style="display:flex;gap:10px;flex-wrap:wrap">
      <button onclick="downloadCSV()" style="padding:9px 18px;background:#1d4ed8;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer">⬇ Download CSV</button>
      <button onclick="window.print()" style="padding:9px 18px;background:#374151;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer">🖨 Print</button>
    </div>
  </div>

  <div style="display:flex;flex-wrap:wrap;gap:14px;margin-bottom:24px">
    ${card('Total Unique', s.totalUniqueTransactions, 'across both sources', '#1d4ed8')}
    ${card('In Both Sources', s.inBothSources, 'PT + UserShare', '#374151')}
    ${card('✓ Uniform', s.uniform, 'fields match exactly', '#16a34a')}
    ${card('✗ Mismatches', s.withDiscrepancies, 'need investigation', '#dc2626')}
    ${card('PT Only', s.ptOnly, 'missing from UserShare', '#2563eb')}
    ${card('UserShare Only', s.usOnly, 'missing from PaymentTx', '#7c3aed')}
    ${statusLabel === 'completed' ? card('Total Revenue', '₦' + fmtAmt(totalRevenue), 'completed PT transactions', '#059669') : ''}
    ${report.usOnly.length > 0 ? card(
        'US-Only Value',
        (usOnlyTotalNaira > 0 ? '₦' + fmtAmt(usOnlyTotalNaira) : '') +
        (usOnlyTotalUSDT  > 0 ? (usOnlyTotalNaira > 0 ? ' / ' : '') + '$' + fmtAmt(usOnlyTotalUSDT) : '') ||
        '₦0.00',
        usOnlyUnresolved > 0 ? `${usOnlyUnresolved} unresolved` : 'all resolved',
        usOnlyUnresolved > 0 ? '#b45309' : '#059669'
      ) : ''}
  </div>

  <div style="display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap">
    <button class="tab-btn active" onclick="showTab('comparison',this)">Side-by-Side (${s.inBothSources})</button>
    <button class="tab-btn" onclick="showTab('discrepancies',this)">Mismatches Only (${s.withDiscrepancies})</button>
    <button class="tab-btn" onclick="showTab('ptonly',this)">PT Only (${s.ptOnly})</button>
    <button class="tab-btn" onclick="showTab('usonly',this)">UserShare Only (${s.usOnly})</button>
    ${statusLabel === 'completed' ? `<button class="tab-btn" onclick="showTab('completeness',this)">Field Completeness</button>` : ''}
  </div>

  <!-- Side-by-Side -->
  <div id="tab-comparison" class="tab-pane active">
    <div class="card">
      <h2 style="font-size:17px;font-weight:700;margin-bottom:10px">Side-by-Side Comparison</h2>
      <p style="font-size:13px;color:#6b7280;margin-bottom:12px">
        Each transaction in <b>both</b> sources shows as <b>two rows</b>:
        <span style="background:#1d4ed8;color:#fff;padding:1px 6px;border-radius:3px;font-size:11px">PT</span> then
        <span style="background:#7c3aed;color:#fff;padding:1px 6px;border-radius:3px;font-size:11px">US</span>.
        Cells <span style="background:#fee2e2;color:#991b1b;padding:1px 5px;border-radius:3px;font-weight:700">highlighted red</span>
        disagree between the two sources.
      </p>
      <div style="margin-bottom:12px">
        <input oninput="filterTable('comp-tbody',this.value)" placeholder="Search ID, user, tier, method…"
          style="padding:7px 12px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;width:300px">
      </div>
      <div class="scroll">
        <table>
          <thead><tr>
            <th style="${TH}">Transaction ID</th>
            <th style="${TH}">Src</th>
            <th style="${TH}">User</th>
            <th style="${TH}">Type</th>
            <th style="${TH}">Status</th>
            <th style="${TH}">Amount</th>
            <th style="${TH}">Currency</th>
            <th style="${TH}">Pay Method</th>
            <th style="${TH}">Tier Key</th>
            <th style="${TH}">Package</th>
            <th style="${TH}">Qty</th>
            <th style="${TH}">Ownership%</th>
            <th style="${TH}">Earning(₦)</th>
            <th style="${TH}">Created At</th>
          </tr></thead>
          <tbody id="comp-tbody">${compRows}</tbody>
        </table>
      </div>
    </div>
  </div>

  <!-- Mismatches -->
  <div id="tab-discrepancies" class="tab-pane">
    <div class="card">
      <h2 style="font-size:17px;font-weight:700;margin-bottom:10px">Mismatches — Field-by-Field Detail</h2>
      <p style="font-size:13px;color:#6b7280;margin-bottom:20px">
        Every comparable field is shown for each mismatched transaction. Green = PT value, Red = US value when they differ.
      </p>
      ${discrepancyBlocks}
    </div>
  </div>

  <!-- PT Only -->
  <div id="tab-ptonly" class="tab-pane">
    <div class="card">
      <h2 style="font-size:17px;font-weight:700;margin-bottom:8px">PaymentTransaction Only</h2>
      <p style="font-size:13px;color:#6b7280;margin-bottom:16px">
        Exist in <b>PaymentTransaction</b> but <b>no matching UserShare record</b>. Share ownership was never recorded.
      </p>
      <div class="scroll"><table>
        <thead><tr>
          <th style="${TH}">Transaction ID</th><th style="${TH}">User</th>
          <th style="${TH}">Type</th><th style="${TH}">Status</th>
          <th style="${TH}">Amount</th><th style="${TH}">Pay Method</th>
          <th style="${TH}">Tier Key</th><th style="${TH}">Package</th>
          <th style="${TH}">Qty</th><th style="${TH}">Created At</th>
        </tr></thead>
        <tbody>${ptOnlyRows}</tbody>
      </table></div>
    </div>
  </div>

  <!-- UserShare Only -->
  <div id="tab-usonly" class="tab-pane">
    <div class="card">
      <h2 style="font-size:17px;font-weight:700;margin-bottom:8px">UserShare Only</h2>
      <p style="font-size:13px;color:#6b7280;margin-bottom:8px">
        Exist in <b>UserShare</b> but <b>no PaymentTransaction</b>. Legacy records, admin grants, or pre-PT data.
      </p>
      ${usAmtStats}
      ${report.usOnly.length > 0 && (usOnlyTotalNaira > 0 || usOnlyTotalUSDT > 0) ? `
      <div style="background:#f0fdf4;border:1px solid #86efac;border-radius:8px;padding:14px 18px;margin-bottom:16px;font-size:13px">
        <b>💰 Resolved Totals:</b>
        ${usOnlyTotalNaira > 0 ? `<span style="margin-left:12px">Naira: <b style="color:#16a34a">₦${fmtAmt(usOnlyTotalNaira)}</b> (${usOnlyWithAmount.filter(r => r.currency !== 'usdt').length} records)</span>` : ''}
        ${usOnlyTotalUSDT  > 0 ? `<span style="margin-left:12px">USDT: <b style="color:#16a34a">$${fmtAmt(usOnlyTotalUSDT)}</b> (${usOnlyWithAmount.filter(r => r.currency === 'usdt').length} records)</span>` : ''}
      </div>` : ''}
      <div class="scroll"><table>
        <thead><tr>
          <th style="${TH}">Transaction ID</th><th style="${TH}">User</th>
          <th style="${TH}">Type</th><th style="${TH}">Status</th>
          <th style="${TH}">Amount</th><th style="${TH}">Pay Method</th>
          <th style="${TH}">Tier Key</th><th style="${TH}">Package</th>
          <th style="${TH}">Qty</th><th style="${TH}">Created At</th>
        </tr></thead>
        <tbody>${usOnlyRows}</tbody>
      </table></div>
    </div>
  </div>

  ${statusLabel === 'completed' ? `
  <!-- Completeness -->
  <div id="tab-completeness" class="tab-pane">
    <div class="card">
      <h2 style="font-size:17px;font-weight:700;margin-bottom:8px">Field Completeness</h2>
      <p style="font-size:13px;color:#6b7280;margin-bottom:16px">
        % of completed PaymentTransactions that have each field populated.
        <span style="color:#16a34a">Green ≥ 90%</span> ·
        <span style="color:#d97706">Amber 60–89%</span> ·
        <span style="color:#dc2626">Red &lt; 60%</span>
      </p>
      <table style="max-width:720px"><thead><tr>
        <th style="${TH};width:220px">Field</th>
        <th style="${TH}">Coverage</th>
      </tr></thead><tbody>${compRows2}</tbody></table>
    </div>
  </div>` : ''}

  <div style="text-align:center;font-size:11px;color:#9ca3af;margin-top:32px;padding-bottom:20px">
    auditTransactions.js v3 &nbsp;·&nbsp; ${esc(generated)} &nbsp;·&nbsp; ${esc(statusLabel)}
  </div>
</div>

<script>
function showTab(name, btn) {
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
  btn.classList.add('active');
}
function filterTable(tbodyId, q) {
  q = q.toLowerCase();
  document.getElementById(tbodyId).querySelectorAll('tr').forEach(r => {
    r.style.display = r.textContent.toLowerCase().includes(q) ? '' : 'none';
  });
}
const CSV_DATA = ${JSON.stringify('__CSV_PLACEHOLDER__')};
function downloadCSV() {
  const blob = new Blob([CSV_DATA], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'audit-${statusLabel}.csv';
  a.click();
}
</script>
</body>
</html>`;
}

// ── CSV builder ───────────────────────────────────────────────────────────────
function buildCSV(rows) {
  const fields = [
    'source','transactionId','userName','userEmail','userId',
    'type','tierKey','packageLabel','status',
    'amount','currency','paymentMethod',
    'shares','ownershipPct','earningKobo',
    'hasProof','adminAction','adminNote',
    'createdAt','updatedAt','verifiedAt',
    'isUniform','discrepancyFields',
  ];
  const esc2 = (v) => { const s = String(v ?? '').replace(/"/g, '""'); return /[",\n\r]/.test(s) ? `"${s}"` : s; };
  return [fields.join(','), ...rows.map(r => fields.map(f => esc2(r[f] ?? '')).join(','))].join('\n');
}

// ── Build per-status report ───────────────────────────────────────────────────
function buildReport(ptRows, usRows, statusFilter) {
  const allIds = new Set([
    ...Object.keys(ptRows).filter(id => !statusFilter || ptRows[id].status === statusFilter),
    ...Object.keys(usRows).filter(id => !statusFilter || usRows[id].status === statusFilter),
  ]);

  const report = { summary: {}, inBothSources: [], ptOnly: [], usOnly: [], discrepancies: [], completeness: [] };

  for (const txId of allIds) {
    const ptRow = ptRows[txId];
    const usRow = usRows[txId];
    const ptOk  = ptRow && (!statusFilter || ptRow.status === statusFilter);
    const usOk  = usRow && (!statusFilter || usRow.status === statusFilter);

    if (ptOk && usOk) {
      const issues = diff(ptRow, usRow);
      const entry  = { transactionId: txId, ptRow, usRow, discrepancies: issues, isUniform: issues.length === 0 };
      report.inBothSources.push(entry);
      if (issues.length) report.discrepancies.push(entry);
    } else if (ptOk) {
      report.ptOnly.push({ ...ptRow, isUniform: null, discrepancyFields: 'PT only' });
    } else if (usOk) {
      report.usOnly.push({ ...usRow, isUniform: null, discrepancyFields: 'US only' });
    }
  }

  report.summary = {
    totalUniqueTransactions : report.inBothSources.length + report.ptOnly.length + report.usOnly.length,
    inBothSources           : report.inBothSources.length,
    uniform                 : report.inBothSources.filter(r => r.isUniform).length,
    withDiscrepancies       : report.discrepancies.length,
    ptOnly                  : report.ptOnly.length,
    usOnly                  : report.usOnly.length,
  };
  return report;
}

// ── Write report to disk ──────────────────────────────────────────────────────
function writeReport(report, statusLabel, generated, outDir) {
  fs.mkdirSync(outDir, { recursive: true });

  const csvRows = [
    ...report.ptOnly,
    ...report.usOnly,
    ...report.inBothSources.flatMap(e => [
      { ...e.ptRow, isUniform: e.isUniform, discrepancyFields: e.discrepancies.map(d => d.field).join(';') },
      { ...e.usRow, isUniform: e.isUniform, discrepancyFields: e.discrepancies.map(d => d.field).join(';') },
    ]),
  ];

  const csv  = buildCSV(csvRows);
  let   html = buildHTML(report, statusLabel, generated);
  html = html.replace('"__CSV_PLACEHOLDER__"', JSON.stringify(csv));

  const slug = `audit-${statusLabel}`;
  fs.writeFileSync(path.join(outDir, `${slug}.html`), html, 'utf8');
  fs.writeFileSync(path.join(outDir, `${slug}.csv`),  csv,  'utf8');
  if (statusLabel === 'all') fs.writeFileSync(path.join(outDir, `${slug}.json`), JSON.stringify(report, null, 2), 'utf8');

  // ── US-only amount summary in console ─────────────────────────────────────
  const usNaira = report.usOnly.filter(r => r.currency !== 'usdt').reduce((s, r) => s + r.amount, 0);
  const usUSDT  = report.usOnly.filter(r => r.currency === 'usdt').reduce((s, r) => s + r.amount, 0);
  const usZero  = report.usOnly.filter(r => r.amount === 0).length;

  const s = report.summary;
  console.log(`  ✅  [${statusLabel.toUpperCase()}]  total=${s.totalUniqueTransactions}  both=${s.inBothSources}  uniform=${s.uniform}  mismatch=${s.withDiscrepancies}  pt-only=${s.ptOnly}  us-only=${s.usOnly}`);
  if (report.usOnly.length > 0) {
    console.log(`       US-Only amounts: ₦${fmtAmt(usNaira)} naira  /  $${fmtAmt(usUSDT)} USDT${usZero > 0 ? `  (⚠️  ${usZero} records still ₦0 — legacy ObjectId tier not in Share model)` : '  ✓ all resolved'}`);
  }
  console.log(`       → ${path.join(outDir, slug)}.html / .csv${statusLabel === 'all' ? ' / .json' : ''}\n`);
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('🔌  Connecting to MongoDB…');
  await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
  console.log('✅  Connected\n');

  // ── TierConfig (optional) ──────────────────────────────────────────────────
  let tierConfig = null;
  if (TierConfig) {
    try {
      tierConfig = typeof TierConfig.getCurrentConfig === 'function'
        ? await TierConfig.getCurrentConfig()
        : await TierConfig.findOne().lean();
      console.log(`📦  TierConfig loaded — ${tierConfig?.tiers?.size ?? 0} tiers`);
    } catch (err) {
      console.warn('⚠️  TierConfig load failed:', err.message);
    }
  }

  // ── Legacy Share model — ObjectId-keyed tier lookup ────────────────────────
  // UserShare records created before TierConfig was introduced store
  // tierKey as a MongoDB ObjectId string (e.g. "69ccd0dc680f6f2a96815a49").
  // We build a Map<objectIdString, shareDoc> so resolveAmount can fall back
  // to the original Share document's price fields.
  const legacyShareMap = new Map();
  if (ShareModel) {
    try {
      const shareDocs = await ShareModel.find({}).lean();
      for (const doc of shareDocs) {
        legacyShareMap.set(doc._id.toString(), doc);
      }
      console.log(`📦  Legacy Share model loaded — ${legacyShareMap.size} records`);

      // Debug: print field names of first doc so we know which price field to use
      if (shareDocs.length > 0) {
        const sample = shareDocs[0];
        const priceFields = Object.keys(sample).filter(k =>
          k.toLowerCase().includes('price') || k.toLowerCase().includes('cost') || k.toLowerCase().includes('amount')
        );
        console.log(`    Sample price-related fields: ${priceFields.join(', ') || '(none found)'}`);
        console.log(`    Sample doc: ${JSON.stringify(
          Object.fromEntries(priceFields.map(f => [f, sample[f]])),
          null, 2
        )}`);
      }
    } catch (err) {
      console.warn('⚠️  Legacy Share model load failed:', err.message);
    }
  } else {
    console.warn('⚠️  Share model not available — amounts for pre-TierConfig UserShare records may show ₦0.00');
  }
  console.log('');

  const ptQuery = {};
  if (TYPE_FILTER) ptQuery.type = TYPE_FILTER;

  // ── Load PaymentTransaction ────────────────────────────────────────────────
  console.log('📥  Loading PaymentTransaction…');
  let ptDocs;
  try {
    ptDocs = await PaymentTransaction.find(ptQuery).populate('userId', 'name email username').lean();
  } catch (err) {
    console.warn('⚠️  populate(userId) failed — trying without populate:', err.message);
    ptDocs = await PaymentTransaction.find(ptQuery).lean();
  }
  console.log(`    ${ptDocs.length} records`);

  // ── Load UserShare ─────────────────────────────────────────────────────────
  console.log('📥  Loading UserShare…');
  let usDocs;
  try {
    usDocs = await UserShare.find({}).populate('user', 'name email username').lean();
  } catch (err) {
    console.warn('⚠️  populate(user) failed — trying without populate:', err.message);
    usDocs = await UserShare.find({}).lean();
  }
  console.log(`    ${usDocs.length} user documents\n`);

  // ── Normalise PaymentTransaction rows ──────────────────────────────────────
  const ptRows = {};
  for (const doc of ptDocs) {
    const row = normalise(
      doc,
      'PaymentTransaction',
      doc.userId?._id || doc.userId,
      doc.userId?.name || doc.userId?.email || doc.userName || 'Unknown',
      doc.userId?.email || doc.userEmail || '',
      tierConfig,
      legacyShareMap,
    );
    ptRows[row.transactionId] = row;
  }

  // ── Normalise UserShare rows ───────────────────────────────────────────────
  // Each UserShare document embeds an array of transaction sub-documents.
  // These sub-docs often lack `amount` (Paystack wrote the status but not the
  // price back into the UserShare subdoc).  We enrich each sub-doc with:
  //   • currency   from the parent doc if missing on the sub-doc
  //   • amount     coalesced from amount / totalAmount fields before passing
  //                to normalise / resolveAmount
  const usRows = {};
  for (const doc of usDocs) {
    const txList = doc.transactions || [];
    for (const tx of txList) {
      if (TYPE_FILTER && tx.type !== TYPE_FILTER) continue;

      // Enrich: inherit parent-level currency / amount where sub-doc is missing
      const enrichedTx = {
        ...tx,
        // Prefer sub-doc currency; fall back to parent; default naira
        currency: tx.currency || doc.currency || 'naira',
        // Coalesce all possible amount field names
        amount  : parseFloat(tx.amount ?? tx.totalAmount ?? tx.priceAmount ?? 0) || 0,
      };

      const row = normalise(
        enrichedTx,
        'UserShare',
        doc.user?._id || doc.user || doc.userId,
        doc.user?.name || doc.user?.email || doc.userName || 'Unknown',
        doc.user?.email || doc.userEmail || '',
        tierConfig,
        legacyShareMap,
      );
      usRows[row.transactionId] = row;
    }
  }

  // ── Amount resolution diagnostics ─────────────────────────────────────────
  const usZeroCount   = Object.values(usRows).filter(r => r.amount === 0).length;
  const usTotalCount  = Object.values(usRows).length;
  if (usTotalCount > 0) {
    console.log(`🔍  UserShare amount resolution: ${usTotalCount - usZeroCount}/${usTotalCount} resolved` +
      (usZeroCount > 0 ? ` — ${usZeroCount} still ₦0 (tierKey not matched in TierConfig or Share model)` : ' ✓') + '\n');
  }

  // ── Field completeness for completed transactions ──────────────────────────
  const completedPT = ptDocs.filter(d => d.status === 'completed');
  const checkFields = [
    'transactionId','type','tierKey','packageLabel','status',
    'amount','currency','paymentMethod','shares',
    'ownershipPct','earningKobo','createdAt',
    'paymentProofCloudinaryUrl','verifiedBy','verifiedAt',
  ];
  const completeness = checkFields.map(field => {
    const populated = completedPT.filter(d => d[field] != null && d[field] !== '').length;
    return {
      field,
      populated,
      total: completedPT.length,
      pct: completedPT.length ? ((populated / completedPT.length) * 100).toFixed(1) : '0.0',
    };
  });

  const generated = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  const outBase   = path.join(process.cwd(), 'audit-output');

  console.log('📊  Building reports…\n');

  for (const status of STATUSES) {
    const rpt = buildReport(ptRows, usRows, status);
    if (status === 'completed') rpt.completeness = completeness;
    writeReport(rpt, status, generated, path.join(outBase, `audit-${status}`));
  }

  if (!ONLY) {
    const all = buildReport(ptRows, usRows, null);
    all.completeness = completeness;
    writeReport(all, 'all', generated, path.join(outBase, 'audit-all'));
  }

  console.log('✅  Done.  Output folder:', outBase);
  await mongoose.disconnect();
}

main().catch(err => {
  console.error('❌  Error:', err.message);
  console.error(err.stack);
  mongoose.disconnect();
  process.exit(1);
});