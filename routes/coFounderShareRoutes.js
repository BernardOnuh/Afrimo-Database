const express = require('express');
const router = express.Router();
const coFounderShareController = require('../controller/coFounderShareController');
const { protect, adminProtect } = require('../middleware/auth');

// ========== PUBLIC ROUTES ==========

/**
 * @swagger
 * /api/shares/cofounder/info:
 *   get:
 *     summary: Get co-founder share information
 *     description: Retrieve current co-founder share pricing, availability, and requirements
 *     tags: [Public - Co-Founder]
 *     responses:
 *       200:
 *         description: Co-founder share information retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 currentPrice:
 *                   type: number
 *                   description: Current price per co-founder share
 *                   example: 5000
 *                 availableShares:
 *                   type: number
 *                   description: Number of co-founder shares available
 *                   example: 50
 *                 totalShares:
 *                   type: number
 *                   description: Total co-founder shares issued
 *                   example: 100
 *                 minimumPurchase:
 *                   type: number
 *                   description: Minimum number of shares that can be purchased
 *                   example: 1
 *                 maximumPurchase:
 *                   type: number
 *                   description: Maximum number of shares per user
 *                   example: 10
 *                 requirements:
 *                   type: object
 *                   properties:
 *                     minimumRegularShares:
 *                       type: number
 *                       description: Required regular shares before co-founder eligibility
 *                       example: 100
 *                     kycRequired:
 *                       type: boolean
 *                       description: Whether KYC verification is required
 *                     accreditedInvestorOnly:
 *                       type: boolean
 *                       description: Whether limited to accredited investors
 *                 benefits:
 *                   type: array
 *                   items:
 *                     type: string
 *                   example: ["Voting rights", "Board representation", "Priority liquidation"]
 *                 vestingSchedule:
 *                   type: object
 *                   properties:
 *                     cliffPeriod:
 *                       type: number
 *                       description: Cliff period in months
 *                     vestingPeriod:
 *                       type: number
 *                       description: Total vesting period in months
 *       500:
 *         description: Internal server error
 */
router.get('/cofounder/info', coFounderShareController.getCoFounderShareInfo);

/**
 * @swagger
 * /api/shares/cofounder/calculate:
 *   post:
 *     summary: Calculate co-founder share purchase amount
 *     description: Calculate total cost and fees for co-founder share purchase
 *     tags: [Public - Co-Founder]
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
 *                 description: Number of co-founder shares to purchase
 *                 example: 5
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
 *                   example: 5
 *                 pricePerShare:
 *                   type: number
 *                   example: 5000
 *                 subtotal:
 *                   type: number
 *                   example: 25000
 *                 fees:
 *                   type: object
 *                   properties:
 *                     processing:
 *                       type: number
 *                     legal:
 *                       type: number
 *                     total:
 *                       type: number
 *                 totalAmount:
 *                   type: number
 *                   example: 25500
 *                 eligibility:
 *                   type: object
 *                   properties:
 *                     eligible:
 *                       type: boolean
 *                     reasons:
 *                       type: array
 *                       items:
 *                         type: string
 *       400:
 *         description: Invalid quantity or calculation parameters
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/cofounder/calculate', coFounderShareController.calculateCoFounderPurchase);

/**
 * @swagger
 * /api/shares/cofounder/payment-config:
 *   get:
 *     summary: Get co-founder payment configuration
 *     description: Retrieve available payment methods and configuration for co-founder shares
 *     tags: [Public - Co-Founder]
 *     responses:
 *       200:
 *         description: Payment configuration retrieved successfully
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
 *                     minimumAmount:
 *                       type: number
 *                     maximumAmount:
 *                       type: number
 *                     supportedCurrencies:
 *                       type: array
 *                       items:
 *                         type: string
 *                 web3:
 *                   type: object
 *                   properties:
 *                     enabled:
 *                       type: boolean
 *                     walletAddress:
 *                       type: string
 *                     supportedTokens:
 *                       type: array
 *                       items:
 *                         type: string
 *                     requiredConfirmations:
 *                       type: number
 *                 bankTransfer:
 *                   type: object
 *                   properties:
 *                     enabled:
 *                       type: boolean
 *                     accountDetails:
 *                       type: object
 *                 restrictions:
 *                   type: object
 *                   properties:
 *                     jurisdictionLimits:
 *                       type: array
 *                       items:
 *                         type: string
 *                     kycRequired:
 *                       type: boolean
 */
router.get('/cofounder/payment-config', coFounderShareController.getPaymentConfig);

