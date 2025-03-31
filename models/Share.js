const mongoose = require('mongoose');

const shareSchema = new mongoose.Schema({
  // Current price configuration
  currentPrices: {
    tier1: {
      shares: { type: Number, default: 2000 },
      priceNaira: { type: Number, default: 50000 },
      priceUSDT: { type: Number, default: 50 }
    },
    tier2: {
      shares: { type: Number, default: 3000 },
      priceNaira: { type: Number, default: 70000 },
      priceUSDT: { type: Number, default: 70 }
    },
    tier3: {
      shares: { type: Number, default: 5000 },
      priceNaira: { type: Number, default: 80000 },
      priceUSDT: { type: Number, default: 80 }
    }
  },
  
  // Total shares available in the system
  totalShares: {
    type: Number,
    default: 10000 // 2000 + 3000 + 5000
  },
  
  // Total shares sold
  sharesSold: {
    type: Number,
    default: 0
  },
  
  // Track sales per tier
  tierSales: {
    tier1Sold: { type: Number, default: 0 },
    tier2Sold: { type: Number, default: 0 },
    tier3Sold: { type: Number, default: 0 }
  },
  
  // Last updated
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, { timestamps: true });

// Create or get the current share configuration
shareSchema.statics.getCurrentConfig = async function() {
  // Find the most recent config or create a new one if none exists
  let config = await this.findOne().sort({ createdAt: -1 });
  
  if (!config) {
    config = await this.create({});
  }
  
  return config;
};

// Update pricing
shareSchema.statics.updatePricing = async function(tier, priceNaira, priceUSDT) {
  const config = await this.getCurrentConfig();
  
  if (tier === 'tier1' || tier === 'tier2' || tier === 'tier3') {
    config.currentPrices[tier].priceNaira = priceNaira || config.currentPrices[tier].priceNaira;
    config.currentPrices[tier].priceUSDT = priceUSDT || config.currentPrices[tier].priceUSDT;
    await config.save();
  }
  
  return config;
};

// Determine which tier a purchase belongs to and calculate price
shareSchema.statics.calculatePurchase = async function(quantity, currency) {
  const config = await this.getCurrentConfig();
  
  // Determine which tier(s) the purchase belongs to
  let remainingShares = quantity;
  let totalPrice = 0;
  let tierBreakdown = {
    tier1: 0,
    tier2: 0,
    tier3: 0
  };
  
  // Check tier1 availability
  const tier1Available = config.currentPrices.tier1.shares - config.tierSales.tier1Sold;
  if (tier1Available > 0 && remainingShares > 0) {
    const tier1Purchase = Math.min(tier1Available, remainingShares);
    tierBreakdown.tier1 = tier1Purchase;
    totalPrice += tier1Purchase * (currency === 'naira' ? config.currentPrices.tier1.priceNaira : config.currentPrices.tier1.priceUSDT);
    remainingShares -= tier1Purchase;
  }
  
  // Check tier2 availability
  const tier2Available = config.currentPrices.tier2.shares - config.tierSales.tier2Sold;
  if (tier2Available > 0 && remainingShares > 0) {
    const tier2Purchase = Math.min(tier2Available, remainingShares);
    tierBreakdown.tier2 = tier2Purchase;
    totalPrice += tier2Purchase * (currency === 'naira' ? config.currentPrices.tier2.priceNaira : config.currentPrices.tier2.priceUSDT);
    remainingShares -= tier2Purchase;
  }
  
  // Check tier3 availability
  const tier3Available = config.currentPrices.tier3.shares - config.tierSales.tier3Sold;
  if (tier3Available > 0 && remainingShares > 0) {
    const tier3Purchase = Math.min(tier3Available, remainingShares);
    tierBreakdown.tier3 = tier3Purchase;
    totalPrice += tier3Purchase * (currency === 'naira' ? config.currentPrices.tier3.priceNaira : config.currentPrices.tier3.priceUSDT);
    remainingShares -= tier3Purchase;
  }
  
  // Check if all shares could be allocated
  const totalPurchasable = tierBreakdown.tier1 + tierBreakdown.tier2 + tierBreakdown.tier3;
  
  return {
    success: totalPurchasable > 0,
    totalPrice,
    currency,
    totalShares: totalPurchasable,
    tierBreakdown,
    insufficientShares: quantity > totalPurchasable
  };
};

const Share = mongoose.model('Share', shareSchema);

module.exports = Share;