// models/Withdrawal.js
const mongoose = require('mongoose');

const WithdrawalSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  amount: {
    type: Number,
    required: true
  },
  paymentMethod: {
    type: String,
    enum: ['bank', 'crypto', 'mobile_money'],
    required: true
  },
  paymentDetails: {
    // Bank transfer details
    bankName: String,
    accountName: String,
    accountNumber: String,
    bankCode: String,
    
    // Crypto wallet details
    cryptoType: String,
    walletAddress: String,
    
    // Mobile money details
    mobileProvider: String,
    mobileNumber: String
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'processing', 'paid', 'failed', 'rejected'],
    default: 'pending'
  },
  notes: {
    type: String
  },
  adminNotes: {
    type: String
  },
  processedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  processedAt: {
    type: Date
  },
  rejectionReason: {
    type: String
  },
  transactionReference: {
    type: String
  },
  clientReference: {
    type: String
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Withdrawal', WithdrawalSchema);