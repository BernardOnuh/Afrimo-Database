const express = require('express');
const router = express.Router();
const userController = require('../controller/userController');
const { protect, adminProtect } = require('../middleware/auth');

/**
 * @swagger
 * components:
 *   schemas:
 *     User:
 *       type: object
 *       properties:
 *         _id:
 *           type: string
 *           example: "60f7c6b4c8f1a2b3c4d5e6f7"
 *         name:
 *           type: string
 *           example: "John Doe"
 *         email:
 *           type: string
 *           format: email
 *           example: "john@example.com"
 *         userName:
 *           type: string
 *           example: "johndoe"
 *         phoneNumber:
 *           type: string
 *           example: "+2341234567890"
 *         walletAddress:
 *           type: string
 *           example: "0x742d35Cc6643C673532925e2aC5c48C0F30A37a0"
 *         isAdmin:
 *           type: boolean
 *           example: false
 *         isBanned:
 *           type: boolean
 *           example: false
 *         isVerified:
 *           type: boolean
 *           example: true
 *         kycStatus:
 *           type: string
 *           enum: [pending, verified, failed, not_started]
 *           example: "verified"
 *         referralCode:
 *           type: string
 *           example: "REF123456"
 *         createdAt:
 *           type: string
 *           format: date-time
 *           example: "2023-01-15T10:30:00.000Z"
 *         updatedAt:
 *           type: string
 *           format: date-time
 *           example: "2023-01-15T10:30:00.000Z"
 *     
 *     KYCLink:
 *       type: object
 *       properties:
 *         linkId:
 *           type: string
 *           example: "kyc_link_123456789"
 *         url:
 *           type: string
 *           example: "https://portal.smileidentity.com/complete-kyc/kyc_link_123456789"
 *         status:
 *           type: string
 *           enum: [active, completed, expired, failed]
 *           example: "active"
 *         userId:
 *           type: string
 *           example: "60f7c6b4c8f1a2b3c4d5e6f7"
 *         expiresAt:
 *           type: string
 *           format: date-time
 *           example: "2023-01-22T10:30:00.000Z"
 *         createdAt:
 *           type: string
 *           format: date-time
 *           example: "2023-01-15T10:30:00.000Z"
 *     
 *     Error:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: false
 *         message:
 *           type: string
 *           example: "Error message"
 *     
 *     Success:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: true
 *         message:
 *           type: string
 *           example: "Operation successful"
 *   
 *   responses:
 *     ValidationError:
 *       description: Validation error
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/Error'
 *           example:
 *             success: false
 *             message: "Validation failed"
 *     
 *     UnauthorizedError:
 *       description: Authentication required
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/Error'
 *           example:
 *             success: false
 *             message: "Access denied. No token provided"
 *     
 *     ForbiddenError:
 *       description: Insufficient permissions
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/Error'
 *           example:
 *             success: false
 *             message: "Access denied. Admin privileges required"
 *     
 *     NotFoundError:
 *       description: Resource not found
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/Error'
 *           example:
 *             success: false
 *             message: "Resource not found"
 *     
 *     ServerError:
 *       description: Internal server error
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/Error'
 *           example:
 *             success: false
 *             message: "Internal server error"
 *   
 *   securitySchemes:
 *     bearerAuth:
 *       type: http
 *       scheme: bearer
 *       bearerFormat: JWT
 *     
 *     adminAuth:
 *       type: http
 *       scheme: bearer
 *       bearerFormat: JWT
 *       description: Admin-level JWT token required
 */

/**
 * @swagger
 * tags:
 *   - name: Authentication
 *     description: User authentication endpoints
 *   - name: Users
 *     description: User profile management endpoints
 *   - name: Admin
 *     description: Administrative endpoints (admin only)
 *   - name: KYC
 *     description: Know Your Customer verification endpoints
 */

