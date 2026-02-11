// /models/SharePercentageListing.js
// Tier-based percentage listing model
// Sell shares by % of your holdings, not fixed counts

const mongoose = require('mongoose');

const SharePercentageListingSchema = new mongoose.Schema(
  {
    listingId: {
      type: String,
      unique: true,
      required: true,
      index: true,
      description: 'Unique listing identifier'
    },

    seller: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },

    // ============================================================================
    // PERCENTAGE-BASED SELLING (not fixed counts)
    // ============================================================================

    /**
     * User has 1000 Basic shares (each = 0.00001%)
     * User wants to sell 10% of their Basic holdings
     * System calculates:
     *   - Percentage to sell: 10%
     *   - Actual shares: 10% of 1000 = 100 Basic shares
     *   - Total ownership: 100 shares × 0.00001% = 0.001%
     */
    percentageOfHoldings: {
      type: Number,
      required: true,
      min: 0.1,
      max: 100,
      description: 'Percentage of user total holdings in this tier (0.1-100%)'
    },

    percentageSold: {
      type: Number,
      default: 0,
      description: 'Percentage of listing already sold'
    },

    // ============================================================================
    // TIER INFORMATION
    // ============================================================================

    tier: {
      type: String,
      required: true,
      enum: ['basic', 'standard', 'premium', 'elite', 'platinum', 'supreme'],
      index: true,
      description: 'Which tier these shares belong to'
    },

    tierName: {
      type: String,
      description: 'Human-readable tier name (Basic, Standard, Premium, etc)'
    },

    tierType: {
      type: String,
      enum: ['regular', 'cofounder'],
      description: 'Whether this is regular or co-founder tier'
    },

    // ============================================================================
    // SHARE CALCULATION
    // ============================================================================

    /**
     * User has 1000 shares total in this tier
     * User lists 10% → actualShares = 100
     * Each share = 0.00001% (from tier config)
     * Total percentage represented = 100 × 0.00001% = 0.001%
     */

    totalSharesInTier: {
      type: Number,
      required: true,
      description: 'Total shares user has in this tier'
    },

    actualShares: {
      type: Number,
      required: true,
      description: 'Calculated shares from percentage (percentageOfHoldings % of totalSharesInTier)'
    },

    sharesSold: {
      type: Number,
      default: 0,
      description: 'Number of shares sold so far'
    },

    sharesAvailable: {
      type: Number,
      description: 'Shares remaining to sell'
    },

    // ============================================================================
    // PERCENTAGE OWNERSHIP TRACKING
    // ============================================================================

    /**
     * Each share has a percent value from tier config
     * Basic: 0.00001% per share
     * Standard: 0.000021% per share
     * etc.
     */

    percentPerShare: {
      type: Number,
      required: true,
      description: 'Percent ownership per share (from tier config)'
    },

    totalPercentageRepresented: {
      type: Number,
      description: 'Total % ownership this listing represents (shares × percentPerShare)'
    },

    // ============================================================================
    // PRICING
    // ============================================================================

    pricePerShare: {
      type: Number,
      required: true,
      min: 0,
      description: 'Price per individual share (not per percentage point)'
    },

    currency: {
      type: String,
      enum: ['naira', 'usdt'],
      required: true,
      default: 'naira'
    },

    totalPrice: {
      type: Number,
      required: true,
      description: 'Total value = actualShares × pricePerShare'
    },

    // ============================================================================
    // DURATION CONTROL
    // ============================================================================

    durationDays: {
      type: Number,
      required: true,
      default: 30,
      min: 1,
      max: 365,
      description: 'How many days listing is active'
    },

    expiresAt: {
      type: Date,
      required: true,
      index: true,
      description: 'When listing automatically expires'
    },

    // ============================================================================
    // PAYMENT & DETAILS
    // ============================================================================

    paymentMethods: {
      type: [String],
      enum: ['bank_transfer', 'crypto', 'wallet_transfer', 'otc_direct'],
      default: ['bank_transfer'],
      required: true
    },

    bankDetails: {
      accountName: String,
      accountNumber: String,
      bankName: String,
      country: String
    },

    cryptoWallet: {
      address: String,
      network: String,
      currency: String
    },

    description: {
      type: String,
      default: '',
      maxlength: 1000
    },

    minSharesPerBuy: {
      type: Number,
      default: 1,
      description: 'Minimum shares per purchase'
    },

    // ============================================================================
    // STATUS TRACKING
    // ============================================================================

    status: {
      type: String,
      enum: ['active', 'partially_sold', 'sold', 'cancelled', 'expired'],
      default: 'active',
      index: true
    },

    cancelledAt: Date,
    cancelReason: String,
    completedAt: Date,

    // ============================================================================
    // METADATA
    // ============================================================================

    views: {
      type: Number,
      default: 0
    },

    offers: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'SharePercentageOffer'
      }
    ]
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

