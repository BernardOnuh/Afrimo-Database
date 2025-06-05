const express = require('express');
const router = express.Router();
const withdrawalController = require('../controller/withdrawalController');
const { protect, adminProtect } = require('../middleware/auth');

/**
 * @swagger
 * components:
 *   securitySchemes:
 *     bearerAuth:
 *       type: http
 *       scheme: bearer
 *       bearerFormat: JWT
 *   schemas:
 *     WithdrawalRequest:
 *       type: object
 *       required:
 *         - amount
 *         - accountDetails
 *       properties:
 *         amount:
 *           type: number
 *           description: Amount to withdraw
 *           example: 100.00
 *         accountDetails:
 *           type: object
 *           properties:
 *             accountNumber:
 *               type: string
 *               example: "1234567890"
 *             bankName:
 *               type: string
 *               example: "First Bank"
 *             accountName:
 *               type: string
 *               example: "John Doe"
 *     WithdrawalResponse:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           example: "64f5b2c3a1b2c3d4e5f6g7h8"
 *         reference:
 *           type: string
 *           example: "WD-2024-001"
 *         amount:
 *           type: number
 *           example: 100.00
 *         status:
 *           type: string
 *           enum: [pending, approved, rejected, paid, processing]
 *           example: "pending"
 *         createdAt:
 *           type: string
 *           format: date-time
 *     Error:
 *       type: object
 *       properties:
 *         error:
 *           type: string
 *           example: "Error message"
 *         message:
 *           type: string
 *           example: "Detailed error description"
 */

/**
 * @swagger
 * /api/withdrawals/instant:
 *   post:
 *     summary: Process instant withdrawal
 *     tags: [Withdrawals]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/WithdrawalRequest'
 *     responses:
 *       200:
 *         description: Instant withdrawal processed successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/WithdrawalResponse'
 *       400:
 *         description: Bad request - validation error or existing pending withdrawal
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: Unauthorized - invalid or missing token
 *       500:
 *         description: Internal server error
 */
router.post('/instant', protect, withdrawalController.checkExistingWithdrawals, withdrawalController.processInstantWithdrawal);

/**
 * @swagger
 * /api/withdrawals/request:
 *   post:
 *     summary: Request withdrawal (requires admin approval)
 *     tags: [Withdrawals]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/WithdrawalRequest'
 *     responses:
 *       201:
 *         description: Withdrawal request created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/WithdrawalResponse'
 *       400:
 *         description: Bad request or existing pending withdrawal
 *       401:
 *         description: Unauthorized
 */
router.post('/request', protect, withdrawalController.checkExistingWithdrawals, withdrawalController.requestWithdrawal);

/**
 * @swagger
 * /api/withdrawals/history:
 *   get:
 *     summary: Get user's withdrawal history
 *     tags: [Withdrawals]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number for pagination
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *         description: Number of records per page
 *     responses:
 *       200:
 *         description: Withdrawal history retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 withdrawals:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/WithdrawalResponse'
 *                 pagination:
 *                   type: object
 *                   properties:
 *                     page:
 *                       type: integer
 *                     limit:
 *                       type: integer
 *                     total:
 *                       type: integer
 */
router.get('/history', protect, withdrawalController.getWithdrawalHistory);

/**
 * @swagger
 * /api/withdrawals/balance:
 *   get:
 *     summary: Get user's earnings balance
 *     tags: [Withdrawals]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Balance retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 availableBalance:
 *                   type: number
 *                   example: 250.75
 *                 totalEarnings:
 *                   type: number
 *                   example: 500.00
 *                 totalWithdrawn:
 *                   type: number
 *                   example: 249.25
 */
router.get('/balance', protect, withdrawalController.getEarningsBalance);

/**
 * @swagger
 * /api/withdrawals/status/{reference}:
 *   get:
 *     summary: Check transaction status by reference
 *     tags: [Withdrawals]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: reference
 *         required: true
 *         schema:
 *           type: string
 *         description: Transaction reference number
 *         example: "WD-2024-001"
 *     responses:
 *       200:
 *         description: Transaction status retrieved
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/WithdrawalResponse'
 *       404:
 *         description: Transaction not found
 */
router.get('/status/:reference', protect, withdrawalController.checkTransactionStatus);

/**
 * @swagger
 * /api/withdrawals/status:
 *   get:
 *     summary: Get withdrawal status overview
 *     tags: [Withdrawals]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Withdrawal status overview
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 hasPendingWithdrawal:
 *                   type: boolean
 *                 pendingAmount:
 *                   type: number
 *                 lastWithdrawal:
 *                   $ref: '#/components/schemas/WithdrawalResponse'
 */
router.get('/status', protect, withdrawalController.getWithdrawalStatus);

