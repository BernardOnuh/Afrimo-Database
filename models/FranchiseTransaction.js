/**
 * FranchiseTransaction Model
 *
 * Represents a buyer purchasing shares THROUGH a franchise.
 * Flow:
 *  1. Buyer visits franchise link → selects a company share package/tier
 *  2. Buyer pays franchise directly (bank transfer etc.) and uploads proof
 *  3. Franchise approves → company deducts from franchise credit balance → shares released to buyer
 *
 * Notes:
 *  - Price is ALWAYS company price (no markup allowed)
 *  - No referral commissions are processed on these transactions
 *  - Franchise can also be the buyer (self-use of their own credit)
 */

const mongoose = require('mongoose');

const franchiseTransactionSchema = new mongoose.Schema({
  transactionId: { type: String, required: true, unique: true },

  franchise:      { type: mongoose.Schema.Types.ObjectId, ref: 'Franchise', required: true },
  franchiseUser:  { type: mongoose.Schema.Types.ObjectId, ref: 'User',      required: true },

  // buyer can be the franchise owner themselves (self-purchase)
  buyer:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  isSelfPurchase: { type: Boolean, default: false },

  // ─── What was bought ────────────────────────────────────────────────────────
  // tierKey & packageLabel mirror the company's TierConfig
  tierKey:      { type: String, required: true },  // e.g. 'basic', 'standard'
  packageLabel: { type: String },

  // ownershipPct & earningKobo per-share from TierConfig at time of purchase
  ownershipPct: { type: Number, default: 0 },
  earningKobo:  { type: Number, default: 0 },

  // companyPrice = the company's listed price for this tier (Naira)
  // This is what gets deducted from the franchise credit balance
  companyPrice: { type: Number, required: true },
  currency:     { type: String, default: 'naira' },

  // ─── Buyer payment proof (buyer → franchise) ────────────────────────────────
  paymentProofPath:            String,
  paymentProofCloudinaryUrl:   String,
  paymentProofCloudinaryId:    String,
  paymentProofOriginalName:    String,
  paymentProofFileSize:        Number,

  paymentMethod: { type: String, default: 'bank_transfer' },
  buyerNote:     String,  // optional note from buyer

  // ─── Status lifecycle ───────────────────────────────────────────────────────
  // pending → approved (franchise approves, shares released)
  //         → rejected (franchise rejects)
  //         → disputed (buyer raises dispute)
  //         → resolved_buyer | resolved_vendor (admin resolves dispute)
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'disputed', 'resolved_buyer', 'resolved_vendor'],
    default: 'pending',
  },

  // set when franchise approves
  approvedAt: Date,
  sharesReleased:   { type: Boolean, default: false },
  sharesReleasedAt: Date,

  // set when franchise rejects
  rejectionReason: String,

  // ─── Dispute ────────────────────────────────────────────────────────────────
  dispute: {
    raisedBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    raisedAt:   Date,
    reason:     String,
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    resolvedAt: Date,
    resolution: String,
    adminNotes: String,
  },

  // ─── Admin ──────────────────────────────────────────────────────────────────
  adminNote: String,
}, {
  timestamps: true,
});

module.exports = mongoose.model('FranchiseTransaction', franchiseTransactionSchema);