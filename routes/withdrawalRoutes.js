const express = require('express');
const router = express.Router();
const withdrawalController = require('../controller/withdrawalController');
const { protect, adminProtect } = require('../middleware/auth');

// User routes - with comprehensive withdrawal status check
router.post('/instant', protect, withdrawalController.checkExistingWithdrawals, withdrawalController.processInstantWithdrawal);
router.post('/request', protect, withdrawalController.checkExistingWithdrawals, withdrawalController.requestWithdrawal);
router.get('/history', protect, withdrawalController.getWithdrawalHistory);
router.get('/balance', protect, withdrawalController.getEarningsBalance);
router.get('/status/:reference', protect, withdrawalController.checkTransactionStatus);

// Status check endpoint
router.get('/status', protect, withdrawalController.getWithdrawalStatus);

// Verification route for checking pending withdrawal status
router.get('/verify-pending', protect, withdrawalController.verifyPendingWithdrawals);

// Receipt routes
router.get('/receipt/:id', protect, withdrawalController.getWithdrawalReceipt);
router.get('/download-receipt/:id', protect, withdrawalController.downloadWithdrawalReceipt);

// Admin routes
router.get('/stats', protect, adminProtect, withdrawalController.getWithdrawalStats);
router.get('/admin/instant', protect, adminProtect, withdrawalController.getInstantWithdrawals);
router.get('/admin/pending', protect, adminProtect, withdrawalController.getPendingWithdrawals);
router.put('/admin/approve/:id', protect, adminProtect, withdrawalController.approveWithdrawal);
router.put('/admin/reject/:id', protect, adminProtect, withdrawalController.rejectWithdrawal);
router.put('/admin/mark-paid/:id', protect, adminProtect, withdrawalController.markWithdrawalAsPaid);
router.get('/admin/history', protect, adminProtect, withdrawalController.getAllWithdrawals);

module.exports = router;