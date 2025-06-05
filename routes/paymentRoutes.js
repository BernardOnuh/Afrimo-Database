// routes/paymentRoutes.js
const express = require('express');
const router = express.Router();
const paymentController = require('../controller/paymentController');
const { protect, adminProtect } = require('../middleware/auth');
const multer = require('multer');
const path = require('path');

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/kyc-documents/');
  },
  filename: function (req, file, cb) {
    // Create unique filename with user ID, document type, and timestamp
    const userId = req.user.id;
    const fileExt = path.extname(file.originalname);
    const docType = file.fieldname; // 'governmentId' or 'proofOfAddress'
    cb(null, `${userId}-${docType}-${Date.now()}${fileExt}`);
  }
});

// File filter to allow only images and PDFs
const fileFilter = (req, file, cb) => {
  const allowedTypes = ['image/jpeg', 'image/png', 'application/pdf'];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only JPEG, PNG and PDF are allowed.'), false);
  }
};

const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: fileFilter
});

// ========== BANK VERIFICATION ROUTES ==========

/**
 * @swagger
 * /api/payments/banks:
 *   get:
 *     summary: Get supported banks
 *     description: Retrieve list of all supported banks for account verification and payments
 *     tags: [Banking - Account Verification]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: country
 *         schema:
 *           type: string
 *           enum: [NG, GH, KE, ZA]
 *           default: NG
 *         description: Country code to filter banks
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [commercial, microfinance, all]
 *           default: all
 *         description: Type of banks to retrieve
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search banks by name
 *     responses:
 *       200:
 *         description: Banks retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 banks:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                         description: Bank identifier
 *                         example: "044"
 *                       name:
 *                         type: string
 *                         description: Bank name
 *                         example: "Access Bank"
 *                       code:
 *                         type: string
 *                         description: Bank code
 *                         example: "044"
 *                       slug:
 *                         type: string
 *                         description: Bank slug
 *                         example: "access-bank"
 *                       country:
 *                         type: string
 *                         description: Country code
 *                         example: "NG"
 *                       type:
 *                         type: string
 *                         enum: [commercial, microfinance]
 *                         example: "commercial"
 *                       logo:
 *                         type: string
 *                         description: Bank logo URL
 *                       active:
 *                         type: boolean
 *                         description: Whether bank is active for transactions
 *                 meta:
 *                   type: object
 *                   properties:
 *                     total:
 *                       type: number
 *                       description: Total number of banks
 *                     country:
 *                       type: string
 *                       description: Country filter applied
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get('/banks', protect, paymentController.getBanks);

/**
 * @swagger
 * /api/payments/verify-account:
 *   get:
 *     summary: Verify bank account details
 *     description: Verify bank account number and retrieve account holder information
 *     tags: [Banking - Account Verification]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: accountNumber
 *         required: true
 *         schema:
 *           type: string
 *           pattern: '^[0-9]{10}$'
 *           minLength: 10
 *           maxLength: 10
 *         description: 10-digit bank account number
 *         example: "0123456789"
 *       - in: query
 *         name: bankCode
 *         required: true
 *         schema:
 *           type: string
 *           pattern: '^[0-9]{3}$'
 *         description: 3-digit bank code
 *         example: "044"
 *     responses:
 *       200:
 *         description: Account verified successfully
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
 *                     accountNumber:
 *                       type: string
 *                       example: "0123456789"
 *                     accountName:
 *                       type: string
 *                       example: "JOHN DOE"
 *                     bankName:
 *                       type: string
 *                       example: "Access Bank"
 *                     bankCode:
 *                       type: string
 *                       example: "044"
 *                     verified:
 *                       type: boolean
 *                       example: true
 *                     verificationDate:
 *                       type: string
 *                       format: date-time
 *                 message:
 *                   type: string
 *                   example: "Account verification successful"
 *       400:
 *         description: Invalid account details or verification failed
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
 *                   example: "Invalid account number or bank code"
 *                 error:
 *                   type: string
 *                   example: "ACCOUNT_NOT_FOUND"
 *       401:
 *         description: Unauthorized
 *       422:
 *         description: Validation error
 *       500:
 *         description: Server error
 */
router.get('/verify-account', protect, paymentController.verifyBankAccount);

