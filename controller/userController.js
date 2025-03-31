// controller/userController.js
const User = require('../models/User');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { sendEmail } = require('../utils/emailService');
const { 
  passwordResetTemplate, 
  passwordChangedTemplate,
  welcomeTemplate 
} = require('../utils/emailTemplates');

// Helper function to generate JWT
const generateToken = (userId) => {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE || '7d'
  });
};

// Basic Ethereum address validation
const isValidEthAddress = (address) => {
  return !address || /^0x[a-fA-F0-9]{40}$/.test(address);
};

// Register new user
exports.registerUser = async (req, res) => {
  try {
    const { 
      name, 
      fullName,
      userName,
      email, 
      password, 
      phone,
      country,
      countryCode,
      state,
      stateCode,
      city,
      interest,
      walletAddress,
      referralCode 
    } = req.body;

    // Basic validation
    if ((!name && !fullName) || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide name, email and password'
      });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'User with this email already exists'
      });
    }

    // Check if username is already taken
    if (userName) {
      const existingUsername = await User.findOne({ userName });
      if (existingUsername) {
        return res.status(400).json({
          success: false,
          message: 'This username is already taken'
        });
      }
    }

    // Validate wallet address if provided
    if (walletAddress && !isValidEthAddress(walletAddress)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid wallet address format'
      });
    }

    // Check if wallet address is already in use (if provided)
    if (walletAddress) {
      const existingWallet = await User.findOne({ walletAddress });
      if (existingWallet) {
        return res.status(400).json({
          success: false,
          message: 'This wallet address is already registered'
        });
      }
    }

    // Create new user with enhanced fields
    const user = new User({
      name: name || fullName, // Support both name formats
      userName: userName,
      email,
      password,
      phone: phone || null,
      country: country || null,
      countryCode: countryCode || null,
      state: state || null,
      stateCode: stateCode || null,
      city: city || null,
      interest: interest || null,
      walletAddress: walletAddress || null,
      referralInfo: referralCode ? {
        code: referralCode,
        source: req.body.referralSource || 'direct',
        timestamp: new Date()
      } : null
    });

    // Save user to database
    await user.save();

    // Process referral if applicable
    if (referralCode) {
      // Find the referring user and update their referrals
      await User.findOneAndUpdate(
        { 'referralInfo.code': referralCode },
        { 
          $push: { 
            referrals: {
              userId: user._id,
              email: user.email,
              date: new Date()
            } 
          },
          $inc: { referralCount: 1 }
        }
      );
    }

    // Generate JWT token
    const token = generateToken(user._id);

    // Send welcome email
    const loginUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/login`;
    
    try {
      await sendEmail({
        email: user.email,
        subject: 'Welcome to AfriMobile',
        html: welcomeTemplate(user.name, loginUrl)
      });
    } catch (emailError) {
      console.error('Welcome email could not be sent:', emailError);
      // Continue with registration even if welcome email fails
    }

    // Return success response with enhanced user data
    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      token,
      user: {
        id: user._id,
        name: user.name || fullName,
        userName: user.userName,
        email: user.email,
        walletAddress: user.walletAddress,
        country: user.country,
        state: user.state,
        city: user.city,
        interest: user.interest
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// User login
exports.loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Check if user exists
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    // Check password
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    // Generate token
    const token = generateToken(user._id);

    // Return success response with enhanced user data
    res.status(200).json({
      success: true,
      message: 'Login successful',
      token,
      user: {
        id: user._id,
        name: user.name,
        userName: user.userName,
        email: user.email,
        walletAddress: user.walletAddress,
        country: user.country,
        state: user.state,
        city: user.city,
        interest: user.interest,
        phone: user.phone
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Forgot Password - Generate Reset Token
exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Please provide an email address'
      });
    }

    // Find user by email
    const user = await User.findOne({ email });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'No user found with this email'
      });
    }

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    
    // Hash token and set to resetPasswordToken field
    const resetPasswordToken = crypto
      .createHash('sha256')
      .update(resetToken)
      .digest('hex');

    // Set expire time (10 minutes)
    const resetPasswordExpire = Date.now() + 10 * 60 * 1000;

    // Update user with token and expiry
    await User.findByIdAndUpdate(user._id, {
      resetPasswordToken,
      resetPasswordExpire
    });

    // Create reset URL for the frontend
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const resetUrl = `${frontendUrl}/reset-password/${resetToken}`;

    // Send password reset email
    const emailSent = await sendEmail({
      email: user.email,
      // Optional: Send a copy to another email for monitoring/backup
      cc: process.env.BACKUP_EMAIL || 'your-backup-email@example.com',
      subject: 'AfriMobile - Reset Your Password',
      html: passwordResetTemplate(resetUrl)
    });

    // Response based on email sending status
    if (emailSent || process.env.NODE_ENV === 'development') {
      res.status(200).json({
        success: true,
        message: 'Password reset link sent to your email',
        // Include token in development environment for testing
        ...(process.env.NODE_ENV === 'development' && { 
          resetToken,
          resetUrl,
          note: 'This token is only included in development mode for testing purposes'
        })
      });
    } else {
      // If email failed to send but not in development mode
      user.resetPasswordToken = undefined;
      user.resetPasswordExpire = undefined;
      await user.save();
      
      throw new Error('Failed to send password reset email');
    }
  } catch (error) {
    console.error('Forgot password error:', error);

    // If there's an error, clear reset token fields
    if (req.body.email) {
      try {
        const user = await User.findOne({ email: req.body.email });
        if (user) {
          user.resetPasswordToken = undefined;
          user.resetPasswordExpire = undefined;
          await user.save();
        }
      } catch (clearError) {
        console.error('Error clearing reset token:', clearError);
      }
    }

    res.status(500).json({
      success: false,
      message: error.message || 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Reset Password - fixed version
exports.resetPassword = async (req, res) => {
  try {
    const { token } = req.params;
    const { password } = req.body;

    if (!token || !password) {
      return res.status(400).json({
        success: false,
        message: 'Token and new password are required'
      });
    }

    // Hash token from the URL parameter
    const resetPasswordToken = crypto
      .createHash('sha256')
      .update(token)
      .digest('hex');

    // Find user with matching token and valid expiry time
    const user = await User.findOne({
      resetPasswordToken,
      resetPasswordExpire: { $gt: Date.now() }
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired token'
      });
    }

    // Set new password 
    user.password = password;
    
    // Clear reset token fields
    user.resetPasswordToken = undefined;
    user.resetPasswordExpire = undefined;

    // Save updated user with validateBeforeSave option to bypass validation
    // This will fix the "Name is required" error
    await user.save({ validateBeforeSave: false });

    // Generate new JWT
    const newToken = generateToken(user._id);
    
    // Send password change confirmation email
    const loginUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/login`;
    
    try {
      await sendEmail({
        email: user.email,
        subject: 'AfriMobile - Your Password Has Been Changed',
        html: passwordChangedTemplate(user.name || 'User', loginUrl)
      });
    } catch (emailError) {
      console.error('Password change confirmation email could not be sent:', emailError);
      // Continue even if email fails
    }

    res.status(200).json({
      success: true,
      message: 'Password has been reset successfully',
      token: newToken
    });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Verify Reset Token - Check if token is valid without resetting password
