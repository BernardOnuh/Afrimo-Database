// models/InstallmentPlan.js
const mongoose = require('mongoose');

const InstallmentSchema = new mongoose.Schema({
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
    enum: ['upcoming', 'pending', 'pending_verification', 'late', 'paid', 'cancelled'],
    default: 'upcoming'
  },
  percentageOfTotal: {
    type: Number,
    required: true,
    default: 20 // Default 20% of total shares per installment for 5 installments
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
  paymentProofPath: {
    type: String,
    default: null
  },
  manualPaymentDetails: {
    bankName: String,
    accountName: String,
    reference: String,
    paymentMethod: String
  },
  adminNote: {
    type: String,
    default: null
  }
}, { timestamps: true });

const InstallmentPlanSchema = new mongoose.Schema({
  planId: {
    type: String,
    required: true,
    unique: true
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'active', 'late', 'completed', 'cancelled'],
    default: 'pending'
  },
  totalShares: {
    type: Number,
    required: true
  },
  totalPrice: {
    type: Number,
    required: true
  },
  currency: {
    type: String,
    enum: ['naira', 'usdt'],
    required: true
  },
  installmentMonths: {
    type: Number,
    default: 5,
    min: 2,
    max: 12
  },
  sharesReleased: {
    type: Number,
    default: 0
  },
  lateFeePercentage: {
    type: Number,
    default: 0.34 // 0.34% per day as default
  },
  cancellationReason: {
    type: String,
    default: null
  },
  tierBreakdown: {
    tier1: {
      type: Number,
      default: 0
    },
    tier2: {
      type: Number,
      default: 0
    },
    tier3: {
      type: Number,
      default: 0
    }
  },
  installments: [InstallmentSchema]
}, { timestamps: true });

// Add installment plan statistics
InstallmentPlanSchema.statics.getStats = async function() {
  const stats = await this.aggregate([
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 },
        totalShares: { $sum: '$totalShares' },
        sharesReleased: { $sum: '$sharesReleased' },
        totalValue: { $sum: '$totalPrice' }
      }
    }
  ]);

  // Format stats by status
  const formattedStats = {};
  stats.forEach(stat => {
    formattedStats[stat._id] = {
      count: stat.count,
      totalShares: stat.totalShares,
      sharesReleased: stat.sharesReleased,
      totalValue: stat.totalValue
    };
  });

  return formattedStats;
};

module.exports = mongoose.model('InstallmentPlan', InstallmentPlanSchema);