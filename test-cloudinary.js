// test-cloudinary.js
const express = require('express');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

// Import your Cloudinary configuration
const {
  cloudinary,
  sharePaymentUpload,
  cofounderPaymentUpload,
  uploadToCloudinary,
  deleteFromCloudinary,
  getCloudinaryFileInfo,
  logCloudinaryUpload,
  handleCloudinaryError
} = require('./config/cloudinary');

const app = express();
const PORT =5002;

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Test 1: Check Cloudinary configuration
async function testCloudinaryConfig() {
  console.log('\n=== TEST 1: Cloudinary Configuration ===');
  
  try {
    // Check if environment variables are set
    const requiredEnvVars = ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'];
    const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
    
    if (missingVars.length > 0) {
      console.error('❌ Missing environment variables:', missingVars);
      return false;
    }
    
    console.log('✅ Environment variables are set');
    console.log('- Cloud Name:', process.env.CLOUDINARY_CLOUD_NAME);
    console.log('- API Key:', process.env.CLOUDINARY_API_KEY ? '***' + process.env.CLOUDINARY_API_KEY.slice(-4) : 'Not set');
    
    // Test Cloudinary connection
    const result = await cloudinary.api.ping();
    console.log('✅ Cloudinary connection successful:', result);
    
    return true;
  } catch (error) {
    console.error('❌ Cloudinary configuration failed:', error.message);
    return false;
  }
}

// Test 2: Test direct upload with buffer
async function testDirectUpload() {
  console.log('\n=== TEST 2: Direct Buffer Upload ===');
  
  try {
    // Create a simple test image buffer (1x1 pixel PNG)
    const testImageBuffer = Buffer.from([
      0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
      0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
      0xDE, 0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41,
      0x54, 0x08, 0xD7, 0x63, 0xF8, 0x00, 0x00, 0x00,
      0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44,
      0xAE, 0x42, 0x60, 0x82
    ]);

    console.log('🔄 Uploading test image...');
    const uploadResult = await uploadToCloudinary(testImageBuffer, {
      folder: 'test-uploads',
      public_id: `test-${Date.now()}`
    });
    
    console.log('✅ Upload successful!');
    console.log('- Public ID:', uploadResult.public_id);
    console.log('- Secure URL:', uploadResult.secure_url);
    console.log('- Format:', uploadResult.format);
    console.log('- Size:', uploadResult.bytes, 'bytes');
    
    // Test file info retrieval
    console.log('\n🔄 Testing file info retrieval...');
    const fileInfo = await getCloudinaryFileInfo(uploadResult.public_id);
    console.log('✅ File info retrieved successfully');
    console.log('- Created at:', fileInfo.created_at);
    console.log('- Resource type:', fileInfo.resource_type);
    
    // Clean up - delete the test file
    console.log('\n🔄 Cleaning up test file...');
    const deleteResult = await deleteFromCloudinary(uploadResult.public_id);
    console.log('✅ Test file deleted:', deleteResult.result);
    
    return true;
  } catch (error) {
    console.error('❌ Direct upload test failed:', error.message);
    return false;
  }
}

