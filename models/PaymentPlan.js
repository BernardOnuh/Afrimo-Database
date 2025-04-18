const mongoose = require('mongoose');

const paymentPlanSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    planType: {
      type: String,
      enum: ['share', 'cofounder'],
      required: true
    },
    totalUnits: {
      type: Number,
      required: true,
      min: 1
    },
    initialPrice: {
      type: Number,
      required: true
    },
    currency: {
      type: String,
      enum: ['naira', 'usdt'],
      default: 'naira'
    },
    amountPaid: {
      type: Number,
      default: 0
    },
    percentagePaid: {
      type: Number,
      default: 0
    },
    unitsPurchased: {
      type: Number,
      default: 0
    },
    status: {
      type: String,
      enum: ['active', 'completed', 'cancelled', 'overdue'],
      default: 'active'
    },
    penaltyFee: {
      type: Number,
      default: 0
    },
    nextPaymentDue: {
      type: Date,
      required: true
    },
    completionDeadline: {
      type: Date
    },
    payments: [
      {
        transactionId: {
          type: String,
          required: true
        },
        amount: {
          type: Number,
          required: true
        },
        percentage: {
          type: Number,
          required: true
        },
        paymentMethod: {
          type: String,
          required: true
        },
        paymentDate: {
          type: Date,
          default: Date.now
        },
        status: {
          type: String,
          enum: ['pending', 'completed', 'failed'],
          default: 'pending'
        }
      }
    ],
    currentPrice: {
      type: Number,
      required: true
    },
    basePenaltyFee: {
      type: Number,
      required: true
    }
  },
  { timestamps: true }
);

// Method to calculate current price with penalties
paymentPlanSchema.methods.getCurrentPriceWithPenalties = function() {
  return this.currentPrice + this.penaltyFee;
};

// Method to update the plan with a new payment
paymentPlanSchema.methods.addPayment = function(payment) {
  this.payments.push(payment);
  
  if (payment.status === 'completed') {
    this.amountPaid += payment.amount;
    
    // Calculate new percentage paid
    const totalPrice = this.initialPrice * this.totalUnits;
    this.percentagePaid = (this.amountPaid / totalPrice) * 100;
    
    // Calculate units purchased (rounded down to nearest whole unit)
    const pricePerUnit = this.initialPrice;
    this.unitsPurchased = Math.floor(this.amountPaid / pricePerUnit);
    
    // Reset penalties if payment is made before due date
    const now = new Date();
    if (now <= this.nextPaymentDue) {
      this.penaltyFee = 0;
    }
    
    // Update next payment due date (30 days from now)
    this.nextPaymentDue = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    
    // Check if plan is completed
    if (this.percentagePaid >= 100) {
      this.status = 'completed';
    } else {
      this.status = 'active';
    }
  }
  
  return this;
};

// Static method to apply penalties to overdue plans
paymentPlanSchema.statics.applyPenalties = async function() {
  const now = new Date();
  
  // Find all active plans with overdue payments
  const overduePlans = await this.find({
    status: 'active',
    nextPaymentDue: { $lt: now }
  });
  
  let updatedPlans = 0;
  
  for (const plan of overduePlans) {
    // Apply the appropriate penalty fee based on plan type
    plan.penaltyFee += plan.basePenaltyFee;
    plan.currentPrice += plan.basePenaltyFee; // Increase the current price too
    
    // Mark as overdue
    plan.status = 'overdue';
    
    await plan.save();
    updatedPlans++;
  }
  
  return updatedPlans;
};

// Method to calculate remaining amount to be paid
paymentPlanSchema.methods.getRemainingAmount = function() {
  const totalPrice = this.getCurrentPriceWithPenalties() * this.totalUnits;
  return totalPrice - this.amountPaid;
};

// Create the model
const PaymentPlan = mongoose.model('PaymentPlan', paymentPlanSchema);

module.exports = PaymentPlan;