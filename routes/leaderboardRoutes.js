const express = require('express');
const router = express.Router();
const leaderboardController = require('../controller/leaderboardController');
const { protect } = require('../middleware/auth');

/**
 * @swagger
 * tags:
 *   - name: Public Leaderboard
 *     description: Public leaderboard endpoints for different categories and time periods
 */

/**
 * @swagger
 * /api/leaderboard:
 *   get:
 *     summary: Get comprehensive leaderboard with filters
 *     tags: [Public Leaderboard]
 *     parameters:
 *       - in: query
 *         name: filter
 *         schema:
 *           type: string
 *           enum: [registration, referrals, spending, cofounder, earnings, shares]
 *           default: registration
 *         description: Category filter for leaderboard
 *       - in: query
 *         name: timeFrame
 *         schema:
 *           type: string
 *           enum: [daily, weekly, monthly, yearly]
 *         description: Time frame filter (optional)
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 10
 *         description: Number of results to return
 *     responses:
 *       200:
 *         description: Leaderboard data retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 filter:
 *                   type: string
 *                   example: "earnings"
 *                 timeFrame:
 *                   type: string
 *                   example: "all-time"
 *                 leaderboard:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       _id:
 *                         type: string
 *                         example: "507f1f77bcf86cd799439011"
 *                       name:
 *                         type: string
 *                         example: "John Doe"
 *                       userName:
 *                         type: string
 *                         example: "johndoe"
 *                       totalShares:
 *                         type: number
 *                         example: 150
 *                       totalCofounderShares:
 *                         type: number
 *                         example: 50
 *                       combinedShares:
 *                         type: number
 *                         example: 200
 *                       referralCount:
 *                         type: number
 *                         example: 25
 *                       totalEarnings:
 *                         type: number
 *                         example: 5000
 *                       currentBalance:
 *                         type: number
 *                         example: 3500
 *                       totalSpent:
 *                         type: number
 *                         example: 15000
 *                       createdAt:
 *                         type: string
 *                         format: date-time
 *                         example: "2024-01-15T10:30:00Z"
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: "Failed to fetch leaderboard"
 */
router.get('/', leaderboardController.getLeaderboard);

// ====================
// CATEGORY-BASED LEADERBOARD ROUTES
// ====================

/**
 * @swagger
 * /api/leaderboard/registration:
 *   get:
 *     summary: Get registration-based leaderboard (newest users first)
 *     tags: [Public Leaderboard]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 10
 *         description: Number of results to return
 *     responses:
 *       200:
 *         description: Registration leaderboard retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 filter:
 *                   type: string
 *                   example: "registration"
 *                 leaderboard:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/LeaderboardUser'
 */
router.get('/registration', leaderboardController.getRegistrationLeaderboard);

/**
 * @swagger
 * /api/leaderboard/referrals:
 *   get:
 *     summary: Get referral-based leaderboard (most referrals first)
 *     tags: [Public Leaderboard]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 10
 *         description: Number of results to return
 *     responses:
 *       200:
 *         description: Referral leaderboard retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 filter:
 *                   type: string
 *                   example: "referrals"
 *                 leaderboard:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/LeaderboardUser'
 */
router.get('/referrals', leaderboardController.getReferralLeaderboard);

/**
 * @swagger
 * /api/leaderboard/spending:
 *   get:
 *     summary: Get spending-based leaderboard (highest spenders first)
 *     tags: [Public Leaderboard]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 10
 *         description: Number of results to return
 *     responses:
 *       200:
 *         description: Spending leaderboard retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 filter:
 *                   type: string
 *                   example: "spending"
 *                 leaderboard:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/LeaderboardUser'
 */
router.get('/spending', leaderboardController.getSpendingLeaderboard);

/**
 * @swagger
 * /api/leaderboard/cofounder:
 *   get:
 *     summary: Get cofounder shares leaderboard (most cofounder shares first)
 *     tags: [Public Leaderboard]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 10
 *         description: Number of results to return
 *     responses:
 *       200:
 *         description: Cofounder leaderboard retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 filter:
 *                   type: string
 *                   example: "cofounder"
 *                 leaderboard:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/LeaderboardUser'
 */
router.get('/cofounder', leaderboardController.getCofounderLeaderboard);

/**
 * @swagger
 * /api/leaderboard/earnings:
 *   get:
 *     summary: Get earnings-based leaderboard (highest earners first)
 *     tags: [Public Leaderboard]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 10
 *         description: Number of results to return
 *     responses:
 *       200:
 *         description: Earnings leaderboard retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 filter:
 *                   type: string
 *                   example: "earnings"
 *                 leaderboard:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/LeaderboardUser'
 */
router.get('/earnings', leaderboardController.getEarningsLeaderboard);

/**
 * @swagger
 * /api/leaderboard/shares:
 *   get:
 *     summary: Get shares-based leaderboard (most total shares first)
 *     tags: [Public Leaderboard]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 10
 *         description: Number of results to return
 *     responses:
 *       200:
 *         description: Shares leaderboard retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 filter:
 *                   type: string
 *                   example: "shares"
 *                 leaderboard:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/LeaderboardUser'
 */
router.get('/shares', leaderboardController.getSharesLeaderboard);

// ====================
// TIME-BASED LEADERBOARD ROUTES
// ====================

