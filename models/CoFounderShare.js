// 1. Updated CoFounderShare Model (models/CoFounderShare.js)
const mongoose = require('mongoose');

const coFounderShareSchema = new mongoose.Schema({
  // Total co-founder shares
  totalShares: {
    type: Number,
    default: 500 // 500 co-founder shares total
  },
  
  // Shares sold
  sharesSold: {
    type: Number,
    default: 0
  },
  
  // NEW: Ratio of co-founder shares to regular shares
  shareToRegularRatio: {
    type: Number,
    default: 29 // 1 co-founder share = 29 regular shares
  },
  
  // Pricing for co-founder shares
  pricing: {
    priceNaira: {
      type: Number,
      default: 1000000 // 1 Million Naira per co-founder share (29x regular share price)
    },
    priceUSDT: {
      type: Number,
      default: 1000 // 1000 USDT per co-founder share (29x regular share price)
    }
  },
  
  // Co-founder application details
  applications: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    name: {
      type: String,
      required: true
    },
    email: {
      type: String,
      required: true,
      lowercase: true
    },
    shares: {
      type: Number,
      default: 1
    },
    background: {
      type: String,
      required: true
    },
    expertise: {
      type: String,
      required: true
    },
    proposedRole: {
      type: String,
      required: true
    },
    motivation: {
      type: String,
      required: true
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending'
    },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    reviewedAt: {
      type: Date
    },
    adminNotes: {
      type: String
    }
  }]
}, { timestamps: true });

// Calculate co-founder share purchase (instance method)
coFounderShareSchema.methods.calculatePurchase = function(quantity, currency) {
  // Check available shares
  const availableShares = this.totalShares - this.sharesSold;
  
  if (quantity > availableShares) {
    return {
      success: false,
      message: `Only ${availableShares} co-founder shares available`,
      availableShares
    };
  }
  
  // Calculate total price
  const price = currency === 'naira'
    ? this.pricing.priceNaira
    : this.pricing.priceUSDT;
  
  const totalPrice = quantity * price;
  const equivalentRegularShares = quantity * this.shareToRegularRatio;
  
  return {
    success: true,
    coFounderShares: quantity,
    equivalentRegularShares: equivalentRegularShares,
    shareToRegularRatio: this.shareToRegularRatio,
    totalPrice,
    currency,
    pricePerShare: price,
    availableShares: availableShares - quantity
  };
};

// Add a static method for use in the controller
coFounderShareSchema.statics.calculatePurchase = async function(quantity, currency) {
  try {
    if (!quantity || !currency || !['naira', 'usdt'].includes(currency)) {
      return {
        success: false,
        message: 'Invalid quantity or currency'
      };
    }
    
    const coFounderShare = await this.findOne();
    
    if (!coFounderShare) {
      return {
        success: false,
        message: 'Co-founder share configuration not found'
      };
    }
    
    // Use the instance method on the found document
    return coFounderShare.calculatePurchase(quantity, currency);
  } catch (error) {
    console.error('Error calculating purchase:', error);
    return {
      success: false,
      message: 'Error calculating purchase'
    };
  }
};

// Submit co-founder application
coFounderShareSchema.methods.submitApplication = function(applicationData) {
  // Ensure we don't exceed total shares
  const totalRequestedShares = this.applications.reduce((sum, app) => 
    app.status === 'approved' ? sum + app.shares : sum, 0
  ) + applicationData.shares;
  
  if (totalRequestedShares > this.totalShares) {
    throw new Error('Exceeds available co-founder shares');
  }
  
  // Add application
  this.applications.push(applicationData);
  return this;
};

// Approve or reject application
coFounderShareSchema.methods.processApplication = function(applicationId, status, adminNotes, reviewedBy) {
  const application = this.applications.id(applicationId);
  
  if (!application) {
    throw new Error('Application not found');
  }
  
  if (application.status !== 'pending') {
    throw new Error('Application already processed');
  }
  
  application.status = status;
  application.reviewedAt = new Date();
  application.reviewedBy = reviewedBy;
  application.adminNotes = adminNotes;
  
  // If approved, update shares sold
  if (status === 'approved') {
    this.sharesSold += application.shares;
  }
  
  return this;
};

const CoFounderShare = mongoose.model('CoFounderShare', coFounderShareSchema);

module.exports = CoFounderShare;