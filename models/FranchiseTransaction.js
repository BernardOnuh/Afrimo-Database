const mongoose = require('mongoose');

const franchiseTransactionSchema = new mongoose.Schema({
  transactionId: { type: String, required: true, unique: true },
  
  // Franchise vendor
  franchise: { type: mongoose.Schema.Types.ObjectId, ref: 'Franchise', required: true },
  franchiseUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  
  // Buyer
  buyer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  
  // What was purchased
  tier: { type: String, required: true },
  quantity: { type: Number, required: true, default: 1 },
  
  // Pricing
  amount: { type: Number, required: true }, // what buyer pays franchise
  currency: { type: String, default: 'naira' },
  
  // Payment details
  paymentProof: { type: String },
  paymentProofCloudinaryId: { type: String },
  buyerBankName: { type: String },
  buyerAccountName: { type: String },
  buyerReference: { type: String },
  
  // Status flow: pending → validated (by vendor) OR disputed → resolved
  status: { 
    type: String, 
    enum: ['pending', 'validated', 'rejected', 'disputed', 'resolved_buyer', 'resolved_vendor', 'cancelled'],
    default: 'pending' 
  },
  
  // Vendor validation
  validatedAt: { type: Date },
  validatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  rejectionReason: { type: String },
  
  // Dispute
  dispute: {
    raisedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    raisedAt: { type: Date },
    reason: { type: String },
    adminNotes: { type: String },
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    resolvedAt: { type: Date },
    resolution: { type: String },
  },
  
  // Whether shares were released to buyer
  sharesReleased: { type: Boolean, default: false },
  sharesReleasedAt: { type: Date },
  
}, { timestamps: true });

franchiseTransactionSchema.index({ franchise: 1, status: 1 });
franchiseTransactionSchema.index({ buyer: 1, status: 1 });
franchiseTransactionSchema.index({ transactionId: 1 });

module.exports = mongoose.model('FranchiseTransaction', franchiseTransactionSchema);
