// controller/userController.js - Updated to use NIN instead of BVN
const User = require("../models/User");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const mongoose = require('mongoose');
const { sendEmail } = require("../utils/emailService");
const {
  passwordResetTemplate,
  passwordChangedTemplate,
  welcomeTemplate,
} = require("../utils/emailTemplates");
const referralController = require("../controller/referralController");

// controller/userController.js
const SmileIDService = require("../services/smileIDService");
const smileIDService = new SmileIDService();

// Helper function to generate JWT
const generateToken = (userId) => {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE || "7d",
  });
};

// Basic Ethereum address validation
const isValidEthAddress = (address) => {
  return !address || /^0x[a-fA-F0-9]{40}$/.test(address);
};

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
      referralCode,
    } = req.body;

    // Basic validation
    if ((!name && !fullName) || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "Please provide name, email and password",
      });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: "User with this email already exists",
      });
    }

    // Check if username is already taken
    if (userName) {
      const existingUsername = await User.findOne({ userName });
      if (existingUsername) {
        return res.status(400).json({
          success: false,
          message: "This username is already taken",
        });
      }
    }

    // Validate wallet address if provided
    if (walletAddress && !isValidEthAddress(walletAddress)) {
      return res.status(400).json({
        success: false,
        message: "Invalid wallet address format",
      });
    }

    // Check if wallet address is already in use (if provided)
    if (walletAddress) {
      const existingWallet = await User.findOne({ walletAddress });
      if (existingWallet) {
        return res.status(400).json({
          success: false,
          message: "This wallet address is already registered",
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
      referralInfo: referralCode
        ? {
            code: referralCode,
            source: req.body.referralSource || "direct",
            timestamp: new Date(),
          }
        : null,
    });

    // Save user to database
    await user.save();

    // Process referral if applicable using the enhanced referral controller
    if (referralCode) {
      try {
        // Call the processNewUserReferral function with the new user's ID
        await referralController.processNewUserReferral(user._id);
        console.log(
          `Referral processed for new user ${user.email} with code ${referralCode}`
        );
      } catch (referralError) {
        console.error("Error processing referral:", referralError);
        // Continue with registration even if referral processing fails
      }
    }

    // Generate JWT token
    const token = generateToken(user._id);

    // Send welcome email
    const loginUrl = `${
      process.env.FRONTEND_URL || "http://localhost:3000"
    }/login`;

    try {
      await sendEmail({
        email: user.email,
        subject: "Welcome to AfriMobile",
        html: welcomeTemplate(user.name, loginUrl),
      });
    } catch (emailError) {
      console.error("Welcome email could not be sent:", emailError);
      // Continue with registration even if welcome email fails
    }

    // Return success response with enhanced user data
    res.status(201).json({
      success: true,
      message: "User registered successfully",
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
        interest: user.interest,
      },
    });
  } catch (error) {
    console.error("Registration error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

// User login with email or username
exports.loginUser = async (req, res) => {
  try {
    const { email, username, password } = req.body;

    // Require either email or username
    if (!email && !username) {
      return res.status(400).json({
        success: false,
        message: "Please provide either email or username",
      });
    }

    // Check if user exists by email or username
    let user;
    if (email) {
      user = await User.findOne({ email }).select("+password");
    } else {
      user = await User.findOne({ userName: username }).select("+password");
    }

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid credentials",
      });
    }

    // Check password
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Invalid credentials",
      });
    }

    // Check if user is banned
    if (user.isBanned) {
      return res.status(403).json({
        success: false,
        message: "Your account has been suspended",
        reason: user.banReason || "Violation of terms of service",
        bannedAt: user.bannedAt,
      });
    }

    // Generate token
    const token = generateToken(user._id);

    // Return success response with enhanced user data
    res.status(200).json({
      success: true,
      message: "Login successful",
      token,
      user: {
        id: user._id,
        name: user.name,
        userName: user.userName,
        email: user.email,
        walletAddress: user.walletAddress,
        country: user.country,
        interest: user.interest,
        phone: user.phone,
        isAdmin: user.isAdmin,
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
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
        message: "Please provide an email address",
      });
    }

    // Find user by email
    const user = await User.findOne({ email });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "No user found with this email",
      });
    }

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString("hex");

    // Hash token and set to resetPasswordToken field
    const resetPasswordToken = crypto
      .createHash("sha256")
      .update(resetToken)
      .digest("hex");

    // Set expire time (10 minutes)
    const resetPasswordExpire = Date.now() + 10 * 60 * 1000;

    // Update user with token and expiry
    await User.findByIdAndUpdate(user._id, {
      resetPasswordToken,
      resetPasswordExpire,
    });

    // Create reset URL for the frontend
    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
    const resetUrl = `${frontendUrl}/reset-password/${resetToken}`;

    // Send password reset email
    const emailSent = await sendEmail({
      email: user.email,
      // Optional: Send a copy to another email for monitoring/backup
      cc: process.env.BACKUP_EMAIL || "your-backup-email@example.com",
      subject: "AfriMobile - Reset Your Password",
      html: passwordResetTemplate(resetUrl),
    });

    // Response based on email sending status
    if (emailSent || process.env.NODE_ENV === "development") {
      res.status(200).json({
        success: true,
        message: "Password reset link sent to your email",
        // Include token in development environment for testing
        ...(process.env.NODE_ENV === "development" && {
          resetToken,
          resetUrl,
          note: "This token is only included in development mode for testing purposes",
        }),
      });
    } else {
      // If email failed to send but not in development mode
      user.resetPasswordToken = undefined;
      user.resetPasswordExpire = undefined;
      await user.save();

      throw new Error("Failed to send password reset email");
    }
  } catch (error) {
    console.error("Forgot password error:", error);

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
        console.error("Error clearing reset token:", clearError);
      }
    }

    res.status(500).json({
      success: false,
      message: error.message || "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
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
        message: "Token and new password are required",
      });
    }

    // Hash token from the URL parameter
    const resetPasswordToken = crypto
      .createHash("sha256")
      .update(token)
      .digest("hex");

    // Find user with matching token and valid expiry time
    const user = await User.findOne({
      resetPasswordToken,
      resetPasswordExpire: { $gt: Date.now() },
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        message: "Invalid or expired token",
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
    const loginUrl = `${
      process.env.FRONTEND_URL || "http://localhost:3000"
    }/login`;

    try {
      await sendEmail({
        email: user.email,
        subject: "AfriMobile - Your Password Has Been Changed",
        html: passwordChangedTemplate(user.name || "User", loginUrl),
      });
    } catch (emailError) {
      console.error(
        "Password change confirmation email could not be sent:",
        emailError
      );
      // Continue even if email fails
    }

    res.status(200).json({
      success: true,
      message: "Password has been reset successfully",
      token: newToken,
    });
  } catch (error) {
    console.error("Reset password error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
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
        message: "Token is required",
      });
    }

    // Hash token to match how it's stored in the database
    const resetPasswordToken = crypto
      .createHash("sha256")
      .update(token)
      .digest("hex");

    // Find user with matching token and valid expiry time
    const user = await User.findOne({
      resetPasswordToken,
      resetPasswordExpire: { $gt: Date.now() },
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        message:
          "This reset link has expired. Please start the process afresh.",
      });
    }

    // Token is valid
    res.status(200).json({
      success: true,
      message: "Token is valid",
    });
  } catch (error) {
    console.error("Token verification error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
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
        message: "Wallet address is required",
      });
    }

    // Basic Ethereum address validation
    if (!isValidEthAddress(walletAddress)) {
      return res.status(400).json({
        success: false,
        message: "Invalid wallet address format",
      });
    }

    // Find user by wallet address
    const user = await User.findOne({ walletAddress });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "No account found with this wallet address",
      });
    }

    // Check if user is banned
    if (user.isBanned) {
      return res.status(403).json({
        success: false,
        message: "Your account has been suspended",
        reason: user.banReason || "Violation of terms of service",
        bannedAt: user.bannedAt,
      });
    }

    // Generate token
    const token = generateToken(user._id);

    // Return success response with enhanced user data
    res.status(200).json({
      success: true,
      message: "Login successful",
      token,
      user: {
        id: user._id,
        name: user.name,
        userName: user.userName,
        email: user.email,
        walletAddress: user.walletAddress,
        country: user.country,
        interest: user.interest,
        phone: user.phone,
        isAdmin: user.isAdmin,
      },
    });
  } catch (error) {
    console.error("Wallet login error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
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
      walletAddress,
    } = req.body;

    // Find user
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Check if username is already taken (if changing username)
    if (userName && userName !== user.userName) {
      const existingUsername = await User.findOne({ userName });
      if (existingUsername) {
        return res.status(400).json({
          success: false,
          message: "This username is already taken",
        });
      }
    }

    // Validate wallet address if provided
    if (
      walletAddress &&
      walletAddress !== user.walletAddress &&
      !isValidEthAddress(walletAddress)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid wallet address format",
      });
    }

    // Check if wallet address is already in use (if changing wallet address)
    if (walletAddress && walletAddress !== user.walletAddress) {
      const existingWallet = await User.findOne({ walletAddress });
      if (existingWallet) {
        return res.status(400).json({
          success: false,
          message:
            "This wallet address is already registered to another account",
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
      message: "Profile updated successfully",
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
        walletAddress: user.walletAddress,
      },
    });
  } catch (error) {
    console.error("Profile update error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

// Get current user profile
exports.getCurrentUser = async (req, res) => {
  try {
    const userId = req.user.id; // From auth middleware

    const user = await User.findById(userId).select(
      "-password -resetPasswordToken -resetPasswordExpire"
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    res.status(200).json({
      success: true,
      user,
    });
  } catch (error) {
    console.error("Get current user error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

// Add these methods to your userController.js file

// Get user profile
exports.getUserProfile = async (req, res) => {
  try {
    const userId = req.user.id; // From auth middleware

    // Find user by ID but exclude sensitive information
    const user = await User.findById(userId).select(
      "-password -resetPasswordToken -resetPasswordExpire"
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    res.status(200).json({
      success: true,
      data: user,
    });
  } catch (error) {
    console.error("Error fetching user profile:", error);
    res.status(500).json({
      success: false,
      message: "Server error while fetching profile",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

// Update user profile
exports.updateUserProfile = async (req, res) => {
  try {
    const userId = req.user.id; // From auth middleware
    const { name, email, walletAddress, phoneNumber } = req.body;

    // Prepare update object with only provided fields
    const updateData = {};
    if (name) updateData.name = name;
    if (email) updateData.email = email;
    if (walletAddress) updateData.walletAddress = walletAddress;
    if (phoneNumber) updateData.phoneNumber = phoneNumber;

    // Check if email is being updated
    if (email) {
      const existingUser = await User.findOne({ email, _id: { $ne: userId } });
      if (existingUser) {
        return res.status(400).json({
          success: false,
          message: "Email already in use by another account",
        });
      }
    }

    // Update the user
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { $set: updateData },
      { new: true, runValidators: true }
    ).select("-password -resetPasswordToken -resetPasswordExpire");

    if (!updatedUser) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Profile updated successfully",
      data: updatedUser,
    });
  } catch (error) {
    console.error("Error updating user profile:", error);
    res.status(500).json({
      success: false,
      message: "Server error while updating profile",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

// Update user password
exports.updatePassword = async (req, res) => {
  try {
    const userId = req.user.id; // From auth middleware
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: "Please provide both current and new password",
      });
    }

    // Get user with password
    const user = await User.findById(userId).select("+password");

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Check if current password matches
    // Changed from user.matchPassword to user.comparePassword to match the method used in loginUser
    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Current password is incorrect",
      });
    }

    // Set new password
    user.password = newPassword;
    await user.save();

    res.status(200).json({
      success: true,
      message: "Password updated successfully",
    });
  } catch (error) {
    console.error("Error updating password:", error);
    res.status(500).json({
      success: false,
      message: "Server error while updating password",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

async function setUserAsAdmin(email) {
  try {
    // Find user by email
    const user = await User.findOne({ email });

    if (!user) {
      console.error(`User with email ${email} not found`);
      return null;
    }

    // Set user as admin
    user.isAdmin = true;
    await user.save();

    console.log(`User with email ${email} has been granted admin privileges`);
    return user;
  } catch (error) {
    console.error("Error setting admin:", error);
    throw error;
  }
}

// Execute the function
setUserAsAdmin("onuhbernard4@gmail.com")
  .then((adminUser) => {
    if (adminUser) {
      console.log("Admin user successfully created:", adminUser);
    }
  })
  .catch((error) => {
    console.error("Failed to set admin:", error);
  });

async function grantAdminRights(adminEmail, newAdminEmail) {
  try {
    // First, verify the current user is an admin
    const adminUser = await User.findOne({ email: adminEmail, isAdmin: true });

    if (!adminUser) {
      throw new Error("You do not have permission to grant admin rights");
    }

    // Find the user to be granted admin rights
    const userToPromote = await User.findOne({ email: newAdminEmail });

    if (!userToPromote) {
      throw new Error(`User with email ${newAdminEmail} not found`);
    }

    // Grant admin rights
    userToPromote.isAdmin = true;
    await userToPromote.save();

    console.log(
      `User ${newAdminEmail} has been granted admin privileges by ${adminEmail}`
    );
    return userToPromote;
  } catch (error) {
    console.error("Error granting admin rights:", error);
    throw error;
  }
}

// Example usage
grantAdminRights("onuhbernard4@gmail.com", "newadmin@example.com")
  .then((promotedUser) => {
    console.log("New admin user:", promotedUser);
  })
  .catch((error) => {
    console.error("Failed to grant admin rights:", error);
  });

// Add this to your userController.js
exports.grantAdminRights = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Please provide an email address",
      });
    }

    // Find the user to be granted admin rights
    const userToPromote = await User.findOne({ email });

    if (!userToPromote) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Check if user is already an admin
    if (userToPromote.isAdmin) {
      return res.status(400).json({
        success: false,
        message: "User is already an admin",
      });
    }

    // Grant admin rights
    userToPromote.isAdmin = true;
    await userToPromote.save();

    res.status(200).json({
      success: true,
      message: `User ${email} has been granted admin privileges`,
      user: {
        id: userToPromote._id,
        email: userToPromote.email,
        isAdmin: true,
      },
    });
  } catch (error) {
    console.error("Error granting admin rights:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

// Add these to your userController.js file

// Ban user
exports.banUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const { reason } = req.body;

    // Verify the current user is an admin
    if (!req.user.isAdmin) {
      return res.status(403).json({
        success: false,
        message: "Permission denied: Admin access required",
      });
    }

    // Find user to ban
    const userToBan = await User.findById(userId);

    if (!userToBan) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Don't allow banning other admins
    if (userToBan.isAdmin) {
      return res.status(403).json({
        success: false,
        message: "Cannot ban an admin user",
      });
    }

    // Update user status
    userToBan.isBanned = true;
    userToBan.banReason = reason || "Violation of terms of service";
    userToBan.bannedAt = new Date();
    userToBan.bannedBy = req.user.id;

    await userToBan.save();

    res.status(200).json({
      success: true,
      message: `User ${userToBan.email} has been banned`,
      user: {
        id: userToBan._id,
        email: userToBan.email,
        isBanned: true,
        banReason: userToBan.banReason,
        bannedAt: userToBan.bannedAt,
      },
    });
  } catch (error) {
    console.error("Error banning user:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

// Unban user
exports.unbanUser = async (req, res) => {
  try {
    const { userId } = req.params;

    // Verify the current user is an admin
    if (!req.user.isAdmin) {
      return res.status(403).json({
        success: false,
        message: "Permission denied: Admin access required",
      });
    }

    // Find user to unban
    const userToUnban = await User.findById(userId);

    if (!userToUnban) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Check if user is already unbanned
    if (!userToUnban.isBanned) {
      return res.status(400).json({
        success: false,
        message: "User is not currently banned",
      });
    }

    // Update user status
    userToUnban.isBanned = false;
    userToUnban.banReason = undefined;
    userToUnban.unbannedAt = new Date();
    userToUnban.unbannedBy = req.user.id;

    await userToUnban.save();

    res.status(200).json({
      success: true,
      message: `User ${userToUnban.email} has been unbanned`,
      user: {
        id: userToUnban._id,
        email: userToUnban.email,
        isBanned: false,
        unbannedAt: userToUnban.unbannedAt,
      },
    });
  } catch (error) {
    console.error("Error unbanning user:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

// Add these functions to your userController.js file

// Get all users (admin only)
exports.getAllUsers = async (req, res) => {
  try {
    // Verify the current user is an admin
    if (!req.user.isAdmin) {
      return res.status(403).json({
        success: false,
        message: "Permission denied: Admin access required",
      });
    }

    // Parse query parameters
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const search = req.query.search || "";
    const status = req.query.status || "all";

    // Calculate skip value for pagination
    const skip = (page - 1) * limit;

    // Build filter object
    let filter = {};

    // Add search filter
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
        { userName: { $regex: search, $options: "i" } },
      ];
    }

    // Add status filter
    if (status === "active") {
      filter.isBanned = { $ne: true };
    } else if (status === "banned") {
      filter.isBanned = true;
    }

    // Get total count for pagination
    const totalUsers = await User.countDocuments(filter);

    // Calculate pagination info
    const totalPages = Math.ceil(totalUsers / limit);
    const hasNext = page < totalPages;
    const hasPrev = page > 1;

    // Fetch users with pagination
    const users = await User.find(filter)
      .select("-password -resetPasswordToken -resetPasswordExpire")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("bannedBy", "name email")
      .populate("unbannedBy", "name email");

    res.status(200).json({
      success: true,
      data: {
        users,
        pagination: {
          currentPage: page,
          totalPages,
          totalUsers,
          hasNext,
          hasPrev,
          limit,
        },
      },
    });
  } catch (error) {
    console.error("Error fetching all users:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

// Get user by ID (admin only)
exports.getUserById = async (req, res) => {
  try {
    // Verify the current user is an admin
    if (!req.user.isAdmin) {
      return res.status(403).json({
        success: false,
        message: "Permission denied: Admin access required",
      });
    }

    const { userId } = req.params;

    // Find user by ID
    const user = await User.findById(userId)
      .select("-password -resetPasswordToken -resetPasswordExpire")
      .populate("bannedBy", "name email")
      .populate("unbannedBy", "name email");

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    res.status(200).json({
      success: true,
      data: user,
    });
  } catch (error) {
    console.error("Error fetching user by ID:", error);

    // Handle invalid ObjectId format
    if (error.name === "CastError") {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID format",
      });
    }

    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

// Get all admin users (admin only)
exports.getAllAdmins = async (req, res) => {
  try {
    // Verify the current user is an admin
    if (!req.user.isAdmin) {
      return res.status(403).json({
        success: false,
        message: "Permission denied: Admin access required",
      });
    }

    // Parse query parameters
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;

    // Calculate skip value for pagination
    const skip = (page - 1) * limit;

    // Filter for admin users only
    const filter = { isAdmin: true };

    // Get total count for pagination
    const totalAdmins = await User.countDocuments(filter);

    // Calculate pagination info
    const totalPages = Math.ceil(totalAdmins / limit);
    const hasNext = page < totalPages;
    const hasPrev = page > 1;

    // Fetch admin users with pagination
    const admins = await User.find(filter)
      .select("-password -resetPasswordToken -resetPasswordExpire")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    res.status(200).json({
      success: true,
      data: {
        admins,
        pagination: {
          currentPage: page,
          totalPages,
          totalAdmins,
          hasNext,
          hasPrev,
          limit,
        },
      },
    });
  } catch (error) {
    console.error("Error fetching admin users:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

// Revoke admin rights from user (admin only)
exports.revokeAdminRights = async (req, res) => {
  try {
    // Verify the current user is an admin
    if (!req.user.isAdmin) {
      return res.status(403).json({
        success: false,
        message: "Permission denied: Admin access required",
      });
    }

    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Please provide an email address",
      });
    }

    // Find the user to revoke admin rights from
    const userToRevoke = await User.findOne({ email });

    if (!userToRevoke) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Check if user is currently an admin
    if (!userToRevoke.isAdmin) {
      return res.status(400).json({
        success: false,
        message: "User is not currently an admin",
      });
    }

    // Prevent self-revocation (optional security measure)
    if (userToRevoke._id.toString() === req.user.id) {
      return res.status(400).json({
        success: false,
        message: "You cannot revoke your own admin rights",
      });
    }

    // Revoke admin rights
    userToRevoke.isAdmin = false;
    userToRevoke.adminRevokedAt = new Date();
    userToRevoke.adminRevokedBy = req.user.id;

    await userToRevoke.save();

    res.status(200).json({
      success: true,
      message: `Admin rights revoked from ${email}`,
      user: {
        id: userToRevoke._id,
        email: userToRevoke.email,
        isAdmin: false,
        adminRevokedAt: userToRevoke.adminRevokedAt,
      },
    });
  } catch (error) {
    console.error("Error revoking admin rights:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

// Update the existing getBannedUsers function to include pagination
exports.getBannedUsers = async (req, res) => {
  try {
    // Verify the current user is an admin
    if (!req.user.isAdmin) {
      return res.status(403).json({
        success: false,
        message: "Permission denied: Admin access required",
      });
    }

    // Parse query parameters
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;

    // Calculate skip value for pagination
    const skip = (page - 1) * limit;

    // Filter for banned users only
    const filter = { isBanned: true };

    // Get total count for pagination
    const totalBannedUsers = await User.countDocuments(filter);

    // Calculate pagination info
    const totalPages = Math.ceil(totalBannedUsers / limit);
    const hasNext = page < totalPages;
    const hasPrev = page > 1;

    // Fetch banned users with pagination
    const bannedUsers = await User.find(filter)
      .select("name email isBanned banReason bannedAt bannedBy")
      .populate("bannedBy", "name email")
      .sort({ bannedAt: -1 })
      .skip(skip)
      .limit(limit);

    res.status(200).json({
      success: true,
      data: {
        users: bannedUsers,
        pagination: {
          currentPage: page,
          totalPages,
          totalUsers: totalBannedUsers,
          hasNext,
          hasPrev,
          limit,
        },
      },
    });
  } catch (error) {
    console.error("Error fetching banned users:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

// Updated grantAdminRights function with tracking
exports.grantAdminRights = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Please provide an email address",
      });
    }

    // Find the user to be granted admin rights
    const userToPromote = await User.findOne({ email });

    if (!userToPromote) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Check if user is already an admin
    if (userToPromote.isAdmin) {
      return res.status(400).json({
        success: false,
        message: "User is already an admin",
      });
    }

    // Grant admin rights with tracking
    userToPromote.isAdmin = true;
    userToPromote.adminGrantedAt = new Date();
    userToPromote.adminGrantedBy = req.user.id;

    await userToPromote.save();

    res.status(200).json({
      success: true,
      message: `User ${email} has been granted admin privileges`,
      user: {
        id: userToPromote._id,
        email: userToPromote.email,
        isAdmin: true,
        adminGrantedAt: userToPromote.adminGrantedAt,
      },
    });
  } catch (error) {
    console.error("Error granting admin rights:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

// Get all banned users
exports.getBannedUsers = async (req, res) => {
  try {
    // Verify the current user is an admin
    if (!req.user.isAdmin) {
      return res.status(403).json({
        success: false,
        message: "Permission denied: Admin access required",
      });
    }

    const bannedUsers = await User.find({ isBanned: true })
      .select("name email isBanned banReason bannedAt bannedBy")
      .populate("bannedBy", "name email");

    res.status(200).json({
      success: true,
      count: bannedUsers.length,
      data: bannedUsers,
    });
  } catch (error) {
    console.error("Error fetching banned users:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

// KYC controller methods - Updated to use NIN as default
exports.createKYCLink = async (req, res) => {
  try {
    const {
      userId,
      name,
      email,
      country = "NG",
      idTypes,
      companyName,
      callbackUrl,
      expiresAt,
    } = req.body;

    console.log('🔍 API Request: POST /users/kyc/create-link');
    console.log('🔍 Origin:', req.headers.origin);
    console.log('🔍 User-Agent:', req.headers['user-agent']);
    console.log('🔍 Content-Type:', req.headers['content-type']);
    console.log('🔍 Database State:', mongoose.connection.readyState);

    // Validate required fields
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User ID is required",
      });
    }

    // Verify user exists
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Use correct supported ID types for Nigeria - UPDATED TO USE NIN
    const defaultIdTypes = [
      {
        country: "NG",
        id_type: "NIN",
        verification_method: "enhanced_kyc",
      },
    ];

    // Configure verification link
    const linkConfig = {
      name: name || `KYC Verification - ${user.name || user.email}`,
      userId: userId,
      email: email || user.email,
      country: country,
      companyName: companyName || process.env.COMPANY_NAME || "Afrimobile",
      callbackUrl: callbackUrl || `${process.env.BACKEND_URL}/api/users/kyc/webhook/smileid`,
      idTypes: idTypes || defaultIdTypes,
      partnerParams: {
        user_name: name || user.name,
        user_email: email || user.email,
        user_id: userId,
        created_by: "backend_api",
        timestamp: new Date().toISOString(),
      },
      expiresAt: expiresAt,
    };

    console.log('Creating KYC link for user:', userId, 'with ID types:', linkConfig.idTypes);

    // Create verification link - GET FRESH DATA DIRECTLY FROM SMILEID
    const smileIdResult = await smileIDService.createVerificationLink(linkConfig);
    
    // CRITICAL: Log the exact response from SmileID
    console.log('🟢 SmileID Service Result:', JSON.stringify(smileIdResult, null, 2));

    if (smileIdResult.success) {
      // CRITICAL: Use the EXACT data from SmileID response - NO MODIFICATIONS
      const responseData = {
        success: true,
        message: "KYC verification link created successfully",
        data: {
          linkId: smileIdResult.linkId,        // This MUST be the actual ref_id from SmileID
          url: smileIdResult.personalLink,     // This MUST be built with the correct linkId
          userId: smileIdResult.userId,
          expiresAt: smileIdResult.expiresAt,
          supportedIdTypes: linkConfig.idTypes,
          country: country,
        },
      };

      // CRITICAL: Log exactly what we're sending to client
      console.log('🟢 Sending to client:', JSON.stringify(responseData, null, 2));

      // DO NOT CACHE - Return fresh data directly
      return res.status(201).json(responseData);
    } else {
      console.error('🔴 SmileID API Error:', smileIdResult.error);
      return res.status(400).json({
        success: false,
        message: "Failed to create verification link",
        error: smileIdResult.error,
      });
    }
  } catch (error) {
    console.error("🔴 Create KYC Link Error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.message : "An error occurred",
    });
  }
};

// Bulk create KYC links - FIXED VERSION WITH NO CACHING - Updated to use NIN
exports.createBulkKYCLinks = async (req, res) => {
  try {
    const { links } = req.body;

    if (!links || !Array.isArray(links) || links.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Links array is required and must not be empty",
      });
    }

    if (links.length > 50) {
      return res.status(400).json({
        success: false,
        message: "Maximum 50 links can be created at once",
      });
    }

    const successful = [];
    const failed = [];

    // Default supported ID types for Nigeria - UPDATED TO USE NIN
    const defaultIdTypes = [
      {
        country: "NG",
        id_type: "NIN",
        verification_method: "enhanced_kyc",
      },
    ];

    for (const linkRequest of links) {
      try {
        const { 
          userId, 
          name, 
          email, 
          country = "NG", 
          idTypes, 
          callbackUrl 
        } = linkRequest;

        if (!userId) {
          failed.push({
            userId: userId || 'unknown',
            error: "User ID is required",
          });
          continue;
        }

        // Verify user exists
        const user = await User.findById(userId);
        if (!user) {
          failed.push({
            userId: userId,
            error: "User not found",
          });
          continue;
        }

        const linkConfig = {
          name: name || `KYC Verification - ${user.name || user.email}`,
          userId: userId,
          email: email || user.email,
          country: country,
          companyName: req.body.companyName || process.env.COMPANY_NAME || "Afrimobile",
          callbackUrl: callbackUrl || req.body.defaultCallbackUrl || `${process.env.BACKEND_URL}/api/users/kyc/webhook/smileid`,
          idTypes: idTypes || req.body.defaultIdTypes || defaultIdTypes,
          partnerParams: {
            user_name: name || user.name,
            user_email: email || user.email,
            user_id: userId,
            batch_id: req.body.batchId || Date.now(),
            created_by: "bulk_api",
          },
        };

        // Create verification link - FRESH DATA ONLY
        const smileIdResult = await smileIDService.createVerificationLink(linkConfig);

        if (smileIdResult.success) {
          successful.push({
            userId: userId,
            userName: user.name,
            userEmail: user.email,
            linkId: smileIdResult.linkId,     // EXACT data from SmileID
            url: smileIdResult.personalLink,  // EXACT data from SmileID
            expiresAt: smileIdResult.expiresAt,
          });
        } else {
          failed.push({
            userId: userId,
            userName: user.name,
            error: smileIdResult.error,
          });
        }

        // Small delay to avoid rate limiting
        await new Promise((resolve) => setTimeout(resolve, 100));
      } catch (error) {
        failed.push({
          userId: linkRequest.userId || 'unknown',
          error: error.message,
        });
      }
    }

    const summary = {
      total: links.length,
      successful: successful.length,
      failed: failed.length,
    };

    // Return fresh data - NO CACHING
    return res.status(201).json({
      success: true,
      message: `Bulk KYC links created: ${summary.successful} successful, ${summary.failed} failed`,
      data: {
        successful,
        failed,
        summary,
      },
    });
  } catch (error) {
    console.error("Create Bulk KYC Links Error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.message : "An error occurred",
    });
  }
};

// Get KYC link status - DIRECT API CALL ONLY
exports.getKYCLinkStatus = async (req, res) => {
  try {
    const { linkId } = req.params;

    if (!linkId) {
      return res.status(400).json({
        success: false,
        message: "Link ID is required",
      });
    }

    console.log('Getting KYC link status for:', linkId);

    // Get fresh data directly from SmileID - NO CACHING
    const smileIdResult = await smileIDService.getLinkInfo(linkId);

    if (smileIdResult.error) {
      console.error('Failed to get link info:', smileIdResult.error);
      return res.status(400).json({
        success: false,
        message: "Failed to get link information",
        error: smileIdResult.error,
      });
    }

    // Return fresh data directly - NO CACHING
    return res.status(200).json({
      success: true,
      message: "Link information retrieved successfully",
      data: smileIdResult,
    });
  } catch (error) {
    console.error("Get KYC Link Status Error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.message : "An error occurred",
    });
  }
};

// Handle SmileID webhook callbacks - IMPROVED VERSION
exports.handleSmileIDWebhook = async (req, res) => {
  try {
    console.log("🔔 SmileID Webhook Received:", new Date().toISOString());
    console.log("📥 Headers:", req.headers);
    console.log("📥 Raw Body:", req.body);

    const body = req.body;

    // Extract headers for signature verification
    const receivedSignature = req.headers["x-signature"] || req.headers["signature"];
    const receivedTimestamp = req.headers["x-timestamp"] || req.headers["timestamp"];

    // Verify signature (optional but recommended)
    if (receivedSignature && receivedTimestamp) {
      try {
        const isValid = smileIDService.verifyWebhookSignature(
          receivedSignature,
          receivedTimestamp,
          process.env.SMILE_PARTNER_ID,
          process.env.SMILE_API_KEY
        );

        if (!isValid) {
          console.log("❌ Invalid webhook signature");
          return res.status(401).json({ 
            success: false,
            message: "Invalid webhook signature" 
          });
        }
        console.log("✅ Webhook signature verified");
      } catch (signatureError) {
        console.error("❌ Signature verification error:", signatureError);
        // Continue without signature verification in case of errors
      }
    }

    // Extract verification result data
    const {
      job_id,
      user_id,
      job_type,
      result_type,
      result_text,
      result_code,
      confidence,
      smile_job_id,
      partner_params,
      timestamp: job_timestamp,
      id_type,
      country,
      Actions,
      ResultCode,
      ResultText,
    } = body;

    console.log("📊 Verification Result:", {
      userId: user_id,
      jobId: job_id,
      result: result_text || ResultText,
      code: result_code || ResultCode,
      confidence: confidence,
    });

    // Process verification result
    const verificationData = {
      userId: user_id,
      jobId: job_id,
      jobType: job_type,
      resultCode: result_code || ResultCode,
      resultText: result_text || ResultText,
      confidence: confidence,
      idType: id_type,
      country: country,
      timestamp: job_timestamp || new Date().toISOString(),
      fullResult: body,
    };

    // Handle different verification outcomes
    if ((result_code === "2814" || ResultCode === "2814")) {
      await handleSuccessfulVerification(verificationData);
    } else if ((result_code === "2815" || ResultCode === "2815")) {
      await handleFailedVerification(verificationData);
    } else {
      await handlePendingVerification(verificationData);
    }

    // Always respond with 200 to acknowledge receipt
    return res.status(200).json({
      success: true,
      message: "Webhook processed successfully",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("❌ Webhook processing error:", error);
    return res.status(500).json({ 
      success: false,
      message: "Webhook processing failed",
      error: process.env.NODE_ENV === "development" ? error.message : "An error occurred"
    });
  }
};

// Helper functions remain the same...
async function handleSuccessfulVerification(data) {
  console.log("✅ Processing successful verification for:", data.userId);

  try {
    const user = await User.findById(data.userId);
    if (user) {
      user.kycStatus = 'verified';
      user.isVerified = true;
      user.kycData = {
        verifiedAt: new Date(),
        verificationMethod: data.idType,
        confidence: data.confidence,
        smileJobId: data.jobId,
      };
      await user.save();
      console.log("✅ User verification status updated:", data.userId);
    }
  } catch (error) {
    console.error("Error handling successful verification:", error);
  }
}

async function handleFailedVerification(data) {
  console.log("❌ Processing failed verification for:", data.userId);

  try {
    const user = await User.findById(data.userId);
    if (user) {
      user.kycStatus = 'failed';
      user.kycData = {
        failedAt: new Date(),
        failureReason: data.resultText,
        verificationMethod: data.idType,
        smileJobId: data.jobId,
      };
      await user.save();
      console.log("❌ User verification failure updated:", data.userId);
    }
  } catch (error) {
    console.error("Error handling failed verification:", error);
  }
}

async function handlePendingVerification(data) {
  console.log("⏳ Processing pending verification for:", data.userId);

  try {
    const user = await User.findById(data.userId);
    if (user) {
      user.kycStatus = 'pending';
      user.kycData = {
        pendingAt: new Date(),
        verificationMethod: data.idType,
        smileJobId: data.jobId,
      };
      await user.save();
      console.log("⏳ User verification pending status updated:", data.userId);
    }
  } catch (error) {
    console.error("Error handling pending verification:", error);
  }
/**
 * COPY THIS ENTIRE METHOD into your controller/userController.js file
 * Add it at the END of the exports list, before module.exports (if you have one)
 * 
 * Make sure you have: const mongoose = require('mongoose');
 * at the top of your controller file
 */
}
// Get comprehensive user details by ID or username (admin only)
exports.getUserDetails = async (req, res) => {
  try {
    // Verify the current user is an admin
    if (!req.user.isAdmin) {
      return res.status(403).json({
        success: false,
        message: "Permission denied: Admin access required",
      });
    }

    const { identifier } = req.params;

    if (!identifier || identifier.trim() === "") {
      return res.status(400).json({
        success: false,
        message: "User ID or username is required",
      });
    }

    let user;

    // Try to find by ID first (if it looks like a MongoDB ObjectId)
    if (mongoose.Types.ObjectId.isValid(identifier)) {
      user = await User.findById(identifier)
        .select("-password -resetPasswordToken -resetPasswordExpire")
        .populate("bannedBy", "name email _id")
        .populate("unbannedBy", "name email _id")
        .populate("adminGrantedBy", "name email _id")
        .populate("adminRevokedBy", "name email _id");
    }

    // If not found by ID, try searching by username
    if (!user) {
      user = await User.findOne({ userName: identifier })
        .select("-password -resetPasswordToken -resetPasswordExpire")
        .populate("bannedBy", "name email _id")
        .populate("unbannedBy", "name email _id")
        .populate("adminGrantedBy", "name email _id")
        .populate("adminRevokedBy", "name email _id");
    }

    // If still not found, try by email
    if (!user) {
      user = await User.findOne({ email: identifier })
        .select("-password -resetPasswordToken -resetPasswordExpire")
        .populate("bannedBy", "name email _id")
        .populate("unbannedBy", "name email _id")
        .populate("adminGrantedBy", "name email _id")
        .populate("adminRevokedBy", "name email _id");
    }

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Build comprehensive response
    const response = {
      success: true,
      data: {
        // Basic user information
        user: {
          _id: user._id,
          name: user.name,
          email: user.email,
          userName: user.userName,
          phoneNumber: user.phoneNumber || user.phone,
          walletAddress: user.walletAddress,
          country: user.country,
          state: user.state,
          city: user.city,
          interest: user.interest,
          isAdmin: user.isAdmin,
          isBanned: user.isBanned,
          isVerified: user.isVerified,
          kycStatus: user.kycStatus || "not_started",
        },

        // Account status summary
        accountStatus: {
          isActive: !user.isBanned,
          isBanned: user.isBanned,
          isAdmin: user.isAdmin,
          isVerified: user.isVerified,
          kycStatus: user.kycStatus || "not_started",
        },

        // Ban details (if banned)
        banDetails: user.isBanned
          ? {
              isBanned: true,
              banReason: user.banReason || "Not specified",
              bannedAt: user.bannedAt,
              bannedBy: user.bannedBy || null,
              unbannedAt: user.unbannedAt || null,
              unbannedBy: user.unbannedBy || null,
            }
          : null,

        // Admin details
        adminDetails: {
          isAdmin: user.isAdmin,
          adminGrantedAt: user.adminGrantedAt || null,
          adminGrantedBy: user.adminGrantedBy || null,
          adminRevokedAt: user.adminRevokedAt || null,
          adminRevokedBy: user.adminRevokedBy || null,
        },

        // KYC details
        kycDetails: {
          kycStatus: user.kycStatus || "not_started",
          verifiedAt:
            user.kycData && user.kycData.verifiedAt
              ? user.kycData.verifiedAt
              : null,
          verificationMethod:
            user.kycData && user.kycData.verificationMethod
              ? user.kycData.verificationMethod
              : null,
          confidence:
            user.kycData && user.kycData.confidence
              ? user.kycData.confidence
              : null,
          failureReason:
            user.kycData && user.kycData.failureReason
              ? user.kycData.failureReason
              : null,
          smileJobId:
            user.kycData && user.kycData.smileJobId
              ? user.kycData.smileJobId
              : null,
          fullKycData: user.kycData || null,
        },

        // Referral information
        referralInfo: user.referralInfo || null,

        // Contact information
        contactInformation: {
          email: user.email,
          phoneNumber: user.phoneNumber || user.phone || null,
          walletAddress: user.walletAddress || null,
          country: user.country || null,
          state: user.state || null,
          city: user.city || null,
        },

        // Timestamps
        timestamps: {
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
          lastLoginAt: user.lastLoginAt || null,
        },

        // Additional metadata
        metadata: {
          referralCode: user.referralCode || null,
          countryCode: user.countryCode || null,
          stateCode: user.stateCode || null,
        },
      },
    };

    res.status(200).json(response);
  } catch (error) {
    console.error("Error fetching user details:", error);

    // Handle invalid ObjectId format
    if (error.name === "CastError") {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID format",
      });
    }

    res.status(500).json({
      success: false,
      message: "Internal server error",
      error:
        process.env.NODE_ENV === "development" ? error.message : "An error occurred",
    });
  }
};