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
const validateManualPayment = (req, res, next) => {
  console.log('\n=== VALIDATION MIDDLEWARE (CLOUDINARY) ===');
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
  
  // Check if Cloudinary file was uploaded
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

// Request debugging middleware
const debugRequest = (req, res, next) => {
  console.log('\n=== MANUAL PAYMENT REQUEST DEBUG (CLOUDINARY) ===');
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
    size: req.file.size,
    cloudinaryUrl: req.file.path,
    publicId: req.file.filename
  } : 'No file');
  console.log('Body content:', req.body);
  console.log('=====================================\n');
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
 *     summary: Submit manual payment with Cloudinary
 *     description: |
 *       Submit a manual payment with proof stored in Cloudinary CDN.
 *       
 *       **IMPROVED FEATURES:**
 *       - ✅ Files stored on Cloudinary CDN (fast global access)
 *       - ✅ Automatic image optimization and compression
 *       - ✅ Support for images and PDFs
 *       - ✅ No server storage issues
 *       - ✅ Reliable file serving
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
 *                 description: Payment proof image/PDF (max 5MB) - uploaded to Cloudinary
 *     responses:
 *       200:
 *         description: Manual payment submitted successfully to Cloudinary
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
 *                     cloudinaryUrl:
 *                       type: string
 *                       example: "https://res.cloudinary.com/your-cloud/image/upload/v1234567890/share-payments/payment-123456.jpg"
 *                       description: Direct URL to the uploaded file on Cloudinary
 *                     publicId:
 *                       type: string
 *                       example: "share-payments/payment-1234567890-123456"
 *                       description: Cloudinary public ID for file management
 */
router.post('/manual/submit', 
  protect,  // 🔥 ADD THIS LINE - Authentication middleware MUST come first!
  sharePaymentUpload.single('paymentProof'),
  logCloudinaryUpload,
  handleCloudinaryError,
  shareController.submitManualPayment
);


