// models/Transaction.js - UPDATED WITH SHARE SUPPORT
const mongoose = require('mongoose');

const TransactionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  type: {
    type: String,
    enum: ['paystack', 'crypto', 'web3', 'co-founder', 'share'], // ✅ ADDED 'share' type
    required: true
  },
  
  // ADDED: Unique transaction identifier for manual payments and other transactions
  transactionId: {
    type: String,
    unique: true,
    sparse: true,  // Allows null values but ensures uniqueness when present
    trim: true
  },
  
  amount: {
    type: Number,
    required: true
  },
  currency: {
    type: String,
    enum: ['naira', 'usdt'],
    required: true
  },
  
  // UPDATED: Enhanced payment method enum to support manual payments
  paymentMethod: {
    type: String,
    enum: [
      'paystack', 
      'crypto', 
      'web3', 
      'manual_bank_transfer', 
      'manual_cash', 
      'manual_other',
      'manual',
      'co-founder', // For backward compatibility
      'centiiv'     // ✅ ADDED for Centiiv payments
    ],
    required: true
  },
  
  // ADDED: File storage path for payment proofs (manual payments)
  paymentProofData: {
    type: Buffer,
    required: false
  },
  paymentProofContentType: {
    type: String,
    required: false
  },
  // Keep paymentProofPath for backward compatibility
  paymentProofPath: {
    type: String,
    required: false
  },
  
  // ✅ ADDED: Additional file metadata for better file handling
  paymentProofFilename: {
    type: String,
    required: false
  },
  paymentProofOriginalName: {
    type: String,
    required: false
  },
    
  // ADDED: Manual payment details structure
  manualPaymentDetails: {
    bankName: {
      type: String,
      default: null,
      trim: true
    },
    accountName: {
      type: String,
      default: null,
      trim: true
    },
    reference: {
      type: String,
      default: null,
      trim: true
    }
  },
  
  // ✅ ADDED: Tier breakdown for share purchases
  tierBreakdown: {
    tier1: { type: Number, default: 0 },
    tier2: { type: Number, default: 0 },
    tier3: { type: Number, default: 0 }
  },
  
  // ✅ ADDED: Centiiv payment fields
  centiivOrderId: {
    type: String,
    required: false,
    trim: true
  },
  centiivInvoiceUrl: {
    type: String,
    required: false,
    trim: true
  },
  
  // ADDED: Admin verification and notes
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
  },
  
  // Existing fields
  txHash: {
    type: String,
    trim: true
  },
  walletAddress: {
    type: String,
    trim: true
  },
  shares: {
    type: Number,
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'completed', 'failed'],
    default: 'pending'
  },
  verified: {
    type: Boolean,
    default: false
  },
  reference: {
    type: String,
    trim: true
  },
  details: {
    type: Object
  },
  
  // ADDED: Additional tracking fields
  notes: {
    type: String,
    default: null,
    trim: true
  },
  
  // Track if this was processed by admin
  adminProcessed: {
    type: Boolean,
    default: false
  },
  
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true // This will automatically handle createdAt and updatedAt
});

// ADDED: Indexes for better query performance
TransactionSchema.index({ userId: 1 });
TransactionSchema.index({ type: 1 });
TransactionSchema.index({ status: 1 });
TransactionSchema.index({ paymentMethod: 1 });
TransactionSchema.index({ transactionId: 1 });
TransactionSchema.index({ createdAt: -1 });
TransactionSchema.index({ type: 1, status: 1 }); // Compound index for common queries
TransactionSchema.index({ type: 1, paymentMethod: 1 }); // For manual payment queries
TransactionSchema.index({ centiivOrderId: 1 }); // ✅ ADDED for Centiiv lookups

// ADDED: Pre-save middleware to ensure updatedAt is set
TransactionSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// ADDED: Instance method to check if transaction is manual payment
TransactionSchema.methods.isManualPayment = function() {
  return this.paymentMethod && this.paymentMethod.toString().startsWith('manual_');
};

