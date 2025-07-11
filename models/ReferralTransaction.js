// Enhanced ReferralTransaction Schema with duplicate prevention
const mongoose = require('mongoose');

const ReferralTransactionSchema = new mongoose.Schema({
  beneficiary: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  
  referredUser: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  
  currency: {
    type: String,
    enum: ['naira', 'usdt', 'USD'],
    default: 'naira'
  },
  
  generation: {
    type: Number,
    enum: [1, 2, 3],
    required: true,
    index: true
  },
  
  // FIXED: Normalize to string for consistent matching
  sourceTransaction: {
    type: String,
    required: true,
    index: true
  },
  
  sourceTransactionModel: {
    type: String,
    enum: ['Transaction', 'PaymentTransaction', 'UserShare'],
    default: 'PaymentTransaction'
  },
  
  purchaseType: {
    type: String,
    enum: ['share', 'cofounder', 'other'],
    default: 'share'
  },
  
  status: {
    type: String,
    enum: ['pending', 'completed', 'failed', 'rolled_back'],
    default: 'completed',
    index: true
  },
  
  rolledBackAt: {
    type: Date,
    default: null
  },
  
  notes: {
    type: String,
    maxlength: 500
  },
  
  metadata: {
    actualShares: { type: Number, min: 0 },
    equivalentShares: { type: Number, min: 0 },
    conversionRatio: { type: Number, min: 1, default: 29 },
    originalAmount: { type: Number, min: 0 },
    commissionRate: { type: Number, min: 0, max: 100 },
    additionalData: { type: mongoose.Schema.Types.Mixed }
  },
  
  processedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  
  commissionDetails: {
    baseAmount: { type: Number, min: 0 },
    commissionRate: { type: Number, min: 0, max: 100 },
    calculatedAt: { type: Date, default: Date.now }
  }
}, {
  timestamps: true
});

// CRITICAL: Add compound unique index to prevent duplicates
ReferralTransactionSchema.index({ 
  beneficiary: 1, 
  sourceTransaction: 1, 
  generation: 1 
}, { 
  unique: true,
  name: 'prevent_duplicate_commissions'
});

// Other indexes for performance
ReferralTransactionSchema.index({ beneficiary: 1, status: 1 });
ReferralTransactionSchema.index({ beneficiary: 1, generation: 1, status: 1 });
ReferralTransactionSchema.index({ referredUser: 1, generation: 1 });
ReferralTransactionSchema.index({ createdAt: -1 });

// FIXED: Safe commission creation with duplicate prevention
ReferralTransactionSchema.statics.createCommission = async function(commissionData) {
  try {
    // Normalize sourceTransaction to string
    const normalizedData = {
      ...commissionData,
      sourceTransaction: commissionData.sourceTransaction.toString()
    };
    
    // Check if commission already exists
    const existing = await this.findOne({
      beneficiary: normalizedData.beneficiary,
      sourceTransaction: normalizedData.sourceTransaction,
      generation: normalizedData.generation
    });
    
    if (existing) {
      console.log(`Commission already exists for beneficiary ${normalizedData.beneficiary}, transaction ${normalizedData.sourceTransaction}, generation ${normalizedData.generation}`);
      return { success: false, message: 'Commission already exists', existing };
    }
    
    // Create new commission
    const commission = new this(normalizedData);
    await commission.save();
    
    console.log(`Created commission: ${commission._id} - ${commission.formattedAmount} for generation ${commission.generation}`);
    return { success: true, commission };
    
  } catch (error) {
    if (error.code === 11000) {
      console.log('Duplicate commission prevented by unique index');
      return { success: false, message: 'Duplicate commission prevented' };
    }
    throw error;
  }
};

// FIXED: Batch commission creation with validation
ReferralTransactionSchema.statics.createBatchCommissions = async function(commissionsData) {
  const results = {
    created: [],
    duplicates: [],
    errors: []
  };
  
  for (const commissionData of commissionsData) {
    try {
      const result = await this.createCommission(commissionData);
      
      if (result.success) {
        results.created.push(result.commission);
      } else {
        results.duplicates.push({
          data: commissionData,
          reason: result.message
        });
      }
    } catch (error) {
      results.errors.push({
        data: commissionData,
        error: error.message
      });
    }
  }
  
  return results;
};

// Enhanced method to find commissions by source transaction
ReferralTransactionSchema.statics.findBySourceTransaction = function(transactionId, sourceModel) {
  return this.find({
    sourceTransaction: transactionId.toString(), // Normalize to string
    sourceTransactionModel: sourceModel
  });
};

// Method to detect and fix duplicate commissions
ReferralTransactionSchema.statics.findAndFixDuplicates = async function() {
  console.log('🔍 Scanning for duplicate commissions...');
  
  const duplicates = await this.aggregate([
    {
      $group: {
        _id: {
          beneficiary: '$beneficiary',
          sourceTransaction: '$sourceTransaction',
          generation: '$generation'
        },
        count: { $sum: 1 },
        docs: { $push: '$$ROOT' }
      }
    },
    {
      $match: {
        count: { $gt: 1 }
      }
    }
  ]);
  
  console.log(`Found ${duplicates.length} sets of duplicate commissions`);
  
  let removedCount = 0;
  
  for (const duplicate of duplicates) {
    // Keep the first one, remove the rest
    const toRemove = duplicate.docs.slice(1);
    
    for (const doc of toRemove) {
      await this.findByIdAndDelete(doc._id);
      removedCount++;
      console.log(`Removed duplicate commission: ${doc._id}`);
    }
  }
  
  console.log(`Removed ${removedCount} duplicate commissions`);
  return { duplicatesFound: duplicates.length, removedCount };
};

// Calculate total earnings for a user with validation
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
        transactionCount: { $sum: 1 },
        // Count by generation
        generation1Count: {
          $sum: { $cond: [{ $eq: ['$generation', 1] }, 1, 0] }
        },
        generation2Count: {
          $sum: { $cond: [{ $eq: ['$generation', 2] }, 1, 0] }
        },
        generation3Count: {
          $sum: { $cond: [{ $eq: ['$generation', 3] }, 1, 0] }
        }
      }
    }
  ]);
};

// Pre-save middleware with enhanced validation
ReferralTransactionSchema.pre('save', function(next) {
  // Normalize sourceTransaction to string
  if (this.sourceTransaction) {
    this.sourceTransaction = this.sourceTransaction.toString();
  }
  
  // Validate commission details
  if (this.commissionDetails && this.commissionDetails.baseAmount && this.commissionDetails.commissionRate) {
    const expectedAmount = (this.commissionDetails.baseAmount * this.commissionDetails.commissionRate) / 100;
    if (Math.abs(this.amount - expectedAmount) > 0.01) {
      return next(new Error('Commission amount does not match calculated amount'));
    }
  }
  
  // Set default commission rates
  if (!this.commissionDetails || !this.commissionDetails.commissionRate) {
    const defaultRates = { 1: 15, 2: 3, 3: 2 };
    if (!this.commissionDetails) {
      this.commissionDetails = {};
    }
    this.commissionDetails.commissionRate = defaultRates[this.generation] || 0;
  }
  
  next();
});

// Virtual for formatted amount display
ReferralTransactionSchema.virtual('formattedAmount').get(function() {
  const symbol = this.currency === 'naira' ? '₦' : this.currency === 'usdt' ? '$' : '$';
  return `${symbol}${this.amount.toFixed(2)}`;
});

const ReferralTransaction = mongoose.model('ReferralTransaction', ReferralTransactionSchema);
module.exports = ReferralTransaction;