/**
 * @swagger
 * /shares/payment-proof/{transactionId}:
 *   get:
 *     tags: [Shares - Manual Payment]
 *     summary: Get payment proof from Cloudinary
 *     description: |
 *       Retrieve payment proof image from Cloudinary CDN for a transaction.
 *       
 *       **IMPROVED FEATURES:**
 *       - ✅ Fast global CDN delivery
 *       - ✅ Automatic image optimization
 *       - ✅ Reliable file serving
 *       - ✅ No server load for file serving
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
 *         description: Payment proof URL retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 cloudinaryUrl:
 *                   type: string
 *                   example: "https://res.cloudinary.com/your-cloud/image/upload/v1234567890/share-payments/payment-123456.jpg"
 *                   description: Direct URL to access the file from Cloudinary
 *                 publicId:
 *                   type: string
 *                   example: "share-payments/payment-1234567890-123456"
 *                 originalName:
 *                   type: string
 *                   example: "receipt.jpg"
 *                 fileSize:
 *                   type: integer
 *                   example: 1024576
 *                 format:
 *                   type: string
 *                   example: "jpg"
 *                 directAccess:
 *                   type: string
 *                   example: "You can access this file directly at the cloudinaryUrl"
 *       302:
 *         description: Redirect to Cloudinary URL (alternative response)
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         description: Access denied - user doesn't own this transaction
 *       404:
 *         description: Transaction or file not found
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/payment-proof/:transactionId', protect, shareController.getPaymentProof);

// Admin routes

/**
 * @swagger
 * /shares/admin/payment-proof/{transactionId}:
 *   get:
 *     tags: [Shares - Admin]
 *     summary: Direct admin access to payment proof file
 *     description: |
 *       Provides direct access to payment proof files for administrators. This endpoint redirects directly 
 *       to the Cloudinary CDN URL for fast file viewing without API overhead.
 *       
 *       **Key Features:**
 *       - ✅ Direct redirect to Cloudinary CDN URL
 *       - ✅ Admin-only access with authentication
 *       - ✅ No JSON wrapper - direct file access
 *       - ✅ Fast loading from global CDN
 *       - ✅ Works with images, PDFs, and other file types
 *       - ✅ Automatic error handling for missing files
 *       
 *       **Use Cases:**
 *       - Quick admin verification of payment proofs
 *       - Opening files directly in browser tabs
 *       - Bypassing API response parsing for immediate access
 *       - Fallback when main API endpoint has issues
 *       
 *       **Response Behavior:**
 *       - Success: 302 redirect to Cloudinary URL
 *       - Not Found: 404 JSON error response
 *       - Unauthorized: 403 JSON error response
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: transactionId
 *         required: true
 *         schema:
 *           type: string
 *           pattern: '^TXN-[A-F0-9]{8}-[0-9]{6}$'
 *           example: "TXN-A1B2C3D4-123456"
 *         description: |
 *           Unique transaction identifier for the manual payment.
 *           Format: TXN-{8 hex chars}-{6 digits}
 *     responses:
 *       302:
 *         description: |
 *           Redirect to Cloudinary CDN URL for direct file access.
 *           Browser will automatically navigate to the payment proof file.
 *         headers:
 *           Location:
 *             description: Cloudinary CDN URL for the payment proof file
 *             schema:
 *               type: string
 *               format: url
 *               example: "https://res.cloudinary.com/your-cloud/image/upload/v1234567890/share-payments/payment-proof-123456.jpg"
 *       403:
 *         description: |
 *           Access denied - Admin authentication required.
 *           This endpoint is restricted to administrators only.
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
 *                   example: "Admin access required"
 *             examples:
 *               not_admin:
 *                 summary: User is not an administrator
 *                 value:
 *                   success: false
 *                   message: "Admin access required"
 *               no_auth:
 *                 summary: No authentication token provided
 *                 value:
 *                   success: false
 *                   message: "Authentication required"
 *       404:
 *         description: |
 *           Payment proof not found. The file may not exist or was never uploaded.
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
 *                   example: "Payment proof not found"
 *             examples:
 *               transaction_not_found:
 *                 summary: Transaction does not exist
 *                 value:
 *                   success: false
 *                   message: "Transaction not found"
 *               file_not_uploaded:
 *                 summary: No payment proof file was uploaded
 *                 value:
 *                   success: false
 *                   message: "Payment proof not found"
 *               file_deleted:
 *                 summary: File was deleted from Cloudinary
 *                 value:
 *                   success: false
 *                   message: "Payment proof file no longer available"
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       500:
 *         description: |
 *           Server error during file access. May indicate Cloudinary connectivity issues.
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
 *                   example: "Failed to access payment proof"
 *             examples:
 *               cloudinary_error:
 *                 summary: Cloudinary service unavailable
 *                 value:
 *                   success: false
 *                   message: "Failed to access payment proof"
 *               database_error:
 *                 summary: Database connectivity issue
 *                 value:
 *                   success: false
 *                   message: "Database error while retrieving transaction"
 *   
 *     x-code-samples:
 *       - lang: 'JavaScript (Frontend)'
 *         source: |
 *           // Open payment proof directly in new tab
 *           const viewPaymentProofDirect = (transactionId) => {
 *             const url = `/api/shares/admin/payment-proof/${transactionId}`;
 *             window.open(url, '_blank');
 *           };
 *           
 *           // Usage in admin component
 *           <button onClick={() => viewPaymentProofDirect('TXN-A1B2C3D4-123456')}>
 *             🔗 View Direct
 *           </button>
 *       
 *       - lang: 'cURL'
 *         source: |
 *           # Direct access with redirect following
 *           curl -L -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
 *             "https://your-api.com/api/shares/admin/payment-proof/TXN-A1B2C3D4-123456"
 *           
 *           # Check redirect location without following
 *           curl -I -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
 *             "https://your-api.com/api/shares/admin/payment-proof/TXN-A1B2C3D4-123456"
 *       
 *       - lang: 'Node.js/Axios'
 *         source: |
 *           // Get redirect URL programmatically
 *           try {
 *             const response = await axios.get(
 *               `/api/shares/admin/payment-proof/${transactionId}`,
 *               { 
 *                 headers: { Authorization: `Bearer ${adminToken}` },
 *                 maxRedirects: 0,  // Don't follow redirects
 *                 validateStatus: (status) => status === 302
 *               }
 *             );
 *             
 *             const cloudinaryUrl = response.headers.location;
 *             console.log('Cloudinary URL:', cloudinaryUrl);
 *           } catch (error) {
 *             if (error.response?.status === 302) {
 *               // Redirect URL is in the Location header
 *               const cloudinaryUrl = error.response.headers.location;
 *             }
 *           }
 *
 * components:
 *   examples:
 *     AdminDirectAccessSuccess:
 *       summary: Successful redirect to Cloudinary
 *       description: |
 *         When a payment proof exists, the endpoint returns a 302 redirect
 *         to the Cloudinary CDN URL for immediate file access.
 *       value:
 *         status: 302
 *         headers:
 *           Location: "https://res.cloudinary.com/your-cloud/image/upload/v1234567890/share-payments/payment-proof-123456.jpg"
 *     
 *     AdminDirectAccessNotFound:
 *       summary: Payment proof not found
 *       description: |
 *         When no payment proof exists for the transaction, returns 404 with error details.
 *       value:
 *         success: false
 *         message: "Payment proof not found"
 *         transactionId: "TXN-A1B2C3D4-123456"
 *         suggestion: "Verify the transaction ID and check if a payment proof was uploaded"
 *
 *   responses:
 *     CloudinaryRedirect:
 *       description: |
 *         Successful redirect to Cloudinary CDN for direct file access.
 *         The browser will automatically navigate to display the payment proof file.
 *       headers:
 *         Location:
 *           description: Direct URL to the payment proof file on Cloudinary CDN
 *           schema:
 *             type: string
 *             format: url
 *             example: "https://res.cloudinary.com/your-cloud/image/upload/v1234567890/share-payments/payment-proof-123456.jpg"
 *         Cache-Control:
 *           description: Caching instructions for the redirect
 *           schema:
 *             type: string
 *             example: "no-cache, no-store, must-revalidate"
 *         X-Cloudinary-Public-Id:
 *           description: Cloudinary public ID for the file (optional)
 *           schema:
 *             type: string
 *             example: "share-payments/payment-proof-1234567890-123456"
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
 *                     type: object
 *                     properties:
 *                       transactionId:
 *                         type: string
 *                         example: "TXN-A1B2-123456"
 *                       shares:
 *                         type: integer
 *                         example: 50
 *                       totalAmount:
 *                         type: number
 *                         example: 50000
 *                       currency:
 *                         type: string
 *                         enum: [naira, usd]
 *                         example: "naira"
 *                       status:
 *                         type: string
 *                         enum: [pending, completed, failed]
 *                         example: "pending"
 *                       date:
 *                         type: string
 *                         format: date-time
 *                         example: "2024-01-15T10:30:00Z"
 *                       user:
 *                         type: object
 *                         properties:
 *                           id:
 *                             type: string
 *                             example: "user123"
 *                           name:
 *                             type: string
 *                             example: "John Doe"
 *                           username:
 *                             type: string
 *                             example: "johndoe"
 *                           email:
 *                             type: string
 *                             example: "john@example.com"
 *                           phone:
 *                             type: string
 *                             example: "+1234567890"
 *                       manualPaymentDetails:
 *                         type: object
 *                         properties:
 *                           reference:
 *                             type: string
 *                             example: "BANK-REF-123456"
 *                           bankName:
 *                             type: string
 *                             example: "First Bank of Nigeria"
 *                           accountName:
 *                             type: string
 *                             example: "John Doe"
 *                       paymentProof:
 *                         type: object
 *                         properties:
 *                           directUrl:
 *                             type: string
 *                             example: "https://res.cloudinary.com/example/image/upload/v123/payment_proof.jpg"
 *                           originalName:
 *                             type: string
 *                             example: "payment_receipt.jpg"
 *                           fileSize:
 *                             type: integer
 *                             example: 1024768
 *                           format:
 *                             type: string
 *                             example: "jpg"
 *                           publicId:
 *                             type: string
 *                             example: "payment_proofs/xyz123"
 *                       paymentProofUrl:
 *                         type: string
 *                         example: "uploads/payment-proofs/payment-1234567890.jpg"
 *                         description: "Legacy field - use paymentProof.directUrl instead"
 *                       cloudinaryPublicId:
 *                         type: string
 *                         example: "payment_proofs/xyz123"
 *                         description: "Legacy field - use paymentProof.publicId instead"
 *                       adminNote:
 *                         type: string
 *                         example: "Payment verified through bank statement"
 *                       verifiedAt:
 *                         type: string
 *                         format: date-time
 *                         example: "2024-01-15T11:00:00Z"
 *                       verifiedBy:
 *                         type: string
 *                         example: "admin123"
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
 *                       example: 100
 *                     limit:
 *                       type: integer
 *                       example: 20
 *                 cloudinaryInfo:
 *                   type: object
 *                   properties:
 *                     accessMethods:
 *                       type: array
 *                       items:
 *                         type: string
 *                       example: ["directUrl", "adminEndpoint"]
 *                     cdnEnabled:
 *                       type: boolean
 *                       example: true
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
// Add these route definitions with Swagger documentation to your routes file

/**
 * @swagger
 * components:
 *   schemas:
 *     CentiivDirectPayRequest:
 *       type: object
 *       required:
 *         - quantity
 *       properties:
 *         quantity:
 *           type: integer
 *           minimum: 1
 *           maximum: 10000
 *           example: 1
 *           description: Number of shares to purchase (amount calculated automatically based on current pricing tiers)
 *         note:
 *           type: string
 *           maxLength: 200
 *           example: "My AfriMobile share purchase"
 *           description: Optional payment note that will appear in the payment interface
 * 
 *     CentiivDirectPayResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: true
 *           description: Indicates if the payment initiation was successful
 *         message:
 *           type: string
 *           example: "Centiiv Direct Pay initiated successfully"
 *           description: Human-readable success message
 *         data:
 *           type: object
 *           properties:
 *             transactionId:
 *               type: string
 *               example: "TXN-6FDB4A4F-553414"
 *               description: Unique transaction identifier for tracking
 *             paymentId:
 *               type: string
 *               example: "69f3fb"
 *               description: Centiiv payment identifier
 *             paymentUrl:
 *               type: string
 *               format: uri
 *               example: "https://centiiv.com/pay?id=69f3fb&type=payment_link"
 *               description: Centiiv payment URL where user should be redirected
 *             amount:
 *               type: number
 *               format: float
 *               example: 50000.00
 *               description: Total amount in Naira calculated from share quantity
 *             shares:
 *               type: integer
 *               example: 1
 *               description: Total shares that will be allocated (same as quantity for regular shares)
 *             quantity:
 *               type: integer
 *               example: 1
 *               description: Original quantity requested by user
 *             callbackUrl:
 *               type: string
 *               format: uri
 *               example: "https://www.afrimobiletech.com/dashboard/shares/payment-success?transaction=TXN-6FDB4A4F-553414&method=centiiv-direct&type=fiat"
 *               description: URL where Centiiv will redirect after payment completion
 *             redirectTo:
 *               type: string
 *               format: uri
 *               example: "https://centiiv.com/pay?id=69f3fb&type=payment_link"
 *               description: URL where frontend should immediately redirect the user
 * 
 *     CentiivDirectPayErrorResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: false
 *           description: Always false for error responses
 *         message:
 *           type: string
 *           example: "Payment service unavailable"
 *           description: Human-readable error message
 *         error:
 *           oneOf:
 *             - type: string
 *               example: "Internal server error"
 *               description: Error message (production)
 *             - type: object
 *               description: Detailed error object (development)
 *         responseData:
 *           type: object
 *           description: Raw API response data for debugging (only in development)
 * 
 * /shares/centiiv/direct-pay:
 *   post:
 *     tags: [Shares - Centiiv Payment]
 *     summary: Initiate Centiiv Direct Pay for Share Purchase
 *     description: |
 *       Creates a direct payment link using Centiiv's Direct Pay API for purchasing AfriMobile shares.
 *       
 *       ## Key Features:
 *       - ✅ **Simplified Input**: Only requires share quantity, automatically calculates amount
 *       - ✅ **Smart Pricing**: Uses current tier-based pricing system
 *       - ✅ **Secure Integration**: Uses Centiiv's secure payment gateway
 *       - ✅ **Automatic Callbacks**: Handles payment status updates via webhooks
 *       - ✅ **Transaction Tracking**: Full audit trail in database
 *       
 *       ## How it Works:
 *       1. **Input**: Provide number of shares to purchase
 *       2. **Calculation**: System calculates total price based on current tiers
 *       3. **Payment Link**: Centiiv generates secure payment URL
 *       4. **Redirect**: User is redirected to Centiiv payment interface
 *       5. **Payment**: User completes payment via bank transfer, card, or other methods
 *       6. **Callback**: Centiiv notifies our system of payment status
 *       7. **Completion**: Shares are allocated upon successful payment
 *       
 *       ## Pricing Tiers:
 *       - **Tier 1**: ₦50,000 per share (limited availability)
 *       - **Tier 2**: ₦75,000 per share (limited availability)  
 *       - **Tier 3**: ₦100,000 per share (general availability)
 *       
 *       ## Payment Methods Supported by Centiiv:
 *       - Bank Transfers
 *       - Credit/Debit Cards
 *       - Mobile Money
 *       - USSD Codes
 *       
 *       ## Response Flow:
 *       ```javascript
 *       // 1. Make API call
 *       POST /api/shares/centiiv/direct-pay
 *       
 *       // 2. Get payment URL in response
 *       { "data": { "redirectTo": "https://centiiv.com/pay?id=..." } }
 *       
 *       // 3. Redirect user to payment URL
 *       window.location.href = response.data.redirectTo;
 *       
 *       // 4. User completes payment
 *       // 5. Centiiv redirects back to callbackUrl
 *       // 6. Check payment status in dashboard
 *       ```
 *       
 *       ## Error Handling:
 *       - **400**: Invalid quantity or validation errors
 *       - **401**: Authentication required
 *       - **500**: Payment service unavailable or configuration issues
 *       
 *       ## Important Notes:
 *       - Payments are processed in Nigerian Naira (₦)
 *       - Minimum purchase: 1 share
 *       - Maximum purchase: 10,000 shares per transaction
 *       - Payment links expire after 24 hours
 *       - Transaction status can be checked via dashboard or webhooks
 *       
 *     operationId: initiateCentiivDirectPay
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CentiivDirectPayRequest'
 *           examples:
 *             singleShare:
 *               summary: Purchase 1 share
 *               description: Basic single share purchase
 *               value:
 *                 quantity: 1
 *                 note: "My first AfriMobile share"
 *             multipleShares:
 *               summary: Purchase 10 shares
 *               description: Multiple shares purchase
 *               value:
 *                 quantity: 10
 *                 note: "Investment in AfriMobile growth"
 *             largeInvestment:
 *               summary: Purchase 100 shares
 *               description: Large investment example
 *               value:
 *                 quantity: 100
 *                 note: "Strategic investment in AfriMobile"
 *     responses:
 *       200:
 *         description: Payment link created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/CentiivDirectPayResponse'
 *             examples:
 *               successResponse:
 *                 summary: Successful payment initiation
 *                 description: Payment link created and ready for user redirect
 *                 value:
 *                   success: true
 *                   message: "Centiiv Direct Pay initiated successfully"
 *                   data:
 *                     transactionId: "TXN-6FDB4A4F-553414"
 *                     paymentId: "69f3fb"
 *                     paymentUrl: "https://centiiv.com/pay?id=69f3fb&type=payment_link"
 *                     amount: 50000.00
 *                     shares: 1
 *                     quantity: 1
 *                     callbackUrl: "https://www.afrimobiletech.com/dashboard/shares/payment-success?transaction=TXN-6FDB4A4F-553414&method=centiiv-direct&type=fiat"
 *                     redirectTo: "https://centiiv.com/pay?id=69f3fb&type=payment_link"
 *       400:
 *         description: Invalid request parameters
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/CentiivDirectPayErrorResponse'
 *             examples:
 *               invalidQuantity:
 *                 summary: Invalid quantity provided
 *                 value:
 *                   success: false
 *                   message: "Please provide a valid quantity of shares"
 *               calculationError:
 *                 summary: Share calculation failed
 *                 value:
 *                   success: false
 *                   message: "Insufficient shares available in current tiers"
 *       401:
 *         description: Authentication required
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
 *                   example: "Access denied. No token provided."
 *       500:
 *         description: Server error or payment service unavailable
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/CentiivDirectPayErrorResponse'
 *             examples:
 *               serviceUnavailable:
 *                 summary: Payment service unavailable
 *                 value:
 *                   success: false
 *                   message: "Payment service unavailable"
 *                   error: "Connection timeout to Centiiv API"
 *               configurationError:
 *                 summary: Service not configured
 *                 value:
 *                   success: false
 *                   message: "Payment service not configured"
 *               invalidResponse:
 *                 summary: Invalid API response
 *                 value:
 *                   success: false
 *                   message: "Invalid payment response"
 *                   responseData:
 *                     success: true
 *                     message: "Payment link created successfully"
 *                     code: "PAYMENT_LINK_CREATED"
 *                     data: {}
 */

