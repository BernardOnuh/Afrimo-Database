const mongoose = require('mongoose');

// Default share tiers configuration
const DEFAULT_TIERS = {
  basic: {
    name: 'Basic Package',
    type: 'share',
    priceUSD: 30,
    priceNGN: 50000,
    percentPerShare: 0.000042,
    earningPerPhone: 28000,
    sharesIncluded: 1,
    active: true,
    description: 'Entry-level share package for new investors',
    maxPurchases: null  // No limit
  },
  premium: {
    name: 'Premium Package',
    type: 'share',
    priceUSD: 60,
    priceNGN: 100000,
    percentPerShare: 0.000084,
    earningPerPhone: 56000,
    sharesIncluded: 1,
    active: true,
    description: 'Premium package for serious investors',
    maxPurchases: null
  },
  elite: {
    name: 'Elite Package',
    type: 'share',
    priceUSD: 90,
    priceNGN: 150000,
    percentPerShare: 0.000126,
    earningPerPhone: 84000,
    sharesIncluded: 1,
    active: true,
    description: 'Elite package for top-tier investors',
    maxPurchases: null
  }
};
const CO_FOUNDER_TO_REGULAR_RATIO = 22;

const tierConfigSchema = new mongoose.Schema({
  tiers: {
    type: Map,
    of: {
      name: { type: String, required: true },
      type: { 
        type: String, 
        enum: ['share', 'co-founder', 'regular', 'cofounder'],
        required: true 
      },
      priceUSD: { type: Number, required: true, min: 0 },
      priceNGN: { type: Number, required: true, min: 0 },
      percentPerShare: { type: Number, required: true, min: 0 },
      earningPerPhone: { type: Number, default: 0 },
      earningInKobo: { type: Number, default: null },
      sharesIncluded: { type: Number, default: 1, min: 1 },
      active: { type: Boolean, default: true },
      description: { type: String, default: '' },
      maxPurchases: { type: Number, default: null, min: 1 },
      priceHistory: {
        type: [{
          priceNGN: Number,
          priceUSD: Number,
          changedAt: { type: Date, default: Date.now },
          changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
          reason: String
        }],
        default: []
      },
      metadata: {
        type: Map,
        of: mongoose.Schema.Types.Mixed,
        default: () => new Map()
      }
    },
    default: () => new Map(Object.entries(DEFAULT_TIERS))
  },
  totalSupply: {
    type: Number,
    default: 10000,
    min: 0,
    description: 'Total number of share packages available for sale'
  },
  active: {
    type: Boolean,
    default: true,
    description: 'Whether the share program is active'
  },
  version: {
    type: Number,
    default: 1,
    description: 'Configuration version for tracking changes'
  },
  lastUpdatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    description: 'Admin who last updated the config'
  }
}, { 
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Virtual for formatted total supply
tierConfigSchema.virtual('formattedTotalSupply').get(function() {
  return this.totalSupply.toLocaleString();
});

// Virtual for active tier count
tierConfigSchema.virtual('activeTierCount').get(function() {
  let count = 0;
  for (const tier of this.tiers.values()) {
    if (tier.type === 'share' && tier.active === true) {
      count++;
    }
  }
  return count;
});

// Get current tier config (singleton pattern)
tierConfigSchema.statics.getCurrentConfig = async function() {
  let config = await this.findOne().sort({ updatedAt: -1 });
  if (!config) {
    // Create from defaults
    config = await this.create({ 
      tiers: new Map(Object.entries(DEFAULT_TIERS)),
      version: 1
    });
  }
  return config;
};

// Get tiers as plain object (share tiers only)
tierConfigSchema.statics.getTiersObject = async function() {
  const config = await this.getCurrentConfig();
  const obj = {};
  for (const [key, value] of config.tiers) {
    if (value.type === 'share' || value.type === 'regular') {
      obj[key] = value.toObject ? value.toObject() : value;
    }
  }
  return obj;
};

// Get all tiers including co-founder
tierConfigSchema.statics.getAllTiers = async function() {
  const config = await this.getCurrentConfig();
  const tiers = {
    share: [],
    cofounder: []
  };
  
  for (const [key, value] of config.tiers) {
    const tierData = value.toObject ? value.toObject() : value;
    tierData.key = key;
    
    if (value.type === 'share' || value.type === 'regular') {
      tiers.share.push(tierData);
    } else if (value.type === 'co-founder' || value.type === 'cofounder') {
      tiers.cofounder.push(tierData);
    }
  }
  
  return tiers;
};

// Get tier by key
tierConfigSchema.statics.getTier = async function(tierKey) {
  const config = await this.getCurrentConfig();
  const tier = config.tiers.get(tierKey);
  if (!tier) return null;
  
  const tierData = tier.toObject ? tier.toObject() : tier;
  tierData.key = tierKey;
  return tierData;
};

// Update tier pricing with history tracking
tierConfigSchema.statics.updateTierPricing = async function(tierKey, priceNGN, priceUSD, reason, updatedBy) {
  const config = await this.getCurrentConfig();
  
  if (!config.tiers.has(tierKey)) {
    throw new Error(`Tier '${tierKey}' not found`);
  }
  
  const tier = config.tiers.get(tierKey);
  const oldPriceNGN = tier.priceNGN;
  const oldPriceUSD = tier.priceUSD;
  
  // Update prices
  if (priceNGN !== undefined) tier.priceNGN = priceNGN;
  if (priceUSD !== undefined) tier.priceUSD = priceUSD;
  
  // Add to price history
  if (!tier.priceHistory) tier.priceHistory = [];
  tier.priceHistory.push({
    priceNGN: tier.priceNGN,
    priceUSD: tier.priceUSD,
    changedAt: new Date(),
    changedBy: updatedBy,
    reason: reason || 'Price update'
  });
  
  // Keep only last 20 price changes
  if (tier.priceHistory.length > 20) {
    tier.priceHistory = tier.priceHistory.slice(-20);
  }
  
  config.tiers.set(tierKey, tier);
  config.lastUpdatedBy = updatedBy;
  config.version += 1;
  await config.save();
  
  return {
    tierKey,
    name: tier.name,
    oldPrice: { naira: oldPriceNGN, usd: oldPriceUSD },
    newPrice: { naira: tier.priceNGN, usd: tier.priceUSD }
  };
};

// Update tier active status
tierConfigSchema.statics.updateTierStatus = async function(tierKey, active, reason, updatedBy) {
  const config = await this.getCurrentConfig();
  
  if (!config.tiers.has(tierKey)) {
    throw new Error(`Tier '${tierKey}' not found`);
  }
  
  const tier = config.tiers.get(tierKey);
  const oldStatus = tier.active;
  tier.active = active;
  
  // Add to metadata for audit
  if (!tier.metadata) tier.metadata = new Map();
  const statusHistory = tier.metadata.get('statusHistory') || [];
  statusHistory.push({
    previousStatus: oldStatus,
    newStatus: active,
    changedAt: new Date(),
    changedBy: updatedBy,
    reason: reason || `Status ${active ? 'activated' : 'deactivated'}`
  });
  tier.metadata.set('statusHistory', statusHistory.slice(-10));
  
  config.tiers.set(tierKey, tier);
  config.lastUpdatedBy = updatedBy;
  config.version += 1;
  await config.save();
  
  return {
    tierKey,
    name: tier.name,
    active: tier.active,
    previousStatus: oldStatus
  };
};

// Add a new tier
tierConfigSchema.statics.addTier = async function(tierKey, tierData, createdBy) {
  const config = await this.getCurrentConfig();
  
  if (config.tiers.has(tierKey)) {
    throw new Error(`Tier '${tierKey}' already exists`);
  }
  
  // Validate required fields
  const requiredFields = ['name', 'type', 'priceUSD', 'priceNGN', 'percentPerShare'];
  for (const field of requiredFields) {
    if (!tierData[field]) {
      throw new Error(`Missing required field: ${field}`);
    }
  }
  
  // Set defaults for optional fields
  const newTier = {
    name: tierData.name,
    type: tierData.type,
    priceUSD: tierData.priceUSD,
    priceNGN: tierData.priceNGN,
    percentPerShare: tierData.percentPerShare,
    earningPerPhone: tierData.earningPerPhone || 0,
    sharesIncluded: tierData.sharesIncluded || 1,
    active: tierData.active !== undefined ? tierData.active : true,
    description: tierData.description || '',
    maxPurchases: tierData.maxPurchases || null,
    priceHistory: [{
      priceNGN: tierData.priceNGN,
      priceUSD: tierData.priceUSD,
      changedAt: new Date(),
      changedBy: createdBy,
      reason: 'Tier created'
    }],
    metadata: new Map()
  };
  
  config.tiers.set(tierKey, newTier);
  config.lastUpdatedBy = createdBy;
  config.version += 1;
  await config.save();
  
  return {
    tierKey,
    ...newTier
  };
};

// Delete a tier (only if no completed transactions exist)
tierConfigSchema.statics.deleteTier = async function(tierKey, deletedBy) {
  const PaymentTransaction = require('./Transaction');
  
  // Check if tier has any completed transactions
  const hasTransactions = await PaymentTransaction.exists({
    tierKey: tierKey,
    status: 'completed'
  });
  
  if (hasTransactions) {
    throw new Error('Cannot delete tier that has completed transactions. Deactivate it instead.');
  }
  
  const config = await this.getCurrentConfig();
  
  if (!config.tiers.has(tierKey)) {
    throw new Error(`Tier '${tierKey}' not found`);
  }
  
  config.tiers.delete(tierKey);
  config.lastUpdatedBy = deletedBy;
  config.version += 1;
  await config.save();
  
  return { tierKey, deleted: true };
};

// Get total supply
tierConfigSchema.statics.getTotalSupply = async function() {
  const config = await this.getCurrentConfig();
  return config.totalSupply || 10000;
};

// Update total supply
tierConfigSchema.statics.updateTotalSupply = async function(newSupply, reason, updatedBy) {
  const config = await this.getCurrentConfig();
  const oldSupply = config.totalSupply;
  
  config.totalSupply = newSupply;
  config.lastUpdatedBy = updatedBy;
  config.version += 1;
  
  // Add to metadata for audit
  if (!config.metadata) config.metadata = new Map();
  const supplyHistory = config.metadata.get('supplyHistory') || [];
  supplyHistory.push({
    oldSupply,
    newSupply,
    reason,
    changedAt: new Date(),
    changedBy: updatedBy
  });
  config.metadata.set('supplyHistory', supplyHistory.slice(-10));
  
  await config.save();
  
  return {
    oldSupply,
    newSupply,
    reason
  };
};

// Get statistics summary for all tiers
tierConfigSchema.statics.getTierStatistics = async function() {
  const PaymentTransaction = require('./Transaction');
  const config = await this.getCurrentConfig();
  
  const stats = {
    totalSupply: config.totalSupply,
    activeTiers: 0,
    inactiveTiers: 0,
    tiers: []
  };
  
  for (const [key, tier] of config.tiers) {
    if (tier.type !== 'share') continue;
    
    const tierSales = await PaymentTransaction.aggregate([
      {
        $match: {
          tierKey: key,
          type: 'share',
          status: 'completed'
        }
      },
      {
        $group: {
          _id: null,
          totalShares: { $sum: '$shares' },
          totalAmount: { $sum: '$amount' },
          count: { $sum: 1 }
        }
      }
    ]);
    
    const sales = tierSales[0] || { totalShares: 0, totalAmount: 0, count: 0 };
    
    stats.tiers.push({
      key,
      name: tier.name,
      active: tier.active,
      priceNGN: tier.priceNGN,
      priceUSD: tier.priceUSD,
      percentPerShare: tier.percentPerShare,
      formattedPercentPerShare: `${(tier.percentPerShare * 100).toFixed(4)}%`,
      earningPerPhone: tier.earningPerPhone,
      formattedEarningPerPhone: `₦${(tier.earningPerPhone / 100).toLocaleString()}`,
      sharesSold: sales.totalShares,
      totalRevenue: sales.totalAmount,
      transactionCount: sales.count,
      maxAvailable: config.totalSupply
    });
    
    if (tier.active) stats.activeTiers++;
    else stats.inactiveTiers++;
  }
  
  return stats;
};

// Method to get price history for a tier
tierConfigSchema.methods.getTierPriceHistory = function(tierKey, limit = 10) {
  const tier = this.tiers.get(tierKey);
  if (!tier || !tier.priceHistory) return [];
  return tier.priceHistory.slice(-limit).reverse();
};

// Method to check if tier is available for purchase
tierConfigSchema.methods.isTierAvailable = function(tierKey) {
  const tier = this.tiers.get(tierKey);
  if (!tier) return false;
  return tier.active === true && tier.type === 'share';
};

module.exports = mongoose.model('TierConfig', tierConfigSchema);