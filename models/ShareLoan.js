const mongoose = require('mongoose');

const shareLoanSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  loanAmount: {
    type: Number,
    required: [true, 'Loan amount is required']
  },
  sharesTiedAsCollateral: {
    type: Number,
    required: [true, 'Number of shares for collateral is required']
  },
  collateralTier: {
    type: String,
    enum: ['basic', 'standard', 'premium', 'elite', 'platinum', 'supreme']
  },
  collateralValue: {
    type: Number
  },
  loanToValueRatio: {
    type: Number
  },
  purpose: {
    type: String,
    required: [true, 'Loan purpose is required']
  },
  repaymentPeriod: {
    type: Number,
    required: [true, 'Repayment period is required'],
    enum: [3, 6, 12]
  },
  interestRate: {
    type: Number,
    default: 5
  },
  totalRepayment: {
    type: Number
  },
  monthlyRepayment: {
    type: Number
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'active', 'repaying', 'completed', 'defaulted', 'rejected'],
    default: 'pending'
  },
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  approvedAt: {
    type: Date
  },
  rejectionReason: {
    type: String
  },
  disbursedAt: {
    type: Date
  },
  repaymentStartDate: {
    type: Date
  },
  bankDetails: {
    bankName: { type: String },
    accountNumber: { type: String },
    accountName: { type: String }
  },
  repayments: [{
    amount: { type: Number, required: true },
    date: { type: Date, default: Date.now },
    reference: { type: String },
    method: { type: String }
  }],
  totalRepaid: {
    type: Number,
    default: 0
  },
  nextPaymentDue: {
    type: Date
  },
  adminNotes: {
    type: String
  }
}, {
  timestamps: true
});

shareLoanSchema.index({ userId: 1 });
shareLoanSchema.index({ status: 1 });
shareLoanSchema.index({ createdAt: -1 });

module.exports = mongoose.model('ShareLoan', shareLoanSchema);
