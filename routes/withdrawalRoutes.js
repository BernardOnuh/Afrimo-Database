// routes/withdrawalRoutes.js
const express = require('express');
const router = express.Router();
const withdrawalController = require('../controller/withdrawalController');
const { protect, adminProtect } = require('../middleware/auth');

// User routes
router.post('/request', protect, withdrawalController.requestWithdrawal);
router.get('/history', protect, withdrawalController.getWithdrawalHistory);
router.get('/balance', protect, withdrawalController.getEarningsBalance);

// Admin routes
router.get('/admin/pending', protect, adminProtect, withdrawalController.getPendingWithdrawals);
router.put('/admin/approve/:id', protect, adminProtect, withdrawalController.approveWithdrawal);
router.put('/admin/reject/:id', protect, adminProtect, withdrawalController.rejectWithdrawal);
router.get('/admin/history', protect, adminProtect, withdrawalController.getAllWithdrawals);

module.exports = router;