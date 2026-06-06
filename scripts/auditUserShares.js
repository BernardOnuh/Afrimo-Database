'use strict';

/**
 * auditUserShares.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Focused report showing users that have shares with PaymentTransaction and 
 * UserShare data side-by-side for easy comparison.
 *
 * Usage:
 *   node auditUserShares.js                     ← all users with shares
 *   node auditUserShares.js --only completed    ← only completed transactions
 *   node auditUserShares.js --type co-founder   ← filter by transaction type
 * ─────────────────────────────────────────────────────────────────────────────
 */

require('dotenv').config();
const mongoose = require('mongoose');
const fs       = require('fs');
const path     = require('path');

// ── Model imports ─────────────────────────────────────────────────────────────
let User;
const possibleUserPaths = [
  '../models/User',
  '../models/user',
  '../models/users/User',
];
for (const p of possibleUserPaths) {
  try { User = require(p); break; } catch (_) { /* try next */ }
}
if (!User) console.warn('⚠️  User model not found');

const PaymentTransaction = require('../models/Transaction');
const UserShare          = require('../models/UserShare');

let TierConfig;
try { TierConfig = require('../models/TierConfig'); } catch (_) {
  console.warn('⚠️  TierConfig model not found');
}

// ── CLI args ──────────────────────────────────────────────────────────────────
const args        = process.argv.slice(2);
const flagVal     = (f) => { const i = args.indexOf(f); return i !== -1 ? args[i + 1] : null; };
const ONLY        = flagVal('--only') || null;
const TYPE_FILTER = flagVal('--type') || null;

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmtDate = (d) => d ? new Date(d).toISOString().replace('T', ' ').slice(0, 19) : '—';
const fmtAmt  = (n) => (parseFloat(n) || 0).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtPct  = (n) => ((parseFloat(n) || 0) * 100).toFixed(2) + '%';
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
  transactionId : raw.transactionId || raw._id?.toString() || 'N/A',
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
  createdAt     : fmtDate(raw.createdAt),
  updatedAt     : fmtDate(raw.updatedAt || raw.createdAt),
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
const STATUS_COLORS = { completed: '#16a34a', pending: '#d97706', failed: '#dc2626' };

const statusBadge = (s) => {
  const c = STATUS_COLORS[s?.toLowerCase()] || '#6b7280';
  return `<span style="background:${c};color:#fff;padding:2px 9px;border-radius:9999px;font-size:11px;font-weight:600">${esc(s || '—')}</span>`;
};

const matchBadge = (ok) =>
  ok ? `<span style="background:#dcfce7;color:#166534;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700">✓ Match</span>`
     : `<span style="background:#fee2e2;color:#991b1b;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700">✗ Mismatch</span>`;

