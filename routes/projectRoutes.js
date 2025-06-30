const express = require('express');
const router = express.Router();
const projectController = require('../controller/projectController');
const { protect, adminProtect } = require('../middleware/auth');

/**
 * @swagger
 * tags:
 *   name: Project
 *   description: Project statistics and analytics endpoints
 */

/**
 * @swagger
 * /project/stats:
 *   get:
 *     summary: Get overall project statistics
 *     description: Retrieve comprehensive project statistics including share sales, user counts, and financial data
 *     tags: [Project]
 *     responses:
 *       200:
 *         description: Project statistics retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 stats:
 *                   type: object
 *                   properties:
 *                     users:
 *                       type: object
 *                       properties:
 *                         total:
 *                           type: number
 *                           description: Total number of registered users
 *                           example: 1250
 *                         totalShareHolders:
 *                           type: number
 *                           description: Users who own any type of shares
 *                           example: 320
 *                         regularShareHolders:
 *                           type: number
 *                           description: Users who own regular shares
 *                           example: 280
 *                         cofounderShareHolders:
 *                           type: number
 *                           description: Users who own co-founder shares
 *                           example: 45
 *                     regularShares:
 *                       type: object
 *                       properties:
 *                         directSold:
 *                           type: number
 *                           description: Direct regular shares sold
 *                           example: 139
 *                         available:
 *                           type: number
 *                           description: Regular shares available for purchase (after co-founder allocation)
 *                           example: 1455
 *                         total:
 *                           type: number
 *                           description: Total regular shares in system
 *                           example: 10000
 *                         tierSales:
 *                           type: object
 *                           properties:
 *                             tier1Sold:
 *                               type: number
 *                               example: 139
 *                             tier2Sold:
 *                               type: number
 *                               example: 0
 *                             tier3Sold:
 *                               type: number
 *                               example: 0
 *                         tierAvailability:
 *                           type: object
 *                           properties:
 *                             tier1:
 *                               type: number
 *                               example: 1455
 *                             tier2:
 *                               type: number
 *                               example: 3000
 *                             tier3:
 *                               type: number
 *                               example: 5000
 *                     cofounderShares:
 *                       type: object
 *                       properties:
 *                         sold:
 *                           type: number
 *                           description: Co-founder shares sold
 *                           example: 14
 *                         available:
 *                           type: number
 *                           description: Co-founder shares available
 *                           example: 486
 *                         total:
 *                           type: number
 *                           description: Total co-founder shares
 *                           example: 500
 *                         equivalentRegularShares:
 *                           type: number
 *                           description: Regular share equivalent of sold co-founder shares (14 x 29)
 *                           example: 406
 *                         shareToRegularRatio:
 *                           type: number
 *                           description: Co-founder to regular share ratio
 *                           example: 29
 *                     combinedAnalysis:
 *                       type: object
 *                       properties:
 *                         totalEffectiveSharesSold:
 *                           type: number
 *                           description: Total effective shares sold (regular + co-founder equivalent)
 *                           example: 545
 *                         totalEffectiveSharesAvailable:
 *                           type: number
 *                           description: Total effective shares available
 *                           example: 9455
 *                         percentageSold:
 *                           type: string
 *                           description: Percentage of total shares sold
 *                           example: "5.45"
 *                         cofounderAllocation:
 *                           type: object
 *                           description: How co-founder equivalent shares are allocated across tiers
 *                           properties:
 *                             tier1:
 *                               type: number
 *                               example: 406
 *                             tier2:
 *                               type: number
 *                               example: 0
 *                             tier3:
 *                               type: number
 *                               example: 0
 *                     totalValues:
 *                       type: object
 *                       properties:
 *                         naira:
 *                           type: object
 *                           properties:
 *                             regularShares:
 *                               type: number
 *                               description: Total value of regular shares in Naira
 *                               example: 6950000
 *                             cofounderShares:
 *                               type: number
 *                               description: Total value of co-founder shares in Naira
 *                               example: 14000000
 *                             total:
 *                               type: number
 *                               description: Total value in Naira
 *                               example: 20950000
 *                         usdt:
 *                           type: object
 *                           properties:
 *                             regularShares:
 *                               type: number
 *                               description: Total value of regular shares in USDT
 *                               example: 6950
 *                             cofounderShares:
 *                               type: number
 *                               description: Total value of co-founder shares in USDT
 *                               example: 14000
 *                             total:
 *                               type: number
 *                               description: Total value in USDT
 *                               example: 20950
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
 *                   example: "Failed to fetch project statistics"
 *                 error:
 *                   type: string
 *                   description: Detailed error information (development mode only)
 */
router.get('/stats', projectController.getProjectStats);

