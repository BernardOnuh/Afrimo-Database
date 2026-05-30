const express = require('express');
const router = express.Router();
const coFounderController = require('../controller/coFounderController');
const { protect, adminProtect } = require('../middleware/auth');
const { 
  cofounderPaymentUpload, 
  logCloudinaryUpload, 
  handleCloudinaryError 
} = require('../config/cloudinary');

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
 * 
 *   schemas:
 *     CoFounderPackage:
 *       type: object
 *       properties:
 *         _id:
 *           type: string
 *           description: Use as tierKey in other endpoints
 *           example: "elite"
 *         label:
 *           type: string
 *           example: "Elite Co-Founder"
 *         priceNaira:
 *           type: number
 *           example: 100000
 *         priceUSDT:
 *           type: number
 *           example: 60
 *         ownershipPct:
 *           type: number
 *           example: 0.005
 *         earningKobo:
 *           type: integer
 *           example: 1000
 *         sharesIncluded:
 *           type: integer
 *           example: 1
 *         active:
 *           type: boolean
 *           example: true
 *     
 *     CoFounderTransaction:
 *       type: object
 *       properties:
 *         transactionId:
 *           type: string
 *           example: "CFD-A1B2C3D4-123456"
 *         user:
 *           type: object
 *           properties:
 *             id:
 *               type: string
 *             name:
 *               type: string
 *             email:
 *               type: string
 *             phone:
 *               type: string
 *         shares:
 *           type: integer
 *           example: 1
 *         amount:
 *           type: number
 *           example: 100000
 *         currency:
 *           type: string
 *           enum: [naira, usdt]
 *         status:
 *           type: string
 *           enum: [pending, completed, failed]
 *         ownershipPct:
 *           type: number
 *           example: 0.005
 *         earningKobo:
 *           type: integer
 *           example: 1000
 *         date:
 *           type: string
 *           format: date-time
 *         paymentProof:
 *           type: object
 *           properties:
 *             directUrl:
 *               type: string
 *             originalName:
 *               type: string
 *         manualPaymentDetails:
 *           type: object
 *           properties:
 *             bankName:
 *               type: string
 *             accountName:
 *               type: string
 *             reference:
 *               type: string
 *     
 *     CoFounderStatistics:
 *       type: object
 *       properties:
 *         totalCoFounderShares:
 *           type: integer
 *         coFounderSharesSold:
 *           type: integer
 *         totalOwnershipPct:
 *           type: number
 *         formattedTotalOwnership:
 *           type: string
 *         totalEarningKobo:
 *           type: integer
 *         formattedTotalEarning:
 *           type: string
 *         totalValueNaira:
 *           type: number
 *         investorCount:
 *           type: integer
 *         pendingTransactions:
 *           type: integer
 *         shareToRegularRatio:
 *           type: integer
 *         tierSummaries:
 *           type: array
 * 
 *   responses:
 *     UnauthorizedError:
 *       description: Authentication failed
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
 *                 example: "Not authorized"
 *     ForbiddenError:
 *       description: Admin access required
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
 *                 example: "Admin access required"
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
 */

// ==================== PUBLIC ROUTES ====================

