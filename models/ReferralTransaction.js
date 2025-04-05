const mongoose = require('mongoose');

const ReferralTransactionSchema = new mongoose.Schema({
  // User who receives the commission
  beneficiary: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  // User who made the purchase that generated this commission
  referredUser: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  // Amount of commission earned
  amount: {
    type: Number,
    required: true
  },
  // Currency of the commission
  currency: {
    type: String,
    enum: ['naira', 'usdt'],
    default: 'naira'
  },
  // Generation level (1, 2, or 3)
  generation: {
    type: Number,
    enum: [1, 2, 3],
    required: true
  },
  // Original transaction that generated this commission
  sourceTransaction: {
    type: mongoose.Schema.Types.ObjectId,
    refPath: 'sourceTransactionModel'
  },
  // Model type for the source transaction (for flexibility)
  sourceTransactionModel: {
    type: String,
    enum: ['Transaction', 'PaymentTransaction', 'UserShare'],
    default: 'Transaction'
  },
  // Purchase type that generated this commission
  purchaseType: {
    type: String,
    enum: ['share', 'cofounder', 'other'],
    default: 'other'
  },
  // Status of the referral transaction
  status: {
    type: String,
    enum: ['pending', 'completed', 'failed'],
    default: 'completed'
  }
}, {
  timestamps: true
});

const ReferralTransaction = mongoose.model('ReferralTransaction', ReferralTransactionSchema);
module.exports = ReferralTransaction;