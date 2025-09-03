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
 *     description: Create a SmileID KYC verification link for a user. Only userId is required, all other fields have sensible defaults. Links automatically expire exactly 60 days from creation (any provided expiresAt value is ignored).
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - userId
 *             properties:
 *               userId:
 *                 type: string
 *                 description: User ID for whom to create the KYC link
 *                 example: "60f7c6b4c8f1a2b3c4d5e6f7"
 *               name:
 *                 type: string
 *                 description: User's full name (optional, will use user's name from database if not provided)
 *                 example: "John Doe"
 *               email:
 *                 type: string
 *                 format: email
 *                 description: User's email address (optional, will use user's email from database if not provided)
 *                 example: "john@example.com"
 *               country:
 *                 type: string
 *                 description: Country code (ISO 2-letter), defaults to "NG"
 *                 example: "NG"
 *                 default: "NG"
 *               idTypes:
 *                 type: array
 *                 description: Custom ID types (optional, will use Nigeria-supported defaults if not provided)
 *                 items:
 *                   type: object
 *                   properties:
 *                     country:
 *                       type: string
 *                       example: "NG"
 *                     id_type:
 *                       type: string
 *                       example: "NIN"
 *                       enum: [NIN, BVN, PASSPORT, DRIVERS_LICENSE, VOTER_ID]
 *                     verification_method:
 *                       type: string
 *                       example: "enhanced_kyc"
 *                       enum: [enhanced_kyc, biometric_kyc, doc_verification]
 *               companyName:
 *                 type: string
 *                 description: Company name (optional, uses COMPANY_NAME environment variable or "Afrimobile" if not provided)
 *                 example: "Afrimobile"
 *               callbackUrl:
 *                 type: string
 *                 description: URL to receive webhook notifications (optional, uses default webhook endpoint if not provided)
 *                 example: "https://yourapp.com/webhook/kyc"
 *               expiresAt:
 *                 type: string
 *                 format: date-time
 *                 description: Link expiration time (optional, defaults to 60 days from creation)
 *                 example: "2023-04-14T10:30:00.000Z"
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
 *                   type: object
 *                   properties:
 *                     linkId:
 *                       type: string
 *                       description: Unique identifier for the KYC link
 *                       example: "kyc_link_123456789"
 *                     url:
 *                       type: string
 *                       description: The verification URL users can access
 *                       example: "https://links.sandbox.usesmileid.com/partner_123/kyc_link_123456789"
 *                     userId:
 *                       type: string
 *                       description: User ID this link was created for
 *                       example: "60f7c6b4c8f1a2b3c4d5e6f7"
 *                     expiresAt:
 *                       type: string
 *                       format: date-time
 *                       description: When the link expires (60 days from creation)
 *                       example: "2023-04-14T10:30:00.000Z"
 *                     supportedIdTypes:
 *                       type: array
 *                       description: List of ID types supported by this link
 *                       items:
 *                         type: object
 *                         properties:
 *                           country:
 *                             type: string
 *                             example: "NG"
 *                           id_type:
 *                             type: string
 *                             example: "NIN"
 *                           verification_method:
 *                             type: string
 *                             example: "enhanced_kyc"
 *                     country:
 *                       type: string
 *                       description: Country this link is configured for
 *                       example: "NG"
 *       400:
 *         description: Bad request - validation failed or link creation failed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             examples:
 *               validation_error:
 *                 summary: Missing required field
 *                 value:
 *                   success: false
 *                   message: "User ID is required"
 *               creation_error:
 *                 summary: SmileID API error
 *                 value:
 *                   success: false
 *                   message: "Failed to create verification link"
 *                   error: "API Error: Invalid partner configuration"
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       404:
 *         description: User not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               success: false
 *               message: "User not found"
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/kyc/create-link', protect, userController.createKYCLink);

