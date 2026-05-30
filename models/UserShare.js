const mongoose = require('mongoose');

// Simplified transaction schema for new system
const transactionSchema = new mongoose.Schema({
  transactionId: {
    type: String,
    required: true,
  },
  type: {
    type: String,
    enum: ['share', 'co-founder'],
    default: 'share'
  },
  // Package reference (new system)
  packageId: {
    type: String,  // Changed from ObjectId to String to support tier keys like "basic"
    default: null
  },
  packageLabel: String,
  
  // Ownership and earnings (from package)
  ownershipPct: {
    type: Number,
    default: 0
  },
  earningKobo: {
    type: Number,
    default: 0
  },
  
  // Payment info
  amount: {
    type: Number,
    required: true
  },
  currency: {
    type: String,
    enum: ['naira', 'usdt'],
    required: true
  },
  paymentMethod: {
    type: String,
    required: true
  },
  
  // Status
  status: {
    type: String,
    enum: ['pending', 'completed', 'failed'],
    default: 'pending'
  },
  
  // Manual payment details (if applicable)
  manualPaymentDetails: {
    bankName: String,
    accountName: String,
    reference: String
  },
  
  // Payment proof storage
  paymentProofPath: String,
  paymentProofCloudinaryUrl: String,
  paymentProofCloudinaryId: String,
  paymentProofOriginalName: String,
  paymentProofFileSize: Number,
  
  // Admin info
  adminNote: String,
  adminAction: {
    type: Boolean,
    default: false
  },
  verifiedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  }
});

// Main UserShare schema
const userShareSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  
  // Total ownership across ALL transaction types (regular + cofounder)
  totalOwnershipPct: {
    type: Number,
    default: 0
  },
  
  // Total earnings across ALL transaction types
  totalEarningKobo: {
    type: Number,
    default: 0
  },
  
  // All transactions (both regular and cofounder)
  transactions: [transactionSchema]
}, { timestamps: true });

// ============================================================================
// STATIC METHODS FOR TRANSACTION MANAGEMENT
// ============================================================================

/**
 * Add a pending transaction (does NOT update totals)
 */
userShareSchema.statics.addTransaction = async function(userId, txData) {
  let record = await this.findOne({ user: userId });
  
  if (!record) {
    record = new this({
      user: userId,
      totalOwnershipPct: 0,
      totalEarningKobo: 0,
      transactions: []
    });
  }
  
  record.transactions.push(txData);
  await record.save();
  
  console.log(`✅ Transaction ${txData.transactionId} added (pending)`);
  return record;
};

/**
 * Approve transaction - add ownership and earnings to totals
 */
userShareSchema.statics.approveTransaction = async function(userId, transactionId) {
  const record = await this.findOne({ user: userId });
  if (!record) {
    console.log(`❌ User record not found: ${userId}`);
    return null;
  }
  
  const tx = record.transactions.find(t => t.transactionId === transactionId);
  if (!tx) {
    console.log(`❌ Transaction not found: ${transactionId}`);
    return null;
  }
  
  // If already completed, skip
  if (tx.status === 'completed') {
    console.log(`⚠️  Transaction already completed: ${transactionId}`);
    return record;
  }
  
  // Mark as completed
  tx.status = 'completed';
  
  // Add to totals (with precision handling)
  record.totalOwnershipPct = parseFloat(
    (record.totalOwnershipPct + tx.ownershipPct).toFixed(10)
  );
  record.totalEarningKobo += tx.earningKobo;
  
  await record.save();
  
  console.log(`✅ Transaction approved: ${transactionId}`);
  console.log(`   Ownership: +${tx.ownershipPct}% (total: ${record.totalOwnershipPct}%)`);
  console.log(`   Earning: +${tx.earningKobo} kobo (total: ${record.totalEarningKobo})`);
  
  return record;
};

/**
 * Reject transaction - remove from totals if was completed
 */
userShareSchema.statics.rejectTransaction = async function(userId, transactionId, newStatus = 'failed') {
  const record = await this.findOne({ user: userId });
  if (!record) {
    console.log(`❌ User record not found: ${userId}`);
    return null;
  }
  
  const tx = record.transactions.find(t => t.transactionId === transactionId);
  if (!tx) {
    console.log(`❌ Transaction not found: ${transactionId}`);
    return null;
  }
  
  // If it was completed, roll back the totals
  if (tx.status === 'completed') {
    record.totalOwnershipPct = parseFloat(
      (record.totalOwnershipPct - tx.ownershipPct).toFixed(10)
    );
    record.totalEarningKobo = Math.max(0, record.totalEarningKobo - tx.earningKobo);
    
    console.log(`✅ Transaction rejected and rolled back: ${transactionId}`);
    console.log(`   Ownership: -${tx.ownershipPct}% (total: ${record.totalOwnershipPct}%)`);
    console.log(`   Earning: -${tx.earningKobo} kobo (total: ${record.totalEarningKobo})`);
  } else {
    console.log(`✅ Transaction rejected (was pending): ${transactionId}`);
  }
  
  tx.status = newStatus;
  await record.save();
  
  return record;
};