router.post('/centiiv/direct-pay', protect, shareController.initiateCentiivDirectPay);

/**
 * @swagger
 * /shares/centiiv/callback:
 *   get:
 *     tags: [Shares - Centiiv Payment]
 *     summary: Centiiv payment callback handler
 *     description: |
 *       Handles payment status callbacks from Centiiv after payment completion.
 *       This endpoint is called automatically by Centiiv and redirects users appropriately.
 *       
 *       **Callback Flow:**
 *       1. User completes payment on Centiiv
 *       2. Centiiv redirects to this callback URL
 *       3. System processes payment result
 *       4. User redirected to success/failure page
 *     parameters:
 *       - in: query
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Centiiv payment ID
 *         example: "f9ab6f"
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *         description: Transaction type
 *         example: "invoice"
 *       - in: query
 *         name: status
 *         required: true
 *         schema:
 *           type: string
 *           enum: [success, failed, cancelled]
 *         description: Payment status from Centiiv
 *         example: "success"
 *       - in: query
 *         name: payment_method
 *         schema:
 *           type: string
 *         description: Payment method used
 *         example: "bank_transfer"
 *       - in: query
 *         name: transaction
 *         schema:
 *           type: string
 *         description: Our internal transaction ID
 *         example: "TXN-A1B2C3D4-123456"
 *     responses:
 *       302:
 *         description: Redirect to success page
 *         headers:
 *           Location:
 *             description: Redirect URL to frontend success page
 *             schema:
 *               type: string
 *               example: "https://yourfrontend.com/dashboard/shares/payment-success?transaction=TXN-A1B2C3D4-123456&method=centiiv&status=success"
 *       200:
 *         description: Callback processed (JSON response for non-success statuses)
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
 *                   example: "Payment failed"
 *                 data:
 *                   type: object
 *                   properties:
 *                     transactionId:
 *                       type: string
 *                     paymentId:
 *                       type: string
 *                     status:
 *                       type: string
 *                     shares:
 *                       type: integer
 *                     amount:
 *                       type: number
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
 *     description: |
 *       Generate crypto payment instructions for share purchase with callback URL support.
 *       
 *       **Crypto Payment Flow:**
 *       1. User submits crypto payment request
 *       2. System generates payment instructions
 *       3. User sends crypto to company wallet
 *       4. User submits transaction hash
 *       5. System verifies on blockchain
 *       6. Automatic redirect on verification
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
 *                 description: Number of shares to purchase
 *               currency:
 *                 type: string
 *                 enum: [usdt, busd]
 *                 default: usdt
 *                 example: "usdt"
 *                 description: Cryptocurrency to use
 *               walletAddress:
 *                 type: string
 *                 example: "0x742d35Cc6643C673532925e2aC5c48C0F30A37a0"
 *                 description: User's wallet address
 *     responses:
 *       200:
 *         description: Crypto payment instructions generated
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
 *                   example: "Crypto payment instructions generated"
 *                 data:
 *                   type: object
 *                   properties:
 *                     transactionId:
 *                       type: string
 *                       example: "TXN-A1B2C3D4-123456"
 *                     paymentInstructions:
 *                       type: object
 *                       properties:
 *                         recipientAddress:
 *                           type: string
 *                           example: "0x742d35Cc6643C673532925e2aC5c48C0F30A37a0"
 *                         amount:
 *                           type: number
 *                           example: 50.25
 *                         currency:
 *                           type: string
 *                           example: "USDT"
 *                         network:
 *                           type: string
 *                           example: "BSC"
 *                         shares:
 *                           type: integer
 *                           example: 50
 *                     callbackUrl:
 *                       type: string
 *                       example: "https://yourfrontend.com/dashboard/shares/payment-success?transaction=TXN-A1B2C3D4-123456&method=centiiv-crypto&type=crypto"
 *                     instructions:
 *                       type: array
 *                       items:
 *                         type: string
 *                       example:
 *                         - "Send exactly 50.25 USDT to: 0x742d35Cc6643C673532925e2aC5c48C0F30A37a0"
 *                         - "Network: BSC (Binance Smart Chain)"
 *                         - "After sending, submit the transaction hash for verification"
 *       400:
 *         description: Crypto payments not available or invalid parameters
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       500:
 *         $ref: '#/components/responses/ServerError'

/**
 * @swagger
 * /shares/centiiv/crypto-verify:
 *   post:
 *     tags: [Shares - Centiiv Payment]
 *     summary: Submit Crypto Transaction Hash
 *     description: |
 *       Submit blockchain transaction hash for verification after making crypto payment.
 *       
 *       **Verification Process:**
 *       1. User submits transaction hash
 *       2. System starts blockchain verification
 *       3. Automatic verification runs in background
 *       4. User receives real-time status updates
 *       5. Redirect on successful verification
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
 *                 description: Internal transaction ID from crypto-pay endpoint
 *               txHash:
 *                 type: string
 *                 example: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef"
 *                 description: Blockchain transaction hash
 *     responses:
 *       200:
 *         description: Transaction hash submitted successfully
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
 *                   example: "Transaction hash submitted successfully. Verification in progress..."
 *                 data:
 *                   type: object
 *                   properties:
 *                     transactionId:
 *                       type: string
 *                       example: "TXN-A1B2C3D4-123456"
 *                     txHash:
 *                       type: string
 *                       example: "0x1234567890abcdef..."
 *                     status:
 *                       type: string
 *                       example: "verifying"
 *                     estimatedVerificationTime:
 *                       type: string
 *                       example: "1-5 minutes"
 *       400:
 *         description: Invalid transaction ID or hash
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       404:
 *         description: Transaction not found
 *       500:
 *         $ref: '#/components/responses/ServerError'

/**
 * @swagger
 * /shares/centiiv/status/{paymentId}:
 *   get:
 *     tags: [Shares - Centiiv Payment]
 *     summary: Get Centiiv Payment Status
 *     description: |
 *       Get current status of a Centiiv payment with real-time updates from Centiiv API.
 *       
 *       **Status Information:**
 *       - Local transaction status
 *       - Live Centiiv payment status
 *       - Payment details and history
 *       - Callback URL information
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: paymentId
 *         required: true
 *         schema:
 *           type: string
 *         description: Centiiv payment ID
 *         example: "f9ab6f"
 *     responses:
 *       200:
 *         description: Payment status retrieved successfully
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
 *                     transactionId:
 *                       type: string
 *                       example: "TXN-A1B2C3D4-123456"
 *                     paymentId:
 *                       type: string
 *                       example: "f9ab6f"
 *                     localStatus:
 *                       type: string
 *                       example: "completed"
 *                       description: Status in our database
 *                     centiivStatus:
 *                       type: object
 *                       properties:
 *                         id:
 *                           type: string
 *                           example: "f9ab6f"
 *                         status:
 *                           type: string
 *                           example: "paid"
 *                         amount:
 *                           type: number
 *                           example: 50000
 *                         createdAt:
 *                           type: string
 *                           format: date-time
 *                         paidAt:
 *                           type: string
 *                           format: date-time
 *                       description: Live status from Centiiv API
 *                     shares:
 *                       type: integer
 *                       example: 50
 *                     amount:
 *                       type: number
 *                       example: 50000
 *                     currency:
 *                       type: string
 *                       example: "naira"
 *                     paymentMethod:
 *                       type: string
 *                       example: "centiiv-direct"
 *                     createdAt:
 *                       type: string
 *                       format: date-time
 *                     callbackUrl:
 *                       type: string
 *                       example: "https://yourfrontend.com/dashboard/shares/payment-success?..."
 *       403:
 *         description: Access denied - user doesn't own this payment
 *       404:
 *         description: Payment not found
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/centiiv/status/:paymentId', protect, shareController.getCentiivPaymentStatus);

/**
 * @swagger
 * /shares/transactions/{transactionId}/status:
 *   get:
 *     tags: [Shares - Transaction Status]
 *     summary: Get Transaction Status
 *     description: |
 *       Get current status of any transaction (Centiiv, PayStack, Web3, Manual, etc.)
 *       
 *       **Supported Transaction Types:**
 *       - Centiiv Direct Pay
 *       - Centiiv Crypto
 *       - Centiiv Invoice
 *       - PayStack
 *       - Web3/Crypto
 *       - Manual Payments
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: transactionId
 *         required: true
 *         schema:
 *           type: string
 *         description: Internal transaction ID
 *         example: "TXN-A1B2C3D4-123456"
 *     responses:
 *       200:
 *         description: Transaction status retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 transaction:
 *                   type: object
 *                   properties:
 *                     transactionId:
 *                       type: string
 *                       example: "TXN-A1B2C3D4-123456"
 *                     status:
 *                       type: string
 *                       enum: [pending, completed, failed, verifying]
 *                       example: "completed"
 *                     shares:
 *                       type: integer
 *                       example: 50
 *                     totalAmount:
 *                       type: number
 *                       example: 50000
 *                     currency:
 *                       type: string
 *                       example: "naira"
 *                     paymentMethod:
 *                       type: string
 *                       example: "centiiv-direct"
 *                     createdAt:
 *                       type: string
 *                       format: date-time
 *                     updatedAt:
 *                       type: string
 *                       format: date-time
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
 *     description: |
 *       Get comprehensive transaction details including user info, payment specifics, and method-specific data.
 *       
 *       **Detailed Information Includes:**
 *       - Complete user information
 *       - Payment method specific details
 *       - Tier breakdown
 *       - Admin notes and actions
 *       - Callback URLs (for Centiiv)
 *       - Blockchain data (for crypto)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: transactionId
 *         required: true
 *         schema:
 *           type: string
 *         description: Internal transaction ID
 *         example: "TXN-A1B2C3D4-123456"
 *     responses:
 *       200:
 *         description: Transaction details retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 transaction:
 *                   type: object
 *                   properties:
 *                     transactionId:
 *                       type: string
 *                       example: "TXN-A1B2C3D4-123456"
 *                     user:
 *                       type: object
 *                       properties:
 *                         id:
 *                           type: string
 *                         name:
 *                           type: string
 *                         email:
 *                           type: string
 *                     shares:
 *                       type: integer
 *                       example: 50
 *                     pricePerShare:
 *                       type: number
 *                       example: 1000
 *                     totalAmount:
 *                       type: number
 *                       example: 50000
 *                     currency:
 *                       type: string
 *                       example: "naira"
 *                     paymentMethod:
 *                       type: string
 *                       example: "centiiv-direct"
 *                     status:
 *                       type: string
 *                       example: "completed"
 *                     createdAt:
 *                       type: string
 *                       format: date-time
 *                     updatedAt:
 *                       type: string
 *                       format: date-time
 *                     centiiv:
 *                       type: object
 *                       properties:
 *                         paymentId:
 *                           type: string
 *                           example: "f9ab6f"
 *                         paymentUrl:
 *                           type: string
 *                         callbackUrl:
 *                           type: string
 *                       description: Present for Centiiv payments
 *                     crypto:
 *                       type: object
 *                       properties:
 *                         fromWallet:
 *                           type: string
 *                         toWallet:
 *                           type: string
 *                         txHash:
 *                           type: string
 *                         network:
 *                           type: string
 *                           example: "BSC"
 *                       description: Present for crypto payments
 *                     tierBreakdown:
 *                       type: object
 *                       properties:
 *                         tier1:
 *                           type: integer
 *                         tier2:
 *                           type: integer
 *                         tier3:
 *                           type: integer
 *                     adminNote:
 *                       type: string
 *                       description: Admin notes if any
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

/**
 * @swagger
 * /shares/admin/centiiv/overview:
 *   get:
 *     tags: [Shares - Admin Centiiv Management]
 *     summary: Complete Centiiv Payment Overview (Admin)
 *     description: |
 *       **COMPREHENSIVE ADMIN OVERVIEW** - View all Centiiv payment activities, workflows, and statuses across the entire project.
 *       
 *       **Complete Visibility:**
 *       - ✅ All Centiiv payment methods (Invoice, Direct Pay, Crypto)
 *       - ✅ Real-time status from Centiiv API
 *       - ✅ Payment workflow tracking
 *       - ✅ Success/failure analytics
 *       - ✅ User behavior insights
 *       - ✅ Financial summaries
 *       - ✅ Payment method performance
 *       - ✅ Callback URL tracking
 *       - ✅ Error analysis and debugging
 *       
 *       **Perfect for:**
 *       - Monitoring overall Centiiv performance
 *       - Identifying payment issues
 *       - Tracking conversion rates
 *       - Financial reporting
 *       - Customer support
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
 *           default: 50
 *         description: Number of records per page
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, completed, failed, verifying]
 *         description: Filter by payment status
 *       - in: query
 *         name: paymentType
 *         schema:
 *           type: string
 *           enum: [centiiv, centiiv-direct, centiiv-crypto, centiiv-invoice]
 *         description: Filter by Centiiv payment type
 *       - in: query
 *         name: fromDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter payments from this date
 *       - in: query
 *         name: toDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter payments to this date
 *       - in: query
 *         name: sortBy
 *         schema:
 *           type: string
 *           enum: [date, amount, status, paymentType]
 *           default: date
 *         description: Sort payments by field
 *       - in: query
 *         name: sortOrder
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *           default: desc
 *         description: Sort order
 *     responses:
 *       200:
 *         description: Centiiv overview data retrieved successfully
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
 *                   example: "Centiiv payment overview retrieved successfully"
 *                 analytics:
 *                   type: object
 *                   properties:
 *                     totalCentiivPayments:
 *                       type: integer
 *                       example: 156
 *                       description: Total Centiiv payments across all types
 *                     paymentMethodBreakdown:
 *                       type: object
 *                       properties:
 *                         centiiv_invoice:
 *                           type: object
 *                           properties:
 *                             count:
 *                               type: integer
 *                               example: 89
 *                             totalAmount:
 *                               type: number
 *                               example: 4450000
 *                             successRate:
 *                               type: number
 *                               example: 78.5
 *                               description: Percentage of successful payments
 *                         centiiv_direct:
 *                           type: object
 *                           properties:
 *                             count:
 *                               type: integer
 *                               example: 45
 *                             totalAmount:
 *                               type: number
 *                               example: 2250000
 *                             successRate:
 *                               type: number
 *                               example: 85.7
 *                         centiiv_crypto:
 *                           type: object
 *                           properties:
 *                             count:
 *                               type: integer
 *                               example: 22
 *                             totalAmount:
 *                               type: number
 *                               example: 1100000
 *                             successRate:
 *                               type: number
 *                               example: 91.2
 *                     statusBreakdown:
 *                       type: object
 *                       properties:
 *                         completed:
 *                           type: integer
 *                           example: 128
 *                         pending:
 *                           type: integer
 *                           example: 15
 *                         failed:
 *                           type: integer
 *                           example: 8
 *                         verifying:
 *                           type: integer
 *                           example: 5
 *                     financialSummary:
 *                       type: object
 *                       properties:
 *                         totalRevenue:
 *                           type: number
 *                           example: 7800000
 *                           description: Total successful payment amount
 *                         averagePaymentAmount:
 *                           type: number
 *                           example: 50000
 *                         totalShares:
 *                           type: integer
 *                           example: 3900
 *                         averageSharesPerPayment:
 *                           type: number
 *                           example: 25
 *                     timeAnalytics:
 *                       type: object
 *                       properties:
 *                         averageCompletionTime:
 *                           type: string
 *                           example: "3.5 minutes"
 *                           description: Average time from initiation to completion
 *                         paymentsLast24h:
 *                           type: integer
 *                           example: 12
 *                         paymentsLast7days:
 *                           type: integer
 *                           example: 45
 *                         paymentsLast30days:
 *                           type: integer
 *                           example: 156
 *                     callbackAnalytics:
 *                       type: object
 *                       properties:
 *                         successfulCallbacks:
 *                           type: integer
 *                           example: 142
 *                         failedCallbacks:
 *                           type: integer
 *                           example: 3
 *                         callbackSuccessRate:
 *                           type: number
 *                           example: 97.9
 *                 payments:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       transactionId:
 *                         type: string
 *                         example: "TXN-A1B2C3D4-123456"
 *                       user:
 *                         type: object
 *                         properties:
 *                           id:
 *                             type: string
 *                           name:
 *user:
                         type: object
                         properties:
                           id:
                             type: string
                           name:
                             type: string
                           email:
                             type: string
                           phone:
                             type: string
                       paymentDetails:
                         type: object
                         properties:
                           shares:
                             type: integer
                             example: 50
                           totalAmount:
                             type: number
                             example: 50000
                           currency:
                             type: string
                             example: "naira"
                           paymentType:
                             type: string
                             enum: [centiiv, centiiv-direct, centiiv-crypto]
                             example: "centiiv-direct"
                           status:
                             type: string
                             enum: [pending, completed, failed, verifying]
                             example: "completed"
                           createdAt:
                             type: string
                             format: date-time
                           completedAt:
                             type: string
                             format: date-time
                       centiivData:
                         type: object
                         properties:
                           paymentId:
                             type: string
                             example: "f9ab6f"
                           orderId:
                             type: string
                             example: "ord_1234567890"
                             description: For invoice payments
                           paymentUrl:
                             type: string
                             example: "https://centiiv.com/pay/f9ab6f"
                           callbackUrl:
                             type: string
                             example: "https://yourfrontend.com/dashboard/shares/payment-success?..."
                           centiivStatus:
                             type: object
                             properties:
                               status:
                                 type: string
                                 example: "paid"
                               lastChecked:
                                 type: string
                                 format: date-time
                             description: Live status from Centiiv API
                       workflowTracking:
                         type: object
                         properties:
                           initiated:
                             type: string
                             format: date-time
                           paymentPageVisited:
                             type: string
                             format: date-time
                           callbackReceived:
                             type: string
                             format: date-time
                           statusUpdated:
                             type: string
                             format: date-time
                           userRedirected:
                             type: string
                             format: date-time
                           sharesAllocated:
                             type: string
                             format: date-time
                       cryptoDetails:
                         type: object
                         properties:
                           fromWallet:
                             type: string
                           toWallet:
                             type: string
                           txHash:
                             type: string
                           network:
                             type: string
                           verificationStatus:
                             type: string
                         description: Present only for crypto payments
                       adminActions:
                         type: array
                         items:
                           type: object
                           properties:
                             action:
                               type: string
                               example: "manual_verification"
                             adminId:
                               type: string
                             note:
                               type: string
                             timestamp:
                               type: string
                               format: date-time
                       issues:
                         type: array
                         items:
                           type: object
                           properties:
                             type:
                               type: string
                               enum: [callback_failed, verification_timeout, api_error, user_abandoned]
                               example: "callback_failed"
                             description:
                               type: string
                               example: "Callback URL returned 404 error"
                             timestamp:
                               type: string
                               format: date-time
                             resolved:
                               type: boolean
                               example: false
                         description: Payment issues and errors
                 filters:
                   type: object
                   properties:
                     applied:
                       type: object
                       properties:
                         status:
                           type: string
                         paymentType:
                           type: string
                         dateRange:
                           type: object
                           properties:
                             from:
                               type: string
                             to:
                               type: string
                     available:
                       type: object
                       properties:
                         statuses:
                           type: array
                           items:
                             type: string
                         paymentTypes:
                           type: array
                           items:
                             type: string
                 pagination:
                   type: object
                   properties:
                     currentPage:
                       type: integer
                     totalPages:
                       type: integer
                     totalRecords:
                       type: integer
                     limit:
                       type: integer
                 recommendations:
                   type: array
                   items:
                     type: object
                     properties:
                       type:
                         type: string
                         enum: [performance, issue_resolution, optimization]
                       priority:
                         type: string
                         enum: [high, medium, low]
                       message:
                         type: string
                       actionRequired:
                         type: boolean
                   example:
                     - type: "performance"
                       priority: "medium" 
                       message: "Centiiv Direct Pay has 85.7% success rate - consider promoting this method"
                       actionRequired: false
                     - type: "issue_resolution"
                       priority: "high"
                       message: "5 payments stuck in 'verifying' status for over 1 hour - requires admin attention"
                       actionRequired: true
       401:
         $ref: '#/components/responses/UnauthorizedError'
       403:
         $ref: '#/components/responses/ForbiddenError'  
       500:
         $ref: '#/components/responses/ServerError'
*/
router.get('/admin/centiiv/overview', protect, adminProtect, shareController.adminGetCentiivOverview);