/**
 * @swagger
 * /users/kyc/create-bulk-links:
 *   post:
 *     tags: [KYC]
 *     summary: Create multiple KYC verification links
 *     description: Create multiple SmileID KYC verification links in bulk. Maximum 50 links per request. Each link automatically expires exactly 60 days from creation time.
 *     security:
 *       - bearerAuth: []
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
 *                   properties:
 *                     userId:
 *                       type: string
 *                       description: User ID for the KYC link
 *                       example: "60f7c6b4c8f1a2b3c4d5e6f7"
 *                     name:
 *                       type: string
 *                       description: User's name (optional)
 *                       example: "John Doe"
 *                     email:
 *                       type: string
 *                       description: User's email (optional)
 *                       example: "john@example.com"
 *                     country:
 *                       type: string
 *                       description: Country code (optional, defaults to "NG")
 *                       example: "NG"
 *                     idTypes:
 *                       type: array
 *                       description: Custom ID types for this specific link
 *                       items:
 *                         type: object
 *                         properties:
 *                           country:
 *                             type: string
 *                             example: "NG"
 *                           id_type:
 *                             type: string
 *                             example: "NIN"
 *                           verification_method:
 *                             type: string
 *                             example: "enhanced_kyc"
 *                     callbackUrl:
 *                       type: string
 *                       description: Custom callback URL for this link
 *                       example: "https://yourapp.com/webhook/kyc"
 *               companyName:
 *                 type: string
 *                 description: Company name for all links (optional)
 *                 example: "Afrimobile"
 *               batchId:
 *                 type: string
 *                 description: Batch identifier for tracking (optional, auto-generated if not provided)
 *                 example: "batch_20230115_001"
 *               defaultCallbackUrl:
 *                 type: string
 *                 description: Default callback URL for all links
 *                 example: "https://yourapp.com/webhook/kyc"
 *               defaultIdTypes:
 *                 type: array
 *                 description: Default ID types for all links (uses Nigeria-NIN defaults if not provided)
 *                 items:
 *                   type: object
 *                   properties:
 *                     country:
 *                       type: string
 *                       example: "NG"
 *                     id_type:
 *                       type: string
 *                       example: "NIN"
 *                     verification_method:
 *                       type: string
 *                       example: "enhanced_kyc"
 *     responses:
 *       201:
 *         description: Bulk KYC links processing completed
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
 *                   example: "Bulk KYC links created: 8 successful, 2 failed"
 *                 data:
 *                   type: object
 *                   properties:
 *                     successful:
 *                       type: array
 *                       description: Successfully created links
 *                       items:
 *                         type: object
 *                         properties:
 *                           userId:
 *                             type: string
 *                             example: "60f7c6b4c8f1a2b3c4d5e6f7"
 *                           userName:
 *                             type: string
 *                             example: "John Doe"
 *                           userEmail:
 *                             type: string
 *                             example: "john@example.com"
 *                           linkId:
 *                             type: string
 *                             example: "kyc_link_123456789"
 *                           url:
 *                             type: string
 *                             example: "https://links.sandbox.usesmileid.com/partner_123/kyc_link_123456789"
 *                           expiresAt:
 *                             type: string
 *                             format: date-time
 *                             example: "2023-04-14T10:30:00.000Z"
 *                     failed:
 *                       type: array
 *                       description: Failed link creation attempts
 *                       items:
 *                         type: object
 *                         properties:
 *                           userId:
 *                             type: string
 *                             example: "60f7c6b4c8f1a2b3c4d5e6f8"
 *                           userName:
 *                             type: string
 *                             example: "Jane Smith"
 *                           error:
 *                             type: string
 *                             example: "User not found"
 *                     summary:
 *                       type: object
 *                       description: Summary statistics
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
 *         description: Bad request - validation failed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             examples:
 *               empty_array:
 *                 summary: Empty links array
 *                 value:
 *                   success: false
 *                   message: "Links array is required and must not be empty"
 *               too_many_links:
 *                 summary: Too many links requested
 *                 value:
 *                   success: false
 *                   message: "Maximum 50 links can be created at once"
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/kyc/create-bulk-links', protect, userController.createBulkKYCLinks);

/**
 * @swagger
 * /users/kyc/link-status/{linkId}:
 *   get:
 *     tags: [KYC]
 *     summary: Get KYC link status
 *     description: Retrieve the current status and information of a KYC verification link from SmileID
 *     parameters:
 *       - in: path
 *         name: linkId
 *         required: true
 *         schema:
 *           type: string
 *         description: The KYC Link ID returned when the link was created
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
 *                 message:
 *                   type: string
 *                   example: "Link information retrieved successfully"
 *                 data:
 *                   type: object
 *                   description: SmileID link information response (structure varies based on SmileID API)
 *                   additionalProperties: true
 *       400:
 *         description: Bad request - invalid link ID or failed to get link information
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             examples:
 *               missing_link_id:
 *                 summary: Missing link ID
 *                 value:
 *                   success: false
 *                   message: "Link ID is required"
 *               link_not_found:
 *                 summary: Link not found or expired
 *                 value:
 *                   success: false
 *                   message: "Failed to get link information"
 *                   error: "Link not found or expired"
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
 *     description: |
 *       Receive verification results from SmileID webhook. This endpoint processes verification results and updates user KYC status.
 *       
 *       **Important**: This endpoint expects raw JSON data and includes signature verification for security.
 *       
 *       **Result Codes**:
 *       - `2814` - Verification successful (user will be marked as verified)
 *       - `2815` - Verification failed (user will be marked as failed)
 *       - Other codes - Verification pending (user will be marked as pending)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               job_id:
 *                 type: string
 *                 description: SmileID job identifier
 *                 example: "job_123456"
 *               user_id:
 *                 type: string
 *                 description: User ID from partner params (your user's ID)
 *                 example: "60f7c6b4c8f1a2b3c4d5e6f7"
 *               job_type:
 *                 type: string
 *                 description: Type of verification job performed
 *                 example: "biometric_kyc"
 *               result_type:
 *                 type: string
 *                 description: Type of verification result
 *                 example: "ID Verification"
 *               result_text:
 *                 type: string
 *                 description: Human readable result description
 *                 example: "Enroll User"
 *               result_code:
 *                 type: string
 *                 description: SmileID result code (2814=success, 2815=failed, others=pending)
 *                 example: "2814"
 *               confidence:
 *                 type: number
 *                 description: Confidence score of the verification (0-100)
 *                 example: 99.7
 *               smile_job_id:
 *                 type: string
 *                 description: SmileID internal job identifier
 *                 example: "0000001111"
 *               partner_params:
 *                 type: object
 *                 description: Custom parameters that were sent during link creation
 *                 properties:
 *                   user_id:
 *                     type: string
 *                     example: "60f7c6b4c8f1a2b3c4d5e6f7"
 *                   user_name:
 *                     type: string
 *                     example: "John Doe"
 *                   user_email:
 *                     type: string
 *                     example: "john@example.com"
 *                   created_by:
 *                     type: string
 *                     example: "backend_api"
 *               timestamp:
 *                 type: string
 *                 format: date-time
 *                 description: Timestamp when the verification was completed
 *                 example: "2023-01-20T15:30:45.123Z"
 *               id_type:
 *                 type: string
 *                 description: Type of ID document that was verified
 *                 example: "NIN"
 *               country:
 *                 type: string
 *                 description: Country code where verification was performed
 *                 example: "NG"
 *               Actions:
 *                 type: object
 *                 description: Alternative field for recommended actions (SmileID may use different field names)
 *                 additionalProperties: true
 *               ResultCode:
 *                 type: string
 *                 description: Alternative result code field (SmileID may use different field names)
 *                 example: "2814"
 *               ResultText:
 *                 type: string
 *                 description: Alternative result text field (SmileID may use different field names)
 *                 example: "Enroll User"
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
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *                   example: "2023-01-20T15:30:45.123Z"
 *       401:
 *         description: Unauthorized - Invalid webhook signature
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               success: false
 *               message: "Invalid webhook signature"
 *       500:
 *         description: Internal server error - Webhook processing failed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               success: false
 *               message: "Webhook processing failed"
 */
router.post('/kyc/webhook/smileid', express.raw({ type: 'application/json' }), userController.handleSmileIDWebhook);

module.exports = router;