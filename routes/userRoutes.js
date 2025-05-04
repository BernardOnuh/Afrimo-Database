const express = require('express');
const router = express.Router();
const userController = require('../controller/userController');
const { protect, adminProtect } = require('../middleware/auth');

// Public routes
router.post('/register', userController.registerUser);
router.post('/login', userController.loginUser);
router.post('/forgot-password', userController.forgotPassword);
router.get('/verify-reset-token/:token', userController.verifyResetToken);
router.post('/reset-password/:token', userController.resetPassword);
router.post('/login-with-wallet', userController.loginWithWallet);

// Protected routes (require authentication)
router.get('/profile', protect, userController.getUserProfile);
router.put('/profile', protect, userController.updateUserProfile);
router.put('/password', protect, userController.updatePassword);

// Admin routes
router.post('/admin/grant-rights', protect, adminProtect, userController.grantAdminRights);

// Ban management routes (admin only)
router.post('/admin/users/:userId/ban', protect, adminProtect, userController.banUser);
router.post('/admin/users/:userId/unban', protect, adminProtect, userController.unbanUser);
router.get('/admin/users/banned', protect, adminProtect, userController.getBannedUsers);

module.exports = router;