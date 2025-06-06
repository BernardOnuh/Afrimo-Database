// routes/coFounderRoutes.js
const express = require('express');
const router = express.Router();
const coFounderController = require('../controller/coFounderController');
const { protect, adminProtect } = require('../middleware/auth');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function(req, file, cb) {
    // For production (Render.com), store in a more persistent location
    const uploadDir = process.env.NODE_ENV === 'production' 
      ? path.join(process.cwd(), 'uploads', 'cofounder-payment-proofs')
      : 'uploads/cofounder-payment-proofs';
    
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
    const filename = 'cofounder-payment-' + uniqueSuffix + ext;
    
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
 *     CoFounderShareInfo:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: true
 *         pricing:
 *           type: object
 *           properties:
 *             priceNaira:
 *               type: number
 *               format: float
 *               example: 100000
 *               description: Price per co-founder share in Naira
 *             priceUSDT:
 *               type: number
 *               format: float
 *               example: 100
 *               description: Price per co-founder share in USDT
 *         availability:
 *           type: object
 *           properties:
 *             totalShares:
 *               type: integer
 *               example: 1000
 *               description: Total co-founder shares available
 *             sharesSold:
 *               type: integer
 *               example: 250
 *               description: Number of co-founder shares already sold
 *             sharesRemaining:
 *               type: integer
 *               example: 750
 *               description: Number of co-founder shares still available
 *     
 *     CoFounderTransaction:
 *       type: object
 *       properties:
 *         transactionId:
 *           type: string
 *           example: "CFD-A1B2-123456"
 *           description: Unique co-founder transaction identifier
 *         shares:
 *           type: integer
 *           example: 5
 *           description: Number of co-founder shares purchased
 *         amount:
 *           type: number
 *           format: float
 *           example: 500000
 *           description: Total amount paid
 *         currency:
 *           type: string
 *           enum: [naira, usdt]
 *           example: "naira"
 *           description: Currency used for payment
 *         paymentMethod:
 *           type: string
 *           enum: [paystack, crypto, web3, manual_bank_transfer, manual_cash, manual_other]
 *           example: "paystack"
 *           description: Payment method used
 *         status:
 *           type: string
 *           enum: [pending, completed, failed]
 *           example: "completed"
 *           description: Transaction status
 *         transactionHash:
 *           type: string
 *           example: "0x1234567890abcdef..."
 *           description: Blockchain transaction hash (for crypto payments)
 *         paymentProofPath:
 *           type: string
 *           example: "uploads/cofounder-payment-proofs/cofounder-payment-1234567890.jpg"
 *           description: Path to payment proof image (for manual payments)
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
 *         adminNotes:
 *           type: string
 *           example: "Transaction verified manually"
 *           description: Admin notes about the transaction
 *         createdAt:
 *           type: string
 *           format: date-time
 *           example: "2024-01-15T10:30:00Z"
 */

// ===========================================
// PUBLIC ROUTES - Co-Founder Share Information
// ===========================================

/**
 * @swagger
 * /cofounder/info:
 *   get:
 *     tags: [Co-Founder - Public]
 *     summary: Get co-founder share information
 *     description: Get current co-founder share pricing and availability information
 *     responses:
 *       200:
 *         description: Co-founder share information retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/CoFounderShareInfo'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/info', coFounderController.getCoFounderShareInfo);

/**
 * @swagger
 * /cofounder/calculate:
 *   post:
 *     tags: [Co-Founder - Public]
 *     summary: Calculate co-founder purchase amount
 *     description: Calculate total amount for specified number of co-founder shares in the selected currency
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
 *                 example: 5
 *                 description: Number of co-founder shares to purchase
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
 *                 purchaseDetails:
 *                   type: object
 *                   properties:
 *                     quantity:
 *                       type: integer
 *                       example: 5
 *                     pricePerShare:
 *                       type: number
 *                       format: float
 *                       example: 100000
 *                     totalPrice:
 *                       type: number
 *                       format: float
 *                       example: 500000
 *                     currency:
 *                       type: string
 *                       example: "naira"
 *                     availableSharesAfterPurchase:
 *                       type: integer
 *                       example: 745
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
router.post('/calculate', coFounderController.calculateCoFounderPurchase);

/**
 * @swagger
 * /cofounder/payment-config:
 *   get:
 *     tags: [Co-Founder - Public]
 *     summary: Get payment configuration
 *     description: Get available payment methods and their configurations for co-founder shares
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
 *                 paymentConfig:
 *                   type: object
 *                   properties:
 *                     companyWalletAddress:
 *                       type: string
 *                       example: "0x742d35Cc6643C673532925e2aC5c48C0F30A37a0"
 *                     acceptedCurrencies:
 *                       type: array
 *                       items:
 *                         type: string
 *                       example: ["USDT", "USDC", "ETH"]
 *                     paymentInstructions:
 *                       type: object
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/payment-config', coFounderController.getPaymentConfig);

// ===========================================
// USER PAYMENT ROUTES
// ===========================================

/**
 * @swagger
 * /cofounder/paystack/initiate:
 *   post:
 *     tags: [Co-Founder - Payment]
 *     summary: Initiate Paystack payment for co-founder shares
 *     description: Initialize a Paystack payment for co-founder share purchase
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
 *                 example: 5
 *                 description: Number of co-founder shares to purchase
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
 *                       example: "CFD-A1B2-123456"
 *                     amount:
 *                       type: number
 *                       example: 500000
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
router.post('/paystack/initiate', protect, coFounderController.initiateCoFounderPaystackPayment);

/**
 * @swagger
 * /cofounder/paystack/verify/{reference}:
 *   get:
 *     tags: [Co-Founder - Payment]
 *     summary: Verify Paystack payment for co-founder shares
 *     description: Verify and complete a Paystack payment transaction for co-founder shares
 *     parameters:
 *       - in: path
 *         name: reference
 *         required: true
 *         schema:
 *           type: string
 *         description: Paystack payment reference
 *         example: "CFD-A1B2-123456"
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
 *                 shares:
 *                   type: integer
 *                   example: 5
 *                 amount:
 *                   type: number
 *                   example: 500000
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/paystack/verify/:reference', coFounderController.verifyCoFounderPaystackPayment);

/**
 * @swagger
 * /cofounder/web3/verify:
 *   post:
 *     tags: [Co-Founder - Payment]
 *     summary: Verify Web3 transaction for co-founder shares
 *     description: Verify a blockchain transaction for co-founder share purchase
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
 *               - amount
 *               - currency
 *               - shares
 *             properties:
 *               transactionHash:
 *                 type: string
 *                 example: "0x1234567890abcdef..."
 *                 description: Blockchain transaction hash
 *               amount:
 *                 type: number
 *                 example: 500
 *                 description: Amount paid in the specified currency
 *               currency:
 *                 type: string
 *                 enum: [usdt, usdc, eth]
 *                 example: "usdt"
 *                 description: Cryptocurrency used for payment
 *               shares:
 *                 type: integer
 *                 example: 5
 *                 description: Number of co-founder shares purchased
 *     responses:
 *       200:
 *         description: Web3 transaction submitted for verification
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
 *                   example: "Transaction submitted for verification"
 *                 transaction:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                       example: "60f7c6b4c8f1a2b3c4d5e6f7"
 *                     status:
 *                       type: string
 *                       example: "pending"
 *                     shares:
 *                       type: integer
 *                       example: 5
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
 *                   example: "Please provide transaction hash, amount, currency, and shares"
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/web3/verify', protect, coFounderController.verifyWeb3Transaction);

/**
 * @swagger
 * /cofounder/user/shares:
 *   get:
 *     tags: [Co-Founder - User]
 *     summary: Get user's co-founder shares
 *     description: Get current user's co-founder share holdings and transaction history
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User co-founder shares retrieved successfully
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
 *                   example: 15
 *                   description: Total co-founder shares owned by user
 *                 transactions:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/CoFounderTransaction'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/user/shares', protect, coFounderController.getUserCoFounderShares);

// ===========================================
// MANUAL PAYMENT ROUTES
// ===========================================

/**
 * @swagger
 * /cofounder/manual/submit:
 *   post:
 *     tags: [Co-Founder - Manual Payment]
 *     summary: Submit manual payment for co-founder shares
 *     description: Submit a manual payment with proof for co-founder share purchase
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
 *                 example: 5
 *                 description: Number of co-founder shares to purchase
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
 *                       example: "CFD-A1B2-123456"
 *                     shares:
 *                       type: integer
 *                       example: 5
 *                     amount:
 *                       type: number
 *                       example: 500000
 *                     status:
 *                       type: string
 *                       example: "pending"
 *                     fileUrl:
 *                       type: string
 *                       example: "/uploads/cofounder-payment-proofs/cofounder-payment-1234567890.jpg"
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
  coFounderController.submitCoFounderManualPayment
);

/**
 * @swagger
 * /cofounder/payment-proof/{transactionId}:
 *   get:
 *     tags: [Co-Founder - Manual Payment]
 *     summary: Get payment proof for co-founder shares
 *     description: Retrieve payment proof image for a co-founder share transaction
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: transactionId
 *         required: true
 *         schema:
 *           type: string
 *         description: Transaction ID
 *         example: "CFD-A1B2-123456"
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
 *       403:
 *         description: Forbidden - User not authorized to view this payment proof
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/payment-proof/:transactionId', protect, coFounderController.getCoFounderPaymentProof);

/**
 * @swagger
 * /cofounder/manual/status/{transactionId}:
 *   get:
 *     tags: [Co-Founder - Manual Payment]
 *     summary: Get manual payment status
 *     description: Get the status of a manual payment transaction for co-founder shares
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: transactionId
 *         required: true
 *         schema:
 *           type: string
 *         description: Transaction ID
 *         example: "CFD-A1B2-123456"
 *     responses:
 *       200:
 *         description: Manual payment status retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 transaction:
 *                   $ref: '#/components/schemas/CoFounderTransaction'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/manual/status/:transactionId', protect, coFounderController.getCoFounderManualPaymentStatus);

// ===========================================
// ADMIN ROUTES
// ===========================================

/**
 * @swagger
 * /cofounder/admin/web3/verify:
 *   post:
 *     tags: [Co-Founder - Admin]
 *     summary: Admin verify Web3 transaction
 *     description: Manually verify a Web3 transaction for co-founder shares (admin only)
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
 *                 description: MongoDB transaction ID
 *               status:
 *                 type: string
 *                 enum: [completed, failed]
 *                 example: "completed"
 *                 description: New transaction status
 *               adminNotes:
 *                 type: string
 *                 example: "Transaction verified manually"
 *                 description: Admin notes about the verification
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
 *                   example: "Transaction verified successfully"
 *                 transaction:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 * example: "60f7c6b4c8f1a2b3c4d5e6f7"
 *                     status:
 *                       type: string
 *                       example: "completed"
 *                     shares:
 *                       type: integer
 *                       example: 5
 *                     amount:
 *                       type: number
 *                       example: 500
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
router.post('/admin/web3/verify', protect, adminProtect, coFounderController.adminVerifyWeb3Transaction);

/**
 * @swagger
 * /cofounder/admin/web3/transactions:
 *   get:
 *     tags: [Co-Founder - Admin]
 *     summary: Get Web3 transactions for co-founder shares
 *     description: Get all Web3 transactions for co-founder shares (admin only)
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
 *                       - $ref: '#/components/schemas/CoFounderTransaction'
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
router.get('/admin/web3/transactions', protect, adminProtect, coFounderController.adminGetWeb3Transactions);

/**
 * @swagger
 * /cofounder/admin/update-pricing:
 *   post:
 *     tags: [Co-Founder - Admin]
 *     summary: Update co-founder share pricing
 *     description: Update the current co-founder share price (admin only)
 *     security:
 *       - adminAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               priceNaira:
 *                 type: number
 *                 format: float
 *                 minimum: 0.01
 *                 example: 120000.00
 *                 description: New price in Naira (provide either priceNaira or priceUSDT or both)
 *               priceUSDT:
 *                 type: number
 *                 format: float
 *                 minimum: 0.01
 *                 example: 120.00
 *                 description: New price in USDT (provide either priceNaira or priceUSDT or both)
 *               effectiveDate:
 *                 type: string
 *                 format: date-time
 *                 example: "2024-02-01T00:00:00Z"
 *                 description: When the new pricing takes effect (optional)
 *               reason:
 *                 type: string
 *                 example: "Market adjustment for co-founder shares"
 *                 description: Reason for the price update (optional)
 *     responses:
 *       200:
 *         description: Co-founder share pricing updated successfully
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
 *                   example: "Co-founder share pricing updated successfully"
 *                 pricing:
 *                   type: object
 *                   properties:
 *                     priceNaira:
 *                       type: number
 *                       example: 120000
 *                     priceUSDT:
 *                       type: number
 *                       example: 120
 *       400:
 *         description: Bad Request - Missing price updates
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
 *                   example: "Please provide at least one price update"
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/admin/update-pricing', protect, adminProtect, coFounderController.updateCoFounderSharePricing);

/**
 * @swagger
 * /cofounder/admin/add-shares:
 *   post:
 *     tags: [Co-Founder - Admin]
 *     summary: Add co-founder shares to user
 *     description: Add co-founder shares directly to a user's account (admin only)
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
 *                 description: ID of the user to add co-founder shares to
 *               shares:
 *                 type: integer
 *                 minimum: 1
 *                 example: 10
 *                 description: Number of co-founder shares to add
 *               note:
 *                 type: string
 *                 example: "Bonus co-founder shares for early investor"
 *                 description: Admin note for the transaction
 *     responses:
 *       200:
 *         description: Co-founder shares added successfully
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
 *                   example: "Successfully added 10 co-founder shares to user"
 *                 transaction:
 *                   type: string
 *                   example: "60f7c6b4c8f1a2b3c4d5e6f8"
 *                   description: Transaction ID
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
router.post('/admin/add-shares', protect, adminProtect, coFounderController.adminAddCoFounderShares);

/**
 * @swagger
 * /cofounder/admin/update-wallet:
 *   post:
 *     tags: [Co-Founder - Admin]
 *     summary: Update company wallet for co-founder payments
 *     description: Update the company's Web3 wallet address for co-founder share payments (admin only)
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
 *                 example: "Security update for co-founder payments"
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
router.post('/admin/update-wallet', protect, adminProtect, coFounderController.updateCompanyWallet);

/**
 * @swagger
 * /cofounder/admin/transactions:
 *   get:
 *     tags: [Co-Founder - Admin]
 *     summary: Get all co-founder transactions
 *     description: Get all co-founder share transactions across all payment methods (admin only)
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
 *                       - $ref: '#/components/schemas/CoFounderTransaction'
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
 *                           paymentProofUrl:
 *                             type: string
 *                             example: "/cofounder/payment-proof/CFD-A1B2-123456"
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
router.get('/admin/transactions', protect, adminProtect, coFounderController.getAllCoFounderTransactions);

/**
 * @swagger
 * /cofounder/admin/statistics:
 *   get:
 *     tags: [Co-Founder - Admin]
 *     summary: Get co-founder share statistics
 *     description: Get comprehensive co-founder share and transaction statistics (admin only)
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
 *                       example: 1000
 *                       description: Total co-founder shares available
 *                     sharesSold:
 *                       type: integer
 *                       example: 250
 *                       description: Number of co-founder shares sold
 *                     sharesRemaining:
 *                       type: integer
 *                       example: 750
 *                       description: Number of co-founder shares remaining
 *                     investorCount:
 *                       type: integer
 *                       example: 50
 *                       description: Number of co-founder investors
 *                     transactions:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           _id:
 *                             type: string
 *                             example: "naira"
 *                           totalAmount:
 *                             type: number
 *                             example: 25000000
 *                           totalShares:
 *                             type: integer
 *                             example: 200
 *                 pricing:
 *                   type: object
 *                   properties:
 *                     priceNaira:
 *                       type: number
 *                       example: 100000
 *                     priceUSDT:
 *                       type: number
 *                       example: 100
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/admin/statistics', protect, adminProtect, coFounderController.getCoFounderShareStatistics);

// ===========================================
// ADMIN MANUAL PAYMENT ROUTES
// ===========================================

/**
 * @swagger
 * /cofounder/admin/manual/transactions:
 *   get:
 *     tags: [Co-Founder - Admin Manual Payment]
 *     summary: Get manual payment transactions for co-founder shares
 *     description: Get all manual payment transactions for co-founder shares (admin only)
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
 *                       - $ref: '#/components/schemas/CoFounderTransaction'
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
 *                           paymentProofUrl:
 *                             type: string
 *                             example: "/cofounder/payment-proof/CFD-A1B2-123456"
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
router.get('/admin/manual/transactions', protect, adminProtect, coFounderController.adminGetCoFounderManualTransactions);

/**
 * @swagger
 * /cofounder/admin/manual/verify:
 *   post:
 *     tags: [Co-Founder - Admin Manual Payment]
 *     summary: Verify manual payment for co-founder shares
 *     description: Approve or reject a manual payment transaction for co-founder shares (admin only)
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
 *                 example: "CFD-A1B2-123456"
 *                 description: Co-founder transaction ID
 *               approved:
 *                 type: boolean
 *                 example: true
 *                 description: Whether to approve or reject the payment
 *               adminNote:
 *                 type: string
 *                 example: "Payment verified through bank statement"
 *                 description: Admin note about the verification
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
router.post('/admin/manual/verify', protect, adminProtect, coFounderController.adminVerifyCoFounderManualPayment);

/**
 * @swagger
 * /cofounder/admin/manual/cancel:
 *   post:
 *     tags: [Co-Founder - Admin Manual Payment]
 *     summary: Cancel manual payment for co-founder shares
 *     description: Cancel a completed manual payment transaction for co-founder shares (admin only)
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
 *                 example: "CFD-A1B2-123456"
 *                 description: Co-founder transaction ID
 *               cancelReason:
 *                 type: string
 *                 example: "Duplicate transaction detected"
 *                 description: Reason for cancelling the payment
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
router.post('/admin/manual/cancel', protect, adminProtect, coFounderController.adminCancelCoFounderManualPayment);

/**
 * @swagger
 * /cofounder/admin/manual/{transactionId}:
 *   delete:
 *     tags: [Co-Founder - Admin Manual Payment]
 *     summary: Delete manual payment transaction for co-founder shares
 *     description: Permanently delete a manual payment transaction for co-founder shares (admin only). This will remove the transaction completely, rollback shares if it was completed, delete payment proof files, and reverse any referral commissions.
 *     security:
 *       - adminAuth: []
 *     parameters:
 *       - in: path
 *         name: transactionId
 *         required: true
 *         schema:
 *           type: string
 *         description: Co-founder transaction ID to delete
 *         example: "CFD-A1B2-123456"
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
 *                   example: "Co-founder manual payment transaction deleted successfully"
 *                 data:
 *                   type: object
 *                   properties:
 *                     transactionId:
 *                       type: string
 *                       example: "CFD-A1B2-123456"
 *                     deletedTransaction:
 *                       type: object
 *                       properties:
 *                         shares:
 *                           type: integer
 *                           example: 5
 *                         amount:
 *                           type: number
 *                           example: 500000
 *                         currency:
 *                           type: string
 *                           example: "naira"
 *                         previousStatus:
 *                           type: string
 *                           example: "completed"
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
router.delete('/admin/manual/:transactionId', protect, adminProtect, coFounderController.adminDeleteCoFounderManualPayment);

/**
 * @swagger
 * /cofounder/admin/manual/pending:
 *   get:
 *     tags: [Co-Founder - Admin Manual Payment]
 *     summary: Get pending manual payments for co-founder shares
 *     description: Get all pending manual payment transactions for co-founder shares (admin only)
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
 *     responses:
 *       200:
 *         description: Pending manual payments retrieved successfully
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
 *                     $ref: '#/components/schemas/CoFounderTransaction'
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
router.get('/admin/manual/pending', protect, adminProtect, coFounderController.getCoFounderPendingManualPayments);

/**
 * @swagger
 * /cofounder/admin/manual/approve/{transactionId}:
 *   post:
 *     tags: [Co-Founder - Admin Manual Payment]
 *     summary: Approve manual payment for co-founder shares
 *     description: Approve a pending manual payment transaction for co-founder shares (admin only)
 *     security:
 *       - adminAuth: []
 *     parameters:
 *       - in: path
 *         name: transactionId
 *         required: true
 *         schema:
 *           type: string
 *         description: Co-founder transaction ID
 *         example: "CFD-A1B2-123456"
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               adminNote:
 *                 type: string
 *                 example: "Payment verified through bank statement"
 *                 description: Admin note about the approval
 *     responses:
 *       200:
 *         description: Manual payment approved successfully
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
 *       401:
 *         $ref: '#/components/responses/Unauthorize
 * 401:
         $ref: '#/components/responses/UnauthorizedError'
       403:
         $ref: '#/components/responses/ForbiddenError'
       404:
         $ref: '#/components/responses/NotFoundError'
       500:
         $ref: '#/components/responses/ServerError'
 */
router.post('/admin/manual/approve/:transactionId', protect, adminProtect, coFounderController.approveCoFounderManualPayment);

/**
 * @swagger
 * /cofounder/admin/manual/reject/{transactionId}:
 *   post:
 *     tags: [Co-Founder - Admin Manual Payment]
 *     summary: Reject manual payment for co-founder shares
 *     description: Reject a pending manual payment transaction for co-founder shares (admin only)
 *     security:
 *       - adminAuth: []
 *     parameters:
 *       - in: path
 *         name: transactionId
 *         required: true
 *         schema:
 *           type: string
 *         description: Co-founder transaction ID
 *         example: "CFD-A1B2-123456"
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               adminNote:
 *                 type: string
 *                 example: "Payment proof insufficient"
 *                 description: Admin note about the rejection
 *     responses:
 *       200:
 *         description: Manual payment rejected successfully
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
 *                   example: "Manual payment rejected successfully"
 *                 status:
 *                   type: string
 *                   example: "failed"
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/admin/manual/reject/:transactionId', protect, adminProtect, coFounderController.rejectCoFounderManualPayment);

/**
 * @swagger
 * /cofounder/admin/manual/all:
 *   get:
 *     tags: [Co-Founder - Admin Manual Payment]
 *     summary: Get all manual payments for co-founder shares
 *     description: Get all manual payment transactions for co-founder shares with filtering options (admin only)
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
 *     responses:
 *       200:
 *         description: All manual payments retrieved successfully
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
 *                     $ref: '#/components/schemas/CoFounderTransaction'
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
router.get('/admin/manual/all', protect, adminProtect, coFounderController.getAllCoFounderManualPayments);

// ===========================================
// LEGACY/COMPATIBILITY ROUTES
// ===========================================

/**
 * @swagger
 * /cofounder/manual/initiate:
 *   post:
 *     tags: [Co-Founder - Manual Payment]
 *     summary: Initiate manual payment (Legacy)
 *     description: Legacy endpoint for initiating manual payment - use /manual/submit instead
 *     security:
 *       - bearerAuth: []
 *     deprecated: true
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - quantity
 *               - currency
 *               - paymentMethod
 *             properties:
 *               quantity:
 *                 type: integer
 *                 minimum: 1
 *                 example: 5
 *               currency:
 *                 type: string
 *                 enum: [naira, usdt]
 *                 example: "naira"
 *               paymentMethod:
 *                 type: string
 *                 enum: [bank_transfer, cash, other]
 *                 example: "bank_transfer"
 *     responses:
 *       200:
 *         description: Manual payment initiated (Legacy response)
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
 *                   example: "Manual payment initiated. Please upload payment proof."
 *                 data:
 *                   type: object
 *                   properties:
 *                     transactionId:
 *                       type: string
 *                       example: "CFD-A1B2-123456"
 *                     instructions:
 *                       type: string
 *                       example: "Please make payment and upload proof using the upload endpoint"
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/manual/initiate', protect, coFounderController.initiateCoFounderManualPayment);

/**
 * @swagger
 * /cofounder/manual/upload:
 *   post:
 *     tags: [Co-Founder - Manual Payment]
 *     summary: Upload payment proof (Legacy)
 *     description: Legacy endpoint for uploading payment proof - use /manual/submit instead
 *     security:
 *       - bearerAuth: []
 *     deprecated: true
 *     responses:
 *       200:
 *         description: Legacy endpoint notice
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
 *                   example: "Please use the manual payment submission endpoint with payment proof"
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/manual/upload', protect, coFounderController.uploadCoFounderPaymentProof);

// ===========================================
// EXPORT ROUTER
// ===========================================

module.exports = router;