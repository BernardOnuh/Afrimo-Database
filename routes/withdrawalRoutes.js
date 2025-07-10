const express = require('express');
const router = express.Router();
const withdrawalController = require('../controller/withdrawalController');
const { protect, adminProtect } = require('../middleware/auth');

/**
 * @swagger
 * components:
 *   schemas:
 *     WithdrawalSettings:
 *       type: object
 *       properties:
 *         globalWithdrawalEnabled:
 *           type: boolean
 *           description: Whether withdrawals are globally enabled
 *           example: true
 *         minimumWithdrawalAmount:
 *           type: number
 *           description: Minimum withdrawal amount in Naira
 *           example: 20000
 *         maxDailyWithdrawals:
 *           type: integer
 *           description: Maximum withdrawals per user per day
 *           example: 3
 *         withdrawalFeePercentage:
 *           type: number
 *           description: Withdrawal fee as percentage
 *           example: 0
 *         lastUpdated:
 *           type: string
 *           format: date-time
 *           example: "2024-01-15T10:30:00Z"
 *         updatedBy:
 *           type: string
 *           description: ID of admin who last updated settings
 *           example: "507f1f77bcf86cd799439011"
 * 
 *     UserWithdrawalRestriction:
 *       type: object
 *       properties:
 *         _id:
 *           type: string
 *           example: "507f1f77bcf86cd799439011"
 *         user:
 *           type: string
 *           description: User ID
 *           example: "507f1f77bcf86cd799439012"
 *         withdrawalDisabled:
 *           type: boolean
 *           description: Whether withdrawals are disabled for this user
 *           example: true
 *         reason:
 *           type: string
 *           description: Reason for disabling withdrawals
 *           example: "Suspicious activity detected"
 *         disabledBy:
 *           type: string
 *           description: Admin who disabled withdrawals
 *           example: "507f1f77bcf86cd799439011"
 *         disabledAt:
 *           type: string
 *           format: date-time
 *           example: "2024-01-15T10:30:00Z"
 *         enabledAt:
 *           type: string
 *           format: date-time
 *           nullable: true
 *           example: null
 * 
 *     WithdrawalHistoryItem:
 *       type: object
 *       properties:
 *         _id:
 *           type: string
 *           example: "507f1f77bcf86cd799439011"
 *         user:
 *           type: object
 *           properties:
 *             _id:
 *               type: string
 *               example: "507f1f77bcf86cd799439012"
 *             name:
 *               type: string
 *               example: "John Doe"
 *             email:
 *               type: string
 *               example: "john@example.com"
 *             userName:
 *               type: string
 *               example: "johndoe"
 *         amount:
 *           type: number
 *           example: 50000
 *         status:
 *           type: string
 *           enum: [pending, processing, paid, failed, rejected]
 *           example: "paid"
 *         paymentMethod:
 *           type: string
 *           example: "bank"
 *         paymentDetails:
 *           type: object
 *           properties:
 *             bankName:
 *               type: string
 *               example: "First Bank"
 *             accountNumber:
 *               type: string
 *               example: "1234567890"
 *             accountName:
 *               type: string
 *               example: "John Doe"
 *         transactionReference:
 *           type: string
 *           example: "TXN123456789"
 *         clientReference:
 *           type: string
 *           example: "WD-123456-1699876543210"
 *         createdAt:
 *           type: string
 *           format: date-time
 *           example: "2024-01-15T10:30:00Z"
 *         processedAt:
 *           type: string
 *           format: date-time
 *           nullable: true
 *           example: "2024-01-15T11:30:00Z"
 *         rejectionReason:
 *           type: string
 *           nullable: true
 *           example: null
 * 
 *     ErrorResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: false
 *         message:
 *           type: string
 *           example: "Error message"
 *         error:
 *           type: string
 *           description: Detailed error (development mode only)
 *           example: "Detailed error message"
 * 
 *   securitySchemes:
 *     bearerAuth:
 *       type: http
 *       scheme: bearer
 *       bearerFormat: JWT
 * 
 *   tags:
 *     - name: User Withdrawals
 *       description: User withdrawal operations
 *     - name: Admin Withdrawals
 *       description: Admin withdrawal management and settings
 */

// ==========================================
// USER WITHDRAWAL ROUTES
// ==========================================

