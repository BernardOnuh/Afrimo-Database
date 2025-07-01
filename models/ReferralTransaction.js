const mongoose = require('mongoose');

const ReferralTransactionSchema = new mongoose.Schema({
  // User who receives the commission
  beneficiary: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true // Add index for better query performance
  },
  
  // User who made the purchase that generated this commission
  referredUser: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true // Add index for better query performance
  },
  
  // Amount of commission earned
  amount: {
    type: Number,
    required: true,
    min: 0 // Ensure non-negative amounts
  },
  
  // Currency of the commission
  currency: {
    type: String,
    enum: ['naira', 'usdt', 'USD'], // Added USD for compatibility
    default: 'naira'
  },
  
  // Generation level (1, 2, or 3)
  generation: {
    type: Number,
    enum: [1, 2, 3],
    required: true,
    index: true // Add index for generation-based queries
  },
  
  // Original transaction that generated this commission
  sourceTransaction: {
    type: mongoose.Schema.Types.ObjectId,
    refPath: 'sourceTransactionModel',
    index: true // Add index for rollback queries
  },
  
  // Model type for the source transaction (for flexibility)
  sourceTransactionModel: {
    type: String,
    enum: ['Transaction', 'PaymentTransaction', 'UserShare'],
    default: 'PaymentTransaction' // Updated default to match co-founder usage
  },
  
  // Purchase type that generated this commission
  purchaseType: {
    type: String,
    enum: ['share', 'cofounder', 'other'],
    default: 'share' // Changed default to 'share' as it's more common
  },
  
  // Status of the referral transaction
  status: {
    type: String,
    enum: ['pending', 'completed', 'failed', 'rolled_back'], // Added 'rolled_back' status
    default: 'completed',
    index: true // Add index for status-based queries
  },
  
  // NEW: Timestamp when transaction was rolled back (if applicable)
  rolledBackAt: {
    type: Date,
    default: null
  },
  
  // NEW: Additional notes or comments (useful for rollbacks or admin actions)
  notes: {
    type: String,
    maxlength: 500 // Limit note length
  },
  
  // NEW: Metadata for additional information (flexible object for future use)
  metadata: {
    // Share conversion details for co-founder purchases
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
      default: 29 // Default co-founder to regular share ratio
    },
    originalAmount: {
      type: Number,
      min: 0
    },
    commissionRate: {
      type: Number,
      min: 0,
      max: 100 // Percentage
    },
    // Additional flexible metadata
    additionalData: {
      type: mongoose.Schema.Types.Mixed // For any future custom data
    }
  },
  
  // NEW: Processing details
  processedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User' // Admin who processed manual transactions
  },
  
  // NEW: Commission calculation details
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
  timestamps: true // Automatically adds createdAt and updatedAt
});

// Compound indexes for better query performance
ReferralTransactionSchema.index({ beneficiary: 1, status: 1 });
ReferralTransactionSchema.index({ beneficiary: 1, generation: 1, status: 1 });
ReferralTransactionSchema.index({ sourceTransaction: 1, sourceTransactionModel: 1 });
ReferralTransactionSchema.index({ referredUser: 1, generation: 1 });
ReferralTransactionSchema.index({ createdAt: -1 }); // For sorting by newest first

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

// Static method to find commissions by source transaction
ReferralTransactionSchema.statics.findBySourceTransaction = function(transactionId, sourceModel) {
  return this.find({
    sourceTransaction: transactionId,
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
    if (Math.abs(this.amount - expectedAmount) > 0.01) { // Allow for small rounding differences
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