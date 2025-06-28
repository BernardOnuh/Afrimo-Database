// 2. Updated UserShare Model (models/UserShare.js)
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
  // NEW: Track co-founder shares separately
  coFounderShares: {
    type: Number,
    default: 0
  },
  // NEW: Track equivalent regular shares from co-founder shares
  equivalentRegularShares: {
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
    // NEW: For co-founder transactions
    coFounderShares: {
      type: Number,
      default: 0
    },
    equivalentRegularShares: {
      type: Number,
      default: 0
    },
    shareToRegularRatio: {
      type: Number,
      default: 1
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
      enum: ['paystack', 'crypto', 'web3', 'manual_bank_transfer', 'manual_cash', 'manual_other', 'co-founder'],
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
    txHash: String,
    paymentProofPath: String,
    manualPaymentDetails: {
      bankName: String,
      accountName: String,
      reference: String
    },
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
      coFounderShares: 0,
      equivalentRegularShares: 0,
      transactions: []
    });
  }
     
  // Add the transaction
  userShares.transactions.push(transactionData);
     
  // Update total shares if transaction is completed
  if (transactionData.status === 'completed') {
    userShares.totalShares += shares;
    
    // If this is a co-founder transaction, update co-founder specific fields
    if (transactionData.paymentMethod === 'co-founder' || transactionData.coFounderShares) {
      userShares.coFounderShares += (transactionData.coFounderShares || 0);
      userShares.equivalentRegularShares += (transactionData.equivalentRegularShares || 0);
    }
  }
     
  userShares.updatedAt = Date.now();
  await userShares.save();
     
  return userShares;
};

// NEW: Add co-founder shares specifically
userShareSchema.statics.addCoFounderShares = async function(userId, coFounderShares, transactionData) {
  const CoFounderShare = require('./CoFounderShare');
  
  // Get the current ratio
  const coFounderConfig = await CoFounderShare.findOne();
  const shareToRegularRatio = coFounderConfig?.shareToRegularRatio || 29;
  
  // Calculate equivalent regular shares
  const equivalentRegularShares = coFounderShares * shareToRegularRatio;
  
  // Find or create user share record
  let userShares = await this.findOne({ user: userId });
  
  if (!userShares) {
    userShares = new this({
      user: userId,
      totalShares: 0,
      coFounderShares: 0,
      equivalentRegularShares: 0,
      transactions: []
    });
  }
  
  // Enhanced transaction data for co-founder shares
  const coFounderTransactionData = {
    ...transactionData,
    coFounderShares: coFounderShares,
    equivalentRegularShares: equivalentRegularShares,
    shareToRegularRatio: shareToRegularRatio,
    paymentMethod: 'co-founder'
  };
  
  // Add transaction
  userShares.transactions.push(coFounderTransactionData);
  
  // Update totals if completed
  if (transactionData.status === 'completed') {
    userShares.coFounderShares += coFounderShares;
    userShares.equivalentRegularShares += equivalentRegularShares;
    // Total shares now includes equivalent regular shares
    userShares.totalShares += equivalentRegularShares;
  }
  
  userShares.updatedAt = Date.now();
  await userShares.save();
  
  return userShares;
};

// Update transaction status
userShareSchema.statics.updateTransactionStatus = async function(userId, transactionId, status, adminNote = null) {
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
    if (transaction.paymentMethod === 'co-founder' || transaction.coFounderShares) {
      // For co-founder shares, add equivalent regular shares to total
      userShares.totalShares += (transaction.equivalentRegularShares || transaction.shares);
      userShares.coFounderShares += (transaction.coFounderShares || 0);
      userShares.equivalentRegularShares += (transaction.equivalentRegularShares || 0);
    } else {
      // For regular shares
      userShares.totalShares += transaction.shares;
    }
  }
     
  // If changing from completed to non-completed, subtract the shares
  if (transaction.status === 'completed' && status !== 'completed') {
    if (transaction.paymentMethod === 'co-founder' || transaction.coFounderShares) {
      // For co-founder shares, subtract equivalent regular shares from total
      userShares.totalShares -= (transaction.equivalentRegularShares || transaction.shares);
      userShares.coFounderShares -= (transaction.coFounderShares || 0);
      userShares.equivalentRegularShares -= (transaction.equivalentRegularShares || 0);
    } else {
      // For regular shares
      userShares.totalShares -= transaction.shares;
    }
    
    // Ensure totals don't go below 0
    userShares.totalShares = Math.max(0, userShares.totalShares);
    userShares.coFounderShares = Math.max(0, userShares.coFounderShares);
    userShares.equivalentRegularShares = Math.max(0, userShares.equivalentRegularShares);
  }
     
  transaction.status = status;
  // Add admin note if provided
  if (adminNote) {
    transaction.adminNote = adminNote;
  }
     
  userShares.updatedAt = Date.now();
  await userShares.save();
     
  return userShares;
};

// NEW: Get user's share breakdown
userShareSchema.methods.getShareBreakdown = function() {
  return {
    totalShares: this.totalShares,
    regularShares: this.totalShares - this.equivalentRegularShares,
    coFounderShares: this.coFounderShares,
    equivalentRegularShares: this.equivalentRegularShares,
    shareBreakdown: {
      direct: this.totalShares - this.equivalentRegularShares,
      fromCoFounder: this.equivalentRegularShares
    }
  };
};

const UserShare = mongoose.model('UserShare', userShareSchema);

module.exports = UserShare;