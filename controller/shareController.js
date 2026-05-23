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

exports.getShareInfo = async (req, res) => {
  try {
    const SharePackage = require('../models/SharePackage');
    const packages = await SharePackage.find({ type: 'share', active: true }).sort({ priceNaira: 1 });
    res.json({ success: true, packages });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};


exports.calculatePurchase = async (req, res) => {
  try {
    const SharePackage = require('../models/SharePackage');
    const { packageId, currency } = req.body;

    if (!packageId || !currency) {
      return res.status(400).json({ success: false, message: 'packageId and currency are required' });
    }

    const pkg = await SharePackage.findById(packageId);
    if (!pkg || !pkg.active || pkg.type !== 'share') {
      return res.status(400).json({ success: false, message: 'Invalid package' });
    }

    const price = currency === 'naira' ? pkg.priceNaira : pkg.priceUSDT;
    if (!price) {
      return res.status(400).json({ success: false, message: `Package not available in ${currency}` });
    }

    res.json({
      success: true,
      packageLabel: pkg.label,
      price,
      currency,
      ownershipPct: pkg.ownershipPct,
      earningKobo: pkg.earningKobo
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
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




// Admin: Update share pricing
exports.updateSharePricing = async (req, res) => {
  try {
    const { tier, priceNaira, priceUSDT, percentPerShare, capacity } = req.body;
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
      priceUSDT ? parseInt(priceUSDT) : undefined,
      percentPerShare ? parseFloat(percentPerShare) : undefined,
      capacity ? parseInt(capacity) : undefined
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
    const record = await UserShare.findOne({ user: userId });

    if (!record) {
      return res.json({
        success: true,
        totalOwnershipPct: 0,
        totalEarningKobo: 0,
        formattedOwnership: '0.0000000%',
        transactions: []
      });
    }

    const summary = record.getOwnershipSummary();

    res.json({
      success: true,
      totalOwnershipPct: record.totalOwnershipPct,
      totalEarningKobo: record.totalEarningKobo,
      formattedOwnership: record.totalOwnershipPct.toFixed(7) + '%',
      breakdown: summary.breakdown,
      transactions: record.transactions
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .map(t => ({
          transactionId: t.transactionId,
          type: t.type,
          packageLabel: t.packageLabel,
          ownershipPct: t.ownershipPct,
          earningKobo: t.earningKobo,
          amount: t.amount,
          currency: t.currency,
          paymentMethod: t.paymentMethod?.replace('manual_', ''),
          status: t.status,
          date: t.createdAt
        }))
    });

  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
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



/**
 * @desc    Submit manual payment proof - Updated for Cloudinary
 * @route   POST /api/shares/manual/submit
 * @access  Private (User)
 */
// shareController.js - Fixed submitManualPayment function
exports.submitManualPayment = async (req, res) => {
  try {
    const { packageId, currency, paymentMethod, bankName, accountName, reference } = req.body;
    const userId = req.user.id;

    // Auth check
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    // File check
    if (!req.file || !req.file.path) {
      return res.status(400).json({ success: false, message: 'Payment proof is required' });
    }

    // Get package
    const SharePackage = require('../models/SharePackage');
    const pkg = await SharePackage.findById(packageId);
    if (!pkg || !pkg.active || pkg.type !== 'share') {
      return res.status(400).json({ success: false, message: 'Invalid package' });
    }

    const priceAmount = currency === 'naira' ? pkg.priceNaira : pkg.priceUSDT;
    if (!priceAmount) {
      return res.status(400).json({ success: false, message: `Package not available in ${currency}` });
    }

    // Check for existing pending
    const existing = await PaymentTransaction.findOne({
      userId,
      type: 'share',
      status: 'pending'
    });
    if (existing) {
      return res.status(400).json({
        success: false,
        message: 'You already have a pending payment awaiting approval',
        pendingTransaction: {
          transactionId: existing.transactionId,
          amount: existing.amount,
          packageLabel: existing.packageLabel,
          date: existing.createdAt
        }
      });
    }

    const transactionId = `TXN-${crypto.randomBytes(4).toString('hex').toUpperCase()}-${Date.now().toString().slice(-6)}`;

    const txData = {
      transactionId,
      type: 'share',
      packageId: pkg._id,
      packageLabel: pkg.label,
      ownershipPct: pkg.ownershipPct,
      earningKobo: pkg.earningKobo,
      amount: priceAmount,
      currency,
      paymentMethod: `manual_${paymentMethod}`,
      status: 'pending',
      manualPaymentDetails: { bankName, accountName, reference },
      paymentProofPath: req.file.path,
      paymentProofCloudinaryUrl: req.file.path,
      paymentProofCloudinaryId: req.file.filename,
      paymentProofOriginalName: req.file.originalname,
      paymentProofFileSize: req.file.size
    };

    // Save to PaymentTransaction
    await PaymentTransaction.create({ userId, ...txData });

    // Save to UserShare (pending — totals not updated yet)
    await UserShare.addTransaction(userId, txData);

    // Notify admins
    try {
      const user = await User.findById(userId);
      const admins = await User.find({ isAdmin: true, email: { $exists: true } });
      for (const admin of admins) {
        await sendEmail({
          email: admin.email,
          subject: 'New Share Payment Submitted',
          html: `
            <h2>New Manual Payment Requires Review</h2>
            <p><strong>User:</strong> ${user?.name} (${user?.email})</p>
            <p><strong>Transaction ID:</strong> ${transactionId}</p>
            <p><strong>Package:</strong> ${pkg.label}</p>
            <p><strong>Amount:</strong> ${currency === 'naira' ? '₦' : '$'}${priceAmount.toLocaleString()}</p>
            <p><strong>Ownership:</strong> ${pkg.ownershipPct}%</p>
            <p><strong>Proof:</strong> <a href="${req.file.path}">View Proof</a></p>
          `
        });
      }
    } catch (emailErr) {
      console.error('Admin email failed:', emailErr.message);
    }

    res.json({
      success: true,
      message: 'Payment submitted successfully. Awaiting admin verification.',
      data: {
        transactionId,
        packageLabel: pkg.label,
        ownershipPct: pkg.ownershipPct,
        amount: priceAmount,
        currency,
        status: 'pending'
      }
    });

  } catch (error) {
    console.error('submitManualPayment error:', error);
    res.status(500).json({ success: false, message: error.message });
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
    const admin = await User.findById(req.user.id);
    if (!admin?.isAdmin) {
      return res.status(403).json({ success: false, message: 'Admin required' });
    }

    const { status, page = 1, limit = 20, fromDate, toDate } = req.query;

    const query = {
      type: 'share',
      paymentMethod: { $regex: /^manual_/i }
    };

    if (status) query.status = status;
    if (fromDate || toDate) {
      query.createdAt = {};
      if (fromDate) query.createdAt.$gte = new Date(fromDate);
      if (toDate) query.createdAt.$lte = new Date(toDate);
    }

    const transactions = await PaymentTransaction.find(query)
      .populate('userId', 'name email phone username')
      .sort({ createdAt: -1 })
      .skip((parseInt(page) - 1) * parseInt(limit))
      .limit(parseInt(limit));

    const totalCount = await PaymentTransaction.countDocuments(query);

    const formatted = transactions.map(tx => ({
      id: tx._id,
      transactionId: tx.transactionId,
      user: {
        id: tx.userId._id,
        name: tx.userId.name,
        email: tx.userId.email,
        phone: tx.userId.phone
      },
      packageLabel: tx.packageLabel,
      ownershipPct: tx.ownershipPct,
      earningKobo: tx.earningKobo,
      amount: tx.amount,
      currency: tx.currency,
      paymentMethod: tx.paymentMethod?.replace('manual_', ''),
      status: tx.status,
      date: tx.createdAt,
      paymentProof: tx.paymentProofCloudinaryUrl ? {
        directUrl: tx.paymentProofCloudinaryUrl,
        originalName: tx.paymentProofOriginalName
      } : null,
      manualPaymentDetails: tx.manualPaymentDetails || {},
      adminNote: tx.adminNotes
    }));

    res.json({
      success: true,
      transactions: formatted,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalCount / parseInt(limit)),
        totalCount
      }
    });

  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
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

    const admin = await User.findById(req.user.id);
    if (!admin?.isAdmin) {
      return res.status(403).json({ success: false, message: 'Admin required' });
    }

    const tx = await PaymentTransaction.findOne({ transactionId, type: 'share' });
    if (!tx) {
      return res.status(404).json({ success: false, message: 'Transaction not found' });
    }
    if (tx.status !== 'pending') {
      return res.status(400).json({ success: false, message: `Transaction already ${tx.status}` });
    }

    // Update PaymentTransaction
    tx.status = approved ? 'completed' : 'failed';
    tx.adminNotes = adminNote;
    tx.verifiedBy = req.user.id;
    tx.verifiedAt = new Date();
    await tx.save();

    // Update UserShare totals
    if (approved) {
      await UserShare.approveTransaction(tx.userId, transactionId);
      try {
        await processReferralCommission(tx.userId, tx.amount, 'share', transactionId);
      } catch (e) {
        console.error('Referral error:', e.message);
      }
    } else {
      await UserShare.rejectTransaction(tx.userId, transactionId, 'failed');
    }

    // Notify user
    const user = await User.findById(tx.userId);
    if (user?.email) {
      try {
        await sendEmail({
          email: user.email,
          subject: `Share Payment ${approved ? 'Approved' : 'Declined'}`,
          html: `
            <h2>Payment ${approved ? 'Approved ✅' : 'Declined ❌'}</h2>
            <p>Dear ${user.name},</p>
            <p>Your payment of ${tx.currency === 'naira' ? '₦' : '$'}${tx.amount.toLocaleString()} 
            for <strong>${tx.packageLabel}</strong> has been ${approved ? 'approved' : 'declined'}.</p>
            ${approved ? `<p>Ownership added: <strong>+${tx.ownershipPct}%</strong></p>` : ''}
            ${adminNote ? `<p>Note: ${adminNote}</p>` : ''}
          `
        });
      } catch (e) {
        console.error('Email error:', e.message);
      }
    }

    res.json({
      success: true,
      message: `Payment ${approved ? 'approved' : 'declined'} successfully`,
      status: tx.status
    });

  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
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

    const admin = await User.findById(req.user.id);
    if (!admin?.isAdmin) {
      return res.status(403).json({ success: false, message: 'Admin required' });
    }

    const tx = await PaymentTransaction.findOne({ transactionId, type: 'share' });
    if (!tx) {
      return res.status(404).json({ success: false, message: 'Transaction not found' });
    }
    if (tx.status !== 'completed') {
      return res.status(400).json({ success: false, message: `Cannot cancel a transaction that is not completed` });
    }

    // Roll back UserShare totals
    await UserShare.rejectTransaction(tx.userId, transactionId, 'pending');

    // Roll back referral if any
    try {
      await rollbackReferralCommission(tx.userId, transactionId, tx.amount, tx.currency, 'share', 'PaymentTransaction');
    } catch (e) {
      console.error('Referral rollback error:', e.message);
    }

    // Update PaymentTransaction
    tx.status = 'pending';
    tx.adminNotes = `CANCELLED: ${cancelReason || 'Admin cancelled'}`;
    await tx.save();

    // Notify user
    const user = await User.findById(tx.userId);
    if (user?.email) {
      try {
        await sendEmail({
          email: user.email,
          subject: 'Payment Approval Cancelled',
          html: `
            <p>Dear ${user.name},</p>
            <p>Your payment approval for <strong>${tx.packageLabel}</strong> has been temporarily reversed.</p>
            <p>Reason: ${cancelReason || 'Administrative review required'}</p>
            <p>Please contact support for more information.</p>
          `
        });
      } catch (e) {
        console.error('Email error:', e.message);
      }
    }

    res.json({ success: true, message: 'Payment approval cancelled', status: 'pending' });

  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
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
/**
 * Send certificate to user's email as attachment
 * @route   POST /api/shares/certificate/email
 */
exports.sendCertificateEmail = async (req, res) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    const { imageBase64, transactionId, fileName } = req.body;

    if (!imageBase64 || !transactionId) {
      return res.status(400).json({ success: false, message: 'Image data and transaction ID are required' });
    }

    // Get user info
    const User = require('../models/User');
    const user = await User.findById(req.user.id);
    if (!user || !user.email) {
      return res.status(400).json({ success: false, message: 'User email not found' });
    }

    const { sendEmail } = require('../utils/emailService');

    // Remove data URL prefix if present
    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    const certFileName = fileName || `AfriMobile-Certificate-${transactionId}.png`;

    const emailSent = await sendEmail({
      email: user.email,
      subject: `Your AfriMobile Share Certificate - ${transactionId}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="text-align: center; margin-bottom: 20px;">
            <h1 style="color: #7c3aed;">AfriMobile</h1>
          </div>
          <h2 style="color: #333;">Your Share Certificate</h2>
          <p>Dear ${user.name || 'Valued Shareholder'},</p>
          <p>Please find your share certificate attached to this email.</p>
          <p><strong>Transaction ID:</strong> ${transactionId}</p>
          <p>Thank you for investing in AfriMobile Technology Limited.</p>
          <br/>
          <p>Best regards,<br/>AfriMobile Team</p>
        </div>
      `,
      attachments: [{
        filename: certFileName,
        content: base64Data,
        encoding: 'base64',
        contentType: 'image/png'
      }]
    });

    if (emailSent) {
      return res.json({ success: true, message: `Certificate sent to ${user.email}` });
    } else {
      return res.status(500).json({ success: false, message: 'Failed to send email' });
    }
  } catch (error) {
    console.error('[SHARES] Certificate email error:', error);
    return res.status(500).json({ success: false, message: 'Failed to send certificate email' });
  }
};

/**
 * @desc    Admin: Revoke/delete any payment transaction (complete rollback)
 * @route   DELETE /api/shares/admin/revoke/:transactionId
 * @access  Private (Admin)
 */
exports.adminRevokeTransaction = async (req, res) => {
  try {
    const { transactionId } = req.params;
    const { reason } = req.body;
    const adminId = req.user.id;

    // Check if admin
    const admin = await User.findById(adminId);
    if (!admin || !admin.isAdmin) {
      return res.status(403).json({ success: false, message: 'Unauthorized: Admin access required' });
    }

    if (!transactionId) {
      return res.status(400).json({ success: false, message: 'Transaction ID is required' });
    }

    // Find in PaymentTransaction
    const paymentTransaction = await PaymentTransaction.findOne({ transactionId });

    // Find in UserShare
    const userShareRecord = await UserShare.findOne({ 'transactions.transactionId': transactionId });

    if (!paymentTransaction && !userShareRecord) {
      return res.status(404).json({ success: false, message: 'Transaction not found' });
    }

    let transactionDetails = {};
    let userId = null;

    if (paymentTransaction) {
      transactionDetails = {
        shares: paymentTransaction.shares,
        amount: paymentTransaction.amount,
        currency: paymentTransaction.currency,
        status: paymentTransaction.status,
        tierBreakdown: paymentTransaction.tierBreakdown,
      };
      userId = paymentTransaction.userId;
    }

    if (userShareRecord) {
      const tx = userShareRecord.transactions.find(t => t.transactionId === transactionId);
      if (tx && !transactionDetails.shares) {
        transactionDetails = {
          shares: tx.shares,
          amount: tx.totalAmount,
          currency: tx.currency,
          status: tx.status,
          tierBreakdown: tx.tierBreakdown,
        };
        userId = userShareRecord.user;
      }
    }

    // Rollback global share counts if completed
    if (transactionDetails.status === 'completed') {
      const shareConfig = await Share.getCurrentConfig();
      shareConfig.sharesSold = Math.max(0, shareConfig.sharesSold - (transactionDetails.shares || 0));

      if (transactionDetails.tierBreakdown) {
        shareConfig.tierSales.tier1Sold = Math.max(0, shareConfig.tierSales.tier1Sold - (transactionDetails.tierBreakdown.tier1 || 0));
        shareConfig.tierSales.tier2Sold = Math.max(0, shareConfig.tierSales.tier2Sold - (transactionDetails.tierBreakdown.tier2 || 0));
        shareConfig.tierSales.tier3Sold = Math.max(0, shareConfig.tierSales.tier3Sold - (transactionDetails.tierBreakdown.tier3 || 0));
      }

      // Rollback percentage sold
      // (percentPerShare * shares if available)
      await shareConfig.save();

      // Rollback referral commissions
      try {
        await rollbackReferralCommission(userId, transactionId, transactionDetails.amount, transactionDetails.currency, 'share', 'UserShare');
      } catch (e) {
        console.error('Referral rollback error:', e);
      }
    }

    // Delete from PaymentTransaction
    if (paymentTransaction) {
      // Delete cloudinary file if exists
      if (paymentTransaction.paymentProofCloudinaryId) {
        try { await deleteFromCloudinary(paymentTransaction.paymentProofCloudinaryId); } catch (e) { console.error('Cloudinary delete error:', e); }
      }
      await PaymentTransaction.deleteOne({ _id: paymentTransaction._id });
    }

    // Remove from UserShare
    if (userShareRecord) {
      userShareRecord.transactions = userShareRecord.transactions.filter(t => t.transactionId !== transactionId);
      userShareRecord.totalShares = userShareRecord.transactions
        .filter(t => t.status === 'completed' && t.paymentMethod !== 'co-founder')
        .reduce((total, t) => total + (t.shares || 0), 0);
      userShareRecord.coFounderShares = userShareRecord.transactions
        .filter(t => t.status === 'completed' && t.paymentMethod === 'co-founder')
        .reduce((total, t) => total + (t.coFounderShares || 0), 0);
      await userShareRecord.save();
    }

    // Notify user
    if (userId) {
      const user = await User.findById(userId);
      if (user && user.email) {
        try {
          await sendEmail({
            email: user.email,
            subject: 'AfriMobile - Transaction Revoked',
            html: `
              <h2>Transaction Revocation Notice</h2>
              <p>Dear ${user.name},</p>
              <p>Your transaction <strong>${transactionId}</strong> has been revoked by an administrator.</p>
              <p>Shares: ${transactionDetails.shares || 0}</p>
              <p>Amount: ${transactionDetails.currency === 'naira' ? '₦' : '$'}${transactionDetails.amount || 0}</p>
              ${reason ? `<p>Reason: ${reason}</p>` : ''}
              <p>If you have questions, please contact support.</p>
            `
          });
        } catch (e) { console.error('Email error:', e); }
      }
    }

    console.log(`[REVOKE] Transaction ${transactionId} revoked by admin ${adminId}. Reason: ${reason || 'N/A'}`);

    res.status(200).json({
      success: true,
      message: 'Transaction revoked successfully. Shares and commissions rolled back.',
      data: { transactionId, ...transactionDetails }
    });
  } catch (error) {
    console.error('Error revoking transaction:', error);
    res.status(500).json({ success: false, message: 'Failed to revoke transaction', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
  }
};

/**
 * @desc    Check if user has a pending manual payment
 * @route   GET /api/shares/user/pending-payment
 * @access  Private (User)
 */
exports.checkPendingPayment = async (req, res) => {
  try {
    const userId = req.user.id;

    // Check in PaymentTransaction
    const pendingPaymentTx = await PaymentTransaction.findOne({
      userId,
      type: 'share',
      paymentMethod: { $regex: '^manual_' },
      status: 'pending'
    });

    if (pendingPaymentTx) {
      return res.status(200).json({
        success: true,
        hasPending: true,
        pendingTransaction: {
          transactionId: pendingPaymentTx.transactionId,
          amount: pendingPaymentTx.amount,
          shares: pendingPaymentTx.shares,
          currency: pendingPaymentTx.currency,
          date: pendingPaymentTx.createdAt,
          status: 'pending'
        }
      });
    }

    // Also check UserShare
    const userShares = await UserShare.findOne({
      user: userId,
      'transactions.status': 'pending',
      'transactions.paymentMethod': { $regex: '^manual_' }
    });

    if (userShares) {
      const pendingTx = userShares.transactions.find(t => t.status === 'pending' && t.paymentMethod.startsWith('manual_'));
      if (pendingTx) {
        return res.status(200).json({
          success: true,
          hasPending: true,
          pendingTransaction: {
            transactionId: pendingTx.transactionId,
            amount: pendingTx.totalAmount,
            shares: pendingTx.shares,
            currency: pendingTx.currency,
            date: pendingTx.createdAt,
            status: 'pending'
          }
        });
      }
    }

    res.status(200).json({ success: true, hasPending: false });
  } catch (error) {
    console.error('Error checking pending payment:', error);
    res.status(500).json({ success: false, message: 'Failed to check pending payment' });
  }
};


exports.createTier = async (req, res) => {
  try {
    const { tier, priceNaira, priceUSDT, capacity, percentPerShare } = req.body;
    const admin = await User.findById(req.user.id);
    if (!admin || !admin.isAdmin) return res.status(403).json({ success: false, message: 'Admin required' });
    if (!tier || !priceNaira) return res.status(400).json({ success: false, message: 'tier and priceNaira are required' });

    const shareConfig = await Share.getCurrentConfig();
    if (!shareConfig.currentPrices) shareConfig.currentPrices = {};
    if (!shareConfig.tierSales) shareConfig.tierSales = {};
    if (!shareConfig.totalTierShares) shareConfig.totalTierShares = {};

    shareConfig.currentPrices[tier] = {
      priceNaira: parseInt(priceNaira),
      priceUSDT: priceUSDT ? parseFloat(priceUSDT) : 0,
      percentPerShare: percentPerShare ? parseFloat(percentPerShare) : 0
    };
    shareConfig.tierSales[tier + 'Sold'] = 0;
    shareConfig.totalTierShares[tier] = capacity ? parseInt(capacity) : 0;

    shareConfig.markModified('currentPrices');
    shareConfig.markModified('tierSales');
    shareConfig.markModified('totalTierShares');
    await shareConfig.save();

    res.status(201).json({ success: true, message: 'Tier created successfully', tier, config: shareConfig.currentPrices[tier] });
  } catch (error) {
    console.error('Error creating tier:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.deleteTier = async (req, res) => {
  try {
    const { tier } = req.params;
    const admin = await User.findById(req.user.id);
    if (!admin || !admin.isAdmin) return res.status(403).json({ success: false, message: 'Admin required' });

    const shareConfig = await Share.getCurrentConfig();
    const soldKey = tier + 'Sold';

    if (shareConfig.tierSales && shareConfig.tierSales[soldKey] > 0) {
      return res.status(400).json({ success: false, message: 'Cannot delete a tier that has existing sales' });
    }

    if (shareConfig.currentPrices) {
      delete shareConfig.currentPrices[tier];
      shareConfig.markModified('currentPrices');
    }
    if (shareConfig.tierSales) {
      delete shareConfig.tierSales[soldKey];
      shareConfig.markModified('tierSales');
    }
    if (shareConfig.totalTierShares) {
      delete shareConfig.totalTierShares[tier];
      shareConfig.markModified('totalTierShares');
    }

    await shareConfig.save();
    res.status(200).json({ success: true, message: 'Tier deleted successfully', tier });
  } catch (error) {
    console.error('Error deleting tier:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.adminUpdateUserShares = async (req, res) => {
  try {
    const admin = await User.findById(req.user.id);
    if (!admin || !admin.isAdmin) return res.status(403).json({ success: false, message: 'Admin required' });

    const { userId } = req.params;
    const { regular, cofounder, tier1, tier2, tier3, adminNote } = req.body;

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    let userShare = await UserShare.findOne({ user: userId });
    if (!userShare) userShare = new UserShare({ user: userId, transactions: [], totalShares: 0 });

    const transactionId = 'ADM-' + crypto.randomBytes(4).toString('hex').toUpperCase() + '-' + Date.now().toString().slice(-6);

    userShare.totalShares = (parseInt(regular) || 0) + (parseInt(cofounder) || 0);
    userShare.transactions.push({
      transactionId,
      shares: parseInt(regular) || 0,
      coFounderShares: parseInt(cofounder) || 0,
      currency: 'naira',
      totalAmount: 0,
      paymentMethod: 'admin_override',
      status: 'completed',
      adminAction: true,
      adminNote: adminNote || 'Direct share count override by admin',
      tierBreakdown: {
        tier1: parseInt(tier1) || 0,
        tier2: parseInt(tier2) || 0,
        tier3: parseInt(tier3) || 0
      }
    });

    await userShare.save();
    res.status(200).json({ success: true, message: 'User shares updated successfully', userId, shares: { regular, cofounder } });
  } catch (error) {
    console.error('Error updating user shares:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.adminEditTransaction = async (req, res) => {
  try {
    const admin = await User.findById(req.user.id);
    if (!admin || !admin.isAdmin) return res.status(403).json({ success: false, message: 'Admin required' });

    const { transactionId } = req.params;
    const { status, shares, adminNote, type } = req.body;

    let updated = false;

    const paymentTx = await PaymentTransaction.findOne({ transactionId });
    if (paymentTx) {
      if (status) paymentTx.status = status;
      if (shares) paymentTx.shares = parseInt(shares);
      if (adminNote) paymentTx.adminNotes = adminNote;
      if (type) paymentTx.type = type;
      paymentTx.verifiedBy = req.user.id;
      paymentTx.verifiedAt = new Date();
      await paymentTx.save();
      updated = true;
    }

    const userShare = await UserShare.findOne({ 'transactions.transactionId': transactionId });
    if (userShare) {
      const tx = userShare.transactions.find(t => t.transactionId === transactionId);
      if (tx) {
        if (status) tx.status = status;
        if (shares) tx.shares = parseInt(shares);
        if (adminNote) tx.adminNote = adminNote;
        await userShare.save();
        updated = true;
      }
    }

    if (!updated) return res.status(404).json({ success: false, message: 'Transaction not found' });

    res.status(200).json({ success: true, message: 'Transaction updated successfully', transactionId });
  } catch (error) {
    console.error('Error editing transaction:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};
