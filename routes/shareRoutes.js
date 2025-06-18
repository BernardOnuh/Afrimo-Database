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
    // For production (Render.com), store in a more persistent location
    const uploadDir = process.env.NODE_ENV === 'production' 
      ? path.join(process.cwd(), 'uploads', 'payment-proofs')
      : 'uploads/payment-proofs';
    
    console.log(`[multer] Environment: ${process.env.NODE_ENV}`);
    console.log(`[multer] Target upload directory: ${uploadDir}`);
    
    // Create directory if it doesn't exist
    if (!fs.existsSync(uploadDir)) {
      console.log(`[multer] Creating directory: ${uploadDir}`);
      try {
        fs.mkdirSync(uploadDir, { recursive: true });
        console.log(`[multer] Directory created successfully`);
      } catch (err) {
        console.error(`[multer] Error creating directory: ${err.message}`);
        return cb(err);
      }
    } else {
      console.log(`[multer] Directory already exists: ${uploadDir}`);
    }
    
    // Verify directory is writable
    try {
      fs.accessSync(uploadDir, fs.constants.W_OK);
      console.log(`[multer] Directory is writable`);
    } catch (err) {
      console.error(`[multer] Directory is not writable: ${err.message}`);
      return cb(new Error('Upload directory is not writable'));
    }
    
    console.log(`[multer] Using upload directory: ${uploadDir}`);
    cb(null, uploadDir);
  },
  filename: function(req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    const filename = 'payment-' + uniqueSuffix + ext;
    
    console.log(`[multer] Original filename: ${file.originalname}`);
    console.log(`[multer] Generated filename: ${filename}`);
    console.log(`[multer] File extension: ${ext}`);
    console.log(`[multer] File MIME type: ${file.mimetype}`);
    
    cb(null, filename);
  }
});

// Enhanced file filter for uploads with better logging
const fileFilter = (req, file, cb) => {
  console.log(`[multer] Processing file upload:`);
  console.log(`[multer] - Original name: ${file.originalname}`);
  console.log(`[multer] - MIME type: ${file.mimetype}`);
  console.log(`[multer] - Field name: ${file.fieldname}`);
  
  if (file.mimetype.startsWith('image/')) {
    console.log(`[multer] File accepted: ${file.originalname}`);
    cb(null, true);
  } else {
    console.log(`[multer] File rejected: ${file.originalname} (not an image)`);
    cb(new Error('Only image files are allowed'), false);
  }
};

// Enhanced multer configuration with better error handling
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
    files: 1 // Only allow 1 file per request
  },
  onError: function(err, next) {
    console.error(`[multer] Upload error: ${err.message}`);
    next(err);
  }
});

// Add middleware to log successful uploads
const logUpload = (req, res, next) => {
  if (req.file) {
    console.log(`[upload-success] File uploaded successfully:`);
    console.log(`[upload-success] - Path: ${req.file.path}`);
    console.log(`[upload-success] - Filename: ${req.file.filename}`);
    console.log(`[upload-success] - Size: ${req.file.size} bytes`);
    console.log(`[upload-success] - MIME type: ${req.file.mimetype}`);
    
    // Verify file was actually written
    if (fs.existsSync(req.file.path)) {
      const stats = fs.statSync(req.file.path);
      console.log(`[upload-success] - File verified on disk: ${stats.size} bytes`);
    } else {
      console.error(`[upload-success] - WARNING: File not found on disk after upload!`);
    }
  }
  next();
};

