// controller/installmentController.js
const Share = require('../models/Share');
const InstallmentPlan = require('../models/InstallmentPlan');
const UserShare = require('../models/UserShare');
const User = require('../models/User');
const crypto = require('crypto');
const { sendEmail } = require('../utils/emailService');
const SiteConfig = require('../models/SiteConfig');
const { processReferralCommission } = require('../utils/referralUtils');

// Generate a unique transaction ID
const generateTransactionId = () => {
  return `INST-${crypto.randomBytes(4).toString('hex').toUpperCase()}-${Date.now().toString().slice(-6)}`;
};

/**
 * @desc    Calculate installment plan
 * @route   POST /api/shares/installment/calculate
 * @access  Private (User)
 */
exports.calculateInstallmentPlan = async (req, res) => {
  try {
    const { quantity, currency, installmentMonths = 5 } = req.body;
    
    if (!quantity || !currency || !['naira', 'usdt'].includes(currency)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid request. Please provide valid quantity, currency (naira or usdt), and installment months.'
      });
    }

    // Validate installment months (default is 5)
    if (installmentMonths < 2 || installmentMonths > 12) {
      return res.status(400).json({
        success: false,
        message: 'Installment plan must be between 2 and 12 months'
      });
    }
    
    // Calculate purchase details
    const purchaseDetails = await Share.calculatePurchase(parseInt(quantity), currency);
    
    if (!purchaseDetails.success) {
      return res.status(400).json({
        success: false,
        message: 'Unable to process this purchase amount.',
        details: purchaseDetails
      });
    }
    
    // Calculate installment amounts
    const installmentAmount = purchaseDetails.totalPrice / installmentMonths;
    const installmentPercentage = 100 / installmentMonths;
    const lateFee = 0.34; // 0.34% late fee
    
    const installmentPlan = {
      totalShares: purchaseDetails.totalShares,
      totalPrice: purchaseDetails.totalPrice,
      currency,
      installmentMonths,
      installmentAmount,
      installmentPercentage,
      lateFeePercentage: lateFee,
      monthlyPayments: Array.from({ length: installmentMonths }, (_, i) => ({
        installmentNumber: i + 1,
        amount: installmentAmount,
        dueDate: new Date(Date.now() + (i * 30 * 24 * 60 * 60 * 1000)), // Roughly 30 days per month
        percentageOfTotal: installmentPercentage
      })),
      tierBreakdown: purchaseDetails.tierBreakdown
    };
    
    res.status(200).json({
      success: true,
      installmentPlan
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
  try {
    const { quantity, currency, installmentMonths = 5 } = req.body;
    const userId = req.user.id;
    
    if (!quantity || !currency || !['naira', 'usdt'].includes(currency)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid request. Please provide valid quantity, currency (naira or usdt), and installment months.'
      });
    }

    // Validate installment months (default is 5)
    if (installmentMonths < 2 || installmentMonths > 12) {
      return res.status(400).json({
        success: false,
        message: 'Installment plan must be between 2 and 12 months'
      });
    }
    
    // Check if user already has an active installment plan
    const existingPlan = await InstallmentPlan.findOne({
      user: userId,
      status: { $in: ['active', 'pending'] }
    });
    
    if (existingPlan) {
      return res.status(400).json({
        success: false,
        message: 'You already have an active installment plan. Please complete or cancel it before starting a new one.',
        planId: existingPlan._id
      });
    }
    
    // Calculate purchase details
    const purchaseDetails = await Share.calculatePurchase(parseInt(quantity), currency);
    
    if (!purchaseDetails.success) {
      return res.status(400).json({
        success: false,
        message: 'Unable to process this purchase amount.',
        details: purchaseDetails
      });
    }
    
    // Generate plan ID
    const planId = generateTransactionId();
    
    // Calculate installment amounts
    const installmentAmount = purchaseDetails.totalPrice / installmentMonths;
    const installmentPercentage = 100 / installmentMonths;
    const lateFee = 0.34; // 0.34% late fee
    
    // Calculate due dates
    const startDate = new Date();
    const installments = [];
    
    for (let i = 0; i < installmentMonths; i++) {
      const dueDate = new Date(startDate);
      dueDate.setMonth(startDate.getMonth() + i);
      
      installments.push({
        installmentNumber: i + 1,
        amount: installmentAmount,
        dueDate,
        status: i === 0 ? 'pending' : 'upcoming', // First payment is pending, others are upcoming
        percentageOfTotal: installmentPercentage,
        lateFee: 0, // Initialize with zero late fee
        paidAmount: 0, // Initialize with zero paid amount
        paidDate: null
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
      lateFeePercentage: lateFee,
      status: 'pending', // Initially pending until first payment
      createdAt: startDate,
      updatedAt: startDate,
      tierBreakdown: purchaseDetails.tierBreakdown,
      installments,
      sharesReleased: 0 // No shares released initially
    });
    
    await newPlan.save();
    
    // Return plan details
    res.status(201).json({
      success: true,
      message: 'Installment plan created successfully',
      planId: planId,
      plan: {
        totalShares: purchaseDetails.totalShares,
        totalPrice: purchaseDetails.totalPrice,
        currency,
        installmentMonths,
        firstPaymentDue: installments[0].dueDate,
        installmentAmount,
        status: 'pending'
      }
    });
    
  } catch (error) {
    console.error('Error creating installment plan:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create installment plan',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Get user's active installment plans
 * @route   GET /api/shares/installment/plans
 * @access  Private (User)
 */
exports.getUserInstallmentPlans = async (req, res) => {
  try {
    const userId = req.user.id;
    
    const plans = await InstallmentPlan.find({
      user: userId,
      // Get all plans except cancelled or completed over 90 days ago
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
    }).sort({ createdAt: -1 });
    
    // Format response
    const formattedPlans = plans.map(plan => ({
      planId: plan.planId,
      status: plan.status,
      totalShares: plan.totalShares,
      totalPrice: plan.totalPrice,
      currency: plan.currency,
      installmentMonths: plan.installmentMonths,
      sharesReleased: plan.sharesReleased,
      remainingShares: plan.totalShares - plan.sharesReleased,
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
      nextPayment: plan.installments.find(i => i.status === 'pending' || i.status === 'late') || null,
      createdAt: plan.createdAt,
      updatedAt: plan.updatedAt
    }));
    
    res.status(200).json({
      success: true,
      plans: formattedPlans
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
 * @desc    Process installment payment with PayStack
 * @route   POST /api/shares/installment/paystack/pay
 * @access  Private (User)
 */
exports.payInstallmentWithPaystack = async (req, res) => {
  try {
    const { planId, email } = req.body;
    const userId = req.user.id;
    
    if (!planId || !email) {
      return res.status(400).json({
        success: false,
        message: 'Please provide planId and email'
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
    
    // Find the next pending or late installment
    const nextInstallment = plan.installments.find(i => 
      i.status === 'pending' || i.status === 'late'
    );
    
    if (!nextInstallment) {
      return res.status(400).json({
        success: false,
        message: 'No pending installments found'
      });
    }
    
    // Calculate amount to pay (including any late fees)
    const amountToPay = nextInstallment.amount + nextInstallment.lateFee;
    
    // Generate transaction ID
    const transactionId = generateTransactionId();
    
    // Create PayStack request
    const paystackRequest = {
      email,
      amount: amountToPay * 100, // Convert to kobo
      reference: transactionId,
      callback_url: `${process.env.FRONTEND_URL}/installment/verify?txref=${transactionId}&planId=${planId}`,
      metadata: {
        userId,
        planId,
        installmentNumber: nextInstallment.installmentNumber,
        transactionId
      }
    };
    
    // Call PayStack API
    const axios = require('axios');
    const paystackResponse = await axios.post(
      'https://api.paystack.co/transaction/initialize',
      paystackRequest,
      {
        headers: {
          'Authorization': `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    if (!paystackResponse.data.status) {
      throw new Error('PayStack initialization failed');
    }
    
    // Update the installment with transaction ID
    nextInstallment.transactionId = transactionId;
    plan.updatedAt = new Date();
    await plan.save();
    
    // Return success with payment URL
    res.status(200).json({
      success: true,
      message: 'Payment initialized successfully',
      data: {
        authorization_url: paystackResponse.data.data.authorization_url,
        reference: transactionId,
        amount: amountToPay,
        installmentNumber: nextInstallment.installmentNumber
      }
    });
    
  } catch (error) {
    console.error('Error initiating installment payment:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to initiate payment',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Verify PayStack payment for installment
 * @route   GET /api/shares/installment/paystack/verify/:reference
 * @access  Private (User)
 */
exports.verifyInstallmentPaystack = async (req, res) => {
  try {
    const { reference } = req.params;
    const userId = req.user.id;
    
    if (!reference) {
      return res.status(400).json({
        success: false,
        message: 'Transaction reference is required'
      });
    }
    
    // Find the installment plan with this transaction
    const plan = await InstallmentPlan.findOne({
      user: userId,
      'installments.transactionId': reference
    });
    
    if (!plan) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found'
      });
    }
    
    // Call PayStack to verify
    const axios = require('axios');
    const verification = await axios.get(
      `https://api.paystack.co/transaction/verify/${reference}`,
      {
        headers: {
          'Authorization': `Bearer ${process.env.PAYSTACK_SECRET_KEY}`
        }
      }
    );
    
    if (!verification.data.status || verification.data.data.status !== 'success') {
      return res.status(400).json({
        success: false,
        message: 'Payment verification failed',
        status: verification.data.data.status
      });
    }
    
    // Payment successful, update installment status
    const installment = plan.installments.find(i => i.transactionId === reference);
    
    // If installment already paid, prevent double payment
    if (installment.status === 'paid') {
      return res.status(400).json({
        success: false,
        message: 'This installment has already been paid'
      });
    }
    
    // Update installment status
    installment.status = 'paid';
    installment.paidAmount = verification.data.data.amount / 100; // Convert from kobo
    installment.paidDate = new Date();
    
    // If first payment, update plan status to active
    if (plan.status === 'pending') {
      plan.status = 'active';
    }
    
    // Calculate shares to release based on percentage
    const sharesToRelease = Math.floor(plan.totalShares * (installment.percentageOfTotal / 100));
    
    // Update plan
    plan.sharesReleased += sharesToRelease;
    plan.updatedAt = new Date();
    
    // Set next installment to pending if available
    const nextInstallmentIndex = plan.installments.findIndex(i => 
      i.installmentNumber === installment.installmentNumber + 1
    );
    
    if (nextInstallmentIndex !== -1) {
      plan.installments[nextInstallmentIndex].status = 'pending';
    } else {
      // If no next installment, plan is completed
      if (plan.installments.every(i => i.status === 'paid')) {
        plan.status = 'completed';
      }
    }
    
    await plan.save();
    
    // Add released shares to user's account if shares > 0
    if (sharesToRelease > 0) {
      await UserShare.addShares(userId, sharesToRelease, {
        transactionId: reference,
        shares: sharesToRelease,
        pricePerShare: installment.amount / sharesToRelease,
        currency: plan.currency,
        totalAmount: installment.amount,
        paymentMethod: 'paystack',
        status: 'completed',
        tierBreakdown: {
          tier1: Math.floor(plan.tierBreakdown.tier1 * (installment.percentageOfTotal / 100)),
          tier2: Math.floor(plan.tierBreakdown.tier2 * (installment.percentageOfTotal / 100)),
          tier3: Math.floor(plan.tierBreakdown.tier3 * (installment.percentageOfTotal / 100))
        },
        installmentPayment: true,
        installmentPlanId: plan.planId,
        installmentNumber: installment.installmentNumber
      });
      
      // Update global share sales
      const shareConfig = await Share.getCurrentConfig();
      shareConfig.sharesSold += sharesToRelease;
      
      // Update tier sales (proportionally)
      const tier1Shares = Math.floor(plan.tierBreakdown.tier1 * (installment.percentageOfTotal / 100));
      const tier2Shares = Math.floor(plan.tierBreakdown.tier2 * (installment.percentageOfTotal / 100));
      const tier3Shares = Math.floor(plan.tierBreakdown.tier3 * (installment.percentageOfTotal / 100));
      
      shareConfig.tierSales.tier1Sold += tier1Shares;
      shareConfig.tierSales.tier2Sold += tier2Shares;
      shareConfig.tierSales.tier3Sold += tier3Shares;
      
      await shareConfig.save();
      
      // Process referral commissions (only for the paid installment amount)
      try {
        const referralResult = await processReferralCommission(
          userId,
          reference,
          installment.amount,
          plan.currency,
          'share',
          'UserShare'
        );
        
        console.log('Installment referral commission process result:', referralResult);
      } catch (referralError) {
        console.error('Error processing installment referral commissions:', referralError);
      }
    }
    
    // Get user details for notification
    const user = await User.findById(userId);
    
    // Send confirmation email to user
    if (user && user.email) {
      try {
        await sendEmail({
          email: user.email,
          subject: 'AfriMobile - Installment Payment Successful',
          html: `
            <h2>Installment Payment Confirmation</h2>
            <p>Dear ${user.name},</p>
            <p>Your installment payment of ${plan.currency === 'naira' ? '₦' : '$'}${installment.paidAmount} for plan ${plan.planId} has been completed successfully.</p>
            <p>Transaction Reference: ${reference}</p>
            <p>Installment: ${installment.installmentNumber} of ${plan.installmentMonths}</p>
            <p>Shares Released: ${sharesToRelease}</p>
            <p>Total Shares Released: ${plan.sharesReleased} of ${plan.totalShares}</p>
            ${nextInstallmentIndex !== -1 ? 
              `<p>Your next installment of ${plan.currency === 'naira' ? '₦' : '$'}${plan.installments[nextInstallmentIndex].amount} is due on ${new Date(plan.installments[nextInstallmentIndex].dueDate).toLocaleDateString()}.</p>` : 
              `<p>Congratulations! You have completed all installments for this plan.</p>`
            }
            <p>Thank you for your investment in AfriMobile!</p>
          `
        });
      } catch (emailError) {
        console.error('Failed to send installment confirmation email:', emailError);
      }
    }
    
    // Return success response
    res.status(200).json({
      success: true,
      message: 'Installment payment verified successfully',
      data: {
        installmentNumber: installment.installmentNumber,
        amount: installment.paidAmount,
        date: installment.paidDate,
        planStatus: plan.status,
        sharesReleased: sharesToRelease,
        totalSharesReleased: plan.sharesReleased,
        remainingShares: plan.totalShares - plan.sharesReleased
      }
    });
    
  } catch (error) {
    console.error('Error verifying installment payment:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to verify payment',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Submit manual payment for installment
 * @route   POST /api/shares/installment/manual/submit
 * @access  Private (User)
 */
exports.submitManualInstallmentPayment = async (req, res) => {
  try {
    const { planId, paymentMethod, bankName, accountName, reference } = req.body;
    const userId = req.user.id;
    const paymentProofImage = req.file; // Uploaded file from multer middleware
    
    if (!planId || !paymentMethod || !paymentProofImage) {
      return res.status(400).json({
        success: false,
        message: 'Please provide planId, payment method, and payment proof image'
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
    
    // Find the next pending or late installment
    const nextInstallment = plan.installments.find(i => 
      i.status === 'pending' || i.status === 'late'
    );
    
    if (!nextInstallment) {
      return res.status(400).json({
        success: false,
        message: 'No pending installments found'
      });
    }
    
    // Calculate amount to pay (including any late fees)
    const amountToPay = nextInstallment.amount + nextInstallment.lateFee;
    
    // Generate transaction ID
    const transactionId = generateTransactionId();
    
    // Save payment proof image to storage
    // The file path is already provided by multer (req.file.path)
    const paymentProofPath = paymentProofImage.path;
    
    // Update the installment with transaction ID and mark as pending verification
    nextInstallment.transactionId = transactionId;
    nextInstallment.status = 'pending_verification';
    nextInstallment.paymentProofPath = paymentProofPath;
    nextInstallment.manualPaymentDetails = {
      bankName: bankName || null,
      accountName: accountName || null,
      reference: reference || null,
      paymentMethod: `manual_${paymentMethod}`
    };
    
    plan.updatedAt = new Date();
    await plan.save();
    
    // Get user details
    const user = await User.findById(userId);
    
    // Notify admin about new manual payment
    try {
      const adminEmail = process.env.ADMIN_EMAIL || 'admin@afrimobile.com';
      await sendEmail({
        email: adminEmail,
        subject: 'AfriMobile - New Installment Manual Payment Requires Verification',
        html: `
          <h2>Installment Manual Payment Verification Required</h2>
          <p>A new manual payment for an installment plan has been submitted:</p>
          <ul>
            <li>User: ${user.name} (${user.email})</li>
            <li>Plan ID: ${planId}</li>
            <li>Transaction ID: ${transactionId}</li>
            <li>Installment: ${nextInstallment.installmentNumber} of ${plan.installmentMonths}</li>
            <li>Amount: ${plan.currency === 'naira' ? '₦' : '$'}${amountToPay}</li>
            <li>Payment Method: ${paymentMethod}</li>
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
    
    // Return success response
    res.status(200).json({
      success: true,
      message: 'Installment payment proof submitted successfully and awaiting verification',
      data: {
        transactionId,
        installmentNumber: nextInstallment.installmentNumber,
        amount: amountToPay,
        status: 'pending_verification'
      }
    });
    
  } catch (error) {
    console.error('Error submitting manual installment payment:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to submit manual installment payment',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Admin: Verify manual installment payment
 * @route   POST /api/shares/installment/admin/manual/verify
 * @access  Private (Admin)
 */
exports.adminVerifyManualInstallmentPayment = async (req, res) => {
  try {
    const { transactionId, approved, adminNote } = req.body;
    const adminId = req.user.id;
    
    // Check if admin
    const admin = await User.findById(adminId);
    if (!admin || !admin.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized: Admin access required'
      });
    }
    
    // Find the installment plan with this transaction
    const plan = await InstallmentPlan.findOne({
      'installments.transactionId': transactionId
    });
    
    if (!plan) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found'
      });
    }
    
    // Find the installment
    const installment = plan.installments.find(i => i.transactionId === transactionId);
    
    if (!installment) {
      return res.status(404).json({
        success: false,
        message: 'Installment not found'
      });
    }
    
    if (installment.status !== 'pending_verification') {
      return res.status(400).json({
        success: false,
        message: `Installment status is not pending verification. Current status: ${installment.status}`
      });
    }
    
    // Update installment status
    if (approved) {
      installment.status = 'paid';
      installment.paidAmount = installment.amount + installment.lateFee;
      installment.paidDate = new Date();
      installment.adminNote = adminNote || 'Verified by admin';
      
      // If first payment, update plan status to active
      if (plan.status === 'pending') {
        plan.status = 'active';
      }
      
      // Calculate shares to release based on percentage
      const sharesToRelease = Math.floor(plan.totalShares * (installment.percentageOfTotal / 100));
      
      // Update plan
      plan.sharesReleased += sharesToRelease;
      
      // Set next installment to pending if available
      const nextInstallmentIndex = plan.installments.findIndex(i => 
        i.installmentNumber === installment.installmentNumber + 1
      );
      
      if (nextInstallmentIndex !== -1) {
        plan.installments[nextInstallmentIndex].status = 'pending';
      } else {
        // If no next installment, plan is completed
        if (plan.installments.every(i => i.status === 'paid' || i.status === 'paid')) {
          plan.status = 'completed';
        }
      }
      
      // Add released shares to user's account if shares > 0
      if (sharesToRelease > 0) {
        await UserShare.addShares(plan.user, sharesToRelease, {
          transactionId,
          shares: sharesToRelease,
          pricePerShare: installment.amount / sharesToRelease,
          currency: plan.currency,
          totalAmount: installment.amount,
          paymentMethod: installment.manualPaymentDetails?.paymentMethod || 'manual',
          status: 'completed',
          tierBreakdown: {
            tier1: Math.floor(plan.tierBreakdown.tier1 * (installment.percentageOfTotal / 100)),
            tier2: Math.floor(plan.tierBreakdown.tier2 * (installment.percentageOfTotal / 100)),
            tier3: Math.floor(plan.tierBreakdown.tier3 * (installment.percentageOfTotal / 100))
          },
          installmentPayment: true,
          installmentPlanId: plan.planId,
          installmentNumber: installment.installmentNumber
        });
        
       // Update global share sales
       const shareConfig = await Share.getCurrentConfig();
       shareConfig.sharesSold += sharesToRelease;
       
       // Update tier sales (proportionally)
       const tier1Shares = Math.floor(plan.tierBreakdown.tier1 * (installment.percentageOfTotal / 100));
       const tier2Shares = Math.floor(plan.tierBreakdown.tier2 * (installment.percentageOfTotal / 100));
       const tier3Shares = Math.floor(plan.tierBreakdown.tier3 * (installment.percentageOfTotal / 100));
       
       shareConfig.tierSales.tier1Sold += tier1Shares;
       shareConfig.tierSales.tier2Sold += tier2Shares;
       shareConfig.tierSales.tier3Sold += tier3Shares;
       
       await shareConfig.save();
       
       // Process referral commissions (only for the paid installment amount)
       try {
         const referralResult = await processReferralCommission(
           plan.user,
           transactionId,
           installment.amount,
           plan.currency,
           'share',
           'UserShare'
         );
         
         console.log('Installment referral commission process result:', referralResult);
       } catch (referralError) {
         console.error('Error processing installment referral commissions:', referralError);
       }
     }
   } else {
     // Payment rejected
     installment.status = 'pending'; // Reset to pending so they can try again
     installment.adminNote = adminNote || 'Rejected by admin';
   }
   
   plan.updatedAt = new Date();
   await plan.save();
   
   // Get user details for notification
   const user = await User.findById(plan.user);
   
   // Send notification email to user
   if (user && user.email) {
     try {
       if (approved) {
         await sendEmail({
           email: user.email,
           subject: 'AfriMobile - Installment Payment Verified',
           html: `
             <h2>Installment Payment Confirmation</h2>
             <p>Dear ${user.name},</p>
             <p>Your installment payment for plan ${plan.planId} has been verified and processed successfully.</p>
             <p>Transaction ID: ${transactionId}</p>
             <p>Installment: ${installment.installmentNumber} of ${plan.installmentMonths}</p>
             <p>Amount: ${plan.currency === 'naira' ? '₦' : '$'}${installment.paidAmount}</p>
             <p>Shares Released: ${Math.floor(plan.totalShares * (installment.percentageOfTotal / 100))}</p>
             <p>Total Shares Released: ${plan.sharesReleased} of ${plan.totalShares}</p>
             ${plan.status !== 'completed' ? 
               `<p>Your next installment is due on ${new Date(plan.installments.find(i => i.status === 'pending')?.dueDate).toLocaleDateString()}.</p>` : 
               `<p>Congratulations! You have completed all installments for this plan.</p>`
             }
             <p>Thank you for your investment in AfriMobile!</p>
             ${adminNote ? `<p>Note: ${adminNote}</p>` : ''}
           `
         });
       } else {
         await sendEmail({
           email: user.email,
           subject: 'AfriMobile - Installment Payment Verification Failed',
           html: `
             <h2>Installment Payment Verification</h2>
             <p>Dear ${user.name},</p>
             <p>We regret to inform you that your recent installment payment for plan ${plan.planId} could not be verified.</p>
             <p>Transaction ID: ${transactionId}</p>
             <p>Installment: ${installment.installmentNumber} of ${plan.installmentMonths}</p>
             <p>Please submit a new payment or contact our support team for assistance.</p>
             ${adminNote ? `<p>Reason: ${adminNote}</p>` : ''}
           `
         });
       }
     } catch (emailError) {
       console.error('Failed to send installment verification email:', emailError);
     }
   }
   
   // Return success response
   res.status(200).json({
     success: true,
     message: approved ? 'Installment payment verified successfully' : 'Installment payment verification rejected',
     approved,
     data: {
       planId: plan.planId,
       installmentNumber: installment.installmentNumber,
       status: installment.status,
       planStatus: plan.status
     }
   });
   
 } catch (error) {
   console.error('Error verifying manual installment payment:', error);
   res.status(500).json({
     success: false,
     message: 'Failed to verify manual installment payment',
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
   
   // Check if admin
   const admin = await User.findById(adminId);
   if (!admin || !admin.isAdmin) {
     return res.status(403).json({
       success: false,
       message: 'Unauthorized: Admin access required'
     });
   }
   
   // Query parameters
   const { status, page = 1, limit = 20 } = req.query;
   const skip = (parseInt(page) - 1) * parseInt(limit);
   
   // Build query
   const query = {};
   if (status && ['pending', 'active', 'late', 'completed', 'cancelled'].includes(status)) {
     query.status = status;
   }
   
   // Get installment plans
   const plans = await InstallmentPlan.find(query)
     .skip(skip)
     .limit(parseInt(limit))
     .sort({ updatedAt: -1 })
     .populate('user', 'name email phone');
   
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
     sharesReleased: plan.sharesReleased,
     remainingShares: plan.totalShares - plan.sharesReleased,
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
     nextInstallment: plan.installments.find(i => 
       i.status === 'pending' || i.status === 'late' || i.status === 'pending_verification'
     )
   }));
   
   // Count total
   const totalCount = await InstallmentPlan.countDocuments(query);
   
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
* @desc    Cancel installment plan
* @route   POST /api/shares/installment/cancel
* @access  Private (User)
*/
exports.cancelInstallmentPlan = async (req, res) => {
 try {
   const { planId, reason } = req.body;
   const userId = req.user.id;
   
   if (!planId) {
     return res.status(400).json({
       success: false,
       message: 'Please provide planId'
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
   
   if (plan.status === 'cancelled') {
     return res.status(400).json({
       success: false,
       message: 'This installment plan is already cancelled'
     });
   }
   
   if (plan.status === 'completed') {
     return res.status(400).json({
       success: false,
       message: 'Cannot cancel a completed installment plan'
     });
   }
   
   // Update plan status to cancelled
   plan.status = 'cancelled';
   plan.cancellationReason = reason || 'Cancelled by user';
   plan.updatedAt = new Date();
   
   // Mark all pending installments as cancelled
   plan.installments.forEach(installment => {
     if (installment.status === 'pending' || installment.status === 'late' || installment.status === 'pending_verification') {
       installment.status = 'cancelled';
     }
   });
   
   await plan.save();
   
   // Get user details
   const user = await User.findById(userId);
   
   // Notify admin about cancellation
   try {
     const adminEmail = process.env.ADMIN_EMAIL || 'admin@afrimobile.com';
     await sendEmail({
       email: adminEmail,
       subject: 'AfriMobile - Installment Plan Cancelled',
       html: `
         <h2>Installment Plan Cancellation Notice</h2>
         <p>An installment plan has been cancelled by a user:</p>
         <ul>
           <li>User: ${user.name} (${user.email})</li>
           <li>Plan ID: ${planId}</li>
           <li>Total Shares: ${plan.totalShares}</li>
           <li>Shares Released: ${plan.sharesReleased}</li>
           <li>Reason: ${reason || 'Not provided'}</li>
         </ul>
       `
     });
   } catch (emailError) {
     console.error('Failed to send admin notification for cancellation:', emailError);
   }
   
   // Send cancellation confirmation to user
   if (user && user.email) {
     try {
       await sendEmail({
         email: user.email,
         subject: 'AfriMobile - Installment Plan Cancellation Confirmation',
         html: `
           <h2>Installment Plan Cancellation</h2>
           <p>Dear ${user.name},</p>
           <p>Your installment plan (ID: ${planId}) has been cancelled as requested.</p>
           <p>Total Shares: ${plan.totalShares}</p>
           <p>Shares Already Released: ${plan.sharesReleased}</p>
           <p>If you have any questions, please contact our support team.</p>
         `
       });
     } catch (emailError) {
       console.error('Failed to send cancellation confirmation email:', emailError);
     }
   }
   
   // Return success response
   res.status(200).json({
     success: true,
     message: 'Installment plan cancelled successfully',
     data: {
       planId,
       status: 'cancelled',
       sharesReleased: plan.sharesReleased
     }
   });
   
 } catch (error) {
   console.error('Error cancelling installment plan:', error);
   res.status(500).json({
     success: false,
     message: 'Failed to cancel installment plan',
     error: process.env.NODE_ENV === 'development' ? error.message : undefined
   });
 }
};

/**
* @desc    Admin: Run the job to check for late payments (can be called via CRON)
* @route   POST /api/shares/installment/admin/check-late-payments
* @access  Private (Admin or System)
*/
exports.checkLatePayments = async (req, res) => {
 try {
   // Check admin access if request from user
   if (req.user) {
     const adminId = req.user.id;
     const admin = await User.findById(adminId);
     if (!admin || !admin.isAdmin) {
       return res.status(403).json({
         success: false,
         message: 'Unauthorized: Admin access required'
       });
     }
   }
   
   // Get all active installment plans with pending payments
   const activePlans = await InstallmentPlan.find({
     status: { $in: ['active', 'pending', 'late'] },
     'installments.status': { $in: ['pending', 'late'] }
   });
   
   // Current date
   const now = new Date();
   let latePaymentsFound = 0;
   
   // Loop through plans to check for late payments
   for (const plan of activePlans) {
     let planUpdated = false;
     let planStatus = plan.status;
     
     // Check each installment
     for (const installment of plan.installments) {
       // Only check pending installments
       if (installment.status === 'pending') {
         // Check if due date has passed
         if (new Date(installment.dueDate) < now) {
           // Calculate days late
           const daysLate = Math.floor((now - new Date(installment.dueDate)) / (1000 * 60 * 60 * 24));
           
           // Mark as late and calculate late fee
           if (daysLate > 0) {
             installment.status = 'late';
             
             // Calculate late fee (0.34% of installment amount per day)
             const lateFeePercentage = plan.lateFeePercentage || 0.34;
             const lateFee = (installment.amount * lateFeePercentage * daysLate) / 100;
             
             // Cap late fee at 20% of installment amount
             installment.lateFee = Math.min(lateFee, installment.amount * 0.2);
             
             latePaymentsFound++;
             planUpdated = true;
             planStatus = 'late';
           }
         }
       } else if (installment.status === 'late') {
         // Already late, update the late fee if more days have passed
         const daysLate = Math.floor((now - new Date(installment.dueDate)) / (1000 * 60 * 60 * 24));
         
         // Calculate late fee (0.34% of installment amount per day)
         const lateFeePercentage = plan.lateFeePercentage || 0.34;
         const lateFee = (installment.amount * lateFeePercentage * daysLate) / 100;
         
         // Cap late fee at 20% of installment amount
         const newLateFee = Math.min(lateFee, installment.amount * 0.2);
         
         // Only update if late fee has increased
         if (newLateFee > installment.lateFee) {
           installment.lateFee = newLateFee;
           planUpdated = true;
         }
       }
     }
     
     // Update plan if any changes
     if (planUpdated) {
       plan.status = planStatus;
       plan.updatedAt = now;
       await plan.save();
       
       // Notify user about late payment
       try {
         const user = await User.findById(plan.user);
         if (user && user.email) {
           // Find the late installment
           const lateInstallment = plan.installments.find(i => i.status === 'late');
           
           if (lateInstallment) {
             // Only send notification if this is a newly late payment
             await sendEmail({
               email: user.email,
               subject: 'AfriMobile - Late Installment Payment Notice',
               html: `
                 <h2>Late Installment Payment Notice</h2>
                 <p>Dear ${user.name},</p>
                 <p>We noticed that your installment payment for plan ${plan.planId} is overdue.</p>
                 <p>Installment: ${lateInstallment.installmentNumber} of ${plan.installmentMonths}</p>
                 <p>Due Date: ${new Date(lateInstallment.dueDate).toLocaleDateString()}</p>
                 <p>Amount: ${plan.currency === 'naira' ? '₦' : '$'}${lateInstallment.amount}</p>
                 <p>Late Fee: ${plan.currency === 'naira' ? '₦' : '$'}${lateInstallment.lateFee.toFixed(2)}</p>
                 <p>Total Amount Due: ${plan.currency === 'naira' ? '₦' : '$'}${(lateInstallment.amount + lateInstallment.lateFee).toFixed(2)}</p>
                 <p>Please make your payment as soon as possible to avoid additional late fees.</p>
               `
             });
           }
         }
       } catch (emailError) {
         console.error('Failed to send late payment notification:', emailError);
       }
     }
   }
   
   // Return success response
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
* @desc    Get payment proof image for installment
* @route   GET /api/shares/installment/payment-proof/:transactionId
* @access  Private (Admin or transaction owner)
*/
exports.getInstallmentPaymentProof = async (req, res) => {
 try {
   const { transactionId } = req.params;
   const userId = req.user.id;
   
   // Find the installment plan
   const plan = await InstallmentPlan.findOne({
     'installments.transactionId': transactionId
   });
   
   if (!plan) {
     return res.status(404).json({
       success: false,
       message: 'Transaction not found'
     });
   }
   
   const installment = plan.installments.find(i => i.transactionId === transactionId);
   
   if (!installment || !installment.paymentProofPath) {
     return res.status(404).json({
       success: false,
       message: 'Payment proof not found for this transaction'
     });
   }
   
   // Check if user is admin or transaction owner
   const user = await User.findById(userId);
   if (!(user && (user.isAdmin || plan.user.toString() === userId))) {
     return res.status(403).json({
       success: false,
       message: 'Unauthorized: You do not have permission to view this payment proof'
     });
   }
   
   // Send the file
   res.sendFile(installment.paymentProofPath, { root: process.cwd() });
   
 } catch (error) {
   console.error('Error fetching installment payment proof:', error);
   res.status(500).json({
     success: false,
     message: 'Failed to fetch payment proof',
     error: process.env.NODE_ENV === 'development' ? error.message : undefined
   });
 }
};