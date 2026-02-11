const express = require('express');
const router = express.Router();
const { protect, adminProtect } = require('../middleware/auth');
const {
  getCompleteProjectOverview,
  getCompleteUserOverview
} = require('../controller/adminCompleteOverviewController');

/**
 * @swagger
 * /admin/complete-overview:
 *   get:
 *     summary: COMPLETE PROJECT OVERVIEW - EVERY MODEL
 *     description: Single endpoint that aggregates data from ALL 30+ models. One call, complete visibility.
 *     tags: [Admin Complete Overview]
 *     security:
 *       - adminAuth: []
 *     responses:
 *       200:
 *         description: Complete project overview with all models
 */
router.get('/complete-overview', protect, adminProtect, getCompleteProjectOverview);

/**
 * @swagger
 * /admin/user/{userId}/complete-overview:
 *   get:
 *     summary: COMPLETE USER OVERVIEW - ALL USER ACTIVITY
 *     description: Single endpoint for complete user activity across all modules
 *     tags: [Admin Complete Overview]
 *     security:
 *       - adminAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Complete user overview
 */
router.get('/user/:userId/complete-overview', protect, adminProtect, getCompleteUserOverview);

module.exports = router;