// ADDED: Instance method to get clean payment method name (without manual_ prefix)
TransactionSchema.methods.getCleanPaymentMethod = function() {
  if (this.paymentMethod && this.paymentMethod.toString().startsWith('manual_')) {
    return this.paymentMethod.replace('manual_', '');
  }
  return this.paymentMethod;
};

// ADDED: Instance method to check if transaction has payment proof
TransactionSchema.methods.hasPaymentProof = function() {
  return !!(this.paymentProofPath && this.paymentProofPath.trim() !== '');
};

// ✅ UPDATED: Instance method to get payment proof URL
TransactionSchema.methods.getPaymentProofUrl = function() {
  if (this.hasPaymentProof() && this.transactionId) {
    if (this.type === 'co-founder') {
      return `/cofounder/payment-proof/${this.transactionId}`;
    } else if (this.type === 'share') {
      return `/shares/payment-proof/${this.transactionId}`;
    }
    return `/payment-proof/${this.transactionId}`;
  }
  return null;
};

// ADDED: Static method to find manual payments
TransactionSchema.statics.findManualPayments = function(conditions = {}) {
  return this.find({
    ...conditions,
    paymentMethod: { $regex: /^manual_/i }
  });
};

// ADDED: Static method to find co-founder transactions
TransactionSchema.statics.findCoFounderTransactions = function(conditions = {}) {
  return this.find({
    ...conditions,
    type: 'co-founder'
  });
};

// ✅ ADDED: Static method to find share transactions
TransactionSchema.statics.findShareTransactions = function(conditions = {}) {
  return this.find({
    ...conditions,
    type: 'share'
  });
};

// ✅ ADDED: Static method to find share manual payments specifically
TransactionSchema.statics.findShareManualPayments = function(conditions = {}) {
  return this.find({
    ...conditions,
    type: 'share',
    paymentMethod: { $regex: /^manual_/i }
  });
};

// ADDED: Static method to find pending manual payments for admin review
TransactionSchema.statics.findPendingManualPayments = function(transactionType = null) {
  const query = {
    status: 'pending',
    paymentMethod: { $regex: /^manual_/i }
  };
  
  if (transactionType) {
    query.type = transactionType;
  }
  
  return this.find(query)
    .populate('userId', 'name email phone')
    .sort({ createdAt: -1 });
};

// ✅ ADDED: Static method to find Centiiv transactions
TransactionSchema.statics.findCentiivTransactions = function(conditions = {}) {
  return this.find({
    ...conditions,
    paymentMethod: 'centiiv'
  });
};

// ✅ ADDED: Static method to find by Centiiv order ID
TransactionSchema.statics.findByCentiivOrderId = function(orderId) {
  return this.findOne({
    centiivOrderId: orderId
  });
};

// ADDED: Static method to get transaction statistics
TransactionSchema.statics.getTransactionStats = async function(type = null) {
  const matchStage = type ? { type } : {};
  
  const stats = await this.aggregate([
    { $match: matchStage },
    {
      $group: {
        _id: {
          status: '$status',
          paymentMethod: '$paymentMethod'
        },
        count: { $sum: 1 },
        totalAmount: { $sum: '$amount' }
      }
    },
    {
      $group: {
        _id: '$_id.status',
        methods: {
          $push: {
            paymentMethod: '$_id.paymentMethod',
            count: '$count',
            totalAmount: '$totalAmount'
          }
        },
        totalCount: { $sum: '$count' },
        totalAmount: { $sum: '$totalAmount' }
      }
    }
  ]);
  
  return stats;
};

// ✅ ADDED: Static method to get share purchase statistics
TransactionSchema.statics.getSharePurchaseStats = async function() {
  const stats = await this.aggregate([
    { $match: { type: 'share', status: 'completed' } },
    {
      $group: {
        _id: null,
        totalShares: { $sum: '$shares' },
        totalAmount: { $sum: '$amount' },
        totalTransactions: { $sum: 1 },
        tier1Shares: { $sum: '$tierBreakdown.tier1' },
        tier2Shares: { $sum: '$tierBreakdown.tier2' },
        tier3Shares: { $sum: '$tierBreakdown.tier3' },
        avgAmount: { $avg: '$amount' },
        avgShares: { $avg: '$shares' }
      }
    }
  ]);
  
  return stats.length > 0 ? stats[0] : null;
};

