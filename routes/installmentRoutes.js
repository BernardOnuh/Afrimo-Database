const express = require('express');
const router = express.Router();
const { protect, adminProtect } = require('../middleware/auth');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const installmentController = require('../controller/installmentController');

// Ensure upload directory exists
const uploadDir = 'uploads/payment_proofs/';
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Configure multer storage for payment proof images
const storage = multer.diskStorage({
  destination: function(req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function(req, file, cb) {
    // Generate a unique filename to prevent overwriting
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1E9)}`;
    cb(null, `installment_${uniqueSuffix}${path.extname(file.originalname)}`);
  }
});

// Advanced file filter with more robust validation
const fileFilter = (req, file, cb) => {
  // Allowed file types
  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'application/pdf'];
  const allowedExtensions = ['.jpeg', '.jpg', '.png', '.pdf'];

  // Check mime type
  const isMimeTypeValid = allowedTypes.includes(file.mimetype);
  
  // Check file extension
  const isExtensionValid = allowedExtensions.includes(path.extname(file.originalname).toLowerCase());

  if (isMimeTypeValid && isExtensionValid) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only JPEG, PNG, and PDF files are allowed.'), false);
  }
};

// Configure upload with enhanced options
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: { 
    fileSize: 5 * 1024 * 1024, // 5MB max file size
    files: 1 // Only one file at a time
  }
});

// Error handling middleware for multer
const handleMulterError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    // Multer-specific errors
    return res.status(400).json({
      success: false,
      message: err.message === 'File too large' 
        ? 'File size exceeds the maximum limit of 5MB' 
        : 'File upload error'
    });
  } else if (err) {
    // Other errors (like file type)
    return res.status(400).json({
      success: false,
      message: err.message || 'File upload failed'
    });
  }
  next();
};

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

// Create rate limiters - More generous for calculations
const calculateRateLimiter = createRateLimiter(50, 60 * 60 * 1000); // 50 requests per hour for calculations
const createInstallmentRateLimiter = createRateLimiter(5, 60 * 60 * 1000); // 5 requests per hour for plan creation
const paymentSubmissionRateLimiter = createRateLimiter(3, 24 * 60 * 60 * 1000); // 3 payment submissions per day

// ========== USER ROUTES (AUTHENTICATED) ==========

/**
 * @swagger
 * /api/installments/calculate:
 *   post:
 *     summary: Calculate installment plan
 *     description: Calculate installment payment schedule and terms for share purchases
 *     tags: [User - Installment Planning]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - totalAmount
 *               - numberOfInstallments
 *             properties:
 *               totalAmount:
 *                 type: number
 *                 minimum: 1000
 *                 description: Total amount to be paid in installments
 *                 example: 50000
 *               numberOfInstallments:
 *                 type: number
 *                 minimum: 2
 *                 maximum: 24
 *                 description: Number of installment payments
 *                 example: 6
 *               shareQuantity:
 *                 type: number
 *                 minimum: 1
 *                 description: Number of shares to purchase
 *                 example: 10
 *               interestRate:
 *                 type: number
 *                 minimum: 0
 *                 maximum: 30
 *                 description: Annual interest rate percentage (optional)
 *                 example: 5.5
 *               paymentFrequency:
 *                 type: string
 *                 enum: [monthly, quarterly, bi-annual]
 *                 default: monthly
 *                 description: Payment frequency
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
 *                 calculation:
 *                   type: object
 *                   properties:
 *                     totalAmount:
 *                       type: number
 *                       example: 50000
 *                     numberOfInstallments:
 *                       type: number
 *                       example: 6
 *                     installmentAmount:
 *                       type: number
 *                       description: Amount per installment
 *                       example: 8500
 *                     totalInterest:
 *                       type: number
 *                       example: 1000
 *                     totalPayable:
 *                       type: number
 *                       example: 51000
 *                     interestRate:
 *                       type: number
 *                       example: 5.5
 *                     paymentFrequency:
 *                       type: string
 *                       example: "monthly"
 *                 schedule:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       installmentNumber:
 *                         type: number
 *                       dueDate:
 *                         type: string
 *                         format: date
 *                       amount:
 *                         type: number
 *                       principalAmount:
 *                         type: number
 *                       interestAmount:
 *                         type: number
 *                       remainingBalance:
 *                         type: number
 *                 fees:
 *                   type: object
 *                   properties:
 *                     processingFee:
 *                       type: number
 *                     lateFee:
 *                       type: number
 *                     earlyPaymentDiscount:
 *                       type: number
 *       400:
 *         description: Invalid calculation parameters
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: Unauthorized
 *       429:
 *         description: Rate limit exceeded
 */
router.post('/calculate', 
  protect, 
  calculateRateLimiter,
  installmentController.validateInstallmentInput,
  installmentController.calculateInstallmentPlan
);

/**
 * @swagger
 * /api/installments/create:
 *   post:
 *     summary: Create installment plan
 *     description: Create and activate an installment payment plan for share purchases
 *     tags: [User - Installment Planning]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - totalAmount
 *               - numberOfInstallments
 *               - shareQuantity
 *             properties:
 *               totalAmount:
 *                 type: number
 *                 minimum: 1000
 *                 description: Total amount to be paid in installments
 *                 example: 50000
 *               numberOfInstallments:
 *                 type: number
 *                 minimum: 2
 *                 maximum: 24
 *                 description: Number of installment payments
 *                 example: 6
 *               shareQuantity:
 *                 type: number
 *                 minimum: 1
 *                 description: Number of shares to purchase
 *                 example: 10
 *               paymentFrequency:
 *                 type: string
 *                 enum: [monthly, quarterly, bi-annual]
 *                 default: monthly
 *                 description: Payment frequency
 *               startDate:
 *                 type: string
 *                 format: date
 *                 description: When installments should start (optional)
 *               metadata:
 *                 type: object
 *                 properties:
 *                   preferredPaymentMethod:
 *                     type: string
 *                     enum: [paystack, manual, web3]
 *                   notes:
 *                     type: string
 *                     maxLength: 500
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
 *                 message:
 *                   type: string
 *                 plan:
 *                   $ref: '#/components/schemas/InstallmentPlan'
 *                 nextPayment:
 *                   type: object
 *                   properties:
 *                     dueDate:
 *                       type: string
 *                       format: date
 *                     amount:
 *                       type: number
 *                     installmentNumber:
 *                       type: number
 *       400:
 *         description: Invalid plan data or user not eligible
 *       401:
 *         description: Unauthorized
 *       429:
 *         description: Rate limit exceeded
 */
router.post('/create', 
  protect, 
  createInstallmentRateLimiter,
  installmentController.validateInstallmentInput,
  installmentController.createInstallmentPlan
);

/**
 * @swagger
 * /api/installments/plans:
 *   get:
 *     summary: Get user's installment plans
 *     description: Retrieve all installment plans for the authenticated user
 *     tags: [User - Installment Management]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [active, completed, cancelled, overdue, all]
 *           default: all
 *         description: Filter by plan status
 *       - in: query
 *         name: includePayments
 *         schema:
 *           type: boolean
 *           default: true
 *         description: Include payment history
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
 *           maximum: 50
 *           default: 10
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
 *                 plans:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/InstallmentPlan'
 *                 summary:
 *                   type: object
 *                   properties:
 *                     totalPlans:
 *                       type: number
 *                     activePlans:
 *                       type: number
 *                     totalOutstanding:
 *                       type: number
 *                     nextPaymentDue:
 *                       type: string
 *                       format: date
 *                     totalPaidToDate:
 *                       type: number
 *                 pagination:
 *                   $ref: '#/components/schemas/Pagination'
 *       401:
 *         description: Unauthorized
 */
router.get('/plans', 
  protect, 
  installmentController.getUserInstallmentPlans
);

/**
 * @swagger
 * /api/installments/cancel:
 *   post:
 *     summary: Cancel installment plan
 *     description: Cancel an active installment plan with optional reason
 *     tags: [User - Installment Management]
 *     security:
 *       - BearerAuth: []
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
 *                 description: ID of the installment plan to cancel
 *               reason:
 *                 type: string
 *                 enum: [financial_hardship, changed_mind, found_alternative, other]
 *                 description: Reason for cancellation
 *               notes:
 *                 type: string
 *                 maxLength: 500
 *                 description: Additional cancellation notes
 *               requestRefund:
 *                 type: boolean
 *                 default: false
 *                 description: Whether to request refund of paid amounts
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
 *                 message:
 *                   type: string
 *                 plan:
 *                   $ref: '#/components/schemas/InstallmentPlan'
 *                 refundDetails:
 *                   type: object
 *                   properties:
 *                     eligible:
 *                       type: boolean
 *                     amount:
 *                       type: number
 *                     processingTime:
 *                       type: string
 *       400:
 *         description: Invalid plan ID or cancellation not allowed
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Plan not found
 */
router.post('/cancel', 
  protect, 
  createInstallmentRateLimiter,
  installmentController.cancelInstallmentPlan
);

// ========== PAYMENT ROUTES ==========

/**
 * @swagger
 * /api/installments/paystack/pay:
 *   post:
 *     summary: Pay installment with Paystack
 *     description: Initiate Paystack payment for an installment
 *     tags: [User - Installment Payments]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - planId
 *               - installmentNumber
 *               - email
 *             properties:
 *               planId:
 *                 type: string
 *                 description: ID of the installment plan
 *               installmentNumber:
 *                 type: number
 *                 minimum: 1
 *                 description: Which installment to pay
 *               email:
 *                 type: string
 *                 format: email
 *                 description: User's email for payment
 *               amount:
 *                 type: number
 *                 description: Payment amount (optional, defaults to scheduled amount)
 *               metadata:
 *                 type: object
 *                 properties:
 *                   paymentSource:
 *                     type: string
 *                     enum: [web, mobile, api]
 *     responses:
 *       200:
 *         description: Payment initiated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 paymentUrl:
 *                   type: string
 *                   description: Paystack payment URL
 *                 reference:
 *                   type: string
 *                   description: Payment reference
 *                 amount:
 *                   type: number
 *                   description: Amount in kobo/cents
 *                 expiresAt:
 *                   type: string
 *                   format: date-time
 *       400:
 *         description: Invalid payment request
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Plan or installment not found
 *       429:
 *         description: Payment rate limit exceeded
 */
router.post('/paystack/pay', 
  protect, 
  paymentSubmissionRateLimiter,
  installmentController.payInstallmentWithPaystack
);

/**
 * @swagger
 * /api/installments/paystack/verify:
 *   get:
 *     summary: Verify Paystack installment payment
 *     description: Verify and complete installment payment via Paystack
 *     tags: [User - Installment Payments]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: reference
 *         required: true
 *         schema:
 *           type: string
 *         description: Paystack payment reference
 *         example: "inst_ref_123456789"
 *       - in: query
 *         name: planId
 *         schema:
 *           type: string
 *         description: Installment plan ID for additional validation
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
 *                 message:
 *                   type: string
 *                 payment:
 *                   $ref: '#/components/schemas/InstallmentPayment'
 *                 plan:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                     remainingBalance:
 *                       type: number
 *                     nextPaymentDue:
 *                       type: string
 *                       format: date
 *                     status:
 *                       type: string
 *                 sharesAllocated:
 *                   type: number
 *                   description: Shares allocated if plan completed
 *       400:
 *         description: Payment verification failed
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Payment reference not found
 */
router.get('/paystack/verify', 
  protect, 
  installmentController.verifyInstallmentPaystack
);

/**
 * @swagger
 * /api/installments/manual/submit:
 *   post:
 *     summary: Submit manual installment payment
 *     description: Submit proof of manual payment (bank transfer, etc.) for installment
 *     tags: [User - Installment Payments]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - planId
 *               - installmentNumber
 *               - amount
 *               - paymentMethod
 *               - paymentProof
 *             properties:
 *               planId:
 *                 type: string
 *                 description: ID of the installment plan
 *               installmentNumber:
 *                 type: number
 *                 minimum: 1
 *                 description: Which installment is being paid
 *               amount:
 *                 type: number
 *                 description: Amount paid
 *               paymentMethod:
 *                 type: string
 *                 enum: [bank_transfer, mobile_money, cash_deposit, crypto, other]
 *                 description: Method of payment
 *               paymentProof:
 *                 type: string
 *                 format: binary
 *                 description: Payment proof image/document (JPEG, PNG, PDF, max 5MB)
 *               transactionReference:
 *                 type: string
 *                 description: Bank transaction reference or receipt number
 *               paymentDate:
 *                 type: string
 *                 format: date
 *                 description: Date when payment was made
 *               notes:
 *                 type: string
 *                 maxLength: 500
 *                 description: Additional payment notes
 *     responses:
 *       201:
 *         description: Manual payment submitted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 payment:
 *                   $ref: '#/components/schemas/InstallmentPayment'
 *                 verificationTimeline:
 *                   type: string
 *                   description: Expected verification timeframe
 *                   example: "1-3 business days"
 *       400:
 *         description: Invalid payment submission or file upload error
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Plan or installment not found
 *       413:
 *         description: File too large
 *       415:
 *         description: Unsupported file type
 *       429:
 *         description: Payment submission rate limit exceeded
 */
router.post('/manual/submit', 
  protect, 
  paymentSubmissionRateLimiter,
  upload.single('paymentProof'),
  handleMulterError,
  installmentController.submitManualInstallmentPayment
);

/**
 * @swagger
 * /api/installments/flexible/payment-proof/{transactionId}:
 *   get:
 *     summary: Get payment proof
 *     description: Retrieve payment proof document for a specific transaction
 *     tags: [User - Installment Payments]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: transactionId
 *         required: true
 *         schema:
 *           type: string
 *         description: Transaction ID for the payment proof
 *         example: "inst_txn_123456789"
 *     responses:
 *       200:
 *         description: Payment proof retrieved successfully
 *         content:
 *           image/jpeg:
 *             schema:
 *               type: string
 *               format: binary
 *           image/png:
 *             schema:
 *               type: string
 *               format: binary
 *           application/pdf:
 *             schema:
 *               type: string
 *               format: binary
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Access denied - not your transaction
 *       404:
 *         description: Payment proof not found
 */
router.get('/flexible/payment-proof/:transactionId', 
  protect, 
  installmentController.getFlexibleInstallmentPaymentProof
);

// ========== ADMIN ROUTES ==========

/**
 * @swagger
 * /api/installments/admin/plans:
 *   get:
 *     summary: Get all installment plans (Admin)
 *     description: Retrieve all installment plans across all users for admin review
 *     tags: [Admin - Installment Management]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [active, completed, cancelled, overdue, all]
 *           default: all
 *         description: Filter by plan status
 *       - in: query
 *         name: userId
 *         schema:
 *           type: string
 *         description: Filter by specific user ID
 *       - in: query
 *         name: dateFrom
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter plans created from this date
 *       - in: query
 *         name: dateTo
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter plans created until this date
 *       - in: query
 *         name: minAmount
 *         schema:
 *           type: number
 *         description: Minimum total plan amount
 *       - in: query
 *         name: maxAmount
 *         schema:
 *           type: number
 *         description: Maximum total plan amount
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
 *         name: sortBy
 *         schema:
 *           type: string
 *           enum: [createdAt, totalAmount, dueDate, userId]
 *           default: createdAt
 *       - in: query
 *         name: sortOrder
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *           default: desc
 *       - in: query
 *         name: exportFormat
 *         schema:
 *           type: string
 *           enum: [json, csv, excel]
 *           default: json
 *         description: Export format for admin reports
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
 *                 plans:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/InstallmentPlan'
 *                 summary:
 *                   type: object
 *                   properties:
 *                     totalPlans:
 *                       type: number
 *                     totalValue:
 *                       type: number
 *                     averagePlanSize:
 *                       type: number
 *                     overdueCount:
 *                       type: number
 *                     overdueAmount:
 *                       type: number
 *                 pagination:
 *                   $ref: '#/components/schemas/Pagination'
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 */
router.get('/admin/plans', 
  adminProtect, 
  installmentController.adminGetAllInstallmentPlans
);

/**
 * @swagger
 * /api/installments/admin/flexible/verify:
 *   post:
 *     summary: Verify manual installment payment (Admin)
 *     description: Admin verification of manual installment payments with proof documents
 *     tags: [Admin - Installment Payments]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - paymentId
 *               - status
 *             properties:
 *               paymentId:
 *                 type: string
 *                 description: ID of the payment to verify
 *               status:
 *                 type: string
 *                 enum: [approved, rejected]
 *                 description: Verification decision
 *               verificationNotes:
 *                 type: string
 *                 maxLength: 1000
 *                 description: Admin notes for verification decision
 *               adjustedAmount:
 *                 type: number
 *                 description: Adjusted amount if different from submitted
 *               allocateShares:
 *                 type: boolean
 *                 default: true
 *                 description: Whether to allocate shares if plan completes
 *               sendNotification:
 *                 type: boolean
 *                 default: true
 *                 description: Send notification to user
 *     responses:
 *       200:
 *         description: Payment verification completed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 payment:
 *                   $ref: '#/components/schemas/InstallmentPayment'
 *                 plan:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                     status:
 *                       type: string
 *                     remainingBalance:
 *                       type: number
 *                     completedInstallments:
 *                       type: number
 *                 sharesAllocated:
 *                   type: number
 *                   description: Number of shares allocated if plan completed
 *       400:
 *         description: Invalid verification data
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 *       404:
 *         description: Payment not found
 */
router.post('/admin/flexible/verify', 
  adminProtect, 
  installmentController.adminVerifyFlexibleInstallmentPayment
);

/**
 * @swagger
 * /api/installments/admin/check-late-payments:
 *   post:
 *     summary: Check for late payments (Admin)
 *     description: Run automated check for late installment payments and apply penalties
 *     tags: [Admin - Installment Management]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               gracePeriodDays:
 *                 type: number
 *                 minimum: 0
 *                 maximum: 30
 *                 default: 7
 *                 description: Grace period before marking as late
 *               applyPenalties:
 *                 type: boolean
 *                 default: true
 *                 description: Whether to apply late payment penalties
 *               sendNotifications:
 *                 type: boolean
 *                 default: true
 *                 description: Send late payment notifications to users
 *               penaltyPercentage:
 *                 type: number
 *                 minimum: 0
 *                 maximum: 10
 *                 default: 2
 *                 description: Late payment penalty percentage
 *               dryRun:
 *                 type: boolean
 *                 default: false
 *                 description: Preview results without applying changes
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
 *                 summary:
 *                   type: object
 *                   properties:
 *                     totalChecked:
 *                       type: number
 *                       description: Total active plans checked
 *                     latePayments:
 *                       type: number
 *                       description: Number of late payments found
 *                     penaltiesApplied:
 *                       type: number
 *                       description: Number of penalties applied
 *                     notificationsSent:
 *                       type: number
 *                       description: Number of notifications sent
 *                     totalPenaltyAmount:
 *                       type: number
 *                       description: Total penalty amount applied
 *                 latePayments:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       planId:
 *                         type: string
 *                       userId:
 *                         type: string
 *                       installmentNumber:
 *                         type: number
 *                       dueDate:
 *                         type: string
 *                         format: date
 *                       daysLate:
 *                         type: number
 *                       amount:
 *                         type: number
 *                       penaltyApplied:
 *                         type: number
 *                       status:
 *                         type: string
 *                 recommendations:
 *                   type: array
 *                   items:
 *                     type: string
 *                   description: System recommendations for managing late payments
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 */
router.post('/admin/check-late-payments', 
  adminProtect, 
  installmentController.checkLatePayments
);

// Note: Additional admin endpoints can be added when corresponding controller methods are implemented
// Examples: statistics, modify-plan, bulk-actions, etc.

// Additional error handling for file cleanup on failed uploads
router.use((err, req, res, next) => {
  // Clean up uploaded file if there was an error
  if (req.file && req.file.path) {
    fs.unlink(req.file.path, (unlinkErr) => {
      if (unlinkErr) {
        console.error('Error cleaning up uploaded file:', unlinkErr);
      }
    });
  }
  
  console.error('Route error:', err);
  res.status(500).json({
    success: false,
    message: 'An unexpected error occurred',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// ========== SWAGGER COMPONENTS ==========

/**
 * @swagger
 * components:
 *   schemas:
 *     InstallmentPlan:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           description: Unique plan identifier
 *         userId:
 *           type: string
 *           description: User who created the plan
 *         totalAmount:
 *           type: number
 *           description: Total amount to be paid
 *         numberOfInstallments:
 *           type: number
 *           description: Number of payment installments
 *         installmentAmount:
 *           type: number
 *           description: Amount per installment
 *         shareQuantity:
 *           type: number
 *           description: Number of shares being purchased
 *         interestRate:
 *           type: number
 *           description: Annual interest rate percentage
 *         paymentFrequency:
 *           type: string
 *           enum: [monthly, quarterly, bi-annual]
 *         status:
 *           type: string
 *           enum: [active, completed, cancelled, overdue, paused]
 *         startDate:
 *           type: string
 *           format: date
 *         endDate:
 *           type: string
 *           format: date
 *         nextPaymentDue:
 *           type: string
 *           format: date
 *         remainingBalance:
 *           type: number
 *         completedInstallments:
 *           type: number
 *         totalPaid:
 *           type: number
 *         lateFees:
 *           type: number
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 *         schedule:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               installmentNumber:
 *                 type: number
 *               dueDate:
 *                 type: string
 *                 format: date
 *               amount:
 *                 type: number
 *               status:
 *                 type: string
 *                 enum: [pending, paid, overdue, waived]
 *               paidDate:
 *                 type: string
 *                 format: date
 *               paidAmount:
 *                 type: number
 *         metadata:
 *           type: object
 *           properties:
 *             preferredPaymentMethod:
 *               type: string
 *             notes:
 *               type: string
 *             riskLevel:
 *               type: string
 *               enum: [low, medium, high]
 *     
 *     InstallmentPayment:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           description: Unique payment identifier
 *         planId:
 *           type: string
 *           description: Associated installment plan ID
 *         installmentNumber:
 *           type: number
 *           description: Which installment this payment covers
 *         amount:
 *           type: number
 *           description: Payment amount
 *         paymentMethod:
 *           type: string
 *           enum: [paystack, manual, web3, bank_transfer]
 *         status:
 *           type: string
 *           enum: [pending, completed, failed, cancelled, under_review]
 *         transactionReference:
 *           type: string
 *           description: External transaction reference
 *         paymentDate:
 *           type: string
 *           format: date-time
 *         verificationDate:
 *           type: string
 *           format: date-time
 *         verifiedBy:
 *           type: string
 *           description: Admin who verified manual payment
 *         paymentProofUrl:
 *           type: string
 *           description: URL to payment proof document
 *         notes:
 *           type: string
 *           description: Payment notes or admin comments
 *         fees:
 *           type: object
 *           properties:
 *             processing:
 *               type: number
 *             late:
 *               type: number
 *             total:
 *               type: number
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 * 
 *     Pagination:
 *       type: object
 *       properties:
 *         currentPage:
 *           type: number
 *         totalPages:
 *           type: number
 *         totalItems:
 *           type: number
 *         itemsPerPage:
 *           type: number
 *         hasNextPage:
 *           type: boolean
 *         hasPrevPage:
 *           type: boolean
 * 
 *     Error:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: false
 *         message:
 *           type: string
 *           description: Error message
 *         code:
 *           type: string
 *           description: Error code
 *         details:
 *           type: object
 *           description: Additional error details
 * 
 *   securitySchemes:
 *     BearerAuth:
 *       type: http
 *       scheme: bearer
 *       bearerFormat: JWT
 * 
 * tags:
 *   - name: User - Installment Planning
 *     description: Installment plan calculation and creation endpoints
 *   - name: User - Installment Management
 *     description: User installment plan management endpoints
 *   - name: User - Installment Payments
 *     description: Installment payment processing endpoints
 *   - name: Admin - Installment Management
 *     description: Administrative installment management endpoints
 *   - name: Admin - Installment Payments
 *     description: Administrative payment verification endpoints
 *   - name: Admin - Installment Reports
 *     description: Administrative reporting and analytics endpoints
 */

module.exports = router;