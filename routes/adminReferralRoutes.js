const express = require('express');
const router = express.Router();
const { adminProtect } = require('../middleware/auth');

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
  bulkEditTransactions,
  syncUserReferralData,
  getPerformanceReport,
  getCommissionBreakdown
} = require('../controller/adminReferralController');

// ─── Rate Limiter Middleware ────────────────────────────────────────────
const createRateLimiter = (maxRequests, windowMs) => {
  const requests = new Map();
  return (req, res, next) => {
    const userId = req.user?.id || req.ip || 'anonymous';
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
 * components:
 *   schemas:
 *     ReferralUser:
 *       type: object
 *       properties:
 *         _id:
 *           type: string
 *           example: "60f7c6b4c8f1a2b3c4d5e6f7"
 *         name:
 *           type: string
 *           example: "John Doe"
 *         email:
 *           type: string
 *           format: email
 *           example: "john@example.com"
 *         userName:
 *           type: string
 *           example: "johndoe"
 *         phoneNumber:
 *           type: string
 *           example: "+2348012345678"
 *         totalEarnings:
 *           type: number
 *           format: double
 *           example: 25000.00
 *         totalReferred:
 *           type: integer
 *           example: 15
 *         joinDate:
 *           type: string
 *           format: date-time
 *           example: "2023-01-15T10:30:00.000Z"
 *         isActive:
 *           type: boolean
 *           example: true
 *         isBanned:
 *           type: boolean
 *           example: false
 *
 *     ReferralTransaction:
 *       type: object
 *       properties:
 *         _id:
 *           type: string
 *           example: "60f7c6b4c8f1a2b3c4d5e6f8"
 *         userId:
 *           type: string
 *           example: "60f7c6b4c8f1a2b3c4d5e6f7"
 *         amount:
 *           type: number
 *           format: double
 *           example: 1500.00
 *         originalAmount:
 *           type: number
 *           format: double
 *           example: 1500.00
 *         status:
 *           type: string
 *           enum: [completed, pending, failed, cancelled, adjusted]
 *           example: "completed"
 *         generation:
 *           type: integer
 *           enum: [1, 2, 3]
 *           example: 1
 *         purchaseType:
 *           type: string
 *           example: "subscription"
 *         createdAt:
 *           type: string
 *           format: date-time
 *           example: "2023-01-15T10:30:00.000Z"
 *         updatedAt:
 *           type: string
 *           format: date-time
 *           example: "2023-01-15T10:30:00.000Z"
 *         beneficiary:
 *           type: object
 *           properties:
 *             _id:
 *               type: string
 *             name:
 *               type: string
 *             email:
 *               type: string
 *
 *     ReferralSettings:
 *       type: object
 *       properties:
 *         isActive:
 *           type: boolean
 *           example: true
 *         minimumPayout:
 *           type: number
 *           example: 10
 *         commissionRates:
 *           type: object
 *           properties:
 *             generation1:
 *               type: number
 *               example: 15
 *             generation2:
 *               type: number
 *               example: 3
 *             generation3:
 *               type: number
 *               example: 2
 *         lastUpdated:
 *           type: string
 *           format: date-time
 *           example: "2023-01-15T10:30:00.000Z"
 *
 *     ReferralDashboard:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: true
 *         dashboard:
 *           type: object
 *           properties:
 *             overview:
 *               type: object
 *               properties:
 *                 totalUsers:
 *                   type: integer
 *                   example: 150
 *                 activeReferrers:
 *                   type: integer
 *                   example: 85
 *                 totalCommissionsPaid:
 *                   type: number
 *                   format: double
 *                   example: 125000.00
 *                 conversionRate:
 *                   type: number
 *                   format: double
 *                   example: 56.7
 *             generationBreakdown:
 *               type: object
 *               properties:
 *                 generation1:
 *                   type: object
 *                   properties:
 *                     totalAmount:
 *                       type: number
 *                       example: 75000.00
 *                     totalTransactions:
 *                       type: integer
 *                       example: 120
 *                 generation2:
 *                   type: object
 *                   properties:
 *                     totalAmount:
 *                       type: number
 *                       example: 35000.00
 *                     totalTransactions:
 *                       type: integer
 *                       example: 85
 *                 generation3:
 *                   type: object
 *                   properties:
 *                     totalAmount:
 *                       type: number
 *                       example: 15000.00
 *                     totalTransactions:
 *                       type: integer
 *                       example: 42
 *             topPerformers:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   _id:
 *                     type: string
 *                   name:
 *                     type: string
 *                   email:
 *                     type: string
 *                   totalReferred:
 *                     type: integer
 *                   totalEarnings:
 *                     type: number
 *
 *     AuditLog:
 *       type: object
 *       properties:
 *         _id:
 *           type: string
 *           example: "60f7c6b4c8f1a2b3c4d5e6f9"
 *         action:
 *           type: string
 *           example: "TRANSACTION_ADJUSTED"
 *         adminId:
 *           type: string
 *           example: "60f7c6b4c8f1a2b3c4d5e6f0"
 *         targetUserId:
 *           type: string
 *           example: "60f7c6b4c8f1a2b3c4d5e6f7"
 *         details:
 *           type: object
 *           example: { "oldAmount": 1500, "newAmount": 2000, "reason": "System correction" }
 *         createdAt:
 *           type: string
 *           format: date-time
 *           example: "2023-01-15T10:30:00.000Z"
 *
 *     Pagination:
 *       type: object
 *       properties:
 *         currentPage:
 *           type: integer
 *           example: 1
 *         totalPages:
 *           type: integer
 *           example: 5
 *         totalCount:
 *           type: integer
 *           example: 100
 *         limit:
 *           type: integer
 *           example: 20
 *
 *     Success:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: true
 *         message:
 *           type: string
 *           example: "Operation successful"
 *
 *     Error:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: false
 *         message:
 *           type: string
 *           example: "Error description"
 *
 *   responses:
 *     UnauthorizedError:
 *       description: Authentication required
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/Error'
 *           example:
 *             success: false
 *             message: "Access denied. No token provided"
 *
 *     ForbiddenError:
 *       description: Admin privileges required
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/Error'
 *           example:
 *             success: false
 *             message: "Access denied. Admin privileges required"
 *
 *     NotFoundError:
 *       description: Resource not found
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/Error'
 *           example:
 *             success: false
 *             message: "Resource not found"
 *
 *     ValidationError:
 *       description: Validation error
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/Error'
 *           example:
 *             success: false
 *             message: "Validation failed"
 *
 *     ServerError:
 *       description: Internal server error
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/Error'
 *           example:
 *             success: false
 *             message: "Internal server error"
 *
 *     RateLimitError:
 *       description: Rate limit exceeded
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/Error'
 *           example:
 *             success: false
 *             message: "Too many requests. Please try again later."
 *
 *   securitySchemes:
 *     bearerAuth:
 *       type: http
 *       scheme: bearer
 *       bearerFormat: JWT
 *       description: Admin-level JWT token required
 */

/**
 * @swagger
 * tags:
 *   - name: Admin Referrals - Dashboard
 *     description: Referral dashboard and overview endpoints
 *   - name: Admin Referrals - Users
 *     description: User management and referral data endpoints
 *   - name: Admin Referrals - Transactions
 *     description: Transaction management and adjustments
 *   - name: Admin Referrals - Earnings
 *     description: Earnings management and adjustments
 *   - name: Admin Referrals - Analytics
 *     description: Analytics and performance reports
 *   - name: Admin Referrals - Settings
 *     description: System settings and configuration
 *   - name: Admin Referrals - Audit
 *     description: Audit logs and system actions
 */

// ─── Routes ──────────────────────────────────────────────────────────────

// ============= DASHBOARD & ANALYTICS =============

/**
 * @swagger
 * /admin/referrals/dashboard:
 *   get:
 *     tags: [Admin Referrals - Dashboard]
 *     summary: Get referral dashboard overview
 *     description: Returns comprehensive dashboard statistics including overview, generation breakdown, and top performers
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Dashboard data retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ReferralDashboard'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       429:
 *         $ref: '#/components/responses/RateLimitError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/dashboard', adminProtect, adminRateLimiter, getReferralDashboard);

/**
 * @swagger
 * /admin/referrals/analytics:
 *   get:
 *     tags: [Admin Referrals - Analytics]
 *     summary: Get referral analytics data
 *     description: Returns detailed analytics and metrics for the referral system
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: period
 *         schema: { type: string, enum: [weekly, monthly, quarterly, yearly], default: "monthly" }
 *         description: Time period for analytics
 *       - in: query
 *         name: generation
 *         schema: { type: integer, enum: [1, 2, 3] }
 *         description: Filter by referral generation
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
 *                 data:
 *                   type: object
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/analytics', adminProtect, getReferralAnalytics);

/**
 * @swagger
 * /admin/referrals/performance-report:
 *   get:
 *     tags: [Admin Referrals - Analytics]
 *     summary: Get performance report
 *     description: Returns detailed performance metrics and KPIs for the referral system
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: startDate
 *         schema: { type: string, format: date }
 *         description: Report start date
 *       - in: query
 *         name: endDate
 *         schema: { type: string, format: date }
 *         description: Report end date
 *     responses:
 *       200:
 *         description: Performance report retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/performance-report', adminProtect, getPerformanceReport);

/**
 * @swagger
 * /admin/referrals/commission-breakdown:
 *   get:
 *     tags: [Admin Referrals - Analytics]
 *     summary: Get commission breakdown
 *     description: Returns commission breakdown by generation with detailed statistics
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Commission breakdown retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     generation1:
 *                       type: object
 *                       properties:
 *                         rate:
 *                           type: number
 *                           example: 15
 *                         totalAmount:
 *                           type: number
 *                           example: 75000
 *                         transactionCount:
 *                           type: integer
 *                           example: 120
 *                     generation2:
 *                       type: object
 *                     generation3:
 *                       type: object
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/commission-breakdown', adminProtect, getCommissionBreakdown);

// ============= USER MANAGEMENT =============

/**
 * @swagger
 * /admin/referrals/users:
 *   get:
 *     tags: [Admin Referrals - Users]
 *     summary: Get all users with referral data
 *     description: Returns paginated list of users with referral statistics, search, and filtering
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1, default: 1 }
 *         description: Page number for pagination
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 100, default: 20 }
 *         description: Number of users per page
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *         description: Search by name, email, or username
 *       - in: query
 *         name: sortBy
 *         schema: { type: string, enum: [totalEarnings, totalReferred, joinDate, name], default: "totalEarnings" }
 *         description: Field to sort by
 *       - in: query
 *         name: sortOrder
 *         schema: { type: string, enum: [asc, desc], default: "desc" }
 *         description: Sort direction
 *       - in: query
 *         name: minEarnings
 *         schema: { type: number }
 *         description: Filter users with minimum earnings
 *       - in: query
 *         name: hasReferrals
 *         schema: { type: string, enum: [true, false] }
 *         description: Filter users with/without referrals
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
 *                     $ref: '#/components/schemas/ReferralUser'
 *                 pagination:
 *                   $ref: '#/components/schemas/Pagination'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       429:
 *         $ref: '#/components/responses/RateLimitError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/users', adminProtect, adminRateLimiter, getAllUsersWithReferralData);

/**
 * @swagger
 * /admin/referrals/user/{userId}:
 *   get:
 *     tags: [Admin Referrals - Users]
 *     summary: Get comprehensive user referral details
 *     description: Returns detailed referral information for a specific user including transactions, referral tree, and summary statistics
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema: { type: string }
 *         description: User ID
 *         example: "60f7c6b4c8f1a2b3c4d5e6f7"
 *       - in: query
 *         name: transactionPage
 *         schema: { type: integer, minimum: 1, default: 1 }
 *       - in: query
 *         name: transactionLimit
 *         schema: { type: integer, minimum: 1, maximum: 100, default: 30 }
 *       - in: query
 *         name: transactionStatus
 *         schema: { type: string, enum: [completed, pending, failed, cancelled, adjusted] }
 *       - in: query
 *         name: transactionGeneration
 *         schema: { type: integer, enum: [1, 2, 3] }
 *     responses:
 *       200:
 *         description: User referral details retrieved successfully
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
 *                       $ref: '#/components/schemas/ReferralUser'
 *                     summary:
 *                       type: object
 *                       properties:
 *                         totalEarningsThisMonth:
 *                           type: number
 *                         avgEarningsPerReferral:
 *                           type: number
 *                     transactions:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/ReferralTransaction'
 *                     referralTree:
 *                       type: object
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/user/:userId', adminProtect, getUserReferralDetails);

/**
 * @swagger
 * /admin/referrals/user/{userId}/sync:
 *   post:
 *     tags: [Admin Referrals - Users]
 *     summary: Sync user referral data
 *     description: Force refresh and synchronize a user's referral data with the system
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema: { type: string }
 *         description: User ID to sync
 *         example: "60f7c6b4c8f1a2b3c4d5e6f7"
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
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/user/:userId/sync', adminProtect, syncUserReferralData);

// ============= TRANSACTION MANAGEMENT =============

/**
 * @swagger
 * /admin/referrals/transactions:
 *   get:
 *     tags: [Admin Referrals - Transactions]
 *     summary: Get all referral transactions
 *     description: Returns paginated list of all referral transactions with filtering and sorting options
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 100, default: 20 }
 *       - in: query
 *         name: generation
 *         schema: { type: integer, enum: [1, 2, 3] }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [completed, pending, failed, cancelled, adjusted] }
 *       - in: query
 *         name: fromDate
 *         schema: { type: string, format: date }
 *         description: Filter transactions from this date onwards
 *       - in: query
 *         name: toDate
 *         schema: { type: string, format: date }
 *         description: Filter transactions up to this date
 *     responses:
 *       200:
 *         description: Transactions retrieved successfully
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
 *                 pagination:
 *                   $ref: '#/components/schemas/Pagination'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/transactions', adminProtect, getAllReferralTransactions);

/**
 * @swagger
 * /admin/referrals/transactions/bulk-edit:
 *   post:
 *     tags: [Admin Referrals - Transactions]
 *     summary: Bulk edit multiple transactions
 *     description: Update multiple transactions at once with new amounts and/or statuses. Includes audit logging for each change.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [transactions, reason]
 *             properties:
 *               transactions:
 *                 type: array
 *                 minItems: 1
 *                 description: Array of transactions to update
 *                 items:
 *                   type: object
 *                   required: [id]
 *                   properties:
 *                     id:
 *                       type: string
 *                       description: Transaction ID
 *                       example: "60f7c6b4c8f1a2b3c4d5e6f8"
 *                     newAmount:
 *                       type: number
 *                       description: New transaction amount (optional)
 *                       example: 2000.00
 *                     newStatus:
 *                       type: string
 *                       enum: [completed, pending, failed, cancelled, adjusted]
 *                       description: New transaction status (optional)
 *               reason:
 *                 type: string
 *                 minLength: 5
 *                 description: Reason for bulk edit (required, must be at least 5 characters)
 *                 example: "Bulk correction for subscription overpayments"
 *           examples:
 *             bulk_amount_update:
 *               summary: Update multiple transaction amounts
 *               value:
 *                 transactions:
 *                   - id: "60f7c6b4c8f1a2b3c4d5e6f8"
 *                     newAmount: 2000
 *                   - id: "60f7c6b4c8f1a2b3c4d5e6f9"
 *                     newAmount: 1800
 *                 reason: "Billing cycle adjustment for January"
 *             bulk_status_update:
 *               summary: Update multiple transaction statuses
 *               value:
 *                 transactions:
 *                   - id: "60f7c6b4c8f1a2b3c4d5e6f8"
 *                     newStatus: "completed"
 *                   - id: "60f7c6b4c8f1a2b3c4d5e6f9"
 *                     newStatus: "completed"
 *                 reason: "Batch completion of pending transactions"
 *     responses:
 *       200:
 *         description: Bulk edit completed successfully
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
 *                   example: "2 transactions updated successfully"
 *                 results:
 *                   type: object
 *                   properties:
 *                     successful:
 *                       type: integer
 *                       example: 2
 *                     failed:
 *                       type: integer
 *                       example: 0
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/transactions/bulk-edit', adminProtect, bulkEditTransactions);

/**
 * @swagger
 * /admin/referrals/transaction/{transactionId}/adjust:
 *   put:
 *     tags: [Admin Referrals - Transactions]
 *     summary: Adjust a single transaction
 *     description: Modify transaction amount and/or status with detailed audit trail. Optionally notify the user of changes.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: transactionId
 *         required: true
 *         schema: { type: string }
 *         description: Transaction ID to adjust
 *         example: "60f7c6b4c8f1a2b3c4d5e6f8"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [adjustmentReason]
 *             properties:
 *               newAmount:
 *                 type: number
 *                 description: New transaction amount (optional, leave blank to keep current)
 *                 example: 2000.00
 *               newStatus:
 *                 type: string
 *                 enum: [completed, pending, failed, cancelled, adjusted]
 *                 description: New transaction status (optional, leave blank to keep current)
 *               adjustmentReason:
 *                 type: string
 *                 minLength: 5
 *                 description: Reason for adjustment (required, at least 5 characters)
 *                 example: "Transaction was for premium subscription, updating amount"
 *               notifyUser:
 *                 type: boolean
 *                 default: true
 *                 description: Send notification to user about the change
 *           examples:
 *             amount_only:
 *               summary: Adjust amount only
 *               value:
 *                 newAmount: 2500
 *                 adjustmentReason: "Corrected amount for premium tier upgrade"
 *                 notifyUser: true
 *             status_only:
 *               summary: Adjust status only
 *               value:
 *                 newStatus: "completed"
 *                 adjustmentReason: "Manual completion of system-delayed transaction"
 *                 notifyUser: true
 *             both:
 *               summary: Adjust both amount and status
 *               value:
 *                 newAmount: 2000
 *                 newStatus: "completed"
 *                 adjustmentReason: "Complete reconciliation for January billing"
 *                 notifyUser: true
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
 *                 data:
 *                   type: object
 *                   properties:
 *                     oldAmount:
 *                       type: number
 *                       example: 1500
 *                     newAmount:
 *                       type: number
 *                       example: 2000
 *                     oldStatus:
 *                       type: string
 *                       example: "pending"
 *                     newStatus:
 *                       type: string
 *                       example: "completed"
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.put('/transaction/:transactionId/adjust', adminProtect, adjustReferralTransaction);

/**
 * @swagger
 * /admin/referrals/transaction/{transactionId}/cancel:
 *   delete:
 *     tags: [Admin Referrals - Transactions]
 *     summary: Cancel a transaction
 *     description: Cancel an existing transaction and reverse earnings. Creates audit log entry and optionally notifies user.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: transactionId
 *         required: true
 *         schema: { type: string }
 *         description: Transaction ID to cancel
 *         example: "60f7c6b4c8f1a2b3c4d5e6f8"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [reason]
 *             properties:
 *               reason:
 *                 type: string
 *                 minLength: 10
 *                 description: Reason for cancellation (required, at least 10 characters)
 *                 example: "User requested cancellation due to subscription downgrade"
 *               notifyUser:
 *                 type: boolean
 *                 default: true
 *                 description: Notify user about the cancellation
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
 *                 data:
 *                   type: object
 *                   properties:
 *                     transactionId:
 *                       type: string
 *                     reversedAmount:
 *                       type: number
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.delete('/transaction/:transactionId/cancel', adminProtect, cancelReferralTransaction);

// ============= EARNINGS MANAGEMENT =============

/**
 * @swagger
 * /admin/referrals/earnings/adjust:
 *   post:
 *     tags: [Admin Referrals - Earnings]
 *     summary: Adjust user earnings
 *     description: Manually adjust a user's total referral earnings. Supports add, subtract, or set operations. Creates comprehensive audit trail.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [userId, adjustmentType, amount, reason]
 *             properties:
 *               userId:
 *                 type: string
 *                 description: ID of the user to adjust earnings for
 *                 example: "60f7c6b4c8f1a2b3c4d5e6f7"
 *               adjustmentType:
 *                 type: string
 *                 enum: [add, subtract, set]
 *                 description: |
 *                   Type of adjustment:
 *                   - `add`: Increase earnings
 *                   - `subtract`: Decrease earnings
 *                   - `set`: Set to exact value
 *                 example: "add"
 *               amount:
 *                 type: number
 *                 minimum: 0
 *                 description: Amount to add/subtract/set
 *                 example: 5000.00
 *               reason:
 *                 type: string
 *                 minLength: 5
 *                 description: Reason for earnings adjustment (at least 5 characters)
 *                 example: "Bonus for achieving top referrer status"
 *               generation:
 *                 type: integer
 *                 enum: [1, 2, 3]
 *                 description: Optional - Apply adjustment to specific generation only
 *               notifyUser:
 *                 type: boolean
 *                 default: true
 *                 description: Send notification to user about the adjustment
 *           examples:
 *             bonus:
 *               summary: Add bonus earnings
 *               value:
 *                 userId: "60f7c6b4c8f1a2b3c4d5e6f7"
 *                 adjustmentType: "add"
 *                 amount: 5000
 *                 reason: "Bonus for achieving top referrer status this month"
 *                 notifyUser: true
 *             correction:
 *               summary: Correct earnings amount
 *               value:
 *                 userId: "60f7c6b4c8f1a2b3c4d5e6f7"
 *                 adjustmentType: "set"
 *                 amount: 25000
 *                 reason: "System correction to resolve accounting discrepancy"
 *                 notifyUser: true
 *             deduction:
 *               summary: Deduct earnings
 *               value:
 *                 userId: "60f7c6b4c8f1a2b3c4d5e6f7"
 *                 adjustmentType: "subtract"
 *                 amount: 1000
 *                 reason: "Chargeback reversal for cancelled subscription"
 *                 notifyUser: true
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
 *                 data:
 *                   type: object
 *                   properties:
 *                     userId:
 *                       type: string
 *                     oldEarnings:
 *                       type: number
 *                       example: 25000
 *                     newEarnings:
 *                       type: number
 *                       example: 30000
 *                     adjustment:
 *                       type: number
 *                       example: 5000
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 *       429:
 *         $ref: '#/components/responses/RateLimitError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/earnings/adjust', adminProtect, adminRateLimiter, adjustUserEarnings);

// ============= BULK ACTIONS =============

/**
 * @swagger
 * /admin/referrals/bulk-actions:
 *   post:
 *     tags: [Admin Referrals - Earnings]
 *     summary: Perform bulk actions
 *     description: Execute general purpose bulk operations on the referral system
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [action]
 *             properties:
 *               action:
 *                 type: string
 *                 description: Type of bulk action to perform
 *               data:
 *                 type: object
 *                 description: Action-specific data
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
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/bulk-actions', adminProtect, performBulkActions);

// ============= SYSTEM SETTINGS =============

/**
 * @swagger
 * /admin/referrals/settings:
 *   get:
 *     tags: [Admin Referrals - Settings]
 *     summary: Get referral system settings
 *     description: Returns current referral system configuration including commission rates, limits, and feature flags
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Settings retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/ReferralSettings'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 *   put:
 *     tags: [Admin Referrals - Settings]
 *     summary: Update referral system settings
 *     description: Update commission rates and system configuration. Changes take effect immediately and are logged in audit trail.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               isActive:
 *                 type: boolean
 *                 description: Enable/disable the referral system
 *                 example: true
 *               minimumPayout:
 *                 type: number
 *                 description: Minimum payout threshold for referral earnings
 *                 example: 10
 *               commissionRates:
 *                 type: object
 *                 description: Commission rates for each generation
 *                 properties:
 *                   generation1:
 *                     type: number
 *                     minimum: 0
 *                     maximum: 100
 *                     description: Percentage for generation 1 referrals
 *                     example: 15
 *                   generation2:
 *                     type: number
 *                     minimum: 0
 *                     maximum: 100
 *                     description: Percentage for generation 2 referrals
 *                     example: 3
 *                   generation3:
 *                     type: number
 *                     minimum: 0
 *                     maximum: 100
 *                     description: Percentage for generation 3 referrals
 *                     example: 2
 *           examples:
 *             rate_update:
 *               summary: Update commission rates
 *               value:
 *                 commissionRates:
 *                   generation1: 20
 *                   generation2: 5
 *                   generation3: 2
 *             toggle_system:
 *               summary: Enable/disable referral system
 *               value:
 *                 isActive: true
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
 *                   example: "Settings updated successfully"
 *                 data:
 *                   $ref: '#/components/schemas/ReferralSettings'
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/settings', adminProtect, getReferralSettings);
router.put('/settings', adminProtect, updateReferralSettings);

// ============= DATA EXPORT =============

/**
 * @swagger
 * /admin/referrals/export:
 *   get:
 *     tags: [Admin Referrals - Settings]
 *     summary: Export referral data
 *     description: Export referral data as CSV or Excel file with all transactions and user information
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: format
 *         schema: { type: string, enum: [csv, excel], default: "csv" }
 *         description: Export file format
 *       - in: query
 *         name: dateFrom
 *         schema: { type: string, format: date }
 *         description: Export data from this date
 *       - in: query
 *         name: dateTo
 *         schema: { type: string, format: date }
 *         description: Export data up to this date
 *     responses:
 *       200:
 *         description: Data exported successfully
 *         content:
 *           text/csv:
 *             schema:
 *               type: string
 *           application/vnd.openxmlformats-officedocument.spreadsheetml.sheet:
 *             schema:
 *               type: string
 *               format: binary
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/export', adminProtect, exportReferralData);

// ============= AUDIT LOGS =============

/**
 * @swagger
 * /admin/referrals/audit-log:
 *   get:
 *     tags: [Admin Referrals - Audit]
 *     summary: Get audit logs
 *     description: Returns comprehensive audit trail of all referral system actions with pagination and filtering
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 100, default: 20 }
 *       - in: query
 *         name: action
 *         schema: { type: string }
 *         description: Filter by action type (e.g., TRANSACTION_ADJUSTED, EARNINGS_ADJUSTED)
 *       - in: query
 *         name: userId
 *         schema: { type: string }
 *         description: Filter audit logs for specific user
 *       - in: query
 *         name: adminId
 *         schema: { type: string }
 *         description: Filter audit logs by admin who performed action
 *       - in: query
 *         name: fromDate
 *         schema: { type: string, format: date }
 *         description: Audit logs from this date onwards
 *       - in: query
 *         name: toDate
 *         schema: { type: string, format: date }
 *         description: Audit logs up to this date
 *     responses:
 *       200:
 *         description: Audit logs retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 logs:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/AuditLog'
 *                 pagination:
 *                   $ref: '#/components/schemas/Pagination'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/audit-log', adminProtect, getAuditLog);

// ─── Error Handling Middleware ────────────────────────────────────────────
router.use((err, req, res, next) => {
  console.error('Admin referral route error:', err);
  res.status(500).json({
    success: false,
    message: 'An unexpected error occurred in admin referral system',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

module.exports = router;