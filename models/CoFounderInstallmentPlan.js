// models/CoFounderInstallmentPlan.js
const mongoose = require('mongoose');

const installmentSchema = new mongoose.Schema({
  installmentNumber: {
    type: Number,
    required: true
  },
  amount: {
    type: Number,
    required: true
  },
  dueDate: {
    type: Date,
    required: true
  },
  status: {
    type: String,
    enum: ['upcoming', 'pending', 'completed', 'overdue'],
    default: 'upcoming'
  },
  percentageOfTotal: {
    type: Number,
    required: true
  },
  sharesReleased: {
    type: Number,
    default: 0
  },
  lateFee: {
    type: Number,
    default: 0
  },
  paidAmount: {
    type: Number,
    default: 0
  },
  paidDate: {
    type: Date,
    default: null
  },
  transactionId: {
    type: String,
    default: null
  },
  isFirstPayment: {
    type: Boolean,
    default: false
  },
  minimumAmount: {
    type: Number,
    default: 0
  },
  adminNote: {
    type: String,
    default: null
  },
  paymentInitialized: {
    type: Boolean,
    default: false
  },
  paymentInitializedAt: {
    type: Date,
    default: null
  }
});

const coFounderInstallmentPlanSchema = new mongoose.Schema({
  planId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  totalShares: {
    type: Number,
    required: true,
    min: 1
  },
  totalPrice: {
    type: Number,
    required: true,
    min: 0
  },
  currency: {
    type: String,
    enum: ['naira', 'usdt'],
    required: true
  },
  installmentMonths: {
    type: Number,
    required: true,
    min: 2,
    max: 12
  },
  minimumDownPaymentAmount: {
    type: Number,
    required: true
  },
  minimumDownPaymentPercentage: {
    type: Number,
    required: true,
    default: 25 // 25% for co-founder shares (higher than regular shares)
  },
  lateFeePercentage: {
    type: Number,
    default: 0.5 // 0.5% per month (higher than regular shares)
  },
  status: {
    type: String,
    enum: ['pending', 'active', 'late', 'completed', 'cancelled'],
    default: 'pending',
    index: true
  },
  sharesReleased: {
    type: Number,
    default: 0
  },
  totalPaidAmount: {
    type: Number,
    default: 0
  },
  currentLateFee: {
    type: Number,
    default: 0
  },
  monthsLate: {
    type: Number,
    default: 0
  },
  lastLateCheckDate: {
    type: Date,
    default: null
  },
  pricePerShare: {
    type: Number,
    required: true
  },
  installments: [installmentSchema],
  cancellationReason: {
    type: String,
    default: null
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Update the updatedAt field before saving
coFounderInstallmentPlanSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

// Add indexes for better query performance
coFounderInstallmentPlanSchema.index({ user: 1, status: 1 });
coFounderInstallmentPlanSchema.index({ status: 1, updatedAt: -1 });
coFounderInstallmentPlanSchema.index({ createdAt: -1 });

// Static method to start a session for transactions
coFounderInstallmentPlanSchema.statics.startSession = function() {
  return mongoose.startSession();
};

// Instance method to calculate remaining balance
coFounderInstallmentPlanSchema.methods.getRemainingBalance = function() {
  return this.totalPrice - this.totalPaidAmount;
};

// Instance method to calculate completion percentage
coFounderInstallmentPlanSchema.methods.getCompletionPercentage = function() {
  return (this.totalPaidAmount / this.totalPrice) * 100;
};

// Instance method to get next pending installment
coFounderInstallmentPlanSchema.methods.getNextPendingInstallment = function() {
  return this.installments.find(installment => 
    installment.status === 'pending' || installment.status === 'upcoming'
  );
};

// Instance method to get overdue installments
coFounderInstallmentPlanSchema.methods.getOverdueInstallments = function() {
  const now = new Date();
  return this.installments.filter(installment => 
    installment.status !== 'completed' && installment.dueDate < now
  );
};

// Virtual field for remaining shares
coFounderInstallmentPlanSchema.virtual('remainingShares').get(function() {
  return this.totalShares - this.sharesReleased;
});

// Virtual field for is overdue
coFounderInstallmentPlanSchema.virtual('isOverdue').get(function() {
  return this.getOverdueInstallments().length > 0;
});

// Ensure virtual fields are serialized
coFounderInstallmentPlanSchema.set('toJSON', { virtuals: true });
coFounderInstallmentPlanSchema.set('toObject', { virtuals: true });

// Add validation for installments array
coFounderInstallmentPlanSchema.pre('validate', function(next) {
  if (this.installments && this.installments.length !== this.installmentMonths) {
    return next(new Error('Number of installments must match installmentMonths'));
  }
  
  // Validate that exactly one installment is marked as first payment
  if (this.installments) {
    const firstPayments = this.installments.filter(inst => inst.isFirstPayment);
    if (firstPayments.length !== 1) {
      return next(new Error('Exactly one installment must be marked as first payment'));
    }
  }
  
  next();
});

// Add compound index for efficient queries
coFounderInstallmentPlanSchema.index({ 
  user: 1, 
  status: 1, 
  updatedAt: -1 
});

const CoFounderInstallmentPlan = mongoose.model('CoFounderInstallmentPlan', coFounderInstallmentPlanSchema);

module.exports = CoFounderInstallmentPlan;