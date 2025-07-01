// config/multer.js
const multer = require('multer');
const path = require('path');

// Memory storage for MongoDB image storage
const memoryStorage = multer.memoryStorage();

// Common file filter
const fileFilter = (req, file, cb) => {
  console.log(`[multer] Processing file: ${file.originalname}`);
  console.log(`[multer] File MIME type: ${file.mimetype}`);
  console.log(`[multer] File size: ${file.size} bytes`);
  
  // Allow images and PDFs
  if (file.mimetype.startsWith('image/') || file.mimetype === 'application/pdf') {
    cb(null, true);
  } else {
    console.log(`[multer] Rejected file type: ${file.mimetype}`);
    cb(new Error('Only images (JPG, PNG, GIF) and PDF files are allowed'));
  }
};

// General upload configuration for payment proofs
const paymentProofUpload = multer({
  storage: memoryStorage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  },
  fileFilter: fileFilter
});

// KYC documents upload configuration
const kycUpload = multer({
  storage: memoryStorage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit for KYC docs
  },
  fileFilter: fileFilter
});

// Co-founder payment proof upload configuration
const coFounderPaymentUpload = multer({
  storage: memoryStorage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  },
  fileFilter: fileFilter
});

module.exports = {
  paymentProofUpload,
  kycUpload,
  coFounderPaymentUpload,
  memoryStorage,
  fileFilter
};