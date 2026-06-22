// controller/executiveController.js
const crypto = require('crypto');
const mongoose = require('mongoose');
const Executive = require('../models/Executive');
const User = require('../models/User');
const UserShare = require('../models/UserShare');
const CoFounderShare = require('../models/CoFounderShare');
const { sendEmail } = require('../utils/emailService');
const {
  sharePaymentUpload,
  logCloudinaryUpload,
  handleCloudinaryError
} = require('../config/cloudinary');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Generate a unique 8-char alphanumeric activation code */
function generateActivationCode() {
  return crypto.randomBytes(4).toString('hex').toUpperCase();
}

/**
 * Compute share metrics for a user from the new % / ownership model.
 *
 * Returns:
 *   { regularOwnershipPct, cofounderOwnershipPct, totalOwnershipPct,
 *     regularEarningKobo, cofounderEarningKobo, totalEarningKobo,
 *     regularShares, coFounderShares }
 *
 * "shares" here are kept for legacy counting but the primary metrics
 * are ownership percentages (stored as decimals, e.g. 0.000042).
 */
async function computeShareInfo(userId) {
  const result = {
    regularOwnershipPct: 0,
    cofounderOwnershipPct: 0,
    totalOwnershipPct: 0,
    regularEarningKobo: 0,
    cofounderEarningKobo: 0,
    totalEarningKobo: 0,
    regularShares: 0,
    coFounderShares: 0
  };

  try {
    // Try the V2 snapshot first (the preferred source after the % migration)
    const UserShareV2 = require('../models/UserShareV2');
    const snapshot = await UserShareV2.findOne({ user: userId }).lean();

    if (snapshot) {
      result.regularOwnershipPct   = snapshot.regularOwnershipPct   || 0;
      result.cofounderOwnershipPct = snapshot.cofounderOwnershipPct || 0;
      result.totalOwnershipPct     = snapshot.totalOwnershipPct     || 0;
      result.totalEarningKobo      = snapshot.totalEarningKobo      || 0;

      // Best-effort legacy counts from V1 for display purposes
      const userShares = await UserShare.findOne({ user: userId }).lean();
      if (userShares) {
        (userShares.transactions || []).forEach(t => {
          if (t.status === 'completed') {
            if (t.paymentMethod === 'co-founder') {
              result.coFounderShares += t.coFounderShares || t.shares || 0;
            } else {
              result.regularShares += t.shares || 0;
            }
          }
        });
      }

      return result;
    }

    // Fallback: derive everything from the legacy UserShare model
    const userShares = await UserShare.findOne({ user: userId }).lean();
    if (!userShares) return result;

    const coFounderConfig   = await CoFounderShare.findOne().lean();
    const shareToRegularRatio = coFounderConfig?.shareToRegularRatio || 29;

    let regularOwnershipPct   = 0;
    let cofounderOwnershipPct = 0;
    let regularEarningKobo    = 0;
    let cofounderEarningKobo  = 0;
    let regularShares         = 0;
    let coFounderShares       = 0;

    (userShares.transactions || []).forEach(t => {
      if (t.status !== 'completed') return;
      if (t.paymentMethod === 'co-founder') {
        const qty = t.coFounderShares || t.shares || 0;
        coFounderShares       += qty;
        cofounderOwnershipPct += t.percentPerShare || t.ownershipPct || 0;
        cofounderEarningKobo  += t.earningKobo || 0;
      } else {
        regularShares         += t.shares || 0;
        regularOwnershipPct   += t.percentPerShare || t.ownershipPct || 0;
        regularEarningKobo    += t.earningKobo || 0;
      }
    });

    result.regularOwnershipPct   = regularOwnershipPct;
    result.cofounderOwnershipPct = cofounderOwnershipPct;
    result.totalOwnershipPct     = regularOwnershipPct + cofounderOwnershipPct;
    result.regularEarningKobo    = regularEarningKobo;
    result.cofounderEarningKobo  = cofounderEarningKobo;
    result.totalEarningKobo      = regularEarningKobo + cofounderEarningKobo;
    result.regularShares         = regularShares;
    result.coFounderShares       = coFounderShares;

  } catch (err) {
    console.warn('[EXECUTIVE] computeShareInfo error:', err.message);
  }

  return result;
}

/** Check admin status from the request */
async function requireAdmin(req, res) {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ 
        success: false, 
        message: 'Unauthorized: User not authenticated' 
      });
    }

    const admin = await User.findById(req.user.id).lean();
    if (!admin || !admin.isAdmin) {
      return res.status(403).json({ 
        success: false, 
        message: 'Unauthorized: Admin access required' 
      });
    }
    return admin;
  } catch (error) {
    console.error('[EXECUTIVE] Admin check error:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Failed to verify admin status' 
    });
  }
}

/** Validate MongoDB ObjectId */
function isValidObjectId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

/**
 * Generate a unique activation code with retry mechanism
 * @param {number} maxAttempts - Maximum attempts to generate unique code
 * @returns {Promise<string>} - Unique activation code
 */
async function generateUniqueActivationCode(maxAttempts = 10) {
  let code;
  let exists = true;
  let attempts = 0;
  
  while (exists && attempts < maxAttempts) {
    code = generateActivationCode();
    exists = await Executive.exists({ activationCode: code });
    attempts++;
  }
  
  if (exists) {
    throw new Error('Failed to generate unique activation code after ' + maxAttempts + ' attempts');
  }
  
  return code;
}

// ---------------------------------------------------------------------------
// ADMIN — Activation Code Management
// ---------------------------------------------------------------------------

/**
 * @desc    Admin: Generate activation code (UNLIMITED)
 * @route   POST /api/executives/admin/generate-code
 * @access  Private (Admin)
 */
