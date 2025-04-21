// routes/installmentRoutes.js
const express = require('express');
const router = express.Router();
const { protect, adminProtect } = require('../middleware/auth');
const multer = require('multer');
const path = require('path');
const installmentController = require('../controller/installmentController');

// Configure multer storage for payment proof images
const storage = multer.diskStorage({
  destination: function(req, file, cb) {
    cb(null, 'uploads/payment_proofs/');
  },
  filename: function(req, file, cb) {
    cb(null, `installment_${Date.now()}${path.extname(file.originalname)}`);
  }
});

// Configure upload
const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: function(req, file, cb) {
    const filetypes = /jpeg|jpg|png|pdf/;
    const mimetype = filetypes.test(file.mimetype);
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
    
    if (mimetype && extname) {
      return cb(null, true);
    }
    cb(new Error('File upload only supports the following filetypes - ' + filetypes));
  }
});

// User routes
router.post('/calculate', protect, installmentController.calculateInstallmentPlan);
router.post('/create', protect, installmentController.createInstallmentPlan);
router.get('/plans', protect, installmentController.getUserInstallmentPlans);
router.post('/cancel', protect, installmentController.cancelInstallmentPlan);

// Payment routes
router.post('/paystack/pay', protect, installmentController.payInstallmentWithPaystack);
router.get('/paystack/verify/:reference', protect, installmentController.verifyInstallmentPaystack);
router.post('/manual/submit', protect, upload.single('paymentProof'), installmentController.submitManualInstallmentPayment);
router.get('/payment-proof/:transactionId', protect, installmentController.getInstallmentPaymentProof);

// Admin routes
router.get('/admin/plans', adminProtect, installmentController.adminGetAllInstallmentPlans);
router.post('/admin/manual/verify', adminProtect, installmentController.adminVerifyManualInstallmentPayment);
router.post('/admin/check-late-payments', adminProtect, installmentController.checkLatePayments);

module.exports = router;