// middleware/upload.js - Render.com Compatible Version
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// ✅ CRITICAL: Create upload directory if it doesn't exist
const createUploadDir = () => {
  // Use /tmp for Render.com deployments (ephemeral but works)
  const uploadDir = process.env.NODE_ENV === 'production' 
    ? '/tmp/uploads/payment-proofs' 
    : path.join(process.cwd(), 'uploads', 'payment-proofs');
  
  console.log(`[UPLOAD] Creating upload directory: ${uploadDir}`);
  
  try {
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
      console.log(`[UPLOAD] Directory created successfully: ${uploadDir}`);
    } else {
      console.log(`[UPLOAD] Directory already exists: ${uploadDir}`);
    }
    
    // Test write permissions
    const testFile = path.join(uploadDir, 'test-write.txt');
    fs.writeFileSync(testFile, 'test');
    fs.unlinkSync(testFile);
    console.log(`[UPLOAD] Directory is writable: ${uploadDir}`);
    
    return uploadDir;
  } catch (error) {
    console.error(`[UPLOAD] Error creating directory: ${error.message}`);
    throw error;
  }
};

// Configure multer storage
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    try {
      const uploadDir = createUploadDir();
      console.log(`[UPLOAD] Using destination: ${uploadDir}`);
      cb(null, uploadDir);
    } catch (error) {
      console.error('[UPLOAD] Destination error:', error);
      cb(error);
    }
  },
  filename: function (req, file, cb) {
    try {
      // Generate unique filename
      const timestamp = Date.now();
      const random = Math.random().toString(36).substring(2, 15);
      const ext = path.extname(file.originalname);
      const filename = `payment-${timestamp}-${random}${ext}`;
      
      console.log(`[UPLOAD] Generated filename: ${filename}`);
      cb(null, filename);
    } catch (error) {
      console.error('[UPLOAD] Filename error:', error);
      cb(error);
    }
  }
});

// Enhanced file filter
const fileFilter = (req, file, cb) => {
  console.log(`[UPLOAD] Processing file: ${file.originalname}, MIME: ${file.mimetype}`);
  
  // Check file type
  const allowedTypes = /jpeg|jpg|png|gif|webp|pdf/;
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = allowedTypes.test(file.mimetype);
  
  if (mimetype && extname) {
    console.log(`[UPLOAD] File type approved: ${file.originalname}`);
    return cb(null, true);
  } else {
    console.error(`[UPLOAD] File type rejected: ${file.originalname} (${file.mimetype})`);
    return cb(new Error('Invalid file type. Only images (JPG, PNG, GIF, WEBP) and PDF files are allowed.'));
  }
};

// Create multer instance
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
    files: 1, // Only 1 file at a time
    fieldSize: 2 * 1024 * 1024, // 2MB for other fields
    fieldNameSize: 100, // 100 bytes for field names
    fields: 10 // Maximum 10 non-file fields
  },
  fileFilter: fileFilter
});

// ✅ ENHANCED: Memory storage fallback for environments that don't support disk storage
const memoryStorage = multer.memoryStorage();

const memoryUpload = multer({
  storage: memoryStorage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
    files: 1
  },
  fileFilter: fileFilter
});

// ✅ SMART MIDDLEWARE: Try disk first, fallback to memory
const smartUpload = (req, res, next) => {
  console.log('[UPLOAD] Starting smart upload process...');
  
  // Try disk storage first
  upload.single('paymentProof')(req, res, (err) => {
    if (err) {
      console.error('[UPLOAD] Disk storage failed:', err.message);
      
      // If disk storage fails, try memory storage
      console.log('[UPLOAD] Falling back to memory storage...');
      
      memoryUpload.single('paymentProof')(req, res, (memErr) => {
        if (memErr) {
          console.error('[UPLOAD] Memory storage also failed:', memErr.message);
          return next(memErr);
        }
        
        if (req.file) {
          console.log('[UPLOAD] Memory storage successful');
          
          // For memory storage, we need to manually save the file
          try {
            const uploadDir = createUploadDir();
            const timestamp = Date.now();
            const random = Math.random().toString(36).substring(2, 15);
            const ext = path.extname(req.file.originalname);
            const filename = `payment-${timestamp}-${random}${ext}`;
            const filepath = path.join(uploadDir, filename);
            
            // Write buffer to disk
            fs.writeFileSync(filepath, req.file.buffer);
            
            // Update req.file to match diskStorage format
            req.file.path = filepath;
            req.file.destination = uploadDir;
            req.file.filename = filename;
            
            console.log(`[UPLOAD] File saved from memory to: ${filepath}`);
          } catch (saveError) {
            console.error('[UPLOAD] Error saving from memory:', saveError);
            return next(saveError);
          }
        }
        
        next();
      });
    } else {
      if (req.file) {
        console.log(`[UPLOAD] Disk storage successful: ${req.file.path}`);
      }
      next();
    }
  });
};

// Export the smart upload middleware
module.exports = {
  single: (fieldName) => smartUpload,
  // For backward compatibility
  upload: smartUpload
};

// ✅ HEALTH CHECK: Log environment info on startup
console.log('[UPLOAD MIDDLEWARE] Environment check:');
console.log('- NODE_ENV:', process.env.NODE_ENV);
console.log('- Platform:', process.platform);
console.log('- CWD:', process.cwd());
console.log('- Temp dir:', process.env.NODE_ENV === 'production' ? '/tmp' : 'local');

// Test directory creation on startup
try {
  const testDir = createUploadDir();
  console.log(`[UPLOAD MIDDLEWARE] Ready! Upload directory: ${testDir}`);
} catch (error) {
  console.error('[UPLOAD MIDDLEWARE] Setup failed:', error.message);
}