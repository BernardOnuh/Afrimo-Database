const express = require('express');
const router = express.Router();
const projectController = require('../controller/projectController');
const { protect, adminProtect } = require('../middleware/auth');

// Public route to get overall project statistics
router.get('/stats', projectController.getProjectStats);

// Protected route to get user-specific project details
router.get('/user-stats', protect, projectController.getUserProjectStats);

module.exports = router;