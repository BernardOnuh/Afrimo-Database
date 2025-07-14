// routes/coFounderRoutes.js - CLEAN VERSION WITH COMPLETE SWAGGER DOCUMENTATION
const express = require('express');
const router = express.Router();
const coFounderController = require('../controller/coFounderController');
const { protect, adminProtect } = require('../middleware/auth');
const { 
  cofounderPaymentUpload, 
  logCloudinaryUpload, 
  handleCloudinaryError 
} = require('../config/cloudinary');
const User = require('../models/User');
const PaymentTransaction = require('../models/Transaction');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// ===================================================================
// MULTER CONFIGURATION FOR FILE UPLOADS (FIXED)
// ===================================================================

const storage = multer.diskStorage({
  destination: function(req, file, cb) {
    let uploadDir;
    
    if (process.env.NODE_ENV === 'production') {
      uploadDir = path.join(process.cwd(), 'uploads', 'cofounder-payment-proofs');
    } else {
      uploadDir = 'uploads/cofounder-payment-proofs';
    }
    
    console.log(`[multer] Environment: ${process.env.NODE_ENV}`);
    console.log(`[multer] Target upload directory: ${uploadDir}`);
    
    if (!fs.existsSync(uploadDir)) {
      console.log(`[multer] Creating directory: ${uploadDir}`);
      try {
        fs.mkdirSync(uploadDir, { recursive: true });
        console.log(`[multer] Directory created successfully`);
      } catch (err) {
        console.error(`[multer] Error creating directory: ${err.message}`);
        return cb(err);
      }
    }
    
    try {
      fs.accessSync(uploadDir, fs.constants.W_OK);
      console.log(`[multer] Directory is writable`);
    } catch (err) {
      console.error(`[multer] Directory is not writable: ${err.message}`);
      return cb(new Error('Upload directory is not writable'));
    }
    
    cb(null, uploadDir);
  },
  filename: function(req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname).toLowerCase();
    const filename = 'cofounder-payment-' + uniqueSuffix + ext;
    cb(null, filename);
  }
});

const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('image/') || file.mimetype === 'application/pdf') {
    cb(null, true);
  } else {
    cb(new Error('Only image files and PDFs are allowed'), false);
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
    files: 1
  }
});

const logUpload = (req, res, next) => {
  if (req.file) {
    console.log(`[upload-success] File uploaded: ${req.file.path}, Size: ${req.file.size} bytes`);
    if (fs.existsSync(req.file.path)) {
      req.file.verified = true;
    }
  }
  next();
};

const handleUploadError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    switch (err.code) {
      case 'LIMIT_FILE_SIZE':
        return res.status(400).json({ success: false, message: 'File too large. Maximum size is 5MB.' });
      case 'LIMIT_FILE_COUNT':
        return res.status(400).json({ success: false, message: 'Too many files. Only 1 file allowed.' });
      case 'LIMIT_UNEXPECTED_FILE':
        return res.status(400).json({ success: false, message: 'Unexpected file field. Use "paymentProof" field name.' });
      default:
        return res.status(400).json({ success: false, message: `Upload error: ${err.message}` });
    }
  } else if (err) {
    return res.status(400).json({ success: false, message: err.message || 'File upload failed' });
  }
  next();
}; 

