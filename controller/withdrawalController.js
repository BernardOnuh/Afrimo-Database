// controller/withdrawalController.js
const User = require('../models/User');
const Referral = require('../models/Referral');
const ReferralTransaction = require('../models/ReferralTransaction');
const Withdrawal = require('../models/Withdrawal');
const Payment = require('../models/Payment');
const { sendEmail } = require('../utils/emailService');

/**
 * Request a withdrawal of referral earnings
 * @route POST /api/withdrawal/request
 * @access Private
 */
exports.requestWithdrawal = async (req, res) => {
  try {
    const userId = req.user.id;
    const { amount, paymentMethod, paymentDetails, notes } = req.body;

    // Basic validation
    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid withdrawal amount'
      });
    }

    if (!paymentMethod) {
      return res.status(400).json({
        success: false,
        message: 'Please select a payment method'
      });
    }

    // Check if user has enough balance
    const referralData = await Referral.findOne({ user: userId });
    if (!referralData || referralData.totalEarnings < amount) {
      return res.status(400).json({
        success: false,
        message: 'Insufficient balance for this withdrawal'
      });
    }

    // Check if user has verified payment details
    const paymentData = await Payment.findOne({ user: userId });
    
    // Validate payment details based on the selected method
    if (paymentMethod === 'bank') {
      if (!paymentDetails.bankName || !paymentDetails.accountName || !paymentDetails.accountNumber) {
        return res.status(400).json({
          success: false,
          message: 'Please provide complete bank details'
        });
      }
    } else if (paymentMethod === 'crypto') {
      if (!paymentDetails.cryptoType || !paymentDetails.walletAddress) {
        return res.status(400).json({
          success: false,
          message: 'Please provide complete crypto wallet details'
        });
      }
    } else if (paymentMethod === 'mobile_money') {
      if (!paymentDetails.mobileProvider || !paymentDetails.mobileNumber) {
        return res.status(400).json({
          success: false,
          message: 'Please provide complete mobile money details'
        });
      }
    }

    // Create a new withdrawal request
    const withdrawal = new Withdrawal({
      user: userId,
      amount,
      paymentMethod,
      paymentDetails,
      notes,
      status: 'pending'
    });

    await withdrawal.save();

    // Notify admin of new withdrawal request (optional)
    try {
      // Fetch user data for email
      const user = await User.findById(userId);
      
      await sendEmail({
        email: process.env.ADMIN_EMAIL || 'admin@afrimobile.com',
        subject: 'New Withdrawal Request',
        html: `
          <h2>New Withdrawal Request Submitted</h2>
          <p><strong>User:</strong> ${user.name} (${user.email})</p>
          <p><strong>Amount:</strong> $${amount}</p>
          <p><strong>Payment Method:</strong> ${paymentMethod}</p>
          <p>Please review this request in the admin dashboard.</p>
        `
      });
    } catch (emailError) {
      console.error('Failed to send admin notification email:', emailError);
      // Continue without failing the request
    }

    res.status(201).json({
      success: true,
      message: 'Withdrawal request submitted successfully',
      data: {
        id: withdrawal._id,
        amount: withdrawal.amount,
        status: withdrawal.status,
        createdAt: withdrawal.createdAt
      }
    });
  } catch (error) {
    console.error('Error requesting withdrawal:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process withdrawal request',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Get user's withdrawal history
 * @route GET /api/withdrawal/history
 * @access Private
 */
exports.getWithdrawalHistory = async (req, res) => {
  try {
    const userId = req.user.id;

    // Get all withdrawal requests for this user
    const withdrawals = await Withdrawal.find({ user: userId })
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: withdrawals.length,
      data: withdrawals
    });
  } catch (error) {
    console.error('Error fetching withdrawal history:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch withdrawal history',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Get user's current earnings balance
 * @route GET /api/withdrawal/balance
 * @access Private
 */
exports.getEarningsBalance = async (req, res) => {
  try {
    const userId = req.user.id;

    // Get the user's referral data
    const referralData = await Referral.findOne({ user: userId });
    
    // Calculate available balance
    let totalEarnings = 0;
    let pendingWithdrawals = 0;
    
    if (referralData) {
      totalEarnings = referralData.totalEarnings || 0;
    }
    
    // Calculate pending withdrawals
    const pending = await Withdrawal.find({
      user: userId,
      status: 'pending'
    });
    
    if (pending.length > 0) {
      pendingWithdrawals = pending.reduce((total, w) => total + w.amount, 0);
    }
    
    const withdrawnAmount = await Withdrawal.aggregate([
      { $match: { user: userId, status: { $in: ['approved', 'paid'] } } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    
    const totalWithdrawn = withdrawnAmount.length > 0 ? withdrawnAmount[0].total : 0;
    
    const availableBalance = totalEarnings - pendingWithdrawals - totalWithdrawn;

    res.status(200).json({
      success: true,
      data: {
        totalEarnings,
        pendingWithdrawals,
        totalWithdrawn,
        availableBalance
      }
    });
  } catch (error) {
    console.error('Error fetching earnings balance:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch earnings balance',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Get all pending withdrawal requests (Admin only)
 * @route GET /api/withdrawal/admin/pending
 * @access Private/Admin
 */
exports.getPendingWithdrawals = async (req, res) => {
  try {
    // Get all pending withdrawal requests
    const withdrawals = await Withdrawal.find({ status: 'pending' })
      .populate('user', 'name email userName')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: withdrawals.length,
      data: withdrawals
    });
  } catch (error) {
    console.error('Error fetching pending withdrawals:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch pending withdrawals',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Approve a withdrawal request (Admin only)
 * @route PUT /api/withdrawal/admin/approve/:id
 * @access Private/Admin
 */
exports.approveWithdrawal = async (req, res) => {
  try {
    const { id } = req.params;
    const { transactionReference, adminNotes } = req.body;
    const adminId = req.user.id;

    // Find the withdrawal request
    const withdrawal = await Withdrawal.findById(id);
    
    if (!withdrawal) {
      return res.status(404).json({
        success: false,
        message: 'Withdrawal request not found'
      });
    }
    
    // Ensure it's in a pending state
    if (withdrawal.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: `Cannot approve withdrawal in ${withdrawal.status} state`
      });
    }

    // Update the withdrawal status
    withdrawal.status = 'approved';
    withdrawal.processedBy = adminId;
    withdrawal.processedAt = new Date();
    withdrawal.transactionReference = transactionReference;
    if (adminNotes) withdrawal.adminNotes = adminNotes;
    
    await withdrawal.save();
    
    // Get user details for email notification
    const user = await User.findById(withdrawal.user);
    
    // Send notification email to user
    try {
      await sendEmail({
        email: user.email,
        subject: 'Withdrawal Request Approved',
        html: `
          <h2>Withdrawal Request Approved</h2>
          <p>Hello ${user.name},</p>
          <p>Your withdrawal request for $${withdrawal.amount} has been approved.</p>
          <p><strong>Transaction Reference:</strong> ${transactionReference || 'N/A'}</p>
          <p><strong>Status:</strong> Approved, pending payment</p>
          <p>You will receive your funds shortly according to your selected payment method.</p>
          <p>Thank you for using our platform!</p>
        `
      });
    } catch (emailError) {
      console.error('Failed to send approval email:', emailError);
      // Continue without failing the request
    }

    res.status(200).json({
      success: true,
      message: 'Withdrawal request approved successfully',
      data: withdrawal
    });
  } catch (error) {
    console.error('Error approving withdrawal:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to approve withdrawal request',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Mark a withdrawal as paid (Admin only)
 * @route PUT /api/withdrawal/admin/mark-paid/:id
 * @access Private/Admin
 */
exports.markWithdrawalAsPaid = async (req, res) => {
  try {
    const { id } = req.params;
    const { transactionReference, adminNotes } = req.body;
    const adminId = req.user.id;

    // Find the withdrawal request
    const withdrawal = await Withdrawal.findById(id);
    
    if (!withdrawal) {
      return res.status(404).json({
        success: false,
        message: 'Withdrawal request not found'
      });
    }
    
    // Ensure it's in an approved state
    if (withdrawal.status !== 'approved') {
      return res.status(400).json({
        success: false,
        message: `Cannot mark as paid a withdrawal in ${withdrawal.status} state`
      });
    }

    // Update the withdrawal status
    withdrawal.status = 'paid';
    withdrawal.processedBy = adminId;
    withdrawal.processedAt = new Date();
    if (transactionReference) withdrawal.transactionReference = transactionReference;
    if (adminNotes) withdrawal.adminNotes = (withdrawal.adminNotes ? withdrawal.adminNotes + '\n' : '') + adminNotes;
    
    await withdrawal.save();
    
    // Get user details for email notification
    const user = await User.findById(withdrawal.user);
    
    // Send notification email to user
    try {
      await sendEmail({
        email: user.email,
        subject: 'Withdrawal Payment Completed',
        html: `
          <h2>Withdrawal Payment Completed</h2>
          <p>Hello ${user.name},</p>
          <p>Your withdrawal request for $${withdrawal.amount} has been paid.</p>
          <p><strong>Transaction Reference:</strong> ${withdrawal.transactionReference || 'N/A'}</p>
          <p><strong>Status:</strong> Paid</p>
          <p>Thank you for using our platform!</p>
        `
      });
    } catch (emailError) {
      console.error('Failed to send payment email:', emailError);
      // Continue without failing the request
    }

    res.status(200).json({
      success: true,
      message: 'Withdrawal marked as paid successfully',
      data: withdrawal
    });
  } catch (error) {
    console.error('Error marking withdrawal as paid:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark withdrawal as paid',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Reject a withdrawal request (Admin only)
 * @route PUT /api/withdrawal/admin/reject/:id
 * @access Private/Admin
 */
exports.rejectWithdrawal = async (req, res) => {
  try {
    const { id } = req.params;
    const { rejectionReason, adminNotes } = req.body;
    const adminId = req.user.id;

    // Ensure rejection reason is provided
    if (!rejectionReason) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a reason for rejection'
      });
    }

    // Find the withdrawal request
    const withdrawal = await Withdrawal.findById(id);
    
    if (!withdrawal) {
      return res.status(404).json({
        success: false,
        message: 'Withdrawal request not found'
      });
    }
    
    // Ensure it's in a pending state
    if (withdrawal.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: `Cannot reject withdrawal in ${withdrawal.status} state`
      });
    }

    // Update the withdrawal status
    withdrawal.status = 'rejected';
    withdrawal.processedBy = adminId;
    withdrawal.processedAt = new Date();
    withdrawal.rejectionReason = rejectionReason;
    if (adminNotes) withdrawal.adminNotes = adminNotes;
    
    await withdrawal.save();
    
    // Get user details for email notification
    const user = await User.findById(withdrawal.user);
    
    // Send notification email to user
    try {
      await sendEmail({
        email: user.email,
        subject: 'Withdrawal Request Rejected',
        html: `
          <h2>Withdrawal Request Rejected</h2>
          <p>Hello ${user.name},</p>
          <p>Your withdrawal request for $${withdrawal.amount} has been rejected.</p>
          <p><strong>Reason:</strong> ${rejectionReason}</p>
          <p>If you have any questions, please contact our support team.</p>
        `
      });
    } catch (emailError) {
      console.error('Failed to send rejection email:', emailError);
      // Continue without failing the request
    }

    res.status(200).json({
      success: true,
      message: 'Withdrawal request rejected successfully',
      data: withdrawal
    });
  } catch (error) {
    console.error('Error rejecting withdrawal:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reject withdrawal request',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Get all withdrawals (Admin only)
 * @route GET /api/withdrawal/admin/history
 * @access Private/Admin
 */
exports.getAllWithdrawals = async (req, res) => {
  try {
    // Support filtering by status
    const { status, userId, startDate, endDate } = req.query;
    
    // Build query
    const query = {};
    
    if (status) {
      query.status = status;
    }
    
    if (userId) {
      query.user = userId;
    }
    
    // Date range filter
    if (startDate || endDate) {
      query.createdAt = {};
      
      if (startDate) {
        query.createdAt.$gte = new Date(startDate);
      }
      
      if (endDate) {
        query.createdAt.$lte = new Date(endDate);
      }
    }
    
    // Pagination
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 20;
    const skip = (page - 1) * limit;
    
    // Get all withdrawal requests with pagination
    const withdrawals = await Withdrawal.find(query)
      .populate('user', 'name email userName')
      .populate('processedBy', 'name userName')
      .skip(skip)
      .limit(limit)
      .sort({ createdAt: -1 });
      
    // Get total count for pagination
    const total = await Withdrawal.countDocuments(query);

    res.status(200).json({
      success: true,
      count: withdrawals.length,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      data: withdrawals
    });
  } catch (error) {
    console.error('Error fetching all withdrawals:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch withdrawals',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

module.exports = exports;