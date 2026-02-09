const express = require('express');
const router = express.Router();
const { protect, adminProtect } = require('../middleware/auth');
const ctrl = require('../controller/sharePackageController');

// Public
router.get('/', ctrl.getAllPackages);

// Admin
router.get('/admin', protect, adminProtect, ctrl.getAdminPackages);
router.post('/', protect, adminProtect, ctrl.createPackage);
router.put('/reorder', protect, adminProtect, ctrl.reorderPackages);
router.put('/:id', protect, adminProtect, ctrl.updatePackage);
router.delete('/:id', protect, adminProtect, ctrl.deletePackage);

module.exports = router;
