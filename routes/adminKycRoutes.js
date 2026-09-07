// routes/adminKycRoutes.js - Admin KYC review endpoints (admin only).
const express = require('express');
const router = express.Router();
const { protect, adminProtect } = require('../middleware/auth');
const adminKycController = require('../controller/adminKycController');

/**
 * @swagger
 * tags:
 *   - name: Admin KYC
 *     description: Admin review/override of user KYC verifications
 */

// Everything below requires a valid admin token
router.use(protect, adminProtect);

/**
 * @swagger
 * /admin/kyc:
 *   get:
 *     tags: [Admin KYC]
 *     summary: List users with their KYC state
 *     description: Paginated, filterable list (by kycStatus, search) of users with KYC info and their latest Didit verification.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: KYC list retrieved
 */
router.get('/', adminKycController.listKyc);

/**
 * @swagger
 * /admin/kyc/{userId}:
 *   get:
 *     tags: [Admin KYC]
 *     summary: Full KYC detail for one user
 *     security:
 *       - bearerAuth: []
 */
router.get('/:userId', adminKycController.getKycDetail);

/**
 * @swagger
 * /admin/kyc/{userId}/decision:
 *   post:
 *     tags: [Admin KYC]
 *     summary: Manually approve or disapprove a user's KYC
 *     description: Body - { action: 'approve' | 'disapprove', reason?: string }
 *     security:
 *       - bearerAuth: []
 */
router.post('/:userId/decision', adminKycController.processDecision);

module.exports = router;