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
  console.log('\n=== VALIDATION MIDDLEWARE (CLOUDINARY) ===');
  console.log('Body:', req.body);
  console.log('File:', req.file);
  
  const { quantity, currency, paymentMethod } = req.body;
  
  if (!quantity || !currency || !paymentMethod) {
    console.log('Missing required fields');
    return res.status(400).json({
      success: false,
      message: 'Missing required fields: quantity, currency, and paymentMethod are required',
      error: 'MISSING_FIELDS',
      received: {
        quantity: !!quantity,
        currency: !!currency,
        paymentMethod: !!paymentMethod,
        file: !!req.file
      }
    });
  }
  
  const qty = parseInt(quantity);
  if (isNaN(qty) || qty < 1) {
    return res.status(400).json({
      success: false,
      message: 'Invalid quantity. Must be a positive integer.',
      error: 'INVALID_QUANTITY'
    });
  }
  
  if (!['naira', 'usdt'].includes(currency.toLowerCase())) {
    return res.status(400).json({
      success: false,
      message: 'Invalid currency. Must be either "naira" or "usdt".',
      error: 'INVALID_CURRENCY'
    });
  }
  
  const validPaymentMethods = ['bank_transfer', 'cash', 'other'];
  if (!validPaymentMethods.includes(paymentMethod)) {
    return res.status(400).json({
      success: false,
      message: `Invalid payment method. Must be one of: ${validPaymentMethods.join(', ')}`,
      error: 'INVALID_PAYMENT_METHOD'
    });
  }
  
  if (!req.file || !req.file.path) {
    return res.status(400).json({
      success: false,
      message: 'Payment proof image is required and must be uploaded successfully',
      error: 'MISSING_CLOUDINARY_FILE'
    });
  }
  
  console.log('Validation passed - Cloudinary file uploaded successfully');
  console.log('Cloudinary URL:', req.file.path);
  console.log('Public ID:', req.file.filename);
  console.log('============================\n');
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

