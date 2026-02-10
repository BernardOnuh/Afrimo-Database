const express = require('express');
const router = express.Router();
const tierController = require('../controller/tierController');
const { protect, adminProtect } = require('../middleware/auth');

/**
 * @swagger
 * tags:
 *   - name: Shares - Tier Management
 *     description: Admin tier configuration and package management
 */

// ==================== TIER MANAGEMENT ROUTES ====================

/**
 * @swagger
 * /shares/admin/tiers:
 *   get:
 *     tags: [Shares - Tier Management]
 *     summary: Get all tier configurations
 *     description: |
 *       View all 6-tier share structure configurations with current sales data.
 *       
 *       **Tier Structure:**
 *       - **REGULAR SHARES:**
 *         - Basic: $30 / ₦30,000 (0.00001% per share)
 *         - Standard: $50 / ₦50,000 (0.000021% per share)
 *         - Premium: $100 / ₦100,000 (0.00005% per share)
 *       
 *       - **CO-FOUNDER TIERS:**
 *         - Elite: $1,000 / ₦1,000,000 (22 shares @ 0.000021% each)
 *         - Platinum: $2,500 / ₦2,500,000 (27 shares @ 0.00005% each)
 *         - Supreme: $5,000 / ₦5,000,000 (60 shares @ 0.00005% each)
 *     security:
 *       - adminAuth: []
 *     responses:
 *       200:
 *         description: All tier configurations retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 tiers:
 *                   type: object
 *                   properties:
 *                     basic:
 *                       type: object
 *                       properties:
 *                         name:
 *                           type: string
 *                           example: "Basic"
 *                         type:
 *                           type: string
 *                           enum: [regular, cofounder]
 *                         priceUSD:
 *                           type: number
 *                         priceNGN:
 *                           type: number
 *                         percentPerShare:
 *                           type: number
 *                         earningPerPhone:
 *                           type: number
 *                         sharesIncluded:
 *                           type: integer
 *                         sold:
 *                           type: integer
 *                         percentSold:
 *                           type: string
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       500:
 *         description: Server error
 */
router.get('/admin/tiers', protect, adminProtect, tierController.getAllTiers);

/**
 * @swagger
 * /shares/admin/tiers/edit:
 *   post:
 *     tags: [Shares - Tier Management]
 *     summary: Edit a single tier configuration
 *     description: |
 *       Update pricing, percentages, or other properties of a specific tier.
 *       
 *       **Editable Fields:**
 *       - priceUSD: 0.01 - 50,000
 *       - priceNGN: 100 - 50,000,000
 *       - percentPerShare: 0.00001 - 0.1
 *       - earningPerPhone: ≥ 0
 *       - sharesIncluded: 1 - 1,000
 *       
 *       **Example Tier Keys:** basic, standard, premium, elite, platinum, supreme
 *     security:
 *       - adminAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - tier
 *             properties:
 *               tier:
 *                 type: string
 *                 enum: [basic, standard, premium, elite, platinum, supreme]
 *                 example: "standard"
 *               priceUSD:
 *                 type: number
 *                 minimum: 0.01
 *                 maximum: 50000
 *                 example: 55
 *               priceNGN:
 *                 type: number
 *                 minimum: 100
 *                 maximum: 50000000
 *                 example: 55000
 *               percentPerShare:
 *                 type: number
 *                 minimum: 0.00001
 *                 maximum: 0.1
 *                 example: 0.000025
 *               earningPerPhone:
 *                 type: number
 *                 minimum: 0
 *                 example: 16000
 *               sharesIncluded:
 *                 type: integer
 *                 minimum: 1
 *                 maximum: 1000
 *               reason:
 *                 type: string
 *                 example: "Market adjustment"
 *     responses:
 *       200:
 *         description: Tier updated successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       500:
 *         description: Server error
 */
router.post('/admin/tiers/edit', protect, adminProtect, tierController.editShareTier);

/**
 * @swagger
 * /shares/admin/tiers/bulk-update:
 *   post:
 *     tags: [Shares - Tier Management]
 *     summary: Update multiple tiers atomically
 *     description: |
 *       Update multiple tiers in a single atomic transaction.
 *       All changes succeed or all fail together.
 *     security:
 *       - adminAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - updates
 *             properties:
 *               updates:
 *                 type: array
 *                 minItems: 1
 *                 items:
 *                   type: object
 *                   required:
 *                     - tier
 *                   properties:
 *                     tier:
 *                       type: string
 *                     priceUSD:
 *                       type: number
 *                     priceNGN:
 *                       type: number
 *               reason:
 *                 type: string
 *     responses:
 *       200:
 *         description: All tiers updated successfully
 *       400:
 *         description: Validation failed
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       500:
 *         description: Server error
 */
