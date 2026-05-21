/**
 * Stores scheduled auto-resume / auto-pause jobs
 */
const mongoose = require('mongoose');

const WithdrawalScheduleSchema = new mongoose.Schema({
  action: {
    type: String,
    required: true,
    enum: ['RESUME_ALL', 'PAUSE_ALL', 'ENABLE_BANK', 'DISABLE_BANK', 'ENABLE_CRYPTO', 'DISABLE_CRYPTO']
  },
  scheduledFor: { type: Date, required: true },
  reason: { type: String },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  executed: { type: Boolean, default: false },
  executedAt: { type: Date },
  cancelled: { type: Boolean, default: false },
  cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  createdAt: { type: Date, default: Date.now }
});

WithdrawalScheduleSchema.index({ scheduledFor: 1, executed: 1, cancelled: 1 });

module.exports = mongoose.model('WithdrawalSchedule', WithdrawalScheduleSchema);
