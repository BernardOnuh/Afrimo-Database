// routes/paymentRoutes.js
const express = require('express');
const router = express.Router();
const paymentController = require('../controller/paymentController');
const { protect, adminProtect } = require('../middleware/auth');
const multer = require('multer');
const path = require('path');

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/kyc-documents/');
  },
  filename: function (req, file, cb) {
    // Create unique filename with user ID, document type, and timestamp
    const userId = req.user.id;
    const fileExt = path.extname(file.originalname);
    const docType = file.fieldname; // 'governmentId' or 'proofOfAddress'
    cb(null, `${userId}-${docType}-${Date.now()}${fileExt}`);
  }
});

// File filter to allow only images and PDFs
const fileFilter = (req, file, cb) => {
  const allowedTypes = ['image/jpeg', 'image/png', 'application/pdf'];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only JPEG, PNG and PDF are allowed.'), false);
  }
};

const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: fileFilter
});

// Bank account verification routes
router.get('/banks', protect, paymentController.getBanks);
router.get('/verify-account', protect, paymentController.verifyBankAccount);

// User payment routes (require authentication)
router.get('/details', protect, paymentController.getPaymentDetails);
router.post('/bank-account', protect, paymentController.updateBankAccount);
router.post('/crypto-wallet', protect, paymentController.updateCryptoWallet);

// KYC document submission routes
router.post(
  '/kyc-documents',
  protect,
  upload.fields([
    { name: 'governmentId', maxCount: 1 },
    { name: 'proofOfAddress', maxCount: 1 }
  ]),
  paymentController.uploadKycDocuments
);

// Get KYC verification status
router.get('/kyc-status', protect, paymentController.getKycStatus);

// Admin routes
router.get('/admin/user-payment-details/:userId', protect, adminProtect, paymentController.getUserPaymentDetails);
router.put('/admin/verify-payment-details/:userId', protect, adminProtect, paymentController.verifyUserPaymentDetails);
router.put('/admin/verify-kyc/:userId', protect, adminProtect, paymentController.verifyKycDocuments);

module.exports = router;