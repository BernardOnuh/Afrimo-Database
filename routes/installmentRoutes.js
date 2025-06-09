const express = require('express');
const router = express.Router();
const { protect, adminProtect } = require('../middleware/auth');
const installmentController = require('../controller/installmentController');

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
 *     InstallmentPlan:
 *       type: object
 *       properties:
 *         planId:
 *           type: string
 *           example: "INST-A1B2-123456"
 *         status:
 *           type: string
 *           enum: [pending, active, late, completed, cancelled]
 *           example: "active"
 *         totalShares:
 *           type: integer
 *           example: 1
 *         totalPrice:
 *           type: number
 *           example: 50000
 *         currency:
 *           type: string
 *           enum: [naira, usdt]
 *           example: "naira"
 *         installmentMonths:
 *           type: integer
 *           example: 5
 *         minimumDownPaymentAmount:
 *           type: number
 *           example: 10000
 *         minimumDownPaymentPercentage:
 *           type: number
 *           example: 20
 *         sharesReleased:
 *           type: integer
 *           example: 0
 *         totalPaidAmount:
 *           type: number
 *           example: 10000
 *         remainingBalance:
 *           type: number
 *           example: 40000
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
 * /shares/installment/calculate:
 *   post:
 *     tags: [Installment - User]
 *     summary: Calculate installment plan
 *     description: Calculate installment plan details for share purchase
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
 *                 description: Number of shares (must be exactly 1 for installment plans)
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
 *         description: Installment plan calculated successfully
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
 *                       example: 50000
 *                     currency:
 *                       type: string
 *                       example: "naira"
 *                     installmentMonths:
 *                       type: integer
 *                       example: 5
 *                     minimumDownPaymentAmount:
 *                       type: number
 *                       example: 10000
 *                     installmentAmount:
 *                       type: number
 *                       example: 10000
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
 *         description: Bad Request - Invalid input parameters
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/calculate', 
  protect, 
  calculateRateLimiter,
  installmentController.validateInstallmentInput,
  installmentController.calculateInstallmentPlan
);

