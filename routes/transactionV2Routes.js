// routes/transactionV2Routes.js

const express = require('express');
const router  = express.Router();
const { protect } = require('../middleware/auth');
const {
  createTransaction,
  deleteTransaction,
  updateTransaction,
  getUserTransactions,
  compareUserData
} = require('../controller/transactionV2Controller');

/**
 * @swagger
 * tags:
 *   name: TransactionsV2
 *   description: Clean v2 transaction data entry and comparison endpoints
 */

/**
 * @swagger
 * components:
 *   securitySchemes:
 *     bearerAuth:
 *       type: http
 *       scheme: bearer
 *       bearerFormat: JWT
 *   schemas:
 *     TransactionV2Input:
 *       type: object
 *       required:
 *         - transactionId
 *         - userId
 *         - type
 *         - shares
 *         - tierKey
 *         - totalAmount
 *         - currency
 *         - ownershipPct
 *         - earningKobo
 *       properties:
 *         transactionId:
 *           type: string
 *           example: "TXN-277DF77F-326451"
 *         userId:
 *           type: string
 *           example: "68b6dc19ecc12436f0b38be0"
 *         type:
 *           type: string
 *           enum: [share, co-founder]
 *         shares:
 *           type: integer
 *           example: 22
 *         tierKey:
 *           type: string
 *           example: "tier_cofounder"
 *         totalAmount:
 *           type: number
 *           example: 800000
 *           description: Full amount paid e.g. ₦800,000
 *         currency:
 *           type: string
 *           enum: [naira, usdt]
 *         ownershipPct:
 *           type: number
 *           example: 0.000021
 *           description: >
 *             Per-share ownership %.
 *             Total = ownershipPct × shares (derived automatically).
 *         earningKobo:
 *           type: number
 *           example: 14
 *           description: >
 *             Per-share earning in kobo.
 *             Total = earningKobo × shares (derived automatically).
 *         status:
 *           type: string
 *           enum: [completed, pending, failed, rejected, cancelled]
 *           default: completed
 *         paymentMethod:
 *           type: string
 *           example: "bank_transfer"
 *         paymentProof:
 *           type: string
 *         note:
 *           type: string
 *   responses:
 *     Unauthorized:
 *       description: Not an admin
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               success: { type: boolean, example: false }
 *               message: { type: string, example: "Admin access required" }
 *     NotFound:
 *       description: Transaction or user not found
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               success: { type: boolean, example: false }
 *               message: { type: string }
 *     Conflict:
 *       description: Duplicate transactionId
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               success: { type: boolean, example: false }
 *               message: { type: string }
 */

// ─────────────────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /v2/transactions:
 *   post:
 *     summary: Enter one corrected transaction (admin only)
 *     description: |
 *       Pass `totalAmount` as the full amount paid.
 *       Pass `ownershipPct` and `earningKobo` as **per-share** values.
 *
 *       **Auto-derived totals:**
 *       | Field | Formula |
 *       |---|---|
 *       | `pricePerShare` | `totalAmount ÷ shares` |
 *       | total `ownershipPct` stored | `ownershipPct × shares` |
 *       | total `earningKobo` stored | `earningKobo × shares` |
 *     tags: [TransactionsV2]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/TransactionV2Input'
 *           examples:
 *             cofounder22shares:
 *               summary: Co-founder 22 shares ₦800k
 *               value:
 *                 transactionId: "TXN-277DF77F-326451"
 *                 userId: "68b6dc19ecc12436f0b38be0"
 *                 type: "co-founder"
 *                 shares: 22
 *                 tierKey: "tier_cofounder"
 *                 totalAmount: 800000
 *                 currency: "naira"
 *                 ownershipPct: 0.000021
 *                 earningKobo: 14
 *                 status: "completed"
 *                 paymentMethod: "bank_transfer"
 *                 note: "co-founder | 2026-05-14"
 *             cofounder29shares:
 *               summary: Co-founder 29 shares ₦2M
 *               value:
 *                 transactionId: "CFD-28ADC821-672358"
 *                 userId: "68b6dc19ecc12436f0b38be0"
 *                 type: "co-founder"
 *                 shares: 29
 *                 tierKey: "tier_cofounder"
 *                 totalAmount: 2000000
 *                 currency: "naira"
 *                 ownershipPct: 0.000050
 *                 earningKobo: 30
 *                 status: "completed"
 *                 paymentMethod: "bank_transfer"
 *                 note: "co-founder | 2025-11-30"
 *     responses:
 *       201:
 *         description: Transaction created successfully
 *       400:
 *         description: Missing required fields
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       409:
 *         $ref: '#/components/responses/Conflict'
 */
router.post('/', protect, createTransaction);

// ─────────────────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /v2/transactions/{transactionId}:
 *   delete:
 *     summary: Delete a transaction and recalculate user snapshot (admin only)
 *     tags: [TransactionsV2]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: transactionId
 *         required: true
 *         schema:
 *           type: string
 *         example: "TXN-277DF77F-326451"
 *     responses:
 *       200:
 *         description: Transaction deleted and snapshot recalculated
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.delete('/:transactionId', protect, deleteTransaction);

// ─────────────────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /v2/transactions/{transactionId}:
 *   patch:
 *     summary: Fix/update a transaction and recalculate user snapshot (admin only)
 *     description: |
 *       Pass only the fields you want to correct.
 *       Any field not passed keeps its existing value.
 *       `ownershipPct` and `earningKobo` are treated as per-share —
 *       totals are re-derived automatically.
 *     tags: [TransactionsV2]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: transactionId
 *         required: true
 *         schema:
 *           type: string
 *         example: "TXN-277DF77F-326451"
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               totalAmount: { type: number }
 *               ownershipPct: { type: number, description: "Per-share value" }
 *               earningKobo: { type: number, description: "Per-share value" }
 *               shares: { type: integer }
 *               tierKey: { type: string }
 *               currency: { type: string, enum: [naira, usdt] }
 *               status: { type: string }
 *               paymentMethod: { type: string }
 *               note: { type: string }
 *           example:
 *             ownershipPct: 0.000021
 *             earningKobo: 14
 *     responses:
 *       200:
 *         description: Transaction updated and snapshot recalculated
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.patch('/:transactionId', protect, updateTransaction);

// ─────────────────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /v2/transactions/user/{userId}:
 *   get:
 *     summary: List all v2 transactions for a user (admin only)
 *     tags: [TransactionsV2]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *         example: "68b6dc19ecc12436f0b38be0"
 *     responses:
 *       200:
 *         description: Transactions fetched successfully
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.get('/user/:userId', protect, getUserTransactions);

// ─────────────────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /v2/transactions/compare/{userId}:
 *   get:
 *     summary: Compare old vs new data side by side for a user (admin only)
 *     tags: [TransactionsV2]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *         example: "68b6dc19ecc12436f0b38be0"
 *     responses:
 *       200:
 *         description: Comparison data returned
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.get('/compare/:userId', protect, compareUserData);

module.exports = router;

// ─── Register in app.js ───────────────────────────────────────────────────────
// app.use('/api/v2/transactions', require('./routes/transactionV2Routes'));