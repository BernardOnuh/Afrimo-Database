// models/CryptoExchangeRate.js
/**
 * CryptoExchangeRate Model
 * Caches USDT and BNB prices in NGN
 */

const mongoose = require('mongoose');

const cryptoExchangeRateSchema = new mongoose.Schema(
  {
    // Price of 1 USDT in Nigerian Naira
    usdtPriceNGN: {
      type: Number,
      required: true
    },

    // Price of 1 BNB in Nigerian Naira
    bnbPriceNGN: {
      type: Number,
      required: true
    },

    // Source of the exchange rate
    source: {
      type: String,
      enum: ['CoinGecko', 'Binance', 'Manual'],
      default: 'CoinGecko'
    },

    // Only one rate should be active at a time
    active: {
      type: Boolean,
      default: true,
      index: true
    },

    // When was this rate last updated
    lastUpdated: {
      type: Date,
      default: Date.now
    },

    createdAt: {
      type: Date,
      default: Date.now
    }
  },
  {
    timestamps: true
  }
);

// Index for finding active rate
cryptoExchangeRateSchema.index({ active: 1 });

// Pre-save hook to deactivate other rates
cryptoExchangeRateSchema.pre('save', async function(next) {
  if (this.active) {
    // Deactivate all other rates
    await mongoose.model('CryptoExchangeRate').updateMany(
      { _id: { $ne: this._id }, active: true },
      { active: false }
    );
  }
  next();
});

module.exports = mongoose.model('CryptoExchangeRate', cryptoExchangeRateSchema);