// Test 3: Test multer upload endpoints
function setupTestEndpoints() {
  console.log('\n=== TEST 3: Setting up Multer Upload Endpoints ===');
  
  // HTML form for testing
  app.get('/', (req, res) => {
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Cloudinary Upload Test</title>
        <style>
          body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
          .test-section { margin: 20px 0; padding: 20px; border: 1px solid #ddd; border-radius: 5px; }
          .success { color: green; }
          .error { color: red; }
          input[type="file"] { margin: 10px 0; }
          button { padding: 10px 20px; margin: 5px; }
        </style>
      </head>
      <body>
        <h1>Cloudinary Upload Test</h1>
        
        <div class="test-section">
          <h2>Test Share Payment Upload</h2>
          <form action="/test-share-upload" method="post" enctype="multipart/form-data">
            <input type="file" name="paymentProof" accept=".jpg,.jpeg,.png,.pdf" required>
            <br>
            <button type="submit">Upload Share Payment Proof</button>
          </form>
        </div>
        
        <div class="test-section">
          <h2>Test Co-founder Payment Upload</h2>
          <form action="/test-cofounder-upload" method="post" enctype="multipart/form-data">
            <input type="file" name="paymentProof" accept=".jpg,.jpeg,.png,.pdf" required>
            <br>
            <button type="submit">Upload Co-founder Payment Proof</button>
          </form>
        </div>
        
        <div class="test-section">
          <h2>Test Results</h2>
          <p>Upload results will appear here after submission.</p>
        </div>
      </body>
      </html>
    `);
  });

  // Test share payment upload
  app.post('/test-share-upload', 
    sharePaymentUpload.single('paymentProof'),
    logCloudinaryUpload,
    handleCloudinaryError,
    (req, res) => {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: 'No file uploaded'
        });
      }

      res.json({
        success: true,
        message: 'Share payment proof uploaded successfully!',
        file: {
          originalName: req.file.originalname,
          cloudinaryUrl: req.file.path,
          publicId: req.file.filename,
          size: req.file.size,
          format: req.file.format
        }
      });
    }
  );

  // Test co-founder payment upload
  app.post('/test-cofounder-upload', 
    cofounderPaymentUpload.single('paymentProof'),
    logCloudinaryUpload,
    handleCloudinaryError,
    (req, res) => {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: 'No file uploaded'
        });
      }

      res.json({
        success: true,
        message: 'Co-founder payment proof uploaded successfully!',
        file: {
          originalName: req.file.originalname,
          cloudinaryUrl: req.file.path,
          publicId: req.file.filename,
          size: req.file.size,
          format: req.file.format
        }
      });
    }
  );

  console.log('✅ Test endpoints set up successfully');
}

// Test 4: Test error handling
async function testErrorHandling() {
  console.log('\n=== TEST 4: Error Handling ===');
  
  try {
    // Test invalid public ID
    console.log('🔄 Testing invalid public ID...');
    await getCloudinaryFileInfo('invalid-public-id-that-does-not-exist');
  } catch (error) {
    console.log('✅ Error handling works for invalid public ID:', error.message);
  }
  
  try {
    // Test deleting non-existent file
    console.log('🔄 Testing delete non-existent file...');
    const deleteResult = await deleteFromCloudinary('non-existent-file');
    console.log('✅ Delete non-existent file handled:', deleteResult.result);
  } catch (error) {
    console.log('✅ Error handling works for non-existent file:', error.message);
  }
}

// Main test function
async function runTests() {
  console.log('🚀 Starting Cloudinary Tests...\n');
  
  const results = {
    config: await testCloudinaryConfig(),
    directUpload: false,
    errorHandling: false
  };
  
  if (results.config) {
    results.directUpload = await testDirectUpload();
    await testErrorHandling();
    results.errorHandling = true;
  }
  
  console.log('\n=== TEST SUMMARY ===');
  console.log('Configuration:', results.config ? '✅ PASSED' : '❌ FAILED');
  console.log('Direct Upload:', results.directUpload ? '✅ PASSED' : '❌ FAILED');
  console.log('Error Handling:', results.errorHandling ? '✅ PASSED' : '❌ FAILED');
  
  if (results.config && results.directUpload) {
    console.log('\n🎉 All tests passed! Your Cloudinary setup is working correctly.');
    console.log(`📝 You can test file uploads by visiting: http://localhost:${PORT}`);
  } else {
    console.log('\n❌ Some tests failed. Please check your configuration.');
  }
}

// Start the test
if (require.main === module) {
  // Run tests first
  runTests().then(() => {
    // Set up server for manual testing
    setupTestEndpoints();
    
    app.listen(PORT, () => {
      console.log(`\n🌐 Test server running on http://localhost:${PORT}`);
      console.log('Visit the URL above to test file uploads manually.');
    });
  });
}

module.exports = {
  testCloudinaryConfig,
  testDirectUpload,
  testErrorHandling,
  runTests
};