/**
 * @swagger
 * /shares/admin/centiiv/analytics:
 *   get:
 *     tags: [Shares - Admin Centiiv Management]
 *     summary: Centiiv Analytics Dashboard Data
 *     description: |
 *       **CENTIIV ANALYTICS DASHBOARD** - Get detailed analytics and metrics for all Centiiv payment methods.
 *       
 *       **Analytics Include:**
 *       - 📊 Payment method performance comparison
 *       - 💰 Revenue breakdown by method and time period
 *       - 📈 Conversion rates and success metrics
 *       - ⏱️ Average completion times
 *       - 🔄 Callback success rates
 *       - 👥 User behavior patterns
 *       - 🚨 Issue trending and resolution rates
 *       
 *       **Perfect for:**
 *       - Executive dashboards
 *       - Performance optimization
 *       - Business intelligence
 *       - Payment method comparison
 *     security:
 *       - adminAuth: []
 *     parameters:
 *       - in: query
 *         name: period
 *         schema:
 *           type: string
 *           enum: [7d, 30d, 90d, 365d, all]
 *           default: 30d
 *         description: Analytics time period
 *       - in: query
 *         name: groupBy
 *         schema:
 *           type: string
 *           enum: [day, week, month]
 *           default: day
 *         description: Data grouping for trends
 *     responses:
 *       200:
 *         description: Analytics data retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 analytics:
 *                   type: object
 *                   properties:
 *                     summary:
 *                       type: object
 *                       properties:
 *                         totalPayments:
 *                           type: integer
 *                           example: 1250
 *                         totalRevenue:
 *                           type: number
 *                           example: 62500000
 *                         averagePaymentSize:
 *                           type: number
 *                           example: 50000
 *                         overallSuccessRate:
 *                           type: number
 *                           example: 82.4
 *                     trends:
 *                       type: object
 *                       properties:
 *                         dailyPayments:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               date:
 *                                 type: string
 *                                 format: date
 *                               count:
 *                                 type: integer
 *                               revenue:
 *                                 type: number
 *                               successRate:
 *                                 type: number
 *                         paymentMethodTrends:
 *                           type: object
 *                           properties:
 *                             centiiv_direct:
 *                               type: array
 *                               items:
 *                                 type: object
 *                                 properties:
 *                                   period:
 *                                     type: string
 *                                   count:
 *                                     type: integer
 *                                   successRate:
 *                                     type: number
 *                     comparison:
 *                       type: object
 *                       properties:
 *                         methodPerformance:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               method:
 *                                 type: string
 *                                 example: "centiiv-direct"
 *                               count:
 *                                 type: integer
 *                                 example: 456
 *                               revenue:
 *                                 type: number
 *                                 example: 22800000
 *                               successRate:
 *                                 type: number
 *                                 example: 85.7
 *                               avgCompletionTime:
 *                                 type: string
 *                                 example: "3.2 minutes"
 *                               userSatisfaction:
 *                                 type: number
 *                                 example: 4.2
 *                         vsOtherMethods:
 *                           type: object
 *                           properties:
 *                             centiivVsPaystack:
 *                               type: object
 *                               properties:
 *                                 centiivSuccessRate:
 *                                   type: number
 *                                   example: 82.4
 *                                 paystackSuccessRate:
 *                                   type: number
 *                                   example: 78.9
 *                                 performanceDiff:
 *                                   type: number
 *                                   example: 3.5
 *                     userBehavior:
 *                       type: object
 *                       properties:
 *                         abandonmentRate:
 *                           type: number
 *                           example: 15.2
 *                           description: Percentage of users who start but don't complete payment
 *                         retryRate:
 *                           type: number
 *                           example: 8.7
 *                           description: Percentage of failed payments that are retried
 *                         preferredMethods:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               method:
 *                                 type: string
 *                               percentage:
 *                                 type: number
 *                         averageSessionTime:
 *                           type: string
 *                           example: "4.5 minutes"
 *                     issues:
 *                       type: object
 *                       properties:
 *                         commonIssues:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               type:
 *                                 type: string
 *                                 example: "callback_timeout"
 *                               count:
 *                                 type: integer
 *                                 example: 23
 *                               percentage:
 *                                 type: number
 *                                 example: 1.8
 *                               trend:
 *                                 type: string
 *                                 enum: [increasing, decreasing, stable]
 *                                 example: "decreasing"
 *                         resolutionTimes:
 *                           type: object
 *                           properties:
 *                             average:
 *                               type: string
 *                               example: "2.3 hours"
 *                             median:
 *                               type: string
 *                               example: "45 minutes"
 *                 period:
 *                   type: object
 *                   properties:
 *                     requested:
 *                       type: string
 *                       example: "30d"
 *                     actualStart:
 *                       type: string
 *                       format: date-time
 *                     actualEnd:
 *                       type: string
 *                       format: date-time
       401:
         $ref: '#/components/responses/UnauthorizedError'
       403:
         $ref: '#/components/responses/ForbiddenError'
       500:
         $ref: '#/components/responses/ServerError'
*/router.get('/admin/centiiv/analytics', protect, adminProtect, shareController.getCentiivAnalytics);

