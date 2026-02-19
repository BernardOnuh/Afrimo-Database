// routes/withdrawalRoutes.js
/**
 * COMPLETE WITHDRAWAL ROUTES - ENHANCED VERSION WITH ADMIN USER LOOKUP
 * 
 * MOUNTING IN app.js:
 * app.use('/api/withdrawal', require('./routes/withdrawalRoutes'));
 * 
 * This means route definitions do NOT include /api or /withdrawal prefix
 * Example: router.get('/balance') becomes GET /api/withdrawal/balance
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
 */
router.post('/instant', protect, withdrawalController.checkExistingWithdrawals, withdrawalController.processInstantWithdrawal);

/**
 * @swagger
 * /withdrawal/request:
 *   post:
 *     summary: Request a bank withdrawal
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
 */
router.get('/history', protect, withdrawalController.getWithdrawalHistory);

/**
 * CORRECTED: This is the endpoint your frontend should call
 * @swagger
 * /withdrawal/balance:
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
router.get('/balance', protect, withdrawalController.getEarningsBalance);

/**
 * Alternative endpoint name for backwards compatibility
 */
router.get('/earnings-balance', protect, withdrawalController.getEarningsBalance);

/**
 * @swagger
 * /withdrawal/status/{reference}:
 *   get:
 *     summary: Check transaction status by reference
 */
router.get('/status/:reference', protect, withdrawalController.checkTransactionStatus);

/**
 * @swagger
 * /withdrawal/verify-pending:
 *   get:
 *     summary: Verify pending withdrawals
 */
router.get('/verify-pending', protect, withdrawalController.verifyPendingWithdrawals);

/**
 * @swagger
 * /withdrawal/receipt/{id}:
 *   get:
 *     summary: Get bank withdrawal receipt URL
 */
router.get('/receipt/:id', protect, withdrawalController.getWithdrawalReceipt);

/**
 * @swagger
 * /withdrawal/download-receipt/{id}:
 *   get:
 *     summary: Download bank withdrawal receipt as PDF
 */
router.get('/download-receipt/:id', protect, withdrawalController.downloadWithdrawalReceipt);

// ========== BANK ADMIN ROUTES ==========

/**
 * @swagger
 * /withdrawal/admin/stats:
 *   get:
 *     summary: Get withdrawal statistics (Admin)
 */
router.get('/admin/stats', protect, adminProtect, withdrawalController.getWithdrawalStats);

/**
 * @swagger
 * /withdrawal/admin/instant:
 *   get:
 *     summary: Get all instant withdrawals (Admin)
 */
router.get('/admin/instant', protect, adminProtect, withdrawalController.getInstantWithdrawals);

/**
 * @swagger
 * /withdrawal/admin/pending:
 *   get:
 *     summary: Get pending bank withdrawals (Admin)
 */
router.get('/admin/pending', protect, adminProtect, withdrawalController.getPendingWithdrawals);

/**
 * @swagger
 * /withdrawal/admin/{id}/approve:
 *   put:
 *     summary: Approve pending bank withdrawal (Admin)
 */
router.put('/admin/:id/approve', protect, adminProtect, withdrawalController.approveWithdrawal);

/**
 * @swagger
 * /withdrawal/admin/{id}/reject:
 *   put:
 *     summary: Reject pending bank withdrawal (Admin)
 */
router.put('/admin/:id/reject', protect, adminProtect, withdrawalController.rejectWithdrawal);

/**
 * @swagger
 * /withdrawal/admin/{id}/pay:
 *   put:
 *     summary: Mark withdrawal as paid (Admin)
 */
router.put('/admin/:id/pay', protect, adminProtect, withdrawalController.markWithdrawalAsPaid);

/**
 * @swagger
 * /withdrawal/admin/all:
 *   get:
 *     summary: Get all withdrawals (Admin)
 */
router.get('/admin/all', protect, adminProtect, withdrawalController.getAllWithdrawals);

// ========== NEW: ADMIN USER LOOKUP ROUTES ==========

/**
 * @swagger
 * /withdrawal/admin/user/{identifier}/balance:
 *   get:
 *     summary: Get user's withdrawal balance (Admin lookup by ID/username)
 *     description: Admin can check any user's balance using ID, username, or email
 *     tags:
 *       - Admin User Lookup
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: identifier
 *         required: true
 *         schema:
 *           type: string
 *         description: User ID, username, or email
 *     responses:
 *       200:
 *         description: User balance retrieved
 *       404:
 *         description: User not found
 */
router.get('/admin/user/:identifier/balance', protect, adminProtect, withdrawalController.adminGetUserBalance);