exports.generateActivationCode = async (req, res) => {
  try {
    // Check admin status
    const admin = await User.findById(req.user.id).lean();
    if (!admin || !admin.isAdmin) {
      return res.status(403).json({ 
        success: false, 
        message: 'Unauthorized: Admin access required' 
      });
    }

    const adminId = req.user.id;
    const { userId, note } = req.body;

    // Validate userId if provided
    if (userId && !isValidObjectId(userId)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid user ID format' 
      });
    }

    // Check if user exists if userId provided
    if (userId) {
      const userExists = await User.findById(userId).lean();
      if (!userExists) {
        return res.status(404).json({ 
          success: false, 
          message: 'User not found with the provided ID' 
        });
      }
    }

    // NO LIMITS - Generate unique code with retry
    let code;
    let exists = true;
    let attempts = 0;
    const maxAttempts = 20; // Keep retry for uniqueness, but no daily limits
    
    while (exists && attempts < maxAttempts) {
      code = crypto.randomBytes(4).toString('hex').toUpperCase();
      exists = await Executive.exists({ activationCode: code });
      attempts++;
    }
    
    if (exists) {
      return res.status(500).json({
        success: false,
        message: 'Failed to generate unique code after multiple attempts'
      });
    }

    // Create executive document
    const execDoc = new Executive({
      activationCode: code,
      codeGeneratedBy: adminId,
      codeGeneratedAt: new Date(),
      status: 'pending',
      adminNote: note || null,
      ...(userId && { userId })
    });

    await execDoc.save();

    console.log('[EXECUTIVE] Activation code generated:', code, 'by admin:', adminId);

    return res.status(201).json({
      success: true,
      message: 'Activation code generated successfully',
      code,
      executiveId: execDoc._id,
      userId: userId || null
    });
  } catch (error) {
    console.error('[EXECUTIVE] Error generating code:', {
      message: error.message,
      stack: error.stack,
      code: error.code,
      name: error.name
    });

    // Handle duplicate key error
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'Duplicate code generated, please try again'
      });
    }

    // Handle validation errors
    if (error.name === 'ValidationError') {
      const errors = Object.values(error.errors).map(e => e.message);
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors
      });
    }

    const errorMessage = process.env.NODE_ENV === 'development' 
      ? error.message 
      : 'Failed to generate activation code';
    
    return res.status(500).json({ 
      success: false, 
      message: errorMessage,
      ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
    });
  }
};

/**
 * @desc    Admin: List all generated codes
 * @route   GET /api/executives/admin/codes
 * @access  Private (Admin)
 */
exports.listActivationCodes = async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const { page = 1, limit = 50, redeemed, search } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const limitNum = Math.min(parseInt(limit), 100);

    const query = { activationCode: { $exists: true, $ne: null } };
    if (redeemed === 'true') query.codeRedeemedAt = { $exists: true };
    if (redeemed === 'false') query.codeRedeemedAt = { $exists: false };

    // Build search query
    if (search) {
      const searchRegex = new RegExp(search, 'i');
      query.$or = [
        { activationCode: searchRegex },
        { 'location.country': searchRegex },
        { 'location.state': searchRegex }
      ];
    }

    const [codes, totalCount] = await Promise.all([
      Executive.find(query)
        .populate('userId', 'name email userName')
        .populate('codeGeneratedBy', 'name email')
        .select('activationCode userId codeGeneratedBy codeGeneratedAt codeRedeemedAt status location.country location.state adminNote')
        .sort({ codeGeneratedAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Executive.countDocuments(query)
    ]);

    return res.status(200).json({
      success: true,
      codes,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalCount / limitNum),
        totalCount,
        limit: limitNum
      }
    });
  } catch (error) {
    console.error('[EXECUTIVE] Error listing codes:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Failed to list activation codes',
      ...(process.env.NODE_ENV === 'development' && { error: error.message })
    });
  }
};

/**
 * @desc    Admin: Revoke (delete) an unused activation code
 * @route   DELETE /api/executives/admin/codes/:code
 * @access  Private (Admin)
 */
exports.revokeActivationCode = async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const { code } = req.params;

    if (!code) {
      return res.status(400).json({ 
        success: false, 
        message: 'Code parameter is required' 
      });
    }

    const execDoc = await Executive.findOne({ 
      activationCode: code.toUpperCase().trim() 
    });
    
    if (!execDoc) {
      return res.status(404).json({ 
        success: false, 
        message: 'Activation code not found' 
      });
    }
    
    if (execDoc.codeRedeemedAt) {
      return res.status(400).json({ 
        success: false, 
        message: 'Cannot revoke a code that has already been redeemed' 
      });
    }

    await Executive.deleteOne({ _id: execDoc._id });

    console.log('[EXECUTIVE] Activation code revoked:', code, 'by admin:', req.user.id);
    return res.status(200).json({ 
      success: true, 
      message: 'Activation code revoked successfully' 
    });
  } catch (error) {
    console.error('[EXECUTIVE] Error revoking code:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Failed to revoke activation code',
      ...(process.env.NODE_ENV === 'development' && { error: error.message })
    });
  }
};

/**
 * @desc    Admin: Get code statistics
 * @route   GET /api/executives/admin/codes/stats
 * @access  Private (Admin)
 */
exports.getCodeStatistics = async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const [total, redeemed, pending] = await Promise.all([
      Executive.countDocuments({ activationCode: { $exists: true, $ne: null } }),
      Executive.countDocuments({ 
        activationCode: { $exists: true, $ne: null },
        codeRedeemedAt: { $exists: true } 
      }),
      Executive.countDocuments({ 
        activationCode: { $exists: true, $ne: null },
        codeRedeemedAt: { $exists: false } 
      })
    ]);

    return res.status(200).json({
      success: true,
      statistics: {
        total,
        redeemed,
        pending,
        usageRate: total > 0 ? (redeemed / total) * 100 : 0
      }
    });
  } catch (error) {
    console.error('[EXECUTIVE] Error getting code stats:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get code statistics'
    });
  }
};

// ---------------------------------------------------------------------------
// USER — Activation Code Flow
// ---------------------------------------------------------------------------

/**
 * @desc    User: Redeem activation code
 * @route   POST /api/executives/redeem
 * @access  Private (User)
 */
