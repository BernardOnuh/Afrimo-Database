const express = require('express'); 
const router = express.Router(); 
const referralController = require('../controller/referralController'); 
const { protect, adminProtect } = require('../middleware/auth');  

// User routes

// Get referral code (username) and stats 
router.get('/stats', protect, referralController.getReferralStats);  

// Get referral tree (people you've referred) 
router.get('/treee', protect, referralController.getReferralTree);  

// Get referral earnings (for self)
router.get('/earnings', protect, referralController.getReferralEarnings);

// Generate custom invite link 
router.post('/generate-invite', protect, referralController.generateCustomInviteLink);  

// Validate invite link 
router.get('/validate-invite/:inviteCode', referralController.validateInviteLink);  

// Admin routes

// Get any user's referral earnings (admin only)
// Example: /api/referral/admin/earnings?userName=johnsmith
// OR: /api/referral/admin/earnings?email=john@example.com
router.get('/admin/earnings', protect, adminProtect, referralController.getReferralEarnings);  

// Admin route to adjust referral commission settings 
router.post('/settings', protect, adminProtect, referralController.updateReferralSettings);  

// Admin route to sync referral data for a specific user
router.post('/admin/sync/:userId', protect, adminProtect, referralController.syncUserReferralData);



module.exports = router;