const express = require('express');
const router = express.Router();
const referralController = require('../controller/referralController');
const { protect, adminProtect } = require('../middleware/auth');

// ========== USER ROUTES ==========

/**
 * @swagger
 * /api/referral/stats:
 *   get:
 *     summary: Get user's referral statistics
 *     description: Retrieve referral code (username) and comprehensive referral statistics for the authenticated user
 *     tags: [User - Referral]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Referral statistics retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 referralCode:
 *                   type: string
 *                   description: User's referral code (username)
 *                   example: "johnsmith"
 *                 totalReferrals:
 *                   type: number
 *                   description: Total number of people referred
 *                   example: 15
 *                 activeReferrals:
 *                   type: number
 *                   description: Number of active referred users
 *                   example: 12
 *                 totalEarnings:
 *                   type: number
 *                   description: Total commission earned from referrals
 *                   example: 1250.50
 *                 pendingEarnings:
 *                   type: number
 *                   description: Pending commission earnings
 *                   example: 300.25
 *                 thisMonthReferrals:
 *                   type: number
 *                   description: Referrals made this month
 *                   example: 3
 *                 thisMonthEarnings:
 *                   type: number
 *                   description: Earnings from this month
 *                   example: 150.75
 *       401:
 *         description: Unauthorized - Invalid or missing token
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/stats', protect, referralController.getReferralStats);

/**
 * @swagger
 * /api/referral/tree:
 *   get:
 *     summary: Get referral tree
 *     description: Retrieve the referral tree showing all people referred by the authenticated user
 *     tags: [User - Referral]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: depth
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 5
 *           default: 3
 *         description: Depth of referral tree to retrieve
 *       - in: query
 *         name: includeInactive
 *         schema:
 *           type: boolean
 *           default: false
 *         description: Include inactive referrals in the tree
 *     responses:
 *       200:
 *         description: Referral tree retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 tree:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       username:
 *                         type: string
 *                       email:
 *                         type: string
 *                       joinDate:
 *                         type: string
 *                         format: date-time
 *                       isActive:
 *                         type: boolean
 *                       totalPurchases:
 *                         type: number
 *                       commissionEarned:
 *                         type: number
 *                       children:
 *                         type: array
 *                         items:
 *                           type: object
 *                 totalLevels:
 *                   type: number
 *                 totalReferrals:
 *                   type: number
 *       401:
 *         description: Unauthorized
 */
router.get('/tree', protect, referralController.getReferralTree);

/**
 * @swagger
 * /api/referral/earnings:
 *   get:
 *     summary: Get referral earnings
 *     description: Retrieve detailed referral earnings for the authenticated user
 *     tags: [User - Referral]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: period
 *         schema:
 *           type: string
 *           enum: [all, today, week, month, quarter, year]
 *           default: all
 *         description: Time period for earnings calculation
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *           default: 1
 *         description: Page number for pagination
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 20
 *         description: Number of records per page
 *     responses:
 *       200:
 *         description: Referral earnings retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 summary:
 *                   type: object
 *                   properties:
 *                     totalEarnings:
 *                       type: number
 *                     paidEarnings:
 *                       type: number
 *                     pendingEarnings:
 *                       type: number
 *                     commission:
 *                       type: number
 *                       description: Current commission percentage
 *                 earnings:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       referredUser:
 *                         type: string
 *                       transactionId:
 *                         type: string
 *                       amount:
 *                         type: number
 *                       commission:
 *                         type: number
 *                       status:
 *                         type: string
 *                         enum: [pending, paid, cancelled]
 *                       createdAt:
 *                         type: string
 *                         format: date-time
 *                 pagination:
 *                   type: object
 *                   properties:
 *                     page:
 *                       type: integer
 *                     limit:
 *                       type: integer
 *                     total:
 *                       type: integer
 *                     pages:
 *                       type: integer
 *       401:
 *         description: Unauthorized
 */
router.get('/earnings', protect, referralController.getReferralEarnings);

/**
 * @swagger
 * /api/referral/generate-invite:
 *   post:
 *     summary: Generate custom invite link
 *     description: Create a custom invite link for sharing referral code
 *     tags: [User - Referral]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               customMessage:
 *                 type: string
 *                 maxLength: 200
 *                 description: Custom message to include with the invite
 *                 example: "Join me on this amazing platform!"
 *               expiresIn:
 *                 type: integer
 *                 minimum: 1
 *                 maximum: 365
 *                 description: Number of days until invite expires
 *                 example: 30
 *               trackingData:
 *                 type: object
 *                 description: Additional tracking data for analytics
 *                 properties:
 *                   source:
 *                     type: string
 *                     example: "social_media"
 *                   campaign:
 *                     type: string
 *                     example: "summer_promotion"
 *     responses:
 *       201:
 *         description: Custom invite link generated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 inviteCode:
 *                   type: string
 *                   description: Generated invite code
 *                   example: "INV-ABC123XYZ"
 *                 inviteLink:
 *                   type: string
 *                   description: Full invite URL
 *                   example: "https://yourapp.com/signup?ref=INV-ABC123XYZ"
 *                 expiresAt:
 *                   type: string
 *                   format: date-time
 *                   description: Invite expiration date
 *                 shortUrl:
 *                   type: string
 *                   description: Shortened URL for easy sharing
 *                   example: "https://yourapp.com/i/ABC123"
 *       400:
 *         description: Invalid request data
 *       401:
 *         description: Unauthorized
 */
router.post('/generate-invite', protect, referralController.generateCustomInviteLink);

