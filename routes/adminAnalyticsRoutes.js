const express = require('express');
const router = express.Router();
const { adminProtect } = require('../middleware/auth');
const { getOverview, getTransactionDetail } = require('../controller/adminAnalyticsController');

/**
 * @swagger
 * /admin/analytics/overview:
 *   get:
 *     summary: Get admin dashboard analytics overview
 *     description: Retrieve comprehensive analytics including daily, weekly, monthly, yearly stats, all-time totals, recent activity, and recent users
 *     tags: [Admin Analytics]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: year
 *         schema:
 *           type: integer
 *           example: 2024
 *         description: Filter data by specific year
 *       - in: query
 *         name: month
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 12
 *           example: 12
 *         description: Filter data by specific month (requires year parameter)
 *     responses:
 *       200:
 *         description: Successfully retrieved analytics data
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
 *                     daily:
 *                       $ref: '#/components/schemas/PeriodStats'
 *                     weekly:
 *                       $ref: '#/components/schemas/PeriodStats'
 *                     monthly:
 *                       $ref: '#/components/schemas/PeriodStats'
 *                     yearly:
 *                       $ref: '#/components/schemas/PeriodStats'
 *                     allTime:
 *                       $ref: '#/components/schemas/AllTimeStats'
 *                     recentActivity:
 *                       type: array
 *                       items:
 *                         oneOf:
 *                           - $ref: '#/components/schemas/TransactionActivity'
 *                           - $ref: '#/components/schemas/WithdrawalActivity'
 *                     recentUsers:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/RecentUser'
 *       401:
 *         description: Unauthorized - Invalid or missing token
 *       500:
 *         description: Server error
 * 
 * /admin/analytics/transaction/{transactionId}:
 *   get:
 *     summary: Get detailed transaction information
 *     description: Retrieve complete transaction details including user info, referrer, and share data
 *     tags: [Admin Analytics]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: transactionId
 *         required: true
 *         schema:
 *           type: string
 *         description: Transaction ID (either transactionId field or MongoDB _id)
 *         example: TXN_1234567890
 *     responses:
 *       200:
 *         description: Successfully retrieved transaction details
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
 *                     transaction:
 *                       $ref: '#/components/schemas/TransactionDetail'
 *                     user:
 *                       $ref: '#/components/schemas/UserDetail'
 *                     referrer:
 *                       $ref: '#/components/schemas/ReferrerDetail'
 *                     userShareData:
 *                       $ref: '#/components/schemas/UserShareData'
 *       401:
 *         description: Unauthorized - Invalid or missing token
 *       404:
 *         description: Transaction not found
 *       500:
 *         description: Server error
 */

router.get('/overview', adminProtect, getOverview);
router.get('/transaction/:transactionId', adminProtect, getTransactionDetail);

module.exports = router;