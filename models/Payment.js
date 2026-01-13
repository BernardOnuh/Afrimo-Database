// models/Payment.js
/**
 * Payment Model
 * Stores user payment methods (bank and crypto)
 */

const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true
    },

    // ========== BANK ACCOUNT FIELDS ==========
    bankAccount: {
      bankName: {
        type: String,
        trim: true
      },
      accountName: {
        type: String,
        trim: true
      },
      accountNumber: {
        type: String,
        trim: true
      },
      bankCode: {
        type: String,
        trim: true
      },
      verified: {
        type: Boolean,
        default: false
      },
      verifiedAt: Date,
      verificationAttempts: {
        type: Number,
        default: 0
      },
      lastVerificationAttempt: Date
    },

    // ========== CRYPTO WALLET FIELDS ==========
    cryptoWallet: {
      walletAddress: {
        type: String,
        lowercase: true,
        sparse: true
      },
      chainName: {
        type: String,
        enum: ['BNB'],
        default: 'BNB',
        sparse: true
      },
      cryptoType: {
        type: String,
        enum: ['USDT'],
        default: 'USDT',
        sparse: true
      },
      verified: {
        type: Boolean,
        default: false
      },
      verifiedAt: Date,
      verificationHash: {
        type: String,
        sparse: true
      },
      verificationAttempts: {
        type: Number,
        default: 0
      },
      lastVerificationAttempt: Date,
      lastUsedAt: Date
    },

    // ========== PAYMENT METHOD PREFERENCE ==========
    preferredWithdrawalMethod: {
      type: String,
      enum: ['bank', 'crypto'],
      sparse: true
    },

    // ========== METADATA ==========
    isVerified: {
      type: Boolean,
      default: false
    },

    createdAt: {
      type: Date,
      default: Date.now
    },
    updatedAt: {
      type: Date,
      default: Date.now
    }
  },
  {
    timestamps: true
  }
);

// Index for crypto wallet address (prevent duplicates across users)
paymentSchema.index({ 
  'cryptoWallet.walletAddress': 1, 
  'cryptoWallet.chainName': 1 
}, { sparse: true });

// Index for bank account (prevent duplicates)
paymentSchema.index({ 
  'bankAccount.accountNumber': 1, 
  'bankAccount.bankCode': 1 
}, { sparse: true });

// Pre-save hook to update updatedAt
paymentSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

// Method to check if user has any verified payment method
paymentSchema.methods.hasVerifiedPaymentMethod = function() {
  const hasBankAccount = this.bankAccount && this.bankAccount.verified;
  const hasCryptoWallet = this.cryptoWallet && this.cryptoWallet.verified;
  return hasBankAccount || hasCryptoWallet;
};

// Method to get available withdrawal methods
paymentSchema.methods.getAvailableWithdrawalMethods = function() {
  const methods = [];
  if (this.bankAccount && this.bankAccount.verified) {
    methods.push('bank');
  }
  if (this.cryptoWallet && this.cryptoWallet.verified) {
    methods.push('crypto');
  }
  return methods;
};

module.exports = mongoose.model('Payment', paymentSchema);