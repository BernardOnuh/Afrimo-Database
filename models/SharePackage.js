const mongoose = require('mongoose');

const sharePackageSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  description: { type: String, default: '' },
  sharesIncluded: { type: Number, required: true, min: 1 },
  priceNaira: { type: Number, required: true, min: 0 },
  priceUSDT: { type: Number, required: true, min: 0 },
  benefits: [{ type: String }],
  isActive: { type: Boolean, default: true },
  displayOrder: { type: Number, default: 0 },
  maxPurchasePerUser: { type: Number, default: 0 },
  color: { type: String, default: '#6366f1' },
  icon: { type: String, default: 'package' }
}, { timestamps: true });

sharePackageSchema.index({ displayOrder: 1 });
sharePackageSchema.index({ isActive: 1 });

const SharePackage = mongoose.model('SharePackage', sharePackageSchema);
module.exports = SharePackage;