/**
 * @swagger
 * /withdrawal/instant:
 *   post:
 *     summary: Process an instant withdrawal to bank account
 *     tags: [User Withdrawals]
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
 *                 minimum: 20000
 *                 description: Amount to withdraw in Naira
 *                 example: 50000
 *               notes:
 *                 type: string
 *                 description: Optional notes for the withdrawal
 *                 example: "Emergency withdrawal"
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
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Withdrawal processed successfully"
 *                 data:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                       example: "507f1f77bcf86cd799439011"
 *                     amount:
 *                       type: number
 *                       example: 50000
 *                     status:
 *                       type: string
 *                       example: "paid"
 *                     transactionReference:
 *                       type: string
 *                       example: "TXN123456789"
 *                     clientReference:
 *                       type: string
 *                       example: "WD-123456-1699876543210"
 *       400:
 *         description: Bad request
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.post('/instant', protect, withdrawalController.checkExistingWithdrawals, withdrawalController.processInstantWithdrawal);

/**
 * @swagger
 * /withdrawal/request:
 *   post:
 *     summary: Request a withdrawal (manual processing)
 *     tags: [User Withdrawals]
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
 *               - paymentDetails
 *             properties:
 *               amount:
 *                 type: number
 *                 minimum: 20000
 *                 example: 50000
 *               paymentMethod:
 *                 type: string
 *                 enum: [bank, crypto, mobile_money]
 *                 example: "bank"
 *               paymentDetails:
 *                 type: object
 *                 properties:
 *                   bankName:
 *                     type: string
 *                     example: "First Bank"
 *                   accountName:
 *                     type: string
 *                     example: "John Doe"
 *                   accountNumber:
 *                     type: string
 *                     example: "1234567890"
 *               notes:
 *                 type: string
 *                 example: "Withdrawal request"
 *     responses:
 *       201:
 *         description: Withdrawal request submitted successfully
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 */
router.post('/request', protect, withdrawalController.checkExistingWithdrawals, withdrawalController.requestWithdrawal);

/**
 * @swagger
 * /withdrawal/history:
 *   get:
 *     summary: Get user's withdrawal history
 *     tags: [User Withdrawals]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Withdrawal history retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 count:
 *                   type: integer
 *                   example: 5
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/WithdrawalHistoryItem'
 */
router.get('/history', protect, withdrawalController.getWithdrawalHistory);

/**
 * @swagger
 * /withdrawal/balance:
 *   get:
 *     summary: Get user's current earnings balance
 *     tags: [User Withdrawals]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Earnings balance retrieved successfully
 */
router.get('/balance', protect, withdrawalController.getEarningsBalance);

/**
 * @swagger
 * /withdrawal/status/{reference}:
 *   get:
 *     summary: Check withdrawal status by reference
 *     tags: [User Withdrawals]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: reference
 *         required: true
 *         schema:
 *           type: string
 *         description: Transaction or client reference
 *     responses:
 *       200:
 *         description: Transaction status retrieved successfully
 */
router.get('/status/:reference', protect, withdrawalController.checkTransactionStatus);

/**
 * @swagger
 * /withdrawal/status:
 *   get:
 *     summary: Get user's current withdrawal status
 *     tags: [User Withdrawals]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Withdrawal status retrieved successfully
 */
router.get('/status', protect, withdrawalController.getWithdrawalStatus);

/**
 * @swagger
 * /withdrawal/verify-pending:
 *   get:
 *     summary: Verify status of pending withdrawals
 *     tags: [User Withdrawals]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Pending withdrawals verified successfully
 */
router.get('/verify-pending', protect, withdrawalController.verifyPendingWithdrawals);

/**
 * @swagger
 * /withdrawal/receipt/{id}:
 *   get:
 *     summary: Get withdrawal receipt URL
 *     tags: [User Withdrawals]
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
 *         description: Receipt URL retrieved successfully
 */
router.get('/receipt/:id', protect, withdrawalController.getWithdrawalReceipt);

/**
 * @swagger
 * /withdrawal/download-receipt/{id}:
 *   get:
 *     summary: Download withdrawal receipt as PDF
 *     tags: [User Withdrawals]
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
 *         description: PDF receipt downloaded successfully
 *         content:
 *           application/pdf:
 *             schema:
 *               type: string
 *               format: binary
 */
router.get('/download-receipt/:id', protect, withdrawalController.downloadWithdrawalReceipt);

// ==========================================
// ADMIN WITHDRAWAL ROUTES
// ==========================================

