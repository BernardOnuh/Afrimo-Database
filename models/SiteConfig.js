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
  lastUpdated: {
    type: Date,
    default: Date.now
  }
});

// Static method to get current config
siteConfigSchema.statics.getCurrentConfig = async function() {
  let config = await this.findOne({});
  if (!config) {
    config = await this.create({});
  }
  return config;
};

module.exports = mongoose.model('SiteConfig', siteConfigSchema);