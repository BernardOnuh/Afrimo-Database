const mongoose = require('mongoose');

const sharePurchaseOfferSchema = new mongoose.Schema({
  // Transaction tracking
  offerId: {
    type: String,
    unique: true,
    required: true,
    index: true
  },
  
  // Parties involved
  seller: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  
  buyer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  
  // Listing reference
  listing: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ShareListing',
    required: true,
    index: true
  },
  
  // Share transaction details
  shares: {
    type: Number,
    required: true,
    min: 1
  },
  
  pricePerShare: {
    type: Number,
    required: true,
    min: 0
  },
  
  currency: {
    type: String,
    enum: ['naira', 'usdt', 'usd', 'eur'],
    required: true
  },
  
  totalPrice: {
    type: Number,
    required: true,
    min: 0
  },
  
  // Payment method
  paymentMethod: {
    type: String,
    enum: ['bank_transfer', 'crypto', 'wallet_transfer', 'otc_direct'],
    required: true
  },
  
  // Payment status
  paymentStatus: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed', 'refunded'],
    default: 'pending',
    index: true
  },
  
  // Payment proof (for manual transfers)
  paymentProof: {
    cloudinaryUrl: String,
    cloudinaryId: String,
    originalName: String,
    fileSize: Number,
    format: String,
    uploadedAt: Date
  },
  
  // Transaction reference
  transactionReference: String, // Bank reference, crypto tx hash, etc.
  
  // For bank transfer
  bankTransferDetails: {
    fromAccount: String,
    toAccount: String,
    bankName: String,
    amount: Number,
    date: Date
  },
  
  // For crypto transfer
  cryptoTransferDetails: {
    fromAddress: String,
    toAddress: String,
    txHash: String,
    network: String,
    gasUsed: String,
    amount: Number,
    date: Date
  },
  
  // Share transfer status
  shareTransferStatus: {
    type: String,
    enum: ['pending', 'transferred', 'failed'],
    default: 'pending',
    index: true
  },
  
  // Overall status
  status: {
    type: String,
    enum: ['pending', 'accepted', 'in_payment', 'payment_failed', 'in_transfer', 'completed', 'cancelled', 'disputed'],
    default: 'pending',
    index: true
  },
  
  // Messages/Notes
  buyerNote: String,
  sellerNote: String,
  adminNote: String,
  
  // Deadlines
  expiresAt: {
    type: Date,
    default: function() {
      const date = new Date();
      date.setHours(date.getHours() + 24); // 24 hours for buyer to proceed
      return date;
    }
  },
  
  paymentDeadline: Date, // When payment must be received
  
  // Verification
  buyerVerified: {
    type: Boolean,
    default: false
  },
  
  sellerConfirmed: {
    type: Boolean,
    default: false
  },
  
  // Escrow (optional)
  useEscrow: {
    type: Boolean,
    default: false
  },
  
  escrowDetails: {
    escrowAgent: mongoose.Schema.Types.ObjectId,
    escrowStatus: String,
    escrowFee: Number,
    escrowFeePercentage: Number
  },
  
  // Dispute tracking
  dispute: {
    reportedBy: mongoose.Schema.Types.ObjectId,
    reason: String,
    description: String,
    reportedAt: Date,
    status: String,
    resolution: String,
    resolvedAt: Date
  },
  
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
  
  acceptedAt: Date,
  completedAt: Date,
  cancelledAt: Date,
  cancelReason: String
});

// Auto-expire offers
sharePurchaseOfferSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

// Indexes for common queries
sharePurchaseOfferSchema.index({ seller: 1, status: 1 });
sharePurchaseOfferSchema.index({ buyer: 1, status: 1 });
sharePurchaseOfferSchema.index({ listing: 1, status: 1 });
sharePurchaseOfferSchema.index({ createdAt: -1, status: 1 });

// Methods
sharePurchaseOfferSchema.methods.isExpired = function() {
  return this.expiresAt < new Date() && this.status === 'pending';
};

sharePurchaseOfferSchema.methods.canAccept = function() {
  return this.status === 'pending' && !this.isExpired();
};

sharePurchaseOfferSchema.methods.canPayment = function() {
  return this.status === 'accepted';
};

sharePurchaseOfferSchema.methods.getFormattedPrice = function() {
  const symbol = this.currency === 'naira' ? '₦' : this.currency === 'usdt' ? '$' : '';
  return `${symbol}${this.totalPrice}`;
};

// Statics
sharePurchaseOfferSchema.statics.generateOfferId = function() {
  const crypto = require('crypto');
  return `OFR-${crypto.randomBytes(4).toString('hex').toUpperCase()}-${Date.now().toString().slice(-6)}`;
};

module.exports = mongoose.model('SharePurchaseOffer', sharePurchaseOfferSchema);