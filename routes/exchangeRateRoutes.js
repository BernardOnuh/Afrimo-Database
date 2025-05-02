// routes/exchangeRateRoutes.js
const express = require('express');
const router = express.Router();
const axios = require('axios');
const { protect } = require('../middleware/auth');

// Controller for exchange rates (could be moved to a separate controller file)
const getExchangeRate = async (req, res) => {
    try {
        // You could integrate with a real exchange rate API like Exchange Rate API, Open Exchange Rates, or Fixer.io
        // For example: const response = await axios.get(`https://api.exchangerate-api.com/v4/latest/USD`);
        
        // For now, using a fixed rate as a fallback
        const fixedRate = 0.00067; // 1 NGN ≈ 0.00067 USD
        
        // You can also fetch from an external API and cache the result
        try {
            // Attempt to get real-time exchange rate from an API
            const response = await axios.get('https://api.exchangerate-api.com/v4/latest/NGN');
            const rate = response.data.rates.USD;
            
            return res.status(200).json({
                success: true,
                rate: rate,
                timestamp: new Date()
            });
        } catch (apiError) {
            console.error('Failed to fetch exchange rate from API:', apiError);
            
            // Return fallback rate if API fails
            return res.status(200).json({
                success: true,
                rate: fixedRate,
                fallback: true,
                timestamp: new Date()
            });
        }
    } catch (error) {
        console.error('Error in exchange rate endpoint:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get exchange rate',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Exchange rate routes
router.get('/usd-ngn', getExchangeRate);

module.exports = router;