exports.redeemActivationCode = async (req, res) => {
  try {
    const userId = req.user.id;
    const { code } = req.body;

    if (!code) {
      return res.status(400).json({ 
        success: false, 
        message: 'Activation code is required' 
      });
    }

    // Check if user already has an executive record (active/approved)
    const existingExec = await Executive.findOne({ 
      userId, 
      status: 'approved',
      codeRedeemedAt: { $exists: true } 
    });
    
    if (existingExec) {
      return res.status(400).json({ 
        success: false, 
        message: 'You already have an approved executive record. You cannot redeem more codes.' 
      });
    }

    // REMOVED: The check for pending codes - allows multiple redemptions
    // if (pendingCode) {
    //   return res.status(400).json({
    //     success: false,
    //     message: 'You already have a pending activation code',
    //     code: pendingCode.activationCode
    //   });
    // }

    const execDoc = await Executive.findOne({ 
      activationCode: code.toUpperCase().trim() 
    });
    
    if (!execDoc) {
      return res.status(404).json({ 
        success: false, 
        message: 'Invalid activation code' 
      });
    }
    
    if (execDoc.codeRedeemedAt) {
      return res.status(400).json({ 
        success: false, 
        message: 'This code has already been redeemed' 
      });
    }
    
    if (execDoc.userId && execDoc.userId.toString() !== userId) {
      return res.status(403).json({ 
        success: false, 
        message: 'This code is assigned to a different user' 
      });
    }

    // Redeem the code
    execDoc.userId = userId;
    execDoc.codeRedeemedAt = new Date();
    execDoc.status = 'pending';
    await execDoc.save();

    console.log('[EXECUTIVE] Code redeemed:', code, 'by user:', userId);

    return res.status(200).json({
      success: true,
      message: 'Activation code redeemed successfully. Please complete your profile.',
      executiveId: execDoc._id
    });
  } catch (error) {
    console.error('[EXECUTIVE] Error redeeming code:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Failed to redeem activation code',
      ...(process.env.NODE_ENV === 'development' && { error: error.message })
    });
  }
};

/**
 * @desc    Admin: Generate multiple activation codes at once
 * @route   POST /api/executives/admin/generate-codes-bulk
 * @access  Private (Admin)
 */
exports.generateMultipleActivationCodes = async (req, res) => {
  try {
    // Check admin status
    const admin = await User.findById(req.user.id).lean();
    if (!admin || !admin.isAdmin) {
      return res.status(403).json({ 
        success: false, 
        message: 'Unauthorized: Admin access required' 
      });
    }

    const adminId = req.user.id;
    const { count = 1, userId, note } = req.body;

    // Limit count to prevent abuse (optional - remove if you want truly unlimited)
    const numberOfCodes = Math.min(parseInt(count), 1000);

    // Validate userId if provided
    if (userId && !isValidObjectId(userId)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid user ID format' 
      });
    }

    // Check if user exists if userId provided
    if (userId) {
      const userExists = await User.findById(userId).lean();
      if (!userExists) {
        return res.status(404).json({ 
          success: false, 
          message: 'User not found with the provided ID' 
        });
      }
    }

    const generatedCodes = [];
    const errors = [];

    // Generate multiple codes
    for (let i = 0; i < numberOfCodes; i++) {
      try {
        let code;
        let exists = true;
        let attempts = 0;
        const maxAttempts = 20;
        
        while (exists && attempts < maxAttempts) {
          code = crypto.randomBytes(4).toString('hex').toUpperCase();
          exists = await Executive.exists({ activationCode: code });
          attempts++;
        }
        
        if (exists) {
          errors.push(`Failed to generate unique code for index ${i}`);
          continue;
        }

        const execDoc = new Executive({
          activationCode: code,
          codeGeneratedBy: adminId,
          codeGeneratedAt: new Date(),
          status: 'pending',
          adminNote: note || null,
          ...(userId && { userId })
        });

        await execDoc.save();
        generatedCodes.push({
          code,
          executiveId: execDoc._id
        });

      } catch (error) {
        errors.push(`Error generating code ${i + 1}: ${error.message}`);
      }
    }

    console.log('[EXECUTIVE] Generated', generatedCodes.length, 'activation codes by admin:', adminId);

    return res.status(201).json({
      success: true,
      message: `Generated ${generatedCodes.length} activation codes successfully`,
      totalRequested: numberOfCodes,
      generated: generatedCodes.length,
      errors: errors.length > 0 ? errors : undefined,
      codes: generatedCodes,
      userId: userId || null
    });
  } catch (error) {
    console.error('[EXECUTIVE] Error generating codes in bulk:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to generate activation codes',
      ...(process.env.NODE_ENV === 'development' && { error: error.message })
    });
  }
};

/**
 * @desc    User: Complete executive profile after redeeming code
 * @route   PUT /api/executives/complete-profile
 * @access  Private (User)
 */