/**
 * @swagger
 * /shares/installment/create:
 *   post:
 *     tags: [Installment - User]
 *     summary: Create new installment plan
 *     description: Create a new installment plan for share purchase
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
 *         description: Installment plan created successfully
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
 *                   example: "Installment plan created successfully"
 *                 planId:
 *                   type: string
 *                   example: "INST-A1B2-123456"
 *                 plan:
 *                   $ref: '#/components/schemas/InstallmentPlan'
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
  installmentController.validateInstallmentInput,
  installmentController.createInstallmentPlan
);

/**
 * @swagger
 * /shares/installment/plans:
 *   get:
 *     tags: [Installment - User]
 *     summary: Get user's installment plans
 *     description: Get current user's installment plans
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
 *         description: User installment plans retrieved successfully
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
 *                     $ref: '#/components/schemas/InstallmentPlan'
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
  installmentController.getUserInstallmentPlans
);

/**
 * @swagger
 * /shares/installment/cancel:
 *   post:
 *     tags: [Installment - User]
 *     summary: Cancel installment plan
 *     description: Cancel an installment plan (only if minimum payment completed)
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
 *                 example: "INST-A1B2-123456"
 *                 description: ID of the installment plan to cancel
 *               reason:
 *                 type: string
 *                 example: "Changed my mind"
 *                 description: Reason for cancellation (optional)
 *     responses:
 *       200:
 *         description: Installment plan cancelled successfully
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
 *                   example: "Installment plan cancelled successfully"
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
  installmentController.cancelInstallmentPlan
);

// Payment routes - Paystack only

/**
 * @swagger
 * /shares/installment/paystack/pay:
 *   post:
 *     tags: [Installment - Payment]
 *     summary: Pay installment with Paystack
 *     description: Initialize Paystack payment for an installment
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
 *                 example: "INST-A1B2-123456"
 *                 description: ID of the installment plan
 *               installmentNumber:
 *                 type: integer
 *                 minimum: 1
 *                 example: 1
 *                 description: Installment number to pay
 *               amount:
 *                 type: number
 *                 minimum: 0.01
 *                 example: 10000
 *                 description: Amount to pay for this installment
 *               email:
 *                 type: string
 *                 format: email
 *                 example: "user@example.com"
 *                 description: User's email for Paystack
 *     responses:
 *       200:
 *         description: Paystack payment initialized successfully
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
 *                   example: "Paystack payment initialized"
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
 *                       example: "INST-A1B2-123456"
 *                     amount:
 *                       type: number
 *                       example: 10000
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
  installmentController.payInstallmentWithPaystack
);

/**
 * @swagger
 * /shares/installment/paystack/verify:
 *   get:
 *     tags: [Installment - Payment]
 *     summary: Verify Paystack installment payment
 *     description: Verify and complete a Paystack installment payment
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: reference
 *         required: true
 *         schema:
 *           type: string
 *         description: Paystack payment reference
 *         example: "INST-A1B2-123456"
 *     responses:
 *       200:
 *         description: Payment verified successfully
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
 *                   example: "Payment verified successfully"
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
  installmentController.verifyInstallmentPaystack
);

// Admin routes

/**
 * @swagger
 * /shares/installment/admin/plans:
 *   get:
 *     tags: [Installment - Admin]
 *     summary: Get all installment plans
 *     description: Get all installment plans (admin only)
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
 *         description: Installment plans retrieved successfully
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
 *                       - $ref: '#/components/schemas/InstallmentPlan'
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
  installmentController.adminGetAllInstallmentPlans
);

/**
 * @swagger
 * /shares/installment/admin/check-late-payments:
 *   post:
 *     tags: [Installment - Admin]
 *     summary: Check for late payments
 *     description: Check and process late payment fees for all active installment plans (admin only)
 *     security:
 *       - adminAuth: []
 *     responses:
 *       200:
 *         description: Late payment check completed successfully
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
 *                   example: "Late payment check completed: 3 late payments found and processed"
 *                 latePaymentsFound:
 *                   type: integer
 *                   example: 3
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/admin/check-late-payments', 
  adminProtect, 
  installmentController.checkLatePayments
);

// Error handling middleware
router.use((err, req, res, next) => {
  console.error('Installment route error:', err);
  res.status(500).json({
    success: false,
    message: 'An unexpected error occurred',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});
/**
 * @swagger
 * components:
 *   securitySchemes:
 *     bearerAuth:
 *       type: http
 *       scheme: bearer
 *       bearerFormat: JWT
 *   schemas:
 *     TransactionVerifyRequest:
 *       type: object
 *       required:
 *         - reference
 *       properties:
 *         reference:
 *           type: string
 *           description: Paystack transaction reference
 *           example: "INST-495245B4-737394"
 *         planId:
 *           type: string
 *           description: Optional plan ID if metadata is incomplete
 *           example: "INST-9D0D1D3D-226991"
 *         forceApprove:
 *           type: boolean
 *           description: Force approve payment even if validation fails
 *           default: false
 *         adminNote:
 *           type: string
 *           description: Admin note for audit trail
 *           example: "Manual verification due to gateway delay"
 *     
 *     TransactionUnverifyRequest:
 *       type: object
 *       properties:
 *         reference:
 *           type: string
 *           description: Transaction reference to unverify
 *           example: "INST-495245B4-737394"
 *         planId:
 *           type: string
 *           description: Alternative to reference - plan ID
 *           example: "INST-9D0D1D3D-226991"
 *         installmentNumber:
 *           type: integer
 *           description: Used with planId to identify installment
 *           example: 1
 *         confirmUnverify:
 *           type: boolean
 *           description: Must be true to proceed with unverification
 *           default: false
 *         adminNote:
 *           type: string
 *           description: Reason for unverification
 *           example: "Duplicate payment detected"
 *     
 *     VerificationResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: true
 *         message:
 *           type: string
 *           example: "Payment verified and approved successfully"
 *         data:
 *           type: object
 *           properties:
 *             planId:
 *               type: string
 *               example: "INST-9D0D1D3D-226991"
 *             reference:
 *               type: string
 *               example: "INST-495245B4-737394"
 *             amount:
 *               type: number
 *               example: 50000
 *             installmentNumber:
 *               type: integer
 *               example: 1
 *             status:
 *               type: string
 *               example: "completed"
 *             planStatus:
 *               type: string
 *               example: "active"
 *             sharesReleased:
 *               type: integer
 *               example: 125
 *             verifiedBy:
 *               type: string
 *               example: "Admin Name"
 *     
 *     PendingTransaction:
 *       type: object
 *       properties:
 *         planId:
 *           type: string
 *           example: "INST-9D0D1D3D-226991"
 *         user:
 *           type: object
 *           properties:
 *             id:
 *               type: string
 *             name:
 *               type: string
 *               example: "John Doe"
 *             email:
 *               type: string
 *               example: "john@example.com"
 *         installmentNumber:
 *           type: integer
 *           example: 1
 *         amount:
 *           type: number
 *           example: 50000
 *         transactionId:
 *           type: string
 *           example: "INST-495245B4-737394"
 *         status:
 *           type: string
 *           enum: [pending, upcoming, completed]
 *         canVerify:
 *           type: boolean
 *         canUnverify:
 *           type: boolean
 *     
 *     ErrorResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: false
 *         message:
 *           type: string
 *           example: "Error message description"
 *         error:
 *           type: string
 *           description: "Detailed error (development only)"
 */

