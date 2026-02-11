// models/Executive.js
const mongoose = require('mongoose');

const executiveSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  // Application Details
  applicationDate: {
    type: Date,
    default: Date.now
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'suspended'],
    default: 'pending'
  },
  
  // Location Information
  location: {
    country: {
      type: String,
      required: [true, 'Country is required']
    },
    state: {
      type: String,
      required: [true, 'State is required']
    },
    city: {
      type: String,
      required: [true, 'City is required']
    },
    address: {
      type: String,
      required: [true, 'Full address is required']
    },
    coordinates: {
      latitude: Number,
      longitude: Number
    }
  },
  
  // Contact Information
  contactInfo: {
    phone: {
      type: String,
      required: [true, 'Phone number is required']
    },
    alternativePhone: String,
    email: {
      type: String,
      required: [true, 'Email is required']
    },
    alternativeEmail: String
  },
  
  // Share Information (at time of application)
  shareInfo: {
    totalShares: {
      type: Number,
      required: true,
      min: 1
    },
    regularShares: {
      type: Number,
      default: 0
    },
    coFounderShares: {
      type: Number,
      default: 0
    },
    shareValue: {
      type: Number,
      required: true
    },
    verifiedAt: {
      type: Date,
      default: Date.now
    }
  },
  
  // Executive Role & Responsibilities
  role: {
    title: {
      type: String,
      default: 'Regional Executive'
    },
    responsibilities: [String],
    region: String
  },
  
  // Additional Information
  bio: {
    type: String,
    maxlength: 1000
  },
  expertise: [String],
  linkedin: String,
  twitter: String,
  
  // Approval Details
  approvalInfo: {
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    approvedAt: Date,
    rejectedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    rejectedAt: Date,
    rejectionReason: String,
    adminNotes: String
  },
  
  // Suspension Details
  suspension: {
    isSuspended: {
      type: Boolean,
      default: false
    },
    suspendedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    suspendedAt: Date,
    suspensionReason: String,
    suspensionEndDate: Date
  },
  
  // Activity Tracking
  activity: {
    lastActive: Date,
    meetingsAttended: {
      type: Number,
      default: 0
    },
    contributionsCount: {
      type: Number,
      default: 0
    }
  },
  
  // Verification
  isVerified: {
    type: Boolean,
    default: false
  },
  verificationDocuments: [{
    type: {
      type: String,
      enum: ['id_card', 'proof_of_address', 'other']
    },
    url: String,
    uploadedAt: {
      type: Date,
      default: Date.now
    }
  }]
}, {
  timestamps: true
});

// Indexes for better query performance
executiveSchema.index({ userId: 1 });
executiveSchema.index({ status: 1 });
executiveSchema.index({ 'location.country': 1, 'location.state': 1 });
executiveSchema.index({ 'shareInfo.totalShares': -1 });

// Virtual for full name (from User)
executiveSchema.virtual('user', {
  ref: 'User',
  localField: 'userId',
  foreignField: '_id',
  justOne: true
});

// Methods
executiveSchema.methods.approve = async function(adminId, notes) {
  this.status = 'approved';
  this.approvalInfo.approvedBy = adminId;
  this.approvalInfo.approvedAt = new Date();
  this.approvalInfo.adminNotes = notes;
  this.isVerified = true;
  return await this.save();
};

executiveSchema.methods.reject = async function(adminId, reason) {
  this.status = 'rejected';
  this.approvalInfo.rejectedBy = adminId;
  this.approvalInfo.rejectedAt = new Date();
  this.approvalInfo.rejectionReason = reason;
  return await this.save();
};

executiveSchema.methods.suspend = async function(adminId, reason, endDate) {
  this.status = 'suspended';
  this.suspension.isSuspended = true;
  this.suspension.suspendedBy = adminId;
  this.suspension.suspendedAt = new Date();
  this.suspension.suspensionReason = reason;
  this.suspension.suspensionEndDate = endDate;
  return await this.save();
};

executiveSchema.methods.unsuspend = async function() {
  this.status = 'approved';
  this.suspension.isSuspended = false;
  this.suspension.suspensionEndDate = null;
  return await this.save();
};

// Static methods
executiveSchema.statics.getApprovedExecutives = function(filter = {}) {
  return this.find({ status: 'approved', ...filter })
    .populate('userId', 'name email userName walletAddress')
    .sort({ 'shareInfo.totalShares': -1 });
};

executiveSchema.statics.getPendingApplications = function() {
  return this.find({ status: 'pending' })
    .populate('userId', 'name email userName phone')
    .sort({ applicationDate: -1 });
};

executiveSchema.statics.getExecutivesByRegion = function(country, state) {
  const filter = { 
    status: 'approved',
    'location.country': country 
  };
  if (state) filter['location.state'] = state;
  
  return this.find(filter)
    .populate('userId', 'name email userName')
    .sort({ 'shareInfo.totalShares': -1 });
};

module.exports = mongoose.model('Executive', executiveSchema);