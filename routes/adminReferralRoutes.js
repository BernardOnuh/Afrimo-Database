const express = require('express');
const router = express.Router();
const { adminProtect } = require('../middleware/auth');

const {
  getReferralDashboard,
  getAllUsersWithReferralData,
  getUserReferralDetails,
  getAllReferralTransactions,
  adjustUserEarnings,
  adjustReferralTransaction,
  cancelReferralTransaction,
  performBulkActions,
  getReferralAnalytics,
  exportReferralData,
  getReferralSettings,
  updateReferralSettings,
  getAuditLog,
  bulkEditTransactions,
  syncUserReferralData,
  getPerformanceReport,
  getCommissionBreakdown
} = require('../controller/adminReferralController');

// Rate limiting middleware
const createRateLimiter = (maxRequests, windowMs) => {
  const requests = new Map();
  return (req, res, next) => {
    const userId = req.user.id;
    const now = Date.now();
    const requestsForUser = (requests.get(userId) || [])
      .filter(timestamp => now - timestamp < windowMs);
    if (requestsForUser.length >= maxRequests) {
      return res.status(429).json({
        success: false,
        message: 'Too many requests. Please try again later.'
      });
    }
    requestsForUser.push(now);
    requests.set(userId, requestsForUser);
    next();
  };
};

const adminRateLimiter = createRateLimiter(100, 60 * 60 * 1000);

// ============= DASHBOARD & ANALYTICS =============
router.get('/dashboard', adminProtect, adminRateLimiter, getReferralDashboard);
router.get('/analytics', adminProtect, getReferralAnalytics);
router.get('/performance-report', adminProtect, getPerformanceReport);
router.get('/commission-breakdown', adminProtect, getCommissionBreakdown);

// ============= USER MANAGEMENT =============
router.get('/users', adminProtect, adminRateLimiter, getAllUsersWithReferralData);
router.get('/user/:userId', adminProtect, getUserReferralDetails);
router.post('/user/:userId/sync', adminProtect, syncUserReferralData);

// ============= TRANSACTION MANAGEMENT =============
router.get('/transactions', adminProtect, getAllReferralTransactions);
router.post('/transactions/bulk-edit', adminProtect, bulkEditTransactions);
router.put('/transaction/:transactionId/adjust', adminProtect, adjustReferralTransaction);
router.delete('/transaction/:transactionId/cancel', adminProtect, cancelReferralTransaction);

// ============= EARNINGS MANAGEMENT =============
router.post('/earnings/adjust', adminProtect, adminRateLimiter, adjustUserEarnings);

// ============= BULK ACTIONS =============
router.post('/bulk-actions', adminProtect, performBulkActions);

// ============= SYSTEM SETTINGS =============
router.get('/settings', adminProtect, getReferralSettings);
router.put('/settings', adminProtect, updateReferralSettings);

// ============= DATA EXPORT =============
router.get('/export', adminProtect, exportReferralData);

// ============= AUDIT LOGS =============
router.get('/audit-log', adminProtect, getAuditLog);

// Error handling middleware
router.use((err, req, res, next) => {
  console.error('Admin referral route error:', err);
  res.status(500).json({
    success: false,
    message: 'An unexpected error occurred in admin referral system',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

module.exports = router;