/**
 * Get user's total ownership percentage
 */
userShareSchema.statics.getUserOwnership = async function(userId) {
  const record = await this.findOne({ user: userId });
  if (!record) {
    return {
      totalOwnershipPct: 0,
      formattedOwnership: '0.0000000%',
      transactions: []
    };
  }
  
  return {
    totalOwnershipPct: record.totalOwnershipPct,
    formattedOwnership: record.totalOwnershipPct.toFixed(7) + '%',
    completedTransactions: record.transactions.filter(t => t.status === 'completed').length,
    pendingTransactions: record.transactions.filter(t => t.status === 'pending').length
  };
};

/**
 * Get transactions by type (regular or cofounder)
 */
userShareSchema.statics.getTransactionsByType = async function(userId, type) {
  const record = await this.findOne({ user: userId });
  if (!record) return [];
  
  return record.transactions.filter(t => t.type === type);
};

/**
 * Get user's breakdown by transaction type
 */
userShareSchema.statics.getUserBreakdown = async function(userId) {
  const record = await this.findOne({ user: userId });
  
  if (!record) {
    return {
      totalOwnershipPct: 0,
      totalEarningKobo: 0,
      regular: { ownershipPct: 0, earningKobo: 0, transactions: 0 },
      cofounder: { ownershipPct: 0, earningKobo: 0, transactions: 0 }
    };
  }
  
  // Get completed transactions only
  const regularCompleted = record.transactions.filter(
    t => t.status === 'completed' && t.type === 'share'
  );
  
  const cofounderCompleted = record.transactions.filter(
    t => t.status === 'completed' && t.type === 'co-founder'
  );
  
  const regularOwnership = regularCompleted.reduce((sum, t) => sum + t.ownershipPct, 0);
  const regularEarning = regularCompleted.reduce((sum, t) => sum + t.earningKobo, 0);
  
  const cofounderOwnership = cofounderCompleted.reduce((sum, t) => sum + t.ownershipPct, 0);
  const cofounderEarning = cofounderCompleted.reduce((sum, t) => sum + t.earningKobo, 0);
  
  return {
    totalOwnershipPct: record.totalOwnershipPct,
    totalEarningKobo: record.totalEarningKobo,
    formattedOwnership: record.totalOwnershipPct.toFixed(7) + '%',
    regular: {
      ownershipPct: regularOwnership,
      earningKobo: regularEarning,
      transactions: regularCompleted.length,
      formattedOwnership: regularOwnership.toFixed(7) + '%'
    },
    cofounder: {
      ownershipPct: cofounderOwnership,
      earningKobo: cofounderEarning,
      transactions: cofounderCompleted.length,
      formattedOwnership: cofounderOwnership.toFixed(7) + '%'
    }
  };
};

// ============================================================================
// ADMIN METHODS FOR ADDING SHARES
// ============================================================================

/**
 * Add regular shares to user (Admin action)
 */
userShareSchema.statics.addShares = async function(userId, shares, txData) {
  let record = await this.findOne({ user: userId });
  
  if (!record) {
    record = new this({
      user: userId,
      totalOwnershipPct: 0,
      totalEarningKobo: 0,
      transactions: []
    });
  }
  
  // Create transaction object with regular share type
  const transaction = {
    transactionId: txData.transactionId,
    type: 'share',
    packageId: txData.packageId,
    packageLabel: txData.packageLabel,
    shares: shares,
    ownershipPct: txData.ownershipPct || 0,
    earningKobo: txData.earningKobo || 0,
    amount: txData.totalAmount,
    currency: txData.currency || 'naira',
    paymentMethod: txData.paymentMethod,
    status: txData.status || 'completed',
    adminAction: true,
    adminNote: txData.adminNote,
    tierBreakdown: txData.tierBreakdown || { tier1: shares, tier2: 0, tier3: 0 }
  };
  
  record.transactions.push(transaction);
  
  // Update totals if status is completed
  if (transaction.status === 'completed') {
    record.totalOwnershipPct = parseFloat(
      (record.totalOwnershipPct + transaction.ownershipPct).toFixed(10)
    );
    record.totalEarningKobo += transaction.earningKobo;
  }
  
  await record.save();
  
  console.log(`✅ Admin added ${shares} regular shares to user ${userId}`);
  return record;
};

/**
 * Add co-founder shares to user (Admin action)
 */
