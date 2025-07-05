// routes/adminReferralRoutes.js
const express = require('express');
const router = express.Router();
const { adminProtect } = require('../middleware/auth');

// Import controller functions - note the path should match your file structure
const {
  getReferralDashboard,
  getAllUsersWithReferralData,
  getUserReferralDetails,
  getAllReferralTransactions,
  adjustUserEarnings,
  adjustReferralTransaction,
  cancelReferralTransaction,
  performBulkActions,
  getReferralAnalytics,
  exportReferralData,
  getReferralSettings,
  updateReferralSettings,
  getAuditLog,
  syncUserReferralData
} = require('../controller/adminReferralController');

/**
 * @swagger
 * components:
 *   schemas:
 *     AdminReferralUser:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           description: User ID
 *         name:
 *           type: string
 *           description: User's full name
 *         userName:
 *           type: string
 *           description: User's username
 *         email:
 *           type: string
 *           description: User's email address
 *         phone:
 *           type: string
 *           description: User's phone number
 *         referralCode:
 *           type: string
 *           description: User's referral code
 *         totalEarnings:
 *           type: number
 *           description: Total referral earnings
 *         totalReferred:
 *           type: integer
 *           description: Total number of referred users
 *         joinDate:
 *           type: string
 *           format: date-time
 *           description: Date user joined
 *         lastActivity:
 *           type: string
 *           format: date-time
 *           description: Last activity date
 *         status:
 *           type: string
 *           enum: [active, inactive, suspended]
 *           description: User status
 *         generations:
 *           type: object
 *           properties:
 *             gen1:
 *               type: object
 *               properties:
 *                 count:
 *                   type: integer
 *                 earnings:
 *                   type: number
 *             gen2:
 *               type: object
 *               properties:
 *                 count:
 *                   type: integer
 *                 earnings:
 *                   type: number
 *             gen3:
 *               type: object
 *               properties:
 *                 count:
 *                   type: integer
 *                 earnings:
 *                   type: number
 *
 *     ReferralTransaction:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           description: Transaction ID
 *         beneficiary:
 *           type: object
 *           properties:
 *             id:
 *               type: string
 *             name:
 *               type: string
 *             userName:
 *               type: string
 *             email:
 *               type: string
 *         referredUser:
 *           type: object
 *           properties:
 *             id:
 *               type: string
 *             name:
 *               type: string
 *             userName:
 *               type: string
 *             email:
 *               type: string
 *         amount:
 *           type: number
 *           description: Transaction amount
 *         currency:
 *           type: string
 *           description: Currency code
 *         generation:
 *           type: integer
 *           description: Referral generation level
 *         purchaseType:
 *           type: string
 *           enum: [share, cofounder, other, adjustment]
 *           description: Type of purchase that triggered the referral
 *         sourceTransaction:
 *           type: string
 *           description: Source transaction ID
 *         status:
 *           type: string
 *           enum: [completed, pending, failed, cancelled, adjusted]
 *           description: Transaction status
 *         createdAt:
 *           type: string
 *           format: date-time
 *           description: Transaction creation date
 *         adjustedBy:
 *           type: string
 *           description: Admin who made adjustments
 *         adjustmentReason:
 *           type: string
 *           description: Reason for adjustment
 *         originalAmount:
 *           type: number
 *           description: Original amount before adjustment
 *
 *     ReferralDashboard:
 *       type: object
 *       properties:
 *         overview:
 *           type: object
 *           properties:
 *             totalUsers:
 *               type: integer
 *             activeReferrers:
 *               type: integer
 *             totalCommissionsPaid:
 *               type: number
 *             totalTransactions:
 *               type: integer
 *             avgCommissionPerUser:
 *               type: number
 *             avgCommissionPerTransaction:
 *               type: number
 *             conversionRate:
 *               type: number
 *         topPerformers:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/AdminReferralUser'
 *         recentActivity:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/ReferralTransaction'
 *         generationBreakdown:
 *           type: object
 *           properties:
 *             generation1:
 *               type: object
 *               properties:
 *                 totalAmount:
 *                   type: number
 *                 totalTransactions:
 *                   type: integer
 *                 avgAmount:
 *                   type: number
 *             generation2:
 *               type: object
 *               properties:
 *                 totalAmount:
 *                   type: number
 *                 totalTransactions:
 *                   type: integer
 *                 avgAmount:
 *                   type: number
 *             generation3:
 *               type: object
 *               properties:
 *                 totalAmount:
 *                   type: number
 *                 totalTransactions:
 *                   type: integer
 *                 avgAmount:
 *                   type: number
 *
 *   responses:
 *     UnauthorizedError:
 *       description: Admin authentication required
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               success:
 *                 type: boolean
 *                 example: false
 *               message:
 *                 type: string
 *                 example: "Unauthorized: Admin access required"
 *     ForbiddenError:
 *       description: Access forbidden
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               success:
 *                 type: boolean
 *                 example: false
 *               message:
 *                 type: string
 *                 example: "Access forbidden"
 *     NotFoundError:
 *       description: Resource not found
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               success:
 *                 type: boolean
 *                 example: false
 *               message:
 *                 type: string
 *                 example: "Resource not found"
 *     BadRequestError:
 *       description: Bad request
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               success:
 *                 type: boolean
 *                 example: false
 *               message:
 *                 type: string
 *                 example: "Invalid request parameters"
 *     ServerError:
 *       description: Internal server error
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               success:
 *                 type: boolean
 *                 example: false
 *               message:
 *                 type: string
 *                 example: "Internal server error"
 *               error:
 *                 type: string
 *                 description: Error details (only in development)
 */

