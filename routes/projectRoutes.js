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

// ─── /project/stats ───────────────────────────────────────────────────────────

/**
 * @swagger
 * /project/stats:
 *   get:
 *     summary: Get overall project statistics
 *     description: >
 *       Retrieve project-wide statistics.
 *       All share data is expressed as **ownership percentage** (up to 7 decimal places),
 *       not raw share counts.
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
 *                           type: integer
 *                           description: Total registered users
 *                           example: 1250
 *                         totalShareholders:
 *                           type: integer
 *                           description: Users holding any completed ownership
 *                           example: 320
 *                         regularShareholders:
 *                           type: integer
 *                           description: Users with completed regular-share purchases
 *                           example: 280
 *                         cofounderShareholders:
 *                           type: integer
 *                           description: Users with completed co-founder purchases
 *                           example: 45
 *                     ownership:
 *                       type: object
 *                       properties:
 *                         totalSold:
 *                           type: number
 *                           format: float
 *                           description: Total ownership % sold (regular + co-founder)
 *                           example: 12.3456789
 *                         totalAvailable:
 *                           type: number
 *                           format: float
 *                           description: Remaining ownership % (100 - totalSold)
 *                           example: 87.6543211
 *                         regularSharesSold:
 *                           type: number
 *                           format: float
 *                           description: Ownership % from regular-share purchases
 *                           example: 8.1234567
 *                         cofounderSharesSold:
 *                           type: number
 *                           format: float
 *                           description: Ownership % from co-founder purchases
 *                           example: 4.2222222
 *                         totalSoldFormatted:
 *                           type: string
 *                           example: "12.3456789%"
 *                         totalAvailableFormatted:
 *                           type: string
 *                           example: "87.6543211%"
 *                     earnings:
 *                       type: object
 *                       properties:
 *                         totalEarningKobo:
 *                           type: integer
 *                           description: Total projected earnings in kobo across all shareholders
 *                           example: 500000000
 *                         regularEarningKobo:
 *                           type: integer
 *                           example: 300000000
 *                         cofounderEarningKobo:
 *                           type: integer
 *                           example: 200000000
 *                         totalEarningNaira:
 *                           type: string
 *                           description: Human-readable Naira equivalent (kobo ÷ 100)
 *                           example: "5000000.00"
 *                     transactions:
 *                       type: object
 *                       properties:
 *                         regularCount:
 *                           type: integer
 *                           example: 350
 *                         cofounderCount:
 *                           type: integer
 *                           example: 60
 *                         totalCount:
 *                           type: integer
 *                           example: 410
 *                     totalValues:
 *                       type: object
 *                       properties:
 *                         naira:
 *                           type: object
 *                           properties:
 *                             regular:
 *                               type: number
 *                               example: 17500000
 *                             cofounder:
 *                               type: number
 *                               example: 6000000
 *                             total:
 *                               type: number
 *                               example: 23500000
 *                         usdt:
 *                           type: object
 *                           properties:
 *                             regular:
 *                               type: number
 *                               example: 17500
 *                             cofounder:
 *                               type: number
 *                               example: 6000
 *                             total:
 *                               type: number
 *                               example: 23500
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/stats', projectController.getProjectStats);

// ─── /project/user-stats ─────────────────────────────────────────────────────

/**
 * @swagger
 * /project/user-stats:
 *   get:
 *     summary: Get the authenticated user's project statistics
 *     description: >
 *       Returns the user's ownership breakdown in **percentage** form,
 *       projected earnings in kobo, transaction counts, investment totals,
 *       and referral stats.
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
 *                     ownership:
 *                       type: object
 *                       properties:
 *                         totalOwnershipPct:
 *                           type: number
 *                           format: float
 *                           description: Total confirmed ownership % (regular + co-founder)
 *                           example: 0.0035000
 *                         regularOwnershipPct:
 *                           type: number
 *                           format: float
 *                           description: Ownership % from regular-share purchases
 *                           example: 0.0020000
 *                         cofounderOwnershipPct:
 *                           type: number
 *                           format: float
 *                           description: Ownership % from co-founder purchases
 *                           example: 0.0015000
 *                         pendingOwnershipPct:
 *                           type: number
 *                           format: float
 *                           description: Ownership % from transactions still awaiting admin approval
 *                           example: 0.0005000
 *                         formattedOwnership:
 *                           type: string
 *                           example: "0.0035000%"
 *                         formattedPending:
 *                           type: string
 *                           example: "0.0005000%"
 *                     earnings:
 *                       type: object
 *                       properties:
 *                         totalEarningKobo:
 *                           type: integer
 *                           description: Total projected earnings in kobo
 *                           example: 350000
 *                         regularEarningKobo:
 *                           type: integer
 *                           example: 200000
 *                         cofounderEarningKobo:
 *                           type: integer
 *                           example: 150000
 *                         totalEarningNaira:
 *                           type: string
 *                           description: Naira equivalent (kobo ÷ 100)
 *                           example: "3500.00"
 *                     transactions:
 *                       type: object
 *                       properties:
 *                         regular:
 *                           type: integer
 *                           example: 3
 *                         cofounder:
 *                           type: integer
 *                           example: 1
 *                         total:
 *                           type: integer
 *                           example: 4
 *                         completed:
 *                           type: integer
 *                           example: 3
 *                         pending:
 *                           type: integer
 *                           example: 1
 *                         failed:
 *                           type: integer
 *                           example: 0
 *                     investment:
 *                       type: object
 *                       properties:
 *                         totalNaira:
 *                           type: number
 *                           example: 450000
 *                         totalUSDT:
 *                           type: number
 *                           example: 200
 *                     referrals:
 *                       type: object
 *                       properties:
 *                         totalReferred:
 *                           type: integer
 *                           example: 8
 *                         totalEarnings:
 *                           type: number
 *                           example: 125000
 *                         generation1:
 *                           type: object
 *                           properties:
 *                             count:
 *                               type: integer
 *                               example: 5
 *                             earnings:
 *                               type: number
 *                               example: 75000
 *                         generation2:
 *                           type: object
 *                           properties:
 *                             count:
 *                               type: integer
 *                               example: 2
 *                             earnings:
 *                               type: number
 *                               example: 30000
 *                         generation3:
 *                           type: object
 *                           properties:
 *                             count:
 *                               type: integer
 *                               example: 1
 *                             earnings:
 *                               type: number
 *                               example: 20000
 *                     summary:
 *                       type: object
 *                       description: Human-readable summary strings
 *                       properties:
 *                         ownership:
 *                           type: string
 *                           example: "0.0035000% total (0.0020000% regular + 0.0015000% co-founder)"
 *                         pendingOwnership:
 *                           type: string
 *                           nullable: true
 *                           example: "0.0005000% pending verification"
 *                         investmentSummary:
 *                           type: string
 *                           example: "₦450,000 + $200"
 *                         statusBreakdown:
 *                           type: string
 *                           example: "3 completed, 1 pending, 0 failed"
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/user-stats', protect, projectController.getUserProjectStats);

// ─── /project/analytics ──────────────────────────────────────────────────────

/**
 * @swagger
 * /project/analytics:
 *   get:
 *     summary: Get detailed project analytics (Admin only)
 *     description: >
 *       Payment-method breakdown of ownership %, top shareholders,
 *       and monthly user-growth data for the last 12 months.
 *     tags: [Project]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Analytics retrieved successfully
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
 *                     paymentMethods:
 *                       type: object
 *                       properties:
 *                         regular:
 *                           type: array
 *                           description: Ownership % grouped by payment method for regular shares
 *                           items:
 *                             type: object
 *                             properties:
 *                               _id:
 *                                 type: string
 *                                 example: "paystack"
 *                               count:
 *                                 type: integer
 *                                 example: 45
 *                               totalOwnershipPct:
 *                                 type: number
 *                                 format: float
 *                                 example: 4.5000000
 *                               totalEarningKobo:
 *                                 type: integer
 *                                 example: 45000000
 *                               totalAmount:
 *                                 type: number
 *                                 example: 2250000
 *                         cofounder:
 *                           type: array
 *                           description: Ownership % grouped by payment method for co-founder shares
 *                           items:
 *                             type: object
 *                             properties:
 *                               _id:
 *                                 type: string
 *                                 example: "manual_bank_transfer"
 *                               count:
 *                                 type: integer
 *                                 example: 8
 *                               totalOwnershipPct:
 *                                 type: number
 *                                 format: float
 *                                 example: 2.4000000
 *                               totalEarningKobo:
 *                                 type: integer
 *                                 example: 24000000
 *                               totalAmount:
 *                                 type: number
 *                                 example: 8000000
 *                     topHolders:
 *                       type: array
 *                       description: Top 10 shareholders by ownership percentage
 *                       items:
 *                         type: object
 *                         properties:
 *                           user:
 *                             type: object
 *                             properties:
 *                               _id:
 *                                 type: string
 *                               name:
 *                                 type: string
 *                                 example: "John Doe"
 *                               email:
 *                                 type: string
 *                                 example: "john@example.com"
 *                               username:
 *                                 type: string
 *                                 example: "johndoe"
 *                           ownershipPct:
 *                             type: number
 *                             format: float
 *                             example: 1.5000000
 *                           formatted:
 *                             type: string
 *                             example: "1.5000000%"
 *                           earningNaira:
 *                             type: string
 *                             example: "150000.00"
 *                     userGrowth:
 *                       type: array
 *                       description: Monthly user registrations over the last 12 months
 *                       items:
 *                         type: object
 *                         properties:
 *                           _id:
 *                             type: object
 *                             properties:
 *                               year:
 *                                 type: integer
 *                                 example: 2025
 *                               month:
 *                                 type: integer
 *                                 example: 4
 *                           count:
 *                             type: integer
 *                             example: 125
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/analytics', protect, adminProtect, projectController.getProjectAnalytics);

module.exports = router;