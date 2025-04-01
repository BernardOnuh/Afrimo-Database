// Updated /routes/userRoutes.js
const express = require('express');
const router = express.Router();
const userController = require('../controller/userController');
const { protect } = require('../middleware/auth');

// Public routes
// Register new user
router.post('/register', userController.registerUser);

// Login user
router.post('/login', userController.loginUser);

// Forgot password
router.post('/forgot-password', userController.forgotPassword);

// Verify reset token (check if valid without resetting)
router.get('/verify-reset-token/:token', userController.verifyResetToken);

// Reset password (with token in URL)
router.post('/reset-password/:token', userController.resetPassword);

// Login with wallet
router.post('/login-with-wallet', userController.loginWithWallet);

// Protected routes (require authentication)
// Get user profile
router.get('/profile', protect, userController.getUserProfile);

// Update user profile
router.put('/profile', protect, userController.updateUserProfile);

// Update password
router.put('/password', protect, userController.updatePassword);

module.exports = router;