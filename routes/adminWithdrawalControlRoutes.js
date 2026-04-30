/**
 * ADMIN WITHDRAWAL CONTROL ROUTES
 */
const express = require('express');
const router = express.Router();
const ctrl = require('../controller/adminWithdrawalControlController');
const { protect, adminProtect } = require('../middleware/auth');
const admin = [protect, adminProtect];

// System status
router.get('/status', ...admin, ctrl.getSystemStatus);

// Global pause / resume
router.post('/pause', ...admin, ctrl.pauseAllWithdrawals);
router.post('/resume', ...admin, ctrl.resumeAllWithdrawals);

// Channel toggles
router.post('/toggle-bank', ...admin, ctrl.toggleBankWithdrawals);
router.post('/toggle-crypto', ...admin, ctrl.toggleCryptoWithdrawals);

// Emergency freeze
router.post('/emergency-freeze', ...admin, ctrl.emergencyFreeze);
router.post('/unfreeze', ...admin, ctrl.liftEmergencyFreeze);

// Global limits
router.post('/limits', ...admin, ctrl.setGlobalLimits);

// Per-user controls
router.post('/user/:identifier/pause', ...admin, ctrl.pauseUserWithdrawals);
router.post('/user/:identifier/resume', ...admin, ctrl.resumeUserWithdrawals);
router.post('/user/:identifier/blacklist', ...admin, ctrl.blacklistUser);
router.post('/user/:identifier/whitelist', ...admin, ctrl.whitelistUser);
router.post('/user/:identifier/limits', ...admin, ctrl.setUserLimits);
router.post('/user/:identifier/cancel-all', ...admin, ctrl.cancelAllUserPendingWithdrawals);

// Individual withdrawal controls
router.post('/cancel/:withdrawalId', ...admin, ctrl.forceCancelWithdrawal);
router.post('/override/:withdrawalId', ...admin, ctrl.overrideWithdrawalStatus);

// Lists
router.get('/blacklisted', ...admin, ctrl.getBlacklistedUsers);
router.get('/paused-users', ...admin, ctrl.getPausedUsers);

// Audit log
router.get('/audit-log', ...admin, ctrl.getAuditLog);

// Dashboard
router.get('/dashboard', ...admin, ctrl.getAdminDashboard);

// Bulk operations
router.post('/bulk/cancel-pending', ...admin, ctrl.bulkCancelAllPendingWithdrawals);
router.post('/bulk/pause-users', ...admin, ctrl.bulkPauseUsers);
router.post('/bulk/blacklist-users', ...admin, ctrl.bulkBlacklistUsers);

// Scheduled controls
router.post('/schedule', ...admin, ctrl.scheduleControl);
router.get('/schedules', ...admin, ctrl.getScheduledControls);
router.delete('/schedule/:scheduleId', ...admin, ctrl.cancelScheduledControl);
router.post('/run-schedules', ...admin, ctrl.executeScheduledControls);

module.exports = router;
