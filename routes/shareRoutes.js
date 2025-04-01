// routes/shareRoutes.js
const express = require('express');
const router = express.Router();
const shareController = require('../controller/shareController');
const { protect, adminProtect } = require('../middleware/auth');

// Public routes
router.get('/info', shareController.getShareInfo);
router.post('/calculate', shareController.calculatePurchase);
router.get('/payment-config', shareController.getPaymentConfig);

// User routes (require authentication)
router.post('/paystack/initiate', protect, shareController.initiatePaystackPayment);
router.get('/paystack/verify/:reference', shareController.verifyPaystackPayment);
router.post('/web3/verify', protect, shareController.verifyWeb3Transaction); // New web3 verification endpoint
router.get('/user/shares', protect, shareController.getUserShares);

// Admin routes
router.post('/web3/verify', protect, shareController.verifyWeb3Transaction);
router.post('/admin/web3/verify', protect, adminProtect, shareController.adminVerifyWeb3Transaction); // New admin web3 verification
router.get('/admin/web3/transactions', protect, adminProtect, shareController.adminGetWeb3Transactions); // New admin web3 transactions list
router.post('/admin/update-pricing', protect, adminProtect, shareController.updateSharePricing);
router.post('/admin/add-shares', protect, adminProtect, shareController.adminAddShares);
router.post('/admin/update-wallet', protect, adminProtect, shareController.updateCompanyWallet);
router.get('/admin/transactions', protect, adminProtect, shareController.getAllTransactions);
router.get('/admin/statistics', protect, adminProtect, shareController.getShareStatistics);

module.exports = router;