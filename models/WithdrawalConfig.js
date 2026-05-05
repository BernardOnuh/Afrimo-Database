const mongoose = require('mongoose');

const WithdrawalConfigSchema = new mongoose.Schema({
  key: { type: String, unique: true, required: true },
  value: { type: mongoose.Schema.Types.Mixed, required: true },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  updatedAt: { type: Date, default: Date.now },
  reason: { type: String }
});

module.exports = mongoose.model('WithdrawalConfig', WithdrawalConfigSchema);
