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
 * @desc    Pay installment with Paystack
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
    
    // Generate transaction ID
    const transactionId = generateTransactionId();
    
    // Initialize Paystack payment
    const paystackResponse = await axios.post(
      'https://api.paystack.co/transaction/initialize',
      {
        email,
        amount: parsedAmount * 100, // Convert to kobo
        currency: plan.currency === 'naira' ? 'NGN' : 'USD',
        reference: transactionId,
        callback_url: `${process.env.FRONTEND_URL}/installment/verify?planId=${planId}`,
        metadata: {
          planId,
          installmentNumber,
          userId,
          transactionId
        }
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    // Update installment with pending payment - USE VALID ENUM VALUE
    installment.transactionId = transactionId;
    // Change from 'pending_payment' to 'pending' which should be a valid enum value
    installment.status = 'pending';
    
    // You can also add a separate field to track payment initialization if needed
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
 * @desc    Verify Paystack installment payment
 * @route   GET /api/shares/installment/paystack/verify
 * @access  Private (User)
 */
exports.verifyInstallmentPaystack = async (req, res) => {
  const session = await InstallmentPlan.startSession();
  session.startTransaction();
  
  try {
    const { reference } = req.query;
    const userId = req.user.id;
    
    if (!reference) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: 'Please provide payment reference'
      });
    }
    
    // Verify payment with Paystack
    const verificationResponse = await axios.get(
      `https://api.paystack.co/transaction/verify/${reference}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`
        }
      }
    );
    
    const paymentData = verificationResponse.data.data;
    
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
    const { planId, installmentNumber, transactionId } = paymentData.metadata;
    
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
    
    // Find the installment
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
    
    // Check if this transaction matches
    if (installment.transactionId !== transactionId) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: 'Transaction ID mismatch'
      });
    }
    
    // Convert amount from kobo to currency unit
    const amount = paymentData.amount / 100;
    
    // Update installment payment
    installment.status = 'completed';
    installment.paidAmount = amount;
    installment.paidDate = new Date(paymentData.paid_at);
    
    // Update plan totals
    plan.totalPaidAmount += amount;
    
    // Update plan status if first payment
    if (plan.status === 'pending' && installment.isFirstPayment) {
      plan.status = 'active';
    }
    
    // Calculate shares to release
    const paymentPercentage = (amount / plan.totalPrice) * 100;
    const sharesToRelease = Math.floor(plan.totalShares * (paymentPercentage / 100));
    plan.sharesReleased += sharesToRelease;
    
    // Check if plan is completed
    if (plan.totalPaidAmount >= plan.totalPrice) {
      plan.status = 'completed';
    }
    
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
          tier1: Math.floor(plan.tierBreakdown.tier1 * (paymentPercentage / 100)),
          tier2: Math.floor(plan.tierBreakdown.tier2 * (paymentPercentage / 100)),
          tier3: Math.floor(plan.tierBreakdown.tier3 * (paymentPercentage / 100))
        },
        installmentPayment: true,
        installmentPlanId: plan.planId
      }, { session });
      
      // Update global share sales
      const Share = require('../models/Share');
      const shareConfig = await Share.getCurrentConfig();
      shareConfig.sharesSold += sharesToRelease;
      
      const tier1Shares = Math.floor(plan.tierBreakdown.tier1 * (paymentPercentage / 100));
      const tier2Shares = Math.floor(plan.tierBreakdown.tier2 * (paymentPercentage / 100));
      const tier3Shares = Math.floor(plan.tierBreakdown.tier3 * (paymentPercentage / 100));
      
      shareConfig.tierSales.tier1Sold += tier1Shares;
      shareConfig.tierSales.tier2Sold += tier2Shares;
      shareConfig.tierSales.tier3Sold += tier3Shares;
      
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
        console.error('Error processing referral commissions:', referralError);
      }
    }
    
    await session.commitTransaction();
    session.endSession();
    
    // Get user details for notification
    const user = await User.findById(userId);
    
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
            <p>Transaction ID: ${transactionId}</p>
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
        console.error('Failed to send confirmation email:', emailError);
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
        sharesReleased: sharesToRelease
      }
    });
    
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    
    console.error('Error verifying Paystack payment:', error);
    
    let errorMessage = 'Failed to verify payment';
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

// Export all controller methods
module.exports = {
  calculateInstallmentPlan: exports.calculateInstallmentPlan,
  createInstallmentPlan: exports.createInstallmentPlan,
  getUserInstallmentPlans: exports.getUserInstallmentPlans,
  payInstallmentWithPaystack: exports.payInstallmentWithPaystack,
  verifyInstallmentPaystack: exports.verifyInstallmentPaystack,
  adminGetAllInstallmentPlans: exports.adminGetAllInstallmentPlans,
  cancelInstallmentPlan: exports.cancelInstallmentPlan,
  checkLatePayments: exports.checkLatePayments,
  validateInstallmentInput
};