// controller/executiveController.js
const crypto = require('crypto');
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
  const admin = await User.findById(req.user.id).lean();
  if (!admin || !admin.isAdmin) {
    res.status(403).json({ success: false, message: 'Unauthorized: Admin access required' });
    return null;
  }
  return admin;
}

// ---------------------------------------------------------------------------
// ADMIN — Activation Code Management
// ---------------------------------------------------------------------------

/**
 * @desc    Admin: Generate activation code
 * @route   POST /api/executives/admin/generate-code
 * @access  Private (Admin)
 */
exports.generateActivationCode = async (req, res) => {
  try {
    if (!await requireAdmin(req, res)) return;

    const adminId = req.user.id;
    const { userId, note } = req.body;

    // Ensure uniqueness
    let code;
    let exists = true;
    while (exists) {
      code  = generateActivationCode();
      exists = await Executive.findOne({ activationCode: code });
    }

    const execDoc = new Executive({
      activationCode:    code,
      codeGeneratedBy:   adminId,
      codeGeneratedAt:   new Date(),
      status:            'pending',
      adminNote:         note || null,
      ...(userId && { userId })
    });

    await execDoc.save();

    console.log('[EXECUTIVE] Activation code generated:', code, 'by admin:', adminId);

    res.status(201).json({
      success:     true,
      message:     'Activation code generated successfully',
      code,
      executiveId: execDoc._id
    });
  } catch (error) {
    console.error('[EXECUTIVE] Error generating code:', error);
    res.status(500).json({ success: false, message: 'Failed to generate activation code' });
  }
};

/**
 * @desc    Admin: List all generated codes
 * @route   GET /api/executives/admin/codes
 * @access  Private (Admin)
 */
