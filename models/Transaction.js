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
  // FIXED: Changed to Mixed type to accept both ObjectId and String
  packageId: {
    type: mongoose.Schema.Types.Mixed,  // Accepts both ObjectId and String
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
      'manual_other',
      'centiiv',
      'web3',
      'crypto',
      'franchise',        // ← add this
      'franchise_credit', // ← add this (used by self-purchase)
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

// FIXED: Add method to check if packageId is a valid ObjectId
TransactionSchema.methods.isObjectIdPackage = function () {
  return mongoose.Types.ObjectId.isValid(this.packageId) && 
         typeof this.packageId !== 'string';
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

// FIXED: Add static method to find transactions by packageId (string or ObjectId)
TransactionSchema.statics.findByPackageId = function (packageId) {
  return this.find({ packageId });
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

// FIXED: Add virtual for package display
TransactionSchema.virtual('packageDisplay').get(function () {
  if (this.packageLabel) return this.packageLabel;
  if (typeof this.packageId === 'string') return this.packageId;
  return 'Unknown Package';
});

// ── Serialization ─────────────────────────────────────────────────────────────
TransactionSchema.set('toJSON', {
  virtuals: true,
  transform: (doc, ret) => { 
    delete ret.__v; 
    // Ensure packageId is always serialized properly
    if (ret.packageId && typeof ret.packageId === 'object') {
      ret.packageId = ret.packageId.toString();
    }
    return ret; 
  }
});
TransactionSchema.set('toObject', { virtuals: true });

// ── Validation ────────────────────────────────────────────────────────────────
TransactionSchema.pre('validate', function (next) {
  if (this.isManualPayment() && !this.transactionId) {
    return next(new Error('Manual payments require a transaction ID'));
  }
  
  // Validate packageId presence
  if (!this.packageId && !this.packageLabel) {
    return next(new Error('Either packageId or packageLabel is required'));
  }
  
  next();
});

// FIXED: Pre-save hook to handle packageId type consistency
TransactionSchema.pre('save', function (next) {
  // If packageId is a string that looks like an ObjectId, convert it
  if (typeof this.packageId === 'string' && mongoose.Types.ObjectId.isValid(this.packageId)) {
    // Keep as string since we're using Mixed type
    // This prevents unnecessary conversion issues
    this.packageId = this.packageId;
  }
  next();
});

// ── Logging ───────────────────────────────────────────────────────────────────
TransactionSchema.post('save', function (doc) {
  console.log(`[Transaction] ${doc.type} | ${doc.transactionId || 'N/A'} | ${doc.status} | Package: ${doc.packageDisplay || 'N/A'} | ${doc.ownershipPct || 0}%`);
});

module.exports = mongoose.model('Transaction', TransactionSchema);