// ============================================================================
// VIRTUAL FIELDS
// ============================================================================

/**
 * Percentage remaining = percentageOfHoldings - percentageSold
 * Example: Listed 10%, sold 3% → remaining 7%
 */
SharePercentageListingSchema.virtual('percentageRemaining').get(function () {
  return this.percentageOfHoldings - this.percentageSold;
});

/**
 * Days left before auto-expiry
 */
SharePercentageListingSchema.virtual('daysRemaining').get(function () {
  const now = new Date();
  const msRemaining = this.expiresAt - now;
  return Math.max(0, Math.ceil(msRemaining / (1000 * 60 * 60 * 24)));
});

// ============================================================================
// METHODS
// ============================================================================

/**
 * Check if expired
 */
SharePercentageListingSchema.methods.isExpired = function () {
  return new Date() > this.expiresAt;
};

/**
 * Check if buyer can purchase this percentage
 * Example: Listed 10%, buyer wants 3%
 */
SharePercentageListingSchema.methods.canBuy = function (percentageToOffer) {
  return (
    percentageToOffer > 0 &&
    percentageToOffer <= this.percentageRemaining &&
    this.status === 'active' &&
    !this.isExpired()
  );
};

/**
 * Calculate actual shares from percentage of this listing
 * Example: Listing has 100 shares total, buyer wants 50%
 * Result: 50 shares
 */
SharePercentageListingSchema.methods.calculateSharesFromPercentage = function (
  percentageToOffer
) {
  return Math.floor((percentageToOffer / 100) * this.actualShares);
};

/**
 * Calculate percentage ownership from shares
 * Example: 50 shares, percentPerShare = 0.00001% → 0.0005%
 */
SharePercentageListingSchema.methods.calculatePercentageFromShares = function (
  shares
) {
  return shares * this.percentPerShare;
};

/**
 * Calculate price for percentage purchase
 * Example: Buying 5% of 100 shares = 5 shares × pricePerShare
 */
SharePercentageListingSchema.methods.calculatePriceForPercentage = function (
  percentageToOffer
) {
  const shares = this.calculateSharesFromPercentage(percentageToOffer);
  return shares * this.pricePerShare;
};

// ============================================================================
// STATIC METHODS
// ============================================================================

/**
 * Check if user can list this much in this tier
 * Prevent: user has 1000 Basic, already listed 60%, try to list 50% more
 */
SharePercentageListingSchema.statics.checkListingLimit = async function (
  userId,
  tier,
  percentageToList
) {
  const activeListings = await this.find({
    seller: userId,
    status: 'active',
    tier
  });

  const alreadyListed = activeListings.reduce((sum, listing) => {
    return sum + listing.percentageOfHoldings;
  }, 0);

  const canList = alreadyListed + percentageToList <= 100;
  const available = Math.max(0, 100 - alreadyListed);

  return {
    canList,
    alreadyListed,
    available,
    requested: percentageToList,
    message: !canList
      ? `Cannot list ${percentageToList}%. Already listing ${alreadyListed}%. Max available: ${available}%`
      : `Can list ${percentageToList}%. You have ${available}% remaining.`
  };
};

/**
 * Generate unique listing ID
 */
SharePercentageListingSchema.statics.generateListingId = function () {
  return `PEL-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
};

// ============================================================================
// INDEXES FOR PERFORMANCE
// ============================================================================

SharePercentageListingSchema.index({ seller: 1, status: 1 });
SharePercentageListingSchema.index({ tier: 1, status: 1 });
SharePercentageListingSchema.index({ expiresAt: 1 });
SharePercentageListingSchema.index({ createdAt: -1 });

module.exports = mongoose.model('SharePercentageListing', SharePercentageListingSchema);