// ── Build User Report ─────────────────────────────────────────────────────────
function buildUserReport(ptRows, usRows, statusFilter) {
  // Group by userId instead of transactionId
  const userMap = new Map();

  // Process PaymentTransactions
  for (const [txId, ptRow] of Object.entries(ptRows)) {
    if (statusFilter && ptRow.status !== statusFilter) continue;
    const userId = ptRow.userId;
    if (!userMap.has(userId)) {
      userMap.set(userId, {
        userId,
        userName: ptRow.userName,
        userEmail: ptRow.userEmail,
        ptTransactions: [],
        usTransactions: [],
      });
    }
    userMap.get(userId).ptTransactions.push(ptRow);
  }

  // Process UserShares
  for (const [txId, usRow] of Object.entries(usRows)) {
    if (statusFilter && usRow.status !== statusFilter) continue;
    const userId = usRow.userId;
    if (!userMap.has(userId)) {
      userMap.set(userId, {
        userId,
        userName: usRow.userName,
        userEmail: usRow.userEmail,
        ptTransactions: [],
        usTransactions: [],
      });
    }
    userMap.get(userId).usTransactions.push(usRow);
  }

  // Build report data
  const users = [];
  for (const user of userMap.values()) {
    // Find matching transactions by ID
    const matchedTransactions = [];
    const unmatchedPT = [];
    const unmatchedUS = [];

    const ptMap = new Map(user.ptTransactions.map(pt => [pt.transactionId, pt]));
    const usMap = new Map(user.usTransactions.map(us => [us.transactionId, us]));

    // Find matches
    const allTxIds = new Set([...ptMap.keys(), ...usMap.keys()]);
    for (const txId of allTxIds) {
      const ptRow = ptMap.get(txId);
      const usRow = usMap.get(txId);
      
      if (ptRow && usRow) {
        const issues = diff(ptRow, usRow);
        matchedTransactions.push({
          transactionId: txId,
          ptRow,
          usRow,
          discrepancies: issues,
          isUniform: issues.length === 0,
        });
      } else if (ptRow) {
        unmatchedPT.push(ptRow);
      } else if (usRow) {
        unmatchedUS.push(usRow);
      }
    }

    const totalShares = user.ptTransactions.reduce((sum, tx) => sum + (tx.shares || 0), 0);
    const totalAmount = user.ptTransactions.reduce((sum, tx) => sum + (tx.amount || 0), 0);
    const avgOwnership = user.ptTransactions.reduce((sum, tx) => sum + (tx.ownershipPct || 0), 0) / (user.ptTransactions.length || 1);

    users.push({
      ...user,
      matchedTransactions,
      unmatchedPT,
      unmatchedUS,
      summary: {
        totalPT: user.ptTransactions.length,
        totalUS: user.usTransactions.length,
        matchedCount: matchedTransactions.length,
        uniformCount: matchedTransactions.filter(m => m.isUniform).length,
        mismatchedCount: matchedTransactions.filter(m => !m.isUniform).length,
        totalShares,
        totalAmount,
        avgOwnershipPct: avgOwnership,
      }
    });
  }

  // Sort by total shares (highest first)
  users.sort((a, b) => b.summary.totalShares - a.summary.totalShares);
  
  return users;
}

