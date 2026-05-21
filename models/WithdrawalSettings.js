// models/WithdrawalSettings.js
const mongoose = require('mongoose');

const withdrawalSettingsSchema = new mongoose.Schema({
  globalWithdrawalEnabled: {
    type: Boolean,
    default: true,
    required: true
  },
  minimumWithdrawalAmount: {
    type: Number,
    default: 20000,
    required: true,
    min: 0
  },
  maxDailyWithdrawals: {
    type: Number,
    default: 5,
    required: true,
    min: 1
  },
  withdrawalFeePercentage: {
    type: Number,
    default: 0,
    required: true,
    min: 0,
    max: 100
  },
  reason: {
    type: String,
    trim: true
  },
  lastUpdated: {
    type: Date,
    default: Date.now
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }
}, {
  timestamps: true,
  collection: 'withdrawalsettings'
});

// Ensure only one settings document exists
withdrawalSettingsSchema.index({}, { unique: true });

module.exports = mongoose.model('WithdrawalSettings', withdrawalSettingsSchema);