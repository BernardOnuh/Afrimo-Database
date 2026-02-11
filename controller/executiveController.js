// controller/executiveController.js
const Executive = require('../models/Executive');
const User = require('../models/User');
const UserShare = require('../models/UserShare');
const CoFounderShare = require('../models/CoFounderShare');
const { sendEmail } = require('../utils/emailService');

/**
 * @desc    Apply to become an executive
 * @route   POST /api/executives/apply
 * @access  Private (User with shares)
 */
exports.applyAsExecutive = async (req, res) => {
  try {
    const userId = req.user.id;
    
    const {
      country,
      state,
      city,
      address,
      phone,
      alternativePhone,
      email,
      alternativeEmail,
      bio,
      expertise,
      linkedin,
      twitter,
      latitude,
      longitude
    } = req.body;
    
    console.log('[EXECUTIVE] Application received from user:', userId);
    
    // Validate required fields
    if (!country || !state || !city || !address || !phone || !email) {
      return res.status(400).json({
        success: false,
        message: 'Please provide all required fields: country, state, city, address, phone, and email'
      });
    }
    
    // Check if user already has an executive application
    const existingApplication = await Executive.findOne({ userId });
    
    if (existingApplication) {
      if (existingApplication.status === 'pending') {
        return res.status(400).json({
          success: false,
          message: 'You already have a pending executive application'
        });
      } else if (existingApplication.status === 'approved') {
        return res.status(400).json({
          success: false,
          message: 'You are already an approved executive'
        });
      } else if (existingApplication.status === 'rejected') {
        // Allow reapplication after rejection
        await Executive.deleteOne({ _id: existingApplication._id });
      }
    }
    
    // Get user's share information
    const userShares = await UserShare.findOne({ user: userId });
    
    if (!userShares || userShares.totalShares === 0) {
      return res.status(403).json({
        success: false,
        message: 'You must own shares to apply as an executive'
      });
    }
    
    // Calculate share breakdown
    const coFounderConfig = await CoFounderShare.findOne();
    const shareToRegularRatio = coFounderConfig?.shareToRegularRatio || 29;
    
    let regularShares = 0;
    let coFounderShares = 0;
    
    userShares.transactions.forEach(transaction => {
      if (transaction.status === 'completed') {
        if (transaction.paymentMethod === 'co-founder') {
          coFounderShares += transaction.coFounderShares || transaction.shares || 0;
        } else {
          regularShares += transaction.shares || 0;
        }
      }
    });
    
    const totalEffectiveShares = regularShares + (coFounderShares * shareToRegularRatio);
    
    // Minimum share requirement (optional - adjust as needed)
    const minimumSharesRequired = 1; // You can change this
    if (totalEffectiveShares < minimumSharesRequired) {
      return res.status(403).json({
        success: false,
        message: `You need at least ${minimumSharesRequired} shares to apply as an executive. You currently have ${totalEffectiveShares} shares.`
      });
    }
    
    // Calculate estimated share value (you can add pricing logic)
    const estimatedShareValue = totalEffectiveShares * 100000; // Example: 100k per share
    
    // Create executive application
    const executiveApplication = new Executive({
      userId,
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
        totalShares: totalEffectiveShares,
        regularShares,
        coFounderShares,
        shareValue: estimatedShareValue,
        verifiedAt: new Date()
      },
      bio: bio || null,
      expertise: expertise || [],
      linkedin: linkedin || null,
      twitter: twitter || null,
      status: 'pending'
    });
    
    await executiveApplication.save();
    
    console.log('[EXECUTIVE] Application created:', executiveApplication._id);
    
    // Get user details for notification
    const user = await User.findById(userId);
    
    // Send confirmation email to user
    if (user && user.email) {
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
              <li>Total Shares: ${totalEffectiveShares}</li>
              <li>Location: ${city}, ${state}, ${country}</li>
              <li>Status: Pending Admin Review</li>
            </ul>
            <p>Our team will review your application and get back to you soon.</p>
            <p>Best regards,<br>AfriMobile Team</p>
          `
        });
      } catch (emailError) {
        console.error('[EXECUTIVE] Failed to send confirmation email:', emailError);
      }
    }
    
    // Notify admin (optional)
    const adminEmail = process.env.ADMIN_EMAIL;
    if (adminEmail) {
      try {
        await sendEmail({
          email: adminEmail,
          subject: 'New Executive Application',
          html: `
            <h2>New Executive Application</h2>
            <p>A new executive application has been submitted:</p>
            <ul>
              <li>User: ${user.name} (${user.email})</li>
              <li>Shares: ${totalEffectiveShares}</li>
              <li>Location: ${city}, ${state}, ${country}</li>
              <li>Phone: ${phone}</li>
            </ul>
            <p>Please review and approve/reject in the admin dashboard.</p>
          `
        });
      } catch (emailError) {
        console.error('[EXECUTIVE] Failed to send admin notification:', emailError);
      }
    }
    
    res.status(201).json({
      success: true,
      message: 'Executive application submitted successfully',
      data: {
        applicationId: executiveApplication._id,
        status: executiveApplication.status,
        shares: totalEffectiveShares,
        location: `${city}, ${state}, ${country}`,
        applicationDate: executiveApplication.applicationDate
      }
    });
    
  } catch (error) {
    console.error('[EXECUTIVE] Error in applyAsExecutive:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to submit executive application',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Get user's executive status/application
 * @route   GET /api/executives/my-application
 * @access  Private (User)
 */
exports.getMyExecutiveApplication = async (req, res) => {
  try {
    const userId = req.user.id;
    
    const application = await Executive.findOne({ userId })
      .populate('approvalInfo.approvedBy', 'name email')
      .populate('approvalInfo.rejectedBy', 'name email');
    
    if (!application) {
      return res.status(404).json({
        success: false,
        message: 'No executive application found'
      });
    }
    
    res.status(200).json({
      success: true,
      data: application
    });
    
  } catch (error) {
    console.error('[EXECUTIVE] Error in getMyExecutiveApplication:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch executive application',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Get all executive applications (admin)
 * @route   GET /api/executives/admin/applications
 * @access  Private (Admin)
 */
exports.getAllExecutiveApplications = async (req, res) => {
  try {
    const adminId = req.user.id;
    
    // Check if admin
    const admin = await User.findById(adminId);
    if (!admin || !admin.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized: Admin access required'
      });
    }
    
    const { 
      status, 
      country, 
      state,
      page = 1, 
      limit = 20,
      sortBy = 'applicationDate',
      sortOrder = 'desc'
    } = req.query;
    
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    // Build query
    const query = {};
    if (status) query.status = status;
    if (country) query['location.country'] = country;
    if (state) query['location.state'] = state;
    
    // Build sort
    const sort = {};
    sort[sortBy] = sortOrder === 'desc' ? -1 : 1;
    
    // Get applications
    const applications = await Executive.find(query)
      .populate('userId', 'name email userName phone walletAddress')
      .populate('approvalInfo.approvedBy', 'name email')
      .populate('approvalInfo.rejectedBy', 'name email')
      .sort(sort)
      .skip(skip)
      .limit(parseInt(limit));
    
    // Get total count
    const totalCount = await Executive.countDocuments(query);
    
    res.status(200).json({
      success: true,
      data: applications,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalCount / parseInt(limit)),
        totalCount,
        limit: parseInt(limit)
      }
    });
    
  } catch (error) {
    console.error('[EXECUTIVE] Error in getAllExecutiveApplications:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch executive applications',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
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
    const adminId = req.user.id;
    const { applicationId } = req.params;
    const { adminNotes, roleTitle, responsibilities, region } = req.body;
    
    // Check if admin
    const admin = await User.findById(adminId);
    if (!admin || !admin.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized: Admin access required'
      });
    }
    
    // Find application
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
    
    // Update role information if provided
    if (roleTitle) application.role.title = roleTitle;
    if (responsibilities) application.role.responsibilities = responsibilities;
    if (region) application.role.region = region;
    
    // Approve the application
    await application.approve(adminId, adminNotes);
    
    console.log('[EXECUTIVE] Application approved:', applicationId);
    
    // Send approval email to user
    const user = application.userId;
    if (user && user.email) {
      try {
        await sendEmail({
          email: user.email,
          subject: 'AfriMobile - Executive Application Approved!',
          html: `
            <h2>Congratulations! Your Executive Application Has Been Approved</h2>
            <p>Dear ${user.name},</p>
            <p>We are pleased to inform you that your application to become an AfriMobile Executive has been approved!</p>
            <p><strong>Executive Details:</strong></p>
            <ul>
              <li>Role: ${application.role.title}</li>
              <li>Region: ${application.role.region || application.location.state}</li>
              <li>Shares: ${application.shareInfo.totalShares}</li>
            </ul>
            ${adminNotes ? `<p><strong>Admin Notes:</strong> ${adminNotes}</p>` : ''}
            <p>Welcome to the AfriMobile Executive Team!</p>
            <p>Best regards,<br>AfriMobile Team</p>
          `
        });
      } catch (emailError) {
        console.error('[EXECUTIVE] Failed to send approval email:', emailError);
      }
    }
    
    res.status(200).json({
      success: true,
      message: 'Executive application approved successfully',
      data: application
    });
    
  } catch (error) {
    console.error('[EXECUTIVE] Error in approveExecutiveApplication:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to approve executive application',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
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
    const adminId = req.user.id;
    const { applicationId } = req.params;
    const { reason } = req.body;
    
    // Check if admin
    const admin = await User.findById(adminId);
    if (!admin || !admin.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized: Admin access required'
      });
    }
    
    if (!reason) {
      return res.status(400).json({
        success: false,
        message: 'Rejection reason is required'
      });
    }
    
    // Find application
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
    
    // Reject the application
    await application.reject(adminId, reason);
    
    console.log('[EXECUTIVE] Application rejected:', applicationId);
    
    // Send rejection email to user
    const user = application.userId;
    if (user && user.email) {
      try {
        await sendEmail({
          email: user.email,
          subject: 'AfriMobile - Executive Application Status',
          html: `
            <h2>Executive Application Update</h2>
            <p>Dear ${user.name},</p>
            <p>Thank you for your interest in becoming an AfriMobile Executive.</p>
            <p>After careful review, we regret to inform you that your application has not been approved at this time.</p>
            <p><strong>Reason:</strong> ${reason}</p>
            <p>You may reapply in the future after addressing the concerns mentioned above.</p>
            <p>Best regards,<br>AfriMobile Team</p>
          `
        });
      } catch (emailError) {
        console.error('[EXECUTIVE] Failed to send rejection email:', emailError);
      }
    }
    
    res.status(200).json({
      success: true,
      message: 'Executive application rejected',
      data: application
    });
    
  } catch (error) {
    console.error('[EXECUTIVE] Error in rejectExecutiveApplication:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reject executive application',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Get all approved executives (public)
 * @route   GET /api/executives/approved
 * @access  Public
 */
exports.getApprovedExecutives = async (req, res) => {
  try {
    const { country, state, page = 1, limit = 20 } = req.query;
    
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    // Build query
    const query = { status: 'approved' };
    if (country) query['location.country'] = country;
    if (state) query['location.state'] = state;
    
    // Get executives
    const executives = await Executive.find(query)
      .populate('userId', 'name email userName')
      .select('-approvalInfo -suspension')
      .sort({ 'shareInfo.totalShares': -1 })
      .skip(skip)
      .limit(parseInt(limit));
    
    // Get total count
    const totalCount = await Executive.countDocuments(query);
    
    res.status(200).json({
      success: true,
      data: executives,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalCount / parseInt(limit)),
        totalCount,
        limit: parseInt(limit)
      }
    });
    
  } catch (error) {
    console.error('[EXECUTIVE] Error in getApprovedExecutives:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch approved executives',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Update executive information
 * @route   PUT /api/executives/update
 * @access  Private (Approved Executive)
 */
exports.updateExecutiveInfo = async (req, res) => {
  try {
    const userId = req.user.id;
    
    const {
      phone,
      alternativePhone,
      email,
      alternativeEmail,
      address,
      bio,
      expertise,
      linkedin,
      twitter
    } = req.body;
    
    // Find executive
    const executive = await Executive.findOne({ 
      userId, 
      status: { $in: ['approved', 'pending'] } 
    });
    
    if (!executive) {
      return res.status(404).json({
        success: false,
        message: 'Executive profile not found or not approved'
      });
    }
    
    // Update allowed fields
    if (phone) executive.contactInfo.phone = phone;
    if (alternativePhone !== undefined) executive.contactInfo.alternativePhone = alternativePhone;
    if (email) executive.contactInfo.email = email;
    if (alternativeEmail !== undefined) executive.contactInfo.alternativeEmail = alternativeEmail;
    if (address) executive.location.address = address;
    if (bio !== undefined) executive.bio = bio;
    if (expertise) executive.expertise = expertise;
    if (linkedin !== undefined) executive.linkedin = linkedin;
    if (twitter !== undefined) executive.twitter = twitter;
    
    await executive.save();
    
    res.status(200).json({
      success: true,
      message: 'Executive information updated successfully',
      data: executive
    });
    
  } catch (error) {
    console.error('[EXECUTIVE] Error in updateExecutiveInfo:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update executive information',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
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
    const adminId = req.user.id;
    const { executiveId } = req.params;
    const { reason, endDate } = req.body;
    
    // Check if admin
    const admin = await User.findById(adminId);
    if (!admin || !admin.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized: Admin access required'
      });
    }
    
    if (!reason) {
      return res.status(400).json({
        success: false,
        message: 'Suspension reason is required'
      });
    }
    
    // Find executive
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
    
    // Suspend executive
    await executive.suspend(adminId, reason, endDate ? new Date(endDate) : null);
    
    // Send suspension email
    const user = executive.userId;
    if (user && user.email) {
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
            <p>If you have any questions, please contact our support team.</p>
            <p>Best regards,<br>AfriMobile Team</p>
          `
        });
      } catch (emailError) {
        console.error('[EXECUTIVE] Failed to send suspension email:', emailError);
      }
    }
    
    res.status(200).json({
      success: true,
      message: 'Executive suspended successfully',
      data: executive
    });
    
  } catch (error) {
    console.error('[EXECUTIVE] Error in suspendExecutive:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to suspend executive',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Remove executive status (admin)
 * @route   DELETE /api/executives/admin/remove/:executiveId
 * @access  Private (Admin)
 */
exports.removeExecutive = async (req, res) => {
  try {
    const adminId = req.user.id;
    const { executiveId } = req.params;
    const { reason } = req.body;
    
    // Check if admin
    const admin = await User.findById(adminId);
    if (!admin || !admin.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized: Admin access required'
      });
    }
    
    // Find and delete executive
    const executive = await Executive.findByIdAndDelete(executiveId)
      .populate('userId', 'name email');
    
    if (!executive) {
      return res.status(404).json({
        success: false,
        message: 'Executive not found'
      });
    }
    
    // Send removal notification
    const user = executive.userId;
    if (user && user.email) {
      try {
        await sendEmail({
          email: user.email,
          subject: 'AfriMobile - Executive Status Removed',
          html: `
            <h2>Executive Status Removed</h2>
            <p>Dear ${user.name},</p>
            <p>Your executive status has been removed.</p>
            ${reason ? `<p><strong>Reason:</strong> ${reason}</p>` : ''}
            <p>You may reapply to become an executive in the future.</p>
            <p>Best regards,<br>AfriMobile Team</p>
          `
        });
      } catch (emailError) {
        console.error('[EXECUTIVE] Failed to send removal email:', emailError);
      }
    }
    
    res.status(200).json({
      success: true,
      message: 'Executive status removed successfully'
    });
    
  } catch (error) {
    console.error('[EXECUTIVE] Error in removeExecutive:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to remove executive',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Get executive statistics (admin)
 * @route   GET /api/executives/admin/statistics
 * @access  Private (Admin)
 */
exports.getExecutiveStatistics = async (req, res) => {
  try {
    const adminId = req.user.id;
    
    // Check if admin
    const admin = await User.findById(adminId);
    if (!admin || !admin.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized: Admin access required'
      });
    }
    
    // Get counts by status
    const [
      totalExecutives,
      pendingCount,
      approvedCount,
      rejectedCount,
      suspendedCount
    ] = await Promise.all([
      Executive.countDocuments(),
      Executive.countDocuments({ status: 'pending' }),
      Executive.countDocuments({ status: 'approved' }),
      Executive.countDocuments({ status: 'rejected' }),
      Executive.countDocuments({ status: 'suspended' })
    ]);
    
    // Get regional distribution
    const regionalDistribution = await Executive.aggregate([
      { $match: { status: 'approved' } },
      {
        $group: {
          _id: {
            country: '$location.country',
            state: '$location.state'
          },
          count: { $sum: 1 },
          totalShares: { $sum: '$shareInfo.totalShares' }
        }
      },
      { $sort: { count: -1 } }
    ]);
    
    // Get top executives by shares
    const topExecutives = await Executive.find({ status: 'approved' })
      .populate('userId', 'name email')
      .select('userId shareInfo location')
      .sort({ 'shareInfo.totalShares': -1 })
      .limit(10);
    
    res.status(200).json({
      success: true,
      statistics: {
        total: totalExecutives,
        byStatus: {
          pending: pendingCount,
          approved: approvedCount,
          rejected: rejectedCount,
          suspended: suspendedCount
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
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};