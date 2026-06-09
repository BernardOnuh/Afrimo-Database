const express = require('express');
const router = express.Router();
const shareController = require('../controller/shareController');
const coFounderController = require('../controller/coFounderController');
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
  const { packageId, tierKey, currency, paymentMethod } = req.body;

  if ((!packageId && !tierKey) || !currency || !paymentMethod) {
    return res.status(400).json({
      success: false,
      message: 'tierKey (or packageId), currency, and paymentMethod are required'
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

// Check required controller methods
const requiredMethods = [
  'getShareInfo',
  'calculatePurchase',
  'getPaymentConfig',
  'getUserShares',
  'submitManualPayment',
  'getPaymentProof',
  'getPaymentProofDirect',
  'updateSharePricing',
  'adminAddShares',
  'updateCompanyWallet',
  'getAllTransactions',
  'getShareStatistics',
  'adminGetManualTransactions',
  'adminVerifyManualPayment',
  'adminCancelManualPayment',
  'adminDeleteManualPayment',
  'getTransactionStatus',
  'getTransactionDetails',
  'getSharePurchaseReport',
  'adminGetUserOverview',
  'sendCertificateEmail',
  'adminRevokeTransaction',
  'checkPendingPayment',
  'createTier',
  'deleteTier',
  'adminUpdateUserShares',
  'adminEditTransaction',
  'getAllTiers',
  'editTier',
  'updateTierStatus'
];

requiredMethods.forEach(method => {
  if (!shareController[method]) {
    console.error(`❌ shareController.${method} is UNDEFINED - This will cause a route error!`);
  }
});

/**
 * @swagger
 * components:
 *   securitySchemes:
 *     bearerAuth:
 *       type: http
 *       scheme: bearer
 *       bearerFormat: JWT
 *     adminAuth:
 *       type: http
 *       scheme: bearer
 *       bearerFormat: JWT
 *       description: Admin JWT token required
 *   
 *   responses:
 *     UnauthorizedError:
 *       description: Authentication failed - Invalid or missing token
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               success:
 *                 type: boolean
 *                 example: false
 *               message:
 *                 type: string
 *                 example: "Not authorized, no token"
 *     ForbiddenError:
 *       description: Access denied - Insufficient permissions
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               success:
 *                 type: boolean
 *                 example: false
 *               message:
 *                 type: string
 *                 example: "Unauthorized: Admin access required"
 *     NotFoundError:
 *       description: Resource not found
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               success:
 *                 type: boolean
 *                 example: false
 *               message:
 *                 type: string
 *                 example: "Transaction not found"
 *     ServerError:
 *       description: Internal server error
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               success:
 *                 type: boolean
 *                 example: false
 *               message:
 *                 type: string
 *                 example: "Internal server error"
 *
 *   schemas:
 *     SharePackage:
 *       type: object
 *       properties:
 *         _id:
 *           type: string
 *           description: Package ID (use as packageId/tierKey)
 *           example: "starter"
 *         label:
 *           type: string
 *           example: "Starter Package"
 *         priceNaira:
 *           type: number
 *           example: 50000
 *         priceUSDT:
 *           type: number
 *           example: 30
 *         ownershipPct:
 *           type: number
 *           example: 0.000042
 *         earningKobo:
 *           type: number
 *           example: 28000
 *         active:
 *           type: boolean
 *           example: true
 *     
 *     ShareTier:
 *       type: object
 *       properties:
 *         key:
 *           type: string
 *           example: "starter"
 *         name:
 *           type: string
 *           example: "Starter Package"
 *         priceNGN:
 *           type: number
 *           example: 50000
 *         priceUSD:
 *           type: number
 *           example: 30
 *         percentPerShare:
 *           type: number
 *           example: 0.000042
 *         earningPerPhone:
 *           type: integer
 *           example: 28000
 *         sharesIncluded:
 *           type: integer
 *           example: 1
 *         active:
 *           type: boolean
 *           example: true
 *         type:
 *           type: string
 *           enum: [share, co-founder]
 *           example: "share"
 *     
 *     Transaction:
 *       type: object
 *       properties:
 *         transactionId:
 *           type: string
 *           example: "TXN-A1B2C3D4-123456"
 *         user:
 *           type: object
 *           properties:
 *             id:
 *               type: string
 *             name:
 *               type: string
 *             email:
 *               type: string
 *         shares:
 *           type: integer
 *           example: 1
 *         totalAmount:
 *           type: number
 *           example: 50000
 *         currency:
 *           type: string
 *           enum: [naira, usdt]
 *           example: "naira"
 *         paymentMethod:
 *           type: string
 *           example: "bank_transfer"
 *         status:
 *           type: string
 *           enum: [pending, completed, failed]
 *           example: "completed"
 *         ownershipPct:
 *           type: number
 *           example: 0.000042
 *         earningKobo:
 *           type: integer
 *           example: 28000
 *         date:
 *           type: string
 *           format: date-time
 *     
 *     ShareStatistics:
 *       type: object
 *       properties:
 *         totalShares:
 *           type: integer
 *           example: 1000000
 *         sharesSold:
 *           type: integer
 *           example: 50000
 *         sharesRemaining:
 *           type: integer
 *           example: 950000
 *         investorCount:
 *           type: integer
 *           example: 150
 *         totalValueNaira:
 *           type: number
 *           example: 2500000000
 *         totalValueUSDT:
 *           type: number
 *           example: 1500000
 *         pendingTransactions:
 *           type: integer
 *           example: 5
 *         tierSales:
 *           type: object
 *           properties:
 *             starterSold:
 *               type: integer
 *               example: 10000
 *             premiumSold:
 *               type: integer
 *               example: 5000
 *             eliteSold:
 *               type: integer
 *               example: 2000
 *     
 *     AddSharesRequest:
 *       type: object
 *       required:
 *         - tierKey
 *       properties:
 *         userId:
 *           type: string
 *           description: MongoDB User ID (alternative to userEmail)
 *           example: "60f7c6b4c8f1a2b3c4d5e6f7"
 *         userEmail:
 *           type: string
 *           description: User email address (alternative to userId)
 *           example: "user@example.com"
 *         tierKey:
 *           type: string
 *           description: Tier key from /shares/admin/tiers
 *           example: "premium"
 *         shares:
 *           type: integer
 *           minimum: 1
 *           default: 1
 *           example: 2
 *         note:
 *           type: string
 *           description: Internal admin note
 *           example: "Bonus allocation"
 *     
 *     UpdatePricingRequest:
 *       type: object
 *       required:
 *         - tierKey
 *         - priceNaira
 *         - priceUSDT
 *         - reason
 *       properties:
 *         tierKey:
 *           type: string
 *           example: "starter"
 *         priceNaira:
 *           type: number
 *           example: 55000
 *         priceUSDT:
 *           type: number
 *           example: 33
 *         reason:
 *           type: string
 *           example: "Market adjustment"
 */

// ==================== PUBLIC ROUTES ====================

/**
 * @swagger
 * /shares/info:
 *   get:
 *     tags:
 *       - Shares - Public
 *     summary: Get available share packages
 *     description: Returns all active share packages. Use the `_id` field as `tierKey` in other endpoints.
 *     responses:
 *       200:
 *         description: List of active share packages
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 packages:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/SharePackage'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/info', shareController.getShareInfo);

/**
 * @swagger
 * /shares/calculate:
 *   post:
 *     tags:
 *       - Shares - Public
 *     summary: Calculate purchase amount
 *     description: Calculate the price for a selected share tier
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - tierKey
 *               - currency
 *             properties:
 *               tierKey:
 *                 type: string
 *                 description: Tier key from /shares/info or /shares/admin/tiers
 *                 example: "starter"
 *               currency:
 *                 type: string
 *                 enum: [naira, usdt]
 *                 example: "naira"
 *     responses:
 *       200:
 *         description: Calculation successful
 *       400:
 *         description: Bad Request - Missing fields or invalid tier
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/calculate', shareController.calculatePurchase);

/**
 * @swagger
 * /shares/payment-config:
 *   get:
 *     tags:
 *       - Shares - Public
 *     summary: Get payment configuration
 *     description: Get available payment methods and configurations
 *     responses:
 *       200:
 *         description: Payment configuration retrieved successfully
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/payment-config', shareController.getPaymentConfig);

// ==================== USER ROUTES ====================

/**
 * @swagger
 * /shares/user/shares:
 *   get:
 *     tags:
 *       - Shares - User
 *     summary: Get user's shares and transactions
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User shares retrieved successfully
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/user/shares', protect, shareController.getUserShares);

/**
 * @swagger
 * /shares/user/pending-payment:
 *   get:
 *     tags:
 *       - Shares - User
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

/**
 * @swagger
 * /shares/user/earnings-summary:
 *   get:
 *     tags:
 *       - Shares - User
 *     summary: Get user earnings summary
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Earnings summary retrieved
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/user/earnings-summary', protect, async (req, res) => {
  try {
    const UserShareV2 = require('../models/UserShareV2');
    const snapshot = await UserShareV2.findOne({ user: req.user.id }).lean();

    res.json({
      success: true,
      totalEarningKobo  : snapshot?.totalEarningKobo   || 0,
      totalOwnershipPct : snapshot?.totalOwnershipPct  || 0,
      formattedOwnership: ((snapshot?.totalOwnershipPct || 0) * 100).toFixed(7) + '%',
      breakdown: {
        share    : { ownershipPct: snapshot?.regularOwnershipPct   || 0 },
        cofounder: { ownershipPct: snapshot?.cofounderOwnershipPct || 0 }
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ==================== MANUAL PAYMENT ROUTES ====================

/**
 * @swagger
 * /shares/manual/submit:
 *   post:
 *     tags:
 *       - Shares - Manual Payment
 *     summary: Submit manual payment with Cloudinary
 *     security:
 *       - bearerAuth: []
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
 *     tags:
 *       - Shares - Manual Payment
 *     summary: Get payment proof from Cloudinary
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: transactionId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Payment proof URL retrieved successfully
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

/**
 * @swagger
 * /shares/transactions/{transactionId}/status:
 *   get:
 *     tags:
 *       - Shares - Transaction
 *     summary: Get transaction status
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: transactionId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Transaction status retrieved
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       404:
 *         description: Transaction not found
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/transactions/:transactionId/status', protect, shareController.getTransactionStatus);

/**
 * @swagger
 * /shares/transactions/{transactionId}/details:
 *   get:
 *     tags:
 *       - Shares - Transaction
 *     summary: Get detailed transaction information
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: transactionId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Transaction details retrieved
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       404:
 *         description: Transaction not found
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/transactions/:transactionId/details', protect, shareController.getTransactionDetails);

/**
 * @swagger
 * /shares/certificate/email:
 *   post:
 *     tags:
 *       - Shares - User
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

// ==================== ADMIN ROUTES ====================

/**
 * @swagger
 * /shares/admin/payment-proof/{transactionId}:
 *   get:
 *     tags:
 *       - Shares - Admin
 *     summary: Direct admin access to payment proof file
 *     security:
 *       - adminAuth: []
 *     parameters:
 *       - in: path
 *         name: transactionId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       302:
 *         description: Redirect to Cloudinary CDN URL
 *       403:
 *         description: Admin access required
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
 *     tags:
 *       - Shares - Admin
 *     summary: Update share tier pricing
 *     security:
 *       - adminAuth: []
 *     responses:
 *       200:
 *         description: Share pricing updated successfully
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
 *     tags:
 *       - Shares - Admin
 *     summary: Add share package to user
 *     security:
 *       - adminAuth: []
 *     responses:
 *       200:
 *         description: Share package added successfully
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
 *     tags:
 *       - Shares - Admin
 *     summary: Update company wallet
 *     security:
 *       - adminAuth: []
 *     responses:
 *       200:
 *         description: Wallet address updated successfully
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
 *     tags:
 *       - Shares - Admin
 *     summary: Get all transactions
 *     security:
 *       - adminAuth: []
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
 *     tags:
 *       - Shares - Admin
 *     summary: Get share statistics
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

// ==================== ADMIN MANUAL PAYMENT ROUTES ====================

/**
 * @swagger
 * /shares/admin/manual/verify:
 *   post:
 *     tags:
 *       - Shares - Admin Manual Payment
 *     summary: Verify manual payment
 *     security:
 *       - adminAuth: []
 *     responses:
 *       200:
 *         description: Manual payment verification updated successfully
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/admin/manual/verify', protect, adminProtect, shareController.adminVerifyManualPayment);

/**
 * @swagger
 * /shares/admin/manual/transactions:
 *   get:
 *     tags:
 *       - Shares - Admin Manual Payment
 *     summary: Get manual payment transactions
 *     security:
 *       - adminAuth: []
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
 *     tags:
 *       - Shares - Admin Manual Payment
 *     summary: Cancel manual payment
 *     security:
 *       - adminAuth: []
 *     responses:
 *       200:
 *         description: Manual payment cancelled successfully
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/admin/manual/cancel', protect, adminProtect, shareController.adminCancelManualPayment);

/**
 * @swagger
 * /shares/admin/manual/{transactionId}:
 *   delete:
 *     tags:
 *       - Shares - Admin Manual Payment
 *     summary: Delete manual payment transaction
 *     security:
 *       - adminAuth: []
 *     parameters:
 *       - in: path
 *         name: transactionId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Manual payment transaction deleted successfully
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.delete('/admin/manual/:transactionId', protect, adminProtect, shareController.adminDeleteManualPayment);

// ==================== ADMIN REPORTS ====================

/**
 * @swagger
 * /shares/admin/purchase-report:
 *   get:
 *     tags:
 *       - Shares - Admin Reports
 *     summary: Get share purchase report
 *     security:
 *       - adminAuth: []
 *     responses:
 *       200:
 *         description: Share purchase report generated successfully
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
if (shareController.getSharePurchaseReport) {
  router.get('/admin/purchase-report', protect, adminProtect, shareController.getSharePurchaseReport);
} else {
  console.error('❌ WARNING: shareController.getSharePurchaseReport is undefined - route not registered');
  router.get('/admin/purchase-report', protect, adminProtect, async (req, res) => {
    res.status(501).json({ 
      success: false, 
      message: 'Purchase report endpoint not implemented yet.' 
    });
  });
}

// ==================== ADMIN USER MANAGEMENT ====================

/**
 * @swagger
 * /shares/admin/user-overview/{identifier}:
 *   get:
 *     tags:
 *       - Shares - Admin User Management
 *     summary: Get comprehensive user share overview
 *     security:
 *       - adminAuth: []
 *     parameters:
 *       - in: path
 *         name: identifier
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: User overview retrieved successfully
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       404:
 *         description: User not found
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/admin/user-overview/:identifier', protect, adminProtect, shareController.adminGetUserOverview);

// ==================== ADMIN REVOKE ====================

/**
 * @swagger
 * /shares/admin/revoke/{transactionId}:
 *   delete:
 *     tags:
 *       - Shares - Admin
 *     summary: Revoke any transaction (complete rollback)
 *     security:
 *       - adminAuth: []
 *     parameters:
 *       - in: path
 *         name: transactionId
 *         required: true
 *         schema:
 *           type: string
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

// ==================== ADMIN LEGACY TIER ROUTES ====================
// NOTE: These older endpoints are kept for backwards compatibility.
// Prefer the /admin/tiers/* endpoints below for new integrations.

/**
 * @swagger
 * /shares/admin/create-tier:
 *   post:
 *     tags:
 *       - Shares - Admin
 *     summary: Create a new share tier (legacy)
 *     security:
 *       - adminAuth: []
 *     responses:
 *       201:
 *         description: Tier created successfully
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/admin/create-tier', protect, adminProtect, shareController.createTier);

/**
 * @swagger
 * /shares/admin/delete-tier/{tierKey}:
 *   delete:
 *     tags:
 *       - Shares - Admin
 *     summary: Delete a share tier (legacy)
 *     security:
 *       - adminAuth: []
 *     parameters:
 *       - in: path
 *         name: tierKey
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Tier deleted successfully
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.delete('/admin/delete-tier/:tierKey', protect, adminProtect, shareController.deleteTier);

// ==================== ADMIN USER SHARES UPDATE ====================

/**
 * @swagger
 * /shares/admin/user/{userId}/shares:
 *   put:
 *     tags:
 *       - Shares - Admin
 *     summary: Update user shares directly
 *     security:
 *       - adminAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: User shares updated successfully
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.put('/admin/user/:userId/shares', protect, adminProtect, shareController.adminUpdateUserShares);

/**
 * @swagger
 * /shares/admin/transaction/{transactionId}:
 *   put:
 *     tags:
 *       - Shares - Admin
 *     summary: Edit a transaction
 *     security:
 *       - adminAuth: []
 *     parameters:
 *       - in: path
 *         name: transactionId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Transaction updated successfully
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.put('/admin/transaction/:transactionId', protect, adminProtect, shareController.adminEditTransaction);

// ==================== ADMIN TIER MANAGEMENT ROUTES ====================
// IMPORTANT: Route order matters in Express. More specific routes (with fixed
// path segments) MUST be registered before generic wildcard routes.

/**
 * @swagger
 * /shares/admin/tiers:
 *   get:
 *     tags:
 *       - Shares - Admin
 *     summary: Get all available share tiers
 *     security:
 *       - adminAuth: []
 *     responses:
 *       200:
 *         description: Tiers retrieved successfully
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/admin/tiers', protect, adminProtect, async (req, res) => {
  try {
    const TierConfig = require('../models/TierConfig');
    const config = await TierConfig.getCurrentConfig();
    
    const shareTiers = [];
    const cofounderTiers = [];
    
    for (const [key, tier] of config.tiers) {
      const tierInfo = {
        key,
        name: tier.name,
        priceNGN: tier.priceNGN,
        priceUSD: tier.priceUSD,
        percentPerShare: tier.percentPerShare,
        earningPerPhone: tier.earningPerPhone,
        sharesIncluded: tier.sharesIncluded || 1,
        active: tier.active,
        type: tier.type
      };
      
      if (tier.type === 'share') {
        shareTiers.push(tierInfo);
      } else if (tier.type === 'co-founder') {
        cofounderTiers.push(tierInfo);
      }
    }
    
    res.status(200).json({
      success: true,
      tiers: {
        share: shareTiers,
        cofounder: cofounderTiers
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch tiers',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// ========== TIER MANAGEMENT - SPECIFIC ROUTES (MUST COME FIRST) ==========

/**
 * @swagger
 * /shares/admin/tiers/all:
 *   get:
 *     tags:
 *       - Shares - Admin - Tier Management
 *     summary: Get all share tiers (both regular and co-founder)
 *     security:
 *       - adminAuth: []
 *     responses:
 *       200:
 *         description: Tiers retrieved successfully
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/admin/tiers/all', protect, adminProtect, shareController.getAllTiers);

/**
 * @swagger
 * /shares/admin/tiers/create:
 *   post:
 *     tags:
 *       - Shares - Admin - Tier Management
 *     summary: Create a new share tier
 *     security:
 *       - adminAuth: []
 *     responses:
 *       201:
 *         description: Tier created successfully
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/admin/tiers/create', protect, adminProtect, shareController.createTier);

/**
 * @swagger
 * /shares/admin/tiers/{tierKey}/edit:
 *   put:
 *     tags:
 *       - Shares - Admin - Tier Management
 *     summary: Edit tier details
 *     description: Update any editable field on a tier — name, prices, percentPerShare, earningPerPhone, sharesIncluded, description. Only fields included in the request body are changed.
 *     security:
 *       - adminAuth: []
 *     parameters:
 *       - in: path
 *         name: tierKey
 *         required: true
 *         schema:
 *           type: string
 *         example: "premium"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *                 example: "Premium Plus"
 *               priceNGN:
 *                 type: number
 *                 example: 110000
 *               priceUSD:
 *                 type: number
 *                 example: 110
 *               percentPerShare:
 *                 type: number
 *                 example: 0.000055
 *               earningPerPhone:
 *                 type: integer
 *                 example: 33000
 *               sharesIncluded:
 *                 type: integer
 *                 example: 1
 *               description:
 *                 type: string
 *                 example: "Updated premium tier"
 *               reason:
 *                 type: string
 *                 example: "Q2 pricing review"
 *     responses:
 *       200:
 *         description: Tier updated successfully
 *       400:
 *         description: No valid fields provided
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       404:
 *         description: Tier not found
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
// FIXED: This specific route MUST come before the generic /:tierKey route
router.put('/admin/tiers/:tierKey/edit', protect, adminProtect, shareController.editTier);

// ========== TIER MANAGEMENT - GENERIC ROUTES (MUST COME LAST) ==========

/**
 * @swagger
 * /shares/admin/tiers/{tierKey}:
 *   put:
 *     tags:
 *       - Shares - Admin - Tier Management
 *     summary: Update tier status (activate/deactivate)
 *     security:
 *       - adminAuth: []
 *     parameters:
 *       - in: path
 *         name: tierKey
 *         required: true
 *         schema:
 *           type: string
 *         example: "diamond"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - active
 *             properties:
 *               active:
 *                 type: boolean
 *                 example: true
 *               reason:
 *                 type: string
 *                 example: "New tier activation"
 *     responses:
 *       200:
 *         description: Tier status updated successfully
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       404:
 *         description: Tier not found
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.put('/admin/tiers/:tierKey', protect, adminProtect, shareController.updateTierStatus);

/**
 * @swagger
 * /shares/admin/tiers/{tierKey}:
 *   delete:
 *     tags:
 *       - Shares - Admin - Tier Management
 *     summary: Delete a share tier
 *     description: Deletes a tier only if no completed transactions exist
 *     security:
 *       - adminAuth: []
 *     parameters:
 *       - in: path
 *         name: tierKey
 *         required: true
 *         schema:
 *           type: string
 *         example: "diamond"
 *     responses:
 *       200:
 *         description: Tier deleted successfully
 *       400:
 *         description: Cannot delete tier with existing sales
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       404:
 *         description: Tier not found
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.delete('/admin/tiers/:tierKey', protect, adminProtect, shareController.deleteTier);

// ==================== CO-FOUNDER ADMIN ROUTES ====================

/**
 * @swagger
 * /shares/cofounder/admin/statistics:
 *   get:
 *     tags:
 *       - Co-Founder - Admin
 *     summary: Get co-founder share statistics
 *     security:
 *       - adminAuth: []
 *     responses:
 *       200:
 *         description: Co-founder statistics retrieved
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/cofounder/admin/statistics', protect, adminProtect, coFounderController.getCoFounderShareStatistics);

/**
 * @swagger
 * /shares/cofounder/admin/update-ratio:
 *   post:
 *     tags:
 *       - Co-Founder - Admin
 *     summary: Update co-founder to regular share ratio
 *     security:
 *       - adminAuth: []
 *     responses:
 *       200:
 *         description: Ratio updated successfully
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/cofounder/admin/update-ratio', protect, adminProtect, coFounderController.updateCoFounderToRegularRatio);

/**
 * @swagger
 * /shares/cofounder/admin/update-tier-pricing:
 *   post:
 *     tags:
 *       - Co-Founder - Admin
 *     summary: Update co-founder tier pricing
 *     security:
 *       - adminAuth: []
 *     responses:
 *       200:
 *         description: Tier pricing updated successfully
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/cofounder/admin/update-tier-pricing', protect, adminProtect, coFounderController.updateCoFounderTierPricing);

/**
 * @swagger
 * /shares/cofounder/admin/manual/all:
 *   get:
 *     tags:
 *       - Co-Founder - Admin Manual
 *     summary: Get all co-founder manual payments
 *     security:
 *       - adminAuth: []
 *     responses:
 *       200:
 *         description: Manual payments retrieved
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/cofounder/admin/manual/all', protect, adminProtect, coFounderController.getAllCoFounderManualPayments);

/**
 * @swagger
 * /shares/cofounder/admin/manual/verify:
 *   post:
 *     tags:
 *       - Co-Founder - Admin Manual
 *     summary: Verify co-founder manual payment
 *     security:
 *       - adminAuth: []
 *     responses:
 *       200:
 *         description: Payment verified
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/cofounder/admin/manual/verify', protect, adminProtect, coFounderController.adminVerifyCoFounderManualPayment);

/**
 * @swagger
 * /shares/cofounder/admin/manual/cancel:
 *   post:
 *     tags:
 *       - Co-Founder - Admin Manual
 *     summary: Cancel co-founder manual payment
 *     security:
 *       - adminAuth: []
 *     responses:
 *       200:
 *         description: Payment cancelled
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/cofounder/admin/manual/cancel', protect, adminProtect, coFounderController.adminCancelCoFounderManualPayment);

/**
 * @swagger
 * /shares/cofounder/admin/manual/{transactionId}:
 *   delete:
 *     tags:
 *       - Co-Founder - Admin Manual
 *     summary: Delete co-founder manual payment (PERMANENT)
 *     security:
 *       - adminAuth: []
 *     parameters:
 *       - in: path
 *         name: transactionId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Transaction deleted
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.delete('/cofounder/admin/manual/:transactionId', protect, adminProtect, coFounderController.adminDeleteCoFounderManualPayment);

/**
 * @swagger
 * /shares/cofounder/admin/add-shares:
 *   post:
 *     tags:
 *       - Co-Founder - Admin
 *     summary: Add co-founder shares to user
 *     security:
 *       - adminAuth: []
 *     responses:
 *       200:
 *         description: Shares added successfully
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/cofounder/admin/add-shares', protect, adminProtect, coFounderController.adminAddCoFounderShares);

module.exports = router