exports.completeProfile = async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      country, state, city, address, phone, alternativePhone,
      email, alternativeEmail, bio, expertise,
      linkedin, twitter, facebook, instagram,
      profileImage, latitude, longitude
    } = req.body;

    // Validate required fields
    const requiredFields = { country, state, city, address, phone, email, profileImage };
    const missingFields = Object.entries(requiredFields)
      .filter(([_, value]) => !value)
      .map(([key]) => key);

    if (missingFields.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Please provide all required fields: ${missingFields.join(', ')}`
      });
    }

    const execDoc = await Executive.findOne({ 
      userId, 
      codeRedeemedAt: { $exists: true } 
    });
    
    if (!execDoc) {
      return res.status(404).json({
        success: false,
        message: 'No redeemed activation code found. Please redeem a code first.'
      });
    }

    // Check if profile is already completed
    if (execDoc.isVerified && execDoc.status === 'approved') {
      return res.status(400).json({
        success: false,
        message: 'Your executive profile is already completed and approved'
      });
    }

    // Compute share info
    const shareInfo = await computeShareInfo(userId);

    // Update executive document
    execDoc.profileImage = profileImage;
    execDoc.location = {
      country,
      state,
      city,
      address,
      coordinates: { 
        latitude: latitude || null, 
        longitude: longitude || null 
      }
    };
    execDoc.contactInfo = {
      phone,
      alternativePhone: alternativePhone || null,
      email,
      alternativeEmail: alternativeEmail || null
    };
    execDoc.shareInfo = {
      totalOwnershipPct: shareInfo.totalOwnershipPct,
      regularOwnershipPct: shareInfo.regularOwnershipPct,
      cofounderOwnershipPct: shareInfo.cofounderOwnershipPct,
      totalEarningKobo: shareInfo.totalEarningKobo,
      regularShares: shareInfo.regularShares,
      coFounderShares: shareInfo.coFounderShares,
      verifiedAt: new Date()
    };
    execDoc.bio = bio || null;
    execDoc.expertise = expertise || [];
    execDoc.socialMedia = {
      linkedin: linkedin || null,
      twitter: twitter || null,
      facebook: facebook || null,
      instagram: instagram || null
    };
    execDoc.linkedin = linkedin || null;
    execDoc.twitter = twitter || null;
    execDoc.status = 'approved';
    execDoc.isVerified = true;
    execDoc.approvalInfo = {
      approvedAt: new Date(),
      adminNotes: 'Auto-approved via activation code'
    };

    await execDoc.save();

    console.log('[EXECUTIVE] Profile completed for user:', userId);

    // Send welcome email
    const user = await User.findById(userId);
    if (user?.email) {
      try {
        await sendEmail({
          email: user.email,
          subject: 'AfriMobile - Welcome, Executive!',
          html: `
            <h2>Welcome to the AfriMobile Executive Team!</h2>
            <p>Dear ${user.name},</p>
            <p>Your executive profile has been activated. You are now an AfriMobile Executive!</p>
            <p><strong>Details:</strong></p>
            <ul>
              <li>Location: ${city}, ${state}, ${country}</li>
              <li>Total Ownership: ${(shareInfo.totalOwnershipPct * 100).toFixed(6)}%</li>
            </ul>
            <p>Best regards,<br>AfriMobile Team</p>
          `
        });
      } catch (emailError) {
        console.error('[EXECUTIVE] Failed to send welcome email:', emailError);
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Executive profile completed successfully!',
      application: execDoc
    });
  } catch (error) {
    console.error('[EXECUTIVE] Error completing profile:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Failed to complete executive profile',
      ...(process.env.NODE_ENV === 'development' && { error: error.message })
    });
  }
};

// ---------------------------------------------------------------------------
// USER — Image Upload
// ---------------------------------------------------------------------------

/**
 * @desc    Upload executive profile image
 * @route   POST /api/executives/upload-image
 * @access  Private (User)
 */
exports.uploadExecutiveImage = async (req, res) => {
  try {
    const userId = req.user.id;

    if (!req.file) {
      return res.status(400).json({ 
        success: false, 
        message: 'No image file provided' 
      });
    }
    
    if (!req.file.mimetype || !req.file.mimetype.startsWith('image/')) {
      return res.status(400).json({ 
        success: false, 
        message: 'File must be an image' 
      });
    }
    
    if (req.file.size > 5 * 1024 * 1024) {
      return res.status(400).json({ 
        success: false, 
        message: 'Image size must be less than 5MB' 
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: 'User not found' 
      });
    }

    const result = await sharePaymentUpload(
      req.file.buffer,
      `executives/${userId}`,
      req.file.originalname
    );

    logCloudinaryUpload(userId, result.secure_url, 'executive_profile');

    return res.status(200).json({
      success: true,
      message: 'Image uploaded successfully',
      imageUrl: result.secure_url,
      publicId: result.public_id
    });
  } catch (error) {
    console.error('[EXECUTIVE IMAGE] Upload error:', error);
    handleCloudinaryError(error);
    return res.status(500).json({
      success: false,
      message: 'Failed to upload image',
      ...(process.env.NODE_ENV === 'development' && { error: error.message })
    });
  }
};

// ---------------------------------------------------------------------------
// USER — Legacy Apply Flow
// ---------------------------------------------------------------------------

/**
 * @desc    Apply to become an executive (legacy / self-service flow)
 * @route   POST /api/executives/apply
 * @access  Private (User with shares)
 */
exports.applyAsExecutive = async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      country, state, city, address, phone, alternativePhone,
      email, alternativeEmail, bio, expertise,
      linkedin, twitter, latitude, longitude, profileImage
    } = req.body;

    // Validate required fields
    const requiredFields = { country, state, city, address, phone, email, profileImage };
    const missingFields = Object.entries(requiredFields)
      .filter(([_, value]) => !value)
      .map(([key]) => key);

    if (missingFields.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Please provide all required fields: ${missingFields.join(', ')}`
      });
    }

    // Check for existing application
    const existingApplication = await Executive.findOne({ userId });
    if (existingApplication) {
      if (existingApplication.status === 'pending') {
        return res.status(400).json({ 
          success: false, 
          message: 'You already have a pending executive application' 
        });
      }
      if (existingApplication.status === 'approved') {
        return res.status(400).json({ 
          success: false, 
          message: 'You are already an approved executive' 
        });
      }
      if (existingApplication.status === 'rejected') {
        await Executive.deleteOne({ _id: existingApplication._id });
      }
    }

    // Must own shares
    const userShares = await UserShare.findOne({ user: userId });
    if (!userShares || userShares.totalShares === 0) {
      return res.status(403).json({
        success: false,
        message: 'You must own shares to apply as an executive'
      });
    }

    // Compute share info
    const shareInfo = await computeShareInfo(userId);

    if (shareInfo.totalOwnershipPct <= 0) {
      return res.status(403).json({
        success: false,
        message: 'You must have a completed share purchase to apply as an executive'
      });
    }

    const executiveApplication = new Executive({
      userId,
      profileImage,
      location: {
        country,
        state,
        city,
        address,
        coordinates: { 
          latitude: latitude || null, 
          longitude: longitude || null 
        }
      },
      contactInfo: {
        phone,
        alternativePhone: alternativePhone || null,
        email,
        alternativeEmail: alternativeEmail || null
      },
      shareInfo: {
        totalOwnershipPct: shareInfo.totalOwnershipPct,
        regularOwnershipPct: shareInfo.regularOwnershipPct,
        cofounderOwnershipPct: shareInfo.cofounderOwnershipPct,
        totalEarningKobo: shareInfo.totalEarningKobo,
        regularShares: shareInfo.regularShares,
        coFounderShares: shareInfo.coFounderShares,
        verifiedAt: new Date()
      },
      bio: bio || null,
      expertise: expertise || [],
      socialMedia: {
        linkedin: linkedin || null,
        twitter: twitter || null
      },
      status: 'pending'
    });

    await executiveApplication.save();

    const user = await User.findById(userId);

    // Send confirmation email to user
    if (user?.email) {
      try {
        await sendEmail({
          email: user.email,
          subject: 'AfriMobile - Executive Application Received',
          html: `
            <h2>Executive Application Submitted</h2>
            <p>Dear ${user.name},</p>
            <p>Thank you for applying to become an AfriMobile Executive.</p>
            <p><strong>Application Details:</strong></p>
            <ul>
              <li>Total Ownership: ${(shareInfo.totalOwnershipPct * 100).toFixed(6)}%</li>
              <li>Location: ${city}, ${state}, ${country}</li>
              <li>Status: Pending Admin Review</li>
            </ul>
            <p>Our team will review your application and get back to you soon.</p>
            <p>Best regards,<br>AfriMobile Team</p>
          `
        });
      } catch (e) {
        console.error('[EXECUTIVE] Failed to send confirmation email:', e);
      }
    }

    // Send notification to admin
    const adminEmail = process.env.ADMIN_EMAIL;
    if (adminEmail) {
      try {
        await sendEmail({
          email: adminEmail,
          subject: 'New Executive Application',
          html: `
            <h2>New Executive Application</h2>
            <ul>
              <li>User: ${user?.name || 'Unknown'} (${user?.email || 'No email'})</li>
              <li>Ownership: ${(shareInfo.totalOwnershipPct * 100).toFixed(6)}%</li>
              <li>Location: ${city}, ${state}, ${country}</li>
              <li>Phone: ${phone}</li>
            </ul>
            <p>Please review in the admin dashboard.</p>
          `
        });
      } catch (e) {
        console.error('[EXECUTIVE] Failed to send admin notification:', e);
      }
    }

    return res.status(201).json({
      success: true,
      message: 'Executive application submitted successfully',
      application: executiveApplication
    });
  } catch (error) {
    console.error('[EXECUTIVE] Error in applyAsExecutive:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to submit executive application',
      ...(process.env.NODE_ENV === 'development' && { error: error.message })
    });
  }
};

