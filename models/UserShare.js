// COMPLETE: UserShare Model (models/UserShare.js) with GridFS and MongoDB Storage
const mongoose = require('mongoose');

const userShareSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  // CORRECTED: Only track direct regular shares here
  totalShares: {
    type: Number,
    default: 0,
    comment: "Direct regular shares purchased"
  },
  // CORRECTED: Track co-founder shares separately
  coFounderShares: {
    type: Number,
    default: 0,
    comment: "Actual co-founder shares owned"
  },
  // CORRECTED: Calculated field for equivalent regular shares from co-founder shares
  equivalentRegularShares: {
    type: Number,
    default: 0,
    comment: "Regular share equivalent of co-founder shares (coFounderShares * ratio)"
  },
  transactions: [{
    transactionId: {
      type: String,
      required: true
    },
    shares: {
      type: Number,
      required: true,
      comment: "For regular shares: actual shares. For co-founder: equivalent regular shares"
    },
    // CORRECTED: Co-founder specific fields (only populated for co-founder transactions)
    coFounderShares: {
      type: Number,
      default: 0,
      comment: "Actual co-founder shares purchased (only for co-founder transactions)"
    },
    equivalentRegularShares: {
      type: Number,
      default: 0,
      comment: "Regular share equivalent (only for co-founder transactions)"
    },
    shareToRegularRatio: {
      type: Number,
      default: 1,
      comment: "Ratio used at time of purchase"
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
      enum: ['paystack', 'crypto', 'web3', 'manual_bank_transfer', 'manual_cash', 'manual_other', 'co-founder', 'centiiv'],
      required: true
    },
    status: {
      type: String,
      enum: ['pending', 'completed', 'failed'],
      default: 'pending'
    },
    // CORRECTED: Only for regular share transactions
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
    txHash: {
      type: String,
      sparse: true
    },
    
    // ✅ MULTIPLE STORAGE OPTIONS: GridFS (recommended), MongoDB Buffer, or File Path
    
    // Option 1: GridFS storage (recommended for production)
    paymentProofGridFS: {
      type: String,
      sparse: true,
      index: true,
      comment: "GridFS filename for payment proof"
    },
    paymentProofFileId: {
      type: mongoose.Schema.Types.ObjectId,
      sparse: true,
      comment: "GridFS file ObjectId"
    },
    paymentProofOriginalName: {
      type: String,
      sparse: true,
      comment: "Original filename of uploaded file"
    },
    
    // Option 2: Direct MongoDB storage (alternative for small files)
    paymentProofData: {
      type: Buffer,
      required: false,
      comment: "Binary data stored directly in MongoDB"
    },
    paymentProofContentType: {
      type: String,
      required: false,
      comment: "MIME type of the stored file"
    },
    
    // Option 3: Legacy file system storage (keep for backward compatibility)
    paymentProofPath: {
      type: String,
      sparse: true,
      comment: "Legacy file system path"
    },
    
    manualPaymentDetails: {
      bankName: String,
      accountName: String,
      reference: String
    },
    centiivOrderId: {
      type: String,
      sparse: true
    },
    centiivInvoiceUrl: {
      type: String,
      sparse: true
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

// CORRECTED: Add regular shares to a user
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
  
  // CORRECTED: Ensure this is for regular shares only
  const regularShareTransaction = {
    ...transactionData,
    shares: shares, // For regular shares, this is the actual shares
    coFounderShares: 0, // No co-founder shares in regular transaction
    equivalentRegularShares: 0, // No equivalent shares in regular transaction
    shareToRegularRatio: 1 // 1:1 ratio for regular shares
  };
     
  // Add the transaction
  userShares.transactions.push(regularShareTransaction);
     
  // CORRECTED: Only update regular shares if transaction is completed
  if (transactionData.status === 'completed') {
    userShares.totalShares += shares;
  }
     
  userShares.updatedAt = Date.now();
  await userShares.save();
     
  return userShares;
};

// CORRECTED: Add co-founder shares specifically
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
  
  // CORRECTED: Co-founder transaction data structure
  const coFounderTransactionData = {
    ...transactionData,
    shares: equivalentRegularShares, // For compatibility with existing code
    coFounderShares: coFounderShares, // Actual co-founder shares
    equivalentRegularShares: equivalentRegularShares, // Equivalent regular shares
    shareToRegularRatio: shareToRegularRatio,
    paymentMethod: 'co-founder',
    tierBreakdown: { tier1: 0, tier2: 0, tier3: 0 } // Co-founder shares don't use tiers
  };
  
  // Add transaction
  userShares.transactions.push(coFounderTransactionData);
  
  // CORRECTED: Only update co-founder fields if completed
  if (transactionData.status === 'completed') {
    userShares.coFounderShares += coFounderShares;
    userShares.equivalentRegularShares += equivalentRegularShares;
    // IMPORTANT: Do NOT add to totalShares - that's only for direct regular shares
  }
  
  userShares.updatedAt = Date.now();
  await userShares.save();
  
  return userShares;
};

// CORRECTED: Update transaction status
userShareSchema.statics.updateTransactionStatus = async function(userId, transactionId, status, adminNote = null) {
  const userShares = await this.findOne({ user: userId, 'transactions.transactionId': transactionId });
     
  if (!userShares) {
    return null;
  }
     
  const transaction = userShares.transactions.find(t => t.transactionId === transactionId);
     
  if (!transaction) {
    return null;
  }
  
  const oldStatus = transaction.status;
     
  // CORRECTED: Handle status changes properly
  if (oldStatus !== 'completed' && status === 'completed') {
    // Adding shares when transaction becomes completed
    if (transaction.paymentMethod === 'co-founder') {
      // For co-founder shares
      userShares.coFounderShares += transaction.coFounderShares;
      userShares.equivalentRegularShares += transaction.equivalentRegularShares;
    } else {
      // For regular shares
      userShares.totalShares += transaction.shares;
    }
  }
     
  // CORRECTED: Handle status changes from completed to other status
  if (oldStatus === 'completed' && status !== 'completed') {
    // Removing shares when transaction is no longer completed
    if (transaction.paymentMethod === 'co-founder') {
      // For co-founder shares
      userShares.coFounderShares -= transaction.coFounderShares;
      userShares.equivalentRegularShares -= transaction.equivalentRegularShares;
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
  if (adminNote) {
    transaction.adminNote = adminNote;
  }
     
  userShares.updatedAt = Date.now();
  await userShares.save();
     
  return userShares;
};

// CORRECTED: Get user's comprehensive share breakdown
userShareSchema.methods.getShareBreakdown = function() {
  return {
    // Direct regular shares purchased
    directRegularShares: this.totalShares,
    
    // Co-founder shares owned
    coFounderShares: this.coFounderShares,
    
    // Equivalent regular shares from co-founder shares
    equivalentRegularShares: this.equivalentRegularShares,
    
    // CORRECTED: Total effective shares (regular + equivalent from co-founder)
    totalEffectiveShares: this.totalShares + this.equivalentRegularShares,
    
    // Breakdown for clarity
    breakdown: {
      directRegular: this.totalShares,
      fromCoFounder: this.equivalentRegularShares,
      coFounderActual: this.coFounderShares
    },
    
    // Summary
    summary: {
      totalRegularEquivalent: this.totalShares + this.equivalentRegularShares,
      actualCoFounderShares: this.coFounderShares
    }
  };
};

// CORRECTED: Virtual field for total effective shares
userShareSchema.virtual('totalEffectiveShares').get(function() {
  return this.totalShares + this.equivalentRegularShares;
});

// CORRECTED: Method to get shares by type
userShareSchema.methods.getSharesByType = function() {
  const regularTransactions = this.transactions.filter(t => 
    t.status === 'completed' && t.paymentMethod !== 'co-founder'
  );
  
  const coFounderTransactions = this.transactions.filter(t => 
    t.status === 'completed' && t.paymentMethod === 'co-founder'
  );
  
  return {
    regular: {
      transactions: regularTransactions,
      totalShares: this.totalShares,
      totalTransactions: regularTransactions.length
    },
    coFounder: {
      transactions: coFounderTransactions,
      coFounderShares: this.coFounderShares,
      equivalentRegularShares: this.equivalentRegularShares,
      totalTransactions: coFounderTransactions.length
    }
  };
};

// ✅ ENHANCED: Method to check if transaction has payment proof (any storage method)
userShareSchema.methods.hasPaymentProof = function(transactionId) {
  const transaction = this.transactions.find(t => t.transactionId === transactionId);
  if (!transaction) return false;
  
  return !!(
    transaction.paymentProofGridFS ||     // GridFS storage
    transaction.paymentProofData ||       // MongoDB buffer storage
    transaction.paymentProofPath          // Legacy file system storage
  );
};

// ✅ ENHANCED: Method to get payment proof info with all storage types
userShareSchema.methods.getPaymentProofInfo = function(transactionId) {
  const transaction = this.transactions.find(t => t.transactionId === transactionId);
  if (!transaction) return null;
  
  // Determine storage type and location
  let storageType = 'none';
  let storageLocation = null;
  let url = null;
  
  if (transaction.paymentProofGridFS) {
    storageType = 'gridfs';
    storageLocation = transaction.paymentProofGridFS;
    url = `/api/shares/payment-proof/${transactionId}`;
  } else if (transaction.paymentProofData) {
    storageType = 'mongodb';
    storageLocation = 'stored_in_document';
    url = `/api/shares/payment-proof/${transactionId}`;
  } else if (transaction.paymentProofPath) {
    storageType = 'filesystem';
    storageLocation = transaction.paymentProofPath;
    url = `/api/shares/payment-proof/${transactionId}`;
  }
  
  return {
    hasProof: this.hasPaymentProof(transactionId),
    storageType,
    storageLocation,
    contentType: transaction.paymentProofContentType,
    originalName: transaction.paymentProofOriginalName,
    url,
    storageMethods: {
      gridfs: !!transaction.paymentProofGridFS,
      mongodb: !!transaction.paymentProofData,
      filesystem: !!transaction.paymentProofPath
    }
  };
};

// ✅ NEW: Method to get payment proof data based on storage type
userShareSchema.methods.getPaymentProofData = async function(transactionId) {
  const transaction = this.transactions.find(t => t.transactionId === transactionId);
  if (!transaction) return null;
  
  // If stored in MongoDB buffer, return it directly
  if (transaction.paymentProofData) {
    return {
      data: transaction.paymentProofData,
      contentType: transaction.paymentProofContentType || 'application/octet-stream',
      originalName: transaction.paymentProofOriginalName,
      storageType: 'mongodb'
    };
  }
  
  // For GridFS or filesystem, return metadata (actual data fetching handled by controllers)
  return {
    data: null,
    contentType: transaction.paymentProofContentType,
    originalName: transaction.paymentProofOriginalName,
    storageType: transaction.paymentProofGridFS ? 'gridfs' : 'filesystem',
    gridfsFilename: transaction.paymentProofGridFS,
    filePath: transaction.paymentProofPath
  };
};

// ✅ NEW: Static method to store payment proof in MongoDB buffer
userShareSchema.statics.storePaymentProofInMongoDB = async function(userId, transactionId, buffer, contentType, originalName) {
  const userShares = await this.findOne({ 
    user: userId, 
    'transactions.transactionId': transactionId 
  });
  
  if (!userShares) {
    throw new Error('User or transaction not found');
  }
  
  const transaction = userShares.transactions.find(t => t.transactionId === transactionId);
  
  if (!transaction) {
    throw new Error('Transaction not found');
  }
  
  // Store in MongoDB buffer
  transaction.paymentProofData = buffer;
  transaction.paymentProofContentType = contentType;
  transaction.paymentProofOriginalName = originalName;
  
  // Clear other storage methods if they exist
  transaction.paymentProofGridFS = undefined;
  transaction.paymentProofFileId = undefined;
  transaction.paymentProofPath = undefined;
  
  userShares.updatedAt = Date.now();
  await userShares.save();
  
  return userShares;
};

// ✅ NEW: Static method to store payment proof in GridFS
userShareSchema.statics.storePaymentProofInGridFS = async function(userId, transactionId, gridfsFilename, fileId, originalName) {
  const userShares = await this.findOne({ 
    user: userId, 
    'transactions.transactionId': transactionId 
  });
  
  if (!userShares) {
    throw new Error('User or transaction not found');
  }
  
  const transaction = userShares.transactions.find(t => t.transactionId === transactionId);
  
  if (!transaction) {
    throw new Error('Transaction not found');
  }
  
  // Store GridFS info
  transaction.paymentProofGridFS = gridfsFilename;
  transaction.paymentProofFileId = fileId;
  transaction.paymentProofOriginalName = originalName;
  
  // Clear other storage methods if they exist
  transaction.paymentProofData = undefined;
  transaction.paymentProofContentType = undefined;
  transaction.paymentProofPath = undefined;
  
  userShares.updatedAt = Date.now();
  await userShares.save();
  
  return userShares;
};

// ✅ NEW: Method to migrate payment proof between storage types
userShareSchema.methods.migratePaymentProofStorage = async function(transactionId, targetStorageType) {
  const transaction = this.transactions.find(t => t.transactionId === transactionId);
  if (!transaction) {
    throw new Error('Transaction not found');
  }
  
  // Implementation would handle migration between storage types
  // This is a placeholder for the migration logic
  console.log(`Migration from current storage to ${targetStorageType} for transaction ${transactionId}`);
  
  // Return current state for now
  return this.getPaymentProofInfo(transactionId);
};

// Index for better performance
userShareSchema.index({ user: 1 });
userShareSchema.index({ 'transactions.transactionId': 1 });
userShareSchema.index({ 'transactions.status': 1 });
userShareSchema.index({ 'transactions.paymentProofGridFS': 1 });
userShareSchema.index({ 'transactions.paymentProofFileId': 1 });

const UserShare = mongoose.model('UserShare', userShareSchema);

module.exports = UserShare;