// ========== USER ROUTES (AUTHENTICATED) ==========

/**
 * @swagger
 * /api/shares/cofounder/paystack/initiate:
 *   post:
 *     summary: Initiate co-founder share Paystack payment
 *     description: Initialize Paystack payment for co-founder share purchase
 *     tags: [User - Co-Founder Payments]
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
 *                 description: Number of co-founder shares to purchase
 *                 example: 3
 *               email:
 *                 type: string
 *                 format: email
 *                 description: User's email address
 *                 example: "investor@example.com"
 *               metadata:
 *                 type: object
 *                 properties:
 *                   investorType:
 *                     type: string
 *                     enum: [individual, institutional, fund]
 *                   riskTolerance:
 *                     type: string
 *                     enum: [low, medium, high]
 *     responses:
 *       200:
 *         description: Payment initiated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 paymentUrl:
 *                   type: string
 *                   description: Paystack payment URL
 *                 reference:
 *                   type: string
 *                   description: Payment reference
 *                 amount:
 *                   type: number
 *                   description: Total amount in kobo/cents
 *                 expiresAt:
 *                   type: string
 *                   format: date-time
 *       400:
 *         description: Invalid request or user not eligible
 *       401:
 *         description: Unauthorized
 */
router.post('/cofounder/paystack/initiate', protect, coFounderShareController.initiateCoFounderPaystackPayment);

/**
 * @swagger
 * /api/shares/cofounder/paystack/verify/{reference}:
 *   get:
 *     summary: Verify co-founder Paystack payment
 *     description: Verify and complete co-founder share purchase via Paystack
 *     tags: [User - Co-Founder Payments]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: reference
 *         required: true
 *         schema:
 *           type: string
 *         description: Paystack payment reference
 *         example: "cf_ref_123456789"
 *     responses:
 *       200:
 *         description: Payment verified and shares allocated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 transaction:
 *                   $ref: '#/components/schemas/CoFounderTransaction'
 *                 shares:
 *                   type: object
 *                   properties:
 *                     allocated:
 *                       type: number
 *                     totalOwned:
 *                       type: number
 *                     ownershipPercentage:
 *                       type: number
 *                 certificateGenerated:
 *                   type: boolean
 *       400:
 *         description: Payment verification failed
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Payment reference not found
 */
router.get('/cofounder/paystack/verify/:reference', protect, coFounderShareController.verifyCoFounderPaystackPayment);

/**
 * @swagger
 * /api/shares/cofounder/web3/verify:
 *   post:
 *     summary: Verify co-founder Web3 transaction
 *     description: Submit and verify cryptocurrency payment for co-founder shares
 *     tags: [User - Co-Founder Payments]
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
 *               - token
 *             properties:
 *               transactionHash:
 *                 type: string
 *                 description: Blockchain transaction hash
 *                 example: "0xabc123def456..."
 *               quantity:
 *                 type: number
 *                 minimum: 1
 *                 description: Number of co-founder shares purchased
 *               amount:
 *                 type: number
 *                 description: Amount paid in cryptocurrency
 *               token:
 *                 type: string
 *                 enum: [ETH, USDT, USDC, BTC]
 *                 description: Cryptocurrency token used
 *               fromAddress:
 *                 type: string
 *                 description: Sender's wallet address
 *     responses:
 *       201:
 *         description: Web3 transaction submitted for verification
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 transactionId:
 *                   type: string
 *                 status:
 *                   type: string
 *                   enum: [pending, verified, failed]
 *                 message:
 *                   type: string
 *                 estimatedVerificationTime:
 *                   type: string
 *       400:
 *         description: Invalid transaction data
 *       401:
 *         description: Unauthorized
 */
router.post('/cofounder/web3/verify', protect, coFounderShareController.verifyWeb3Transaction);

