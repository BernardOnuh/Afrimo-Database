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
  currency: {
    type: String,
    default: 'USD'
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'paid'],
    default: 'pending'
  },
  paymentMethod: {
    type: String,
    enum: ['bank', 'crypto', 'mobile_money'],
    required: true
  },
  paymentDetails: {
    // For bank transfers
    bankName: String,
    accountName: String,
    accountNumber: String,
    
    // For crypto transfers
    cryptoType: String,
    walletAddress: String,
    
    // For mobile money
    mobileProvider: String,
    mobileNumber: String
  },
  notes: {
    type: String
  },
  adminNotes: {
    type: String
  },
  transactionReference: {
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
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Withdrawal', WithdrawalSchema);