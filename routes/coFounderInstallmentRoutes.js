// routes/coFounderInstallmentRoutes.js
const express = require('express');
const router = express.Router();
const { protect, adminProtect } = require('../middleware/auth');
const coFounderInstallmentController = require('../controller/coFounderInstallmentController');

// Rate limiting middleware (basic implementation)
const createRateLimiter = (maxRequests, windowMs) => {
  const requests = new Map();

  return (req, res, next) => {
    const userId = req.user.id;
    const now = Date.now();

    // Clean up old requests
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

// Create rate limiters
const calculateRateLimiter = createRateLimiter(50, 60 * 60 * 1000); // 50 requests per hour for calculations
const createInstallmentRateLimiter = createRateLimiter(5, 60 * 60 * 1000); // 5 requests per hour for plan creation
const paymentSubmissionRateLimiter = createRateLimiter(10, 60 * 60 * 1000); // 10 payment submissions per hour

/**
 * @swagger
 * components:
 *   schemas:
 *     CoFounderInstallmentPlan:
 *       type: object
 *       properties:
 *         planId:
 *           type: string
 *           example: "CFI-A1B2-123456"
 *         status:
 *           type: string
 *           enum: [pending, active, late, completed, cancelled]
 *           example: "active"
 *         totalShares:
 *           type: integer
 *           example: 1
 *         totalPrice:
 *           type: number
 *           example: 100000
 *         currency:
 *           type: string
 *           enum: [naira, usdt]
 *           example: "naira"
 *         installmentMonths:
 *           type: integer
 *           example: 5
 *         minimumDownPaymentAmount:
 *           type: number
 *           example: 25000
 *         minimumDownPaymentPercentage:
 *           type: number
 *           example: 25
 *         sharesReleased:
 *           type: integer
 *           example: 0
 *         totalPaidAmount:
 *           type: number
 *           example: 25000
 *         remainingBalance:
 *           type: number
 *           example: 75000
 *         installments:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               installmentNumber:
 *                 type: integer
 *               amount:
 *                 type: number
 *               dueDate:
 *                 type: string
 *                 format: date-time
 *               status:
 *                 type: string
 *               percentageOfTotal:
 *                 type: number
 *               paidAmount:
 *                 type: number
 *               paidDate:
 *                 type: string
 *                 format: date-time
 *         createdAt:
 *           type: string
 *           format: date-time
 */

// User routes

/**
 * @swagger
 * /shares/cofounder/installment/calculate:
 *   post:
 *     tags: [CoFounder Installment - User]
 *     summary: Calculate co-founder installment plan
 *     description: Calculate installment plan details for co-founder share purchase
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - quantity
 *               - currency
 *             properties:
 *               quantity:
 *                 type: integer
 *                 minimum: 1
 *                 maximum: 1
 *                 example: 1
 *                 description: Number of co-founder shares (must be exactly 1 for installment plans)
 *               currency:
 *                 type: string
 *                 enum: [naira, usdt]
 *                 example: "naira"
 *                 description: Currency for the installment plan
 *               installmentMonths:
 *                 type: integer
 *                 minimum: 2
 *                 maximum: 12
 *                 default: 5
 *                 example: 5
 *                 description: Number of months for installment plan
 *     responses:
 *       200:
 *         description: Co-founder installment plan calculated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 installmentPlan:
 *                   type: object
 *                   properties:
 *                     totalShares:
 *                       type: integer
 *                       example: 1
 *                     totalPrice:
 *                       type: number
 *                       example: 100000
 *                     currency:
 *                       type: string
 *                       example: "naira"
 *                     installmentMonths:
 *                       type: integer
 *                       example: 5
 *                     minimumDownPaymentAmount:
 *                       type: number
 *                       example: 25000
 *                     minimumDownPaymentPercentage:
 *                       type: number
 *                       example: 25
 *                     installmentAmount:
 *                       type: number
 *                       example: 20000
 *                     monthlyPayments:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           installmentNumber:
 *                             type: integer
 *                           amount:
 *                             type: number
 *                           dueDate:
 *                             type: string
 *                             format: date-time
 *                           percentageOfTotal:
 *                             type: number
 *                           sharesReleased:
 *                             type: integer
 *                           isFirstPayment:
 *                             type: boolean
 *       400:
 *         description: Bad Request - Invalid input parameters or insufficient shares
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/calculate', 
  protect, 
  calculateRateLimiter,
  coFounderInstallmentController.validateCoFounderInstallmentInput,
  coFounderInstallmentController.calculateCoFounderInstallmentPlan
);

/**
 * @swagger
 * /shares/cofounder/installment/create:
 *   post:
 *     tags: [CoFounder Installment - User]
 *     summary: Create new co-founder installment plan
 *     description: Create a new installment plan for co-founder share purchase
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - quantity
 *               - currency
 *             properties:
 *               quantity:
 *                 type: integer
 *                 minimum: 1
 *                 maximum: 1
 *                 example: 1
 *               currency:
 *                 type: string
 *                 enum: [naira, usdt]
 *                 example: "naira"
 *               installmentMonths:
 *                 type: integer
 *                 minimum: 2
 *                 maximum: 12
 *                 default: 5
 *                 example: 5
 *     responses:
 *       201:
 *         description: Co-founder installment plan created successfully
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
 *                   example: "Co-founder installment plan created successfully"
 *                 planId:
 *                   type: string
 *                   example: "CFI-A1B2-123456"
 *                 plan:
 *                   $ref: '#/components/schemas/CoFounderInstallmentPlan'
 *       400:
 *         description: Bad Request - User already has active plan or invalid input
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/create', 
  protect, 
  createInstallmentRateLimiter,
  coFounderInstallmentController.validateCoFounderInstallmentInput,
  coFounderInstallmentController.createCoFounderInstallmentPlan
);

/**
 * @swagger
 * /shares/cofounder/installment/plans:
 *   get:
 *     tags: [CoFounder Installment - User]
 *     summary: Get user's co-founder installment plans
 *     description: Get current user's co-founder installment plans
 *     security:
 *       - bearerAuth: []
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
 *           maximum: 50
 *           default: 10
 *         description: Number of plans per page
 *     responses:
 *       200:
 *         description: User co-founder installment plans retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 plans:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/CoFounderInstallmentPlan'
 *                 pagination:
 *                   type: object
 *                   properties:
 *                     currentPage:
 *                       type: integer
 *                     totalPages:
 *                       type: integer
 *                     totalCount:
 *                       type: integer
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/plans', 
  protect, 
  coFounderInstallmentController.getUserCoFounderInstallmentPlans
);

/**
 * @swagger
 * /shares/cofounder/installment/cancel:
 *   post:
 *     tags: [CoFounder Installment - User]
 *     summary: Cancel co-founder installment plan
 *     description: Cancel a co-founder installment plan (only if minimum payment completed)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - planId
 *             properties:
 *               planId:
 *                 type: string
 *                 example: "CFI-A1B2-123456"
 *                 description: ID of the co-founder installment plan to cancel
 *               reason:
 *                 type: string
 *                 example: "Changed my mind"
 *                 description: Reason for cancellation (optional)
 *     responses:
 *       200:
 *         description: Co-founder installment plan cancelled successfully
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
 *                   example: "Co-founder installment plan cancelled successfully"
 *                 data:
 *                   type: object
 *                   properties:
 *                     planId:
 *                       type: string
 *                     status:
 *                       type: string
 *                       example: "cancelled"
 *                     sharesReleased:
 *                       type: integer
 *                     amountPaid:
 *                       type: number
 *       400:
 *         description: Bad Request - Cannot cancel plan or plan not found
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/cancel', 
  protect, 
  createInstallmentRateLimiter,
  coFounderInstallmentController.cancelCoFounderInstallmentPlan
);

// Payment routes - Paystack only

/**
 * @swagger
 * /shares/cofounder/installment/paystack/pay:
 *   post:
 *     tags: [CoFounder Installment - Payment]
 *     summary: Pay co-founder installment with Paystack
 *     description: Initialize Paystack payment for a co-founder installment
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - planId
 *               - installmentNumber
 *               - amount
 *               - email
 *             properties:
 *               planId:
 *                 type: string
 *                 example: "CFI-A1B2-123456"
 *                 description: ID of the co-founder installment plan
 *               installmentNumber:
 *                 type: integer
 *                 minimum: 1
 *                 example: 1
 *                 description: Installment number to pay
 *               amount:
 *                 type: number
 *                 minimum: 0.01
 *                 example: 25000
 *                 description: Amount to pay for this installment
 *               email:
 *                 type: string
 *                 format: email
 *                 example: "user@example.com"
 *                 description: User's email for Paystack
 *     responses:
 *       200:
 *         description: Co-founder Paystack payment initialized successfully
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
 *                   example: "Co-founder Paystack payment initialized"
 *                 data:
 *                   type: object
 *                   properties:
 *                     authorizationUrl:
 *                       type: string
 *                       example: "https://checkout.paystack.com/..."
 *                     accessCode:
 *                       type: string
 *                     reference:
 *                       type: string
 *                       example: "CFI-A1B2-123456"
 *                     amount:
 *                       type: number
 *                       example: 25000
 *                     currency:
 *                       type: string
 *                       example: "naira"
 *                     planId:
 *                       type: string
 *                     installmentNumber:
 *                       type: integer
 *       400:
 *         description: Bad Request - Invalid parameters or plan status
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/paystack/pay', 
  protect, 
  paymentSubmissionRateLimiter,
  coFounderInstallmentController.payCoFounderInstallmentWithPaystack
);

/**
 * @swagger
 * /shares/cofounder/installment/paystack/verify:
 *   get:
 *     tags: [CoFounder Installment - Payment]
 *     summary: Verify Paystack co-founder installment payment
 *     description: Verify and complete a Paystack co-founder installment payment
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: reference
 *         required: true
 *         schema:
 *           type: string
 *         description: Paystack payment reference
 *         example: "CFI-A1B2-123456"
 *     responses:
 *       200:
 *         description: Co-founder payment verified successfully
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
 *                   example: "Co-founder payment verified successfully"
 *                 data:
 *                   type: object
 *                   properties:
 *                     planId:
 *                       type: string
 *                     amount:
 *                       type: number
 *                     status:
 *                       type: string
 *                       example: "completed"
 *                     planStatus:
 *                       type: string
 *                       example: "active"
 *                     totalPaidAmount:
 *                       type: number
 *                     remainingBalance:
 *                       type: number
 *                     sharesReleased:
 *                       type: integer
 *       400:
 *         description: Bad Request - Payment verification failed
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/paystack/verify', 
  protect, 
  coFounderInstallmentController.verifyCoFounderInstallmentPaystack
);

// Admin routes

/**
 * @swagger
 * /shares/cofounder/installment/admin/plans:
 *   get:
 *     tags: [CoFounder Installment - Admin]
 *     summary: Get all co-founder installment plans
 *     description: Get all co-founder installment plans (admin only)
 *     security:
 *       - adminAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 20
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, active, late, completed, cancelled]
 *         description: Filter by plan status
 *       - in: query
 *         name: userId
 *         schema:
 *           type: string
 *         description: Filter by specific user ID
 *     responses:
 *       200:
 *         description: Co-founder installment plans retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 plans:
 *                   type: array
 *                   items:
 *                     allOf:
 *                       - $ref: '#/components/schemas/CoFounderInstallmentPlan'
 *                       - type: object
 *                         properties:
 *                           user:
 *                             type: object
 *                             properties:
 *                               id:
 *                                 type: string
 *                               name:
 *                                 type: string
 *                               email:
 *                                 type: string
 *                               phone:
 *                                 type: string
 *                 pagination:
 *                   type: object
 *                   properties:
 *                     currentPage:
 *                       type: integer
 *                     totalPages:
 *                       type: integer
 *                     totalCount:
 *                       type: integer
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/admin/plans', 
  adminProtect, 
  coFounderInstallmentController.adminGetAllCoFounderInstallmentPlans
);

/**
 * @swagger
 * /shares/cofounder/installment/admin/check-late-payments:
 *   post:
 *     tags: [CoFounder Installment - Admin]
 *     summary: Check for late payments
 *     description: Check and process late payment fees for all active co-founder installment plans (admin only)
 *     security:
 *       - adminAuth: []
 *     responses:
 *       200:
 *         description: Co-founder late payment check completed successfully
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
 *                   example: "Co-founder late payment check completed: 2 late payments found and processed"
 *                 latePaymentsFound:
 *                   type: integer
 *                   example: 2
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/admin/check-late-payments', 
  adminProtect, 
  coFounderInstallmentController.checkCoFounderLatePayments
);

// Error handling middleware
router.use((err, req, res, next) => {
  console.error('Co-founder installment route error:', err);
  res.status(500).json({
    success: false,
    message: 'An unexpected error occurred in co-founder installment system',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

module.exports = router;