router.post('/admin/tiers/bulk-update', protect, adminProtect, tierController.bulkUpdateTiers);

/**
 * @swagger
 * /shares/admin/tiers/history:
 *   get:
 *     tags: [Shares - Tier Management]
 *     summary: Get tier change audit log
 *     description: View complete history of all tier modifications
 *     security:
 *       - adminAuth: []
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
 *           default: 50
 *     responses:
 *       200:
 *         description: Audit log retrieved
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       500:
 *         description: Server error
 */
router.get('/admin/tiers/history', protect, adminProtect, tierController.getTierChangeHistory);

// ==================== PACKAGE MANAGEMENT ROUTES ====================

/**
 * @swagger
 * /shares/admin/packages/create:
 *   post:
 *     tags: [Shares - Tier Management]
 *     summary: Create investment package
 *     description: |
 *       Create bundles combining multiple tiers with discounts and bonuses.
 *       
 *       **Package Types:**
 *       - bundle: Combination of tiers
 *       - promotional: Time-limited offers
 *       - seasonal: Seasonal bundles
 *       - custom: Corporate packages
 *       - loyalty: Loyalty rewards
 *     security:
 *       - adminAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - packageType
 *               - tiers
 *             properties:
 *               name:
 *                 type: string
 *                 minLength: 1
 *                 maxLength: 100
 *                 example: "Q1 2024 Bundle"
 *               description:
 *                 type: string
 *                 maxLength: 1000
 *               packageType:
 *                 type: string
 *                 enum: [bundle, promotional, seasonal, custom, loyalty]
 *               tiers:
 *                 type: array
 *                 minItems: 1
 *                 items:
 *                   type: object
 *                   required:
 *                     - tier
 *                     - quantity
 *                   properties:
 *                     tier:
 *                       type: string
 *                       enum: [basic, standard, premium, elite, platinum, supreme]
 *                     quantity:
 *                       type: integer
 *                       minimum: 1
 *                     discount:
 *                       type: number
 *                       minimum: 0
 *                       maximum: 100
 *               totalDiscount:
 *                 type: number
 *                 minimum: 0
 *                 maximum: 50
 *                 example: 15
 *               bonusShares:
 *                 type: integer
 *                 minimum: 0
 *                 example: 5
 *               bonusPercentage:
 *                 type: number
 *                 minimum: 0
 *               availability:
 *                 type: object
 *                 properties:
 *                   availableFrom:
 *                     type: string
 *                     format: date-time
 *                   availableUntil:
 *                     type: string
 *                     format: date-time
 *                   maxPurchases:
 *                     type: integer
 *               benefits:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       200:
 *         description: Package created successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       500:
 *         description: Server error
 */
router.post('/admin/packages/create', protect, adminProtect, tierController.createPackage);

/**
 * @swagger
 * /shares/admin/packages:
 *   get:
 *     tags: [Shares - Tier Management]
 *     summary: List all investment packages
 *     description: Get all packages with filtering and pagination
 *     security:
 *       - adminAuth: []
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
 *           default: 20
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [bundle, promotional, seasonal, custom, loyalty]
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [active, inactive, expired]
 *     responses:
 *       200:
 *         description: Packages retrieved
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       500:
 *         description: Server error
 */
router.get('/admin/packages', protect, adminProtect, tierController.getAllPackages);

/**
 * @swagger
 * /shares/admin/packages/{packageId}/edit:
 *   put:
 *     tags: [Shares - Tier Management]
 *     summary: Edit investment package
 *     description: Modify existing package properties
 *     security:
 *       - adminAuth: []
 *     parameters:
 *       - in: path
 *         name: packageId
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
 *               name:
 *                 type: string
 *               description:
 *                 type: string
 *               totalDiscount:
 *                 type: number
 *               bonusShares:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Package updated
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Not found
 *       500:
 *         description: Server error
 */
router.put('/admin/packages/:packageId/edit', protect, adminProtect, tierController.editPackage);

/**
 * @swagger
 * /shares/admin/packages/{packageId}/delete:
 *   delete:
 *     tags: [Shares - Tier Management]
 *     summary: Delete investment package
 *     description: Remove a package (only if no sales)
 *     security:
 *       - adminAuth: []
 *     parameters:
 *       - in: path
 *         name: packageId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Package deleted
 *       400:
 *         description: Cannot delete - has sales
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Not found
 *       500:
 *         description: Server error
 */
router.delete('/admin/packages/:packageId/delete', protect, adminProtect, tierController.deletePackage);

module.exports = router;