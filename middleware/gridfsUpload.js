// middleware/gridfsUpload.js
const multer = require('multer');
const { GridFSBucket } = require('mongodb');
const mongoose = require('mongoose');
const crypto = require('crypto');
const path = require('path');

class GridFSUploadMiddleware {
  constructor() {
    this.upload = null;
    this.bucket = null;
    this.initializeUpload();
  }

  initializeUpload() {
    // Configure multer to use memory storage
    const storage = multer.memoryStorage();
    
    this.upload = multer({
      storage: storage,
      limits: {
        fileSize: 5 * 1024 * 1024, // 5MB limit
        files: 1 // Only allow 1 file
      },
      fileFilter: (req, file, cb) => {
        console.log(`[GridFS Upload] Processing file: ${file.originalname}`);
        
        // Check file type
        const allowedMimes = [
          'image/jpeg',
          'image/jpg', 
          'image/png',
          'image/gif',
          'application/pdf'
        ];
        
        if (allowedMimes.includes(file.mimetype)) {
          cb(null, true);
        } else {
          cb(new Error(`Invalid file type. Allowed types: ${allowedMimes.join(', ')}`), false);
        }
      }
    });
  }

  // Get GridFS bucket instance
  getBucket() {
    if (!this.bucket && mongoose.connection.db) {
      this.bucket = new GridFSBucket(mongoose.connection.db, {
        bucketName: 'payment_proofs'
      });
      console.log('GridFS bucket initialized for payment_proofs');
    }
    return this.bucket;
  }

  // Upload file to GridFS
  async uploadToGridFS(buffer, filename, metadata = {}) {
    return new Promise((resolve, reject) => {
      const bucket = this.getBucket();
      
      if (!bucket) {
        return reject(new Error('GridFS bucket not available'));
      }

      // Generate unique filename
      const timestamp = Date.now();
      const randomSuffix = crypto.randomBytes(6).toString('hex');
      const ext = path.extname(filename);
      const uniqueFilename = `payment-${timestamp}-${randomSuffix}${ext}`;

      console.log(`[GridFS] Uploading file: ${uniqueFilename}, size: ${buffer.length} bytes`);

      const uploadStream = bucket.openUploadStream(uniqueFilename, {
        metadata: {
          originalName: filename,
          uploadDate: new Date(),
          ...metadata
        }
      });

      uploadStream.on('error', (error) => {
        console.error('[GridFS] Upload error:', error);
        reject(error);
      });

      uploadStream.on('finish', (file) => {
        console.log(`[GridFS] Upload successful: ${file.filename}, ID: ${file._id}`);
        resolve({
          fileId: file._id,
          filename: file.filename,
          originalName: filename,
          size: buffer.length,
          uploadDate: new Date()
        });
      });

      // Write buffer to stream
      uploadStream.end(buffer);
    });
  }

  // Download file from GridFS
  async downloadFromGridFS(filename) {
    return new Promise((resolve, reject) => {
      const bucket = this.getBucket();
      
      if (!bucket) {
        return reject(new Error('GridFS bucket not available'));
      }

      console.log(`[GridFS] Downloading file: ${filename}`);

      const chunks = [];
      let fileInfo = null;

      const downloadStream = bucket.openDownloadStreamByName(filename);

      downloadStream.on('file', (file) => {
        fileInfo = file;
        console.log(`[GridFS] File found: ${file.filename}, size: ${file.length} bytes`);
      });

      downloadStream.on('data', (chunk) => {
        chunks.push(chunk);
      });

      downloadStream.on('error', (error) => {
        console.error(`[GridFS] Download error for ${filename}:`, error);
        reject(error);
      });

      downloadStream.on('end', () => {
        const buffer = Buffer.concat(chunks);
        console.log(`[GridFS] Download completed: ${filename}, ${buffer.length} bytes`);
        
        resolve({
          buffer,
          fileInfo,
          contentType: fileInfo?.metadata?.contentType || 'application/octet-stream',
          originalName: fileInfo?.metadata?.originalName || filename
        });
      });
    });
  }

  // Check if file exists in GridFS
  async fileExists(filename) {
    try {
      const bucket = this.getBucket();
      
      if (!bucket) {
        return false;
      }

      // Try to find the file
      const files = await bucket.find({ filename }).toArray();
      return files.length > 0;
    } catch (error) {
      console.error(`[GridFS] Error checking file existence: ${filename}`, error);
      return false;
    }
  }

