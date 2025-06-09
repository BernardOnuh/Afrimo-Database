// controller/installmentController.js
const Share = require('../models/Share');
const InstallmentPlan = require('../models/InstallmentPlan');
const UserShare = require('../models/UserShare');
const User = require('../models/User');
const crypto = require('crypto');
const axios = require('axios');
const { sendEmail } = require('../utils/emailService');
const { processReferralCommission } = require('../utils/referralUtils');

// Generate a unique transaction ID
const generateTransactionId = () => {
  return `INST-${crypto.randomBytes(4).toString('hex').toUpperCase()}-${Date.now().toString().slice(-6)}`;
};

// Input validation middleware
const validateInstallmentInput = (req, res, next) => {
  const { quantity, currency, installmentMonths = 5 } = req.body;
  
  if (!quantity || !currency || !['naira', 'usdt'].includes(currency)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid request. Please provide valid quantity, currency (naira or usdt), and installment months.'
    });
  }

  const parsedQuantity = Math.floor(Number(quantity));
  if (parsedQuantity !== 1) {
    return res.status(400).json({
      success: false,
      message: 'Installment plans are only available for exactly 1 share. Complete this plan first before starting another.'
    });
  }

  if (installmentMonths < 2 || installmentMonths > 12) {
    return res.status(400).json({
      success: false,
      message: 'Installment plan must be between 2 and 12 months'
    });
  }

  next();
};

/**
 * @desc    Calculate installment plan
 * @route   POST /api/shares/installment/calculate
 * @access  Private (User)
 */
