// routes/withdrawalRoutes.js
/**
 * COMPLETE WITHDRAWAL ROUTES - FIXED VERSION
 * Routes are defined WITHOUT /api prefix because they are mounted with /api in app.js
 * 
 * MOUNTING IN app.js:
 * const withdrawalRoutes = require('./routes/withdrawalRoutes');
 * app.use('/api', withdrawalRoutes);
 */
/**
 * COMPLETE WITHDRAWAL ROUTES - CORRECTED
 * All withdrawal routes (both bank and crypto) with full Swagger documentation
 * Includes receipt generation endpoints
 * 
 * NOTE: Mount this in app.js as:
 * app.use('/api/withdrawal', require('./routes/withdrawalRoutes'));
 * NOT as app.use('/api/api/withdrawal', ...)
 */

const express = require('express');
const router = express.Router();
const withdrawalController = require('../controller/withdrawalController');
const { protect, adminProtect } = require('../middleware/auth');

// ========== BANK WITHDRAWAL ROUTES ==========

/**
 * @swagger
 * /withdrawal/instant:
 *   post:
 *     summary: Process instant bank withdrawal
 *     description: Withdraw earnings to verified bank account instantly
 *     tags:
 *       - Bank Withdrawal
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - amount
 *             properties:
 *               amount:
 *                 type: number
 *                 example: 50000
 *                 description: Amount in Naira
 *               notes:
 *                 type: string
 *                 example: "Urgent withdrawal"
 *     responses:
 *       200:
 *         description: Withdrawal processed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                     amount:
 *                       type: number
 *                     status:
 *                       type: string
 *       400:
 *         description: Bad request (insufficient balance, no wallet, etc)
 *       401:
 *         description: Unauthorized
 */
router.post('/instant', protect, withdrawalController.checkExistingWithdrawals, withdrawalController.processInstantWithdrawal);

/**
 * @swagger
 * /withdrawal/request:
 *   post:
 *     summary: Request a bank withdrawal
 *     description: Submit a withdrawal request with custom payment details
 *     tags:
 *       - Bank Withdrawal
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - amount
 *               - paymentMethod
 *             properties:
 *               amount:
 *                 type: number
 *                 example: 20000
 *               paymentMethod:
 *                 type: string
 *                 enum: [bank, crypto, mobile_money]
 *               paymentDetails:
 *                 type: object
 *               notes:
 *                 type: string
 *     responses:
 *       201:
 *         description: Withdrawal request created
 *       400:
 *         description: Invalid request
 *       401:
 *         description: Unauthorized
 */
router.post('/request', protect, withdrawalController.checkExistingWithdrawals, withdrawalController.requestWithdrawal);

/**
 * @swagger
 * /withdrawal/history:
 *   get:
 *     summary: Get bank withdrawal history
 *     description: Retrieve all withdrawal requests for the authenticated user
 *     tags:
 *       - Bank Withdrawal
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Withdrawal history retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 count:
 *                   type: number
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *       401:
 *         description: Unauthorized
 */
router.get('/history', protect, withdrawalController.getWithdrawalHistory);

/**
 * @swagger
 * /api/withdrawal/earnings-balance:
 *   get:
 *     summary: Get current earnings balance
 *     description: Check available balance for withdrawal
 *     tags:
 *       - Bank Withdrawal
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Balance retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     totalEarnings:
 *                       type: number
 *                     totalWithdrawn:
 *                       type: number
 *                     availableBalance:
 *                       type: number
 *                     minimumWithdrawalAmount:
 *                       type: number
 *       401:
 *         description: Unauthorized
 */
router.get('/earnings-balance', protect, withdrawalController.getEarningsBalance);

/**
 * @swagger
 * /withdrawal/check/{reference}:
 *   get:
 *     summary: Check transaction status by reference
 *     description: Get detailed status of a specific withdrawal
 *     tags:
 *       - Bank Withdrawal
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: reference
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *         example: "WD-abc123-1234567890"
 *     responses:
 *       200:
 *         description: Transaction status retrieved
 *       404:
 *         description: Transaction not found
 *       401:
 *         description: Unauthorized
 */
router.get('/check/:reference', protect, withdrawalController.checkTransactionStatus);

/**
 * @swagger
 * /withdrawal/status:
 *   get:
 *     summary: Get current withdrawal status
 *     description: Check if user has any pending or processing withdrawals
 *     tags:
 *       - Bank Withdrawal
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Withdrawal status retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *       401:
 *         description: Unauthorized
 */
router.get('/status', protect, withdrawalController.getWithdrawalStatus);

/**
 * @swagger
 * /withdrawal/verify-pending:
 *   get:
 *     summary: Verify pending withdrawals
 *     description: Check status of pending withdrawals with payment provider
 *     tags:
 *       - Bank Withdrawal
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Verification completed
 *       401:
 *         description: Unauthorized
 */