  // Delete file from GridFS
  async deleteFromGridFS(filename) {
    try {
      const bucket = this.getBucket();
      
      if (!bucket) {
        throw new Error('GridFS bucket not available');
      }

      // Find the file first
      const files = await bucket.find({ filename }).toArray();
      
      if (files.length === 0) {
        console.log(`[GridFS] File not found for deletion: ${filename}`);
        return false;
      }

      // Delete the file
      await bucket.delete(files[0]._id);
      console.log(`[GridFS] File deleted: ${filename}`);
      return true;
    } catch (error) {
      console.error(`[GridFS] Error deleting file: ${filename}`, error);
      throw error;
    }
  }

  // Middleware function for handling file uploads
  handleUpload(fieldName = 'paymentProof') {
    return async (req, res, next) => {
      try {
        // First, use multer to handle the multipart form data
        const multerMiddleware = this.upload.single(fieldName);
        
        multerMiddleware(req, res, async (err) => {
          if (err) {
            console.error('[GridFS Middleware] Multer error:', err);
            
            if (err instanceof multer.MulterError) {
              switch (err.code) {
                case 'LIMIT_FILE_SIZE':
                  return res.status(400).json({
                    success: false,
                    message: 'File too large. Maximum size is 5MB.',
                    error: 'FILE_TOO_LARGE'
                  });
                case 'LIMIT_UNEXPECTED_FILE':
                  return res.status(400).json({
                    success: false,
                    message: `Unexpected file field. Use "${fieldName}" field name.`,
                    error: 'UNEXPECTED_FIELD'
                  });
                default:
                  return res.status(400).json({
                    success: false,
                    message: `Upload error: ${err.message}`,
                    error: 'MULTER_ERROR'
                  });
              }
            }
            
            return res.status(400).json({
              success: false,
              message: err.message || 'File upload failed',
              error: 'UPLOAD_ERROR'
            });
          }

          // Check if file was uploaded
          if (!req.file || !req.file.buffer) {
            return res.status(400).json({
              success: false,
              message: 'No file uploaded or file is empty',
              error: 'MISSING_FILE'
            });
          }

          try {
            console.log(`[GridFS Middleware] Processing uploaded file: ${req.file.originalname}`);
            console.log(`[GridFS Middleware] File size: ${req.file.buffer.length} bytes`);
            console.log(`[GridFS Middleware] MIME type: ${req.file.mimetype}`);

            // Upload to GridFS
            const uploadResult = await this.uploadToGridFS(
              req.file.buffer,
              req.file.originalname,
              {
                contentType: req.file.mimetype,
                fieldName: req.file.fieldname,
                userId: req.user?.id,
                uploadedAt: new Date()
              }
            );

            // Add GridFS info to request object
            req.gridfsFile = uploadResult;
            req.file.gridfsFilename = uploadResult.filename;
            req.file.gridfsFileId = uploadResult.fileId;

            console.log(`[GridFS Middleware] File successfully uploaded to GridFS: ${uploadResult.filename}`);
            
            next();
          } catch (uploadError) {
            console.error('[GridFS Middleware] GridFS upload error:', uploadError);
            return res.status(500).json({
              success: false,
              message: 'Failed to save file to database',
              error: 'GRIDFS_UPLOAD_ERROR'
            });
          }
        });
      } catch (error) {
        console.error('[GridFS Middleware] Unexpected error:', error);
        return res.status(500).json({
          success: false,
          message: 'Internal server error during file upload',
          error: 'INTERNAL_ERROR'
        });
      }
    };
  }

  // Middleware for serving files from GridFS
  serveFile() {
    return async (req, res, next) => {
      try {
        const { filename } = req.params;
        
        if (!filename) {
          return res.status(400).json({
            success: false,
            message: 'Filename is required'
          });
        }

        console.log(`[GridFS Serve] Serving file: ${filename}`);

        const { buffer, fileInfo, contentType, originalName } = await this.downloadFromGridFS(filename);

        // Set appropriate headers
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Length', buffer.length);
        res.setHeader('Content-Disposition', `inline; filename="${originalName}"`);
        res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache for 1 day

        // Send the file
        res.send(buffer);
        
      } catch (error) {
        console.error('[GridFS Serve] Error serving file:', error);
        
        if (error.message.includes('FileNotFound') || error.message.includes('file not found')) {
          return res.status(404).json({
            success: false,
            message: 'File not found',
            error: 'FILE_NOT_FOUND'
          });
        }
        
        return res.status(500).json({
          success: false,
          message: 'Error retrieving file',
          error: 'GRIDFS_SERVE_ERROR'
        });
      }
    };
  }
}

// Create singleton instance
const gridfsUpload = new GridFSUploadMiddleware();

module.exports = gridfsUpload;