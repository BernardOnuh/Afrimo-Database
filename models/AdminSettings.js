const mongoose = require('mongoose');

const adminSettingsSchema = new mongoose.Schema({
  showEarnings: {
    type: Boolean,
    default: true
  },
  showAvailableBalance: {
    type: Boolean,
    default: true
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }
}, {
  timestamps: true
});


adminSettingsSchema.index({}, { unique: true });

module.exports = mongoose.model('AdminSettings', adminSettingsSchema);