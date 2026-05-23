const mongoose = require('mongoose');

const TransactionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },

  type: {
    type: String,
    enum: ['co-founder', 'share'],
    required: true
  },

  transactionId: {
    type: String,
    unique: true,
    sparse: true,
    trim: true
  },

  // Package info (replaces shares/tiers system)
  packageId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SharePackage',
    required: false
  },
  packageLabel: {
    type: String,
    trim: true
  },
  ownershipPct: {
    type: Number,
    default: 0
  },
  earningKobo: {
    type: Number,
    default: 0
  },

  // Payment details
  amount: {
    type: Number,
    required: true
  },
  currency: {
    type: String,
    enum: ['naira', 'usdt'],
    required: true
  },
  paymentMethod: {
    type: String,
    enum: [
      'manual_bank_transfer',
      'manual_cash',
      'manual_other'
    ],
    required: true
  },

  // Manual payment details
  manualPaymentDetails: {
    bankName:    { type: String, default: null, trim: true },
    accountName: { type: String, default: null, trim: true },
    reference:   { type: String, default: null, trim: true }
  },

  // Payment proof (Cloudinary only)
  paymentProofPath:         { type: String, trim: true },
  paymentProofCloudinaryUrl:{ type: String, trim: true },
  paymentProofCloudinaryId: { type: String, trim: true },
  paymentProofOriginalName: { type: String, trim: true },
  paymentProofFileSize:     { type: Number },
  paymentProofFormat:       { type: String, trim: true },

  // Status & admin
  status: {
    type: String,
    enum: ['pending', 'completed', 'failed'],
    default: 'pending'
  },
  adminNotes: {
    type: String,
    default: null,
    trim: true
  },
  verifiedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  verifiedAt: {
    type: Date,
    default: null
  }

}, { timestamps: true });

// ── Indexes ──────────────────────────────────────────────────────────────────
TransactionSchema.index({ userId: 1 });
TransactionSchema.index({ type: 1 });
TransactionSchema.index({ status: 1 });
TransactionSchema.index({ paymentMethod: 1 });
TransactionSchema.index({ transactionId: 1 });
TransactionSchema.index({ createdAt: -1 });
TransactionSchema.index({ type: 1, status: 1 });
TransactionSchema.index({ type: 1, paymentMethod: 1 });

// ── Instance methods ──────────────────────────────────────────────────────────
TransactionSchema.methods.isManualPayment = function () {
  return this.paymentMethod?.startsWith('manual_');
};

TransactionSchema.methods.getCleanPaymentMethod = function () {
  return this.paymentMethod?.replace('manual_', '') || this.paymentMethod;
};

TransactionSchema.methods.hasPaymentProof = function () {
  return !!(this.paymentProofCloudinaryUrl || this.paymentProofPath);
};

TransactionSchema.methods.getPaymentProofUrl = function () {
  if (!this.hasPaymentProof() || !this.transactionId) return null;
  const base = this.type === 'co-founder' ? '/cofounder' : '/shares';
  return `${base}/payment-proof/${this.transactionId}`;
};

// ── Static methods ────────────────────────────────────────────────────────────
TransactionSchema.statics.findPendingManual = function (type = null) {
  const query = {
    status: 'pending',
    paymentMethod: { $regex: /^manual_/i }
  };
  if (type) query.type = type;
  return this.find(query)
    .populate('userId', 'name email phone')
    .sort({ createdAt: -1 });
};

TransactionSchema.statics.findByType = function (type, conditions = {}) {
  return this.find({ ...conditions, type });
};

// ── Virtuals ──────────────────────────────────────────────────────────────────
TransactionSchema.virtual('formattedAmount').get(function () {
  const symbol = this.currency === 'naira' ? '₦' : '$';
  return `${symbol}${this.amount.toLocaleString()}`;
});

TransactionSchema.virtual('displayPaymentMethod').get(function () {
  return this.getCleanPaymentMethod();
});

TransactionSchema.virtual('statusDisplay').get(function () {
  return {
    pending:   { text: 'Pending',   color: 'orange' },
    completed: { text: 'Completed', color: 'green'  },
    failed:    { text: 'Failed',    color: 'red'    }
  }[this.status] || { text: this.status, color: 'gray' };
});

// ── Serialization ─────────────────────────────────────────────────────────────
TransactionSchema.set('toJSON', {
  virtuals: true,
  transform: (doc, ret) => { delete ret.__v; return ret; }
});
TransactionSchema.set('toObject', { virtuals: true });

// ── Validation ────────────────────────────────────────────────────────────────
TransactionSchema.pre('validate', function (next) {
  if (this.isManualPayment() && !this.transactionId) {
    return next(new Error('Manual payments require a transaction ID'));
  }
  next();
});

// ── Logging ───────────────────────────────────────────────────────────────────
TransactionSchema.post('save', function (doc) {
  console.log(`[Transaction] ${doc.type} | ${doc.transactionId} | ${doc.status} | ${doc.ownershipPct}%`);
});

module.exports = mongoose.model('Transaction', TransactionSchema);