/**
 * @swagger
 * /withdrawal/admin/settings:
 *   get:
 *     summary: Get global withdrawal settings
 *     tags: [Admin Withdrawals]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Withdrawal settings retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/WithdrawalSettings'
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 */
router.get('/admin/settings', protect, adminProtect, withdrawalController.getWithdrawalSettings);

/**
 * @swagger
 * /withdrawal/admin/settings:
 *   put:
 *     summary: Update global withdrawal settings
 *     tags: [Admin Withdrawals]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               globalWithdrawalEnabled:
 *                 type: boolean
 *                 description: Enable/disable withdrawals globally
 *                 example: true
 *               minimumWithdrawalAmount:
 *                 type: number
 *                 description: Minimum withdrawal amount
 *                 example: 20000
 *               maxDailyWithdrawals:
 *                 type: integer
 *                 description: Maximum withdrawals per user per day
 *                 example: 3
 *               withdrawalFeePercentage:
 *                 type: number
 *                 description: Withdrawal fee percentage
 *                 example: 0
 *     responses:
 *       200:
 *         description: Settings updated successfully
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
 *                   example: "Withdrawal settings updated successfully"
 *                 data:
 *                   $ref: '#/components/schemas/WithdrawalSettings'
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 */
router.put('/admin/settings', protect, adminProtect, withdrawalController.updateWithdrawalSettings);

/**
 * @swagger
 * /withdrawal/admin/toggle-global:
 *   post:
 *     summary: Toggle global withdrawal status (enable/disable all withdrawals)
 *     tags: [Admin Withdrawals]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - enabled
 *             properties:
 *               enabled:
 *                 type: boolean
 *                 description: Whether to enable or disable withdrawals globally
 *                 example: false
 *               reason:
 *                 type: string
 *                 description: Reason for the change
 *                 example: "System maintenance"
 *     responses:
 *       200:
 *         description: Global withdrawal status toggled successfully
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
 *                   example: "Withdrawals disabled globally"
 *                 data:
 *                   type: object
 *                   properties:
 *                     globalWithdrawalEnabled:
 *                       type: boolean
 *                       example: false
 *                     reason:
 *                       type: string
 *                       example: "System maintenance"
 *                     updatedBy:
 *                       type: string
 *                       example: "507f1f77bcf86cd799439011"
 *                     updatedAt:
 *                       type: string
 *                       format: date-time
 *                       example: "2024-01-15T10:30:00Z"
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 */
router.post('/admin/toggle-global', protect, adminProtect, withdrawalController.toggleGlobalWithdrawals);

/**
 * @swagger
 * /withdrawal/admin/user/{userId}/toggle:
 *   post:
 *     summary: Enable/disable withdrawals for a specific user
 *     tags: [Admin Withdrawals]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *         description: User ID to toggle withdrawal status for
 *         example: "507f1f77bcf86cd799439012"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - disabled
 *             properties:
 *               disabled:
 *                 type: boolean
 *                 description: Whether to disable withdrawals for this user
 *                 example: true
 *               reason:
 *                 type: string
 *                 description: Reason for disabling/enabling withdrawals
 *                 example: "Suspicious activity detected"
 *     responses:
 *       200:
 *         description: User withdrawal status toggled successfully
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
 *                   example: "Withdrawals disabled for user"
 *                 data:
 *                   $ref: '#/components/schemas/UserWithdrawalRestriction'
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 *       404:
 *         description: User not found
 */
router.post('/admin/user/:userId/toggle', protect, adminProtect, withdrawalController.toggleUserWithdrawals);

/**
 * @swagger
 * /withdrawal/admin/user/{userId}/status:
 *   get:
 *     summary: Get withdrawal status for a specific user
 *     tags: [Admin Withdrawals]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *         description: User ID
 *     responses:
 *       200:
 *         description: User withdrawal status retrieved successfully
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
 *                     userId:
 *                       type: string
 *                       example: "507f1f77bcf86cd799439012"
 *                     withdrawalDisabled:
 *                       type: boolean
 *                       example: false
 *                     canWithdraw:
 *                       type: boolean
 *                       example: true
 *                     restriction:
 *                       nullable: true
 *                       allOf:
 *                         - $ref: '#/components/schemas/UserWithdrawalRestriction'
 *                     globalStatus:
 *                       type: boolean
 *                       example: true
 */
router.get('/admin/user/:userId/status', protect, adminProtect, withdrawalController.getUserWithdrawalStatus);