/**
 * @swagger
 * /api/leaderboard/daily:
 *   get:
 *     summary: Get daily leaderboard (today's activity)
 *     tags: [Public Leaderboard]
 *     parameters:
 *       - in: query
 *         name: filter
 *         schema:
 *           type: string
 *           enum: [registration, referrals, spending, cofounder, earnings, shares]
 *           default: earnings
 *         description: Category filter for daily leaderboard
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 10
 *         description: Number of results to return
 *     responses:
 *       200:
 *         description: Daily leaderboard retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 timeFrame:
 *                   type: string
 *                   example: "daily"
 *                 filter:
 *                   type: string
 *                   example: "earnings"
 *                 leaderboard:
 *                   type: array
 *                   items:
 *                     allOf:
 *                       - $ref: '#/components/schemas/LeaderboardUser'
 *                       - type: object
 *                         properties:
 *                           periodEarnings:
 *                             type: number
 *                             description: Earnings for the current day
 *                             example: 150
 */
router.get('/daily', leaderboardController.getDailyLeaderboard);

/**
 * @swagger
 * /api/leaderboard/weekly:
 *   get:
 *     summary: Get weekly leaderboard (this week's activity)
 *     tags: [Public Leaderboard]
 *     parameters:
 *       - in: query
 *         name: filter
 *         schema:
 *           type: string
 *           enum: [registration, referrals, spending, cofounder, earnings, shares]
 *           default: earnings
 *         description: Category filter for weekly leaderboard
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 10
 *         description: Number of results to return
 *     responses:
 *       200:
 *         description: Weekly leaderboard retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 timeFrame:
 *                   type: string
 *                   example: "weekly"
 *                 filter:
 *                   type: string
 *                   example: "earnings"
 *                 leaderboard:
 *                   type: array
 *                   items:
 *                     allOf:
 *                       - $ref: '#/components/schemas/LeaderboardUser'
 *                       - type: object
 *                         properties:
 *                           periodEarnings:
 *                             type: number
 *                             description: Earnings for the current week
 *                             example: 850
 */
router.get('/weekly', leaderboardController.getWeeklyLeaderboard);

/**
 * @swagger
 * /api/leaderboard/monthly:
 *   get:
 *     summary: Get monthly leaderboard (this month's activity)
 *     tags: [Public Leaderboard]
 *     parameters:
 *       - in: query
 *         name: filter
 *         schema:
 *           type: string
 *           enum: [registration, referrals, spending, cofounder, earnings, shares]
 *           default: earnings
 *         description: Category filter for monthly leaderboard
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 10
 *         description: Number of results to return
 *     responses:
 *       200:
 *         description: Monthly leaderboard retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 timeFrame:
 *                   type: string
 *                   example: "monthly"
 *                 filter:
 *                   type: string
 *                   example: "earnings"
 *                 leaderboard:
 *                   type: array
 *                   items:
 *                     allOf:
 *                       - $ref: '#/components/schemas/LeaderboardUser'
 *                       - type: object
 *                         properties:
 *                           periodEarnings:
 *                             type: number
 *                             description: Earnings for the current month
 *                             example: 3200
 */
router.get('/monthly', leaderboardController.getMonthlyLeaderboard);

/**
 * @swagger
 * /api/leaderboard/yearly:
 *   get:
 *     summary: Get yearly leaderboard (this year's activity)
 *     tags: [Public Leaderboard]
 *     parameters:
 *       - in: query
 *         name: filter
 *         schema:
 *           type: string
 *           enum: [registration, referrals, spending, cofounder, earnings, shares]
 *           default: earnings
 *         description: Category filter for yearly leaderboard
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 10
 *         description: Number of results to return
 *     responses:
 *       200:
 *         description: Yearly leaderboard retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 timeFrame:
 *                   type: string
 *                   example: "yearly"
 *                 filter:
 *                   type: string
 *                   example: "earnings"
 *                 leaderboard:
 *                   type: array
 *                   items:
 *                     allOf:
 *                       - $ref: '#/components/schemas/LeaderboardUser'
 *                       - type: object
 *                         properties:
 *                           periodEarnings:
 *                             type: number
 *                             description: Earnings for the current year
 *                             example: 25000
 */
router.get('/yearly', leaderboardController.getYearlyLeaderboard);

/**
 * @swagger
 * components:
 *   schemas:
 *     LeaderboardUser:
 *       type: object
 *       properties:
 *         _id:
 *           type: string
 *           description: User's unique identifier
 *           example: "507f1f77bcf86cd799439011"
 *         name:
 *           type: string
 *           description: User's full name
 *           example: "John Doe"
 *         userName:
 *           type: string
 *           description: User's username
 *           example: "johndoe"
 *         totalShares:
 *           type: number
 *           description: Total number of regular shares owned
 *           example: 150
 *         totalCofounderShares:
 *           type: number
 *           description: Total number of cofounder shares owned
 *           example: 50
 *         combinedShares:
 *           type: number
 *           description: Total of all shares (regular + cofounder)
 *           example: 200
 *         referralCount:
 *           type: number
 *           description: Number of users referred
 *           example: 25
 *         totalEarnings:
 *           type: number
 *           description: Total earnings from all sources
 *           example: 5000
 *         currentBalance:
 *           type: number
 *           description: Current available balance (earnings minus withdrawals)
 *           example: 3500
 *         withdrawalAmount:
 *           type: number
 *           description: Total amount withdrawn
 *           example: 1500
 *         pendingWithdrawalsAmount:
 *           type: number
 *           description: Total amount in pending withdrawals
 *           example: 0
 *         processingWithdrawalsAmount:
 *           type: number
 *           description: Total amount in processing withdrawals
 *           example: 0
 *         totalSpent:
 *           type: number
 *           description: Total amount spent on shares
 *           example: 15000
 *         createdAt:
 *           type: string
 *           format: date-time
 *           description: Account creation date
 *           example: "2024-01-15T10:30:00Z"
 */

module.exports = router;