/**
 * @swagger
 * /users/register:
 *   post:
 *     tags: [Authentication]
 *     summary: Register a new user
 *     description: Create a new user account
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - email
 *               - password
 *               - phoneNumber
 *             properties:
 *               name:
 *                 type: string
 *                 example: "John Doe"
 *               email:
 *                 type: string
 *                 format: email
 *                 example: "john@example.com"
 *               password:
 *                 type: string
 *                 minLength: 6
 *                 example: "password123"
 *               phoneNumber:
 *                 type: string
 *                 example: "+2341234567890"
 *               userName:
 *                 type: string
 *                 example: "johndoe"
 *               referralCode:
 *                 type: string
 *                 example: "REF123456"
 *     responses:
 *       201:
 *         description: User registered successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "User registered successfully"
 *                 data:
 *                   type: object
 *                   properties:
 *                     user:
 *                       $ref: '#/components/schemas/User'
 *                     token:
 *                       type: string
 *                       example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/register', userController.registerUser);

/**
 * @swagger
 * /users/login:
 *   post:
 *     tags: [Authentication]
 *     summary: Login user
 *     description: Authenticate user and return JWT token
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 example: "john@example.com"
 *               password:
 *                 type: string
 *                 example: "password123"
 *     responses:
 *       200:
 *         description: Login successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Login successful"
 *                 data:
 *                   type: object
 *                   properties:
 *                     user:
 *                       $ref: '#/components/schemas/User'
 *                     token:
 *                       type: string
 *                       example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         description: Invalid credentials
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               success: false
 *               message: "Invalid email or password"
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/login', userController.loginUser);

/**
 * @swagger
 * /users/forgot-password:
 *   post:
 *     tags: [Authentication]
 *     summary: Request password reset
 *     description: Send password reset email to user
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 example: "john@example.com"
 *     responses:
 *       200:
 *         description: Password reset email sent
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Success'
 *             example:
 *               success: true
 *               message: "Password reset email sent"
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/forgot-password', userController.forgotPassword);

/**
 * @swagger
 * /users/verify-reset-token/{token}:
 *   get:
 *     tags: [Authentication]
 *     summary: Verify password reset token
 *     description: Verify if password reset token is valid
 *     parameters:
 *       - in: path
 *         name: token
 *         required: true
 *         schema:
 *           type: string
 *         description: Password reset token
 *         example: "abc123def456"
 *     responses:
 *       200:
 *         description: Token is valid
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Success'
 *             example:
 *               success: true
 *               message: "Token is valid"
 *       400:
 *         description: Invalid or expired token
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               success: false
 *               message: "Invalid or expired token"
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/verify-reset-token/:token', userController.verifyResetToken);

/**
 * @swagger
 * /users/reset-password/{token}:
 *   post:
 *     tags: [Authentication]
 *     summary: Reset password
 *     description: Reset user password using reset token
 *     parameters:
 *       - in: path
 *         name: token
 *         required: true
 *         schema:
 *           type: string
 *         description: Password reset token
 *         example: "abc123def456"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - password
 *             properties:
 *               password:
 *                 type: string
 *                 minLength: 6
 *                 example: "newpassword123"
 *     responses:
 *       200:
 *         description: Password reset successful
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Success'
 *             example:
 *               success: true
 *               message: "Password reset successful"
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/reset-password/:token', userController.resetPassword);

/**
 * @swagger
 * /users/login-with-wallet:
 *   post:
 *     tags: [Authentication]
 *     summary: Login with wallet address
 *     description: Authenticate user using wallet address
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - walletAddress
 *             properties:
 *               walletAddress:
 *                 type: string
 *                 example: "0x742d35Cc6643C673532925e2aC5c48C0F30A37a0"
 *               signature:
 *                 type: string
 *                 example: "0x123456789abcdef..."
 *     responses:
 *       200:
 *         description: Wallet login successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Wallet login successful"
 *                 data:
 *                   type: object
 *                   properties:
 *                     user:
 *                       $ref: '#/components/schemas/User'
 *                     token:
 *                       type: string
 *                       example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/login-with-wallet', userController.loginWithWallet);

/**
 * @swagger
 * /users/profile:
 *   get:
 *     tags: [Users]
 *     summary: Get user profile
 *     description: Get current user's profile information
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User profile retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/User'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/profile', protect, userController.getUserProfile);

/**
 * @swagger
 * /users/profile:
 *   put:
 *     tags: [Users]
 *     summary: Update user profile
 *     description: Update current user's profile information
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *                 example: "John Doe Updated"
 *               phoneNumber:
 *                 type: string
 *                 example: "+2341234567890"
 *               userName:
 *                 type: string
 *                 example: "johndoe_updated"
 *     responses:
 *       200:
 *         description: Profile updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Profile updated successfully"
 *                 data:
 *                   $ref: '#/components/schemas/User'
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.put('/profile', protect, userController.updateUserProfile);

/**
 * @swagger
 * /users/password:
 *   put:
 *     tags: [Users]
 *     summary: Update user password
 *     description: Update current user's password
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - currentPassword
 *               - newPassword
 *             properties:
 *               currentPassword:
 *                 type: string
 *                 example: "oldpassword123"
 *               newPassword:
 *                 type: string
 *                 minLength: 6
 *                 example: "newpassword123"
 *     responses:
 *       200:
 *         description: Password updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Success'
 *             example:
 *               success: true
 *               message: "Password updated successfully"
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.put('/password', protect, userController.updatePassword);

/**
 * @swagger
 * /users/admin/grant-rights:
 *   post:
 *     tags: [Admin]
 *     summary: Grant admin rights to user
 *     description: Grant administrative privileges to a user (admin only)
 *     security:
 *       - adminAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 example: "user@example.com"
 *     responses:
 *       200:
 *         description: Admin rights granted successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Success'
 *             example:
 *               success: true
 *               message: "Admin rights granted successfully"
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/admin/grant-rights', protect, adminProtect, userController.grantAdminRights);

/**
 * @swagger
 * /users/admin/revoke-rights:
 *   post:
 *     tags: [Admin]
 *     summary: Revoke admin rights from user
 *     description: Remove administrative privileges from a user (admin only)
 *     security:
 *       - adminAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 example: "admin@example.com"
 *     responses:
 *       200:
 *         description: Admin rights revoked successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Success'
 *             example:
 *               success: true
 *               message: "Admin rights revoked successfully"
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/admin/revoke-rights', protect, adminProtect, userController.revokeAdminRights);

/**
 * @swagger
 * /users/admin/users/{userId}/ban:
 *   post:
 *     tags: [Admin]
 *     summary: Ban a user
 *     description: Ban a user from the platform (admin only)
 *     security:
 *       - adminAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *         description: User ID to ban
 *         example: "60f7c6b4c8f1a2b3c4d5e6f7"
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reason:
 *                 type: string
 *                 example: "Violation of terms of service"
 *     responses:
 *       200:
 *         description: User banned successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Success'
 *             example:
 *               success: true
 *               message: "User banned successfully"
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/admin/users/:userId/ban', protect, adminProtect, userController.banUser);

/**
 * @swagger
 * /users/admin/users/{userId}/unban:
 *   post:
 *     tags: [Admin]
 *     summary: Unban a user
 *     description: Remove ban from a user (admin only)
 *     security:
 *       - adminAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *         description: User ID to unban
 *         example: "60f7c6b4c8f1a2b3c4d5e6f7"
 *     responses:
 *       200:
 *         description: User unbanned successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Success'
 *             example:
 *               success: true
 *               message: "User unbanned successfully"
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/admin/users/:userId/unban', protect, adminProtect, userController.unbanUser);

/**
 * @swagger
 * /users/admin/users/banned:
 *   get:
 *     tags: [Admin]
 *     summary: Get banned users
 *     description: Get list of all banned users (admin only)
 *     security:
 *       - adminAuth: []
 *     parameters:
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
 *           default: 10
 *         description: Number of users per page
 *     responses:
 *       200:
 *         description: Banned users retrieved successfully
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
 *                     users:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/User'
 *                     pagination:
 *                       type: object
 *                       properties:
 *                         currentPage:
 *                           type: integer
 *                           example: 1
 *                         totalPages:
 *                           type: integer
 *                           example: 5
 *                         totalUsers:
 *                           type: integer
 *                           example: 50
 *                         hasNext:
 *                           type: boolean
 *                           example: true
 *                         hasPrev:
 *                           type: boolean
 *                           example: false
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/admin/users/banned', protect, adminProtect, userController.getBannedUsers);

/**
 * @swagger
 * /users/admin/users:
 *   get:
 *     tags: [Admin]
 *     summary: Get all users
 *     description: Get list of all users with pagination (admin only)
 *     security:
 *       - adminAuth: []
 *     parameters:
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
 *           default: 10
 *         description: Number of users per page
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search by name, email, or username
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [active, banned, all]
 *           default: all
 *         description: Filter by user status
 *     responses:
 *       200:
 *         description: Users retrieved successfully
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
 *                     users:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/User'
 *                     pagination:
 *                       type: object
 *                       properties:
 *                         currentPage:
 *                           type: integer
 *                           example: 1
 *                         totalPages:
 *                           type: integer
 *                           example: 5
 *                         totalUsers:
 *                           type: integer
 *                           example: 50
 *                         hasNext:
 *                           type: boolean
 *                           example: true
 *                         hasPrev:
 *                           type: boolean
 *                           example: false
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/admin/users', protect, adminProtect, userController.getAllUsers);

/**
 * @swagger
 * /users/admin/users/{userId}:
 *   get:
 *     tags: [Admin]
 *     summary: Get user by ID
 *     description: Get detailed information about a specific user (admin only)
 *     security:
 *       - adminAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *         description: User ID
 *         example: "60f7c6b4c8f1a2b3c4d5e6f7"
 *     responses:
 *       200:
 *         description: User retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/User'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/admin/users/:userId', protect, adminProtect, userController.getUserById);

/**
 * @swagger
 * /users/admin/admins:
 *   get:
 *     tags: [Admin]
 *     summary: Get all admin users
 *     description: Get list of all users with admin privileges (admin only)
 *     security:
 *       - adminAuth: []
 *     parameters:
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
 *           default: 10
 *         description: Number of admins per page
 *     responses:
 *       200:
 *         description: Admin users retrieved successfully
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
 *                     admins:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/User'
 *                     pagination:
 *                       type: object
 *                       properties:
 *                         currentPage:
 *                           type: integer
 *                           example: 1
 *                         totalPages:
 *                           type: integer
 *                           example: 2
 *                         totalAdmins:
 *                           type: integer
 *                           example: 15
 *                         hasNext:
 *                           type: boolean
 *                           example: true
 *                         hasPrev:
 *                           type: boolean
 *                           example: false
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/admin/admins', protect, adminProtect, userController.getAllAdmins);

/**
 * @swagger
 * /users/kyc/create-link:
 *   post:
 *     tags: [KYC]
 *     summary: Create KYC verification link
 *     description: Create a SmileID KYC verification link for a user
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - userId
 *               - partnerId
 *             properties:
 *               userId:
 *                 type: string
 *                 description: User ID for whom to create the KYC link
 *                 example: "60f7c6b4c8f1a2b3c4d5e6f7"
 *               partnerId:
 *                 type: string
 *                 description: SmileID partner ID
 *                 example: "partner_123"
 *               country:
 *                 type: string
 *                 description: Country code (ISO 2-letter)
 *                 example: "NG"
 *               idType:
 *                 type: string
 *                 description: Type of ID document to verify
 *                 example: "PASSPORT"
 *                 enum: [PASSPORT, NATIONAL_ID, DRIVERS_LICENSE, VOTER_ID]
 *               callbackUrl:
 *                 type: string
 *                 description: URL to receive webhook notifications
 *                 example: "https://yourapp.com/webhook/kyc"
 *               expiresAt:
 *                 type: string
 *                 format: date-time
 *                 description: Link expiration time (optional, defaults to 7 days)
 *                 example: "2023-01-22T10:30:00.000Z"
 *     responses:
 *       201:
 *         description: KYC link created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "KYC verification link created successfully"
 *                 data:
 *                   $ref: '#/components/schemas/KYCLink'
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/kyc/create-link', userController.createKYCLink);

/**
 * @swagger
 * /users/kyc/create-bulk-links:
 *   post:
 *     tags: [KYC]
 *     summary: Create multiple KYC verification links
 *     description: Create multiple SmileID KYC verification links in bulk
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - links
 *             properties:
 *               links:
 *                 type: array
 *                 description: Array of KYC link requests
 *                 minItems: 1
 *                 maxItems: 50
 *                 items:
 *                   type: object
 *                   required:
 *                     - userId
 *                     - partnerId
 *                   properties:
 *                     userId:
 *                       type: string
 *                       example: "60f7c6b4c8f1a2b3c4d5e6f7"
 *                     partnerId:
 *                       type: string
 *                       example: "partner_123"
 *                     country:
 *                       type: string
 *                       example: "NG"
 *                     idType:
 *                       type: string
 *                       example: "PASSPORT"
 *                     callbackUrl:
 *                       type: string
 *                       example: "https://yourapp.com/webhook/kyc"
 *               defaultCountry:
 *                 type: string
 *                 description: Default country for all links (can be overridden per link)
 *                 example: "NG"
 *               defaultIdType:
 *                 type: string
 *                 description: Default ID type for all links (can be overridden per link)
 *                 example: "PASSPORT"
 *               defaultCallbackUrl:
 *                 type: string
 *                 description: Default callback URL for all links (can be overridden per link)
 *                 example: "https://yourapp.com/webhook/kyc"
 *     responses:
 *       201:
 *         description: Bulk KYC links created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Bulk KYC verification links created successfully"
 *                 data:
 *                   type: object
 *                   properties:
 *                     successful:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/KYCLink'
 *                     failed:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           userId:
 *                             type: string
 *                             example: "60f7c6b4c8f1a2b3c4d5e6f7"
 *                           error:
 *                             type: string
 *                             example: "User not found"
 *                     summary:
 *                       type: object
 *                       properties:
 *                         total:
 *                           type: integer
 *                           example: 10
 *                         successful:
 *                           type: integer
 *                           example: 8
 *                         failed:
 *                           type: integer
 *                           example: 2
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/kyc/create-bulk-links', userController.createBulkKYCLinks);

/**
 * @swagger
 * /users/kyc/link-status/{linkId}:
 *   get:
 *     tags: [KYC]
 *     summary: Get KYC link status
 *     description: Get the current status and information of a KYC verification link
 *     parameters:
 *       - in: path
 *         name: linkId
 *         required: true
 *         schema:
 *           type: string
 *         description: KYC Link ID
 *         example: "kyc_link_123456789"
 *     responses:
 *       200:
 *         description: KYC link status retrieved successfully
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
 *                     linkInfo:
 *                       $ref: '#/components/schemas/KYCLink'
 *                     verificationResult:
 *                       type: object
 *                       description: Verification results (if completed)
 *                       properties:
 *                         resultCode:
 *                           type: string
 *                           example: "1012"
 *                         resultText:
 *                           type: string
 *                           example: "Enroll User"
 *                         smileJobId:
 *                           type: string
 *                           example: "0000001111"
 *                         partnerParams:
 *                           type: object
 *                           properties:
 *                             user_id:
 *                               type: string
 *                               example: "60f7c6b4c8f1a2b3c4d5e6f7"
 *                             job_id:
 *                               type: string
 *                               example: "kyc_job_123"
 *                         confidence:
 *                           type: number
 *                           example: 99.7
 *                         timestamp:
 *                           type: string
 *                           format: date-time
 *                           example: "2023-01-20T15:30:45.123Z"
 *       404:
 *         description: KYC link not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               success: false
 *               message: "KYC link not found"
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/kyc/link-status/:linkId', userController.getKYCLinkStatus);

/**
 * @swagger
 * /users/kyc/webhook/smileid:
 *   post:
 *     tags: [KYC]
 *     summary: SmileID webhook endpoint
 *     description: Receive verification results from SmileID webhook
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               signature:
 *                 type: string
 *                 description: SmileID signature for verification
 *                 example: "signature_hash_here"
 *               timestamp:
 *                 type: string
 *                 format: date-time
 *                 description: Timestamp of the webhook
 *                 example: "2023-01-20T15:30:45.123Z"
 *               link_id:
 *                 type: string
 *                 description: The KYC link ID
 *                 example: "kyc_link_123456789"
 *               result_code:
 *                 type: string
 *                 description: SmileID result code
 *                 example: "1012"
 *               result_text:
 *                 type: string
 *                 description: Human readable result
 *                 example: "Enroll User"
 *               smile_job_id:
 *                 type: string
 *                 description: SmileID job identifier
 *                 example: "0000001111"
 *               partner_params:
 *                 type: object
 *                 description: Custom parameters sent during link creation
 *                 properties:
 *                   user_id:
 *                     type: string
 *                     example: "60f7c6b4c8f1a2b3c4d5e6f7"
 *                   job_id:
 *                     type: string
 *                     example: "kyc_job_123"
 *               confidence:
 *                 type: number
 *                 description: Confidence score of the verification
 *                 example: 99.7
 *               id_info:
 *                 type: object
 *                 description: Extracted ID information
 *                 properties:
 *                   country:
 *                     type: string
 *                     example: "NG"
 *                   id_type:
 *                     type: string
 *                     example: "PASSPORT"
 *                   id_number:
 *                     type: string
 *                     example: "A12345678"
 *                   full_name:
 *                     type: string
 *                     example: "John Doe"
 *                   dob:
 *                     type: string
 *                     format: date
 *                     example: "1990-01-15"
 *               actions:
 *                 type: object
 *                 description: Recommended actions based on verification
 *                 properties:
 *                   verify_id_number:
 *                     type: boolean
 *                     example: true
 *                   return_personal_info:
 *                     type: boolean
 *                     example: true
 *                   human_review_compare:
 *                     type: boolean
 *                     example: false
 *     responses:
 *       200:
 *         description: Webhook processed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Webhook processed successfully"
 *       400:
 *         description: Invalid webhook data or signature
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               success: false
 *               message: "Invalid webhook signature"
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/kyc/webhook/smileid', express.raw({ type: 'application/json' }), userController.handleSmileIDWebhook);

module.exports = router;