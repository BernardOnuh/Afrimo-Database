// routes/shareRoutes.js
const express = require('express');
const router = express.Router();
const shareController = require('../controller/shareController');
const { protect, adminProtect } = require('../middleware/auth');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function(req, file, cb) {
    const uploadDir = 'uploads/payment-proofs';
    
    // Create directory if it doesn't exist
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    
    cb(null, uploadDir);
  },
  filename: function(req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, 'payment-' + uniqueSuffix + ext);
  }
});

// File filter for uploads (only accept images)
const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new Error('Only image files are allowed'), false);
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
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
 *         id:
 *           type: string
 *           example: "60f7c6b4c8f1a2b3c4d5e6f7"
 *         userId:
 *           type: string
 *           example: "60f7c6b4c8f1a2b3c4d5e6f8"
 *         type:
 *           type: string
 *           enum: [paystack, web3, manual]
 *           example: "paystack"
 *         status:
 *           type: string
 *           enum: [pending, completed, failed, cancelled]
 *           example: "completed"
 *         tier:
 *           type: string
 *           enum: [tier1, tier2, tier3]
 *           example: "tier1"
 *         quantity:
 *           type: integer
 *           example: 50
 *         amount:
 *           type: number
 *           format: float
 *           example: 50000.00
 *         currency:
 *           type: string
 *           enum: [naira, usdt]
 *           example: "naira"
 *         reference:
 *           type: string
 *           example: "ref_123456789"
 *         createdAt:
 *           type: string
 *           format: date-time
 *           example: "2024-01-15T10:30:00Z"
 */

// Public routes

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
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/ShareInfo'
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
 *                 description: Number of shares to purchase
 *               currency:
 *                 type: string
 *                 enum: [naira, usdt]
 *                 example: "naira"
 *                 description: Currency for the calculation (naira or usdt)
 *     responses:
 *       200:
 *         description: Purchase calculation successful
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
 *                     quantity:
 *                       type: integer
 *                       example: 50
 *                     currency:
 *                       type: string
 *                       example: "naira"
 *                     pricePerShare:
 *                       type: number
 *                       format: float
 *                       example: 100.50
 *                     totalAmount:
 *                       type: number
 *                       format: float
 *                       example: 5025.00
 *                     usdtPrice:
 *                       type: number
 *                       format: float
 *                       example: 3.15
 *                       description: Price in USDT if currency is usdt
 *       400:
 *         description: Bad Request - Invalid quantity or currency
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
 *                   example: "Invalid request. Please provide valid quantity and currency (naira or usdt)."
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
 *                     paystack:
 *                       type: object
 *                       properties:
 *                         enabled:
 *                           type: boolean
 *                           example: true
 *                         publicKey:
 *                           type: string
 *                           example: "pk_test_..."
 *                     web3:
 *                       type: object
 *                       properties:
 *                         enabled:
 *                           type: boolean
 *                           example: true
 *                         walletAddress:
 *                           type: string
 *                           example: "0x742d35Cc6643C673532925e2aC5c48C0F30A37a0"
 *                         supportedTokens:
 *                           type: array
 *                           items:
 *                             type: string
 *                           example: ["USDT", "USDC", "ETH"]
 *                     manual:
 *                       type: object
 *                       properties:
 *                         enabled:
 *                           type: boolean
 *                           example: true
 *                         bankDetails:
 *                           type: object
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/payment-config', shareController.getPaymentConfig);

// User routes (require authentication)

