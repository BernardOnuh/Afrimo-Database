const mongoose = require('mongoose');

const userShareSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  totalShares: {
    type: Number,
    default: 0
  },
  transactions: [{
    transactionId: {
      type: String,
      required: true
    },
    shares: {
      type: Number,
      required: true
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
    paymentMethod: {
      type: String,
      enum: ['paystack', 'crypto'],
      required: true
    },
    status: {
      type: String,
      enum: ['pending', 'completed', 'failed'],
      default: 'pending'
    },
    tierBreakdown: {
      tier1: { type: Number, default: 0 },
      tier2: { type: Number, default: 0 },
      tier3: { type: Number, default: 0 }
    },
    adminAction: {
      type: Boolean,
      default: false
    },
    adminNote: String,
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Add shares to a user (both new purchase and admin action)
userShareSchema.statics.addShares = async function(userId, shares, transactionData) {
  let userShares = await this.findOne({ user: userId });
  
  if (!userShares) {
    userShares = new this({
      user: userId,
      totalShares: 0,
      transactions: []
    });
  }
  
  // Add the transaction
  userShares.transactions.push(transactionData);
  
  // Update total shares if transaction is completed
  if (transactionData.status === 'completed') {
    userShares.totalShares += shares;
  }
  
  userShares.updatedAt = Date.now();
  await userShares.save();
  
  return userShares;
};

// Update transaction status
userShareSchema.statics.updateTransactionStatus = async function(userId, transactionId, status) {
  const userShares = await this.findOne({ user: userId, 'transactions.transactionId': transactionId });
  
  if (!userShares) {
    return null;
  }
  
  const transaction = userShares.transactions.find(t => t.transactionId === transactionId);
  
  if (!transaction) {
    return null;
  }
  
  // If changing from non-completed to completed, add the shares to the total
  if (transaction.status !== 'completed' && status === 'completed') {
    userShares.totalShares += transaction.shares;
  }
  
  // If changing from completed to non-completed, subtract the shares
  if (transaction.status === 'completed' && status !== 'completed') {
    userShares.totalShares -= transaction.shares;
    // Ensure totalShares doesn't go below 0
    userShares.totalShares = Math.max(0, userShares.totalShares);
  }
  
  transaction.status = status;
  userShares.updatedAt = Date.now();
  await userShares.save();
  
  return userShares;
};

const UserShare = mongoose.model('UserShare', userShareSchema);

module.exports = UserShare;