/**
 * @swagger
 * /api/referral/validate-invite/{inviteCode}:
 *   get:
 *     summary: Validate invite link
 *     description: Validate an invite code and return referrer information
 *     tags: [Public - Referral]
 *     parameters:
 *       - in: path
 *         name: inviteCode
 *         required: true
 *         schema:
 *           type: string
 *         description: Invite code to validate
 *         example: "INV-ABC123XYZ"
 *     responses:
 *       200:
 *         description: Invite code is valid
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 valid:
 *                   type: boolean
 *                   example: true
 *                 referrer:
 *                   type: object
 *                   properties:
 *                     username:
 *                       type: string
 *                       example: "johnsmith"
 *                     displayName:
 *                       type: string
 *                       example: "John Smith"
 *                     avatar:
 *                       type: string
 *                       example: "https://example.com/avatar.jpg"
 *                 customMessage:
 *                   type: string
 *                   example: "Join me on this amazing platform!"
 *                 commission:
 *                   type: number
 *                   description: Commission percentage for new users
 *                   example: 10
 *                 expiresAt:
 *                   type: string
 *                   format: date-time
 *       400:
 *         description: Invalid or expired invite code
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 valid:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: "Invite code has expired"
 *       404:
 *         description: Invite code not found
 */
router.get('/validate-invite/:inviteCode', referralController.validateInviteLink);

// ========== ADMIN ROUTES ==========

/**
 * @swagger
 * /api/referral/admin/earnings:
 *   get:
 *     summary: Get any user's referral earnings (Admin)
 *     description: Retrieve referral earnings for any user by username or email (admin only)
 *     tags: [Admin - Referral]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: userName
 *         schema:
 *           type: string
 *         description: Username of the user to query
 *         example: "johnsmith"
 *       - in: query
 *         name: email
 *         schema:
 *           type: string
 *           format: email
 *         description: Email of the user to query
 *         example: "john@example.com"
 *       - in: query
 *         name: userId
 *         schema:
 *           type: string
 *         description: User ID to query
 *       - in: query
 *         name: period
 *         schema:
 *           type: string
 *           enum: [all, today, week, month, quarter, year]
 *           default: all
 *         description: Time period for earnings calculation
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
 *     responses:
 *       200:
 *         description: User referral earnings retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 user:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                     username:
 *                       type: string
 *                     email:
 *                       type: string
 *                 summary:
 *                   type: object
 *                   properties:
 *                     totalEarnings:
 *                       type: number
 *                     paidEarnings:
 *                       type: number
 *                     pendingEarnings:
 *                       type: number
 *                 earnings:
 *                   type: array
 *                   items:
 *                     type: object
 *                 pagination:
 *                   type: object
 *       400:
 *         description: Missing required query parameter (userName, email, or userId)
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 *       404:
 *         description: User not found
 */
router.get('/admin/earnings', protect, adminProtect, referralController.getReferralEarnings);

/**
 * @swagger
 * /api/referral/settings:
 *   post:
 *     summary: Update referral commission settings
 *     description: Update global referral commission settings and policies (admin only)
 *     tags: [Admin - Referral]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               defaultCommission:
 *                 type: number
 *                 minimum: 0
 *                 maximum: 100
 *                 description: Default commission percentage for new referrals
 *                 example: 10
 *               tieredCommission:
 *                 type: object
 *                 description: Tiered commission structure
 *                 properties:
 *                   enabled:
 *                     type: boolean
 *                   tiers:
 *                     type: array
 *                     items:
 *                       type: object
 *                       properties:
 *                         referralCount:
 *                           type: number
 *                         commission:
 *                           type: number
 *               minimumPayout:
 *                 type: number
 *                 minimum: 0
 *                 description: Minimum amount required for payout
 *                 example: 50
 *               payoutFrequency:
 *                 type: string
 *                 enum: [daily, weekly, monthly, quarterly]
 *                 description: How often payouts are processed
 *               maxReferralDepth:
 *                 type: integer
 *                 minimum: 1
 *                 maximum: 10
 *                 description: Maximum depth for multi-level referrals
 *                 example: 3
 *               bonusSettings:
 *                 type: object
 *                 properties:
 *                   firstReferralBonus:
 *                     type: number
 *                   milestoneBonus:
 *                     type: object
 *     responses:
 *       200:
 *         description: Referral settings updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Referral settings updated successfully"
 *                 settings:
 *                   type: object
 *                   description: Updated settings object
 *       400:
 *         description: Invalid settings data
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 */
router.post('/settings', protect, adminProtect, referralController.updateReferralSettings);

/**
 * @swagger
 * /api/referral/admin/sync/{userId}:
 *   post:
 *     summary: Sync referral data for a specific user
 *     description: Manually trigger synchronization of referral data for a specific user (admin only)
 *     tags: [Admin - Referral]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *         description: User ID to sync referral data for
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               fullSync:
 *                 type: boolean
 *                 default: false
 *                 description: Whether to perform a full sync or incremental sync
 *               recalculateEarnings:
 *                 type: boolean
 *                 default: false
 *                 description: Whether to recalculate all earnings
 *               syncDepth:
 *                 type: integer
 *                 minimum: 1
 *                 maximum: 10
 *                 default: 3
 *                 description: Depth of referral tree to sync
 *     responses:
 *       200:
 *         description: Referral data sync completed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Referral data sync completed successfully"
 *                 syncResults:
 *                   type: object
 *                   properties:
 *                     syncedReferrals:
 *                       type: number
 *                     updatedEarnings:
 *                       type: number
 *                     errors:
 *                       type: array
 *                       items:
 *                         type: string
 *                     duration:
 *                       type: string
 *                       example: "2.5s"
 *       400:
 *         description: Invalid user ID or sync parameters
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 *       404:
 *         description: User not found
 *       500:
 *         description: Sync operation failed
 */
router.post('/admin/sync/:userId', protect, adminProtect, referralController.syncUserReferralData);

module.exports = router;