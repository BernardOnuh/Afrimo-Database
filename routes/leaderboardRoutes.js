// routes/leaderboardRoutes.js
const express = require('express');
const router = express.Router();
const leaderboardController = require('../controller/leaderboardController');
const { protect } = require('../middleware/auth');

// Public leaderboard routes with filters
router.get('/registration', leaderboardController.getRegistrationLeaderboard);
router.get('/referrals', leaderboardController.getReferralLeaderboard);
router.get('/spending', leaderboardController.getSpendingLeaderboard);
router.get('/cofounder', leaderboardController.getCofounderLeaderboard);
router.get('/earnings', leaderboardController.getEarningsLeaderboard); // New route for top earners
router.get('/shares', leaderboardController.getSharesLeaderboard); // New route for top shareholders

// Comprehensive leaderboard with all filters
router.get('/', leaderboardController.getLeaderboard);

module.exports = router;