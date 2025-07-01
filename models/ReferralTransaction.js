const mongoose = require('mongoose');

const ReferralTransactionSchema = new mongoose.Schema({
  // User who receives the commission
  beneficiary: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  
  // User who made the purchase that generated this commission
  referredUser: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  
  // Amount of commission earned
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  
  // Currency of the commission
  currency: {
    type: String,
    enum: ['naira', 'usdt', 'USD'],
    default: 'naira'
  },
  
  // Generation level (1, 2, or 3)
  generation: {
    type: Number,
    enum: [1, 2, 3],
    required: true,
    index: true
  },
  
  // FIXED: Original transaction that generated this commission - now supports both ObjectId and String
  sourceTransaction: {
    type: mongoose.Schema.Types.Mixed, // Changed from ObjectId to Mixed to support both
    index: true
  },
  
  // Model type for the source transaction
  sourceTransactionModel: {
    type: String,
    enum: ['Transaction', 'PaymentTransaction', 'UserShare'],
    default: 'PaymentTransaction'
  },
  
  // Purchase type that generated this commission
  purchaseType: {
    type: String,
    enum: ['share', 'cofounder', 'other'],
    default: 'share'
  },
  
  // Status of the referral transaction
  status: {
    type: String,
    enum: ['pending', 'completed', 'failed', 'rolled_back'],
    default: 'completed',
    index: true
  },
  
  // Timestamp when transaction was rolled back (if applicable)
  rolledBackAt: {
    type: Date,
    default: null
  },
  
  // Additional notes or comments
  notes: {
    type: String,
    maxlength: 500
  },
  
  // Metadata for additional information
  metadata: {
    actualShares: {
      type: Number,
      min: 0
    },
    equivalentShares: {
      type: Number,
      min: 0
    },
    conversionRatio: {
      type: Number,
      min: 1,
      default: 29
    },
    originalAmount: {
      type: Number,
      min: 0
    },
    commissionRate: {
      type: Number,
      min: 0,
      max: 100
    },
    additionalData: {
      type: mongoose.Schema.Types.Mixed
    }
  },
  
  // Processing details
  processedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  
  // Commission calculation details
  commissionDetails: {
    baseAmount: {
      type: Number,
      min: 0
    },
    commissionRate: {
      type: Number,
      min: 0,
      max: 100
    },
    calculatedAt: {
      type: Date,
      default: Date.now
    }
  }
}, {
  timestamps: true
});

// Compound indexes for better query performance
ReferralTransactionSchema.index({ beneficiary: 1, status: 1 });
ReferralTransactionSchema.index({ beneficiary: 1, generation: 1, status: 1 });
ReferralTransactionSchema.index({ sourceTransaction: 1, sourceTransactionModel: 1 });
ReferralTransactionSchema.index({ referredUser: 1, generation: 1 });
ReferralTransactionSchema.index({ createdAt: -1 });

// Virtual for formatted amount display
ReferralTransactionSchema.virtual('formattedAmount').get(function() {
  const symbol = this.currency === 'naira' ? '₦' : this.currency === 'usdt' ? '$' : '$';
  return `${symbol}${this.amount.toFixed(2)}`;
});

// Instance method to check if transaction can be rolled back
ReferralTransactionSchema.methods.canRollback = function() {
  return this.status === 'completed' && !this.rolledBackAt;
};

// Instance method to rollback transaction
ReferralTransactionSchema.methods.rollback = function(reason = 'Transaction rollback') {
  this.status = 'rolled_back';
  this.rolledBackAt = new Date();
  this.notes = reason;
  return this.save();
};

// FIXED: Static method to find commissions by source transaction (handles both ObjectId and String)
ReferralTransactionSchema.statics.findBySourceTransaction = function(transactionId, sourceModel) {
  return this.find({
    sourceTransaction: transactionId, // Works with both ObjectId and String now
    sourceTransactionModel: sourceModel
  });
};

// Static method to calculate total earnings for a user
ReferralTransactionSchema.statics.calculateUserEarnings = function(userId) {
  return this.aggregate([
    {
      $match: {
        beneficiary: mongoose.Types.ObjectId(userId),
        status: 'completed'
      }
    },
    {
      $group: {
        _id: null,
        totalEarnings: { $sum: '$amount' },
        generation1Earnings: {
          $sum: { $cond: [{ $eq: ['$generation', 1] }, '$amount', 0] }
        },
        generation2Earnings: {
          $sum: { $cond: [{ $eq: ['$generation', 2] }, '$amount', 0] }
        },
        generation3Earnings: {
          $sum: { $cond: [{ $eq: ['$generation', 3] }, '$amount', 0] }
        },
        transactionCount: { $sum: 1 }
      }
    }
  ]);
};

// Pre-save middleware to validate commission details
ReferralTransactionSchema.pre('save', function(next) {
  // Ensure commission details are consistent
  if (this.commissionDetails && this.commissionDetails.baseAmount && this.commissionDetails.commissionRate) {
    const expectedAmount = (this.commissionDetails.baseAmount * this.commissionDetails.commissionRate) / 100;
    if (Math.abs(this.amount - expectedAmount) > 0.01) {
      return next(new Error('Commission amount does not match calculated amount'));
    }
  }
  
  // Set default commission rates based on generation if not provided
  if (!this.commissionDetails || !this.commissionDetails.commissionRate) {
    const defaultRates = { 1: 15, 2: 3, 3: 2 };
    if (!this.commissionDetails) {
      this.commissionDetails = {};
    }
    this.commissionDetails.commissionRate = defaultRates[this.generation] || 0;
  }
  
  next();
});

// Post-save middleware for logging
ReferralTransactionSchema.post('save', function(doc) {
  console.log(`ReferralTransaction saved: ${doc._id} - ${doc.formattedAmount} commission for generation ${doc.generation} (${doc.purchaseType})`);
});

const ReferralTransaction = mongoose.model('ReferralTransaction', ReferralTransactionSchema);
module.exports = ReferralTransaction;