router.get('/verify-pending', protect, withdrawalController.verifyPendingWithdrawals);

/**
 * @swagger
 * /withdrawal/receipt/{id}:
 *   get:
 *     summary: Get bank withdrawal receipt URL
 *     description: Get receipt URL for a bank withdrawal
 *     tags:
 *       - Bank Withdrawal
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *         description: Withdrawal ID
 *     responses:
 *       200:
 *         description: Receipt URL retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     receiptUrl:
 *                       type: string
 *       404:
 *         description: Withdrawal not found
 *       403:
 *         description: Not authorized
 */
router.get('/receipt/:id', protect, withdrawalController.getWithdrawalReceipt);

/**
 * @swagger
 * /withdrawal/download-receipt/{id}:
 *   get:
 *     summary: Download bank withdrawal receipt as PDF
 *     description: Generate and download withdrawal receipt in PDF format
 *     tags:
 *       - Bank Withdrawal
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *         description: Withdrawal ID
 *     responses:
 *       200:
 *         description: PDF receipt generated and downloaded
 *         content:
 *           application/pdf: {}
 *       404:
 *         description: Withdrawal not found
 *       403:
 *         description: Not authorized
 */
router.get('/download-receipt/:id', protect, withdrawalController.downloadWithdrawalReceipt);

// ========== BANK ADMIN ROUTES ==========

/**
 * @swagger
 * /withdrawal/admin/stats:
 *   get:
 *     summary: Get withdrawal statistics (Admin)
 *     description: Get overall withdrawal statistics and trends
 *     tags:
 *       - Admin - Bank Withdrawal
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Statistics retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 */
router.get('/admin/stats', protect, adminProtect, withdrawalController.getWithdrawalStats);

/**
 * @swagger
 * /withdrawal/admin/instant:
 *   get:
 *     summary: Get all instant withdrawals (Admin)
 *     description: View all instant withdrawals with filters
 *     tags:
 *       - Admin - Bank Withdrawal
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: page
 *         in: query
 *         schema:
 *           type: number
 *       - name: limit
 *         in: query
 *         schema:
 *           type: number
 *       - name: status
 *         in: query
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Instant withdrawals retrieved
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 */
router.get('/admin/instant', protect, adminProtect, withdrawalController.getInstantWithdrawals);

/**
 * @swagger
 * /withdrawal/admin/pending:
 *   get:
 *     summary: Get pending bank withdrawals (Admin)
 *     tags:
 *       - Admin - Bank Withdrawal
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Pending withdrawals retrieved
 */
router.get('/admin/pending', protect, adminProtect, withdrawalController.getPendingWithdrawals);

/**
 * @swagger
 * /withdrawal/admin/{id}/approve:
 *   put:
 *     summary: Approve pending bank withdrawal (Admin)
 *     tags:
 *       - Admin - Bank Withdrawal
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               notes:
 *                 type: string
 *     responses:
 *       200:
 *         description: Withdrawal approved
 */
router.put('/admin/:id/approve', protect, adminProtect, withdrawalController.approveWithdrawal);

/**
 * @swagger
 * /withdrawal/admin/{id}/reject:
 *   put:
 *     summary: Reject pending bank withdrawal (Admin)
 *     tags:
 *       - Admin - Bank Withdrawal
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               rejectionReason:
 *                 type: string
 *     responses:
 *       200:
 *         description: Withdrawal rejected
 */
router.put('/admin/:id/reject', protect, adminProtect, withdrawalController.rejectWithdrawal);

/**
 * @swagger
 * /withdrawal/admin/{id}/pay:
 *   put:
 *     summary: Mark withdrawal as paid (Admin)
 *     tags:
 *       - Admin - Bank Withdrawal
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               transactionReference:
 *                 type: string
 *     responses:
 *       200:
 *         description: Withdrawal marked as paid
 */
router.put('/admin/:id/pay', protect, adminProtect, withdrawalController.markWithdrawalAsPaid);

/**
 * @swagger
 * /withdrawal/admin/all:
 *   get:
 *     summary: Get all withdrawals (Admin)
 *     tags:
 *       - Admin - Bank Withdrawal
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: page
 *         in: query
 *         schema:
 *           type: number
 *       - name: limit
 *         in: query
 *         schema:
 *           type: number
 *       - name: status
 *         in: query
 *         schema:
 *           type: string
 *       - name: userId
 *         in: query
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: All withdrawals retrieved
 */
router.get('/admin/all', protect, adminProtect, withdrawalController.getAllWithdrawals);

// ========== CRYPTO WITHDRAWAL ROUTES ==========

