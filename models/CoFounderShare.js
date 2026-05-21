const mongoose = require('mongoose');

const coFounderShareSchema = new mongoose.Schema(
  {
    totalShares: {
      type: Number,
      default: 500,
      required: true
    },
    shareToRegularRatio: {
      type: Number,
      default: 29,
      required: true
    },
    // Percentage-based allocation (replacing tierBreakdown)
    shareAllocation: {
      type: Map,
      of: new mongoose.Schema(
        {
          percentage: {
            type: Number,
            min: 0,
            max: 100,
            required: true
          },
          shares: {
            type: Number,
            default: 0
          },
          sold: {
            type: Number,
            default: 0
          }
        },
        { _id: false }
      ),
      default: new Map([
        ['allocation_1', { percentage: 0.00, shares: 0, sold: 0 }]
      ])
    },
    pricing: {
      priceNaira: {
        type: Number,
        default: 0
      },
      priceUSDT: {
        type: Number,
        default: 0
      }
    },
    disabled: {
      type: Boolean,
      default: false
    },
    createdAt: {
      type: Date,
      default: Date.now
    },
    updatedAt: {
      type: Date,
      default: Date.now
    }
  },
  { timestamps: true }
);

// Middleware to validate total percentage before save
coFounderShareSchema.pre('save', function(next) {
  if (this.shareAllocation && this.shareAllocation.size > 0) {
    let totalPercentage = 0;
    this.shareAllocation.forEach(allocation => {
      totalPercentage += allocation.percentage;
    });

    // Allow small floating-point rounding errors (within 0.01%)
    if (Math.abs(totalPercentage - 100) > 0.01) {
      return next(
        new Error(
          `Total allocation percentage must equal 100%. Current: ${totalPercentage.toFixed(2)}%`
        )
      );
    }
  }
  next();
});

// Method to recalculate shares based on percentage
coFounderShareSchema.methods.recalculateSharesFromPercentage = function() {
  if (this.shareAllocation && this.shareAllocation.size > 0) {
    this.shareAllocation.forEach((allocation, key) => {
      allocation.shares = Math.floor((allocation.percentage / 100) * this.totalShares);
    });
  }
  return this;
};

// Method to get allocation summary
coFounderShareSchema.methods.getAllocationSummary = function() {
  const summary = {};
  if (this.shareAllocation && this.shareAllocation.size > 0) {
    this.shareAllocation.forEach((allocation, key) => {
      summary[key] = {
        percentage: allocation.percentage,
        shares: allocation.shares,
        sold: allocation.sold,
        available: allocation.shares - allocation.sold
      };
    });
  }
  return summary;
};

module.exports = mongoose.model('CoFounderShare', coFounderShareSchema);