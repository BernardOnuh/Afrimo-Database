// controller/installmentController.js
const Share = require('../models/Share');
const InstallmentPlan = require('../models/InstallmentPlan');
const UserShare = require('../models/UserShare');
const User = require('../models/User');
const crypto = require('crypto');
const { sendEmail } = require('../utils/emailService');
const SiteConfig = require('../models/SiteConfig');
const { processReferralCommission } = require('../utils/referralUtils');
const fs = require('fs');
const path = require('path');

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
    
    // Calculate due dates more accurately
    const startDate = new Date();
    const monthlyPayments = Array.from({ length: installmentMonths }, (_, i) => {
      const dueDate = new Date(startDate);
      dueDate.setMonth(startDate.getMonth() + i + 1); // Set to same day next month
      dueDate.setDate(1); // Set to first day of month for consistency
      
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
        note: "First payment must be at least 20% of total price. Subsequent payments can be flexible amounts."
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
    
    // Calculate installments with accurate due dates
    const startDate = new Date();
    const installments = [];
    
    for (let i = 0; i < installmentMonths; i++) {
      const dueDate = new Date(startDate);
      dueDate.setMonth(startDate.getMonth() + i + 1);
      dueDate.setDate(1); // Set to first day of month
      
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
      totalPaidAmount: 0,
      flexiblePayments: []
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
        note: "First payment must be at least 20% of total price. Subsequent payments can be flexible amounts."
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
 * @desc    Submit manual payment for installment with flexible amount
 * @route   POST /api/shares/installment/manual/submit
 * @access  Private (User)
 */
exports.submitManualInstallmentPayment = async (req, res) => {
  try {
    const { planId, paymentAmount, paymentMethod, bankName, accountName, reference } = req.body;
    const userId = req.user.id;
    const paymentProofImage = req.file;
    
    // Validate input
    if (!planId || !paymentAmount || !paymentMethod || !paymentProofImage) {
      return res.status(400).json({
        success: false,
        message: 'Please provide planId, payment amount, payment method, and payment proof image'
      });
    }
    
    // Validate payment proof file
    const allowedFileTypes = ['image/jpeg', 'image/png', 'application/pdf'];
    const maxFileSize = 5 * 1024 * 1024; // 5MB
    
    if (!allowedFileTypes.includes(paymentProofImage.mimetype)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid file type. Only JPEG, PNG, and PDF are allowed'
      });
    }
    
    if (paymentProofImage.size > maxFileSize) {
      return res.status(400).json({
        success: false,
        message: 'File size too large. Maximum 5MB allowed'
      });
    }
    
    // Validate payment amount
    const parsedPaymentAmount = parseFloat(paymentAmount);
    if (isNaN(parsedPaymentAmount)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid payment amount'
      });
    }
    
    if (parsedPaymentAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Payment amount must be greater than 0'
      });
    }
    
    // Find the installment plan
    const plan = await InstallmentPlan.findOne({
      planId,
      user: userId
    });
    
    if (!plan) {
      return res.status(404).json({
        success: false,
        message: 'Installment plan not found'
      });
    }
    
    // Check plan status
    if (plan.status === 'cancelled') {
      return res.status(400).json({
        success: false,
        message: 'This installment plan has been cancelled'
      });
    }
    
    if (plan.status === 'completed') {
      return res.status(400).json({
        success: false,
        message: 'This installment plan has been completed'
      });
    }
    
    // Validate payment amount
    const isFirstPayment = plan.totalPaidAmount === 0;
    const remainingBalance = plan.totalPrice - plan.totalPaidAmount;
    
    if (isFirstPayment && parsedPaymentAmount < plan.minimumDownPaymentAmount) {
      return res.status(400).json({
        success: false,
        message: `First payment must be at least ${plan.currency === 'naira' ? '₦' : '$'}${plan.minimumDownPaymentAmount.toFixed(2)} (20% of total price)`
      });
    }
    
    if (parsedPaymentAmount > remainingBalance) {
      return res.status(400).json({
        success: false,
        message: `Payment amount cannot exceed remaining balance of ${plan.currency === 'naira' ? '₦' : '$'}${remainingBalance.toFixed(2)}`
      });
    }
    
    // Generate transaction ID
    const transactionId = generateTransactionId();
    
    // Add new flexible payment record
    const newPayment = {
      transactionId,
      amount: parsedPaymentAmount,
      paymentDate: new Date(),
      status: 'pending_verification',
      paymentProofPath: paymentProofImage.path,
      manualPaymentDetails: {
        bankName: bankName || null,
        accountName: accountName || null,
        reference: reference || null,
        paymentMethod: `manual_${paymentMethod}`
      },
      isFirstPayment
    };
    
    // Update plan with new payment
    if (!plan.flexiblePayments) {
      plan.flexiblePayments = [];
    }
    plan.flexiblePayments.push(newPayment);
    plan.updatedAt = new Date();
    await plan.save();
    
    // Notify admin
    try {
      const user = await User.findById(userId);
      const adminEmail = process.env.ADMIN_EMAIL || 'admin@afrimobile.com';
      
      await sendEmail({
        email: adminEmail,
        subject: 'New Flexible Installment Payment Requires Verification',
        html: `
          <h2>Flexible Installment Payment Verification Required</h2>
          <p>A new flexible payment for an installment plan has been submitted:</p>
          <ul>
            <li>User: ${user.name} (${user.email})</li>
            <li>Plan ID: ${planId}</li>
            <li>Transaction ID: ${transactionId}</li>
            <li>Payment Amount: ${plan.currency === 'naira' ? '₦' : '$'}${parsedPaymentAmount.toFixed(2)}</li>
            <li>Total Paid So Far: ${plan.currency === 'naira' ? '₦' : '$'}${plan.totalPaidAmount.toFixed(2)}</li>
            <li>Remaining Balance: ${plan.currency === 'naira' ? '₦' : '$'}${remainingBalance.toFixed(2)}</li>
            <li>Payment Method: ${paymentMethod}</li>
            <li>Is First Payment: ${isFirstPayment ? 'Yes' : 'No'}</li>
            ${bankName ? `<li>Bank Name: ${bankName}</li>` : ''}
            ${accountName ? `<li>Account Name: ${accountName}</li>` : ''}
            ${reference ? `<li>Reference/Receipt No: ${reference}</li>` : ''}
          </ul>
          <p>Please verify this payment in the admin dashboard.</p>
        `
      });
    } catch (emailError) {
      console.error('Failed to send admin notification:', emailError);
    }
    
    res.status(200).json({
      success: true,
      message: 'Flexible installment payment proof submitted successfully and awaiting verification',
      data: {
        transactionId,
        amount: parsedPaymentAmount,
        remainingBalance: remainingBalance - parsedPaymentAmount,
        status: 'pending_verification'
      }
    });
    
  } catch (error) {
    console.error('Error submitting flexible installment payment:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to submit flexible installment payment',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Admin: Verify flexible installment payment
 * @route   POST /api/shares/installment/admin/flexible/verify
 * @access  Private (Admin)
 */
exports.adminVerifyFlexibleInstallmentPayment = async (req, res) => {
  const session = await InstallmentPlan.startSession();
  session.startTransaction();
  
  try {
    const { transactionId, approved, adminNote } = req.body;
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
    
    // Find the installment plan with transaction
    const plan = await InstallmentPlan.findOne({
      'flexiblePayments.transactionId': transactionId
    }).session(session);
    
    if (!plan) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: 'Transaction not found'
      });
    }
    
    // Find the payment
    const payment = plan.flexiblePayments.find(p => p.transactionId === transactionId);
    if (!payment || payment.status !== 'pending_verification') {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: payment ? `Payment status is not pending verification. Current status: ${payment.status}` : 'Payment not found'
      });
    }
    
    if (approved) {
      // Update payment status
      payment.status = 'completed';
      payment.adminNote = adminNote || 'Verified by admin';
      payment.verifiedDate = new Date();
      
      // Update plan totals
      plan.totalPaidAmount += payment.amount;
      
      // Update plan status if first payment
      if (plan.status === 'pending' && payment.isFirstPayment) {
        plan.status = 'active';
      }
      
      // Calculate shares to release
      const paymentPercentage = (payment.amount / plan.totalPrice) * 100;
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
          pricePerShare: payment.amount / sharesToRelease,
          currency: plan.currency,
          totalAmount: payment.amount,
          paymentMethod: payment.manualPaymentDetails?.paymentMethod || 'manual',
          status: 'completed',
          tierBreakdown: {
            tier1: Math.floor(plan.tierBreakdown.tier1 * (paymentPercentage / 100)),
            tier2: Math.floor(plan.tierBreakdown.tier2 * (paymentPercentage / 100)),
            tier3: Math.floor(plan.tierBreakdown.tier3 * (paymentPercentage / 100))
          },
          installmentPayment: true,
          installmentPlanId: plan.planId,
          flexiblePayment: true
        }, { session });
        
        // Update global share sales
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
            payment.amount,
            'share',
            transactionId,
            { session }
          );
        } catch (referralError) {
          console.error('Error processing referral commissions:', referralError);
        }
      }
    } else {
      // Payment rejected
      payment.status = 'rejected';
      payment.adminNote = adminNote || 'Rejected by admin';
      await plan.save({ session });
    }
    
    await session.commitTransaction();
    session.endSession();
    
    // Get user details for notification
    const user = await User.findById(plan.user);
    
    // Send notification email
    if (user?.email) {
      try {
        const emailSubject = approved ? 
          'Installment Payment Verified' : 
          'Installment Payment Verification Failed';
        
        const emailHtml = approved ? `
          <h2>Installment Payment Confirmation</h2>
          <p>Dear ${user.name},</p>
          <p>Your installment payment for plan ${plan.planId} has been verified and processed successfully.</p>
          <p>Transaction ID: ${transactionId}</p>
          <p>Payment Amount: ${plan.currency === 'naira' ? '₦' : '$'}${payment.amount.toFixed(2)}</p>
          <p>Shares Released: ${Math.floor(plan.totalShares * ((payment.amount / plan.totalPrice) * 100) / 100)}</p>
          <p>Total Shares Released: ${plan.sharesReleased} of ${plan.totalShares}</p>
          <p>Remaining Balance: ${plan.currency === 'naira' ? '₦' : '$'}${(plan.totalPrice - plan.totalPaidAmount).toFixed(2)}</p>
          ${plan.status === 'completed' ? 
            `<p>Congratulations! You have completed your installment plan.</p>` : 
            `<p>You can make your next payment at any time with any amount you choose.</p>`
          }
          ${adminNote ? `<p>Note: ${adminNote}</p>` : ''}
        ` : `
          <h2>Installment Payment Verification</h2>
          <p>Dear ${user.name},</p>
          <p>We regret to inform you that your recent installment payment for plan ${plan.planId} could not be verified.</p>
          <p>Transaction ID: ${transactionId}</p>
          <p>Payment Amount: ${plan.currency === 'naira' ? '₦' : '$'}${payment.amount.toFixed(2)}</p>
          <p>Please submit a new payment or contact our support team for assistance.</p>
          ${adminNote ? `<p>Reason: ${adminNote}</p>` : ''}
        `;
        
        await sendEmail({
          email: user.email,
          subject: `AfriMobile - ${emailSubject}`,
          html: emailHtml
        });
      } catch (emailError) {
        console.error('Failed to send verification email:', emailError);
      }
    }
    
    res.status(200).json({
      success: true,
      message: approved ? 'Payment verified successfully' : 'Payment verification rejected',
      approved,
      data: {
        planId: plan.planId,
        amount: payment.amount,
        status: payment.status,
        planStatus: plan.status,
        totalPaidAmount: plan.totalPaidAmount,
        remainingBalance: plan.totalPrice - plan.totalPaidAmount
      }
    });
    
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error('Error verifying payment:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to verify payment',
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
      
      // Get last payment date
      const lastPaymentDate = plan.flexiblePayments?.length > 0 
        ? Math.max(...plan.flexiblePayments
            .filter(p => p.status === 'completed')
            .map(p => new Date(p.verifiedDate || p.paymentDate).getTime()))
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
                subject: 'Late Payment Notice',
                html: `
                  <h2>Late Payment Notice</h2>
                  <p>Dear ${user.name},</p>
                  <p>We noticed that your installment plan ${plan.planId} has a late payment.</p>
                  <p>Days Since Last Payment: ${daysSinceLastPayment}</p>
                  <p>Months Late: ${monthsLate}</p>
                  <p>Remaining Balance: ${plan.currency === 'naira' ? '₦' : '$'}${remainingBalance.toFixed(2)}</p>
                  <p>Late Fee: ${plan.currency === 'naira' ? '₦' : '$'}${cappedLateFee.toFixed(2)} (${lateFeePercentage}% per month)</p>
                  <p>Total Amount Due: ${plan.currency === 'naira' ? '₦' : '$'}${(remainingBalance + cappedLateFee).toFixed(2)}</p>
                  <p>Please make a payment as soon as possible to avoid additional late fees.</p>
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
 * @desc    Get user's installment plans with flexible payments
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
      flexiblePayments: (plan.flexiblePayments || []).map(payment => ({
        transactionId: payment.transactionId,
        amount: payment.amount,
        paymentDate: payment.paymentDate,
        verifiedDate: payment.verifiedDate,
        status: payment.status,
        isFirstPayment: payment.isFirstPayment,
        adminNote: payment.adminNote
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
 * @desc    Admin: Get all installment plans with flexible payments
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
        })),
        flexiblePayments: (plan.flexiblePayments || []).map(payment => ({
          transactionId: payment.transactionId,
          amount: payment.amount,
          paymentDate: payment.paymentDate,
          verifiedDate: payment.verifiedDate,
          status: payment.status,
          isFirstPayment: payment.isFirstPayment,
          adminNote: payment.adminNote,
          paymentProofPath: payment.paymentProofPath
        })),
        pendingPayments: (plan.flexiblePayments || []).filter(p => p.status === 'pending_verification')
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
   * @desc    Get payment proof image for flexible installment payment
   * @route   GET /api/shares/installment/flexible/payment-proof/:transactionId
   * @access  Private (Admin or transaction owner)
   */
  exports.getFlexibleInstallmentPaymentProof = async (req, res) => {
    try {
      const { transactionId } = req.params;
      const userId = req.user.id;
      
      // Find the installment plan with this transaction
      const plan = await InstallmentPlan.findOne({
        'flexiblePayments.transactionId': transactionId
      });
      
      if (!plan) {
        return res.status(404).json({
          success: false,
          message: 'Transaction not found'
        });
      }
      
      // Find the payment
      const payment = plan.flexiblePayments.find(p => p.transactionId === transactionId);
      
      if (!payment || !payment.paymentProofPath) {
        return res.status(404).json({
          success: false,
          message: 'Payment proof not found for this transaction'
        });
      }
      
      // Check authorization
      const user = await User.findById(userId);
      if (!(user && (user.isAdmin || plan.user.toString() === userId))) {
        return res.status(403).json({
          success: false,
          message: 'Unauthorized: You do not have permission to view this payment proof'
        });
      }
  
      // Secure file path resolution
      const securePath = (filePath) => {
        const normalized = path.normalize(filePath);
        if (normalized.startsWith('..') || path.isAbsolute(normalized)) {
          return null; // Prevent directory traversal
        }
        return path.join(process.cwd(), 'uploads', normalized);
      };
  
      // Try multiple possible locations
      const possiblePaths = [
        securePath(payment.paymentProofPath),
        path.join('/opt/render/project/src/uploads', path.basename(payment.paymentProofPath)),
        path.join('/tmp', path.basename(payment.paymentProofPath))
      ].filter(p => p !== null);
  
      let validFilePath = null;
      
      for (const testPath of possiblePaths) {
        try {
          if (fs.existsSync(testPath)) {
            const stats = fs.statSync(testPath);
            if (stats.isFile()) {
              validFilePath = testPath;
              break;
            }
          }
        } catch (err) {
          console.log(`Error checking path ${testPath}: ${err.message}`);
        }
      }
      
      if (!validFilePath) {
        return res.status(404).json({
          success: false,
          message: 'Payment proof file not found on server'
        });
      }
      
      // Determine content type
      const ext = path.extname(validFilePath).toLowerCase();
      const contentTypeMap = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.pdf': 'application/pdf'
      };
      
      const contentType = contentTypeMap[ext] || 'application/octet-stream';
      
      // Set caching headers
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'private, max-age=3600'); // Cache for 1 hour
      
      // Stream the file
      const fileStream = fs.createReadStream(validFilePath);
      fileStream.on('error', (err) => {
        console.error('Error streaming payment proof:', err);
        if (!res.headersSent) {
          res.status(500).json({
            success: false,
            message: 'Error streaming payment proof'
          });
        }
      });
      
      fileStream.pipe(res);
      
    } catch (error) {
      console.error('Error fetching payment proof:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch payment proof',
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
      
      // Update installment with pending payment
      installment.transactionId = transactionId;
      installment.status = 'pending_payment';
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
                `<p>Your next payment is due on ${plan.installments[installmentIndex + 1]?.dueDate.toLocaleDateString() || 'the next installment date'}.</p>`
              }
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
    submitManualInstallmentPayment: exports.submitManualInstallmentPayment,
    payInstallmentWithPaystack: exports.payInstallmentWithPaystack,
    verifyInstallmentPaystack: exports.verifyInstallmentPaystack,
    adminVerifyFlexibleInstallmentPayment: exports.adminVerifyFlexibleInstallmentPayment,
    adminGetAllInstallmentPlans: exports.adminGetAllInstallmentPlans,
    cancelInstallmentPlan: exports.cancelInstallmentPlan,
    checkLatePayments: exports.checkLatePayments,
    getFlexibleInstallmentPaymentProof: exports.getFlexibleInstallmentPaymentProof,
    validateInstallmentInput
  };