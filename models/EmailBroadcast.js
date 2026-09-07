// models/EmailBroadcast.js - Tracks which users have received the email
// broadcast, so the worker resumes safely after restarts and never
// double-sends.
const mongoose = require('mongoose');

const emailBroadcastSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, index: true },
    name: { type: String, default: '' },
    status: {
      type: String,
      enum: ['pending', 'sent', 'failed'],
      default: 'pending',
    },
    sentAt: { type: Date, default: null },
    error: { type: String, default: '' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('EmailBroadcast', emailBroadcastSchema);