// Rate limiting middleware for admin actions
const createRateLimiter = (maxRequests, windowMs) => {
  const requests = new Map();

  return (req, res, next) => {
    const userId = req.user.id;
    const now = Date.now();

    const requestsForUser = (requests.get(userId) || [])
      .filter(timestamp => now - timestamp < windowMs);

    if (requestsForUser.length >= maxRequests) {
      return res.status(429).json({
        success: false,
        message: 'Too many requests. Please try again later.'
      });
    }

    requestsForUser.push(now);
    requests.set(userId, requestsForUser);
    next();
  };
};

const adminRateLimiter = createRateLimiter(100, 60 * 60 * 1000); // 100 requests per hour

/**
 * @swagger
 * /admin/referrals/dashboard:
 *   get:
 *     tags: [Admin Referrals]
 *     summary: Get referral system dashboard overview
 *     description: Get comprehensive overview of the referral system including statistics, top performers, and recent activity
 *     security:
 *       - adminAuth: []
 *     responses:
 *       200:
 *         description: Referral dashboard data retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 dashboard:
 *                   $ref: '#/components/schemas/ReferralDashboard'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       429:
 *         description: Too many requests
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
// Dashboard and overview routes
router.get('/dashboard', 
  adminProtect, 
  adminRateLimiter,
  getReferralDashboard
);

/**
 * @swagger
 * /admin/referrals/analytics:
 *   get:
 *     tags: [Admin Referrals]
 *     summary: Get advanced referral analytics
 *     description: Get detailed analytics and insights about the referral system performance
 *     security:
 *       - adminAuth: []
 *     parameters:
 *       - in: query
 *         name: period
 *         schema:
 *           type: string
 *           enum: [week, month, quarter, year, all]
 *           default: month
 *         description: Time period for analytics
 *         example: "month"
 *       - in: query
 *         name: includeCharts
 *         schema:
 *           type: boolean
 *           default: true
 *         description: Whether to include chart data for visualization
 *         example: true
 *     responses:
 *       200:
 *         description: Analytics data retrieved successfully
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
 *                     overview:
 *                       type: object
 *                       properties:
 *                         totalTransactions:
 *                           type: integer
 *                         totalCommissions:
 *                           type: number
 *                         avgCommission:
 *                           type: number
 *                         uniqueEarners:
 *                           type: integer
 *                         period:
 *                           type: string
 *                     trends:
 *                       type: object
 *                       properties:
 *                         totalDays:
 *                           type: integer
 *                         avgDailyTransactions:
 *                           type: number
 *                         avgDailyCommissions:
 *                           type: number
 *                     topPerformers:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           user:
 *                             type: object
 *                             properties:
 *                               id:
 *                                 type: string
 *                               name:
 *                                 type: string
 *                               userName:
 *                                 type: string
 *                               email:
 *                                 type: string
 *                           earnings:
 *                             type: number
 *                           transactions:
 *                             type: integer
 *                           avgPerTransaction:
 *                             type: number
 *                     generationAnalysis:
 *                       type: object
 *                       properties:
 *                         generation1:
 *                           type: object
 *                           properties:
 *                             totalAmount:
 *                               type: number
 *                             totalTransactions:
 *                               type: integer
 *                             avgAmount:
 *                               type: number
 *                             percentage:
 *                               type: number
 *                         generation2:
 *                           type: object
 *                           properties:
 *                             totalAmount:
 *                               type: number
 *                             totalTransactions:
 *                               type: integer
 *                             avgAmount:
 *                               type: number
 *                             percentage:
 *                               type: number
 *                         generation3:
 *                           type: object
 *                           properties:
 *                             totalAmount:
 *                               type: number
 *                             totalTransactions:
 *                               type: integer
 *                             avgAmount:
 *                               type: number
 *                             percentage:
 *                               type: number
 *                     conversionRates:
 *                       type: object
 *                       properties:
 *                         signupToReferral:
 *                           type: number
 *                           description: Percentage of users who signed up with referral
 *                         referralToEarning:
 *                           type: number
 *                           description: Percentage of referred users who earned commissions
 *                         overallConversion:
 *                           type: number
 *                           description: Overall conversion rate
 *                     chartData:
 *                       type: object
 *                       nullable: true
 *                       properties:
 *                         dailyTrends:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               date:
 *                                 type: string
 *                                 format: date
 *                               transactions:
 *                                 type: integer
 *                               commissions:
 *                                 type: number
 *                         generationDistribution:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               generation:
 *                                 type: integer
 *                               amount:
 *                                 type: number
 *                               transactions:
 *                                 type: integer
 *                               percentage:
 *                                 type: number
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/analytics', 
  adminProtect, 
  getReferralAnalytics
);

/**
 * @swagger
 * /admin/referrals/users:
 *   get:
 *     tags: [Admin Referrals]
 *     summary: Get all users with referral data
 *     description: Get paginated list of all users with their referral statistics and earnings
 *     security:
 *       - adminAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *           default: 1
 *         description: Page number for pagination
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 20
 *         description: Number of users per page
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search by name, email, or username
 *       - in: query
 *         name: sortBy
 *         schema:
 *           type: string
 *           enum: [totalEarnings, totalReferred, joinDate, lastActivity, name]
 *           default: totalEarnings
 *         description: Field to sort by
 *       - in: query
 *         name: sortOrder
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *           default: desc
 *         description: Sort order
 *       - in: query
 *         name: minEarnings
 *         schema:
 *           type: number
 *           minimum: 0
 *         description: Filter users with minimum earnings
 *       - in: query
 *         name: hasReferrals
 *         schema:
 *           type: boolean
 *         description: Filter users who have made referrals
 *     responses:
 *       200:
 *         description: Users with referral data retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 users:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/AdminReferralUser'
 *                 pagination:
 *                   type: object
 *                   properties:
 *                     currentPage:
 *                       type: integer
 *                     totalPages:
 *                       type: integer
 *                     totalCount:
 *                       type: integer
 *                     hasNext:
 *                       type: boolean
 *                     hasPrev:
 *                       type: boolean
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
// User management routes
router.get('/users', 
  adminProtect, 
  adminRateLimiter,
  getAllUsersWithReferralData
);

/**
 * @swagger
 * /admin/referrals/user/{userId}:
 *   get:
 *     tags: [Admin Referrals]
 *     summary: Get detailed referral data for a specific user
 *     description: Get comprehensive referral information for a specific user including all transactions, referred users, and earnings breakdown
 *     security:
 *       - adminAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *         description: User ID to get referral data for
 *         example: "64f8a9b2c1234567890abcde"
 *     responses:
 *       200:
 *         description: User referral data retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 userReferralData:
 *                   type: object
 *                   properties:
 *                     user:
 *                       $ref: '#/components/schemas/AdminReferralUser'
 *                     referralTree:
 *                       type: object
 *                       properties:
 *                         generation1:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               id:
 *                                 type: string
 *                               name:
 *                                 type: string
 *                               userName:
 *                                 type: string
 *                               email:
 *                                 type: string
 *                               joinedDate:
 *                                 type: string
 *                                 format: date-time
 *                         generation2:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               id:
 *                                 type: string
 *                               name:
 *                                 type: string
 *                               userName:
 *                                 type: string
 *                               email:
 *                                 type: string
 *                               referredBy:
 *                                 type: string
 *                               joinedDate:
 *                                 type: string
 *                                 format: date-time
 *                         generation3:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               id:
 *                                 type: string
 *                               name:
 *                                 type: string
 *                               userName:
 *                                 type: string
 *                               email:
 *                                 type: string
 *                               referredBy:
 *                                 type: string
 *                               joinedDate:
 *                                 type: string
 *                                 format: date-time
 *                     transactions:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/ReferralTransaction'
 *                     summary:
 *                       type: object
 *                       properties:
 *                         totalEarningsAllTime:
 *                           type: number
 *                         totalEarningsThisMonth:
 *                           type: number
 *                         totalEarningsThisYear:
 *                           type: number
 *                         avgEarningsPerReferral:
 *                           type: number
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/user/:userId', 
  adminProtect, 
  getUserReferralDetails
);

/**
 * @swagger
 * /admin/referrals/user/{userId}/sync:
 *   post:
 *     tags: [Admin Referrals]
 *     summary: Sync user's referral data
 *     description: Force synchronization of a user's referral statistics and earnings
 *     security:
 *       - adminAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *         description: User ID to sync referral data for
 *         example: "64f8a9b2c1234567890abcde"
 *     responses:
 *       200:
 *         description: User referral data synced successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "User referral data synced successfully"
 *                 syncResults:
 *                   type: object
 *                   properties:
 *                     oldEarnings:
 *                       type: number
 *                       description: Earnings before sync
 *                     newEarnings:
 *                       type: number
 *                       description: Earnings after sync
 *                     transactionsProcessed:
 *                       type: integer
 *                       description: Number of transactions processed
 *                     discrepanciesFound:
 *                       type: integer
 *                       description: Number of discrepancies found and fixed
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/user/:userId/sync', 
  adminProtect, 
  syncUserReferralData
);

/**
 * @swagger
 * /admin/referrals/transactions:
 *   get:
 *     tags: [Admin Referrals]
 *     summary: Get all referral transactions
 *     description: Get paginated list of all referral transactions with comprehensive filtering options
 *     security:
 *       - adminAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *           default: 1
 *         description: Page number for pagination
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 20
 *         description: Number of transactions per page
 *       - in: query
 *         name: userId
 *         schema:
 *           type: string
 *         description: Filter by beneficiary user ID
 *       - in: query
 *         name: generation
 *         schema:
 *           type: integer
 *           enum: [1, 2, 3]
 *         description: Filter by generation level
 *       - in: query
 *         name: purchaseType
 *         schema:
 *           type: string
 *           enum: [share, cofounder, other, adjustment]
 *         description: Filter by purchase type
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [completed, pending, failed, cancelled, adjusted]
 *         description: Filter by transaction status
 *       - in: query
 *         name: fromDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter transactions from this date (YYYY-MM-DD)
 *       - in: query
 *         name: toDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter transactions to this date (YYYY-MM-DD)
 *       - in: query
 *         name: minAmount
 *         schema:
 *           type: number
 *           minimum: 0
 *         description: Filter transactions with minimum amount
 *       - in: query
 *         name: maxAmount
 *         schema:
 *           type: number
 *           minimum: 0
 *         description: Filter transactions with maximum amount
 *     responses:
 *       200:
 *         description: Referral transactions retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 transactions:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/ReferralTransaction'
 *                 summary:
 *                   type: object
 *                   properties:
 *                     totalTransactions:
 *                       type: integer
 *                     totalAmount:
 *                       type: number
 *                     avgAmount:
 *                       type: number
 *                 pagination:
 *                   type: object
 *                   properties:
 *                     currentPage:
 *                       type: integer
 *                     totalPages:
 *                       type: integer
 *                     totalCount:
 *                       type: integer
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
// Transaction management routes
router.get('/transactions', 
  adminProtect, 
  getAllReferralTransactions
);

/**
 * @swagger
 * /admin/referrals/transaction/{transactionId}/adjust:
 *   put:
 *     tags: [Admin Referrals]
 *     summary: Adjust specific referral transaction
 *     description: Modify the amount or status of a specific referral transaction
 *     security:
 *       - adminAuth: []
 *     parameters:
 *       - in: path
 *         name: transactionId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID of the transaction to adjust
 *         example: "64f8a9b2c1234567890abcde"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               newAmount:
 *                 type: number
 *                 minimum: 0
 *                 description: New amount for the transaction
 *                 example: 75.50
 *               newStatus:
 *                 type: string
 *                 enum: [completed, pending, failed, cancelled, adjusted]
 *                 description: New status for the transaction
 *                 example: "adjusted"
 *               adjustmentReason:
 *                 type: string
 *                 minLength: 10
 *                 maxLength: 500
 *                 description: Reason for the adjustment
 *                 example: "Correcting calculation error"
 *               notifyUser:
 *                 type: boolean
 *                 default: true
 *                 description: Whether to notify the beneficiary about the change
 *                 example: true
 *     responses:
 *       200:
 *         description: Transaction adjusted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Transaction adjusted successfully"
 *                 transaction:
 *                   $ref: '#/components/schemas/ReferralTransaction'
 *       400:
 *         $ref: '#/components/responses/BadRequestError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.put('/transaction/:transactionId/adjust', 
  adminProtect, 
  adjustReferralTransaction
);

/**
 * @swagger
 * /admin/referrals/transaction/{transactionId}/cancel:
 *   delete:
 *     tags: [Admin Referrals]
 *     summary: Cancel/Delete a referral transaction
 *     description: Cancel or delete a referral transaction and update user earnings accordingly
 *     security:
 *       - adminAuth: []
 *     parameters:
 *       - in: path
 *         name: transactionId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID of the transaction to cancel
 *         example: "64f8a9b2c1234567890abcde"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - reason
 *             properties:
 *               reason:
 *                 type: string
 *                 minLength: 10
 *                 maxLength: 500
 *                 description: Reason for cancelling the transaction
 *                 example: "Transaction was processed in error"
 *               notifyUser:
 *                 type: boolean
 *                 default: true
 *                 description: Whether to notify the beneficiary about the cancellation
 *                 example: true
 *     responses:
 *       200:
 *         description: Transaction cancelled successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Transaction cancelled successfully"
 *                 cancelledTransaction:
 *                   type: object
 *                   properties:
 *                     transactionId:
 *                       type: string
 *                       description: ID of cancelled transaction
 *                     originalAmount:
 *                       type: number
 *                       description: Original transaction amount
 *                     beneficiaryId:
 *                       type: string
 *                       description: ID of the beneficiary user
 *                     newTotalEarnings:
 *                       type: number
 *                       description: User's updated total earnings
 *       400:
 *         $ref: '#/components/responses/BadRequestError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.delete('/transaction/:transactionId/cancel', 
  adminProtect, 
  cancelReferralTransaction
);

/**
 * @swagger
 * /admin/referrals/earnings/adjust:
 *   post:
 *     tags: [Admin Referrals]
 *     summary: Adjust user's referral earnings
 *     description: Manually adjust a user's referral earnings by adding, subtracting, or setting a specific amount
 *     security:
 *       - adminAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - userId
 *               - adjustmentType
 *               - amount
 *               - reason
 *             properties:
 *               userId:
 *                 type: string
 *                 description: ID of the user whose earnings to adjust
 *                 example: "64f8a9b2c1234567890abcde"
 *               adjustmentType:
 *                 type: string
 *                 enum: [add, subtract, set]
 *                 description: Type of adjustment to make
 *                 example: "add"
 *               amount:
 *                 type: number
 *                 minimum: 0
 *                 description: Amount to adjust (in USD)
 *                 example: 50.00
 *               reason:
 *                 type: string
 *                 minLength: 10
 *                 maxLength: 500
 *                 description: Reason for the adjustment
 *                 example: "Bonus payment for exceptional performance"
 *               generation:
 *                 type: integer
 *                 enum: [1, 2, 3]
 *                 description: Which generation to adjust (optional, affects all if not specified)
 *                 example: 1
 *               referredUserId:
 *                 type: string
 *                 description: ID of the referred user (for specific transaction adjustments)
 *                 example: "64f8a9b2c1234567890abcdf"
 *               notifyUser:
 *                 type: boolean
 *                 default: true
 *                 description: Whether to notify the user about the adjustment via email
 *                 example: true
 *     responses:
 *       200:
 *         description: Earnings adjusted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Earnings adjusted successfully"
 *                 adjustment:
 *                   type: object
 *                   properties:
 *                     adjustmentId:
 *                       type: string
 *                       description: ID of the adjustment transaction
 *                     oldEarnings:
 *                       type: number
 *                       description: Previous earnings amount
 *                     newEarnings:
 *                       type: number
 *                       description: New earnings amount
 *                     adjustmentAmount:
 *                       type: number
 *                       description: Amount of adjustment
 *                     adjustmentType:
 *                       type: string
 *                       description: Type of adjustment made
 *                     reason:
 *                       type: string
 *                       description: Reason for adjustment
 *       400:
 *         $ref: '#/components/responses/BadRequestError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
// Earnings adjustment routes
router.post('/earnings/adjust', 
  adminProtect, 
  adminRateLimiter,
  adjustUserEarnings
);

/**
 * @swagger
 * /admin/referrals/bulk-actions:
 *   post:
 *     tags: [Admin Referrals]
 *     summary: Perform bulk actions on multiple users
 *     description: Perform bulk operations like adjustments, synchronization, or recalculation on multiple users
 *     security:
 *       - adminAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - action
 *               - userIds
 *             properties:
 *               action:
 *                 type: string
 *                 enum: [sync_stats, adjust_earnings, recalculate_all]
 *                 description: Bulk action to perform
 *                 example: "sync_stats"
 *               userIds:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Array of user IDs to perform action on
 *                 example: ["64f8a9b2c1234567890abcde", "64f8a9b2c1234567890abcdf"]
 *               adjustmentData:
 *                 type: object
 *                 description: Required for adjust_earnings action
 *                 properties:
 *                   type:
 *                     type: string
 *                     enum: [add, subtract, multiply]
 *                     description: Type of adjustment
 *                     example: "add"
 *                   amount:
 *                     type: number
 *                     minimum: 0
 *                     description: Amount for adjustment
 *                     example: 25.00
 *                   reason:
 *                     type: string
 *                     minLength: 10
 *                     description: Reason for bulk adjustment
 *                     example: "Year-end bonus for all active referrers"
 *     responses:
 *       200:
 *         description: Bulk action completed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Bulk action 'sync_stats' completed"
 *                 results:
 *                   type: object
 *                   properties:
 *                     processed:
 *                       type: integer
 *                       description: Total number of users processed
 *                     successful:
 *                       type: integer
 *                       description: Number of successful operations
 *                     failed:
 *                       type: integer
 *                       description: Number of failed operations
 *                     errors:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           userId:
 *                             type: string
 *                           error:
 *                             type: string
 *       400:
 *         $ref: '#/components/responses/BadRequestError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/bulk-actions', 
  adminProtect, 
  performBulkActions
);

/**
 * @swagger
 * /admin/referrals/settings:
 *   get:
 *     tags: [Admin Referrals]
 *     summary: Get current referral system settings
 *     description: Get current commission rates and other referral system settings
 *     security:
 *       - adminAuth: []
 *     responses:
 *       200:
 *         description: Referral settings retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 settings:
 *                   type: object
 *                   properties:
 *                     commissionRates:
 *                       type: object
 *                       properties:
 *                         generation1:
 *                           type: number
 *                           description: Commission rate for first generation (%)
 *                           example: 15
 *                         generation2:
 *                           type: number
 *                           description: Commission rate for second generation (%)
 *                           example: 3
 *                         generation3:
 *                           type: number
 *                           description: Commission rate for third generation (%)
 *                           example: 2
 *                     isActive:
 *                       type: boolean
 *                       description: Whether referral system is active
 *                       example: true
 *                     maxGenerations:
 *                       type: integer
 *                       description: Maximum number of referral generations
 *                       example: 3
 *                     minimumPayout:
 *                       type: number
 *                       description: Minimum payout threshold
 *                       example: 10
 *                     lastUpdated:
 *                       type: string
 *                       format: date-time
 *                       description: Last time settings were updated
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
// System settings routes
router.get('/settings', 
  adminProtect, 
  getReferralSettings
);

/**
 * @swagger
 * /admin/referrals/settings:
 *   put:
 *     tags: [Admin Referrals]
 *     summary: Update referral system settings
 *     description: Update commission rates and other referral system settings
 *     security:
 *       - adminAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               commissionRates:
 *                 type: object
 *                 properties:
 *                   generation1:
 *                     type: number
 *                     minimum: 0
 *                     maximum: 100
 *                     description: Commission rate for first generation (%)
 *                     example: 15
 *                   generation2:
 *                     type: number
 *                     minimum: 0
 *                     maximum: 100
 *                     description: Commission rate for second generation (%)
 *                     example: 3
 *                   generation3:
 *                     type: number
 *                     minimum: 0
 *                     maximum: 100
 *                     description: Commission rate for third generation (%)
 *                     example: 2
 *               isActive:
 *                 type: boolean
 *                 description: Whether to activate/deactivate referral system
 *                 example: true
 *               maxGenerations:
 *                 type: integer
 *                 minimum: 1
 *                 maximum: 10
 *                 description: Maximum number of referral generations
 *                 example: 3
 *               minimumPayout:
 *                 type: number
 *                 minimum: 0
 *                 description: Minimum payout threshold
 *                 example: 10
 *     responses:
 *       200:
 *         description: Settings updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Referral settings updated successfully"
 *                 settings:
 *                   type: object
 *                   properties:
 *                     commissionRates:
 *                       type: object
 *                     isActive:
 *                       type: boolean
 *                     minimumPayout:
 *                       type: number
 *                     lastUpdated:
 *                       type: string
 *                       format: date-time
 *       400:
 *         $ref: '#/components/responses/BadRequestError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.put('/settings', 
  adminProtect, 
  updateReferralSettings
);

/**
 * @swagger
 * /admin/referrals/export:
 *   get:
 *     tags: [Admin Referrals]
 *     summary: Export referral data
 *     description: Export referral data in various formats (CSV, Excel, JSON)
 *     security:
 *       - adminAuth: []
 *     parameters:
 *       - in: query
 *         name: format
 *         schema:
 *           type: string
 *           enum: [csv, excel, json]
 *           default: csv
 *         description: Export format
 *         example: "csv"
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [users, transactions, summary]
 *           default: users
 *         description: Type of data to export
 *         example: "users"
 *       - in: query
 *         name: fromDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Start date for data export (YYYY-MM-DD)
 *         example: "2024-01-01"
 *       - in: query
 *         name: toDate
 *         schema:
 *           type: string
 *           format: date
 *         description: End date for data export (YYYY-MM-DD)
 *         example: "2024-12-31"
 *       - in: query
 *         name: includeDetails
 *         schema:
 *           type: boolean
 *           default: true
 *         description: Whether to include detailed transaction data
 *         example: true
 *     responses:
 *       200:
 *         description: Data exported successfully
 *         content:
 *           text/csv:
 *             schema:
 *               type: string
 *               format: binary
 *           application/json:
 *             schema:
 *               type: string
 *               format: binary
 *           application/vnd.openxmlformats-officedocument.spreadsheetml.sheet:
 *             schema:
 *               type: string
 *               format: binary
 *       400:
 *         $ref: '#/components/responses/BadRequestError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
// Data export routes
router.get('/export', 
  adminProtect, 
  exportReferralData
);

/**
 * @swagger
 * /admin/referrals/audit-log:
 *   get:
 *     tags: [Admin Referrals]
 *     summary: Get referral system audit log
 *     description: Get detailed audit log of all admin actions on the referral system
 *     security:
 *       - adminAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *           default: 1
 *         description: Page number for pagination
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 20
 *         description: Number of audit entries per page
 *       - in: query
 *         name: adminId
 *         schema:
 *           type: string
 *         description: Filter by specific admin user
 *       - in: query
 *         name: action
 *         schema:
 *           type: string
 *           enum: [earnings_adjustment, transaction_adjustment, settings_update, bulk_action, user_view, dashboard_view]
 *         description: Filter by action type
 *       - in: query
 *         name: fromDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter audit entries from this date
 *       - in: query
 *         name: toDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter audit entries to this date
 *     responses:
 *       200:
 *         description: Audit log retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 auditLog:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                         description: Audit entry ID
 *                       adminId:
 *                         type: string
 *                         description: ID of admin who performed action
 *                       adminName:
 *                         type: string
 *                         description: Name of admin who performed action
 *                       action:
 *                         type: string
 *                         description: Type of action performed
 *                       targetUserId:
 *                         type: string
 *                         description: ID of target user (if applicable)
 *                       targetUserName:
 *                         type: string
 *                         description: Name of target user (if applicable)
 *                       details:
 *                         type: object
 *                         description: Details of the action performed
 *                       timestamp:
 *                         type: string
 *                         format: date-time
 *                         description: When the action was performed
 *                       ipAddress:
 *                         type: string
 *                         description: IP address of admin
 *                 pagination:
 *                   type: object
 *                   properties:
 *                     currentPage:
 *                       type: integer
 *                     totalPages:
 *                       type: integer
 *                     totalCount:
 *                       type: integer
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
// Audit and monitoring routes
router.get('/audit-log', 
  adminProtect, 
  getAuditLog
);

// Create placeholder functions for routes that were defined but don't exist in controller
const getPerformanceReport = async (req, res) => {
  try {
    // This is a placeholder - you can implement this function later
    res.status(200).json({
      success: true,
      message: 'Performance report endpoint - coming soon',
      report: {
        placeholder: true,
        note: 'This endpoint needs to be implemented'
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error generating performance report',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

const getCommissionBreakdown = async (req, res) => {
  try {
    // This is a placeholder - you can implement this function later
    res.status(200).json({
      success: true,
      message: 'Commission breakdown endpoint - coming soon',
      breakdown: {
        placeholder: true,
        note: 'This endpoint needs to be implemented'
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error generating commission breakdown',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @swagger
 * /admin/referrals/performance-report:
 *   get:
 *     tags: [Admin Referrals]
 *     summary: Get performance report
 *     description: Get detailed performance report of referral system (Placeholder endpoint - Coming Soon)
 *     security:
 *       - adminAuth: []
 *     parameters:
 *       - in: query
 *         name: period
 *         schema:
 *           type: string
 *           enum: [week, month, quarter, year]
 *           default: month
 *         description: Time period for the report
 *       - in: query
 *         name: includeCharts
 *         schema:
 *           type: boolean
 *           default: false
 *         description: Whether to include chart data
 *     responses:
 *       200:
 *         description: Performance report generated successfully (Placeholder)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Performance report endpoint - coming soon"
 *                 report:
 *                   type: object
 *                   properties:
 *                     placeholder:
 *                       type: boolean
 *                       example: true
 *                     note:
 *                       type: string
 *                       example: "This endpoint needs to be implemented"
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
// Additional routes with placeholder functions
router.get('/performance-report', 
  adminProtect, 
  getPerformanceReport
);

/**
 * @swagger
 * /admin/referrals/commission-breakdown:
 *   get:
 *     tags: [Admin Referrals]
 *     summary: Get commission breakdown
 *     description: Get detailed breakdown of commissions by various criteria (Placeholder endpoint - Coming Soon)
 *     security:
 *       - adminAuth: []
 *     parameters:
 *       - in: query
 *         name: groupBy
 *         schema:
 *           type: string
 *           enum: [generation, purchaseType, month, user]
 *           default: generation
 *         description: How to group the commission data
 *       - in: query
 *         name: fromDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Start date for analysis
 *       - in: query
 *         name: toDate
 *         schema:
 *           type: string
 *           format: date
 *         description: End date for analysis
 *     responses:
 *       200:
 *         description: Commission breakdown retrieved successfully (Placeholder)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Commission breakdown endpoint - coming soon"
 *                 breakdown:
 *                   type: object
 *                   properties:
 *                     placeholder:
 *                       type: boolean
 *                       example: true
 *                     note:
 *                       type: string
 *                       example: "This endpoint needs to be implemented"
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/commission-breakdown', 
  adminProtect, 
  getCommissionBreakdown
);

// Error handling middleware
router.use((err, req, res, next) => {
  console.error('Admin referral route error:', err);
  res.status(500).json({
    success: false,
    message: 'An unexpected error occurred in admin referral system',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

module.exports = router;

// Additional routes with placeholder functions
router.get('/performance-report', 
  adminProtect, 
  getPerformanceReport
);

router.get('/commission-breakdown', 
  adminProtect, 
  getCommissionBreakdown
);

// Error handling middleware
router.use((err, req, res, next) => {
  console.error('Admin referral route error:', err);
  res.status(500).json({
    success: false,
    message: 'An unexpected error occurred in admin referral system',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

module.exports = router;