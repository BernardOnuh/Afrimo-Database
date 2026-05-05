/**
 * Tracks every admin action taken on the withdrawal system
 */
const mongoose = require('mongoose');

const WithdrawalAuditLogSchema = new mongoose.Schema({
  action: {
    type: String,
    required: true,
    enum: [
      'GLOBAL_PAUSE', 'GLOBAL_RESUME',
      'EMERGENCY_FREEZE', 'EMERGENCY_UNFREEZE',
      'BANK_DISABLED', 'BANK_ENABLED',
      'CRYPTO_DISABLED', 'CRYPTO_ENABLED',
      'GLOBAL_LIMITS_SET',
      'USER_PAUSED', 'USER_RESUMED',
      'USER_BLACKLISTED', 'USER_WHITELISTED',
      'USER_LIMITS_SET',
      'WITHDRAWAL_FORCE_CANCELLED',
      'WITHDRAWAL_BULK_CANCELLED',
      'WITHDRAWAL_STATUS_OVERRIDDEN',
      'SCHEDULED_RESUME'
    ]
  },
  performedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  targetUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  targetWithdrawal: { type: mongoose.Schema.Types.ObjectId, ref: 'Withdrawal', default: null },
  reason: { type: String },
  metadata: { type: mongoose.Schema.Types.Mixed }, // extra context (prev status, amounts, etc.)
  ip: { type: String },
  createdAt: { type: Date, default: Date.now }
});

WithdrawalAuditLogSchema.index({ action: 1, createdAt: -1 });
WithdrawalAuditLogSchema.index({ performedBy: 1, createdAt: -1 });
WithdrawalAuditLogSchema.index({ targetUser: 1, createdAt: -1 });

module.exports = mongoose.model('WithdrawalAuditLog', WithdrawalAuditLogSchema);