exports.calculateInstallmentPlan = async (req, res) => {
  try {
    const { quantity, currency, installmentMonths = 5 } = req.body;
    
    // Calculate purchase details
    const purchaseDetails = await Share.calculatePurchase(quantity, currency);
    
    if (!purchaseDetails.success) {
      return res.status(400).json({
        success: false,
        message: 'Unable to process this purchase amount.',
        details: purchaseDetails
      });
    }
    
    // Calculate minimum down payment (20% of total price)
    const minimumDownPaymentAmount = purchaseDetails.totalPrice * 0.2;
    const installmentAmount = purchaseDetails.totalPrice / installmentMonths;
    const installmentPercentage = 100 / installmentMonths;
    const lateFee = 0.34; // 0.34% late fee per month
    
    // Calculate due dates - MAINTAIN THE CREATION DAY
    const startDate = new Date();
    const creationDay = startDate.getDate(); // Store the day of creation
    
    const monthlyPayments = Array.from({ length: installmentMonths }, (_, i) => {
      const dueDate = new Date(startDate.getFullYear(), startDate.getMonth() + i + 1, creationDay);
      
      // Handle edge case where the target month doesn't have the same day
      // (e.g., created on Jan 31, but Feb only has 28/29 days)
      if (dueDate.getDate() !== creationDay) {
        // The date rolled over to next month, so set to last day of target month
        dueDate.setDate(0); // Go back to last day of previous month
      }
      
      return {
        installmentNumber: i + 1,
        amount: installmentAmount,
        dueDate,
        percentageOfTotal: installmentPercentage,
        sharesReleased: Math.floor(purchaseDetails.totalShares * (installmentPercentage / 100)),
        isFirstPayment: i === 0
      };
    });
    
    res.status(200).json({
      success: true,
      installmentPlan: {
        totalShares: purchaseDetails.totalShares,
        totalPrice: purchaseDetails.totalPrice,
        currency,
        installmentMonths,
        minimumDownPaymentAmount,
        minimumDownPaymentPercentage: 20,
        installmentAmount,
        installmentPercentage,
        lateFeePercentage: lateFee,
        monthlyPayments,
        tierBreakdown: purchaseDetails.tierBreakdown,
        note: "First payment must be at least 20% of total price. Subsequent payments can be flexible amounts using Paystack."
      }
    });
    
  } catch (error) {
    console.error('Error calculating installment plan:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to calculate installment plan',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};


/**
 * @desc    Create new installment plan
 * @route   POST /api/shares/installment/create
 * @access  Private (User)
 */
exports.createInstallmentPlan = async (req, res) => {
  const session = await InstallmentPlan.startSession();
  session.startTransaction();
  
  try {
    const { quantity, currency, installmentMonths = 5 } = req.body;
    const userId = req.user.id;
    
    // Check if user already has an active installment plan
    const existingPlan = await InstallmentPlan.findOne({
      user: userId,
      status: { $in: ['active', 'pending'] }
    }).session(session);
    
    if (existingPlan) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: 'You already have an active installment plan. Please complete or cancel it before starting a new one.',
        planId: existingPlan._id
      });
    }
    
    // Calculate purchase details
    const purchaseDetails = await Share.calculatePurchase(quantity, currency);
    
    if (!purchaseDetails.success) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: 'Unable to process this purchase amount.',
        details: purchaseDetails
      });
    }
    
    // Generate plan ID
    const planId = generateTransactionId();
    const minimumDownPaymentAmount = purchaseDetails.totalPrice * 0.2;
    const installmentAmount = purchaseDetails.totalPrice / installmentMonths;
    const installmentPercentage = 100 / installmentMonths;
    const lateFee = 0.34;
    
    const startDate = new Date();
    const creationDay = startDate.getDate(); // Store the day of creation
    const installments = [];
    
    for (let i = 0; i < installmentMonths; i++) {
      const dueDate = new Date(startDate.getFullYear(), startDate.getMonth() + i + 1, creationDay);
      
      // Handle edge case where the target month doesn't have the same day
      if (dueDate.getDate() !== creationDay) {
        // The date rolled over to next month, so set to last day of target month
        dueDate.setDate(0); // Go back to last day of previous month
      }
      
      const sharesReleased = Math.floor(purchaseDetails.totalShares * (installmentPercentage / 100));
      
      installments.push({
        installmentNumber: i + 1,
        amount: installmentAmount,
        dueDate,
        status: i === 0 ? 'pending' : 'upcoming',
        percentageOfTotal: installmentPercentage,
        sharesReleased,
        lateFee: 0,
        paidAmount: 0,
        paidDate: null,
        isFirstPayment: i === 0,
        minimumAmount: i === 0 ? minimumDownPaymentAmount : 0
      });
    }
    
    // Create installment plan
    const newPlan = new InstallmentPlan({
      planId,
      user: userId,
      totalShares: purchaseDetails.totalShares,
      totalPrice: purchaseDetails.totalPrice,
      currency,
      installmentMonths,
      minimumDownPaymentAmount,
      minimumDownPaymentPercentage: 20,
      lateFeePercentage: lateFee,
      status: 'pending',
      createdAt: startDate,
      updatedAt: startDate,
      tierBreakdown: purchaseDetails.tierBreakdown,
      installments,
      sharesReleased: 0,
      totalPaidAmount: 0
    });
    
    await newPlan.save({ session });
    await session.commitTransaction();
    session.endSession();
    
    res.status(201).json({
      success: true,
      message: 'Installment plan created successfully',
      planId,
      plan: {
        totalShares: purchaseDetails.totalShares,
        totalPrice: purchaseDetails.totalPrice,
        currency,
        installmentMonths,
        minimumDownPaymentAmount,
        minimumDownPaymentPercentage: 20,
        firstPaymentDue: installments[0].dueDate,
        installmentAmount,
        status: 'pending',
        note: "First payment must be at least 20% of total price. Use Paystack to make payments."
      }
    });
    
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error('Error creating installment plan:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create installment plan',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Admin: Check for late payments with monthly penalty
 * @route   POST /api/shares/installment/admin/check-late-payments
 * @access  Private (Admin or System)
 */
exports.checkLatePayments = async (req, res) => {
  try {
    // Check admin access if request from user
    if (req.user) {
      const admin = await User.findById(req.user.id);
      if (!admin?.isAdmin) {
        return res.status(403).json({
          success: false,
          message: 'Unauthorized: Admin access required'
        });
      }
    }
    
    // Get all active installment plans
    const activePlans = await InstallmentPlan.find({
      status: { $in: ['active', 'pending', 'late'] }
    });
    
    const now = new Date();
    let latePaymentsFound = 0;
    const lateFeeCapPercentage = 5; // Cap late fees at 5% of total price
    
    for (const plan of activePlans) {
      let planUpdated = false;
      
      // Get last payment date from installments
      const lastPaidInstallment = plan.installments
        .filter(inst => inst.status === 'completed')
        .sort((a, b) => new Date(b.paidDate) - new Date(a.paidDate))[0];
      
      const lastPaymentDate = lastPaidInstallment 
        ? new Date(lastPaidInstallment.paidDate).getTime()
        : new Date(plan.createdAt).getTime();
      
      const daysSinceLastPayment = Math.floor((now - lastPaymentDate) / (1000 * 60 * 60 * 24));
      
      // Check if payment is late (more than 30 days)
      if (daysSinceLastPayment > 30 && plan.totalPaidAmount < plan.totalPrice) {
        const monthsLate = Math.floor(daysSinceLastPayment / 30);
        
        // Calculate late fee with cap
        const remainingBalance = plan.totalPrice - plan.totalPaidAmount;
        const lateFeePercentage = Math.min(plan.lateFeePercentage || 0.34, lateFeeCapPercentage);
        const monthlyLateFee = (remainingBalance * lateFeePercentage) / 100;
        const totalLateFee = monthlyLateFee * monthsLate;
        const maxAllowedLateFee = (plan.totalPrice * lateFeeCapPercentage) / 100;
        const cappedLateFee = Math.min(totalLateFee, maxAllowedLateFee);
        
        // Update plan if late fee changed
        if (!plan.currentLateFee || plan.currentLateFee < cappedLateFee) {
          plan.currentLateFee = cappedLateFee;
          plan.monthsLate = monthsLate;
          plan.status = 'late';
          plan.lastLateCheckDate = now;
          planUpdated = true;
          latePaymentsFound++;
          
          // Notify user
          try {
            const user = await User.findById(plan.user);
            if (user?.email) {
              await sendEmail({
                email: user.email,
                subject: 'Late Payment Notice - Installment Plan',
                html: `
                  <h2>Late Payment Notice</h2>
                  <p>Dear ${user.name},</p>
                  <p>We noticed that your installment plan ${plan.planId} has a late payment.</p>
                  <p>Days Since Last Payment: ${daysSinceLastPayment}</p>
                  <p>Months Late: ${monthsLate}</p>
                  <p>Remaining Balance: ${plan.currency === 'naira' ? '₦' : '$'}${remainingBalance.toFixed(2)}</p>
                  <p>Late Fee: ${plan.currency === 'naira' ? '₦' : '$'}${cappedLateFee.toFixed(2)} (${lateFeePercentage}% per month)</p>
                  <p>Total Amount Due: ${plan.currency === 'naira' ? '₦' : '$'}${(remainingBalance + cappedLateFee).toFixed(2)}</p>
                  <p>Please make a payment as soon as possible using Paystack to avoid additional late fees.</p>
                `
              });
            }
          } catch (emailError) {
            console.error('Failed to send late payment notification:', emailError);
          }
        }
      }
      
      // Save plan if updated
      if (planUpdated) {
        plan.updatedAt = now;
        await plan.save();
      }
    }
    
    res.status(200).json({
      success: true,
      message: `Late payment check completed: ${latePaymentsFound} late payments found and processed`,
      latePaymentsFound
    });
    
  } catch (error) {
    console.error('Error checking late payments:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to check late payments',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Get user's installment plans
 * @route   GET /api/shares/installment/plans
 * @access  Private (User)
 */
exports.getUserInstallmentPlans = async (req, res) => {
  try {
    const userId = req.user.id;
    const { page = 1, limit = 10 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    // Get plans with pagination
    const [plans, totalCount] = await Promise.all([
      InstallmentPlan.find({
        user: userId,
        $or: [
          { status: { $in: ['active', 'pending', 'late'] } },
          { 
            status: 'completed',
            updatedAt: { $gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) }
          },
          {
            status: 'cancelled',
            updatedAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
          }
        ]
      })
      .skip(skip)
      .limit(parseInt(limit))
      .sort({ createdAt: -1 }),
      
      InstallmentPlan.countDocuments({
        user: userId,
        $or: [
          { status: { $in: ['active', 'pending', 'late'] } },
          { 
            status: 'completed',
            updatedAt: { $gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) }
          }
        ]
      })
    ]);
    
    // Format response
    const formattedPlans = plans.map(plan => ({
      planId: plan.planId,
      status: plan.status,
      totalShares: plan.totalShares,
      totalPrice: plan.totalPrice,
      currency: plan.currency,
      installmentMonths: plan.installmentMonths,
      minimumDownPaymentAmount: plan.minimumDownPaymentAmount,
      minimumDownPaymentPercentage: plan.minimumDownPaymentPercentage,
      sharesReleased: plan.sharesReleased,
      remainingShares: plan.totalShares - plan.sharesReleased,
      totalPaidAmount: plan.totalPaidAmount || 0,
      remainingBalance: plan.totalPrice - (plan.totalPaidAmount || 0),
      currentLateFee: plan.currentLateFee || 0,
      monthsLate: plan.monthsLate || 0,
      installments: plan.installments.map(installment => ({
        installmentNumber: installment.installmentNumber,
        amount: installment.amount,
        dueDate: installment.dueDate,
        status: installment.status,
        percentageOfTotal: installment.percentageOfTotal,
        lateFee: installment.lateFee,
        paidAmount: installment.paidAmount,
        paidDate: installment.paidDate,
        transactionId: installment.transactionId || null
      })),
      createdAt: plan.createdAt,
      updatedAt: plan.updatedAt
    }));
    
    res.status(200).json({
      success: true,
      plans: formattedPlans,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalCount / parseInt(limit)),
        totalCount
      }
    });
    
  } catch (error) {
    console.error('Error fetching user installment plans:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch installment plans',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Cancel installment plan (only if minimum payment completed)
 * @route   POST /api/shares/installment/cancel
 * @access  Private (User)
 */
exports.cancelInstallmentPlan = async (req, res) => {
  const session = await InstallmentPlan.startSession();
  session.startTransaction();
  
  try {
    const { planId, reason } = req.body;
    const userId = req.user.id;
    
    if (!planId) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: 'Please provide planId'
      });
    }
    
    // Find the installment plan
    const plan = await InstallmentPlan.findOne({
      planId,
      user: userId
    }).session(session);
    
    if (!plan) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: 'Installment plan not found'
      });
    }
    
    // Validate plan status
    if (plan.status === 'cancelled') {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: 'This installment plan is already cancelled'
      });
    }
    
    if (plan.status === 'completed') {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: 'Cannot cancel a completed installment plan'
      });
    }
    
    // Check minimum down payment
    if (plan.totalPaidAmount < plan.minimumDownPaymentAmount) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: `You cannot cancel the plan before completing the minimum down payment of ${plan.currency === 'naira' ? '₦' : '$'}${plan.minimumDownPaymentAmount.toFixed(2)} (20%)`
      });
    }
    
    // Update plan status
    plan.status = 'cancelled';
    plan.cancellationReason = reason || 'Cancelled by user';
    plan.updatedAt = new Date();
    await plan.save({ session });
    
    // Get user details
    const user = await User.findById(userId);
    
    // Notify admin
    try {
      const adminEmail = process.env.ADMIN_EMAIL || 'admin@afrimobile.com';
      await sendEmail({
        email: adminEmail,
        subject: 'Installment Plan Cancelled',
        html: `
          <h2>Installment Plan Cancellation Notice</h2>
          <p>An installment plan has been cancelled by a user:</p>
          <ul>
            <li>User: ${user.name} (${user.email})</li>
            <li>Plan ID: ${planId}</li>
            <li>Total Shares: ${plan.totalShares}</li>
            <li>Total Price: ${plan.currency === 'naira' ? '₦' : '$'}${plan.totalPrice.toFixed(2)}</li>
            <li>Amount Paid: ${plan.currency === 'naira' ? '₦' : '$'}${plan.totalPaidAmount.toFixed(2)}</li>
            <li>Shares Released: ${plan.sharesReleased}</li>
            <li>Reason: ${reason || 'Not provided'}</li>
          </ul>
        `
      });
    } catch (emailError) {
      console.error('Failed to send admin notification:', emailError);
    }
    
    // Send confirmation to user
    if (user?.email) {
      try {
        await sendEmail({
          email: user.email,
          subject: 'Installment Plan Cancellation Confirmation',
          html: `
            <h2>Installment Plan Cancellation</h2>
            <p>Dear ${user.name},</p>
            <p>Your installment plan (ID: ${planId}) has been cancelled as requested.</p>
            <p>Total Price: ${plan.currency === 'naira' ? '₦' : '$'}${plan.totalPrice.toFixed(2)}</p>
            <p>Amount Paid: ${plan.currency === 'naira' ? '₦' : '$'}${plan.totalPaidAmount.toFixed(2)}</p>
            <p>Shares Already Released: ${plan.sharesReleased}</p>
            <p>The shares you have already received will remain in your account.</p>
          `
        });
      } catch (emailError) {
        console.error('Failed to send cancellation email:', emailError);
      }
    }
    
    await session.commitTransaction();
    session.endSession();
    
    res.status(200).json({
      success: true,
      message: 'Installment plan cancelled successfully',
      data: {
        planId,
        status: 'cancelled',
        sharesReleased: plan.sharesReleased,
        amountPaid: plan.totalPaidAmount
      }
    });
    
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error('Error cancelling installment plan:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to cancel installment plan',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Admin: Get all installment plans
 * @route   GET /api/shares/installment/admin/plans
 * @access  Private (Admin)
 */
exports.adminGetAllInstallmentPlans = async (req, res) => {
  try {
    const adminId = req.user.id;
    
    // Check admin privileges
    const admin = await User.findById(adminId);
    if (!admin || !admin.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized: Admin access required'
      });
    }
    
    // Query parameters
    const { status, page = 1, limit = 20, userId } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    // Build query
    const query = {};
    if (status && ['pending', 'active', 'late', 'completed', 'cancelled'].includes(status)) {
      query.status = status;
    }
    if (userId) {
      query.user = userId;
    }
    
    // Get installment plans with pagination
    const [plans, totalCount] = await Promise.all([
      InstallmentPlan.find(query)
        .skip(skip)
        .limit(parseInt(limit))
        .sort({ updatedAt: -1 })
        .populate('user', 'name email phone'),
      
      InstallmentPlan.countDocuments(query)
    ]);
    
    // Format response
    const formattedPlans = plans.map(plan => ({
      planId: plan.planId,
      user: {
        id: plan.user._id,
        name: plan.user.name,
        email: plan.user.email,
        phone: plan.user.phone
      },
      status: plan.status,
      totalShares: plan.totalShares,
      totalPrice: plan.totalPrice,
      currency: plan.currency,
      installmentMonths: plan.installmentMonths,
      minimumDownPaymentAmount: plan.minimumDownPaymentAmount,
      minimumDownPaymentPercentage: plan.minimumDownPaymentPercentage,
      sharesReleased: plan.sharesReleased,
      remainingShares: plan.totalShares - plan.sharesReleased,
      totalPaidAmount: plan.totalPaidAmount || 0,
      remainingBalance: plan.totalPrice - (plan.totalPaidAmount || 0),
      currentLateFee: plan.currentLateFee || 0,
      monthsLate: plan.monthsLate || 0,
      lateFeePercentage: plan.lateFeePercentage,
      createdAt: plan.createdAt,
      updatedAt: plan.updatedAt,
      installments: plan.installments.map(installment => ({
        installmentNumber: installment.installmentNumber,
        amount: installment.amount,
        dueDate: installment.dueDate,
        status: installment.status,
        percentageOfTotal: installment.percentageOfTotal,
        lateFee: installment.lateFee,
        paidAmount: installment.paidAmount,
        paidDate: installment.paidDate,
        transactionId: installment.transactionId || null,
        adminNote: installment.adminNote
      }))
    }));
    
    // Return response
    res.status(200).json({
      success: true,
      plans: formattedPlans,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalCount / parseInt(limit)),
        totalCount
      }
    });
    
  } catch (error) {
    console.error('Error fetching installment plans:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch installment plans',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Pay installment with Paystack (FIXED VERSION)
 * @route   POST /api/shares/installment/paystack/pay
 * @access  Private (User)
 */
exports.payInstallmentWithPaystack = async (req, res) => {
  const session = await InstallmentPlan.startSession();
  session.startTransaction();
  
  try {
    const { planId, installmentNumber, amount, email } = req.body;
    const userId = req.user.id;
    
    // Validate input
    if (!planId || !installmentNumber || !amount || !email) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: 'Please provide planId, installmentNumber, amount, and email'
      });
    }
    
    // Find the installment plan
    const plan = await InstallmentPlan.findOne({
      planId,
      user: userId
    }).session(session);
    
    if (!plan) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: 'Installment plan not found'
      });
    }
    
    // Check plan status
    if (plan.status === 'cancelled') {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: 'This installment plan has been cancelled'
      });
    }
    
    if (plan.status === 'completed') {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: 'This installment plan has been completed'
      });
    }
    
    // Validate installment number
    const installmentIndex = parseInt(installmentNumber) - 1;
    if (installmentIndex < 0 || installmentIndex >= plan.installments.length) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: 'Invalid installment number'
      });
    }
    
    const installment = plan.installments[installmentIndex];
    
    // Check if installment is already completed
    if (installment.status === 'completed') {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: 'This installment has already been paid'
      });
    }
    
    // Validate payment amount
    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: 'Invalid payment amount'
      });
    }
    
    // Check if this is first payment and meets minimum requirement
    if (installment.isFirstPayment && parsedAmount < plan.minimumDownPaymentAmount) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: `First payment must be at least ${plan.currency === 'naira' ? '₦' : '$'}${plan.minimumDownPaymentAmount.toFixed(2)} (20% of total price)`
      });
    }
    
    // Check if payment exceeds remaining balance
    const remainingBalance = plan.totalPrice - plan.totalPaidAmount;
    if (parsedAmount > remainingBalance) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: `Payment amount cannot exceed remaining balance of ${plan.currency === 'naira' ? '₦' : '$'}${remainingBalance.toFixed(2)}`
      });
    }
    
    // Generate unique transaction reference for Paystack
    const paystackReference = generateTransactionId();
    
    // Initialize Paystack payment
    const paystackResponse = await axios.post(
      'https://api.paystack.co/transaction/initialize',
      {
        email,
        amount: parsedAmount * 100, // Convert to kobo
        currency: plan.currency === 'naira' ? 'NGN' : 'USD',
        reference: paystackReference, // Use generated reference
        callback_url: `${process.env.FRONTEND_URL}/installment/verify?planId=${planId}`,
        metadata: {
          planId,
          installmentNumber,
          userId,
          // Don't include transactionId in metadata - use the reference itself
        }
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    // FIXED: Store the Paystack reference directly as transactionId
    installment.transactionId = paystackReference;
    installment.status = 'pending'; // Valid enum value
    installment.paymentInitialized = true;
    installment.paymentInitializedAt = new Date();
    
    plan.updatedAt = new Date();
    await plan.save({ session });
    
    await session.commitTransaction();
    session.endSession();
    
    res.status(200).json({
      success: true,
      message: 'Paystack payment initialized',
      data: {
        authorizationUrl: paystackResponse.data.data.authorization_url,
        accessCode: paystackResponse.data.data.access_code,
        reference: paystackResponse.data.data.reference,
        amount: parsedAmount,
        currency: plan.currency,
        planId,
        installmentNumber
      }
    });
    
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    
    console.error('Error initializing Paystack payment:', error);
    
    let errorMessage = 'Failed to initialize Paystack payment';
    if (error.response?.data?.message) {
      errorMessage = error.response.data.message;
    }
    
    res.status(500).json({
      success: false,
      message: errorMessage,
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};
/**
 * @desc    Verify Paystack installment payment (FIXED VERSION)
 * @route   GET /api/shares/installment/paystack/verify
 * @access  Private (User)
 */
exports.verifyInstallmentPaystack = async (req, res) => {
  const session = await InstallmentPlan.startSession();
  session.startTransaction();
  
  try {
    const { reference } = req.query;
    
    if (!reference) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: 'Please provide payment reference'
      });
    }

    console.log(`🔍 Verifying payment with reference: ${reference}`);
    
    // Verify payment with Paystack first
    const verificationResponse = await axios.get(
      `https://api.paystack.co/transaction/verify/${reference}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`
        }
      }
    );
    
    const paymentData = verificationResponse.data.data;
    console.log(`💳 Paystack verification response:`, paymentData);
    
    // Check if payment was successful
    if (paymentData.status !== 'success') {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: 'Payment verification failed',
        data: paymentData
      });
    }
    
    // Get metadata
    const { planId, installmentNumber, userId } = paymentData.metadata;
    
    if (!planId || !installmentNumber || !userId) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: 'Invalid payment metadata. Missing required fields.',
        receivedMetadata: paymentData.metadata
      });
    }

    // Verify user from metadata instead of req.user
    const user = await User.findById(userId);
    if (!user) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // If req.user exists, verify it matches the payment user
    if (req.user && req.user.id !== userId) {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({
        success: false,
        message: 'Payment verification failed: User mismatch'
      });
    }
    
    // Find the installment plan using userId from metadata
    const plan = await InstallmentPlan.findOne({
      planId,
      user: userId
    }).session(session);
    
    if (!plan) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: `Installment plan not found for planId: ${planId} and userId: ${userId}`
      });
    }
    
    // Find the installment
    const installmentIndex = parseInt(installmentNumber) - 1;
    if (installmentIndex < 0 || installmentIndex >= plan.installments.length) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: `Invalid installment number: ${installmentNumber}. Plan has ${plan.installments.length} installments.`
      });
    }
    
    const installment = plan.installments[installmentIndex];
    
    // FIXED: More flexible transaction matching logic
    // Check if this installment can accept this payment
    const canAcceptPayment = (
      // Case 1: Exact transaction ID match
      installment.transactionId === reference ||
      
      // Case 2: Installment is pending and has no completed payment
      (installment.status === 'pending' && !installment.paidAmount) ||
      
      // Case 3: Installment status is upcoming and no transaction recorded yet
      (installment.status === 'upcoming' && !installment.transactionId) ||
      
      // Case 4: Payment was initialized but not completed (has transactionId but status not completed)
      (installment.transactionId && installment.status !== 'completed')
    );

    if (!canAcceptPayment) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: 'This installment cannot accept this payment',
        details: {
          installmentStatus: installment.status,
          installmentTransactionId: installment.transactionId,
          paymentReference: reference,
          alreadyPaid: installment.paidAmount > 0
        }
      });
    }

    // Check if installment is already completed with a different transaction
    if (installment.status === 'completed' && installment.transactionId !== reference) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: 'This installment has already been completed with a different transaction',
        data: {
          planId: plan.planId,
          installmentNumber,
          status: 'already_completed',
          paidAmount: installment.paidAmount,
          paidDate: installment.paidDate,
          existingTransactionId: installment.transactionId,
          currentReference: reference
        }
      });
    }

    // Check for duplicate payment across all installments in the plan
    const existingPayment = plan.installments.find(inst => 
      inst.transactionId === reference && inst.status === 'completed'
    );
    
    if (existingPayment && existingPayment !== installment) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: 'This payment reference has already been used for another installment',
        data: {
          planId: plan.planId,
          existingInstallmentNumber: existingPayment.installmentNumber,
          currentInstallmentNumber: installmentNumber,
          reference: reference
        }
      });
    }
    
    // Convert amount from kobo to currency unit
    const amount = paymentData.amount / 100;
    
    console.log(`💰 Processing payment: ${amount} ${plan.currency} for installment ${installmentNumber}`);
    
    // Validate payment amount for first payment
    if (installment.isFirstPayment && amount < plan.minimumDownPaymentAmount) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: `First payment amount is below minimum requirement of ${plan.currency === 'naira' ? '₦' : '$'}${plan.minimumDownPaymentAmount.toFixed(2)}`,
        provided: amount,
        required: plan.minimumDownPaymentAmount
      });
    }
    
    // Check if payment exceeds remaining balance
    const remainingBalance = plan.totalPrice - (plan.totalPaidAmount || 0);
    if (amount > remainingBalance) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: `Payment amount cannot exceed remaining balance of ${plan.currency === 'naira' ? '₦' : '$'}${remainingBalance.toFixed(2)}`,
        providedAmount: amount,
        remainingBalance: remainingBalance
      });
    }
    
    // Update installment payment - FIXED: Use the payment reference as transaction ID
    installment.status = 'completed';
    installment.paidAmount = amount;
    installment.paidDate = new Date(paymentData.paid_at);
    installment.transactionId = reference; // Use Paystack reference as transaction ID
    
    // Update plan totals
    plan.totalPaidAmount = (plan.totalPaidAmount || 0) + amount;
    
    // Update plan status if first payment
    if (plan.status === 'pending' && installment.isFirstPayment) {
      plan.status = 'active';
      console.log(`📈 Plan status updated to active`);
    }
    
    // Calculate shares to release
    const paymentPercentage = (amount / plan.totalPrice) * 100;
    const sharesToRelease = Math.floor(plan.totalShares * (paymentPercentage / 100));
    plan.sharesReleased = (plan.sharesReleased || 0) + sharesToRelease;
    
    console.log(`🎯 Releasing ${sharesToRelease} shares (${paymentPercentage.toFixed(2)}% of total)`);
    
    // Check if plan is completed
    if (plan.totalPaidAmount >= plan.totalPrice) {
      plan.status = 'completed';
      console.log(`✅ Plan completed! Total paid: ${plan.totalPaidAmount} of ${plan.totalPrice}`);
    }
    
    // Update plan timestamp
    plan.updatedAt = new Date();
    
    // Save plan updates
    await plan.save({ session });
    
    // Add released shares to user's account if applicable
    if (sharesToRelease > 0) {
      await UserShare.addShares(plan.user, sharesToRelease, {
        transactionId: reference, // Use Paystack reference
        shares: sharesToRelease,
        pricePerShare: amount / sharesToRelease,
        currency: plan.currency,
        totalAmount: amount,
        paymentMethod: 'paystack',
        status: 'completed',
        tierBreakdown: {
          tier1: Math.floor((plan.tierBreakdown?.tier1 || 0) * (paymentPercentage / 100)),
          tier2: Math.floor((plan.tierBreakdown?.tier2 || 0) * (paymentPercentage / 100)),
          tier3: Math.floor((plan.tierBreakdown?.tier3 || 0) * (paymentPercentage / 100))
        },
        installmentPayment: true,
        installmentPlanId: plan.planId
      }, { session });
      
      // Update global share sales
      const Share = require('../models/Share');
      const shareConfig = await Share.getCurrentConfig();
      shareConfig.sharesSold = (shareConfig.sharesSold || 0) + sharesToRelease;
      
      const tier1Shares = Math.floor((plan.tierBreakdown?.tier1 || 0) * (paymentPercentage / 100));
      const tier2Shares = Math.floor((plan.tierBreakdown?.tier2 || 0) * (paymentPercentage / 100));
      const tier3Shares = Math.floor((plan.tierBreakdown?.tier3 || 0) * (paymentPercentage / 100));
      
      if (!shareConfig.tierSales) {
        shareConfig.tierSales = { tier1Sold: 0, tier2Sold: 0, tier3Sold: 0 };
      }
      
      shareConfig.tierSales.tier1Sold = (shareConfig.tierSales.tier1Sold || 0) + tier1Shares;
      shareConfig.tierSales.tier2Sold = (shareConfig.tierSales.tier2Sold || 0) + tier2Shares;
      shareConfig.tierSales.tier3Sold = (shareConfig.tierSales.tier3Sold || 0) + tier3Shares;
      
      await shareConfig.save({ session });
      
      // Process referral commissions
      try {
        await processReferralCommission(
          plan.user,
          amount,
          'share',
          reference, // Use Paystack reference
          { session }
        );
      } catch (referralError) {
        console.error('💥 Error processing referral commissions:', referralError);
        // Don't fail the whole transaction for referral errors
      }
    }
    
    await session.commitTransaction();
    session.endSession();
    
    console.log(`🎉 Payment verification completed successfully`);
    
    // Send confirmation email
    if (user?.email) {
      try {
        await sendEmail({
          email: user.email,
          subject: 'Installment Payment Confirmation',
          html: `
            <h2>Payment Successful</h2>
            <p>Dear ${user.name},</p>
            <p>Your installment payment for plan ${plan.planId} has been successfully processed.</p>
            <p>Transaction Reference: ${reference}</p>
            <p>Amount Paid: ${plan.currency === 'naira' ? '₦' : '$'}${amount.toFixed(2)}</p>
            <p>Shares Released: ${sharesToRelease}</p>
            <p>Total Shares Released: ${plan.sharesReleased} of ${plan.totalShares}</p>
            <p>Remaining Balance: ${plan.currency === 'naira' ? '₦' : '$'}${(plan.totalPrice - plan.totalPaidAmount).toFixed(2)}</p>
            ${plan.status === 'completed' ? 
              `<p>Congratulations! You have completed your installment plan.</p>` : 
              `<p>You can make your next payment at any time using Paystack.</p>`}
          `
        });
      } catch (emailError) {
        console.error('📧 Failed to send confirmation email:', emailError);
      }
    }
    
    res.status(200).json({
      success: true,
      message: 'Payment verified successfully',
      data: {
        planId: plan.planId,
        amount,
        status: 'completed',
        planStatus: plan.status,
        totalPaidAmount: plan.totalPaidAmount,
        remainingBalance: plan.totalPrice - plan.totalPaidAmount,
        sharesReleased: sharesToRelease,
        totalSharesReleased: plan.sharesReleased,
        transactionId: reference
      }
    });
    
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    
    console.error('💥 Error verifying Paystack payment:', error);
    
    let errorMessage = 'Failed to verify payment';
    let statusCode = 500;
    
    if (error.response?.status === 404) {
      errorMessage = 'Payment reference not found with Paystack';
      statusCode = 404;
    } else if (error.response?.status === 400) {
      errorMessage = 'Invalid payment reference';
      statusCode = 400;
    } else if (error.response?.data?.message) {
      errorMessage = error.response.data.message;
      statusCode = error.response.status || 500;
    }
    
    res.status(statusCode).json({
      success: false,
      message: errorMessage,
      error: process.env.NODE_ENV === 'development' ? {
        message: error.message,
        stack: error.stack,
        response: error.response?.data
      } : undefined
    });
  }
};

