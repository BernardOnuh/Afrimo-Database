const express = require('express');
const router = express.Router();
const { protect, adminProtect } = require('../middleware/auth');
const {
  createPreOrder,
  getMyPreOrders,
  updatePreOrder,
  cancelPreOrder,
  adminGetAllPreOrders,
  adminUpdatePreOrderStatus,
  adminGetPreOrderStats
} = require('../controller/preOrderController');

// User routes
router.post('/', protect, createPreOrder);
router.get('/my-orders', protect, getMyPreOrders);
router.put('/:id', protect, updatePreOrder);
router.put('/:id/cancel', protect, cancelPreOrder);

// Admin routes
router.get('/admin/all', adminProtect, adminGetAllPreOrders);
router.put('/admin/:id/status', adminProtect, adminUpdatePreOrderStatus);
router.get('/admin/stats', adminProtect, adminGetPreOrderStats);

module.exports = router;
