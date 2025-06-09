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
 *     AdminVerifyRequest:
 *       type: object
 *       required:
 *         - reference
 *       properties:
 *         reference:
 *           type: string
 *           description: The Paystack transaction reference to verify
 *           example: "INST-495245B4-737394"
 *         forceApprove:
 *           type: boolean
 *           description: Set to true to approve even if payment failed in Paystack
 *           default: false
 *           example: false
 *         adminNote:
 *           type: string
 *           description: Optional note explaining why you're verifying this payment
 *           example: "Customer provided bank transfer receipt"
 *           maxLength: 500
 *     AdminUnverifyRequest:
 *       type: object
 *       required:
 *         - reference
 *         - confirmUnverify
 *       properties:
 *         reference:
 *           type: string
 *           description: The transaction reference to reverse/unverify
 *           example: "INST-495245B4-737394"
 *         confirmUnverify:
 *           type: boolean
 *           description: MUST be true to proceed (safety confirmation)
 *           example: true
 *         adminNote:
 *           type: string
 *           description: Required explanation for why you're reversing this payment
 *           example: "Payment was processed twice by mistake"
 *           maxLength: 500
 *   responses:
 *     UnauthorizedError:
 *       description: Authentication token is missing or invalid
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
 *                 example: "Unauthorized access"
 *     ForbiddenError:
 *       description: Access forbidden - admin privileges required
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
 *                 example: "Admin access required"
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
 *         description: Unauthorized access
 *       500:
 *         description: Internal server error
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
 *         description: Unauthorized access
 *       500:
 *         description: Internal server error
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
 *         description: Unauthorized access
 *       500:
 *         description: Internal server error
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
 *         description: Unauthorized access
 *       404:
 *         description: Plan not found
 *       500:
 *         description: Internal server error
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
 *         description: Unauthorized access
 *       404:
 *         description: Plan not found
 *       500:
 *         description: Internal server error
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
 *         description: Unauthorized access
 *       404:
 *         description: Transaction not found
 *       500:
 *         description: Internal server error
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
 *         description: Unauthorized access
 *       403:
 *         description: Admin access required
 *       500:
 *         description: Internal server error
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
 *         description: Unauthorized access
 *       403:
 *         description: Admin access required
 *       500:
 *         description: Internal server error
 */
router.post('/admin/check-late-payments', 
  adminProtect, 
  installmentController.checkLatePayments
);

/**
 * @swagger
 * /shares/installment/admin/verify-transaction:
 *   post:
 *     summary: Verify a pending payment
 *     description: |
 *       **What this does:** Approves a Paystack payment and releases shares to the customer.
 *       
 *       **When to use:**
 *       - Customer made payment but it shows as "failed" in Paystack
 *       - Customer provided proof of bank transfer
 *       - Payment needs manual approval for any reason
 *       
 *       **What happens:**
 *       1. Checks payment status with Paystack
 *       2. If failed but you set `forceApprove: true`, it approves anyway
 *       3. Releases shares to customer's account
 *       4. Updates installment plan status
 *       5. Sends confirmation email to customer
 *       
 *       **⚠️ Important:** Only use `forceApprove: true` when you have verified the payment through other means.
 *     tags: [Installment - Admin]
 *     security:
 *       - adminAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/AdminVerifyRequest'
 *           examples:
 *             normal_verification:
 *               summary: Normal verification (payment succeeded in Paystack)
 *               value:
 *                 reference: "INST-495245B4-737394"
 *                 adminNote: "Payment verified successfully"
 *             force_approve_failed:
 *               summary: Force approve a failed payment
 *               value:
 *                 reference: "INST-495245B4-737394"
 *                 forceApprove: true
 *                 adminNote: "Customer showed bank transfer receipt"
 *             bank_transfer:
 *               summary: Manual bank transfer verification
 *               value:
 *                 reference: "INST-495245B4-737394"
 *                 forceApprove: true
 *                 adminNote: "Verified bank transfer of ₦50,000 on 2024-12-09"
 *     responses:
 *       200:
 *         description: Payment processed successfully
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
 *                   example: "Payment verified and approved successfully"
 *                 data:
 *                   type: object
 *                   properties:
 *                     planId:
 *                       type: string
 *                       example: "INST-9D0D1D3D-226991"
 *                     amount:
 *                       type: number
 *                       example: 50000
 *                     sharesReleased:
 *                       type: integer
 *                       example: 125
 *                     customerName:
 *                       type: string
 *                       example: "John Doe"
 *                     customerEmail:
 *                       type: string
 *                       example: "john@example.com"
 *       400:
 *         description: Cannot verify this payment
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
 *                   example: "Payment status: failed. Use forceApprove=true to override."
 *                 canForceApprove:
 *                   type: boolean
 *                   example: true
 *                   description: Indicates you can retry with forceApprove=true
 *                 paymentStatus:
 *                   type: string
 *                   example: "failed"
 *             examples:
 *               payment_failed:
 *                 summary: Payment failed in Paystack
 *                 value:
 *                   success: false
 *                   message: "Payment status: failed. Use forceApprove=true to override."
 *                   canForceApprove: true
 *                   paymentStatus: "failed"
 *               already_verified:
 *                 summary: Payment already verified
 *                 value:
 *                   success: false
 *                   message: "This installment has already been completed"
 *                   canUnverify: true
 *       403:
 *         description: Admin access required
 *       404:
 *         description: Transaction reference not found
 *       500:
 *         description: Server error
 */
