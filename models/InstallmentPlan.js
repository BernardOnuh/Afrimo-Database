// models/InstallmentPlan.js - NEW Unified Installment Plan System
const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema({
  amount: { type: Number, required: true },
  date: { type: Date, default: Date.now },
  method: { type: String, enum: ['bank_transfer', 'usdt', 'crypto'], default: 'bank_transfer' },
  reference: { type: String },
  proofPath: { type: String },
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  adminNote: { type: String, default: '' },
  reviewedAt: { type: Date },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { _id: true });

const installmentPlanSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  tier: {
    type: String,
    enum: ['basic', 'standard', 'premium', 'elite', 'platinum', 'supreme'],
    required: true
  },
  tierType: { type: String, enum: ['regular', 'cofounder'], required: true },
  totalPrice: { type: Number, required: true },
  currency: { type: String, enum: ['naira', 'usdt'], default: 'naira' },
  downPayment: { type: Number, required: true },
  payments: [paymentSchema],
  status: {
    type: String,
    enum: ['pending_downpayment', 'active', 'completed', 'forfeited', 'cancelled'],
    default: 'pending_downpayment'
  },
  deadline: { type: Date, required: true },
  lastReminderSent: { type: Date },
  completedAt: { type: Date },
  forfeitedAt: { type: Date },
  shareRecordId: { type: mongoose.Schema.Types.ObjectId }, // ref to UserShare or CoFounderShare after completion
}, { timestamps: true });

// Virtuals
installmentPlanSchema.virtual('totalPaid').get(function () {
  return this.payments
    .filter(p => p.status === 'approved')
    .reduce((sum, p) => sum + p.amount, 0);
});

installmentPlanSchema.virtual('remainingBalance').get(function () {
  return Math.max(0, this.totalPrice - this.totalPaid);
});

installmentPlanSchema.virtual('percentPaid').get(function () {
  if (this.totalPrice === 0) return 100;
  return Math.min(100, Math.round((this.totalPaid / this.totalPrice) * 10000) / 100);
});

installmentPlanSchema.set('toJSON', { virtuals: true });
installmentPlanSchema.set('toObject', { virtuals: true });

// Indexes
installmentPlanSchema.index({ user: 1, status: 1 });
installmentPlanSchema.index({ status: 1, deadline: 1 });
installmentPlanSchema.index({ tier: 1 });

module.exports = mongoose.model('InstallmentPlan', installmentPlanSchema);