/**
 * @desc    Admin: Unverify/Reverse a completed installment payment
 * @route   POST /api/shares/installment/admin/unverify-transaction
 * @access  Private (Admin only)
 */
exports.adminUnverifyTransaction = async (req, res) => {
  const session = await InstallmentPlan.startSession();
  session.startTransaction();
  
  try {
    const { reference, planId, installmentNumber, adminNote, confirmUnverify = false } = req.body;
    const adminId = req.user.id;
    
    // Check admin privileges
    const admin = await User.findById(adminId);
    if (!admin || !admin.isAdmin) {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({
        success: false,
        message: 'Unauthorized: Admin access required'
      });
    }
    
    if (!reference && !planId) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: 'Please provide either payment reference or planId with installmentNumber'
      });
    }

    console.log(`❌ Admin ${admin.name} unverifying transaction: ${reference || `${planId}-${installmentNumber}`}`);
    
    let plan;
    let targetInstallment;
    let targetInstallmentIndex;
    
    // Find the plan and installment
    if (reference) {
      // Find by transaction reference
      plan = await InstallmentPlan.findOne({
        'installments.transactionId': reference
      }).session(session);
      
      if (plan) {
        targetInstallmentIndex = plan.installments.findIndex(
          inst => inst.transactionId === reference
        );
        if (targetInstallmentIndex !== -1) {
          targetInstallment = plan.installments[targetInstallmentIndex];
        }
      }
    } else if (planId && installmentNumber) {
      // Find by planId and installment number
      plan = await InstallmentPlan.findOne({
        planId
      }).session(session);
      
      if (plan) {
        targetInstallmentIndex = parseInt(installmentNumber) - 1;
        if (targetInstallmentIndex >= 0 && targetInstallmentIndex < plan.installments.length) {
          targetInstallment = plan.installments[targetInstallmentIndex];
        }
      }
    }
    
    if (!plan) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: 'Installment plan not found'
      });
    }
    
    if (!targetInstallment) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: 'Installment not found'
      });
    }
    
    // Check if installment is actually completed
    if (targetInstallment.status !== 'completed') {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: `Installment is not completed. Current status: ${targetInstallment.status}`,
        cannotUnverify: true
      });
    }
    
    // Check if user confirmation is needed for safety
    if (!confirmUnverify) {
      await session.abortTransaction();
      session.endSession();
      return res.status(200).json({
        success: false,
        message: 'Unverification requires confirmation. This action will reverse the payment and remove shares.',
        requiresConfirmation: true,
        data: {
          planId: plan.planId,
          installmentNumber: targetInstallmentIndex + 1,
          amount: targetInstallment.paidAmount,
          paidDate: targetInstallment.paidDate,
          transactionId: targetInstallment.transactionId,
          warning: 'This will remove shares from user account and reverse all related transactions'
        },
        instruction: 'Set confirmUnverify=true to proceed'
      });
    }
    
    // Get user details
    const user = await User.findById(plan.user);
    if (!user) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: 'User not found for this plan'
      });
    }
    
    const amount = targetInstallment.paidAmount;
    const paymentPercentage = (amount / plan.totalPrice) * 100;
    const sharesToRemove = Math.floor(plan.totalShares * (paymentPercentage / 100));
    
    console.log(`🔄 Reversing payment: ${amount} ${plan.currency}, removing ${sharesToRemove} shares`);
    
    // Store current values for audit
    const unverifyRecord = {
      originalStatus: targetInstallment.status,
      originalAmount: targetInstallment.paidAmount,
      originalPaidDate: targetInstallment.paidDate,
      originalTransactionId: targetInstallment.transactionId,
      sharesToRemove,
      unverifiedBy: adminId,
      unverifiedAt: new Date(),
      adminNote: adminNote || 'Payment unverified by admin'
    };
    
    // Restore original values if available, otherwise set to pending
    if (targetInstallment.originalValues) {
      targetInstallment.status = targetInstallment.originalValues.status;
      targetInstallment.paidAmount = targetInstallment.originalValues.paidAmount;
      targetInstallment.paidDate = targetInstallment.originalValues.paidDate;
      targetInstallment.transactionId = targetInstallment.originalValues.transactionId;
    } else {
      targetInstallment.status = 'pending';
      targetInstallment.paidAmount = 0;
      targetInstallment.paidDate = null;
      // Keep transactionId for tracking
    }
    
    // Add unverify record for audit trail
    if (!targetInstallment.unverifyHistory) {
      targetInstallment.unverifyHistory = [];
    }
    targetInstallment.unverifyHistory.push(unverifyRecord);
    
    // Clear verification fields
    delete targetInstallment.verifiedBy;
    delete targetInstallment.verifiedAt;
    delete targetInstallment.forceApproved;
    delete targetInstallment.originalValues;
    
    // Update plan totals
    plan.totalPaidAmount = (plan.totalPaidAmount || 0) - amount;
    plan.sharesReleased = (plan.sharesReleased || 0) - sharesToRemove;
    
    // Update plan status if needed
    if (plan.totalPaidAmount <= 0) {
      plan.status = 'pending';
    } else if (plan.totalPaidAmount < plan.totalPrice && plan.status === 'completed') {
      plan.status = 'active';
    }
    
    // Update plan timestamp and admin action
    plan.updatedAt = new Date();
    plan.lastAdminAction = {
      adminId,
      adminName: admin.name,
      action: 'unverify_payment',
      timestamp: new Date(),
      note: adminNote,
      transactionId: targetInstallment.transactionId,
      amount: amount,
      sharesRemoved: sharesToRemove
    };
    
    // Save plan updates
    await plan.save({ session });
    
    // Remove shares from user's account
    if (sharesToRemove > 0) {
      try {
        // Find and remove the user share record
        const userShareRecord = await UserShare.findOne({
          user: plan.user,
          transactionId: targetInstallment.transactionId
        }).session(session);
        
        if (userShareRecord) {
          // Remove the specific share record
          await UserShare.deleteOne({
            _id: userShareRecord._id
          }).session(session);
        } else {
          // If specific record not found, subtract from total
          const userShares = await UserShare.findOne({
            user: plan.user
          }).session(session);
          
          if (userShares && userShares.totalShares >= sharesToRemove) {
            userShares.totalShares -= sharesToRemove;
            userShares.updatedAt = new Date();
            await userShares.save({ session });
          }
        }
        
        // Update global share sales
        const Share = require('../models/Share');
        const shareConfig = await Share.getCurrentConfig();
        shareConfig.sharesSold = Math.max(0, (shareConfig.sharesSold || 0) - sharesToRemove);
        
        const tier1Shares = Math.floor((plan.tierBreakdown?.tier1 || 0) * (paymentPercentage / 100));
        const tier2Shares = Math.floor((plan.tierBreakdown?.tier2 || 0) * (paymentPercentage / 100));
        const tier3Shares = Math.floor((plan.tierBreakdown?.tier3 || 0) * (paymentPercentage / 100));
        
        if (shareConfig.tierSales) {
          shareConfig.tierSales.tier1Sold = Math.max(0, (shareConfig.tierSales.tier1Sold || 0) - tier1Shares);
          shareConfig.tierSales.tier2Sold = Math.max(0, (shareConfig.tierSales.tier2Sold || 0) - tier2Shares);
          shareConfig.tierSales.tier3Sold = Math.max(0, (shareConfig.tierSales.tier3Sold || 0) - tier3Shares);
        }
        
        await shareConfig.save({ session });
        
      } catch (shareError) {
        console.error('💥 Error removing shares:', shareError);
        // Continue anyway - we can manually fix shares later
      }
    }
    
    await session.commitTransaction();
    session.endSession();
    
    console.log(`❌ Admin unverification completed successfully`);
    
    // Send notification email to user
    if (user?.email) {
      try {
        await sendEmail({
          email: user.email,
          subject: 'Installment Payment Unverified',
          html: `
            <h2>Payment Verification Reversed</h2>
            <p>Dear ${user.name},</p>
            <p>Your installment payment for plan ${plan.planId} has been unverified by our admin team.</p>
            <p>Transaction Reference: ${targetInstallment.transactionId}</p>
            <p>Amount Unverified: ${plan.currency === 'naira' ? '₦' : '$'}${amount.toFixed(2)}</p>
            <p>Shares Removed: ${sharesToRemove}</p>
            <p>Updated Total Shares: ${plan.sharesReleased} of ${plan.totalShares}</p>
            <p>Updated Balance Paid: ${plan.currency === 'naira' ? '₦' : '$'}${plan.totalPaidAmount.toFixed(2)}</p>
            <p>Remaining Balance: ${plan.currency === 'naira' ? '₦' : '$'}${(plan.totalPrice - plan.totalPaidAmount).toFixed(2)}</p>
            ${adminNote ? `<p><em>Admin Note: ${adminNote}</em></p>` : ''}
            <p>If you believe this is an error, please contact our support team.</p>
          `
        });
      } catch (emailError) {
        console.error('📧 Failed to send unverify notification email:', emailError);
      }
    }
    
    // Send notification to other admins
    try {
      const adminEmail = process.env.ADMIN_EMAIL || 'admin@afrimobile.com';
      await sendEmail({
        email: adminEmail,
        subject: 'Installment Payment Unverified by Admin',
        html: `
          <h2>Admin Payment Unverification</h2>
          <p>Admin <strong>${admin.name}</strong> has unverified an installment payment:</p>
          <ul>
            <li>User: ${user.name} (${user.email})</li>
            <li>Plan ID: ${plan.planId}</li>
            <li>Transaction Reference: ${targetInstallment.transactionId}</li>
            <li>Amount Unverified: ${plan.currency === 'naira' ? '₦' : '$'}${amount.toFixed(2)}</li>
            <li>Installment: ${targetInstallmentIndex + 1} of ${plan.installmentMonths}</li>
            <li>Shares Removed: ${sharesToRemove}</li>
            <li>New Plan Status: ${plan.status}</li>
            ${adminNote ? `<li>Admin Note: ${adminNote}</li>` : ''}
          </ul>
          <p><strong>Warning:</strong> This action reversed a completed payment and removed shares from the user's account.</p>
        `
      });
    } catch (emailError) {
      console.error('📧 Failed to send admin notification:', emailError);
    }
    
    res.status(200).json({
      success: true,
      message: 'Payment unverified successfully',
      data: {
        planId: plan.planId,
        reference: targetInstallment.transactionId,
        amount,
        installmentNumber: targetInstallmentIndex + 1,
        status: targetInstallment.status,
        planStatus: plan.status,
        totalPaidAmount: plan.totalPaidAmount,
        remainingBalance: plan.totalPrice - plan.totalPaidAmount,
        sharesRemoved: sharesToRemove,
        totalSharesReleased: plan.sharesReleased,
        unverifiedBy: admin.name,
        adminNote: adminNote || null,
        user: {
          name: user.name,
          email: user.email
        }
      }
    });
    
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    
    console.error('💥 Admin unverification error:', error);
    
    res.status(500).json({
      success: false,
      message: 'Failed to unverify payment',
      error: process.env.NODE_ENV === 'development' ? {
        message: error.message,
        stack: error.stack,
        response: error.response?.data
      } : undefined
    });
  }
};

