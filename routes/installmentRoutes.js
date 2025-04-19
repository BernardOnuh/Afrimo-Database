// routes/installmentRoutes.js
const express = require('express');
const router = express.Router();
const { protect, adminProtect } = require('../middleware/auth'); // Changed from "admin" to "adminProtect"
const multer = require('multer');
const installmentController = require('../controller/installmentController');

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/payment-proofs/');
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, `payment-proof-${uniqueSuffix}-${file.originalname}`);
  }
});

const upload = multer({ 
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB max file size
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  }
});

// Regular Share Installment Routes
router.post('/initiate', protect, installmentController.initiateShareInstallment);
router.post('/payment', protect, installmentController.makeInstallmentPayment);
router.get('/payment/verify/:reference', protect, installmentController.verifyInstallmentPayment);
router.post('/web3/verify', protect, installmentController.verifyWeb3InstallmentPayment);
router.get('/user', protect, installmentController.getUserInstallments);

// Co-founder Share Installment Routes
router.post('/cofounder/initiate', protect, installmentController.initiateCoFounderInstallment);

// Admin Routes
router.get('/admin', protect, adminProtect, installmentController.adminGetAllInstallments);
router.post('/admin/web3/verify', protect, adminProtect, installmentController.adminVerifyWeb3InstallmentPayment);
router.post('/admin/apply-penalties', protect, adminProtect, installmentController.applyPenalties);
router.post('/admin/handle-default', protect, adminProtect, installmentController.adminHandleDefaultedInstallment);

module.exports = router;