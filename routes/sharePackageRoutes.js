const express = require('express');
const router = express.Router();
const { protect, adminProtect } = require('../middleware/auth');
const ctrl = require('../controller/sharePackageController');

// Public
router.get('/', ctrl.getAllPackages);

// Admin — package level
router.get('/admin', protect, adminProtect, ctrl.getAdminPackages);
router.post('/', protect, adminProtect, ctrl.createPackage);
router.put('/reorder', protect, adminProtect, ctrl.reorderPackages);
router.patch('/:id/edit', protect, adminProtect, ctrl.adminEditPackageFields);
router.put('/:id', protect, adminProtect, ctrl.updatePackage);
router.delete('/:id', protect, adminProtect, ctrl.deletePackage);

// Admin — view then edit a specific user's purchases
router.get('/user/:userId/purchases', protect, adminProtect, ctrl.adminGetUserPurchasedPackages);
router.patch('/user/:userId/edit', protect, adminProtect, ctrl.adminEditUserSharePackage);

module.exports = router;
