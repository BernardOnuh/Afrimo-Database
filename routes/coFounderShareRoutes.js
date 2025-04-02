const express = require('express');
const router = express.Router();
const coFounderShareController = require('../controller/coFounderShareController');
const { protect, adminProtect } = require('../middleware/auth');

// Public routes
router.get('/cofounder/info', coFounderShareController.getCoFounderShareInfo);
router.post('/cofounder/calculate', coFounderShareController.calculateCoFounderPurchase);
router.get('/cofounder/payment-config', coFounderShareController.getPaymentConfig);

// User routes (require authentication)
router.post('/cofounder/paystack/initiate', protect, coFounderShareController.initiateCoFounderPaystackPayment);
router.get('/cofounder/paystack/verify/:reference', protect, coFounderShareController.verifyCoFounderPaystackPayment);
router.post('/cofounder/web3/verify', protect, coFounderShareController.verifyWeb3Transaction);
router.get('/cofounder/user/shares', protect, coFounderShareController.getUserCoFounderShares);

// Admin routes
router.post('/cofounder/admin/web3/verify', protect, adminProtect, coFounderShareController.adminVerifyWeb3Transaction);
router.get('/cofounder/admin/web3/transactions', protect, adminProtect, coFounderShareController.adminGetWeb3Transactions);
router.post('/cofounder/admin/update-pricing', protect, adminProtect, coFounderShareController.updateCoFounderSharePricing);
router.post('/cofounder/admin/add-shares', protect, adminProtect, coFounderShareController.adminAddCoFounderShares);
router.post('/cofounder/admin/update-wallet', protect, adminProtect, coFounderShareController.updateCompanyWallet);
router.get('/cofounder/admin/transactions', protect, adminProtect, coFounderShareController.getAllCoFounderTransactions);
router.get('/cofounder/admin/statistics', protect, adminProtect, coFounderShareController.getCoFounderShareStatistics);

module.exports = router;