// ---------------------------------------------------------------------------
// USER — Read / Update
// ---------------------------------------------------------------------------

/**
 * @desc    Get user's executive status/application
 * @route   GET /api/executives/my-application
 * @access  Private (User)
 */
exports.getMyExecutiveApplication = async (req, res) => {
  try {
    const application = await Executive.findOne({ userId: req.user.id })
      .populate('approvalInfo.approvedBy', 'name email')
      .populate('approvalInfo.rejectedBy', 'name email');

    if (!application) {
      return res.status(404).json({ 
        success: false, 
        message: 'No executive application found' 
      });
    }

    return res.status(200).json({ 
      success: true, 
      application 
    });
  } catch (error) {
    console.error('[EXECUTIVE] Error in getMyExecutiveApplication:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch executive application',
      ...(process.env.NODE_ENV === 'development' && { error: error.message })
    });
  }
};

/**
 * @desc    Update executive information (self)
 * @route   PUT /api/executives/update
 * @access  Private (Approved Executive)
 */
exports.updateExecutiveInfo = async (req, res) => {
  try {
    const executive = await Executive.findOne({
      userId: req.user.id,
      status: { $in: ['approved', 'pending'] }
    });

    if (!executive) {
      return res.status(404).json({ 
        success: false, 
        message: 'Executive profile not found or not approved' 
      });
    }

    const {
      phone, alternativePhone, email, alternativeEmail,
      address, bio, expertise, linkedin, twitter, profileImage
    } = req.body;

    // Update fields if provided
    if (phone) executive.contactInfo.phone = phone;
    if (alternativePhone !== undefined) executive.contactInfo.alternativePhone = alternativePhone;
    if (email) executive.contactInfo.email = email;
    if (alternativeEmail !== undefined) executive.contactInfo.alternativeEmail = alternativeEmail;
    if (address) executive.location.address = address;
    if (bio !== undefined) executive.bio = bio;
    if (expertise) executive.expertise = expertise;
    if (linkedin !== undefined) executive.socialMedia.linkedin = linkedin;
    if (twitter !== undefined) executive.socialMedia.twitter = twitter;
    if (profileImage) executive.profileImage = profileImage;

    await executive.save();

    return res.status(200).json({
      success: true,
      message: 'Executive information updated successfully',
      application: executive
    });
  } catch (error) {
    console.error('[EXECUTIVE] Error in updateExecutiveInfo:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update executive information',
      ...(process.env.NODE_ENV === 'development' && { error: error.message })
    });
  }
};

// ---------------------------------------------------------------------------
// PUBLIC — Browse Executives
// ---------------------------------------------------------------------------

/**
 * @desc    Get all approved executives
 * @route   GET /api/executives/approved
 * @access  Public
 */
exports.getApprovedExecutives = async (req, res) => {
  try {
    const { country, state, page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const limitNum = Math.min(parseInt(limit), 50);

    const query = { status: 'approved' };
    if (country) query['location.country'] = country;
    if (state) query['location.state'] = state;

    const [executives, totalCount] = await Promise.all([
      Executive.find(query)
        .populate('userId', 'name email userName')
        .select('-approvalInfo -suspension')
        .sort({ 'shareInfo.totalOwnershipPct': -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Executive.countDocuments(query)
    ]);

    return res.status(200).json({
      success: true,
      executives,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalCount / limitNum),
        totalCount,
        limit: limitNum
      }
    });
  } catch (error) {
    console.error('[EXECUTIVE] Error in getApprovedExecutives:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch approved executives',
      ...(process.env.NODE_ENV === 'development' && { error: error.message })
    });
  }
};

// ---------------------------------------------------------------------------
// ADMIN — Application Management
// ---------------------------------------------------------------------------

/**
 * @desc    Get all executive applications (admin)
 * @route   GET /api/executives/admin/applications
 * @access  Private (Admin)
 */
