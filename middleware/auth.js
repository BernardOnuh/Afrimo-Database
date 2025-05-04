const jwt = require('jsonwebtoken');
const User = require('../models/User');

// Authentication middleware
exports.protect = async (req, res, next) => {
  let token;
  
  try {
    // Get token from Authorization header
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    } else if (req.cookies && req.cookies.token) {
      // Also check for token in cookies (alternative authentication method)
      token = req.cookies.token;
    }
    
    // Check if token exists
    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Access denied. No authentication token provided.'
      });
    }
    
    try {
      // Verify token
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      
      // Check if token is expired
      const currentTime = Math.floor(Date.now() / 1000);
      if (decoded.exp && decoded.exp < currentTime) {
        return res.status(401).json({
          success: false,
          message: 'Token expired. Please login again.'
        });
      }
      
      // Get user from token
      const user = await User.findById(decoded.id).select('-password');
      
      if (!user) {
        return res.status(401).json({
          success: false,
          message: 'Invalid token. User not found.'
        });
      }
      
      // Check if user is banned
      if (user.isBanned) {
        return res.status(403).json({
          success: false,
          message: 'Your account has been suspended.',
          reason: user.banReason || 'Violation of terms of service',
          bannedAt: user.bannedAt
        });
      }
      
      // Check if user is active (keep existing status checks)
      if (user.status === 'inactive' || user.status === 'suspended') {
        return res.status(403).json({
          success: false,
          message: 'Your account is currently inactive or suspended.'
        });
      }
      
      // Add user to request object
      req.user = user;
      next();
    } catch (error) {
      if (error.name === 'JsonWebTokenError') {
        return res.status(401).json({
          success: false,
          message: 'Invalid authentication token.'
        });
      } else if (error.name === 'TokenExpiredError') {
        return res.status(401).json({
          success: false,
          message: 'Token expired. Please login again.'
        });
      } else {
        console.error('Token verification error:', error);
        return res.status(401).json({
          success: false,
          message: 'Authentication failed.',
          error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
      }
    }
  } catch (error) {
    console.error('Auth middleware error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error during authentication.',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Admin authorization middleware
exports.adminProtect = async (req, res, next) => {
  try {
    // First authenticate the user
    exports.protect(req, res, () => {
      // Then check if user has admin rights
      if (!req.user || !req.user.isAdmin) {
        return res.status(403).json({
          success: false,
          message: 'Access denied. Admin privileges required.'
        });
      }
      
      // If user is admin, proceed
      next();
    });
  } catch (error) {
    console.error('Admin authorization error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error during authorization.',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Role-based authorization middleware (for future use)
exports.authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Role ${req.user ? req.user.role : 'undefined'} is not authorized to access this resource`
      });
    }
    next();
  };
};