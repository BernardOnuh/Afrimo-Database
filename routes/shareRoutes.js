const express = require('express');
const router = express.Router();
const shareController = require('../controller/shareController');
const { protect, adminProtect } = require('../middleware/auth');

// Public routes
router.get('/info', shareController.getShareInfo);
router.post('/calculate', shareController.calculatePurchase);
router.get('/payment-config', shareController.getPaymentConfig); // New route for payment config

// User routes (require authentication)
router.post('/paystack/initiate', protect, shareController.initiatePaystackPayment);
router.post('/crypto/submit', protect, shareController.processCryptoPayment);
router.get('/paystack/verify/:reference', shareController.verifyPaystackPayment);
router.get('/user/shares', protect, shareController.getUserShares);

// Admin routes
router.post('/admin/verify-crypto', protect, shareController.verifyCryptoPayment);
router.post('/admin/update-pricing', protect, shareController.updateSharePricing);
router.post('/admin/add-shares', protect, shareController.adminAddShares);
router.post('/admin/update-wallet', protect, shareController.updateCompanyWallet); // New route to update company wallet
router.get('/admin/transactions', protect, shareController.getAllTransactions);
router.get('/admin/statistics', protect, shareController.getShareStatistics);

module.exports = router;