const mongoose = require('mongoose');

const franchisePackageSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: { type: String },
  // What the franchise charges the buyer
  priceNGN: { type: Number, required: true },
  priceUSD: { type: Number },
  // How many shares (ownership units) included
  sharesIncluded: { type: Number, required: true, default: 1 },
  // Which tier these shares come from
  tier: { type: String, required: true },
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
});

const franchiseSchema = new mongoose.Schema({
  // The user who owns this franchise
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },

  // Franchise status
  status: { type: String, enum: ['pending', 'active', 'suspended', 'revoked'], default: 'pending' },
  approvedAt: { type: Date },
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

  // Business details
  businessName: { type: String, required: true },
  businessDescription: { type: String },

  // Bank details for buyers to pay
  bankDetails: {
    bankName: { type: String },
    accountNumber: { type: String },
    accountName: { type: String },
  },

  // Inventory — shares purchased in bulk from company
  inventory: {
    totalSharesPurchased: { type: Number, default: 0 },
    totalSharesSold: { type: Number, default: 0 },
    availableShares: { type: Number, default: 0 },
    // Track by tier
    tierInventory: {
      type: Map,
      of: new mongoose.Schema({
        purchased: { type: Number, default: 0 },
        sold: { type: Number, default: 0 },
        available: { type: Number, default: 0 },
      }, { _id: false }),
      default: {},
    },
  },

  // Bulk purchase history (buying from company at discount)
  bulkPurchases: [{
    transactionId: { type: String },
    tier: { type: String },
    quantity: { type: Number },
    originalPrice: { type: Number }, // full price
    discountedPrice: { type: Number }, // what they paid (30% off)
    discountPercent: { type: Number, default: 30 },
    paymentMethod: { type: String },
    paymentProof: { type: String },
    paymentProofCloudinaryId: { type: String },
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    approvedAt: { type: Date },
    createdAt: { type: Date, default: Date.now },
  }],

  // Custom packages the franchise created for resale
  packages: [franchisePackageSchema],

  // Franchise forfeits referral bonuses
  referralBonusForfeited: { type: Boolean, default: true },

  // Stats
  totalRevenue: { type: Number, default: 0 },
  totalSales: { type: Number, default: 0 },
  disputeCount: { type: Number, default: 0 },

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
}, { timestamps: true });

// Minimum bulk purchase amount
franchiseSchema.statics.MIN_BULK_AMOUNT = 500000; // ₦500k
franchiseSchema.statics.DISCOUNT_PERCENT = 30;

module.exports = mongoose.model('Franchise', franchiseSchema);