/**
 * @swagger
 * /cofounder/info:
 *   get:
 *     tags:
 *       - Co-Founder - Public
 *     summary: Get available co-founder packages
 *     description: Returns all active co-founder packages from TierConfig
 *     responses:
 *       200:
 *         description: Co-founder packages retrieved successfully
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
 *                     $ref: '#/components/schemas/CoFounderPackage'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/info', coFounderController.getCoFounderShareInfo);

/**
 * @swagger
 * /cofounder/calculate:
 *   post:
 *     tags:
 *       - Co-Founder - Public
 *     summary: Calculate co-founder purchase amount
 *     description: Calculate the price for a selected co-founder tier
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
 *                 description: Tier key from /cofounder/info
 *                 example: "elite"
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
 *                 tierKey:
 *                   type: string
 *                 tierName:
 *                   type: string
 *                 tierType:
 *                   type: string
 *                 price:
 *                   type: number
 *                 currency:
 *                   type: string
 *                 percentPerShare:
 *                   type: number
 *                 earningPerPhone:
 *                   type: integer
 *                 sharesIncluded:
 *                   type: integer
 *       400:
 *         description: Bad Request
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/calculate', coFounderController.calculateCoFounderPurchase);

/**
 * @swagger
 * /cofounder/payment-config:
 *   get:
 *     tags:
 *       - Co-Founder - Public
 *     summary: Get payment configuration
 *     responses:
 *       200:
 *         description: Payment config retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 paymentConfig:
 *                   type: object
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/payment-config', coFounderController.getPaymentConfig);

// ==================== USER ROUTES ====================

/**
 * @swagger
 * /cofounder/user/shares:
 *   get:
 *     tags:
 *       - Co-Founder - User
 *     summary: Get user's co-founder shares
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User shares retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 totalOwnershipPct:
 *                   type: number
 *                 cofounderOwnershipPct:
 *                   type: number
 *                 totalEarningKobo:
 *                   type: integer
 *                 transactions:
 *                   type: array
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/user/shares', protect, coFounderController.getUserCoFounderShares);

/**
 * @swagger
 * /cofounder/manual/status/{transactionId}:
 *   get:
 *     tags:
 *       - Co-Founder - User
 *     summary: Get co-founder manual payment status
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
 *         description: Status retrieved
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/manual/status/:transactionId', protect, coFounderController.getCoFounderManualPaymentStatus);

// ==================== MANUAL PAYMENT ROUTES ====================

/**
 * @swagger
 * /cofounder/manual/submit:
 *   post:
 *     tags:
 *       - Co-Founder - Manual Payment
 *     summary: Submit co-founder manual payment
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - tierKey
 *               - currency
 *               - paymentMethod
 *               - paymentProof
 *             properties:
 *               tierKey:
 *                 type: string
 *                 example: "elite"
 *               currency:
 *                 type: string
 *                 enum: [naira, usdt]
 *               paymentMethod:
 *                 type: string
 *                 enum: [bank_transfer, cash, other]
 *               bankName:
 *                 type: string
 *               accountName:
 *                 type: string
 *               reference:
 *                 type: string
 *               paymentProof:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: Payment submitted successfully
 *       400:
 *         description: Validation error
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/manual/submit',
  protect,
  cofounderPaymentUpload.single('paymentProof'),
  logCloudinaryUpload,
  handleCloudinaryError,
  coFounderController.submitCoFounderManualPayment
);

/**
 * @swagger
 * /cofounder/payment-proof/{transactionId}:
 *   get:
 *     tags:
 *       - Co-Founder - Manual Payment
 *     summary: Get payment proof from Cloudinary
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: transactionId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: redirect
 *         schema:
 *           type: boolean
 *     responses:
 *       200:
 *         description: Payment proof URL retrieved
 *       302:
 *         description: Redirect to Cloudinary URL
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/payment-proof/:transactionId', protect, coFounderController.getCoFounderPaymentProof);

// ==================== ADMIN ROUTES ====================

/**
 * @swagger
 * /cofounder/admin/payment-proof/{transactionId}:
 *   get:
 *     tags:
 *       - Co-Founder - Admin
 *     summary: Direct admin access to payment proof
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
 *         description: Redirect to Cloudinary
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 */
router.get('/admin/payment-proof/:transactionId', protect, adminProtect, coFounderController.getCoFounderPaymentProofDirect);

