const mongoose = require('mongoose');

const sharePackageSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  type: { type: String, enum: ['regular', 'cofounder'], default: 'regular' },
  description: { type: String, default: '' },
  priceNaira: { type: Number, required: true },
  priceUSDT: { type: Number, required: true },
  ownershipPct: { type: String, default: '0%' },
  earningKobo: { type: String, default: '0' },
  benefits: [String],
  isActive: { type: Boolean, default: true },
  displayOrder: { type: Number, default: 0 },
  maxPurchasePerUser: { type: Number, default: 0 },
  color: { type: String, default: '#6366f1' },
  icon: { type: String, default: 'package' },
}, { timestamps: true });

module.exports = mongoose.model('SharePackage', sharePackageSchema);