/**
 * @swagger
 * /withdrawal/crypto/rates:
 *   get:
 *     summary: Get current crypto exchange rates
 *     description: Get current USDT to NGN and BNB to NGN exchange rates
 *     tags:
 *       - Crypto Withdrawal
 *     responses:
 *       200:
 *         description: Exchange rates retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     usdtPriceNGN:
 *                       type: number
 *                       example: 1550.50
 *                       description: Price of 1 USDT in Nigerian Naira
 *                     bnbPriceNGN:
 *                       type: number
 *                       example: 45000
 *                       description: Price of 1 BNB in Nigerian Naira
 *                     minimumWithdrawalNGN:
 *                       type: number
 *                       example: 1000
 *                     equivalentUSDT:
 *                       type: number
 *                       example: 0.645
 *     examples:
 *       success:
 *         value:
 *           success: true
 *           data:
 *             usdtPriceNGN: 1550.50
 *             bnbPriceNGN: 45000
 *             minimumWithdrawalNGN: 1000
 */
router.get('/crypto/rates', withdrawalController.getCryptoRates);

/**
 * @swagger
 * /withdrawal/crypto/wallet:
 *   get:
 *     summary: Get user's crypto wallet
 *     description: Retrieve the user's BNB wallet address for crypto withdrawals
 *     tags:
 *       - Crypto Withdrawal
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Wallet retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     walletAddress:
 *                       type: string
 *                       example: "0x742d35Cc6634C0532925a3b844Bc9e7595f42bE"
 *                     chainName:
 *                       type: string
 *                       example: "BNB"
 *                     cryptoType:
 *                       type: string
 *                       example: "USDT"
 *                     verified:
 *                       type: boolean
 *       401:
 *         description: Unauthorized
 */
router.get('/crypto/wallet', protect, withdrawalController.getUserCryptoWallet);

/**
 * @swagger
 * /withdrawal/crypto/wallet/setup:
 *   post:
 *     summary: Setup or update crypto wallet
 *     description: Add or update BNB wallet address for crypto withdrawals
 *     tags:
 *       - Crypto Withdrawal
 *     security:
 *       - bearerAuth: []
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
 *                 example: "0x742d35Cc6634C0532925a3b844Bc9e7595f42bE"
 *                 description: Valid BNB Smart Chain wallet address (0x format)
 *               cryptoType:
 *                 type: string
 *                 enum: [USDT]
 *                 default: USDT
 *               chainName:
 *                 type: string
 *                 enum: [BNB]
 *                 default: BNB
 *     responses:
 *       200:
 *         description: Wallet setup successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: object
 *       400:
 *         description: Invalid wallet address
 *       401:
 *         description: Unauthorized
 */
router.post('/crypto/wallet/setup', protect, withdrawalController.setupCryptoWallet);

/**
 * @swagger
 * /withdrawal/crypto/request:
 *   post:
 *     summary: Request crypto withdrawal
 *     description: Submit a USDT withdrawal request to your wallet
 *     tags:
 *       - Crypto Withdrawal
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - amountNGN
 *             properties:
 *               amountNGN:
 *                 type: number
 *                 example: 5000
 *                 description: Amount to withdraw in Nigerian Naira
 *     responses:
 *       201:
 *         description: Withdrawal request created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                     amountNGN:
 *                       type: number
 *                     amountUSDT:
 *                       type: number
 *                     walletAddress:
 *                       type: string
 *                     status:
 *                       type: string
 *                       enum: [pending]
 *       400:
 *         description: Bad request (insufficient balance, no wallet, etc)
 *       401:
 *         description: Unauthorized
 */
router.post('/crypto/request', protect, withdrawalController.processCryptoWithdrawal);

/**
 * @swagger
 * /withdrawal/crypto/history:
 *   get:
 *     summary: Get crypto withdrawal history
 *     description: Retrieve all crypto withdrawals for the user
 *     tags:
 *       - Crypto Withdrawal
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Withdrawal history retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 count:
 *                   type: number
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *       401:
 *         description: Unauthorized
 */
router.get('/crypto/history', protect, withdrawalController.getCryptoWithdrawalHistory);

/**
 * @swagger
 * /withdrawal/crypto/status/{id}:
 *   get:
 *     summary: Get crypto withdrawal status
 *     description: Check the status of a specific crypto withdrawal request
 *     tags:
 *       - Crypto Withdrawal
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *         description: Withdrawal ID
 *     responses:
 *       200:
 *         description: Withdrawal status retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *       404:
 *         description: Withdrawal not found
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Not authorized to view this withdrawal
 */
router.get('/crypto/status/:id', protect, withdrawalController.getCryptoWithdrawalStatus);