/**
 * @desc    Admin: Get pending transactions for review
 * @route   GET /api/shares/installment/admin/pending-transactions
 * @access  Private (Admin only)
 */
exports.adminGetPendingTransactions = async (req, res) => {
  try {
    const adminId = req.user.id;
    
    // Check admin privileges
    const admin = await User.findById(adminId);
    if (!admin || !admin.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized: Admin access required'
      });
    }
    
    const { page = 1, limit = 20, status = 'all' } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    let query = {};
    
    // Build query based on status filter
    if (status === 'pending') {
      query = {
        'installments': {
          $elemMatch: {
            status: { $in: ['pending', 'upcoming'] },
            transactionId: { $exists: true, $ne: null }
          }
        }
      };
    } else if (status === 'completed') {
      query = {
        'installments': {
          $elemMatch: {
            status: 'completed',
            verifiedBy: { $exists: true }
          }
        }
      };
    } else {
      // All transactions with transaction IDs
      query = {
        'installments': {
          $elemMatch: {
            transactionId: { $exists: true, $ne: null }
          }
        }
      };
    }
    
    // Find plans matching the query
    const plans = await InstallmentPlan.find(query)
      .skip(skip)
      .limit(parseInt(limit))
      .sort({ updatedAt: -1 })
      .populate('user', 'name email phone');
    
    const transactions = [];
    
    for (const plan of plans) {
      let installmentsToShow = [];
      
      if (status === 'pending') {
        installmentsToShow = plan.installments.filter(
          inst => ['pending', 'upcoming'].includes(inst.status) && inst.transactionId
        );
      } else if (status === 'completed') {
        installmentsToShow = plan.installments.filter(
          inst => inst.status === 'completed' && inst.verifiedBy
        );
      } else {
        installmentsToShow = plan.installments.filter(
          inst => inst.transactionId
        );
      }
      
      for (const installment of installmentsToShow) {
        transactions.push({
          planId: plan.planId,
          user: {
            id: plan.user._id,
            name: plan.user.name,
            email: plan.user.email,
            phone: plan.user.phone
          },
          installmentNumber: installment.installmentNumber,
          amount: installment.amount,
          paidAmount: installment.paidAmount || 0,
          dueDate: installment.dueDate,
          paidDate: installment.paidDate,
          transactionId: installment.transactionId,
          status: installment.status,
          currency: plan.currency,
          isFirstPayment: installment.isFirstPayment,
          minimumAmount: installment.isFirstPayment ? plan.minimumDownPaymentAmount : 0,
          planStatus: plan.status,
          verifiedBy: installment.verifiedBy,
          verifiedAt: installment.verifiedAt,
          adminNote: installment.adminNote,
          forceApproved: installment.forceApproved || false,
          unverifyHistory: installment.unverifyHistory || [],
          canVerify: installment.status !== 'completed',
          canUnverify: installment.status === 'completed' && installment.verifiedBy,
          createdAt: plan.createdAt,
          updatedAt: plan.updatedAt
        });
      }
    }
    
    // Sort by most recent first
    transactions.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    
    res.status(200).json({
      success: true,
      transactions,
      count: transactions.length,
      filters: {
        status,
        availableStatuses: ['all', 'pending', 'completed']
      },
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(transactions.length / parseInt(limit)),
        totalCount: transactions.length
      }
    });
    
  } catch (error) {
    console.error('Error fetching pending transactions:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch transactions',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Admin: Get transaction details for verification
 * @route   GET /api/shares/installment/admin/transaction-details/:reference
 * @access  Private (Admin only)
 */
exports.adminGetTransactionDetails = async (req, res) => {
  try {
    const adminId = req.user.id;
    const { reference } = req.params;
    
    // Check admin privileges
    const admin = await User.findById(adminId);
    if (!admin || !admin.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized: Admin access required'
      });
    }
    
    if (!reference) {
      return res.status(400).json({
        success: false,
        message: 'Please provide transaction reference'
      });
    }
    
    // Get Paystack transaction details
    let paystackData = null;
    try {
      const verificationResponse = await axios.get(
        `https://api.paystack.co/transaction/verify/${reference}`,
        {
          headers: {
            Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`
          }
        }
      );
      paystackData = verificationResponse.data.data;
    } catch (paystackError) {
      console.error('Failed to fetch Paystack data:', paystackError);
      paystackData = {
        error: 'Failed to fetch from Paystack',
        message: paystackError.response?.data?.message || paystackError.message
      };
    }
    
    // Find the installment plan
    const plan = await InstallmentPlan.findOne({
      'installments.transactionId': reference
    }).populate('user', 'name email phone');
    
    if (!plan) {
      return res.status(404).json({
        success: false,
        message: 'Installment plan not found for this transaction',
        paystackData
      });
    }
    
    // Find the specific installment
    const installmentIndex = plan.installments.findIndex(
      inst => inst.transactionId === reference
    );
    
    if (installmentIndex === -1) {
      return res.status(404).json({
        success: false,
        message: 'Installment not found in plan',
        paystackData
      });
    }
    
    const installment = plan.installments[installmentIndex];
    
    res.status(200).json({
      success: true,
      data: {
        plan: {
          planId: plan.planId,
          status: plan.status,
          totalShares: plan.totalShares,
          totalPrice: plan.totalPrice,
          currency: plan.currency,
          totalPaidAmount: plan.totalPaidAmount || 0,
          remainingBalance: plan.totalPrice - (plan.totalPaidAmount || 0),
          sharesReleased: plan.sharesReleased || 0,
          minimumDownPaymentAmount: plan.minimumDownPaymentAmount
        },
        user: {
          id: plan.user._id,
          name: plan.user.name,
          email: plan.user.email,
          phone: plan.user.phone
        },
        installment: {
          number: installment.installmentNumber,
          amount: installment.amount,
          paidAmount: installment.paidAmount || 0,
          dueDate: installment.dueDate,
          paidDate: installment.paidDate,
          status: installment.status,
          transactionId: installment.transactionId,
          isFirstPayment: installment.isFirstPayment,
          verifiedBy: installment.verifiedBy,
          verifiedAt: installment.verifiedAt,
          adminNote: installment.adminNote,
          forceApproved: installment.forceApproved || false,
          unverifyHistory: installment.unverifyHistory || []
        },
        paystack: paystackData,
        actions: {
          canVerify: installment.status !== 'completed',
          canUnverify: installment.status === 'completed' && installment.verifiedBy,
          requiresForceApprove: paystackData?.status !== 'success'
        }
      }
    });
    
  } catch (error) {
    console.error('Error fetching transaction details:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch transaction details',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Admin: Verify and approve pending Paystack transaction
 * @route   POST /api/shares/installment/admin/verify-transaction
 * @access  Private (Admin only)
 */
exports.adminVerifyTransaction = async (req, res) => {
  const session = await InstallmentPlan.startSession();
  session.startTransaction();
  
  try {
    const { reference, planId, forceApprove = false, adminNote } = req.body;
    const adminId = req.user.id;
    
    // Check admin privileges
    const admin = await User.findById(adminId);
    if (!admin || !admin.isAdmin) {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({
        success: false,
        message: 'Unauthorized: Admin access required'
      });
    }
    
    if (!reference) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: 'Please provide payment reference'
      });
    }

    console.log(`✅ Admin ${admin.name} verifying transaction: ${reference}`);
    
    // First, get transaction details from Paystack
    let paymentData;
    try {
      const verificationResponse = await axios.get(
        `https://api.paystack.co/transaction/verify/${reference}`,
        {
          headers: {
            Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`
          }
        }
      );
      paymentData = verificationResponse.data.data;
    } catch (paystackError) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: 'Failed to verify transaction with Paystack',
        error: paystackError.response?.data || paystackError.message
      });
    }
    
    console.log(`💳 Paystack status: ${paymentData.status}`);
    
    // If payment failed and not forcing approval, return the status
    if (paymentData.status !== 'success' && !forceApprove) {
      await session.abortTransaction();
      session.endSession();
      return res.status(200).json({
        success: false,
        message: `Payment status: ${paymentData.status}. Use forceApprove=true to override.`,
        paymentStatus: paymentData.status,
        canForceApprove: true,
        data: {
          reference: paymentData.reference,
          amount: paymentData.amount / 100,
          currency: paymentData.currency,
          status: paymentData.status,
          gateway_response: paymentData.gateway_response,
          paid_at: paymentData.paid_at,
          metadata: paymentData.metadata
        }
      });
    }
    
    // Get metadata from payment or use provided planId
    const metadata = paymentData.metadata || {};
    let targetPlanId = planId || metadata.planId;
    let targetUserId = metadata.userId;
    let installmentNumber = metadata.installmentNumber;
    let transactionId = metadata.transactionId || reference;
    
    // If no planId, search for plan by reference in installments
    if (!targetPlanId) {
      const planWithReference = await InstallmentPlan.findOne({
        'installments.transactionId': reference
      }).session(session);
      
      if (planWithReference) {
        targetPlanId = planWithReference.planId;
        targetUserId = planWithReference.user.toString();
        
        // Find which installment has this reference
        const installmentIndex = planWithReference.installments.findIndex(
          inst => inst.transactionId === reference
        );
        if (installmentIndex !== -1) {
          installmentNumber = installmentIndex + 1;
        }
      }
    }
    
    if (!targetPlanId) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: 'Cannot determine installment plan. Please provide planId.',
        availableData: {
          reference,
          paystackMetadata: metadata,
          suggestion: 'Search for the plan manually and provide planId'
        }
      });
    }
    
    // Find the installment plan
    const plan = await InstallmentPlan.findOne({
      planId: targetPlanId
    }).session(session);
    
    if (!plan) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: `Installment plan not found: ${targetPlanId}`
      });
    }
    
    // Get user details
    const user = await User.findById(plan.user);
    if (!user) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: 'User not found for this plan'
      });
    }
    
    // If installmentNumber not found, try to determine it
    if (!installmentNumber) {
      // Find installment with matching transaction ID
      const installmentIndex = plan.installments.findIndex(
        inst => inst.transactionId === reference || inst.transactionId === transactionId
      );
      
      if (installmentIndex !== -1) {
        installmentNumber = installmentIndex + 1;
      } else {
        // Find first pending/upcoming installment
        const nextInstallmentIndex = plan.installments.findIndex(
          inst => inst.status === 'pending' || inst.status === 'upcoming'
        );
        
        if (nextInstallmentIndex !== -1) {
          installmentNumber = nextInstallmentIndex + 1;
        } else {
          await session.abortTransaction();
          session.endSession();
          return res.status(400).json({
            success: false,
            message: 'Cannot determine which installment this payment is for',
            suggestion: 'All installments appear to be completed or plan status unclear'
          });
        }
      }
    }
    
    // Validate installment number
    const installmentIndex = parseInt(installmentNumber) - 1;
    if (installmentIndex < 0 || installmentIndex >= plan.installments.length) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: `Invalid installment number: ${installmentNumber}. Plan has ${plan.installments.length} installments.`
      });
    }
    
    const installment = plan.installments[installmentIndex];
    
    // Check if installment is already completed
    if (installment.status === 'completed') {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: 'This installment has already been completed',
        data: {
          planId: plan.planId,
          installmentNumber,
          status: 'already_completed',
          paidAmount: installment.paidAmount,
          paidDate: installment.paidDate,
          previousTransactionId: installment.transactionId,
          canUnverify: true
        }
      });
    }
    
    // Convert amount from kobo to currency unit
    const amount = paymentData.amount / 100;
    
    // Validate payment amount for first payment
    if (installment.isFirstPayment && amount < plan.minimumDownPaymentAmount && !forceApprove) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: `First payment amount (${plan.currency === 'naira' ? '₦' : '$'}${amount}) is below minimum requirement (${plan.currency === 'naira' ? '₦' : '$'}${plan.minimumDownPaymentAmount}). Use forceApprove=true to override.`,
        canForceApprove: true,
        minimumRequired: plan.minimumDownPaymentAmount,
        providedAmount: amount
      });
    }
    
    // Check if payment exceeds remaining balance
    const remainingBalance = plan.totalPrice - (plan.totalPaidAmount || 0);
    if (amount > remainingBalance && !forceApprove) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: `Payment amount (${plan.currency === 'naira' ? '₦' : '$'}${amount}) exceeds remaining balance (${plan.currency === 'naira' ? '₦' : '$'}${remainingBalance}). Use forceApprove=true to override.`,
        canForceApprove: true,
        remainingBalance,
        providedAmount: amount
      });
    }
    
    console.log(`💰 Admin approving payment: ${amount} ${plan.currency} for installment ${installmentNumber}`);
    
    // Store original values for potential rollback
    const originalInstallment = {
      status: installment.status,
      paidAmount: installment.paidAmount,
      paidDate: installment.paidDate,
      transactionId: installment.transactionId
    };
    
    // Update installment payment
    installment.status = 'completed';
    installment.paidAmount = amount;
    installment.paidDate = new Date(paymentData.paid_at || new Date());
    installment.transactionId = transactionId;
    installment.adminNote = adminNote || `Verified by admin ${admin.name}`;
    installment.verifiedBy = adminId;
    installment.verifiedAt = new Date();
    installment.forceApproved = forceApprove;
    installment.originalValues = originalInstallment; // Store for unverify
    
    // Update plan totals
    plan.totalPaidAmount = (plan.totalPaidAmount || 0) + amount;
    
    // Update plan status if first payment
    if (plan.status === 'pending' && installment.isFirstPayment) {
      plan.status = 'active';
      console.log(`📈 Plan status updated to active`);
    }
    
    // Calculate shares to release
    const paymentPercentage = (amount / plan.totalPrice) * 100;
    const sharesToRelease = Math.floor(plan.totalShares * (paymentPercentage / 100));
    plan.sharesReleased = (plan.sharesReleased || 0) + sharesToRelease;
    
    console.log(`🎯 Releasing ${sharesToRelease} shares (${paymentPercentage.toFixed(2)}% of total)`);
    
    // Check if plan is completed
    if (plan.totalPaidAmount >= plan.totalPrice) {
      plan.status = 'completed';
      console.log(`✅ Plan completed! Total paid: ${plan.totalPaidAmount} of ${plan.totalPrice}`);
    }
    
    // Update plan timestamp and admin verification info
    plan.updatedAt = new Date();
    plan.lastAdminAction = {
      adminId,
      adminName: admin.name,
      action: 'verify_payment',
      timestamp: new Date(),
      note: adminNote,
      transactionId,
      amount
    };
    
    // Save plan updates
    await plan.save({ session });
    
    // Add released shares to user's account if applicable
    if (sharesToRelease > 0) {
      await UserShare.addShares(plan.user, sharesToRelease, {
        transactionId,
        shares: sharesToRelease,
        pricePerShare: amount / sharesToRelease,
        currency: plan.currency,
        totalAmount: amount,
        paymentMethod: 'paystack',
        status: 'completed',
        tierBreakdown: {
          tier1: Math.floor((plan.tierBreakdown?.tier1 || 0) * (paymentPercentage / 100)),
          tier2: Math.floor((plan.tierBreakdown?.tier2 || 0) * (paymentPercentage / 100)),
          tier3: Math.floor((plan.tierBreakdown?.tier3 || 0) * (paymentPercentage / 100))
        },
        installmentPayment: true,
        installmentPlanId: plan.planId,
        adminVerified: true,
        verifiedBy: adminId
      }, { session });
      
      // Update global share sales
      const Share = require('../models/Share');
      const shareConfig = await Share.getCurrentConfig();
      shareConfig.sharesSold = (shareConfig.sharesSold || 0) + sharesToRelease;
      
      const tier1Shares = Math.floor((plan.tierBreakdown?.tier1 || 0) * (paymentPercentage / 100));
      const tier2Shares = Math.floor((plan.tierBreakdown?.tier2 || 0) * (paymentPercentage / 100));
      const tier3Shares = Math.floor((plan.tierBreakdown?.tier3 || 0) * (paymentPercentage / 100));
      
      if (!shareConfig.tierSales) {
        shareConfig.tierSales = { tier1Sold: 0, tier2Sold: 0, tier3Sold: 0 };
      }
      
      shareConfig.tierSales.tier1Sold = (shareConfig.tierSales.tier1Sold || 0) + tier1Shares;
      shareConfig.tierSales.tier2Sold = (shareConfig.tierSales.tier2Sold || 0) + tier2Shares;
      shareConfig.tierSales.tier3Sold = (shareConfig.tierSales.tier3Sold || 0) + tier3Shares;
      
      await shareConfig.save({ session });
      
      // Process referral commissions
      try {
        await processReferralCommission(
          plan.user,
          amount,
          'share',
          transactionId,
          { session }
        );
      } catch (referralError) {
        console.error('💥 Error processing referral commissions:', referralError);
        // Don't fail the whole transaction for referral errors
      }
    }
    
    await session.commitTransaction();
    session.endSession();
    
    console.log(`🎉 Admin verification completed successfully`);
    
    // Send confirmation email to user
    if (user?.email) {
      try {
        await sendEmail({
          email: user.email,
          subject: 'Installment Payment Approved',
          html: `
            <h2>Payment Approved by Admin</h2>
            <p>Dear ${user.name},</p>
            <p>Your installment payment for plan ${plan.planId} has been verified and approved by our admin team.</p>
            <p>Transaction Reference: ${reference}</p>
            <p>Amount Approved: ${plan.currency === 'naira' ? '₦' : '$'}${amount.toFixed(2)}</p>
            <p>Shares Released: ${sharesToRelease}</p>
            <p>Total Shares Released: ${plan.sharesReleased} of ${plan.totalShares}</p>
            <p>Remaining Balance: ${plan.currency === 'naira' ? '₦' : '$'}${(plan.totalPrice - plan.totalPaidAmount).toFixed(2)}</p>
            ${plan.status === 'completed' ? 
              `<p>🎉 Congratulations! You have completed your installment plan.</p>` : 
              `<p>You can make your next payment at any time using Paystack.</p>`}
            ${adminNote ? `<p><em>Admin Note: ${adminNote}</em></p>` : ''}
          `
        });
      } catch (emailError) {
        console.error('📧 Failed to send confirmation email:', emailError);
      }
    }
    
    res.status(200).json({
      success: true,
      message: 'Payment verified and approved successfully',
      data: {
        planId: plan.planId,
        reference,
        amount,
        installmentNumber,
        status: 'completed',
        planStatus: plan.status,
        totalPaidAmount: plan.totalPaidAmount,
        remainingBalance: plan.totalPrice - plan.totalPaidAmount,
        sharesReleased: sharesToRelease,
        totalSharesReleased: plan.sharesReleased,
        transactionId,
        verifiedBy: admin.name,
        forceApproved: forceApprove,
        adminNote: adminNote || null,
        user: {
          name: user.name,
          email: user.email
        }
      }
    });
    
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    
    console.error('💥 Admin verification error:', error);
    
    res.status(500).json({
      success: false,
      message: 'Failed to verify payment',
      error: process.env.NODE_ENV === 'development' ? {
        message: error.message,
        stack: error.stack,
        response: error.response?.data
      } : undefined
    });
  }
};

// Complete module exports
module.exports = {
  // Validation middleware
  validateInstallmentInput,
  
  // User functions
  calculateInstallmentPlan: exports.calculateInstallmentPlan,
  createInstallmentPlan: exports.createInstallmentPlan,
  getUserInstallmentPlans: exports.getUserInstallmentPlans,
  cancelInstallmentPlan: exports.cancelInstallmentPlan,
  
  // Payment functions
  payInstallmentWithPaystack: exports.payInstallmentWithPaystack,
  verifyInstallmentPaystack: exports.verifyInstallmentPaystack,
  
  // Admin functions
  adminGetAllInstallmentPlans: exports.adminGetAllInstallmentPlans,
  checkLatePayments: exports.checkLatePayments,
  
  // Admin verification functions (complete implementations)
  adminVerifyTransaction: exports.adminVerifyTransaction,
  adminUnverifyTransaction: exports.adminUnverifyTransaction,
  adminGetPendingTransactions: exports.adminGetPendingTransactions,
  adminGetTransactionDetails: exports.adminGetTransactionDetails
};