/**
 * @swagger
 * /shares/paystack/initiate:
 *   post:
 *     tags: [Shares - Payment]
 *     summary: Initiate Paystack payment
 *     description: Initialize a Paystack payment for share purchase
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
 *                 example: 50
 *                 description: Number of shares to purchase
 *               currency:
 *                 type: string
 *                 enum: [naira, usdt]
 *                 example: "naira"
 *                 description: Currency for the payment (naira or usdt)
 *               email:
 *                 type: string
 *                 format: email
 *                 example: "user@example.com"
 *                 description: User's email (optional, will use authenticated user's email if not provided)
 *     responses:
 *       200:
 *         description: Payment initialization successful
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
 *                     authorization_url:
 *                       type: string
 *                       example: "https://checkout.paystack.com/..."
 *                     access_code:
 *                       type: string
 *                       example: "access_code_123"
 *                     reference:
 *                       type: string
 *                       example: "ref_123456789"
 *       400:
 *         description: Bad Request - Invalid quantity or currency
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
 *                   example: "Invalid request. Please provide valid quantity and currency (naira or usdt)."
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/paystack/initiate', protect, shareController.initiatePaystackPayment);

/**
 * @swagger
 * /shares/paystack/verify/{reference}:
 *   get:
 *     tags: [Shares - Payment]
 *     summary: Verify Paystack payment
 *     description: Verify and complete a Paystack payment transaction
 *     parameters:
 *       - in: path
 *         name: reference
 *         required: true
 *         schema:
 *           type: string
 *         description: Paystack payment reference
 *         example: "ref_123456789"
 *     responses:
 *       200:
 *         description: Payment verification successful
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
 *                   $ref: '#/components/schemas/Transaction'
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/paystack/verify/:reference', shareController.verifyPaystackPayment);

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
 *               - transactionHash
 *               - quantity
 *               - amount
 *               - currency
 *             properties:
 *               transactionHash:
 *                 type: string
 *                 example: "0x1234567890abcdef..."
 *                 description: Blockchain transaction hash
 *               quantity:
 *                 type: integer
 *                 example: 50
 *                 description: Number of shares purchased
 *               amount:
 *                 type: number
 *                 format: float
 *                 example: 5025.00
 *                 description: Amount paid in the specified currency
 *               currency:
 *                 type: string
 *                 enum: [naira, usdt]
 *                 example: "usdt"
 *                 description: Currency used for payment
 *               token:
 *                 type: string
 *                 example: "USDT"
 *                 description: Token used for payment (for crypto transactions)
 *               walletAddress:
 *                 type: string
 *                 example: "0x742d35Cc6643C673532925e2aC5c48C0F30A37a0"
 *                 description: Sender's wallet address
 *     responses:
 *       200:
 *         description: Web3 transaction verified successfully
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
 *                   example: "Transaction verified successfully"
 *                 data:
 *                   $ref: '#/components/schemas/Transaction'
 *       400:
 *         description: Bad Request - Invalid parameters
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
 *                   example: "Invalid request. Please provide valid quantity and currency."
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
 *         description: Page number for pagination
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 10
 *         description: Number of transactions per page
 *     responses:
 *       200:
 *         description: User shares retrieved successfully
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
 *                     totalShares:
 *                       type: integer
 *                       example: 150
 *                     totalInvestment:
 *                       type: number
 *                       format: float
 *                       example: 15075.00
 *                     transactions:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/Transaction'
 *                     pagination:
 *                       type: object
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/user/shares', protect, shareController.getUserShares);

// Manual payment routes

/**
 * @swagger
 * /shares/manual/submit:
 *   post:
 *     tags: [Shares - Manual Payment]
 *     summary: Submit manual payment
 *     description: Submit a manual payment with proof for share purchase
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
 *               - amount
 *               - currency
 *               - paymentMethod
 *               - paymentProof
 *             properties:
 *               quantity:
 *                 type: integer
 *                 minimum: 1
 *                 example: 50
 *                 description: Number of shares to purchase
 *               amount:
 *                 type: number
 *                 format: float
 *                 example: 5025.00
 *                 description: Amount paid
 *               currency:
 *                 type: string
 *                 enum: [naira, usdt]
 *                 example: "naira"
 *                 description: Currency used for payment
 *               paymentMethod:
 *                 type: string
 *                 example: "Bank Transfer"
 *                 description: Method of payment used
 *               paymentReference:
 *                 type: string
 *                 example: "TXN123456789"
 *                 description: Payment reference number
 *               paymentProof:
 *                 type: string
 *                 format: binary
 *                 description: Payment proof image (max 5MB)
 *               notes:
 *                 type: string
 *                 example: "Payment made via GTBank"
 *                 description: Additional notes about the payment
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
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Manual payment submitted successfully"
 *                 data:
 *                   $ref: '#/components/schemas/Transaction'
 *       400:
 *         description: Bad Request - Invalid parameters
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
 *                   example: "Invalid request. Please provide valid quantity and currency."
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/manual/submit', protect, upload.single('paymentProof'), shareController.submitManualPayment);

/**
 * @swagger
 * /shares/payment-proof/{transactionId}:
 *   get:
 *     tags: [Shares - Manual Payment]
 *     summary: Get payment proof
 *     description: Retrieve payment proof image for a transaction
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: transactionId
 *         required: true
 *         schema:
 *           type: string
 *         description: Transaction ID
 *         example: "60f7c6b4c8f1a2b3c4d5e6f7"
 *     responses:
 *       200:
 *         description: Payment proof retrieved successfully
 *         content:
 *           image/*:
 *             schema:
 *               type: string
 *               format: binary
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/payment-proof/:transactionId', protect, shareController.getPaymentProof);

// Admin routes

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
 *               - status
 *             properties:
 *               transactionId:
 *                 type: string
 *                 example: "60f7c6b4c8f1a2b3c4d5e6f7"
 *               status:
 *                 type: string
 *                 enum: [approved, rejected]
 *                 example: "approved"
 *               notes:
 *                 type: string
 *                 example: "Transaction verified manually"
 *     responses:
 *       200:
 *         description: Transaction status updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Success'
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
 *           enum: [pending, completed, failed]
 *         description: Filter by transaction status
 *     responses:
 *       200:
 *         description: Web3 transactions retrieved successfully
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
 *                     transactions:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/Transaction'
 *                     pagination:
 *                       type: object
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
 *                 description: Share tier to update (tier1, tier2, or tier3)
 *               priceNaira:
 *                 type: number
 *                 format: float
 *                 minimum: 0.01
 *                 example: 52000.00
 *                 description: New price in Naira (provide either priceNaira or priceUSDT or both)
 *               priceUSDT:
 *                 type: number
 *                 format: float
 *                 minimum: 0.01
 *                 example: 52.00
 *                 description: New price in USDT (provide either priceNaira or priceUSDT or both)
 *               effectiveDate:
 *                 type: string
 *                 format: date-time
 *                 example: "2024-02-01T00:00:00Z"
 *                 description: When the new pricing takes effect (optional)
 *               reason:
 *                 type: string
 *                 example: "Market adjustment"
 *                 description: Reason for the price update (optional)
 *     responses:
 *       200:
 *         description: Share pricing updated successfully
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
 *                   example: "Pricing updated successfully"
 *                 data:
 *                   type: object
 *                   properties:
 *                     tier:
 *                       type: string
 *                       example: "tier1"
 *                     priceNaira:
 *                       type: number
 *                       format: float
 *                       example: 52000.00
 *                     priceUSDT:
 *                       type: number
 *                       format: float
 *                       example: 52.00
 *                     effectiveDate:
 *                       type: string
 *                       format: date-time
 *       400:
 *         description: Bad Request - Missing tier or price updates
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
 *                   example: "Please provide tier and at least one price update"
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
 *     summary: Add shares to pool
 *     description: Add additional shares to the available pool (admin only)
 *     security:
 *       - adminAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - shares
 *             properties:
 *               shares:
 *                 type: integer
 *                 minimum: 1
 *                 example: 1000
 *               reason:
 *                 type: string
 *                 example: "New share issuance"
 *     responses:
 *       200:
 *         description: Shares added successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Success'
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
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
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Success'
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
 *         name: type
 *         schema:
 *           type: string
 *           enum: [paystack, web3, manual]
 *         description: Filter by transaction type
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, completed, failed, cancelled]
 *         description: Filter by transaction status
 *       - in: query
 *         name: fromDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter transactions from this date
 *       - in: query
 *         name: toDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter transactions to this date
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
 *                 data:
 *                   type: object
 *                   properties:
 *                     transactions:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/Transaction'
 *                     pagination:
 *                       type: object
 *                     summary:
 *                       type: object
 *                       properties:
 *                         totalTransactions:
 *                           type: integer
 *                         totalAmount:
 *                           type: number
 *                           format: float
 *                         totalShares:
 *                           type: integer
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
 *                     shares:
 *                       type: object
 *                       properties:
 *                         total:
 *                           type: integer
 *                         sold:
 *                           type: integer
 *                         available:
 *                           type: integer
 *                         currentPrice:
 *                           type: number
 *                           format: float
 *                     revenue:
 *                       type: object
 *                       properties:
 *                         total:
 *                           type: number
 *                           format: float
 *                         thisMonth:
 *                           type: number
 *                           format: float
 *                         lastMonth:
 *                           type: number
 *                           format: float
 *                     transactions:
 *                       type: object
 *                       properties:
 *                         total:
 *                           type: integer
 *                         pending:
 *                           type: integer
 *                         completed:
 *                           type: integer
 *                         failed:
 *                           type: integer
 *                     paymentMethods:
 *                       type: object
 *                       properties:
 *                         paystack:
 *                           type: object
 *                           properties:
 *                             count:
 *                               type: integer
 *                             amount:
 *                               type: number
 *                               format: float
 *                         web3:
 *                           type: object
 *                           properties:
 *                             count:
 *                               type: integer
 *                             amount:
 *                               type: number
 *                               format: float
 *                         manual:
 *                           type: object
 *                           properties:
 *                             count:
 *                               type: integer
 *                             amount:
 *                               type: number
 *                               format: float
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/admin/statistics', protect, adminProtect, shareController.getShareStatistics);

// Admin manual payment routes

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
 *           enum: [pending, verified, rejected, cancelled]
 *         description: Filter by payment status
 *       - in: query
 *         name: fromDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter transactions from this date
 *       - in: query
 *         name: toDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter transactions to this date
 *     responses:
 *       200:
 *         description: Manual payment transactions retrieved successfully
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
 *                     transactions:
 *                       type: array
 *                       items:
 *                         allOf:
 *                           - $ref: '#/components/schemas/Transaction'
 *                           - type: object
 *                             properties:
 *                               paymentProofUrl:
 *                                 type: string
 *                                 example: "/api/shares/payment-proof/60f7c6b4c8f1a2b3c4d5e6f7"
 *                               paymentMethod:
 *                                 type: string
 *                                 example: "Bank Transfer"
 *                               paymentReference:
 *                                 type: string
 *                                 example: "TXN123456789"
 *                               notes:
 *                                 type: string
 *                                 example: "Payment made via GTBank"
 *                               user:
 *                                 type: object
 *                                 properties:
 *                                   name:
 *                                     type: string
 *                                   email:
 *                                     type: string
 *                     pagination:
 *                       type: object
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
 *               - status
 *             properties:
 *               transactionId:
 *                 type: string
 *                 example: "60f7c6b4c8f1a2b3c4d5e6f7"
 *               status:
 *                 type: string
 *                 enum: [verified, rejected]
 *                 example: "verified"
 *               adminNotes:
 *                 type: string
 *                 example: "Payment verified through bank statement"
 *               rejectionReason:
 *                 type: string
 *                 example: "Invalid payment proof"
 *     responses:
 *       200:
 *         description: Manual payment verification updated successfully
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
 *                   $ref: '#/components/schemas/Transaction'
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
 * /shares/admin/manual/cancel:
 *   post:
 *     tags: [Shares - Admin Manual Payment]
 *     summary: Cancel manual payment
 *     description: Cancel a manual payment transaction (admin only)
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
 *                 example: "60f7c6b4c8f1a2b3c4d5e6f7"
 *               reason:
 *                 type: string
 *                 example: "Duplicate transaction"
 *               adminNotes:
 *                 type: string
 *                 example: "Transaction cancelled due to duplicate submission"
 *     responses:
 *       200:
 *         description: Manual payment cancelled successfully
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
 *                   example: "Payment cancelled successfully"
 *                 data:
 *                   $ref: '#/components/schemas/Transaction'
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

module.exports = router;