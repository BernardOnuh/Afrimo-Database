const mongoose = require('mongoose');

/**
 * MIGRATION NOTE (Feb 2026):
 * Old tier1/tier2/tier3 structure replaced with new 6-tier system.
 * Migration mapping for existing data:
 *   - Old regular/ordinary share buyers → reclassify as "standard" tier
 *   - Old cofounder buyers → reclassify as "elite" tier
 * Shares are now tracked in percentage (%) not raw numbers.
 * 
 * New Tier Structure:
 * REGULAR SHARES:
 *   basic:    $30 / ₦30,000  — 0.00001% per share  — ₦6,000 earning/phone
 *   standard: $50 / ₦50,000  — 0.000021% per share — ₦14,000 earning/phone
 *   premium:  $100 / ₦100,000 — 0.00005% per share — ₦30,000 earning/phone
 * 
 * CO-FOUNDER TIERS:
 *   elite:    $1,000 / ₦1,000,000  — 22 shares @ 0.000021% each — ₦14,000/phone
 *   platinum: $2,500 / ₦2,500,000  — 27 shares @ 0.00005% each
 *   supreme:  $5,000 / ₦5,000,000  — 60 shares @ 0.00005% each
 */

// Tier configuration constants
const SHARE_TIERS = {
  // Regular share tiers
  basic: {
    name: 'Basic',
    type: 'regular',
    priceUSD: 30,
    priceNGN: 30000,
    percentPerShare: 0.00001,
    earningPerPhone: 6000,
    sharesIncluded: 1
  },
  standard: {
    name: 'Standard',
    type: 'regular',
    priceUSD: 50,
    priceNGN: 50000,
    percentPerShare: 0.000021,
    earningPerPhone: 14000,
    sharesIncluded: 1
  },
  premium: {
    name: 'Premium',
    type: 'regular',
    priceUSD: 100,
    priceNGN: 100000,
    percentPerShare: 0.00005,
    earningPerPhone: 30000,
    sharesIncluded: 1
  },
  // Co-Founder tiers
  elite: {
    name: 'Elite',
    type: 'cofounder',
    priceUSD: 1000,
    priceNGN: 1000000,
    percentPerShare: 0.000021,
    earningPerPhone: 14000,
    sharesIncluded: 22
  },
  platinum: {
    name: 'Platinum',
    type: 'cofounder',
    priceUSD: 2500,
    priceNGN: 2500000,
    percentPerShare: 0.00005,
    earningPerPhone: null,
    sharesIncluded: 27
  },
  supreme: {
    name: 'Supreme',
    type: 'cofounder',
    priceUSD: 5000,
    priceNGN: 5000000,
    percentPerShare: 0.00005,
    earningPerPhone: null,
    sharesIncluded: 60
  }
};

const shareSchema = new mongoose.Schema({
  // New tier-based pricing configuration
  tiers: {
    type: Object,
    default: SHARE_TIERS
  },

  // Legacy fields kept for backward compatibility
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

  totalShares: {
    type: Number,
    default: 10000
  },

  sharesSold: {
    type: Number,
    default: 0
  },

  // Track sales per new tier
  tierSales: {
    tier1Sold: { type: Number, default: 0 },
    tier2Sold: { type: Number, default: 0 },
    tier3Sold: { type: Number, default: 0 },
    // New tier sales tracking
    basicSold: { type: Number, default: 0 },
    standardSold: { type: Number, default: 0 },
    premiumSold: { type: Number, default: 0 },
    eliteSold: { type: Number, default: 0 },
    platinumSold: { type: Number, default: 0 },
    supremeSold: { type: Number, default: 0 }
  },

  // Total percentage sold
  totalPercentageSold: {
    type: Number,
    default: 0
  },

  centiivConfig: {
    enabled: { type: Boolean, default: true },
    reminderInterval: { type: Number, default: 7 },
    defaultDueDays: { type: Number, default: 30 },
    lastOrderId: { type: String, default: null }
  },

  updatedAt: {
    type: Date,
    default: Date.now
  }
}, { timestamps: true });

// Static: get tier configuration
shareSchema.statics.getTierConfig = function() {
  return SHARE_TIERS;
};

// Static: get regular tiers only
shareSchema.statics.getRegularTiers = function() {
  return Object.entries(SHARE_TIERS)
    .filter(([, v]) => v.type === 'regular')
    .reduce((acc, [k, v]) => ({ ...acc, [k]: v }), {});
};

