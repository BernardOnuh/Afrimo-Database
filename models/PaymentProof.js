// models/PaymentProof.js
const mongoose = require('mongoose');

const paymentProofSchema = new mongoose.Schema({
  transactionId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  fileName: {
    type: String,
    required: true
  },
  originalName: {
    type: String,
    required: true
  },
  mimeType: {
    type: String,
    required: true
  },
  fileSize: {
    type: Number,
    required: true
  },
  imageData: {
    type: Buffer,
    required: true
  },
  encoding: {
    type: String,
    default: 'base64'
  },
  uploadedAt: {
    type: Date,
    default: Date.now
  },
  isDeleted: {
    type: Boolean,
    default: false
  }
});

// Create index for faster queries
paymentProofSchema.index({ transactionId: 1, userId: 1 });

module.exports = mongoose.model('PaymentProof', paymentProofSchema);

// 3. Updated submitManualPayment function
const PaymentProof = require('../models/PaymentProof');

exports.submitManualPayment = async (req, res) => {
  try {
    const { quantity, paymentMethod, bankName, accountName, reference, currency } = req.body;
    const userId = req.user.id;
    const paymentProofImage = req.file; // Uploaded file from multer middleware
    
    console.log('📋 [Manual Payment] Received submission:', {
      userId,
      quantity,
      paymentMethod,
      currency,
      fileReceived: !!paymentProofImage,
      fileName: paymentProofImage?.originalname,
      fileSize: paymentProofImage?.size,
      mimeType: paymentProofImage?.mimetype
    });
    
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
    
    // Validate file size (5MB limit)
    if (paymentProofImage.size > 5 * 1024 * 1024) {
      return res.status(400).json({
        success: false,
        message: 'File size too large. Maximum 5MB allowed.'
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
    
    // Generate unique filename
    const timestamp = Date.now();
    const randomSuffix = Math.round(Math.random() * 1E9);
    const fileExtension = paymentProofImage.originalname.split('.').pop();
    const uniqueFileName = `${transactionId}-${timestamp}-${randomSuffix}.${fileExtension}`;
    
    console.log('💾 [Manual Payment] Storing image in MongoDB:', {
      transactionId,
      fileName: uniqueFileName,
      fileSize: paymentProofImage.size,
      mimeType: paymentProofImage.mimetype
    });
    
    // Store image in MongoDB
    let paymentProofDoc;
    try {
      paymentProofDoc = new PaymentProof({
        transactionId,
        userId,
        fileName: uniqueFileName,
        originalName: paymentProofImage.originalname,
        mimeType: paymentProofImage.mimetype,
        fileSize: paymentProofImage.size,
        imageData: paymentProofImage.buffer // Store the buffer directly
      });
      
      await paymentProofDoc.save();
      console.log('✅ [Manual Payment] Image saved to MongoDB successfully');
    } catch (dbError) {
      console.error('❌ [Manual Payment] Failed to save image to MongoDB:', dbError);
      return res.status(500).json({
        success: false,
        message: 'Failed to save payment proof image'
      });
    }
    
    // Record the transaction as "pending verification"
    await UserShare.addShares(userId, purchaseDetails.totalShares, {
      transactionId,
      shares: purchaseDetails.totalShares,
      pricePerShare: purchaseDetails.totalPrice / purchaseDetails.totalShares,
      currency,
      totalAmount: purchaseDetails.totalPrice,
      paymentMethod: `manual_${paymentMethod}`,
      status: 'pending',
      tierBreakdown: purchaseDetails.tierBreakdown,
      paymentProofId: paymentProofDoc._id, // Store reference to PaymentProof document
      paymentProofFileName: uniqueFileName,
      hasPaymentProof: true,
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
          <p>Payment proof uploaded: ${paymentProofImage.originalname} (${Math.round(paymentProofImage.size / 1024)}KB)</p>
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
        status: 'pending',
        paymentProofId: paymentProofDoc._id,
        fileName: uniqueFileName
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

// 4. Updated getPaymentProof function
exports.getPaymentProof = async (req, res) => {
  try {
    const { transactionId } = req.params;
    const userId = req.user.id;
    
    console.log(`📸 [Payment Proof] Request for transaction: ${transactionId} from user: ${userId}`);
    
    // Find the transaction
    const userShareRecord = await UserShare.findOne({
      'transactions.transactionId': transactionId
    });
    
    if (!userShareRecord) {
      console.log(`❌ [Payment Proof] Transaction not found: ${transactionId}`);
      return res.status(404).json({
        success: false,
        message: 'Transaction not found'
      });
    }
    
    const transaction = userShareRecord.transactions.find(
      t => t.transactionId === transactionId
    );
    
    if (!transaction) {
      console.log(`❌ [Payment Proof] Transaction details not found: ${transactionId}`);
      return res.status(404).json({
        success: false,
        message: 'Transaction not found'
      });
    }
    
    // Check if user is admin or transaction owner
    const user = await User.findById(userId);
    if (!(user && (user.isAdmin || userShareRecord.user.toString() === userId))) {
      console.log(`🚫 [Payment Proof] Unauthorized access: ${userId}`);
      return res.status(403).json({
        success: false,
        message: 'Unauthorized: You do not have permission to view this payment proof'
      });
    }

    // Get payment proof from MongoDB
    const paymentProof = await PaymentProof.findOne({
      transactionId: transactionId,
      isDeleted: false
    });
    
    if (!paymentProof) {
      console.log(`❌ [Payment Proof] Payment proof not found in database: ${transactionId}`);
      return res.status(404).json({
        success: false,
        message: 'Payment proof not found'
      });
    }
    
    console.log(`✅ [Payment Proof] Found payment proof in database:`, {
      transactionId,
      fileName: paymentProof.fileName,
      fileSize: paymentProof.fileSize,
      mimeType: paymentProof.mimeType
    });
    
    // Set proper headers
    res.setHeader('Content-Type', paymentProof.mimeType);
    res.setHeader('Content-Length', paymentProof.fileSize);
    res.setHeader('Content-Disposition', `inline; filename="${paymentProof.originalName}"`);
    res.setHeader('Cache-Control', 'private, max-age=300'); // Cache for 5 minutes
    
    // Send the image buffer
    res.send(paymentProof.imageData);
    
  } catch (error) {
    console.error(`💥 [Payment Proof] Server error: ${error.message}`);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch payment proof',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// 5. Alternative: Get payment proof as base64 (for API responses)
exports.getPaymentProofBase64 = async (req, res) => {
  try {
    const { transactionId } = req.params;
    const userId = req.user.id;
    
    // Find the transaction (same authorization checks as above)
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
    
    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found'
      });
    }
    
    // Check authorization
    const user = await User.findById(userId);
    if (!(user && (user.isAdmin || userShareRecord.user.toString() === userId))) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    // Get payment proof from MongoDB
    const paymentProof = await PaymentProof.findOne({
      transactionId: transactionId,
      isDeleted: false
    });
    
    if (!paymentProof) {
      return res.status(404).json({
        success: false,
        message: 'Payment proof not found'
      });
    }
    
    // Convert buffer to base64
    const base64Image = paymentProof.imageData.toString('base64');
    const dataUrl = `data:${paymentProof.mimeType};base64,${base64Image}`;
    
    res.status(200).json({
      success: true,
      data: {
        transactionId,
        fileName: paymentProof.fileName,
        originalName: paymentProof.originalName,
        mimeType: paymentProof.mimeType,
        fileSize: paymentProof.fileSize,
        uploadedAt: paymentProof.uploadedAt,
        imageData: dataUrl // Full data URL for immediate use
      }
    });
    
  } catch (error) {
    console.error('Error fetching payment proof base64:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch payment proof',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// 6. Updated adminGetManualTransactions function
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
      .populate('user', 'name email phone username');
    
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
          hasPaymentProof: transaction.hasPaymentProof || false,
          paymentProofId: transaction.paymentProofId || null,
          paymentProofFileName: transaction.paymentProofFileName || null,
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

// 7. Updated adminDeleteManualPayment function
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
      paymentProofId: transaction.paymentProofId
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
          userShareRecord.user,
          transactionId,
          transaction.totalAmount,
          transaction.currency,
          'share',
          'UserShare'
        );
        console.log('Referral commission rollback result:', rollbackResult);
      } catch (referralError) {
        console.error('Error rolling back referral commissions:', referralError);
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
    
    // Mark payment proof as deleted in MongoDB (soft delete)
    if (transactionDetails.paymentProofId) {
      try {
        await PaymentProof.findByIdAndUpdate(
          transactionDetails.paymentProofId,
          { 
            isDeleted: true,
            deletedAt: new Date(),
            deletedBy: adminId
          }
        );
        console.log(`Payment proof marked as deleted: ${transactionDetails.paymentProofId}`);
      } catch (deleteErr) {
        console.error('Error marking payment proof as deleted:', deleteErr);
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
      paymentProofDeleted: !!transactionDetails.paymentProofId,
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
        },
        paymentProofDeleted: !!transactionDetails.paymentProofId
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