const mongoose = require('mongoose');

const ReferralTransactionSchema = new mongoose.Schema({
  beneficiary: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  referredUser: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  amount: {
    type: Number,
    required: true,
    default: 0
  },
  currency: {
    type: String,
    enum: ['naira', 'usdt'],
    default: 'naira'
  },
  generation: {
    type: Number,
    enum: [1, 2, 3],
    required: true
  },
  sourceTransaction: {
    type: mongoose.Schema.Types.ObjectId,
    refPath: 'sourceTransactionModel'
  },
  sourceTransactionModel: {
    type: String,
    enum: ['Share', 'CoFounderShare']
  },
  status: {
    type: String,
    enum: ['pending', 'completed', 'failed'],
    default: 'pending'
  }
}, {
  timestamps: true
});

// Static method to create a referral transaction
ReferralTransactionSchema.statics.createTransaction = async function(data) {
  const transaction = new this(data);
  return await transaction.save();
};

// Static method to get transactions for a user
ReferralTransactionSchema.statics.getUserTransactions = async function(userId) {
  return await this.find({ beneficiary: userId })
    .sort({ createdAt: -1 })
    .populate('referredUser', 'name email')
    .populate('sourceTransaction');
};

const ReferralTransaction = mongoose.model('ReferralTransaction', ReferralTransactionSchema);

module.exports = ReferralTransaction;