// models/UserWithdrawalRestriction.js
const mongoose = require('mongoose');

const userWithdrawalRestrictionSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  withdrawalDisabled: {
    type: Boolean,
    default: false,
    required: true
  },
  reason: {
    type: String,
    required: function() {
      return this.withdrawalDisabled;
    },
    trim: true,
    maxlength: 500
  },
  disabledBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: function() {
      return this.withdrawalDisabled;
    }
  },
  disabledAt: {
    type: Date,
    required: function() {
      return this.withdrawalDisabled;
    }
  },
  enabledAt: {
    type: Date,
    default: null
  },
  notes: {
    type: String,
    trim: true,
    maxlength: 1000
  }
}, {
  timestamps: true,
  collection: 'userwithdrawalrestrictions'
});

// Indexes for better query performance
userWithdrawalRestrictionSchema.index({ user: 1 });
userWithdrawalRestrictionSchema.index({ withdrawalDisabled: 1 });
userWithdrawalRestrictionSchema.index({ disabledAt: -1 });

module.exports = mongoose.model('UserWithdrawalRestriction', userWithdrawalRestrictionSchema);