const validateCoFounderManualPayment = (req, res, next) => {
  console.log('\n=== CO-FOUNDER VALIDATION MIDDLEWARE (CLOUDINARY) ===');
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
const debugCoFounderRequest = (req, res, next) => {
  console.log('\n=== CO-FOUNDER MANUAL PAYMENT REQUEST DEBUG (CLOUDINARY) ===');
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


// ===================================================================
// SWAGGER COMPONENT SCHEMAS
// ===================================================================

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
 *               example: 100000
 *             priceUSDT:
 *               type: number
 *               example: 100
 *         availability:
 *           type: object
 *           properties:
 *             totalShares:
 *               type: integer
 *               example: 1000
 *             sharesSold:
 *               type: integer
 *               example: 250
 *             sharesRemaining:
 *               type: integer
 *               example: 750
 * 
 *     CoFounderTransaction:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           example: "60f7c6b4c8f1a2b3c4d5e6f7"
 *         transactionId:
 *           type: string
 *           example: "CFD-A1B2-123456"
 *         user:
 *           type: object
 *           properties:
 *             id:
 *               type: string
 *               example: "60f7c6b4c8f1a2b3c4d5e6f8"
 *             name:
 *               type: string
 *               example: "John Doe"
 *             email:
 *               type: string
 *               example: "john@example.com"
 *             phone:
 *               type: string
 *               example: "+2348123456789"
 *         shares:
 *           type: integer
 *           example: 5
 *         amount:
 *           type: number
 *           example: 500000
 *         currency:
 *           type: string
 *           enum: [naira, usdt]
 *           example: "naira"
 *         paymentMethod:
 *           type: string
 *           enum: [paystack, crypto, bank_transfer, cash, other]
 *           example: "bank_transfer"
 *         status:
 *           type: string
 *           enum: [pending, completed, failed]
 *           example: "pending"
 *         date:
 *           type: string
 *           format: date-time
 *           example: "2024-01-15T10:30:00Z"
 *         paymentProofUrl:
 *           type: string
 *           example: "/cofounder/payment-proof/CFD-A1B2-123456"
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
 *               example: "FBN123456789"
 *         adminNotes:
 *           type: string
 *           example: "Payment verification in progress"
 */

// ===================================================================
// PUBLIC ROUTES
// ===================================================================

/**
 * @swagger
 * /cofounder/info:
 *   get:
 *     tags: [Co-Founder - Public]
 *     summary: Get co-founder share information
 *     description: Get current co-founder share pricing and availability
 *     responses:
 *       200:
 *         description: Share information retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/CoFounderShareInfo'
 *       500:
 *         description: Server error
 */
router.get('/info', coFounderController.getCoFounderShareInfo);

/**
 * @swagger
 * /cofounder/calculate:
 *   post:
 *     tags: [Co-Founder - Public]
 *     summary: Calculate co-founder purchase amount
 *     description: Calculate total amount for specified number of co-founder shares
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [quantity, currency]
 *             properties:
 *               quantity:
 *                 type: integer
 *                 minimum: 1
 *                 example: 5
 *               currency:
 *                 type: string
 *                 enum: [naira, usdt]
 *                 example: "naira"
 *     responses:
 *       200:
 *         description: Calculation successful
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
 *                       example: 100000
 *                     totalPrice:
 *                       type: number
 *                       example: 500000
 *                     currency:
 *                       type: string
 *                       example: "naira"
 *       400:
 *         description: Invalid request parameters
 *       500:
 *         description: Server error
 */
router.post('/calculate', coFounderController.calculateCoFounderPurchase);

/**
 * @swagger
 * /cofounder/payment-config:
 *   get:
 *     tags: [Co-Founder - Public]
 *     summary: Get payment configuration
 *     description: Get available payment methods and configurations
 *     responses:
 *       200:
 *         description: Payment config retrieved successfully
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
 *       500:
 *         description: Server error
 */
router.get('/payment-config', coFounderController.getPaymentConfig);

// ===================================================================
// USER PAYMENT ROUTES
// ===================================================================

/**
 * @swagger
 * /cofounder/paystack/initiate:
 *   post:
 *     tags: [Co-Founder - Payment]
 *     summary: Initiate Paystack payment
 *     description: Initialize Paystack payment for co-founder shares
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [quantity, email]
 *             properties:
 *               quantity:
 *                 type: integer
 *                 minimum: 1
 *                 example: 5
 *               email:
 *                 type: string
 *                 format: email
 *                 example: "user@example.com"
 *     responses:
 *       200:
 *         description: Payment initialized successfully
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
 *                     reference:
 *                       type: string
 *                       example: "CFD-A1B2-123456"
 *                     amount:
 *                       type: number
 *                       example: 500000
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.post('/paystack/initiate', protect, coFounderController.initiateCoFounderPaystackPayment);

/**
 * @swagger
 * /cofounder/paystack/verify/{reference}:
 *   get:
 *     tags: [Co-Founder - Payment]
 *     summary: Verify Paystack payment
 *     description: Verify and complete Paystack payment
 *     parameters:
 *       - in: path
 *         name: reference
 *         required: true
 *         schema:
 *           type: string
 *         description: Payment reference
 *         example: "CFD-A1B2-123456"
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
 *                 shares:
 *                   type: integer
 *                   example: 5
 *                 amount:
 *                   type: number
 *                   example: 500000
 *       400:
 *         description: Verification failed
 *       404:
 *         description: Transaction not found
 *       500:
 *         description: Server error
 */
router.get('/paystack/verify/:reference', coFounderController.verifyCoFounderPaystackPayment);

/**
 * @swagger
 * /cofounder/web3/verify:
 *   post:
 *     tags: [Co-Founder - Payment]
 *     summary: Verify Web3 transaction
 *     description: Submit blockchain transaction for verification
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [transactionHash, amount, currency, shares]
 *             properties:
 *               transactionHash:
 *                 type: string
 *                 example: "0x1234567890abcdef..."
 *               amount:
 *                 type: number
 *                 example: 500
 *               currency:
 *                 type: string
 *                 enum: [usdt, usdc, eth]
 *                 example: "usdt"
 *               shares:
 *                 type: integer
 *                 example: 5
 *     responses:
 *       200:
 *         description: Transaction submitted for verification
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
 *                     status:
 *                       type: string
 *                       example: "pending"
 *                     shares:
 *                       type: integer
 *                       example: 5
 *       400:
 *         description: Invalid parameters
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.post('/web3/verify', protect, coFounderController.verifyWeb3Transaction);

/**
 * @swagger
 * /cofounder/user/shares:
 *   get:
 *     tags: [Co-Founder - User]
 *     summary: Get user's co-founder shares
 *     description: Get current user's co-founder share holdings
 *     security:
 *       - bearerAuth: []
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
 *                   example: 15
 *                 transactions:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/CoFounderTransaction'
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get('/user/shares', protect, coFounderController.getUserCoFounderShares);

// ===================================================================
// MANUAL PAYMENT ROUTES (FIXED)
// ===================================================================

/**
 * @swagger
 * /cofounder/manual/submit:
 *   post:
 *     tags: [Co-Founder - Manual Payment]
 *     summary: Submit co-founder manual payment with Cloudinary
 *     description: |
 *       Submit manual payment with proof for co-founder shares stored on Cloudinary CDN.
 *       
 *       **IMPROVED FEATURES:**
 *       - ✅ Files stored on Cloudinary CDN (fast global access)
 *       - ✅ Automatic image optimization and compression
 *       - ✅ Support for images and PDFs
 *       - ✅ No server storage issues
 *       - ✅ Reliable file serving
 *       - ✅ Enhanced admin visibility and management
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [quantity, currency, paymentMethod, paymentProof]
 *             properties:
 *               quantity:
 *                 type: integer
 *                 minimum: 1
 *                 example: 5
 *                 description: Number of co-founder shares
 *               currency:
 *                 type: string
 *                 enum: [naira, usdt]
 *                 example: "naira"
 *                 description: Payment currency
 *               paymentMethod:
 *                 type: string
 *                 enum: [bank_transfer, cash, other]
 *                 example: "bank_transfer"
 *                 description: Payment method used
 *               bankName:
 *                 type: string
 *                 example: "First Bank of Nigeria"
 *                 description: Bank name (for transfers)
 *               accountName:
 *                 type: string
 *                 example: "John Doe"
 *                 description: Account holder name
 *               reference:
 *                 type: string
 *                 example: "FBN123456789"
 *                 description: Payment reference
 *               paymentProof:
 *                 type: string
 *                 format: binary
 *                 description: Payment proof image/PDF (max 5MB) - uploaded to Cloudinary
 *     responses:
 *       200:
 *         description: Payment submitted successfully to Cloudinary
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
 *                     cloudinaryUrl:
 *                       type: string
 *                       example: "https://res.cloudinary.com/your-cloud/image/upload/v1234567890/cofounder-payments/payment-123456.jpg"
 *                       description: Direct URL to the uploaded file on Cloudinary
 *                     publicId:
 *                       type: string
 *                       example: "cofounder-payments/payment-1234567890-123456"
 *                       description: Cloudinary public ID for file management
 *       400:
 *         description: Bad request - invalid parameters or file upload error
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 *     x-codeSamples:
 *       - lang: 'curl'
 *         source: |
 *           curl -X POST "https://api.afrimobile.com/cofounder/manual/submit" \
 *             -H "Authorization: Bearer YOUR_JWT_TOKEN" \
 *             -F "quantity=5" \
 *             -F "currency=naira" \
 *             -F "paymentMethod=bank_transfer" \
 *             -F "bankName=First Bank" \
 *             -F "accountName=John Doe" \
 *             -F "reference=FBN123456789" \
 *             -F "paymentProof=@/path/to/receipt.jpg"
 */
router.post('/manual/submit', 
  protect, 
  debugCoFounderRequest,                               // Debug incoming request
  cofounderPaymentUpload.single('paymentProof'),      // ✅ NEW: Cloudinary upload middleware
  logCloudinaryUpload,                                 // Log successful upload
  handleCloudinaryError,                               // Handle upload errors
  validateCoFounderManualPayment,                      // Validate required fields and Cloudinary upload
  coFounderController.submitCoFounderManualPayment     // Controller function
);

/**
 * @swagger
 * /cofounder/payment-proof/{transactionId}:
 *   get:
 *     tags: [Co-Founder - Manual Payment]
 *     summary: Get co-founder payment proof from Cloudinary
 *     description: |
 *       Retrieve payment proof image/PDF from Cloudinary CDN for co-founder transaction.
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
 *         example: "CFD-A1B2-123456"
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
 *                   example: "https://res.cloudinary.com/your-cloud/image/upload/v1234567890/cofounder-payments/payment-123456.jpg"
 *                   description: Direct URL to access the file from Cloudinary
 *                 publicId:
 *                   type: string
 *                   example: "cofounder-payments/payment-1234567890-123456"
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
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - not authorized to view this proof
 *       404:
 *         description: Transaction or file not found
 *       500:
 *         description: Server error
 */
router.get('/payment-proof/:transactionId', protect, coFounderController.getCoFounderPaymentProof);

/**
 * @swagger
 * /cofounder/admin/payment-proof/{transactionId}:
 *   get:
 *     tags: [Co-Founder - Admin]
 *     summary: Direct admin access to co-founder payment proof
 *     description: Direct redirect to Cloudinary URL for admin access
 *     security:
 *       - adminAuth: []
 *     parameters:
 *       - in: path
 *         name: transactionId
 *         required: true
 *         schema:
 *           type: string
 *         example: "CFD-A1B2-123456"
 *     responses:
 *       302:
 *         description: Redirect to Cloudinary URL
 *       403:
 *         description: Admin access required
 *       404:
 *         description: Payment proof not found
 */
router.get('/admin/payment-proof/:transactionId', protect, adminProtect, coFounderController.getCoFounderPaymentProofDirect);

/**
 * @swagger
 * /cofounder/manual/status/{transactionId}:
 *   get:
 *     tags: [Co-Founder - Manual Payment]
 *     summary: Get payment status
 *     description: Get status of manual payment transaction
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
 *         description: Status retrieved successfully
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
 *         description: Unauthorized
 *       404:
 *         description: Transaction not found
 *       500:
 *         description: Server error
 */
router.get('/manual/status/:transactionId', protect, coFounderController.getCoFounderManualPaymentStatus);



// ===================================================================
// ADMIN ROUTES
// ===================================================================

/**
 * @swagger
 * /cofounder/admin/web3/verify:
 *   post:
 *     tags: [Co-Founder - Admin]
 *     summary: Admin verify Web3 transaction
 *     description: Manually verify Web3 transaction (admin only)
 *     security:
 *       - adminAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [transactionId, status]
 *             properties:
 *               transactionId:
 *                 type: string
 *                 example: "60f7c6b4c8f1a2b3c4d5e6f7"
 *               status:
 *                 type: string
 *                 enum: [completed, failed]
 *                 example: "completed"
 *               adminNotes:
 *                 type: string
 *                 example: "Transaction verified manually"
 *     responses:
 *       200:
 *         description: Transaction verified successfully
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 *       404:
 *         description: Transaction not found
 *       500:
 *         description: Server error
 */
router.post('/admin/web3/verify', protect, adminProtect, coFounderController.adminVerifyWeb3Transaction);

/**
 * @swagger
 * /cofounder/admin/web3/transactions:
 *   get:
 *     tags: [Co-Founder - Admin]
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
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 *       500:
 *         description: Server error
 */
router.get('/admin/web3/transactions', protect, adminProtect, coFounderController.adminGetWeb3Transactions);

/**
 * @swagger
 * /cofounder/admin/update-pricing:
 *   post:
 *     tags: [Co-Founder - Admin]
 *     summary: Update share pricing
 *     description: Update co-founder share prices (admin only)
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
 *                 minimum: 0.01
 *                 example: 120000
 *               priceUSDT:
 *                 type: number
 *                 minimum: 0.01
 *                 example: 120
 *     responses:
 *       200:
 *         description: Pricing updated successfully
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 *       500:
 *         description: Server error
 */
router.post('/admin/update-pricing', protect, adminProtect, coFounderController.updateCoFounderSharePricing);

/**
 * @swagger
 * /cofounder/admin/add-shares:
 *   post:
 *     tags: [Co-Founder - Admin]
 *     summary: Add shares to user
 *     description: Add co-founder shares directly to user account (admin only)
 *     security:
 *       - adminAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [userId, shares]
 *             properties:
 *               userId:
 *                 type: string
 *                 example: "60f7c6b4c8f1a2b3c4d5e6f7"
 *               shares:
 *                 type: integer
 *                 minimum: 1
 *                 example: 10
 *               note:
 *                 type: string
 *                 example: "Bonus shares for early investor"
 *     responses:
 *       200:
 *         description: Shares added successfully
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 *       404:
 *         description: User not found
 *       500:
 *         description: Server error
 */
router.post('/admin/add-shares', protect, adminProtect, coFounderController.adminAddCoFounderShares);

// CONTINUATION OF coFounderRoutes.js - ADMIN MANUAL PAYMENT ROUTES

/**
 * @swagger
 * /cofounder/admin/update-wallet:
 *   post:
 *     tags: [Co-Founder - Admin]
 *     summary: Update company wallet
 *     description: Update company Web3 wallet address (admin only)
 *     security:
 *       - adminAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [walletAddress]
 *             properties:
 *               walletAddress:
 *                 type: string
 *                 example: "0x742d35Cc6643C673532925e2aC5c48C0F30A37a0"
 *               reason:
 *                 type: string
 *                 example: "Security update"
 *     responses:
 *       200:
 *         description: Wallet updated successfully
 *       400:
 *         description: Invalid wallet address
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 *       500:
 *         description: Server error
 */
router.post('/admin/update-wallet', protect, adminProtect, coFounderController.updateCompanyWallet);

/**
 * @swagger
 * /cofounder/admin/transactions:
 *   get:
 *     tags: [Co-Founder - Admin]
 *     summary: Get all transactions
 *     description: Get all co-founder transactions across all payment methods (admin only)
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
 *           enum: [paystack, crypto, manual_bank_transfer, manual_cash, manual_other]
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
 *           example: "2024-01-01"
 *       - in: query
 *         name: toDate
 *         schema:
 *           type: string
 *           format: date
 *           example: "2024-12-31"
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
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 *       500:
 *         description: Server error
 */
router.get('/admin/transactions', protect, adminProtect, coFounderController.getAllCoFounderTransactions);

/**
 * @swagger
 * /cofounder/admin/statistics:
 *   get:
 *     tags: [Co-Founder - Admin]
 *     summary: Get share statistics
 *     description: Get comprehensive co-founder share statistics (admin only)
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
 *                     sharesSold:
 *                       type: integer
 *                       example: 250
 *                     sharesRemaining:
 *                       type: integer
 *                       example: 750
 *                     investorCount:
 *                       type: integer
 *                       example: 50
 *                     transactions:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           _id:
 *                             type: string
 *                           totalAmount:
 *                             type: number
 *                           totalShares:
 *                             type: integer
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
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 *       500:
 *         description: Server error
 */
router.get('/admin/statistics', protect, adminProtect, coFounderController.getCoFounderShareStatistics);

// ===================================================================
// ADMIN MANUAL PAYMENT ROUTES (FIXED)
// ===================================================================

/**
 * @swagger
 * /cofounder/admin/manual/transactions:
 *   get:
 *     tags: [Co-Founder - Admin Manual Payment]
 *     summary: Get manual payment transactions (FIXED)
 *     description: |
 *       Get all manual payment transactions for co-founder shares (admin only).
 *       
 *       **FIXED ISSUES:**
 *       - ✅ Improved query logic to find manual transactions
 *       - ✅ Enhanced transaction formatting
 *       - ✅ Better pagination and filtering
 *       - ✅ Consistent response structure
 *     security:
 *       - adminAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *           default: 1
 *         example: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 20
 *         example: 20
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, completed, failed]
 *         example: "pending"
 *       - in: query
 *         name: fromDate
 *         schema:
 *           type: string
 *           format: date
 *         example: "2024-01-01"
 *       - in: query
 *         name: toDate
 *         schema:
 *           type: string
 *           format: date
 *         example: "2024-12-31"
 *     responses:
 *       200:
 *         description: Manual transactions retrieved successfully
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
 *                       example: 1
 *                     totalPages:
 *                       type: integer
 *                       example: 5
 *                     totalCount:
 *                       type: integer
 *                       example: 85
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 *       500:
 *         description: Server error
 *     x-codeSamples:
 *       - lang: 'curl'
 *         source: |
 *           curl -X GET "https://api.afrimobile.com/cofounder/admin/manual/transactions?status=pending" \
 *             -H "Authorization: Bearer ADMIN_JWT_TOKEN"
 */
router.get('/admin/manual/transactions', protect, adminProtect, coFounderController.adminGetCoFounderManualTransactions);

/**
 * @swagger
 * /cofounder/admin/manual/verify:
 *   post:
 *     tags: [Co-Founder - Admin Manual Payment]
 *     summary: Verify manual payment (FIXED)
 *     description: |
 *       Approve or reject a manual payment transaction (admin only).
 *       
 *       **FIXED ISSUES:**
 *       - ✅ Uses PaymentTransaction model directly
 *       - ✅ Proper transaction status updates
 *       - ✅ Correct referral commission processing
 *       - ✅ Reliable email notifications
 *     security:
 *       - adminAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [transactionId, approved]
 *             properties:
 *               transactionId:
 *                 type: string
 *                 example: "CFD-A1B2-123456"
 *                 description: Co-founder transaction ID
 *               approved:
 *                 type: boolean
 *                 example: true
 *                 description: Whether to approve (true) or reject (false)
 *               adminNote:
 *                 type: string
 *                 example: "Payment verified through bank statement"
 *                 description: Admin note about the decision
 *     responses:
 *       200:
 *         description: Verification completed successfully
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
 *                   examples:
 *                     approved:
 *                       value: "Manual payment approved successfully"
 *                     rejected:
 *                       value: "Manual payment declined successfully"
 *                 status:
 *                   type: string
 *                   enum: [completed, failed]
 *                   example: "completed"
 *       400:
 *         description: Bad request - transaction already processed
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 *       404:
 *         description: Transaction not found
 *       500:
 *         description: Server error
 *     x-codeSamples:
 *       - lang: 'curl'
 *         source: |
 *           # Approve payment
 *           curl -X POST "https://api.afrimobile.com/cofounder/admin/manual/verify" \
 *             -H "Authorization: Bearer ADMIN_JWT_TOKEN" \
 *             -H "Content-Type: application/json" \
 *             -d '{
 *               "transactionId": "CFD-A1B2-123456",
 *               "approved": true,
 *               "adminNote": "Payment verified"
 *             }'
 *           
 *           # Reject payment
 *           curl -X POST "https://api.afrimobile.com/cofounder/admin/manual/verify" \
 *             -H "Authorization: Bearer ADMIN_JWT_TOKEN" \
 *             -H "Content-Type: application/json" \
 *             -d '{
 *               "transactionId": "CFD-A1B2-123456",
 *               "approved": false,
 *               "adminNote": "Insufficient proof"
 *             }'
 */
router.post('/admin/manual/verify', protect, adminProtect, coFounderController.adminVerifyCoFounderManualPayment);

/**
 * @swagger
 * /cofounder/admin/manual/cancel:
 *   post:
 *     tags: [Co-Founder - Admin Manual Payment]
 *     summary: Cancel manual payment (FIXED)
 *     description: |
 *       Cancel a completed manual payment transaction (admin only).
 *       
 *       This will revert the transaction to pending and rollback:
 *       - ✅ Global share counts
 *       - ✅ User share allocations
 *       - ✅ Referral commissions
 *     security:
 *       - adminAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [transactionId]
 *             properties:
 *               transactionId:
 *                 type: string
 *                 example: "CFD-A1B2-123456"
 *               cancelReason:
 *                 type: string
 *                 example: "Duplicate transaction detected"
 *     responses:
 *       200:
 *         description: Payment cancelled successfully
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
 *         description: Cannot cancel non-completed transaction
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 *       404:
 *         description: Transaction not found
 *       500:
 *         description: Server error
 */
router.post('/admin/manual/cancel', protect, adminProtect, coFounderController.adminCancelCoFounderManualPayment);

/**
 * @swagger
 * /cofounder/admin/manual/{transactionId}:
 *   delete:
 *     tags: [Co-Founder - Admin Manual Payment]
 *     summary: Delete manual payment transaction (FIXED)
 *     description: |
 *       **⚠️ PERMANENT DELETION** - Delete a manual payment transaction (admin only).
 *       
 *       **WARNING**: This action is irreversible and will:
 *       - ✅ Remove transaction from database
 *       - ✅ Rollback shares if completed
 *       - ✅ Delete payment proof files
 *       - ✅ Reverse referral commissions
 *       - ✅ Notify user via email
 *     security:
 *       - adminAuth: []
 *     parameters:
 *       - in: path
 *         name: transactionId
 *         required: true
 *         schema:
 *           type: string
 *         description: Transaction ID to delete
 *         example: "CFD-A1B2-123456"
 *     responses:
 *       200:
 *         description: Transaction deleted successfully
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
 *         description: Missing transaction ID
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 *       404:
 *         description: Transaction not found
 *       500:
 *         description: Server error
 *     x-codeSamples:
 *       - lang: 'curl'
 *         source: |
 *           curl -X DELETE "https://api.afrimobile.com/cofounder/admin/manual/CFD-A1B2-123456" \
 *             -H "Authorization: Bearer ADMIN_JWT_TOKEN"
 */
router.delete('/admin/manual/:transactionId', protect, adminProtect, coFounderController.adminDeleteCoFounderManualPayment);

/**
 * @swagger
 * /cofounder/admin/manual/pending:
 *   get:
 *     tags: [Co-Founder - Admin Manual Payment]
 *     summary: Get pending manual payments
 *     description: Get only pending manual payment transactions (admin only)
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
 *         description: Pending transactions retrieved successfully
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
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 *       500:
 *         description: Server error
 */
router.get('/admin/manual/pending', protect, adminProtect, coFounderController.getCoFounderPendingManualPayments);

/**
 * @swagger
 * /cofounder/admin/manual/approve/{transactionId}:
 *   post:
 *     tags: [Co-Founder - Admin Manual Payment]
 *     summary: Quick approve manual payment
 *     description: Quick approve a pending manual payment (convenience endpoint)
 *     security:
 *       - adminAuth: []
 *     parameters:
 *       - in: path
 *         name: transactionId
 *         required: true
 *         schema:
 *           type: string
 *         example: "CFD-A1B2-123456"
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               adminNote:
 *                 type: string
 *                 example: "Payment verified"
 *     responses:
 *       200:
 *         description: Payment approved successfully
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
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 *       404:
 *         description: Transaction not found
 *       500:
 *         description: Server error
 */
router.post('/admin/manual/approve/:transactionId', protect, adminProtect, coFounderController.approveCoFounderManualPayment);

/**
 * @swagger
 * /cofounder/admin/manual/reject/{transactionId}:
 *   post:
 *     tags: [Co-Founder - Admin Manual Payment]
 *     summary: Quick reject manual payment
 *     description: Quick reject a pending manual payment (convenience endpoint)
 *     security:
 *       - adminAuth: []
 *     parameters:
 *       - in: path
 *         name: transactionId
 *         required: true
 *         schema:
 *           type: string
 *         example: "CFD-A1B2-123456"
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               adminNote:
 *                 type: string
 *                 example: "Insufficient payment proof"
 *     responses:
 *       200:
 *         description: Payment rejected successfully
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
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 *       404:
 *         description: Transaction not found
 *       500:
 *         description: Server error
 */
router.post('/admin/manual/reject/:transactionId', protect, adminProtect, coFounderController.rejectCoFounderManualPayment);

/**
 * @swagger
 * /cofounder/admin/manual/all:
 *   get:
 *     tags: [Co-Founder - Admin Manual Payment]
 *     summary: Get all manual payments
 *     description: Get all manual payment transactions with filtering (admin only)
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
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 *       500:
 *         description: Server error
 */
router.get('/admin/manual/all', protect, adminProtect, coFounderController.getAllCoFounderManualPayments);

// ===================================================================
// DEBUG/TROUBLESHOOTING ROUTES (TEMPORARY)
// ===================================================================

/**
 * @swagger
 * /cofounder/admin/debug/manual:
 *   get:
 *     tags: [Co-Founder - Debug]
 *     summary: Debug manual payment data
 *     description: |
 *       Debug endpoint to analyze manual payment transactions (admin only).
 *       
 *       **Purpose**: Troubleshoot manual payment visibility issues.
 *       
 *       Returns detailed breakdown of transaction data for analysis.
 *     security:
 *       - adminAuth: []
 *     responses:
 *       200:
 *         description: Debug information retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 debug:
 *                   type: object
 *                   properties:
 *                     totalCoFounderTransactions:
 *                       type: integer
 *                       example: 15
 *                     uniquePaymentMethods:
 *                       type: array
 *                       items:
 *                         type: string
 *                       example: ["paystack", "manual_bank_transfer", "crypto"]
 *                     transactionsWithProof:
 *                       type: integer
 *                       example: 5
 *                     potentialManualTransactions:
 *                       type: integer
 *                       example: 5
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 *       500:
 *         description: Server error
 */
router.get('/admin/debug/manual', protect, adminProtect, coFounderController.debugManualTransactions);

/**
 * @swagger
 * /cofounder/admin/debug/all-transactions:
 *   get:
 *     tags: [Co-Founder - Debug]
 *     summary: Debug all transactions
 *     description: Get all co-founder transactions for debugging (admin only)
 *     security:
 *       - adminAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 50
 *           default: 20
 *     responses:
 *       200:
 *         description: Debug data retrieved successfully
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
 *                 summary:
 *                   type: object
 *                   properties:
 *                     total:
 *                       type: integer
 *                     paymentMethods:
 *                       type: array
 *                     statusBreakdown:
 *                       type: array
 *                     paymentMethodBreakdown:
 *                       type: array
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 *       500:
 *         description: Server error
 */
router.get('/admin/debug/all-transactions', protect, adminProtect, async (req, res) => {
  try {
      const adminId = req.user.id;
      const { limit = 20 } = req.query;
      
      // Verify admin
      const admin = await User.findById(adminId);
      if (!admin || !admin.isAdmin) {
          return res.status(403).json({
              success: false,
              message: 'Unauthorized: Admin access required'
          });
      }
      
      // Get all co-founder transactions
      const transactions = await PaymentTransaction.find({ 
          type: 'co-founder' 
      })
      .select('_id transactionId paymentMethod status paymentProofPath createdAt userId shares amount currency')
      .populate('userId', 'name email')
      .sort({ createdAt: -1 })
      .limit(Number(limit));
      
      // Get summary data
      const paymentMethods = await PaymentTransaction.distinct('paymentMethod', { type: 'co-founder' });
      const statusBreakdown = await PaymentTransaction.aggregate([
          { $match: { type: 'co-founder' } },
          { $group: { _id: '$status', count: { $sum: 1 } } }
      ]);
      const paymentMethodBreakdown = await PaymentTransaction.aggregate([
          { $match: { type: 'co-founder' } },
          { $group: { _id: '$paymentMethod', count: { $sum: 1 } } }
      ]);
      
      res.status(200).json({
          success: true,
          transactions: transactions,
          summary: {
              total: transactions.length,
              paymentMethods: paymentMethods,
              statusBreakdown: statusBreakdown,
              paymentMethodBreakdown: paymentMethodBreakdown
          }
      });
      
  } catch (error) {
      console.error('Error in debug all-transactions:', error);
      res.status(500).json({
          success: false,
          message: 'Debug failed',
          error: error.message
      });
  }
});

// CONTINUATION OF coFounderRoutes.js - Part 3: Emergency Fix & Legacy Routes

/**
 * @swagger
 * /cofounder/admin/emergency/fix-payment-methods:
 *   post:
 *     tags: [Co-Founder - Emergency]
 *     summary: Emergency fix for null payment methods
 *     description: |
 *       **⚠️ EMERGENCY ROUTE** - One-time fix for transactions with null paymentMethod values.
 *       
 *       **Purpose**: Fix existing data where manual transactions have `paymentMethod: null`.
 *       
 *       **Usage Steps**:
 *       1. Run with `dryRun: true` to preview changes
 *       2. Review the analysis breakdown
 *       3. Run with `force: true` to apply changes
 *       4. Remove this route after successful fix
 *       
 *       **⚠️ WARNING**: This is a one-time data migration.
 *     security:
 *       - adminAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               dryRun:
 *                 type: boolean
 *                 default: false
 *                 description: Preview changes without applying them
 *                 example: true
 *               force:
 *                 type: boolean
 *                 default: false
 *                 description: Apply the actual fix
 *                 example: false
 *     responses:
 *       200:
 *         description: Emergency fix completed or previewed
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
 *                   examples:
 *                     preview:
 *                       value: "Emergency fix preview. Would update 6 transactions."
 *                     completed:
 *                       value: "Emergency fix completed. Updated 6 transactions."
 *                 data:
 *                   type: object
 *                   properties:
 *                     mode:
 *                       type: string
 *                       enum: ["DRY RUN", "ACTUAL FIX"]
 *                       example: "DRY RUN"
 *                     totalTransactionsFixed:
 *                       type: integer
 *                       example: 6
 *                     totalErrors:
 *                       type: integer
 *                       example: 0
 *                     analysisBreakdown:
 *                       type: object
 *                       properties:
 *                         totalFound:
 *                           type: integer
 *                           example: 6
 *                         setCrypto:
 *                           type: integer
 *                           example: 0
 *                         setPaystack:
 *                           type: integer
 *                           example: 0
 *                         setManual:
 *                           type: integer
 *                           example: 6
 *                         errors:
 *                           type: integer
 *                           example: 0
 *                 warning:
 *                   type: string
 *                   example: "This was a preview. Set force: true to actually apply changes."
 *                 nextSteps:
 *                   type: array
 *                   items:
 *                     type: string
 *                   example: [
 *                     "Review the analysis breakdown",
 *                     "If results look correct, run again with force: true",
 *                     "Test manual transaction visibility after fix"
 *                   ]
 *       400:
 *         description: Fix not confirmed - preview mode
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
 *                   example: "This is an emergency data migration. Set 'force: true' to confirm or 'dryRun: true' to preview."
 *                 preview:
 *                   type: object
 *                   properties:
 *                     transactionsToFix:
 *                       type: integer
 *                       example: 6
 *                     sampleTransactions:
 *                       type: array
 *                       items:
 *                         type: object
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 *       500:
 *         description: Server error
 *     x-codeSamples:
 *       - lang: 'curl'
 *         source: |
 *           # Step 1: Preview what will be fixed
 *           curl -X POST "https://api.afrimobile.com/cofounder/admin/emergency/fix-payment-methods" \
 *             -H "Authorization: Bearer ADMIN_JWT_TOKEN" \
 *             -H "Content-Type: application/json" \
 *             -d '{"dryRun": true}'
 *           
 *           # Step 2: Apply the actual fix
 *           curl -X POST "https://api.afrimobile.com/cofounder/admin/emergency/fix-payment-methods" \
 *             -H "Authorization: Bearer ADMIN_JWT_TOKEN" \
 *             -H "Content-Type: application/json" \
 *             -d '{"force": true}'
 *       - lang: 'JavaScript'
 *         source: |
 *           // Preview the fix first
 *           const previewFix = async () => {
 *             const response = await fetch('/cofounder/admin/emergency/fix-payment-methods', {
 *               method: 'POST',
 *               headers: {
 *                 'Authorization': 'Bearer ' + adminToken,
 *                 'Content-Type': 'application/json'
 *               },
 *               body: JSON.stringify({ dryRun: true })
 *             });
 *             const result = await response.json();
 *             console.log('Preview results:', result);
 *             return result;
 *           };
 *           
 *           // Apply the fix if preview looks good
 *           const applyFix = async () => {
 *             if (confirm('Are you sure you want to apply the emergency fix?')) {
 *               const response = await fetch('/cofounder/admin/emergency/fix-payment-methods', {
 *                 method: 'POST',
 *                 headers: {
 *                   'Authorization': 'Bearer ' + adminToken,
 *                   'Content-Type': 'application/json'
 *                 },
 *                 body: JSON.stringify({ force: true })
 *               });
 *               const result = await response.json();
 *               console.log('Fix applied:', result);
 *             }
 *           };
 */
router.post('/admin/emergency/fix-payment-methods', protect, adminProtect, async (req, res) => {
  try {
      const adminId = req.user.id;
      const { dryRun = false, force = false } = req.body;
      
      // Verify admin
      const admin = await User.findById(adminId);
      if (!admin || !admin.isAdmin) {
          return res.status(403).json({
              success: false,
              message: 'Unauthorized: Admin access required'
          });
      }
      
      console.log('[EMERGENCY FIX] Starting to fix null paymentMethod values...');
      console.log(`[EMERGENCY FIX] Mode: ${dryRun ? 'DRY RUN' : force ? 'ACTUAL FIX' : 'PREVIEW'}`);
      
      // Find all co-founder transactions with null paymentMethod
      const transactionsToFix = await PaymentTransaction.find({
          type: 'co-founder',
          paymentMethod: null
      });
      
      console.log(`[EMERGENCY FIX] Found ${transactionsToFix.length} transactions with null paymentMethod`);
      
      // If not force and not dryRun, show preview only
      if (!force && !dryRun) {
          return res.status(400).json({
              success: false,
              message: "This is an emergency data migration. Set 'force: true' to confirm or 'dryRun: true' to preview.",
              preview: {
                  transactionsToFix: transactionsToFix.length,
                  sampleTransactions: transactionsToFix.slice(0, 3).map(t => ({
                      id: t._id,
                      transactionId: t.transactionId,
                      currentPaymentMethod: t.paymentMethod,
                      hasTransactionHash: !!t.transactionHash,
                      hasReference: !!t.reference,
                      hasPaymentProof: !!t.paymentProofPath,
                      createdAt: t.createdAt
                  }))
              }
          });
      }
      
      let fixedCount = 0;
      let errorCount = 0;
      let analysisBreakdown = {
          totalFound: transactionsToFix.length,
          setCrypto: 0,
          setPaystack: 0,
          setManual: 0,
          errors: 0
      };
      
      for (const transaction of transactionsToFix) {
          try {
              // Determine the likely payment method based on available data
              let newPaymentMethod = 'manual_bank_transfer'; // Default assumption
              
              // If it has a transactionHash, it's probably crypto
              if (transaction.transactionHash) {
                  newPaymentMethod = 'crypto';
                  analysisBreakdown.setCrypto++;
              }
              // If it has a reference field and no transactionHash, probably paystack
              else if (transaction.reference && !transaction.transactionHash) {
                  newPaymentMethod = 'paystack';
                  analysisBreakdown.setPaystack++;
              }
              // If it has paymentProofPath or follows our manual transaction pattern
              else if (transaction.paymentProofPath || 
                       (transaction.transactionId && transaction.transactionId.startsWith('CFD-'))) {
                  newPaymentMethod = 'manual_bank_transfer';
                  analysisBreakdown.setManual++;
              } else {
                  // Default fallback
                  analysisBreakdown.setManual++;
              }
              
              console.log(`[EMERGENCY FIX] Transaction ${transaction._id}: ${transaction.transactionId} -> ${newPaymentMethod}`);
              
              // Only actually update if not a dry run
              if (!dryRun) {
                  await PaymentTransaction.findByIdAndUpdate(transaction._id, {
                      paymentMethod: newPaymentMethod
                  });
              }
              
              fixedCount++;
              
          } catch (updateError) {
              console.error(`[EMERGENCY FIX] Error updating transaction ${transaction._id}:`, updateError);
              errorCount++;
              analysisBreakdown.errors++;
          }
      }
      
      console.log(`[EMERGENCY FIX] ${dryRun ? 'Would have fixed' : 'Successfully fixed'} ${fixedCount} transactions`);
      
      // Verify the fix worked (only if not dry run)
      let verificationQuery = [];
      if (!dryRun) {
          verificationQuery = await PaymentTransaction.find({
              type: 'co-founder',
              paymentMethod: { $regex: /^manual_/i }
          }).select('_id transactionId paymentMethod');
      }
      
      res.status(200).json({
          success: true,
          message: `Emergency fix ${dryRun ? 'preview' : 'completed'}. ${dryRun ? 'Would update' : 'Updated'} ${fixedCount} transactions.`,
          data: {
              mode: dryRun ? 'DRY RUN' : 'ACTUAL FIX',
              totalTransactionsFixed: fixedCount,
              totalErrors: errorCount,
              manualTransactionsNow: verificationQuery.length,
              sampleFixed: verificationQuery.slice(0, 5),
              analysisBreakdown
          },
          warning: dryRun ? 'This was a preview. Set force: true to actually apply changes.' : null,
          nextSteps: dryRun ? [
              'Review the analysis breakdown',
              'If results look correct, run again with force: true',
              'Test manual transaction visibility after fix'
          ] : [
              'Test manual transaction visibility in admin dashboard',
              'Verify admin can approve/reject manual payments',
              'Remove this emergency route after confirming fix worked'
          ]
      });
      
  } catch (error) {
      console.error('[EMERGENCY FIX] Error:', error);
      res.status(500).json({
          success: false,
          message: 'Emergency fix failed',
          error: error.message
      });
  }
});

// ===================================================================
// LEGACY/COMPATIBILITY ROUTES
// ===================================================================

/**
 * @swagger
 * /cofounder/manual/initiate:
 *   post:
 *     tags: [Co-Founder - Legacy]
 *     summary: Initiate manual payment (DEPRECATED)
 *     description: |
 *       **DEPRECATED** - Legacy endpoint for initiating manual payment.
 *       
 *       **⚠️ Use `/cofounder/manual/submit` instead.**
 *       
 *       This endpoint is kept for backward compatibility but will be removed in future versions.
 *     security:
 *       - bearerAuth: []
 *     deprecated: true
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [quantity, currency, paymentMethod]
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
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.post('/manual/initiate', protect, coFounderController.initiateCoFounderManualPayment);

/**
 * @swagger
 * /cofounder/manual/upload:
 *   post:
 *     tags: [Co-Founder - Legacy]
 *     summary: Upload payment proof (DEPRECATED)
 *     description: |
 *       **DEPRECATED** - Legacy endpoint for uploading payment proof.
 *       
 *       **⚠️ Use `/cofounder/manual/submit` instead.**
 *       
 *       This endpoint is kept for backward compatibility but will be removed in future versions.
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
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.post('/manual/upload', protect, coFounderController.uploadCoFounderPaymentProof);

// ===================================================================
// EXPORT ROUTER
// ===================================================================

module.exports = router;

// ===================================================================
// TESTING EXAMPLES FOR SWAGGER UI
// ===================================================================

/*

TESTING WORKFLOW:

1. **Test File Upload (User)**:
   POST /cofounder/manual/submit
   - Use form-data with paymentProof file
   - Should return success with transactionId

2. **Check Admin Visibility**:
   GET /cofounder/admin/manual/transactions
   - Should see the uploaded transaction

3. **View Payment Proof**:
   GET /cofounder/payment-proof/{transactionId}
   - Should return the uploaded image/PDF

4. **Admin Approve/Reject**:
   POST /cofounder/admin/manual/verify
   - Test both approval and rejection

5. **Check Status Update**:
   GET /cofounder/manual/status/{transactionId}
   - Should reflect the admin decision

6. **Debug if Issues**:
   GET /cofounder/admin/debug/manual
   GET /cofounder/admin/debug/all-transactions
   - Use these to troubleshoot data issues

7. **Emergency Fix (if needed)**:
   POST /cofounder/admin/emergency/fix-payment-methods
   - Run with dryRun: true first
   - Then with force: true if needed

SAMPLE CURL COMMANDS:

# 1. Submit manual payment
curl -X POST "https://api.afrimobile.com/cofounder/manual/submit" \
  -H "Authorization: Bearer USER_JWT_TOKEN" \
  -F "quantity=5" \
  -F "currency=naira" \
  -F "paymentMethod=bank_transfer" \
  -F "bankName=First Bank" \
  -F "accountName=John Doe" \
  -F "reference=FBN123456789" \
  -F "paymentProof=@/path/to/receipt.jpg"

# 2. Get admin manual transactions
curl -X GET "https://api.afrimobile.com/cofounder/admin/manual/transactions?status=pending" \
  -H "Authorization: Bearer ADMIN_JWT_TOKEN"

# 3. Approve payment
curl -X POST "https://api.afrimobile.com/cofounder/admin/manual/verify" \
  -H "Authorization: Bearer ADMIN_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "transactionId": "CFD-A1B2-123456",
    "approved": true,
    "adminNote": "Payment verified"
  }'

# 4. Check payment proof
curl -X GET "https://api.afrimobile.com/cofounder/payment-proof/CFD-A1B2-123456" \
  -H "Authorization: Bearer USER_JWT_TOKEN" \
  --output payment-proof.jpg

# 5. Emergency fix (preview first)
curl -X POST "https://api.afrimobile.com/cofounder/admin/emergency/fix-payment-methods" \
  -H "Authorization: Bearer ADMIN_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"dryRun": true}'

JAVASCRIPT EXAMPLES:

// Submit manual payment
const formData = new FormData();
formData.append('quantity', '5');
formData.append('currency', 'naira');
formData.append('paymentMethod', 'bank_transfer');
formData.append('bankName', 'First Bank');
formData.append('accountName', 'John Doe');
formData.append('reference', 'FBN123456789');
formData.append('paymentProof', fileInput.files[0]);

fetch('/cofounder/manual/submit', {
  method: 'POST',
  headers: { 'Authorization': 'Bearer ' + token },
  body: formData
});

// Get admin transactions
fetch('/cofounder/admin/manual/transactions?status=pending', {
  headers: { 'Authorization': 'Bearer ' + adminToken }
})
.then(response => response.json())
.then(data => console.log('Pending transactions:', data.transactions));

// Approve payment
fetch('/cofounder/admin/manual/verify', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ' + adminToken,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    transactionId: 'CFD-A1B2-123456',
    approved: true,
    adminNote: 'Payment verified'
  })
});

*/