/**
 * @swagger
 * /withdrawal/admin/restricted-users:
 *   get:
 *     summary: Get list of users with withdrawal restrictions
 *     tags: [Admin Withdrawals]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *           default: 1
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 20
 *         description: Number of items per page
 *     responses:
 *       200:
 *         description: Restricted users list retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 count:
 *                   type: integer
 *                   example: 15
 *                 data:
 *                   type: array
 *                   items:
 *                     allOf:
 *                       - $ref: '#/components/schemas/UserWithdrawalRestriction'
 *                       - type: object
 *                         properties:
 *                           userDetails:
 *                             type: object
 *                             properties:
 *                               name:
 *                                 type: string
 *                                 example: "John Doe"
 *                               email:
 *                                 type: string
 *                                 example: "john@example.com"
 *                               userName:
 *                                 type: string
 *                                 example: "johndoe"
 *                 pagination:
 *                   type: object
 *                   properties:
 *                     totalPages:
 *                       type: integer
 *                       example: 3
 *                     currentPage:
 *                       type: integer
 *                       example: 1
 *                     totalItems:
 *                       type: integer
 *                       example: 15
 */
router.get('/admin/restricted-users', protect, adminProtect, withdrawalController.getRestrictedUsers);

/**
 * @swagger
 * /withdrawal/admin/complete-history:
 *   get:
 *     summary: Get complete withdrawal history for all users (Admin only)
 *     tags: [Admin Withdrawals]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *           default: 1
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 20
 *         description: Number of items per page
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, processing, paid, failed, rejected]
 *         description: Filter by withdrawal status
 *       - in: query
 *         name: userId
 *         schema:
 *           type: string
 *         description: Filter by specific user ID
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter withdrawals from this date
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter withdrawals until this date
 *       - in: query
 *         name: minAmount
 *         schema:
 *           type: number
 *         description: Filter by minimum amount
 *       - in: query
 *         name: maxAmount
 *         schema:
 *           type: number
 *         description: Filter by maximum amount
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search by user name, email, or transaction reference
 *       - in: query
 *         name: sortBy
 *         schema:
 *           type: string
 *           enum: [createdAt, amount, status, processedAt]
 *           default: createdAt
 *         description: Field to sort by
 *       - in: query
 *         name: sortOrder
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *           default: desc
 *         description: Sort order
 *     responses:
 *       200:
 *         description: Complete withdrawal history retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 count:
 *                   type: integer
 *                   example: 250
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/WithdrawalHistoryItem'
 *                 pagination:
 *                   type: object
 *                   properties:
 *                     totalPages:
 *                       type: integer
 *                       example: 13
 *                     currentPage:
 *                       type: integer
 *                       example: 1
 *                     totalItems:
 *                       type: integer
 *                       example: 250
 *                     hasNext:
 *                       type: boolean
 *                       example: true
 *                     hasPrev:
 *                       type: boolean
 *                       example: false
 *                 summary:
 *                   type: object
 *                   properties:
 *                     totalAmount:
 *                       type: number
 *                       description: Total amount across all filtered withdrawals
 *                       example: 5000000
 *                     averageAmount:
 *                       type: number
 *                       description: Average withdrawal amount
 *                       example: 20000
 *                     statusBreakdown:
 *                       type: object
 *                       properties:
 *                         pending:
 *                           type: integer
 *                           example: 5
 *                         processing:
 *                           type: integer
 *                           example: 10
 *                         paid:
 *                           type: integer
 *                           example: 200
 *                         failed:
 *                           type: integer
 *                           example: 15
 *                         rejected:
 *                           type: integer
 *                           example: 20
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 *       500:
 *         description: Server error
 */
router.get('/admin/complete-history', protect, adminProtect, withdrawalController.getCompleteWithdrawalHistory);

// Existing admin routes
router.get('/stats', protect, adminProtect, withdrawalController.getWithdrawalStats);
router.get('/admin/instant', protect, adminProtect, withdrawalController.getInstantWithdrawals);
router.get('/admin/pending', protect, adminProtect, withdrawalController.getPendingWithdrawals);
router.put('/admin/approve/:id', protect, adminProtect, withdrawalController.approveWithdrawal);
router.put('/admin/reject/:id', protect, adminProtect, withdrawalController.rejectWithdrawal);
router.put('/admin/mark-paid/:id', protect, adminProtect, withdrawalController.markWithdrawalAsPaid);
router.get('/admin/history', protect, adminProtect, withdrawalController.getAllWithdrawals);

module.exports = router;