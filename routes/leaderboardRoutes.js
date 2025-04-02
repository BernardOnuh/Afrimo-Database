const express = require('express');
const router = express.Router();
const leaderboardController = require('../controller/leaderboardController');
const { protect } = require('../middleware/auth');

// Public leaderboard routes with filters
router.get('/registration', leaderboardController.getRegistrationLeaderboard);
router.get('/referrals', leaderboardController.getReferralLeaderboard);
router.get('/spending', leaderboardController.getSpendingLeaderboard);
router.get('/cofounder', leaderboardController.getCofounderLeaderboard);

// Comprehensive leaderboard with all filters
router.get('/', leaderboardController.getLeaderboard);

module.exports = router;