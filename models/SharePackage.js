const mongoose = require('mongoose');

const sharePackageSchema = new mongoose.Schema({
  label: { 
    type: String, 
    required: true, 
    trim: true 
  },
  type: { 
    type: String, 
    enum: ['share', 'co-founder'], 
    required: true 
  },
  priceNaira: { 
    type: Number, 
    default: 0 
  },
  priceUSDT: { 
    type: Number, 
    default: 0 
  },
  ownershipPct: { 
    type: Number, 
    required: true 
  },
  earningKobo: { 
    type: Number, 
    required: true 
  },
  active: { 
    type: Boolean, 
    default: true 
  }
}, { timestamps: true });

module.exports = mongoose.model('SharePackage', sharePackageSchema);
