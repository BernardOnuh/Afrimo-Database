const mongoose = require('mongoose');

const kycVerificationSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  diditSessionId: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  workflowId: {
    type: String,
    default: null,
  },
  status: {
    type: String,
    enum: [
      'Not Started',
      'In Progress',
      'Awaiting User',
      'In Review',
      'Approved',
      'Declined',
      'Resubmitted',
      'Abandoned',
      'Expired',
      'Kyc Expired',
    ],
    default: 'Not Started',
  },
  lastEventId: {
    type: String,
    default: null,
  },
  decision: {
    type: mongoose.Schema.Types.Mixed,
    default: null,
  },
  sessionUrl: {
    type: String,
    default: null,
  },
}, {
  timestamps: true,
});

kycVerificationSchema.index({ user: 1, createdAt: -1 });

const KycVerification = mongoose.model('KycVerification', kycVerificationSchema);

module.exports = KycVerification;