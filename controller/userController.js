// controller/userController.js
const User = require("../models/User");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
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

// Create KYC verification link for user
exports.createKYCLink = async (req, res) => {
  try {
    const {
      userId,
      name,
      email,
      idTypes,
      companyName,
      callbackUrl,
      expiresAt,
    } = req.body;

    // Validate required fields
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User ID is required",
      });
    }

    // Configure verification link
    const linkConfig = {
      name: name || `KYC Verification - ${userId}`,
      userId: userId,
      companyName: companyName,
      callbackUrl: callbackUrl,
      idTypes: idTypes || [
        {
          country: "NG",
          id_type: "BVN",
          verification_method: "biometric_kyc",
        },
        {
          country: "NG",
          id_type: "IDENTITY_CARD",
          verification_method: "biometric_kyc",
        },
      ],
      partnerParams: {
        user_name: name,
        user_email: email,
        created_by: "backend_api",
        timestamp: new Date().toISOString(),
      },
      expiresAt: expiresAt,
    };

    // Create verification link
    const result = await smileIDService.createVerificationLink(linkConfig);

    if (result.success) {
      // TODO: Save link details to your database
      // await saveVerificationLinkToDatabase({
      //   userId: result.userId,
      //   linkId: result.linkId,
      //   personalLink: result.personalLink,
      //   expiresAt: result.expiresAt,
      //   status: 'pending'
      // });

      res.status(201).json({
        success: true,
        message: "KYC verification link created successfully",
        data: {
          linkId: result.linkId,
          verificationLink: result.personalLink,
          userId: result.userId,
          expiresAt: result.expiresAt,
        },
      });
    } else {
      res.status(400).json({
        success: false,
        message: "Failed to create verification link",
        error: result.error,
      });
    }
  } catch (error) {
    console.error("Create KYC Link Error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// Handle SmileID webhook callbacks
exports.handleSmileIDWebhook = async (req, res) => {
  try {
    console.log("🔔 SmileID Webhook Received:", new Date().toISOString());

    const body = req.body;

    // Extract headers for signature verification
    const receivedSignature =
      req.headers["x-signature"] || req.headers["signature"];
    const receivedTimestamp =
      req.headers["x-timestamp"] || req.headers["timestamp"];

    // Verify signature (optional but recommended)
    if (receivedSignature && receivedTimestamp) {
      const isValid = smileIDService.verifyWebhookSignature(
        receivedSignature,
        receivedTimestamp,
        process.env.SMILE_PARTNER_ID,
        process.env.SMILE_API_KEY
      );

      if (!isValid) {
        console.log("❌ Invalid webhook signature");
        return res.status(401).json({ error: "Invalid signature" });
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
    if (result_code === "2814" || ResultCode === "2814") {
      // Verification successful
      await handleSuccessfulVerification(verificationData);
    } else if (result_code === "2815" || ResultCode === "2815") {
      // Verification failed
      await handleFailedVerification(verificationData);
    } else {
      // Other status (pending, review, etc.)
      await handlePendingVerification(verificationData);
    }

    // Always respond with 200 to acknowledge receipt
    res.status(200).json({
      status: "received",
      message: "Webhook processed successfully",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("❌ Webhook processing error:", error);
    res.status(500).json({ error: "Webhook processing failed" });
  }
};

// Get KYC link status
exports.getKYCLinkStatus = async (req, res) => {
  try {
    const { linkId } = req.params;

    if (!linkId) {
      return res.status(400).json({
        success: false,
        message: "Link ID is required",
      });
    }

    const result = await smileIDService.getLinkInfo(linkId);

    if (result.error) {
      return res.status(400).json({
        success: false,
        message: "Failed to get link information",
        error: result.error,
      });
    }

    res.status(200).json({
      success: true,
      message: "Link information retrieved successfully",
      data: result,
    });
  } catch (error) {
    console.error("Get KYC Link Status Error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// Helper functions for handling verification outcomes
async function handleSuccessfulVerification(data) {
  console.log("✅ Processing successful verification for:", data.userId);

  try {
    // TODO: Update user verification status in database
    // await updateUserVerificationStatus(data.userId, 'verified', data);

    // TODO: Send success notification to user
    // await sendVerificationSuccessNotification(data.userId);

    // TODO: Enable verified user features
    // await enableVerifiedUserFeatures(data.userId);

    console.log("✅ User verification completed:", data.userId);
  } catch (error) {
    console.error("Error handling successful verification:", error);
  }
}

async function handleFailedVerification(data) {
  console.log("❌ Processing failed verification for:", data.userId);

  try {
    // TODO: Update user verification status in database
    // await updateUserVerificationStatus(data.userId, 'failed', data);

    // TODO: Send failure notification with retry instructions
    // await sendVerificationFailedNotification(data.userId, data.resultText);

    // TODO: Log failure reason for analysis
    // await logVerificationFailure(data);

    console.log(
      "❌ Verification failed for:",
      data.userId,
      "Reason:",
      data.resultText
    );
  } catch (error) {
    console.error("Error handling failed verification:", error);
  }
}

async function handlePendingVerification(data) {
  console.log("⏳ Processing pending verification for:", data.userId);

  try {
    // TODO: Update user verification status in database
    // await updateUserVerificationStatus(data.userId, 'pending', data);

    // TODO: Send pending notification to user
    // await sendVerificationPendingNotification(data.userId);

    console.log("⏳ Verification pending for:", data.userId);
  } catch (error) {
    console.error("Error handling pending verification:", error);
  }
}

// Bulk create KYC links
exports.createBulkKYCLinks = async (req, res) => {
  try {
    const { users } = req.body;

    if (!users || !Array.isArray(users) || users.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Users array is required",
      });
    }

    const results = [];

    for (const user of users) {
      const linkConfig = {
        name: `KYC Verification - ${user.name || user.userId}`,
        userId: user.userId,
        companyName: user.companyName,
        callbackUrl: user.callbackUrl,
        idTypes: user.idTypes,
        partnerParams: {
          user_name: user.name,
          user_email: user.email,
          batch_id: req.body.batchId || Date.now(),
          created_by: "bulk_api",
        },
      };

      const result = await smileIDService.createVerificationLink(linkConfig);
      results.push({
        userId: user.userId,
        userName: user.name,
        ...result,
      });

      // Small delay to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    const successful = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    res.status(201).json({
      success: true,
      message: `Bulk KYC links created: ${successful} successful, ${failed} failed`,
      summary: { successful, failed, total: results.length },
      data: results,
    });
  } catch (error) {
    console.error("Create Bulk KYC Links Error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};