exports.getAllExecutiveApplications = async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const {
      status, country, state,
      page = 1, limit = 20,
      sortBy = 'applicationDate', sortOrder = 'desc',
      search
    } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const limitNum = Math.min(parseInt(limit), 100);
    
    const query = {};
    if (status) query.status = status;
    if (country) query['location.country'] = country;
    if (state) query['location.state'] = state;

    // Add search functionality
    if (search) {
      const searchRegex = new RegExp(search, 'i');
      query.$or = [
        { 'location.country': searchRegex },
        { 'location.state': searchRegex },
        { 'location.city': searchRegex }
      ];
    }

    const sort = {};
    sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

    let applications = await Executive.find(query)
      .populate('userId', 'name email userName phone walletAddress')
      .populate('approvalInfo.approvedBy', 'name email')
      .populate('approvalInfo.rejectedBy', 'name email')
      .populate('codeGeneratedBy', 'name email')
      .sort(sort)
      .skip(skip)
      .limit(limitNum)
      .lean();

    // Optional name/email search (post-populate)
    if (search && applications.length > 0) {
      const s = search.toLowerCase();
      applications = applications.filter(a =>
        a.userId?.name?.toLowerCase().includes(s) ||
        a.userId?.email?.toLowerCase().includes(s) ||
        a.userId?.userName?.toLowerCase().includes(s)
      );
    }

    const totalCount = await Executive.countDocuments(query);

    return res.status(200).json({
      success: true,
      applications,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalCount / limitNum),
        totalCount,
        limit: limitNum
      }
    });
  } catch (error) {
    console.error('[EXECUTIVE] Error in getAllExecutiveApplications:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch executive applications',
      ...(process.env.NODE_ENV === 'development' && { error: error.message })
    });
  }
};

/**
 * @desc    Get single executive by ID (admin)
 * @route   GET /api/executives/admin/:executiveId
 * @access  Private (Admin)
 */
exports.getExecutiveById = async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const { executiveId } = req.params;

    if (!isValidObjectId(executiveId)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid executive ID format' 
      });
    }

    const application = await Executive.findById(executiveId)
      .populate('userId', 'name email userName phone walletAddress')
      .populate('approvalInfo.approvedBy', 'name email')
      .populate('approvalInfo.rejectedBy', 'name email')
      .populate('codeGeneratedBy', 'name email');

    if (!application) {
      return res.status(404).json({ 
        success: false, 
        message: 'Executive not found' 
      });
    }

    return res.status(200).json({ 
      success: true, 
      application 
    });
  } catch (error) {
    console.error('[EXECUTIVE] Error in getExecutiveById:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch executive',
      ...(process.env.NODE_ENV === 'development' && { error: error.message })
    });
  }
};

/**
 * @desc    Approve executive application
 * @route   POST /api/executives/admin/approve/:applicationId
 * @access  Private (Admin)
 */
exports.approveExecutiveApplication = async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const { applicationId } = req.params;
    const { adminNotes, roleTitle, responsibilities, region } = req.body;

    if (!isValidObjectId(applicationId)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid application ID format' 
      });
    }

    const application = await Executive.findById(applicationId)
      .populate('userId', 'name email');

    if (!application) {
      return res.status(404).json({ 
        success: false, 
        message: 'Executive application not found' 
      });
    }
    
    if (application.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: `Application has already been ${application.status}`
      });
    }

    // Update role if provided
    if (roleTitle) application.role.title = roleTitle;
    if (responsibilities) application.role.responsibilities = responsibilities;
    if (region) application.role.region = region;

    await application.approve(req.user.id, adminNotes);

    // Send approval email
    const user = application.userId;
    if (user?.email) {
      try {
        await sendEmail({
          email: user.email,
          subject: 'AfriMobile - Executive Application Approved!',
          html: `
            <h2>Congratulations! Your Executive Application Has Been Approved</h2>
            <p>Dear ${user.name},</p>
            <p>Your application to become an AfriMobile Executive has been approved!</p>
            <ul>
              <li>Role: ${application.role.title || 'Executive'}</li>
              <li>Region: ${application.role.region || application.location.state}</li>
              <li>Ownership: ${(application.shareInfo.totalOwnershipPct * 100).toFixed(6)}%</li>
            </ul>
            ${adminNotes ? `<p><strong>Admin Notes:</strong> ${adminNotes}</p>` : ''}
            <p>Welcome to the AfriMobile Executive Team!</p>
            <p>Best regards,<br>AfriMobile Team</p>
          `
        });
      } catch (e) {
        console.error('[EXECUTIVE] Failed to send approval email:', e);
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Executive application approved successfully',
      application
    });
  } catch (error) {
    console.error('[EXECUTIVE] Error in approveExecutiveApplication:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to approve executive application',
      ...(process.env.NODE_ENV === 'development' && { error: error.message })
    });
  }
};

/**
 * @desc    Reject executive application
 * @route   POST /api/executives/admin/reject/:applicationId
 * @access  Private (Admin)
 */
exports.rejectExecutiveApplication = async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const { applicationId } = req.params;
    const { reason } = req.body;

    if (!isValidObjectId(applicationId)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid application ID format' 
      });
    }

    if (!reason) {
      return res.status(400).json({ 
        success: false, 
        message: 'Rejection reason is required' 
      });
    }

    const application = await Executive.findById(applicationId)
      .populate('userId', 'name email');

    if (!application) {
      return res.status(404).json({ 
        success: false, 
        message: 'Executive application not found' 
      });
    }
    
    if (application.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: `Application has already been ${application.status}`
      });
    }

    await application.reject(req.user.id, reason);

    // Send rejection email
    const user = application.userId;
    if (user?.email) {
      try {
        await sendEmail({
          email: user.email,
          subject: 'AfriMobile - Executive Application Status',
          html: `
            <h2>Executive Application Update</h2>
            <p>Dear ${user.name},</p>
            <p>After careful review, your application has not been approved at this time.</p>
            <p><strong>Reason:</strong> ${reason}</p>
            <p>You may reapply after addressing the concerns above.</p>
            <p>Best regards,<br>AfriMobile Team</p>
          `
        });
      } catch (e) {
        console.error('[EXECUTIVE] Failed to send rejection email:', e);
      }
    }

    return res.status(200).json({ 
      success: true, 
      message: 'Executive application rejected', 
      application 
    });
  } catch (error) {
    console.error('[EXECUTIVE] Error in rejectExecutiveApplication:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to reject executive application',
      ...(process.env.NODE_ENV === 'development' && { error: error.message })
    });
  }
};

