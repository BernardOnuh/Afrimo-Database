const mongoose = require('mongoose');

const adminAuditLogSchema = new mongoose.Schema({
  adminId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  action: { type: String, required: true },
  targetUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  details: mongoose.Schema.Types.Mixed,
  ipAddress: String,
  userAgent: String,
  timestamp: { type: Date, default: Date.now }
});

adminAuditLogSchema.index({ adminId: 1, timestamp: -1 });
adminAuditLogSchema.index({ action: 1, timestamp: -1 });

module.exports = mongoose.model('AdminAuditLog', adminAuditLogSchema);