/**
 * @swagger
 * /api/withdrawals/verify-pending:
 *   get:
 *     summary: Verify pending withdrawal status
 *     tags: [Withdrawals]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Pending withdrawals verification
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 pendingWithdrawals:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/WithdrawalResponse'
 */
router.get('/verify-pending', protect, withdrawalController.verifyPendingWithdrawals);

/**
 * @swagger
 * /api/withdrawals/receipt/{id}:
 *   get:
 *     summary: Get withdrawal receipt
 *     tags: [Withdrawals]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Withdrawal ID
 *     responses:
 *       200:
 *         description: Receipt data retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 receipt:
 *                   $ref: '#/components/schemas/WithdrawalResponse'
 */
router.get('/receipt/:id', protect, withdrawalController.getWithdrawalReceipt);

/**
 * @swagger
 * /api/withdrawals/download-receipt/{id}:
 *   get:
 *     summary: Download withdrawal receipt as PDF
 *     tags: [Withdrawals]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Withdrawal ID
 *     responses:
 *       200:
 *         description: PDF receipt file
 *         content:
 *           application/pdf:
 *             schema:
 *               type: string
 *               format: binary
 */
router.get('/download-receipt/:id', protect, withdrawalController.downloadWithdrawalReceipt);

// Admin routes
/**
 * @swagger
 * /api/withdrawals/stats:
 *   get:
 *     summary: Get withdrawal statistics (Admin only)
 *     tags: [Admin - Withdrawals]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Withdrawal statistics
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 totalWithdrawals:
 *                   type: number
 *                 totalAmount:
 *                   type: number
 *                 pendingCount:
 *                   type: integer
 *                 approvedCount:
 *                   type: integer
 *                 rejectedCount:
 *                   type: integer
 *       403:
 *         description: Forbidden - Admin access required
 */
router.get('/stats', protect, adminProtect, withdrawalController.getWithdrawalStats);

/**
 * @swagger
 * /api/withdrawals/admin/instant:
 *   get:
 *     summary: Get all instant withdrawals (Admin only)
 *     tags: [Admin - Withdrawals]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of instant withdrawals
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/WithdrawalResponse'
 */
router.get('/admin/instant', protect, adminProtect, withdrawalController.getInstantWithdrawals);

/**
 * @swagger
 * /api/withdrawals/admin/pending:
 *   get:
 *     summary: Get all pending withdrawals (Admin only)
 *     tags: [Admin - Withdrawals]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of pending withdrawals
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/WithdrawalResponse'
 */
router.get('/admin/pending', protect, adminProtect, withdrawalController.getPendingWithdrawals);

/**
 * @swagger
 * /api/withdrawals/admin/approve/{id}:
 *   put:
 *     summary: Approve a withdrawal (Admin only)
 *     tags: [Admin - Withdrawals]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Withdrawal ID
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               notes:
 *                 type: string
 *                 description: Admin notes for approval
 *     responses:
 *       200:
 *         description: Withdrawal approved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/WithdrawalResponse'
 */
router.put('/admin/approve/:id', protect, adminProtect, withdrawalController.approveWithdrawal);

/**
 * @swagger
 * /api/withdrawals/admin/reject/{id}:
 *   put:
 *     summary: Reject a withdrawal (Admin only)
 *     tags: [Admin - Withdrawals]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Withdrawal ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - reason
 *             properties:
 *               reason:
 *                 type: string
 *                 description: Reason for rejection
 *               notes:
 *                 type: string
 *                 description: Additional admin notes
 *     responses:
 *       200:
 *         description: Withdrawal rejected successfully
 */
router.put('/admin/reject/:id', protect, adminProtect, withdrawalController.rejectWithdrawal);

/**
 * @swagger
 * /api/withdrawals/admin/mark-paid/{id}:
 *   put:
 *     summary: Mark withdrawal as paid (Admin only)
 *     tags: [Admin - Withdrawals]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Withdrawal ID
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               transactionReference:
 *                 type: string
 *                 description: Payment transaction reference
 *               notes:
 *                 type: string
 *                 description: Payment notes
 *     responses:
 *       200:
 *         description: Withdrawal marked as paid successfully
 */
router.put('/admin/mark-paid/:id', protect, adminProtect, withdrawalController.markWithdrawalAsPaid);

/**
 * @swagger
 * /api/withdrawals/admin/history:
 *   get:
 *     summary: Get all withdrawals history (Admin only)
 *     tags: [Admin - Withdrawals]
 *     security:
 *       - bearerAuth: []
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
 *           default: 10
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, approved, rejected, paid, processing]
 *         description: Filter by status
 *     responses:
 *       200:
 *         description: All withdrawals history
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 withdrawals:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/WithdrawalResponse'
 *                 pagination:
 *                   type: object
 */
router.get('/admin/history', protect, adminProtect, withdrawalController.getAllWithdrawals);

module.exports = router;