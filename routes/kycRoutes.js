const express = require('express');
const router = express.Router();
const diditController = require('../controller/diditController');
const { protect } = require('../middleware/auth');

/**
 * @swagger
 * tags:
 *   - name: KYC
 *     description: Know Your Customer verification endpoints
 */

/**
 * @swagger
 * /kyc/session:
 *   post:
 *     tags: [KYC]
 *     summary: Create a Didit KYC verification session
 *     description: Creates a verification session for the authenticated user and returns the hosted verification URL.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       201:
 *         description: Verification session created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     url: { type: string }
 *                     session_id: { type: string }
 *                     verified: { type: boolean, example: false }
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       502:
 *         description: Failed to create session
 */
router.post('/session', protect, diditController.createSession);

/**
 * @swagger
 * /kyc/status:
 *   get:
 *     tags: [KYC]
 *     summary: Get current user KYC status
 *     description: Returns the authenticated user's current KYC verification status.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: KYC status retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     kycStatus: { type: string, example: "pending" }
 *                     isVerified: { type: boolean, example: false }
 *                     provider: { type: string, example: "didit" }
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 */
router.get('/status', protect, diditController.getStatus);

module.exports = router;