// ========== USER PAYMENT MANAGEMENT ROUTES ==========

/**
 * @swagger
 * /api/payments/details:
 *   get:
 *     summary: Get user payment details
 *     description: Retrieve authenticated user's payment methods and account information
 *     tags: [User - Payment Management]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Payment details retrieved successfully
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: No payment details found
 */
router.get('/details', protect, paymentController.getPaymentDetails);

/**
 * @swagger
 * /api/payments/bank-account:
 *   post:
 *     summary: Update bank account information
 *     description: Add or update user's bank account details for payments and withdrawals
 *     tags: [User - Payment Management]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - accountNumber
 *               - bankCode
 *               - accountName
 *             properties:
 *               accountNumber:
 *                 type: string
 *                 pattern: '^[0-9]{10}$'
 *                 description: 10-digit bank account number
 *                 example: "0123456789"
 *               bankCode:
 *                 type: string
 *                 pattern: '^[0-9]{3}$'
 *                 description: 3-digit bank code
 *                 example: "044"
 *               accountName:
 *                 type: string
 *                 minLength: 2
 *                 maxLength: 100
 *                 description: Account holder's full name as appears on bank account
 *                 example: "JOHN DOE"
 *               isPrimary:
 *                 type: boolean
 *                 default: true
 *                 description: Set as primary payment method
 *               verifyImmediately:
 *                 type: boolean
 *                 default: true
 *                 description: Verify account details immediately
 *     responses:
 *       200:
 *         description: Bank account updated successfully
 *       400:
 *         description: Invalid bank account details
 *       401:
 *         description: Unauthorized
 *       409:
 *         description: Bank account already exists
 *       422:
 *         description: Validation error
 */
router.post('/bank-account', protect, paymentController.updateBankAccount);

/**
 * @swagger
 * /api/payments/crypto-wallet:
 *   post:
 *     summary: Update cryptocurrency wallet address
 *     description: Add or update user's cryptocurrency wallet for Web3 payments
 *     tags: [User - Payment Management]
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
 *               - walletType
 *             properties:
 *               walletAddress:
 *                 type: string
 *                 description: Cryptocurrency wallet address
 *                 example: "0x742d35Cc6634C0532925a3b8D9Aba3b16730Dc"
 *               walletType:
 *                 type: string
 *                 enum: [ethereum, bitcoin, binance_smart_chain, polygon]
 *                 description: Type of cryptocurrency wallet
 *                 example: "ethereum"
 *               isPrimary:
 *                 type: boolean
 *                 default: false
 *                 description: Set as primary crypto payment method
 *               verifyOwnership:
 *                 type: boolean
 *                 default: false
 *                 description: Initiate wallet ownership verification
 *               supportedTokens:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: List of supported tokens for this wallet
 *                 example: ["ETH", "USDT", "USDC"]
 *     responses:
 *       200:
 *         description: Crypto wallet updated successfully
 *       400:
 *         description: Invalid wallet address or type
 *       401:
 *         description: Unauthorized
 *       409:
 *         description: Wallet address already registered
 *       422:
 *         description: Validation error
 */
router.post('/crypto-wallet', protect, paymentController.updateCryptoWallet);

// ========== KYC DOCUMENT ROUTES ==========

/**
 * @swagger
 * /api/payments/kyc-documents:
 *   post:
 *     summary: Upload KYC documents
 *     description: Submit Know Your Customer (KYC) documents for verification
 *     tags: [User - KYC Verification]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - governmentId
 *               - proofOfAddress
 *             properties:
 *               governmentId:
 *                 type: string
 *                 format: binary
 *                 description: Government-issued ID document (passport, driver's license, national ID)
 *               proofOfAddress:
 *                 type: string
 *                 format: binary
 *                 description: Proof of address document (utility bill, bank statement, etc.)
 *               documentType:
 *                 type: string
 *                 enum: [passport, drivers_license, national_id, voters_card]
 *                 description: Type of government ID being submitted
 *                 example: "national_id"
 *               addressDocumentType:
 *                 type: string
 *                 enum: [utility_bill, bank_statement, rental_agreement, government_letter]
 *                 description: Type of address proof document
 *                 example: "utility_bill"
 *               notes:
 *                 type: string
 *                 maxLength: 500
 *                 description: Additional notes for verification team
 *               consentToProcess:
 *                 type: boolean
 *                 description: Consent to process personal data
 *                 example: true
 *     responses:
 *       201:
 *         description: KYC documents uploaded successfully
 *       400:
 *         description: Invalid file upload or missing documents
 *       401:
 *         description: Unauthorized
 *       409:
 *         description: KYC documents already submitted and pending review
 *       413:
 *         description: File size too large (max 5MB per file)
 *       415:
 *         description: Unsupported file type (only JPEG, PNG, PDF allowed)
 *       422:
 *         description: Validation error
 */
