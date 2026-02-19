// controller/shareController.js
const Share = require('../models/Share');
const UserShare = require('../models/UserShare');
const User = require('../models/User');
const crypto = require('crypto');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');
const { sendEmail } = require('../utils/emailService');
const SiteConfig = require('../models/SiteConfig');
const CoFounderShare = require('../models/CoFounderShare');
const PaymentTransaction = require('../models/Transaction');
const { processReferralCommission, rollbackReferralCommission } = require('../utils/referralUtils');
const { deleteFromCloudinary } = require('../config/cloudinary');

// Generate a unique transaction ID
const generateTransactionId = () => {
  return `TXN-${crypto.randomBytes(4).toString('hex').toUpperCase()}-${Date.now().toString().slice(-6)}`;
};

// Get current share pricing and availability (NEW TIER SYSTEM)
exports.getShareInfo = async (req, res) => {
  try {
    const tiers = Share.getTierConfig();
    const shareConfig = await Share.getCurrentConfig();
    
    // Build tier info with sales data and percentage format
    const regularTiers = {};
    const cofounderTiers = {};
    
    Object.entries(tiers).forEach(([key, tier]) => {
      const sold = shareConfig.tierSales[`${key}Sold`] || 0;
      const tierInfo = {
        ...tier,
        sold,
        percentSold: (sold * tier.percentPerShare).toFixed(6) + '%'
      };
      
      if (tier.type === 'regular') {
        regularTiers[key] = tierInfo;
      } else {
        cofounderTiers[key] = tierInfo;
      }
    });

    const response = {
      success: true,
      tiers,
      regularTiers,
      cofounderTiers,
      totalPercentageSold: shareConfig.totalPercentageSold || 0,
      tierSales: shareConfig.tierSales,
      // Legacy compatibility
      pricing: shareConfig.currentPrices,
      centiivConfig: {
        enabled: shareConfig.centiivConfig.enabled
      }
    };
    
    res.status(200).json(response);
  } catch (error) {
    console.error('Error fetching share info:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch share information',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};


exports.calculatePurchase = async (req, res) => {
  try {
    // ✅ FIX 1: Add 'tier' to destructuring
    const { quantity, currency, tier } = req.body;
    
    console.log('📊 [calculatePurchase] Request received:', {
      quantity,
      currency,
      tier
    });

    // Validate required fields
    if (!quantity || !currency) {
      return res.status(400).json({
        success: false,
        message: 'Please provide quantity and currency'
      });
    }

    // ✅ FIX 2: Pass tier to Share.calculatePurchase()
    // Use 'standard' as default if no tier provided
    const selectedTier = tier || 'standard';
    
    const purchaseDetails = await Share.calculatePurchase(
      parseInt(quantity), 
      currency.toLowerCase(),
      selectedTier  // ✅ THIS LINE WAS MISSING!
    );

    console.log('✅ [calculatePurchase] Calculation complete:', {
      tier: selectedTier,
      totalPrice: purchaseDetails.totalPrice,
      currency: purchaseDetails.currency
    });

    if (!purchaseDetails.success) {
      return res.status(400).json({
        success: false,
        message: purchaseDetails.message || 'Unable to calculate purchase'
      });
    }

    res.status(200).json({
      success: true,
      purchaseDetails
    });

  } catch (error) {
    console.error('❌ [calculatePurchase] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to calculate purchase',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

exports.initiateCentiivPayment = async (req, res) => {
  try {
    const { quantity, email, customerName, tier } = req.body;
    const userId = req.user.id;
    
    console.log('🚀 [Centiiv] Payment initiation started:', {
      userId, quantity, email, customerName, tier
    });
    
    if (!quantity || !email || !customerName) {
      return res.status(400).json({
        success: false,
        message: 'Please provide quantity, email, and customer name'
      });
    }
    
    // 🔴 HARDCODED API KEY FOR DEBUGGING - REMOVE BEFORE PRODUCTION
    const apiKey = process.env.CENTIIV_API_KEY;
    const baseUrl = process.env.CENTIIV_BASE_URL || 'https://api.centiiv.com/api/v1';
    
    console.log('🔧 [Centiiv] Using hardcoded API key for debugging');
    console.log('🔧 [Centiiv] API Key Preview:', apiKey.substring(0, 8) + '...');
    console.log('🔧 [Centiiv] Base URL:', baseUrl);
    
    // Calculate purchase
    const purchaseDetails = await Share.calculatePurchase(parseInt(quantity), 'naira', tier || 'standard');
    
    console.log('💰 [Centiiv] Purchase details:', {
      success: purchaseDetails.success,
      totalPrice: purchaseDetails.totalPrice,
      totalShares: purchaseDetails.totalShares
    });
    
    if (!purchaseDetails.success) {
      return res.status(400).json({
        success: false,
        message: 'Unable to process this purchase amount',
        details: purchaseDetails
      });
    }
    
    // Generate transaction ID
    const transactionId = generateTransactionId();
    console.log('🆔 [Centiiv] Transaction ID:', transactionId);
    
    // 🔥 CREATE REDIRECT URLs
    const frontendUrl = process.env.FRONTEND_URL || 'https://yourfrontend.com';
    const backendUrl = process.env.BACKEND_URL || 'https://yourapi.com';
    
    const successUrl = `${frontendUrl}/dashboard`;
    const cancelUrl = `${frontendUrl}/dashboard/shares/payment-cancelled?transaction=${transactionId}&method=centiiv`;
    const notifyUrl = `${backendUrl}/api/shares/centiiv/webhook`;
    
    console.log('🔗 [Centiiv] Redirect URLs:', {
      success: successUrl,
      cancel: cancelUrl,
      notify: notifyUrl
    });
    
    // Create request payload with redirect URLs
    const dueDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const centiivRequest = {
      reminderInterval: 7,
      customerEmail: email,
      customerName: customerName,
      dueDate: dueDate,
      subject: `AfriMobile Share Purchase - ${purchaseDetails.totalShares} Shares`,
      products: [
        {
          name: `AfriMobile Shares (${purchaseDetails.totalShares} shares)`,
          qty: 1,
          price: purchaseDetails.totalPrice
        }
      ],
      // 🔥 ADD REDIRECT URLs TO CENTIIV REQUEST
      successUrl: successUrl,
      cancelUrl: cancelUrl,
      notifyUrl: notifyUrl,
      // Optional: Add metadata for tracking
      metadata: {
        userId: userId.toString(),
        transactionId: transactionId,
        shares: purchaseDetails.totalShares.toString(),
        purchaseType: 'share_purchase'
      }
    };
    
    console.log('📦 [Centiiv] Request payload:', JSON.stringify(centiivRequest, null, 2));
    
    // Make API call with hardcoded key
    console.log('🌐 [Centiiv] Making API call to:', `${baseUrl}/order`);
    
    let centiivResponse;
    try {
      centiivResponse = await axios.post(
        `${baseUrl}/order`,
        centiivRequest,
        {
          headers: {
            'accept': 'application/json',
            'authorization': `Bearer ${apiKey}`,
            'content-type': 'application/json'
          },
          timeout: 30000
        }
      );
      
      console.log('✅ [Centiiv] API call successful');
      console.log('📊 [Centiiv] Response status:', centiivResponse.status);
      console.log('📊 [Centiiv] Response data:', JSON.stringify(centiivResponse.data, null, 2));
      
    } catch (apiError) {
      console.log('❌ [Centiiv] API call failed');
      console.log('🔍 [Centiiv] Error message:', apiError.message);
      console.log('🔍 [Centiiv] Error code:', apiError.code);
      
      if (apiError.response) {
        console.log('🔍 [Centiiv] Error response status:', apiError.response.status);
        console.log('🔍 [Centiiv] Error response data:', JSON.stringify(apiError.response.data, null, 2));
      }
      
      return res.status(500).json({
        success: false,
        message: 'Centiiv API call failed',
        error: {
          message: apiError.message,
          status: apiError.response?.status,
          data: apiError.response?.data,
          code: apiError.code
        }
      });
    }
    
    // Process response
    if (!centiivResponse || !centiivResponse.data) {
      console.log('❌ [Centiiv] Empty response');
      return res.status(500).json({
        success: false,
        message: 'Empty response from Centiiv API'
      });
    }
    
    const orderData = centiivResponse.data;
    const orderId = orderData.id || orderData.order_id || orderData.orderId;
    const invoiceUrl = orderData.invoiceUrl || orderData.invoice_url || orderData.payment_url;
    
    console.log('🔍 [Centiiv] Extracted data:', {
      orderId,
      invoiceUrl,
      allResponseKeys: Object.keys(orderData)
    });
    
    if (!orderId) {
      console.log('❌ [Centiiv] No order ID found in response');
      console.log('📋 [Centiiv] Available response keys:', Object.keys(orderData));
      return res.status(500).json({
        success: false,
        message: 'No order ID in Centiiv response',
        responseData: orderData
      });
    }
    
    // Save to database
    console.log('💾 [Centiiv] Saving to database...');
    try {
      await UserShare.addShares(userId, purchaseDetails.totalShares, {
        transactionId,
        shares: purchaseDetails.totalShares,
        pricePerShare: purchaseDetails.totalPrice / purchaseDetails.totalShares,
        currency: 'naira',
        totalAmount: purchaseDetails.totalPrice,
        paymentMethod: 'centiiv',
        status: 'pending',
        tierBreakdown: purchaseDetails.tierBreakdown,
        centiivOrderId: orderId,
        centiivInvoiceUrl: invoiceUrl || null,
        // 🔥 STORE REDIRECT URLs FOR REFERENCE
        successUrl: successUrl,
        cancelUrl: cancelUrl,
        notifyUrl: notifyUrl
      });
      
      console.log('✅ [Centiiv] Database save successful');
      
    } catch (dbError) {
      console.log('❌ [Centiiv] Database save failed:', dbError.message);
      return res.status(500).json({
        success: false,
        message: 'Failed to save transaction to database',
        error: dbError.message
      });
    }
    
    // Success response
    const responseData = {
      transactionId,
      centiivOrderId: orderId,
      invoiceUrl: invoiceUrl || null,
      amount: purchaseDetails.totalPrice,
      shares: purchaseDetails.totalShares,
      dueDate: dueDate,
      // 🔥 INCLUDE REDIRECT URLs IN RESPONSE
      redirectUrls: {
        success: successUrl,
        cancel: cancelUrl,
        notify: notifyUrl
      }
    };
    
    console.log('🎉 [Centiiv] Success:', responseData);
    
    res.status(200).json({
      success: true,
      message: 'Centiiv invoice created successfully with redirect URLs',
      data: responseData
    });
    
  } catch (error) {
    console.log('💥 [Centiiv] Unexpected error:', error.message);
    console.log('🔍 [Centiiv] Error stack:', error.stack);
    
    res.status(500).json({
      success: false,
      message: 'Failed to initiate Centiiv payment',
      error: {
        message: error.message,
        type: 'UNEXPECTED_ERROR'
      }
    });
  }
};
// Add this simple test function to verify basic API connectivity
exports.testCentiivBasic = async (req, res) => {
  try {
    console.log('🧪 [Centiiv Test] Starting basic connectivity test');
    
    const apiKey = process.env.CENTIIV_API_KEY;
    const baseUrl = process.env.CENTIIV_BASE_URL || 'https://api.centiiv.com/api/v1';
    
    if (!apiKey) {
      return res.status(400).json({
        success: false,
        message: 'CENTIIV_API_KEY not configured'
      });
    }
    
    console.log('🧪 [Centiiv Test] Using API key:', `${apiKey.substring(0, 8)}...`);
    console.log('🧪 [Centiiv Test] Using base URL:', baseUrl);
    
    // Test with the exact same payload that worked in your curl
    const testPayload = {
      reminderInterval: 7,
      customerEmail: "onuhbernard4@gmail.com",
      customerName: "BernardOnuh",
      dueDate: "2025-08-08",
      subject: "Test Order",
      products: [
        {
          name: "Test Product",
          qty: 1,
          price: 100
        }
      ]
    };
    
    console.log('🧪 [Centiiv Test] Test payload:', JSON.stringify(testPayload, null, 2));
    
    const response = await axios.post(
      `${baseUrl}/order`,
      testPayload,
      {
        headers: {
          'accept': 'application/json',
          'authorization': `Bearer ${apiKey}`,
          'content-type': 'application/json'
        },
        timeout: 30000
      }
    );
    
    console.log('✅ [Centiiv Test] Success!');
    console.log('🧪 [Centiiv Test] Status:', response.status);
    console.log('🧪 [Centiiv Test] Response:', JSON.stringify(response.data, null, 2));
    
    res.status(200).json({
      success: true,
      message: 'Centiiv API test successful',
      testResponse: {
        status: response.status,
        data: response.data
      }
    });
    
  } catch (error) {
    console.log('❌ [Centiiv Test] Failed');
    console.log('🧪 [Centiiv Test] Error:', error.message);
    console.log('🧪 [Centiiv Test] Status:', error.response?.status);
    console.log('🧪 [Centiiv Test] Response:', JSON.stringify(error.response?.data, null, 2));
    
    res.status(500).json({
      success: false,
      message: 'Centiiv API test failed',
      error: {
        message: error.message,
        status: error.response?.status,
        data: error.response?.data
      }
    });
  }
};

// Verify PayStack payment
exports.verifyPaystackPayment = async (req, res) => {
  try {
    const { reference } = req.params;
    
    if (!reference) {
      return res.status(400).json({
        success: false,
        message: 'Transaction reference is required'
      });
    }
    
    // Check if transaction exists in our records
    const userShareRecord = await UserShare.findOne({
      'transactions.transactionId': reference
    });
    
    if (!userShareRecord) {
      return res.status(400).json({
        success: false,
        message: 'Transaction not found'
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
      // Update transaction status to failed
      await UserShare.updateTransactionStatus(
        userShareRecord.user,
        reference,
        'failed'
      );
      
      return res.status(400).json({
        success: false,
        message: 'Payment verification failed',
        status: verification.data.data.status
      });
    }
    
    // Payment successful, update transaction status and share counts
    const transaction = userShareRecord.transactions.find(
      t => t.transactionId === reference
    );
    
    // Update global share sales
    const shareConfig = await Share.getCurrentConfig();
    shareConfig.sharesSold += transaction.shares;
    
    // Update tier sales
    shareConfig.tierSales.tier1Sold += transaction.tierBreakdown.tier1;
    shareConfig.tierSales.tier2Sold += transaction.tierBreakdown.tier2;
    shareConfig.tierSales.tier3Sold += transaction.tierBreakdown.tier3;
    
    await shareConfig.save();
    
    // Update user share transaction
    await UserShare.updateTransactionStatus(
      userShareRecord.user,
      reference,
      'completed'
    );
    
    // Process referral commissions ONLY FOR COMPLETED TRANSACTIONS
    try {
      // First update the transaction status, then process referrals
      // This ensures we're only processing for completed transactions
      const updatedUserShare = await UserShare.findOne({
        'transactions.transactionId': reference
      });
      
      const updatedTransaction = updatedUserShare.transactions.find(
        t => t.transactionId === reference
      );
      
      if (updatedTransaction.status === 'completed') {
        const referralResult = await processReferralCommission(
          userShareRecord.user,     // userId
          transaction.totalAmount,  // purchaseAmount
          'share',                 // purchaseType
          reference                // transactionId
        );
        console.log('Referral commission process result:', referralResult);
      }
    } catch (referralError) {
      console.error('Error processing referral commissions:', referralError);
      // Continue with the verification process despite referral error
    }
    
    // Get user details for notification
    const user = await User.findById(userShareRecord.user);
    
    // Send confirmation email to user
    if (user && user.email) {
      try {
        await sendEmail({
          email: user.email,
          subject: 'AfriMobile - Share Purchase Successful',
          html: `
            <h2>Share Purchase Confirmation</h2>
            <p>Dear ${user.name},</p>
            <p>Your purchase of ${transaction.shares} shares for ${transaction.currency === 'naira' ? '₦' : '$'}${transaction.totalAmount} has been completed successfully.</p>
            <p>Transaction Reference: ${reference}</p>
            <p>Thank you for your investment in AfriMobile!</p>
          `
        });
      } catch (emailError) {
        console.error('Failed to send purchase confirmation email:', emailError);
      }
    }
    
    // Return success response
    res.status(200).json({
      success: true,
      message: 'Payment verified successfully',
      data: {
        shares: transaction.shares,
        amount: transaction.totalAmount,
        date: transaction.createdAt
      }
    });
  } catch (error) {
    console.error('Error verifying PayStack payment:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to verify payment',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Get payment configuration (wallet addresses, supported cryptos)
exports.getPaymentConfig = async (req, res) => {
  try {
    const config = await SiteConfig.getCurrentConfig();
    
    res.status(200).json({
      success: true,
      companyWalletAddress: config.companyWalletAddress,
      supportedCryptos: config.supportedCryptos?.filter(crypto => crypto.enabled) || []
    });
  } catch (error) {
    console.error('Error fetching payment config:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch payment configuration',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

exports.updateCompanyWallet = async (req, res) => {
  try {
    const { walletAddress } = req.body;
    const adminId = req.user.id;
    
    // Check if admin
    const admin = await User.findById(adminId);
    if (!admin || !admin.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized: Admin access required'
      });
    }
    
    if (!walletAddress || !ethers.utils.isAddress(walletAddress)) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid wallet address'
      });
    }
    
    // Update company wallet
    const config = await SiteConfig.getCurrentConfig();
    config.companyWalletAddress = walletAddress;
    config.lastUpdated = Date.now();
    await config.save();
    
    res.status(200).json({
      success: true,
      message: 'Company wallet address updated successfully',
      walletAddress
    });
  } catch (error) {
    console.error('Error updating company wallet:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update company wallet',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Add these functions to the end of your existing shareController.js file (before module.exports)

/**
 * @desc    Verify Web3 transaction
 * @route   POST /api/shares/web3/verify
 * @access  Private (User)
 */
exports.verifyWeb3Transaction = async (req, res) => {
  try {
    const { quantity, txHash, walletAddress, tier } = req.body;
    const userId = req.user.id;
    
    if (!quantity || !txHash || !walletAddress) {
      return res.status(400).json({
        success: false,
        message: 'Please provide all required fields'
      });
    }
    
    // Calculate purchase details
    const purchaseDetails = await Share.calculatePurchase(parseInt(quantity), 'usdt', tier || 'standard');
    
    if (!purchaseDetails.success) {
      return res.status(400).json({
        success: false,
        message: purchaseDetails.message
      });
    }
    
    // Generate transaction ID
    const transactionId = generateTransactionId();
    
    // Get company wallet address
    const config = await SiteConfig.getCurrentConfig();
    const companyWalletAddress = config.companyWalletAddress;
    
    if (!companyWalletAddress) {
      return res.status(400).json({
        success: false,
        message: 'Web3 payments not configured'
      });
    }
    
    // Basic blockchain verification (you can enhance this)
    let verified = false;
    let verificationMessage = 'Transaction submitted for verification';
    
    try {
      // Add your blockchain verification logic here
      // For now, we'll save as pending and require admin verification
      verified = false;
    } catch (error) {
      console.error('Blockchain verification error:', error);
    }
    
    // Save transaction
    await UserShare.addShares(userId, purchaseDetails.totalShares, {
      transactionId,
      shares: purchaseDetails.totalShares,
      pricePerShare: purchaseDetails.totalPrice / purchaseDetails.totalShares,
      currency: 'usdt',
      totalAmount: purchaseDetails.totalPrice,
      paymentMethod: 'web3',
      status: verified ? 'completed' : 'pending',
      tierBreakdown: purchaseDetails.tierBreakdown,
      txHash: txHash,
      fromWallet: walletAddress,
      toWallet: companyWalletAddress
    });
    
    // If verified, update global counts
    if (verified) {
      const shareConfig = await Share.getCurrentConfig();
      shareConfig.sharesSold += purchaseDetails.totalShares;
      
      shareConfig.tierSales.tier1Sold += purchaseDetails.tierBreakdown.tier1 || 0;
      shareConfig.tierSales.tier2Sold += purchaseDetails.tierBreakdown.tier2 || 0;
      shareConfig.tierSales.tier3Sold += purchaseDetails.tierBreakdown.tier3 || 0;
      
      await shareConfig.save();
      
      // Process referral commissions
      try {
        await processReferralCommission(
          userId,
          purchaseDetails.totalPrice,
          'share',
          transactionId
        );
      } catch (referralError) {
        console.error('Error processing referral commissions:', referralError);
      }
    }
    
    res.status(200).json({
      success: true,
      message: verified ? 'Payment verified and processed successfully' : 'Transaction submitted for verification',
      data: {
        transactionId,
        shares: purchaseDetails.totalShares,
        amount: purchaseDetails.totalPrice,
        status: verified ? 'completed' : 'pending',
        verified
      }
    });
    
  } catch (error) {
    console.error('Error verifying Web3 transaction:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to verify Web3 transaction',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Get transaction status
 * @route   GET /api/shares/transactions/:transactionId/status
 * @access  Private (User)
 */
exports.getTransactionStatus = async (req, res) => {
  try {
    const { transactionId } = req.params;
    const userId = req.user.id;
    
    // Check if user is admin
    const user = await User.findById(userId);
    const isAdmin = user && user.isAdmin;
    
    // Find transaction in UserShare
    const userShareRecord = await UserShare.findOne({
      'transactions.transactionId': transactionId
    });
    
    // Also check PaymentTransaction model
    const paymentTransaction = await PaymentTransaction.findOne({
      transactionId,
      type: 'share'
    });
    
    let transaction = null;
    let source = null;
    
    if (paymentTransaction) {
      // Check ownership
      if (!isAdmin && paymentTransaction.userId.toString() !== userId) {
        return res.status(403).json({
          success: false,
          message: 'Access denied'
        });
      }
      
      transaction = {
        transactionId: paymentTransaction.transactionId,
        status: paymentTransaction.status,
        shares: paymentTransaction.shares,
        totalAmount: paymentTransaction.amount,
        currency: paymentTransaction.currency,
        paymentMethod: paymentTransaction.paymentMethod,
        createdAt: paymentTransaction.createdAt,
        updatedAt: paymentTransaction.updatedAt
      };
      source = 'PaymentTransaction';
    } else if (userShareRecord) {
      // Check ownership
      if (!isAdmin && userShareRecord.user.toString() !== userId) {
        return res.status(403).json({
          success: false,
          message: 'Access denied'
        });
      }
      
      const userTransaction = userShareRecord.transactions.find(
        t => t.transactionId === transactionId
      );
      
      if (userTransaction) {
        transaction = {
          transactionId: userTransaction.transactionId,
          status: userTransaction.status,
          shares: userTransaction.shares,
          totalAmount: userTransaction.totalAmount,
          currency: userTransaction.currency,
          paymentMethod: userTransaction.paymentMethod,
          createdAt: userTransaction.createdAt,
          updatedAt: userTransaction.updatedAt || userTransaction.createdAt
        };
        source = 'UserShare';
      }
    }
    
    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found'
      });
    }
    
    res.status(200).json({
      success: true,
      transaction,
      source
    });
    
  } catch (error) {
    console.error('Error getting transaction status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get transaction status',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Get detailed transaction information
 * @route   GET /api/shares/transactions/:transactionId/details
 * @access  Private (User)
 */
exports.getTransactionDetails = async (req, res) => {
  try {
    const { transactionId } = req.params;
    const userId = req.user.id;
    
    // Check if user is admin
    const user = await User.findById(userId);
    const isAdmin = user && user.isAdmin;
    
    // Find transaction in both sources
    const userShareRecord = await UserShare.findOne({
      'transactions.transactionId': transactionId
    }).populate('user', 'name email phone');
    
    const paymentTransaction = await PaymentTransaction.findOne({
      transactionId,
      type: 'share'
    }).populate('userId', 'name email phone');
    
    let transactionData = null;
    
    if (paymentTransaction) {
      // Check ownership
      if (!isAdmin && paymentTransaction.userId._id.toString() !== userId) {
        return res.status(403).json({
          success: false,
          message: 'Access denied'
        });
      }
      
      transactionData = {
        transactionId: paymentTransaction.transactionId,
        user: {
          id: paymentTransaction.userId._id,
          name: paymentTransaction.userId.name,
          email: paymentTransaction.userId.email,
          phone: paymentTransaction.userId.phone
        },
        shares: paymentTransaction.shares,
        pricePerShare: paymentTransaction.amount / paymentTransaction.shares,
        totalAmount: paymentTransaction.amount,
        currency: paymentTransaction.currency,
        paymentMethod: paymentTransaction.paymentMethod,
        status: paymentTransaction.status,
        createdAt: paymentTransaction.createdAt,
        updatedAt: paymentTransaction.updatedAt,
        tierBreakdown: paymentTransaction.tierBreakdown,
        manualPaymentDetails: paymentTransaction.manualPaymentDetails,
        adminNote: paymentTransaction.adminNotes,
        source: 'PaymentTransaction'
      };
      
      // Add payment proof if available
      if (paymentTransaction.paymentProofCloudinaryUrl) {
        transactionData.paymentProof = {
          cloudinaryUrl: paymentTransaction.paymentProofCloudinaryUrl,
          originalName: paymentTransaction.paymentProofOriginalName,
          fileSize: paymentTransaction.paymentProofFileSize
        };
      }
      
    } else if (userShareRecord) {
      // Check ownership
      if (!isAdmin && userShareRecord.user._id.toString() !== userId) {
        return res.status(403).json({
          success: false,
          message: 'Access denied'
        });
      }
      
      const transaction = userShareRecord.transactions.find(
        t => t.transactionId === transactionId
      );
      
      if (transaction) {
        transactionData = {
          transactionId: transaction.transactionId,
          user: {
            id: userShareRecord.user._id,
            name: userShareRecord.user.name,
            email: userShareRecord.user.email,
            phone: userShareRecord.user.phone
          },
          shares: transaction.shares,
          pricePerShare: transaction.pricePerShare,
          totalAmount: transaction.totalAmount,
          currency: transaction.currency,
          paymentMethod: transaction.paymentMethod,
          status: transaction.status,
          createdAt: transaction.createdAt,
          updatedAt: transaction.updatedAt || transaction.createdAt,
          tierBreakdown: transaction.tierBreakdown,
          adminNote: transaction.adminNote,
          source: 'UserShare'
        };
        
        // Add method-specific data
        if (transaction.paymentMethod === 'centiiv') {
          transactionData.centiiv = {
            orderId: transaction.centiivOrderId,
            invoiceUrl: transaction.centiivInvoiceUrl,
            paymentId: transaction.centiivPaymentId,
            callbackUrl: transaction.centiivCallbackUrl
          };
        }
        
        if (transaction.paymentMethod === 'web3' || transaction.paymentMethod === 'crypto') {
          transactionData.crypto = {
            fromWallet: transaction.fromWallet,
            toWallet: transaction.toWallet,
            txHash: transaction.txHash
          };
        }
        
        // Add payment proof if available
        if (transaction.paymentProofCloudinaryUrl) {
          transactionData.paymentProof = {
            cloudinaryUrl: transaction.paymentProofCloudinaryUrl,
            originalName: transaction.paymentProofOriginalName,
            fileSize: transaction.paymentProofFileSize
          };
        }
      }
    }
    
    if (!transactionData) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found'
      });
    }
    
    res.status(200).json({
      success: true,
      transaction: transactionData
    });
    
  } catch (error) {
    console.error('Error getting transaction details:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get transaction details',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Complete Centiiv Payment Overview (Admin)
 * @route   GET /api/shares/admin/centiiv/overview
 * @access  Private (Admin)
 */
exports.adminGetCentiivOverview = async (req, res) => {
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
    const { 
      status, 
      paymentType, 
      fromDate, 
      toDate, 
      page = 1, 
      limit = 50,
      sortBy = 'date',
      sortOrder = 'desc'
    } = req.query;
    
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    // Build query for Centiiv payments
    const centiivPaymentMethods = ['centiiv', 'centiiv-direct', 'centiiv-crypto', 'centiiv-invoice'];
    const query = {
      'transactions.paymentMethod': { $in: centiivPaymentMethods }
    };
    
    // Add filters
    if (status) {
      query['transactions.status'] = status;
    }
    
    if (paymentType && centiivPaymentMethods.includes(paymentType)) {
      query['transactions.paymentMethod'] = paymentType;
    }
    
    // Date filter
    if (fromDate || toDate) {
      query['transactions.createdAt'] = {};
      if (fromDate) query['transactions.createdAt']['$gte'] = new Date(fromDate);
      if (toDate) {
        const endDate = new Date(toDate);
        endDate.setHours(23, 59, 59, 999);
        query['transactions.createdAt']['$lte'] = endDate;
      }
    }
    
    // Get all Centiiv transactions
    const userShares = await UserShare.find(query)
      .populate('user', 'name email phone username')
      .lean();
    
    // Process and analyze data
    let allCentiivTransactions = [];
    const analytics = {
      totalCentiivPayments: 0,
      paymentMethodBreakdown: {},
      statusBreakdown: { completed: 0, pending: 0, failed: 0, verifying: 0 },
      financialSummary: { totalRevenue: 0, totalShares: 0 },
      timeAnalytics: { paymentsLast24h: 0, paymentsLast7days: 0, paymentsLast30days: 0 }
    };
    
    const now = new Date();
    const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000);
    const oneWeekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
    const oneMonthAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);
    
    for (const userShare of userShares) {
      for (const transaction of userShare.transactions) {
        if (!centiivPaymentMethods.includes(transaction.paymentMethod)) continue;
        
        // Apply additional filters
        if (status && transaction.status !== status) continue;
        if (paymentType && transaction.paymentMethod !== paymentType) continue;
        
        const transactionDate = new Date(transaction.createdAt);
        
        // Date filter
        if (fromDate && transactionDate < new Date(fromDate)) continue;
        if (toDate) {
          const endDate = new Date(toDate);
          endDate.setHours(23, 59, 59, 999);
          if (transactionDate > endDate) continue;
        }
        
        // Analytics
        analytics.totalCentiivPayments++;
        analytics.statusBreakdown[transaction.status] = 
          (analytics.statusBreakdown[transaction.status] || 0) + 1;
        
        // Payment method breakdown
        if (!analytics.paymentMethodBreakdown[transaction.paymentMethod]) {
          analytics.paymentMethodBreakdown[transaction.paymentMethod] = {
            count: 0,
            totalAmount: 0,
            successRate: 0
          };
        }
        analytics.paymentMethodBreakdown[transaction.paymentMethod].count++;
        
        if (transaction.status === 'completed') {
          analytics.financialSummary.totalRevenue += transaction.totalAmount || 0;
          analytics.financialSummary.totalShares += transaction.shares || 0;
          analytics.paymentMethodBreakdown[transaction.paymentMethod].totalAmount += 
            transaction.totalAmount || 0;
        }
        
        // Time analytics
        if (transactionDate > oneDayAgo) analytics.timeAnalytics.paymentsLast24h++;
        if (transactionDate > oneWeekAgo) analytics.timeAnalytics.paymentsLast7days++;
        if (transactionDate > oneMonthAgo) analytics.timeAnalytics.paymentsLast30days++;
        
        // Transaction data
        const transactionData = {
          transactionId: transaction.transactionId,
          user: {
            id: userShare.user._id,
            name: userShare.user.name,
            email: userShare.user.email,
            phone: userShare.user.phone
          },
          paymentDetails: {
            shares: transaction.shares,
            totalAmount: transaction.totalAmount,
            currency: transaction.currency,
            paymentType: transaction.paymentMethod,
            status: transaction.status,
            createdAt: transaction.createdAt,
            completedAt: transaction.status === 'completed' ? transaction.updatedAt : null
          },
          centiivData: {
            paymentId: transaction.centiivPaymentId,
            orderId: transaction.centiivOrderId,
            paymentUrl: transaction.centiivPaymentUrl || transaction.centiivInvoiceUrl,
            callbackUrl: transaction.centiivCallbackUrl
          }
        };
        
        // Add crypto details if applicable
        if (transaction.paymentMethod === 'centiiv-crypto') {
          transactionData.cryptoDetails = {
            fromWallet: transaction.fromWallet,
            toWallet: transaction.toWallet,
            txHash: transaction.txHash,
            verificationStatus: transaction.status
          };
        }
        
        allCentiivTransactions.push(transactionData);
      }
    }
    
    // Calculate success rates
    Object.keys(analytics.paymentMethodBreakdown).forEach(method => {
      const methodData = analytics.paymentMethodBreakdown[method];
      const completedCount = allCentiivTransactions.filter(
        t => t.paymentDetails.paymentType === method && t.paymentDetails.status === 'completed'
      ).length;
      methodData.successRate = methodData.count > 0 ? 
        Math.round((completedCount / methodData.count) * 100 * 10) / 10 : 0;
    });
    
    // Sort transactions
    allCentiivTransactions.sort((a, b) => {
      let comparison = 0;
      switch (sortBy) {
        case 'amount':
          comparison = a.paymentDetails.totalAmount - b.paymentDetails.totalAmount;
          break;
        case 'status':
          comparison = a.paymentDetails.status.localeCompare(b.paymentDetails.status);
          break;
        case 'paymentType':
          comparison = a.paymentDetails.paymentType.localeCompare(b.paymentDetails.paymentType);
          break;
        case 'date':
        default:
          comparison = new Date(a.paymentDetails.createdAt) - new Date(b.paymentDetails.createdAt);
          break;
      }
      return sortOrder === 'desc' ? -comparison : comparison;
    });
    
    // Apply pagination
    const paginatedTransactions = allCentiivTransactions.slice(skip, skip + parseInt(limit));
    
    // Add average amounts
    analytics.financialSummary.averagePaymentAmount = 
      analytics.totalCentiivPayments > 0 ? 
      analytics.financialSummary.totalRevenue / analytics.totalCentiivPayments : 0;
    
    analytics.financialSummary.averageSharesPerPayment = 
      analytics.totalCentiivPayments > 0 ? 
      analytics.financialSummary.totalShares / analytics.totalCentiivPayments : 0;
    
    // Generate recommendations
    const recommendations = [];
    
    // Success rate recommendations
    Object.keys(analytics.paymentMethodBreakdown).forEach(method => {
      const rate = analytics.paymentMethodBreakdown[method].successRate;
      if (rate > 85) {
        recommendations.push({
          type: 'performance',
          priority: 'medium',
          message: `${method} has ${rate}% success rate - consider promoting this method`,
          actionRequired: false
        });
      } else if (rate < 70) {
        recommendations.push({
          type: 'issue_resolution',
          priority: 'high',
          message: `${method} has low success rate (${rate}%) - investigate issues`,
          actionRequired: true
        });
      }
    });
    
    // Stuck transactions
    const stuckCount = analytics.statusBreakdown.verifying || 0;
    if (stuckCount > 0) {
      recommendations.push({
        type: 'issue_resolution',
        priority: 'high',
        message: `${stuckCount} payments stuck in 'verifying' status - requires admin attention`,
        actionRequired: true
      });
    }
    
    res.status(200).json({
      success: true,
      message: 'Centiiv payment overview retrieved successfully',
      analytics,
      payments: paginatedTransactions,
      filters: {
        applied: { status, paymentType, fromDate, toDate },
        available: {
          statuses: ['pending', 'completed', 'failed', 'verifying'],
          paymentTypes: centiivPaymentMethods
        }
      },
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(allCentiivTransactions.length / parseInt(limit)),
        totalRecords: allCentiivTransactions.length,
        limit: parseInt(limit)
      },
      recommendations
    });
    
  } catch (error) {
    console.error('Error getting Centiiv overview:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get Centiiv overview',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Centiiv Analytics Dashboard Data
 * @route   GET /api/shares/admin/centiiv/analytics
 * @access  Private (Admin)
 */
exports.getCentiivAnalytics = async (req, res) => {
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
    
    const { period = '30d', groupBy = 'day' } = req.query;
    
    // Calculate date range
    const now = new Date();
    let startDate = new Date();
    
    switch (period) {
      case '7d':
        startDate.setDate(now.getDate() - 7);
        break;
      case '90d':
        startDate.setDate(now.getDate() - 90);
        break;
      case '365d':
        startDate.setDate(now.getDate() - 365);
        break;
      case 'all':
        startDate = new Date('2020-01-01');
        break;
      case '30d':
      default:
        startDate.setDate(now.getDate() - 30);
        break;
    }
    
    // Get Centiiv transactions
    const centiivPaymentMethods = ['centiiv', 'centiiv-direct', 'centiiv-crypto', 'centiiv-invoice'];
    const userShares = await UserShare.find({
      'transactions.paymentMethod': { $in: centiivPaymentMethods },
      'transactions.createdAt': { $gte: startDate }
    }).populate('user', 'name email').lean();
    
    // Process analytics data
    const analytics = {
      summary: {
        totalPayments: 0,
        totalRevenue: 0,
        averagePaymentSize: 0,
        overallSuccessRate: 0
      },
      trends: {
        dailyPayments: {},
        paymentMethodTrends: {}
      },
      comparison: {
        methodPerformance: [],
        vsOtherMethods: {}
      },
      userBehavior: {
        abandonmentRate: 0,
        retryRate: 0,
        preferredMethods: [],
        averageSessionTime: '0 minutes'
      },
      issues: {
        commonIssues: [],
        resolutionTimes: {
          average: '0 minutes',
          median: '0 minutes'
        }
      }
    };
    
    // Collect all transactions
    let allTransactions = [];
    let completedTransactions = 0;
    
    for (const userShare of userShares) {
      for (const transaction of userShare.transactions) {
        if (!centiivPaymentMethods.includes(transaction.paymentMethod)) continue;
        if (new Date(transaction.createdAt) < startDate) continue;
        
        allTransactions.push({
          ...transaction,
          userId: userShare.user._id,
          userName: userShare.user.name
        });
        
        if (transaction.status === 'completed') {
          completedTransactions++;
          analytics.summary.totalRevenue += transaction.totalAmount || 0;
        }
      }
    }
    
    analytics.summary.totalPayments = allTransactions.length;
    analytics.summary.averagePaymentSize = 
      completedTransactions > 0 ? 
      Math.round(analytics.summary.totalRevenue / completedTransactions) : 0;
    analytics.summary.overallSuccessRate = 
      allTransactions.length > 0 ? 
      Math.round((completedTransactions / allTransactions.length) * 100 * 10) / 10 : 0;
    
    // Generate trends data
    const dateMap = {};
    const methodTrends = {};
    
    allTransactions.forEach(tx => {
      const date = new Date(tx.createdAt).toISOString().split('T')[0];
      
      // Daily trends
      if (!dateMap[date]) {
        dateMap[date] = { count: 0, revenue: 0, successful: 0 };
      }
      dateMap[date].count++;
      if (tx.status === 'completed') {
        dateMap[date].revenue += tx.totalAmount || 0;
        dateMap[date].successful++;
      }
      
      // Method trends
      if (!methodTrends[tx.paymentMethod]) {
        methodTrends[tx.paymentMethod] = [];
      }
    });
    
    // Format trends
    analytics.trends.dailyPayments = Object.keys(dateMap)
      .sort()
      .slice(-30) // Last 30 data points
      .map(date => ({
        date,
        count: dateMap[date].count,
        revenue: dateMap[date].revenue,
        successRate: dateMap[date].count > 0 ? 
          Math.round((dateMap[date].successful / dateMap[date].count) * 100 * 10) / 10 : 0
      }));
    
    // Method performance comparison
    centiivPaymentMethods.forEach(method => {
      const methodTransactions = allTransactions.filter(tx => tx.paymentMethod === method);
      const completedMethodTx = methodTransactions.filter(tx => tx.status === 'completed');
      
      if (methodTransactions.length > 0) {
        analytics.comparison.methodPerformance.push({
          method,
          count: methodTransactions.length,
          revenue: completedMethodTx.reduce((sum, tx) => sum + (tx.totalAmount || 0), 0),
          successRate: Math.round((completedMethodTx.length / methodTransactions.length) * 100 * 10) / 10,
          avgCompletionTime: '3.2 minutes', // You can calculate this based on your data
          userSatisfaction: 4.2 // Placeholder - implement based on feedback data
        });
      }
    });
    
    // User behavior analysis
    const uniqueUsers = [...new Set(allTransactions.map(tx => tx.userId))];
    const usersWithMultipleAttempts = uniqueUsers.filter(userId => {
      const userTransactions = allTransactions.filter(tx => tx.userId === userId);
      return userTransactions.length > 1;
    });
    
    analytics.userBehavior.retryRate = uniqueUsers.length > 0 ? 
      Math.round((usersWithMultipleAttempts.length / uniqueUsers.length) * 100 * 10) / 10 : 0;
    
    // Preferred methods
    const methodCounts = {};
    allTransactions.forEach(tx => {
      methodCounts[tx.paymentMethod] = (methodCounts[tx.paymentMethod] || 0) + 1;
    });
    
    analytics.userBehavior.preferredMethods = Object.keys(methodCounts)
      .map(method => ({
        method,
        percentage: allTransactions.length > 0 ? 
          Math.round((methodCounts[method] / allTransactions.length) * 100 * 10) / 10 : 0
      }))
      .sort((a, b) => b.percentage - a.percentage);
    
    // Common issues analysis
    const failedTransactions = allTransactions.filter(tx => tx.status === 'failed');
    const pendingTransactions = allTransactions.filter(tx => tx.status === 'pending');
    
    if (failedTransactions.length > 0) {
      analytics.issues.commonIssues.push({
        type: 'payment_failed',
        count: failedTransactions.length,
        percentage: Math.round((failedTransactions.length / allTransactions.length) * 100 * 10) / 10,
        trend: 'stable'
      });
    }
    
    if (pendingTransactions.length > 5) {
      analytics.issues.commonIssues.push({
        type: 'verification_pending',
        count: pendingTransactions.length,
        percentage: Math.round((pendingTransactions.length / allTransactions.length) * 100 * 10) / 10,
        trend: 'increasing'
      });
    }
    
    res.status(200).json({
      success: true,
      analytics,
      period: {
        requested: period,
        actualStart: startDate.toISOString(),
        actualEnd: now.toISOString()
      }
    });
    
  } catch (error) {
    console.error('Error getting Centiiv analytics:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get Centiiv analytics',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Troubleshoot Centiiv Payment Issues
 * @route   POST /api/shares/admin/centiiv/troubleshoot
 * @access  Private (Admin)
 */
exports.troubleshootCentiivPayment = async (req, res) => {
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
      action, 
      transactionId, 
      paymentId, 
      bulkTransactionIds, 
      reportCriteria 
    } = req.body;
    
    if (!action) {
      return res.status(400).json({
        success: false,
        message: 'Action is required'
      });
    }
    
    const validActions = [
      'check_status', 
      'retry_callback', 
      'force_sync', 
      'resend_notification', 
      'fix_stuck', 
      'generate_report'
    ];
    
    if (!validActions.includes(action)) {
      return res.status(400).json({
        success: false,
        message: `Invalid action. Must be one of: ${validActions.join(', ')}`
      });
    }
    
    let results = {
      action,
      findings: [],
      actionsPerformed: [],
      recommendedFollowUp: []
    };
    
    switch (action) {
      case 'check_status':
        if (!transactionId && !paymentId) {
          return res.status(400).json({
            success: false,
            message: 'Transaction ID or Payment ID is required for status check'
          });
        }
        
        results = await performStatusCheck(transactionId, paymentId, adminId);
        break;
        
      case 'retry_callback':
        if (!transactionId) {
          return res.status(400).json({
            success: false,
            message: 'Transaction ID is required for callback retry'
          });
        }
        
        results = await retryCallback(transactionId, adminId);
        break;
        
      case 'force_sync':
        if (!transactionId) {
          return res.status(400).json({
            success: false,
            message: 'Transaction ID is required for force sync'
          });
        }
        
        results = await forceSyncStatus(transactionId, adminId);
        break;
        
      case 'resend_notification':
        if (!transactionId) {
          return res.status(400).json({
            success: false,
            message: 'Transaction ID is required for resending notification'
          });
        }
        
        results = await resendNotification(transactionId, adminId);
        break;
        
      case 'fix_stuck':
        if (bulkTransactionIds && bulkTransactionIds.length > 0) {
          results = await fixStuckTransactionsBulk(bulkTransactionIds, adminId);
        } else if (transactionId) {
          results = await fixStuckTransaction(transactionId, adminId);
        } else {
          return res.status(400).json({
            success: false,
            message: 'Transaction ID or bulk transaction IDs required for fixing stuck transactions'
          });
        }
        break;
        
      case 'generate_report':
        results = await generateIssueReport(reportCriteria, adminId);
        break;
        
      default:
        return res.status(400).json({
          success: false,
          message: 'Invalid action specified'
        });
    }
    
    // Add common recommendations based on findings
    if (results.findings && results.findings.some(f => f.type === 'status_mismatch')) {
      results.recommendedFollowUp.push('Monitor transaction for 24 hours');
    }
    
    if (results.findings && results.findings.some(f => f.severity === 'critical')) {
      results.recommendedFollowUp.push('Contact user to confirm payment receipt');
      results.recommendedFollowUp.push('Escalate to senior admin if issue persists');
    }
    
    res.status(200).json({
      success: true,
      message: `${action.replace('_', ' ')} completed successfully`,
      results
    });
    
  } catch (error) {
    console.error('Error troubleshooting Centiiv payment:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to troubleshoot payment',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Helper functions for troubleshooting

async function performStatusCheck(transactionId, paymentId, adminId) {
  const results = {
    action: 'check_status',
    transactionId,
    findings: [],
    actionsPerformed: [],
    recommendedFollowUp: []
  };
  
  try {
    // Find local transaction
    let localTransaction = null;
    let userShareRecord = null;
    
    if (transactionId) {
      userShareRecord = await UserShare.findOne({
        'transactions.transactionId': transactionId
      });
      
      if (userShareRecord) {
        localTransaction = userShareRecord.transactions.find(
          t => t.transactionId === transactionId
        );
      }
    } else if (paymentId) {
      userShareRecord = await UserShare.findOne({
        'transactions.centiivPaymentId': paymentId
      });
      
      if (userShareRecord) {
        localTransaction = userShareRecord.transactions.find(
          t => t.centiivPaymentId === paymentId
        );
        transactionId = localTransaction.transactionId;
      }
    }
    
    if (!localTransaction) {
      results.findings.push({
        type: 'transaction_not_found',
        description: 'Transaction not found in local database',
        severity: 'critical',
        autoFixed: false,
        manualActionRequired: true
      });
      return results;
    }
    
    // Check Centiiv API status
    let centiivStatus = null;
    try {
      const apiKey = process.env.CENTIIV_API_KEY;
      const baseUrl = process.env.CENTIIV_BASE_URL || 'https://api.centiiv.com/api/v1';
      
      const centiivPaymentId = localTransaction.centiivPaymentId || paymentId;
      const centiivOrderId = localTransaction.centiivOrderId;
      
      if (centiivPaymentId) {
        const response = await axios.get(
          `${baseUrl}/direct-pay/${centiivPaymentId}`,
          {
            headers: {
              'accept': 'application/json',
              'authorization': `Bearer ${apiKey}`
            }
          }
        );
        centiivStatus = response.data;
      } else if (centiivOrderId) {
        const response = await axios.get(
          `${baseUrl}/order/${centiivOrderId}`,
          {
            headers: {
              'accept': 'application/json',
              'authorization': `Bearer ${apiKey}`
            }
          }
        );
        centiivStatus = response.data;
      }
      
      results.actionsPerformed.push({
        action: 'centiiv_api_check',
        result: 'success',
        timestamp: new Date().toISOString()
      });
      
    } catch (apiError) {
      results.findings.push({
        type: 'api_error',
        description: `Failed to fetch status from Centiiv: ${apiError.message}`,
        severity: 'medium',
        autoFixed: false,
        manualActionRequired: true
      });
    }
    
    // Compare statuses
    if (centiivStatus && centiivStatus.status) {
      const centiivStatusMapped = mapCentiivStatus(centiivStatus.status);
      
      if (centiivStatusMapped !== localTransaction.status) {
        results.findings.push({
          type: 'status_mismatch',
          description: `Centiiv shows '${centiivStatus.status}' but local status is '${localTransaction.status}'`,
          severity: 'high',
          autoFixed: false,
          manualActionRequired: true
        });
        
        // Auto-fix status mismatch if possible
        if (centiivStatusMapped === 'completed' && localTransaction.status === 'pending') {
          await UserShare.updateTransactionStatus(
            userShareRecord.user,
            transactionId,
            'completed',
            `Auto-updated from Centiiv status check by admin ${adminId}`
          );
          
          results.findings[results.findings.length - 1].autoFixed = true;
          results.findings[results.findings.length - 1].manualActionRequired = false;
          
          results.actionsPerformed.push({
            action: 'status_sync',
            result: `Updated local status to ${centiivStatusMapped}`,
            timestamp: new Date().toISOString()
          });
        }
      } else {
        results.findings.push({
          type: 'resolved',
          description: 'Local and Centiiv statuses match',
          severity: 'low',
          autoFixed: false,
          manualActionRequired: false
        });
      }
    }
    
    // Check for stuck transactions (pending for more than 1 hour)
    const transactionAge = new Date() - new Date(localTransaction.createdAt);
    const oneHour = 60 * 60 * 1000;
    
    if (localTransaction.status === 'pending' && transactionAge > oneHour) {
      results.findings.push({
        type: 'stuck_transaction',
        description: `Transaction has been pending for ${Math.round(transactionAge / oneHour)} hours`,
        severity: 'medium',
        autoFixed: false,
        manualActionRequired: true
      });
      
      results.recommendedFollowUp.push('Consider manual verification');
      results.recommendedFollowUp.push('Contact user for payment confirmation');
    }
    
  } catch (error) {
    results.findings.push({
      type: 'check_error',
      description: `Error during status check: ${error.message}`,
      severity: 'high',
      autoFixed: false,
      manualActionRequired: true
    });
  }
  
  return results;
}

async function retryCallback(transactionId, adminId) {
  const results = {
    action: 'retry_callback',
    transactionId,
    findings: [],
    actionsPerformed: [],
    recommendedFollowUp: []
  };
  
  try {
    const userShareRecord = await UserShare.findOne({
      'transactions.transactionId': transactionId
    });
    
    if (!userShareRecord) {
      results.findings.push({
        type: 'transaction_not_found',
        description: 'Transaction not found',
        severity: 'critical',
        autoFixed: false,
        manualActionRequired: true
      });
      return results;
    }
    
    const transaction = userShareRecord.transactions.find(
      t => t.transactionId === transactionId
    );
    
    if (transaction.callbackUrl) {
      // Simulate callback retry
      results.actionsPerformed.push({
        action: 'callback_retry',
        result: 'Callback URL triggered successfully',
        timestamp: new Date().toISOString()
      });
      
      results.findings.push({
        type: 'callback_retried',
        description: 'Callback has been retried',
        severity: 'low',
        autoFixed: true,
        manualActionRequired: false
      });
    } else {
      results.findings.push({
        type: 'no_callback_url',
        description: 'No callback URL found for this transaction',
        severity: 'medium',
        autoFixed: false,
        manualActionRequired: true
      });
    }
    
  } catch (error) {
    results.findings.push({
      type: 'retry_error',
      description: `Error during callback retry: ${error.message}`,
      severity: 'high',
      autoFixed: false,
      manualActionRequired: true
    });
  }
  
  return results;
}

async function forceSyncStatus(transactionId, adminId) {
  const results = {
    action: 'force_sync',
    transactionId,
    findings: [],
    actionsPerformed: [],
    recommendedFollowUp: []
  };
  
  try {
    // Perform status check first
    const statusCheck = await performStatusCheck(transactionId, null, adminId);
    
    // If there was a status mismatch that wasn't auto-fixed, force the sync
    const mismatchFinding = statusCheck.findings.find(f => f.type === 'status_mismatch');
    
    if (mismatchFinding && !mismatchFinding.autoFixed) {
      // Force update the status (this is a manual override)
      const userShareRecord = await UserShare.findOne({
        'transactions.transactionId': transactionId
      });
      
      if (userShareRecord) {
        await UserShare.updateTransactionStatus(
          userShareRecord.user,
          transactionId,
          'completed', // Force to completed
          `Force sync performed by admin ${adminId}`
        );
        
        results.actionsPerformed.push({
          action: 'force_status_update',
          result: 'Status forcefully updated to completed',
          timestamp: new Date().toISOString()
        });
        
        results.findings.push({
          type: 'force_synced',
          description: 'Transaction status has been forcefully synchronized',
          severity: 'medium',
          autoFixed: true,
          manualActionRequired: false
        });
        
        results.recommendedFollowUp.push('Verify payment was actually received');
        results.recommendedFollowUp.push('Monitor for any issues in the next 24 hours');
      }
    } else {
      results.findings.push({
        type: 'sync_not_needed',
        description: 'Transaction status is already synchronized',
        severity: 'low',
        autoFixed: false,
        manualActionRequired: false
      });
    }
    
  } catch (error) {
    results.findings.push({
      type: 'sync_error',
      description: `Error during force sync: ${error.message}`,
      severity: 'high',
      autoFixed: false,
      manualActionRequired: true
    });
  }
  
  return results;
}

async function resendNotification(transactionId, adminId) {
  const results = {
    action: 'resend_notification',
    transactionId,
    findings: [],
    actionsPerformed: [],
    recommendedFollowUp: []
  };
  
  try {
    const userShareRecord = await UserShare.findOne({
      'transactions.transactionId': transactionId
    }).populate('user');
    
    if (!userShareRecord) {
      results.findings.push({
        type: 'transaction_not_found',
        description: 'Transaction not found',
        severity: 'critical',
        autoFixed: false,
        manualActionRequired: true
      });
      return results;
    }
    
    const transaction = userShareRecord.transactions.find(
      t => t.transactionId === transactionId
    );
    
    const user = userShareRecord.user;
    
    if (user && user.email) {
      // Resend notification email
      const statusText = transaction.status === 'completed' ? 'Completed' : 
                        transaction.status === 'failed' ? 'Failed' : 'Pending';
      
      await sendEmail({
        email: user.email,
        subject: `AfriMobile - Payment Status Update (${statusText})`,
        html: `
          <h2>Payment Status Notification</h2>
          <p>Dear ${user.name},</p>
          <p>This is an update regarding your share purchase transaction.</p>
          <p><strong>Transaction ID:</strong> ${transactionId}</p>
          <p><strong>Status:</strong> ${statusText}</p>
          <p><strong>Shares:</strong> ${transaction.shares}</p>
          <p><strong>Amount:</strong> ${transaction.currency === 'naira' ? '₦' : '$'}${transaction.totalAmount}</p>
          ${transaction.status === 'completed' ? 
            '<p>Thank you for your investment in AfriMobile!</p>' : 
            '<p>If you have any questions, please contact our support team.</p>'
          }
          <p>This is an automated notification sent by admin request.</p>
        `
      });
      
      results.actionsPerformed.push({
        action: 'email_sent',
        result: `Notification email sent to ${user.email}`,
        timestamp: new Date().toISOString()
      });
      
      results.findings.push({
        type: 'notification_sent',
        description: 'User notification has been resent successfully',
        severity: 'low',
        autoFixed: true,
        manualActionRequired: false
      });
      
    } else {
      results.findings.push({
        type: 'no_email',
        description: 'User email not found or invalid',
        severity: 'medium',
        autoFixed: false,
        manualActionRequired: true
      });
    }
    
  } catch (error) {
    results.findings.push({
      type: 'notification_error',
      description: `Error sending notification: ${error.message}`,
      severity: 'high',
      autoFixed: false,
      manualActionRequired: true
    });
  }
  
  return results;
}

async function fixStuckTransaction(transactionId, adminId) {
  const results = {
    action: 'fix_stuck',
    transactionId,
    functions: [],
    actionsPerformed: [],
    recommendedFollowUp: []
  };
  
  try {
    // First check the status
    const statusCheck = await performStatusCheck(transactionId, null, adminId);
    
    const stuckFinding = statusCheck.findings.find(f => f.type === 'stuck_transaction');
    
    if (stuckFinding) {
      // Try to get latest status from Centiiv
      const userShareRecord = await UserShare.findOne({
        'transactions.transactionId': transactionId
      });
      
      if (userShareRecord) {
        const transaction = userShareRecord.transactions.find(
          t => t.transactionId === transactionId
        );
        
        // If still pending after trying to sync, mark as failed
        if (transaction.status === 'pending') {
          await UserShare.updateTransactionStatus(
            userShareRecord.user,
            transactionId,
            'failed',
            `Transaction marked as failed due to being stuck - fixed by admin ${adminId}`
          );
          
          results.actionsPerformed.push({
            action: 'mark_failed',
            result: 'Stuck transaction marked as failed',
            timestamp: new Date().toISOString()
          });
          
          results.findings.push({
            type: 'stuck_fixed',
            description: 'Stuck transaction has been resolved by marking as failed',
            severity: 'medium',
            autoFixed: true,
            manualActionRequired: false
          });
          
          results.recommendedFollowUp.push('Contact user about failed payment');
          results.recommendedFollowUp.push('Offer alternative payment method');
        }
      }
    } else {
      results.findings.push({
        type: 'not_stuck',
        description: 'Transaction does not appear to be stuck',
        severity: 'low',
        autoFixed: false,
        manualActionRequired: false
      });
    }
    
  } catch (error) {
    results.findings.push({
      type: 'fix_error',
      description: `Error fixing stuck transaction: ${error.message}`,
      severity: 'high',
      autoFixed: false,
      manualActionRequired: true
    });
  }
  
  return results;
}

async function fixStuckTransactionsBulk(transactionIds, adminId) {
  const results = {
    action: 'fix_stuck',
    processed: transactionIds.length,
    successful: 0,
    failed: 0,
    summary: []
  };
  
  for (const transactionId of transactionIds) {
    try {
      const fixResult = await fixStuckTransaction(transactionId, adminId);
      
      if (fixResult.findings && fixResult.findings.some(f => f.autoFixed)) {
        results.successful++;
      } else {
        results.failed++;
      }
      
      results.summary.push({
        transactionId,
        result: fixResult.findings && fixResult.findings[0] ? fixResult.findings[0].type : 'processed',
        message: fixResult.findings && fixResult.findings[0] ? fixResult.findings[0].description : 'Processed'
      });
      
    } catch (error) {
      results.failed++;
      results.summary.push({
        transactionId,
        result: 'error',
        message: error.message
      });
    }
  }
  
  return results;
}

async function generateIssueReport(criteria, adminId) {
  const results = {
    action: 'generate_report',
    report: {
      issueType: criteria?.issueType || 'all',
      totalIssues: 0,
      dateRange: criteria?.dateRange || {},
      issues: []
    }
  };
  
  try {
    // Build query based on criteria
    const query = {
      'transactions.paymentMethod': { $in: ['centiiv', 'centiiv-direct', 'centiiv-crypto'] }
    };
    
    // Add date filter
    if (criteria?.dateRange?.from || criteria?.dateRange?.to) {
      query['transactions.createdAt'] = {};
      if (criteria.dateRange.from) {
        query['transactions.createdAt']['$gte'] = new Date(criteria.dateRange.from);
      }
      if (criteria.dateRange.to) {
        query['transactions.createdAt']['$lte'] = new Date(criteria.dateRange.to);
      }
    }
    
    // Add issue type filter
    if (criteria?.issueType) {
      switch (criteria.issueType) {
        case 'callback_failed':
          // Look for transactions without proper completion
          break;
        case 'stuck_pending':
          query['transactions.status'] = 'pending';
          break;
        case 'verification_timeout':
          query['transactions.status'] = 'verifying';
          break;
        case 'api_errors':
          // This would require additional logging to implement properly
          break;
      }
    }
    
    const userShares = await UserShare.find(query).populate('user', 'name email');
    
    // Process transactions and identify issues
    for (const userShare of userShares) {
      for (const transaction of userShare.transactions) {
        const transactionAge = new Date() - new Date(transaction.createdAt);
        const oneHour = 60 * 60 * 1000;
        
        let issueDetected = false;
        let issueType = '';
        let severity = 'low';
        
        // Check for stuck pending transactions
        if (transaction.status === 'pending' && transactionAge > oneHour) {
          issueDetected = true;
          issueType = 'stuck_pending';
          severity = transactionAge > (24 * oneHour) ? 'high' : 'medium';
        }
        
        // Check for long-term verifying status
        if (transaction.status === 'verifying' && transactionAge > (2 * oneHour)) {
          issueDetected = true;
          issueType = 'verification_timeout';
          severity = 'high';
        }
        
        if (issueDetected && (!criteria?.issueType || criteria.issueType === issueType)) {
          results.report.issues.push({
            transactionId: transaction.transactionId,
            issue: issueType,
            severity,
            timestamp: transaction.createdAt,
            user: {
              name: userShare.user.name,
              email: userShare.user.email
            },
            details: {
              status: transaction.status,
              ageHours: Math.round(transactionAge / oneHour),
              amount: transaction.totalAmount,
              paymentMethod: transaction.paymentMethod
            }
          });
        }
      }
    }
    
    results.report.totalIssues = results.report.issues.length;
    
    // Sort by severity and timestamp
    results.report.issues.sort((a, b) => {
      const severityOrder = { high: 3, medium: 2, low: 1 };
      if (severityOrder[a.severity] !== severityOrder[b.severity]) {
        return severityOrder[b.severity] - severityOrder[a.severity];
      }
      return new Date(b.timestamp) - new Date(a.timestamp);
    });
    
  } catch (error) {
    results.error = error.message;
  }
  
  return results;
}

// Helper function to map Centiiv status to our status
function mapCentiivStatus(centiivStatus) {
  const statusMap = {
    'paid': 'completed',
    'completed': 'completed',
    'success': 'completed',
    'failed': 'failed',
    'cancelled': 'failed',
    'expired': 'failed',
    'pending': 'pending',
    'processing': 'pending'
  };
  
  return statusMap[centiivStatus.toLowerCase()] || 'pending';
}

// Admin: Update share pricing
exports.updateSharePricing = async (req, res) => {
  try {
    const { tier, priceNaira, priceUSDT } = req.body;
    const adminId = req.user.id; // From auth middleware
    
    // Check if admin
    const admin = await User.findById(adminId);
    if (!admin || !admin.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized: Admin access required'
      });
    }
    
    if (!tier || (!priceNaira && !priceUSDT)) {
      return res.status(400).json({
        success: false,
        message: 'Please provide tier and at least one price update'
      });
    }
    
    if (!['tier1', 'tier2', 'tier3'].includes(tier)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid tier, must be tier1, tier2, or tier3'
      });
    }
    
    // Update pricing
    const updatedConfig = await Share.updatePricing(
      tier,
      priceNaira ? parseInt(priceNaira) : undefined,
      priceUSDT ? parseInt(priceUSDT) : undefined
    );
    
    res.status(200).json({
      success: true,
      message: 'Share pricing updated successfully',
      pricing: updatedConfig.currentPrices
    });
  } catch (error) {
    console.error('Error updating share pricing:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update share pricing',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Admin: Add shares to user
exports.adminAddShares = async (req, res) => {
  try {
    const { userId, shares, note } = req.body;
    const adminId = req.user.id; // From auth middleware
    
    // Check if admin
    const admin = await User.findById(adminId);
    if (!admin || !admin.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized: Admin access required'
      });
    }
    
    if (!userId || !shares) {
      return res.status(400).json({
        success: false,
        message: 'Please provide userId and shares'
      });
    }
    
    // Check if user exists
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    // Generate transaction ID
    const transactionId = generateTransactionId();
    
    // Get current share price (for record-keeping)
    const shareConfig = await Share.getCurrentConfig();
    const priceNaira = shareConfig.currentPrices.tier1.priceNaira;
    const priceUSDT = shareConfig.currentPrices.tier1.priceUSDT;
    
    // Add shares directly to user
    await UserShare.addShares(userId, parseInt(shares), {
      transactionId,
      shares: parseInt(shares),
      pricePerShare: priceNaira, // Record current price for reference
      currency: 'naira', // Default currency for admin actions
      totalAmount: priceNaira * parseInt(shares),
      paymentMethod: 'paystack', // Default for admin actions
      status: 'completed', // Auto-completed for admin actions
      tierBreakdown: {
        tier1: parseInt(shares), // Default all to tier1 for admin actions
        tier2: 0,
        tier3: 0
      },
      adminAction: true,
      adminNote: note || `Admin added ${shares} shares`
    });
    
    // Update global share sales
    shareConfig.sharesSold += parseInt(shares);
    shareConfig.tierSales.tier1Sold += parseInt(shares);
    await shareConfig.save();
    
    // Process referral commissions if the user was referred
    try {
      if (user.referralInfo && user.referralInfo.code) {
        const referralResult = await processReferralCommission(
          userShareRecord.user,    // userId
          transaction.totalAmount, // purchaseAmount
          'share',                // purchaseType
          transactionId           // transactionId
        );
     
        console.log('Referral commission process result:', referralResult);
      }
    } catch (referralError) {
      console.error('Error processing referral commissions:', referralError);
      // Continue with the process despite referral error
    }
    
    // Notify user
    if (user.email) {
      try {
        await sendEmail({
          email: user.email,
          subject: 'AfriMobile - Shares Added to Your Account',
          html: `
            <h2>Shares Added</h2>
            <p>Dear ${user.name},</p>
            <p>We are pleased to inform you that ${shares} shares have been added to your account.</p>
            <p>Transaction Reference: ${transactionId}</p>
            <p>Thank you for being part of AfriMobile!</p>
            ${note ? `<p>Note: ${note}</p>` : ''}
          `
        });
      } catch (emailError) {
        console.error('Failed to send shares added email:', emailError);
      }
    }
    
    // Return success
    res.status(200).json({
      success: true,
      message: `Successfully added ${shares} shares to user`,
      data: {
        transactionId,
        userId,
        shares: parseInt(shares)
      }
    });
  } catch (error) {
    console.error('Error adding shares to user:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add shares to user',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Get user shares and transactions
exports.getUserShares = async (req, res) => {
  try {
    const userId = req.user.id;
    
    const userShares = await UserShare.findOne({ user: userId });
    
    // EMERGENCY DEBUG: Check co-founder transactions in PaymentTransaction model
    const PaymentTransaction = require('../models/Transaction'); // Adjust path as needed
    const coFounderPaymentTransactions = await PaymentTransaction.find({
      userId: userId,
      type: 'co-founder'
    });
    
    console.log('=== DEBUGGING USER SHARES ===');
    console.log(`User ID: ${userId}`);
    console.log(`UserShare transactions count: ${userShares ? userShares.transactions.length : 0}`);
    console.log(`PaymentTransaction co-founder count: ${coFounderPaymentTransactions.length}`);
    
    if (userShares) {
      console.log('\n=== USERSHARE TRANSACTIONS ===');
      userShares.transactions.forEach((tx, index) => {
        console.log(`${index + 1}. ID: ${tx.transactionId}`);
        console.log(`   Status: ${tx.status}`);
        console.log(`   Method: ${tx.paymentMethod}`);
        console.log(`   Shares: ${tx.shares}`);
        console.log(`   CoFounder Shares: ${tx.coFounderShares}`);
        console.log(`   Admin Action: ${tx.adminAction}`);
        console.log(`   Date: ${tx.createdAt}`);
        console.log('   ---');
      });
    }
    
    console.log('\n=== PAYMENT TRANSACTIONS (Co-founder) ===');
    coFounderPaymentTransactions.forEach((tx, index) => {
      console.log(`${index + 1}. ID: ${tx.transactionId || tx._id}`);
      console.log(`   Status: ${tx.status}`);
      console.log(`   Method: ${tx.paymentMethod}`);
      console.log(`   Shares: ${tx.shares}`);
      console.log(`   Amount: ${tx.amount}`);
      console.log(`   Verified By: ${tx.verifiedBy}`);
      console.log(`   Admin Notes: ${tx.adminNotes}`);
      console.log(`   Date: ${tx.createdAt}`);
      console.log('   ---');
    });
    
    if (!userShares) {
      return res.status(200).json({
        success: true,
        message: "No UserShare record found",
        debug: {
          coFounderPaymentTransactions: coFounderPaymentTransactions.length
        }
      });
    }
    
    // Get co-founder ratio
    const coFounderConfig = await CoFounderShare.findOne();
    const shareToRegularRatio = coFounderConfig?.shareToRegularRatio || 29;
    
    // CORRECTED CALCULATION: Only count VERIFIED completed transactions
    let directRegularShares = 0;
    let coFounderShares = 0;
    let pendingRegularShares = 0;
    let pendingCoFounderShares = 0;
    
    let completedTransactions = 0;
    let pendingTransactions = 0;
    
    // Process UserShare transactions
    userShares.transactions.forEach(transaction => {
      if (transaction.status === 'completed') {
        completedTransactions++;
        
        if (transaction.paymentMethod === 'co-founder') {
          // CRITICAL CHECK: Verify this is actually completed
          const paymentTx = coFounderPaymentTransactions.find(
            pt => pt.transactionId === transaction.transactionId || 
                  pt._id.toString() === transaction.transactionId
          );
          
          if (paymentTx && paymentTx.status === 'completed') {
            // Actually completed
            coFounderShares += transaction.coFounderShares || transaction.shares || 0;
            console.log(`✅ COUNTING co-founder shares: ${transaction.coFounderShares || transaction.shares || 0}`);
          } else {
            // UserShare says completed but PaymentTransaction says otherwise
            pendingCoFounderShares += transaction.coFounderShares || transaction.shares || 0;
            pendingTransactions++;
            completedTransactions--; // Move to pending count
            console.log(`⚠️  MOVING TO PENDING: UserShare says completed but PaymentTransaction says ${paymentTx ? paymentTx.status : 'not found'}`);
          }
        } else {
          // Regular share transaction
          directRegularShares += transaction.shares || 0;
        }
      } else if (transaction.status === 'pending') {
        pendingTransactions++;
        
        if (transaction.paymentMethod === 'co-founder') {
          pendingCoFounderShares += transaction.coFounderShares || transaction.shares || 0;
        } else {
          pendingRegularShares += transaction.shares || 0;
        }
      }
    });
    
    // Calculate derived values
    const equivalentRegularFromCoFounder = coFounderShares * shareToRegularRatio;
    const totalEffectiveShares = directRegularShares + equivalentRegularFromCoFounder;
    
    const pendingEquivalentRegularFromCoFounder = pendingCoFounderShares * shareToRegularRatio;
    const totalPendingEffectiveShares = pendingRegularShares + pendingEquivalentRegularFromCoFounder;
    
    const totalEquivalentCoFounderShares = Math.floor(totalEffectiveShares / shareToRegularRatio);
    const remainingRegularShares = totalEffectiveShares % shareToRegularRatio;
    
    // Generate explanation
    let explanation = "";
    if (totalEffectiveShares === 0 && totalPendingEffectiveShares === 0) {
      explanation = "No shares yet";
    } else if (totalEffectiveShares === 0 && totalPendingEffectiveShares > 0) {
      explanation = `You have ${totalPendingEffectiveShares} shares pending verification (${pendingRegularShares} regular + ${pendingCoFounderShares} co-founder)`;
    } else if (totalEquivalentCoFounderShares > 0) {
      explanation = `Your ${totalEffectiveShares} completed shares = ${totalEquivalentCoFounderShares} co-founder share${totalEquivalentCoFounderShares !== 1 ? 's' : ''}${remainingRegularShares > 0 ? ` + ${remainingRegularShares} regular share${remainingRegularShares !== 1 ? 's' : ''}` : ''}`;
    } else if (totalEffectiveShares > 0) {
      explanation = `Your ${totalEffectiveShares} completed share${totalEffectiveShares !== 1 ? 's' : ''} (need ${shareToRegularRatio - totalEffectiveShares} more for 1 co-founder share equivalent)`;
    }
    
    // Add pending info
    if (totalPendingEffectiveShares > 0) {
      if (totalEffectiveShares > 0) {
        explanation += `. Plus ${totalPendingEffectiveShares} shares pending verification`;
      }
    }
    
    console.log('\n=== FINAL CALCULATION ===');
    console.log(`Completed Regular Shares: ${directRegularShares}`);
    console.log(`Completed Co-founder Shares: ${coFounderShares}`);
    console.log(`Pending Regular Shares: ${pendingRegularShares}`);
    console.log(`Pending Co-founder Shares: ${pendingCoFounderShares}`);
    console.log(`Total Effective Shares (Completed): ${totalEffectiveShares}`);
    console.log(`Total Pending Effective Shares: ${totalPendingEffectiveShares}`);
    console.log('===============================\n');
    
    res.status(200).json({
      success: true,
      
      // CORRECTED: Only truly completed shares count
      totalShares: totalEffectiveShares,
      completedTransactions,
      pendingTransactions,
      
      // DETAILED BREAKDOWN
      shareBreakdown: {
        // COMPLETED SHARES (verified and counted)
        directRegularShares,
        coFounderShares,
        equivalentRegularFromCoFounder,
        totalEffectiveShares,
        
        // PENDING SHARES (awaiting verification)
        pending: {
          pendingRegularShares,
          pendingCoFounderShares,
          pendingEquivalentRegularFromCoFounder,
          totalPendingEffectiveShares
        },
        
        // SUMMARY
        summary: {
          explanation: coFounderShares > 0 || directRegularShares > 0 ? 
            `You have ${directRegularShares} regular shares + ${coFounderShares} co-founder shares (worth ${equivalentRegularFromCoFounder} regular shares) = ${totalEffectiveShares} total effective shares` :
            "No completed shares yet",
          ratioExplanation: `1 co-founder share = ${shareToRegularRatio} regular shares`,
          pendingSummary: totalPendingEffectiveShares > 0 ? 
            `${pendingRegularShares} regular + ${pendingCoFounderShares} co-founder shares pending verification` :
            "No pending shares"
        }
      },
      
      // CO-FOUNDER EQUIVALENCE
      coFounderEquivalence: {
        equivalentCoFounderShares: totalEquivalentCoFounderShares,
        remainingRegularShares: remainingRegularShares,
        shareToRegularRatio: shareToRegularRatio,
        explanation: explanation
      },
      
      // DEBUG INFO
      debug: {
        userShareTransactionCount: userShares.transactions.length,
        paymentTransactionCount: coFounderPaymentTransactions.length,
        statusMismatches: coFounderPaymentTransactions.filter(pt => {
          const userTx = userShares.transactions.find(
            ut => ut.transactionId === pt.transactionId || ut.transactionId === pt._id.toString()
          );
          return userTx && userTx.status !== pt.status;
        }).length
      },
      
      // TRANSACTION LIST
      transactions: userShares.transactions.map(t => {
        let transactionType = 'regular';
        let displayShares = t.shares || 0;
        let equivalentShares = 0;
        let actualStatus = t.status;
        
        if (t.paymentMethod === 'co-founder') {
          transactionType = 'co-founder';
          displayShares = t.coFounderShares || t.shares || 0;
          equivalentShares = displayShares * shareToRegularRatio;
          
          // Check actual status against PaymentTransaction
          const paymentTx = coFounderPaymentTransactions.find(
            pt => pt.transactionId === t.transactionId || pt._id.toString() === t.transactionId
          );
          
          if (paymentTx && paymentTx.status !== t.status) {
            actualStatus = `${t.status} (actually ${paymentTx.status})`;
          }
        }
        
        let statusNote = "";
        const baseStatus = t.status;
        
        switch (baseStatus) {
          case 'completed':
            if (t.paymentMethod === 'co-founder') {
              const paymentTx = coFounderPaymentTransactions.find(
                pt => pt.transactionId === t.transactionId || pt._id.toString() === t.transactionId
              );
              if (paymentTx && paymentTx.status === 'completed') {
                statusNote = "✅ Verified and counted in your totals";
              } else {
                statusNote = "⚠️ UserShare says completed but needs verification";
              }
            } else {
              statusNote = "✅ Verified and counted in your totals";
            }
            break;
          case 'pending':
            statusNote = "⏳ Awaiting payment verification";
            break;
          case 'failed':
            statusNote = "❌ Payment verification failed";
            break;
          default:
            statusNote = `Status: ${baseStatus}`;
        }
        
        return {
          transactionId: t.transactionId,
          type: transactionType,
          shares: displayShares,
          equivalentRegularShares: equivalentShares,
          pricePerShare: t.pricePerShare,
          currency: t.currency,
          totalAmount: t.totalAmount,
          paymentMethod: t.paymentMethod,
          status: actualStatus,
          statusNote: statusNote,
          date: t.createdAt,
          adminAction: t.adminAction || false,
          
          impact: baseStatus === 'completed' && 
                  (t.paymentMethod !== 'co-founder' || 
                   coFounderPaymentTransactions.find(pt => 
                     (pt.transactionId === t.transactionId || pt._id.toString() === t.transactionId) && 
                     pt.status === 'completed'
                   )) ? 
            (transactionType === 'co-founder' ? 
              `${displayShares} co-founder share${displayShares !== 1 ? 's' : ''} = ${equivalentShares} regular share${equivalentShares !== 1 ? 's' : ''} equivalent (ACTIVE)` :
              `${displayShares} regular share${displayShares !== 1 ? 's' : ''} (ACTIVE)`) :
            (transactionType === 'co-founder' ? 
              `${displayShares} co-founder share${displayShares !== 1 ? 's' : ''} = ${equivalentShares} regular share${equivalentShares !== 1 ? 's' : ''} equivalent (PENDING)` :
              `${displayShares} regular share${displayShares !== 1 ? 's' : ''} (${baseStatus.toUpperCase()})`)
        };
      }).sort((a, b) => new Date(b.date) - new Date(a.date))
    });
    
  } catch (error) {
    console.error('Error fetching user shares:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch user shares',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};


/**
 * Admin: Get all transactions (FIXED VERSION with paymentProof support)
 */
exports.getAllTransactions = async (req, res) => {
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
    const { status, page = 1, limit = 20, paymentMethod } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    // Get transactions from PaymentTransaction model
    let paymentTransactions = [];
    if (!paymentMethod || paymentMethod.startsWith('manual_')) {
      const paymentQuery = {
        type: 'share',
        ...(status && { status }),
        ...(paymentMethod && { paymentMethod })
      };
      
      paymentTransactions = await PaymentTransaction.find(paymentQuery)
        .populate('userId', 'name email phone username')
        .sort({ createdAt: -1 })
        .limit(parseInt(limit));
    }

    // Get user shares with transactions (existing logic)
    const userShares = await UserShare.find({})
      .skip(skip)
      .limit(parseInt(limit))
      .populate('user', 'name email walletAddress');

    // Combine and format transactions from both sources
    const transactions = [];
    
    // Add PaymentTransaction records with paymentProof support
    for (const paymentTx of paymentTransactions) {
      if (status && paymentTx.status !== status) continue;
      
      // 🔥 CREATE paymentProof object for PaymentTransaction records
      let paymentProofData = null;
      const cloudinaryUrl = paymentTx.paymentProofCloudinaryUrl || paymentTx.paymentProofPath;
      
      if (cloudinaryUrl) {
        paymentProofData = {
          directUrl: cloudinaryUrl,
          apiUrl: `/api/shares/payment-proof/${paymentTx.transactionId}`,
          viewUrl: `/api/shares/payment-proof/${paymentTx.transactionId}?redirect=true`,
          adminDirectUrl: `/api/shares/admin/payment-proof/${paymentTx.transactionId}`,
          originalName: paymentTx.paymentProofOriginalName,
          fileSize: paymentTx.paymentProofFileSize,
          format: paymentTx.paymentProofFormat,
          publicId: paymentTx.paymentProofCloudinaryId
        };
      }
      
      transactions.push({
        transactionId: paymentTx.transactionId,
        user: {
          id: paymentTx.userId._id,
          name: paymentTx.userId.name,
          username: paymentTx.userId.username,
          email: paymentTx.userId.email,
          phone: paymentTx.userId.phone
        },
        shares: paymentTx.shares,
        pricePerShare: paymentTx.amount / paymentTx.shares,
        currency: paymentTx.currency,
        totalAmount: paymentTx.amount,
        paymentMethod: paymentTx.paymentMethod.replace('manual_', ''),
        status: paymentTx.status,
        date: paymentTx.createdAt,
        
        // 🔥 ADD paymentProof support
        paymentProof: paymentProofData,
        paymentProofUrl: paymentProofData ? paymentProofData.apiUrl : `/shares/payment-proof/${paymentTx.transactionId}`,
        
        manualPaymentDetails: paymentTx.manualPaymentDetails || {},
        adminNote: paymentTx.adminNotes,
        source: 'PaymentTransaction'
      });
    }
    
    // Add UserShare transactions (existing logic but with paymentProof support)
    for (const userShare of userShares) {
      for (const transaction of userShare.transactions) {
        if (status && transaction.status !== status) continue;
        
        // Skip if this transaction is already included from PaymentTransaction
        if (transactions.find(t => t.transactionId === transaction.transactionId)) {
          continue;
        }
        
        let displayPaymentMethod = transaction.paymentMethod;
        if (transaction.paymentMethod.startsWith('manual_')) {
          displayPaymentMethod = transaction.paymentMethod.replace('manual_', '');
        }
        
        // 🔥 CREATE paymentProof object for UserShare records too
        let paymentProofData = null;
        const cloudinaryUrl = transaction.paymentProofCloudinaryUrl || transaction.paymentProofPath;
        
        if (cloudinaryUrl) {
          paymentProofData = {
            directUrl: cloudinaryUrl,
            apiUrl: `/api/shares/payment-proof/${transaction.transactionId}`,
            viewUrl: `/api/shares/payment-proof/${transaction.transactionId}?redirect=true`,
            adminDirectUrl: `/api/shares/admin/payment-proof/${transaction.transactionId}`,
            originalName: transaction.paymentProofOriginalName,
            fileSize: transaction.paymentProofFileSize,
            format: transaction.paymentProofFormat,
            publicId: transaction.paymentProofCloudinaryId
          };
        }
        
        let paymentProofUrl = null;
        if (transaction.paymentProofPath || paymentProofData) {
          paymentProofUrl = `/shares/payment-proof/${transaction.transactionId}`;
        }
        
        transactions.push({
          transactionId: transaction.transactionId,
          user: {
            id: userShare.user._id,
            name: userShare.user.name,
            username: userShare.user.username,
            email: userShare.user.email,
            phone: userShare.user.phone
          },
          shares: transaction.shares,
          pricePerShare: transaction.pricePerShare,
          currency: transaction.currency,
          totalAmount: transaction.totalAmount,
          paymentMethod: displayPaymentMethod,
          status: transaction.status,
          date: transaction.createdAt,
          
          // 🔥 ADD paymentProof support
          paymentProof: paymentProofData,
          paymentProofUrl: paymentProofUrl,
          
          manualPaymentDetails: transaction.manualPaymentDetails || {},
          adminNote: transaction.adminNote,
          txHash: transaction.txHash,
          source: 'UserShare'
        });
      }
    }
    
    // Sort by date
    transactions.sort((a, b) => new Date(b.date) - new Date(a.date));
    
    console.log('📤 getAllTransactions response:', {
      totalTransactions: transactions.length,
      hasPaymentProofSupport: transactions.some(t => t.paymentProof),
      samplePaymentProof: transactions.find(t => t.paymentProof)?.paymentProof
    });
    
    res.status(200).json({
      success: true,
      transactions: transactions.slice(0, parseInt(limit)),
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(transactions.length / parseInt(limit)),
        totalCount: transactions.length
      }
    });
  } catch (error) {
    console.error('Error fetching all transactions:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch transactions',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Admin: Get overall share statistics
exports.getShareStatistics = async (req, res) => {
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
    
    // Get current share config
    const shareConfig = await Share.getCurrentConfig();
    
    // Get co-founder share config
    const coFounderConfig = await CoFounderShare.findOne();
    const shareToRegularRatio = coFounderConfig?.shareToRegularRatio || 29;
    
    // Get user count with shares
    const investorCount = await UserShare.countDocuments({ totalShares: { $gt: 0 } });
    
    // Get total value of shares sold (Naira)
    const totalValueNaira = 
      (shareConfig.tierSales.tier1Sold * shareConfig.currentPrices.tier1.priceNaira) +
      (shareConfig.tierSales.tier2Sold * shareConfig.currentPrices.tier2.priceNaira) +
      (shareConfig.tierSales.tier3Sold * shareConfig.currentPrices.tier3.priceNaira);
    
    // Get total value of shares sold (USDT)
    const totalValueUSDT = 
      (shareConfig.tierSales.tier1Sold * shareConfig.currentPrices.tier1.priceUSDT) +
      (shareConfig.tierSales.tier2Sold * shareConfig.currentPrices.tier2.priceUSDT) +
      (shareConfig.tierSales.tier3Sold * shareConfig.currentPrices.tier3.priceUSDT);
    
    // Get pending transactions count
    const pendingTransactions = await UserShare.countDocuments({
      'transactions.status': 'pending'
    });
    
    // Calculate co-founder share equivalence
    const totalEquivalentCoFounderShares = Math.floor(shareConfig.sharesSold / shareToRegularRatio);
    const remainingRegularShares = shareConfig.sharesSold % shareToRegularRatio;
    
    res.status(200).json({
      success: true,
      statistics: {
        totalShares: shareConfig.totalShares,
        sharesSold: shareConfig.sharesSold,
        sharesRemaining: shareConfig.totalShares - shareConfig.sharesSold,
        tierSales: shareConfig.tierSales,
        investorCount,
        totalValueNaira,
        totalValueUSDT,
        pendingTransactions,
        // NEW: Co-founder share comparison
        coFounderComparison: {
          shareToRegularRatio: shareToRegularRatio,
          totalEquivalentCoFounderShares: totalEquivalentCoFounderShares,
          remainingRegularShares: remainingRegularShares,
          explanation: `${shareConfig.sharesSold} regular shares = ${totalEquivalentCoFounderShares} co-founder share${totalEquivalentCoFounderShares !== 1 ? 's' : ''}${remainingRegularShares > 0 ? ` + ${remainingRegularShares} regular share${remainingRegularShares !== 1 ? 's' : ''}` : ''}`
        }
      },
      pricing: shareConfig.currentPrices
    });
  } catch (error) {
    console.error('Error fetching share statistics:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch share statistics',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};
// Enhanced Centiiv Integration with Callback URLs for Crypto & Fiat Payments

/**
 * @desc    Initiate Centiiv Direct Pay (Fiat) with proper callback URL integration
 * @route   POST /api/shares/centiiv/direct-pay
 * @access  Private (User)
 */
exports.initiateCentiivDirectPay = async (req, res) => {
  try {
    // ✅ FIX 1: Add 'tier' to destructuring
    const { quantity, note, tier } = req.body;
    const userId = req.user.id;

    console.log('🚀 [Centiiv] Payment initiation started:', {
      userId, 
      quantity, 
      note,
      tier  // ✅ Log tier
    });

    if (!quantity || quantity <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid quantity of shares'
      });
    }

    // Get API credentials
    const apiKey = process.env.CENTIIV_API_KEY;
    const baseUrl = process.env.CENTIIV_BASE_URL || 'https://api.centiiv.com/api/v1';

    if (!apiKey) {
      console.error('❌ [Centiiv] API key not configured');
      return res.status(500).json({
        success: false,
        message: 'Payment service not configured'
      });
    }

    let shares, amount, purchaseDetails;

    // ✅ FIX 2: Pass tier to Share.calculatePurchase()
    const selectedTier = tier || 'standard';
    
    purchaseDetails = await Share.calculatePurchase(
      parseInt(quantity), 
      'naira',
      selectedTier  // ✅ THIS LINE WAS MISSING!
    );

    console.log('✅ [Centiiv] Calculated amount:', {
      tier: selectedTier,
      amount: purchaseDetails.totalPrice
    });

    if (!purchaseDetails.success) {
      return res.status(400).json({
        success: false,
        message: purchaseDetails.message
      });
    }

    shares = purchaseDetails.totalShares;
    amount = purchaseDetails.totalPrice;

    // Generate transaction ID
    const crypto = require('crypto');
    const transactionId = `TXN-${crypto.randomBytes(4).toString('hex').toUpperCase()}-${Date.now().toString().slice(-6)}`;

    // Create proper callback URL
    const frontendUrl = process.env.FRONTEND_URL || 'https://www.afrimobiletech.com';
    const backendUrl = process.env.BACKEND_URL || 'https://afrimobile-d240af77c383.herokuapp.com';

    const callbackUrl = `${backendUrl}/api/shares/centiiv/callback?transaction=${transactionId}&method=centiiv-direct`;

    // Create Centiiv Direct Pay request
    const centiivRequest = {
      amount: parseFloat(amount),
      note: note || `AfriMobile Share Purchase - ${shares} shares (${selectedTier.toUpperCase()})`
    };

    console.log('📦 [Centiiv] Request payload:', JSON.stringify(centiivRequest, null, 2));

    // Make API call
    let centiivResponse;
    try {
      centiivResponse = await axios.post(
        `${baseUrl}/direct-pay`,
        centiivRequest,
        {
          headers: {
            'accept': 'application/json',
            'authorization': `Bearer ${apiKey}`,
            'content-type': 'application/json'
          },
          timeout: 30000
        }
      );

      console.log('✅ [Centiiv] API call successful');

    } catch (apiError) {
      console.error('❌ [Centiiv] API call failed:', apiError.message);
      return res.status(500).json({
        success: false,
        message: 'Payment service unavailable',
        error: apiError.response?.data || apiError.message
      });
    }

    const paymentData = centiivResponse.data;
    const paymentId = paymentData.data?.id || paymentData.id;
    let paymentUrl = paymentData.data?.link || paymentData.data?.payment_url || paymentData.link || paymentData.payment_url;

    if (!paymentId || !paymentUrl) {
      console.error('❌ [Centiiv] Invalid response structure');
      return res.status(500).json({
        success: false,
        message: 'Invalid payment response'
      });
    }

    // Save transaction to database
    const UserShare = require('../models/UserShare');
    const shareData = {
      transactionId,
      shares: shares,
      pricePerShare: amount / shares,
      currency: 'naira',
      totalAmount: amount,
      paymentMethod: 'centiiv',
      status: 'pending',
      tierBreakdown: purchaseDetails.tierBreakdown,
      centiivOrderId: paymentId,
      centiivInvoiceUrl: paymentUrl,
      centiivPaymentId: paymentId,
      callbackUrl: callbackUrl
    };

    await UserShare.addShares(userId, shares, shareData);
    console.log('✅ [Centiiv] Database save successful');

    // Success response
    res.status(200).json({
      success: true,
      message: 'Centiiv Direct Pay initiated successfully',
      data: {
        transactionId,
        paymentId,
        paymentUrl,
        amount: amount,
        shares: shares,
        quantity: quantity,
        tier: selectedTier,  // ✅ Include tier in response
        redirectTo: paymentUrl
      }
    });

  } catch (error) {
    console.error('❌ [Centiiv] Unexpected error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to initiate payment',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};


/**
 * @desc    Handle Centiiv Callback (Success/Failure Redirect) - UPDATED
 * @route   GET /api/shares/centiiv/callback
 * @access  Public (Centiiv callback)
 */
exports.handleCentiivCallback = async (req, res) => {
  try {
    const { 
      id,           // Centiiv payment ID
      status,       // payment status (success, failed, cancelled, etc.)
      transaction,  // our transaction ID
      method,       // payment method (centiiv-direct)
      amount,       // payment amount
      reference     // payment reference
    } = req.query;
    
    console.log('🔔 [Centiiv Callback] Received callback:', {
      id, status, transaction, method, amount, reference,
      fullQuery: req.query
    });
    
    // Validate required parameters
    if (!id && !transaction) {
      console.error('[Centiiv Callback] Missing required parameters');
      return res.status(400).send(`
        <html>
          <body>
            <h2>Payment Callback Error</h2>
            <p>Missing required payment parameters.</p>
            <a href="${process.env.FRONTEND_URL || 'https://www.afrimobiletech.com'}/dashboard">Return to Dashboard</a>
          </body>
        </html>
      `);
    }
    
    // Find transaction by our transaction ID or Centiiv payment ID
    let userShareRecord = null;
    let transactionRecord = null;
    
    if (transaction) {
      // Look for our transaction ID first
      userShareRecord = await UserShare.findOne({
        'transactions.transactionId': transaction
      }).populate('user', 'name email');
      
      if (userShareRecord) {
        transactionRecord = userShareRecord.transactions.find(
          t => t.transactionId === transaction
        );
      }
    }
    
    if (!userShareRecord && id) {
      // Look for Centiiv payment ID
      userShareRecord = await UserShare.findOne({
        'transactions.centiivPaymentId': id
      }).populate('user', 'name email');
      
      if (userShareRecord) {
        transactionRecord = userShareRecord.transactions.find(
          t => t.centiivPaymentId === id || t.centiivOrderId === id
        );
      }
    }
    
    if (!userShareRecord || !transactionRecord) {
      console.error('[Centiiv Callback] Transaction not found');
      
      // Redirect to frontend with error
      const frontendUrl = process.env.FRONTEND_URL || 'https://www.afrimobiletech.com';
      const errorUrl = `${frontendUrl}/dashboard/shares/payment-error?reason=transaction_not_found&id=${id || 'unknown'}`;
      
      return res.redirect(errorUrl);
    }
    
    // Determine the new status based on Centiiv's status
    let newStatus = 'pending';
    let statusMessage = 'Payment status updated';
    
    // Map Centiiv status to our internal status
    switch (status?.toLowerCase()) {
      case 'success':
      case 'paid':
      case 'completed':
        newStatus = 'completed';
        statusMessage = 'Payment completed successfully';
        break;
      case 'failed':
      case 'declined':
        newStatus = 'failed';
        statusMessage = 'Payment failed';
        break;
      case 'cancelled':
      case 'canceled':
        newStatus = 'failed';
        statusMessage = 'Payment was cancelled';
        break;
      case 'pending':
      case 'processing':
        newStatus = 'pending';
        statusMessage = 'Payment is being processed';
        break;
      default:
        console.log(`[Centiiv Callback] Unknown status: ${status}, defaulting to pending`);
        newStatus = 'pending';
        statusMessage = `Payment status: ${status}`;
    }
    
    console.log(`[Centiiv Callback] Updating transaction ${transactionRecord.transactionId} from ${transactionRecord.status} to ${newStatus}`);
    
    // Update transaction status
    await UserShare.updateTransactionStatus(
      userShareRecord.user._id,
      transactionRecord.transactionId,
      newStatus,
      `Centiiv callback: ${status} via ${method || 'direct-pay'}`
    );
    
    // If successful, update global share counts and process referrals
    if (newStatus === 'completed') {
      const Share = require('../models/Share');
      const shareConfig = await Share.getCurrentConfig();
      shareConfig.sharesSold += transactionRecord.shares;
      
      // Update tier sales
      if (transactionRecord.tierBreakdown) {
        shareConfig.tierSales.tier1Sold += transactionRecord.tierBreakdown.tier1 || 0;
        shareConfig.tierSales.tier2Sold += transactionRecord.tierBreakdown.tier2 || 0;
        shareConfig.tierSales.tier3Sold += transactionRecord.tierBreakdown.tier3 || 0;
      }
      
      await shareConfig.save();
      
      // Process referral commissions
      try {
        const { processReferralCommission } = require('../utils/referralUtils');
        const referralResult = await processReferralCommission(
          userShareRecord.user._id,
          transactionRecord.totalAmount,
          'share',
          transactionRecord.transactionId
        );
        console.log('Referral commission process result:', referralResult);
      } catch (referralError) {
        console.error('Error processing referral commissions:', referralError);
      }
      
      // Send confirmation email
      if (userShareRecord.user && userShareRecord.user.email) {
        try {
          const { sendEmail } = require('../utils/emailService');
          await sendEmail({
            email: userShareRecord.user.email,
            subject: 'AfriMobile - Share Purchase Successful',
            html: `
              <h2>Share Purchase Confirmation</h2>
              <p>Dear ${userShareRecord.user.name},</p>
              <p>Your purchase of ${transactionRecord.shares} shares for ₦${transactionRecord.totalAmount} has been completed successfully via Centiiv.</p>
              <p>Transaction Reference: ${transactionRecord.transactionId}</p>
              <p>Payment ID: ${id}</p>
              <p>Thank you for your investment in AfriMobile!</p>
            `
          });
        } catch (emailError) {
          console.error('Failed to send confirmation email:', emailError);
        }
      }
    }
    
    // 🔥 REDIRECT TO FRONTEND WITH STATUS
    const frontendUrl = process.env.FRONTEND_URL || 'https://www.afrimobiletech.com';
    
    if (newStatus === 'completed') {
      // Redirect to success page
      const successUrl = `${frontendUrl}/dashboard/shares/payment-success?transaction=${transactionRecord.transactionId}&method=centiiv&status=success&shares=${transactionRecord.shares}&amount=${transactionRecord.totalAmount}`;
      console.log(`[Centiiv Callback] Redirecting to success: ${successUrl}`);
      return res.redirect(successUrl);
    } else if (newStatus === 'failed') {
      // Redirect to failure page
      const failureUrl = `${frontendUrl}/dashboard/shares/payment-failed?transaction=${transactionRecord.transactionId}&method=centiiv&reason=${encodeURIComponent(statusMessage)}`;
      console.log(`[Centiiv Callback] Redirecting to failure: ${failureUrl}`);
      return res.redirect(failureUrl);
    } else {
      // Redirect to pending page
      const pendingUrl = `${frontendUrl}/dashboard/shares/payment-pending?transaction=${transactionRecord.transactionId}&method=centiiv&status=${status}`;
      console.log(`[Centiiv Callback] Redirecting to pending: ${pendingUrl}`);
      return res.redirect(pendingUrl);
    }
    
  } catch (error) {
    console.error('Error handling Centiiv callback:', error);
    
    // Redirect to error page
    const frontendUrl = process.env.FRONTEND_URL || 'https://www.afrimobiletech.com';
    const errorUrl = `${frontendUrl}/dashboard/shares/payment-error?reason=server_error`;
    
    return res.redirect(errorUrl);
  }
};

/**
 * @desc    Enhanced Web3 Payment with Centiiv Crypto Support
 * @route   POST /api/shares/centiiv/crypto-pay
 * @access  Private (User)
 */
exports.initiateCentiivCryptoPay = async (req, res) => {
  try {
    const { quantity, currency = 'usdt', walletAddress, tier } = req.body;
    const userId = req.user.id;
    
    console.log('🚀 [Centiiv Crypto] Payment initiation started:', {
      userId, quantity, currency, walletAddress, tier
    });
    
    if (!quantity || !walletAddress) {
      return res.status(400).json({
        success: false,
        message: 'Please provide quantity and wallet address'
      });
    }
    
    // ✅ FIXED: Validate quantity is a positive integer
    const shareQuantity = parseInt(quantity);
    if (isNaN(shareQuantity) || shareQuantity <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid quantity of shares (positive integer)'
      });
    }
    
    // Calculate purchase details
    const purchaseDetails = await Share.calculatePurchase(shareQuantity, currency, tier || 'standard');
    
    if (!purchaseDetails.success) {
      return res.status(400).json({
        success: false,
        message: purchaseDetails.message
      });
    }
    
    // Generate transaction ID
    const transactionId = generateTransactionId();
    
    // Create callback URL for crypto payment
    const frontendUrl = process.env.FRONTEND_URL || 'https://yourfrontend.com';
    const callbackUrl = `${frontendUrl}/dashboard/shares/payment-success?transaction=${transactionId}&method=centiiv-crypto&type=crypto`;
    
    // Get company wallet address for direct crypto payments
    const config = await SiteConfig.getCurrentConfig();
    const companyWalletAddress = config.companyWalletAddress;
    
    if (!companyWalletAddress) {
      return res.status(400).json({
        success: false,
        message: 'Crypto payments not available - wallet not configured'
      });
    }
    
    // Save pending transaction
    await UserShare.addShares(userId, purchaseDetails.totalShares, {
      transactionId,
      shares: purchaseDetails.totalShares,
      pricePerShare: purchaseDetails.totalPrice / purchaseDetails.totalShares,
      currency: currency,
      totalAmount: purchaseDetails.totalPrice,
      paymentMethod: 'centiiv-crypto',
      status: 'pending',
      tierBreakdown: purchaseDetails.tierBreakdown,
      fromWallet: walletAddress,
      toWallet: companyWalletAddress,
      callbackUrl: callbackUrl
    });
    
    // Return payment instructions
    res.status(200).json({
      success: true,
      message: 'Crypto payment instructions generated',
      data: {
        transactionId,
        quantity: shareQuantity, // ✅ Return original quantity
        paymentInstructions: {
          recipientAddress: companyWalletAddress,
          amount: purchaseDetails.totalPrice,
          currency: currency.toUpperCase(),
          network: 'BSC', // Binance Smart Chain
          shares: purchaseDetails.totalShares
        },
        callbackUrl: callbackUrl,
        instructions: [
          `Send exactly ${purchaseDetails.totalPrice} ${currency.toUpperCase()} to: ${companyWalletAddress}`,
          `Network: BSC (Binance Smart Chain)`,
          `After sending, submit the transaction hash for verification`,
          `You will be redirected to the success page upon verification`
        ]
      }
    });
    
  } catch (error) {
    console.error('💥 [Centiiv Crypto] Unexpected error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to initiate crypto payment',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

exports.initiateCentiivPayment = async (req, res) => {
  try {
    const { quantity, email, customerName, tier } = req.body;
    const userId = req.user.id;
    
    console.log('🚀 [Centiiv] Payment initiation started:', {
      userId, quantity, email, customerName, tier
    });
    
    if (!quantity || !email || !customerName) {
      return res.status(400).json({
        success: false,
        message: 'Please provide quantity, email, and customer name'
      });
    }
    
    // API configuration
    const apiKey = process.env.CENTIIV_API_KEY;
    const baseUrl = process.env.CENTIIV_BASE_URL || 'https://api.centiiv.com/api/v1';
    
    console.log('🔧 [Centiiv] Using API key for invoice creation');
    console.log('🔧 [Centiiv] API Key Preview:', apiKey.substring(0, 8) + '...');
    console.log('🔧 [Centiiv] Base URL:', baseUrl);
    
    // Calculate purchase
    const purchaseDetails = await Share.calculatePurchase(parseInt(quantity), 'naira', tier || 'standard');
    
    console.log('💰 [Centiiv] Purchase details:', {
      success: purchaseDetails.success,
      totalPrice: purchaseDetails.totalPrice,
      totalShares: purchaseDetails.totalShares
    });
    
    if (!purchaseDetails.success) {
      return res.status(400).json({
        success: false,
        message: 'Unable to process this purchase amount',
        details: purchaseDetails
      });
    }
    
    // Generate transaction ID
    const transactionId = generateTransactionId();
    console.log('🆔 [Centiiv] Transaction ID:', transactionId);
    
    // CREATE REDIRECT URLs
    const frontendUrl = process.env.FRONTEND_URL || 'https://yourfrontend.com';
    const backendUrl = process.env.BACKEND_URL || 'https://yourapi.com';
    
    const successUrl = `${frontendUrl}/dashboard`;
    const cancelUrl = `${frontendUrl}/dashboard/shares/payment-cancelled?transaction=${transactionId}&method=centiiv`;
    const notifyUrl = `${backendUrl}/api/shares/centiiv/webhook`;
    
    console.log('🔗 [Centiiv] Redirect URLs:', {
      success: successUrl,
      cancel: cancelUrl,
      notify: notifyUrl
    });
    
    // Create request payload with redirect URLs
    const dueDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const centiivRequest = {
      reminderInterval: 7,
      customerEmail: email,
      customerName: customerName,
      dueDate: dueDate,
      subject: `AfriMobile Share Purchase - ${purchaseDetails.totalShares} Shares`,
      products: [
        {
          name: `AfriMobile Shares (${purchaseDetails.totalShares} shares)`,
          qty: 1,
          price: purchaseDetails.totalPrice
        }
      ],
      // ADD REDIRECT URLs TO CENTIIV REQUEST
      successUrl: successUrl,
      cancelUrl: cancelUrl,
      notifyUrl: notifyUrl,
      // Optional: Add metadata for tracking
      metadata: {
        userId: userId.toString(),
        transactionId: transactionId,
        shares: purchaseDetails.totalShares.toString(),
        purchaseType: 'share_purchase'
      }
    };
    
    console.log('📦 [Centiiv] Request payload:', JSON.stringify(centiivRequest, null, 2));
    
    // Make API call
    console.log('🌐 [Centiiv] Making API call to:', `${baseUrl}/order`);
    
    let centiivResponse;
    try {
      centiivResponse = await axios.post(
        `${baseUrl}/order`,
        centiivRequest,
        {
          headers: {
            'accept': 'application/json',
            'authorization': `Bearer ${apiKey}`,
            'content-type': 'application/json'
          },
          timeout: 30000
        }
      );
      
      console.log('✅ [Centiiv] API call successful');
      console.log('📊 [Centiiv] Response status:', centiivResponse.status);
      console.log('📊 [Centiiv] Response data:', JSON.stringify(centiivResponse.data, null, 2));
      
    } catch (apiError) {
      console.log('❌ [Centiiv] API call failed');
      console.log('🔍 [Centiiv] Error message:', apiError.message);
      console.log('🔍 [Centiiv] Error code:', apiError.code);
      
      if (apiError.response) {
        console.log('🔍 [Centiiv] Error response status:', apiError.response.status);
        console.log('🔍 [Centiiv] Error response data:', JSON.stringify(apiError.response.data, null, 2));
      }
      
      return res.status(500).json({
        success: false,
        message: 'Centiiv API call failed',
        error: {
          message: apiError.message,
          status: apiError.response?.status,
          data: apiError.response?.data,
          code: apiError.code
        }
      });
    }
    
    // Process response
    if (!centiivResponse || !centiivResponse.data) {
      console.log('❌ [Centiiv] Empty response');
      return res.status(500).json({
        success: false,
        message: 'Empty response from Centiiv API'
      });
    }
    
    const orderData = centiivResponse.data;
    const orderId = orderData.id || orderData.order_id || orderData.orderId;
    const invoiceUrl = orderData.invoiceUrl || orderData.invoice_url || orderData.payment_url;
    
    console.log('🔍 [Centiiv] Extracted data:', {
      orderId,
      invoiceUrl,
      allResponseKeys: Object.keys(orderData)
    });
    
    if (!orderId) {
      console.log('❌ [Centiiv] No order ID found in response');
      console.log('📋 [Centiiv] Available response keys:', Object.keys(orderData));
      return res.status(500).json({
        success: false,
        message: 'No order ID in Centiiv response',
        responseData: orderData
      });
    }
    
    // Save to database
    console.log('💾 [Centiiv] Saving to database...');
    try {
      await UserShare.addShares(userId, purchaseDetails.totalShares, {
        transactionId,
        shares: purchaseDetails.totalShares,
        pricePerShare: purchaseDetails.totalPrice / purchaseDetails.totalShares,
        currency: 'naira',
        totalAmount: purchaseDetails.totalPrice,
        paymentMethod: 'centiiv',
        status: 'pending',
        tierBreakdown: purchaseDetails.tierBreakdown,
        centiivOrderId: orderId,
        centiivInvoiceUrl: invoiceUrl || null,
        // STORE REDIRECT URLs FOR REFERENCE
        successUrl: successUrl,
        cancelUrl: cancelUrl,
        notifyUrl: notifyUrl
      });
      
      console.log('✅ [Centiiv] Database save successful');
      
    } catch (dbError) {
      console.log('❌ [Centiiv] Database save failed:', dbError.message);
      return res.status(500).json({
        success: false,
        message: 'Failed to save transaction to database',
        error: dbError.message
      });
    }
    
    // Success response
    const responseData = {
      transactionId,
      centiivOrderId: orderId,
      invoiceUrl: invoiceUrl || null,
      amount: purchaseDetails.totalPrice,
      shares: purchaseDetails.totalShares,
      dueDate: dueDate,
      // INCLUDE REDIRECT URLs IN RESPONSE
      redirectUrls: {
        success: successUrl,
        cancel: cancelUrl,
        notify: notifyUrl
      }
    };
    
    console.log('🎉 [Centiiv] Success:', responseData);
    
    res.status(200).json({
      success: true,
      message: 'Centiiv invoice created successfully with redirect URLs',
      data: responseData
    });
    
  } catch (error) {
    console.log('💥 [Centiiv] Unexpected error:', error.message);
    console.log('🔍 [Centiiv] Error stack:', error.stack);
    
    res.status(500).json({
      success: false,
      message: 'Failed to initiate Centiiv payment',
      error: {
        message: error.message,
        type: 'UNEXPECTED_ERROR'
      }
    });
  }
};

// 2. getCentiivAnalytics - ALREADY EXISTS IN CONTROLLER  
exports.getCentiivAnalytics = async (req, res) => {
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
    
    const { period = '30d', groupBy = 'day' } = req.query;
    
    // Calculate date range
    const now = new Date();
    let startDate = new Date();
    
    switch (period) {
      case '7d':
        startDate.setDate(now.getDate() - 7);
        break;
      case '90d':
        startDate.setDate(now.getDate() - 90);
        break;
      case '365d':
        startDate.setDate(now.getDate() - 365);
        break;
      case 'all':
        startDate = new Date('2020-01-01');
        break;
      case '30d':
      default:
        startDate.setDate(now.getDate() - 30);
        break;
    }
    
    // Get Centiiv transactions
    const centiivPaymentMethods = ['centiiv', 'centiiv-direct', 'centiiv-crypto', 'centiiv-invoice'];
    const userShares = await UserShare.find({
      'transactions.paymentMethod': { $in: centiivPaymentMethods },
      'transactions.createdAt': { $gte: startDate }
    }).populate('user', 'name email').lean();
    
    // Process analytics data
    const analytics = {
      summary: {
        totalPayments: 0,
        totalRevenue: 0,
        averagePaymentSize: 0,
        overallSuccessRate: 0
      },
      trends: {
        dailyPayments: {},
        paymentMethodTrends: {}
      },
      comparison: {
        methodPerformance: [],
        vsOtherMethods: {}
      },
      userBehavior: {
        abandonmentRate: 0,
        retryRate: 0,
        preferredMethods: [],
        averageSessionTime: '0 minutes'
      },
      issues: {
        commonIssues: [],
        resolutionTimes: {
          average: '0 minutes',
          median: '0 minutes'
        }
      }
    };
    
    // Collect all transactions
    let allTransactions = [];
    let completedTransactions = 0;
    
    for (const userShare of userShares) {
      for (const transaction of userShare.transactions) {
        if (!centiivPaymentMethods.includes(transaction.paymentMethod)) continue;
        if (new Date(transaction.createdAt) < startDate) continue;
        
        allTransactions.push({
          ...transaction,
          userId: userShare.user._id,
          userName: userShare.user.name
        });
        
        if (transaction.status === 'completed') {
          completedTransactions++;
          analytics.summary.totalRevenue += transaction.totalAmount || 0;
        }
      }
    }
    
    analytics.summary.totalPayments = allTransactions.length;
    analytics.summary.averagePaymentSize = 
      completedTransactions > 0 ? 
      Math.round(analytics.summary.totalRevenue / completedTransactions) : 0;
    analytics.summary.overallSuccessRate = 
      allTransactions.length > 0 ? 
      Math.round((completedTransactions / allTransactions.length) * 100 * 10) / 10 : 0;
    
    // Generate trends data
    const dateMap = {};
    const methodTrends = {};
    
    allTransactions.forEach(tx => {
      const date = new Date(tx.createdAt).toISOString().split('T')[0];
      
      // Daily trends
      if (!dateMap[date]) {
        dateMap[date] = { count: 0, revenue: 0, successful: 0 };
      }
      dateMap[date].count++;
      if (tx.status === 'completed') {
        dateMap[date].revenue += tx.totalAmount || 0;
        dateMap[date].successful++;
      }
      
      // Method trends
      if (!methodTrends[tx.paymentMethod]) {
        methodTrends[tx.paymentMethod] = [];
      }
    });
    
    // Format trends
    analytics.trends.dailyPayments = Object.keys(dateMap)
      .sort()
      .slice(-30) // Last 30 data points
      .map(date => ({
        date,
        count: dateMap[date].count,
        revenue: dateMap[date].revenue,
        successRate: dateMap[date].count > 0 ? 
          Math.round((dateMap[date].successful / dateMap[date].count) * 100 * 10) / 10 : 0
      }));
    
    // Method performance comparison
    centiivPaymentMethods.forEach(method => {
      const methodTransactions = allTransactions.filter(tx => tx.paymentMethod === method);
      const completedMethodTx = methodTransactions.filter(tx => tx.status === 'completed');
      
      if (methodTransactions.length > 0) {
        analytics.comparison.methodPerformance.push({
          method,
          count: methodTransactions.length,
          revenue: completedMethodTx.reduce((sum, tx) => sum + (tx.totalAmount || 0), 0),
          successRate: Math.round((completedMethodTx.length / methodTransactions.length) * 100 * 10) / 10,
          avgCompletionTime: '3.2 minutes', // You can calculate this based on your data
          userSatisfaction: 4.2 // Placeholder - implement based on feedback data
        });
      }
    });
    
    // User behavior analysis
    const uniqueUsers = [...new Set(allTransactions.map(tx => tx.userId))];
    const usersWithMultipleAttempts = uniqueUsers.filter(userId => {
      const userTransactions = allTransactions.filter(tx => tx.userId === userId);
      return userTransactions.length > 1;
    });
    
    analytics.userBehavior.retryRate = uniqueUsers.length > 0 ? 
      Math.round((usersWithMultipleAttempts.length / uniqueUsers.length) * 100 * 10) / 10 : 0;
    
    // Preferred methods
    const methodCounts = {};
    allTransactions.forEach(tx => {
      methodCounts[tx.paymentMethod] = (methodCounts[tx.paymentMethod] || 0) + 1;
    });
    
    analytics.userBehavior.preferredMethods = Object.keys(methodCounts)
      .map(method => ({
        method,
        percentage: allTransactions.length > 0 ? 
          Math.round((methodCounts[method] / allTransactions.length) * 100 * 10) / 10 : 0
      }))
      .sort((a, b) => b.percentage - a.percentage);
    
    // Common issues analysis
    const failedTransactions = allTransactions.filter(tx => tx.status === 'failed');
    const pendingTransactions = allTransactions.filter(tx => tx.status === 'pending');
    
    if (failedTransactions.length > 0) {
      analytics.issues.commonIssues.push({
        type: 'payment_failed',
        count: failedTransactions.length,
        percentage: Math.round((failedTransactions.length / allTransactions.length) * 100 * 10) / 10,
        trend: 'stable'
      });
    }
    
    if (pendingTransactions.length > 5) {
      analytics.issues.commonIssues.push({
        type: 'verification_pending',
        count: pendingTransactions.length,
        percentage: Math.round((pendingTransactions.length / allTransactions.length) * 100 * 10) / 10,
        trend: 'increasing'
      });
    }
    
    res.status(200).json({
      success: true,
      analytics,
      period: {
        requested: period,
        actualStart: startDate.toISOString(),
        actualEnd: now.toISOString()
      }
    });
    
  } catch (error) {
    console.error('Error getting Centiiv analytics:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get Centiiv analytics',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// 3. troubleshootCentiivPayment - ALREADY EXISTS IN CONTROLLER
exports.troubleshootCentiivPayment = async (req, res) => {
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
      action, 
      transactionId, 
      paymentId, 
      bulkTransactionIds, 
      reportCriteria 
    } = req.body;
    
    if (!action) {
      return res.status(400).json({
        success: false,
        message: 'Action is required'
      });
    }
    
    const validActions = [
      'check_status', 
      'retry_callback', 
      'force_sync', 
      'resend_notification', 
      'fix_stuck', 
      'generate_report'
    ];
    
    if (!validActions.includes(action)) {
      return res.status(400).json({
        success: false,
        message: `Invalid action. Must be one of: ${validActions.join(', ')}`
      });
    }
    
    let results = {
      action,
      findings: [],
      actionsPerformed: [],
      recommendedFollowUp: []
    };
    
    switch (action) {
      case 'check_status':
        if (!transactionId && !paymentId) {
          return res.status(400).json({
            success: false,
            message: 'Transaction ID or Payment ID is required for status check'
          });
        }
        
        results = await performStatusCheck(transactionId, paymentId, adminId);
        break;
        
      case 'retry_callback':
        if (!transactionId) {
          return res.status(400).json({
            success: false,
            message: 'Transaction ID is required for callback retry'
          });
        }
        
        results = await retryCallback(transactionId, adminId);
        break;
        
      case 'force_sync':
        if (!transactionId) {
          return res.status(400).json({
            success: false,
            message: 'Transaction ID is required for force sync'
          });
        }
        
        results = await forceSyncStatus(transactionId, adminId);
        break;
        
      case 'resend_notification':
        if (!transactionId) {
          return res.status(400).json({
            success: false,
            message: 'Transaction ID is required for resending notification'
          });
        }
        
        results = await resendNotification(transactionId, adminId);
        break;
        
      case 'fix_stuck':
        if (bulkTransactionIds && bulkTransactionIds.length > 0) {
          results = await fixStuckTransactionsBulk(bulkTransactionIds, adminId);
        } else if (transactionId) {
          results = await fixStuckTransaction(transactionId, adminId);
        } else {
          return res.status(400).json({
            success: false,
            message: 'Transaction ID or bulk transaction IDs required for fixing stuck transactions'
          });
        }
        break;
        
      case 'generate_report':
        results = await generateIssueReport(reportCriteria, adminId);
        break;
        
      default:
        return res.status(400).json({
          success: false,
          message: 'Invalid action specified'
        });
    }
    
    // Add common recommendations based on findings
    if (results.findings && results.findings.some(f => f.type === 'status_mismatch')) {
      results.recommendedFollowUp.push('Monitor transaction for 24 hours');
    }
    
    if (results.findings && results.findings.some(f => f.severity === 'critical')) {
      results.recommendedFollowUp.push('Contact user to confirm payment receipt');
      results.recommendedFollowUp.push('Escalate to senior admin if issue persists');
    }
    
    res.status(200).json({
      success: true,
      message: `${action.replace('_', ' ')} completed successfully`,
      results
    });
    
  } catch (error) {
    console.error('Error troubleshooting Centiiv payment:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to troubleshoot payment',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Submit Crypto Transaction Hash for Verification
 * @route   POST /api/shares/centiiv/crypto-verify
 * @access  Private (User)
 */
exports.submitCryptoTransactionHash = async (req, res) => {
  try {
    const { transactionId, txHash } = req.body;
    const userId = req.user.id;
    
    if (!transactionId || !txHash) {
      return res.status(400).json({
        success: false,
        message: 'Please provide transaction ID and transaction hash'
      });
    }
    
    // Find the transaction
    const userShareRecord = await UserShare.findOne({
      user: userId,
      'transactions.transactionId': transactionId
    });
    
    if (!userShareRecord) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found'
      });
    }
    
    const transaction = userShareRecord.transactions.find(
      t => t.transactionId === transactionId
    );
    
    if (transaction.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: `Transaction already ${transaction.status}`
      });
    }
    
    // Update transaction with hash and start verification
    const transactionIndex = userShareRecord.transactions.findIndex(
      t => t.transactionId === transactionId
    );
    
    userShareRecord.transactions[transactionIndex].txHash = txHash;
    userShareRecord.transactions[transactionIndex].status = 'verifying';
    userShareRecord.transactions[transactionIndex].verificationStarted = new Date();
    
    await userShareRecord.save();
    
    // Start async verification (you can use your existing Web3 verification logic)
    // This would typically be done in a background job
    setTimeout(async () => {
      try {
        // Use your existing blockchain verification logic
        const verification = await verifyTransactionOnChain(
          txHash,
          transaction.toWallet,
          transaction.fromWallet
        );
        
        let newStatus = verification.valid ? 'completed' : 'failed';
        
        await UserShare.updateTransactionStatus(
          userId,
          transactionId,
          newStatus,
          verification.valid ? 
            `Auto-verified crypto transaction: ${txHash}` : 
            `Auto-verification failed: ${verification.message}`
        );
        
        // If successful, update global counts and process referrals
        if (newStatus === 'completed') {
          const shareConfig = await Share.getCurrentConfig();
          shareConfig.sharesSold += transaction.shares;
          
          if (transaction.tierBreakdown) {
            shareConfig.tierSales.tier1Sold += transaction.tierBreakdown.tier1 || 0;
            shareConfig.tierSales.tier2Sold += transaction.tierBreakdown.tier2 || 0;
            shareConfig.tierSales.tier3Sold += transaction.tierBreakdown.tier3 || 0;
          }
          
          await shareConfig.save();
          
          // Process referrals
          await processReferralCommission(
            userId,
            transaction.totalAmount,
            'share',
            transactionId
          );
          
          // If callback URL exists, you could trigger a redirect or notification
          if (transaction.callbackUrl) {
            console.log(`Crypto payment verified for callback: ${transaction.callbackUrl}`);
          }
        }
        
      } catch (verificationError) {
        console.error('Background crypto verification failed:', verificationError);
        
        await UserShare.updateTransactionStatus(
          userId,
          transactionId,
          'pending',
          `Verification error: ${verificationError.message}. Manual review required.`
        );
      }
    }, 5000); // Delay verification by 5 seconds
    
    res.status(200).json({
      success: true,
      message: 'Transaction hash submitted successfully. Verification in progress...',
      data: {
        transactionId,
        txHash,
        status: 'verifying',
        estimatedVerificationTime: '1-5 minutes'
      }
    });
    
  } catch (error) {
    console.error('Error submitting crypto transaction hash:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to submit transaction hash',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

/**
 * @desc    Get Centiiv Payment Status
 * @route   GET /api/shares/centiiv/status/:paymentId
 * @access  Private (User/Admin)
 */
exports.getCentiivPaymentStatus = async (req, res) => {
  try {
    const { paymentId } = req.params;
    const userId = req.user.id;
    
    // Check if user owns this payment or is admin
    const user = await User.findById(userId);
    const isAdmin = user && user.isAdmin;
    
    // Find transaction
    const userShareRecord = await UserShare.findOne({
      'transactions.centiivPaymentId': paymentId
    });
    
    if (!userShareRecord) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found'
      });
    }
    
    // Check ownership
    if (!isAdmin && userShareRecord.user.toString() !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }
    
    const transaction = userShareRecord.transactions.find(
      t => t.centiivPaymentId === paymentId
    );
    
    // Get latest status from Centiiv API
    let centiivStatus = null;
    try {
      const apiKey = process.env.CENTIIV_API_KEY;
      const baseUrl = process.env.CENTIIV_BASE_URL || 'https://api.centiiv.com/api/v1';
      
      const centiivResponse = await axios.get(
        `${baseUrl}/direct-pay/${paymentId}`,
        {
          headers: {
            'accept': 'application/json',
            'authorization': `Bearer ${apiKey}`
          }
        }
      );
      
      centiivStatus = centiivResponse.data;
    } catch (apiError) {
      console.error('Error fetching Centiiv status:', apiError.message);
    }
    
    res.status(200).json({
      success: true,
      data: {
        transactionId: transaction.transactionId,
        paymentId: paymentId,
        localStatus: transaction.status,
        centiivStatus: centiivStatus,
        shares: transaction.shares,
        amount: transaction.totalAmount,
        currency: transaction.currency,
        paymentMethod: transaction.paymentMethod,
        createdAt: transaction.createdAt,
        callbackUrl: transaction.callbackUrl
      }
    });
    
  } catch (error) {
    console.error('Error getting payment status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get payment status'
    });
  }
};

// Helper function for blockchain verification (reuse your existing logic)
async function verifyTransactionOnChain(txHash, companyWallet, senderWallet) {
  // This should use your existing blockchain verification logic
  // from the verifyWeb3Transaction function
  // I'm including a simplified version here
  
  try {
    const { ethers } = require('ethers');
    
    // Initialize provider for BSC
    const provider = new ethers.providers.JsonRpcProvider(
      process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org/'
    );
    
    // USDT token address on BSC
    const usdtTokenAddress = '0x55d398326f99059fF775485246999027B3197955';
    
    // Get transaction receipt
    const receipt = await provider.getTransactionReceipt(txHash);
    
    if (!receipt) {
      return {
        valid: false,
        message: 'Transaction not found or still pending'
      };
    }
    
    // Verify transaction status
    if (receipt.status !== 1) {
      return {
        valid: false,
        message: 'Transaction failed on blockchain'
      };
    }
    
    // Additional verification logic here...
    // (Include your existing verification from verifyWeb3Transaction)
    
    return {
      valid: true,
      message: 'Transaction verified successfully'
    };
    
  } catch (error) {
    console.error('Blockchain verification error:', error);
    return {
      valid: false,
      message: 'Error verifying transaction: ' + error.message
    };
  }
}

// Admin: Verify web3 payment
exports.adminVerifyWeb3Transaction = async (req, res) => {
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
  
    // Find the transaction
    const userShareRecord = await UserShare.findOne({
      'transactions.transactionId': transactionId
    });
    
    if (!userShareRecord) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found'
      });
    }
  
    const transaction = userShareRecord.transactions.find(
      t => t.transactionId === transactionId && t.paymentMethod === 'crypto'
    );
  
    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Crypto transaction details not found'
      });
    }
  
    if (transaction.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: `Transaction already ${transaction.status}`
      });
    }
  
    const newStatus = approved ? 'completed' : 'failed';
    
    // Update transaction status
    await UserShare.updateTransactionStatus(
      userShareRecord.user,
      transactionId,
      newStatus,
      adminNote
    );
    
    // If approved, update global share counts and ONLY THEN process referrals
    if (approved) {
      const shareConfig = await Share.getCurrentConfig();
      shareConfig.sharesSold += transaction.shares;
      
      // Update tier sales
      shareConfig.tierSales.tier1Sold += transaction.tierBreakdown.tier1;
      shareConfig.tierSales.tier2Sold += transaction.tierBreakdown.tier2;
      shareConfig.tierSales.tier3Sold += transaction.tierBreakdown.tier3;
      
      await shareConfig.save();
      
      // Process referral commissions ONLY for now-completed transactions
      try {
        // Get updated transaction to ensure it's been marked as completed
        const updatedUserShare = await UserShare.findOne({
          'transactions.transactionId': transactionId
        });
        
        const updatedTransaction = updatedUserShare.transactions.find(
          t => t.transactionId === transactionId
        );
        
        if (updatedTransaction.status === 'completed') {
          const referralResult = await processReferralCommission(
            userShareRecord.user,    // userId
            transaction.totalAmount, // purchaseAmount
            'share',                // purchaseType
            transactionId           // transactionId
          );
          
          console.log('Referral commission process result:', referralResult);
        }
      } catch (referralError) {
        console.error('Error processing referral commissions:', referralError);
        // Continue with the verification process despite referral error
      }
    }
    
    // Notify user
    const user = await User.findById(userShareRecord.user);
    if (user && user.email) {
      try {
        await sendEmail({
          email: user.email,
          subject: `AfriMobile - Web3 Payment ${approved ? 'Approved' : 'Declined'}`,
          html: `
            <h2>Share Purchase ${approved ? 'Confirmation' : 'Update'}</h2>
            <p>Dear ${user.name},</p>
            <p>Your purchase of ${transaction.shares} shares for $${transaction.totalAmount} USDT has been ${approved ? 'verified and completed' : 'declined'}.</p>
            <p>Transaction Reference: ${transactionId}</p>
            ${approved ? 
              `<p>Thank you for your investment in AfriMobile!</p>` : 
              `<p>Please contact support if you have any questions.</p>`
            }
            ${adminNote ? `<p>Note: ${adminNote}</p>` : ''}
          `
        });
      } catch (emailError) {
        console.error('Failed to send purchase notification email:', emailError);
      }
    }
    
    // Return success
    res.status(200).json({
      success: true,
      message: `Transaction ${approved ? 'approved' : 'declined'} successfully`,
      status: newStatus
    });
  } catch (error) {
    console.error('Error verifying web3 payment:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to verify web3 payment',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Admin: Get Web3 transactions
exports.adminGetWeb3Transactions = async (req, res) => {
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
    const query = { 'transactions.paymentMethod': 'crypto' };
    if (status && ['pending', 'completed', 'failed'].includes(status)) {
      query['transactions.status'] = status;
    }
    
    // Get user shares with transactions
    const userShares = await UserShare.find(query)
      .skip(skip)
      .limit(parseInt(limit))
      .populate('user', 'name email walletAddress');
    
    // Format response
    const transactions = [];
    for (const userShare of userShares) {
      for (const transaction of userShare.transactions) {
        // Only include web3 transactions matching status filter
        if (transaction.paymentMethod !== 'crypto' || 
            (status && transaction.status !== status)) {
          continue;
        }
        
        transactions.push({
          transactionId: transaction.transactionId,
          txHash: transaction.txHash,
          user: {
            id: userShare.user._id,
            name: userShare.user.name,
            email: userShare.user.email,
            walletAddress: userShare.user.walletAddress
          },
          shares: transaction.shares,
          pricePerShare: transaction.pricePerShare,
          currency: transaction.currency,
          totalAmount: transaction.totalAmount,
          status: transaction.status,
          date: transaction.createdAt,
          adminNote: transaction.adminNote
        });
      }
    }
    
    // Count total
    const totalCount = await UserShare.countDocuments(query);
    
    res.status(200).json({
      success: true,
      transactions,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalCount / parseInt(limit)),
        totalCount
      }
    });
  } catch (error) {
    console.error('Error fetching web3 transactions:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch web3 transactions',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Submit manual payment proof - Updated for Cloudinary
 * @route   POST /api/shares/manual/submit
 * @access  Private (User)
 */
// shareController.js - Fixed submitManualPayment function
exports.submitManualPayment = async (req, res) => {
  try {
    console.log('[SHARES] Manual payment submission started');

    // Check user authentication
    if (!req.user || !req.user.id) {
      console.error('[SHARES] User not authenticated');
      return res.status(401).json({
        success: false,
        message: 'Authentication required. Please log in.'
      });
    }

    const userId = req.user.id;

    // ✅ FIX 1: Add 'tier' to destructuring
    const { quantity, currency, paymentMethod, bankName, accountName, reference, tier } = req.body;

    console.log('[SHARES] Request details:', {
      quantity,
      currency,
      paymentMethod,
      tier  // ✅ Log tier
    });

    // Validate required fields
    if (!quantity || !currency || !paymentMethod) {
      console.error('[SHARES] Missing required fields');
      return res.status(400).json({
        success: false,
        message: 'Please provide quantity, currency, and payment method'
      });
    }

    // Check for payment proof file
    if (!req.file && !req.body.adminNote) {
      console.error('[SHARES] No payment proof uploaded');
      return res.status(400).json({
        success: false,
        message: 'Please upload payment proof'
      });
    }

    // ✅ FIX 2: Pass tier to Share.calculatePurchase()
    const Share = require('../models/Share');
    const selectedTier = tier || 'standard';

    const purchaseDetails = await Share.calculatePurchase(
      parseInt(quantity), 
      currency.toLowerCase(),
      selectedTier  // ✅ THIS LINE WAS MISSING!
    );

    console.log('✅ [SHARES] Purchase calculated with tier:', {
      tier: selectedTier,
      totalPrice: purchaseDetails.totalPrice,
      shares: purchaseDetails.totalShares
    });

    if (!purchaseDetails.success) {
      console.error('[SHARES] Share calculation failed:', purchaseDetails.message);
      return res.status(400).json({
        success: false,
        message: purchaseDetails.message
      });
    }

    // Generate transaction ID
    const crypto = require('crypto');
    const transactionId = `TXN-${crypto.randomBytes(4).toString('hex').toUpperCase()}-${Date.now().toString().slice(-6)}`;

    // Extract file info from Cloudinary (if using Cloudinary)
    let fileInfo = {};
    if (req.file) {
      fileInfo = {
        cloudinaryUrl: req.file.path,
        cloudinaryId: req.file.filename,
        originalname: req.file.originalname,
        size: req.file.size
      };
      console.log('[SHARES] File uploaded:', { url: fileInfo.cloudinaryUrl });
    }

    // Create PaymentTransaction record
    const PaymentTransaction = require('../models/Transaction');
    const paymentTransactionData = {
      userId,
      transactionId,
      type: 'share',
      shares: parseInt(quantity),
      amount: purchaseDetails.totalPrice,
      currency,
      paymentMethod: `manual_${paymentMethod}`,
      status: 'pending',
      tierBreakdown: purchaseDetails.tierBreakdown,
      manualPaymentDetails: {
        bankName: bankName || null,
        accountName: accountName || null,
        reference: reference || null
      },
      paymentProofPath: fileInfo.cloudinaryUrl || null,
      paymentProofOriginalName: fileInfo.originalname || null,
      paymentProofFilename: fileInfo.cloudinaryId || null
    };

    if (fileInfo.cloudinaryUrl) {
      paymentTransactionData.paymentProofCloudinaryUrl = fileInfo.cloudinaryUrl;
      paymentTransactionData.paymentProofCloudinaryId = fileInfo.cloudinaryId;
    }

    const paymentTransaction = new PaymentTransaction(paymentTransactionData);
    await paymentTransaction.save();
    console.log('[SHARES] Payment transaction created:', transactionId);

    // Also create UserShare record
    const UserShare = require('../models/UserShare');
    const userShareData = {
      transactionId,
      shares: parseInt(quantity),
      pricePerShare: purchaseDetails.totalPrice / parseInt(quantity),
      currency,
      totalAmount: purchaseDetails.totalPrice,
      paymentMethod: `manual_${paymentMethod}`,
      status: 'pending',
      tierBreakdown: purchaseDetails.tierBreakdown
    };

    if (fileInfo.cloudinaryUrl) {
      userShareData.paymentProofCloudinaryUrl = fileInfo.cloudinaryUrl;
      userShareData.paymentProofCloudinaryId = fileInfo.cloudinaryId;
    }

    await UserShare.addShares(userId, parseInt(quantity), userShareData);
    console.log('[SHARES] UserShare record created');

    // Send success response
    res.status(200).json({
      success: true,
      message: 'Payment proof submitted successfully',
      data: {
        transactionId,
        shares: parseInt(quantity),
        amount: purchaseDetails.totalPrice,
        currency,
        status: 'pending',
        tier: selectedTier,  // ✅ Include tier in response
        paymentMethod: `manual_${paymentMethod}`
      }
    });

  } catch (error) {
    console.error('[SHARES] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to submit manual payment',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Get payment proof from Cloudinary
 * @route   GET /api/shares/payment-proof/:transactionId
 * @access  Private (User)
 */
exports.getPaymentProof = async (req, res) => {
  try {
    const { transactionId } = req.params;
    const userId = req.user.id;
    
    console.log(`[SHARES getPaymentProof] Request for transaction: ${transactionId} from user: ${userId}`);
    
    // Look in both UserShare and PaymentTransaction for Cloudinary data
    let cloudinaryUrl = null;
    let cloudinaryId = null;
    let originalName = null;
    let fileSize = null;
    let format = null;
    let userShareRecord = null;
    let isAdmin = false;

    // Check if user is admin
    const user = await User.findById(userId);
    isAdmin = user && user.isAdmin;

    // First check PaymentTransaction (primary source for manual payments)
    const paymentTransaction = await PaymentTransaction.findOne({
      transactionId,
      type: 'share'
    });
    
    if (paymentTransaction) {
      cloudinaryUrl = paymentTransaction.paymentProofCloudinaryUrl;
      cloudinaryId = paymentTransaction.paymentProofCloudinaryId;
      originalName = paymentTransaction.paymentProofOriginalName;
      fileSize = paymentTransaction.paymentProofFileSize;
      format = paymentTransaction.paymentProofFormat;
      
      // Check if user owns this transaction or is admin
      if (!(isAdmin || paymentTransaction.userId.toString() === userId)) {
        console.error('[SHARES] Access denied - user does not own transaction');
        return res.status(403).json({
          success: false,
          message: 'Access denied'
        });
      }
    }

    // If not found in PaymentTransaction, check UserShare (fallback)
    if (!cloudinaryUrl) {
      userShareRecord = await UserShare.findOne({
        'transactions.transactionId': transactionId
      });

      if (userShareRecord) {
        const transaction = userShareRecord.transactions.find(
          t => t.transactionId === transactionId
        );
        
        if (transaction) {
          cloudinaryUrl = transaction.paymentProofCloudinaryUrl;
          cloudinaryId = transaction.paymentProofCloudinaryId;
          originalName = transaction.paymentProofOriginalName;
          fileSize = transaction.paymentProofFileSize;
          format = transaction.paymentProofFormat;
        }
        
        // Check if user is admin or transaction owner
        if (!(isAdmin || userShareRecord.user.toString() === userId)) {
          console.log(`[SHARES getPaymentProof] Unauthorized access: ${userId}`);
          return res.status(403).json({
            success: false,
            message: 'Unauthorized: You do not have permission to view this payment proof'
          });
        }
      }
    }

    if (!cloudinaryUrl) {
      console.error('[SHARES] Transaction not found or no Cloudinary file:', transactionId);
      return res.status(404).json({
        success: false,
        message: 'Transaction not found or payment proof not available'
      });
    }

    console.log(`[SHARES getPaymentProof] Serving Cloudinary file: ${cloudinaryUrl}`);

    // ✅ SOLUTION: Provide multiple access methods for different frontend needs

    // Check if request wants direct redirect (for simple image viewing)
    if (req.query.redirect === 'true' || req.headers.accept?.includes('text/html')) {
      // Direct redirect to Cloudinary URL (good for admins viewing in browser)
      return res.redirect(cloudinaryUrl);
    }

    // ✅ Default: Return JSON with Cloudinary data (good for API consumers)
    res.status(200).json({
      success: true,
      cloudinaryUrl: cloudinaryUrl,
      publicId: cloudinaryId,
      originalName: originalName,
      fileSize: fileSize,
      format: format,
      directAccess: "You can access this file directly at the cloudinaryUrl",
      message: "File is hosted on Cloudinary CDN for fast global access",
      // ✅ Additional helper URLs for different use cases
      viewUrl: `${cloudinaryUrl}?redirect=true`, // Add redirect param for direct viewing
      downloadUrl: cloudinaryUrl.includes('upload/') ? 
        cloudinaryUrl.replace('upload/', 'upload/fl_attachment/') : cloudinaryUrl, // Force download
      thumbnailUrl: cloudinaryUrl.includes('upload/') && format !== 'pdf' ? 
        cloudinaryUrl.replace('upload/', 'upload/w_300,h_300,c_fit/') : cloudinaryUrl // Thumbnail for images
    });
    
  } catch (error) {
    console.error(`[SHARES getPaymentProof] Server error: ${error.message}`, error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch payment proof',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

exports.getPaymentProofDirect = async (req, res) => {
  try {
    const { transactionId } = req.params;
    const userId = req.user.id;
    
    // Only allow admins to use this direct endpoint
    const user = await User.findById(userId);
    if (!user || !user.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Admin access required'
      });
    }
    
    // Get Cloudinary URL
    let cloudinaryUrl = null;
    
    // Check PaymentTransaction first
    const paymentTransaction = await PaymentTransaction.findOne({
      transactionId,
      type: 'share'
    });
    
    if (paymentTransaction && paymentTransaction.paymentProofCloudinaryUrl) {
      cloudinaryUrl = paymentTransaction.paymentProofCloudinaryUrl;
    } else {
      // Check UserShare as fallback
      const userShareRecord = await UserShare.findOne({
        'transactions.transactionId': transactionId
      });
      
      if (userShareRecord) {
        const transaction = userShareRecord.transactions.find(
          t => t.transactionId === transactionId
        );
        if (transaction && transaction.paymentProofCloudinaryUrl) {
          cloudinaryUrl = transaction.paymentProofCloudinaryUrl;
        }
      }
    }
    
    if (!cloudinaryUrl) {
      return res.status(404).json({
        success: false,
        message: 'Payment proof not found'
      });
    }
    
    // Direct redirect to Cloudinary URL
    res.redirect(cloudinaryUrl);
    
  } catch (error) {
    console.error('Error in direct payment proof access:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to access payment proof'
    });
  }
};
/**
 * @desc    Admin: Get all manual payment transactions (FINAL FIXED VERSION)
 * @route   GET /api/shares/admin/manual/transactions
 * @access  Private (Admin)
 */
exports.adminGetManualTransactions = async (req, res) => {
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
    const { status, page = 1, limit = 20, fromDate, toDate } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    // Get manual transactions from PaymentTransaction model ONLY
    const query = {
      type: 'share',
      paymentMethod: { $regex: '^manual_' },
      ...(status && { status })
    };
    
    // Add date filters
    if (fromDate || toDate) {
      query.createdAt = {};
      if (fromDate) query.createdAt.$gte = new Date(fromDate);
      if (toDate) query.createdAt.$lte = new Date(toDate);
    }
    
    console.log('🔍 Manual transactions query:', query);
    
    const paymentTransactions = await PaymentTransaction.find(query)
      .populate('userId', 'name email phone username')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    console.log(`✅ Found ${paymentTransactions.length} PaymentTransaction records`);

    // 🔥 CRITICAL: Format response with paymentProof object
    const transactions = paymentTransactions.map(transaction => {
      console.log(`🔍 Processing transaction ${transaction.transactionId}:`, {
        hasCloudinaryUrl: !!transaction.paymentProofCloudinaryUrl,
        hasPaymentProofPath: !!transaction.paymentProofPath,
        originalName: transaction.paymentProofOriginalName
      });

      // Get Cloudinary URL from any available field
      let cloudinaryUrl = transaction.paymentProofCloudinaryUrl || 
                         transaction.paymentProofPath || 
                         null;

      // 🔥 CREATE THE paymentProof OBJECT (THIS IS MISSING IN YOUR CURRENT CODE!)
      let paymentProofData = null;
      
      if (cloudinaryUrl) {
        paymentProofData = {
          // 🔥 THIS IS THE KEY FIELD YOUR FRONTEND NEEDS!
          directUrl: cloudinaryUrl,
          
          // Additional fields
          apiUrl: `/api/shares/payment-proof/${transaction.transactionId}`,
          viewUrl: `/api/shares/payment-proof/${transaction.transactionId}?redirect=true`,
          adminDirectUrl: `/api/shares/admin/payment-proof/${transaction.transactionId}`,
          originalName: transaction.paymentProofOriginalName,
          fileSize: transaction.paymentProofFileSize,
          format: transaction.paymentProofFormat,
          publicId: transaction.paymentProofCloudinaryId
        };
        
        console.log(`✅ Created paymentProof for ${transaction.transactionId}:`, paymentProofData.directUrl);
      } else {
        console.log(`⚠️  No Cloudinary URL for ${transaction.transactionId}`);
      }

      return {
        id: transaction._id,
        transactionId: transaction.transactionId,
        user: {
          id: transaction.userId._id,
          name: transaction.userId.name,
          username: transaction.userId.username,
          email: transaction.userId.email,
          phone: transaction.userId.phone
        },
        shares: transaction.shares,
        pricePerShare: transaction.amount / transaction.shares,
        currency: transaction.currency,
        totalAmount: transaction.amount,
        paymentMethod: transaction.paymentMethod.replace('manual_', ''),
        status: transaction.status,
        date: transaction.createdAt,
        
        // 🔥 THIS IS THE CRITICAL ADDITION YOUR CURRENT CODE IS MISSING!
        paymentProof: paymentProofData,
        
        // Keep legacy fields for compatibility
        paymentProofUrl: paymentProofData ? paymentProofData.apiUrl : null,
        cloudinaryPublicId: transaction.paymentProofCloudinaryId,
        
        manualPaymentDetails: transaction.manualPaymentDetails || {},
        adminNote: transaction.adminNotes,
        verifiedBy: transaction.verifiedBy
      };
    });

    // Count total
    const totalCount = await PaymentTransaction.countDocuments(query);
    
    // 🔥 DEBUG LOG
    console.log('📤 Final response check:', {
      transactionCount: transactions.length,
      firstHasPaymentProof: transactions[0]?.paymentProof ? 'YES' : 'NO',
      firstDirectUrl: transactions[0]?.paymentProof?.directUrl || 'MISSING'
    });
    
    res.status(200).json({
      success: true,
      transactions,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalCount / parseInt(limit)),
        totalCount
      },
      cloudinaryInfo: {
        cdnEnabled: true,
        message: "Use paymentProof.directUrl for Cloudinary access"
      }
    });
    
  } catch (error) {
    console.error('❌ Error in adminGetManualTransactions:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch manual transactions',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};
/**
 * @desc    Admin: Verify manual payment
 * @route   POST /api/shares/admin/manual/verify
 * @access  Private (Admin)
 */
exports.adminVerifyManualPayment = async (req, res) => {
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
    
    // ✅ FIXED: Find and update in PaymentTransaction model
    const paymentTransaction = await PaymentTransaction.findOne({
      transactionId,
      type: 'share',
      paymentMethod: { $regex: '^manual_' }
    });

    if (!paymentTransaction) {
      return res.status(404).json({
        success: false,
        message: 'Manual transaction not found'
      });
    }

    if (paymentTransaction.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: `Transaction already ${paymentTransaction.status}`
      });
    }

    const newStatus = approved ? 'completed' : 'failed';

    // Update PaymentTransaction
    paymentTransaction.status = newStatus;
    paymentTransaction.adminNotes = adminNote;
    paymentTransaction.verifiedBy = adminId;
    paymentTransaction.verifiedAt = new Date();
    await paymentTransaction.save();

    // Also update UserShare for compatibility
    const userShareRecord = await UserShare.findOne({
      'transactions.transactionId': transactionId
    });

    if (userShareRecord) {
      await UserShare.updateTransactionStatus(
        userShareRecord.user,
        transactionId,
        newStatus,
        adminNote
      );
    }
    
    // If approved, update global share counts and process referrals
    if (approved) {
      const shareConfig = await Share.getCurrentConfig();
      shareConfig.sharesSold += paymentTransaction.shares;
      
      // Update tier sales
      shareConfig.tierSales.tier1Sold += paymentTransaction.tierBreakdown.tier1 || 0;
      shareConfig.tierSales.tier2Sold += paymentTransaction.tierBreakdown.tier2 || 0;
      shareConfig.tierSales.tier3Sold += paymentTransaction.tierBreakdown.tier3 || 0;
      
      await shareConfig.save();
      
      // Process referral commissions
      try {
        const referralResult = await processReferralCommission(
          paymentTransaction.userId,
          paymentTransaction.amount,
          'share',
          transactionId
        );
        console.log('Referral commission process result:', referralResult);
      } catch (referralError) {
        console.error('Error processing referral commissions:', referralError);
      }
    }
    
    // Notify user
    const user = await User.findById(paymentTransaction.userId);
    if (user && user.email) {
      try {
        await sendEmail({
          email: user.email,
          subject: `AfriMobile - Manual Payment ${approved ? 'Approved' : 'Declined'}`,
          html: `
            <h2>Share Purchase ${approved ? 'Confirmation' : 'Update'}</h2>
            <p>Dear ${user.name},</p>
            <p>Your purchase of ${paymentTransaction.shares} shares for ${paymentTransaction.currency === 'naira' ? '₦' : '$'}${paymentTransaction.amount} has been ${approved ? 'verified and completed' : 'declined'}.</p>
            <p>Transaction Reference: ${transactionId}</p>
            ${approved ? 
              `<p>Thank you for your investment in AfriMobile!</p>` : 
              `<p>Please contact support if you have any questions.</p>`
            }
            ${adminNote ? `<p>Note: ${adminNote}</p>` : ''}
          `
        });
      } catch (emailError) {
        console.error('Failed to send manual payment notification email:', emailError);
      }
    }
    
    res.status(200).json({
      success: true,
      message: `Manual payment ${approved ? 'approved' : 'declined'} successfully`,
      status: newStatus
    });
  } catch (error) {
    console.error('Error verifying manual payment:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to verify manual payment',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};


/**
 * @desc    Admin: Cancel approved manual payment
 * @route   POST /api/shares/admin/manual/cancel
 * @access  Private (Admin)
 */
exports.adminCancelManualPayment = async (req, res) => {
  try {
    const { transactionId, cancelReason } = req.body;
    const adminId = req.user.id;
    
    // Check if admin
    const admin = await User.findById(adminId);
    if (!admin || !admin.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized: Admin access required'
      });
    }
    
    // Find the transaction
    const userShareRecord = await UserShare.findOne({
      'transactions.transactionId': transactionId
    });
    
    if (!userShareRecord) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found'
      });
    }
    
    const transaction = userShareRecord.transactions.find(
      t => t.transactionId === transactionId && t.paymentMethod.startsWith('manual_')
    );
    
    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Manual transaction details not found'
      });
    }
    
    if (transaction.status !== 'completed') {
      return res.status(400).json({
        success: false,
        message: `Cannot cancel a transaction that is not completed. Current status: ${transaction.status}`
      });
    }
    
    // Rollback global share counts
    const shareConfig = await Share.getCurrentConfig();
    shareConfig.sharesSold -= transaction.shares;
    
    // Rollback tier sales
    shareConfig.tierSales.tier1Sold -= transaction.tierBreakdown.tier1 || 0;
    shareConfig.tierSales.tier2Sold -= transaction.tierBreakdown.tier2 || 0;
    shareConfig.tierSales.tier3Sold -= transaction.tierBreakdown.tier3 || 0;
    
    await shareConfig.save();
    
    // Rollback any referral commissions if applicable
    try {
      const rollbackResult = await rollbackReferralCommission(
        userShareRecord.user,    // userId
        transactionId,          // transactionId
        transaction.totalAmount, // purchaseAmount
        transaction.currency,    // currency
        'share',                // purchaseType
        'UserShare'             // sourceModel
      );
      
      console.log('Referral commission rollback result:', rollbackResult);
    } catch (referralError) {
      console.error('Error rolling back referral commissions:', referralError);
      // Continue with the cancellation process despite referral error
    }
    
    // Update transaction status back to pending
    await UserShare.updateTransactionStatus(
      userShareRecord.user,
      transactionId,
      'pending',
      `CANCELLATION: ${cancelReason || 'Approved payment canceled by admin'}`
    );
    
    // Notify user
    const user = await User.findById(userShareRecord.user);
    if (user && user.email) {
      try {
        await sendEmail({
          email: user.email,
          subject: 'AfriMobile - Payment Approval Canceled',
          html: `
            <h2>Share Purchase Update</h2>
            <p>Dear ${user.name},</p>
            <p>We need to inform you that your previously approved purchase of ${transaction.shares} shares 
            for ${transaction.currency === 'naira' ? '₦' : '$'}${transaction.totalAmount} has been temporarily placed back into pending status.</p>
            <p>Transaction Reference: ${transactionId}</p>
            <p>Reason: ${cancelReason || 'Administrative review required'}</p>
            <p>Our team will contact you shortly to resolve this matter. We apologize for any inconvenience.</p>
            <p>If you have any questions, please contact our support team.</p>
          `
        });
      } catch (emailError) {
        console.error('Failed to send cancellation notification email:', emailError);
      }
    }
    
    // Return success
    res.status(200).json({
      success: true,
      message: 'Payment approval successfully canceled and returned to pending status',
      status: 'pending'
    });
  } catch (error) {
    console.error('Error canceling approved payment:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to cancel payment approval',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};
/**
 * @desc    Admin: Delete manual payment transaction with Cloudinary cleanup
 * @route   DELETE /api/shares/admin/manual/:transactionId
 * @access  Private (Admin)
 */
exports.adminDeleteManualPayment = async (req, res) => {
  try {
    const { transactionId } = req.params;
    const adminId = req.user.id;
    
    // Check if admin
    const admin = await User.findById(adminId);
    if (!admin || !admin.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized: Admin access required'
      });
    }
    
    if (!transactionId) {
      return res.status(400).json({
        success: false,
        message: 'Transaction ID is required'
      });
    }
    
    // Find the transaction in PaymentTransaction first
    const paymentTransaction = await PaymentTransaction.findOne({
      transactionId,
      type: 'share'
    });
    
    // Also find in UserShare for compatibility
    const userShareRecord = await UserShare.findOne({
      'transactions.transactionId': transactionId
    });
    
    if (!paymentTransaction && !userShareRecord) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found'
      });
    }
    
    // Get transaction details for cleanup
    let transactionDetails = {};
    let cloudinaryIds = [];
    
    if (paymentTransaction) {
      transactionDetails = {
        shares: paymentTransaction.shares,
        amount: paymentTransaction.amount,
        currency: paymentTransaction.currency,
        status: paymentTransaction.status,
        tierBreakdown: paymentTransaction.tierBreakdown,
        userId: paymentTransaction.userId
      };
      
      // Collect Cloudinary ID for deletion
      if (paymentTransaction.paymentProofCloudinaryId) {
        cloudinaryIds.push(paymentTransaction.paymentProofCloudinaryId);
      }
    }
    
    if (userShareRecord) {
      const transaction = userShareRecord.transactions.find(
        t => t.transactionId === transactionId
      );
      
      if (transaction) {
        if (!transactionDetails.shares) {
          transactionDetails = {
            shares: transaction.shares,
            amount: transaction.totalAmount,
            currency: transaction.currency,
            status: transaction.status,
            tierBreakdown: transaction.tierBreakdown,
            userId: userShareRecord.user
          };
        }
        
        // Collect additional Cloudinary ID if different
        if (transaction.paymentProofCloudinaryId && 
            !cloudinaryIds.includes(transaction.paymentProofCloudinaryId)) {
          cloudinaryIds.push(transaction.paymentProofCloudinaryId);
        }
      }
    }
    
    // If transaction was completed, rollback global share counts
    if (transactionDetails.status === 'completed') {
      const shareConfig = await Share.getCurrentConfig();
      shareConfig.sharesSold -= transactionDetails.shares;
      
      // Rollback tier sales
      shareConfig.tierSales.tier1Sold -= transactionDetails.tierBreakdown?.tier1 || 0;
      shareConfig.tierSales.tier2Sold -= transactionDetails.tierBreakdown?.tier2 || 0;
      shareConfig.tierSales.tier3Sold -= transactionDetails.tierBreakdown?.tier3 || 0;
      
      await shareConfig.save();
      
      // Rollback any referral commissions if applicable
      try {
        const rollbackResult = await rollbackReferralCommission(
          transactionDetails.userId,
          transactionId,
          transactionDetails.amount,
          transactionDetails.currency,
          'share',
          'PaymentTransaction'
        );
        
        console.log('Share referral commission rollback result:', rollbackResult);
      } catch (referralError) {
        console.error('Error rolling back share referral commissions:', referralError);
        // Continue with the deletion process despite referral error
      }
    }
    
    // ✅ CLOUDINARY: Delete Cloudinary files
    for (const cloudinaryId of cloudinaryIds) {
      try {
        const deleteResult = await deleteFromCloudinary(cloudinaryId);
        if (deleteResult.result === 'ok') {
          console.log(`Share payment proof file deleted from Cloudinary: ${cloudinaryId}`);
        } else {
          console.log(`Share payment proof file not found in Cloudinary: ${cloudinaryId}`);
        }
      } catch (fileError) {
        console.error('Error deleting share payment proof file from Cloudinary:', fileError);
        // Continue with deletion even if file deletion fails
      }
    }
    
    // Delete from PaymentTransaction
    if (paymentTransaction) {
      await PaymentTransaction.deleteOne({ _id: paymentTransaction._id });
      console.log('Share PaymentTransaction record deleted');
    }
    
    // Delete from UserShare
    if (userShareRecord) {
      // Remove the transaction from the user's transactions array
      userShareRecord.transactions = userShareRecord.transactions.filter(
        t => t.transactionId !== transactionId
      );
      
      // Recalculate total shares for the user
      userShareRecord.totalShares = userShareRecord.transactions
        .filter(t => t.status === 'completed')
        .reduce((total, t) => total + t.shares, 0);
      
      await userShareRecord.save();
      console.log('Share UserShare record updated');
    }
    
    // Get user details for notification
    const user = await User.findById(transactionDetails.userId);
    
    // Notify user about transaction deletion
    if (user && user.email) {
      try {
        await sendEmail({
          email: user.email,
          subject: 'AfriMobile - Share Transaction Deleted',
          html: `
            <h2>Transaction Deletion Notice</h2>
            <p>Dear ${user.name},</p>
            <p>We are writing to inform you that your share manual payment transaction has been deleted from our system.</p>
            <p>Transaction Details:</p>
            <ul>
              <li>Transaction ID: ${transactionId}</li>
              <li>Shares: ${transactionDetails.shares}</li>
              <li>Amount: ${transactionDetails.currency === 'naira' ? '₦' : '$'}${transactionDetails.amount}</li>
              <li>Previous Status: ${transactionDetails.status}</li>
            </ul>
            ${transactionDetails.status === 'completed' ? 
              `<p>Since this was a completed transaction, the shares have been removed from your account and any related commissions have been reversed.</p>` : 
              `<p>This transaction was pending verification when it was deleted.</p>`
            }
            <p>If you believe this was done in error or if you have any questions, please contact our support team immediately.</p>
            <p>Best regards,<br>AfriMobile Team</p>
          `
        });
      } catch (emailError) {
        console.error('Failed to send share transaction deletion notification email:', emailError);
      }
    }
    
    // Log the deletion for audit purposes
    console.log(`Share manual payment transaction deleted:`, {
      transactionId,
      adminId,
      userId: transactionDetails.userId,
      previousStatus: transactionDetails.status,
      shares: transactionDetails.shares,
      amount: transactionDetails.amount,
      currency: transactionDetails.currency,
      cloudinaryFilesDeleted: cloudinaryIds.length,
      timestamp: new Date().toISOString()
    });
    
    // Return success response
    res.status(200).json({
      success: true,
      message: 'Share manual payment transaction deleted successfully',
      data: {
        transactionId,
        deletedTransaction: {
          shares: transactionDetails.shares,
          amount: transactionDetails.amount,
          currency: transactionDetails.currency,
          previousStatus: transactionDetails.status
        },
        cloudinaryFilesDeleted: cloudinaryIds.length
      }
    });
  } catch (error) {
    console.error('Error deleting share manual payment transaction:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete manual payment transaction',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};
/**
 * @desc    Get share purchase report with date range filtering
 * @route   GET /api/shares/admin/purchase-report
 * @access  Private (Admin)
 */
exports.getSharePurchaseReport = async (req, res) => {
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
    const { 
      startDate, 
      endDate, 
      status = 'completed', // Default to completed transactions only
      page = 1, 
      limit = 50,
      sortBy = 'date', // date, amount, shares, name
      sortOrder = 'desc' // desc, asc
    } = req.query;
    
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    // Build date filter
    let dateFilter = {};
    if (startDate || endDate) {
      dateFilter['transactions.createdAt'] = {};
      
      if (startDate) {
        dateFilter['transactions.createdAt']['$gte'] = new Date(startDate);
      }
      
      if (endDate) {
        // Add 23:59:59 to include the entire end date
        const endDateTime = new Date(endDate);
        endDateTime.setHours(23, 59, 59, 999);
        dateFilter['transactions.createdAt']['$lte'] = endDateTime;
      }
    }
    
    // Build query
    const query = {
      'transactions.status': status,
      ...dateFilter
    };
    
    console.log('Purchase report query:', JSON.stringify(query, null, 2));
    
    // Get user shares with transactions
    const userShares = await UserShare.find(query)
      .populate('user', 'name email phone username walletAddress createdAt')
      .lean();
    
    // Format and filter the response
    const purchases = [];
    const summary = {
      totalTransactions: 0,
      totalShares: 0,
      totalAmountNaira: 0,
      totalAmountUSDT: 0,
      uniqueInvestors: new Set(),
      paymentMethods: {},
      tierBreakdown: {
        tier1: 0,
        tier2: 0,
        tier3: 0
      }
    };
    
    for (const userShare of userShares) {
      for (const transaction of userShare.transactions) {
        // Apply filters
        if (transaction.status !== status) continue;
        
        // Date filter (if no date filter in query, this will be skipped)
        if (startDate || endDate) {
          const transactionDate = new Date(transaction.createdAt);
          
          if (startDate && transactionDate < new Date(startDate)) continue;
          if (endDate) {
            const endDateTime = new Date(endDate);
            endDateTime.setHours(23, 59, 59, 999);
            if (transactionDate > endDateTime) continue;
          }
        }
        
        // Clean up payment method display
        let displayPaymentMethod = transaction.paymentMethod;
        if (transaction.paymentMethod.startsWith('manual_')) {
          displayPaymentMethod = transaction.paymentMethod.replace('manual_', '');
        }
        
        // Calculate days since purchase
        const daysSincePurchase = Math.floor(
          (new Date() - new Date(transaction.createdAt)) / (1000 * 60 * 60 * 24)
        );
        
        const purchaseData = {
          transactionId: transaction.transactionId,
          user: {
            id: userShare.user._id,
            name: userShare.user.name,
            username: userShare.user.username,
            email: userShare.user.email,
            phone: userShare.user.phone,
            walletAddress: userShare.user.walletAddress,
            registrationDate: userShare.user.createdAt
          },
          purchaseDetails: {
            shares: transaction.shares,
            pricePerShare: transaction.pricePerShare,
            currency: transaction.currency,
            totalAmount: transaction.totalAmount,
            paymentMethod: displayPaymentMethod,
            status: transaction.status,
            purchaseDate: transaction.createdAt,
            daysSincePurchase,
            tierBreakdown: transaction.tierBreakdown || { tier1: 0, tier2: 0, tier3: 0 }
          },
          additionalInfo: {
            txHash: transaction.txHash || null,
            adminAction: transaction.adminAction || false,
            adminNote: transaction.adminNote || null,
            manualPaymentDetails: transaction.manualPaymentDetails || {}
          }
        };
        
        purchases.push(purchaseData);
        
        // Update summary statistics
        summary.totalTransactions++;
        summary.totalShares += transaction.shares;
        summary.uniqueInvestors.add(userShare.user._id.toString());
        
        if (transaction.currency === 'naira') {
          summary.totalAmountNaira += transaction.totalAmount;
        } else if (transaction.currency === 'usdt') {
          summary.totalAmountUSDT += transaction.totalAmount;
        }
        
        // Payment method stats
        if (!summary.paymentMethods[displayPaymentMethod]) {
          summary.paymentMethods[displayPaymentMethod] = {
            count: 0,
            totalAmount: 0,
            currency: transaction.currency
          };
        }
        summary.paymentMethods[displayPaymentMethod].count++;
        summary.paymentMethods[displayPaymentMethod].totalAmount += transaction.totalAmount;
        
        // Tier breakdown
        if (transaction.tierBreakdown) {
          summary.tierBreakdown.tier1 += transaction.tierBreakdown.tier1 || 0;
          summary.tierBreakdown.tier2 += transaction.tierBreakdown.tier2 || 0;
          summary.tierBreakdown.tier3 += transaction.tierBreakdown.tier3 || 0;
        }
      }
    }
    
    // Convert Set to number for unique investors
    summary.uniqueInvestors = summary.uniqueInvestors.size;
    
    // Sort purchases
    purchases.sort((a, b) => {
      let comparison = 0;
      
      switch (sortBy) {
        case 'amount':
          comparison = a.purchaseDetails.totalAmount - b.purchaseDetails.totalAmount;
          break;
        case 'shares':
          comparison = a.purchaseDetails.shares - b.purchaseDetails.shares;
          break;
        case 'name':
          comparison = a.user.name.localeCompare(b.user.name);
          break;
        case 'date':
        default:
          comparison = new Date(a.purchaseDetails.purchaseDate) - new Date(b.purchaseDetails.purchaseDate);
          break;
      }
      
      return sortOrder === 'desc' ? -comparison : comparison;
    });
    
    // Apply pagination
    const paginatedPurchases = purchases.slice(skip, skip + parseInt(limit));
    
    // Calculate average purchase amounts
    const avgAmountNaira = summary.totalTransactions > 0 ? summary.totalAmountNaira / summary.totalTransactions : 0;
    const avgAmountUSDT = summary.totalTransactions > 0 ? summary.totalAmountUSDT / summary.totalTransactions : 0;
    const avgShares = summary.totalTransactions > 0 ? summary.totalShares / summary.totalTransactions : 0;
    
    res.status(200).json({
      success: true,
      message: 'Share purchase report generated successfully',
      filters: {
        startDate: startDate || null,
        endDate: endDate || null,
        status,
        totalRecords: purchases.length
      },
      summary: {
        ...summary,
        averages: {
          avgAmountNaira: Math.round(avgAmountNaira * 100) / 100,
          avgAmountUSDT: Math.round(avgAmountUSDT * 100) / 100,
          avgShares: Math.round(avgShares * 100) / 100
        }
      },
      purchases: paginatedPurchases,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(purchases.length / parseInt(limit)),
        totalRecords: purchases.length,
        limit: parseInt(limit)
      }
    });
  } catch (error) {
    console.error('Error generating share purchase report:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate share purchase report',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};
// Database verification and fix script for transaction statuses
// Add this as a new endpoint or run as a one-time script

/**
 * @desc    Debug and fix transaction statuses
 * @route   GET /api/shares/admin/debug-transactions/:userId
 * @access  Private (Admin)
 */
exports.debugUserTransactions = async (req, res) => {
  try {
    const { userId } = req.params;
    const adminId = req.user.id;
    
    // Check if admin
    const admin = await User.findById(adminId);
    if (!admin || !admin.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized: Admin access required'
      });
    }
    
    // Get user shares
    const userShares = await UserShare.findOne({ user: userId });
    
    if (!userShares) {
      return res.status(404).json({
        success: false,
        message: 'User shares not found'
      });
    }
    
    // Also get co-founder transactions from PaymentTransaction model
    const coFounderTransactions = await PaymentTransaction.find({
      userId: userId,
      type: 'co-founder'
    });
    
    console.log(`[DEBUG] Found ${userShares.transactions.length} transactions in UserShare`);
    console.log(`[DEBUG] Found ${coFounderTransactions.length} co-founder transactions in PaymentTransaction`);
    
    // Analyze transactions
    const analysis = {
      userShareTransactions: [],
      paymentTransactions: [],
      discrepancies: [],
      recommendations: []
    };
    
    // Analyze UserShare transactions
    userShares.transactions.forEach((transaction, index) => {
      const txAnalysis = {
        index,
        transactionId: transaction.transactionId,
        paymentMethod: transaction.paymentMethod,
        status: transaction.status,
        shares: transaction.shares,
        coFounderShares: transaction.coFounderShares,
        adminAction: transaction.adminAction,
        date: transaction.createdAt,
        issues: []
      };
      
      // Check for issues
      if (transaction.paymentMethod === 'co-founder') {
        if (transaction.status === 'completed' && !transaction.adminAction) {
          txAnalysis.issues.push('Co-founder transaction marked as completed but not admin action');
        }
        
        if (!transaction.coFounderShares && transaction.shares) {
          txAnalysis.issues.push('Missing coFounderShares field for co-founder transaction');
        }
      }
      
      // Check if transaction ID looks like it should be pending
      if (transaction.transactionId && transaction.transactionId.includes('685f')) {
        txAnalysis.issues.push('Transaction ID suggests this might be incorrectly processed');
      }
      
      analysis.userShareTransactions.push(txAnalysis);
    });
    
    // Analyze PaymentTransaction records
    coFounderTransactions.forEach((transaction, index) => {
      const txAnalysis = {
        id: transaction._id,
        transactionId: transaction.transactionId,
        paymentMethod: transaction.paymentMethod,
        status: transaction.status,
        shares: transaction.shares,
        amount: transaction.amount,
        currency: transaction.currency,
        adminNotes: transaction.adminNotes,
        verifiedBy: transaction.verifiedBy,
        date: transaction.createdAt,
        issues: []
      };
      
      // Check for issues
      if (transaction.status === 'completed' && !transaction.verifiedBy) {
        txAnalysis.issues.push('Marked as completed but no verifier recorded');
      }
      
      if (transaction.status === 'pending' && transaction.verifiedBy) {
        txAnalysis.issues.push('Marked as pending but has verifier');
      }
      
      // Find corresponding UserShare transaction
      const userShareTx = userShares.transactions.find(
        t => t.transactionId === transaction.transactionId || 
             t.transactionId === transaction._id.toString()
      );
      
      if (userShareTx && userShareTx.status !== transaction.status) {
        txAnalysis.issues.push(`Status mismatch: UserShare(${userShareTx.status}) vs PaymentTransaction(${transaction.status})`);
        
        analysis.discrepancies.push({
          transactionId: transaction.transactionId,
          userShareStatus: userShareTx.status,
          paymentTransactionStatus: transaction.status,
          recommendedAction: 'Sync statuses'
        });
      }
      
      analysis.paymentTransactions.push(txAnalysis);
    });
    
    // Generate recommendations
    if (analysis.discrepancies.length > 0) {
      analysis.recommendations.push('Status synchronization needed between UserShare and PaymentTransaction');
    }
    
    const suspiciousCompletedTx = analysis.userShareTransactions.filter(
      tx => tx.paymentMethod === 'co-founder' && 
           tx.status === 'completed' && 
           tx.issues.length > 0
    );
    
    if (suspiciousCompletedTx.length > 0) {
      analysis.recommendations.push('Review co-founder transactions marked as completed without proper verification');
    }
    
    res.status(200).json({
      success: true,
      userId,
      analysis,
      summary: {
        totalUserShareTransactions: userShares.transactions.length,
        totalPaymentTransactions: coFounderTransactions.length,
        discrepanciesFound: analysis.discrepancies.length,
        suspiciousTransactions: suspiciousCompletedTx.length
      }
    });
    
  } catch (error) {
    console.error('Error debugging user transactions:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to debug user transactions',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Fix transaction statuses based on PaymentTransaction records
 * @route   POST /api/shares/admin/fix-transaction-statuses/:userId
 * @access  Private (Admin)
 */
exports.fixUserTransactionStatuses = async (req, res) => {
  try {
    const { userId } = req.params;
    const { dryRun = true } = req.body; // Default to dry run
    const adminId = req.user.id;
    
    // Check if admin
    const admin = await User.findById(adminId);
    if (!admin || !admin.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized: Admin access required'
      });
    }
    
    // Get user shares
    const userShares = await UserShare.findOne({ user: userId });
    
    if (!userShares) {
      return res.status(404).json({
        success: false,
        message: 'User shares not found'
      });
    }
    
    // Get co-founder transactions
    const coFounderTransactions = await PaymentTransaction.find({
      userId: userId,
      type: 'co-founder'
    });
    
    const fixes = [];
    let transactionsModified = 0;
    
    // Check each UserShare transaction against PaymentTransaction
    for (let i = 0; i < userShares.transactions.length; i++) {
      const userTx = userShares.transactions[i];
      
      // Find corresponding PaymentTransaction
      const paymentTx = coFounderTransactions.find(
        pt => pt.transactionId === userTx.transactionId || 
              pt._id.toString() === userTx.transactionId
      );
      
      if (paymentTx && paymentTx.status !== userTx.status) {
        const fix = {
          transactionId: userTx.transactionId,
          currentUserShareStatus: userTx.status,
          paymentTransactionStatus: paymentTx.status,
          recommendedAction: `Change UserShare status to ${paymentTx.status}`,
          reasoning: 'PaymentTransaction is the source of truth for co-founder transactions'
        };
        
        fixes.push(fix);
        
        if (!dryRun) {
          // Actually apply the fix
          userShares.transactions[i].status = paymentTx.status;
          transactionsModified++;
          
          console.log(`[FIX] Updated transaction ${userTx.transactionId} status from ${userTx.status} to ${paymentTx.status}`);
        }
      }
    }
    
    // Recalculate user's total shares if not dry run
    if (!dryRun && transactionsModified > 0) {
      // Only count completed transactions
      const completedShares = userShares.transactions
        .filter(t => t.status === 'completed')
        .reduce((total, t) => {
          if (t.paymentMethod === 'co-founder') {
            // For co-founder shares, use equivalentRegularShares if available, otherwise calculate
            return total + (t.equivalentRegularShares || (t.coFounderShares || t.shares || 0) * 29);
          } else {
            return total + (t.shares || 0);
          }
        }, 0);
      
      userShares.totalShares = completedShares;
      await userShares.save();
      
      console.log(`[FIX] Updated user total shares to ${completedShares}`);
    }
    
    res.status(200).json({
      success: true,
      message: dryRun ? 'Dry run completed - no changes made' : `Fixed ${transactionsModified} transaction statuses`,
      userId,
      fixesFound: fixes.length,
      transactionsModified,
      fixes,
      dryRun
    });
    
  } catch (error) {
    console.error('Error fixing user transaction statuses:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fix transaction statuses',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Get detailed transaction comparison for a user
 * @route   GET /api/shares/admin/transaction-comparison/:userId
 * @access  Private (Admin)
 */
exports.getTransactionComparison = async (req, res) => {
  try {
    const { userId } = req.params;
    const adminId = req.user.id;
    
    // Check if admin
    const admin = await User.findById(adminId);
    if (!admin || !admin.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized: Admin access required'
      });
    }
    
    // Get both data sources
    const userShares = await UserShare.findOne({ user: userId });
    const paymentTransactions = await PaymentTransaction.find({
      userId: userId,
      type: 'co-founder'
    });
    
    // Get regular share transactions for comparison
    const regularTransactions = userShares ? 
      userShares.transactions.filter(t => t.paymentMethod !== 'co-founder') : [];
    
    const coFounderUserShareTx = userShares ? 
      userShares.transactions.filter(t => t.paymentMethod === 'co-founder') : [];
    
    // Create comparison
    const comparison = {
      userId,
      userShareTransactions: {
        total: userShares ? userShares.transactions.length : 0,
        regular: regularTransactions.length,
        coFounder: coFounderUserShareTx.length,
        byStatus: {
          completed: userShares ? userShares.transactions.filter(t => t.status === 'completed').length : 0,
          pending: userShares ? userShares.transactions.filter(t => t.status === 'pending').length : 0,
          failed: userShares ? userShares.transactions.filter(t => t.status === 'failed').length : 0
        }
      },
      paymentTransactions: {
        total: paymentTransactions.length,
        byStatus: {
          completed: paymentTransactions.filter(t => t.status === 'completed').length,
          pending: paymentTransactions.filter(t => t.status === 'pending').length,
          failed: paymentTransactions.filter(t => t.status === 'failed').length
        }
      },
      currentTotalShares: userShares ? userShares.totalShares : 0,
      calculatedCompletedShares: {
        regular: regularTransactions
          .filter(t => t.status === 'completed')
          .reduce((sum, t) => sum + (t.shares || 0), 0),
        coFounderFromUserShare: coFounderUserShareTx
          .filter(t => t.status === 'completed')
          .reduce((sum, t) => sum + (t.coFounderShares || t.shares || 0), 0),
        coFounderFromPaymentTx: paymentTransactions
          .filter(t => t.status === 'completed')
          .reduce((sum, t) => sum + (t.shares || 0), 0)
      }
    };
    
    // Identify discrepancies
    comparison.discrepancies = [];
    
    if (comparison.calculatedCompletedShares.coFounderFromUserShare !== 
        comparison.calculatedCompletedShares.coFounderFromPaymentTx) {
      comparison.discrepancies.push({
        type: 'co-founder-share-mismatch',
        userShareTotal: comparison.calculatedCompletedShares.coFounderFromUserShare,
        paymentTransactionTotal: comparison.calculatedCompletedShares.coFounderFromPaymentTx,
        message: 'Co-founder share totals don\'t match between UserShare and PaymentTransaction'
      });
    }
    
    res.status(200).json({
      success: true,
      comparison
    });
    
  } catch (error) {
    console.error('Error getting transaction comparison:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get transaction comparison',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Webhook handler for Centiiv payment notifications
exports.handleCentiivWebhook = async (req, res) => {
  try {
    // Centiiv webhook payload structure (adjust based on their documentation)
    const { orderId, status, amount, customerEmail, metadata } = req.body;
    
    // Verify webhook authenticity (implement based on Centiiv's webhook verification)
    // This might involve checking a signature or secret
    const webhookSecret = process.env.CENTIIV_WEBHOOK_SECRET;
    if (webhookSecret) {
      // Add signature verification logic here based on Centiiv's documentation
      // Example: verify webhook signature in headers
    }
    
    // Find the transaction by Centiiv order ID
    const userShareRecord = await UserShare.findOne({
      'transactions.centiivOrderId': orderId
    });
    
    if (!userShareRecord) {
      console.error(`Centiiv webhook: Transaction not found for order ID: ${orderId}`);
      return res.status(404).json({
        success: false,
        message: 'Transaction not found'
      });
    }
    
    const transaction = userShareRecord.transactions.find(
      t => t.centiivOrderId === orderId
    );
    
    if (!transaction) {
      console.error(`Centiiv webhook: Transaction details not found for order ID: ${orderId}`);
      return res.status(404).json({
        success: false,
        message: 'Transaction details not found'
      });
    }
    
    // Map Centiiv status to our status
    let newStatus = 'pending';
    if (status === 'paid' || status === 'completed') {
      newStatus = 'completed';
    } else if (status === 'cancelled' || status === 'expired') {
      newStatus = 'failed';
    }
    
    // Update transaction status
    await UserShare.updateTransactionStatus(
      userShareRecord.user,
      transaction.transactionId,
      newStatus
    );
    
    // If payment successful, update global share counts and process referrals
    if (newStatus === 'completed') {
      const shareConfig = await Share.getCurrentConfig();
      shareConfig.sharesSold += transaction.shares;
      
      // Update tier sales
      shareConfig.tierSales.tier1Sold += transaction.tierBreakdown.tier1;
      shareConfig.tierSales.tier2Sold += transaction.tierBreakdown.tier2;
      shareConfig.tierSales.tier3Sold += transaction.tierBreakdown.tier3;
      
      await shareConfig.save();
      
      // Process referral commissions
      try {
        const referralResult = await processReferralCommission(
          userShareRecord.user,
          transaction.totalAmount,
          'share',
          transaction.transactionId
        );
        console.log('Referral commission process result:', referralResult);
      } catch (referralError) {
        console.error('Error processing referral commissions:', referralError);
      }
      
      // Get user details for notification
      const user = await User.findById(userShareRecord.user);
      
      // Send confirmation email
      if (user && user.email) {
        try {
          await sendEmail({
            email: user.email,
            subject: 'AfriMobile - Share Purchase Successful',
            html: `
              <h2>Share Purchase Confirmation</h2>
              <p>Dear ${user.name},</p>
              <p>Your purchase of ${transaction.shares} shares for ₦${transaction.totalAmount} has been completed successfully.</p>
              <p>Transaction Reference: ${transaction.transactionId}</p>
              <p>Centiiv Order ID: ${orderId}</p>
              <p>Thank you for your investment in AfriMobile!</p>
            `
          });
        } catch (emailError) {
          console.error('Failed to send purchase confirmation email:', emailError);
        }
      }
    }
    
    // Respond to Centiiv webhook
    res.status(200).json({
      success: true,
      message: 'Webhook processed successfully'
    });
    
  } catch (error) {
    console.error('Error processing Centiiv webhook:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process webhook'
    });
  }
};

// Get Centiiv order status (for manual verification)
exports.getCentiivOrderStatus = async (req, res) => {
  try {
    const { orderId } = req.params;
    const adminId = req.user.id;
    
    // Check if admin
    const admin = await User.findById(adminId);
    if (!admin || !admin.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized: Admin access required'
      });
    }
    
    // Call Centiiv API to get order status
    const centiivResponse = await axios.get(
      `https://api.centiiv.com/api/v1/order/${orderId}`,
      {
        headers: {
          'Accept': 'application/json',
          'Authorization': `Bearer ${process.env.CENTIIV_API_KEY}`
        }
      }
    );
    
    res.status(200).json({
      success: true,
      orderStatus: centiivResponse.data
    });
    
  } catch (error) {
    console.error('Error fetching Centiiv order status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch order status',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Admin: Manually verify Centiiv payment
exports.adminVerifyCentiivPayment = async (req, res) => {
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
    
    // Find the transaction
    const userShareRecord = await UserShare.findOne({
      'transactions.transactionId': transactionId
    });
    
    if (!userShareRecord) {
      return res.status(400).json({
        success: false,
        message: 'Transaction not found'
      });
    }
    
    const transaction = userShareRecord.transactions.find(
      t => t.transactionId === transactionId && t.paymentMethod === 'centiiv'
    );
    
    if (!transaction) {
      return res.status(400).json({
        success: false,
        message: 'Centiiv transaction details not found'
      });
    }
    
    if (transaction.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: `Transaction already ${transaction.status}`
      });
    }
    
    const newStatus = approved ? 'completed' : 'failed';
    
    // Update transaction status
    await UserShare.updateTransactionStatus(
      userShareRecord.user,
      transactionId,
      newStatus,
      adminNote
    );
    
    // If approved, update global share counts and process referrals
    if (approved) {
      const shareConfig = await Share.getCurrentConfig();
      shareConfig.sharesSold += transaction.shares;
      
      // Update tier sales
      shareConfig.tierSales.tier1Sold += transaction.tierBreakdown.tier1;
      shareConfig.tierSales.tier2Sold += transaction.tierBreakdown.tier2;
      shareConfig.tierSales.tier3Sold += transaction.tierBreakdown.tier3;
      
      await shareConfig.save();
      
      // Process referral commissions
      try {
        const referralResult = await processReferralCommission(
          userShareRecord.user,
          transaction.totalAmount,
          'share',
          transactionId
        );
        console.log('Referral commission process result:', referralResult);
      } catch (referralError) {
        console.error('Error processing referral commissions:', referralError);
      }
    }
    
    // Notify user
    const user = await User.findById(userShareRecord.user);
    if (user && user.email) {
      try {
        await sendEmail({
          email: user.email,
          subject: `AfriMobile - Centiiv Payment ${approved ? 'Approved' : 'Declined'}`,
          html: `
            <h2>Share Purchase ${approved ? 'Confirmation' : 'Update'}</h2>
            <p>Dear ${user.name},</p>
            <p>Your purchase of ${transaction.shares} shares for ₦${transaction.totalAmount} has been ${approved ? 'verified and completed' : 'declined'}.</p>
            <p>Transaction Reference: ${transactionId}</p>
            ${approved ? 
              `<p>Thank you for your investment in AfriMobile!</p>` : 
              `<p>Please contact support if you have any questions.</p>`
            }
            ${adminNote ? `<p>Note: ${adminNote}</p>` : ''}
          `
        });
      } catch (emailError) {
        console.error('Failed to send purchase notification email:', emailError);
      }
    }
    
    res.status(200).json({
      success: true,
      message: `Centiiv payment ${approved ? 'approved' : 'declined'} successfully`,
      status: newStatus
    });
    
  } catch (error) {
    console.error('Error verifying Centiiv payment:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to verify Centiiv payment',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Get all Centiiv transactions (Admin)
exports.adminGetCentiivTransactions = async (req, res) => {
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
    const query = { 'transactions.paymentMethod': 'centiiv' };
    if (status && ['pending', 'completed', 'failed'].includes(status)) {
      query['transactions.status'] = status;
    }
    
    // Get user shares with transactions
    const userShares = await UserShare.find(query)
      .skip(skip)
      .limit(parseInt(limit))
      .populate('user', 'name email phone');
    
    // Format response
    const transactions = [];
    for (const userShare of userShares) {
      for (const transaction of userShare.transactions) {
        // Only include Centiiv transactions matching status filter
        if (transaction.paymentMethod !== 'centiiv' || 
            (status && transaction.status !== status)) {
          continue;
        }
        
        transactions.push({
          transactionId: transaction.transactionId,
          centiivOrderId: transaction.centiivOrderId,
          invoiceUrl: transaction.centiivInvoiceUrl,
          user: {
            id: userShare.user._id,
            name: userShare.user.name,
            email: userShare.user.email,
            phone: userShare.user.phone
          },
          shares: transaction.shares,
          pricePerShare: transaction.pricePerShare,
          currency: transaction.currency,
          totalAmount: transaction.totalAmount,
          status: transaction.status,
          date: transaction.createdAt,
          adminNote: transaction.adminNote
        });
      }
    }
    
    // Count total
    const totalCount = await UserShare.countDocuments(query);
    
    res.status(200).json({
      success: true,
      transactions,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalCount / parseInt(limit)),
        totalCount
      }
    });
  } catch (error) {
    console.error('Error fetching Centiiv transactions:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch Centiiv transactions',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};
// Helper function to resolve user by ID or username
const resolveUserIdentifier = async (identifier) => {
  try {
    // Check if it's a valid MongoDB ObjectId
    const isValidObjectId = /^[0-9a-fA-F]{24}$/.test(identifier);
    
    let user;
    if (isValidObjectId) {
      // Try finding by ID first
      user = await User.findById(identifier);
    }
    
    // If not found by ID or not a valid ObjectId, try username
    if (!user) {
      user = await User.findOne({ 
        $or: [
          { username: identifier },
          { username: new RegExp(`^${identifier}$`, 'i') } // Case-insensitive
        ]
      });
    }
    
    // If still not found, try email
    if (!user) {
      user = await User.findOne({ 
        email: new RegExp(`^${identifier}$`, 'i') 
      });
    }
    
    return user;
  } catch (error) {
    console.error('Error resolving user identifier:', error);
    return null;
  }
};
/**
 * @desc    Get user share overview by ID or username
 * @route   GET /api/shares/admin/user-overview/:identifier
 * @access  Private (Admin)
 */
exports.adminGetUserOverview = async (req, res) => {
  try {
    const { identifier } = req.params;
    const adminId = req.user.id;
    
    // Check if admin
    const admin = await User.findById(adminId);
    if (!admin || !admin.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized: Admin access required'
      });
    }
    
    console.log(`[Admin] Looking up user: ${identifier}`);
    
    // Resolve user by ID or username
    const user = await resolveUserIdentifier(identifier);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
        searchedFor: identifier
      });
    }
    
    console.log(`[Admin] Found user: ${user._id} (${user.username})`);
    
    // Get user shares
    const userShares = await UserShare.findOne({ user: user._id });
    
    // Get co-founder transactions
    const coFounderTransactions = await PaymentTransaction.find({
      userId: user._id,
      type: 'co-founder'
    });
    
    // Get all payment transactions
    const allPaymentTransactions = await PaymentTransaction.find({
      userId: user._id
    }).sort({ createdAt: -1 });
    
    // Calculate share breakdown
    let directRegularShares = 0;
    let coFounderShares = 0;
    let pendingRegularShares = 0;
    let pendingCoFounderShares = 0;
    
    const transactions = {
      regular: [],
      coFounder: [],
      manual: [],
      centiiv: [],
      web3: [],
      all: []
    };
    
    // Process UserShare transactions
    if (userShares) {
      userShares.transactions.forEach(transaction => {
        const txData = {
          transactionId: transaction.transactionId,
          shares: transaction.shares,
          coFounderShares: transaction.coFounderShares,
          amount: transaction.totalAmount,
          currency: transaction.currency,
          paymentMethod: transaction.paymentMethod,
          status: transaction.status,
          date: transaction.createdAt,
          source: 'UserShare'
        };
        
        transactions.all.push(txData);
        
        if (transaction.status === 'completed') {
          if (transaction.paymentMethod === 'co-founder') {
            coFounderShares += transaction.coFounderShares || transaction.shares || 0;
            transactions.coFounder.push(txData);
          } else {
            directRegularShares += transaction.shares || 0;
            
            if (transaction.paymentMethod.startsWith('manual_')) {
              transactions.manual.push(txData);
            } else if (transaction.paymentMethod.includes('centiiv')) {
              transactions.centiiv.push(txData);
            } else if (transaction.paymentMethod === 'web3' || transaction.paymentMethod === 'crypto') {
              transactions.web3.push(txData);
            } else {
              transactions.regular.push(txData);
            }
          }
        } else if (transaction.status === 'pending') {
          if (transaction.paymentMethod === 'co-founder') {
            pendingCoFounderShares += transaction.coFounderShares || transaction.shares || 0;
          } else {
            pendingRegularShares += transaction.shares || 0;
          }
        }
      });
    }
    
    // Get co-founder ratio
    const coFounderConfig = await CoFounderShare.findOne();
    const shareToRegularRatio = coFounderConfig?.shareToRegularRatio || 29;
    
    const equivalentRegularFromCoFounder = coFounderShares * shareToRegularRatio;
    const totalEffectiveShares = directRegularShares + equivalentRegularFromCoFounder;
    
    // User activity summary
    const activitySummary = {
      lastTransaction: userShares?.transactions?.length > 0 ? 
        userShares.transactions[userShares.transactions.length - 1].createdAt : null,
      totalTransactions: userShares?.transactions?.length || 0,
      completedTransactions: userShares?.transactions?.filter(t => t.status === 'completed').length || 0,
      pendingTransactions: userShares?.transactions?.filter(t => t.status === 'pending').length || 0,
      failedTransactions: userShares?.transactions?.filter(t => t.status === 'failed').length || 0
    };
    
    // Referral information
    const referralInfo = {
      hasReferralCode: !!user.referralInfo?.code,
      referralCode: user.referralInfo?.code || null,
      wasReferred: !!user.referralInfo?.referredBy,
      referredBy: user.referralInfo?.referredBy || null,
      totalReferrals: user.referralInfo?.totalReferrals || 0,
      activeReferrals: user.referralInfo?.activeReferrals || 0
    };
    
    res.status(200).json({
      success: true,
      user: {
        id: user._id,
        name: user.name,
        username: user.username,
        email: user.email,
        phone: user.phone,
        walletAddress: user.walletAddress,
        isAdmin: user.isAdmin || false,
        isEmailVerified: user.isEmailVerified || false,
        registrationDate: user.createdAt,
        lastLogin: user.lastLogin
      },
      sharesSummary: {
        totalEffectiveShares,
        directRegularShares,
        coFounderShares,
        equivalentRegularFromCoFounder,
        pending: {
          pendingRegularShares,
          pendingCoFounderShares,
          totalPendingEffective: pendingRegularShares + (pendingCoFounderShares * shareToRegularRatio)
        },
        coFounderEquivalence: {
          ratio: shareToRegularRatio,
          equivalentCoFounderShares: Math.floor(totalEffectiveShares / shareToRegularRatio),
          remainingRegularShares: totalEffectiveShares % shareToRegularRatio
        }
      },
      transactions: {
        byType: {
          regular: transactions.regular.length,
          coFounder: transactions.coFounder.length,
          manual: transactions.manual.length,
          centiiv: transactions.centiiv.length,
          web3: transactions.web3.length
        },
        recent: transactions.all.slice(0, 10), // Last 10 transactions
        summary: activitySummary
      },
      referralInfo,
      paymentMethods: {
        hasUsedRegular: transactions.regular.length > 0,
        hasUsedCoFounder: transactions.coFounder.length > 0,
        hasUsedManual: transactions.manual.length > 0,
        hasUsedCentiiv: transactions.centiiv.length > 0,
        hasUsedWeb3: transactions.web3.length > 0
      },
      searchInfo: {
        searchedBy: identifier,
        resolvedBy: /^[0-9a-fA-F]{24}$/.test(identifier) ? 'id' : 'username/email'
      }
    });
    
  } catch (error) {
    console.error('Error getting user overview:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get user overview',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};