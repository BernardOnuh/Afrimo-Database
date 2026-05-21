const express = require('express');
const router = express.Router();
const { protect, adminProtect } = require('../middleware/auth');
const {
  requestLoan,
  getMyLoans,
  adminGetAllLoans,
  adminApproveLoan,
  adminRejectLoan,
  adminDisburseLoan,
  recordRepayment,
  adminGetLoanStats
} = require('../controller/shareLoanController');

// User routes
router.post('/request', protect, requestLoan);
router.get('/my-loans', protect, getMyLoans);

// Admin routes
router.get('/admin/all', adminProtect, adminGetAllLoans);
router.post('/admin/:id/approve', adminProtect, adminApproveLoan);
router.post('/admin/:id/reject', adminProtect, adminRejectLoan);
router.post('/admin/:id/disburse', adminProtect, adminDisburseLoan);
router.post('/admin/:id/repayment', adminProtect, recordRepayment);
router.get('/admin/stats', adminProtect, adminGetLoanStats);

module.exports = router;
