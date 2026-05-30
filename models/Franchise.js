/**
 * Franchise Model - Reseller/Distributor System
 *
 * How it works (recharge-card model):
 * - User purchases a franchise package (e.g. ₦800k) → gets ₦1M credit to distribute
 * - Credit is spent when franchise approves share purchases for buyers (or themselves)
 * - Buyers pay the franchise directly, upload proof → franchise approves → shares released
 * - Franchise sells at COMPANY PRICES only — no custom pricing
 * - Franchise earns the margin (bought ₦800k, distributes ₦1M worth = ₦200k profit)
 * - NO referral commissions on franchise sales
 */

const mongoose = require('mongoose');

// ─── Franchise Packages (the "recharge cards") ───────────────────────────────
// These are the packages a user buys TO BECOME / RELOAD a franchise.
// costNaira = what they pay the company
// creditNaira = how much share value they can distribute to buyers
const FRANCHISE_PACKAGES = {
  starter:    { label: 'Starter',    costNaira: 800_000,   creditNaira: 1_000_000 },
  standard:   { label: 'Standard',   costNaira: 1_500_000, creditNaira: 2_000_000 },
  pro:        { label: 'Pro',        costNaira: 2_000_000, creditNaira: 3_000_000 },
  enterprise: { label: 'Enterprise', costNaira: 5_000_000, creditNaira: 8_000_000 },
};

const franchiseSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,   // one franchise per user
  },

  status: {
    type: String,
    enum: ['pending', 'active', 'suspended', 'revoked'],
    default: 'pending',
  },

  businessName: { type: String, required: true, trim: true },
  businessDescription: { type: String, trim: true },

  bankDetails: {
    bankName:      { type: String, trim: true },
    accountNumber: { type: String, trim: true },
    accountName:   { type: String, trim: true },
  },

  approvedAt: Date,
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

  // ─── Credit / Wallet ────────────────────────────────────────────────────────
  // creditBalance = how much (in Naira) the franchise can still distribute
  // totalCreditPurchased = lifetime total credit bought
  // totalCreditUsed = lifetime total credit spent approving sales
  creditBalance:         { type: Number, default: 0, min: 0 },
  totalCreditPurchased:  { type: Number, default: 0 },
  totalCreditUsed:       { type: Number, default: 0 },

  // ─── Stats ──────────────────────────────────────────────────────────────────
  totalSales:   { type: Number, default: 0 },   // number of approved transactions
  disputeCount: { type: Number, default: 0 },

  // ─── Credit Purchase History (buying franchise packages) ────────────────────
  creditPurchases: [{
    transactionId: String,
    packageKey:    String,   // 'starter' | 'standard' | 'pro' | 'enterprise'
    packageLabel:  String,
    costNaira:     Number,   // what they paid
    creditNaira:   Number,   // credit received
    paymentMethod: String,
    paymentProofPath:       String,
    paymentProofCloudinaryUrl: String,
    paymentProofCloudinaryId:  String,
    paymentProofOriginalName:  String,
    paymentProofFileSize:      Number,
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
    },
    adminNote:  String,
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    approvedAt: Date,
    createdAt:  { type: Date, default: Date.now },
  }],
}, {
  timestamps: true,
});

// ─── Static: get package config ──────────────────────────────────────────────
franchiseSchema.statics.getPackages = function () {
  return FRANCHISE_PACKAGES;
};

franchiseSchema.statics.getPackage = function (key) {
  return FRANCHISE_PACKAGES[key] || null;
};

module.exports = mongoose.model('Franchise', franchiseSchema);