userShareSchema.statics.addCoFounderShares = async function(userId, shares, txData) {
  let record = await this.findOne({ user: userId });
  
  if (!record) {
    record = new this({
      user: userId,
      totalOwnershipPct: 0,
      totalEarningKobo: 0,
      transactions: []
    });
  }
  
  // Create transaction object with co-founder type
  const transaction = {
    transactionId: txData.transactionId,
    type: 'co-founder',
    packageId: txData.packageId,
    packageLabel: txData.packageLabel,
    shares: shares,
    coFounderShares: shares,
    ownershipPct: txData.ownershipPct,
    earningKobo: txData.earningKobo,
    amount: txData.totalAmount,
    currency: txData.currency || 'naira',
    paymentMethod: txData.paymentMethod,
    status: 'completed',
    adminAction: true,
    adminNote: txData.adminNote,
    equivalentRegularShares: txData.equivalentRegularShares,
    shareToRegularRatio: txData.shareToRegularRatio
  };
  
  record.transactions.push(transaction);
  
  // Update totals
  record.totalOwnershipPct = parseFloat(
    (record.totalOwnershipPct + txData.ownershipPct).toFixed(10)
  );
  record.totalEarningKobo += txData.earningKobo;
  
  await record.save();
  
  console.log(`✅ Admin added ${shares} co-founder shares to user ${userId}`);
  console.log(`   Ownership: +${txData.ownershipPct}% (total: ${record.totalOwnershipPct}%)`);
  console.log(`   Earning: +${txData.earningKobo} kobo (total: ${record.totalEarningKobo})`);
  
  return record;
};

// ============================================================================
// INSTANCE METHODS
// ============================================================================

/**
 * Get all completed transactions
 */
userShareSchema.methods.getCompletedTransactions = function() {
  return this.transactions.filter(t => t.status === 'completed')
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
};

/**
 * Get pending transactions
 */
userShareSchema.methods.getPendingTransactions = function() {
  return this.transactions.filter(t => t.status === 'pending')
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
};

/**
 * Get ownership summary
 */
userShareSchema.methods.getOwnershipSummary = function() {
  const completed = this.getCompletedTransactions();
  
  return {
    totalOwnershipPct: this.totalOwnershipPct,
    totalEarningKobo: this.totalEarningKobo,
    formattedOwnership: this.totalOwnershipPct.toFixed(7) + '%',
    completedTransactions: completed.length,
    allTransactions: this.transactions.length,
    breakdown: {
      regular: completed
        .filter(t => t.type === 'share')
        .reduce((sum, t) => sum + t.ownershipPct, 0),
      cofounder: completed
        .filter(t => t.type === 'co-founder')
        .reduce((sum, t) => sum + t.ownershipPct, 0)
    }
  };
};

/**
 * Get detailed share breakdown (ADD THIS METHOD)
 */
userShareSchema.methods.getShareBreakdown = function() {
  let regularShares = 0;
  let coFounderShares = 0;
  let regularOwnershipPct = 0;
  let coFounderOwnershipPct = 0;
  let regularEarningKobo = 0;
  let coFounderEarningKobo = 0;
  let regularTransactions = 0;
  let coFounderTransactions = 0;
  
  // Process completed transactions only
  this.transactions.forEach(tx => {
    if (tx.status === 'completed') {
      if (tx.type === 'co-founder') {
        coFounderShares += tx.shares || 1;
        coFounderOwnershipPct += tx.ownershipPct || 0;
        coFounderEarningKobo += tx.earningKobo || 0;
        coFounderTransactions++;
      } else {
        regularShares += tx.shares || 1;
        regularOwnershipPct += tx.ownershipPct || 0;
        regularEarningKobo += tx.earningKobo || 0;
        regularTransactions++;
      }
    }
  });
  
  const totalShares = regularShares + coFounderShares;
  const totalOwnershipPct = regularOwnershipPct + coFounderOwnershipPct;
  const totalEarningKobo = regularEarningKobo + coFounderEarningKobo;
  
  return {
    // Regular shares breakdown
    regular: {
      shares: regularShares,
      ownershipPct: regularOwnershipPct,
      earningKobo: regularEarningKobo,
      formattedOwnership: `${(regularOwnershipPct * 100).toFixed(7)}%`,
      formattedEarning: `₦${(regularEarningKobo / 100).toLocaleString()}`,
      transactions: regularTransactions
    },
    // Co-founder shares breakdown
    cofounder: {
      shares: coFounderShares,
      ownershipPct: coFounderOwnershipPct,
      earningKobo: coFounderEarningKobo,
      formattedOwnership: `${(coFounderOwnershipPct * 100).toFixed(7)}%`,
      formattedEarning: `₦${(coFounderEarningKobo / 100).toLocaleString()}`,
      transactions: coFounderTransactions
    },
    // Combined totals
    total: {
      shares: totalShares,
      ownershipPct: totalOwnershipPct,
      earningKobo: totalEarningKobo,
      formattedOwnership: `${(totalOwnershipPct * 100).toFixed(7)}%`,
      formattedEarning: `₦${(totalEarningKobo / 100).toLocaleString()}`,
      transactions: regularTransactions + coFounderTransactions
    },
    // Legacy fields for backward compatibility
    totalOwnershipPct: totalOwnershipPct,
    totalEarningKobo: totalEarningKobo,
    regularShares: regularShares,
    coFounderShares: coFounderShares
  };
};

// ============================================================================
// INDEXES
// ============================================================================

userShareSchema.index({ user: 1 });
userShareSchema.index({ 'transactions.transactionId': 1 });
userShareSchema.index({ 'transactions.status': 1 });
userShareSchema.index({ 'transactions.type': 1 });
userShareSchema.index({ createdAt: 1 });

module.exports = mongoose.model('UserShare', userShareSchema);