/**
 * @desc    Suspend executive
 * @route   POST /api/executives/admin/suspend/:executiveId
 * @access  Private (Admin)
 */
exports.suspendExecutive = async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const { executiveId } = req.params;
    const { reason, endDate } = req.body;

    if (!isValidObjectId(executiveId)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid executive ID format' 
      });
    }

    if (!reason) {
      return res.status(400).json({ 
        success: false, 
        message: 'Suspension reason is required' 
      });
    }

    const executive = await Executive.findById(executiveId)
      .populate('userId', 'name email');

    if (!executive) {
      return res.status(404).json({ 
        success: false, 
        message: 'Executive not found' 
      });
    }
    
    if (executive.status !== 'approved') {
      return res.status(400).json({ 
        success: false, 
        message: 'Only approved executives can be suspended' 
      });
    }

    await executive.suspend(req.user.id, reason, endDate ? new Date(endDate) : null);

    // Send suspension email
    const user = executive.userId;
    if (user?.email) {
      try {
        await sendEmail({
          email: user.email,
          subject: 'AfriMobile - Executive Status Suspended',
          html: `
            <h2>Executive Status Suspended</h2>
            <p>Dear ${user.name},</p>
            <p>Your executive status has been temporarily suspended.</p>
            <p><strong>Reason:</strong> ${reason}</p>
            ${endDate ? `<p><strong>Suspension End Date:</strong> ${new Date(endDate).toLocaleDateString()}</p>` : ''}
            <p>Contact our support team if you have questions.</p>
            <p>Best regards,<br>AfriMobile Team</p>
          `
        });
      } catch (e) {
        console.error('[EXECUTIVE] Failed to send suspension email:', e);
      }
    }

    return res.status(200).json({ 
      success: true, 
      message: 'Executive suspended successfully', 
      application: executive 
    });
  } catch (error) {
    console.error('[EXECUTIVE] Error in suspendExecutive:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to suspend executive',
      ...(process.env.NODE_ENV === 'development' && { error: error.message })
    });
  }
};

/**
 * @desc    Reactivate a suspended executive
 * @route   POST /api/executives/admin/reactivate/:executiveId
 * @access  Private (Admin)
 */
exports.reactivateExecutive = async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const { executiveId } = req.params;
    const { adminNotes } = req.body;

    if (!isValidObjectId(executiveId)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid executive ID format' 
      });
    }

    const executive = await Executive.findById(executiveId)
      .populate('userId', 'name email');

    if (!executive) {
      return res.status(404).json({ 
        success: false, 
        message: 'Executive not found' 
      });
    }
    
    if (executive.status !== 'suspended') {
      return res.status(400).json({ 
        success: false, 
        message: 'Only suspended executives can be reactivated' 
      });
    }

    executive.status = 'approved';
    executive.suspension = undefined;
    executive.approvalInfo = {
      ...executive.approvalInfo,
      approvedAt: new Date(),
      approvedBy: req.user.id,
      adminNotes: adminNotes || 'Reactivated by admin'
    };

    await executive.save();

    // Send reactivation email
    const user = executive.userId;
    if (user?.email) {
      try {
        await sendEmail({
          email: user.email,
          subject: 'AfriMobile - Executive Status Reactivated',
          html: `
            <h2>Executive Status Reactivated</h2>
            <p>Dear ${user.name},</p>
            <p>Your executive status has been reactivated. Welcome back!</p>
            ${adminNotes ? `<p><strong>Notes:</strong> ${adminNotes}</p>` : ''}
            <p>Best regards,<br>AfriMobile Team</p>
          `
        });
      } catch (e) {
        console.error('[EXECUTIVE] Failed to send reactivation email:', e);
      }
    }

    return res.status(200).json({ 
      success: true, 
      message: 'Executive reactivated successfully', 
      application: executive 
    });
  } catch (error) {
    console.error('[EXECUTIVE] Error in reactivateExecutive:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to reactivate executive',
      ...(process.env.NODE_ENV === 'development' && { error: error.message })
    });
  }
};

/**
 * @desc    Admin: Edit any executive's profile fields
 * @route   PUT /api/executives/admin/edit/:executiveId
 * @access  Private (Admin)
 */
exports.adminEditExecutive = async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const { executiveId } = req.params;
    const {
      country, state, city, address,
      phone, alternativePhone, email, alternativeEmail,
      bio, expertise, linkedin, twitter, facebook, instagram,
      profileImage, roleTitle, responsibilities, region,
      adminNotes
    } = req.body;

    if (!isValidObjectId(executiveId)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid executive ID format' 
      });
    }

    const executive = await Executive.findById(executiveId);
    if (!executive) {
      return res.status(404).json({ 
        success: false, 
        message: 'Executive not found' 
      });
    }

    // Location
    if (country) executive.location.country = country;
    if (state) executive.location.state = state;
    if (city) executive.location.city = city;
    if (address) executive.location.address = address;

    // Contact
    if (phone) executive.contactInfo.phone = phone;
    if (alternativePhone !== undefined) executive.contactInfo.alternativePhone = alternativePhone;
    if (email) executive.contactInfo.email = email;
    if (alternativeEmail !== undefined) executive.contactInfo.alternativeEmail = alternativeEmail;

    // Profile
    if (bio !== undefined) executive.bio = bio;
    if (expertise) executive.expertise = expertise;
    if (profileImage) executive.profileImage = profileImage;

    // Social
    if (linkedin !== undefined) executive.socialMedia.linkedin = linkedin;
    if (twitter !== undefined) executive.socialMedia.twitter = twitter;
    if (facebook !== undefined) executive.socialMedia.facebook = facebook;
    if (instagram !== undefined) executive.socialMedia.instagram = instagram;

    // Role
    if (roleTitle) executive.role.title = roleTitle;
    if (responsibilities) executive.role.responsibilities = responsibilities;
    if (region) executive.role.region = region;

    // Admin note
    if (adminNotes) executive.approvalInfo.adminNotes = adminNotes;

    await executive.save();

    return res.status(200).json({
      success: true,
      message: 'Executive updated successfully',
      application: executive
    });
  } catch (error) {
    console.error('[EXECUTIVE] Error in adminEditExecutive:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update executive',
      ...(process.env.NODE_ENV === 'development' && { error: error.message })
    });
  }
};

