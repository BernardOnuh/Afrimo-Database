const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Name is required'],
    trim: true
  },
  userName: {
    type: String,
    trim: true,
    sparse: true
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    trim: true
  },
  password: {
    type: String,
    required: [true, 'Password is required'],
    minlength: 6
  },
  phone: {
    type: String,
    trim: true
  },
  country: {
    type: String,
    trim: true
  },
  countryCode: {
    type: String,
    trim: true
  },
  state: {
    type: String,
    trim: true
  },
  stateCode: {
    type: String,
    trim: true
  },
  city: {
    type: String,
    trim: true
  },
  interest: {
    type: String,
    trim: true
  },
  walletAddress: {
    type: String,
    trim: true,
    default: null,  // Default to null if not provided
    sparse: true   // Allows null values but ensures uniqueness when provided
  },
  verified: {
    type: Boolean,
    default: false
  },
  isAdmin: {
    type: Boolean,
    default: false
  },
  // Admin tracking fields
  adminGrantedAt: {
    type: Date,
    default: null
  },
  adminGrantedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  adminRevokedAt: {
    type: Date,
    default: null
  },
  adminRevokedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  // Ban-related fields
  isBanned: {
    type: Boolean,
    default: false
  },
  banReason: {
    type: String,
    trim: true,
    default: null
  },
  bannedAt: {
    type: Date,
    default: null
  },
  bannedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  unbannedAt: {
    type: Date,
    default: null
  },
  unbannedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  // Password reset fields
  resetPasswordToken: {
    type: String,
    default: null
  },
  resetPasswordExpire: {
    type: Date,
    default: null
  },
  // Referral system fields
  referralInfo: {
    code: {
      type: String,
      trim: true
    },
    source: {
      type: String,
      trim: true,
      default: 'direct'
    },
    timestamp: {
      type: Date
    }
  },
  referrals: [{
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    email: {
      type: String,
      trim: true
    },
    date: {
      type: Date,
      default: Date.now
    }
  }],
  referralCount: {
    type: Number,
    default: 0
  },
  // Timestamps
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  },
  location: {
    state: { type: String, trim: true },
    city: { type: String, trim: true },
    country: { type: String, default: 'Nigeria' }
  },
  
  earnings: {
    total: { type: Number, default: 0 },
    visible: { type: Boolean, default: true }
  },
  
  availableBalance: {
    amount: { type: Number, default: 0 },
    visible: { type: Boolean, default: true }
  },
  
  stats: {
    totalShares: { type: Number, default: 0 },
    totalReferrals: { type: Number, default: 0 },
    totalCofounders: { type: Number, default: 0 },
    lastUpdated: { type: Date, default: Date.now }
  },
  
  status: {
    isActive: { type: Boolean, default: true },
    isSuspended: { type: Boolean, default: false }
  }
}, {
  // Enable automatic timestamps
  timestamps: true
});

// Index for better query performance
userSchema.index({ email: 1 });
userSchema.index({ userName: 1 });
userSchema.index({ walletAddress: 1 });
userSchema.index({ isAdmin: 1 });
userSchema.index({ isBanned: 1 });
userSchema.index({ createdAt: -1 });

userSchema.index({ 'earnings.total': -1 });
userSchema.index({ 'availableBalance.amount': -1 });
userSchema.index({ 'stats.totalShares': -1 });
userSchema.index({ 'location.state': 1 });

// Pre-save hook to hash password
userSchema.pre('save', async function(next) {
  // Only hash the password if it's modified or new
  if (!this.isModified('password')) return next();
  
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Pre-save hook to update timestamps
userSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Method to compare passwords
userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Generate referral code
userSchema.methods.generateReferralCode = function() {
  return this._id.toString().substr(-6).toUpperCase();
};

// Method to check if user can perform admin actions
userSchema.methods.canPerformAdminActions = function() {
  return this.isAdmin && !this.isBanned;
};

// Method to get user's full address
userSchema.methods.getFullAddress = function() {
  const addressParts = [this.city, this.state, this.country].filter(Boolean);
  return addressParts.join(', ') || null;
};

// Static method to find active users (not banned)
userSchema.statics.findActiveUsers = function(conditions = {}) {
  return this.find({ 
    ...conditions, 
    isBanned: { $ne: true } 
  });
};

// Static method to find admin users
userSchema.statics.findAdminUsers = function(conditions = {}) {
  return this.find({ 
    ...conditions, 
    isAdmin: true,
    isBanned: { $ne: true }
  });
};

// Virtual for user's display name
userSchema.virtual('displayName').get(function() {
  return this.userName || this.name || this.email.split('@')[0];
});

// Virtual for referral code
userSchema.virtual('myReferralCode').get(function() {
  return this.generateReferralCode();
});

// Ensure virtual fields are serialized
userSchema.set('toJSON', { virtuals: true });
userSchema.set('toObject', { virtuals: true });

const User = mongoose.model('User', userSchema);

module.exports = User;