// Enhanced error handling middleware for multer
const handleUploadError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    console.error(`[multer-error] Multer error: ${err.code} - ${err.message}`);
    
    switch (err.code) {
      case 'LIMIT_FILE_SIZE':
        return res.status(400).json({
          success: false,
          message: 'File too large. Maximum size is 5MB.'
        });
      case 'LIMIT_FILE_COUNT':
        return res.status(400).json({
          success: false,
          message: 'Too many files. Only 1 file allowed.'
        });
      case 'LIMIT_UNEXPECTED_FILE':
        return res.status(400).json({
          success: false,
          message: 'Unexpected file field. Use "paymentProof" field name.'
        });
      default:
        return res.status(400).json({
          success: false,
          message: `Upload error: ${err.message}`
        });
    }
  } else if (err) {
    console.error(`[upload-error] General upload error: ${err.message}`);
    return res.status(400).json({
      success: false,
      message: err.message || 'File upload failed'
    });
  }
  next();
};

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
 *           description: "Transaction hash for crypto payments"
 *         paymentProofPath:
 *           type: string
 *           example: "uploads/payment-proofs/payment-1234567890.jpg"
 *           description: "Path to payment proof image for manual payments"
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
 *               - email
 *             properties:
 *               quantity:
 *                 type: integer
 *                 minimum: 1
 *                 example: 50
 *                 description: Number of shares to purchase
 *               email:
 *                 type: string
 *                 format: email
 *                 example: "user@example.com"
 *                 description: User's email for Paystack
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
 *                 message:
 *                   type: string
 *                   example: "Payment initialized successfully"
 *                 data:
 *                   type: object
 *                   properties:
 *                     authorization_url:
 *                       type: string
 *                       example: "https://checkout.paystack.com/..."
 *                     reference:
 *                       type: string
 *                       example: "TXN-A1B2-123456"
 *                     amount:
 *                       type: number
 *                       example: 50000
 *       400:
 *         description: Bad Request - Invalid quantity or email
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
 *                   example: "Please provide quantity and email"
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
 *         example: "TXN-A1B2-123456"
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
 *                   type: object
 *                   properties:
 *                     shares:
 *                       type: integer
 *                       example: 50
 *                     amount:
 *                       type: number
 *                       example: 50000
 *                     date:
 *                       type: string
 *                       format: date-time
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
 *               - quantity
 *               - txHash
 *               - walletAddress
 *             properties:
 *               quantity:
 *                 type: integer
 *                 example: 50
 *                 description: Number of shares purchased
 *               txHash:
 *                 type: string
 *                 example: "0x1234567890abcdef..."
 *                 description: Blockchain transaction hash
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
 *                   example: "Payment verified and processed successfully"
 *                 data:
 *                   type: object
 *                   properties:
 *                     transactionId:
 *                       type: string
 *                       example: "TXN-A1B2-123456"
 *                     shares:
 *                       type: integer
 *                       example: 50
 *                     amount:
 *                       type: number
 *                       example: 50.25
 *                     status:
 *                       type: string
 *                       example: "completed"
 *                     verified:
 *                       type: boolean
 *                       example: true
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
 *                   example: "Please provide all required fields"
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
 *                 totalShares:
 *                   type: integer
 *                   example: 150
 *                 transactions:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Transaction'
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
 *               - currency
 *               - paymentMethod
 *               - paymentProof
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
 *                 description: Currency used for payment
 *               paymentMethod:
 *                 type: string
 *                 enum: [bank_transfer, cash, other]
 *                 example: "bank_transfer"
 *                 description: Method of payment used
 *               bankName:
 *                 type: string
 *                 example: "First Bank of Nigeria"
 *                 description: Bank name (for bank transfers)
 *               accountName:
 *                 type: string
 *                 example: "John Doe"
 *                 description: Account holder name (for bank transfers)
 *               reference:
 *                 type: string
 *                 example: "FBN123456789"
 *                 description: Payment reference/receipt number
 *               paymentProof:
 *                 type: string
 *                 format: binary
 *                 description: Payment proof image (max 5MB)
 *     responses:
 *       200:
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
 *                   example: "Payment proof submitted successfully and awaiting verification"
 *                 data:
 *                   type: object
 *                   properties:
 *                     transactionId:
 *                       type: string
 *                       example: "TXN-A1B2-123456"
 *                     shares:
 *                       type: integer
 *                       example: 50
 *                     amount:
 *                       type: number
 *                       example: 50000
 *                     status:
 *                       type: string
 *                       example: "pending"
 *                     fileUrl:
 *                       type: string
 *                       example: "/uploads/payment-proofs/payment-1234567890.jpg"
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
 *                   example: "Please provide quantity, payment method, and payment proof image"
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */

