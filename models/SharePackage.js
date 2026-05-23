const mongoose = require('mongoose');

const sharePackageSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  type: { type: String, enum: ['share', 'co-founder'], required: true },
  priceNaira: { type: Number, required: true },
  priceUSDT: { type: Number, required: true },
  ownershipPct: { type: mongoose.Schema.Types.Mixed }, // accepts string '0.00001%' OR number 0.00001
  earningKobo: { type: mongoose.Schema.Types.Mixed },   // accepts string '6k' OR number 6000
  benefits: [String],
  isActive: { type: Boolean, default: true },
  displayOrder: { type: Number, default: 0 },
  maxPurchasePerUser: { type: Number, default: 0 },
  color: { type: String, default: '#6366f1' },
  icon: { type: String, default: 'package' },
}, { timestamps: true });

// Getter methods — always return NUMBERS for calculations
sharePackageSchema.virtual('ownershipPctValue').get(function() {
  if (typeof this.ownershipPct === 'number') return this.ownershipPct;
  if (typeof this.ownershipPct === 'string') {
    return parseFloat(this.ownershipPct.replace('%', ''));
  }
  return 0;
});

sharePackageSchema.virtual('earningKoboValue').get(function() {
  if (typeof this.earningKobo === 'number') return this.earningKobo;
  if (typeof this.earningKobo === 'string') {
    if (this.earningKobo === '—') return 14000;
    return parseInt(this.earningKobo.replace('k', '')) * 1000;
  }
  return 0;
});

// Enable virtuals in JSON
sharePackageSchema.set('toJSON', { virtuals: true });

module.exports = mongoose.model('SharePackage', sharePackageSchema);