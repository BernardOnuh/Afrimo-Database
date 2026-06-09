'use strict';

/**
 * auditTransactions.js  (v2-Enhanced)
 * ─────────────────────────────────────────────────────────────────────────────
 * TOTAL USER SHARE & DATE FILTERING:
 * 
 *   Filters by:
 *   - Total User Share: ₦0 to ₦100,000 (sum of all user transactions)
 *   - Status: Only "completed"
 *   - Date ranges: Separate reports for:
 *       * Period 1: 2025-01-01 to 2026-02-28
 *       * Period 2: 2026-03-01 to today
 *
 * Output structure:
 *   audit-output/
 *     audit-completed-jan-2025-to-feb-2026/
 *     audit-completed-mar-2026-to-present/
 *
 * Usage:
 *   node auditTransactions-enhanced.js
 *   node auditTransactions-enhanced.js --min-amount 0 --max-amount 100000
 *   node auditTransactions-enhanced.js --type co-founder
 * ─────────────────────────────────────────────────────────────────────────────
 */

require('dotenv').config();
const mongoose = require('mongoose');
const fs       = require('fs');
const path     = require('path');

// ── Model imports ─────────────────────────────────────────────────────────────
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

// ── CLI args & config ─────────────────────────────────────────────────────────
const args        = process.argv.slice(2);
const flagVal     = (f) => { const i = args.indexOf(f); return i !== -1 ? args[i + 1] : null; };

const MIN_AMOUNT  = parseFloat(flagVal('--min-amount')) || 0;
const MAX_AMOUNT  = parseFloat(flagVal('--max-amount')) || 100000;
const TYPE_FILTER = flagVal('--type') || null;

// Date ranges: Period 1 = Jan 2025 to Feb 2026, Period 2 = Mar 2026 to today
const PERIOD_1_START = new Date('2025-01-01T00:00:00Z');
const PERIOD_1_END   = new Date('2026-02-28T23:59:59Z');
const PERIOD_2_START = new Date('2026-03-01T00:00:00Z');
const PERIOD_2_END   = new Date(); // Today

const PERIODS = [
  { label: 'jan-2025-to-feb-2026', start: PERIOD_1_START, end: PERIOD_1_END, slug: 'completed-jan-2025-to-feb-2026' },
  { label: 'mar-2026-to-present', start: PERIOD_2_START, end: PERIOD_2_END, slug: 'completed-mar-2026-to-present' },
];

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmtDate = (d) => d ? new Date(d).toISOString().replace('T', ' ').slice(0, 19) : '—';
const fmtAmt  = (n) => (parseFloat(n) || 0).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtPct  = (n) => ((parseFloat(n) || 0) * 100).toFixed(7) + '%';
const esc     = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const resolveAmount = (tx, tierConfig) => {
  let amt = parseFloat(tx.amount ?? tx.totalAmount ?? 0) || 0;
  if (amt === 0 && tx.tierKey && tierConfig) {
    const tier = tierConfig.tiers?.get?.(tx.tierKey);
    if (tier) {
      const cur = (tx.currency || 'naira').toLowerCase();
      amt = (cur === 'usdt' ? tier.priceUSD : tier.priceNGN) * (parseFloat(tx.shares) || 1);
    }
  }
  return amt;
};