/**
 * @swagger
 * /api/shares/cofounder/user/shares:
 *   get:
 *     summary: Get user's co-founder shares
 *     description: Retrieve authenticated user's co-founder share holdings and transaction history
 *     tags: [User - Co-Founder]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: includeTransactions
 *         schema:
 *           type: boolean
 *           default: true
 *         description: Include transaction history
 *       - in: query
 *         name: includeCertificates
 *         schema:
 *           type: boolean
 *           default: false
 *         description: Include share certificates
 *     responses:
 *       200:
 *         description: Co-founder shares retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 summary:
 *                   type: object
 *                   properties:
 *                     totalShares:
 *                       type: number
 *                       description: Total co-founder shares owned
 *                     totalInvestment:
 *                       type: number
 *                       description: Total amount invested
 *                     ownershipPercentage:
 *                       type: number
 *                       description: Percentage ownership in company
 *                     vestingStatus:
 *                       type: object
 *                       properties:
 *                         totalVested:
 *                           type: number
 *                         availableToExercise:
 *                           type: number
 *                         nextVestingDate:
 *                           type: string
 *                           format: date
 *                 transactions:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/CoFounderTransaction'
 *                 rights:
 *                   type: object
 *                   properties:
 *                     votingRights:
 *                       type: boolean
 *                     boardSeat:
 *                       type: boolean
 *                     liquidationPreference:
 *                       type: string
 *                 certificates:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       shareCount:
 *                         type: number
 *                       issueDate:
 *                         type: string
 *                         format: date
 *                       downloadUrl:
 *                         type: string
 *       401:
 *         description: Unauthorized
 */
router.get('/cofounder/user/shares', protect, coFounderShareController.getUserCoFounderShares);

// ========== ADMIN ROUTES ==========

/**
 * @swagger
 * /api/shares/cofounder/admin/web3/verify:
 *   post:
 *     summary: Admin verify co-founder Web3 transaction
 *     description: Manually verify or reject co-founder Web3 transactions (admin only)
 *     tags: [Admin - Co-Founder Web3]
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
 *                 description: Co-founder transaction ID to verify
 *               status:
 *                 type: string
 *                 enum: [approved, rejected]
 *                 description: Verification decision
 *               notes:
 *                 type: string
 *                 description: Admin notes for the verification
 *                 maxLength: 500
 *               allocateShares:
 *                 type: boolean
 *                 default: true
 *                 description: Whether to allocate shares immediately upon approval
 *     responses:
 *       200:
 *         description: Co-founder transaction verified successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 transaction:
 *                   $ref: '#/components/schemas/CoFounderTransaction'
 *                 sharesAllocated:
 *                   type: number
 *       400:
 *         description: Invalid verification data
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 *       404:
 *         description: Transaction not found
 */
router.post('/cofounder/admin/web3/verify', protect, adminProtect, coFounderShareController.adminVerifyWeb3Transaction);

/**
 * @swagger
 * /api/shares/cofounder/admin/web3/transactions:
 *   get:
 *     summary: Get all co-founder Web3 transactions
 *     description: Retrieve all co-founder Web3 transactions for admin review
 *     tags: [Admin - Co-Founder Web3]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, approved, rejected, all]
 *           default: all
 *         description: Filter by transaction status
 *       - in: query
 *         name: token
 *         schema:
 *           type: string
 *           enum: [ETH, USDT, USDC, BTC]
 *         description: Filter by cryptocurrency token
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
 *         name: sortBy
 *         schema:
 *           type: string
 *           enum: [createdAt, amount, quantity]
 *           default: createdAt
 *       - in: query
 *         name: sortOrder
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *           default: desc
 *     responses:
 *       200:
 *         description: Co-founder Web3 transactions retrieved successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 */
router.get('/cofounder/admin/web3/transactions', protect, adminProtect, coFounderShareController.adminGetWeb3Transactions);

/**
 * @swagger
 * /api/shares/cofounder/admin/update-pricing:
 *   post:
 *     summary: Update co-founder share pricing
 *     description: Update pricing and terms for co-founder shares (admin only)
 *     tags: [Admin - Co-Founder Configuration]
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
 *                 description: New price per co-founder share
 *               minimumPurchase:
 *                 type: number
 *                 minimum: 1
 *                 description: Minimum shares per purchase
 *               maximumPurchase:
 *                 type: number
 *                 description: Maximum shares per user
 *               vestingSchedule:
 *                 type: object
 *                 properties:
 *                   cliffPeriod:
 *                     type: number
 *                     description: Cliff period in months
 *                   vestingPeriod:
 *                     type: number
 *                     description: Total vesting period in months
 *               effectiveDate:
 *                 type: string
 *                 format: date-time
 *                 description: When pricing takes effect
 *     responses:
 *       200:
 *         description: Co-founder share pricing updated successfully
 *       400:
 *         description: Invalid pricing data
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 */
router.post('/cofounder/admin/update-pricing', protect, adminProtect, coFounderShareController.updateCoFounderSharePricing);

