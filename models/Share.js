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
  
  // Total regular shares sold (excludes co-founder equivalent shares)
  sharesSold: {
    type: Number,
    default: 0
  },
  
  // Track direct regular share sales per tier
  tierSales: {
    tier1Sold: { type: Number, default: 0 },
    tier2Sold: { type: Number, default: 0 },
    tier3Sold: { type: Number, default: 0 }
  },
  
  // Centiiv configuration for payment processing
  centiivConfig: {
    enabled: { type: Boolean, default: true },
    reminderInterval: { type: Number, default: 7 }, // days
    defaultDueDays: { type: Number, default: 30 }, // days until payment due
    lastOrderId: { type: String, default: null } // track last order for reference
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

// Update Centiiv configuration
shareSchema.statics.updateCentiivConfig = async function(updates) {
  const config = await this.getCurrentConfig();
  
  if (updates.enabled !== undefined) config.centiivConfig.enabled = updates.enabled;
  if (updates.reminderInterval) config.centiivConfig.reminderInterval = updates.reminderInterval;
  if (updates.defaultDueDays) config.centiivConfig.defaultDueDays = updates.defaultDueDays;
  if (updates.lastOrderId) config.centiivConfig.lastOrderId = updates.lastOrderId;
  
  await config.save();
  return config;
};

// UPDATED: Calculate purchase considering co-founder share allocations
shareSchema.statics.calculatePurchase = async function(quantity, currency) {
  try {
    const shareConfig = await this.getCurrentConfig();
    
    // ADDED: Get co-founder shares to calculate true availability
    const CoFounderShare = require('./CoFounderShare');
    const coFounderConfig = await CoFounderShare.findOne();
    const shareToRegularRatio = coFounderConfig?.shareToRegularRatio || 29;
    const coFounderSharesSold = coFounderConfig?.sharesSold || 0;
    const equivalentRegularSharesFromCoFounder = coFounderSharesSold * shareToRegularRatio;
    
    console.log('Calculate purchase debug:', {
      requestedQuantity: quantity,
      coFounderSharesSold,
      equivalentRegularSharesFromCoFounder,
      shareToRegularRatio
    });
    
    // ADDED: Allocate co-founder equivalent shares across tiers (starting from tier1)
    let remainingCoFounderShares = equivalentRegularSharesFromCoFounder;
    
    let coFounderAllocatedToTier1 = 0;
    let coFounderAllocatedToTier2 = 0;
    let coFounderAllocatedToTier3 = 0;
    
    // Allocate co-founder equivalent shares starting from tier1
    if (remainingCoFounderShares > 0) {
      const tier1Capacity = shareConfig.currentPrices.tier1.shares;
      const tier1DirectUsed = shareConfig.tierSales.tier1Sold;
      const tier1Available = tier1Capacity - tier1DirectUsed;
      
      coFounderAllocatedToTier1 = Math.min(remainingCoFounderShares, tier1Available);
      remainingCoFounderShares -= coFounderAllocatedToTier1;
    }
    
    if (remainingCoFounderShares > 0) {
      const tier2Capacity = shareConfig.currentPrices.tier2.shares;
      const tier2DirectUsed = shareConfig.tierSales.tier2Sold;
      const tier2Available = tier2Capacity - tier2DirectUsed;
      
      coFounderAllocatedToTier2 = Math.min(remainingCoFounderShares, tier2Available);
      remainingCoFounderShares -= coFounderAllocatedToTier2;
    }
    
    if (remainingCoFounderShares > 0) {
      const tier3Capacity = shareConfig.currentPrices.tier3.shares;
      const tier3DirectUsed = shareConfig.tierSales.tier3Sold;
      const tier3Available = tier3Capacity - tier3DirectUsed;
      
      coFounderAllocatedToTier3 = Math.min(remainingCoFounderShares, tier3Available);
      remainingCoFounderShares -= coFounderAllocatedToTier3;
    }
    
    // UPDATED: Calculate actual available shares per tier after co-founder allocations
    const tier1ActualAvailable = Math.max(0, 
      shareConfig.currentPrices.tier1.shares - 
      shareConfig.tierSales.tier1Sold - 
      coFounderAllocatedToTier1
    );
    
    const tier2ActualAvailable = Math.max(0, 
      shareConfig.currentPrices.tier2.shares - 
      shareConfig.tierSales.tier2Sold - 
      coFounderAllocatedToTier2
    );
    
    const tier3ActualAvailable = Math.max(0, 
      shareConfig.currentPrices.tier3.shares - 
      shareConfig.tierSales.tier3Sold - 
      coFounderAllocatedToTier3
    );
    
    const totalActualAvailable = tier1ActualAvailable + tier2ActualAvailable + tier3ActualAvailable;
    
    console.log('Tier availability after co-founder allocation:', {
      tier1ActualAvailable,
      tier2ActualAvailable,
      tier3ActualAvailable,
      totalActualAvailable
    });
    
    // UPDATED: Check if enough shares are available
    if (quantity > totalActualAvailable) {
      return {
        success: false,
        message: `Insufficient shares available. Only ${totalActualAvailable} shares remaining (${equivalentRegularSharesFromCoFounder} equivalent shares from ${coFounderSharesSold} co-founder shares are already allocated).`,
        totalPrice: 0,
        currency: currency,
        totalShares: 0,
        tierBreakdown: { tier1: 0, tier2: 0, tier3: 0 },
        insufficientShares: true,
        available: totalActualAvailable,
        requested: quantity,
        debug: {
          coFounderSharesSold,
          equivalentRegularFromCoFounder: equivalentRegularSharesFromCoFounder,
          coFounderAllocations: {
            tier1: coFounderAllocatedToTier1,
            tier2: coFounderAllocatedToTier2,
            tier3: coFounderAllocatedToTier3
          }
        }
      };
    }
    
    // UPDATED: Calculate tier breakdown using actual available shares
    let remainingShares = quantity;
    let totalPrice = 0;
    const tierBreakdown = { tier1: 0, tier2: 0, tier3: 0 };
    
    // Tier 1
    if (remainingShares > 0 && tier1ActualAvailable > 0) {
      const tier1Purchase = Math.min(remainingShares, tier1ActualAvailable);
      tierBreakdown.tier1 = tier1Purchase;
      
      const tier1Price = currency === 'naira' ? 
        shareConfig.currentPrices.tier1.priceNaira : 
        shareConfig.currentPrices.tier1.priceUSDT;
      
      totalPrice += tier1Purchase * tier1Price;
      remainingShares -= tier1Purchase;
    }
    
    // Tier 2
    if (remainingShares > 0 && tier2ActualAvailable > 0) {
      const tier2Purchase = Math.min(remainingShares, tier2ActualAvailable);
      tierBreakdown.tier2 = tier2Purchase;
      
      const tier2Price = currency === 'naira' ? 
        shareConfig.currentPrices.tier2.priceNaira : 
        shareConfig.currentPrices.tier2.priceUSDT;
      
      totalPrice += tier2Purchase * tier2Price;
      remainingShares -= tier2Purchase;
    }
    
    // Tier 3
    if (remainingShares > 0 && tier3ActualAvailable > 0) {
      const tier3Purchase = Math.min(remainingShares, tier3ActualAvailable);
      tierBreakdown.tier3 = tier3Purchase;
      
      const tier3Price = currency === 'naira' ? 
        shareConfig.currentPrices.tier3.priceNaira : 
        shareConfig.currentPrices.tier3.priceUSDT;
      
      totalPrice += tier3Purchase * tier3Price;
      remainingShares -= tier3Purchase;
    }
    
    // Check if all shares could be allocated
    const totalPurchasable = tierBreakdown.tier1 + tierBreakdown.tier2 + tierBreakdown.tier3;
    
    if (remainingShares > 0) {
      return {
        success: false,
        message: `Only ${totalPurchasable} shares available across all tiers after accounting for co-founder allocations`,
        totalPrice: 0,
        currency: currency,
        totalShares: 0,
        tierBreakdown: { tier1: 0, tier2: 0, tier3: 0 },
        insufficientShares: true,
        available: totalPurchasable,
        requested: quantity
      };
    }
    
    return {
      success: true,
      totalPrice: totalPrice,
      currency: currency,
      totalShares: totalPurchasable,
      tierBreakdown: tierBreakdown,
      insufficientShares: false,
      // ADDED: Additional information for debugging and transparency
      breakdown: {
        totalEffectiveSharesSold: shareConfig.sharesSold + equivalentRegularSharesFromCoFounder,
        actualAvailable: totalActualAvailable,
        equivalentFromCoFounder: equivalentRegularSharesFromCoFounder,
        coFounderAllocations: {
          tier1: coFounderAllocatedToTier1,
          tier2: coFounderAllocatedToTier2,
          tier3: coFounderAllocatedToTier3
        },
        tierAvailability: {
          tier1: tier1ActualAvailable,
          tier2: tier2ActualAvailable,
          tier3: tier3ActualAvailable
        }
      }
    };
  } catch (error) {
    console.error('Error calculating purchase:', error);
    return {
      success: false,
      message: 'Error calculating purchase details',
      totalPrice: 0,
      currency: currency,
      totalShares: 0,
      tierBreakdown: { tier1: 0, tier2: 0, tier3: 0 },
      insufficientShares: true,
      error: error.message
    };
  }
};

// Calculate purchase specifically for Centiiv payments
shareSchema.statics.calculateCentiivPurchase = async function(quantity) {
  const config = await this.getCurrentConfig();
  
  if (!config.centiivConfig.enabled) {
    return {
      success: false,
      message: 'Centiiv payments are currently disabled'
    };
  }
  
  // Centiiv uses Naira by default
  const purchaseDetails = await this.calculatePurchase(quantity, 'naira');
  
  if (purchaseDetails.success) {
    // Add Centiiv-specific details
    purchaseDetails.centiivDetails = {
      reminderInterval: config.centiivConfig.reminderInterval,
      dueDate: new Date(Date.now() + config.centiivConfig.defaultDueDays * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    };
  }
  
  return purchaseDetails;
};

// ADDED: Helper method to get comprehensive share statistics
shareSchema.statics.getComprehensiveStats = async function() {
  try {
    const shareConfig = await this.getCurrentConfig();
    
    // Get co-founder data
    const CoFounderShare = require('./CoFounderShare');
    const coFounderConfig = await CoFounderShare.findOne();
    const shareToRegularRatio = coFounderConfig?.shareToRegularRatio || 29;
    const coFounderSharesSold = coFounderConfig?.sharesSold || 0;
    const equivalentRegularSharesFromCoFounder = coFounderSharesSold * shareToRegularRatio;
    
    // Calculate total effective shares sold
    const totalEffectiveSharesSold = shareConfig.sharesSold + equivalentRegularSharesFromCoFounder;
    const totalEffectiveSharesRemaining = shareConfig.totalShares - totalEffectiveSharesSold;
    
    return {
      totalShares: shareConfig.totalShares,
      directRegularSharesSold: shareConfig.sharesSold,
      coFounderSharesSold: coFounderSharesSold,
      equivalentRegularSharesFromCoFounder: equivalentRegularSharesFromCoFounder,
      totalEffectiveSharesSold: totalEffectiveSharesSold,
      totalEffectiveSharesRemaining: totalEffectiveSharesRemaining,
      shareToRegularRatio: shareToRegularRatio,
      tierSales: shareConfig.tierSales,
      currentPrices: shareConfig.currentPrices,
      centiivConfig: shareConfig.centiivConfig
    };
  } catch (error) {
    console.error('Error getting comprehensive stats:', error);
    return null;
  }
};

// ADDED: Helper method to validate share allocation consistency
shareSchema.statics.validateShareConsistency = async function() {
  try {
    const stats = await this.getComprehensiveStats();
    
    if (!stats) {
      return { valid: false, message: 'Could not retrieve stats' };
    }
    
    // Check if total shares sold doesn't exceed total shares
    if (stats.totalEffectiveSharesSold > stats.totalShares) {
      return {
        valid: false,
        message: `Total effective shares sold (${stats.totalEffectiveSharesSold}) exceeds total shares (${stats.totalShares})`,
        oversold: stats.totalEffectiveSharesSold - stats.totalShares
      };
    }
    
    // Check tier consistency
    const tierTotal = stats.tierSales.tier1Sold + stats.tierSales.tier2Sold + stats.tierSales.tier3Sold;
    if (tierTotal !== stats.directRegularSharesSold) {
      return {
        valid: false,
        message: `Tier sales total (${tierTotal}) doesn't match direct regular shares sold (${stats.directRegularSharesSold})`,
        difference: tierTotal - stats.directRegularSharesSold
      };
    }
    
    return {
      valid: true,
      message: 'Share allocation is consistent',
      stats: stats
    };
  } catch (error) {
    return {
      valid: false,
      message: 'Error validating consistency: ' + error.message
    };
  }
};

// Generate Centiiv order subject line
shareSchema.statics.generateCentiivSubject = function(shares, customerName) {
  return `AfriMobile Share Purchase - ${shares} Shares for ${customerName}`;
};

// Generate Centiiv product description
shareSchema.statics.generateCentiivProduct = function(shares, tierBreakdown) {
  let description = `AfriMobile Shares (${shares} total)`;
  
  if (tierBreakdown.tier1 > 0) description += ` - Tier 1: ${tierBreakdown.tier1}`;
  if (tierBreakdown.tier2 > 0) description += ` - Tier 2: ${tierBreakdown.tier2}`;
  if (tierBreakdown.tier3 > 0) description += ` - Tier 3: ${tierBreakdown.tier3}`;
  
  return description;
};

const Share = mongoose.model('Share', shareSchema);

module.exports = Share;