const normalise = (raw, source, userId, userName, userEmail, tierConfig) => ({
  source,
  transactionId : raw.transactionId || 'N/A',
  userId        : (userId || raw.userId || '').toString(),
  userName      : userName || 'Unknown',
  userEmail     : userEmail || '',
  type          : raw.type || 'share',
  tierKey       : raw.tierKey || raw.packageId || '',
  packageLabel  : raw.packageLabel || '',
  status        : (raw.status || '').toLowerCase(),
  amount        : resolveAmount(raw, tierConfig),
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

// ── Side-by-side comparison rows ──────────────────────────────────────────────
function buildComparisonRows(inBothSources) {
  if (!inBothSources.length) {
    return `<tr><td colspan="14" style="padding:20px;text-align:center;color:#9ca3af">No transactions found in both sources.</td></tr>`;
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
        <td style="${cellStyle('amount', ';text-align:right')}">${row.currency === 'naira' ? '₦' : '$'}${fmtAmt(row.amount)}</td>
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
    <td style="${b};text-align:right">${r.currency === 'naira' ? '₦' : '$'}${fmtAmt(r.amount)}</td>
    <td style="${b}">${esc(r.paymentMethod)}</td>
    <td style="${b}">${esc(r.tierKey) || '—'}</td>
    <td style="${b}">${esc(r.packageLabel) || '—'}</td>
    <td style="${b};text-align:center">${r.shares}</td>
    <td style="${b};white-space:nowrap">${esc(r.createdAt)}</td>
  </tr>`).join('');
}

// ── HTML page builder ─────────────────────────────────────────────────────────
function buildHTML(report, periodLabel, generated) {
  const s = report.summary;
  const statusColor = '#16a34a';
  const TH = 'padding:9px 10px;background:#f9fafb;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#6b7280;border-bottom:2px solid #e5e7eb;white-space:nowrap;text-align:left';

  const card = (label, value, sub, color) =>
    `<div style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:18px 22px;min-width:140px;flex:1">
       <div style="font-size:26px;font-weight:800;color:${color}">${value}</div>
       <div style="font-size:13px;font-weight:600;color:#374151;margin-top:2px">${label}</div>
       ${sub ? `<div style="font-size:11px;color:#9ca3af;margin-top:3px">${sub}</div>` : ''}
     </div>`;

  const totalRevenue = [...report.ptOnly, ...report.inBothSources.map(e => e.ptRow)]
    .reduce((sum, r) => sum + (r.amount || 0), 0);

  const compRows    = buildComparisonRows(report.inBothSources);
  const ptOnlyRows  = buildSingleRows(report.ptOnly);
  const usOnlyRows  = buildSingleRows(report.usOnly);

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
            <th style="padding:8px 12px;background:#eff6ff;font-size:11px;font-weight:700;text-align:left;border-bottom:1px solid #fecaca;text-transform:uppercase">PaymentTransaction</th>
            <th style="padding:8px 12px;background:#faf5ff;font-size:11px;font-weight:700;text-align:left;border-bottom:1px solid #fecaca;text-transform:uppercase">UserShare</th>
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
        </div>
      </div>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Audit — COMPLETED ₦0–100K — ${esc(periodLabel)}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f3f4f6;color:#111827}
  table{width:100%;border-collapse:collapse}
  code{background:#f3f4f6;padding:1px 4px;border-radius:3px;font-size:11px}
  .card{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:24px;margin-bottom:24px;overflow:hidden}
  .scroll{overflow-x:auto}
  .tab-btn{padding:8px 18px;border:none;background:#f3f4f6;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;color:#374151;transition:.15s}
  .tab-btn.active{background:#16a34a;color:#fff}
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
        <span style="background:#16a34a;color:#fff;padding:4px 14px;border-radius:9999px;font-size:13px;font-weight:700;text-transform:uppercase">Completed ₦0–100K</span>
      </div>
      <div style="font-size:13px;color:#9ca3af;margin-top:5px">
        Generated: ${esc(generated)} &nbsp;·&nbsp; Period: <b>${esc(periodLabel)}</b>
        ${TYPE_FILTER ? ` &nbsp;·&nbsp; Type: <b>${esc(TYPE_FILTER)}</b>` : ''}
      </div>
    </div>
    <div style="display:flex;gap:10px;flex-wrap:wrap">
      <button onclick="downloadCSV()" style="padding:9px 18px;background:#16a34a;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer">⬇ Download CSV</button>
      <button onclick="window.print()" style="padding:9px 18px;background:#374151;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer">🖨 Print</button>
    </div>
  </div>

  <div style="display:flex;flex-wrap:wrap;gap:14px;margin-bottom:24px">
    ${card('Total Unique', s.totalUniqueTransactions, 'across both sources', '#16a34a')}
    ${card('In Both Sources', s.inBothSources, 'PT + UserShare', '#374151')}
    ${card('✓ Uniform', s.uniform, 'fields match exactly', '#059669')}
    ${card('✗ Mismatches', s.withDiscrepancies, 'need investigation', '#dc2626')}
    ${card('PT Only', s.ptOnly, 'missing from UserShare', '#2563eb')}
    ${card('UserShare Only', s.usOnly, 'missing from PaymentTx', '#7c3aed')}
    ${card('Total Revenue', '₦' + fmtAmt(totalRevenue), 'all completed PT', '#059669')}
  </div>

  <div style="display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap">
    <button class="tab-btn active" onclick="showTab('comparison',this)">Side-by-Side (${s.inBothSources})</button>
    <button class="tab-btn" onclick="showTab('discrepancies',this)">Mismatches (${s.withDiscrepancies})</button>
    <button class="tab-btn" onclick="showTab('ptonly',this)">PT Only (${s.ptOnly})</button>
    <button class="tab-btn" onclick="showTab('usonly',this)">US Only (${s.usOnly})</button>
  </div>

  <!-- Side-by-Side -->
  <div id="tab-comparison" class="tab-pane active">
    <div class="card">
      <h2 style="font-size:17px;font-weight:700;margin-bottom:10px">Side-by-Side Comparison</h2>
      <p style="font-size:13px;color:#6b7280;margin-bottom:12px">
        Red highlights show field differences between PaymentTransaction <span style="background:#1d4ed8;color:#fff;padding:1px 6px;border-radius:3px;font-size:11px">PT</span> and UserShare <span style="background:#7c3aed;color:#fff;padding:1px 6px;border-radius:3px;font-size:11px">US</span>.
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
        Every comparable field is shown for each mismatched transaction.
      </p>
      ${discrepancyBlocks}
    </div>
  </div>

  <!-- PT Only -->
  <div id="tab-ptonly" class="tab-pane">
    <div class="card">
      <h2 style="font-size:17px;font-weight:700;margin-bottom:8px">PaymentTransaction Only</h2>
      <p style="font-size:13px;color:#6b7280;margin-bottom:16px">
        Exist in <b>PaymentTransaction</b> but <b>no matching UserShare record</b>.
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
      <p style="font-size:13px;color:#6b7280;margin-bottom:16px">
        Exist in <b>UserShare</b> but <b>no PaymentTransaction record</b>.
      </p>
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

  <div style="text-align:center;font-size:11px;color:#9ca3af;margin-top:32px;padding-bottom:20px">
    auditTransactions.js v2-Enhanced &nbsp;·&nbsp; ${esc(generated)} &nbsp;·&nbsp; ₦0–100,000 Completed
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
  a.download = 'audit-completed-0-100k.csv';
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

// ── Build report for a specific period ────────────────────────────────────────
function buildReport(ptRows, usRows, periodStart, periodEnd) {
  // Step 1: Filter by date range and collect transactions
  const candidateRows = {};
  const userAmountByTx = {}; // Track which user+tx we've already counted

  // Collect PT rows by date
  for (const id in ptRows) {
    const r = ptRows[id];
    const createdDate = new Date(r.createdAt);
    if (createdDate >= periodStart && createdDate <= periodEnd) {
      candidateRows[id] = r;
      // Mark this transaction as counted for this user
      userAmountByTx[r.userId + ':' + id] = r.amount || 0;
    }
  }

  // Collect US rows by date (don't double-count if already in PT)
  for (const id in usRows) {
    const r = usRows[id];
    const createdDate = new Date(r.createdAt);
    if (createdDate >= periodStart && createdDate <= periodEnd) {
      if (!candidateRows[id]) {
        candidateRows[id] = r;
        userAmountByTx[r.userId + ':' + id] = r.amount || 0;
      }
    }
  }

  // Step 2: Calculate user totals (each transaction counted once)
  const userTotals = {};
  for (const key in userAmountByTx) {
    const userId = key.split(':')[0];
    const amount = userAmountByTx[key];
    if (!userTotals[userId]) userTotals[userId] = 0;
    userTotals[userId] += amount;
  }

  // Step 3: Filter users by total amount range (₦0–100K inclusive)
  const validUserIds = new Set();
  for (const userId in userTotals) {
    const total = Math.round(userTotals[userId] * 100) / 100; // Round to 2 decimals
    if (total >= MIN_AMOUNT && total <= MAX_AMOUNT) {
      validUserIds.add(userId);
    }
  }

  // Step 4: Filter rows to only include transactions from valid users
  const filtered = {};
  for (const id in candidateRows) {
    const r = candidateRows[id];
    if (validUserIds.has(r.userId)) {
      filtered[id] = r;
    }
  }

  const report = { summary: {}, inBothSources: [], ptOnly: [], usOnly: [], discrepancies: [] };

  for (const txId of Object.keys(filtered)) {
    const ptRow = filtered[txId]?.source === 'PaymentTransaction' ? filtered[txId] : ptRows[txId];
    const usRow = filtered[txId]?.source === 'UserShare' ? filtered[txId] : usRows[txId];

    const ptOk = ptRow && ptRow.status === 'completed';
    const usOk = usRow && usRow.status === 'completed';

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
function writeReport(report, periodLabel, periodSlug, generated, outDir) {
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
  let   html = buildHTML(report, periodLabel, generated);
  html = html.replace('"__CSV_PLACEHOLDER__"', JSON.stringify(csv));

  fs.writeFileSync(path.join(outDir, `audit-${periodSlug}.html`), html, 'utf8');
  fs.writeFileSync(path.join(outDir, `audit-${periodSlug}.csv`),  csv,  'utf8');

  const s = report.summary;
  console.log(`  ✅  [${periodLabel.toUpperCase()}]  total=${s.totalUniqueTransactions}  both=${s.inBothSources}  uniform=${s.uniform}  mismatch=${s.withDiscrepancies}  pt-only=${s.ptOnly}  us-only=${s.usOnly}`);
  console.log(`       → ${path.join(outDir, `audit-${periodSlug}`)}.html / .csv\n`);
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n🔍  FILTERS: Amount ₦${fmtAmt(MIN_AMOUNT)}–${fmtAmt(MAX_AMOUNT)} | Status: completed only\n`);
  console.log('🔌  Connecting to MongoDB…');
  await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
  console.log('✅  Connected\n');

  let tierConfig = null;
  if (TierConfig) {
    try {
      tierConfig = typeof TierConfig.getCurrentConfig === 'function'
        ? await TierConfig.getCurrentConfig()
        : await TierConfig.findOne().lean();
    } catch (err) {
      console.warn('⚠️  TierConfig load failed:', err.message);
    }
  }

  const ptQuery = { status: 'completed' };
  if (TYPE_FILTER) ptQuery.type = TYPE_FILTER;

  // ── Load PaymentTransaction ─────────────────────────────────────────────────
  console.log('📥  Loading PaymentTransaction (status=completed)…');
  let ptDocs;
  try {
    ptDocs = await PaymentTransaction.find(ptQuery).populate('userId', 'name email username').lean();
  } catch (err) {
    console.warn('⚠️  populate(userId) failed — trying without:', err.message);
    ptDocs = await PaymentTransaction.find(ptQuery).lean();
  }
  console.log(`    ${ptDocs.length} records\n`);

  // ── Load UserShare ──────────────────────────────────────────────────────────
  console.log('📥  Loading UserShare…');
  let usDocs;
  try {
    usDocs = await UserShare.find({}).populate('user', 'name email username').lean();
  } catch (err) {
    console.warn('⚠️  populate(user) failed — trying without:', err.message);
    usDocs = await UserShare.find({}).lean();
  }
  console.log(`    ${usDocs.length} user documents\n`);

  // ── Normalise ───────────────────────────────────────────────────────────────
  const ptRows = {};
  for (const doc of ptDocs) {
    const row = normalise(
      doc, 'PaymentTransaction',
      doc.userId?._id || doc.userId,
      doc.userId?.name || doc.userId?.email || doc.userName || 'Unknown',
      doc.userId?.email || doc.userEmail || '',
      tierConfig,
    );
    ptRows[row.transactionId] = row;
  }

  const usRows = {};
  for (const doc of usDocs) {
    const txList = doc.transactions || [];
    for (const tx of txList) {
      if (TYPE_FILTER && tx.type !== TYPE_FILTER) continue;
      if (tx.status !== 'completed') continue; // Only completed
      const row = normalise(
        tx, 'UserShare',
        doc.user?._id || doc.user || doc.userId,
        doc.user?.name || doc.user?.email || doc.userName || 'Unknown',
        doc.user?.email || doc.userEmail || '',
        tierConfig,
      );
      usRows[row.transactionId] = row;
    }
  }

  const generated = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  const outBase   = path.join(process.cwd(), 'audit-output');

  console.log('📊  Building period-separated reports…\n');

  for (const period of PERIODS) {
    const rpt = buildReport(ptRows, usRows, period.start, period.end);
    writeReport(rpt, period.label, period.slug, generated, path.join(outBase, `audit-${period.slug}`));
  }

  console.log(`✅  Done.  Output folder: ${outBase}\n`);
  console.log(`📋  Report folders:\n`);
  PERIODS.forEach(p => {
    console.log(`    • audit-output/audit-${p.slug}/`);
  });

  await mongoose.disconnect();
}

main().catch(err => {
  console.error('❌  Error:', err.message);
  console.error(err.stack);
  mongoose.disconnect();
  process.exit(1);
});