/**
 * @swagger
 * /api/shares/cofounder/admin/add-shares:
 *   post:
 *     summary: Add co-founder shares to pool
 *     description: Add additional co-founder shares to the available pool (admin only)
 *     tags: [Admin - Co-Founder Configuration]
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
 *                 description: Number of co-founder shares to add
 *               reason:
 *                 type: string
 *                 description: Reason for adding shares
 *                 maxLength: 200
 *               boardApprovalDate:
 *                 type: string
 *                 format: date
 *                 description: Date of board approval
 *     responses:
 *       200:
 *         description: Co-founder shares added successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 newTotal:
 *                   type: number
 *                 availableShares:
 *                   type: number
 *       400:
 *         description: Invalid share data
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 */
router.post('/cofounder/admin/add-shares', protect, adminProtect, coFounderShareController.adminAddCoFounderShares);

/**
 * @swagger
 * /api/shares/cofounder/admin/update-wallet:
 *   post:
 *     summary: Update company wallet for co-founder payments
 *     description: Update cryptocurrency wallet address for co-founder share payments (admin only)
 *     tags: [Admin - Co-Founder Configuration]
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
 *                 description: New Ethereum wallet address
 *               walletType:
 *                 type: string
 *                 enum: [ethereum, bitcoin, polygon]
 *                 description: Type of cryptocurrency wallet
 *     responses:
 *       200:
 *         description: Company wallet updated successfully
 *       400:
 *         description: Invalid wallet address
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 */
router.post('/cofounder/admin/update-wallet', protect, adminProtect, coFounderShareController.updateCompanyWallet);

/**
 * @swagger
 * /api/shares/cofounder/admin/transactions:
 *   get:
 *     summary: Get all co-founder transactions
 *     description: Retrieve comprehensive co-founder transaction history (admin only)
 *     tags: [Admin - Co-Founder Reports]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [paystack, web3, bank_transfer, all]
 *           default: all
 *         description: Filter by transaction type
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, completed, failed, cancelled, all]
 *           default: all
 *       - in: query
 *         name: userId
 *         schema:
 *           type: string
 *         description: Filter by specific user ID
 *       - in: query
 *         name: dateFrom
 *         schema:
 *           type: string
 *           format: date
 *         description: Start date for filtering
 *       - in: query
 *         name: dateTo
 *         schema:
 *           type: string
 *           format: date
 *         description: End date for filtering
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
 *         name: exportFormat
 *         schema:
 *           type: string
 *           enum: [json, csv]
 *           default: json
 *         description: Export format for data
 *     responses:
 *       200:
 *         description: Co-founder transactions retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 transactions:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/CoFounderTransaction'
 *                 summary:
 *                   type: object
 *                   properties:
 *                     totalTransactions:
 *                       type: number
 *                     totalAmount:
 *                       type: number
 *                     totalShares:
 *                       type: number
 *                     averageInvestment:
 *                       type: number
 *                 pagination:
 *                   $ref: '#/components/schemas/Pagination'
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 */
router.get('/cofounder/admin/transactions', protect, adminProtect, coFounderShareController.getAllCoFounderTransactions);

/**
 * @swagger
 * /api/shares/cofounder/admin/statistics:
 *   get:
 *     summary: Get co-founder share statistics
 *     description: Retrieve comprehensive co-founder share analytics and statistics (admin only)
 *     tags: [Admin - Co-Founder Reports]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: period
 *         schema:
 *           type: string
 *           enum: [7d, 30d, 90d, 1y, all]
 *           default: 30d
 *         description: Time period for statistics
 *       - in: query
 *         name: breakdown
 *         schema:
 *           type: string
 *           enum: [daily, weekly, monthly]
 *           default: daily
 *         description: Breakdown granularity
 *     responses:
 *       200:
 *         description: Co-founder statistics retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 overview:
 *                   type: object
 *                   properties:
 *                     totalShares:
 *                       type: number
 *                     soldShares:
 *                       type: number
 *                     availableShares:
 *                       type: number
 *                     totalRevenue:
 *                       type: number
 *                     uniqueInvestors:
 *                       type: number
 *                     averageInvestment:
 *                       type: number
 *                 salesTrend:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       date:
 *                         type: string
 *                         format: date
 *                       shares:
 *                         type: number
 *                       revenue:
 *                         type: number
 *                       investors:
 *                         type: number
 *                 paymentMethods:
 *                   type: object
 *                   properties:
 *                     paystack:
 *                       type: object
 *                     web3:
 *                       type: object
 *                     bankTransfer:
 *                       type: object
 *                 topInvestors:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       userId:
 *                         type: string
 *                       username:
 *                         type: string
 *                       totalShares:
 *                         type: number
 *                       totalInvestment:
 *                         type: number
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 */
router.get('/cofounder/admin/statistics', protect, adminProtect, coFounderShareController.getCoFounderShareStatistics);

module.exports = router;