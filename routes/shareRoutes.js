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

// ========== PUBLIC ROUTES ==========

/**
 * @swagger
 * /api/shares/info:
 *   get:
 *     summary: Get share information
 *     tags: [Public]
 *     responses:
 *       200:
 *         description: Share information retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 currentPrice:
 *                   type: number
 *                   example: 100
 *                 availableShares:
 *                   type: number
 *                   example: 1000
 *                 totalShares:
 *                   type: number
 *                   example: 10000
 */
router.get('/info', shareController.getShareInfo);

/**
 * @swagger
 * /api/shares/calculate:
 *   post:
 *     summary: Calculate share purchase amount
 *     tags: [Public]
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
 *                 type: number
 *                 minimum: 1
 *                 example: 10
 *     responses:
 *       200:
 *         description: Calculation successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 quantity:
 *                   type: number
 *                 totalAmount:
 *                   type: number
 *                 pricePerShare:
 *                   type: number
 */
router.post('/calculate', shareController.calculatePurchase);

/**
 * @swagger
 * /api/shares/payment-config:
 *   get:
 *     summary: Get payment configuration
 *     tags: [Public]
 *     responses:
 *       200:
 *         description: Payment configuration retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 paystack:
 *                   type: object
 *                   properties:
 *                     enabled:
 *                       type: boolean
 *                 web3:
 *                   type: object
 *                   properties:
 *                     enabled:
 *                       type: boolean
 *                     walletAddress:
 *                       type: string
 */
router.get('/payment-config', shareController.getPaymentConfig);

// ========== USER ROUTES (AUTHENTICATED) ==========

/**
 * @swagger
 * /api/shares/paystack/initiate:
 *   post:
 *     summary: Initiate Paystack payment
 *     tags: [User - Payments]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - quantity
 *               - email
 *             properties:
 *               quantity:
 *                 type: number
 *                 minimum: 1
 *               email:
 *                 type: string
 *                 format: email
 *     responses:
 *       200:
 *         description: Payment initiated successfully
 *       401:
 *         description: Unauthorized
 */
router.post('/paystack/initiate', protect, shareController.initiatePaystackPayment);

/**
 * @swagger
 * /api/shares/paystack/verify/{reference}:
 *   get:
 *     summary: Verify Paystack payment
 *     tags: [User - Payments]
 *     parameters:
 *       - in: path
 *         name: reference
 *         required: true
 *         schema:
 *           type: string
 *         description: Payment reference
 *     responses:
 *       200:
 *         description: Payment verified successfully
 *       400:
 *         description: Payment verification failed
 */
router.get('/paystack/verify/:reference', shareController.verifyPaystackPayment);

/**
 * @swagger
 * /api/shares/web3/verify:
 *   post:
 *     summary: Verify Web3 transaction
 *     tags: [User - Payments]
 *     security:
 *       - BearerAuth: []
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
 *             properties:
 *               transactionHash:
 *                 type: string
 *               quantity:
 *                 type: number
 *               amount:
 *                 type: number
 *     responses:
 *       200:
 *         description: Transaction verified successfully
 *       401:
 *         description: Unauthorized
 */
router.post('/web3/verify', protect, shareController.verifyWeb3Transaction);

/**
 * @swagger
 * /api/shares/user/shares:
 *   get:
 *     summary: Get user's shares
 *     tags: [User]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: User shares retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 totalShares:
 *                   type: number
 *                 transactions:
 *                   type: array
 *                   items:
 *                     type: object
 *       401:
 *         description: Unauthorized
 */
router.get('/user/shares', protect, shareController.getUserShares);

// ========== MANUAL PAYMENT ROUTES ==========

/**
 * @swagger
 * /api/shares/manual/submit:
 *   post:
 *     summary: Submit manual payment with proof
 *     tags: [User - Manual Payment]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - quantity
 *               - amount
 *               - paymentMethod
 *               - paymentProof
 *             properties:
 *               quantity:
 *                 type: number
 *                 minimum: 1
 *               amount:
 *                 type: number
 *               paymentMethod:
 *                 type: string
 *                 enum: [bank_transfer, mobile_money, cash]
 *               paymentDetails:
 *                 type: string
 *               paymentProof:
 *                 type: string
 *                 format: binary
 *                 description: Image file (max 5MB)
 *     responses:
 *       201:
 *         description: Manual payment submitted successfully
 *       400:
 *         description: Invalid request data
 *       401:
 *         description: Unauthorized
 */
router.post('/manual/submit', protect, upload.single('paymentProof'), shareController.submitManualPayment);

/**
 * @swagger
 * /api/shares/payment-proof/{transactionId}:
 *   get:
 *     summary: Get payment proof image
 *     tags: [User - Manual Payment]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: transactionId
 *         required: true
 *         schema:
 *           type: string
 *         description: Transaction ID
 *     responses:
 *       200:
 *         description: Payment proof image
 *         content:
 *           image/*:
 *             schema:
 *               type: string
 *               format: binary
 *       404:
 *         description: Payment proof not found
 *       401:
 *         description: Unauthorized
 */
