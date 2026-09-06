const express = require('express');
const router = express.Router();
const diditController = require('../controller/diditController');

// Didit sends status.updated / data.updated webhooks here.
// The body must stay raw-buffer accessible for the route; this router is mounted
// BEFORE the global express.json() middleware so X-Signature-V2 verification works
// against the canonicalised parsed body without double-encoding by middleware.
router.post('/', express.raw({ type: '*/*' }), diditController.handleWebhook);

module.exports = router;