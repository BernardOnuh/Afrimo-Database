// controller/shareController.js
const Share = require('../models/Share');
const UserShare = require('../models/UserShare');
const User = require('../models/User');
const crypto = require('crypto');
const axios = require('axios');
const { ethers } = require('ethers');
const { sendEmail } = require('../utils/emailService');
const SiteConfig = require('../models/SiteConfig');
const { processReferralCommission } = require('../utils/referralUtils');

// Generate a unique transaction ID
const generateTransactionId = () => {
  return `TXN-${crypto.randomBytes(4).toString('hex').toUpperCase()}-${Date.now().toString().slice(-6)}`;
};

// Get current share pricing and availability
exports.getShareInfo = async (req, res) => {
  try {
    const shareConfig = await Share.getCurrentConfig();
    
    const response = {
      success: true,
      pricing: shareConfig.currentPrices,
      availability: {
        tier1: shareConfig.currentPrices.tier1.shares - shareConfig.tierSales.tier1Sold,
        tier2: shareConfig.currentPrices.tier2.shares - shareConfig.tierSales.tier2Sold,
        tier3: shareConfig.currentPrices.tier3.shares - shareConfig.tierSales.tier3Sold,
      },
      totalAvailable: shareConfig.totalShares - shareConfig.sharesSold
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
    
    res.status(200).json({
      success: true,
      purchaseDetails
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
          userShareRecord.user,
          reference,
          transaction.totalAmount,
          transaction.currency,
          'share',
          'UserShare'
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
          userId,
          transactionId,
          priceNaira * parseInt(shares),
          'naira',
          'share',
          'UserShare'
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
    const userId = req.user.id; // From auth middleware
    
    const userShares = await UserShare.findOne({ user: userId });
    
    if (!userShares) {
      return res.status(200).json({
        success: true,
        totalShares: 0,
        transactions: []
      });
    }
    
    res.status(200).json({
      success: true,
      totalShares: userShares.totalShares,
      transactions: userShares.transactions.map(t => ({
        transactionId: t.transactionId,
        shares: t.shares,
        pricePerShare: t.pricePerShare,
        currency: t.currency,
        totalAmount: t.totalAmount,
        paymentMethod: t.paymentMethod,
        status: t.status,
        date: t.createdAt,
        adminAction: t.adminAction || false
      }))
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
    const adminId = req.user.id; // From auth middleware
    
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
        
        transactions.push({
          transactionId: transaction.transactionId,
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
          paymentMethod: transaction.paymentMethod,
          status: transaction.status,
          date: transaction.createdAt,
          adminAction: transaction.adminAction || false,
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
    const adminId = req.user.id; // From auth middleware
    
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
        pendingTransactions
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
          userId,
          transactionId,  // Use transactionId for consistency
          paymentAmount > 0 ? paymentAmount : purchaseDetails.totalPrice,
          'usdt',
          'share',
          'UserShare'
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
            userShareRecord.user,
            transactionId,
            transaction.totalAmount,
            transaction.currency,
            'share',
            'UserShare'
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
          paymentProofPath: transaction.paymentProofPath,
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
            userShareRecord.user,
            transactionId,
            transaction.totalAmount,
            transaction.currency,
            'share',
            'UserShare'
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
 * @desc    Get payment proof image
 * @route   GET /api/shares/payment-proof/:transactionId
 * @access  Private (Admin or transaction owner)
 */
exports.getPaymentProof = async (req, res) => {
  try {
    const { transactionId } = req.params;
    const userId = req.user.id;
    
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
      t => t.transactionId === transactionId
    );
    
    if (!transaction || !transaction.paymentProofPath) {
      return res.status(404).json({
        success: false,
        message: 'Payment proof not found for this transaction'
      });
    }
    
    // Check if user is admin or transaction owner
    const user = await User.findById(userId);
    if (!(user && (user.isAdmin || userShareRecord.user.toString() === userId))) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized: You do not have permission to view this payment proof'
      });
    }
    
    // Send the file
    res.sendFile(transaction.paymentProofPath, { root: process.cwd() });
    
  } catch (error) {
    console.error('Error fetching payment proof:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch payment proof',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};
