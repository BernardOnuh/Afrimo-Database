// models/CryptoWallet.js
const mongoose = require('mongoose');

const cryptoWalletSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true
    },
    walletAddress: {
      type: String,
      required: true,
      lowercase: true
    },
    cryptoType: {
      type: String,
      enum: ['USDT'],
      default: 'USDT'
    },
    chainName: {
      type: String,
      enum: ['BNB'],
      default: 'BNB'
    },
    verified: {
      type: Boolean,
      default: false
    },
    verificationHash: {
      type: String,
      sparse: true
    },
    verificationDate: Date,
    // Track failed verification attempts
    verificationAttempts: {
      type: Number,
      default: 0
    },
    lastVerificationAttempt: Date,
    // For security
    lastUsedAt: Date
  },
  {
    timestamps: true
  }
);

// Prevent duplicate wallet addresses across users
cryptoWalletSchema.index({ walletAddress: 1, chainName: 1 });

module.exports = mongoose.model('CryptoWallet', cryptoWalletSchema);