// ── HTML page builder ─────────────────────────────────────────────────────────
function buildHTML(users, statusLabel, generated) {
  const TH = 'padding:9px 10px;background:#f9fafb;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#6b7280;border-bottom:2px solid #e5e7eb;white-space:nowrap;text-align:left';
  const TD = 'padding:7px 10px;font-size:12px;border-bottom:1px solid #f3f4f6';

  const totalUsers = users.length;
  const totalShares = users.reduce((sum, u) => sum + u.summary.totalShares, 0);
  const totalAmount = users.reduce((sum, u) => sum + u.summary.totalAmount, 0);
  const matchedTotal = users.reduce((sum, u) => sum + u.summary.matchedCount, 0);
  const mismatchedTotal = users.reduce((sum, u) => sum + u.summary.mismatchedCount, 0);

  // Build user rows
  const userRows = users.map((user, index) => {
    const matchStatus = user.summary.matchedCount === user.summary.totalPT && 
                       user.summary.matchedCount === user.summary.totalUS &&
                       user.summary.mismatchedCount === 0;
    
    return `<tr id="user-row-${user.userId}" style="border-bottom:1px solid #e5e7eb">
      <td style="${TD};text-align:center;width:40px">
        <input type="checkbox" id="checkbox-${user.userId}" onchange="toggleUserComplete('${user.userId}')" style="width:18px;height:18px;cursor:pointer">
      </td>
      <td style="${TD}">
        <strong>${esc(user.userName)}</strong><br>
        <span style="color:#9ca3af;font-size:10px">ID: ${esc(user.userId)}</span><br>
        <span style="color:#9ca3af;font-size:10px">${esc(user.userEmail)}</span>
      </td>
      <td style="${TD};text-align:center">${user.summary.totalShares}</td>
      <td style="${TD};text-align:right">₦${fmtAmt(user.summary.totalAmount)}</td>
      <td style="${TD};text-align:center">${user.summary.totalPT}</td>
      <td style="${TD};text-align:center">${user.summary.totalUS}</td>
      <td style="${TD};text-align:center">${user.summary.matchedCount}</td>
      <td style="${TD};text-align:center">${matchBadge(matchStatus)}</td>
      <td style="${TD};text-align:center">
        <button onclick="toggleUserDetails('${user.userId}')" style="background:#e5e7eb;border:none;padding:4px 12px;border-radius:4px;font-size:10px;cursor:pointer;font-weight:600">▼ Details</button>
      </td>
    </tr>`;
  }).join('');

  // Build detailed transaction rows for each user
  const userDetails = users.map(user => {
    const matchedRows = user.matchedTransactions.map(m => {
      const diffFields = new Set(m.discrepancies.map(d => d.field));
      const cellStyle = (field, value, isPT = true) => {
        const differs = diffFields.has(field);
        if (differs) {
          return `<span style="background:#fee2e2;color:#991b1b;padding:2px 6px;border-radius:3px;font-weight:700">${esc(value)}</span>`;
        }
        return esc(value);
      };

      return `<div style="margin-bottom:15px;border-left:3px solid ${m.isUniform ? '#86efac' : '#fca5a5'};padding-left:12px">
        <div style="display:flex;justify-content:space-between;margin-bottom:8px">
          <code style="font-size:11px;font-weight:700">${esc(m.transactionId)}</code>
          ${matchBadge(m.isUniform)}
        </div>
        <table style="width:100%;margin-bottom:10px;background:#f9fafb;border-radius:6px">
          <thead><tr>
            <th style="padding:6px 8px;font-size:10px;background:#e5e7eb">Field</th>
            <th style="padding:6px 8px;font-size:10px;background:#dbeafe">PaymentTransaction</th>
            <th style="padding:6px 8px;font-size:10px;background:#ede9fe">UserShare</th>
          </tr></thead>
          <tbody>
            ${COMPARABLE.map(field => `
              <tr>
                <td style="padding:5px 8px;font-size:11px;font-family:monospace">${field}</td>
                <td style="padding:5px 8px;font-size:11px">${cellStyle(field, m.ptRow[field] ?? '—', true)}</td>
                <td style="padding:5px 8px;font-size:11px">${cellStyle(field, m.usRow[field] ?? '—', false)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>`;
    }).join('');

    const unmatchedPTRows = user.unmatchedPT.map(tx => `
      <div style="margin-bottom:8px;padding:8px;background:#dbeafe;border-radius:4px">
        <code style="font-size:10px">${esc(tx.transactionId)}</code> - 
        ₦${fmtAmt(tx.amount)} - ${tx.shares} shares - ${statusBadge(tx.status)}
      </div>
    `).join('') || '<div style="color:#9ca3af;font-size:11px">None</div>';

    const unmatchedUSRows = user.unmatchedUS.map(tx => `
      <div style="margin-bottom:8px;padding:8px;background:#ede9fe;border-radius:4px">
        <code style="font-size:10px">${esc(tx.transactionId)}</code> - 
        ₦${fmtAmt(tx.amount)} - ${tx.shares} shares - ${statusBadge(tx.status)}
      </div>
    `).join('') || '<div style="color:#9ca3af;font-size:11px">None</div>';

    return `<div id="user-detail-${user.userId}" class="user-detail" style="display:none;background:#f9fafb;padding:15px;margin:5px 0 15px 0;border-radius:8px">
      <h4 style="margin-bottom:12px;font-size:14px;color:#374151">📋 Transaction Details - ${esc(user.userName)} (${esc(user.userId)})</h4>
      
      <div style="margin-bottom:20px">
        <h5 style="font-size:12px;color:#1d4ed8;margin-bottom:8px">✓ Matched Transactions (${user.matchedTransactions.length})</h5>
        ${matchedRows || '<div style="color:#9ca3af;font-size:11px">No matched transactions</div>'}
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:15px;margin-bottom:15px">
        <div>
          <h5 style="font-size:12px;color:#2563eb;margin-bottom:8px">⚠️ PT Only (${user.unmatchedPT.length})</h5>
          ${unmatchedPTRows}
        </div>
        <div>
          <h5 style="font-size:12px;color:#7c3aed;margin-bottom:8px">⚠️ UserShare Only (${user.unmatchedUS.length})</h5>
          ${unmatchedUSRows}
        </div>
      </div>
      
      <div style="margin-top:10px;padding:8px;background:#e5e7eb;border-radius:4px">
        <label style="cursor:pointer;display:flex;align-items:center;gap:8px">
          <input type="checkbox" id="detail-checkbox-${user.userId}" onchange="syncCheckbox('${user.userId}')">
          <span style="font-size:12px;font-weight:500">✓ Mark this user as reviewed/completed</span>
        </label>
      </div>
    </div>`;
  }).join('');

  // Load saved checkbox states from localStorage
  const loadScript = `
    <script>
    function loadCheckboxStates() {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('audit_completed_')) {
          const userId = key.replace('audit_completed_', '');
          const isChecked = localStorage.getItem(key) === 'true';
          const checkbox = document.getElementById('checkbox-' + userId);
          const detailCheckbox = document.getElementById('detail-checkbox-' + userId);
          if (checkbox) checkbox.checked = isChecked;
          if (detailCheckbox) detailCheckbox.checked = isChecked;
          
          // Style the row if completed
          const row = document.getElementById('user-row-' + userId);
          if (row && isChecked) {
            row.style.backgroundColor = '#f0fdf4';
            row.style.opacity = '0.85';
          } else if (row) {
            row.style.backgroundColor = '';
            row.style.opacity = '';
          }
        }
      }
    }
    
    function toggleUserComplete(userId) {
      const checkbox = document.getElementById('checkbox-' + userId);
      const detailCheckbox = document.getElementById('detail-checkbox-' + userId);
      const isChecked = checkbox.checked;
      
      if (detailCheckbox) detailCheckbox.checked = isChecked;
      localStorage.setItem('audit_completed_' + userId, isChecked);
      
      // Visual feedback
      const row = document.getElementById('user-row-' + userId);
      if (row) {
        if (isChecked) {
          row.style.backgroundColor = '#f0fdf4';
          row.style.opacity = '0.85';
        } else {
          row.style.backgroundColor = '';
          row.style.opacity = '';
        }
      }
      
      // Update stats
      updateCompletedStats();
    }
    
    function syncCheckbox(userId) {
      const detailCheckbox = document.getElementById('detail-checkbox-' + userId);
      const mainCheckbox = document.getElementById('checkbox-' + userId);
      if (mainCheckbox && detailCheckbox) {
        mainCheckbox.checked = detailCheckbox.checked;
        localStorage.setItem('audit_completed_' + userId, detailCheckbox.checked);
        
        const row = document.getElementById('user-row-' + userId);
        if (row) {
          if (detailCheckbox.checked) {
            row.style.backgroundColor = '#f0fdf4';
            row.style.opacity = '0.85';
          } else {
            row.style.backgroundColor = '';
            row.style.opacity = '';
          }
        }
        
        updateCompletedStats();
      }
    }
    
    function updateCompletedStats() {
      let completed = 0;
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('audit_completed_') && localStorage.getItem(key) === 'true') {
          completed++;
        }
      }
      const statsDiv = document.getElementById('completedStats');
      if (statsDiv) {
        statsDiv.innerHTML = '<span style="background:#dcfce7;color:#166534;padding:8px 15px;border-radius:8px;font-weight:700">✓ Completed: ' + completed + ' / ${totalUsers} users</span>';
      }
    }
    
    function resetAllCheckboxes() {
      if (confirm('Are you sure you want to reset all checkboxes?')) {
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && key.startsWith('audit_completed_')) {
            localStorage.removeItem(key);
          }
        }
        location.reload();
      }
    }
    
    function filterUsers() {
      const input = document.getElementById('searchInput');
      const filter = input.value.toLowerCase();
      const table = document.getElementById('userTableBody');
      const rows = table.getElementsByTagName('tr');
      
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const text = row.textContent || row.innerText;
        if (text.toLowerCase().indexOf(filter) > -1) {
          row.style.display = '';
        } else {
          row.style.display = 'none';
          // Also hide associated detail view
          const userId = row.getAttribute('data-user-id') || row.cells[1]?.querySelector('strong')?.textContent;
          if (userId) {
            const detail = document.getElementById('user-detail-' + userId);
            if (detail) detail.style.display = 'none';
          }
        }
      }
    }
    
    // Load states on page load
    document.addEventListener('DOMContentLoaded', function() {
      loadCheckboxStates();
      updateCompletedStats();
    });
    </script>
  `;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>User Share Audit — ${esc(statusLabel?.toUpperCase() || 'ALL')} — ${esc(generated)}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f3f4f6;color:#111827;padding:20px}
  .container{max-width:1400px;margin:0 auto}
  .header{background:#fff;border-radius:12px;padding:20px;margin-bottom:20px;box-shadow:0 1px 3px rgba(0,0,0,0.1)}
  .stats{display:flex;gap:15px;margin-top:15px;flex-wrap:wrap}
  .stat-card{background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:15px;flex:1;min-width:150px}
  .stat-value{font-size:24px;font-weight:800;color:#1d4ed8}
  .stat-label{font-size:12px;color:#6b7280;margin-top:4px}
  table{width:100%;border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1)}
  th{background:#f9fafb}
  .user-detail{margin-bottom:10px}
  .btn{background:#1d4ed8;color:#fff;padding:8px 16px;border:none;border-radius:6px;cursor:pointer;font-size:13px}
  .btn:hover{background:#1e40af}
  input[type="text"]{width:300px;padding:8px 12px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;margin-bottom:20px;margin-right:10px}
  .action-bar{display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap}
  .reset-btn{background:#ef4444;color:#fff;padding:8px 16px;border:none;border-radius:6px;cursor:pointer;font-size:13px}
  .reset-btn:hover{background:#dc2626}
</style>
${loadScript}
</head>
<body>
<div class="container">
  <div class="header">
    <h1 style="font-size:24px;margin-bottom:8px">👥 Users with Shares</h1>
    <p style="color:#6b7280;font-size:13px">Generated: ${esc(generated)} ${statusLabel ? `| Status: ${esc(statusLabel)}` : ''}</p>
    
    <div class="stats">
      <div class="stat-card"><div class="stat-value">${totalUsers}</div><div class="stat-label">Total Users</div></div>
      <div class="stat-card"><div class="stat-value">${totalShares}</div><div class="stat-label">Total Shares</div></div>
      <div class="stat-card"><div class="stat-value">₦${fmtAmt(totalAmount)}</div><div class="stat-label">Total Amount</div></div>
      <div class="stat-card"><div class="stat-value">${matchedTotal}</div><div class="stat-label">Matched TX</div></div>
      <div class="stat-card"><div class="stat-value">${mismatchedTotal}</div><div class="stat-label">Mismatched TX</div></div>
      <div class="stat-card" id="completedStats"><div class="stat-value">—</div><div class="stat-label">Completed</div></div>
    </div>
  </div>

  <div class="action-bar">
    <div>
      <input type="text" id="searchInput" placeholder="🔍 Search by name, email or ID..." onkeyup="filterUsers()">
      <button onclick="resetAllCheckboxes()" class="reset-btn">Reset All Checkboxes</button>
    </div>
    <div style="font-size:12px;color:#6b7280">
      💡 Check boxes to track which users you've reviewed
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th style="${TH};width:50px;text-align:center">✓</th>
        <th style="${TH}">User</th>
        <th style="${TH};text-align:center">Shares</th>
        <th style="${TH};text-align:right">Total Amount</th>
        <th style="${TH};text-align:center">PT Count</th>
        <th style="${TH};text-align:center">US Count</th>
        <th style="${TH};text-align:center">Matched</th>
        <th style="${TH};text-align:center">Status</th>
        <th style="${TH};text-align:center">Actions</th>
      </tr>
    </thead>
    <tbody id="userTableBody">
      ${userRows}
    </tbody>
  </table>

  <div id="userDetailsContainer">
    ${userDetails}
  </div>
</div>
</body>
</html>`;
}

