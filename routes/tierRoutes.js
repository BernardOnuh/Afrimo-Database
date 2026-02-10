const express = require('express');
const router = express.Router();
const tierController = require('../controller/tierController');
const { protect, adminProtect } = require('../middleware/auth');

// Public: get all tiers
router.get('/', tierController.getTiers);

// Admin only
router.put('/:tierKey', protect, tierController.updateTier);
router.post('/', protect, tierController.createTier);
router.delete('/:tierKey', protect, tierController.deleteTier);

module.exports = router;