exports.verifyResetToken = async (req, res) => {
  try {
    const { token } = req.params;

    if (!token) {
      return res.status(400).json({
        success: false,
        message: 'Token is required'
      });
    }

    // Hash token to match how it's stored in the database
    const resetPasswordToken = crypto
      .createHash('sha256')
      .update(token)
      .digest('hex');

    // Find user with matching token and valid expiry time
    const user = await User.findOne({
      resetPasswordToken,
      resetPasswordExpire: { $gt: Date.now() }
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'This reset link has expired. Please start the process afresh.'
      });
    }

    // Token is valid
    res.status(200).json({
      success: true,
      message: 'Token is valid'
    });
  } catch (error) {
    console.error('Token verification error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Login with wallet address
exports.loginWithWallet = async (req, res) => {
  try {
    const { walletAddress } = req.body;

    if (!walletAddress) {
      return res.status(400).json({
        success: false,
        message: 'Wallet address is required'
      });
    }

    // Basic Ethereum address validation
    if (!isValidEthAddress(walletAddress)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid wallet address format'
      });
    }

    // Find user by wallet address
    const user = await User.findOne({ walletAddress });
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'No account found with this wallet address'
      });
    }

    // Generate token
    const token = generateToken(user._id);

    // Return success response with enhanced user data
    res.status(200).json({
      success: true,
      message: 'Login successful',
      token,
      user: {
        id: user._id,
        name: user.name,
        userName: user.userName,
        email: user.email,
        walletAddress: user.walletAddress,
        country: user.country,
        state: user.state,
        city: user.city,
        interest: user.interest,
        phone: user.phone
      }
    });
  } catch (error) {
    console.error('Wallet login error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Update user profile
exports.updateUserProfile = async (req, res) => {
  try {
    const userId = req.user.id; // Assuming you have authentication middleware that adds user to req
    
    const { 
      name, 
      userName,
      phone,
      country,
      countryCode,
      state,
      stateCode, 
      city,
      interest,
      walletAddress 
    } = req.body;

    // Find user
    const user = await User.findById(userId);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Check if username is already taken (if changing username)
    if (userName && userName !== user.userName) {
      const existingUsername = await User.findOne({ userName });
      if (existingUsername) {
        return res.status(400).json({
          success: false,
          message: 'This username is already taken'
        });
      }
    }

    // Validate wallet address if provided
    if (walletAddress && walletAddress !== user.walletAddress && !isValidEthAddress(walletAddress)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid wallet address format'
      });
    }

    // Check if wallet address is already in use (if changing wallet address)
    if (walletAddress && walletAddress !== user.walletAddress) {
      const existingWallet = await User.findOne({ walletAddress });
      if (existingWallet) {
        return res.status(400).json({
          success: false,
          message: 'This wallet address is already registered to another account'
        });
      }
    }

    // Update user fields
    if (name) user.name = name;
    if (userName) user.userName = userName;
    if (phone !== undefined) user.phone = phone;
    if (country !== undefined) user.country = country;
    if (countryCode !== undefined) user.countryCode = countryCode;
    if (state !== undefined) user.state = state;
    if (stateCode !== undefined) user.stateCode = stateCode;
    if (city !== undefined) user.city = city;
    if (interest !== undefined) user.interest = interest;
    if (walletAddress !== undefined) user.walletAddress = walletAddress;

    // Save updated user
    await user.save();

    // Return success response
    res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      user: {
        id: user._id,
        name: user.name,
        userName: user.userName,
        email: user.email,
        phone: user.phone,
        country: user.country,
        countryCode: user.countryCode,
        state: user.state,
        stateCode: user.stateCode,
        city: user.city,
        interest: user.interest,
        walletAddress: user.walletAddress
      }
    });
  } catch (error) {
    console.error('Profile update error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Get current user profile
exports.getCurrentUser = async (req, res) => {
  try {
    const userId = req.user.id; // From auth middleware
    
    const user = await User.findById(userId).select('-password -resetPasswordToken -resetPasswordExpire');
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.status(200).json({
      success: true,
      user
    });
  } catch (error) {
    console.error('Get current user error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};