// ── CSV builder for users ─────────────────────────────────────────────────────
function buildCSV(users) {
  const fields = [
    'userName', 'userEmail', 'userId',
    'totalShares', 'totalAmount', 'ptCount', 'usCount',
    'matchedCount', 'uniformCount', 'mismatchedCount',
    'matchedTxIds', 'unmatchedPTTxIds', 'unmatchedUSTxIds'
  ];
  
  const esc2 = (v) => {
    const s = String(v ?? '').replace(/"/g, '""');
    return /[",\n\r]/.test(s) ? `"${s}"` : s;
  };
  
  return [
    fields.join(','),
    ...users.map(u => fields.map(f => {
      if (f === 'totalShares') return u.summary.totalShares;
      if (f === 'totalAmount') return u.summary.totalAmount;
      if (f === 'ptCount') return u.summary.totalPT;
      if (f === 'usCount') return u.summary.totalUS;
      if (f === 'matchedCount') return u.summary.matchedCount;
      if (f === 'uniformCount') return u.summary.uniformCount;
      if (f === 'mismatchedCount') return u.summary.mismatchedCount;
      if (f === 'matchedTxIds') return u.matchedTransactions.map(m => m.transactionId).join(';');
      if (f === 'unmatchedPTTxIds') return u.unmatchedPT.map(t => t.transactionId).join(';');
      if (f === 'unmatchedUSTxIds') return u.unmatchedUS.map(t => t.transactionId).join(';');
      return esc2(u[f]);
    }).join(',')).join('\n')
  ].join('\n');
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('🔌 Connecting to MongoDB…');
  await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
  console.log('✅ Connected\n');

  let tierConfig = null;
  if (TierConfig) {
    try {
      tierConfig = typeof TierConfig.getCurrentConfig === 'function'
        ? await TierConfig.getCurrentConfig()
        : await TierConfig.findOne().lean();
    } catch (err) {
      console.warn('⚠️ TierConfig load failed:', err.message);
    }
  }

  const ptQuery = {};
  if (TYPE_FILTER) ptQuery.type = TYPE_FILTER;

  console.log('📥 Loading PaymentTransaction…');
  let ptDocs;
  try {
    ptDocs = await PaymentTransaction.find(ptQuery).populate('userId', 'name email username').lean();
  } catch (err) {
    console.warn('⚠️ populate(userId) failed:', err.message);
    ptDocs = await PaymentTransaction.find(ptQuery).lean();
  }
  console.log(`    ${ptDocs.length} records`);

  console.log('📥 Loading UserShare…');
  let usDocs;
  try {
    usDocs = await UserShare.find({}).populate('user', 'name email username').lean();
  } catch (err) {
    console.warn('⚠️ populate(user) failed:', err.message);
    usDocs = await UserShare.find({}).lean();
  }
  console.log(`    ${usDocs.length} user documents\n`);

  // Normalise PT rows
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

  // Normalise US rows
  const usRows = {};
  for (const doc of usDocs) {
    const txList = doc.transactions || [];
    for (const tx of txList) {
      if (TYPE_FILTER && tx.type !== TYPE_FILTER) continue;
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
  const outDir = path.join(process.cwd(), 'audit-output', 'user-shares');
  fs.mkdirSync(outDir, { recursive: true });

  // Build report for each status
  const statuses = ONLY ? [ONLY] : ['all', 'completed', 'pending', 'failed'];
  
  for (const status of statuses) {
    const statusFilter = status === 'all' ? null : status;
    const users = buildUserReport(ptRows, usRows, statusFilter);
    const html = buildHTML(users, status, generated);
    const csv = buildCSV(users);
    
    const slug = `user-shares-${status}`;
    fs.writeFileSync(path.join(outDir, `${slug}.html`), html, 'utf8');
    fs.writeFileSync(path.join(outDir, `${slug}.csv`), csv, 'utf8');
    
    console.log(`✅ [${status.toUpperCase()}] ${users.length} users with shares → ${path.join(outDir, slug)}.html / .csv`);
  }

  console.log('\n✅ Done. Output folder:', outDir);
  await mongoose.disconnect();
}

main().catch(err => {
  console.error('❌ Error:', err.message);
  console.error(err.stack);
  mongoose.disconnect();
  process.exit(1);
});