/**
 * @swagger
 * /shares/installment/admin/verify-transaction:
 *   post:
 *     summary: Verify and approve a pending Paystack transaction
 *     description: |
 *       Admin endpoint to verify and approve installment payments. Can force approve
 *       payments that failed in Paystack or don't meet normal validation criteria.
 *       
 *       **Features:**
 *       - Verifies payment with Paystack API
 *       - Can force approve failed payments
 *       - Releases shares to user account
 *       - Updates plan status and balances
 *       - Sends notifications to user and admins
 *       - Maintains complete audit trail
 *       
 *       **Force Approve Use Cases:**
 *       - Payment failed in Paystack but customer provided valid proof
 *       - Payment amount below minimum (with justification)
 *       - Manual bank transfer verification
 *     tags:
 *       - Admin Verification
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/TransactionVerifyRequest'
 *           examples:
 *             normal_verification:
 *               summary: Normal verification
 *               value:
 *                 reference: "INST-495245B4-737394"
 *                 adminNote: "Payment verified manually"
 *             force_approve:
 *               summary: Force approve failed payment
 *               value:
 *                 reference: "INST-495245B4-737394"
 *                 forceApprove: true
 *                 adminNote: "Customer provided valid bank transfer receipt"
 *             with_plan_id:
 *               summary: With plan ID fallback
 *               value:
 *                 reference: "INST-495245B4-737394"
 *                 planId: "INST-9D0D1D3D-226991"
 *                 adminNote: "Manual verification with plan lookup"
 *     responses:
 *       200:
 *         description: Payment verified successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/VerificationResponse'
 *       400:
 *         description: Validation error or payment already completed
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/ErrorResponse'
 *                 - type: object
 *                   properties:
 *                     canForceApprove:
 *                       type: boolean
 *                       description: Whether force approve can override this error
 *                     data:
 *                       type: object
 *                       description: Additional context for the error
 *             examples:
 *               payment_failed:
 *                 summary: Payment failed in Paystack
 *                 value:
 *                   success: false
 *                   message: "Payment status: failed. Use forceApprove=true to override."
 *                   canForceApprove: true
 *                   paymentStatus: "failed"
 *               already_completed:
 *                 summary: Payment already verified
 *                 value:
 *                   success: false
 *                   message: "This installment has already been completed"
 *                   data:
 *                     canUnverify: true
 *       403:
 *         description: Unauthorized - Admin access required
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Plan or user not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */

/**
 * @swagger
 * /shares/installment/admin/unverify-transaction:
 *   post:
 *     summary: Unverify and reverse a completed payment
 *     description: |
 *       Admin endpoint to reverse a completed installment payment. This is a dangerous
 *       operation that requires explicit confirmation and will:
 *       
 *       **What it does:**
 *       - Reverses the payment verification
 *       - Removes shares from user account
 *       - Updates plan balances and status
 *       - Maintains audit trail of the reversal
 *       - Sends notifications to user and admins
 *       
 *       **Safety Features:**
 *       - Requires confirmUnverify=true to proceed
 *       - First call shows confirmation prompt
 *       - Complete audit trail maintained
 *       - Cannot unverify non-completed payments
 *       
 *       **Use Cases:**
 *       - Duplicate payment processing
 *       - Fraudulent transaction discovered
 *       - Payment processed in error
 *       - Customer dispute resolution
 *     tags:
 *       - Admin Verification
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/TransactionUnverifyRequest'
 *           examples:
 *             confirmation_check:
 *               summary: First call - get confirmation prompt
 *               value:
 *                 reference: "INST-495245B4-737394"
 *             confirmed_unverify:
 *               summary: Confirmed unverification
 *               value:
 *                 reference: "INST-495245B4-737394"
 *                 confirmUnverify: true
 *                 adminNote: "Duplicate payment detected and reversed"
 *             by_plan_id:
 *               summary: Unverify by plan ID and installment
 *               value:
 *                 planId: "INST-9D0D1D3D-226991"
 *                 installmentNumber: 1
 *                 confirmUnverify: true
 *                 adminNote: "Manual reversal requested by customer"
 *     responses:
 *       200:
 *         description: Response varies based on confirmUnverify flag
 *         content:
 *           application/json:
 *             schema:
 *               oneOf:
 *                 - type: object
 *                   properties:
 *                     success:
 *                       type: boolean
 *                       example: false
 *                     message:
 *                       type: string
 *                       example: "Unverification requires confirmation"
 *                     requiresConfirmation:
 *                       type: boolean
 *                       example: true
 *                     data:
 *                       type: object
 *                       properties:
 *                         warning:
 *                           type: string
 *                         amount:
 *                           type: number
 *                 - $ref: '#/components/schemas/VerificationResponse'
 *             examples:
 *               confirmation_required:
 *                 summary: Confirmation required
 *                 value:
 *                   success: false
 *                   message: "Unverification requires confirmation. This action will reverse the payment and remove shares."
 *                   requiresConfirmation: true
 *                   instruction: "Set confirmUnverify=true to proceed"
 *               unverify_success:
 *                 summary: Successfully unverified
 *                 value:
 *                   success: true
 *                   message: "Payment unverified successfully"
 *                   data:
 *                     planId: "INST-9D0D1D3D-226991"
 *                     amount: 50000
 *                     sharesRemoved: 125
 *                     unverifiedBy: "Admin Name"
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       403:
 *         description: Unauthorized - Admin access required
 *       404:
 *         description: Plan or installment not found
 *       500:
 *         description: Server error
 */

