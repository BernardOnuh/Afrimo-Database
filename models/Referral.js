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
    email: String,
    date: {
      type: Date,
      default: Date.now
    }
  }]
}, {
  timestamps: true
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
    
    // Add to referrals list
    referral.referrals.push({
      userId: referredUserId,
      date: new Date()
    });
    
    // Save the updated record
    await referral.save();
    
    return referral;
  } catch (error) {
    console.error('Error updating referral stats:', error);
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