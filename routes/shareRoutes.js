const express = require('express');
const router = express.Router();
const shareController = require('../controller/shareController');
const { protect, adminProtect } = require('../middleware/auth');
const upload = require('../middleware/upload');
const multer = require('multer');

const logUpload = (req, res, next) => {
  console.log('\n=== UPLOAD MIDDLEWARE DEBUG ===');
  console.log('Method:', req.method);
  console.log('Content-Type:', req.get('Content-Type'));
  console.log('Content-Length:', req.get('Content-Length'));
  
  if (req.file) {
    console.log(`[upload-success] ✅ File uploaded to memory successfully:`);
    console.log(`[upload-success] - Original name: ${req.file.originalname}`);
    console.log(`[upload-success] - Field name: ${req.file.fieldname}`);
    console.log(`[upload-success] - Size: ${req.file.size} bytes`);
    console.log(`[upload-success] - MIME type: ${req.file.mimetype}`);
    console.log(`[upload-success] - Buffer length: ${req.file.buffer ? req.file.buffer.length : 'N/A'} bytes`);
    console.log(`[upload-success] - Ready for storage`);
  } else {
    console.log(`[upload-warning] ⚠️ No file received in upload middleware`);
    console.log('Available fields in req:', Object.keys(req.body || {}));
    console.log('Files in req.files:', req.files);
  }
  console.log('===============================\n');
  next();
};

// Enhanced error handling middleware for multer
const handleUploadError = (err, req, res, next) => {
  console.error('\n=== UPLOAD ERROR HANDLER ===');
  console.error('Error type:', err?.constructor?.name);
  console.error('Error message:', err?.message);
  console.error('Error code:', err?.code);
  console.error('============================\n');

  if (err instanceof multer.MulterError) {
    console.error(`[multer-error] Multer error: ${err.code} - ${err.message}`);
    
    switch (err.code) {
      case 'LIMIT_FILE_SIZE':
        return res.status(400).json({
          success: false,
          message: 'File too large. Maximum size is 5MB.',
          error: 'FILE_TOO_LARGE'
        });
      case 'LIMIT_FILE_COUNT':
        return res.status(400).json({
          success: false,
          message: 'Too many files. Only 1 file allowed.',
          error: 'TOO_MANY_FILES'
        });
      case 'LIMIT_UNEXPECTED_FILE':
        return res.status(400).json({
          success: false,
          message: 'Unexpected file field. Use "paymentProof" field name.',
          error: 'UNEXPECTED_FIELD'
        });
      case 'LIMIT_PART_COUNT':
        return res.status(400).json({
          success: false,
          message: 'Too many form parts.',
          error: 'TOO_MANY_PARTS'
        });
      default:
        return res.status(400).json({
          success: false,
          message: `Upload error: ${err.message}`,
          error: 'MULTER_ERROR'
        });
    }
  } else if (err) {
    console.error(`[upload-error] General upload error: ${err.message}`);
    return res.status(400).json({
      success: false,
      message: err.message || 'File upload failed',
      error: 'UPLOAD_ERROR'
    });
  }
  next();
};

// Request debugging middleware
const debugRequest = (req, res, next) => {
  console.log('\n=== MANUAL PAYMENT REQUEST DEBUG ===');
  console.log('Method:', req.method);
  console.log('URL:', req.url);
  console.log('Headers:', JSON.stringify({
    'content-type': req.headers['content-type'],
    'content-length': req.headers['content-length'],
    'authorization': req.headers.authorization ? '[PRESENT]' : '[MISSING]'
  }, null, 2));
  console.log('Body fields:', Object.keys(req.body || {}));
  console.log('File info:', req.file ? {
    fieldname: req.file.fieldname,
    originalname: req.file.originalname,
    mimetype: req.file.mimetype,
    size: req.file.size
  } : 'No file');
  console.log('Body content:', req.body);
  console.log('=====================================\n');
  next();
};

