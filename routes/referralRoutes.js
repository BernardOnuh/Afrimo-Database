const express = require('express');
const router = express.Router();
const referralController = require('../controller/referralController');
const { protect, adminProtect } = require('../middleware/auth');

// Get referral code (username) and stats
router.get('/stats', protect, referralController.getReferralStats);

// Get referral tree (people you've referred)
router.get('/tree', protect, referralController.getReferralTree);

// Get referral earnings
router.get('/earnings', protect, referralController.getReferralEarnings);

// Admin route to adjust referral commission settings
router.post('/settings', protect, adminProtect, referralController.updateReferralSettings);

module.exports = router;