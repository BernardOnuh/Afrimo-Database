// routes/installmentPlanRoutes.js
const express = require('express');
const router = express.Router();
const { protect, adminProtect } = require('../middleware/auth');
const controller = require('../controller/installmentPlanController');

// Multer for proof uploads
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const uploadDir = process.env.NODE_ENV === 'production'
  ? '/tmp/uploads/installment-proofs'
  : path.join(process.cwd(), 'uploads', 'installment-proofs');

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, `inst-${Date.now()}-${Math.round(Math.random() * 1E9)}${path.extname(file.originalname)}`)
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|pdf|webp/;
    const ext = allowed.test(path.extname(file.originalname).toLowerCase());
    const mime = allowed.test(file.mimetype);
    cb(null, ext && mime);
  }
});

// User routes
router.post('/create', protect, upload.single('proof'), controller.createPlan);
router.get('/my-plans', protect, controller.getMyPlans);
router.get('/my-plans/:planId', protect, controller.getPlanDetails);
router.post('/pay/:planId', protect, upload.single('proof'), controller.makePayment);

// Admin routes
router.get('/admin/stats', adminProtect, controller.adminGetStats);
router.get('/admin/all', adminProtect, controller.adminGetAll);
router.get('/admin/:planId', adminProtect, controller.adminGetPlan);
router.put('/admin/:planId/approve-payment/:paymentIndex', adminProtect, controller.adminApprovePayment);
router.put('/admin/:planId/reject-payment/:paymentIndex', adminProtect, controller.adminRejectPayment);
router.put('/admin/:planId/forfeit', adminProtect, controller.adminForfeitPlan);

module.exports = router;