/**
 * @swagger
 * /shares/admin/centiiv/troubleshoot:
 *   post:
 *     tags: [Shares - Admin Centiiv Management]
 *     summary: Troubleshoot Centiiv Payment Issues
 *     description: |
 *       **CENTIIV TROUBLESHOOTING TOOL** - Diagnose and resolve payment issues automatically.
 *       
 *       **Troubleshooting Actions:**
 *       - 🔍 Check payment status with Centiiv API
 *       - 🔄 Retry failed callbacks
 *       - ✅ Force status synchronization
 *       - 📧 Resend user notifications
 *       - 🔧 Fix stuck transactions
 *       - 📊 Generate issue reports
 *       
 *       **Use Cases:**
 *       - Fix stuck payments
 *       - Resolve callback issues
 *       - Sync status mismatches
 *       - Customer support
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
 *                 description: Troubleshooting action to perform
 *               transactionId:
 *                 type: string
 *                 example: "TXN-A1B2C3D4-123456"
 *                 description: Specific transaction to troubleshoot (optional for reports)
 *               paymentId:
 *                 type: string
 *                 example: "f9ab6f"
 *                 description: Centiiv payment ID (alternative to transactionId)
 *               bulkTransactionIds:
 *                 type: array
 *                 items:
 *                   type: string
 *                 example: ["TXN-A1B2-123456", "TXN-C3D4-789012"]
 *                 description: Multiple transactions for bulk actions
 *               reportCriteria:
 *                 type: object
 *                 properties:
 *                   issueType:
 *                     type: string
 *                     enum: [callback_failed, stuck_pending, verification_timeout, api_errors]
 *                   dateRange:
 *                     type: object
 *                     properties:
 *                       from:
 *                         type: string
 *                         format: date
 *                       to:
 *                         type: string
 *                         format: date
 *                 description: Criteria for generating issue reports
 *     responses:
 *       200:
 *         description: Troubleshooting action completed successfully
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
 *                   example: "Payment status check completed successfully"
 *                 results:
 *                   type: object
 *                   properties:
 *                     action:
 *                       type: string
 *                       example: "check_status"
 *                     transactionId:
 *                       type: string
 *                       example: "TXN-A1B2C3D4-123456"
 *                     findings:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           type:
 *                             type: string
 *                             enum: [status_mismatch, callback_missing, api_error, resolved]
 *                           description:
 *                             type: string
 *                           severity:
 *                             type: string
 *                             enum: [low, medium, high, critical]
 *                           autoFixed:
 *                             type: boolean
 *                           manualActionRequired:
 *                             type: boolean
 *                       example:
 *                         - type: "status_mismatch"
 *                           description: "Centiiv shows 'paid' but local status is 'pending'"
 *                           severity: "high"
 *                           autoFixed: true
 *                           manualActionRequired: false
 *                     actionsPerformed:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           action:
 *                             type: string
 *                           result:
 *                             type: string
 *                           timestamp:
 *                             type: string
 *                             format: date-time
 *                     recommendedFollowUp:
 *                       type: array
 *                       items:
 *                         type: string
 *                       example:
 *                         - "Monitor transaction for 24 hours"
 *                         - "Contact user to confirm payment receipt"
 *                 bulkResults:
 *                   type: object
 *                   properties:
 *                     processed:
 *                       type: integer
 *                       example: 25
 *                     successful:
 *                       type: integer
 *                       example: 23
 *                     failed:
 *                       type: integer
 *                       example: 2
 *                     summary:
 *                       type: array
 *                       items:
 *                         type: object
 *                   description: Present for bulk operations
 *                 report:
 *                   type: object
 *                   properties:
 *                     issueType:
 *                       type: string
 *                     totalIssues:
 *                       type: integer
 *                     dateRange:
 *                       type: object
 *                     issues:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           transactionId:
 *                             type: string
 *                           issue:
 *                             type: string
 *                           severity:
 *                             type: string
 *                           timestamp:
 *                             type: string
 *                             format: date-time
 *                   description: Present for report generation
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