/**
 * @swagger
 * /project/user-stats:
 *   get:
 *     summary: Get user-specific project statistics
 *     description: Retrieve detailed statistics for the authenticated user including their shares, investments, and referrals
 *     tags: [Project]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User statistics retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 stats:
 *                   type: object
 *                   properties:
 *                     shares:
 *                       type: object
 *                       properties:
 *                         direct:
 *                           type: number
 *                           description: Direct regular shares owned
 *                           example: 50
 *                         cofounder:
 *                           type: number
 *                           description: Co-founder shares owned
 *                           example: 2
 *                         equivalentFromCofounder:
 *                           type: number
 *                           description: Regular share equivalent from co-founder shares
 *                           example: 58
 *                         totalEffective:
 *                           type: number
 *                           description: Total effective shares owned
 *                           example: 108
 *                         cofounderEquivalence:
 *                           type: object
 *                           properties:
 *                             equivalentCoFounderShares:
 *                               type: number
 *                               description: Co-founder share equivalent of total shares
 *                               example: 3
 *                             remainingRegularShares:
 *                               type: number
 *                               description: Remaining regular shares after co-founder conversion
 *                               example: 21
 *                             shareToRegularRatio:
 *                               type: number
 *                               example: 29
 *                             explanation:
 *                               type: string
 *                               example: "Your 108 total shares = 3 co-founder equivalents + 21 regular"
 *                     transactions:
 *                       type: object
 *                       properties:
 *                         regular:
 *                           type: number
 *                           description: Number of completed regular share transactions
 *                           example: 2
 *                         cofounder:
 *                           type: number
 *                           description: Number of completed co-founder share transactions
 *                           example: 1
 *                         total:
 *                           type: number
 *                           description: Total number of completed transactions
 *                           example: 3
 *                     investment:
 *                       type: object
 *                       properties:
 *                         totalNaira:
 *                           type: number
 *                           description: Total investment in Naira
 *                           example: 4500000
 *                         totalUSDT:
 *                           type: number
 *                           description: Total investment in USDT
 *                           example: 2000
 *                     referrals:
 *                       type: object
 *                       properties:
 *                         totalReferred:
 *                           type: number
 *                           description: Total users referred
 *                           example: 8
 *                         totalEarnings:
 *                           type: number
 *                           description: Total referral earnings
 *                           example: 125000
 *                         generation1:
 *                           type: object
 *                           properties:
 *                             count:
 *                               type: number
 *                               example: 5
 *                             earnings:
 *                               type: number
 *                               example: 75000
 *                         generation2:
 *                           type: object
 *                           properties:
 *                             count:
 *                               type: number
 *                               example: 2
 *                             earnings:
 *                               type: number
 *                               example: 30000
 *                         generation3:
 *                           type: object
 *                           properties:
 *                             count:
 *                               type: number
 *                               example: 1
 *                             earnings:
 *                               type: number
 *                               example: 20000
 *       401:
 *         description: Unauthorized
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
 *                   example: "Not authorized, token failed"
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
 *                   example: "Failed to fetch user project statistics"
 *                 error:
 *                   type: string
 *                   description: Detailed error information (development mode only)
 */
router.get('/user-stats', protect, projectController.getUserProjectStats);

/**
 * @swagger
 * /project/analytics:
 *   get:
 *     summary: Get detailed project analytics (Admin only)
 *     description: Retrieve comprehensive project analytics including payment methods, user growth, and detailed statistics
 *     tags: [Project]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Project analytics retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 analytics:
 *                   type: object
 *                   properties:
 *                     shareStats:
 *                       type: object
 *                       description: Comprehensive share statistics from Share.getComprehensiveStats()
 *                       properties:
 *                         totalShares:
 *                           type: number
 *                           example: 10000
 *                         directRegularSharesSold:
 *                           type: number
 *                           example: 139
 *                         coFounderSharesSold:
 *                           type: number
 *                           example: 14
 *                         equivalentRegularSharesFromCoFounder:
 *                           type: number
 *                           example: 406
 *                         totalEffectiveSharesSold:
 *                           type: number
 *                           example: 545
 *                         totalEffectiveSharesRemaining:
 *                           type: number
 *                           example: 9455
 *                         shareToRegularRatio:
 *                           type: number
 *                           example: 29
 *                     paymentMethods:
 *                       type: object
 *                       properties:
 *                         regular:
 *                           type: array
 *                           description: Payment method breakdown for regular shares
 *                           items:
 *                             type: object
 *                             properties:
 *                               _id:
 *                                 type: string
 *                                 description: Payment method name
 *                                 example: "paystack"
 *                               count:
 *                                 type: number
 *                                 description: Number of transactions
 *                                 example: 45
 *                               totalAmount:
 *                                 type: number
 *                                 description: Total amount for this payment method
 *                                 example: 2250000
 *                               totalShares:
 *                                 type: number
 *                                 description: Total shares purchased via this method
 *                                 example: 45
 *                         cofounder:
 *                           type: array
 *                           description: Payment method breakdown for co-founder shares
 *                           items:
 *                             type: object
 *                             properties:
 *                               _id:
 *                                 type: string
 *                                 example: "manual_bank_transfer"
 *                               count:
 *                                 type: number
 *                                 example: 8
 *                               totalAmount:
 *                                 type: number
 *                                 example: 8000000
 *                               totalShares:
 *                                 type: number
 *                                 example: 8
 *                     userGrowth:
 *                       type: array
 *                       description: User registration growth over the last 12 months
 *                       items:
 *                         type: object
 *                         properties:
 *                           _id:
 *                             type: object
 *                             properties:
 *                               year:
 *                                 type: number
 *                                 example: 2024
 *                               month:
 *                                 type: number
 *                                 example: 12
 *                           count:
 *                             type: number
 *                             description: Number of users registered in this month
 *                             example: 125
 *       403:
 *         description: Forbidden - Admin access required
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
 *                   example: "Unauthorized: Admin access required"
 *       401:
 *         description: Unauthorized
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
 *                   example: "Not authorized, token failed"
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
 *                   example: "Failed to fetch project analytics"
 *                 error:
 *                   type: string
 *                   description: Detailed error information (development mode only)
 */
router.get('/analytics', protect, projectController.getProjectAnalytics);

module.exports = router;