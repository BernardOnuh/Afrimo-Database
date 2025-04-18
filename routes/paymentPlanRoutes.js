const express = require('express');
const router = express.Router();
const paymentPlanController = require('../controller/paymentPlanController');
const { protect, adminProtect } = require('../middleware/auth');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Configure multer for file uploads (for payment proofs)
const storage = multer.diskStorage({
  destination: function(req, file, cb) {
    const uploadDir = 'uploads/payment-plan-proofs';
    
    // Create directory if it doesn't exist
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    
    cb(null, uploadDir);
  },
  filename: function(req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, 'plan-payment-' + uniqueSuffix + ext);
  }
});

// File filter for uploads (only accept images)
const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new Error('Only image files are allowed'), false);
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  }
});

// Public routes
router.get('/info', paymentPlanController.getPaymentPlanInfo);

// User routes (require authentication)
router.post('/', protect, paymentPlanController.createPaymentPlan);
router.get('/', protect, paymentPlanController.getUserPaymentPlans);
router.get('/:id', protect, paymentPlanController.getPaymentPlanById);
router.post('/:id/paystack', protect, paymentPlanController.makePaystackPayment);
router.get('/verify/:reference', paymentPlanController.verifyPaystackPayment);
router.post('/:id/crypto', protect, paymentPlanController.submitCryptoPayment);
router.post('/:id/manual', protect, upload.single('paymentProof'), paymentPlanController.submitManualPayment);
router.post('/:id/cancel', protect, paymentPlanController.cancelPaymentPlan);
router.get('/payment-proof/:transactionId', protect, paymentPlanController.getPaymentProof);

// Admin routes
router.get('/admin/all', protect, adminProtect, paymentPlanController.adminGetAllPaymentPlans);
router.get('/admin/user/:userId', protect, adminProtect, paymentPlanController.adminGetUserPaymentPlans);
router.get('/admin/overdue', protect, adminProtect, paymentPlanController.adminGetOverduePaymentPlans);
router.post('/admin/verify-crypto', protect, adminProtect, paymentPlanController.adminVerifyCryptoPayment);
router.post('/admin/verify-manual', protect, adminProtect, paymentPlanController.adminVerifyManualPayment);
router.post('/admin/apply-penalties', protect, adminProtect, paymentPlanController.applyPenalties);
router.post('/admin/cancel/:id', protect, adminProtect, paymentPlanController.adminCancelPaymentPlan);

module.exports = router;