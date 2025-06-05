const express = require('express');
const router = express.Router();
const leaderboardController = require('../controller/leaderboardController');
const { protect } = require('../middleware/auth');

// Public leaderboard routes with filters
router.get('/registration', leaderboardController.getRegistrationLeaderboard);
router.get('/referrals', leaderboardController.getReferralLeaderboard);
router.get('/spending', leaderboardController.getSpendingLeaderboard);
router.get('/cofounder', leaderboardController.getCofounderLeaderboard);
router.get('/earnings', leaderboardController.getEarningsLeaderboard);
router.get('/shares', leaderboardController.getSharesLeaderboard);

// Time-based leaderboard routes
router.get('/daily', leaderboardController.getDailyLeaderboard);
router.get('/weekly', leaderboardController.getWeeklyLeaderboard);
router.get('/monthly', leaderboardController.getMonthlyLeaderboard);
router.get('/yearly', leaderboardController.getYearlyLeaderboard);

// Comprehensive leaderboard with all filters
router.get('/', leaderboardController.getLeaderboard);

module.exports = router;