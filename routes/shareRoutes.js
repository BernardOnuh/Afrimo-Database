const express = require('express');
const router = express.Router();
const shareController = require('../controller/shareController');
const { protect, adminProtect } = require('../middleware/auth');
const upload = require('../middleware/upload');
const multer = require('multer');
const { 
  sharePaymentUpload, 
  logCloudinaryUpload, 
  handleCloudinaryError 
} = require('../config/cloudinary');

// Enhanced error handling middleware for multer
const validateManualPayment = (req, res, next) => {
  const { packageId, currency, paymentMethod } = req.body;

  if (!packageId || !currency || !paymentMethod) {
    return res.status(400).json({
      success: false,
      message: 'packageId, currency, and paymentMethod are required'
    });
  }

  if (!['naira', 'usdt'].includes(currency.toLowerCase())) {
    return res.status(400).json({ success: false, message: 'Currency must be naira or usdt' });
  }

  const validMethods = ['bank_transfer', 'cash', 'other'];
  if (!validMethods.includes(paymentMethod)) {
    return res.status(400).json({
      success: false,
      message: `paymentMethod must be one of: ${validMethods.join(', ')}`
    });
  }

  if (!req.file || !req.file.path) {
    return res.status(400).json({ success: false, message: 'Payment proof is required' });
  }

  next();
};

const requiredMethods = [
  'sendCertificateEmail',
  'checkPendingPayment', 
  'adminRevokeTransaction',
  // add others you're unsure about
];

requiredMethods.forEach(method => {
  if (!shareController[method]) {
    console.error(`❌ shareController.${method} is UNDEFINED`);
  }
});


/**
 * @swagger
 * components:
 *   schemas:
 *     ShareInfo:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: true
 *         pricing:
 *           type: object
 *           properties:
 *             tier1:
 *               type: object
 *               properties:
 *                 shares:
 *                   type: integer
 *                   example: 2000
 *                 priceNaira:
 *                   type: number
 *                   format: float
 *                   example: 50000
 *                 priceUSDT:
 *                   type: number
 *                   format: float
 *                   example: 50
 *             tier2:
 *               type: object
 *               properties:
 *                 shares:
 *                   type: integer
 *                   example: 3000
 *                 priceNaira:
 *                   type: number
 *                   format: float
 *                   example: 70000
 *                 priceUSDT:
 *                   type: number
 *                   format: float
 *                   example: 70
 *             tier3:
 *               type: object
 *               properties:
 *                 shares:
 *                   type: integer
 *                   example: 5000
 *                 priceNaira:
 *                   type: number
 *                   format: float
 *                   example: 80000
 *                 priceUSDT:
 *                   type: number
 *                   format: float
 *                   example: 80
 *         availability:
 *           type: object
 *           properties:
 *             tier1:
 *               type: integer
 *               example: 1889
 *             tier2:
 *               type: integer
 *               example: 3000
 *             tier3:
 *               type: integer
 *               example: 5000
 *         totalAvailable:
 *           type: integer
 *           example: 9889
 *
 *     Transaction:
 *       type: object
 *       properties:
 *         transactionId:
 *           type: string
 *           example: "TXN-A1B2-123456"
 *         shares:
 *           type: integer
 *           example: 50
 *         pricePerShare:
 *           type: number
 *           format: float
 *           example: 1000.50
 *         currency:
 *           type: string
 *           enum: [naira, usdt]
 *           example: "naira"
 *         totalAmount:
 *           type: number
 *           format: float
 *           example: 50025.00
 *         paymentMethod:
 *           type: string
 *           enum: [paystack, crypto, web3, manual_bank_transfer, manual_cash, manual_other]
 *           example: "paystack"
 *         status:
 *           type: string
 *           enum: [pending, completed, failed]
 *           example: "completed"
 *         tierBreakdown:
 *           type: object
 *           properties:
 *             tier1:
 *               type: integer
 *               example: 30
 *             tier2:
 *               type: integer
 *               example: 20
 *             tier3:
 *               type: integer
 *               example: 0
 *         txHash:
 *           type: string
 *           example: "0x1234567890abcdef..."
 *         paymentProofPath:
 *           type: string
 *           example: "uploads/payment-proofs/payment-1234567890.jpg"
 *         manualPaymentDetails:
 *           type: object
 *           properties:
 *             bankName:
 *               type: string
 *               example: "First Bank"
 *             accountName:
 *               type: string
 *               example: "John Doe"
 *             reference:
 *               type: string
 *               example: "FBN12345678"
 *         adminAction:
 *           type: boolean
 *           example: false
 *         adminNote:
 *           type: string
 *           example: "Transaction verified manually"
 *         createdAt:
 *           type: string
 *           format: date-time
 *           example: "2024-01-15T10:30:00Z"
 */

