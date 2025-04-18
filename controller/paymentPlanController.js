const PaymentPlan = require('../models/PaymentPlan');
const Share = require('../models/Share');
const CoFounderShare = require('../models/CoFounderShare');
const User = require('../models/User');
const UserShare = require('../models/UserShare');
const crypto = require('crypto');
const axios = require('axios');
const { sendEmail } = require('../utils/emailService');
const { processReferralCommission } = require('../utils/referralUtils');
const PaymentTransaction = require('../models/Transaction');

// Generate a unique transaction ID
const generateTransactionId = () => {
  return `PPL-${crypto.randomBytes(4).toString('hex').toUpperCase()}-${Date.now().toString().slice(-6)}`;
};

/**
 * @desc    Create a new payment plan
 * @route   POST /api/payment-plans
 * @access  Private (User)
 */
exports.createPaymentPlan = async (req, res) => {
  try {
    const { planType, totalUnits, initialPaymentPercentage, currency } = req.body;
    const userId = req.user.id;
    
    // Validate required fields
    if (!planType || !totalUnits || !initialPaymentPercentage) {
      return res.status(400).json({
        success: false,
        message: 'Please provide planType, totalUnits, and initialPaymentPercentage'
      });
    }
    
    // Validate plan type
    if (!['share', 'cofounder'].includes(planType)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid plan type. Must be "share" or "cofounder"'
      });
    }
    
    // Validate initial payment (minimum 20%)
    if (initialPaymentPercentage < 20) {
      return res.status(400).json({
        success: false,
        message: 'Initial payment must be at least 20% of the total amount'
      });
    }
    
    // Check if user already has an active payment plan for the same type
    const existingPlan = await PaymentPlan.findOne({
      user: userId,
      planType,
      status: { $in: ['active', 'overdue'] }
    });
    
    if (existingPlan) {
      return res.status(400).json({
        success: false,
        message: `You already have an active payment plan for ${planType}`,
        plan: existingPlan
      });
    }
    
    // Get the current price based on plan type
    let initialPrice, basePenaltyFee;
    if (planType === 'share') {
      const shareConfig = await Share.getCurrentConfig();
      // Assuming tier1 price for simplicity - you might want to modify this based on your needs
      initialPrice = currency === 'naira' ? 
        shareConfig.currentPrices.tier1.priceNaira : 
        shareConfig.currentPrices.tier1.priceUSDT;
      basePenaltyFee = 1500; // Penalty for share payment plans
    } else {
      const coFounderShare = await CoFounderShare.findOne();
      initialPrice = currency === 'naira' ? 
        coFounderShare.pricing.priceNaira : 
        coFounderShare.pricing.priceUSDT;
      basePenaltyFee = 5000; // Penalty for co-founder payment plans
    }
    
    // Calculate initial payment amount
    const totalPrice = initialPrice * totalUnits;
    const initialPaymentAmount = (totalPrice * initialPaymentPercentage) / 100;
    
    // Calculate next payment due date (30 days from now)
    const nextPaymentDue = new Date();
    nextPaymentDue.setDate(nextPaymentDue.getDate() + 30);
    
    // Create payment plan
    const paymentPlan = new PaymentPlan({
      user: userId,
      planType,
      totalUnits,
      initialPrice,
      currency: currency || 'naira',
      nextPaymentDue,
      currentPrice: initialPrice,
      basePenaltyFee
    });
    
    // Save the plan
    await paymentPlan.save();
    
    res.status(201).json({
      success: true,
      message: 'Payment plan created successfully',
      paymentPlan,
      initialPayment: {
        amount: initialPaymentAmount,
        percentage: initialPaymentPercentage
      }
    });
  } catch (error) {
    console.error('Error creating payment plan:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create payment plan',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Get user's payment plans
 * @route   GET /api/payment-plans
 * @access  Private (User)
 */
exports.getUserPaymentPlans = async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Find all plans for the user
    const paymentPlans = await PaymentPlan.find({ user: userId });
    
    res.status(200).json({
      success: true,
      count: paymentPlans.length,
      data: paymentPlans
    });
  } catch (error) {
    console.error('Error fetching payment plans:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch payment plans',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Get payment plan by ID
 * @route   GET /api/payment-plans/:id
 * @access  Private (User)
 */
exports.getPaymentPlanById = async (req, res) => {
  try {
    const userId = req.user.id;
    const planId = req.params.id;
    
    // Find payment plan
    const paymentPlan = await PaymentPlan.findById(planId);
    
    if (!paymentPlan) {
      return res.status(404).json({
        success: false,
        message: 'Payment plan not found'
      });
    }
    
    // Check if plan belongs to user or user is admin
    const user = await User.findById(userId);
    if (paymentPlan.user.toString() !== userId && !user.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized: You do not have permission to view this payment plan'
      });
    }
    
    res.status(200).json({
      success: true,
      data: paymentPlan
    });
  } catch (error) {
    console.error('Error fetching payment plan:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch payment plan',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Make payment for a payment plan via Paystack
 * @route   POST /api/payment-plans/:id/paystack
 * @access  Private (User)
 */
exports.makePaystackPayment = async (req, res) => {
  try {
    const userId = req.user.id;
    const planId = req.params.id;
    const { paymentPercentage, email } = req.body;
    
    if (!paymentPercentage || !email) {
      return res.status(400).json({
        success: false,
        message: 'Please provide paymentPercentage and email'
      });
    }
    
    // Validate payment percentage (minimum 20% for initial payment)
    if (paymentPercentage < 20) {
      return res.status(400).json({
        success: false,
        message: 'Payment percentage must be at least 20%'
      });
    }
    
    // Find payment plan
    const paymentPlan = await PaymentPlan.findById(planId);
    
    if (!paymentPlan) {
      return res.status(404).json({
        success: false,
        message: 'Payment plan not found'
      });
    }
    
    // Check if plan belongs to user
    if (paymentPlan.user.toString() !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized: You do not have permission to make payments for this plan'
      });
    }
    
    // Check if plan is completed
    if (paymentPlan.status === 'completed') {
      return res.status(400).json({
        success: false,
        message: 'This payment plan is already completed'
      });
    }
    
    // Calculate payment amount based on percentage
    const totalRemainingPrice = paymentPlan.getRemainingAmount();
    const paymentAmount = (totalRemainingPrice * paymentPercentage) / 100;
    
    // Generate transaction ID
    const transactionId = generateTransactionId();
    
    // Create PayStack request
    const paystackRequest = {
      email,
      amount: paymentAmount * 100, // Convert to kobo
      reference: transactionId,
      callback_url: `${process.env.FRONTEND_URL}/payment-plans/verify?txref=${transactionId}&planId=${planId}`,
      metadata: {
        userId,
        planId,
        paymentPercentage,
        transactionId
      }
    };
    
    // Call PayStack API
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
    
    // Record pending payment in the plan
    paymentPlan.payments.push({
      transactionId,
      amount: paymentAmount,
      percentage: paymentPercentage,
      paymentMethod: 'paystack',
      status: 'pending'
    });
    
    await paymentPlan.save();
    
    // Return success with payment URL
    res.status(200).json({
      success: true,
      message: 'Payment initialized successfully',
      data: {
        authorization_url: paystackResponse.data.data.authorization_url,
        reference: transactionId,
        amount: paymentAmount
      }
    });
  } catch (error) {
    console.error('Error initializing payment:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to initialize payment',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Verify Paystack payment for a payment plan
 * @route   GET /api/payment-plans/verify/:reference
 * @access  Public
 */
exports.verifyPaystackPayment = async (req, res) => {
  try {
    const { reference } = req.params;
    const { planId } = req.query;
    
    if (!reference || !planId) {
      return res.status(400).json({
        success: false,
        message: 'Reference and planId are required'
      });
    }
    
    // Find payment plan
    const paymentPlan = await PaymentPlan.findById(planId);
    
    if (!paymentPlan) {
      return res.status(404).json({
        success: false,
        message: 'Payment plan not found'
      });
    }
    
    // Find the payment in the plan
    const paymentIndex = paymentPlan.payments.findIndex(p => p.transactionId === reference);
    
    if (paymentIndex === -1) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found in this plan'
      });
    }
    
    // Call PayStack to verify
    const verification = await axios.get(
      `https://api.paystack.co/transaction/verify/${reference}`,
      {
        headers: {
          'Authorization': `Bearer ${process.env.PAYSTACK_SECRET_KEY}`
        }
      }
    );
    
    if (!verification.data.status || verification.data.data.status !== 'success') {
      // Update payment status to failed
      paymentPlan.payments[paymentIndex].status = 'failed';
      await paymentPlan.save();
      
      return res.status(400).json({
        success: false,
        message: 'Payment verification failed',
        status: verification.data.data.status
      });
    }
    
    // Update payment status to completed
    paymentPlan.payments[paymentIndex].status = 'completed';
    
    // Update plan with the new payment
    paymentPlan.addPayment(paymentPlan.payments[paymentIndex]);
    
    // Check if plan is now completed
    if (paymentPlan.status === 'completed') {
      // Allocate the units to the user
      if (paymentPlan.planType === 'share') {
        // Update Share model
        const shareConfig = await Share.getCurrentConfig();
        shareConfig.sharesSold += paymentPlan.totalUnits;
        shareConfig.tierSales.tier1Sold += paymentPlan.totalUnits; // Assuming tier1 for simplicity
        await shareConfig.save();
        
        // Add shares to user
        await UserShare.addShares(paymentPlan.user, paymentPlan.totalUnits, {
          transactionId: reference,
          shares: paymentPlan.totalUnits,
          pricePerShare: paymentPlan.currentPrice,
          currency: paymentPlan.currency,
          totalAmount: paymentPlan.amountPaid,
          paymentMethod: 'payment_plan',
          status: 'completed',
          tierBreakdown: {
            tier1: paymentPlan.totalUnits,
            tier2: 0,
            tier3: 0
          }
        });
      } else if (paymentPlan.planType === 'cofounder') {
        // Update CoFounderShare model
        const coFounderShare = await CoFounderShare.findOne();
        coFounderShare.sharesSold += paymentPlan.totalUnits;
        await coFounderShare.save();
        
        // Create a transaction for the co-founder purchase
        const transaction = await PaymentTransaction.create({
          userId: paymentPlan.user,
          type: 'co-founder',
          amount: paymentPlan.amountPaid,
          currency: paymentPlan.currency,
          shares: paymentPlan.totalUnits,
          status: 'completed',
          reference,
          paymentMethod: 'payment_plan'
        });
        
        // Add shares to user
        await UserShare.addShares(paymentPlan.user, paymentPlan.totalUnits, {
          transactionId: transaction._id,
          shares: paymentPlan.totalUnits,
          pricePerShare: paymentPlan.currentPrice,
          currency: paymentPlan.currency,
          totalAmount: paymentPlan.amountPaid,
          paymentMethod: 'co-founder',
          status: 'completed',
          tierBreakdown: {
            tier1: 0,
            tier2: 0,
            tier3: 0
          }
        });
      }
      
      // Process referral commission for the total amount
      try {
        await processReferralCommission(
          paymentPlan.user,
          reference,
          paymentPlan.amountPaid,
          paymentPlan.currency,
          paymentPlan.planType,
          'PaymentPlan'
        );
      } catch (referralError) {
        console.error('Error processing referral commission:', referralError);
      }
      
      // Send completion notification
      const user = await User.findById(paymentPlan.user);
      if (user && user.email) {
        try {
          await sendEmail({
            email: user.email,
            subject: `Payment Plan Completed - ${paymentPlan.planType === 'share' ? 'Shares' : 'Co-Founder Shares'} Allocated`,
            html: `
              <h2>Payment Plan Completed</h2>
              <p>Dear ${user.name},</p>
              <p>Congratulations! You have successfully completed your payment plan for ${paymentPlan.totalUnits} ${paymentPlan.planType === 'share' ? 'shares' : 'co-founder shares'}.</p>
              <p>Total Amount Paid: ${paymentPlan.currency === 'naira' ? '₦' : '$'}${paymentPlan.amountPaid}</p>
              <p>The ${paymentPlan.planType === 'share' ? 'shares' : 'co-founder shares'} have been allocated to your account.</p>
              <p>Thank you for your investment!</p>
            `
          });
        } catch (emailError) {
          console.error('Failed to send payment plan completion email:', emailError);
        }
      }
    } else {
      // Send payment confirmation
      const user = await User.findById(paymentPlan.user);
      if (user && user.email) {
        try {
          await sendEmail({
            email: user.email,
            subject: `Payment Successful - ${paymentPlan.planType === 'share' ? 'Share' : 'Co-Founder'} Payment Plan`,
            html: `
              <h2>Payment Confirmation</h2>
              <p>Dear ${user.name},</p>
              <p>Your payment of ${paymentPlan.currency === 'naira' ? '₦' : '$'}${paymentPlan.payments[paymentIndex].amount} has been successfully processed.</p>
              <p>Payment Plan Progress: ${paymentPlan.percentagePaid.toFixed(2)}%</p>
              <p>Next Payment Due: ${paymentPlan.nextPaymentDue.toLocaleDateString()}</p>
              <p>Thank you for your continued investment!</p>
            `
          });
        } catch (emailError) {
          console.error('Failed to send payment confirmation email:', emailError);
        }
      }
    }
    
    await paymentPlan.save();
    
    res.status(200).json({
      success: true,
      message: 'Payment verified successfully',
      data: {
        planStatus: paymentPlan.status,
        percentagePaid: paymentPlan.percentagePaid,
        amountPaid: paymentPlan.amountPaid,
        nextPaymentDue: paymentPlan.nextPaymentDue
      }
    });
  } catch (error) {
    console.error('Error verifying payment:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to verify payment',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Submit crypto payment for a payment plan
 * @route   POST /api/payment-plans/:id/crypto
 * @access  Private (User)
 */
exports.submitCryptoPayment = async (req, res) => {
  try {
    const userId = req.user.id;
    const planId = req.params.id;
    const { paymentPercentage, transactionHash } = req.body;
    
    if (!paymentPercentage || !transactionHash) {
      return res.status(400).json({
        success: false,
        message: 'Please provide paymentPercentage and transactionHash'
      });
    }
    
    // Find payment plan
    const paymentPlan = await PaymentPlan.findById(planId);
    
    if (!paymentPlan) {
      return res.status(404).json({
        success: false,
        message: 'Payment plan not found'
      });
    }
    
    // Check if plan belongs to user
    if (paymentPlan.user.toString() !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized: You do not have permission to make payments for this plan'
      });
    }
    
    // Calculate payment amount based on percentage
    const totalRemainingPrice = paymentPlan.getRemainingAmount();
    const paymentAmount = (totalRemainingPrice * paymentPercentage) / 100;
    
    // Generate transaction ID
    const transactionId = generateTransactionId();
    
    // Record pending payment in the plan
    paymentPlan.payments.push({
      transactionId,
      amount: paymentAmount,
      percentage: paymentPercentage,
      paymentMethod: 'crypto',
      status: 'pending'
    });
    
    await paymentPlan.save();
    
    // Notify admin about pending crypto payment
    const admins = await User.find({ isAdmin: true });
    const user = await User.findById(userId);
    
    if (admins.length > 0) {
      try {
        for (const admin of admins) {
          if (admin.email) {
            await sendEmail({
              email: admin.email,
              subject: 'New Crypto Payment for Payment Plan',
              html: `
                <h2>New Crypto Payment Requires Verification</h2>
                <p>User: ${user.name} (${user.email})</p>
                <p>Payment Plan ID: ${planId}</p>
                <p>Payment Amount: ${paymentPlan.currency === 'naira' ? '₦' : '$'}${paymentAmount}</p>
                <p>Transaction Hash: ${transactionHash}</p>
                <p>Please verify this payment in the admin dashboard.</p>
              `
            });
          }
        }
      } catch (emailError) {
        console.error('Failed to send admin notification:', emailError);
      }
    }
    
    res.status(200).json({
      success: true,
      message: 'Crypto payment submitted for verification',
      data: {
        transactionId,
        amount: paymentAmount,
        status: 'pending'
      }
    });
  } catch (error) {
    console.error('Error submitting crypto payment:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to submit crypto payment',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Admin verify crypto payment for a payment plan
 * @route   POST /api/payment-plans/admin/verify-crypto
 * @access  Private (Admin)
 */
exports.adminVerifyCryptoPayment = async (req, res) => {
  try {
    const { planId, transactionId, approved, adminNote } = req.body;
    const adminId = req.user.id;
    
    // Verify admin
    const admin = await User.findById(adminId);
    if (!admin || !admin.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized: Admin access required'
      });
    }
    
    // Find payment plan
    const paymentPlan = await PaymentPlan.findById(planId);
    
    if (!paymentPlan) {
      return res.status(404).json({
        success: false,
        message: 'Payment plan not found'
      });
    }
    
    // Find the payment in the plan
    const paymentIndex = paymentPlan.payments.findIndex(p => p.transactionId === transactionId);
    
    if (paymentIndex === -1) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found in this plan'
      });
    }
    
    if (approved) {
      // Update payment status to completed
      paymentPlan.payments[paymentIndex].status = 'completed';
      
      // Add admin note if provided
      if (adminNote) {
        paymentPlan.payments[paymentIndex].adminNote = adminNote;
      }
      
      // Update plan with the new payment
      paymentPlan.addPayment(paymentPlan.payments[paymentIndex]);
      
      // Check if plan is now completed
      if (paymentPlan.status === 'completed') {
        // Allocate the units to the user
        if (paymentPlan.planType === 'share') {
          // Update Share model
          const shareConfig = await Share.getCurrentConfig();
          shareConfig.sharesSold += paymentPlan.totalUnits;
          shareConfig.tierSales.tier1Sold += paymentPlan.totalUnits; // Assuming tier1 for simplicity
          await shareConfig.save();
          
          // Add shares to user
          await UserShare.addShares(paymentPlan.user, paymentPlan.totalUnits, {
            transactionId,
            shares: paymentPlan.totalUnits,
            pricePerShare: paymentPlan.currentPrice,
            currency: paymentPlan.currency,
            totalAmount: paymentPlan.amountPaid,
            paymentMethod: 'payment_plan',
            status: 'completed',
            tierBreakdown: {
              tier1: paymentPlan.totalUnits,
              tier2: 0,
              tier3: 0
            }
          });
        } else if (paymentPlan.planType === 'cofounder') {
          // Update CoFounderShare model
          const coFounderShare = await CoFounderShare.findOne();
          coFounderShare.sharesSold += paymentPlan.totalUnits;
          await coFounderShare.save();
          
          // Create a transaction for the co-founder purchase
          const transaction = await PaymentTransaction.create({
            userId: paymentPlan.user,
            type: 'co-founder',
            amount: paymentPlan.amountPaid,
            currency: paymentPlan.currency,
            shares: paymentPlan.totalUnits,
            status: 'completed',
            reference: transactionId,
            paymentMethod: 'payment_plan'
          });
          
          // Add shares to user
          await UserShare.addShares(paymentPlan.user, paymentPlan.totalUnits, {
            transactionId: transaction._id,
            shares: paymentPlan.totalUnits,
            pricePerShare: paymentPlan.currentPrice,
            currency: paymentPlan.currency,
            totalAmount: paymentPlan.amountPaid,
            paymentMethod: 'co-founder',
            status: 'completed',
            tierBreakdown: {
              tier1: 0,
              tier2: 0,
              tier3: 0
            }
          });
        }
        
        // Process referral commission for the total amount
        try {
          await processReferralCommission(
            paymentPlan.user,
            transactionId,
            paymentPlan.amountPaid,
            paymentPlan.currency,
            paymentPlan.planType,
            'PaymentPlan'
          );
        } catch (referralError) {
          console.error('Error processing referral commission:', referralError);
        }
        
        // Send completion notification
        const user = await User.findById(paymentPlan.user);
        if (user && user.email) {
          try {
            await sendEmail({
              email: user.email,
              subject: `Payment Plan Completed - ${paymentPlan.planType === 'share' ? 'Shares' : 'Co-Founder Shares'} Allocated`,
              html: `
                <h2>Payment Plan Completed</h2>
                <p>Dear ${user.name},</p>
                <p>Congratulations! You have successfully completed your payment plan for ${paymentPlan.totalUnits} ${paymentPlan.planType === 'share' ? 'shares' : 'co-founder shares'}.</p>
                <p>Total Amount Paid: ${paymentPlan.currency === 'naira' ? '₦' : '$'}${paymentPlan.amountPaid}</p>
                <p>The ${paymentPlan.planType === 'share' ? 'shares' : 'co-founder shares'} have been allocated to your account.</p>
                <p>Thank you for your investment!</p>
              `
            });
          } catch (emailError) {
            console.error('Failed to send payment plan completion email:', emailError);
          }
        }
      } else {
        // Send payment confirmation
        const user = await User.findById(paymentPlan.user);
        if (user && user.email) {
          try {
            await sendEmail({
              email: user.email,
              subject: `Payment Verified - ${paymentPlan.planType === 'share' ? 'Share' : 'Co-Founder'} Payment Plan`,
              html: `
                <h2>Payment Confirmation</h2>
                <p>Dear ${user.name},</p>
                <p>Your crypto payment of ${paymentPlan.currency === 'naira' ? '₦' : '$'}${paymentPlan.payments[paymentIndex].amount} has been verified and processed.</p>
                <p>Payment Plan Progress: ${paymentPlan.percentagePaid.toFixed(2)}%</p>
                <p>Next Payment Due: ${paymentPlan.nextPaymentDue.toLocaleDateString()}</p>
                <p>Thank you for your continued investment!</p>
                ${adminNote ? `<p>Admin Note: ${adminNote}</p>` : ''}
              `
            });
          } catch (emailError) {
            console.error('Failed to send payment confirmation email:', emailError);
          }
        }
      }
    } else {
      // Update payment status to failed
      paymentPlan.payments[paymentIndex].status = 'failed';
      
      // Add admin note if provided
      if (adminNote) {
        paymentPlan.payments[paymentIndex].adminNote = adminNote;
      }
      
      // Notify user about rejected payment
      const user = await User.findById(paymentPlan.user);
      if (user && user.email) {
        try {
          await sendEmail({
            email: user.email,
            subject: `Payment Declined - ${paymentPlan.planType === 'share' ? 'Share' : 'Co-Founder'} Payment Plan`,
            html: `
              <h2>Payment Declined</h2>
              <p>Dear ${user.name},</p>
              <p>Your crypto payment for your payment plan has been declined.</p>
              <p>Transaction ID: ${transactionId}</p>
              ${adminNote ? `<p>Reason: ${adminNote}</p>` : ''}
              <p>Please contact support if you have any questions.</p>
            `
          });
        } catch (emailError) {
          console.error('Failed to send payment rejection email:', emailError);
        }
      }
    }
    
    await paymentPlan.save();
    
    res.status(200).json({
      success: true,
      message: `Payment ${approved ? 'approved' : 'declined'} successfully`,
      data: {
        planStatus: paymentPlan.status,
        percentagePaid: paymentPlan.percentagePaid,
        amountPaid: paymentPlan.amountPaid,
        nextPaymentDue: paymentPlan.nextPaymentDue
      }
    });
  } catch (error) {
    console.error('Error verifying crypto payment:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to verify crypto payment',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Admin get all payment plans
 * @route   GET /api/payment-plans/admin/all
 * @access  Private (Admin)
 */
exports.adminGetAllPaymentPlans = async (req, res) => {
  try {
    const adminId = req.user.id;
    const { status, planType, page = 1, limit = 20 } = req.query;
    
    // Verify admin
    const admin = await User.findById(adminId);
    if (!admin || !admin.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized: Admin access required'
      });
    }
    
    // Build query
    const query = {};
    
    if (status) {
      query.status = status;
    }
    
    if (planType) {
      query.planType = planType;
    }
    
    // Count total
    const total = await PaymentPlan.countDocuments(query);
    
    // Paginate results
    const paymentPlans = await PaymentPlan.find(query)
      .populate('user', 'name email')
      .skip((parseInt(page) - 1) * parseInt(limit))
      .limit(parseInt(limit))
      .sort({ createdAt: -1 });
    
    res.status(200).json({
      success: true,
      count: paymentPlans.length,
      total,
      totalPages: Math.ceil(total / parseInt(limit)),
      currentPage: parseInt(page),
      data: paymentPlans
    });
  } catch (error) {
    console.error('Error fetching payment plans:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch payment plans',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Admin get payment plans for a specific user
 * @route   GET /api/payment-plans/admin/user/:userId
 * @access  Private (Admin)
 */
exports.adminGetUserPaymentPlans = async (req, res) => {
  try {
    const adminId = req.user.id;
    const { userId } = req.params;
    
    // Verify admin
    const admin = await User.findById(adminId);
    if (!admin || !admin.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized: Admin access required'
      });
    }
    
    // Find payment plans for user
    const paymentPlans = await PaymentPlan.find({ user: userId })
      .populate('user', 'name email')
      .sort({ createdAt: -1 });
    
    res.status(200).json({
      success: true,
      count: paymentPlans.length,
      data: paymentPlans
    });
  } catch (error) {
    console.error('Error fetching user payment plans:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch user payment plans',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Admin get overdue payment plans
 * @route   GET /api/payment-plans/admin/overdue
 * @access  Private (Admin)
 */
exports.adminGetOverduePaymentPlans = async (req, res) => {
  try {
    const adminId = req.user.id;
    const { page = 1, limit = 20 } = req.query;
    
    // Verify admin
    const admin = await User.findById(adminId);
    if (!admin || !admin.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized: Admin access required'
      });
    }
    
    // Find overdue payment plans
    const now = new Date();
    const query = {
      status: { $in: ['active', 'overdue'] },
      nextPaymentDue: { $lt: now }
    };
    
    // Count total
    const total = await PaymentPlan.countDocuments(query);
    
    // Paginate results
    const paymentPlans = await PaymentPlan.find(query)
      .populate('user', 'name email')
      .skip((parseInt(page) - 1) * parseInt(limit))
      .limit(parseInt(limit))
      .sort({ nextPaymentDue: 1 });
    
    res.status(200).json({
      success: true,
      count: paymentPlans.length,
      total,
      totalPages: Math.ceil(total / parseInt(limit)),
      currentPage: parseInt(page),
      data: paymentPlans
    });
  } catch (error) {
    console.error('Error fetching overdue payment plans:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch overdue payment plans',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Apply penalties to overdue payment plans (to be run by cron job)
 * @route   POST /api/payment-plans/admin/apply-penalties
 * @access  Private (Admin or System)
 */
exports.applyPenalties = async (req, res) => {
  try {
    const adminId = req.user?.id;
    
    // If request is from a user, verify admin
    if (adminId) {
      const admin = await User.findById(adminId);
      if (!admin || !admin.isAdmin) {
        return res.status(403).json({
          success: false,
          message: 'Unauthorized: Admin access required'
        });
      }
    }
    
    // Apply penalties to overdue plans
    const updatedPlans = await PaymentPlan.applyPenalties();
    
    // Send notifications to affected users
    const overduePlans = await PaymentPlan.find({ status: 'overdue' })
      .populate('user', 'name email');
    
    for (const plan of overduePlans) {
      if (plan.user && plan.user.email) {
        try {
          await sendEmail({
            email: plan.user.email,
            subject: `Payment Plan Overdue - Penalty Applied`,
            html: `
              <h2>Payment Plan Penalty</h2>
              <p>Dear ${plan.user.name},</p>
              <p>Your payment plan for ${plan.planType === 'share' ? 'shares' : 'co-founder shares'} is overdue.</p>
              <p>A penalty of ${plan.currency === 'naira' ? '₦' : '$'}${plan.basePenaltyFee} has been applied to your remaining balance.</p>
              <p>Current Amount Due: ${plan.currency === 'naira' ? '₦' : '$'}${plan.getRemainingAmount()}</p>
              <p>To avoid additional penalties, please make a payment as soon as possible.</p>
            `
          });
        } catch (emailError) {
          console.error('Failed to send penalty notification email:', emailError);
        }
      }
    }
    
    res.status(200).json({
      success: true,
      message: 'Penalties applied successfully',
      updatedPlans
    });
  } catch (error) {
    console.error('Error applying penalties:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to apply penalties',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Admin cancel a payment plan
 * @route   POST /api/payment-plans/admin/cancel/:id
 * @access  Private (Admin)
 */
exports.adminCancelPaymentPlan = async (req, res) => {
  try {
    const adminId = req.user.id;
    const planId = req.params.id;
    const { reason } = req.body;
    
    // Verify admin
    const admin = await User.findById(adminId);
    if (!admin || !admin.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized: Admin access required'
      });
    }
    
    // Find payment plan
    const paymentPlan = await PaymentPlan.findById(planId);
    
    if (!paymentPlan) {
      return res.status(404).json({
        success: false,
        message: 'Payment plan not found'
      });
    }
    
    // Check if plan is already completed
    if (paymentPlan.status === 'completed') {
      return res.status(400).json({
        success: false,
        message: 'Cannot cancel a completed payment plan'
      });
    }
    
    // Update plan status
    paymentPlan.status = 'cancelled';
    paymentPlan.adminNote = reason || 'Cancelled by admin';
    
    await paymentPlan.save();
    
    // Notify user
    const user = await User.findById(paymentPlan.user);
    if (user && user.email) {
      try {
        await sendEmail({
          email: user.email,
          subject: `Payment Plan Cancelled`,
          html: `
            <h2>Payment Plan Cancelled</h2>
            <p>Dear ${user.name},</p>
            <p>Your payment plan for ${paymentPlan.planType === 'share' ? 'shares' : 'co-founder shares'} has been cancelled.</p>
            ${reason ? `<p>Reason: ${reason}</p>` : ''}
            <p>If you have any questions, please contact our support team.</p>
          `
        });
      } catch (emailError) {
        console.error('Failed to send cancellation email:', emailError);
      }
    }
    
    res.status(200).json({
      success: true,
      message: 'Payment plan cancelled successfully'
    });
  } catch (error) {
    console.error('Error cancelling payment plan:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to cancel payment plan',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    User cancel a payment plan
 * @route   POST /api/payment-plans/:id/cancel
 * @access  Private (User)
 */
exports.cancelPaymentPlan = async (req, res) => {
  try {
    const userId = req.user.id;
    const planId = req.params.id;
    
    // Find payment plan
    const paymentPlan = await PaymentPlan.findById(planId);
    
    if (!paymentPlan) {
      return res.status(404).json({
        success: false,
        message: 'Payment plan not found'
      });
    }
    
    // Check if plan belongs to user
    if (paymentPlan.user.toString() !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized: You do not have permission to cancel this payment plan'
      });
    }
    
    // Check if plan is already completed
    if (paymentPlan.status === 'completed') {
      return res.status(400).json({
        success: false,
        message: 'Cannot cancel a completed payment plan'
      });
    }
    
    // Update plan status
    paymentPlan.status = 'cancelled';
    paymentPlan.adminNote = 'Cancelled by user';
    
    await paymentPlan.save();
    
    // Notify user of cancellation
    const user = await User.findById(userId);
    if (user && user.email) {
      try {
        await sendEmail({
          email: user.email,
          subject: `Payment Plan Cancelled`,
          html: `
            <h2>Payment Plan Cancellation Confirmation</h2>
            <p>Dear ${user.name},</p>
            <p>Your payment plan for ${paymentPlan.planType === 'share' ? 'shares' : 'co-founder shares'} has been cancelled as requested.</p>
            <p>If you have any questions or wish to create a new payment plan in the future, please contact our support team.</p>
          `
        });
      } catch (emailError) {
        console.error('Failed to send cancellation confirmation email:', emailError);
      }
    }
    
    res.status(200).json({
      success: true,
      message: 'Payment plan cancelled successfully'
    });
  } catch (error) {
    console.error('Error cancelling payment plan:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to cancel payment plan',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

module.exports = exports;