/**
 * @swagger
 * /shares/installment/admin/pending-transactions:
 *   get:
 *     summary: Get transactions for admin review
 *     description: |
 *       Retrieves installment transactions that need admin attention or review.
 *       Can filter by status and supports pagination.
 *       
 *       **Status Filters:**
 *       - `pending`: Transactions with references but not yet verified
 *       - `completed`: Verified transactions with admin details
 *       - `all`: All transactions with transaction references
 *       
 *       **Response includes:**
 *       - Transaction details and status
 *       - User information
 *       - Plan context
 *       - Available actions (verify/unverify)
 *       - Admin verification history
 *     tags:
 *       - Admin Verification
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [all, pending, completed]
 *           default: all
 *         description: Filter transactions by status
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
 *     responses:
 *       200:
 *         description: List of transactions
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
 *                     $ref: '#/components/schemas/PendingTransaction'
 *                 count:
 *                   type: integer
 *                   description: Number of transactions in current page
 *                 filters:
 *                   type: object
 *                   properties:
 *                     status:
 *                       type: string
 *                     availableStatuses:
 *                       type: array
 *                       items:
 *                         type: string
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
 *         description: Unauthorized - Admin access required
 *       500:
 *         description: Server error
 */

/**
 * @swagger
 * /shares/installment/admin/transaction-details/{reference}:
 *   get:
 *     summary: Get detailed transaction information
 *     description: |
 *       Retrieves comprehensive details about a specific transaction including:
 *       
 *       **Information provided:**
 *       - Complete plan details and status
 *       - User information
 *       - Installment details and history
 *       - Paystack transaction data
 *       - Available admin actions
 *       - Verification history and audit trail
 *       
 *       **Use this endpoint to:**
 *       - Review transaction before verification
 *       - Check Paystack status vs internal status
 *       - See complete payment history
 *       - Determine available actions
 *     tags:
 *       - Admin Verification
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: reference
 *         required: true
 *         schema:
 *           type: string
 *         description: Paystack transaction reference
 *         example: "INST-495245B4-737394"
 *     responses:
 *       200:
 *         description: Detailed transaction information
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
 *                     plan:
 *                       type: object
 *                       properties:
 *                         planId:
 *                           type: string
 *                         status:
 *                           type: string
 *                         totalPrice:
 *                           type: number
 *                         remainingBalance:
 *                           type: number
 *                         sharesReleased:
 *                           type: integer
 *                     user:
 *                       type: object
 *                       properties:
 *                         name:
 *                           type: string
 *                         email:
 *                           type: string
 *                     installment:
 *                       type: object
 *                       properties:
 *                         number:
 *                           type: integer
 *                         status:
 *                           type: string
 *                         amount:
 *                           type: number
 *                         isFirstPayment:
 *                           type: boolean
 *                         verifiedBy:
 *                           type: string
 *                         adminNote:
 *                           type: string
 *                     paystack:
 *                       type: object
 *                       properties:
 *                         status:
 *                           type: string
 *                         amount:
 *                           type: number
 *                         currency:
 *                           type: string
 *                         gateway_response:
 *                           type: string
 *                     actions:
 *                       type: object
 *                       properties:
 *                         canVerify:
 *                           type: boolean
 *                           description: Whether transaction can be verified
 *                         canUnverify:
 *                           type: boolean
 *                           description: Whether transaction can be unverified
 *                         requiresForceApprove:
 *                           type: boolean
 *                           description: Whether force approve is needed
 *       403:
 *         description: Unauthorized - Admin access required
 *       404:
 *         description: Transaction not found
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/ErrorResponse'
 *                 - type: object
 *                   properties:
 *                     paystackData:
 *                       type: object
 *                       description: Paystack data even if plan not found
 *       500:
 *         description: Server error
 */

module.exports = router;