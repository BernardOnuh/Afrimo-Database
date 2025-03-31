// models/SiteConfig.js
const mongoose = require('mongoose');

const siteConfigSchema = new mongoose.Schema({
  companyWalletAddress: {
    type: String,
    required: true,
    default: '0x1234567890abcdef1234567890abcdef12345678' // Replace with your actual company wallet
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