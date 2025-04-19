// models/ShareInstallment.js
const mongoose = require('mongoose');

const ShareInstallmentSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  shareType: {
    type: String,
    enum: ['regular', 'co-founder'],
    required: true
  },
  // Reference to either UserShare or PaymentTransaction 
  parentShareId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
  totalShares: {
    type: Number,
    required: true
  },
  sharesPaid: {
    type: Number,
    default: 0
  },
  percentagePaid: {
    type: Number,
    default: 0
  },
  pricePerShare: {
    type: Number,
    required: true
  },
  currency: {
    type: String,
    enum: ['naira', 'usdt'],
    required: true
  },
  totalAmount: {
    type: Number,
    required: true
  },
  amountPaid: {
    type: Number,
    default: 0
  },
  remainingAmount: {
    type: Number,
    required: true
  },
  // Array of installment payments
  payments: [
    {
      amount: {
        type: Number,
        required: true
      },
      paymentDate: {
        type: Date,
        default: Date.now
      },
      transactionId: {
        type: String,
        required: true
      },
      paymentMethod: {
        type: String,
        required: true
      },
      status: {
        type: String,
        enum: ['pending', 'completed', 'failed'],
        default: 'pending'
      },
      penalty: {
        type: Number,
        default: 0
      }
    }
  ],
  nextPaymentDue: {
    type: Date,
    required: true
  },
  installmentStatus: {
    type: String,
    enum: ['active', 'completed', 'defaulted'],
    default: 'active'
  },
  lastPaymentDate: {
    type: Date
  },
  missedPayments: {
    type: Number,
    default: 0
  },
  totalPenalty: {
    type: Number,
    default: 0
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  completedAt: {
    type: Date
  }
});

// Method to add a new payment
ShareInstallmentSchema.methods.addPayment = function(payment) {
  this.payments.push(payment);
  this.amountPaid += payment.amount;
  this.remainingAmount = this.totalAmount - this.amountPaid;
  
  // Calculate shares paid (proportional to amount paid)
  this.percentagePaid = (this.amountPaid / this.totalAmount) * 100;
  this.sharesPaid = (this.percentagePaid / 100) * this.totalShares;
  
  // Update last payment date
  this.lastPaymentDate = new Date();
  
  // Set next payment due date to 30 days from now
  this.nextPaymentDue = new Date();
  this.nextPaymentDue.setDate(this.nextPaymentDue.getDate() + 30);
  
  // Check if installment is completed
  if (this.remainingAmount <= 0) {
    this.installmentStatus = 'completed';
    this.completedAt = new Date();
  } else {
    this.installmentStatus = 'active';
  }
  
  return this.save();
};

// Method to calculate and apply penalty
ShareInstallmentSchema.methods.calculatePenalty = function() {
  const currentDate = new Date();
  
  // If next payment due date has passed
  if (currentDate > this.nextPaymentDue && this.installmentStatus === 'active') {
    // Calculate days overdue
    const daysOverdue = Math.floor((currentDate - this.nextPaymentDue) / (1000 * 60 * 60 * 24));
    
    // Only apply penalty if at least 30 days have passed since last calculation
    if (daysOverdue >= 30) {
      this.missedPayments += 1;
      
      // Calculate penalty (0.3% of remaining amount)
      const penaltyAmount = this.remainingAmount * 0.003;
      this.totalPenalty += penaltyAmount;
      
      // Add penalty to remaining amount
      this.remainingAmount += penaltyAmount;
      
      // Reset next payment due date to 30 days from now
      this.nextPaymentDue = new Date();
      this.nextPaymentDue.setDate(this.nextPaymentDue.getDate() + 30);
      
      // If missed too many payments (e.g., 3), mark as defaulted
      if (this.missedPayments >= 3) {
        this.installmentStatus = 'defaulted';
      }
      
      return {
        penaltyApplied: true,
        penaltyAmount,
        totalPenalty: this.totalPenalty,
        nextPaymentDue: this.nextPaymentDue
      };
    }
  }
  
  return {
    penaltyApplied: false,
    penaltyAmount: 0
  };
};

// Static method to get all installments due for penalty calculation
ShareInstallmentSchema.statics.getPendingPenaltyInstallments = function() {
  const currentDate = new Date();
  return this.find({
    installmentStatus: 'active',
    nextPaymentDue: { $lt: currentDate }
  });
};

// Static method to get all active installments for a user
ShareInstallmentSchema.statics.getUserActiveInstallments = function(userId) {
  return this.find({
    user: userId,
    installmentStatus: 'active'
  });
};

// Create the model
const ShareInstallment = mongoose.model('ShareInstallment', ShareInstallmentSchema);

module.exports = ShareInstallment;