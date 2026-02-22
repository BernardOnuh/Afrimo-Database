const express = require('express');
const router = express.Router();
const { adminProtect } = require('../middleware/auth');
const { getOverview } = require('../controller/adminAnalyticsController');

router.get('/overview', adminProtect, getOverview);

module.exports = router;
