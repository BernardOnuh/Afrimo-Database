// controller/shareController.js
const Share = require('../models/Share');
const UserShare = require('../models/UserShare');
const User = require('../models/User');
const crypto = require('crypto');
const axios = require('axios');
const { ethers } = require('ethers');
const { sendEmail } = require('../utils/emailService');
const SiteConfig = require('../models/SiteConfig');
const CoFounderShare = require('../models/CoFounderShare');
const { processReferralCommission, rollbackReferralCommission } = require('../utils/referralUtils');

// Generate a unique transaction ID
const generateTransactionId = () => {
  return `TXN-${crypto.randomBytes(4).toString('hex').toUpperCase()}-${Date.now().toString().slice(-6)}`;
};

// Get current share pricing and availability
exports.getShareInfo = async (req, res) => {
  try {
    const shareConfig = await Share.getCurrentConfig();
    
    // Get co-founder share configuration
    const coFounderConfig = await CoFounderShare.findOne();
    const shareToRegularRatio = coFounderConfig?.shareToRegularRatio || 29;
    const coFounderSharesSold = coFounderConfig?.sharesSold || 0;
    
    // CRITICAL FIX: Calculate equivalent regular shares from co-founder purchases
    const equivalentRegularSharesFromCoFounder = coFounderSharesSold * shareToRegularRatio;
    
    console.log('Share calculation debug:', {
      coFounderSharesSold,
      shareToRegularRatio,
      equivalentRegularSharesFromCoFounder,
      directRegularSharesSold: shareConfig.sharesSold,
      tier1DirectSold: shareConfig.tierSales.tier1Sold,
      tier2DirectSold: shareConfig.tierSales.tier2Sold,
      tier3DirectSold: shareConfig.tierSales.tier3Sold
    });
    
    // FIXED: Allocate co-founder equivalent shares across tiers (starting from tier1)
    let remainingCoFounderShares = equivalentRegularSharesFromCoFounder;
    
    // Calculate tier-specific allocations of co-founder equivalent shares
    let coFounderAllocatedToTier1 = 0;
    let coFounderAllocatedToTier2 = 0;
    let coFounderAllocatedToTier3 = 0;
    
    // Allocate co-founder equivalent shares starting from tier1
    if (remainingCoFounderShares > 0) {
      const tier1Capacity = shareConfig.currentPrices.tier1.shares;
      const tier1DirectUsed = shareConfig.tierSales.tier1Sold;
      const tier1Available = tier1Capacity - tier1DirectUsed;
      
      coFounderAllocatedToTier1 = Math.min(remainingCoFounderShares, tier1Available);
      remainingCoFounderShares -= coFounderAllocatedToTier1;
    }
    
    if (remainingCoFounderShares > 0) {
      const tier2Capacity = shareConfig.currentPrices.tier2.shares;
      const tier2DirectUsed = shareConfig.tierSales.tier2Sold;
      const tier2Available = tier2Capacity - tier2DirectUsed;
      
      coFounderAllocatedToTier2 = Math.min(remainingCoFounderShares, tier2Available);
      remainingCoFounderShares -= coFounderAllocatedToTier2;
    }
    
    if (remainingCoFounderShares > 0) {
      const tier3Capacity = shareConfig.currentPrices.tier3.shares;
      const tier3DirectUsed = shareConfig.tierSales.tier3Sold;
      const tier3Available = tier3Capacity - tier3DirectUsed;
      
      coFounderAllocatedToTier3 = Math.min(remainingCoFounderShares, tier3Available);
      remainingCoFounderShares -= coFounderAllocatedToTier3;
    }
    
    // FIXED: Calculate actual availability after deducting co-founder equivalent shares
    const tier1ActualAvailable = Math.max(0, 
      shareConfig.currentPrices.tier1.shares - 
      shareConfig.tierSales.tier1Sold - 
      coFounderAllocatedToTier1
    );
    
    const tier2ActualAvailable = Math.max(0, 
      shareConfig.currentPrices.tier2.shares - 
      shareConfig.tierSales.tier2Sold - 
      coFounderAllocatedToTier2
    );
    
    const tier3ActualAvailable = Math.max(0, 
      shareConfig.currentPrices.tier3.shares - 
      shareConfig.tierSales.tier3Sold - 
      coFounderAllocatedToTier3
    );
    
    // Calculate totals
    const totalDirectSharesSold = shareConfig.sharesSold;
    const totalEffectiveSharesSold = totalDirectSharesSold + equivalentRegularSharesFromCoFounder;
    const totalActualAvailable = tier1ActualAvailable + tier2ActualAvailable + tier3ActualAvailable;
    
    console.log('Availability calculation:', {
      tier1ActualAvailable,
      tier2ActualAvailable, 
      tier3ActualAvailable,
      totalActualAvailable,
      coFounderAllocations: {
        tier1: coFounderAllocatedToTier1,
        tier2: coFounderAllocatedToTier2,
        tier3: coFounderAllocatedToTier3
      }
    });
    
    const response = {
      success: true,
      pricing: shareConfig.currentPrices,
      availability: {
        tier1: tier1ActualAvailable,
        tier2: tier2ActualAvailable,
        tier3: tier3ActualAvailable,
      },
      totalAvailable: totalActualAvailable,
      
      // ENHANCED: Detailed breakdown for debugging
      shareBreakdown: {
        totalRegularShares: shareConfig.totalShares,
        directRegularSharesSold: totalDirectSharesSold,
        coFounderSharesSold: coFounderSharesSold,
        equivalentRegularFromCoFounder: equivalentRegularSharesFromCoFounder,
        totalEffectiveSharesSold: totalEffectiveSharesSold,
        actualRemaining: totalActualAvailable,
        
        // Tier-specific breakdown
        tierBreakdown: {
          tier1: {
            capacity: shareConfig.currentPrices.tier1.shares,
            directSold: shareConfig.tierSales.tier1Sold,
            coFounderAllocated: coFounderAllocatedToTier1,
            totalUsed: shareConfig.tierSales.tier1Sold + coFounderAllocatedToTier1,
            available: tier1ActualAvailable
          },
          tier2: {
            capacity: shareConfig.currentPrices.tier2.shares,
            directSold: shareConfig.tierSales.tier2Sold,
            coFounderAllocated: coFounderAllocatedToTier2,
            totalUsed: shareConfig.tierSales.tier2Sold + coFounderAllocatedToTier2,
            available: tier2ActualAvailable
          },
          tier3: {
            capacity: shareConfig.currentPrices.tier3.shares,
            directSold: shareConfig.tierSales.tier3Sold,
            coFounderAllocated: coFounderAllocatedToTier3,
            totalUsed: shareConfig.tierSales.tier3Sold + coFounderAllocatedToTier3,
            available: tier3ActualAvailable
          }
        }
      },
      
      coFounderComparison: {
        shareToRegularRatio: shareToRegularRatio,
        explanation: `${shareToRegularRatio} Regular Shares = 1 Co-Founder Share`,
        coFounderPricing: coFounderConfig ? {
          priceNaira: coFounderConfig.pricing.priceNaira,
          priceUSDT: coFounderConfig.pricing.priceUSDT
        } : null,
        coFounderSharesSold: coFounderSharesSold,
        equivalentRegularShares: equivalentRegularSharesFromCoFounder
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


// Calculate purchase details before payment
exports.calculatePurchase = async (req, res) => {
  try {
    const { quantity, currency } = req.body;
    
    if (!quantity || !currency || !['naira', 'usdt'].includes(currency)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid request. Please provide valid quantity and currency (naira or usdt).'
      });
    }
    
    const purchaseDetails = await Share.calculatePurchase(parseInt(quantity), currency);
    
    if (!purchaseDetails.success) {
      return res.status(400).json({
        success: false,
        message: 'Unable to process this purchase amount.',
        details: purchaseDetails
      });
    }
    
    // Get co-founder share ratio for comparison
    const coFounderConfig = await CoFounderShare.findOne();
    const shareToRegularRatio = coFounderConfig?.shareToRegularRatio || 29;
    
    // FIXED: Calculate co-founder share equivalence more clearly
    const totalRegularShares = purchaseDetails.totalShares;
    const equivalentCoFounderShares = Math.floor(totalRegularShares / shareToRegularRatio);
    const remainingRegularShares = totalRegularShares % shareToRegularRatio;
    
    // Enhanced purchase details with co-founder comparison
    const enhancedPurchaseDetails = {
      ...purchaseDetails,
      coFounderEquivalence: {
        equivalentCoFounderShares: equivalentCoFounderShares,
        remainingRegularShares: remainingRegularShares,
        shareToRegularRatio: shareToRegularRatio,
        explanation: equivalentCoFounderShares > 0 ? 
          `${totalRegularShares} regular shares = ${equivalentCoFounderShares} co-founder share${equivalentCoFounderShares !== 1 ? 's' : ''}${remainingRegularShares > 0 ? ` + ${remainingRegularShares} regular share${remainingRegularShares !== 1 ? 's' : ''}` : ''}` :
          `${totalRegularShares} regular share${totalRegularShares !== 1 ? 's' : ''} (need ${shareToRegularRatio - totalRegularShares} more for 1 co-founder share equivalent)`,
        comparisonNote: `Note: ${shareToRegularRatio} regular shares = 1 co-founder share in terms of value and voting power`
      }
    };
    
    res.status(200).json({
      success: true,
      purchaseDetails: enhancedPurchaseDetails
    });
  } catch (error) {
    console.error('Error calculating purchase:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to calculate purchase details',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Initiate PayStack payment
exports.initiatePaystackPayment = async (req, res) => {
  try {
    const { quantity, email } = req.body;
    const userId = req.user.id; // From auth middleware
    
    if (!quantity || !email) {
      return res.status(400).json({
        success: false,
        message: 'Please provide quantity and email'
      });
    }
    
    // Calculate purchase amount
    const purchaseDetails = await Share.calculatePurchase(parseInt(quantity), 'naira');
    
    if (!purchaseDetails.success) {
      return res.status(400).json({
        success: false,
        message: 'Unable to process this purchase amount',
        details: purchaseDetails
      });
    }
    
    // Generate transaction ID
    const transactionId = generateTransactionId();
    
    // Create PayStack request
    const paystackRequest = {
      email,
      amount: purchaseDetails.totalPrice * 100, // Convert to kobo
      reference: transactionId,
      callback_url: `${process.env.FRONTEND_URL}/payment/verify?txref=${transactionId}`,
      metadata: {
        userId,
        shares: purchaseDetails.totalShares,
        tierBreakdown: purchaseDetails.tierBreakdown,
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
    
    // Record the pending transaction
    await UserShare.addShares(userId, purchaseDetails.totalShares, {
      transactionId,
      shares: purchaseDetails.totalShares,
      pricePerShare: purchaseDetails.totalPrice / purchaseDetails.totalShares,
      currency: 'naira',
      totalAmount: purchaseDetails.totalPrice,
      paymentMethod: 'paystack',
      status: 'pending',
      tierBreakdown: purchaseDetails.tierBreakdown
    });
    
    // Return success with payment URL
    res.status(200).json({
      success: true,
      message: 'Payment initialized successfully',
      data: {
        authorization_url: paystackResponse.data.data.authorization_url,
        reference: transactionId,
        amount: purchaseDetails.totalPrice
      }
    });
  } catch (error) {
    console.error('Error initiating PayStack payment:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to initiate payment',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
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


// Admin: Get all transactions
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
    const { status, page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    // Build query
    const query = {};
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
        // Only include transactions matching status filter
        if (status && transaction.status !== status) {
          continue;
        }
        
        // FIXED: Clean up payment method display
        let displayPaymentMethod = transaction.paymentMethod;
        if (transaction.paymentMethod.startsWith('manual_')) {
          displayPaymentMethod = transaction.paymentMethod.replace('manual_', '');
        }
        
        // FIXED: Correct payment proof URL using static file serving
        let paymentProofUrl = null;
        if (transaction.paymentProofPath) {
          // Extract just the filename from the path
          const path = require('path');
          const filename = path.basename(transaction.paymentProofPath);
          // Use the static file serving endpoint
          paymentProofUrl = `/uploads/payment-proofs/${filename}`;
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
          paymentProofUrl: paymentProofUrl, // FIXED: Now points to static files
          manualPaymentDetails: transaction.manualPaymentDetails || {},
          adminNote: transaction.adminNote,
          txHash: transaction.txHash
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

/**
 * @desc    Verify and process a web3 transaction
 * @route   POST /api/shares/web3/verify
 * @access  Private (User)
 */
exports.verifyWeb3Transaction = async (req, res) => {
  try {
    const { quantity, txHash, walletAddress } = req.body;
    const userId = req.user.id;

    // Validate input
    if (!quantity || !txHash || !walletAddress) {
      return res.status(400).json({
        success: false,
        message: 'Please provide all required fields'
      });
    }

    // Calculate purchase details
    const purchaseDetails = await Share.calculatePurchase(parseInt(quantity), 'usdt');
    
    if (!purchaseDetails.success) {
      return res.status(400).json({
        success: false,
        message: 'Unable to process this purchase amount',
        details: purchaseDetails
      });
    }

    // Check if transaction already exists
    const existingUserShare = await UserShare.findOne({
      'transactions.txHash': txHash
    });
    
    if (existingUserShare) {
      return res.status(400).json({
        success: false,
        message: 'This transaction has already been processed'
      });
    }

    // Get company wallet address from config
    const config = await SiteConfig.getCurrentConfig();
    const companyWalletAddress = config.companyWalletAddress;
    
    if (!companyWalletAddress) {
      return res.status(400).json({
        success: false,
        message: 'Company wallet address not configured'
      });
    }

    // Verify on blockchain
    let verificationSuccess = false;
    let verificationError = null;
    let paymentAmount = 0;
    
    try {
      // Connect to BSC
      const provider = new ethers.providers.JsonRpcProvider(
        process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org/'
      );
      
      // USDT token address on BSC
      const usdtTokenAddress = '0x55d398326f99059fF775485246999027B3197955';
      
      // Get transaction receipt
      const receipt = await provider.getTransactionReceipt(txHash);
      
      if (!receipt) {
        throw new Error('Transaction not found or still pending');
      }
      
      if (receipt.status !== 1) {
        throw new Error('Transaction failed on blockchain');
      }
      
      // Get transaction details
      const tx = await provider.getTransaction(txHash);
      
      // Verify sender
      if (tx.from.toLowerCase() !== walletAddress.toLowerCase()) {
        throw new Error('Transaction sender does not match');
      }
      
      // Verify this is a transaction to the USDT contract
      if (tx.to.toLowerCase() !== usdtTokenAddress.toLowerCase()) {
        throw new Error('Transaction is not to the USDT token contract');
      }
      
      // Find the Transfer event in the logs
      const transferEvent = receipt.logs.find(log => {
        // Check if log is from USDT contract
        if (log.address.toLowerCase() !== usdtTokenAddress.toLowerCase()) {
          return false;
        }
        
        // Check if has 3 topics (signature + from + to)
        if (log.topics.length !== 3) {
          return false;
        }
        
        // Transfer event signature: keccak256("Transfer(address,address,uint256)")
        const transferEventSignature = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
        
        return log.topics[0].toLowerCase() === transferEventSignature.toLowerCase();
      });
      
      if (!transferEvent) {
        throw new Error('No USDT transfer event found in transaction');
      }
      
      // Extract receiver address from the log (second topic)
      const receiverAddress = '0x' + transferEvent.topics[2].slice(26);
      
      // Verify the receiver is our company wallet
      if (receiverAddress.toLowerCase() !== companyWalletAddress.toLowerCase()) {
        throw new Error('USDT transfer recipient does not match company wallet');
      }
      
      // Decode the amount from the data field
      const amount = ethers.BigNumber.from(transferEvent.data);
      
      // Convert to USDT with 18 decimals
      paymentAmount = parseFloat(ethers.utils.formatUnits(amount, 18));
      
      // Verify the amount (within 2% tolerance)
      const requiredAmount = purchaseDetails.totalPrice;
      const allowedDifference = requiredAmount * 0.02; // 2% difference allowed
      
      if (Math.abs(paymentAmount - requiredAmount) > allowedDifference) {
        throw new Error(`Amount mismatch: Paid ${paymentAmount} USDT, Required ~${requiredAmount} USDT`);
      }
      
      // Verify transaction is not too old (within last 24 hours)
      const txBlock = await provider.getBlock(receipt.blockNumber);
      const txTimestamp = txBlock.timestamp * 1000; // Convert to milliseconds
      const currentTime = Date.now();
      const oneDayInMs = 24 * 60 * 60 * 1000;
      
      if (currentTime - txTimestamp > oneDayInMs) {
        throw new Error('Transaction is too old (more than 24 hours)');
      }
      
      // All checks passed
      verificationSuccess = true;
    } catch (err) {
      verificationError = err.message;
      console.error('Blockchain verification error:', err);
    }

    // Generate transaction ID
    const transactionId = generateTransactionId();
    
    // Set status based on verification result
    const status = verificationSuccess ? 'completed' : 'pending';
    
    // Record the transaction
    await UserShare.addShares(userId, purchaseDetails.totalShares, {
      transactionId,
      shares: purchaseDetails.totalShares,
      pricePerShare: purchaseDetails.totalPrice / purchaseDetails.totalShares,
      currency: 'usdt',
      totalAmount: paymentAmount > 0 ? paymentAmount : purchaseDetails.totalPrice,
      paymentMethod: 'crypto',status,
      txHash,
      tierBreakdown: purchaseDetails.tierBreakdown,
      adminNote: verificationSuccess ? 
        `Auto-verified USDT transaction: ${txHash}` : 
        `Failed auto-verification: ${verificationError}. Transaction Hash: ${txHash}, From Wallet: ${walletAddress}`
    });
    
    // If verification successful, update global share counts AND process referrals
    if (verificationSuccess) {
      const shareConfig = await Share.getCurrentConfig();
      shareConfig.sharesSold += purchaseDetails.totalShares;
      
      // Update tier sales
      shareConfig.tierSales.tier1Sold += purchaseDetails.tierBreakdown.tier1;
      shareConfig.tierSales.tier2Sold += purchaseDetails.tierBreakdown.tier2;
      shareConfig.tierSales.tier3Sold += purchaseDetails.tierBreakdown.tier3;
      
      await shareConfig.save();
      
      // Process referral commissions ONLY for completed transactions
      try {
        // First ensure the transaction is marked as completed
        const referralResult = await processReferralCommission(
          userId,                                                   // userId
          paymentAmount > 0 ? paymentAmount : purchaseDetails.totalPrice,  // purchaseAmount
          'share',                                                 // purchaseType
          transactionId                                            // transactionId
        );
        
        console.log('Referral commission process result:', referralResult);
      } catch (referralError) {
        console.error('Error processing referral commissions:', referralError);
        // Continue with the verification process despite referral error
      }
      
      // Get user details for notification
      const user = await User.findById(userId);
      
      // Send confirmation email to user
      if (user && user.email) {
        try {
          await sendEmail({
            email: user.email,
            subject: 'AfriMobile - Share Purchase Successful',
            html: `
              <h2>Share Purchase Confirmation</h2>
              <p>Dear ${user.name},</p>
              <p>Your purchase of ${purchaseDetails.totalShares} shares for $${paymentAmount.toFixed(2)} USDT has been completed successfully.</p>
              <p>Transaction Hash: ${txHash}</p>
              <p>Thank you for your investment in AfriMobile!</p>
            `
          });
        } catch (emailError) {
          console.error('Failed to send purchase confirmation email:', emailError);
        }
      }
    } else {
      // For pending transactions, we DON'T process referral commissions
      // They'll be processed when the transaction is verified and marked as completed
      
      // Notify admin about pending verification
      const user = await User.findById(userId);
      try {
        const adminEmail = process.env.ADMIN_EMAIL || 'admin@afrimobile.com';
        await sendEmail({
          email: adminEmail,
          subject: 'AfriMobile - New Web3 Payment Needs Verification',
          html: `
            <h2>Web3 Payment Verification Required</h2>
            <p>Automatic verification failed: ${verificationError}</p>
            <p>Transaction details:</p>
            <ul>
              <li>User: ${user.name} (${user.email})</li>
              <li>Transaction ID: ${transactionId}</li>
              <li>Expected Amount: $${purchaseDetails.totalPrice} USDT</li>
              ${paymentAmount > 0 ? `<li>Received Amount: $${paymentAmount.toFixed(2)} USDT</li>` : ''}
              <li>Shares: ${purchaseDetails.totalShares}</li>
              <li>Transaction Hash: ${txHash}</li>
              <li>Wallet Address: ${walletAddress}</li>
            </ul>
            <p>Please verify this transaction in the admin dashboard.</p>
          `
        });
      } catch (emailError) {
        console.error('Failed to send admin notification:', emailError);
      }
    }
    
    // Return response
    res.status(200).json({
      success: true,
      message: verificationSuccess ? 
        'Payment verified and processed successfully' : 
        'Payment submitted for verification',
      data: {
        transactionId,
        shares: purchaseDetails.totalShares,
        amount: paymentAmount > 0 ? paymentAmount : purchaseDetails.totalPrice,
        status,
        verified: verificationSuccess
      }
    });
  } catch (error) {
    console.error('Web3 verification error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during transaction verification',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Helper function to verify USDT transaction on the blockchain
 * @param {string} txHash - Transaction hash
 * @param {string} companyWallet - Company wallet address
 * @param {string} senderWallet - Sender's wallet address
 * @returns {object} Verification result
 */
async function verifyTransactionOnChain(txHash, companyWallet, senderWallet) {
  try {
    // Initialize provider for BSC
    const provider = new ethers.providers.JsonRpcProvider(
      process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org/'
    );
    
    // USDT token address on BSC
    const usdtTokenAddress = '0x55d398326f99059fF775485246999027B3197955';
    
    // Get transaction receipt
    const receipt = await provider.getTransactionReceipt(txHash);
    
    // If no receipt, transaction may be pending
    if (!receipt) {
      return {
        valid: false,
        message: 'Transaction is still pending or not found'
      };
    }
    
    // Get transaction details
    const tx = await provider.getTransaction(txHash);
    
    // Verify transaction status
    if (receipt.status !== 1) {
      return {
        valid: false,
        message: 'Transaction failed on blockchain'
      };
    }
    
    // Verify sender
    if (tx.from.toLowerCase() !== senderWallet.toLowerCase()) {
      return {
        valid: false,
        message: 'Transaction sender does not match'
      };
    }
    
    // For ERC20 transfers, we need to check the logs to verify the transfer
    // ERC20 Transfer event has the following signature:
    // Transfer(address indexed from, address indexed to, uint256 value)
    
    // First, verify this is a transaction to the USDT contract
    if (tx.to.toLowerCase() !== usdtTokenAddress.toLowerCase()) {
      return {
        valid: false,
        message: 'Transaction is not to the USDT token contract'
      };
    }
    
    // Find the Transfer event in the logs
    const transferEvent = receipt.logs.find(log => {
      // Check if this log is from the USDT contract
      if (log.address.toLowerCase() !== usdtTokenAddress.toLowerCase()) {
        return false;
      }
      
      // Check if this has 3 topics (signature + from + to)
      if (log.topics.length !== 3) {
        return false;
      }
      
      // The first topic is the event signature
      // Transfer event signature: keccak256("Transfer(address,address,uint256)")
      const transferEventSignature = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
      
      return log.topics[0].toLowerCase() === transferEventSignature.toLowerCase();
    });
    
    // If no transfer event found
    if (!transferEvent) {
      return {
        valid: false,
        message: 'No USDT transfer event found in transaction'
      };
    }
    
    // Extract receiver address from the log (second topic)
    const receiverAddress = '0x' + transferEvent.topics[2].slice(26);
    
    // Verify the receiver is our company wallet
    if (receiverAddress.toLowerCase() !== companyWallet.toLowerCase()) {
      return {
        valid: false,
        message: 'USDT transfer recipient does not match company wallet'
      };
    }
    
    // Decode the amount from the data field
    const amount = ethers.BigNumber.from(transferEvent.data);
    
    // Verify transaction is not too old (within last 24 hours)
    const txBlock = await provider.getBlock(receipt.blockNumber);
    const txTimestamp = txBlock.timestamp * 1000; // Convert to milliseconds
    const currentTime = Date.now();
    const oneDayInMs = 24 * 60 * 60 * 1000;
    
    if (currentTime - txTimestamp > oneDayInMs) {
      return {
        valid: false,
        message: 'Transaction is too old (more than 24 hours)'
      };
    }
    
    // Transaction passed all checks
    return {
      valid: true,
      amount: amount,
      timestamp: txTimestamp
    };
  } catch (error) {
    console.error('Blockchain verification error:', error);
    return {
      valid: false,
      message: 'Error verifying transaction on blockchain: ' + error.message
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

// Add these functions to the shareController.js file

/**
 * @desc    Submit manual payment proof
 * @route   POST /api/shares/manual/submit
 * @access  Private (User)
 */
exports.submitManualPayment = async (req, res) => {
  try {
    const { quantity, paymentMethod, bankName, accountName, reference, currency } = req.body;
    const userId = req.user.id;
    const paymentProofImage = req.file; // Uploaded file from multer middleware
    
    // Validate required fields
    if (!quantity || !paymentMethod || !paymentProofImage) {
      return res.status(400).json({
        success: false,
        message: 'Please provide quantity, payment method, and payment proof image'
      });
    }
    
    // Validate currency
    if (!currency || !['naira', 'usdt'].includes(currency)) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid currency (naira or usdt)'
      });
    }
    
    // Calculate purchase details
    const purchaseDetails = await Share.calculatePurchase(parseInt(quantity), currency);
    
    if (!purchaseDetails.success) {
      return res.status(400).json({
        success: false,
        message: 'Unable to process this purchase amount',
        details: purchaseDetails
      });
    }
    
    // Generate transaction ID
    const transactionId = generateTransactionId();
    
    // Save payment proof image to storage
    // The file path is already provided by multer (req.file.path)
    const paymentProofPath = paymentProofImage.path;
    
    // Record the transaction as "pending verification"
    await UserShare.addShares(userId, purchaseDetails.totalShares, {
      transactionId,
      shares: purchaseDetails.totalShares,
      pricePerShare: purchaseDetails.totalPrice / purchaseDetails.totalShares,
      currency,
      totalAmount: purchaseDetails.totalPrice,
      paymentMethod: `manual_${paymentMethod}`, // e.g., manual_bank_transfer
      status: 'pending',
      tierBreakdown: purchaseDetails.tierBreakdown,
      paymentProofPath,
      manualPaymentDetails: {
        bankName: bankName || null,
        accountName: accountName || null,
        reference: reference || null
      }
    });
    
    // Get user details
    const user = await User.findById(userId);
    
    // Notify admin about new manual payment
    try {
      const adminEmail = process.env.ADMIN_EMAIL || 'admin@afrimobile.com';
      await sendEmail({
        email: adminEmail,
        subject: 'AfriMobile - New Manual Payment Requires Verification',
        html: `
          <h2>Manual Payment Verification Required</h2>
          <p>A new manual payment has been submitted:</p>
          <ul>
            <li>User: ${user.name} (${user.email})</li>
            <li>Transaction ID: ${transactionId}</li>
            <li>Amount: ${currency === 'naira' ? '₦' : '$'}${purchaseDetails.totalPrice}</li>
            <li>Shares: ${purchaseDetails.totalShares}</li>
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
      message: 'Payment proof submitted successfully and awaiting verification',
      data: {
        transactionId,
        shares: purchaseDetails.totalShares,
        amount: purchaseDetails.totalPrice,
        status: 'pending'
      }
    });
  } catch (error) {
    console.error('Error submitting manual payment:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to submit manual payment',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Admin: Get all manual payment transactions
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
    const { status, page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    // Build query for manual payment methods
    const query = {
      'transactions.paymentMethod': { $regex: '^manual_' }
    };
    
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
        // Only include manual transactions matching status filter
        if (!transaction.paymentMethod.startsWith('manual_') || 
            (status && transaction.status !== status)) {
          continue;
        }
        
        // FIXED: Generate correct payment proof URL
        let paymentProofUrl = null;
        if (transaction.paymentProofPath) {
          const path = require('path');
          const filename = path.basename(transaction.paymentProofPath);
          paymentProofUrl = `/uploads/payment-proofs/${filename}`;
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
          paymentMethod: transaction.paymentMethod.replace('manual_', ''),
          status: transaction.status,
          date: transaction.createdAt,
          paymentProofUrl: paymentProofUrl, // FIXED: Correct URL
          paymentProofPath: transaction.paymentProofPath, // Keep original path for admin
          manualPaymentDetails: transaction.manualPaymentDetails || {},
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
    console.error('Error fetching manual transactions:', error);
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
      shareConfig.tierSales.tier1Sold += transaction.tierBreakdown.tier1 || 0;
      shareConfig.tierSales.tier2Sold += transaction.tierBreakdown.tier2 || 0;
      shareConfig.tierSales.tier3Sold += transaction.tierBreakdown.tier3 || 0;
      
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
          subject: `AfriMobile - Manual Payment ${approved ? 'Approved' : 'Declined'}`,
          html: `
            <h2>Share Purchase ${approved ? 'Confirmation' : 'Update'}</h2>
            <p>Dear ${user.name},</p>
            <p>Your purchase of ${transaction.shares} shares for ${transaction.currency === 'naira' ? '₦' : '$'}${transaction.totalAmount} has been ${approved ? 'verified and completed' : 'declined'}.</p>
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
    
    // Return success
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
 * @desc    Get payment proof image - Fixed for render.com deployments
 * @route   GET /api/shares/payment-proof/:transactionId
 * @access  Private (Admin or transaction owner)
 */
exports.getPaymentProof = async (req, res) => {
  try {
    const { transactionId } = req.params;
    const userId = req.user.id;
    
    console.log(`[getPaymentProof] Request for transaction: ${transactionId} from user: ${userId}`);
    
    // Find the transaction
    const userShareRecord = await UserShare.findOne({
      'transactions.transactionId': transactionId
    });
    
    if (!userShareRecord) {
      console.log(`[getPaymentProof] Transaction not found: ${transactionId}`);
      return res.status(404).json({
        success: false,
        message: 'Transaction not found'
      });
    }
    
    const transaction = userShareRecord.transactions.find(
      t => t.transactionId === transactionId
    );
    
    if (!transaction || !transaction.paymentProofPath) {
      console.log(`[getPaymentProof] Payment proof path not found for transaction: ${transactionId}`);
      return res.status(404).json({
        success: false,
        message: 'Payment proof path not found for this transaction'
      });
    }
    
    console.log(`[getPaymentProof] Original payment proof path: ${transaction.paymentProofPath}`);
    
    // Check if user is admin or transaction owner
    const user = await User.findById(userId);
    if (!(user && (user.isAdmin || userShareRecord.user.toString() === userId))) {
      console.log(`[getPaymentProof] Unauthorized access: ${userId}`);
      return res.status(403).json({
        success: false,
        message: 'Unauthorized: You do not have permission to view this payment proof'
      });
    }

    // Check various possible file paths - special handling for render.com
    const fs = require('fs');
    const path = require('path');
    
    // Create an array of possible paths to check
    const possiblePaths = [];
    
    // 1. Original path as stored in DB
    possiblePaths.push(transaction.paymentProofPath);
    
    // 2. Relative to current working directory
    possiblePaths.push(path.join(process.cwd(), transaction.paymentProofPath));
    
    // 3. If path has 'uploads', extract that part and try both ways
    if (transaction.paymentProofPath.includes('uploads')) {
      const uploadsPart = transaction.paymentProofPath.substring(
        transaction.paymentProofPath.indexOf('uploads')
      );
      possiblePaths.push(path.join(process.cwd(), uploadsPart));
      possiblePaths.push(uploadsPart);
    }
    
    // 4. Try /opt/render/project/src/ path (common for render.com)
    if (process.env.NODE_ENV === 'production') {
      possiblePaths.push(path.join('/opt/render/project/src/', transaction.paymentProofPath));
      
      if (transaction.paymentProofPath.includes('uploads')) {
        const uploadsPart = transaction.paymentProofPath.substring(
          transaction.paymentProofPath.indexOf('uploads')
        );
        possiblePaths.push(path.join('/opt/render/project/src/', uploadsPart));
      }
    }

    // 5. Try /tmp path (render.com sometimes uses this for temp storage)
    if (process.env.NODE_ENV === 'production') {
      possiblePaths.push(path.join('/tmp/', path.basename(transaction.paymentProofPath)));
    }
    
    console.log('[getPaymentProof] Checking possible file paths:', JSON.stringify(possiblePaths));
    
    // Check each path
    let validFilePath = null;
    
    for (const testPath of possiblePaths) {
      try {
        if (fs.existsSync(testPath)) {
          const stats = fs.statSync(testPath);
          if (stats.isFile()) {
            validFilePath = testPath;
            console.log(`[getPaymentProof] Found file at: ${validFilePath}, size: ${stats.size} bytes`);
            break;
          }
        }
      } catch (err) {
        console.log(`[getPaymentProof] Error checking path ${testPath}: ${err.message}`);
      }
    }
    
    if (!validFilePath) {
      console.error('[getPaymentProof] File not found at any checked location');
      
      // Return detailed debugging info in development
      if (process.env.NODE_ENV === 'development') {
        return res.status(404).json({
          success: false,
          message: 'Payment proof file not found on server',
          debug: {
            originalPath: transaction.paymentProofPath,
            checkedPaths: possiblePaths,
            cwd: process.cwd(),
            env: process.env.NODE_ENV,
            platform: process.platform
          }
        });
      } else {
        return res.status(404).json({
          success: false,
          message: 'Payment proof file not found on server'
        });
      }
    }
    
    // Determine content type
    const ext = path.extname(validFilePath).toLowerCase();
    let contentType = 'application/octet-stream'; // Default
    
    if (ext === '.jpg' || ext === '.jpeg') contentType = 'image/jpeg';
    else if (ext === '.png') contentType = 'image/png';
    else if (ext === '.gif') contentType = 'image/gif';
    else if (ext === '.pdf') contentType = 'application/pdf';
    
    console.log(`[getPaymentProof] Serving file with content type: ${contentType}`);
    
    // Send the file
    res.setHeader('Content-Type', contentType);
    fs.createReadStream(validFilePath).pipe(res);
    
  } catch (error) {
    console.error(`[getPaymentProof] Server error: ${error.message}`, error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch payment proof',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
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
 * @desc    Admin: Delete manual payment transaction
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
        message: 'Manual transaction not found'
      });
    }
    
    // Store transaction details for cleanup and notification
    const transactionDetails = {
      shares: transaction.shares,
      totalAmount: transaction.totalAmount,
      currency: transaction.currency,
      status: transaction.status,
      tierBreakdown: transaction.tierBreakdown,
      paymentProofPath: transaction.paymentProofPath
    };
    
    // If transaction was completed, rollback global share counts
    if (transaction.status === 'completed') {
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
        // Continue with the deletion process despite referral error
      }
    }
    
    // Remove the transaction from the user's transactions array
    userShareRecord.transactions = userShareRecord.transactions.filter(
      t => t.transactionId !== transactionId
    );
    
    // Recalculate total shares for the user
    userShareRecord.totalShares = userShareRecord.transactions
      .filter(t => t.status === 'completed')
      .reduce((total, t) => total + t.shares, 0);
    
    await userShareRecord.save();
    
    // Delete payment proof file if it exists
    if (transactionDetails.paymentProofPath) {
      try {
        const fs = require('fs');
        const path = require('path');
        
        // Try multiple possible file paths
        const possiblePaths = [
          transactionDetails.paymentProofPath,
          path.join(process.cwd(), transactionDetails.paymentProofPath),
          path.join('/opt/render/project/src/', transactionDetails.paymentProofPath)
        ];
        
        // If path contains 'uploads', also try that part
        if (transactionDetails.paymentProofPath.includes('uploads')) {
          const uploadsPart = transactionDetails.paymentProofPath.substring(
            transactionDetails.paymentProofPath.indexOf('uploads')
          );
          possiblePaths.push(path.join(process.cwd(), uploadsPart));
          possiblePaths.push(path.join('/opt/render/project/src/', uploadsPart));
        }
        
        let fileDeleted = false;
        for (const filePath of possiblePaths) {
          try {
            if (fs.existsSync(filePath)) {
              fs.unlinkSync(filePath);
              console.log(`Payment proof file deleted: ${filePath}`);
              fileDeleted = true;
              break;
            }
          } catch (deleteErr) {
            console.log(`Failed to delete file at ${filePath}: ${deleteErr.message}`);
          }
        }
        
        if (!fileDeleted) {
          console.log(`Payment proof file not found or already deleted: ${transactionDetails.paymentProofPath}`);
        }
      } catch (fileError) {
        console.error('Error deleting payment proof file:', fileError);
        // Continue with deletion even if file deletion fails
      }
    }
    
    // Get user details for notification
    const user = await User.findById(userShareRecord.user);
    
    // Notify user about transaction deletion
    if (user && user.email) {
      try {
        await sendEmail({
          email: user.email,
          subject: 'AfriMobile - Transaction Deleted',
          html: `
            <h2>Transaction Deletion Notice</h2>
            <p>Dear ${user.name},</p>
            <p>We are writing to inform you that your manual payment transaction has been deleted from our system.</p>
            <p>Transaction Details:</p>
            <ul>
              <li>Transaction ID: ${transactionId}</li>
              <li>Shares: ${transactionDetails.shares}</li>
              <li>Amount: ${transactionDetails.currency === 'naira' ? '₦' : '$'}${transactionDetails.totalAmount}</li>
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
        console.error('Failed to send transaction deletion notification email:', emailError);
      }
    }
    
    // Log the deletion for audit purposes
    console.log(`Manual payment transaction deleted:`, {
      transactionId,
      adminId,
      userId: userShareRecord.user,
      previousStatus: transactionDetails.status,
      shares: transactionDetails.shares,
      amount: transactionDetails.totalAmount,
      currency: transactionDetails.currency,
      timestamp: new Date().toISOString()
    });
    
    // Return success response
    res.status(200).json({
      success: true,
      message: 'Manual payment transaction deleted successfully',
      data: {
        transactionId,
        deletedTransaction: {
          shares: transactionDetails.shares,
          amount: transactionDetails.totalAmount,
          currency: transactionDetails.currency,
          previousStatus: transactionDetails.status
        },
        userUpdates: {
          newTotalShares: userShareRecord.totalShares,
          sharesRemoved: transactionDetails.status === 'completed' ? transactionDetails.shares : 0
        }
      }
    });
  } catch (error) {
    console.error('Error deleting manual payment transaction:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete manual payment transaction',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Add this function to the end of your shareController.js file, before the module.exports

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