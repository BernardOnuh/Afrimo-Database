// models/Withdrawal.js
/**
 * Withdrawal Model
 * Handles both Bank and Crypto withdrawals
 */

const mongoose = require('mongoose');

const withdrawalSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },

    // Amount in NGN
    amount: {
      type: Number,
      required: true
    },

    // Type of withdrawal: 'bank' or 'crypto'
    withdrawalType: {
      type: String,
      enum: ['bank', 'crypto'],
      default: 'bank',
      index: true
    },

    // ========== BANK WITHDRAWAL FIELDS ==========
    paymentMethod: {
      type: String,
      enum: ['bank', 'crypto', 'mobile_money'],
      sparse: true
    },

    paymentDetails: {
      bankName: String,
      accountName: String,
      accountNumber: String,
      bankCode: String,
      // For mobile money
      mobileProvider: String,
      mobileNumber: String,
      // For crypto
      cryptoType: String,
      walletAddress: String
    },

    // Bank-specific fields
    transactionReference: {
      type: String,
      sparse: true
    },

    // ========== CRYPTO WITHDRAWAL FIELDS ==========
    cryptoDetails: {
      amountUSDT: Number,
      walletAddress: {
        type: String,
        lowercase: true
      },
      chainName: {
        type: String,
        enum: ['BNB'],
        default: 'BNB'
      },
      transactionHash: {
        type: String,
        sparse: true,
        unique: true
      },
      blockNumber: Number,
      exchangeRate: Number, // NGN per USDT at time of withdrawal
      gasUsed: String
    },

    // ========== WITHDRAWAL STATUS ==========
    status: {
      type: String,
      enum: ['pending', 'processing', 'paid', 'failed', 'approved', 'rejected'],
      default: 'pending',
      index: true
    },

    // ========== TRACKING FIELDS ==========
    clientReference: {
      type: String,
      required: true,
      unique: true,
      index: true
    },

    notes: String,
    adminNotes: String,

    // ========== ADMIN APPROVAL WORKFLOW ==========
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      sparse: true
    },
    approvedAt: Date,

    rejectedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      sparse: true
    },
    rejectedAt: Date,
    rejectionReason: String,

    paidBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      sparse: true
    },

    // ========== PROCESSING TIMESTAMPS ==========
    processedAt: Date,
    failedAt: Date,

    // For retries
    retryCount: {
      type: Number,
      default: 0
    },
    lastRetryAt: Date,
    failureReason: String,

    createdAt: {
      type: Date,
      default: Date.now,
      index: true
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

// Indexes for efficient querying
withdrawalSchema.index({ user: 1, createdAt: -1 });
withdrawalSchema.index({ status: 1, createdAt: -1 });
withdrawalSchema.index({ withdrawalType: 1, status: 1 });
withdrawalSchema.index({ walletAddress: 1 }, { sparse: true });
withdrawalSchema.index({ cryptoDetails: { transactionHash: 1 } }, { sparse: true });

// Pre-save hook to update updatedAt
withdrawalSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model('Withdrawal', withdrawalSchema);