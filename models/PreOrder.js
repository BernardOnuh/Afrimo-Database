const mongoose = require('mongoose');

const preOrderSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  fullName: {
    type: String,
    required: [true, 'Full name is required']
  },
  email: {
    type: String,
    required: [true, 'Email is required']
  },
  phone: {
    type: String,
    required: [true, 'Phone number is required']
  },
  alternativePhone: {
    type: String
  },
  country: {
    type: String,
    required: [true, 'Country is required']
  },
  state: {
    type: String,
    required: [true, 'State is required']
  },
  city: {
    type: String,
    required: [true, 'City is required']
  },
  address: {
    type: String,
    required: [true, 'Address is required']
  },
  quantity: {
    type: Number,
    default: 1,
    min: [1, 'Quantity must be at least 1']
  },
  preferredColor: {
    type: String,
    enum: ['black', 'white', 'blue', 'other']
  },
  notes: {
    type: String
  },
  status: {
    type: String,
    enum: ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled'],
    default: 'pending'
  },
  estimatedDelivery: {
    type: Date
  },
  trackingNumber: {
    type: String
  },
  adminNotes: {
    type: String
  }
}, {
  timestamps: true
});

preOrderSchema.index({ userId: 1 });
preOrderSchema.index({ status: 1 });
preOrderSchema.index({ country: 1 });
preOrderSchema.index({ createdAt: -1 });

module.exports = mongoose.model('PreOrder', preOrderSchema);
