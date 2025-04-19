// controllers/installmentController.js
const ShareInstallment = require('../models/ShareInstallement');
const Share = require('../models/Share');
const CoFounderShare = require('../models/CoFounderShare');
const UserShare = require('../models/UserShare');
const PaymentTransaction = require('../models/Transaction');
const User = require('../models/User');
const SiteConfig = require('../models/SiteConfig');
const PaymentConfig = require('../models/PaymentConfig');
const crypto = require('crypto');
const axios = require('axios');
const { sendEmail } = require('../utils/emailService');
const { processReferralCommission } = require('../utils/referralUtils');

// Generate a unique transaction ID
const generateTransactionId = () => {
  return `INST-${crypto.randomBytes(4).toString('hex').toUpperCase()}-${Date.now().toString().slice(-6)}`;
};

/**
 * @desc    Initiate installment purchase for regular shares
 * @route   POST /api/shares/installment/initiate
 * @access  Private (User)
 */
exports.initiateShareInstallment = async (req, res) => {
  try {
    const { quantity, initialPercentage, currency } = req.body;
    const userId = req.user.id;
    
    // Validate request
    if (!quantity || !initialPercentage || !currency) {
      return res.status(400).json({
        success: false,
        message: 'Please provide quantity, initialPercentage, and currency'
      });
    }
    
    // Ensure initial percentage is at least 20%
    if (initialPercentage < 20) {
      return res.status(400).json({
        success: false,
        message: 'Initial payment must be at least 20% of the total share price'
      });
    }
    
    // Calculate purchase details for full shares
    const purchaseDetails = await Share.calculatePurchase(parseInt(quantity), currency);
    
    if (!purchaseDetails.success) {
      return res.status(400).json({
        success: false,
        message: 'Unable to process this purchase amount',
        details: purchaseDetails
      });
    }
    
    // Calculate initial payment amount
    const totalPrice = purchaseDetails.totalPrice;
    const initialAmount = (initialPercentage / 100) * totalPrice;
    const remainingAmount = totalPrice - initialAmount;
    
    // Generate transaction IDs
    const installmentId = generateTransactionId();
    const initialPaymentId = generateTransactionId();
    
    // Create installment record
    const installment = await ShareInstallment.create({
      user: userId,
      shareType: 'regular',
      parentShareId: null, // Will be updated after initial payment
      totalShares: purchaseDetails.totalShares,
      pricePerShare: totalPrice / purchaseDetails.totalShares,
      currency,
      totalAmount: totalPrice,
      amountPaid: 0, // Will be updated after initial payment
      remainingAmount: totalPrice, // Will be updated after initial payment
      nextPaymentDue: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
      payments: []
    });
    
    // Return success with details
    res.status(200).json({
      success: true,
      message: 'Installment plan initiated successfully',
      data: {
        installmentId: installment._id,
        installmentTransactionId: installmentId,
        initialPaymentTransactionId: initialPaymentId,
        totalShares: purchaseDetails.totalShares,
        totalAmount: totalPrice,
        initialAmount,
        remainingAmount,
        initialPercentage,
        currency,
        tierBreakdown: purchaseDetails.tierBreakdown
      }
    });
  } catch (error) {
    console.error('Error initiating share installment:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to initiate installment plan',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Initiate installment purchase for co-founder shares
 * @route   POST /api/shares/cofounder/installment/initiate
 * @access  Private (User)
 */
exports.initiateCoFounderInstallment = async (req, res) => {
  try {
    const { quantity, initialPercentage, currency } = req.body;
    const userId = req.user.id;
    
    // Validate request
    if (!quantity || !initialPercentage || !currency) {
      return res.status(400).json({
        success: false,
        message: 'Please provide quantity, initialPercentage, and currency'
      });
    }
    
    // Ensure initial percentage is at least 20%
    if (initialPercentage < 20) {
      return res.status(400).json({
        success: false,
        message: 'Initial payment must be at least 20% of the total share price'
      });
    }
    
    // Find co-founder share configuration
    const coFounderShare = await CoFounderShare.findOne();
    
    if (!coFounderShare) {
      return res.status(400).json({
        success: false,
        message: 'Co-founder share configuration not found'
      });
    }
    
    // Validate available shares
    if (coFounderShare.sharesSold + parseInt(quantity) > coFounderShare.totalShares) {
      return res.status(400).json({
        success: false,
        message: 'Insufficient shares available',
        availableShares: coFounderShare.totalShares - coFounderShare.sharesSold
      });
    }
    
    // Calculate price based on currency
    const pricePerShare = currency === 'naira' ? 
      coFounderShare.pricing.priceNaira : 
      coFounderShare.pricing.priceUSDT;
    
    const totalPrice = parseInt(quantity) * pricePerShare;
    
    // Calculate initial payment amount
    const initialAmount = (initialPercentage / 100) * totalPrice;
    const remainingAmount = totalPrice - initialAmount;
    
    // Generate transaction IDs
    const installmentId = generateTransactionId();
    const initialPaymentId = generateTransactionId();
    
    // Create installment record
    const installment = await ShareInstallment.create({
      user: userId,
      shareType: 'co-founder',
      parentShareId: null, // Will be updated after initial payment
      totalShares: parseInt(quantity),
      pricePerShare: pricePerShare,
      currency,
      totalAmount: totalPrice,
      amountPaid: 0, // Will be updated after initial payment
      remainingAmount: totalPrice, // Will be updated after initial payment
      nextPaymentDue: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
      payments: []
    });
    
    // Return success with details
    res.status(200).json({
      success: true,
      message: 'Co-founder installment plan initiated successfully',
      data: {
        installmentId: installment._id,
        installmentTransactionId: installmentId,
        initialPaymentTransactionId: initialPaymentId,
        totalShares: parseInt(quantity),
        totalAmount: totalPrice,
        initialAmount,
        remainingAmount,
        initialPercentage,
        currency
      }
    });
  } catch (error) {
    console.error('Error initiating co-founder installment:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to initiate installment plan',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Make installment payment
 * @route   POST /api/shares/installment/payment
 * @access  Private (User)
 */
exports.makeInstallmentPayment = async (req, res) => {
  try {
    const { installmentId, amount, paymentMethod } = req.body;
    const userId = req.user.id;
    
    // Validate request
    if (!installmentId || !amount || !paymentMethod) {
      return res.status(400).json({
        success: false,
        message: 'Please provide installmentId, amount, and paymentMethod'
      });
    }
    
    // Find installment
    const installment = await ShareInstallment.findById(installmentId);
    
    if (!installment) {
      return res.status(404).json({
        success: false,
        message: 'Installment plan not found'
      });
    }
    
    // Verify user owns this installment
    if (installment.user.toString() !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized: You do not own this installment plan'
      });
    }
    
    // Check installment status
    if (installment.installmentStatus !== 'active') {
      return res.status(400).json({
        success: false,
        message: `Installment plan is ${installment.installmentStatus}, no payments can be made`
      });
    }
    
    // Calculate minimum payment (20% of remaining amount)
    const minPaymentPercentage = installment.payments.length === 0 ? 20 : 20;
    const minPayment = (minPaymentPercentage / 100) * installment.remainingAmount;
    
    // Verify payment amount
    if (parseFloat(amount) < minPayment) {
      return res.status(400).json({
        success: false,
        message: `Payment must be at least ${minPaymentPercentage}% of the remaining amount (${minPayment.toFixed(2)} ${installment.currency})`,
        minPayment: minPayment.toFixed(2)
      });
    }
    
    // Check if payment exceeds remaining amount
    const paymentAmount = Math.min(parseFloat(amount), installment.remainingAmount);
    
    // Generate transaction ID
    const transactionId = generateTransactionId();
    
    // Process payment based on payment method
    let paymentResponse;
    
    if (paymentMethod === 'paystack') {
      // Paystack payment logic
      const email = req.user.email;
      
      // Create PayStack request
      const paystackRequest = {
        email,
        amount: paymentAmount * 100, // Convert to kobo
        reference: transactionId,
        callback_url: `${process.env.FRONTEND_URL}/installment/payment/verify?txref=${transactionId}&installmentId=${installmentId}`,
        metadata: {
          userId,
          installmentId,
          paymentAmount,
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
      
      paymentResponse = {
        success: true,
        message: 'Payment initialized successfully',
        data: {
          authorization_url: paystackResponse.data.data.authorization_url,
          reference: transactionId,
          amount: paymentAmount
        }
      };
    } else if (paymentMethod === 'crypto') {
      // Crypto payment logic
      const config = installment.shareType === 'regular' ? 
        await SiteConfig.getCurrentConfig() : 
        await PaymentConfig.getCurrentConfig();
      
      paymentResponse = {
        success: true,
        message: 'Please complete your crypto payment',
        data: {
          reference: transactionId,
          amount: paymentAmount,
          companyWalletAddress: config.companyWalletAddress
        }
      };
    } else {
      return res.status(400).json({
        success: false,
        message: 'Invalid payment method'
      });
    }
    
    // Add pending payment to installment
    installment.payments.push({
      amount: paymentAmount,
      paymentDate: new Date(),
      transactionId,
      paymentMethod,
      status: 'pending'
    });
    
    await installment.save();
    
    // Return payment response
    res.status(200).json(paymentResponse);
  } catch (error) {
    console.error('Error making installment payment:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process installment payment',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Verify installment payment (Paystack)
 * @route   GET /api/shares/installment/payment/verify/:reference
 * @access  Private (User)
 */
exports.verifyInstallmentPayment = async (req, res) => {
  try {
    const { reference } = req.params;
    const { installmentId } = req.query;
    
    if (!reference || !installmentId) {
      return res.status(400).json({
        success: false,
        message: 'Transaction reference and installmentId are required'
      });
    }
    
    // Find installment
    const installment = await ShareInstallment.findById(installmentId);
    
    if (!installment) {
      return res.status(404).json({
        success: false,
        message: 'Installment plan not found'
      });
    }
    
    // Find the payment
    const paymentIndex = installment.payments.findIndex(p => p.transactionId === reference);
    
    if (paymentIndex === -1) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found in this installment plan'
      });
    }
    
    const payment = installment.payments[paymentIndex];
    
    // If payment already processed
    if (payment.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: `Payment already ${payment.status}`
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
      installment.payments[paymentIndex].status = 'failed';
      await installment.save();
      
      return res.status(400).json({
        success: false,
        message: 'Payment verification failed',
        status: verification.data.data.status
      });
    }
    
    // Payment successful, update installment
    installment.payments[paymentIndex].status = 'completed';
    
    // Update installment with the paid amount
    const paidAmount = payment.amount;
    installment.amountPaid += paidAmount;
    installment.remainingAmount -= paidAmount;
    
    // Calculate percentage paid
    installment.percentagePaid = (installment.amountPaid / installment.totalAmount) * 100;
    
    // Calculate shares paid
    installment.sharesPaid = (installment.percentagePaid / 100) * installment.totalShares;
    
    // Set next payment due date
    installment.lastPaymentDate = new Date();
    installment.nextPaymentDue = new Date();
    installment.nextPaymentDue.setDate(installment.nextPaymentDue.getDate() + 30);
    
    // Check if fully paid
    if (installment.remainingAmount <= 0) {
      installment.installmentStatus = 'completed';
      installment.completedAt = new Date();
      
      // Process completion logic based on share type
      if (installment.shareType === 'regular') {
        await handleRegularShareCompletion(installment);
      } else if (installment.shareType === 'co-founder') {
        await handleCoFounderShareCompletion(installment);
      }
    }
    
    await installment.save();
    
    // Get user details for notification
    const user = await User.findById(installment.user);
    
    // Send confirmation email
    if (user && user.email) {
      try {
        await sendEmail({
          email: user.email,
          subject: `AfriMobile - Share Installment Payment Successful`,
          html: `
            <h2>Installment Payment Confirmation</h2>
            <p>Dear ${user.name},</p>
            <p>Your installment payment of ${installment.currency === 'naira' ? '₦' : '$'}${paidAmount} has been completed successfully.</p>
            <p>Transaction Reference: ${reference}</p>
            <p>Current Progress: ${installment.percentagePaid.toFixed(2)}% paid</p>
            <p>Remaining Amount: ${installment.currency === 'naira' ? '₦' : '$'}${installment.remainingAmount.toFixed(2)}</p>
            <p>Next Payment Due: ${installment.nextPaymentDue.toLocaleDateString()}</p>
            ${installment.installmentStatus === 'completed' ? 
              `<p>Congratulations! You have completed all payments for this share purchase.</p>` : 
              `<p>Thank you for your continued investment in AfriMobile!</p>`
            }
          `
        });
      } catch (emailError) {
        console.error('Failed to send payment confirmation email:', emailError);
      }
    }
    
    // Return success response
    res.status(200).json({
      success: true,
      message: 'Payment verified successfully',
      data: {
        amount: paidAmount,
        totalPaid: installment.amountPaid,
        remainingAmount: installment.remainingAmount,
        percentagePaid: installment.percentagePaid,
        nextPaymentDue: installment.nextPaymentDue,
        status: installment.installmentStatus
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
 * @desc    Verify web3 installment payment
 * @route   POST /api/shares/installment/web3/verify
 * @access  Private (User)
 */
exports.verifyWeb3InstallmentPayment = async (req, res) => {
  try {
    const { installmentId, transactionHash, amount } = req.body;
    const userId = req.user.id;
    
    // Validate request
    if (!installmentId || !transactionHash || !amount) {
      return res.status(400).json({
        success: false,
        message: 'Please provide installmentId, transactionHash, and amount'
      });
    }
    
    // Find installment
    const installment = await ShareInstallment.findById(installmentId);
    
    if (!installment) {
      return res.status(404).json({
        success: false,
        message: 'Installment plan not found'
      });
    }
    
    // Verify user owns this installment
    if (installment.user.toString() !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized: You do not own this installment plan'
      });
    }
    
    // Generate transaction ID
    const transactionId = generateTransactionId();
    
    // Add pending payment to installment
    installment.payments.push({
      amount: parseFloat(amount),
      paymentDate: new Date(),
      transactionId,
      paymentMethod: 'crypto',
      status: 'pending',
      txHash: transactionHash
    });
    
    await installment.save();
    
    // Notify admin
    const admins = await User.find({ isAdmin: true });
    
    if (admins.length > 0) {
      try {
        for (const admin of admins) {
          if (admin.email) {
            await sendEmail({
              email: admin.email,
              subject: 'New Installment Payment Verification',
              html: `
                <h2>New Installment Payment Requires Verification</h2>
                <p>A new web3 transaction for an installment payment requires verification:</p>
                <p>User ID: ${userId}</p>
                <p>Installment ID: ${installmentId}</p>
                <p>Amount: ${installment.currency === 'naira' ? '₦' : '$'}${amount}</p>
                <p>Transaction Hash: ${transactionHash}</p>
                <p>Please verify this transaction in the admin dashboard.</p>
              `
            });
          }
        }
      } catch (emailError) {
        console.error('Failed to send admin notification:', emailError);
      }
    }
    
    // Return success response
    res.status(200).json({
      success: true,
      message: 'Transaction submitted for verification',
      data: {
        installmentId,
        transactionId,
        amount,
        status: 'pending'
      }
    });
  } catch (error) {
    console.error('Error submitting web3 installment payment:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to submit payment',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Admin verify web3 installment payment
 * @route   POST /api/shares/admin/installment/web3/verify
 * @access  Private (Admin)
 */
exports.adminVerifyWeb3InstallmentPayment = async (req, res) => {
  try {
    const { installmentId, transactionId, approved, adminNote } = req.body;
    const adminId = req.user.id;
    
    // Verify admin
    const admin = await User.findById(adminId);
    if (!admin || !admin.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized: Admin access required'
      });
    }
    
    // Find installment
    const installment = await ShareInstallment.findById(installmentId);
    
    if (!installment) {
      return res.status(404).json({
        success: false,
        message: 'Installment plan not found'
      });
    }
    
    // Find the payment
    const paymentIndex = installment.payments.findIndex(p => p.transactionId === transactionId);
    
    if (paymentIndex === -1) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found in this installment plan'
      });
    }
    
    const payment = installment.payments[paymentIndex];
    
    // If payment already processed
    if (payment.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: `Payment already ${payment.status}`
      });
    }
    
    // Update payment status
    installment.payments[paymentIndex].status = approved ? 'completed' : 'failed';
    installment.payments[paymentIndex].adminNote = adminNote;
    
    if (approved) {
      // Update installment with the paid amount
      const paidAmount = payment.amount;
      installment.amountPaid += paidAmount;
      installment.remainingAmount -= paidAmount;
      
      // Calculate percentage paid
      installment.percentagePaid = (installment.amountPaid / installment.totalAmount) * 100;
      
      // Calculate shares paid
      installment.sharesPaid = (installment.percentagePaid / 100) * installment.totalShares;
      
      // Set next payment due date
      installment.lastPaymentDate = new Date();
      installment.nextPaymentDue = new Date();
      installment.nextPaymentDue.setDate(installment.nextPaymentDue.getDate() + 30);
      
     // Continuing from the previous file
      
      // Check if fully paid
      if (installment.remainingAmount <= 0) {
        installment.installmentStatus = 'completed';
        installment.completedAt = new Date();
        
        // Process completion logic based on share type
        if (installment.shareType === 'regular') {
          await handleRegularShareCompletion(installment);
        } else if (installment.shareType === 'co-founder') {
          await handleCoFounderShareCompletion(installment);
        }
      }
    }
    
    await installment.save();
    
    // Get user details for notification
    const user = await User.findById(installment.user);
    
    // Send notification email
    if (user && user.email) {
      try {
        await sendEmail({
          email: user.email,
          subject: `AfriMobile - Share Installment Payment ${approved ? 'Approved' : 'Declined'}`,
          html: `
            <h2>Installment Payment ${approved ? 'Approved' : 'Declined'}</h2>
            <p>Dear ${user.name},</p>
            <p>Your installment payment of ${installment.currency === 'naira' ? '₦' : '$'}${payment.amount} has been ${approved ? 'approved' : 'declined'}.</p>
            <p>Transaction ID: ${transactionId}</p>
            ${approved ? `
              <p>Current Progress: ${installment.percentagePaid.toFixed(2)}% paid</p>
              <p>Remaining Amount: ${installment.currency === 'naira' ? '₦' : '$'}${installment.remainingAmount.toFixed(2)}</p>
              <p>Next Payment Due: ${installment.nextPaymentDue.toLocaleDateString()}</p>
              ${installment.installmentStatus === 'completed' ? 
                `<p>Congratulations! You have completed all payments for this share purchase.</p>` : 
                `<p>Thank you for your continued investment in AfriMobile!</p>`
              }
            ` : `
              <p>Reason: ${adminNote || 'Payment verification failed'}</p>
              <p>Please contact our support team if you have any questions.</p>
            `}
          `
        });
      } catch (emailError) {
        console.error('Failed to send payment notification email:', emailError);
      }
    }
    
    // Return success response
    res.status(200).json({
      success: true,
      message: `Payment ${approved ? 'approved' : 'declined'} successfully`,
      data: {
        amount: payment.amount,
        totalPaid: installment.amountPaid,
        remainingAmount: installment.remainingAmount,
        percentagePaid: installment.percentagePaid,
        nextPaymentDue: installment.nextPaymentDue,
        status: installment.installmentStatus
      }
    });
  } catch (error) {
    console.error('Error verifying web3 installment payment:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to verify payment',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Get user's installment plans
 * @route   GET /api/shares/installment/user
 * @access  Private (User)
 */
exports.getUserInstallments = async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Find user's installment plans
    const installments = await ShareInstallment.find({ user: userId });
    
    // Format response
    const formattedInstallments = installments.map(installment => ({
      id: installment._id,
      shareType: installment.shareType,
      totalShares: installment.totalShares,
      sharesPaid: installment.sharesPaid,
      percentagePaid: installment.percentagePaid,
      totalAmount: installment.totalAmount,
      amountPaid: installment.amountPaid,
      remainingAmount: installment.remainingAmount,
      currency: installment.currency,
      status: installment.installmentStatus,
      nextPaymentDue: installment.nextPaymentDue,
      lastPaymentDate: installment.lastPaymentDate,
      missedPayments: installment.missedPayments,
      totalPenalty: installment.totalPenalty,
      createdAt: installment.createdAt,
      completedAt: installment.completedAt,
      payments: installment.payments.map(payment => ({
        amount: payment.amount,
        date: payment.paymentDate,
        status: payment.status,
        paymentMethod: payment.paymentMethod,
        transactionId: payment.transactionId,
        penalty: payment.penalty
      }))
    }));
    
    res.status(200).json({
      success: true,
      installments: formattedInstallments
    });
  } catch (error) {
    console.error('Error fetching user installments:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch installment plans',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Admin get all installment plans
 * @route   GET /api/shares/admin/installment
 * @access  Private (Admin)
 */
exports.adminGetAllInstallments = async (req, res) => {
  try {
    const { status, shareType, page = 1, limit = 20 } = req.query;
    const adminId = req.user.id;
    
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
      query.installmentStatus = status;
    }
    
    if (shareType) {
      query.shareType = shareType;
    }
    
    // Paginate results
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    // Get installments with user details
    const installments = await ShareInstallment.find(query)
      .skip(skip)
      .limit(parseInt(limit))
      .populate('user', 'name email');
    
    // Format response
    const formattedInstallments = installments.map(installment => ({
      id: installment._id,
      user: {
        id: installment.user._id,
        name: installment.user.name,
        email: installment.user.email
      },
      shareType: installment.shareType,
      totalShares: installment.totalShares,
      sharesPaid: installment.sharesPaid,
      percentagePaid: installment.percentagePaid,
      totalAmount: installment.totalAmount,
      amountPaid: installment.amountPaid,
      remainingAmount: installment.remainingAmount,
      currency: installment.currency,
      status: installment.installmentStatus,
      nextPaymentDue: installment.nextPaymentDue,
      lastPaymentDate: installment.lastPaymentDate,
      missedPayments: installment.missedPayments,
      totalPenalty: installment.totalPenalty,
      createdAt: installment.createdAt,
      completedAt: installment.completedAt,
      payments: installment.payments.map(payment => ({
        amount: payment.amount,
        date: payment.paymentDate,
        status: payment.status,
        paymentMethod: payment.paymentMethod,
        transactionId: payment.transactionId,
        penalty: payment.penalty
      }))
    }));
    
    // Count total
    const totalCount = await ShareInstallment.countDocuments(query);
    
    res.status(200).json({
      success: true,
      installments: formattedInstallments,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalCount / parseInt(limit)),
        totalCount
      }
    });
  } catch (error) {
    console.error('Error fetching all installments:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch installment plans',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Apply penalties to overdue installments (scheduled job)
 * @route   POST /api/shares/admin/installment/apply-penalties
 * @access  Private (Admin)
 */
exports.applyPenalties = async (req, res) => {
  try {
    const adminId = req.user.id;
    
    // Verify admin
    const admin = await User.findById(adminId);
    if (!admin || !admin.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized: Admin access required'
      });
    }
    
    // Get all active installments with overdue payments
    const overdueInstallments = await ShareInstallment.getPendingPenaltyInstallments();
    
    const results = {
      processed: 0,
      penaltiesApplied: 0,
      totalPenaltyAmount: 0,
      defaulted: 0,
      errors: []
    };
    
    // Process each installment
    for (const installment of overdueInstallments) {
      try {
        results.processed++;
        
        // Calculate and apply penalty
        const penaltyResult = installment.calculatePenalty();
        
        if (penaltyResult.penaltyApplied) {
          results.penaltiesApplied++;
          results.totalPenaltyAmount += penaltyResult.penaltyAmount;
          
          // Check if defaulted
          if (installment.installmentStatus === 'defaulted') {
            results.defaulted++;
          }
          
          await installment.save();
          
          // Notify user about penalty
          const user = await User.findById(installment.user);
          if (user && user.email) {
            try {
              await sendEmail({
                email: user.email,
                subject: 'AfriMobile - Share Installment Penalty Applied',
                html: `
                  <h2>Installment Payment Overdue</h2>
                  <p>Dear ${user.name},</p>
                  <p>We notice that your installment payment is overdue. A penalty of ${installment.currency === 'naira' ? '₦' : '$'}${penaltyResult.penaltyAmount.toFixed(2)} (0.3%) has been applied to your remaining balance.</p>
                  <p>New Remaining Amount: ${installment.currency === 'naira' ? '₦' : '$'}${installment.remainingAmount.toFixed(2)}</p>
                  <p>Next Payment Due: ${installment.nextPaymentDue.toLocaleDateString()}</p>
                  <p>Please make your payment as soon as possible to avoid additional penalties.</p>
                  ${installment.installmentStatus === 'defaulted' ? 
                    `<p>Warning: Your installment plan has been marked as defaulted due to multiple missed payments. Please contact our support team immediately.</p>` : 
                    ``
                  }
                `
              });
            } catch (emailError) {
              console.error('Failed to send penalty notification email:', emailError);
            }
          }
        }
      } catch (error) {
        console.error(`Error processing installment ${installment._id}:`, error);
        results.errors.push({
          installmentId: installment._id,
          error: error.message
        });
      }
    }
    
    res.status(200).json({
      success: true,
      message: 'Penalties applied successfully',
      results
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
 * @desc    Admin handle defaulted installment
 * @route   POST /api/shares/admin/installment/handle-default
 * @access  Private (Admin)
 */
exports.adminHandleDefaultedInstallment = async (req, res) => {
  try {
    const { installmentId, action, adminNote } = req.body;
    const adminId = req.user.id;
    
    // Verify admin
    const admin = await User.findById(adminId);
    if (!admin || !admin.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized: Admin access required'
      });
    }
    
    // Find installment
    const installment = await ShareInstallment.findById(installmentId);
    
    if (!installment) {
      return res.status(404).json({
        success: false,
        message: 'Installment plan not found'
      });
    }
    
    // Verify installment is defaulted
    if (installment.installmentStatus !== 'defaulted') {
      return res.status(400).json({
        success: false,
        message: `Installment is not defaulted, current status: ${installment.installmentStatus}`
      });
    }
    
    // Handle based on action
    if (action === 'reinstate') {
      // Reinstate the installment plan
      installment.installmentStatus = 'active';
      installment.missedPayments = 0;
      installment.nextPaymentDue = new Date();
      installment.nextPaymentDue.setDate(installment.nextPaymentDue.getDate() + 30);
      
      await installment.save();
      
      // Notify user
      const user = await User.findById(installment.user);
      if (user && user.email) {
        try {
          await sendEmail({
            email: user.email,
            subject: 'AfriMobile - Installment Plan Reinstated',
            html: `
              <h2>Installment Plan Reinstated</h2>
              <p>Dear ${user.name},</p>
              <p>Good news! Your installment plan has been reinstated.</p>
              <p>Current Balance: ${installment.currency === 'naira' ? '₦' : '$'}${installment.remainingAmount.toFixed(2)}</p>
              <p>Next Payment Due: ${installment.nextPaymentDue.toLocaleDateString()}</p>
              <p>Please ensure you make your payments on time to avoid future penalties.</p>
              ${adminNote ? `<p>Note: ${adminNote}</p>` : ''}
            `
          });
        } catch (emailError) {
          console.error('Failed to send reinstatement email:', emailError);
        }
      }
      
      res.status(200).json({
        success: true,
        message: 'Installment plan reinstated successfully',
        installment: {
          id: installment._id,
          status: installment.installmentStatus,
          nextPaymentDue: installment.nextPaymentDue
        }
      });
    } else if (action === 'cancel') {
      // Cancel the installment and process partial shares
      await processCancelledInstallment(installment, adminNote);
      
      res.status(200).json({
        success: true,
        message: 'Installment plan cancelled and partial shares processed',
        installment: {
          id: installment._id,
          status: 'cancelled',
          sharesPaid: installment.sharesPaid
        }
      });
    } else {
      return res.status(400).json({
        success: false,
        message: 'Invalid action, must be either "reinstate" or "cancel"'
      });
    }
  } catch (error) {
    console.error('Error handling defaulted installment:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to handle defaulted installment',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Helper function to process a completed regular share installment
 */
async function handleRegularShareCompletion(installment) {
  try {
    // Find share configuration
    const shareConfig = await Share.getCurrentConfig();
    
    // Calculate tier distribution (simplified example)
    const tierBreakdown = {
      tier1: Math.ceil(installment.totalShares * 0.7), // 70% tier1
      tier2: Math.ceil(installment.totalShares * 0.2), // 20% tier2
      tier3: Math.ceil(installment.totalShares * 0.1)  // 10% tier3
    };
    
    // Ensure total adds up correctly
    const totalTiers = tierBreakdown.tier1 + tierBreakdown.tier2 + tierBreakdown.tier3;
    if (totalTiers !== installment.totalShares) {
      const difference = installment.totalShares - totalTiers;
      tierBreakdown.tier1 += difference; // Adjust tier1 for any rounding differences
    }
    
    // Record transaction
    await UserShare.addShares(installment.user, installment.totalShares, {
      transactionId: installment._id.toString(),
      shares: installment.totalShares,
      pricePerShare: installment.pricePerShare,
      currency: installment.currency,
      totalAmount: installment.totalAmount,
      paymentMethod: 'installment',
      status: 'completed',
      tierBreakdown,
      instalmentPlan: true
    });
    
    // Update global share counts
    shareConfig.sharesSold += installment.totalShares;
    shareConfig.tierSales.tier1Sold += tierBreakdown.tier1;
    shareConfig.tierSales.tier2Sold += tierBreakdown.tier2;
    shareConfig.tierSales.tier3Sold += tierBreakdown.tier3;
    
    await shareConfig.save();
    
    // Process referral commission
    try {
      await processReferralCommission(
        installment.user,
        installment._id.toString(),
        installment.totalAmount,
        installment.currency,
        'share',
        'ShareInstallment'
      );
    } catch (error) {
      console.error('Error processing referral commission:', error);
    }
    
    return true;
  } catch (error) {
    console.error('Error handling regular share completion:', error);
    throw error;
  }
}

/**
 * Helper function to process a completed co-founder share installment
 */
async function handleCoFounderShareCompletion(installment) {
  try {
    // Find co-founder share configuration
    const coFounderShare = await CoFounderShare.findOne();
    
    // Update co-founder shares sold
    coFounderShare.sharesSold += installment.totalShares;
    await coFounderShare.save();
    
    // Record the transaction
    const transaction = await PaymentTransaction.create({
      userId: installment.user,
      type: 'co-founder',
      shares: installment.totalShares,
      amount: installment.totalAmount,
      currency: installment.currency,
      status: 'completed',
      paymentMethod: 'installment',
      installmentId: installment._id
    });
    
    // Add shares to user
    await UserShare.addShares(installment.user, installment.totalShares, {
      transactionId: transaction._id,
      shares: installment.totalShares,
      pricePerShare: installment.pricePerShare,
      currency: installment.currency,
      totalAmount: installment.totalAmount,
      paymentMethod: 'co-founder',
      status: 'completed',
      tierBreakdown: {
        tier1: 0,
        tier2: 0,
        tier3: 0
      },
      instalmentPlan: true
    });
    
    // Process referral commission
    try {
      await processReferralCommission(
        installment.user,
        transaction._id,
        installment.totalAmount,
        installment.currency,
        'cofounder',
        'PaymentTransaction'
      );
    } catch (error) {
      console.error('Error processing referral commission:', error);
    }
    
    return true;
  } catch (error) {
    console.error('Error handling co-founder share completion:', error);
    throw error;
  }
}

/**
 * Helper function to process a cancelled installment (convert paid portion to shares)
 */
async function processCancelledInstallment(installment, adminNote) {
  try {
    // Only process if some amount has been paid
    if (installment.amountPaid <= 0 || installment.percentagePaid <= 0) {
      installment.installmentStatus = 'cancelled';
      await installment.save();
      return false;
    }
    
    // Calculate partial shares (proportional to amount paid)
    const partialShares = Math.floor(installment.sharesPaid);
    
    if (partialShares <= 0) {
      installment.installmentStatus = 'cancelled';
      await installment.save();
      return false;
    }
    
    // Process based on share type
    if (installment.shareType === 'regular') {
      // Find share configuration
      const shareConfig = await Share.getCurrentConfig();
      
      // Calculate tier distribution (simplified example)
      const tierBreakdown = {
        tier1: Math.ceil(partialShares * 0.7), // 70% tier1
        tier2: Math.ceil(partialShares * 0.2), // 20% tier2
        tier3: Math.ceil(partialShares * 0.1)  // 10% tier3
      };
      
      // Ensure total adds up correctly
      const totalTiers = tierBreakdown.tier1 + tierBreakdown.tier2 + tierBreakdown.tier3;
      if (totalTiers !== partialShares) {
        const difference = partialShares - totalTiers;
        tierBreakdown.tier1 += difference; // Adjust tier1 for any rounding differences
      }
      
      // Record transaction
      await UserShare.addShares(installment.user, partialShares, {
        transactionId: `PARTIAL-${installment._id.toString()}`,
        shares: partialShares,
        pricePerShare: installment.pricePerShare,
        currency: installment.currency,
        totalAmount: installment.amountPaid,
        paymentMethod: 'installment-partial',
        status: 'completed',
        tierBreakdown,
        adminAction: true,
        adminNote: adminNote || 'Partial shares from cancelled installment plan'
      });
      
      // Update global share counts
      shareConfig.sharesSold += partialShares;
      shareConfig.tierSales.tier1Sold += tierBreakdown.tier1;
      shareConfig.tierSales.tier2Sold += tierBreakdown.tier2;
      shareConfig.tierSales.tier3Sold += tierBreakdown.tier3;
      
      await shareConfig.save();
    } else if (installment.shareType === 'co-founder') {
      // Find co-founder share configuration
      const coFounderShare = await CoFounderShare.findOne();
      
      // Update co-founder shares sold
      coFounderShare.sharesSold += partialShares;
      await coFounderShare.save();
      
      // Record the transaction
      const transaction = await PaymentTransaction.create({
        userId: installment.user,
        type: 'co-founder',
        shares: partialShares,
        amount: installment.amountPaid,
        currency: installment.currency,
        status: 'completed',
        paymentMethod: 'installment-partial',
        adminNotes: adminNote || 'Partial shares from cancelled installment plan'
      });
      
      // Add shares to user
      await UserShare.addShares(installment.user, partialShares, {
        transactionId: transaction._id,
        shares: partialShares,
        pricePerShare: installment.pricePerShare,
        currency: installment.currency,
        totalAmount: installment.amountPaid,
        paymentMethod: 'co-founder',
        status: 'completed',
        tierBreakdown: {
          tier1: 0,
          tier2: 0,
          tier3: 0
        },
        adminAction: true,
        adminNote: adminNote || 'Partial shares from cancelled installment plan'
      });
    }
    
    // Update installment status
    installment.installmentStatus = 'cancelled';
    await installment.save();
    
    // Notify user
    const user = await User.findById(installment.user);
    if (user && user.email) {
      try {
        await sendEmail({
          email: user.email,
          subject: 'AfriMobile - Installment Plan Cancelled with Partial Shares',
          html: `
            <h2>Installment Plan Cancelled</h2>
            <p>Dear ${user.name},</p>
            <p>Your installment plan has been cancelled due to missed payments.</p>
            <p>Good news! We have converted your paid amount (${installment.currency === 'naira' ? '₦' : '$'}${installment.amountPaid.toFixed(2)}) to ${partialShares} share(s).</p>
            <p>These shares have been added to your account.</p>
            ${adminNote ? `<p>Note: ${adminNote}</p>` : ''}
            <p>If you have any questions, please contact our support team.</p>
          `
        });
      } catch (emailError) {
        console.error('Failed to send cancellation email:', emailError);
      }
    }
    
    return true;
  } catch (error) {
    console.error('Error processing cancelled installment:', error);
    throw error;
  }
}

module.exports = exports;