router.get('/payment-proof/:transactionId', protect, shareController.getPaymentProof);

// ========== ADMIN ROUTES ==========

/**
 * @swagger
 * /api/shares/admin/web3/verify:
 *   post:
 *     summary: Admin verify Web3 transaction
 *     tags: [Admin - Web3]
 *     security:
 *       - BearerAuth: []
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
 *               status:
 *                 type: string
 *                 enum: [approved, rejected]
 *               notes:
 *                 type: string
 *     responses:
 *       200:
 *         description: Transaction status updated
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 */
router.post('/admin/web3/verify', protect, adminProtect, shareController.adminVerifyWeb3Transaction);

/**
 * @swagger
 * /api/shares/admin/web3/transactions:
 *   get:
 *     summary: Get all Web3 transactions for admin review
 *     tags: [Admin - Web3]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, approved, rejected]
 *         description: Filter by transaction status
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *     responses:
 *       200:
 *         description: Web3 transactions retrieved
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 */
router.get('/admin/web3/transactions', protect, adminProtect, shareController.adminGetWeb3Transactions);

/**
 * @swagger
 * /api/shares/admin/update-pricing:
 *   post:
 *     summary: Update share pricing
 *     tags: [Admin - Configuration]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - pricePerShare
 *             properties:
 *               pricePerShare:
 *                 type: number
 *                 minimum: 0
 *     responses:
 *       200:
 *         description: Pricing updated successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 */
router.post('/admin/update-pricing', protect, adminProtect, shareController.updateSharePricing);

/**
 * @swagger
 * /api/shares/admin/add-shares:
 *   post:
 *     summary: Add shares to the pool
 *     tags: [Admin - Configuration]
 *     security:
 *       - BearerAuth: []
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
 *                 type: number
 *                 minimum: 1
 *     responses:
 *       200:
 *         description: Shares added successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 */
router.post('/admin/add-shares', protect, adminProtect, shareController.adminAddShares);

/**
 * @swagger
 * /api/shares/admin/update-wallet:
 *   post:
 *     summary: Update company wallet address
 *     tags: [Admin - Configuration]
 *     security:
 *       - BearerAuth: []
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
 *                 pattern: '^0x[a-fA-F0-9]{40}$'
 *     responses:
 *       200:
 *         description: Wallet address updated
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 */
router.post('/admin/update-wallet', protect, adminProtect, shareController.updateCompanyWallet);

/**
 * @swagger
 * /api/shares/admin/transactions:
 *   get:
 *     summary: Get all transactions
 *     tags: [Admin - Reports]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [paystack, web3, manual]
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, completed, failed, cancelled]
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
 *     responses:
 *       200:
 *         description: All transactions retrieved
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 */
router.get('/admin/transactions', protect, adminProtect, shareController.getAllTransactions);

/**
 * @swagger
 * /api/shares/admin/statistics:
 *   get:
 *     summary: Get share statistics
 *     tags: [Admin - Reports]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Statistics retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 totalShares:
 *                   type: number
 *                 soldShares:
 *                   type: number
 *                 availableShares:
 *                   type: number
 *                 totalRevenue:
 *                   type: number
 *                 transactionCounts:
 *                   type: object
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 */
router.get('/admin/statistics', protect, adminProtect, shareController.getShareStatistics);

// ========== ADMIN MANUAL PAYMENT ROUTES ==========

/**
 * @swagger
 * /api/shares/admin/manual/transactions:
 *   get:
 *     summary: Get all manual payment transactions for admin review
 *     tags: [Admin - Manual Payments]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, approved, rejected, cancelled]
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *     responses:
 *       200:
 *         description: Manual payment transactions retrieved
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 */
router.get('/admin/manual/transactions', protect, adminProtect, shareController.adminGetManualTransactions);

/**
 * @swagger
 * /api/shares/admin/manual/verify:
 *   post:
 *     summary: Verify manual payment transaction
 *     tags: [Admin - Manual Payments]
 *     security:
 *       - BearerAuth: []
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
 *               status:
 *                 type: string
 *                 enum: [approved, rejected]
 *               notes:
 *                 type: string
 *                 description: Admin notes for the verification
 *     responses:
 *       200:
 *         description: Manual payment verified successfully
 *       400:
 *         description: Invalid request data
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 *       404:
 *         description: Transaction not found
 */
router.post('/admin/manual/verify', protect, adminProtect, shareController.adminVerifyManualPayment);

/**
 * @swagger
 * /api/shares/admin/manual/cancel:
 *   post:
 *     summary: Cancel manual payment transaction
 *     tags: [Admin - Manual Payments]
 *     security:
 *       - BearerAuth: []
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
 *               reason:
 *                 type: string
 *                 description: Reason for cancellation
 *     responses:
 *       200:
 *         description: Manual payment cancelled successfully
 *       400:
 *         description: Invalid request data
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 *       404:
 *         description: Transaction not found
 */
router.post('/admin/manual/cancel', protect, adminProtect, shareController.adminCancelManualPayment);

module.exports = router;