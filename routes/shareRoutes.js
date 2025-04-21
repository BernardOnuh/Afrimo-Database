// routes/shareRoutes.js
const express = require('express');
const router = express.Router();
const shareController = require('../controller/shareController');
const installmentController = require('../controller/installmentController');
const { protect, adminProtect } = require('../middleware/auth');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function(req, file, cb) {
    const uploadDir = 'uploads/payment-proofs';
    
    // Create directory if it doesn't exist
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    
    cb(null, uploadDir);
  },
  filename: function(req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, 'payment-' + uniqueSuffix + ext);
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
router.get('/info', shareController.getShareInfo);
router.post('/calculate', shareController.calculatePurchase);
router.get('/payment-config', shareController.getPaymentConfig);

// User routes (require authentication)
router.post('/paystack/initiate', protect, shareController.initiatePaystackPayment);
router.get('/paystack/verify/:reference', shareController.verifyPaystackPayment);
router.post('/web3/verify', protect, shareController.verifyWeb3Transaction);
router.get('/user/shares', protect, shareController.getUserShares);

// Manual payment routes
router.post('/manual/submit', protect, upload.single('paymentProof'), shareController.submitManualPayment);
router.get('/payment-proof/:transactionId', protect, shareController.getPaymentProof);

// Admin routes
router.post('/admin/web3/verify', protect, adminProtect, shareController.adminVerifyWeb3Transaction);
router.get('/admin/web3/transactions', protect, adminProtect, shareController.adminGetWeb3Transactions);
router.post('/admin/update-pricing', protect, adminProtect, shareController.updateSharePricing);
router.post('/admin/add-shares', protect, adminProtect, shareController.adminAddShares);
router.post('/admin/update-wallet', protect, adminProtect, shareController.updateCompanyWallet);
router.get('/admin/transactions', protect, adminProtect, shareController.getAllTransactions);
router.get('/admin/statistics', protect, adminProtect, shareController.getShareStatistics);

// Admin manual payment routes
router.get('/admin/manual/transactions', protect, adminProtect, shareController.adminGetManualTransactions);
router.post('/admin/manual/verify', protect, adminProtect, shareController.adminVerifyManualPayment);
// NEW ROUTE: Add the cancel manual payment route
router.post('/admin/manual/cancel', protect, adminProtect, shareController.adminCancelManualPayment);

// =====================================================================
// INSTALLMENT PAYMENT ROUTES
// =====================================================================

// Installment calculation and management
router.post('/installment/calculate', protect, installmentController.calculateInstallmentPlan);
router.post('/installment/create', protect, installmentController.createInstallmentPlan);
router.get('/installment/plans', protect, installmentController.getUserInstallmentPlans);
router.post('/installment/cancel', protect, installmentController.cancelInstallmentPlan);

// Installment payment methods
router.post('/installment/paystack/pay', protect, installmentController.payInstallmentWithPaystack);
router.get('/installment/paystack/verify/:reference', protect, installmentController.verifyInstallmentPaystack);
router.post('/installment/manual/submit', protect, upload.single('paymentProof'), installmentController.submitManualInstallmentPayment);
router.get('/installment/payment-proof/:transactionId', protect, installmentController.getInstallmentPaymentProof);

// Admin installment routes
router.get('/installment/admin/plans', protect, adminProtect, installmentController.adminGetAllInstallmentPlans);
router.post('/installment/admin/manual/verify', protect, adminProtect, installmentController.adminVerifyManualInstallmentPayment);
router.post('/installment/admin/check-late-payments', protect, adminProtect, installmentController.checkLatePayments);

module.exports = router;