router.post(
  '/kyc-documents',
  protect,
  upload.fields([
    { name: 'governmentId', maxCount: 1 },
    { name: 'proofOfAddress', maxCount: 1 }
  ]),
  paymentController.uploadKycDocuments
);

/**
 * @swagger
 * /api/payments/kyc-status:
 *   get:
 *     summary: Get KYC verification status
 *     description: Retrieve current KYC verification status and submission details
 *     tags: [User - KYC Verification]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: KYC status retrieved successfully
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: No KYC submission found
 */
router.get('/kyc-status', protect, paymentController.getKycStatus);

// ========== ADMIN ROUTES ==========

/**
 * @swagger
 * /api/payments/admin/user-payment-details/{userId}:
 *   get:
 *     summary: Get user payment details (Admin)
 *     description: Retrieve comprehensive payment information for a specific user (admin only)
 *     tags: [Admin - Payment Management]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *         description: User ID to retrieve payment details for
 *         example: "60f7b1b3c9a6b20015f4e8a1"
 *       - in: query
 *         name: includeTransactions
 *         schema:
 *           type: boolean
 *           default: true
 *         description: Include transaction history
 *       - in: query
 *         name: includeKycHistory
 *         schema:
 *           type: boolean
 *           default: true
 *         description: Include complete KYC submission history
 *     responses:
 *       200:
 *         description: User payment details retrieved successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 *       404:
 *         description: User not found
 */
router.get('/admin/user-payment-details/:userId', protect, adminProtect, paymentController.getUserPaymentDetails);

/**
 * @swagger
 * /api/payments/admin/verify-payment-details/{userId}:
 *   put:
 *     summary: Verify user payment details (Admin)
 *     description: Admin verification of user's bank account or crypto wallet details
 *     tags: [Admin - Payment Management]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *         description: User ID whose payment details to verify
 *         example: "60f7b1b3c9a6b20015f4e8a1"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - verificationType
 *               - status
 *             properties:
 *               verificationType:
 *                 type: string
 *                 enum: [bank_account, crypto_wallet]
 *                 description: Type of payment method to verify
 *                 example: "bank_account"
 *               status:
 *                 type: string
 *                 enum: [approved, rejected]
 *                 description: Verification decision
 *                 example: "approved"
 *               paymentMethodId:
 *                 type: string
 *                 description: Specific payment method ID to verify (if user has multiple)
 *               verificationNotes:
 *                 type: string
 *                 maxLength: 1000
 *                 description: Admin notes for verification decision
 *                 example: "Bank account verified successfully through manual check"
 *               riskLevel:
 *                 type: string
 *                 enum: [low, medium, high]
 *                 description: Assigned risk level for this payment method
 *                 example: "low"
 *               limitations:
 *                 type: object
 *                 properties:
 *                   dailyLimit:
 *                     type: number
 *                     description: Daily transaction limit for this method
 *                   monthlyLimit:
 *                     type: number
 *                     description: Monthly transaction limit
 *                   requiresApproval:
 *                     type: boolean
 *                     description: Whether transactions require manual approval
 *               notifyUser:
 *                 type: boolean
 *                 default: true
 *                 description: Send notification to user about verification status
 *     responses:
 *       200:
 *         description: Payment details verification completed successfully
 *       400:
 *         description: Invalid verification data or payment method not found
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 *       404:
 *         description: User or payment method not found
 *       409:
 *         description: Payment method already verified or verification conflict
 */
router.put('/admin/verify-payment-details/:userId', protect, adminProtect, paymentController.verifyUserPaymentDetails);

// Export the router - THIS WAS MISSING!
module.exports = router;