// Validation middleware for manual payment
const validateManualPayment = (req, res, next) => {
  console.log('\n=== VALIDATION MIDDLEWARE ===');
  console.log('Body:', req.body);
  console.log('File:', req.file);
  
  const { quantity, currency, paymentMethod } = req.body;
  
  // Check required fields
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
  
  // Validate quantity
  const qty = parseInt(quantity);
  if (isNaN(qty) || qty < 1) {
    return res.status(400).json({
      success: false,
      message: 'Invalid quantity. Must be a positive integer.',
      error: 'INVALID_QUANTITY'
    });
  }
  
  // Validate currency
  if (!['naira', 'usdt'].includes(currency.toLowerCase())) {
    return res.status(400).json({
      success: false,
      message: 'Invalid currency. Must be either "naira" or "usdt".',
      error: 'INVALID_CURRENCY'
    });
  }
  
  // Validate payment method
  const validPaymentMethods = ['bank_transfer', 'cash', 'other'];
  if (!validPaymentMethods.includes(paymentMethod)) {
    return res.status(400).json({
      success: false,
      message: `Invalid payment method. Must be one of: ${validPaymentMethods.join(', ')}`,
      error: 'INVALID_PAYMENT_METHOD'
    });
  }
  
  // Check if file is present
  if (!req.file) {
    return res.status(400).json({
      success: false,
      message: 'Payment proof image is required',
      error: 'MISSING_FILE'
    });
  }
  
  console.log('Validation passed');
  console.log('============================\n');
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

/**
 * @swagger
 * /shares/centiiv/initiate:
 *   post:
 *     tags: [Shares - Payment]
 *     summary: Initiate Centiiv payment
 *     description: Initialize a Centiiv invoice for share purchase
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
 *               - customerName
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
 *                 description: Customer's email for invoice
 *               customerName:
 *                 type: string
 *                 example: "John Doe"
 *                 description: Customer's full name for invoice
 *     responses:
 *       200:
 *         description: Centiiv invoice created successfully
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
 *                   example: "Centiiv invoice created successfully"
 *                 data:
 *                   type: object
 *                   properties:
 *                     transactionId:
 *                       type: string
 *                       example: "TXN-A1B2-123456"
 *                       description: Internal transaction reference
 *                     centiivOrderId:
 *                       type: string
 *                       example: "ord_1234567890"
 *                       description: Centiiv order ID
 *                     invoiceUrl:
 *                       type: string
 *                       example: "https://invoice.centiiv.com/pay/ord_1234567890"
 *                       description: URL to redirect user for payment
 *                     amount:
 *                       type: number
 *                       example: 50000
 *                       description: Total amount in Naira
 *                     shares:
 *                       type: integer
 *                       example: 50
 *                       description: Number of shares purchased
 *                     dueDate:
 *                       type: string
 *                       format: date
 *                       example: "2025-08-08"
 *                       description: Payment due date
 *       400:
 *         description: Bad Request - Invalid quantity, email, or customer name
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
 *                   example: "Please provide quantity, email, and customer name"
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/centiiv/initiate', protect, shareController.initiateCentiivPayment);

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
 *                 description: Centiiv order ID
 *               status:
 *                 type: string
 *                 enum: [paid, completed, cancelled, expired, pending]
 *                 example: "paid"
 *                 description: Payment status from Centiiv
 *               amount:
 *                 type: number
 *                 example: 50000
 *                 description: Payment amount
 *               customerEmail:
 *                 type: string
 *                 format: email
 *                 example: "user@example.com"
 *                 description: Customer email
 *               metadata:
 *                 type: object
 *                 description: Additional transaction metadata
 *     responses:
 *       200:
 *         description: Webhook processed successfully
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
 *                   example: "Webhook processed successfully"
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
 *                   example: "Transaction not found"
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

router.post('/manual/submit', 
  protect,                              // Auth middleware first
  debugRequest,                         // Debug incoming request
  upload.single('paymentProof'),        // ✅ NEW: Smart upload middleware
  handleUploadError,                    // Handle multer-specific errors
  logUpload,                           // Log upload details
  validateManualPayment,               // Validate required fields
  shareController.submitManualPayment  // Controller function
);

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
 *         description: Centiiv order ID
 *         example: "ord_1234567890"
 *     responses:
 *       200:
 *         description: Order status retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 orderStatus:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                       example: "ord_1234567890"
 *                     status:
 *                       type: string
 *                       example: "paid"
 *                     amount:
 *                       type: number
 *                       example: 50000
 *                     customerEmail:
 *                       type: string
 *                       example: "user@example.com"
 *                     customerName:
 *                       type: string
 *                       example: "John Doe"
 *                     dueDate:
 *                       type: string
 *                       format: date
 *                       example: "2025-08-08"
 *                     createdAt:
 *                       type: string
 *                       format: date-time
 *                       example: "2025-07-02T10:30:00Z"
 *                     paidAt:
 *                       type: string
 *                       format: date-time
 *                       example: "2025-07-05T14:20:00Z"
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       404:
 *         description: Order not found
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
 *                   example: "Order not found"
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
 *                 description: Internal transaction ID
 *               approved:
 *                 type: boolean
 *                 example: true
 *                 description: Whether to approve or reject the transaction
 *               adminNote:
 *                 type: string
 *                 example: "Payment verified through Centiiv dashboard"
 *                 description: Admin note for the verification action
 *     responses:
 *       200:
 *         description: Centiiv payment verification updated successfully
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
 *                   example: "Centiiv payment approved successfully"
 *                 status:
 *                   type: string
 *                   example: "completed"
 *       400:
 *         description: Bad Request - Transaction already processed or invalid
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
 *                   example: "Transaction already completed"
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
 *                   example: "Centiiv transaction details not found"
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
 *         description: Filter transactions from this date (YYYY-MM-DD)
 *       - in: query
 *         name: toDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter transactions to this date (YYYY-MM-DD)
 *     responses:
 *       200:
 *         description: Centiiv transactions retrieved successfully
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
 *                     type: object
 *                     properties:
 *                       transactionId:
 *                         type: string
 *                         example: "TXN-A1B2-123456"
 *                       centiivOrderId:
 *                         type: string
 *                         example: "ord_1234567890"
 *                       invoiceUrl:
 *                         type: string
 *                         example: "https://invoice.centiiv.com/pay/ord_1234567890"
 *                       user:
 *                         type: object
 *                         properties:
 *                           id:
 *                             type: string
 *                           name:
 *                             type: string
 *                           email:
 *                             type: string
 *                           phone:
 *                             type: string
 *                       shares:
 *                         type: integer
 *                         example: 50
 *                       pricePerShare:
 *                         type: number
 *                         example: 1000
 *                       currency:
 *                         type: string
 *                         example: "naira"
 *                       totalAmount:
 *                         type: number
 *                         example: 50000
 *                       status:
 *                         type: string
 *                         example: "completed"
 *                       date:
 *                         type: string
 *                         format: date-time
 *                         example: "2025-07-02T10:30:00Z"
 *                       adminNote:
 *                         type: string
 *                         example: "Payment verified manually"
 *                 pagination:
 *                   type: object
 *                   properties:
 *                     currentPage:
 *                       type: integer
 *                       example: 1
 *                     totalPages:
 *                       type: integer
 *                       example: 5
 *                     totalCount:
 *                       type: integer
 *                       example: 89
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
 *                       type: object
                             properties:
                               id:
                                 type: string
                               name:
                                 type: string
                               username:
                                 type: string
                               email:
                                 type: string
                               phone:
                                 type: string
                           paymentProofPath:
                             type: string
                             example: "uploads/payment-proofs/payment-1234567890.jpg"
                 pagination:
                   type: object
                   properties:
                     currentPage:
                       type: integer
                     totalPages:
                       type: integer
                     totalCount:
                       type: integer
       401:
         $ref: '#/components/responses/UnauthorizedError'
       403:
         $ref: '#/components/responses/ForbiddenError'
       500:
         $ref: '#/components/responses/ServerError'
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

/**
 * @swagger
 * /shares/admin/debug-transactions/{userId}:
 *   get:
 *     tags: [Shares - Admin Debug]
 *     summary: Debug user transaction statuses
 *     description: Analyze user transactions for status mismatches and issues (admin only)
 *     security:
 *       - adminAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *         description: User ID to debug
 *         example: "60f7c6b4c8f1a2b3c4d5e6f7"
 *     responses:
 *       200:
 *         description: Debug analysis completed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 userId:
 *                   type: string
 *                 analysis:
 *                   type: object
 *                   properties:
 *                     userShareTransactions:
 *                       type: array
 *                     paymentTransactions:
 *                       type: array
 *                     discrepancies:
 *                       type: array
 *                     recommendations:
 *                       type: array
 *                 summary:
 *                   type: object
 *                   properties:
 *                     totalUserShareTransactions:
 *                       type: integer
 *                     totalPaymentTransactions:
 *                       type: integer
 *                     discrepanciesFound:
 *                       type: integer
 *                     suspiciousTransactions:
 *                       type: integer
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       404:
 *         description: User not found
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/admin/debug-transactions/:userId', protect, adminProtect, shareController.debugUserTransactions);

/**
 * @swagger
 * /shares/admin/fix-transaction-statuses/{userId}:
 *   post:
 *     tags: [Shares - Admin Debug]
 *     summary: Fix user transaction status mismatches
 *     description: Synchronize transaction statuses between UserShare and PaymentTransaction models (admin only)
 *     security:
 *       - adminAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *         description: User ID to fix
 *         example: "60f7c6b4c8f1a2b3c4d5e6f7"
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
 *                 description: If true, only shows what would be fixed without making changes
 *     responses:
 *       200:
 *         description: Transaction status fix completed
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
 *                   example: "Dry run completed - no changes made"
 *                 userId:
 *                   type: string
 *                 fixesFound:
 *                   type: integer
 *                 transactionsModified:
 *                   type: integer
 *                 fixes:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       transactionId:
 *                         type: string
 *                       currentUserShareStatus:
 *                         type: string
 *                       paymentTransactionStatus:
 *                         type: string
 *                       recommendedAction:
 *                         type: string
 *                 dryRun:
 *                   type: boolean
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       404:
 *         description: User not found
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/admin/fix-transaction-statuses/:userId', protect, adminProtect, shareController.fixUserTransactionStatuses);

/**
 * @swagger
 * /shares/admin/transaction-comparison/{userId}:
 *   get:
 *     tags: [Shares - Admin Debug]
 *     summary: Compare transaction data sources
 *     description: Compare transaction data between UserShare and PaymentTransaction models (admin only)
 *     security:
 *       - adminAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *         description: User ID to compare
 *         example: "60f7c6b4c8f1a2b3c4d5e6f7"
 *     responses:
 *       200:
 *         description: Transaction comparison completed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 comparison:
 *                   type: object
 *                   properties:
 *                     userId:
 *                       type: string
 *                     userShareTransactions:
 *                       type: object
 *                       properties:
 *                         total:
 *                           type: integer
 *                         regular:
 *                           type: integer
 *                         coFounder:
 *                           type: integer
 *                         byStatus:
 *                           type: object
 *                     paymentTransactions:
 *                       type: object
 *                       properties:
 *                         total:
 *                           type: integer
 *                         byStatus:
 *                           type: object
 *                     currentTotalShares:
 *                       type: integer
 *                     calculatedCompletedShares:
 *                       type: object
 *                     discrepancies:
 *                       type: array
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/admin/transaction-comparison/:userId', protect, adminProtect, shareController.getTransactionComparison);

module.exports = router;