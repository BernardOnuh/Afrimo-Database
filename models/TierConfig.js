const mongoose = require('mongoose');
const { SHARE_TIERS } = require('./Share');

const tierConfigSchema = new mongoose.Schema({
  tiers: {
    type: Map,
    of: {
      name: { type: String, required: true },
      type: { type: String, enum: ['regular', 'cofounder'], required: true },
      priceUSD: { type: Number, required: true },
      priceNGN: { type: Number, required: true },
      percentPerShare: { type: Number, required: true },
      earningPerPhone: { type: Number, default: null },
      sharesIncluded: { type: Number, default: 1 }
    },
    default: () => new Map(Object.entries(SHARE_TIERS))
  }
}, { timestamps: true });

// Get current tier config (singleton pattern)
tierConfigSchema.statics.getCurrentConfig = async function() {
  let config = await this.findOne().sort({ updatedAt: -1 });
  if (!config) {
    // Create from defaults
    config = await this.create({ tiers: new Map(Object.entries(SHARE_TIERS)) });
  }
  return config;
};

// Get tiers as plain object
tierConfigSchema.statics.getTiersObject = async function() {
  const config = await this.getCurrentConfig();
  const obj = {};
  for (const [key, value] of config.tiers) {
    obj[key] = value.toObject ? value.toObject() : value;
  }
  return obj;
};

module.exports = mongoose.model('TierConfig', tierConfigSchema);
