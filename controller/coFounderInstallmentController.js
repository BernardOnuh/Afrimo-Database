// controller/coFounderInstallmentController.js
const CoFounderShare = require('../models/CoFounderShare');
const CoFounderInstallmentPlan = require('../models/CoFounderInstallmentPlan');
const UserShare = require('../models/UserShare');
const User = require('../models/User');
const crypto = require('crypto');
const axios = require('axios');
const { sendEmail } = require('../utils/emailService');
const { processReferralCommission } = require('../utils/referralUtils');

// Generate a unique transaction ID
const generateTransactionId = () => {
  return `CFI-${crypto.randomBytes(4).toString('hex').toUpperCase()}-${Date.now().toString().slice(-6)}`;
};

// Input validation middleware
const validateCoFounderInstallmentInput = (req, res, next) => {
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
      message: 'Co-founder installment plans are only available for exactly 1 share. Complete this plan first before starting another.'
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
 * @desc    Calculate co-founder installment plan
 * @route   POST /api/shares/cofounder/installment/calculate
 * @access  Private (User)
 */
const calculateCoFounderInstallmentPlan = async (req, res) => {
  try {
    const { quantity, currency, installmentMonths = 5 } = req.body;
    
    // Get co-founder share configuration
    const coFounderShare = await CoFounderShare.findOne();
    
    if (!coFounderShare) {
      return res.status(400).json({
        success: false,
        message: 'Co-founder share configuration not found'
      });
    }
    
    // Validate available shares
    if (coFounderShare.sharesSold + quantity > coFounderShare.totalShares) {
      return res.status(400).json({
        success: false,
        message: 'Insufficient co-founder shares available',
        availableShares: coFounderShare.totalShares - coFounderShare.sharesSold
      });
    }
    
    // Calculate price based on currency
    const pricePerShare = currency === 'naira' ? 
      coFounderShare.pricing.priceNaira : 
      coFounderShare.pricing.priceUSDT;
    
    const totalPrice = quantity * pricePerShare;
    
    // Calculate minimum down payment (25% for co-founder shares)
    const minimumDownPaymentAmount = totalPrice * 0.25;
    const installmentAmount = totalPrice / installmentMonths;
    const installmentPercentage = 100 / installmentMonths;
    const lateFee = 0.5; // 0.5% late fee per month
    
    // Calculate due dates - MAINTAIN THE CREATION DAY
    const startDate = new Date();
    const creationDay = startDate.getDate();
    
    const monthlyPayments = Array.from({ length: installmentMonths }, (_, i) => {
      const dueDate = new Date(startDate.getFullYear(), startDate.getMonth() + i + 1, creationDay);
      
      // Handle edge case where the target month doesn't have the same day
      if (dueDate.getDate() !== creationDay) {
        dueDate.setDate(0); // Go back to last day of previous month
      }
      
      return {
        installmentNumber: i + 1,
        amount: installmentAmount,
        dueDate,
        percentageOfTotal: installmentPercentage,
        sharesReleased: Math.floor(quantity * (installmentPercentage / 100)),
        isFirstPayment: i === 0
      };
    });
    
    res.status(200).json({
      success: true,
      installmentPlan: {
        totalShares: quantity,
        totalPrice,
        currency,
        installmentMonths,
        minimumDownPaymentAmount,
        minimumDownPaymentPercentage: 25,
        installmentAmount,
        installmentPercentage,
        lateFeePercentage: lateFee,
        monthlyPayments,
        pricePerShare,
        note: "First payment must be at least 25% of total price. Subsequent payments can be flexible amounts using Paystack."
      }
    });
    
  } catch (error) {
    console.error('Error calculating co-founder installment plan:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to calculate co-founder installment plan',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Create new co-founder installment plan
 * @route   POST /api/shares/cofounder/installment/create
 * @access  Private (User)
 */
const createCoFounderInstallmentPlan = async (req, res) => {
  const session = await CoFounderInstallmentPlan.startSession();
  session.startTransaction();
  
  try {
    const { quantity, currency, installmentMonths = 5 } = req.body;
    const userId = req.user.id;
    
    // Check if user already has an active co-founder installment plan
    const existingPlan = await CoFounderInstallmentPlan.findOne({
      user: userId,
      status: { $in: ['active', 'pending'] }
    }).session(session);
    
    if (existingPlan) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: 'You already have an active co-founder installment plan. Please complete or cancel it before starting a new one.',
        planId: existingPlan._id
      });
    }
    
    // Get co-founder share configuration
    const coFounderShare = await CoFounderShare.findOne().session(session);
    
    if (!coFounderShare) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: 'Co-founder share configuration not found'
      });
    }
    
    // Validate available shares
    if (coFounderShare.sharesSold + quantity > coFounderShare.totalShares) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: 'Insufficient co-founder shares available',
        availableShares: coFounderShare.totalShares - coFounderShare.sharesSold
      });
    }
    
    // Calculate price based on currency
    const pricePerShare = currency === 'naira' ? 
      coFounderShare.pricing.priceNaira : 
      coFounderShare.pricing.priceUSDT;
    
    const totalPrice = quantity * pricePerShare;
    
    // Generate plan ID
    const planId = generateTransactionId();
    const minimumDownPaymentAmount = totalPrice * 0.25; // 25% for co-founder shares
    const installmentAmount = totalPrice / installmentMonths;
    const installmentPercentage = 100 / installmentMonths;
    const lateFee = 0.5; // 0.5% late fee
    
    const startDate = new Date();
    const creationDay = startDate.getDate();
    const installments = [];
    
    for (let i = 0; i < installmentMonths; i++) {
      const dueDate = new Date(startDate.getFullYear(), startDate.getMonth() + i + 1, creationDay);
      
      // Handle edge case where the target month doesn't have the same day
      if (dueDate.getDate() !== creationDay) {
        dueDate.setDate(0);
      }
      
      const sharesReleased = Math.floor(quantity * (installmentPercentage / 100));
      
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
    
    // Create co-founder installment plan
    const newPlan = new CoFounderInstallmentPlan({
      planId,
      user: userId,
      totalShares: quantity,
      totalPrice,
      currency,
      installmentMonths,
      minimumDownPaymentAmount,
      minimumDownPaymentPercentage: 25,
      lateFeePercentage: lateFee,
      status: 'pending',
      createdAt: startDate,
      updatedAt: startDate,
      pricePerShare,
      installments,
      sharesReleased: 0,
      totalPaidAmount: 0
    });
    
    await newPlan.save({ session });
    await session.commitTransaction();
    session.endSession();
    
    res.status(201).json({
      success: true,
      message: 'Co-founder installment plan created successfully',
      planId,
      plan: {
        totalShares: quantity,
        totalPrice,
        currency,
        installmentMonths,
        minimumDownPaymentAmount,
        minimumDownPaymentPercentage: 25,
        firstPaymentDue: installments[0].dueDate,
        installmentAmount,
        status: 'pending',
        note: "First payment must be at least 25% of total price. Use Paystack to make payments."
      }
    });
    
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error('Error creating co-founder installment plan:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create co-founder installment plan',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Get user's co-founder installment plans
 * @route   GET /api/shares/cofounder/installment/plans
 * @access  Private (User)
 */
const getUserCoFounderInstallmentPlans = async (req, res) => {
  try {
    const userId = req.user.id;
    const { page = 1, limit = 10 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    // Get plans with pagination
    const [plans, totalCount] = await Promise.all([
      CoFounderInstallmentPlan.find({
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
      
      CoFounderInstallmentPlan.countDocuments({
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
    console.error('Error fetching user co-founder installment plans:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch co-founder installment plans',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Pay co-founder installment with Paystack
 * @route   POST /api/shares/cofounder/installment/paystack/pay
 * @access  Private (User)
 */
const payCoFounderInstallmentWithPaystack = async (req, res) => {
  const session = await CoFounderInstallmentPlan.startSession();
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
    
    // Find the co-founder installment plan
    const plan = await CoFounderInstallmentPlan.findOne({
      planId,
      user: userId
    }).session(session);
    
    if (!plan) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: 'Co-founder installment plan not found'
      });
    }
    
    // Check plan status
    if (plan.status === 'cancelled') {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: 'This co-founder installment plan has been cancelled'
      });
    }
    
    if (plan.status === 'completed') {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: 'This co-founder installment plan has been completed'
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
        message: `First payment must be at least ${plan.currency === 'naira' ? '₦' : '$'}${plan.minimumDownPaymentAmount.toFixed(2)} (25% of total price)`
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
        callback_url: `${process.env.FRONTEND_URL}/cofounder/installment/verify?planId=${planId}`,
        metadata: {
          planId,
          installmentNumber,
          userId,
          transactionId,
          type: 'cofounder-installment'
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
    installment.status = 'pending';
    installment.paymentInitialized = true;
    installment.paymentInitializedAt = new Date();
    
    plan.updatedAt = new Date();
    await plan.save({ session });
    
    await session.commitTransaction();
    session.endSession();
    
    res.status(200).json({
      success: true,
      message: 'Co-founder Paystack payment initialized',
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
    
    console.error('Error initializing co-founder Paystack payment:', error);
    
    let errorMessage = 'Failed to initialize co-founder Paystack payment';
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
 * @desc    Verify Paystack co-founder installment payment
 * @route   GET /api/shares/cofounder/installment/paystack/verify
 * @access  Private (User)
 */
const verifyCoFounderInstallmentPaystack = async (req, res) => {
  const session = await CoFounderInstallmentPlan.startSession();
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
    
    // Find the co-founder installment plan
    const plan = await CoFounderInstallmentPlan.findOne({
      planId,
      user: userId
    }).session(session);
    
    if (!plan) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: 'Co-founder installment plan not found'
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
    plan.totalPaidAmount = (plan.totalPaidAmount || 0) + amount;
    
    // Update plan status if first payment
    if (plan.status === 'pending' && installment.isFirstPayment) {
      plan.status = 'active';
    }
    
    // Calculate shares to release
    const paymentPercentage = (amount / plan.totalPrice) * 100;
    const sharesToRelease = Math.floor(plan.totalShares * (paymentPercentage / 100));
    plan.sharesReleased = (plan.sharesReleased || 0) + sharesToRelease;
    
    // Check if plan is completed
    if (plan.totalPaidAmount >= plan.totalPrice) {
      plan.status = 'completed';
    }
    
    // Save plan updates
    plan.updatedAt = new Date();
    await plan.save({ session });
    
    // Add released shares to user's account if applicable
    if (sharesToRelease > 0 && UserShare.addShares) {
      await UserShare.addShares(plan.user, sharesToRelease, {
        transactionId,
        shares: sharesToRelease,
        pricePerShare: amount / sharesToRelease,
        currency: plan.currency,
        totalAmount: amount,
        paymentMethod: 'co-founder',
        status: 'completed',
        tierBreakdown: {
          tier1: 0,
          tier2: 0,
          tier3: 0
        },
        coFounderInstallmentPayment: true,
        coFounderInstallmentPlanId: plan.planId
      }, { session });
      
      // Update co-founder share sales
      const coFounderShare = await CoFounderShare.findOne().session(session);
      if (coFounderShare) {
        coFounderShare.sharesSold = (coFounderShare.sharesSold || 0) + sharesToRelease;
        await coFounderShare.save({ session });
      }
      
      // Process referral commissions
      try {
        if (processReferralCommission) {
          await processReferralCommission(
            plan.user,
            amount,
            'cofounder',
            transactionId,
            { session }
          );
        }
      } catch (referralError) {
        console.error('Error processing referral commissions:', referralError);
      }
    }
    
    await session.commitTransaction();
    session.endSession();
    
    // Get user details for notification
    const user = await User.findById(userId);
    
    // Send confirmation email
    if (user?.email && sendEmail) {
      try {
        await sendEmail({
          email: user.email,
          subject: 'Co-Founder Installment Payment Confirmation',
          html: `
            <h2>Co-Founder Payment Successful</h2>
            <p>Dear ${user.name},</p>
            <p>Your co-founder installment payment for plan ${plan.planId} has been successfully processed.</p>
            <p>Transaction ID: ${transactionId}</p>
            <p>Amount Paid: ${plan.currency === 'naira' ? '₦' : '$'}${amount.toFixed(2)}</p>
            <p>Co-Founder Shares Released: ${sharesToRelease}</p>
            <p>Total Shares Released: ${plan.sharesReleased} of ${plan.totalShares}</p>
            <p>Remaining Balance: ${plan.currency === 'naira' ? '₦' : '$'}${(plan.totalPrice - plan.totalPaidAmount).toFixed(2)}</p>
            ${plan.status === 'completed' ? 
              `<p>Congratulations! You have completed your co-founder installment plan.</p>` : 
              `<p>You can make your next payment at any time using Paystack.</p>`}
          `
        });
      } catch (emailError) {
        console.error('Failed to send confirmation email:', emailError);
      }
    }
    
    res.status(200).json({
      success: true,
      message: 'Co-founder payment verified successfully',
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
    
    console.error('Error verifying co-founder Paystack payment:', error);
    
    let errorMessage = 'Failed to verify co-founder payment';
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
 * @desc    Cancel co-founder installment plan
 * @route   POST /api/shares/cofounder/installment/cancel
 * @access  Private (User)
 */
const cancelCoFounderInstallmentPlan = async (req, res) => {
    const session = await CoFounderInstallmentPlan.startSession();
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
      
      // Find the co-founder installment plan
      const plan = await CoFounderInstallmentPlan.findOne({
        planId,
        user: userId
      }).session(session);
      
      if (!plan) {
        await session.abortTransaction();
        session.endSession();
        return res.status(404).json({
          success: false,
          message: 'Co-founder installment plan not found'
        });
      }
      
      // Validate plan status
      if (plan.status === 'cancelled') {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({
          success: false,
          message: 'This co-founder installment plan is already cancelled'
        });
      }
      
      if (plan.status === 'completed') {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({
          success: false,
          message: 'Cannot cancel a completed co-founder installment plan'
        });
      }
      
      // Check minimum down payment - FIXED TEMPLATE LITERAL
      if ((plan.totalPaidAmount || 0) < plan.minimumDownPaymentAmount) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({
          success: false,
          message: `You cannot cancel the plan before completing the minimum down payment of ${plan.currency === 'naira' ? '₦' : '$'}${plan.minimumDownPaymentAmount.toFixed(2)} (25%)`
        });
      }
      
      // Update plan status
      plan.status = 'cancelled';
      plan.cancellationReason = reason || 'Cancelled by user';
      plan.updatedAt = new Date();
      await plan.save({ session });
      
      // Get user details
      const user = await User.findById(userId);
      
      // Notify admin - FIXED TEMPLATE LITERALS
      try {
        const adminEmail = process.env.ADMIN_EMAIL || 'admin@afrimobile.com';
        if (sendEmail) {
          await sendEmail({
            email: adminEmail,
            subject: 'Co-Founder Installment Plan Cancelled',
            html: `
              <h2>Co-Founder Installment Plan Cancellation Notice</h2>
              <p>A co-founder installment plan has been cancelled by a user:</p>
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
        }
      } catch (emailError) {
        console.error('Failed to send admin notification:', emailError);
      }
      
      // Send confirmation to user - FIXED TEMPLATE LITERALS
      if (user?.email && sendEmail) {
        try {
          await sendEmail({
            email: user.email,
            subject: 'Co-Founder Installment Plan Cancellation Confirmation',
            html: `
              <h2>Co-Founder Installment Plan Cancellation</h2>
              <p>Dear ${user.name},</p>
              <p>Your co-founder installment plan (ID: ${planId}) has been cancelled as requested.</p>
              <p>Total Price: ${plan.currency === 'naira' ? '₦' : '$'}${plan.totalPrice.toFixed(2)}</p>
              <p>Amount Paid: ${plan.currency === 'naira' ? '₦' : '$'}${plan.totalPaidAmount.toFixed(2)}</p>
              <p>Co-Founder Shares Already Released: ${plan.sharesReleased}</p>
              <p>The co-founder shares you have already received will remain in your account.</p>
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
        message: 'Co-founder installment plan cancelled successfully',
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
      console.error('Error cancelling co-founder installment plan:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to cancel co-founder installment plan',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  };
  
  /**
   * @desc    Admin: Check for late payments with monthly penalty
   * @route   POST /api/shares/cofounder/installment/admin/check-late-payments
   * @access  Private (Admin or System)
   */
  const checkCoFounderLatePayments = async (req, res) => {
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
      
      // Get all active co-founder installment plans
      const activePlans = await CoFounderInstallmentPlan.find({
        status: { $in: ['active', 'pending', 'late'] }
      });
      
      const now = new Date();
      let latePaymentsFound = 0;
      const lateFeeCapPercentage = 7.5; // Cap late fees at 7.5% of total price
      
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
        if (daysSinceLastPayment > 30 && (plan.totalPaidAmount || 0) < plan.totalPrice) {
          const monthsLate = Math.floor(daysSinceLastPayment / 30);
          
          // Calculate late fee with cap
          const remainingBalance = plan.totalPrice - (plan.totalPaidAmount || 0);
          const lateFeePercentage = Math.min(plan.lateFeePercentage || 0.5, lateFeeCapPercentage);
          const monthlyLateFee = (remainingBalance * lateFeePercentage) / 100;
          const totalLateFee = monthlyLateFee * monthsLate;
          const maxAllowedLateFee = (plan.totalPrice * lateFeeCapPercentage) / 100;
          const cappedLateFee = Math.min(totalLateFee, maxAllowedLateFee);
          
          // Update plan if late fee changed
          if (!(plan.currentLateFee) || plan.currentLateFee < cappedLateFee) {
            plan.currentLateFee = cappedLateFee;
            plan.monthsLate = monthsLate;
            plan.status = 'late';
            plan.lastLateCheckDate = now;
            planUpdated = true;
            latePaymentsFound++;
            
            // Notify user - FIXED TEMPLATE LITERALS
            try {
              const user = await User.findById(plan.user);
              if (user?.email && sendEmail) {
                await sendEmail({
                  email: user.email,
                  subject: 'Late Payment Notice - Co-Founder Installment Plan',
                  html: `
                    <h2>Late Payment Notice</h2>
                    <p>Dear ${user.name},</p>
                    <p>We noticed that your co-founder installment plan ${plan.planId} has a late payment.</p>
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
        message: `Co-founder late payment check completed: ${latePaymentsFound} late payments found and processed`,
        latePaymentsFound
      });
      
    } catch (error) {
      console.error('Error checking co-founder late payments:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to check co-founder late payments',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  };

/**
 * @desc    Admin: Get all co-founder installment plans
 * @route   GET /api/shares/cofounder/installment/admin/plans
 * @access  Private (Admin)
 */
const adminGetAllCoFounderInstallmentPlans = async (req, res) => {
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
    
    // Get co-founder installment plans with pagination
    const [plans, totalCount] = await Promise.all([
      CoFounderInstallmentPlan.find(query)
        .skip(skip)
        .limit(parseInt(limit))
        .sort({ updatedAt: -1 })
        .populate('user', 'name email phone'),
      
      CoFounderInstallmentPlan.countDocuments(query)
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
    console.error('Error fetching co-founder installment plans:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch co-founder installment plans',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Export all controller methods
module.exports = {
  calculateCoFounderInstallmentPlan,
  createCoFounderInstallmentPlan,
  getUserCoFounderInstallmentPlans,
  payCoFounderInstallmentWithPaystack,
  verifyCoFounderInstallmentPaystack,
  cancelCoFounderInstallmentPlan,
  checkCoFounderLatePayments,
  adminGetAllCoFounderInstallmentPlans,
  validateCoFounderInstallmentInput
};