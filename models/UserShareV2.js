// models/UserShareV2.js
const mongoose = require('mongoose');

// This is DERIVED — always recomputed from TransactionV2.
// Never write to it directly; use recalculateUserShare helper.
const UserShareV2Schema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },

  // Confirmed ownership only (status: completed)
  totalOwnershipPct     : { type: Number, default: 0 },
  regularOwnershipPct   : { type: Number, default: 0 },
  cofounderOwnershipPct : { type: Number, default: 0 },

  // Pending (not yet confirmed)
  pendingOwnershipPct   : { type: Number, default: 0 },

  // Earnings
  totalEarningKobo      : { type: Number, default: 0 },

  // Investment totals (completed only)
  totalInvestedNaira    : { type: Number, default: 0 },
  totalInvestedUSDT     : { type: Number, default: 0 },

  // Transaction count (all statuses)
  transactionCount      : { type: Number, default: 0 },

  // When this snapshot was last recomputed
  lastRecalculatedAt    : { type: Date, default: Date.now }

}, { timestamps: true });

module.exports = mongoose.model('UserShareV2', UserShareV2Schema);