/**
 * @desc    Admin: Refresh share info for an executive from current share data
 * @route   POST /api/executives/admin/refresh-shares/:executiveId
 * @access  Private (Admin)
 */
exports.adminRefreshExecutiveShares = async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const { executiveId } = req.params;

    if (!isValidObjectId(executiveId)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid executive ID format' 
      });
    }

    const executive = await Executive.findById(executiveId);
    if (!executive) {
      return res.status(404).json({ 
        success: false, 
        message: 'Executive not found' 
      });
    }

    const shareInfo = await computeShareInfo(executive.userId);

    executive.shareInfo = {
      totalOwnershipPct: shareInfo.totalOwnershipPct,
      regularOwnershipPct: shareInfo.regularOwnershipPct,
      cofounderOwnershipPct: shareInfo.cofounderOwnershipPct,
      totalEarningKobo: shareInfo.totalEarningKobo,
      regularShares: shareInfo.regularShares,
      coFounderShares: shareInfo.coFounderShares,
      verifiedAt: new Date()
    };

    await executive.save();

    return res.status(200).json({
      success: true,
      message: 'Share info refreshed successfully',
      shareInfo: executive.shareInfo
    });
  } catch (error) {
    console.error('[EXECUTIVE] Error in adminRefreshExecutiveShares:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to refresh share info',
      ...(process.env.NODE_ENV === 'development' && { error: error.message })
    });
  }
};

/**
 * @desc    Permanently remove executive record
 * @route   DELETE /api/executives/admin/remove/:executiveId
 * @access  Private (Admin)
 */
exports.removeExecutive = async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const { executiveId } = req.params;
    const { reason } = req.body;

    if (!isValidObjectId(executiveId)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid executive ID format' 
      });
    }

    const executive = await Executive.findByIdAndDelete(executiveId)
      .populate('userId', 'name email');

    if (!executive) {
      return res.status(404).json({ 
        success: false, 
        message: 'Executive not found' 
      });
    }

    // Send removal email
    const user = executive.userId;
    if (user?.email) {
      try {
        await sendEmail({
          email: user.email,
          subject: 'AfriMobile - Executive Status Removed',
          html: `
            <h2>Executive Status Removed</h2>
            <p>Dear ${user.name},</p>
            <p>Your executive status has been removed.</p>
            ${reason ? `<p><strong>Reason:</strong> ${reason}</p>` : ''}
            <p>You may reapply in the future.</p>
            <p>Best regards,<br>AfriMobile Team</p>
          `
        });
      } catch (e) {
        console.error('[EXECUTIVE] Failed to send removal email:', e);
      }
    }

    return res.status(200).json({ 
      success: true, 
      message: 'Executive status removed successfully' 
    });
  } catch (error) {
    console.error('[EXECUTIVE] Error in removeExecutive:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to remove executive',
      ...(process.env.NODE_ENV === 'development' && { error: error.message })
    });
  }
};

// ---------------------------------------------------------------------------
// ADMIN — Statistics
// ---------------------------------------------------------------------------

/**
 * @desc    Get executive statistics (admin)
 * @route   GET /api/executives/admin/statistics
 * @access  Private (Admin)
 */
exports.getExecutiveStatistics = async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const [
      totalExecutives,
      pendingCount,
      approvedCount,
      rejectedCount,
      suspendedCount,
      unusedCodeCount
    ] = await Promise.all([
      Executive.countDocuments(),
      Executive.countDocuments({ status: 'pending' }),
      Executive.countDocuments({ status: 'approved' }),
      Executive.countDocuments({ status: 'rejected' }),
      Executive.countDocuments({ status: 'suspended' }),
      Executive.countDocuments({ 
        activationCode: { $exists: true, $ne: null }, 
        codeRedeemedAt: { $exists: false } 
      })
    ]);

    // Aggregate ownership % across all approved executives
    const ownershipAgg = await Executive.aggregate([
      { $match: { status: 'approved' } },
      {
        $group: {
          _id: null,
          totalOwnershipPct: { $sum: '$shareInfo.totalOwnershipPct' },
          totalEarningKobo: { $sum: '$shareInfo.totalEarningKobo' },
          count: { $sum: 1 }
        }
      }
    ]);
    
    const ownershipTotals = ownershipAgg[0] || { 
      totalOwnershipPct: 0, 
      totalEarningKobo: 0,
      count: 0
    };

    // Regional distribution
    const regionalDistribution = await Executive.aggregate([
      { $match: { status: 'approved' } },
      {
        $group: {
          _id: {
            country: '$location.country',
            state: '$location.state'
          },
          count: { $sum: 1 },
          totalOwnershipPct: { $sum: '$shareInfo.totalOwnershipPct' }
        }
      },
      { $sort: { count: -1 } },
      { $limit: 50 }
    ]);

    // Top executives by ownership %
    const topExecutives = await Executive.find({ status: 'approved' })
      .populate('userId', 'name email')
      .select('userId shareInfo location')
      .sort({ 'shareInfo.totalOwnershipPct': -1 })
      .limit(10)
      .lean();

    return res.status(200).json({
      success: true,
      statistics: {
        total: totalExecutives,
        byStatus: {
          pending: pendingCount,
          approved: approvedCount,
          rejected: rejectedCount,
          suspended: suspendedCount
        },
        unusedActivationCodes: unusedCodeCount,
        ownershipSummary: {
          totalOwnershipPct: ownershipTotals.totalOwnershipPct,
          formattedTotalOwnership: (ownershipTotals.totalOwnershipPct * 100).toFixed(6) + '%',
          totalEarningKobo: ownershipTotals.totalEarningKobo,
          executiveCount: ownershipTotals.count,
          averageOwnershipPct: ownershipTotals.count > 0 
            ? (ownershipTotals.totalOwnershipPct / ownershipTotals.count) 
            : 0
        },
        regionalDistribution,
        topExecutives
      }
    });
  } catch (error) {
    console.error('[EXECUTIVE] Error in getExecutiveStatistics:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch executive statistics',
      ...(process.env.NODE_ENV === 'development' && { error: error.message })
    });
  }
};