/**
 * @swagger
 * /withdrawal/crypto/receipt/{id}:
 *   get:
 *     summary: Get crypto withdrawal receipt URL
 *     description: Get the receipt URL for a crypto withdrawal
 *     tags:
 *       - Crypto Withdrawal
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Withdrawal ID
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Receipt URL retrieved successfully
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
 *                     receiptUrl:
 *                       type: string
 *                       example: "/receipts/crypto-receipt-12345.pdf"
 *       404:
 *         description: Withdrawal not found
 *       403:
 *         description: Not authorized to access this withdrawal
 */
router.get('/crypto/receipt/:id', protect, withdrawalController.getCryptoWithdrawalReceipt);

/**
 * @swagger
 * /withdrawal/crypto/download-receipt/{id}:
 *   get:
 *     summary: Download crypto withdrawal receipt as PDF
 *     description: Download the withdrawal receipt as a PDF file
 *     tags:
 *       - Crypto Withdrawal
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Withdrawal ID
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: PDF receipt file
 *         content:
 *           application/pdf:
 *             schema:
 *               type: string
 *               format: binary
 *       404:
 *         description: Withdrawal not found
 *       403:
 *         description: Not authorized to download this receipt
 */
router.get('/crypto/download-receipt/:id', protect, withdrawalController.downloadCryptoWithdrawalReceipt);

// ========== CRYPTO ADMIN ROUTES ==========

/**
 * @swagger
 * /withdrawal/admin/crypto/wallet/setup:
 *   post:
 *     summary: Setup admin crypto wallet (Admin)
 *     description: Configure the master wallet for processing crypto withdrawals
 *     tags:
 *       - Admin - Crypto Withdrawal
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               privateKey:
 *                 type: string
 *                 description: Private key of the admin wallet (64 hex characters)
 *                 example: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef"
 *               seedPhrase:
 *                 type: string
 *                 description: 12-word seed phrase (alternative to private key)
 *     responses:
 *       200:
 *         description: Admin wallet setup successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     walletAddress:
 *                       type: string
 *                     balanceBNB:
 *                       type: number
 *       400:
 *         description: Invalid private key/seed phrase or insufficient balance
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 */
router.post('/admin/crypto/wallet/setup', protect, adminProtect, withdrawalController.setupAdminCryptoWallet);

/**
 * @swagger
 * /withdrawal/admin/crypto/wallet/status:
 *   get:
 *     summary: Get admin wallet status (Admin)
 *     description: Check the balance and details of the admin crypto wallet
 *     tags:
 *       - Admin - Crypto Withdrawal
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Wallet status retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     walletAddress:
 *                       type: string
 *                     balanceBNB:
 *                       type: number
 *                       description: BNB balance (for gas fees)
 *                     balanceUSDT:
 *                       type: number
 *                       description: USDT balance (for withdrawals)
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 */
router.get('/admin/crypto/wallet/status', protect, adminProtect, withdrawalController.getAdminCryptoWalletStatus);

/**
 * @swagger
 * /withdrawal/admin/crypto/process:
 *   post:
 *     summary: Process pending crypto withdrawals (Admin)
 *     description: Manually process pending crypto withdrawal requests
 *     tags:
 *       - Admin - Crypto Withdrawal
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Withdrawals processed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: object
 *                   properties:
 *                     processed:
 *                       type: number
 *                     failed:
 *                       type: number
 *                     results:
 *                       type: array
 *       400:
 *         description: Admin wallet not configured
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 */
router.post('/admin/crypto/process', protect, adminProtect, withdrawalController.processPendingCryptoWithdrawals);

/**
 * @swagger
 * /withdrawal/admin/crypto/pending:
 *   get:
 *     summary: Get pending crypto withdrawals (Admin)
 *     description: View all pending crypto withdrawal requests
 *     tags:
 *       - Admin - Crypto Withdrawal
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Pending withdrawals retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 count:
 *                   type: number
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 */
router.get('/admin/crypto/pending', protect, adminProtect, withdrawalController.getPendingCryptoWithdrawals);

/**
 * @swagger
 * /withdrawal/admin/crypto/stats:
 *   get:
 *     summary: Get crypto withdrawal statistics (Admin)
 *     description: View statistics about all crypto withdrawals
 *     tags:
 *       - Admin - Crypto Withdrawal
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Statistics retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     totalWithdrawals:
 *                       type: number
 *                     totalAmountNGN:
 *                       type: number
 *                     totalAmountUSDT:
 *                       type: number
 *                     completedCount:
 *                       type: number
 *                     pendingCount:
 *                       type: number
 *                     failedCount:
 *                       type: number
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 */
router.get('/admin/crypto/stats', protect, adminProtect, withdrawalController.getCryptoStats);

module.exports = router;