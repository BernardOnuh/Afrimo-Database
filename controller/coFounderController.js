/**
 * Co-Founder Share Controller
 * Merged: Percentage-Based Allocation + Full Payment/Transaction Management
 */

const CoFounderShare = require('../models/CoFounderShare');
const Share = require('../models/Share');
const UserShare = require('../models/UserShare');
const PaymentTransaction = require('../models/Transaction');
const PaymentConfig = require('../models/PaymentConfig');
const User = require('../models/User');
const crypto = require('crypto');
const axios = require('axios');
const { ethers } = require('ethers');
const { sendEmail } = require('../utils/emailService');
const { handleCofounderPurchase } = require('./referralController');
const { deleteFromCloudinary } = require('../config/cloudinary');
const { processReferralCommission, rollbackReferralCommission } = require('../utils/referralUtils');

// Generate a unique transaction ID
const generateTransactionId = () => {
    return `CFD-${crypto.randomBytes(4).toString('hex').toUpperCase()}-${Date.now().toString().slice(-6)}`;
};



// ===================================================================
// SHARE INFO & PURCHASE
// ===================================================================

// Get current co-founder share information
const getCoFounderShareInfo = async (req, res) => {
    try {
      const SharePackage = require('../models/SharePackage');
      const packages = await SharePackage.find({ type: 'co-founder', active: true }).sort({ priceNaira: 1 });
      res.json({ success: true, packages });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  };


// Calculate purchase details before payment
const calculateCoFounderPurchase = async (req, res) => {
  try {
    const SharePackage = require('../models/SharePackage');
    const { packageId, currency } = req.body;

    if (!packageId || !currency) {
      return res.status(400).json({ success: false, message: 'packageId and currency are required' });
    }

    const pkg = await SharePackage.findById(packageId);
    if (!pkg || !pkg.active || pkg.type !== 'co-founder') {
      return res.status(400).json({ success: false, message: 'Invalid co-founder package' });
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

// Get payment configuration for co-founder shares
const getPaymentConfig = async (req, res) => {
    try {
        const paymentConfig = await PaymentConfig.getCurrentConfig();
        
        res.status(200).json({
            success: true,
            paymentConfig: {
                companyWalletAddress: paymentConfig.companyWalletAddress,
                acceptedCurrencies: paymentConfig.acceptedCurrencies,
                paymentInstructions: paymentConfig.paymentInstructions
            }
        });
    } catch (error) {
        console.error('Error fetching payment configuration:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch payment configuration',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};



// ===================================================================
// MANUAL PAYMENT
// ===================================================================

/**
 * @desc    Submit co-founder manual payment proof
 * @route   POST /api/cofounder/manual/submit
 * @access  Private (User)
 */
const submitCoFounderManualPayment = async (req, res) => {
    try {
      const { packageId, currency, paymentMethod, bankName, accountName, reference } = req.body;
      const userId = req.user.id;
  
      if (!userId) {
        return res.status(401).json({ success: false, message: 'Authentication required' });
      }
  
      if (!req.file || !req.file.path) {
        return res.status(400).json({ success: false, message: 'Payment proof is required' });
      }
  
      const SharePackage = require('../models/SharePackage');
      const pkg = await SharePackage.findById(packageId);
      if (!pkg || !pkg.active || pkg.type !== 'co-founder') {
        return res.status(400).json({ success: false, message: 'Invalid co-founder package' });
      }
  
      const priceAmount = currency === 'naira' ? pkg.priceNaira : pkg.priceUSDT;
      if (!priceAmount) {
        return res.status(400).json({ success: false, message: `Package not available in ${currency}` });
      }
  
      // Check for existing pending
      const existing = await PaymentTransaction.findOne({
        userId,
        type: 'co-founder',
        status: 'pending'
      });
      if (existing) {
        return res.status(400).json({
          success: false,
          message: 'You already have a pending co-founder payment awaiting approval',
          pendingTransaction: {
            transactionId: existing.transactionId,
            amount: existing.amount,
            packageLabel: existing.packageLabel,
            date: existing.createdAt
          }
        });
      }
  
      const transactionId = `CFD-${crypto.randomBytes(4).toString('hex').toUpperCase()}-${Date.now().toString().slice(-6)}`;
  
      const txData = {
        transactionId,
        type: 'co-founder',
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
            subject: 'New Co-Founder Payment Submitted',
            html: `
              <h2>New Co-Founder Payment Requires Review</h2>
              <p><strong>User:</strong> ${user?.name} (${user?.email})</p>
              <p><strong>Transaction ID:</strong> ${transactionId}</p>
              <p><strong>Package:</strong> ${pkg.label}</p>
              <p><strong>Amount:</strong> ₦${priceAmount.toLocaleString()}</p>
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
        message: 'Co-founder payment submitted successfully. Awaiting admin verification.',
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
      console.error('submitCoFounderManualPayment error:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  };

/**
 * @desc    Get co-founder payment proof from Cloudinary
 * @route   GET /api/cofounder/payment-proof/:transactionId
 * @access  Private (User)
 */
const getCoFounderPaymentProof = async (req, res) => {
    try {
        const { transactionId } = req.params;
        const userId = req.user.id;
        
        const user = await User.findById(userId);
        const isAdmin = user && user.isAdmin;

        const transaction = await PaymentTransaction.findOne({ transactionId, type: 'co-founder' });
        
        if (!transaction) {
            return res.status(404).json({ success: false, message: 'Transaction not found' });
        }
        
        if (!(isAdmin || transaction.userId.toString() === userId)) {
            return res.status(403).json({ success: false, message: 'Access denied' });
        }

        const cloudinaryUrl = transaction.paymentProofCloudinaryUrl;
        if (!cloudinaryUrl) {
            return res.status(404).json({
                success: false,
                message: 'Transaction not found or payment proof not available'
            });
        }

        if (req.query.redirect === 'true' || req.headers.accept?.includes('text/html')) {
            return res.redirect(cloudinaryUrl);
        }

        res.status(200).json({
            success: true,
            cloudinaryUrl,
            publicId: transaction.paymentProofCloudinaryId,
            originalName: transaction.paymentProofOriginalName,
            fileSize: transaction.paymentProofFileSize,
            format: transaction.paymentProofFormat,
            directAccess: "You can access this file directly at the cloudinaryUrl",
            message: "File is hosted on Cloudinary CDN for fast global access",
            viewUrl: `${cloudinaryUrl}?redirect=true`,
            downloadUrl: cloudinaryUrl.includes('upload/') ?
                cloudinaryUrl.replace('upload/', 'upload/fl_attachment/') : cloudinaryUrl,
            thumbnailUrl: cloudinaryUrl.includes('upload/') && transaction.paymentProofFormat !== 'pdf' ?
                cloudinaryUrl.replace('upload/', 'upload/w_300,h_300,c_fit/') : cloudinaryUrl
        });
        
    } catch (error) {
        console.error(`[COFOUNDER getPaymentProof] Server error: ${error.message}`, error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch payment proof',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
};

/**
 * @desc    Get co-founder payment proof direct access (Admin only)
 * @route   GET /api/cofounder/admin/payment-proof/:transactionId
 * @access  Private (Admin)
 */
const getCoFounderPaymentProofDirect = async (req, res) => {
    try {
        const { transactionId } = req.params;
        const userId = req.user.id;
        
        const user = await User.findById(userId);
        if (!user || !user.isAdmin) {
            return res.status(403).json({ success: false, message: 'Admin access required' });
        }
        
        const transaction = await PaymentTransaction.findOne({ transactionId, type: 'co-founder' });
        
        if (!transaction || !transaction.paymentProofCloudinaryUrl) {
            return res.status(404).json({ success: false, message: 'Payment proof not found' });
        }
        
        res.redirect(transaction.paymentProofCloudinaryUrl);
        
    } catch (error) {
        console.error('Error in co-founder direct payment proof access:', error);
        res.status(500).json({ success: false, message: 'Failed to access payment proof' });
    }
};


// ===================================================================
// USER SHARES
// ===================================================================

const getUserCoFounderShares = async (req, res) => {
    try {
      const userId = req.user.id;
      const record = await UserShare.findOne({ user: userId });
  
      if (!record) {
        return res.json({
          success: true,
          totalOwnershipPct: 0,
          cofounderOwnershipPct: 0,
          totalEarningKobo: 0,
          transactions: []
        });
      }
  
      // Filter only co-founder transactions
      const cofounderTxs = record.transactions.filter(t => t.type === 'co-founder');
      const cofounderOwnershipPct = cofounderTxs
        .filter(t => t.status === 'completed')
        .reduce((sum, t) => sum + t.ownershipPct, 0);
  
      res.json({
        success: true,
        totalOwnershipPct: record.totalOwnershipPct,      // ALL ownership (shares + cofounder)
        cofounderOwnershipPct,                             // just cofounder portion
        totalEarningKobo: record.totalEarningKobo,
        formattedOwnership: record.totalOwnershipPct.toFixed(7) + '%',
        transactions: cofounderTxs
          .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
          .map(t => ({
            transactionId: t.transactionId,
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


// ===================================================================
// ADMIN: MANUAL TRANSACTION MANAGEMENT
// ===================================================================

/**
 * @desc    Admin: Get co-founder manual transactions
 * @route   GET /api/cofounder/admin/manual/transactions
 * @access  Private (Admin)
 */
const adminGetCoFounderManualTransactions = async (req, res) => {
    try {
      const admin = await User.findById(req.user.id);
      if (!admin?.isAdmin) {
        return res.status(403).json({ success: false, message: 'Admin required' });
      }
  
      const { status, page = 1, limit = 20, fromDate, toDate } = req.query;
  
      const query = {
        type: 'co-founder',
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


const adminVerifyCoFounderManualPayment = async (req, res) => {
    try {
      const { transactionId, approved, adminNote } = req.body;
  
      const admin = await User.findById(req.user.id);
      if (!admin?.isAdmin) {
        return res.status(403).json({ success: false, message: 'Admin required' });
      }
  
      const tx = await PaymentTransaction.findOne({ transactionId, type: 'co-founder' });
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
  
      // Update UserShare totals — counts alongside regular shares
      if (approved) {
        await UserShare.approveTransaction(tx.userId, transactionId);
        try {
          await handleCofounderPurchase(tx.userId, tx.amount, tx.ownershipPct, tx._id);
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
            subject: `Co-Founder Payment ${approved ? 'Approved' : 'Declined'}`,
            html: `
              <h2>Payment ${approved ? 'Approved ✅' : 'Declined ❌'}</h2>
              <p>Dear ${user.name},</p>
              <p>Your co-founder payment of ₦${tx.amount.toLocaleString()} 
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


const adminCancelCoFounderManualPayment = async (req, res) => {
  try {
    const { transactionId, cancelReason } = req.body;

    const admin = await User.findById(req.user.id);
    if (!admin?.isAdmin) {
      return res.status(403).json({ success: false, message: 'Admin required' });
    }

    const tx = await PaymentTransaction.findOne({ transactionId, type: 'co-founder' });
    if (!tx) {
      return res.status(404).json({ success: false, message: 'Transaction not found' });
    }
    if (tx.status !== 'completed') {
      return res.status(400).json({ success: false, message: 'Can only cancel completed transactions' });
    }

    // Roll back UserShare totals
    await UserShare.rejectTransaction(tx.userId, transactionId, 'pending');

    // Roll back referral if any
    try {
      await rollbackReferralCommission(
        tx.userId, transactionId, tx.amount,
        tx.currency, 'cofounder', 'PaymentTransaction'
      );
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
          subject: 'Co-Founder Payment Approval Cancelled',
          html: `
            <p>Dear ${user.name},</p>
            <p>Your co-founder payment approval for <strong>${tx.packageLabel}</strong> 
            has been temporarily reversed.</p>
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
 * @desc    Admin: Delete co-founder manual payment transaction with Cloudinary cleanup
 * @route   DELETE /api/cofounder/admin/manual/:transactionId
 * @access  Private (Admin)
 */
const adminDeleteCoFounderManualPayment = async (req, res) => {
    try {
        const { transactionId } = req.params;
        const adminId = req.user.id;
        
        const admin = await User.findById(adminId);
        if (!admin || !admin.isAdmin) {
            return res.status(403).json({ success: false, message: 'Unauthorized: Admin access required' });
        }
        
        if (!transactionId) {
            return res.status(400).json({ success: false, message: 'Transaction ID is required' });
        }
        
        const transaction = await PaymentTransaction.findOne({
            transactionId,
            type: 'co-founder',
            paymentMethod: { $regex: '^manual_' }
        });
        
        if (!transaction) {
            return res.status(404).json({ success: false, message: 'Manual transaction not found' });
        }
        
        const transactionDetails = {
            shares: transaction.shares,
            amount: transaction.amount,
            currency: transaction.currency,
            status: transaction.status,
            userId: transaction.userId,
            cloudinaryId: transaction.paymentProofCloudinaryId,
            cloudinaryUrl: transaction.paymentProofCloudinaryUrl
        };
        
        if (transaction.status === 'completed') {
            const coFounderShare = await CoFounderShare.findOne();
            coFounderShare.sharesSold -= transaction.shares;
            await coFounderShare.save();
            
            try {
                const rollbackResult = await rollbackReferralCommission(
                    transaction.userId, transaction._id, transaction.amount,
                    transaction.currency, 'co-founder', 'PaymentTransaction'
                );
                console.log('Co-founder referral commission rollback result:', rollbackResult);
            } catch (referralError) {
                console.error('Error rolling back co-founder referral commissions:', referralError);
            }
            
            try {
                const userShare = await UserShare.findOne({ user: transaction.userId });
                if (userShare) {
                    userShare.transactions = userShare.transactions.filter(
                        t => t.transactionId !== transaction._id.toString()
                    );
                    userShare.totalShares = userShare.transactions
                        .filter(t => t.status === 'completed')
                        .reduce((total, t) => total + t.shares, 0);
                    await userShare.save();
                }
            } catch (userShareError) {
                console.error('Error updating user shares:', userShareError);
            }
        }
        
        if (transactionDetails.cloudinaryId) {
            try {
                const deleteResult = await deleteFromCloudinary(transactionDetails.cloudinaryId);
                if (deleteResult.result === 'ok') {
                    console.log(`Co-founder payment proof deleted from Cloudinary: ${transactionDetails.cloudinaryId}`);
                }
            } catch (fileError) {
                console.error('Error deleting co-founder payment proof from Cloudinary:', fileError);
            }
        }
        
        await PaymentTransaction.findByIdAndDelete(transaction._id);
        
        const user = await User.findById(transactionDetails.userId);
        if (user && user.email) {
            try {
                await sendEmail({
                    email: user.email,
                    subject: 'Co-Founder Transaction Deleted',
                    html: `
                        <h2>Co-Founder Transaction Deletion Notice</h2>
                        <p>Dear ${user.name},</p>
                        <p>Your co-founder manual payment transaction has been deleted from our system.</p>
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
                        <p>If you believe this was done in error, please contact our support team immediately.</p>
                        <p>Best regards,<br>AfriMobile Team</p>
                    `
                });
            } catch (emailError) {
                console.error('Failed to send co-founder transaction deletion notification email:', emailError);
            }
        }
        
        console.log(`Co-founder manual payment transaction deleted:`, {
            transactionId, adminId,
            userId: transactionDetails.userId,
            previousStatus: transactionDetails.status,
            shares: transactionDetails.shares,
            amount: transactionDetails.amount,
            currency: transactionDetails.currency,
            cloudinaryFileDeleted: !!transactionDetails.cloudinaryId,
            timestamp: new Date().toISOString()
        });
        
        res.status(200).json({
            success: true,
            message: 'Co-founder manual payment transaction deleted successfully',
            data: {
                transactionId,
                deletedTransaction: {
                    shares: transactionDetails.shares,
                    amount: transactionDetails.amount,
                    currency: transactionDetails.currency,
                    previousStatus: transactionDetails.status
                },
                cloudinaryFileDeleted: !!transactionDetails.cloudinaryId
            }
        });
    } catch (error) {
        console.error('Error deleting co-founder manual payment transaction:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete manual payment transaction',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};


// ===================================================================
// ADMIN: SHARE MANAGEMENT
// ===================================================================

const adminAddCoFounderShares = async (req, res) => {
    try {
        const { userId, shares, note } = req.body;
        const adminId = req.user.id;
        
        const admin = await User.findById(adminId);
        if (!admin || !admin.isAdmin) {
            return res.status(403).json({ success: false, message: 'Unauthorized: Admin access required' });
        }
        
        let coFounderShare = await CoFounderShare.findOne();
        if (!coFounderShare) {
            coFounderShare = new CoFounderShare();
            await coFounderShare.save();
        }
        
        const shareToRegularRatio = coFounderShare.shareToRegularRatio || 29;
        
        if (coFounderShare.sharesSold + parseInt(shares) > coFounderShare.totalShares) {
            return res.status(400).json({ success: false, message: 'Insufficient co-founder shares available' });
        }
        
        const transactionId = generateTransactionId();
        const transaction = await PaymentTransaction.create({
            userId,
            type: 'co-founder',
            transactionId,
            shares: parseInt(shares),
            status: 'completed',
            adminNotes: note || 'Admin share allocation',
            paymentMethod: 'co-founder',
            amount: coFounderShare.pricing.priceNaira * parseInt(shares),
            currency: 'naira',
            shareToRegularRatio,
            coFounderShares: parseInt(shares),
            equivalentRegularShares: parseInt(shares) * shareToRegularRatio
        });
        
        await UserShare.addCoFounderShares(userId, parseInt(shares), {
            transactionId: transaction._id,
            shares: parseInt(shares),
            coFounderShares: parseInt(shares),
            equivalentRegularShares: parseInt(shares) * shareToRegularRatio,
            shareToRegularRatio,
            pricePerShare: coFounderShare.pricing.priceNaira,
            currency: 'naira',
            totalAmount: coFounderShare.pricing.priceNaira * parseInt(shares),
            paymentMethod: 'co-founder',
            status: 'completed',
            tierBreakdown: { tier1: 0, tier2: 0, tier3: 0 },
            adminAction: true,
            adminNote: note || 'Admin share allocation'
        });
        
        coFounderShare.sharesSold += parseInt(shares);
        await coFounderShare.save();
        
        try {
            const referralResult = await handleCofounderPurchase(
                userId, coFounderShare.pricing.priceNaira * parseInt(shares), parseInt(shares), transaction._id
            );
            console.log('Co-founder referral commission process result for admin-added shares:', referralResult);
            if (referralResult.success) console.log('Admin-added shares commissions distributed:', referralResult.commissions);
        } catch (referralError) {
            console.error('Error processing co-founder referral commissions for admin-added shares:', referralError);
        }

        const user = await User.findById(userId);
        if (user && user.email) {
            try {
                await sendEmail({
                    email: user.email,
                    subject: 'Co-Founder Shares Allocated',
                    html: `
                        <h2>Co-Founder Shares Allocation</h2>
                        <p>Dear ${user.name},</p>
                        <p>You have been allocated ${shares} co-founder share(s).</p>
                        <p>This is equivalent to ${parseInt(shares) * shareToRegularRatio} regular shares.</p>
                        ${note ? `<p>Note: ${note}</p>` : ''}
                        <p>Thank you for your contribution!</p>
                    `
                });
            } catch (emailError) {
                console.error('Failed to send shares allocation email:', emailError);
            }
        }
        
        res.status(200).json({
            success: true,
            message: `Successfully added ${shares} co-founder shares to user`,
            coFounderShares: parseInt(shares),
            equivalentRegularShares: parseInt(shares) * shareToRegularRatio,
            transaction: transaction._id
        });
    } catch (error) {
        console.error('Error adding co-founder shares:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to add co-founder shares',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

const updateShareToRegularRatio = async (req, res) => {
    try {
        const { ratio } = req.body;
        const adminId = req.user.id;
        
        const admin = await User.findById(adminId);
        if (!admin || !admin.isAdmin) {
            return res.status(403).json({ success: false, message: 'Unauthorized: Admin access required' });
        }
        
        if (!ratio || ratio <= 0 || !Number.isInteger(Number(ratio))) {
            return res.status(400).json({
                success: false,
                message: 'Please provide a valid ratio (must be a positive integer)'
            });
        }
        
        let coFounderShare = await CoFounderShare.findOne();
        if (!coFounderShare) coFounderShare = new CoFounderShare();
        
        const oldRatio = coFounderShare.shareToRegularRatio || 29;
        const newRatio = parseInt(ratio);
        
        coFounderShare.shareToRegularRatio = newRatio;
        await coFounderShare.save();
        
        console.log(`Admin ${adminId} updated share-to-regular ratio from ${oldRatio} to ${newRatio}`);
        
        res.status(200).json({
            success: true,
            message: 'Share to regular ratio updated successfully',
            oldRatio,
            newRatio,
            explanation: `1 Co-Founder Share now equals ${newRatio} Regular Shares`
        });
    } catch (error) {
        console.error('Error updating share to regular ratio:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update ratio',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

const disableCoFounderProgramme = async (req, res) => {
    try {
        const admin = await User.findById(req.user.id);
        if (!admin || !admin.isAdmin) {
            return res.status(403).json({ success: false, message: 'Admin required' });
        }

        let coFounderShare = await CoFounderShare.findOne();
        if (!coFounderShare) {
            return res.status(404).json({ success: false, message: 'Co-founder config not found' });
        }

        coFounderShare.totalShares = 0;
        coFounderShare.disabled = true;
        await coFounderShare.save();

        res.status(200).json({ success: true, message: 'Co-founder programme disabled successfully' });
    } catch (error) {
        console.error('Error disabling co-founder programme:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};




// ===================================================================
// ADMIN: TRANSACTIONS & STATISTICS
// ===================================================================

const getAllCoFounderTransactions = async (req, res) => {
    try {
        const { status, page = 1, limit = 20, paymentMethod, fromDate, toDate } = req.query;
        const adminId = req.user.id;
        
        const admin = await User.findById(adminId);
        if (!admin || !admin.isAdmin) {
            return res.status(403).json({ success: false, message: 'Unauthorized: Admin access required' });
        }
        
        const query = { type: 'co-founder' };
        if (status) query.status = status;
        if (paymentMethod) query.paymentMethod = paymentMethod;
        if (fromDate || toDate) {
            query.createdAt = {};
            if (fromDate) query.createdAt.$gte = new Date(fromDate);
            if (toDate) query.createdAt.$lte = new Date(toDate);
        }
        
        const transactions = await PaymentTransaction.find(query)
            .skip((page - 1) * limit)
            .limit(Number(limit))
            .populate('userId', 'name email')
            .sort({ createdAt: -1 });
        
        const formattedTransactions = transactions.map(transaction => {
            let paymentProofUrl = null;
            if (transaction.paymentProofPath && transaction.transactionId) {
                paymentProofUrl = `/cofounder/payment-proof/${transaction.transactionId}`;
            }
            
            let cleanPaymentMethod = 'unknown';
            if (transaction.paymentMethod) {
                cleanPaymentMethod = typeof transaction.paymentMethod === 'string'
                    ? transaction.paymentMethod.replace('manual_', '')
                    : String(transaction.paymentMethod).replace('manual_', '');
            }
            
            const userData = transaction.userId ? {
                id: transaction.userId._id,
                name: transaction.userId.name || 'Unknown',
                email: transaction.userId.email || 'No email'
            } : { id: 'unknown', name: 'Unknown User', email: 'No email' };
            
            return {
                id: transaction._id,
                transactionId: transaction.transactionId || 'No ID',
                user: userData,
                shares: transaction.shares || 0,
                amount: transaction.amount || 0,
                currency: transaction.currency || 'unknown',
                paymentMethod: cleanPaymentMethod,
                status: transaction.status || 'unknown',
                date: transaction.createdAt,
                paymentProofUrl,
                manualPaymentDetails: transaction.manualPaymentDetails || {},
                adminNotes: transaction.adminNotes || '',
                transactionHash: transaction.transactionHash || null,
                verifiedBy: transaction.verifiedBy || null
            };
        });
        
        const totalCount = await PaymentTransaction.countDocuments(query);
        
        res.status(200).json({
            success: true,
            transactions: formattedTransactions,
            pagination: {
                currentPage: Number(page),
                totalPages: Math.ceil(totalCount / limit),
                totalCount,
                hasNext: Number(page) < Math.ceil(totalCount / limit),
                hasPrev: Number(page) > 1
            }
        });
    } catch (error) {
        console.error('Error fetching co-founder transactions:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch transactions',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
};

const getCoFounderShareStatistics = async (req, res) => {
    try {
        const adminId = req.user.id;
        
        const admin = await User.findById(adminId);
        if (!admin || !admin.isAdmin) {
            return res.status(403).json({ success: false, message: 'Unauthorized: Admin access required' });
        }
        
        const coFounderShare = await CoFounderShare.findOne();
        const shareToRegularRatio = coFounderShare?.shareToRegularRatio || 29;
        
        const investorCount = await PaymentTransaction.countDocuments({
            type: 'co-founder', status: 'completed'
        });
        
        const transactions = await PaymentTransaction.aggregate([
            { $match: { type: 'co-founder', status: 'completed' } },
            {
                $group: {
                    _id: '$currency',
                    totalAmount: { $sum: '$amount' },
                    totalCoFounderShares: { $sum: '$shares' }
                }
            }
        ]);
        
        const totalEquivalentRegularShares = coFounderShare.sharesSold * shareToRegularRatio;
        
        res.status(200).json({
            success: true,
            statistics: {
                totalCoFounderShares: coFounderShare.totalShares,
                coFounderSharesSold: coFounderShare.sharesSold,
                coFounderSharesRemaining: coFounderShare.totalShares - coFounderShare.sharesSold,
                shareToRegularRatio,
                totalEquivalentRegularShares,
                investorCount,
                transactions
            },
            pricing: coFounderShare.pricing,
            ratioExplanation: `Each co-founder share represents ${shareToRegularRatio} regular shares`
        });
    } catch (error) {
        console.error('Error fetching co-founder share statistics:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch share statistics',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};





const getCoFounderManualPaymentStatus = async (req, res) => {
    try {
        const { transactionId } = req.params;
        const userId = req.user.id;
        
        const transaction = await PaymentTransaction.findOne({
            transactionId,
            type: 'co-founder',
            userId
        });
        
        if (!transaction) {
            return res.status(404).json({ success: false, message: 'Transaction not found' });
        }
        
        res.status(200).json({
            success: true,
            transaction: {
                transactionId: transaction.transactionId,
                shares: transaction.shares,
                amount: transaction.amount,
                currency: transaction.currency,
                paymentMethod: transaction.paymentMethod.replace('manual_', ''),
                status: transaction.status,
                date: transaction.createdAt,
                adminNotes: transaction.adminNotes
            }
        });
    } catch (error) {
        console.error('Error getting co-founder manual payment status:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get payment status',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

const getCoFounderPendingManualPayments = async (req, res) => {
    try {
        const { page = 1, limit = 20 } = req.query;
        const adminId = req.user.id;
        
        const admin = await User.findById(adminId);
        if (!admin || !admin.isAdmin) {
            return res.status(403).json({ success: false, message: 'Unauthorized: Admin access required' });
        }
        
        const query = {
            type: 'co-founder',
            paymentMethod: { $regex: '^manual_' },
            status: 'pending'
        };
        
        const transactions = await PaymentTransaction.find(query)
            .skip((page - 1) * limit)
            .limit(Number(limit))
            .populate('userId', 'name email phone')
            .sort({ createdAt: -1 });
        
        const formattedTransactions = transactions.map(transaction => {
            let paymentProofUrl = null;
            if (transaction.paymentProofPath) {
                paymentProofUrl = `/cofounder/payment-proof/${transaction.transactionId}`;
            }
            return {
                transactionId: transaction.transactionId,
                user: {
                    id: transaction.userId._id,
                    name: transaction.userId.name,
                    email: transaction.userId.email,
                    phone: transaction.userId.phone
                },
                shares: transaction.shares,
                amount: transaction.amount,
                currency: transaction.currency,
                paymentMethod: transaction.paymentMethod.replace('manual_', ''),
                status: transaction.status,
                date: transaction.createdAt,
                paymentProofUrl,
                manualPaymentDetails: transaction.manualPaymentDetails || {}
            };
        });
        
        const totalCount = await PaymentTransaction.countDocuments(query);
        
        res.status(200).json({
            success: true,
            transactions: formattedTransactions,
            pagination: {
                currentPage: Number(page),
                totalPages: Math.ceil(totalCount / limit),
                totalCount
            }
        });
    } catch (error) {
        console.error('Error fetching pending co-founder manual payments:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch pending manual payments',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

const approveCoFounderManualPayment = async (req, res) => {
    try {
        const { transactionId } = req.params;
        const { adminNote } = req.body;
        return await adminVerifyCoFounderManualPayment({ ...req, body: { transactionId, approved: true, adminNote } }, res);
    } catch (error) {
        console.error('Error approving co-founder manual payment:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to approve manual payment',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

const rejectCoFounderManualPayment = async (req, res) => {
    try {
        const { transactionId } = req.params;
        const { adminNote } = req.body;
        return await adminVerifyCoFounderManualPayment({ ...req, body: { transactionId, approved: false, adminNote } }, res);
    } catch (error) {
        console.error('Error rejecting co-founder manual payment:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to reject manual payment',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

const getAllCoFounderManualPayments = async (req, res) => {
    try {
        return await adminGetCoFounderManualTransactions(req, res);
    } catch (error) {
        console.error('Error fetching all co-founder manual payments:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch all manual payments',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};


// ===================================================================
// ADMIN: FLEXIBLE USER IDENTIFIER & OVERVIEW
// ===================================================================

const resolveUserIdentifier = async (identifier) => {
    try {
        const isValidObjectId = /^[0-9a-fA-F]{24}$/.test(identifier);
        let user = null;
        if (isValidObjectId) {
            user = await User.findById(identifier);
            if (user) return user;
        }
        user = await User.findOne({ username: { $regex: new RegExp(`^${identifier}$`, 'i') } });
        if (user) return user;
        user = await User.findOne({ email: { $regex: new RegExp(`^${identifier}$`, 'i') } });
        return user || null;
    } catch (error) {
        console.error('Error resolving user identifier:', error);
        return null;
    }
};

/**
 * @desc    Get comprehensive co-founder overview for a specific user (Admin only)
 * @route   GET /api/cofounder/admin/user-overview/:identifier
 * @access  Private (Admin)
 */
const adminGetUserCoFounderOverview = async (req, res) => {
    try {
        const { identifier } = req.params;
        const adminId = req.user.id;
        
        const admin = await User.findById(adminId);
        if (!admin || !admin.isAdmin) {
            return res.status(403).json({ success: false, message: 'Unauthorized: Admin access required' });
        }
        
        const user = await resolveUserIdentifier(identifier);
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found', searchedFor: identifier });
        }
        
        let resolvedBy = 'id';
        if (user._id.toString() !== identifier) {
            if (user.username?.toLowerCase() === identifier.toLowerCase()) resolvedBy = 'username';
            else if (user.email?.toLowerCase() === identifier.toLowerCase()) resolvedBy = 'email';
        }
        
        const coFounderConfig = await CoFounderShare.findOne();
        const shareToRegularRatio = coFounderConfig?.shareToRegularRatio || 29;
        
        const cofounderTransactions = await PaymentTransaction.find({
            userId: user._id,
            type: 'co-founder'
        }).sort({ createdAt: -1 });
        
        const pendingTransactions = cofounderTransactions.filter(t => t.status === 'pending');
        const completedTransactions = cofounderTransactions.filter(t => t.status === 'completed');
        const failedTransactions = cofounderTransactions.filter(t => t.status === 'failed');
        
        const totalCoFounderShares = completedTransactions.reduce((sum, t) => sum + (t.shares || 0), 0);
        const totalEquivalentRegularShares = totalCoFounderShares * shareToRegularRatio;
        const totalSpent = completedTransactions.reduce((sum, t) => sum + (t.amount || 0), 0);
        
        const paymentMethodBreakdown = {};
        cofounderTransactions.forEach(t => {
            const method = t.paymentMethod || 'unknown';
            if (!paymentMethodBreakdown[method]) {
                paymentMethodBreakdown[method] = { count: 0, totalShares: 0, totalAmount: 0, pending: 0, completed: 0, failed: 0 };
            }
            paymentMethodBreakdown[method].count++;
            paymentMethodBreakdown[method].totalShares += t.shares || 0;
            paymentMethodBreakdown[method].totalAmount += t.amount || 0;
            paymentMethodBreakdown[method][t.status]++;
        });
        
        const recentTransactions = cofounderTransactions.slice(0, 10).map(t => ({
            transactionId: t.transactionId,
            shares: t.shares,
            equivalentRegularShares: (t.shares || 0) * shareToRegularRatio,
            amount: t.amount,
            currency: t.currency,
            paymentMethod: t.paymentMethod,
            status: t.status,
            date: t.createdAt,
            hasPaymentProof: !!t.paymentProofPath || !!t.paymentProofCloudinaryUrl,
            adminNotes: t.adminNotes
        }));
        
        const userShare = await UserShare.findOne({ user: user._id });
        const shareBreakdown = userShare ? userShare.getShareBreakdown() : null;
        
        const lastTransaction = cofounderTransactions[0];
        
        res.status(200).json({
            success: true,
            searchInfo: {
                searchedBy: identifier,
                resolvedBy,
                resolvedUser: { id: user._id, username: user.username, name: user.name, email: user.email }
            },
            user: {
                id: user._id, name: user.name, username: user.username, email: user.email,
                phone: user.phone, isAdmin: user.isAdmin, isVerified: user.isVerified,
                createdAt: user.createdAt, wallet: user.wallet
            },
            coFounderSharesSummary: {
                totalCoFounderShares,
                equivalentRegularShares: totalEquivalentRegularShares,
                shareToRegularRatio,
                totalSpent,
                averagePricePerShare: completedTransactions.length > 0 ? totalSpent / totalCoFounderShares : 0
            },
            overallShareBreakdown: shareBreakdown,
            transactionSummary: {
                total: cofounderTransactions.length,
                pending: pendingTransactions.length,
                completed: completedTransactions.length,
                failed: failedTransactions.length,
                byPaymentMethod: paymentMethodBreakdown
            },
            activitySummary: {
                lastTransactionDate: lastTransaction ? lastTransaction.createdAt : null,
                lastTransactionStatus: lastTransaction ? lastTransaction.status : null,
                totalTransactions: cofounderTransactions.length,
                pendingCount: pendingTransactions.length,
                completedCount: completedTransactions.length,
                failedCount: failedTransactions.length
            },
            recentTransactions,
            ratioExplanation: `1 Co-Founder Share = ${shareToRegularRatio} Regular Shares`
        });
    } catch (error) {
        console.error('Error fetching user co-founder overview:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch user co-founder overview',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/**
 * @desc    Admin manually add co-founder shares to a user (flexible identifier)
 * @route   POST /api/cofounder/admin/add-shares
 * @access  Private (Admin)
 */
const adminAddCoFounderSharesFlexible = async (req, res) => {
    try {
        const { userIdentifier, shares, note } = req.body;
        const adminId = req.user.id;
        
        const admin = await User.findById(adminId);
        if (!admin || !admin.isAdmin) {
            return res.status(403).json({ success: false, message: 'Unauthorized: Admin access required' });
        }
        
        const user = await resolveUserIdentifier(userIdentifier);
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found', searchedFor: userIdentifier });
        }
        
        let resolvedBy = 'id';
        if (user._id.toString() !== userIdentifier) {
            if (user.username?.toLowerCase() === userIdentifier.toLowerCase()) resolvedBy = 'username';
            else if (user.email?.toLowerCase() === userIdentifier.toLowerCase()) resolvedBy = 'email';
        }
        
        let coFounderShare = await CoFounderShare.findOne();
        if (!coFounderShare) {
            coFounderShare = new CoFounderShare();
            await coFounderShare.save();
        }
        
        const shareToRegularRatio = coFounderShare.shareToRegularRatio || 29;
        
        if (coFounderShare.sharesSold + parseInt(shares) > coFounderShare.totalShares) {
            return res.status(400).json({ success: false, message: 'Insufficient co-founder shares available' });
        }
        
        const transactionId = generateTransactionId();
        const transaction = await PaymentTransaction.create({
            userId: user._id,
            type: 'co-founder',
            transactionId,
            shares: parseInt(shares),
            status: 'completed',
            adminNotes: note || 'Admin share allocation',
            paymentMethod: 'co-founder',
            amount: coFounderShare.pricing.priceNaira * parseInt(shares),
            currency: 'naira',
            shareToRegularRatio,
            coFounderShares: parseInt(shares),
            equivalentRegularShares: parseInt(shares) * shareToRegularRatio
        });
        
        await UserShare.addCoFounderShares(user._id, parseInt(shares), {
            transactionId: transaction._id,
            shares: parseInt(shares),
            coFounderShares: parseInt(shares),
            equivalentRegularShares: parseInt(shares) * shareToRegularRatio,
            shareToRegularRatio,
            pricePerShare: coFounderShare.pricing.priceNaira,
            currency: 'naira',
            totalAmount: coFounderShare.pricing.priceNaira * parseInt(shares),
            paymentMethod: 'co-founder',
            status: 'completed',
            tierBreakdown: { tier1: 0, tier2: 0, tier3: 0 },
            adminAction: true,
            adminNote: note || 'Admin share allocation'
        });
        
        coFounderShare.sharesSold += parseInt(shares);
        await coFounderShare.save();
        
        try {
            const referralResult = await handleCofounderPurchase(
                user._id, coFounderShare.pricing.priceNaira * parseInt(shares), parseInt(shares), transaction._id
            );
            console.log('Co-founder referral commission process result for admin-added shares:', referralResult);
            if (referralResult.success) console.log('Admin-added shares commissions distributed:', referralResult.commissions);
        } catch (referralError) {
            console.error('Error processing co-founder referral commissions for admin-added shares:', referralError);
        }

        if (user.email) {
            try {
                await sendEmail({
                    email: user.email,
                    subject: 'Co-Founder Shares Allocated',
                    html: `
                        <h2>Co-Founder Shares Allocation</h2>
                        <p>Dear ${user.name},</p>
                        <p>You have been allocated ${shares} co-founder share(s).</p>
                        <p>This is equivalent to ${parseInt(shares) * shareToRegularRatio} regular shares.</p>
                        ${note ? `<p>Note: ${note}</p>` : ''}
                        <p>Thank you for your contribution!</p>
                    `
                });
            } catch (emailError) {
                console.error('Failed to send shares allocation email:', emailError);
            }
        }
        
        res.status(200).json({
            success: true,
            message: `Successfully added ${shares} co-founder shares to user`,
            searchInfo: {
                searchedBy: userIdentifier,
                resolvedBy,
                resolvedUser: { id: user._id, username: user.username, name: user.name }
            },
            data: {
                coFounderShares: parseInt(shares),
                equivalentRegularShares: parseInt(shares) * shareToRegularRatio,
                transaction: transaction._id,
                user: { id: user._id, name: user.name, username: user.username, email: user.email }
            }
        });
    } catch (error) {
        console.error('Error adding co-founder shares:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to add co-founder shares',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};


// ===================================================================
// EXPORTS
// ===================================================================

module.exports = {
    getCoFounderShareInfo,
    calculateCoFounderPurchase,
    getPaymentConfig,
    submitCoFounderManualPayment,
    getCoFounderManualPaymentStatus,
    getCoFounderPaymentProof,
    getCoFounderPendingManualPayments,
    approveCoFounderManualPayment,
    rejectCoFounderManualPayment,
    getAllCoFounderManualPayments,
    adminGetCoFounderManualTransactions,
    adminVerifyCoFounderManualPayment,
    adminCancelCoFounderManualPayment,
    adminDeleteCoFounderManualPayment,
    getCoFounderPaymentProofDirect,
    getUserCoFounderShares,
    adminAddCoFounderShares,
    adminAddCoFounderSharesFlexible,
    disableCoFounderProgramme,
    getAllCoFounderTransactions,
    getCoFounderShareStatistics,
    adminGetUserCoFounderOverview,
    resolveUserIdentifier
  };