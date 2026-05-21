const mongoose = require('mongoose');

const UserWithdrawalControlSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  isPaused: { type: Boolean, default: false },
  isBlacklisted: { type: Boolean, default: false },
  customMinLimit: { type: Number, default: null },
  customMaxLimit: { type: Number, default: null },
  pauseReason: { type: String },
  blacklistReason: { type: String },
  pausedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  blacklistedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  pausedAt: { type: Date },
  blacklistedAt: { type: Date },
  updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('UserWithdrawalControl', UserWithdrawalControlSchema);