router.post('/admin/verify-transaction', 
  adminProtect, 
  installmentController.adminVerifyTransaction
);

/**
 * @swagger
 * /shares/installment/admin/unverify-transaction:
 *   post:
 *     summary: Reverse/undo a verified payment
 *     description: |
 *       **⚠️ DANGER: This reverses a completed payment and removes shares from customer's account**
 *       
 *       **What this does:**
 *       - Reverses a previously verified payment
 *       - Removes shares from customer's account
 *       - Updates installment plan balances
 *       - Sends notification to customer
 *       - Creates audit trail
 *       
 *       **When to use:**
 *       - Payment was processed twice by mistake
 *       - Fraudulent payment discovered
 *       - Customer dispute needs resolution
 *       - Payment was verified in error
 *       
 *       **Safety features:**
 *       - Requires `confirmUnverify: true` to proceed
 *       - First call without confirmation shows you what will happen
 *       - Complete audit trail maintained
 *       - Customer is automatically notified
 *       
 *       **⚠️ Warning:** This action cannot be easily undone. Use with extreme caution.
 *     tags: [Installment - Admin]
 *     security:
 *       - adminAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/AdminUnverifyRequest'
 *           examples:
 *             check_before_unverify:
               summary: "Step 1: Check what will happen (safety check)"
               value:
                 reference: "INST-495245B4-737394"
                 confirmUnverify: false
                 adminNote: "Checking impact before proceeding"
             confirm_unverify:
               summary: "Step 2: Actually reverse the payment"
               value:
                 reference: "INST-495245B4-737394"
                 confirmUnverify: true
                 adminNote: "Payment was processed twice - reversing duplicate"
             fraud_reversal:
               summary: "Fraud case reversal"
               value:
                 reference: "INST-495245B4-737394"
                 confirmUnverify: true
                 adminNote: "Fraudulent payment detected - reversing transaction"
     responses:
       200:
         description: Response depends on confirmUnverify value
         content:
           application/json:
             schema:
               oneOf:
                 - type: object
                   title: Safety Check Response
                   properties:
                     success:
                       type: boolean
                       example: false
                     message:
                       type: string
                       example: "Unverification requires confirmation"
                     requiresConfirmation:
                       type: boolean
                       example: true
                     data:
                       type: object
                       properties:
                         planId:
                           type: string
                         customerName:
                           type: string
                         amount:
                           type: number
                         sharesWillBeRemoved:
                           type: integer
                         warning:
                           type: string
                           example: "This will remove 125 shares from John Doe's account"
                     instruction:
                       type: string
                       example: "Set confirmUnverify=true to proceed"
                 - type: object
                   title: Unverification Complete
                   properties:
                     success:
                       type: boolean
                       example: true
                     message:
                       type: string
                       example: "Payment unverified successfully"
                     data:
                       type: object
                       properties:
                         planId:
                           type: string
                         amount:
                           type: number
                         sharesRemoved:
                           type: integer
                         customerNotified:
                           type: boolean
                         unverifiedBy:
                           type: string
             examples:
               safety_check:
                 summary: Safety confirmation needed
                 value:
                   success: false
                   message: "Unverification requires confirmation"
                   requiresConfirmation: true
                   data:
                     planId: "INST-9D0D1D3D-226991"
                     customerName: "John Doe"
                     amount: 50000
                     sharesWillBeRemoved: 125
                     warning: "This will remove 125 shares from John Doe's account"
                   instruction: "Set confirmUnverify=true to proceed"
               unverify_complete:
                 summary: Successfully unverified
                 value:
                   success: true
                   message: "Payment unverified successfully"
                   data:
                     planId: "INST-9D0D1D3D-226991"
                     amount: 50000
                     sharesRemoved: 125
                     customerNotified: true
                     unverifiedBy: "Admin Name"
       400:
         description: Cannot unverify this transaction
         content:
           application/json:
             schema:
               type: object
               properties:
                 success:
                   type: boolean
                   example: false
                 message:
                   type: string
                   example: "Installment is not completed. Current status: pending"
                 cannotUnverify:
                   type: boolean
                   example: true
       403:
         description: Admin access required
       404:
         description: Transaction reference not found
       500:
         description: Server error
 */
router.post('/admin/unverify-transaction', 
  adminProtect, 
  installmentController.adminUnverifyTransaction
);

/**
 * @swagger
 * /shares/installment/admin/pending-transactions:
 *   get:
 *     summary: Get transactions for admin review
 *     tags: [Installment - Admin]
 *     security:
 *       - adminAuth: []
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
 *         description: List of transactions retrieved successfully
 *       403:
 *         description: Unauthorized - Admin access required
 *       500:
 *         description: Server error
 */
router.get('/admin/pending-transactions', 
  adminProtect, 
  installmentController.adminGetPendingTransactions
);

/**
 * @swagger
 * /shares/installment/admin/transaction-details/{reference}:
 *   get:
 *     summary: Get detailed transaction information
 *     tags: [Installment - Admin]
 *     security:
 *       - adminAuth: []
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
 *         description: Detailed transaction information retrieved successfully
 *       403:
 *         description: Unauthorized - Admin access required
 *       404:
 *         description: Transaction not found
 *       500:
 *         description: Server error
 */
router.get('/admin/transaction-details/:reference', 
  adminProtect, 
  installmentController.adminGetTransactionDetails
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

module.exports = router;
 