exports.listActivationCodes = async (req, res) => {
  try {
    if (!await requireAdmin(req, res)) return;

    const { page = 1, limit = 50, redeemed } = req.query;
    const skip  = (parseInt(page) - 1) * parseInt(limit);

    const query = { activationCode: { $exists: true, $ne: null } };
    if (redeemed === 'true')  query.codeRedeemedAt = { $exists: true };
    if (redeemed === 'false') query.codeRedeemedAt = { $exists: false };

    const codes = await Executive.find(query)
      .populate('userId',          'name email userName')
      .populate('codeGeneratedBy', 'name email')
      .select('activationCode userId codeGeneratedBy codeGeneratedAt codeRedeemedAt status location.country location.state adminNote')
      .sort({ codeGeneratedAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const totalCount = await Executive.countDocuments(query);

    res.status(200).json({
      success: true,
      codes,
      pagination: {
        currentPage: parseInt(page),
        totalPages:  Math.ceil(totalCount / parseInt(limit)),
        totalCount
      }
    });
  } catch (error) {
    console.error('[EXECUTIVE] Error listing codes:', error);
    res.status(500).json({ success: false, message: 'Failed to list activation codes' });
  }
};

/**
 * @desc    Admin: Revoke (delete) an unused activation code
 * @route   DELETE /api/executives/admin/codes/:code
 * @access  Private (Admin)
 */
exports.revokeActivationCode = async (req, res) => {
  try {
    if (!await requireAdmin(req, res)) return;

    const { code } = req.params;

    const execDoc = await Executive.findOne({ activationCode: code.toUpperCase().trim() });
    if (!execDoc) {
      return res.status(404).json({ success: false, message: 'Activation code not found' });
    }
    if (execDoc.codeRedeemedAt) {
      return res.status(400).json({ success: false, message: 'Cannot revoke a code that has already been redeemed' });
    }

    await Executive.deleteOne({ _id: execDoc._id });

    console.log('[EXECUTIVE] Activation code revoked:', code, 'by admin:', req.user.id);
    res.status(200).json({ success: true, message: 'Activation code revoked successfully' });
  } catch (error) {
    console.error('[EXECUTIVE] Error revoking code:', error);
    res.status(500).json({ success: false, message: 'Failed to revoke activation code' });
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
      return res.status(400).json({ success: false, message: 'Activation code is required' });
    }

    // Check if user already has an executive record
    const existingExec = await Executive.findOne({ userId, codeRedeemedAt: { $exists: true } });
    if (existingExec) {
      return res.status(400).json({ success: false, message: 'You already have an executive record' });
    }

    const execDoc = await Executive.findOne({ activationCode: code.toUpperCase().trim() });
    if (!execDoc) {
      return res.status(404).json({ success: false, message: 'Invalid activation code' });
    }
    if (execDoc.codeRedeemedAt) {
      return res.status(400).json({ success: false, message: 'This code has already been redeemed' });
    }
    if (execDoc.userId && execDoc.userId.toString() !== userId) {
      return res.status(403).json({ success: false, message: 'This code is assigned to a different user' });
    }

    execDoc.userId         = userId;
    execDoc.codeRedeemedAt = new Date();
    await execDoc.save();

    console.log('[EXECUTIVE] Code redeemed:', code, 'by user:', userId);

    res.status(200).json({
      success:     true,
      message:     'Activation code redeemed successfully. Please complete your profile.',
      executiveId: execDoc._id
    });
  } catch (error) {
    console.error('[EXECUTIVE] Error redeeming code:', error);
    res.status(500).json({ success: false, message: 'Failed to redeem activation code' });
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

    const execDoc = await Executive.findOne({ userId, codeRedeemedAt: { $exists: true } });
    if (!execDoc) {
      return res.status(404).json({
        success: false,
        message: 'No redeemed activation code found. Please redeem a code first.'
      });
    }

    if (!country || !state || !city || !address || !phone || !email) {
      return res.status(400).json({
        success: false,
        message: 'Please provide all required fields: country, state, city, address, phone, and email'
      });
    }
    if (!profileImage) {
      return res.status(400).json({ success: false, message: 'Profile image is required' });
    }

    // --- NEW: % based share info ---
    const shareInfo = await computeShareInfo(userId);

    execDoc.profileImage = profileImage;
    execDoc.location     = {
      country,
      state,
      city,
      address,
      coordinates: { latitude: latitude || null, longitude: longitude || null }
    };
    execDoc.contactInfo  = {
      phone,
      alternativePhone:  alternativePhone  || null,
      email,
      alternativeEmail:  alternativeEmail  || null
    };
    execDoc.shareInfo    = {
      // % based fields
      totalOwnershipPct:     shareInfo.totalOwnershipPct,
      regularOwnershipPct:   shareInfo.regularOwnershipPct,
      cofounderOwnershipPct: shareInfo.cofounderOwnershipPct,
      totalEarningKobo:      shareInfo.totalEarningKobo,
      // legacy counts kept for display
      regularShares:         shareInfo.regularShares,
      coFounderShares:       shareInfo.coFounderShares,
      verifiedAt:            new Date()
    };
    execDoc.bio         = bio || null;
    execDoc.expertise   = expertise || [];
    execDoc.socialMedia = {
      linkedin:  linkedin  || null,
      twitter:   twitter   || null,
      facebook:  facebook  || null,
      instagram: instagram || null
    };
    execDoc.linkedin    = linkedin || null;
    execDoc.twitter     = twitter  || null;
    execDoc.status      = 'approved';
    execDoc.isVerified  = true;
    execDoc.approvalInfo = {
      approvedAt:  new Date(),
      adminNotes:  'Auto-approved via activation code'
    };

    await execDoc.save();

    console.log('[EXECUTIVE] Profile completed for user:', userId);

    const user = await User.findById(userId);
    if (user?.email) {
      try {
        await sendEmail({
          email:   user.email,
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

    res.status(200).json({
      success:     true,
      message:     'Executive profile completed successfully!',
      application: execDoc
    });
  } catch (error) {
    console.error('[EXECUTIVE] Error completing profile:', error);
    res.status(500).json({ success: false, message: 'Failed to complete executive profile' });
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
      return res.status(400).json({ success: false, message: 'No image file provided' });
    }
    if (!req.file.mimetype.startsWith('image/')) {
      return res.status(400).json({ success: false, message: 'File must be an image' });
    }
    if (req.file.size > 5 * 1024 * 1024) {
      return res.status(400).json({ success: false, message: 'Image size must be less than 5MB' });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const result = await sharePaymentUpload(
      req.file.buffer,
      `executives/${userId}`,
      req.file.originalname
    );

    logCloudinaryUpload(userId, result.secure_url, 'executive_profile');

    res.status(200).json({
      success:  true,
      message:  'Image uploaded successfully',
      imageUrl: result.secure_url,
      publicId: result.public_id
    });
  } catch (error) {
    console.error('[EXECUTIVE IMAGE] Upload error:', error);
    handleCloudinaryError(error);
    res.status(500).json({
      success: false,
      message: 'Failed to upload image',
      error:   process.env.NODE_ENV === 'development' ? error.message : undefined
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

    if (!country || !state || !city || !address || !phone || !email) {
      return res.status(400).json({
        success: false,
        message: 'Please provide all required fields: country, state, city, address, phone, and email'
      });
    }
    if (!profileImage) {
      return res.status(400).json({ success: false, message: 'Profile image is required' });
    }

    // Check for existing application
    const existingApplication = await Executive.findOne({ userId });
    if (existingApplication) {
      if (existingApplication.status === 'pending') {
        return res.status(400).json({ success: false, message: 'You already have a pending executive application' });
      }
      if (existingApplication.status === 'approved') {
        return res.status(400).json({ success: false, message: 'You are already an approved executive' });
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

    // --- NEW: % based share info ---
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
        coordinates: { latitude: latitude || null, longitude: longitude || null }
      },
      contactInfo: {
        phone,
        alternativePhone:  alternativePhone  || null,
        email,
        alternativeEmail:  alternativeEmail  || null
      },
      shareInfo: {
        totalOwnershipPct:     shareInfo.totalOwnershipPct,
        regularOwnershipPct:   shareInfo.regularOwnershipPct,
        cofounderOwnershipPct: shareInfo.cofounderOwnershipPct,
        totalEarningKobo:      shareInfo.totalEarningKobo,
        regularShares:         shareInfo.regularShares,
        coFounderShares:       shareInfo.coFounderShares,
        verifiedAt:            new Date()
      },
      bio:         bio      || null,
      expertise:   expertise || [],
      socialMedia: {
        linkedin: linkedin || null,
        twitter:  twitter  || null
      },
      status: 'pending'
    });

    await executiveApplication.save();

    const user = await User.findById(userId);

    if (user?.email) {
      try {
        await sendEmail({
          email:   user.email,
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

    const adminEmail = process.env.ADMIN_EMAIL;
    if (adminEmail) {
      try {
        await sendEmail({
          email:   adminEmail,
          subject: 'New Executive Application',
          html: `
            <h2>New Executive Application</h2>
            <ul>
              <li>User: ${user.name} (${user.email})</li>
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

    res.status(201).json({
      success:     true,
      message:     'Executive application submitted successfully',
      application: executiveApplication
    });
  } catch (error) {
    console.error('[EXECUTIVE] Error in applyAsExecutive:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to submit executive application',
      error:   process.env.NODE_ENV === 'development' ? error.message : undefined
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
      return res.status(404).json({ success: false, message: 'No executive application found' });
    }

    res.status(200).json({ success: true, application });
  } catch (error) {
    console.error('[EXECUTIVE] Error in getMyExecutiveApplication:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch executive application',
      error:   process.env.NODE_ENV === 'development' ? error.message : undefined
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
      return res.status(404).json({ success: false, message: 'Executive profile not found or not approved' });
    }

    const {
      phone, alternativePhone, email, alternativeEmail,
      address, bio, expertise, linkedin, twitter, profileImage
    } = req.body;

    if (phone)                            executive.contactInfo.phone             = phone;
    if (alternativePhone !== undefined)   executive.contactInfo.alternativePhone  = alternativePhone;
    if (email)                            executive.contactInfo.email             = email;
    if (alternativeEmail !== undefined)   executive.contactInfo.alternativeEmail  = alternativeEmail;
    if (address)                          executive.location.address              = address;
    if (bio !== undefined)                executive.bio                           = bio;
    if (expertise)                        executive.expertise                     = expertise;
    if (linkedin !== undefined)           executive.socialMedia.linkedin          = linkedin;
    if (twitter !== undefined)            executive.socialMedia.twitter           = twitter;
    if (profileImage)                     executive.profileImage                  = profileImage;

    await executive.save();

    res.status(200).json({
      success:     true,
      message:     'Executive information updated successfully',
      application: executive
    });
  } catch (error) {
    console.error('[EXECUTIVE] Error in updateExecutiveInfo:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update executive information',
      error:   process.env.NODE_ENV === 'development' ? error.message : undefined
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
    const skip  = (parseInt(page) - 1) * parseInt(limit);

    const query = { status: 'approved' };
    if (country) query['location.country'] = country;
    if (state)   query['location.state']   = state;

    const executives = await Executive.find(query)
      .populate('userId', 'name email userName')
      .select('-approvalInfo -suspension')
      .sort({ 'shareInfo.totalOwnershipPct': -1 })  // sort by % descending
      .skip(skip)
      .limit(parseInt(limit));

    const totalCount = await Executive.countDocuments(query);

    res.status(200).json({
      success:    true,
      executives,
      pagination: {
        currentPage: parseInt(page),
        totalPages:  Math.ceil(totalCount / parseInt(limit)),
        totalCount,
        limit:       parseInt(limit)
      }
    });
  } catch (error) {
    console.error('[EXECUTIVE] Error in getApprovedExecutives:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch approved executives',
      error:   process.env.NODE_ENV === 'development' ? error.message : undefined
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
    if (!await requireAdmin(req, res)) return;

    const {
      status, country, state,
      page = 1, limit = 20,
      sortBy = 'applicationDate', sortOrder = 'desc',
      search
    } = req.query;

    const skip  = (parseInt(page) - 1) * parseInt(limit);
    const query = {};
    if (status)  query.status                = status;
    if (country) query['location.country']   = country;
    if (state)   query['location.state']     = state;

    const sort = {};
    sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

    let applications = await Executive.find(query)
      .populate('userId', 'name email userName phone walletAddress')
      .populate('approvalInfo.approvedBy', 'name email')
      .populate('approvalInfo.rejectedBy', 'name email')
      .populate('codeGeneratedBy',         'name email')
      .sort(sort)
      .skip(skip)
      .limit(parseInt(limit));

    // Optional name/email search (post-populate)
    if (search) {
      const s = search.toLowerCase();
      applications = applications.filter(a =>
        a.userId?.name?.toLowerCase().includes(s)  ||
        a.userId?.email?.toLowerCase().includes(s) ||
        a.userId?.userName?.toLowerCase().includes(s)
      );
    }

    const totalCount = await Executive.countDocuments(query);

    res.status(200).json({
      success:      true,
      applications,
      pagination: {
        currentPage: parseInt(page),
        totalPages:  Math.ceil(totalCount / parseInt(limit)),
        totalCount,
        limit:       parseInt(limit)
      }
    });
  } catch (error) {
    console.error('[EXECUTIVE] Error in getAllExecutiveApplications:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch executive applications',
      error:   process.env.NODE_ENV === 'development' ? error.message : undefined
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
    if (!await requireAdmin(req, res)) return;

    const { executiveId } = req.params;

    const application = await Executive.findById(executiveId)
      .populate('userId',                  'name email userName phone walletAddress')
      .populate('approvalInfo.approvedBy', 'name email')
      .populate('approvalInfo.rejectedBy', 'name email')
      .populate('codeGeneratedBy',         'name email');

    if (!application) {
      return res.status(404).json({ success: false, message: 'Executive not found' });
    }

    res.status(200).json({ success: true, application });
  } catch (error) {
    console.error('[EXECUTIVE] Error in getExecutiveById:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch executive',
      error:   process.env.NODE_ENV === 'development' ? error.message : undefined
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
    if (!await requireAdmin(req, res)) return;

    const { applicationId } = req.params;
    const { adminNotes, roleTitle, responsibilities, region } = req.body;

    const application = await Executive.findById(applicationId)
      .populate('userId', 'name email');

    if (!application) {
      return res.status(404).json({ success: false, message: 'Executive application not found' });
    }
    if (application.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: `Application has already been ${application.status}`
      });
    }

    if (roleTitle)        application.role.title           = roleTitle;
    if (responsibilities) application.role.responsibilities = responsibilities;
    if (region)           application.role.region           = region;

    await application.approve(req.user.id, adminNotes);

    const user = application.userId;
    if (user?.email) {
      try {
        await sendEmail({
          email:   user.email,
          subject: 'AfriMobile - Executive Application Approved!',
          html: `
            <h2>Congratulations! Your Executive Application Has Been Approved</h2>
            <p>Dear ${user.name},</p>
            <p>Your application to become an AfriMobile Executive has been approved!</p>
            <ul>
              <li>Role: ${application.role.title}</li>
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

    res.status(200).json({
      success:     true,
      message:     'Executive application approved successfully',
      application
    });
  } catch (error) {
    console.error('[EXECUTIVE] Error in approveExecutiveApplication:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to approve executive application',
      error:   process.env.NODE_ENV === 'development' ? error.message : undefined
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
    if (!await requireAdmin(req, res)) return;

    const { applicationId } = req.params;
    const { reason } = req.body;

    if (!reason) {
      return res.status(400).json({ success: false, message: 'Rejection reason is required' });
    }

    const application = await Executive.findById(applicationId)
      .populate('userId', 'name email');

    if (!application) {
      return res.status(404).json({ success: false, message: 'Executive application not found' });
    }
    if (application.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: `Application has already been ${application.status}`
      });
    }

    await application.reject(req.user.id, reason);

    const user = application.userId;
    if (user?.email) {
      try {
        await sendEmail({
          email:   user.email,
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

    res.status(200).json({ success: true, message: 'Executive application rejected', application });
  } catch (error) {
    console.error('[EXECUTIVE] Error in rejectExecutiveApplication:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reject executive application',
      error:   process.env.NODE_ENV === 'development' ? error.message : undefined
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
    if (!await requireAdmin(req, res)) return;

    const { executiveId } = req.params;
    const { reason, endDate } = req.body;

    if (!reason) {
      return res.status(400).json({ success: false, message: 'Suspension reason is required' });
    }

    const executive = await Executive.findById(executiveId)
      .populate('userId', 'name email');

    if (!executive) {
      return res.status(404).json({ success: false, message: 'Executive not found' });
    }
    if (executive.status !== 'approved') {
      return res.status(400).json({ success: false, message: 'Only approved executives can be suspended' });
    }

    await executive.suspend(req.user.id, reason, endDate ? new Date(endDate) : null);

    const user = executive.userId;
    if (user?.email) {
      try {
        await sendEmail({
          email:   user.email,
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

    res.status(200).json({ success: true, message: 'Executive suspended successfully', application: executive });
  } catch (error) {
    console.error('[EXECUTIVE] Error in suspendExecutive:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to suspend executive',
      error:   process.env.NODE_ENV === 'development' ? error.message : undefined
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
    if (!await requireAdmin(req, res)) return;

    const { executiveId } = req.params;
    const { adminNotes }  = req.body;

    const executive = await Executive.findById(executiveId)
      .populate('userId', 'name email');

    if (!executive) {
      return res.status(404).json({ success: false, message: 'Executive not found' });
    }
    if (executive.status !== 'suspended') {
      return res.status(400).json({ success: false, message: 'Only suspended executives can be reactivated' });
    }

    executive.status     = 'approved';
    executive.suspension = undefined;
    executive.approvalInfo = {
      ...executive.approvalInfo,
      approvedAt: new Date(),
      approvedBy: req.user.id,
      adminNotes: adminNotes || 'Reactivated by admin'
    };

    await executive.save();

    const user = executive.userId;
    if (user?.email) {
      try {
        await sendEmail({
          email:   user.email,
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

    res.status(200).json({ success: true, message: 'Executive reactivated successfully', application: executive });
  } catch (error) {
    console.error('[EXECUTIVE] Error in reactivateExecutive:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reactivate executive',
      error:   process.env.NODE_ENV === 'development' ? error.message : undefined
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
    if (!await requireAdmin(req, res)) return;

    const { executiveId } = req.params;
    const {
      country, state, city, address,
      phone, alternativePhone, email, alternativeEmail,
      bio, expertise, linkedin, twitter, facebook, instagram,
      profileImage, roleTitle, responsibilities, region,
      adminNotes
    } = req.body;

    const executive = await Executive.findById(executiveId);
    if (!executive) {
      return res.status(404).json({ success: false, message: 'Executive not found' });
    }

    // Location
    if (country)  executive.location.country  = country;
    if (state)    executive.location.state     = state;
    if (city)     executive.location.city      = city;
    if (address)  executive.location.address   = address;

    // Contact
    if (phone)                          executive.contactInfo.phone            = phone;
    if (alternativePhone !== undefined) executive.contactInfo.alternativePhone = alternativePhone;
    if (email)                          executive.contactInfo.email            = email;
    if (alternativeEmail !== undefined) executive.contactInfo.alternativeEmail = alternativeEmail;

    // Profile
    if (bio !== undefined)    executive.bio            = bio;
    if (expertise)            executive.expertise      = expertise;
    if (profileImage)         executive.profileImage   = profileImage;

    // Social
    if (linkedin !== undefined)  executive.socialMedia.linkedin  = linkedin;
    if (twitter  !== undefined)  executive.socialMedia.twitter   = twitter;
    if (facebook !== undefined)  executive.socialMedia.facebook  = facebook;
    if (instagram !== undefined) executive.socialMedia.instagram = instagram;

    // Role
    if (roleTitle)        executive.role.title           = roleTitle;
    if (responsibilities) executive.role.responsibilities = responsibilities;
    if (region)           executive.role.region           = region;

    // Admin note
    if (adminNotes) executive.approvalInfo.adminNotes = adminNotes;

    await executive.save();

    res.status(200).json({
      success:     true,
      message:     'Executive updated successfully',
      application: executive
    });
  } catch (error) {
    console.error('[EXECUTIVE] Error in adminEditExecutive:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update executive',
      error:   process.env.NODE_ENV === 'development' ? error.message : undefined
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
    if (!await requireAdmin(req, res)) return;

    const { executiveId } = req.params;

    const executive = await Executive.findById(executiveId);
    if (!executive) {
      return res.status(404).json({ success: false, message: 'Executive not found' });
    }

    const shareInfo = await computeShareInfo(executive.userId);

    executive.shareInfo = {
      totalOwnershipPct:     shareInfo.totalOwnershipPct,
      regularOwnershipPct:   shareInfo.regularOwnershipPct,
      cofounderOwnershipPct: shareInfo.cofounderOwnershipPct,
      totalEarningKobo:      shareInfo.totalEarningKobo,
      regularShares:         shareInfo.regularShares,
      coFounderShares:       shareInfo.coFounderShares,
      verifiedAt:            new Date()
    };

    await executive.save();

    res.status(200).json({
      success:   true,
      message:   'Share info refreshed successfully',
      shareInfo: executive.shareInfo
    });
  } catch (error) {
    console.error('[EXECUTIVE] Error in adminRefreshExecutiveShares:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to refresh share info',
      error:   process.env.NODE_ENV === 'development' ? error.message : undefined
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
    if (!await requireAdmin(req, res)) return;

    const { executiveId } = req.params;
    const { reason } = req.body;

    const executive = await Executive.findByIdAndDelete(executiveId)
      .populate('userId', 'name email');

    if (!executive) {
      return res.status(404).json({ success: false, message: 'Executive not found' });
    }

    const user = executive.userId;
    if (user?.email) {
      try {
        await sendEmail({
          email:   user.email,
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

    res.status(200).json({ success: true, message: 'Executive status removed successfully' });
  } catch (error) {
    console.error('[EXECUTIVE] Error in removeExecutive:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to remove executive',
      error:   process.env.NODE_ENV === 'development' ? error.message : undefined
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
    if (!await requireAdmin(req, res)) return;

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
      Executive.countDocuments({ activationCode: { $exists: true, $ne: null }, codeRedeemedAt: { $exists: false } })
    ]);

    // Aggregate ownership % across all approved executives
    const ownershipAgg = await Executive.aggregate([
      { $match: { status: 'approved' } },
      {
        $group: {
          _id:               null,
          totalOwnershipPct: { $sum: '$shareInfo.totalOwnershipPct' },
          totalEarningKobo:  { $sum: '$shareInfo.totalEarningKobo' }
        }
      }
    ]);
    const ownershipTotals = ownershipAgg[0] || { totalOwnershipPct: 0, totalEarningKobo: 0 };

    // Regional distribution
    const regionalDistribution = await Executive.aggregate([
      { $match: { status: 'approved' } },
      {
        $group: {
          _id: {
            country: '$location.country',
            state:   '$location.state'
          },
          count:             { $sum: 1 },
          totalOwnershipPct: { $sum: '$shareInfo.totalOwnershipPct' }
        }
      },
      { $sort: { count: -1 } }
    ]);

    // Top executives by ownership %
    const topExecutives = await Executive.find({ status: 'approved' })
      .populate('userId', 'name email')
      .select('userId shareInfo location')
      .sort({ 'shareInfo.totalOwnershipPct': -1 })
      .limit(10);

    res.status(200).json({
      success: true,
      statistics: {
        total: totalExecutives,
        byStatus: {
          pending:    pendingCount,
          approved:   approvedCount,
          rejected:   rejectedCount,
          suspended:  suspendedCount
        },
        unusedActivationCodes: unusedCodeCount,
        ownershipSummary: {
          totalOwnershipPct:        ownershipTotals.totalOwnershipPct,
          formattedTotalOwnership:  (ownershipTotals.totalOwnershipPct * 100).toFixed(6) + '%',
          totalEarningKobo:         ownershipTotals.totalEarningKobo
        },
        regionalDistribution,
        topExecutives
      }
    });
  } catch (error) {
    console.error('[EXECUTIVE] Error in getExecutiveStatistics:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch executive statistics',
      error:   process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};