// Enhanced manual payment submission route with better error handling
router.post('/manual/submit', 
  protect, 
  upload.single('paymentProof'), 
  handleUploadError,
  logUpload,
  shareController.submitManualPayment
);
/*
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
 *         example: "TXN-A1B2-123456"
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
 *                   example: "Transaction approved successfully"
 *                 status:
 *                   type: string
 *                   example: "completed"
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
 *                 transactions:
 *                   type: array
 *                   items:
 *                     allOf:
 *                       - $ref: '#/components/schemas/Transaction'
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
 *                               walletAddress:
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
 *                   example: "Share pricing updated successfully"
 *                 pricing:
 *                   type: object
 *                   properties:
 *                     tier1:
 *                       type: object
 *                       properties:
 *                         priceNaira:
 *                           type: number
 *                           example: 52000
 *                         priceUSDT:
 *                           type: number
 *                           example: 52
 *                     tier2:
 *                       type: object
 *                     tier3:
 *                       type: object
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
 *                 description: ID of the user to add shares to
 *               shares:
 *                 type: integer
 *                 minimum: 1
 *                 example: 100
 *                 description: Number of shares to add
 *               note:
 *                 type: string
 *                 example: "Bonus shares for early investor"
 *                 description: Admin note for the transaction
 *     responses:
 *       200:
 *         description: Shares added successfully
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
 *                   example: "Successfully added 100 shares to user"
 *                 data:
 *                   type: object
 *                   properties:
 *                     transactionId:
 *                       type: string
 *                       example: "TXN-A1B2-123456"
 *                     userId:
 *                       type: string
 *                       example: "60f7c6b4c8f1a2b3c4d5e6f7"
 *                     shares:
 *                       type: integer
 *                       example: 100
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       404:
 *         description: User not found
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
 *                   example: "User not found"
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
 *                 description: New company wallet address
 *               reason:
 *                 type: string
 *                 example: "Security update"
 *                 description: Reason for wallet update
 *     responses:
 *       200:
 *         description: Wallet address updated successfully
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
 *                   example: "Company wallet address updated successfully"
 *                 walletAddress:
 *                   type: string
 *                   example: "0x742d35Cc6643C673532925e2aC5c48C0F30A37a0"
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
 *         name: paymentMethod
 *         schema:
 *           type: string
 *           enum: [paystack, crypto, web3, manual_bank_transfer, manual_cash, manual_other]
 *         description: Filter by payment method
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, completed, failed]
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
 *                 transactions:
 *                   type: array
 *                   items:
 *                     allOf:
 *                       - $ref: '#/components/schemas/Transaction'
 *                       - type: object
 *                         properties:
 *                           user:
 *                             type: object
 *                             properties:
 *                               id:
 *                                 type: string
 *                               name:
 *                                 type: string
 *                               username:
 *                                 type: string
 *                               email:
 *                                 type: string
 *                               phone:
 *                                 type: string
 *                           paymentProofUrl:
 *                             type: string
 *                             example: "/shares/payment-proof/TXN-A1B2-123456"
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
 *                 statistics:
 *                   type: object
 *                   properties:
 *                     totalShares:
 *                       type: integer
 *                       example: 10000
 *                     sharesSold:
 *                       type: integer
 *                       example: 2500
 *                     sharesRemaining:
 *                       type: integer
 *                       example: 7500
 *                     tierSales:
 *                       type: object
 *                       properties:
 *                         tier1Sold:
 *                           type: integer
 *                           example: 1500
 *                         tier2Sold:
 *                           type: integer
 *                           example: 800
 *                         tier3Sold:
 *                           type: integer
 *                           example: 200
 *                     investorCount:
 *                       type: integer
 *                       example: 150
 *                     totalValueNaira:
 *                       type: number
 *                       example: 125000000
 *                     totalValueUSDT:
 *                       type: number
 *                       example: 125000
 *                     pendingTransactions:
 *                       type: integer
 *                       example: 5
 *                 pricing:
 *                   type: object
 *                   properties:
 *                     tier1:
 *                       type: object
 *                       properties:
 *                         priceNaira:
 *                           type: number
 *                           example: 50000
 *                         priceUSDT:
 *                           type: number
 *                           example: 50
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
 *           enum: [pending, completed, failed]
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
 *                 transactions:
 *                   type: array
 *                   items:
 *                     allOf:
 *                       - $ref: '#/components/schemas/Transaction'
 *                       - type: object
 *                         properties:
 *                           user:
 *                             type: object
 *                             properties:
 *                               id:
 *                                 type: string
 *                               name:
 *                                 type: string
 *                               username:
 *                                 type: string
 *                               email:
 *                                 type: string
 *                               phone:
 *                                 type: string
 *                           paymentProofPath:
 *                             type: string
 *                             example: "uploads/payment-proofs/payment-1234567890.jpg"
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
 *                   example: "Manual payment approved successfully"
 *                 status:
 *                   type: string
 *                   example: "completed"
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
 *                   example: "Payment approval successfully canceled and returned to pending status"
 *                 status:
 *                   type: string
 *                   example: "pending"
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
 *     description: Permanently delete a manual payment transaction (admin only). This will remove the transaction completely, rollback shares if it was completed, delete payment proof files, and reverse any referral commissions.
 *     security:
 *       - adminAuth: []
 *     parameters:
 *       - in: path
 *         name: transactionId
 *         required: true
 *         schema:
 *           type: string
 *         description: Transaction ID to delete
 *         example: "TXN-A1B2-123456"
 *     responses:
 *       200:
 *         description: Manual payment transaction deleted successfully
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
 *                   example: "Manual payment transaction deleted successfully"
 *                 data:
 *                   type: object
 *                   properties:
 *                     transactionId:
 *                       type: string
 *                       example: "TXN-A1B2-123456"
 *                     deletedTransaction:
 *                       type: object
 *                       properties:
 *                         shares:
 *                           type: integer
 *                           example: 50
 *                         amount:
 *                           type: number
 *                           example: 50000
 *                         currency:
 *                           type: string
 *                           example: "naira"
 *                         previousStatus:
 *                           type: string
 *                           example: "completed"
 *                     userUpdates:
 *                       type: object
 *                       properties:
 *                         newTotalShares:
 *                           type: integer
 *                           example: 100
 *                           description: User's new total share count after deletion
 *                         sharesRemoved:
 *                           type: integer
 *                           example: 50
 *                           description: Number of shares removed (0 if transaction was pending)
 *       400:
 *         description: Bad Request - Missing transaction ID
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
 *                   example: "Transaction ID is required"
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       404:
 *         description: Transaction not found
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
 *                   example: "Manual transaction not found"
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.delete('/admin/manual/:transactionId', protect, adminProtect, shareController.adminDeleteManualPayment);

// Add this route to your shareRoutes.js file in the admin routes section

/**
 * @swagger
 * /shares/admin/purchase-report:
 *   get:
 *     tags: [Shares - Admin Reports]
 *     summary: Get share purchase report
 *     description: Get detailed report of share purchases with date range filtering, user details, and transaction information (admin only)
 *     security:
 *       - adminAuth: []
 *     parameters:
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *           example: "2024-01-01"
 *         description: Start date for filtering purchases (YYYY-MM-DD)
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *           example: "2024-12-31"
 *         description: End date for filtering purchases (YYYY-MM-DD)
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, completed, failed]
 *           default: completed
 *         description: Filter by transaction status
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
 *           maximum: 200
 *           default: 50
 *         description: Number of records per page
 *       - in: query
 *         name: sortBy
 *         schema:
 *           type: string
 *           enum: [date, amount, shares, name]
 *           default: date
 *         description: Sort purchases by field
 *       - in: query
 *         name: sortOrder
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *           default: desc
 *         description: Sort order (ascending or descending)
 *     responses:
 *       200:
 *         description: Share purchase report generated successfully
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
 *                   example: "Share purchase report generated successfully"
 *                 filters:
 *                   type: object
 *                   properties:
 *                     startDate:
 *                       type: string
 *                       format: date
 *                       example: "2024-01-01"
 *                     endDate:
 *                       type: string
 *                       format: date
 *                       example: "2024-12-31"
 *                     status:
 *                       type: string
 *                       example: "completed"
 *                     totalRecords:
 *                       type: integer
 *                       example: 156
 *                 summary:
 *                   type: object
 *                   properties:
 *                     totalTransactions:
 *                       type: integer
 *                       example: 156
 *                     totalShares:
 *                       type: integer
 *                       example: 7850
 *                     totalAmountNaira:
 *                       type: number
 *                       example: 392500000
 *                     totalAmountUSDT:
 *                       type: number
 *                       example: 392500
 *                     uniqueInvestors:
 *                       type: integer
 *                       example: 89
 *                     paymentMethods:
 *                       type: object
 *                       example:
 *                         paystack:
 *                           count: 78
 *                           totalAmount: 195000000
 *                           currency: "naira"
 *                     tierBreakdown:
 *                       type: object
 *                       properties:
 *                         tier1:
 *                           type: integer
 *                           example: 4200
 *                         tier2:
 *                           type: integer
 *                           example: 2650
 *                         tier3:
 *                           type: integer
 *                           example: 1000
 *                     averages:
 *                       type: object
 *                       properties:
 *                         avgAmountNaira:
 *                           type: number
 *                           example: 2516025.64
 *                         avgAmountUSDT:
 *                           type: number
 *                           example: 2516.03
 *                         avgShares:
 *                           type: number
 *                           example: 50.32
 *                 purchases:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       transactionId:
 *                         type: string
 *                         example: "TXN-A1B2-123456"
 *                       user:
 *                         type: object
 *                         properties:
 *                           id:
 *                             type: string
 *                           name:
 *                             type: string
 *                           username:
 *                             type: string
 *                           email:
 *                             type: string
 *                           phone:
 *                             type: string
 *                           walletAddress:
 *                             type: string
 *                           registrationDate:
 *                             type: string
 *                             format: date-time
 *                       purchaseDetails:
 *                         type: object
 *                         properties:
 *                           shares:
 *                             type: integer
 *                           pricePerShare:
 *                             type: number
 *                           currency:
 *                             type: string
 *                           totalAmount:
 *                             type: number
 *                           paymentMethod:
 *                             type: string
 *                           status:
 *                             type: string
 *                           purchaseDate:
 *                             type: string
 *                             format: date-time
 *                           daysSincePurchase:
 *                             type: integer
 *                           tierBreakdown:
 *                             type: object
 *                       additionalInfo:
 *                         type: object
 *                         properties:
 *                           txHash:
 *                             type: string
 *                           adminAction:
 *                             type: boolean
 *                           adminNote:
 *                             type: string
 *                           manualPaymentDetails:
 *                             type: object
 *                 pagination:
 *                   type: object
 *                   properties:
 *                     currentPage:
 *                       type: integer
 *                     totalPages:
 *                       type: integer
 *                     totalRecords:
 *                       type: integer
 *                     limit:
 *                       type: integer
 *       400:
 *         description: Bad Request - Invalid date format or parameters
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/admin/purchase-report', protect, adminProtect, shareController.getSharePurchaseReport);

module.exports = router;
 