// Static: get cofounder tiers only
shareSchema.statics.getCoFounderTiers = function() {
  return Object.entries(SHARE_TIERS)
    .filter(([, v]) => v.type === 'cofounder')
    .reduce((acc, [k, v]) => ({ ...acc, [k]: v }), {});
};

// Create or get the current share configuration
shareSchema.statics.getCurrentConfig = async function() {
  let config = await this.findOne().sort({ createdAt: -1 });
  if (!config) {
    config = await this.create({ tiers: SHARE_TIERS });
  }
  return config;
};

// Calculate purchase for a specific tier
shareSchema.statics.calculatePurchase = async function(quantity, currency, tier = 'standard') {
  try {
    // Try to load dynamic tier config from DB, fall back to SHARE_TIERS
    let tierConfig;
    try {
      const TierConfig = require('./TierConfig');
      const dbTiers = await TierConfig.getTiersObject();
      tierConfig = dbTiers[tier] || SHARE_TIERS[tier];
    } catch (e) {
      tierConfig = SHARE_TIERS[tier];
    }
    if (!tierConfig) {
      return {
        success: false,
        message: `Invalid tier: ${tier}. Valid tiers: ${Object.keys(SHARE_TIERS).join(', ')}`,
        totalPrice: 0, currency, totalShares: 0
      };
    }

    const pricePerUnit = currency === 'naira' ? tierConfig.priceNGN : tierConfig.priceUSD;
    const totalPrice = quantity * pricePerUnit;
    const totalShares = tierConfig.type === 'cofounder' ? quantity * tierConfig.sharesIncluded : quantity;
    const totalPercent = totalShares * tierConfig.percentPerShare;

    return {
      success: true,
      tier: tier,
      tierName: tierConfig.name,
      tierType: tierConfig.type,
      totalPrice,
      currency,
      quantity,
      totalShares,
      percentPerShare: tierConfig.percentPerShare,
      totalPercent: totalPercent,
      totalPercentFormatted: `${totalPercent}%`,
      earningPerPhone: tierConfig.earningPerPhone,
      sharesIncluded: tierConfig.sharesIncluded,
      pricePerUnit
    };
  } catch (error) {
    console.error('Error calculating purchase:', error);
    return {
      success: false,
      message: 'Error calculating purchase details',
      totalPrice: 0, currency, totalShares: 0,
      error: error.message
    };
  }
};

// Calculate purchase specifically for Centiiv payments
shareSchema.statics.calculateCentiivPurchase = async function(quantity, tier = 'standard') {
  const config = await this.getCurrentConfig();
  if (!config.centiivConfig.enabled) {
    return { success: false, message: 'Centiiv payments are currently disabled' };
  }

  const purchaseDetails = await this.calculatePurchase(quantity, 'naira', tier);
  if (purchaseDetails.success) {
    purchaseDetails.centiivDetails = {
      reminderInterval: config.centiivConfig.reminderInterval,
      dueDate: new Date(Date.now() + config.centiivConfig.defaultDueDays * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    };
  }
  return purchaseDetails;
};

// Get comprehensive share statistics in percentage format
shareSchema.statics.getComprehensiveStats = async function() {
  try {
    const shareConfig = await this.getCurrentConfig();

    return {
      tiers: SHARE_TIERS,
      tierSales: shareConfig.tierSales,
      totalPercentageSold: shareConfig.totalPercentageSold,
      // Legacy fields
      totalShares: shareConfig.totalShares,
      sharesSold: shareConfig.sharesSold,
      currentPrices: shareConfig.currentPrices,
      centiivConfig: shareConfig.centiivConfig
    };
  } catch (error) {
    console.error('Error getting comprehensive stats:', error);
    return null;
  }
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

// Generate Centiiv order subject line
shareSchema.statics.generateCentiivSubject = function(shares, customerName, tier) {
  const tierConfig = SHARE_TIERS[tier] || SHARE_TIERS.standard;
  return `AfriMobile ${tierConfig.name} Share Purchase - ${shares} Shares for ${customerName}`;
};

// Generate Centiiv product description
shareSchema.statics.generateCentiivProduct = function(shares, tier) {
  const tierConfig = SHARE_TIERS[tier] || SHARE_TIERS.standard;
  const percent = (shares * tierConfig.percentPerShare).toFixed(6);
  return `AfriMobile ${tierConfig.name} Shares (${shares} shares, ${percent}% ownership)`;
};

const Share = mongoose.model('Share', shareSchema);

module.exports = Share;
module.exports.SHARE_TIERS = SHARE_TIERS;
