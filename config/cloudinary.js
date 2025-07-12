// config/cloudinary.js - Updated for Cloudinary v2.x
const { v2: cloudinary } = require('cloudinary');
const multer = require('multer');
const { Readable } = require('stream');

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Custom storage engine for multer with Cloudinary v2
class CloudinaryStorage {
  constructor(options = {}) {
    this.options = {
      folder: options.folder || 'payment-proofs',
      allowedFormats: options.allowedFormats || ['jpg', 'jpeg', 'png', 'pdf'],
      transformation: options.transformation || [
        { width: 1200, height: 1200, crop: 'limit', quality: 'auto' }
      ],
      ...options
    };
  }

  _handleFile(req, file, cb) {
    // Generate unique filename
    const timestamp = Date.now();
    const random = Math.round(Math.random() * 1E9);
    const publicId = `${this.options.folder}/upload-${timestamp}-${random}`;

    // Create upload stream
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        public_id: publicId,
        folder: this.options.folder,
        resource_type: 'auto', // Handles both images and PDFs
        transformation: this.options.transformation
      },
      (error, result) => {
        if (error) {
          console.error('[Cloudinary] Upload error:', error);
          return cb(error);
        }

        console.log('[Cloudinary] Upload successful:', result.public_id);
        
        // Return file info in multer format
        cb(null, {
          fieldname: file.fieldname,
          originalname: file.originalname,
          mimetype: file.mimetype,
          size: result.bytes,
          filename: result.public_id, // Cloudinary public ID
          path: result.secure_url,    // Cloudinary secure URL
          format: result.format,      // File format
          cloudinary: result          // Full Cloudinary response
        });
      }
    );

    // Handle upload stream errors
    uploadStream.on('error', (error) => {
      console.error('[Cloudinary] Stream error:', error);
      cb(error);
    });

    // Pipe file buffer to Cloudinary
    file.stream.pipe(uploadStream);
  }

  _removeFile(req, file, cb) {
    // Delete file from Cloudinary
    if (file.filename) {
      cloudinary.uploader.destroy(file.filename, (error, result) => {
        cb(error, result);
      });
    } else {
      cb();
    }
  }
}

// Create storage instances
const createCloudinaryStorage = (folder = 'payment-proofs') => {
  return new CloudinaryStorage({ folder });
};

// Storage for regular share payment proofs
const sharePaymentStorage = createCloudinaryStorage('share-payments');

// Storage for co-founder payment proofs
const cofounderPaymentStorage = createCloudinaryStorage('cofounder-payments');

// Create multer instances
const sharePaymentUpload = multer({
  storage: sharePaymentStorage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
    files: 1
  },
  fileFilter: (req, file, cb) => {
    // Check file type
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'application/pdf'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only JPG, PNG and PDF files are allowed'), false);
    }
  }
});

const cofounderPaymentUpload = multer({
  storage: cofounderPaymentStorage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
    files: 1
  },
  fileFilter: (req, file, cb) => {
    // Check file type
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'application/pdf'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only JPG, PNG and PDF files are allowed'), false);
    }
  }
});

// Utility functions
const uploadToCloudinary = async (buffer, options = {}) => {
  return new Promise((resolve, reject) => {
    const uploadOptions = {
      folder: 'payment-proofs',
      resource_type: 'auto',
      ...options
    };

    // Convert buffer to stream
    const stream = Readable.from(buffer);
    
    const uploadStream = cloudinary.uploader.upload_stream(
      uploadOptions,
      (error, result) => {
        if (error) {
          reject(error);
        } else {
          resolve(result);
        }
      }
    );

    stream.pipe(uploadStream);
  });
};

const deleteFromCloudinary = async (publicId) => {
  try {
    console.log(`[Cloudinary] Deleting file: ${publicId}`);
    const result = await cloudinary.uploader.destroy(publicId);
    console.log(`[Cloudinary] Delete result:`, result);
    return result;
  } catch (error) {
    console.error('[Cloudinary] Error deleting file:', error);
    throw error;
  }
};

// Get file info from Cloudinary
const getCloudinaryFileInfo = async (publicId) => {
  try {
    const result = await cloudinary.api.resource(publicId);
    return result;
  } catch (error) {
    console.error('[Cloudinary] Error getting file info:', error);
    throw error;
  }
};

// Middleware for logging uploads
const logCloudinaryUpload = (req, res, next) => {
  if (req.file) {
    console.log('[Cloudinary] ✅ File uploaded successfully:');
    console.log('- Original name:', req.file.originalname);
    console.log('- Cloudinary URL:', req.file.path);
    console.log('- Public ID:', req.file.filename);
    console.log('- Size:', req.file.size, 'bytes');
    console.log('- Format:', req.file.format);
  } else {
    console.log('[Cloudinary] ⚠️ No file received');
  }
  next();
};

// Enhanced error handling for Cloudinary uploads
const handleCloudinaryError = (err, req, res, next) => {
  console.error('\n=== CLOUDINARY UPLOAD ERROR ===');
  console.error('Error type:', err?.constructor?.name);
  console.error('Error message:', err?.message);
  console.error('================================\n');

  if (err instanceof multer.MulterError) {
    switch (err.code) {
      case 'LIMIT_FILE_SIZE':
        return res.status(400).json({
          success: false,
          message: 'File too large. Maximum size is 5MB.',
          error: 'FILE_TOO_LARGE'
        });
      case 'LIMIT_FILE_COUNT':
        return res.status(400).json({
          success: false,
          message: 'Too many files. Only 1 file allowed.',
          error: 'TOO_MANY_FILES'
        });
      case 'LIMIT_UNEXPECTED_FILE':
        return res.status(400).json({
          success: false,
          message: 'Unexpected file field. Use "paymentProof" field name.',
          error: 'UNEXPECTED_FIELD'
        });
      default:
        return res.status(400).json({
          success: false,
          message: `Upload error: ${err.message}`,
          error: 'MULTER_ERROR'
        });
    }
  } else if (err && err.message && err.message.includes('File size too large')) {
    return res.status(400).json({
      success: false,
      message: 'File too large for Cloudinary. Maximum size is 5MB.',
      error: 'CLOUDINARY_SIZE_LIMIT'
    });
  } else if (err) {
    return res.status(400).json({
      success: false,
      message: err.message || 'File upload failed',
      error: 'UPLOAD_ERROR'
    });
  }
  next();
};

module.exports = {
  cloudinary,
  sharePaymentUpload,
  cofounderPaymentUpload,
  uploadToCloudinary,
  deleteFromCloudinary,
  getCloudinaryFileInfo,
  logCloudinaryUpload,
  handleCloudinaryError,
  createCloudinaryStorage,
  CloudinaryStorage
};