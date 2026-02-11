// routes/executiveRoutes.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const executiveController = require('../controller/executiveController');
const { protect, adminProtect } = require('../middleware/auth');

// Configure multer for memory storage
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB max file size
  },
  fileFilter: (req, file, cb) => {
    // Accept images only
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  }
});

/**
 * @swagger
 * components:
 *   schemas:
 *     Executive:
 *       type: object
 *       properties:
 *         _id:
 *           type: string
 *         userId:
 *           type: string
 *         profileImage:
 *           type: string
 *         status:
 *           type: string
 *           enum: [pending, approved, rejected, suspended]
 *         location:
 *           type: object
 *           properties:
 *             country:
 *               type: string
 *             state:
 *               type: string
 *             city:
 *               type: string
 *             address:
 *               type: string
 *         contactInfo:
 *           type: object
 *           properties:
 *             phone:
 *               type: string
 *             email:
 *               type: string
 *         shareInfo:
 *           type: object
 *           properties:
 *             totalShares:
 *               type: number
 *             regularShares:
 *               type: number
 *             coFounderShares:
 *               type: number
 */

// ===================================================================
// PUBLIC ROUTES
// ===================================================================

/**
 * @swagger
 * /executives/approved:
 *   get:
 *     tags: [Executives - Public]
 *     summary: Get approved executives
 *     description: Get list of all approved executives (public)
 *     parameters:
 *       - in: query
 *         name: country
 *         schema:
 *           type: string
 *         description: Filter by country
 *       - in: query
 *         name: state
 *         schema:
 *           type: string
 *         description: Filter by state
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
 *     responses:
 *       200:
 *         description: Executives retrieved successfully
 */
router.get('/approved', executiveController.getApprovedExecutives);

// ===================================================================
// USER ROUTES
// ===================================================================

/**
 * @swagger
 * /executives/upload-image:
 *   post:
 *     tags: [Executives - User]
 *     summary: Upload executive profile image
 *     description: Upload profile picture for executive application
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [image]
 *             properties:
 *               image:
 *                 type: string
 *                 format: binary
 *                 description: Profile image file (max 5MB)
 *     responses:
 *       200:
 *         description: Image uploaded successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 imageUrl:
 *                   type: string
 *       400:
 *         description: Invalid file or no file provided
 */
router.post('/upload-image', protect, upload.single('image'), executiveController.uploadExecutiveImage);

/**
 * @swagger
 * /executives/apply:
 *   post:
 *     tags: [Executives - User]
 *     summary: Apply to become an executive
 *     description: Submit application to become an executive (requires shares and profile image)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [country, state, city, address, phone, email, profileImage]
 *             properties:
 *               country:
 *                 type: string
 *                 example: "Nigeria"
 *               state:
 *                 type: string
 *                 example: "Lagos"
 *               city:
 *                 type: string
 *                 example: "Ikeja"
 *               address:
 *                 type: string
 *                 example: "123 Main Street, Ikeja"
 *               phone:
 *                 type: string
 *                 example: "+2348123456789"
 *               alternativePhone:
 *                 type: string
 *               email:
 *                 type: string
 *                 example: "executive@example.com"
 *               alternativeEmail:
 *                 type: string
 *               profileImage:
 *                 type: string
 *                 description: Cloudinary URL of uploaded profile image
 *                 example: "https://res.cloudinary.com/..."
 *               bio:
 *                 type: string
 *               expertise:
 *                 type: array
 *                 items:
 *                   type: string
 *               linkedin:
 *                 type: string
 *               twitter:
 *                 type: string
 *               latitude:
 *                 type: number
 *               longitude:
 *                 type: number
 *     responses:
 *       201:
 *         description: Application submitted successfully
 *       400:
 *         description: Invalid request
 *       403:
 *         description: User doesn't have shares
 */
router.post('/apply', protect, executiveController.applyAsExecutive);

/**
 * @swagger
 * /executives/my-application:
 *   get:
 *     tags: [Executives - User]
 *     summary: Get my executive application
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Application retrieved successfully
 */
router.get('/my-application', protect, executiveController.getMyExecutiveApplication);

/**
 * @swagger
 * /executives/update:
 *   put:
 *     tags: [Executives - User]
 *     summary: Update executive information
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               phone:
 *                 type: string
 *               email:
 *                 type: string
 *               address:
 *                 type: string
 *               bio:
 *                 type: string
 *               profileImage:
 *                 type: string
 *     responses:
 *       200:
 *         description: Information updated successfully
 */
router.put('/update', protect, executiveController.updateExecutiveInfo);

// ===================================================================
// ADMIN ROUTES
// ===================================================================

/**
 * @swagger
 * /executives/admin/applications:
 *   get:
 *     tags: [Executives - Admin]
 *     summary: Get all executive applications
 *     security:
 *       - adminAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, approved, rejected, suspended]
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Applications retrieved successfully
 */
router.get('/admin/applications', protect, adminProtect, executiveController.getAllExecutiveApplications);

/**
 * @swagger
 * /executives/admin/approve/{applicationId}:
 *   post:
 *     tags: [Executives - Admin]
 *     summary: Approve executive application
 *     security:
 *       - adminAuth: []
 *     parameters:
 *       - in: path
 *         name: applicationId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               adminNotes:
 *                 type: string
 *               roleTitle:
 *                 type: string
 *               responsibilities:
 *                 type: array
 *                 items:
 *                   type: string
 *               region:
 *                 type: string
 *     responses:
 *       200:
 *         description: Application approved
 */
router.post('/admin/approve/:applicationId', protect, adminProtect, executiveController.approveExecutiveApplication);

/**
 * @swagger
 * /executives/admin/reject/{applicationId}:
 *   post:
 *     tags: [Executives - Admin]
 *     summary: Reject executive application
 *     security:
 *       - adminAuth: []
 *     parameters:
 *       - in: path
 *         name: applicationId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [reason]
 *             properties:
 *               reason:
 *                 type: string
 *     responses:
 *       200:
 *         description: Application rejected
 */
router.post('/admin/reject/:applicationId', protect, adminProtect, executiveController.rejectExecutiveApplication);

/**
 * @swagger
 * /executives/admin/suspend/{executiveId}:
 *   post:
 *     tags: [Executives - Admin]
 *     summary: Suspend executive
 *     security:
 *       - adminAuth: []
 *     parameters:
 *       - in: path
 *         name: executiveId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [reason]
 *             properties:
 *               reason:
 *                 type: string
 *               endDate:
 *                 type: string
 *                 format: date
 *     responses:
 *       200:
 *         description: Executive suspended
 */
router.post('/admin/suspend/:executiveId', protect, adminProtect, executiveController.suspendExecutive);

/**
 * @swagger
 * /executives/admin/remove/{executiveId}:
 *   delete:
 *     tags: [Executives - Admin]
 *     summary: Remove executive status
 *     security:
 *       - adminAuth: []
 *     parameters:
 *       - in: path
 *         name: executiveId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reason:
 *                 type: string
 *     responses:
 *       200:
 *         description: Executive removed
 */
router.delete('/admin/remove/:executiveId', protect, adminProtect, executiveController.removeExecutive);

/**
 * @swagger
 * /executives/admin/statistics:
 *   get:
 *     tags: [Executives - Admin]
 *     summary: Get executive statistics
 *     security:
 *       - adminAuth: []
 *     responses:
 *       200:
 *         description: Statistics retrieved successfully
 */
router.get('/admin/statistics', protect, adminProtect, executiveController.getExecutiveStatistics);

module.exports = router;