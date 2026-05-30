const express = require('express');
const router = express.Router();
const tierController = require('../controller/tierController');
const { protect, adminProtect } = require('../middleware/auth');

/**
 * @swagger
 * tags:
 *   name: Share Tiers
 *   description: Share tier management endpoints
 */

/**
 * @swagger
 * /shares/tiers:
 *   get:
 *     tags:
 *       - Share Tiers
 *     summary: Get all share tiers
 *     description: Returns all share tiers including regular shares and co-founder tiers
 *     responses:
 *       200:
 *         description: Tiers retrieved successfully
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
 *                   additionalProperties:
 *                     type: object
 *                     properties:
 *                       name:
 *                         type: string
 *                       type:
 *                         type: string
 *                       priceUSD:
 *                         type: number
 *                       priceNGN:
 *                         type: number
 *                       percentPerShare:
 *                         type: number
 *                       earningPerPhone:
 *                         type: integer
 *                       sharesIncluded:
 *                         type: integer
 *       500:
 *         description: Server error
 */
router.get('/', tierController.getTiers);

/**
 * @swagger
 * /shares/tiers:
 *   post:
 *     tags:
 *       - Share Tiers
 *     summary: Create a new share tier
 *     description: Create a new share tier. Requires admin authentication.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - key
 *               - name
 *               - type
 *               - priceUSD
 *               - priceNGN
 *               - percentPerShare
 *             properties:
 *               key:
 *                 type: string
 *                 example: "diamond"
 *               name:
 *                 type: string
 *                 example: "Diamond Package"
 *               type:
 *                 type: string
 *                 enum: [share, co-founder]
 *               priceUSD:
 *                 type: number
 *                 example: 120
 *               priceNGN:
 *                 type: number
 *                 example: 200000
 *               percentPerShare:
 *                 type: number
 *                 example: 0.000168
 *               earningPerPhone:
 *                 type: integer
 *                 example: 112000
 *               sharesIncluded:
 *                 type: integer
 *                 example: 1
 *     responses:
 *       201:
 *         description: Tier created successfully
 *       400:
 *         description: Missing required fields or tier already exists
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 *       500:
 *         description: Server error
 */
router.post('/', protect, adminProtect, tierController.createTier);

/**
 * @swagger
 * /shares/tiers/{tierKey}:
 *   put:
 *     tags:
 *       - Share Tiers
 *     summary: Update a share tier
 *     description: Update an existing share tier. Requires admin authentication.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: tierKey
 *         required: true
 *         schema:
 *           type: string
 *         description: The tier key to update
 *         example: "basic"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               priceUSD:
 *                 type: number
 *               priceNGN:
 *                 type: number
 *               percentPerShare:
 *                 type: number
 *               earningPerPhone:
 *                 type: integer
 *               sharesIncluded:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Tier updated successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 *       404:
 *         description: Tier not found
 *       500:
 *         description: Server error
 */
router.put('/:tierKey', protect, adminProtect, tierController.updateTier);

/**
 * @swagger
 * /shares/tiers/{tierKey}:
 *   delete:
 *     tags:
 *       - Share Tiers
 *     summary: Delete a share tier
 *     description: Delete an existing share tier. Requires admin authentication.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: tierKey
 *         required: true
 *         schema:
 *           type: string
 *         description: The tier key to delete
 *         example: "diamond"
 *     responses:
 *       200:
 *         description: Tier deleted successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 *       404:
 *         description: Tier not found
 *       500:
 *         description: Server error
 */
router.delete('/:tierKey', protect, adminProtect, tierController.deleteTier);

module.exports = router;