// ─── Public Routes ────────────────────────────────────────────────────────────

/**
 * @swagger
 * /shares/info:
 *   get:
 *     tags: [Shares - Public]
 *     summary: Get share information
 *     description: Get current share pricing and availability information
 *     responses:
 *       200:
 *         description: Share information retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ShareInfo'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/info', shareController.getShareInfo);

/**
 * @swagger
 * /shares/calculate:
 *   post:
 *     tags: [Shares - Public]
 *     summary: Calculate purchase amount
 *     description: Calculate total amount for specified number of shares in the selected currency
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
 *                 example: 50
 *               currency:
 *                 type: string
 *                 enum: [naira, usdt]
 *                 example: "naira"
 *     responses:
 *       200:
 *         description: Purchase calculation successful
 *       400:
 *         description: Bad Request - Invalid quantity or currency
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/calculate', shareController.calculatePurchase);

/**
 * @swagger
 * /shares/payment-config:
 *   get:
 *     tags: [Shares - Public]
 *     summary: Get payment configuration
 *     description: Get available payment methods and their configurations
 *     responses:
 *       200:
 *         description: Payment configuration retrieved successfully
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/payment-config', shareController.getPaymentConfig);


router.get('/user/shares', protect, shareController.getUserShares);

// ─── Manual Payment Routes ────────────────────────────────────────────────────

/**
 * @swagger
 * /shares/manual/submit:
 *   post:
 *     tags: [Shares - Manual Payment]
 *     summary: Submit manual payment with Cloudinary
 *     description: Submit a manual payment with proof stored in Cloudinary CDN.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - quantity
 *               - currency
 *               - paymentMethod
 *               - paymentProof
 *             properties:
 *               quantity:
 *                 type: integer
 *                 minimum: 1
 *                 example: 50
 *               currency:
 *                 type: string
 *                 enum: [naira, usdt]
 *                 example: "naira"
 *               paymentMethod:
 *                 type: string
 *                 enum: [bank_transfer, cash, other]
 *                 example: "bank_transfer"
 *               bankName:
 *                 type: string
 *                 example: "First Bank of Nigeria"
 *               accountName:
 *                 type: string
 *                 example: "John Doe"
 *               reference:
 *                 type: string
 *                 example: "FBN123456789"
 *               paymentProof:
 *                 type: string
 *                 format: binary
 *                 description: Payment proof image/PDF (max 5MB)
 *     responses:
 *       200:
 *         description: Manual payment submitted successfully
 *       400:
 *         description: Validation error
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/manual/submit', 
  protect,
  sharePaymentUpload.single('paymentProof'),
  logCloudinaryUpload,
  handleCloudinaryError,
  validateManualPayment,
  shareController.submitManualPayment
);

/**
 * @swagger
 * /shares/payment-proof/{transactionId}:
 *   get:
 *     tags: [Shares - Manual Payment]
 *     summary: Get payment proof from Cloudinary
 *     description: Retrieve payment proof image from Cloudinary CDN for a transaction.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: transactionId
 *         required: true
 *         schema:
 *           type: string
 *         example: "TXN-A1B2-123456"
 *     responses:
 *       200:
 *         description: Payment proof URL retrieved successfully
 *       302:
 *         description: Redirect to Cloudinary URL
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         description: Access denied
 *       404:
 *         description: Transaction or file not found
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/payment-proof/:transactionId', protect, shareController.getPaymentProof);

// ─── Admin Routes ─────────────────────────────────────────────────────────────

/**
 * @swagger
 * /shares/admin/payment-proof/{transactionId}:
 *   get:
 *     tags: [Shares - Admin]
 *     summary: Direct admin access to payment proof file
 *     description: Redirects directly to the Cloudinary CDN URL for fast file viewing.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: transactionId
 *         required: true
 *         schema:
 *           type: string
 *         example: "TXN-A1B2C3D4-123456"
 *     responses:
 *       302:
 *         description: Redirect to Cloudinary CDN URL
 *       403:
 *         description: Access denied
 *       404:
 *         description: Payment proof not found
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/admin/payment-proof/:transactionId', protect, adminProtect, shareController.getPaymentProofDirect);





/**
 * @swagger
 * /shares/admin/update-pricing:
 *   post:
 *     tags: [Shares - Admin]
 *     summary: Update share pricing
 *     description: Update the current share price for a specific tier (admin only)
 *     security:
 *       - adminAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - tier
 *             properties:
 *               tier:
 *                 type: string
 *                 enum: [tier1, tier2, tier3]
 *                 example: "tier1"
 *               priceNaira:
 *                 type: number
 *                 format: float
 *                 minimum: 0.01
 *                 example: 52000.00
 *               priceUSDT:
 *                 type: number
 *                 format: float
 *                 minimum: 0.01
 *                 example: 52.00
 *               effectiveDate:
 *                 type: string
 *                 format: date-time
 *                 example: "2024-02-01T00:00:00Z"
 *               reason:
 *                 type: string
 *                 example: "Market adjustment"
 *     responses:
 *       200:
 *         description: Share pricing updated successfully
 *       400:
 *         description: Missing tier or price updates
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/admin/update-pricing', protect, adminProtect, shareController.updateSharePricing);

/**
 * @swagger
 * /shares/admin/add-shares:
 *   post:
 *     tags: [Shares - Admin]
 *     summary: Add shares to user
 *     description: Add shares directly to a user's account (admin only)
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
 *               - shares
 *             properties:
 *               userId:
 *                 type: string
 *                 example: "60f7c6b4c8f1a2b3c4d5e6f7"
 *               shares:
 *                 type: integer
 *                 minimum: 1
 *                 example: 100
 *               note:
 *                 type: string
 *                 example: "Bonus shares for early investor"
 *     responses:
 *       200:
 *         description: Shares added successfully
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       404:
 *         description: User not found
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/admin/add-shares', protect, adminProtect, shareController.adminAddShares);

/**
 * @swagger
 * /shares/admin/update-wallet:
 *   post:
 *     tags: [Shares - Admin]
 *     summary: Update company wallet
 *     description: Update the company's Web3 wallet address (admin only)
 *     security:
 *       - adminAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - walletAddress
 *             properties:
 *               walletAddress:
 *                 type: string
 *                 example: "0x742d35Cc6643C673532925e2aC5c48C0F30A37a0"
 *               reason:
 *                 type: string
 *                 example: "Security update"
 *     responses:
 *       200:
 *         description: Wallet address updated successfully
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/admin/update-wallet', protect, adminProtect, shareController.updateCompanyWallet);

/**
 * @swagger
 * /shares/admin/transactions:
 *   get:
 *     tags: [Shares - Admin]
 *     summary: Get all transactions
 *     description: Get all share transactions across all payment methods (admin only)
 *     security:
 *       - adminAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *       - in: query
 *         name: paymentMethod
 *         schema:
 *           type: string
 *           enum: [paystack, crypto, web3, manual_bank_transfer, manual_cash, manual_other]
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, completed, failed]
 *       - in: query
 *         name: fromDate
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: toDate
 *         schema:
 *           type: string
 *           format: date
 *     responses:
 *       200:
 *         description: Transactions retrieved successfully
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/admin/transactions', protect, adminProtect, shareController.getAllTransactions);

/**
 * @swagger
 * /shares/admin/statistics:
 *   get:
 *     tags: [Shares - Admin]
 *     summary: Get share statistics
 *     description: Get comprehensive share and transaction statistics (admin only)
 *     security:
 *       - adminAuth: []
 *     responses:
 *       200:
 *         description: Statistics retrieved successfully
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/admin/statistics', protect, adminProtect, shareController.getShareStatistics);

// ─── Admin Manual Payment Routes ──────────────────────────────────────────────

/**
 * @swagger
 * /shares/admin/manual/verify:
 *   post:
 *     tags: [Shares - Admin Manual Payment]
 *     summary: Verify manual payment
 *     description: Approve or reject a manual payment transaction (admin only)
 *     security:
 *       - adminAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - transactionId
 *               - approved
 *             properties:
 *               transactionId:
 *                 type: string
 *                 example: "TXN-A1B2-123456"
 *               approved:
 *                 type: boolean
 *                 example: true
 *               adminNote:
 *                 type: string
 *                 example: "Payment verified through bank statement"
 *     responses:
 *       200:
 *         description: Manual payment verification updated successfully
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
router.post('/admin/manual/verify', protect, adminProtect, shareController.adminVerifyManualPayment);

/**
 * @swagger
 * /shares/admin/manual/transactions:
 *   get:
 *     tags: [Shares - Admin Manual Payment]
 *     summary: Get manual payment transactions
 *     description: Get all manual payment transactions (admin only)
 *     security:
 *       - adminAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, completed, failed]
 *       - in: query
 *         name: fromDate
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: toDate
 *         schema:
 *           type: string
 *           format: date
 *     responses:
 *       200:
 *         description: Manual payment transactions retrieved successfully
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/admin/manual/transactions', protect, adminProtect, shareController.adminGetManualTransactions);

/**
 * @swagger
 * /shares/admin/manual/cancel:
 *   post:
 *     tags: [Shares - Admin Manual Payment]
 *     summary: Cancel manual payment
 *     description: Cancel a completed manual payment transaction (admin only)
 *     security:
 *       - adminAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - transactionId
 *             properties:
 *               transactionId:
 *                 type: string
 *                 example: "TXN-A1B2-123456"
 *               cancelReason:
 *                 type: string
 *                 example: "Duplicate transaction detected"
 *     responses:
 *       200:
 *         description: Manual payment cancelled successfully
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
router.post('/admin/manual/cancel', protect, adminProtect, shareController.adminCancelManualPayment);

/**
 * @swagger
 * /shares/admin/manual/{transactionId}:
 *   delete:
 *     tags: [Shares - Admin Manual Payment]
 *     summary: Delete manual payment transaction
 *     description: Permanently delete a manual payment transaction (admin only)
 *     security:
 *       - adminAuth: []
 *     parameters:
 *       - in: path
 *         name: transactionId
 *         required: true
 *         schema:
 *           type: string
 *         example: "TXN-A1B2-123456"
 *     responses:
 *       200:
 *         description: Manual payment transaction deleted successfully
 *       400:
 *         description: Missing transaction ID
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       404:
 *         description: Transaction not found
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.delete('/admin/manual/:transactionId', protect, adminProtect, shareController.adminDeleteManualPayment);



router.get('/transactions/:transactionId/status', protect, shareController.getTransactionStatus);

/**
 * @swagger
 * /shares/transactions/{transactionId}/details:
 *   get:
 *     tags: [Shares - Transaction Status]
 *     summary: Get Detailed Transaction Information
 *     description: Get comprehensive transaction details including user info, payment specifics, and method-specific data.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: transactionId
 *         required: true
 *         schema:
 *           type: string
 *         example: "TXN-A1B2C3D4-123456"
 *     responses:
 *       200:
 *         description: Transaction details retrieved successfully
 *       403:
 *         description: Access denied
 *       404:
 *         description: Transaction not found
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/transactions/:transactionId/details', protect, shareController.getTransactionDetails);

// ─── Admin Centiiv Management Routes ─────────────────────────────────────────



// ─── Admin Reports ────────────────────────────────────────────────────────────

/**
 * @swagger
 * /shares/admin/purchase-report:
 *   get:
 *     tags: [Shares - Admin Reports]
 *     summary: Get share purchase report
 *     description: Get detailed report of share purchases with date range filtering (admin only)
 *     security:
 *       - adminAuth: []
 *     parameters:
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *           example: "2024-01-01"
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *           example: "2024-12-31"
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, completed, failed]
 *           default: completed
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           maximum: 200
 *           default: 50
 *       - in: query
 *         name: sortBy
 *         schema:
 *           type: string
 *           enum: [date, amount, shares, name]
 *           default: date
 *       - in: query
 *         name: sortOrder
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *           default: desc
 *     responses:
 *       200:
 *         description: Share purchase report generated successfully
 *       400:
 *         description: Invalid date format or parameters
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/admin/purchase-report', protect, adminProtect, shareController.getSharePurchaseReport);

// ─── Admin User Management Routes ────────────────────────────────────────────

/**
 * @swagger
 * /shares/admin/user-overview/{identifier}:
 *   get:
 *     tags: [Shares - Admin User Management]
 *     summary: Get comprehensive user share overview
 *     description: |
 *       Get complete user share information using ID, username, or email.
 *       Accepts MongoDB User ID (24-char hex), username, or email address.
 *     security:
 *       - adminAuth: []
 *     parameters:
 *       - in: path
 *         name: identifier
 *         required: true
 *         schema:
 *           type: string
 *         description: User ID, username, or email
 *         example: "johndoe"
 *     responses:
 *       200:
 *         description: User overview retrieved successfully
 *       404:
 *         description: User not found
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/admin/user-overview/:identifier', protect, adminProtect, shareController.adminGetUserOverview);

// ─── Admin Debug Routes ───────────────────────────────────────────────────────
// NOTE: These use :identifier which accepts User ID, username, or email.


// ─── Misc Routes ──────────────────────────────────────────────────────────────

/**
 * @swagger
 * /shares/certificate/email:
 *   post:
 *     tags: [Shares - User]
 *     summary: Send share certificate to user email
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Certificate sent successfully
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/certificate/email', protect, shareController.sendCertificateEmail);

/**
 * @swagger
 * /shares/admin/revoke/{transactionId}:
 *   delete:
 *     tags: [Shares - Admin]
 *     summary: Revoke any transaction (complete rollback)
 *     security:
 *       - adminAuth: []
 *     parameters:
 *       - in: path
 *         name: transactionId
 *         required: true
 *         schema:
 *           type: string
 *         example: "TXN-A1B2-123456"
 *     responses:
 *       200:
 *         description: Transaction revoked successfully
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       404:
 *         description: Transaction not found
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.delete('/admin/revoke/:transactionId', protect, adminProtect, shareController.adminRevokeTransaction);

/**
 * @swagger
 * /shares/user/pending-payment:
 *   get:
 *     tags: [Shares - User]
 *     summary: Check if user has a pending manual payment
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Pending payment status retrieved
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/user/pending-payment', protect, shareController.checkPendingPayment);


router.post('/admin/create-tier', protect, adminProtect, shareController.createTier);
router.delete('/admin/delete-tier/:tier', protect, adminProtect, shareController.deleteTier);
router.put('/admin/user/:userId/shares', protect, adminProtect, shareController.adminUpdateUserShares);
router.put('/admin/transaction/:transactionId', protect, adminProtect, shareController.adminEditTransaction);

module.exports = router;
// GET /api/shares/user/earnings-summary
router.get('/user/earnings-summary', protect, async (req, res) => {
  try {
    const UserShare = require('../models/UserShare');
    const breakdown = await UserShare.getUserBreakdown(req.user.id);

    res.json({
      success: true,
      totalEarningKobo: breakdown.totalEarningKobo,
      totalOwnershipPct: breakdown.totalOwnershipPct,
      formattedOwnership: breakdown.formattedOwnership,
      breakdown: {
        share: breakdown.regular,
        cofounder: breakdown.cofounder
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/shares/user/earnings-summary-OLD-REPLACED
router.get('/user/earnings-summary-disabled', protect, async (req, res) => {
  try {
    const PaymentTransaction = require('../models/Transaction');

    const transactions = await PaymentTransaction.find({
      userId: req.user.id,
      status: 'completed'
    }).lean();

    let totalEarnings = 0;
    let totalOwnershipPct = 0;

    transactions.forEach(t => {
      const earning = (t.earningKobo || 0) * (t.shares || 0);
      const ownership = (t.ownershipPct || 0) * (t.shares || 0);
      totalEarnings += earning;
      totalOwnershipPct += ownership;
    });

    res.json({
      success: true,
      totalEarnings,
      totalOwnershipPct,
      formattedOwnership: totalOwnershipPct.toFixed(7) + '%'
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});
