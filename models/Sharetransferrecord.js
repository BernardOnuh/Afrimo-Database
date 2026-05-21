const mongoose = require('mongoose');

const shareTransferRecordSchema = new mongoose.Schema({
  // Transfer ID
  transferId: {
    type: String,
    unique: true,
    required: true,
    index: true
  },
  
  // Parties
  fromUser: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  
  toUser: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  
  // Transfer type
  transferType: {
    type: String,
    enum: ['sale', 'gift', 'inheritance', 'admin_transfer', 'co_founder_trade'],
    required: true
  },
  
  // Shares transferred
  shareCount: {
    type: Number,
    required: true,
    min: 1
  },
  
  shareType: {
    type: String,
    enum: ['regular', 'cofounder'],
    default: 'regular'
  },
  
  // For sales
  pricePerShare: Number,
  totalPrice: Number,
  currency: String, // Only for sales
  
  // Related offer/listing
  offer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SharePurchaseOffer'
  },
  
  listing: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ShareListing'
  },
  
  // Transfer status
  status: {
    type: String,
    enum: ['pending', 'in_progress', 'completed', 'failed', 'reversed'],
    default: 'pending',
    index: true
  },
  
  // Payment verification (for sales)
  paymentVerified: {
    type: Boolean,
    default: false
  },
  
  paymentVerificationDetails: {
    verifiedBy: mongoose.Schema.Types.ObjectId,
    verificationMethod: String, // bank_verification, blockchain_check, manual_review
    verificationProof: String,
    verifiedAt: Date
  },
  
  // Blockchain/Smart Contract
  blockchainTx: {
    txHash: String,
    network: String,
    blockNumber: Number,
    gasUsed: String,
    status: String // pending, confirmed, failed
  },
  
  // Share certificate/proof
  sharesCertificate: {
    certificateId: String,
    issuedAt: Date,
    cloudinaryUrl: String
  },
  
  // Notes and metadata
  description: String,
  notes: String,
  adminNotes: String,
  
  // Tracking
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  
  updatedAt: {
    type: Date,
    default: Date.now
  },
  
  completedAt: Date,
  failedAt: Date,
  failureReason: String,
  
  // Audit trail
  approvedBy: mongoose.Schema.Types.ObjectId,
  approvedAt: Date,
  
  reversedBy: mongoose.Schema.Types.ObjectId,
  reversalReason: String,
  reversedAt: Date,
  
  // Fee tracking
  fees: {
    platformFee: {
      amount: Number,
      percentage: Number,
      description: String
    },
    transferFee: {
      amount: Number,
      percentage: Number,
      description: String
    },
    totalFees: Number
  }
});

// Indexes
shareTransferRecordSchema.index({ fromUser: 1, status: 1 });
shareTransferRecordSchema.index({ toUser: 1, status: 1 });
shareTransferRecordSchema.index({ transferType: 1, status: 1 });
shareTransferRecordSchema.index({ createdAt: -1, status: 1 });
shareTransferRecordSchema.index({ offer: 1 });
shareTransferRecordSchema.index({ listing: 1 });

// Methods
shareTransferRecordSchema.methods.getTransferDetails = function() {
  return {
    transferId: this.transferId,
    from: this.fromUser,
    to: this.toUser,
    shares: this.shareCount,
    shareType: this.shareType,
    type: this.transferType,
    status: this.status,
    amount: this.transferType === 'sale' ? 
      `${this.currency === 'naira' ? '₦' : '$'}${this.totalPrice}` : 
      'N/A',
    date: this.createdAt
  };
};

shareTransferRecordSchema.methods.isCompleted = function() {
  return this.status === 'completed';
};

// Statics
shareTransferRecordSchema.statics.generateTransferId = function() {
  const crypto = require('crypto');
  return `TRF-${crypto.randomBytes(4).toString('hex').toUpperCase()}-${Date.now().toString().slice(-6)}`;
};

shareTransferRecordSchema.statics.getUserTransferHistory = async function(userId) {
  return this.find({
    $or: [
      { fromUser: userId },
      { toUser: userId }
    ],
    status: 'completed'
  })
  .populate('fromUser', 'name username avatar')
  .populate('toUser', 'name username avatar')
  .sort({ createdAt: -1 });
};

module.exports = mongoose.model('ShareTransferRecord', shareTransferRecordSchema);