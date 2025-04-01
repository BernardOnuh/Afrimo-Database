// models/PaymentConfig.js
const mongoose = require('mongoose');

/**
 * Payment configuration schema
 * Stores payment-related settings like wallet addresses and provider keys
 */
const PaymentConfigSchema = new mongoose.Schema({
  companyWalletAddress: {
    type: String,
    required: true
  },
  paystackPublicKey: {
    type: String
  },
  paystackSecretKey: {
    type: String
  },
  supportedCryptos: [{
    name: {
      type: String,
      required: true
    },
    ticker: {
      type: String,
      required: true
    },
    network: {
      type: String,
      required: true
    },
    enabled: {
      type: Boolean,
      default: true
    }
  }],
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

/**
 * Get the current payment configuration
 * Creates a default one if none exists
 */
PaymentConfigSchema.statics.getCurrentConfig = async function() {
  const config = await this.findOne();
  
  if (config) {
    return config;
  }
  
  // Create default config
  return this.create({
    companyWalletAddress: process.env.COMPANY_WALLET_ADDRESS || '0x8E5A1709A1dAD654668A8c44E1286b17eF5086B0',
    paystackPublicKey: process.env.PAYSTACK_PUBLIC_KEY,
    paystackSecretKey: process.env.PAYSTACK_SECRET_KEY,
    supportedCryptos: [
      {
        name: 'USDT (BEP-20)',
        ticker: 'USDT',
        network: 'BSC',
        enabled: true
      }
    ]
  });
};

module.exports = mongoose.model('PaymentConfig', PaymentConfigSchema);