/**
 * @swagger
 * /withdrawal/admin/user/{identifier}/withdrawals:
 *   get:
 *     summary: Get user's withdrawal history (Admin lookup)
 *     description: Admin can view any user's withdrawal history
 *     tags:
 *       - Admin User Lookup
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: identifier
 *         required: true
 *         schema:
 *           type: string
 *         description: User ID, username, or email
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *         description: Filter by status (pending, paid, failed, etc)
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *         description: Filter by type (bank, crypto)
 */
router.get('/admin/user/:identifier/withdrawals', protect, adminProtect, withdrawalController.adminGetUserWithdrawals);

/**
 * @swagger
 * /withdrawal/admin/user/{identifier}/pending:
 *   get:
 *     summary: Get user's pending withdrawals (Admin lookup)
 *     description: Admin can view pending/processing withdrawals for any user
 *     tags:
 *       - Admin User Lookup
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: identifier
 *         required: true
 *         schema:
 *           type: string
 *         description: User ID, username, or email
 */
router.get('/admin/user/:identifier/pending', protect, adminProtect, withdrawalController.adminGetUserPendingWithdrawals);

/**
 * @swagger
 * /withdrawal/admin/user/{identifier}/summary:
 *   get:
 *     summary: Get user's withdrawal summary (Admin lookup)
 *     description: Get complete withdrawal info for a user
 *     tags:
 *       - Admin User Lookup
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: identifier
 *         required: true
 *         schema:
 *           type: string
 *         description: User ID, username, or email
 */
router.get('/admin/user/:identifier/summary', protect, adminProtect, withdrawalController.adminGetUserWithdrawalSummary);

// ========== CRYPTO WITHDRAWAL ROUTES ==========

/**
 * @swagger
 * /withdrawal/crypto/rates:
 *   get:
 *     summary: Get current crypto exchange rates
 */
router.get('/crypto/rates', withdrawalController.getCryptoRates);

/**
 * @swagger
 * /withdrawal/crypto/wallet:
 *   get:
 *     summary: Get user's crypto wallet
 */
router.get('/crypto/wallet', protect, withdrawalController.getUserCryptoWallet);

/**
 * @swagger
 * /withdrawal/crypto/wallet/setup:
 *   post:
 *     summary: Setup or update crypto wallet
 */
router.post('/crypto/wallet/setup', protect, withdrawalController.setupCryptoWallet);

/**
 * @swagger
 * /withdrawal/crypto/request:
 *   post:
 *     summary: Request crypto withdrawal
 */
router.post('/crypto/request', protect, withdrawalController.processCryptoWithdrawal);

/**
 * @swagger
 * /withdrawal/crypto/history:
 *   get:
 *     summary: Get crypto withdrawal history
 */
router.get('/crypto/history', protect, withdrawalController.getCryptoWithdrawalHistory);

/**
 * @swagger
 * /withdrawal/crypto/status/{id}:
 *   get:
 *     summary: Get crypto withdrawal status
 */
router.get('/crypto/status/:id', protect, withdrawalController.getCryptoWithdrawalStatus);

/**
 * @swagger
 * /withdrawal/crypto/receipt/{id}:
 *   get:
 *     summary: Get crypto withdrawal receipt URL
 */
router.get('/crypto/receipt/:id', protect, withdrawalController.getCryptoWithdrawalReceipt);

/**
 * @swagger
 * /withdrawal/crypto/download-receipt/{id}:
 *   get:
 *     summary: Download crypto withdrawal receipt as PDF
 */
router.get('/crypto/download-receipt/:id', protect, withdrawalController.downloadCryptoWithdrawalReceipt);

// ========== CRYPTO ADMIN ROUTES ==========

/**
 * @swagger
 * /withdrawal/admin/crypto/wallet/setup:
 *   post:
 *     summary: Setup admin crypto wallet (Admin)
 */
router.post('/admin/crypto/wallet/setup', protect, adminProtect, withdrawalController.setupAdminCryptoWallet);

/**
 * @swagger
 * /withdrawal/admin/crypto/wallet/status:
 *   get:
 *     summary: Get admin wallet status (Admin)
 */
router.get('/admin/crypto/wallet/status', protect, adminProtect, withdrawalController.getAdminCryptoWalletStatus);

/**
 * @swagger
 * /withdrawal/admin/crypto/process:
 *   post:
 *     summary: Process pending crypto withdrawals (Admin)
 */
router.post('/admin/crypto/process', protect, adminProtect, withdrawalController.processPendingCryptoWithdrawals);

/**
 * @swagger
 * /withdrawal/admin/crypto/pending:
 *   get:
 *     summary: Get pending crypto withdrawals (Admin)
 */
router.get('/admin/crypto/pending', protect, adminProtect, withdrawalController.getPendingCryptoWithdrawals);

/**
 * @swagger
 * /withdrawal/admin/crypto/stats:
 *   get:
 *     summary: Get crypto withdrawal statistics (Admin)
 */
router.get('/admin/crypto/stats', protect, adminProtect, withdrawalController.getCryptoStats);

module.exports = router;