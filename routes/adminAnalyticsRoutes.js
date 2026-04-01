const express = require('express');
const router = express.Router();
const { adminProtect } = require('../middleware/auth');
const { getOverview, getTransactionDetail } = require('../controller/adminAnalyticsController');

router.get('/overview', adminProtect, getOverview);
router.get('/transaction/:transactionId', adminProtect, getTransactionDetail);

module.exports = router;