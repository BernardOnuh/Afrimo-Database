// models/TransactionV2.js
const mongoose = require('mongoose');

const TransactionV2Schema = new mongoose.Schema({
  transactionId: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  type: {
    type: String,
    enum: ['share', 'co-founder'],
    required: true
  },

  // ── What was bought ──────────────────────────────────────────────────────
  shares: {
    type: Number,
    required: true,
    min: 1
  },
  tierKey: {
    type: String,
    required: true
  },

  // Per-share values (what you enter)
  pricePerShare: {
    type: Number,
    required: true,
    min: 0
  },
  ownershipPctPerShare: {
    type: Number,
    required: true   // % ownership granted per single share at this tier
  },
  earningKoboPerShare: {
    type: Number,
    default: 0       // earning in kobo per single share
  },

  // Derived totals (auto-computed: perShare × shares)
  totalAmount: {
    type: Number,
    required: true,
    min: 0           // = pricePerShare × shares
  },
  ownershipPct: {
    type: Number,
    required: true   // = ownershipPctPerShare × shares
  },
  earningKobo: {
    type: Number,
    default: 0       // = earningKoboPerShare × shares
  },

  currency: {
    type: String,
    enum: ['naira', 'usdt'],
    required: true,
    lowercase: true
  },

  status: {
    type: String,
    enum: ['completed', 'pending', 'failed', 'rejected', 'cancelled'],
    default: 'pending',
    index: true
  },

  paymentMethod: {
    type: String,
    trim: true
  },
  paymentProof: {
    type: String,
    trim: true
  },

  // Audit
  enteredBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  note: {
    type: String,
    trim: true   // e.g. "corrected from old record"
  }

}, { timestamps: true });

// ── Indexes ──────────────────────────────────────────────────────────────────
TransactionV2Schema.index({ transactionId: 1 }, { unique: true });
TransactionV2Schema.index({ userId: 1, type: 1 });
TransactionV2Schema.index({ userId: 1, status: 1 });

module.exports = mongoose.model('TransactionV2', TransactionV2Schema);