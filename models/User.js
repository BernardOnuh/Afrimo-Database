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
  // Existing fields
  resetPasswordToken: String,
  resetPasswordExpire: Date,
  referralInfo: {
    code: String,
    source: String,
    timestamp: Date
  },
  referrals: [{
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    email: String,
    date: Date
  }],
  referralCount: {
    type: Number,
    default: 0
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

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

// Method to compare passwords
userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Generate referral code
userSchema.methods.generateReferralCode = function() {
  return this._id.toString().substr(-6).toUpperCase();
};

const User = mongoose.model('User', userSchema);

module.exports = User;