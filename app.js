const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const fs = require('fs');

// Load environment variables
require('dotenv').config();

// Initialize express app
const app = express();

// Display important environment variables (without exposing sensitive data)
console.log('======================================');
console.log(`NODE_ENV: ${process.env.NODE_ENV}`);
console.log(`LENCO_API_KEY configured: ${process.env.LENCO_API_KEY ? 'Yes' : 'No'}`);
console.log('======================================');

// Security middleware
app.use(helmet());

// Rate limiting
const limiter = rateLimit({ 
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again after 15 minutes'
});

// Apply rate limiting to all routes
app.use(limiter);

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log('MongoDB Connected'))
.catch(err => {
  console.error(`Error connecting to MongoDB: ${err.message}`);
  process.exit(1);
});

// Middleware
app.use(cors());
app.use(express.json({ limit: '1mb' })); // Limit request body size
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Logging middleware
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

// Set up static folder for uploads
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// DETAILED SWAGGER DEBUGGING
console.log('\n🔍 DETAILED SWAGGER DEBUGGING');
console.log('======================================');

// Check current working directory
console.log(`Current directory: ${process.cwd()}`);
console.log(`__dirname: ${__dirname}`);

// Check if config directory exists
const configDir = path.join(__dirname, 'config');
console.log(`Config directory path: ${configDir}`);
console.log(`Config directory exists: ${fs.existsSync(configDir)}`);

if (fs.existsSync(configDir)) {
  const configFiles = fs.readdirSync(configDir);
  console.log(`Files in config directory:`, configFiles);
}

// Check specific swagger config file
const swaggerPath = path.join(__dirname, 'config', 'swaggerConfig.js');
console.log(`Swagger config path: ${swaggerPath}`);
console.log(`Swagger config exists: ${fs.existsSync(swaggerPath)}`);

if (fs.existsSync(swaggerPath)) {
  console.log('✅ swaggerConfig.js file found');
  
  try {
    console.log('Attempting to require swaggerConfig...');
    const swaggerConfig = require('./config/swaggerConfig');
    console.log('✅ swaggerConfig loaded successfully');
    console.log(`   Type: ${typeof swaggerConfig}`);
    console.log(`   Constructor: ${swaggerConfig.constructor.name}`);
    console.log(`   Is function: ${typeof swaggerConfig === 'function'}`);
    
    if (typeof swaggerConfig === 'function') {
      console.log('✅ swaggerConfig is a valid Express router');
      console.log('Mounting swagger config at /api...');
      app.use('/api', swaggerConfig);
      console.log('✅ Swagger routes mounted successfully');
      
      // Test if the routes are actually registered
      console.log('\n📋 Checking registered routes...');
      app._router.stack.forEach((middleware, index) => {
        if (middleware.route) {
          console.log(`  Route ${index}: ${middleware.route.path}`);
        } else if (middleware.name === 'router') {
          console.log(`  Router ${index}: ${middleware.regexp}`);
          if (middleware.handle && middleware.handle.stack) {
            middleware.handle.stack.forEach((route, routeIndex) => {
              if (route.route) {
                console.log(`    Sub-route ${routeIndex}: ${route.route.path}`);
              }
            });
          }
        }
      });
      
    } else {
      console.error('❌ swaggerConfig is not a function');
      console.error(`   Exported value:`, swaggerConfig);
      if (typeof swaggerConfig === 'object') {
        console.error(`   Object keys:`, Object.keys(swaggerConfig));
      }
    }
  } catch (error) {
    console.error('❌ Error loading swaggerConfig:', error.message);
    console.error('   Stack:', error.stack);
  }
} else {
  console.error('❌ swaggerConfig.js file not found');
  console.error('   Expected path:', swaggerPath);
  
  // Check if there are any .js files in config directory
  try {
    if (fs.existsSync(configDir)) {
      const jsFiles = fs.readdirSync(configDir).filter(file => file.endsWith('.js'));
      if (jsFiles.length > 0) {
        console.log('   Found these JS files in config directory:', jsFiles);
      } else {
        console.log('   No .js files found in config directory');
      }
    }
  } catch (err) {
    console.error('   Error reading config directory:', err.message);
  }
}

console.log('======================================\n');

// Add a simple test route for debugging
app.get('/test-simple', (req, res) => {
  res.json({
    success: true,
    message: 'Simple test route working',
    timestamp: new Date().toISOString()
  });
});

// Add basic API routes (temporarily simplified)
console.log('Setting up basic API routes...');

// Only load routes that we know work
try {
  app.use('/api/users', require('./routes/userRoutes'));
  console.log('✅ userRoutes loaded');
} catch (error) {
  console.error('❌ Error loading userRoutes:', error.message);
}

try {
  app.use('/api/payment', require('./routes/paymentRoutes'));
  console.log('✅ paymentRoutes loaded');
} catch (error) {
  console.error('❌ Error loading paymentRoutes:', error.message);
}

// Root route - Health check with debugging info
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'AfriMobile API is running',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    debug: {
      swaggerConfigExists: fs.existsSync(path.join(__dirname, 'config', 'swaggerConfig.js')),
      configDirectory: fs.existsSync(path.join(__dirname, 'config')),
      expectedSwaggerPath: '/api/docs',
      testEndpoints: {
        simple: '/test-simple',
        health: '/'
      }
    }
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Express Error:', err.stack);
  res.status(500).json({
    success: false,
    message: 'Something went wrong!',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// Handle 404 errors with more detail
app.use((req, res) => {
  console.log(`404 - Route not found: ${req.method} ${req.path}`);
  console.log(`Available routes check - is /api/test or /api/docs registered?`);
  
  res.status(404).json({
    success: false,
    message: 'Resource not found',
    requestedPath: req.path,
    method: req.method,
    suggestion: 'Try /test-simple or / for working endpoints'
  });
});

// Start server
const PORT = process.env.PORT || 5000;
const server = app.listen(PORT, () => {
  console.log('\n🚀 SERVER STARTED');
  console.log('**********************************************');
  console.log(`Server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/`);
  console.log(`Simple test: http://localhost:${PORT}/test-simple`);
  console.log(`Expected Swagger: http://localhost:${PORT}/api/docs`);
  console.log(`Expected Test: http://localhost:${PORT}/api/test`);
  console.log('**********************************************\n');
});

module.exports = app;