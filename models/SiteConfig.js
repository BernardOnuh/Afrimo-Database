// models/SiteConfig.js
const mongoose = require('mongoose');

const siteConfigSchema = new mongoose.Schema({
  companyWalletAddress: {
    type: String,
    required: true,
    default: '0x8E5A1709A1dAD654668A8c44E1286b17eF5086B0' // Replace with your actual company wallet
  },
  supportedCryptos: [{
    symbol: String,
    network: String,
    contractAddress: String,
    enabled: Boolean
  }],
  // Add referral commission rates
  referralCommission: {
    generation1: {
      type: Number,
      default: 15 // 15% for direct referrals
    },
    generation2: {
      type: Number,
      default: 3  // 3% for second generation
    },
    generation3: {
      type: Number,
      default: 2  // 2% for third generation
    }
  },
  lastUpdated: {
    type: Date,
    default: Date.now
  }
});

// Static method to get current config
siteConfigSchema.statics.getCurrentConfig = async function() {
  let config = await this.findOne({});
  if (!config) {
    config = await this.create({
      // Make sure default values are set when creating a new config
      referralCommission: {
        generation1: 15,
        generation2: 3,
        generation3: 2
      }
    });
  } else if (!config.referralCommission) {
    // If config exists but doesn't have referralCommission, add it
    config.referralCommission = {
      generation1: 15,
      generation2: 3,
      generation3: 2
    };
    await config.save();
  }
  return config;
};

module.exports = mongoose.model('SiteConfig', siteConfigSchema);