/**
 * @swagger
 * /shares/centiiv/webhook:
 *   post:
 *     tags: [Shares - Payment]
 *     summary: Centiiv webhook endpoint
 *     description: Handle payment status updates from Centiiv (no authentication required)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               orderId:
 *                 type: string
 *                 example: "ord_1234567890"
 *               status:
 *                 type: string
 *                 enum: [paid, completed, cancelled, expired, pending]
 *                 example: "paid"
 *               amount:
 *                 type: number
 *                 example: 50000
 *               customerEmail:
 *                 type: string
 *                 format: email
 *                 example: "user@example.com"
 *               metadata:
 *                 type: object
 *     responses:
 *       200:
 *         description: Webhook processed successfully
 *       404:
 *         description: Transaction not found
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/centiiv/webhook', shareController.handleCentiivWebhook);

/**
 * @swagger
 * /shares/web3/verify:
 *   post:
 *     tags: [Shares - Payment]
 *     summary: Verify Web3 transaction
 *     description: Verify a blockchain transaction for share purchase
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
 *               - txHash
 *               - walletAddress
 *             properties:
 *               quantity:
 *                 type: integer
 *                 example: 50
 *               txHash:
 *                 type: string
 *                 example: "0x1234567890abcdef..."
 *               walletAddress:
 *                 type: string
 *                 example: "0x742d35Cc6643C673532925e2aC5c48C0F30A37a0"
 *     responses:
 *       200:
 *         description: Web3 transaction verified successfully
 *       400:
 *         description: Bad Request
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/web3/verify', protect, shareController.verifyWeb3Transaction);

/**
 * @swagger
 * /shares/user/shares:
 *   get:
 *     tags: [Shares - User]
 *     summary: Get user's shares
 *     description: Get current user's share holdings and transaction history
 *     security:
 *       - bearerAuth: []
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
 *           default: 10
 *     responses:
 *       200:
 *         description: User shares retrieved successfully
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
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
 * /shares/admin/centiiv/order/{orderId}:
 *   get:
 *     tags: [Shares - Admin]
 *     summary: Get Centiiv order status
 *     description: Fetch the current status of a Centiiv order (admin only)
 *     security:
 *       - adminAuth: []
 *     parameters:
 *       - in: path
 *         name: orderId
 *         required: true
 *         schema:
 *           type: string
 *         example: "ord_1234567890"
 *     responses:
 *       200:
 *         description: Order status retrieved successfully
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       404:
 *         description: Order not found
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/admin/centiiv/order/:orderId', protect, adminProtect, shareController.getCentiivOrderStatus);

/**
 * @swagger
 * /shares/admin/centiiv/verify:
 *   post:
 *     tags: [Shares - Admin]
 *     summary: Admin verify Centiiv payment
 *     description: Manually verify a Centiiv payment transaction (admin only)
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
 *                 example: "Payment verified through Centiiv dashboard"
 *     responses:
 *       200:
 *         description: Centiiv payment verification updated successfully
 *       400:
 *         description: Transaction already processed or invalid
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       404:
 *         description: Transaction not found
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/admin/centiiv/verify', protect, adminProtect, shareController.adminVerifyCentiivPayment);

/**
 * @swagger
 * /shares/admin/centiiv/transactions:
 *   get:
 *     tags: [Shares - Admin]
 *     summary: Get Centiiv transactions
 *     description: Get all Centiiv payment transactions with filtering options (admin only)
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
 *         description: Centiiv transactions retrieved successfully
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/admin/centiiv/transactions', protect, adminProtect, shareController.adminGetCentiivTransactions);

/**
 * @swagger
 * /shares/admin/web3/verify:
 *   post:
 *     tags: [Shares - Admin]
 *     summary: Admin verify Web3 transaction
 *     description: Manually verify a Web3 transaction (admin only)
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
 *                 example: "Transaction verified manually"
 *     responses:
 *       200:
 *         description: Transaction status updated successfully
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
router.post('/admin/web3/verify', protect, adminProtect, shareController.adminVerifyWeb3Transaction);

/**
 * @swagger
 * /shares/admin/web3/transactions:
 *   get:
 *     tags: [Shares - Admin]
 *     summary: Get Web3 transactions
 *     description: Get all Web3 transactions (admin only)
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
 *     responses:
 *       200:
 *         description: Web3 transactions retrieved successfully
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/admin/web3/transactions', protect, adminProtect, shareController.adminGetWeb3Transactions);

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

// ─── Centiiv Payment Routes ───────────────────────────────────────────────────

/**
 * @swagger
 * /shares/centiiv/direct-pay:
 *   post:
 *     tags: [Shares - Centiiv Payment]
 *     summary: Initiate Centiiv Direct Pay for Share Purchase
 *     description: Creates a direct payment link using Centiiv's Direct Pay API.
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
 *             properties:
 *               quantity:
 *                 type: integer
 *                 minimum: 1
 *                 maximum: 10000
 *                 example: 1
 *               note:
 *                 type: string
 *                 maxLength: 200
 *                 example: "My AfriMobile share purchase"
 *     responses:
 *       200:
 *         description: Payment link created successfully
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
 *                   example: "Centiiv Direct Pay initiated successfully"
 *                 data:
 *                   type: object
 *                   properties:
 *                     transactionId:
 *                       type: string
 *                       example: "TXN-6FDB4A4F-553414"
 *                     paymentId:
 *                       type: string
 *                       example: "69f3fb"
 *                     paymentUrl:
 *                       type: string
 *                       example: "https://centiiv.com/pay?id=69f3fb&type=payment_link"
 *                     amount:
 *                       type: number
 *                       example: 50000.00
 *                     shares:
 *                       type: integer
 *                       example: 1
 *                     redirectTo:
 *                       type: string
 *                       example: "https://centiiv.com/pay?id=69f3fb&type=payment_link"
 *       400:
 *         description: Invalid request parameters
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/centiiv/direct-pay', protect, shareController.initiateCentiivDirectPay);

/**
 * @swagger
 * /shares/centiiv/callback:
 *   get:
 *     tags: [Shares - Centiiv Payment]
 *     summary: Centiiv payment callback handler
 *     description: Handles payment status callbacks from Centiiv after payment completion.
 *     parameters:
 *       - in: query
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         example: "f9ab6f"
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *         example: "invoice"
 *       - in: query
 *         name: status
 *         required: true
 *         schema:
 *           type: string
 *           enum: [success, failed, cancelled]
 *         example: "success"
 *       - in: query
 *         name: payment_method
 *         schema:
 *           type: string
 *         example: "bank_transfer"
 *       - in: query
 *         name: transaction
 *         schema:
 *           type: string
 *         example: "TXN-A1B2C3D4-123456"
 *     responses:
 *       302:
 *         description: Redirect to success page
 *       200:
 *         description: Callback processed
 *       404:
 *         description: Transaction not found
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/centiiv/callback', shareController.handleCentiivCallback);

/**
 * @swagger
 * /shares/centiiv/crypto-pay:
 *   post:
 *     tags: [Shares - Centiiv Payment]
 *     summary: Initiate Centiiv Crypto Payment
 *     description: Generate crypto payment instructions for share purchase.
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
 *               - walletAddress
 *             properties:
 *               quantity:
 *                 type: integer
 *                 minimum: 1
 *                 example: 50
 *               currency:
 *                 type: string
 *                 enum: [usdt, busd]
 *                 default: usdt
 *                 example: "usdt"
 *               walletAddress:
 *                 type: string
 *                 example: "0x742d35Cc6643C673532925e2aC5c48C0F30A37a0"
 *     responses:
 *       200:
 *         description: Crypto payment instructions generated
 *       400:
 *         description: Crypto payments not available or invalid parameters
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/centiiv/crypto-pay', protect, shareController.initiateCentiivCryptoPay);

/**
 * @swagger
 * /shares/centiiv/crypto-verify:
 *   post:
 *     tags: [Shares - Centiiv Payment]
 *     summary: Submit Crypto Transaction Hash
 *     description: Submit blockchain transaction hash for verification after making crypto payment.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - transactionId
 *               - txHash
 *             properties:
 *               transactionId:
 *                 type: string
 *                 example: "TXN-A1B2C3D4-123456"
 *               txHash:
 *                 type: string
 *                 example: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef"
 *     responses:
 *       200:
 *         description: Transaction hash submitted successfully
 *       400:
 *         description: Invalid transaction ID or hash
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       404:
 *         description: Transaction not found
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/centiiv/crypto-verify', protect, shareController.submitCryptoTransactionHash);

/**
 * @swagger
 * /shares/centiiv/status/{paymentId}:
 *   get:
 *     tags: [Shares - Centiiv Payment]
 *     summary: Get Centiiv Payment Status
 *     description: Get current status of a Centiiv payment with real-time updates.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: paymentId
 *         required: true
 *         schema:
 *           type: string
 *         example: "f9ab6f"
 *     responses:
 *       200:
 *         description: Payment status retrieved successfully
 *       403:
 *         description: Access denied
 *       404:
 *         description: Payment not found
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/centiiv/status/:paymentId', protect, shareController.getCentiivPaymentStatus);

// ─── Transaction Status Routes ────────────────────────────────────────────────

/**
 * @swagger
 * /shares/transactions/{transactionId}/status:
 *   get:
 *     tags: [Shares - Transaction Status]
 *     summary: Get Transaction Status
 *     description: Get current status of any transaction (Centiiv, PayStack, Web3, Manual, etc.)
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
 *         description: Transaction status retrieved successfully
 *       403:
 *         description: Access denied
 *       404:
 *         description: Transaction not found
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
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

/**
 * @swagger
 * /shares/admin/centiiv/overview:
 *   get:
 *     tags: [Shares - Admin Centiiv Management]
 *     summary: Complete Centiiv Payment Overview (Admin)
 *     description: View all Centiiv payment activities, workflows, and statuses across the entire project.
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
 *           default: 50
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, completed, failed, verifying]
 *       - in: query
 *         name: paymentType
 *         schema:
 *           type: string
 *           enum: [centiiv, centiiv-direct, centiiv-crypto, centiiv-invoice]
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
 *       - in: query
 *         name: sortBy
 *         schema:
 *           type: string
 *           enum: [date, amount, status, paymentType]
 *           default: date
 *       - in: query
 *         name: sortOrder
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *           default: desc
 *     responses:
 *       200:
 *         description: Centiiv overview data retrieved successfully
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/admin/centiiv/overview', protect, adminProtect, shareController.adminGetCentiivOverview);

/**
 * @swagger
 * /shares/admin/centiiv/analytics:
 *   get:
 *     tags: [Shares - Admin Centiiv Management]
 *     summary: Centiiv Analytics Dashboard Data
 *     description: Get detailed analytics and metrics for all Centiiv payment methods.
 *     security:
 *       - adminAuth: []
 *     parameters:
 *       - in: query
 *         name: period
 *         schema:
 *           type: string
 *           enum: [7d, 30d, 90d, 365d, all]
 *           default: 30d
 *       - in: query
 *         name: groupBy
 *         schema:
 *           type: string
 *           enum: [day, week, month]
 *           default: day
 *     responses:
 *       200:
 *         description: Analytics data retrieved successfully
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/admin/centiiv/analytics', protect, adminProtect, shareController.getCentiivAnalytics);

/**
 * @swagger
 * /shares/admin/centiiv/troubleshoot:
 *   post:
 *     tags: [Shares - Admin Centiiv Management]
 *     summary: Troubleshoot Centiiv Payment Issues
 *     description: Diagnose and resolve payment issues automatically.
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
 *             properties:
 *               action:
 *                 type: string
 *                 enum: [check_status, retry_callback, force_sync, resend_notification, fix_stuck, generate_report]
 *                 example: "check_status"
 *               transactionId:
 *                 type: string
 *                 example: "TXN-A1B2C3D4-123456"
 *               paymentId:
 *                 type: string
 *                 example: "f9ab6f"
 *               bulkTransactionIds:
 *                 type: array
 *                 items:
 *                   type: string
 *                 example: ["TXN-A1B2-123456", "TXN-C3D4-789012"]
 *     responses:
 *       200:
 *         description: Troubleshooting action completed successfully
 *       400:
 *         description: Invalid troubleshooting parameters
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       404:
 *         description: Transaction not found
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/admin/centiiv/troubleshoot', protect, adminProtect, shareController.troubleshootCentiivPayment);

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

/**
 * @swagger
 * /shares/admin/debug-transactions/{identifier}:
 *   get:
 *     tags: [Shares - Admin Debug]
 *     summary: Debug user transaction statuses
 *     description: Analyze user transactions for status mismatches and issues. Accepts User ID, username, or email.
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
 *         description: Debug analysis completed successfully
 *       404:
 *         description: User not found
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/admin/debug-transactions/:identifier', protect, adminProtect, shareController.debugUserTransactions);

/**
 * @swagger
 * /shares/admin/fix-transaction-statuses/{identifier}:
 *   post:
 *     tags: [Shares - Admin Debug]
 *     summary: Fix user transaction status mismatches
 *     description: Synchronize transaction statuses between UserShare and PaymentTransaction models. Accepts User ID, username, or email.
 *     security:
 *       - adminAuth: []
 *     parameters:
 *       - in: path
 *         name: identifier
 *         required: true
 *         schema:
 *           type: string
 *         description: User ID, username, or email
 *         example: "john@example.com"
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               dryRun:
 *                 type: boolean
 *                 default: true
 *                 description: If true, shows what would be fixed without making changes
 *     responses:
 *       200:
 *         description: Transaction status fix completed
 *       404:
 *         description: User not found
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/admin/fix-transaction-statuses/:identifier', protect, adminProtect, shareController.fixUserTransactionStatuses);

/**
 * @swagger
 * /shares/admin/transaction-comparison/{identifier}:
 *   get:
 *     tags: [Shares - Admin Debug]
 *     summary: Compare transaction data sources
 *     description: Compare transaction data between UserShare and PaymentTransaction models. Accepts User ID, username, or email.
 *     security:
 *       - adminAuth: []
 *     parameters:
 *       - in: path
 *         name: identifier
 *         required: true
 *         schema:
 *           type: string
 *         description: User ID, username, or email
 *         example: "60f7c6b4c8f1a2b3c4d5e6f7"
 *     responses:
 *       200:
 *         description: Transaction comparison completed successfully
 *       404:
 *         description: User not found
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/admin/transaction-comparison/:identifier', protect, adminProtect, shareController.getTransactionComparison);

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

    const PRICE_MAP = {
      // Naira packages
      25000:   { earningKobo: 6000,  ownershipPct: 0.00001  },
      30000:   { earningKobo: 6000,  ownershipPct: 0.00001  },
      35000:   { earningKobo: 6000,  ownershipPct: 0.00001  },
      40000:   { earningKobo: 14000, ownershipPct: 0.000021 },
      50000:   { earningKobo: 14000, ownershipPct: 0.000021 },
      55000:   { earningKobo: 14000, ownershipPct: 0.000021 },
      70000:   { earningKobo: 30000, ownershipPct: 0.00005  },
      75000:   { earningKobo: 30000, ownershipPct: 0.00005  },
      100000:  { earningKobo: 30000, ownershipPct: 0.00005  },
      // Co-founder naira
      500000:  { earningKobo: 14000, ownershipPct: 0.000021 },
      700000:  { earningKobo: 14000, ownershipPct: 0.000021 },
      800000:  { earningKobo: 14000, ownershipPct: 0.000462 },
      1000000: { earningKobo: 14000, ownershipPct: 0.000462 },
      2000000: { earningKobo: 14000, ownershipPct: 0.00135  },
      3500000: { earningKobo: 14000, ownershipPct: 0.003    },
      // USDT prices (approximate naira equivalent for matching)
      30:  { earningKobo: 6000,  ownershipPct: 0.00001  },
      40:  { earningKobo: 14000, ownershipPct: 0.000021 },
      50:  { earningKobo: 14000, ownershipPct: 0.000021 },
      75:  { earningKobo: 30000, ownershipPct: 0.00005  },
      100: { earningKobo: 30000, ownershipPct: 0.00005  },
    };

    const userShare = await UserShare.findOne({ user: req.user.id }).lean();

    let totalEarnings = 0;
    let totalOwnershipPct = 0;

    if (userShare && userShare.transactions) {
      userShare.transactions
        .filter(t => t.status === 'completed')
        .forEach(t => {
          const pps = t.pricePerShare || 0;
          const mapping = PRICE_MAP[pps] || { earningKobo: 6000, ownershipPct: 0.00001 };
          totalEarnings += mapping.earningKobo * (t.shares || 0);
          totalOwnershipPct += mapping.ownershipPct * (t.shares || 0);
        });
    }

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
