// routes/executiveRoutes.js
const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const executiveController = require('../controller/executiveController');
const { protect, adminProtect } = require('../middleware/auth');

// Multer — memory storage for Cloudinary upload
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 5 * 1024 * 1024 },          // 5 MB hard cap (matches controller check)
  fileFilter: (_req, file, cb) => {
    file.mimetype.startsWith('image/')
      ? cb(null, true)
      : cb(new Error('Only image files are allowed'), false);
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
 *             country: { type: string }
 *             state:   { type: string }
 *             city:    { type: string }
 *             address: { type: string }
 *         contactInfo:
 *           type: object
 *           properties:
 *             phone: { type: string }
 *             email: { type: string }
 *         shareInfo:
 *           type: object
 *           description: All share data is now expressed as ownership percentages (decimals)
 *           properties:
 *             totalOwnershipPct:     { type: number, example: 0.000084 }
 *             regularOwnershipPct:   { type: number, example: 0.000042 }
 *             cofounderOwnershipPct: { type: number, example: 0.000042 }
 *             totalEarningKobo:      { type: integer, example: 56000 }
 *             regularShares:         { type: integer, example: 2,   description: "Legacy count" }
 *             coFounderShares:       { type: integer, example: 0,   description: "Legacy count" }
 *             verifiedAt:            { type: string, format: date-time }
 */

// ===================================================================
// PUBLIC
// ===================================================================

/**
 * @swagger
 * /executives/approved:
 *   get:
 *     tags: [Executives - Public]
 *     summary: Get approved executives
 *     parameters:
 *       - { in: query, name: country, schema: { type: string } }
 *       - { in: query, name: state,   schema: { type: string } }
 *       - { in: query, name: page,    schema: { type: integer, default: 1  } }
 *       - { in: query, name: limit,   schema: { type: integer, default: 20 } }
 *     responses:
 *       200: { description: Executives retrieved successfully }
 */
router.get('/approved', executiveController.getApprovedExecutives);

// ===================================================================
// USER — Activation-Code Flow
// ===================================================================

/**
 * @swagger
 * /executives/redeem:
 *   post:
 *     tags: [Executives - User]
 *     summary: Redeem an activation code
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [code]
 *             properties:
 *               code: { type: string, example: "A1B2C3D4" }
 *     responses:
 *       200: { description: Code redeemed, complete profile next }
 *       400: { description: Already redeemed / invalid code }
 */
router.post('/redeem', protect, executiveController.redeemActivationCode);

/**
 * @swagger
 * /executives/admin/codes/stats:
 *   get:
 *     tags: [Executives - Admin]
 *     summary: Get code generation statistics
 *     security:
 *       - adminAuth: []
 *     responses:
 *       200: { description: Statistics retrieved }
 */
router.get('/admin/codes/stats', protect, adminProtect, executiveController.getCodeStatistics);

/**
 * @swagger
 * /executives/admin/generate-codes-bulk:
 *   post:
 *     tags: [Executives - Admin]
 *     summary: Generate multiple activation codes at once (UNLIMITED)
 *     security:
 *       - adminAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               count: { type: integer, default: 1, description: "Number of codes to generate" }
 *               userId: { type: string, description: "Pre-assign to a specific user (optional)" }
 *               note: { type: string }
 *     responses:
 *       201: { description: Codes generated }
 */
router.post('/admin/generate-codes-bulk', protect, adminProtect, executiveController.generateMultipleActivationCodes);


/**
 * @swagger
 * /executives/complete-profile:
 *   put:
 *     tags: [Executives - User]
 *     summary: Complete executive profile after redeeming a code
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
 *               country:          { type: string }
 *               state:            { type: string }
 *               city:             { type: string }
 *               address:          { type: string }
 *               phone:            { type: string }
 *               alternativePhone: { type: string }
 *               email:            { type: string }
 *               alternativeEmail: { type: string }
 *               bio:              { type: string }
 *               expertise:        { type: array, items: { type: string } }
 *               linkedin:         { type: string }
 *               twitter:          { type: string }
 *               facebook:         { type: string }
 *               instagram:        { type: string }
 *               profileImage:     { type: string, description: Cloudinary URL }
 *               latitude:         { type: number }
 *               longitude:        { type: number }
 *     responses:
 *       200: { description: Profile completed and auto-approved }
 *       400: { description: Validation error }
 *       404: { description: No redeemed code found }
 */
router.put('/complete-profile', protect, executiveController.completeProfile);

// ===================================================================
// USER — Image Upload + Legacy Apply + My Application + Self-Update
// ===================================================================

/**
 * @swagger
 * /executives/upload-image:
 *   post:
 *     tags: [Executives - User]
 *     summary: Upload executive profile image
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
 *               image: { type: string, format: binary, description: "Max 5 MB" }
 *     responses:
 *       200: { description: Image uploaded, returns imageUrl }
 *       400: { description: No file / wrong type / too large }
 */
router.post('/upload-image', protect, upload.single('image'), executiveController.uploadExecutiveImage);

/**
 * @swagger
 * /executives/apply:
 *   post:
 *     tags: [Executives - User]
 *     summary: Apply to become an executive (self-service, requires share ownership)
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
 *               country:      { type: string }
 *               state:        { type: string }
 *               city:         { type: string }
 *               address:      { type: string }
 *               phone:        { type: string }
 *               email:        { type: string }
 *               profileImage: { type: string }
 *               bio:          { type: string }
 *               expertise:    { type: array, items: { type: string } }
 *               linkedin:     { type: string }
 *               twitter:      { type: string }
 *               latitude:     { type: number }
 *               longitude:    { type: number }
 *     responses:
 *       201: { description: Application submitted, pending admin review }
 *       403: { description: No share ownership }
 */
router.post('/apply', protect, executiveController.applyAsExecutive);

/**
 * @swagger
 * /executives/my-application:
 *   get:
 *     tags: [Executives - User]
 *     summary: Get my executive application / status
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Application retrieved }
 *       404: { description: No application found }
 */
router.get('/my-application', protect, executiveController.getMyExecutiveApplication);

/**
 * @swagger
 * /executives/update:
 *   put:
 *     tags: [Executives - User]
 *     summary: Self-update executive contact / profile info
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               phone:            { type: string }
 *               alternativePhone: { type: string }
 *               email:            { type: string }
 *               alternativeEmail: { type: string }
 *               address:          { type: string }
 *               bio:              { type: string }
 *               expertise:        { type: array, items: { type: string } }
 *               linkedin:         { type: string }
 *               twitter:          { type: string }
 *               profileImage:     { type: string }
 *     responses:
 *       200: { description: Updated successfully }
 *       404: { description: Not found / not approved }
 */
router.put('/update', protect, executiveController.updateExecutiveInfo);

// ===================================================================
// ADMIN — Activation Code Management
// ===================================================================

/**
 * @swagger
 * /executives/admin/generate-code:
 *   post:
 *     tags: [Executives - Admin]
 *     summary: Generate an activation code
 *     security:
 *       - adminAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               userId: { type: string, description: "Pre-assign to a specific user (optional)" }
 *               note:   { type: string }
 *     responses:
 *       201: { description: Code generated }
 */
router.post('/admin/generate-code', protect, adminProtect, executiveController.generateActivationCode);

/**
 * @swagger
 * /executives/admin/codes:
 *   get:
 *     tags: [Executives - Admin]
 *     summary: List all activation codes
 *     security:
 *       - adminAuth: []
 *     parameters:
 *       - { in: query, name: page,     schema: { type: integer, default: 1  } }
 *       - { in: query, name: limit,    schema: { type: integer, default: 50 } }
 *       - { in: query, name: redeemed, schema: { type: string, enum: [true, false] }, description: "Filter by redemption status" }
 *     responses:
 *       200: { description: Codes listed }
 */
router.get('/admin/codes', protect, adminProtect, executiveController.listActivationCodes);

/**
 * @swagger
 * /executives/admin/codes/{code}:
 *   delete:
 *     tags: [Executives - Admin]
 *     summary: Revoke an unused activation code
 *     security:
 *       - adminAuth: []
 *     parameters:
 *       - { in: path, name: code, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Code revoked }
 *       400: { description: Code already redeemed }
 *       404: { description: Code not found }
 */
router.delete('/admin/codes/:code', protect, adminProtect, executiveController.revokeActivationCode);

// ===================================================================
// ADMIN — Application / Executive Management
//  IMPORTANT: Specific named paths MUST come before /:executiveId
// ===================================================================

/**
 * @swagger
 * /executives/admin/applications:
 *   get:
 *     tags: [Executives - Admin]
 *     summary: List all executive applications with filters
 *     security:
 *       - adminAuth: []
 *     parameters:
 *       - { in: query, name: status,    schema: { type: string, enum: [pending, approved, rejected, suspended] } }
 *       - { in: query, name: country,   schema: { type: string } }
 *       - { in: query, name: state,     schema: { type: string } }
 *       - { in: query, name: search,    schema: { type: string }, description: "Name / email / username" }
 *       - { in: query, name: sortBy,    schema: { type: string, default: applicationDate } }
 *       - { in: query, name: sortOrder, schema: { type: string, enum: [asc, desc], default: desc } }
 *       - { in: query, name: page,      schema: { type: integer, default: 1  } }
 *       - { in: query, name: limit,     schema: { type: integer, default: 20 } }
 *     responses:
 *       200: { description: Applications retrieved }
 */
router.get('/admin/applications', protect, adminProtect, executiveController.getAllExecutiveApplications);

/**
 * @swagger
 * /executives/admin/statistics:
 *   get:
 *     tags: [Executives - Admin]
 *     summary: Get executive statistics (% based ownership totals, regional breakdown, top executives)
 *     security:
 *       - adminAuth: []
 *     responses:
 *       200: { description: Statistics retrieved }
 */
router.get('/admin/statistics', protect, adminProtect, executiveController.getExecutiveStatistics);

/**
 * @swagger
 * /executives/admin/approve/{applicationId}:
 *   post:
 *     tags: [Executives - Admin]
 *     summary: Approve executive application
 *     security:
 *       - adminAuth: []
 *     parameters:
 *       - { in: path, name: applicationId, required: true, schema: { type: string } }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               adminNotes:      { type: string }
 *               roleTitle:       { type: string }
 *               responsibilities: { type: array, items: { type: string } }
 *               region:          { type: string }
 *     responses:
 *       200: { description: Approved }
 *       400: { description: Already processed }
 *       404: { description: Not found }
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
 *       - { in: path, name: applicationId, required: true, schema: { type: string } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [reason]
 *             properties:
 *               reason: { type: string }
 *     responses:
 *       200: { description: Rejected }
 *       400: { description: Already processed or missing reason }
 */
router.post('/admin/reject/:applicationId', protect, adminProtect, executiveController.rejectExecutiveApplication);

/**
 * @swagger
 * /executives/admin/suspend/{executiveId}:
 *   post:
 *     tags: [Executives - Admin]
 *     summary: Suspend an approved executive
 *     security:
 *       - adminAuth: []
 *     parameters:
 *       - { in: path, name: executiveId, required: true, schema: { type: string } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [reason]
 *             properties:
 *               reason:  { type: string }
 *               endDate: { type: string, format: date }
 *     responses:
 *       200: { description: Suspended }
 *       400: { description: Not approved / missing reason }
 */
router.post('/admin/suspend/:executiveId', protect, adminProtect, executiveController.suspendExecutive);

/**
 * @swagger
 * /executives/admin/reactivate/{executiveId}:
 *   post:
 *     tags: [Executives - Admin]
 *     summary: Reactivate a suspended executive
 *     security:
 *       - adminAuth: []
 *     parameters:
 *       - { in: path, name: executiveId, required: true, schema: { type: string } }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               adminNotes: { type: string }
 *     responses:
 *       200: { description: Reactivated }
 *       400: { description: Not suspended }
 *       404: { description: Not found }
 */
router.post('/admin/reactivate/:executiveId', protect, adminProtect, executiveController.reactivateExecutive);

/**
 * @swagger
 * /executives/admin/edit/{executiveId}:
 *   put:
 *     tags: [Executives - Admin]
 *     summary: Admin-edit any executive's profile fields
 *     description: Only fields included in the body are updated. All fields are optional.
 *     security:
 *       - adminAuth: []
 *     parameters:
 *       - { in: path, name: executiveId, required: true, schema: { type: string } }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               country:          { type: string }
 *               state:            { type: string }
 *               city:             { type: string }
 *               address:          { type: string }
 *               phone:            { type: string }
 *               alternativePhone: { type: string }
 *               email:            { type: string }
 *               alternativeEmail: { type: string }
 *               bio:              { type: string }
 *               expertise:        { type: array, items: { type: string } }
 *               linkedin:         { type: string }
 *               twitter:          { type: string }
 *               facebook:         { type: string }
 *               instagram:        { type: string }
 *               profileImage:     { type: string }
 *               roleTitle:        { type: string }
 *               responsibilities: { type: array, items: { type: string } }
 *               region:           { type: string }
 *               adminNotes:       { type: string }
 *     responses:
 *       200: { description: Executive updated }
 *       404: { description: Not found }
 */
router.put('/admin/edit/:executiveId', protect, adminProtect, executiveController.adminEditExecutive);

/**
 * @swagger
 * /executives/admin/refresh-shares/{executiveId}:
 *   post:
 *     tags: [Executives - Admin]
 *     summary: Re-sync an executive's shareInfo from current share records
 *     description: Useful after manual share adjustments to keep the executive record current.
 *     security:
 *       - adminAuth: []
 *     parameters:
 *       - { in: path, name: executiveId, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Share info refreshed }
 *       404: { description: Not found }
 */
router.post('/admin/refresh-shares/:executiveId', protect, adminProtect, executiveController.adminRefreshExecutiveShares);

/**
 * @swagger
 * /executives/admin/remove/{executiveId}:
 *   delete:
 *     tags: [Executives - Admin]
 *     summary: Permanently remove an executive record
 *     security:
 *       - adminAuth: []
 *     parameters:
 *       - { in: path, name: executiveId, required: true, schema: { type: string } }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reason: { type: string }
 *     responses:
 *       200: { description: Removed }
 *       404: { description: Not found }
 */
router.delete('/admin/remove/:executiveId', protect, adminProtect, executiveController.removeExecutive);

/**
 * @swagger
 * /executives/admin/{executiveId}:
 *   get:
 *     tags: [Executives - Admin]
 *     summary: Get a single executive record by ID
 *     security:
 *       - adminAuth: []
 *     parameters:
 *       - { in: path, name: executiveId, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Executive retrieved }
 *       404: { description: Not found }
 */
// NOTE: This generic /:executiveId GET must stay LAST among admin routes
router.get('/admin/:executiveId', protect, adminProtect, executiveController.getExecutiveById);

module.exports = router;