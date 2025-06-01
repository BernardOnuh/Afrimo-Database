const express = require('express');
const router = express.Router();
const { protect, adminProtect } = require('../middleware/auth');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const installmentController = require('../controller/installmentController');

// Ensure upload directory exists
const uploadDir = 'uploads/payment_proofs/';
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Configure multer storage for payment proof images
const storage = multer.diskStorage({
  destination: function(req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function(req, file, cb) {
    // Generate a unique filename to prevent overwriting
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1E9)}`;
    cb(null, `installment_${uniqueSuffix}${path.extname(file.originalname)}`);
  }
});

// Advanced file filter with more robust validation
const fileFilter = (req, file, cb) => {
  // Allowed file types
  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'application/pdf'];
  const allowedExtensions = ['.jpeg', '.jpg', '.png', '.pdf'];

  // Check mime type
  const isMimeTypeValid = allowedTypes.includes(file.mimetype);
  
  // Check file extension
  const isExtensionValid = allowedExtensions.includes(path.extname(file.originalname).toLowerCase());

  if (isMimeTypeValid && isExtensionValid) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only JPEG, PNG, and PDF files are allowed.'), false);
  }
};

// Configure upload with enhanced options
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: { 
    fileSize: 5 * 1024 * 1024, // 5MB max file size
    files: 1 // Only one file at a time
  }
});

// Error handling middleware for multer
const handleMulterError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    // Multer-specific errors
    return res.status(400).json({
      success: false,
      message: err.message === 'File too large' 
        ? 'File size exceeds the maximum limit of 5MB' 
        : 'File upload error'
    });
  } else if (err) {
    // Other errors (like file type)
    return res.status(400).json({
      success: false,
      message: err.message || 'File upload failed'
    });
  }
  next();
};

// Rate limiting middleware (basic implementation)
const createRateLimiter = (maxRequests, windowMs) => {
  const requests = new Map();

  return (req, res, next) => {
    const userId = req.user.id;
    const now = Date.now();

    // Clean up old requests
    const requestsForUser = (requests.get(userId) || [])
      .filter(timestamp => now - timestamp < windowMs);

    if (requestsForUser.length >= maxRequests) {
      return res.status(429).json({
        success: false,
        message: 'Too many requests. Please try again later.'
      });
    }

    requestsForUser.push(now);
    requests.set(userId, requestsForUser);
    next();
  };
};

// Create rate limiters - More generous for calculations
const calculateRateLimiter = createRateLimiter(50, 60 * 60 * 1000); // 50 requests per hour for calculations
const createInstallmentRateLimiter = createRateLimiter(5, 60 * 60 * 1000); // 5 requests per hour for plan creation
const paymentSubmissionRateLimiter = createRateLimiter(3, 24 * 60 * 60 * 1000); // 3 payment submissions per day

// User routes
router.post('/calculate', 
  protect, 
  calculateRateLimiter, // More generous rate limiting for calculations
  installmentController.validateInstallmentInput,
  installmentController.calculateInstallmentPlan
);

router.post('/create', 
  protect, 
  createInstallmentRateLimiter, // Keep strict rate limiting for actual plan creation
  installmentController.validateInstallmentInput,
  installmentController.createInstallmentPlan
);

router.get('/plans', 
  protect, 
  installmentController.getUserInstallmentPlans
);

router.post('/cancel', 
  protect, 
  createInstallmentRateLimiter,
  installmentController.cancelInstallmentPlan
);

// Payment routes - Updated to match second controller
router.post('/paystack/pay', 
  protect, 
  paymentSubmissionRateLimiter,
  installmentController.payInstallmentWithPaystack
);

router.get('/paystack/verify', 
  protect, 
  installmentController.verifyInstallmentPaystack
);

// Manual payment submission - Updated endpoint name and method
router.post('/manual/submit', 
  protect, 
  paymentSubmissionRateLimiter,
  upload.single('paymentProof'),
  handleMulterError,
  installmentController.submitManualInstallmentPayment
);

// Payment proof retrieval - Updated to match second controller method name
router.get('/flexible/payment-proof/:transactionId', 
  protect, 
  installmentController.getFlexibleInstallmentPaymentProof
);

// Admin routes - Updated to match second controller
router.get('/admin/plans', 
  adminProtect, 
  installmentController.adminGetAllInstallmentPlans
);

// Updated admin verification endpoint name
router.post('/admin/flexible/verify', 
  adminProtect, 
  installmentController.adminVerifyFlexibleInstallmentPayment
);

router.post('/admin/check-late-payments', 
  adminProtect, 
  installmentController.checkLatePayments
);

// Additional error handling for file cleanup on failed uploads
router.use((err, req, res, next) => {
  // Clean up uploaded file if there was an error
  if (req.file && req.file.path) {
    fs.unlink(req.file.path, (unlinkErr) => {
      if (unlinkErr) {
        console.error('Error cleaning up uploaded file:', unlinkErr);
      }
    });
  }
  
  console.error('Route error:', err);
  res.status(500).json({
    success: false,
    message: 'An unexpected error occurred',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

module.exports = router;