// ADDED: Virtual for formatted amount display
TransactionSchema.virtual('formattedAmount').get(function() {
  const symbol = this.currency === 'naira' ? '₦' : '$';
  return `${symbol}${this.amount.toLocaleString()}`;
});

// ADDED: Virtual for display-friendly payment method
TransactionSchema.virtual('displayPaymentMethod').get(function() {
  return this.getCleanPaymentMethod();
});

// ADDED: Virtual for status display with color coding
TransactionSchema.virtual('statusDisplay').get(function() {
  const statusMap = {
    'pending': { text: 'Pending', color: 'orange' },
    'completed': { text: 'Completed', color: 'green' },
    'failed': { text: 'Failed', color: 'red' }
  };
  
  return statusMap[this.status] || { text: this.status, color: 'gray' };
});

// ✅ ADDED: Virtual for transaction type display
TransactionSchema.virtual('typeDisplay').get(function() {
  const typeMap = {
    'paystack': 'Paystack',
    'crypto': 'Cryptocurrency',
    'web3': 'Web3 Wallet',
    'co-founder': 'Co-Founder Share',
    'share': 'Regular Share',
    'centiiv': 'Centiiv Invoice'
  };
  
  return typeMap[this.type] || this.type;
});

// ✅ ADDED: Virtual for shares display with type context
TransactionSchema.virtual('sharesDisplay').get(function() {
  if (this.type === 'co-founder') {
    return `${this.shares} Co-Founder Share${this.shares !== 1 ? 's' : ''}`;
  } else if (this.type === 'share') {
    return `${this.shares} Regular Share${this.shares !== 1 ? 's' : ''}`;
  }
  return `${this.shares} Share${this.shares !== 1 ? 's' : ''}`;
});

// ADDED: Ensure virtual fields are serialized
TransactionSchema.set('toJSON', { 
  virtuals: true,
  transform: function(doc, ret) {
    // Remove sensitive fields from JSON output
    delete ret.__v;
    delete ret.paymentProofData; // Don't expose binary data in JSON
    return ret;
  }
});

TransactionSchema.set('toObject', { virtuals: true });

// ADDED: Validation for manual payment requirements
TransactionSchema.pre('validate', function(next) {
  // If it's a manual payment, ensure we have either payment proof or admin notes
  if (this.isManualPayment() && this.status === 'pending') {
    if (!this.paymentProofPath && !this.adminNotes) {
      return next(new Error('Manual payments require either payment proof or admin notes'));
    }
  }
  
  // Ensure transactionId is present for manual payments
  if (this.isManualPayment() && !this.transactionId) {
    return next(new Error('Manual payments require a transaction ID'));
  }
  
  // ✅ ADDED: Validation for Centiiv transactions
  if (this.paymentMethod === 'centiiv' && !this.centiivOrderId) {
    return next(new Error('Centiiv payments require an order ID'));
  }
  
  // ✅ ADDED: Validation for share transactions
  if (this.type === 'share' && (!this.tierBreakdown || 
      (this.tierBreakdown.tier1 + this.tierBreakdown.tier2 + this.tierBreakdown.tier3) !== this.shares)) {
    return next(new Error('Share transactions require valid tier breakdown'));
  }
  
  next();
});

// ✅ ADDED: Post-save middleware for logging
TransactionSchema.post('save', function(doc) {
  console.log(`[Transaction] ${doc.type} transaction ${doc.transactionId} saved with status: ${doc.status}`);
});

// ✅ ADDED: Post-update middleware for logging
TransactionSchema.post('findOneAndUpdate', function(doc) {
  if (doc) {
    console.log(`[Transaction] ${doc.type} transaction ${doc.transactionId} updated with status: ${doc.status}`);
  }
});

const Transaction = mongoose.model('Transaction', TransactionSchema);

module.exports = Transaction;