/**
 * @swagger
 * /cofounder/admin/statistics:
 *   get:
 *     tags:
 *       - Co-Founder - Admin
 *     summary: Get co-founder share statistics
 *     security:
 *       - adminAuth: []
 *     responses:
 *       200:
 *         description: Statistics retrieved
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/CoFounderStatistics'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/admin/statistics', protect, adminProtect, coFounderController.getCoFounderShareStatistics);

/**
 * @swagger
 * /cofounder/admin/transactions:
 *   get:
 *     tags:
 *       - Co-Founder - Admin
 *     summary: Get all co-founder transactions
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
 *         description: Transactions retrieved
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/admin/transactions', protect, adminProtect, coFounderController.getAllCoFounderTransactions);

/**
 * @swagger
 * /cofounder/admin/add-shares:
 *   post:
 *     tags:
 *       - Co-Founder - Admin
 *     summary: Add co-founder shares to user
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
 *               - tierKey
 *             properties:
 *               userId:
 *                 type: string
 *               tierKey:
 *                 type: string
 *                 example: "elite"
 *               shares:
 *                 type: integer
 *                 default: 1
 *               note:
 *                 type: string
 *     responses:
 *       200:
 *         description: Shares added successfully
 *       400:
 *         description: Bad request
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       404:
 *         description: User or tier not found
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/admin/add-shares', protect, adminProtect, coFounderController.adminAddCoFounderShares);

/**
 * @swagger
 * /cofounder/admin/update-ratio:
 *   post:
 *     tags:
 *       - Co-Founder - Admin
 *     summary: Update co-founder to regular share ratio
 *     security:
 *       - adminAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - ratio
 *             properties:
 *               ratio:
 *                 type: integer
 *                 example: 22
 *               reason:
 *                 type: string
 *     responses:
 *       200:
 *         description: Ratio updated successfully
 *       400:
 *         description: Invalid ratio
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/admin/update-ratio', protect, adminProtect, coFounderController.updateCoFounderToRegularRatio);

/**
 * @swagger
 * /cofounder/admin/update-tier-pricing:
 *   post:
 *     tags:
 *       - Co-Founder - Admin
 *     summary: Update co-founder tier pricing
 *     security:
 *       - adminAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - tierKey
 *             properties:
 *               tierKey:
 *                 type: string
 *                 example: "elite"
 *               priceNaira:
 *                 type: number
 *               priceUSDT:
 *                 type: number
 *               reason:
 *                 type: string
 *     responses:
 *       200:
 *         description: Pricing updated successfully
 *       400:
 *         description: Invalid request
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       404:
 *         description: Tier not found
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/admin/update-tier-pricing', protect, adminProtect, coFounderController.updateCoFounderTierPricing);

// ==================== ADMIN MANUAL PAYMENT ROUTES ====================

/**
 * @swagger
 * /cofounder/admin/manual/transactions:
 *   get:
 *     tags:
 *       - Co-Founder - Admin Manual
 *     summary: Get co-founder manual transactions
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
 *         description: Manual transactions retrieved
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/admin/manual/transactions', protect, adminProtect, coFounderController.adminGetCoFounderManualTransactions);

/**
 * @swagger
 * /cofounder/admin/manual/all:
 *   get:
 *     tags:
 *       - Co-Founder - Admin Manual
 *     summary: Get all co-founder manual payments
 *     security:
 *       - adminAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, completed, failed]
 *     responses:
 *       200:
 *         description: Manual payments retrieved
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/admin/manual/all', protect, adminProtect, coFounderController.getAllCoFounderManualPayments);

/**
 * @swagger
 * /cofounder/admin/manual/pending:
 *   get:
 *     tags:
 *       - Co-Founder - Admin Manual
 *     summary: Get pending co-founder manual payments
 *     security:
 *       - adminAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Pending payments retrieved
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/admin/manual/pending', protect, adminProtect, coFounderController.getCoFounderPendingManualPayments);

/**
 * @swagger
 * /cofounder/admin/manual/verify:
 *   post:
 *     tags:
 *       - Co-Founder - Admin Manual
 *     summary: Verify co-founder manual payment
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
 *               approved:
 *                 type: boolean
 *               adminNote:
 *                 type: string
 *     responses:
 *       200:
 *         description: Payment verified
 *       400:
 *         description: Already processed
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       404:
 *         description: Transaction not found
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/admin/manual/verify', protect, adminProtect, coFounderController.adminVerifyCoFounderManualPayment);

/**
 * @swagger
 * /cofounder/admin/manual/approve/{transactionId}:
 *   post:
 *     tags:
 *       - Co-Founder - Admin Manual
 *     summary: Quick approve co-founder manual payment
 *     security:
 *       - adminAuth: []
 *     parameters:
 *       - in: path
 *         name: transactionId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               adminNote:
 *                 type: string
 *     responses:
 *       200:
 *         description: Payment approved
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       404:
 *         description: Transaction not found
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/admin/manual/approve/:transactionId', protect, adminProtect, coFounderController.approveCoFounderManualPayment);

/**
 * @swagger
 * /cofounder/admin/manual/reject/{transactionId}:
 *   post:
 *     tags:
 *       - Co-Founder - Admin Manual
 *     summary: Quick reject co-founder manual payment
 *     security:
 *       - adminAuth: []
 *     parameters:
 *       - in: path
 *         name: transactionId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               adminNote:
 *                 type: string
 *     responses:
 *       200:
 *         description: Payment rejected
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       404:
 *         description: Transaction not found
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/admin/manual/reject/:transactionId', protect, adminProtect, coFounderController.rejectCoFounderManualPayment);

/**
 * @swagger
 * /cofounder/admin/manual/cancel:
 *   post:
 *     tags:
 *       - Co-Founder - Admin Manual
 *     summary: Cancel co-founder manual payment
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
 *               cancelReason:
 *                 type: string
 *     responses:
 *       200:
 *         description: Payment cancelled
 *       400:
 *         description: Cannot cancel non-completed
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       404:
 *         description: Transaction not found
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/admin/manual/cancel', protect, adminProtect, coFounderController.adminCancelCoFounderManualPayment);

/**
 * @swagger
 * /cofounder/admin/manual/{transactionId}:
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
 *       400:
 *         description: Missing transaction ID
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       404:
 *         description: Transaction not found
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.delete('/admin/manual/:transactionId', protect, adminProtect, coFounderController.adminDeleteCoFounderManualPayment);

// ==================== ADMIN USER MANAGEMENT ====================

/**
 * @swagger
 * /cofounder/admin/user-overview/{identifier}:
 *   get:
 *     tags:
 *       - Co-Founder - Admin
 *     summary: Get user co-founder overview
 *     description: Get comprehensive co-founder share data by ID, username, or email
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
 *         description: User overview retrieved
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       404:
 *         description: User not found
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/admin/user-overview/:identifier', protect, adminProtect, coFounderController.adminGetUserCoFounderOverview);

/**
 * @swagger
 * /cofounder/admin/add-shares-flexible:
 *   post:
 *     tags:
 *       - Co-Founder - Admin
 *     summary: Add co-founder shares using flexible identifier
 *     security:
 *       - adminAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - userIdentifier
 *               - shares
 *             properties:
 *               userIdentifier:
 *                 type: string
 *                 description: User ID, username, or email
 *               shares:
 *                 type: integer
 *               note:
 *                 type: string
 *     responses:
 *       200:
 *         description: Shares added
 *       400:
 *         description: Bad request
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       404:
 *         description: User not found
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/admin/add-shares-flexible', protect, adminProtect, coFounderController.adminAddCoFounderSharesFlexible);

/**
 * @swagger
 * /cofounder/admin/disable:
 *   post:
 *     tags:
 *       - Co-Founder - Admin
 *     summary: Disable co-founder programme
 *     security:
 *       - adminAuth: []
 *     responses:
 *       200:
 *         description: Programme disabled
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/admin/disable', protect, adminProtect, coFounderController.disableCoFounderProgramme);

module.exports = router;