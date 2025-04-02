const mongoose = require('mongoose');

/**
 * Payment configuration schema
 * Stores payment-related settings like wallet addresses and provider keys
 */
const PaymentConfigSchema = new mongoose.Schema({
  companyWalletAddress: {
    type: String,
    required: true,
    default: () => process.env.COMPANY_WALLET_ADDRESS || '0x8E5A1709A1dAD654668A8c44E1286b17eF5086B0'
  },
  paystackPublicKey: {
    type: String,
    default: () => process.env.PAYSTACK_PUBLIC_KEY || ''
  },
  paystackSecretKey: {
    type: String,
    default: () => process.env.PAYSTACK_SECRET_KEY || ''
  },
  companyBankDetails: {
    bankName: {
      type: String,
      default: 'AfriMobile Bank'
    },
    accountNumber: {
      type: String,
      default: '1234567890'
    },
    accountName: {
      type: String,
      default: 'AfriMobile Investments'
    }
  },
  supportedCryptos: [{
    name: {
      type: String,
      required: true,
      default: 'USDT (BEP-20)'
    },
    ticker: {
      type: String,
      required: true,
      default: 'USDT'
    },
    network: {
      type: String,
      required: true,
      default: 'BSC'
    },
    enabled: {
      type: Boolean,
      default: true
    },
    walletAddress: {
      type: String,
      default: () => process.env.COMPANY_USDT_WALLET || ''
    }
  }],
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, { 
  // Ensure unique configuration
  timestamps: true 
});

/**
 * Get the current payment configuration
 * Creates a default one if none exists
 */
PaymentConfigSchema.statics.getCurrentConfig = async function() {
  try {
    let config = await this.findOne();
    
    if (!config) {
      config = await this.create({
        companyWalletAddress: process.env.COMPANY_WALLET_ADDRESS || '0x8E5A1709A1dAD654668A8c44E1286b17eF5086B0',
        supportedCryptos: [{
          name: 'USDT (BEP-20)',
          ticker: 'USDT',
          network: 'BSC',
          enabled: true,
          walletAddress: process.env.COMPANY_USDT_WALLET || ''
        }]
      });
    }
    
    return config;
  } catch (error) {
    console.error('Error getting payment configuration:', error);
    throw error;
  }
};

// Ensure only one configuration document exists
PaymentConfigSchema.pre('save', async function(next) {
  if (this.isNew) {
    const existingConfig = await this.constructor.findOne();
    if (existingConfig) {
      // Update existing document instead of creating a new one
      existingConfig.set(this);
      return next(new Error('Only one payment configuration is allowed'));
    }
  }
  next();
});

const PaymentConfig = mongoose.model('PaymentConfig', PaymentConfigSchema);

module.exports = PaymentConfig;