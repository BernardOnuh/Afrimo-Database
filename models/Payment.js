// models/Payment.js
const mongoose = require('mongoose');

const PaymentSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  // Bank account details
  bankAccount: {
    accountName: {
      type: String,
      trim: true
    },
    bankName: {
      type: String,
      trim: true
    },
    accountNumber: {
      type: String,
      trim: true
    }
  },
  // Crypto wallet details
  cryptoWallet: {
    cryptoType: {
      type: String,
      trim: true,
      enum: ['BTC', 'ETH', 'BNB', 'USDT', 'USDC', 'Other']
    },
    walletAddress: {
      type: String,
      trim: true
    }
  },
  // KYC documents
  kycDocuments: {
    governmentId: {
      filename: String,
      originalName: String,
      mimetype: String,
      path: String,
      size: Number,
      uploadDate: {
        type: Date,
        default: Date.now
      },
      status: {
        type: String,
        enum: ['pending', 'approved', 'rejected'],
        default: 'pending'
      },
      rejectionReason: String
    },
    proofOfAddress: {
      filename: String,
      originalName: String,
      mimetype: String,
      path: String,
      size: Number,
      uploadDate: {
        type: Date,
        default: Date.now
      },
      status: {
        type: String,
        enum: ['pending', 'approved', 'rejected'],
        default: 'pending'
      },
      rejectionReason: String
    }
  },
  // KYC verification status
  kycVerified: {
    type: Boolean,
    default: false
  },
  // Payment verification status
  isVerified: {
    type: Boolean,
    default: false
  },
  verificationNotes: {
    type: String,
    trim: true
  },
  verifiedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  verifiedAt: {
    type: Date
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Payment', PaymentSchema);