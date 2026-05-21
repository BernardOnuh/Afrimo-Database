const mongoose = require('mongoose');

// Schema for tracking referral generations and earnings
const ReferralSchema = new mongoose.Schema({
  // User who is generating referrals
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  
  // Total number of users referred
  referredUsers: {
    type: Number,
    default: 0
  },
  
  // Total earnings from referrals
  totalEarnings: {
    type: Number,
    default: 0
  },
  
  // NEW FIELDS: Track withdrawal amounts by status
  totalWithdrawn: {
    type: Number,
    default: 0
  },
  pendingWithdrawals: {
    type: Number,
    default: 0
  },
  processingWithdrawals: {
    type: Number,
    default: 0
  },
  
  // Breakdown of referrals by generation
  generation1: {
    count: {
      type: Number,
      default: 0
    },
    earnings: {
      type: Number,
      default: 0
    }
  },
  
  generation2: {
    count: {
      type: Number,
      default: 0
    },
    earnings: {
      type: Number,
      default: 0
    }
  },
  
  generation3: {
    count: {
      type: Number,
      default: 0
    },
    earnings: {
      type: Number,
      default: 0
    }
  },
  
  // List of direct referrals
  referrals: [{
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    name: String,
    userName: String,
    email: String,
    date: {
      type: Date,
      default: Date.now
    },
    status: {
      type: String,
      enum: ['active', 'inactive'],
      default: 'active'
    }
  }]
}, {
  timestamps: true
});

// Virtual for available balance calculation
ReferralSchema.virtual('availableBalance').get(function() {
  return this.totalEarnings - 
         (this.totalWithdrawn || 0) - 
         (this.pendingWithdrawals || 0) - 
         (this.processingWithdrawals || 0);
});

// Static method to create or update referral record
ReferralSchema.statics.updateReferralStats = async function(userId, referredUserId, generation, earnings = 0) {
  try {
    // Find or create referral record
    let referral = await this.findOne({ user: userId });
    
    if (!referral) {
      referral = new this({
        user: userId,
        referredUsers: 0,
        totalEarnings: 0,
        totalWithdrawn: 0,
        pendingWithdrawals: 0,
        processingWithdrawals: 0,
        generation1: { count: 0, earnings: 0 },
        generation2: { count: 0, earnings: 0 },
        generation3: { count: 0, earnings: 0 }
      });
    }
    
    // Update referral record based on generation
    switch(generation) {
      case 1:
        referral.generation1.count++;
        referral.generation1.earnings += earnings;
        break;
      case 2:
        referral.generation2.count++;
        referral.generation2.earnings += earnings;
        break;
      case 3:
        referral.generation3.count++;
        referral.generation3.earnings += earnings;
        break;
    }
    
    // Increment total referrals and earnings
    referral.referredUsers++;
    referral.totalEarnings += earnings;
    
    // If referredUserId is provided, add to referrals list
    if (referredUserId) {
      // Get referred user details
      const User = mongoose.model('User');
      const referredUser = await User.findById(referredUserId);
      
      if (referredUser) {
        referral.referrals.push({
          userId: referredUserId,
          name: referredUser.name,
          userName: referredUser.userName,
          email: referredUser.email,
          date: new Date()
        });
      }
    }
    
    // Save the updated record
    await referral.save();
    
    return referral;
  } catch (error) {
    console.error('Error updating referral stats:', error);
    throw error;
  }
};

// NEW: Static method to update withdrawal amounts
ReferralSchema.statics.updateWithdrawalAmounts = async function(userId, options = {}) {
  try {
    const updateQuery = { user: userId };
    const updateObj = { $set: {} };
    
    // Check which fields should be updated
    if (options.totalWithdrawn !== undefined) {
      updateObj.$set.totalWithdrawn = options.totalWithdrawn;
    }
    
    if (options.pendingWithdrawals !== undefined) {
      updateObj.$set.pendingWithdrawals = options.pendingWithdrawals;
    }
    
    if (options.processingWithdrawals !== undefined) {
      updateObj.$set.processingWithdrawals = options.processingWithdrawals;
    }
    
    // If using increment operations
    if (options.inc) {
      updateObj.$inc = {};
      
      if (options.inc.totalWithdrawn) {
        updateObj.$inc.totalWithdrawn = options.inc.totalWithdrawn;
      }
      
      if (options.inc.pendingWithdrawals) {
        updateObj.$inc.pendingWithdrawals = options.inc.pendingWithdrawals;
      }
      
      if (options.inc.processingWithdrawals) {
        updateObj.$inc.processingWithdrawals = options.inc.processingWithdrawals;
      }
    }
    
    // Perform the update
    const updated = await this.findOneAndUpdate(
      updateQuery,
      updateObj,
      { new: true }
    );
    
    return updated;
  } catch (error) {
    console.error('Error updating withdrawal amounts:', error);
    throw error;
  }
};

// Static method to get current config (for consistency with other models)
ReferralSchema.statics.getCurrentConfig = async function() {
  let config = await this.findOne();
  
  if (!config) {
    config = new this({
      referredUsers: 0,
      totalEarnings: 0,
      totalWithdrawn: 0,
      pendingWithdrawals: 0,
      processingWithdrawals: 0,
      generation1: { count: 0, earnings: 0 },
      generation2: { count: 0, earnings: 0 },
      generation3: { count: 0, earnings: 0 }
    });
    await config.save();
  }
  
  return config;
};

const Referral = mongoose.model('Referral', ReferralSchema);
module.exports = Referral;