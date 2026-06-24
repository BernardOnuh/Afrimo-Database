const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const balanceAdjustmentSchema = new Schema({
  user: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  adminId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  field: {
    type: String,
    enum: ['totalWithdrawn', 'pendingWithdrawals', 'processingWithdrawals', 'totalEarnings'],
    required: true
  },
  oldValue: {
    type: Number,
    required: true
  },
  newValue: {
    type: Number,
    required: true
  },
  changeAmount: {
    type: Number,
    required: true
  },
  reason: {
    type: String,
    required: true
  },
  notes: String,
  timestamp: {
    type: Date,
    default: Date.now,
    index: true
  },
  userEmail: String,
  userName: String,
  adminEmail: String,
  ipAddress: String,
  userAgent: String
});

// Index for quick lookups
balanceAdjustmentSchema.index({ user: 1, timestamp: -1 });
balanceAdjustmentSchema.index({ adminId: 1, timestamp: -1 });
balanceAdjustmentSchema.index({ timestamp: -1 });

// Virtual for formatted change
balanceAdjustmentSchema.virtual('formattedChange').get(function() {
  return this.changeAmount >= 0 ? `+${this.changeAmount}` : `${this.changeAmount}`;
});

module.exports = mongoose.model('BalanceAdjustment', balanceAdjustmentSchema);