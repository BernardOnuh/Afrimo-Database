const mongoose = require('mongoose');

const shareListingSchema = new mongoose.Schema({
  // Listing ID and ownership
  listingId: {
    type: String,
    unique: true,
    required: true,
    index: true
  },
  
  seller: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  
  // Share details
  shares: {
    type: Number,
    required: true,
    min: 1
  },
  
  shareType: {
    type: String,
    enum: ['regular', 'cofounder'],
    default: 'regular'
  },
  
  // Pricing information
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
  
  // Listing status
  status: {
    type: String,
    enum: ['active', 'partially_sold', 'sold', 'cancelled', 'expired'],
    default: 'active',
    index: true
  },
  
  // Sold/Available tracking
  sharesSold: {
    type: Number,
    default: 0,
    min: 0
  },
  
  sharesAvailable: {
    type: Number,
    default: function() {
      return this.shares - this.sharesSold;
    }
  },
  
  // Payment methods
  paymentMethods: {
    type: [{
      type: String,
      enum: ['bank_transfer', 'crypto', 'wallet_transfer', 'otc_direct']
    }],
    required: true
  },
  
  // Bank details for manual transfer (if applicable)
  bankDetails: {
    accountName: String,
    accountNumber: String,
    bankName: String,
    swiftCode: String,
    country: String,
    note: String
  },
  
  // Crypto wallet for USDT/crypto payments
  cryptoWallet: {
    address: String,
    network: String, // BSC, Ethereum, etc.
    currency: String // USDT, BTC, ETH, etc.
  },
  
  // Listing details
  description: String,
  
  minSharesPerBuy: {
    type: Number,
    default: 1
  },
  
  maxSharesPerBuyer: {
    type: Number,
    default: null // No limit if null
  },
  
  // Expiration
  expiresAt: {
    type: Date,
    default: function() {
      const date = new Date();
      date.setDate(date.getDate() + 30); // 30 days from now
      return date;
    }
  },
  
  // Verification
  requiresBuyerVerification: {
    type: Boolean,
    default: false
  },
  
  // Visibility
  isPublic: {
    type: Boolean,
    default: true
  },
  
  // Tracking
  views: {
    type: Number,
    default: 0
  },
  
  interested: [{
    userId: mongoose.Schema.Types.ObjectId,
    interestedAt: {
      type: Date,
      default: Date.now
    }
  }],
  
  // Statistics
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  
  updatedAt: {
    type: Date,
    default: Date.now
  },
  
  cancelledAt: Date,
  cancelReason: String,
  
  completedAt: Date
});

// Calculate available shares before saving
shareListingSchema.pre('save', function(next) {
  if (this.status !== 'sold') {
    this.sharesAvailable = Math.max(0, this.shares - (this.sharesSold || 0));
  }
  this.updatedAt = new Date();
  next();
});

// Index for common queries
shareListingSchema.index({ seller: 1, status: 1 });
shareListingSchema.index({ currency: 1, status: 1 });
shareListingSchema.index({ createdAt: -1, status: 1 });
shareListingSchema.index({ expiresAt: 1, status: 1 });

// Methods
shareListingSchema.methods.getFormattedPrice = function() {
  const symbol = this.currency === 'naira' ? '₦' : this.currency === 'usdt' ? '$' : '';
  return `${symbol}${this.pricePerShare}`;
};

shareListingSchema.methods.getTotalPrice = function() {
  const symbol = this.currency === 'naira' ? '₦' : this.currency === 'usdt' ? '$' : '';
  return `${symbol}${this.totalPrice}`;
};

shareListingSchema.methods.isExpired = function() {
  return this.expiresAt < new Date() && this.status !== 'sold' && this.status !== 'cancelled';
};

shareListingSchema.methods.canBuy = function(quantity) {
  return this.sharesAvailable >= quantity && 
         this.status === 'active' && 
         !this.isExpired() &&
         quantity >= this.minSharesPerBuy;
};

// Statics
shareListingSchema.statics.generateListingId = function() {
  const crypto = require('crypto');
  return `LST-${crypto.randomBytes(4).toString('hex').toUpperCase()}-${Date.now().toString().slice(-6)}`;
};

shareListingSchema.statics.getActiveListings = async function(filters = {}) {
  const query = {
    status: 'active',
    expiresAt: { $gt: new Date() },
    isPublic: true
  };
  
  if (filters.currency) query.currency = filters.currency;
  if (filters.shareType) query.shareType = filters.shareType;
  if (filters.minPrice) query.pricePerShare = { $gte: filters.minPrice };
  if (filters.maxPrice) query.pricePerShare = { ...query.pricePerShare, $lte: filters.maxPrice };
  
  return this.find(query)
    .populate('seller', 'name username avatar')
    .sort({ createdAt: -1 });
};

module.exports = mongoose.model('ShareListing', shareListingSchema);