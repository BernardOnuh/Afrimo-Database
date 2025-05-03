// controller/withdrawalController.js
const User = require('../models/User');
const Referral = require('../models/Referral');
const ReferralTransaction = require('../models/ReferralTransaction');
const Withdrawal = require('../models/Withdrawal');
const Payment = require('../models/Payment');
const { sendEmail } = require('../utils/emailService');
const { generateWithdrawalReceipt } = require('../utils/withdrawalReceiptService.js');
const axios = require('axios'); // Add axios for API requests

// Minimum withdrawal amount in Naira
const MINIMUM_WITHDRAWAL_AMOUNT = 20000;

/**
 * Process an instant withdrawal to bank account
 * @route POST /api/withdrawal/instant
 * @access Private
 */
exports.processInstantWithdrawal = async (req, res) => {
  try {
    const userId = req.user.id;
    const { amount, notes } = req.body;

    // Basic validation
    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid withdrawal amount'
      });
    }

    // Check minimum withdrawal amount
    if (amount < MINIMUM_WITHDRAWAL_AMOUNT) {
      return res.status(400).json({
        success: false,
        message: `Minimum withdrawal amount is ₦${MINIMUM_WITHDRAWAL_AMOUNT.toLocaleString()}`
      });
    }

    // Check for pending withdrawals
    const pendingWithdrawal = await Withdrawal.findOne({
      user: userId,
      status: 'pending'
    });

    if (pendingWithdrawal) {
      return res.status(400).json({
        success: false,
        message: 'You have a pending withdrawal. Wait for it to complete before making another withdrawal request.'
      });
    }

    // Check if user has enough balance
    const referralData = await Referral.findOne({ user: userId });
    if (!referralData || referralData.totalEarnings < amount) {
      return res.status(400).json({
        success: false,
        message: 'Insufficient balance for this withdrawal'
      });
    }

    // Calculate available balance
    let pendingWithdrawals = 0;
    const pending = await Withdrawal.find({
      user: userId,
      status: 'pending'
    });
    
    if (pending.length > 0) {
      pendingWithdrawals = pending.reduce((total, w) => total + w.amount, 0);
    }
    
    const withdrawnAmount = await Withdrawal.aggregate([
      { $match: { user: userId, status: { $in: ['paid', 'processing'] } } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    
    const totalWithdrawn = withdrawnAmount.length > 0 ? withdrawnAmount[0].total : 0;
    
    const availableBalance = referralData.totalEarnings - pendingWithdrawals - totalWithdrawn;

    // Check if available balance is enough
    if (availableBalance < amount) {
      return res.status(400).json({
        success: false,
        message: 'Insufficient available balance for this withdrawal'
      });
    }

    // Check if user has verified payment details
    const paymentData = await Payment.findOne({ user: userId });
    if (!paymentData || !paymentData.bankAccount) {
      return res.status(400).json({
        success: false,
        message: 'Bank account details not found. Please add your bank details first.'
      });
    }

    // Ensure bank account is verified
    if (!paymentData.bankAccount.verified) {
      return res.status(400).json({
        success: false,
        message: 'Your bank account is not verified. Please verify your account before making withdrawals.'
      });
    }

    // Generate a unique client reference
    const clientReference = `WD-${userId.substr(-6)}-${Date.now()}`;

    // Create a pending withdrawal record first
    const withdrawal = new Withdrawal({
      user: userId,
      amount,
      paymentMethod: 'bank',
      paymentDetails: {
        bankName: paymentData.bankAccount.bankName,
        accountName: paymentData.bankAccount.accountName,
        accountNumber: paymentData.bankAccount.accountNumber,
        bankCode: paymentData.bankAccount.bankCode
      },
      notes,
      status: 'pending',
      clientReference: clientReference
    });

    await withdrawal.save();

    // Process the bank transfer using Lenco API
    try {
      const response = await axios.post('https://api.lenco.co/access/v1/transactions', {
        accountId: process.env.LENCO_ACCOUNT_ID, // Your company's Lenco account ID
        accountNumber: paymentData.bankAccount.accountNumber,
        bankCode: paymentData.bankAccount.bankCode,
        amount: amount.toString(),
        narration: `Afrimobile Earnings Withdrawal`,
        reference: clientReference,
        senderName: 'Afrimobile'
      }, {
        headers: {
          'Authorization': `Bearer ${process.env.LENCO_API_KEY}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.data && response.data.status) {
        // Update withdrawal with transaction reference
        withdrawal.transactionReference = response.data.data.transactionReference;
        
        // Set status based on immediate response
        if (response.data.data.status === 'successful') {
          withdrawal.status = 'paid';
          withdrawal.processedAt = new Date();
          
          // Create a transaction record for successful withdrawal
          const transaction = new ReferralTransaction({
            user: userId,
            type: 'withdrawal',
            amount: -amount,
            description: `Withdrawal to ${paymentData.bankAccount.bankName} - ${paymentData.bankAccount.accountNumber}`,
            status: 'completed',
            reference: clientReference
          });
          await transaction.save();
        } else if (response.data.data.status === 'failed' || response.data.data.status === 'declined') {
          withdrawal.status = 'failed';
          withdrawal.rejectionReason = response.data.data.reasonForFailure || 'Transaction failed';
        } else {
          // Status is pending or processing
          withdrawal.status = 'processing';
        }

        await withdrawal.save();

        // Get user info for receipt and notification
        const user = await User.findById(userId);

        // Generate receipt for successful payments
        if (withdrawal.status === 'paid') {
          const receipt = await generateWithdrawalReceipt(withdrawal, user);
          
          // Send confirmation email for successful transaction
          try {
            await sendEmail({
              email: user.email,
              subject: 'Withdrawal Successful',
              html: `
                <h2>Withdrawal Successful</h2>
                <p>Hello ${user.name},</p>
                <p>Your withdrawal of ₦${amount.toLocaleString()} has been processed successfully.</p>
                <p><strong>Transaction Reference:</strong> ${response.data.data.transactionReference}</p>
                <p>You can download your receipt from the dashboard or using <a href="${process.env.FRONTEND_URL}/api/withdrawal/receipt/${withdrawal._id}">this link</a>.</p>
                <p>Thank you for using our platform!</p>
              `
            });
          } catch (emailError) {
            console.error('Failed to send withdrawal confirmation email:', emailError);
          }
        }

        return res.status(200).json({
          success: true,
          message: withdrawal.status === 'paid' ? 'Withdrawal processed successfully' : 'Withdrawal initiated, processing in progress',
          data: {
            id: withdrawal._id,
            amount: withdrawal.amount,
            status: withdrawal.status,
            transactionReference: response.data.data.transactionReference,
            clientReference: clientReference,
            processedAt: withdrawal.processedAt,
            receiptUrl: withdrawal.status === 'paid' ? receipt.filePath : null
          }
        });
      } else {
        throw new Error('Failed to process transaction with payment provider');
      }
    } catch (transferError) {
      console.error('Bank transfer error:', transferError);
      
      // Update withdrawal status to failed
      withdrawal.status = 'failed';
      withdrawal.rejectionReason = transferError.response?.data?.message || 'Payment processing failed';
      await withdrawal.save();

      return res.status(400).json({
        success: false,
        message: 'Failed to process withdrawal',
        error: transferError.response?.data?.message || 'Payment processing failed'
      });
    }
  } catch (error) {
    console.error('Error processing instant withdrawal:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process withdrawal',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Verify pending withdrawals
 * @route GET /api/withdrawal/verify-pending
 * @access Private
 */
exports.verifyPendingWithdrawals = async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Find all pending withdrawals for the user
    const pendingWithdrawals = await Withdrawal.find({
      user: userId,
      status: 'pending'
    });

    if (pendingWithdrawals.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'No pending withdrawals found'
      });
    }

    // Verify each pending withdrawal
    for (const withdrawal of pendingWithdrawals) {
      try {
        const response = await axios.get(`https://api.lenco.co/access/v1/transaction-by-reference/${withdrawal.clientReference}`, {
          headers: {
            'Authorization': `Bearer ${process.env.LENCO_API_KEY}`
          }
        });

        if (response.data && response.data.status) {
          const transactionData = response.data.data;
          
          if (transactionData.status === 'successful') {
            withdrawal.status = 'paid';
            withdrawal.processedAt = new Date();
            withdrawal.transactionReference = transactionData.transactionReference;
            
            // Create a transaction record for successful withdrawal
            const transaction = new ReferralTransaction({
              user: userId,
              type: 'withdrawal',
              amount: -withdrawal.amount,
              description: `Withdrawal to ${withdrawal.paymentDetails.bankName} - ${withdrawal.paymentDetails.accountNumber}`,
              status: 'completed',
              reference: withdrawal.clientReference
            });
            await transaction.save();
            
          } else if (transactionData.status === 'failed' || transactionData.status === 'declined') {
            withdrawal.status = 'failed';
            withdrawal.rejectionReason = transactionData.reasonForFailure || 'Transaction failed';
            
          } else if (transactionData.status === 'pending') {
            // Keep it pending, do nothing
            continue;
          }
          
          await withdrawal.save();
        }
      } catch (apiError) {
        console.error(`Error verifying withdrawal ${withdrawal._id}:`, apiError);
        // Continue to next withdrawal if this one fails
      }
    }

    // Get updated pending withdrawals after verification
    const updatedPending = await Withdrawal.find({
      user: userId,
      status: 'pending'
    });

    return res.status(200).json({
      success: true,
      message: 'Withdrawal verification completed',
      data: {
        pendingCount: updatedPending.length,
        canWithdraw: updatedPending.length === 0
      }
    });
  } catch (error) {
    console.error('Error verifying pending withdrawals:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to verify pending withdrawals',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Check bank transfer transaction status
 * @route GET /api/withdrawal/status/:reference
 * @access Private
 */
exports.checkTransactionStatus = async (req, res) => {
  try {
    const { reference } = req.params;
    
    // Find the withdrawal record
    const withdrawal = await Withdrawal.findOne({
      $or: [
        { clientReference: reference },
        { transactionReference: reference }
      ]
    });
    
    if (!withdrawal) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found'
      });
    }
    
    // If transaction is still processing or pending, check status with Lenco
    if (withdrawal.status === 'processing' || withdrawal.status === 'pending') {
      try {
        // Use transaction-by-reference endpoint to get the latest status
        const response = await axios.get(`https://api.lenco.co/access/v1/transaction-by-reference/${withdrawal.clientReference}`, {
          headers: {
            'Authorization': `Bearer ${process.env.LENCO_API_KEY}`
          }
        });
        
        if (response.data && response.data.status) {
          const transactionData = response.data.data;
          
          // Update transaction status based on Lenco response
          if (transactionData.status === 'successful') {
            withdrawal.status = 'paid';
            withdrawal.processedAt = new Date();
            withdrawal.transactionReference = transactionData.transactionReference;
            
            // Create a transaction record for successful withdrawal only if not exists
            const existingTransaction = await ReferralTransaction.findOne({ reference: withdrawal.clientReference });
            if (!existingTransaction) {
              const transaction = new ReferralTransaction({
                user: withdrawal.user,
                type: 'withdrawal',
                amount: -withdrawal.amount,
                description: `Withdrawal to ${withdrawal.paymentDetails.bankName} - ${withdrawal.paymentDetails.accountNumber}`,
                status: 'completed',
                reference: withdrawal.clientReference
              });
              await transaction.save();
            }
          } else if (transactionData.status === 'failed' || transactionData.status === 'declined') {
            withdrawal.status = 'failed';
            withdrawal.failedAt = transactionData.failedAt;
            withdrawal.rejectionReason = transactionData.reasonForFailure || 'Transaction failed';
          } else if (transactionData.status === 'pending') {
            withdrawal.status = 'pending';
          }
          
          await withdrawal.save();
        }
      } catch (apiError) {
        console.error('Error checking transaction status:', apiError);
        // Continue without failing the request
      }
    }
    
    res.status(200).json({
      success: true,
      data: {
        id: withdrawal._id,
        amount: withdrawal.amount,
        status: withdrawal.status,
        transactionReference: withdrawal.transactionReference,
        clientReference: withdrawal.clientReference,
        processedAt: withdrawal.processedAt,
        rejectionReason: withdrawal.rejectionReason,
        failedAt: withdrawal.failedAt
      }
    });
  } catch (error) {
    console.error('Error checking transaction status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to check transaction status',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Middleware to check for pending withdrawals
 */
exports.checkPendingWithdrawal = async (req, res, next) => {
  try {
    const userId = req.user.id;
    
    const pendingWithdrawal = await Withdrawal.findOne({
      user: userId,
      status: 'pending'
    });

    if (pendingWithdrawal) {
      // Set a custom property on request for controller to handle
      req.hasPendingWithdrawal = true;
      req.pendingWithdrawal = pendingWithdrawal;
    }
    
    next();
  } catch (error) {
    console.error('Error checking pending withdrawal:', error);
    next();
  }
};

/**
 * Get withdrawal receipt
 * @route GET /api/withdrawal/receipt/:id
 * @access Private
 */
exports.getWithdrawalReceipt = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    // Find the withdrawal
    const withdrawal = await Withdrawal.findById(id);
    
    if (!withdrawal) {
      return res.status(404).json({
        success: false,
        message: 'Withdrawal not found'
      });
    }
    
    // Check if the withdrawal belongs to the user or the user is admin
    if (withdrawal.user.toString() !== userId && !req.user.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to access this receipt'
      });
    }

    // Get user data
    const user = await User.findById(withdrawal.user);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    // Generate or retrieve receipt
    const receipt = await generateWithdrawalReceipt(withdrawal, user);
    
    // Return receipt URL
    res.status(200).json({
      success: true,
      data: {
        receiptUrl: receipt.filePath
      }
    });
  } catch (error) {
    console.error('Error generating withdrawal receipt:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate withdrawal receipt',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Generate receipt for a withdrawal
 * @route GET /api/withdrawal/download-receipt/:id
 * @access Private
 */
exports.downloadWithdrawalReceipt = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    // Find the withdrawal
    const withdrawal = await Withdrawal.findById(id);
    
    if (!withdrawal) {
      return res.status(404).json({
        success: false,
        message: 'Withdrawal not found'
      });
    }
    
    // Ensure the user owns this withdrawal or is an admin
    if (withdrawal.user.toString() !== userId && !req.user.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to access this receipt'
      });
    }

    // Get user details
    const user = await User.findById(withdrawal.user);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Create PDF document using PDFKit
    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({
      size: 'A4',
      margin: 50,
      info: {
        Title: 'Withdrawal Receipt',
        Author: 'Afrimobile',
        Subject: 'Withdrawal Receipt',
      }
    });

    // Set response headers for PDF download
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="withdrawal-receipt-${id}.pdf"`);
    
    // Pipe the PDF output to the response
    doc.pipe(res);
    
    // Add Afrimobile logo
    // Create an SVG logo rather than using an external image
    const logoSvg = `
      <svg width="163" height="42" viewBox="0 0 163 42" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M47.2255 33.8401C49.5229 45.1632 38.8428 32.8107 24.2513 32.8107C9.22957 30.9707 -1.15106 43.5885 2.30986 36.7061C2.30986 25.336 9.64031 0 24.2318 0C38.0777 1.14706 47.2255 22.47 47.2255 33.8401Z" fill="#5A19A0"/>
        <path d="M6.96559 27.5028C5.00492 31.105 3.46202 32.0245 1.66908 38.7574C1.46521 37.7868 -3.44072 31.7022 4.59019 16.7708C13.2433 2.54858 18.2956 0.0662591 23.857 0.0662631C23.857 11.2275 10.1704 22.6127 6.96559 27.5028Z" fill="#5A19A0"/>
        <path d="M40.2016 26.7935C42.1623 30.3957 44.9989 33.2649 46.5882 38.8134C46.792 37.8428 54.3406 33.2184 46.3097 18.287C37.6565 4.06475 28.8339 -0.363062 24.3993 0.0289038C27.5519 11.3395 36.8082 23.0793 40.2016 26.7935Z" fill="#5A19A0"/>
        <path d="M46.3097 38.7574C46.3097 38.8914 36.3839 39 24.1397 39C11.8956 39 1.96973 38.8914 1.96973 38.7574C1.96973 38.6234 14.1482 23.418 23.857 21.7942C29.3241 22.3542 46.3097 38.6234 46.3097 38.7574Z" fill="#5A19A0"/>
        <path d="M26.8832 19.4258C26.8832 21.1255 25.5117 20.5648 24.0511 20.5648C19.9072 20.5648 21.4898 17.8842 21.9896 15.9455C21.9896 14.2008 24.072 10.59 24.6134 10.8081C26.074 10.8081 27.4247 17.5692 26.8832 19.4258Z" fill="#5A19A0"/>
      </svg>
    `;
    
    // Add SVG logo  
    doc.svg(logoSvg, 50, 50, { width: 100 });
    
    // Add page title
    doc.fontSize(20)
      .fillColor('#5A19A0')
      .text('WITHDRAWAL RECEIPT', { align: 'center' })
      .moveDown(1);
      
    // Format date nicely
    const formatDate = (date) => {
      return new Date(date).toLocaleString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    };
    
    // Format currency with commas
    const formatAmount = (amount) => {
      return amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    };
    
    // Add receipt border
    doc.rect(50, 130, 500, 450)
      .lineWidth(1)
      .stroke('#5A19A0');
      
    // Add Transaction Details Section
    doc.fontSize(14)
      .fillColor('#333333')
      .text('TRANSACTION DETAILS', 70, 150)
      .moveDown(0.5);
      
    // Add a line
    doc.moveTo(70, 175).lineTo(530, 175).stroke('#CCCCCC');
    
    // Add transaction details
    doc.fontSize(10)
      .text('Transaction ID:', 70, 190)
      .text(withdrawal._id.toString(), 200, 190)
      .text('Date:', 70, 215)
      .text(formatDate(withdrawal.createdAt), 200, 215)
      .text('Status:', 70, 240)
      .text(withdrawal.status.charAt(0).toUpperCase() + withdrawal.status.slice(1), 200, 240)
      .text('Amount:', 70, 265)
      .text(`₦${formatAmount(withdrawal.amount)}`, 200, 265)
      .text('Payment Method:', 70, 290)
      .text(withdrawal.paymentMethod.charAt(0).toUpperCase() + withdrawal.paymentMethod.slice(1), 200, 290);
      
    if (withdrawal.transactionReference) {
      doc.text('Transaction Reference:', 70, 315)
          .text(withdrawal.transactionReference, 200, 315);
    }
    
    if (withdrawal.clientReference) {
      doc.text('Client Reference:', 70, withdrawal.transactionReference ? 340 : 315)
          .text(withdrawal.clientReference, 200, withdrawal.transactionReference ? 340 : 315);
    }
    
    // Add a line
    let yPos = withdrawal.transactionReference && withdrawal.clientReference ? 365 : 
              (withdrawal.transactionReference || withdrawal.clientReference) ? 340 : 315;
    doc.moveTo(70, yPos).lineTo(530, yPos).stroke('#CCCCCC');
    
    yPos += 25;
    
    // Add User Details Section
    doc.fontSize(14)
      .fillColor('#333333')
      .text('USER DETAILS', 70, yPos)
      .moveDown(0.5);
      
    yPos += 25;
    
    // Add a line
    doc.moveTo(70, yPos).lineTo(530, yPos).stroke('#CCCCCC');
    
    yPos += 25;
    
    // Add user details
    doc.fontSize(10)
      .text('Name:', 70, yPos)
      .text(user.name, 200, yPos);
      
    yPos += 25;
      
    doc.text('Email:', 70, yPos)
      .text(user.email, 200, yPos);
      
    yPos += 50;
    
    // Add Payment Details Section if available
    if (withdrawal.paymentDetails) {
      // Add a line
      doc.moveTo(70, yPos).lineTo(530, yPos).stroke('#CCCCCC');
      
      yPos += 25;
      
      doc.fontSize(14)
        .fillColor('#333333')
        .text('PAYMENT DETAILS', 70, yPos)
        .moveDown(0.5);
        
      yPos += 25;
      
      // Add a line
      doc.moveTo(70, yPos).lineTo(530, yPos).stroke('#CCCCCC');
      
      yPos += 25;
      
      // Add specific payment details based on method
      if (withdrawal.paymentMethod === 'bank') {
        doc.fontSize(10)
          .text('Bank Name:', 70, yPos)
          .text(withdrawal.paymentDetails.bankName || 'N/A', 200, yPos);
          
        yPos += 25;
          
        doc.text('Account Number:', 70, yPos)
          .text(withdrawal.paymentDetails.accountNumber || 'N/A', 200, yPos);
          
        yPos += 25;
          
        doc.text('Account Name:', 70, yPos)
          .text(withdrawal.paymentDetails.accountName || 'N/A', 200, yPos);
      } else if (withdrawal.paymentMethod === 'crypto') {
        doc.fontSize(10)
          .text('Crypto Type:', 70, yPos)
          .text(withdrawal.paymentDetails.cryptoType || 'N/A', 200, yPos);
          
        yPos += 25;
          
        doc.text('Wallet Address:', 70, yPos)
          .text(withdrawal.paymentDetails.walletAddress || 'N/A', 200, yPos);
      } else if (withdrawal.paymentMethod === 'mobile_money') {
        doc.fontSize(10)
          .text('Mobile Provider:', 70, yPos)
          .text(withdrawal.paymentDetails.mobileProvider || 'N/A', 200, yPos);
          
        yPos += 25;
          
        doc.text('Mobile Number:', 70, yPos)
          .text(withdrawal.paymentDetails.mobileNumber || 'N/A', 200, yPos);
      }
    }
    
    // Add the footer
    doc.fontSize(8)
      .fillColor('#999999')
      .text('This is an electronically generated receipt', 50, 700, { align: 'center' })
      .text('Afrimobile - Your Time', 50, 715, { align: 'center' });
    
    // Finalize PDF
    doc.end();
    
  } catch (error) {
    console.error('Error generating withdrawal receipt:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to generate receipt',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Request a withdrawal of referral earnings
 * @route POST /api/withdrawal/request
 * @access Private
 */
exports.requestWithdrawal = async (req, res) => {
  try {
    const userId = req.user.id;
    const { amount, paymentMethod, paymentDetails, notes } = req.body;

    // Basic validation
    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid withdrawal amount'
      });
    }

    // Check minimum withdrawal amount
    if (amount < MINIMUM_WITHDRAWAL_AMOUNT) {
      return res.status(400).json({
        success: false,
        message: `Minimum withdrawal amount is ₦${MINIMUM_WITHDRAWAL_AMOUNT.toLocaleString()}`
      });
    }

    if (!paymentMethod) {
      return res.status(400).json({
        success: false,
        message: 'Please select a payment method'
      });
    }

    // Check if user has enough balance
    const referralData = await Referral.findOne({ user: userId });
    if (!referralData || referralData.totalEarnings < amount) {
      return res.status(400).json({
        success: false,
        message: 'Insufficient balance for this withdrawal'
      });
    }

    // Check if user has verified payment details
    const paymentData = await Payment.findOne({ user: userId });
    
    // Validate payment details based on the selected method
    if (paymentMethod === 'bank') {
      if (!paymentDetails.bankName || !paymentDetails.accountName || !paymentDetails.accountNumber) {
        return res.status(400).json({
          success: false,
          message: 'Please provide complete bank details'// === Continuation of withdrawalController.js ===

        });
      }
    } else if (paymentMethod === 'crypto') {
      if (!paymentDetails.cryptoType || !paymentDetails.walletAddress) {
        return res.status(400).json({
          success: false,
          message: 'Please provide complete crypto wallet details'
        });
      }
    } else if (paymentMethod === 'mobile_money') {
      if (!paymentDetails.mobileProvider || !paymentDetails.mobileNumber) {
        return res.status(400).json({
          success: false,
          message: 'Please provide complete mobile money details'
        });
      }
    }

    // Create a new withdrawal request
    const withdrawal = new Withdrawal({
      user: userId,
      amount,
      paymentMethod,
      paymentDetails,
      notes,
      status: 'pending'
    });

    await withdrawal.save();

    // Notify admin of new withdrawal request (optional)
    try {
      // Fetch user data for email
      const user = await User.findById(userId);
      
      await sendEmail({
        email: process.env.ADMIN_EMAIL || 'admin@afrimobile.com',
        subject: 'New Withdrawal Request',
        html: `
          <h2>New Withdrawal Request Submitted</h2>
          <p><strong>User:</strong> ${user.name} (${user.email})</p>
          <p><strong>Amount:</strong> ₦${amount.toLocaleString()}</p>
          <p><strong>Payment Method:</strong> ${paymentMethod}</p>
          <p>Please review this request in the admin dashboard.</p>
        `
      });
    } catch (emailError) {
      console.error('Failed to send admin notification email:', emailError);
      // Continue without failing the request
    }

    res.status(201).json({
      success: true,
      message: 'Withdrawal request submitted successfully',
      data: {
        id: withdrawal._id,
        amount: withdrawal.amount,
        status: withdrawal.status,
        createdAt: withdrawal.createdAt
      }
    });
  } catch (error) {
    console.error('Error requesting withdrawal:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process withdrawal request',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Get user's withdrawal history
 * @route GET /api/withdrawal/history
 * @access Private
 */
exports.getWithdrawalHistory = async (req, res) => {
  try {
    const userId = req.user.id;

    // Get all withdrawal requests for this user
    const withdrawals = await Withdrawal.find({ user: userId })
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: withdrawals.length,
      data: withdrawals
    });
  } catch (error) {
    console.error('Error fetching withdrawal history:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch withdrawal history',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Get user's current earnings balance
 * @route GET /api/withdrawal/balance
 * @access Private
 */
exports.getEarningsBalance = async (req, res) => {
  try {
    const userId = req.user.id;

    // Get the user's referral data
    const referralData = await Referral.findOne({ user: userId });
    
    // Calculate available balance
    let totalEarnings = 0;
    let pendingWithdrawals = 0;
    
    if (referralData) {
      totalEarnings = referralData.totalEarnings || 0;
    }
    
    // Calculate pending withdrawals
    const pending = await Withdrawal.find({
      user: userId,
      status: 'pending'
    });
    
    if (pending.length > 0) {
      pendingWithdrawals = pending.reduce((total, w) => total + w.amount, 0);
    }
    
    const withdrawnAmount = await Withdrawal.aggregate([
      { $match: { user: userId, status: { $in: ['approved', 'paid'] } } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    
    const totalWithdrawn = withdrawnAmount.length > 0 ? withdrawnAmount[0].total : 0;
    
    const availableBalance = totalEarnings - pendingWithdrawals - totalWithdrawn;

    res.status(200).json({
      success: true,
      data: {
        totalEarnings,
        pendingWithdrawals,
        totalWithdrawn,
        availableBalance,
        minimumWithdrawalAmount: MINIMUM_WITHDRAWAL_AMOUNT,
        canWithdraw: availableBalance >= MINIMUM_WITHDRAWAL_AMOUNT
      }
    });
  } catch (error) {
    console.error('Error fetching earnings balance:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch earnings balance',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// ========== ADMIN CONTROLLER FUNCTIONS ==========

/**
 * Get withdrawal statistics (Admin only)
 * @route GET /api/withdrawal/stats
 * @access Admin
 */
exports.getWithdrawalStats = async (req, res) => {
  try {
    // Get overall withdrawal statistics
    const stats = await Withdrawal.aggregate([
      {
        $group: {
          _id: null,
          totalWithdrawals: { $sum: 1 },
          totalAmount: { $sum: '$amount' },
          totalPaid: { 
            $sum: { $cond: [{ $eq: ['$status', 'paid'] }, '$amount', 0] } 
          },
          totalPending: { 
            $sum: { $cond: [{ $eq: ['$status', 'pending'] }, '$amount', 0] } 
          },
          totalFailed: { 
            $sum: { $cond: [{ $eq: ['$status', 'failed'] }, '$amount', 0] } 
          }
        }
      }
    ]);

    // Get withdrawal counts by status
    const statusCounts = await Withdrawal.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);

    // Get withdrawal trends by month (last 6 months)
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const withdrawalTrends = await Withdrawal.aggregate([
      {
        $match: {
          createdAt: { $gte: sixMonthsAgo }
        }
      },
      {
        $group: {
          _id: {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' }
          },
          totalAmount: { $sum: '$amount' },
          count: { $sum: 1 }
        }
      },
      {
        $sort: { '_id.year': 1, '_id.month': 1 }
      }
    ]);

    res.status(200).json({
      success: true,
      data: {
        overview: stats[0] || {
          totalWithdrawals: 0,
          totalAmount: 0,
          totalPaid: 0,
          totalPending: 0,
          totalFailed: 0
        },
        statusCounts,
        withdrawalTrends
      }
    });
  } catch (error) {
    console.error('Error fetching withdrawal stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch withdrawal statistics',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Get all instant withdrawals (Admin only)
 * @route GET /api/withdrawal/admin/instant
 * @access Admin
 */
exports.getInstantWithdrawals = async (req, res) => {
  try {
    const { page = 1, limit = 20, status, startDate, endDate } = req.query;

    const query = {};
    
    // Filter by status if provided
    if (status) {
      query.status = status;
    }

    // Filter by date range if provided
    if (startDate && endDate) {
      query.createdAt = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }

    const withdrawals = await Withdrawal.find(query)
      .populate('user', 'name email')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const count = await Withdrawal.countDocuments(query);

    res.status(200).json({
      success: true,
      count,
      data: withdrawals,
      totalPages: Math.ceil(count / limit),
      currentPage: page
    });
  } catch (error) {
    console.error('Error fetching instant withdrawals:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch instant withdrawals',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Get pending withdrawals (Admin only)
 * @route GET /api/withdrawal/admin/pending
 * @access Admin
 */
exports.getPendingWithdrawals = async (req, res) => {
  try {
    const pendingWithdrawals = await Withdrawal.find({ status: 'pending' })
      .populate('user', 'name email profileImage')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: pendingWithdrawals.length,
      data: pendingWithdrawals
    });
  } catch (error) {
    console.error('Error fetching pending withdrawals:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch pending withdrawals',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Approve a withdrawal request (Admin only)
 * @route PUT /api/withdrawal/admin/approve/:id
 * @access Admin
 */
exports.approveWithdrawal = async (req, res) => {
  try {
    const { id } = req.params;
    const { notes } = req.body;

    const withdrawal = await Withdrawal.findById(id);

    if (!withdrawal) {
      return res.status(404).json({
        success: false,
        message: 'Withdrawal request not found'
      });
    }

    if (withdrawal.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: 'Only pending withdrawals can be approved'
      });
    }

    // Update withdrawal status
    withdrawal.status = 'approved';
    withdrawal.approvedBy = req.user.id;
    withdrawal.approvedAt = new Date();
    withdrawal.adminNotes = notes;

    await withdrawal.save();

    // Get user information
    const user = await User.findById(withdrawal.user);

    // Send approval notification email
    try {
      await sendEmail({
        email: user.email,
        subject: 'Withdrawal Request Approved',
        html: `
          <h2>Withdrawal Request Approved</h2>
          <p>Hello ${user.name},</p>
          <p>Your withdrawal request of ₦${withdrawal.amount.toLocaleString()} has been approved.</p>
          <p>The payment will be processed shortly.</p>
          <p>Thank you for using our platform!</p>
        `
      });
    } catch (emailError) {
      console.error('Failed to send approval email:', emailError);
    }

    res.status(200).json({
      success: true,
      message: 'Withdrawal approved successfully',
      data: withdrawal
    });
  } catch (error) {
    console.error('Error approving withdrawal:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to approve withdrawal',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Reject a withdrawal request (Admin only)
 * @route PUT /api/withdrawal/admin/reject/:id
 * @access Admin
 */
exports.rejectWithdrawal = async (req, res) => {
  try {
    const { id } = req.params;
    const { rejectionReason, notes } = req.body;

    if (!rejectionReason) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a rejection reason'
      });
    }

    const withdrawal = await Withdrawal.findById(id);

    if (!withdrawal) {
      return res.status(404).json({
        success: false,
        message: 'Withdrawal request not found'
      });
    }

    if (withdrawal.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: 'Only pending withdrawals can be rejected'
      });
    }

    // Update withdrawal status
    withdrawal.status = 'rejected';
    withdrawal.rejectedBy = req.user.id;
    withdrawal.rejectedAt = new Date();
    withdrawal.rejectionReason = rejectionReason;
    withdrawal.adminNotes = notes;

    await withdrawal.save();

    // Get user information
    const user = await User.findById(withdrawal.user);

    // Send rejection notification email
    try {
      await sendEmail({
        email: user.email,
        subject: 'Withdrawal Request Rejected',
        html: `
          <h2>Withdrawal Request Rejected</h2>
          <p>Hello ${user.name},</p>
          <p>Your withdrawal request of ₦${withdrawal.amount.toLocaleString()} has been rejected.</p>
          <p><strong>Reason:</strong> ${rejectionReason}</p>
          <p>If you believe this is an error, please contact support.</p>
        `
      });
    } catch (emailError) {
      console.error('Failed to send rejection email:', emailError);
    }

    res.status(200).json({
      success: true,
      message: 'Withdrawal rejected successfully',
      data: withdrawal
    });
  } catch (error) {
    console.error('Error rejecting withdrawal:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reject withdrawal',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Mark a withdrawal as paid (Admin only)
 * @route PUT /api/withdrawal/admin/mark-paid/:id
 * @access Admin
 */
exports.markWithdrawalAsPaid = async (req, res) => {
  try {
    const { id } = req.params;
    const { transactionReference } = req.body;

    const withdrawal = await Withdrawal.findById(id);

    if (!withdrawal) {
      return res.status(404).json({
        success: false,
        message: 'Withdrawal request not found'
      });
    }

    if (withdrawal.status !== 'approved' && withdrawal.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: 'Only approved or pending withdrawals can be marked as paid'
      });
    }

    // Update withdrawal status
    withdrawal.status = 'paid';
    withdrawal.paidBy = req.user.id;
    withdrawal.processedAt = new Date();
    if (transactionReference) {
      withdrawal.transactionReference = transactionReference;
    }

    await withdrawal.save();

    // Create a transaction record for the withdrawal
    const transaction = new ReferralTransaction({
      user: withdrawal.user,
      type: 'withdrawal',
      amount: -withdrawal.amount,
      description: `Withdrawal to ${withdrawal.paymentMethod}`,
      status: 'completed',
      reference: withdrawal.transactionReference || `MANUAL-${withdrawal._id}`
    });
    await transaction.save();

    // Get user information
    const user = await User.findById(withdrawal.user);

    // Generate receipt
    const receipt = await generateWithdrawalReceipt(withdrawal, user);

    // Send payment confirmation email
    try {
      await sendEmail({
        email: user.email,
        subject: 'Withdrawal Completed',
        html: `
          <h2>Withdrawal Completed</h2>
          <p>Hello ${user.name},</p>
          <p>Your withdrawal of ₦${withdrawal.amount.toLocaleString()} has been processed successfully.</p>
          ${transactionReference ? `<p><strong>Transaction Reference:</strong> ${transactionReference}</p>` : ''}
          <p>You can download your receipt from the dashboard.</p>
          <p>Thank you for using our platform!</p>
        `
      });
    } catch (emailError) {
      console.error('Failed to send payment confirmation email:', emailError);
    }

    res.status(200).json({
      success: true,
      message: 'Withdrawal marked as paid successfully',
      data: {
        ...withdrawal.toObject(),
        receiptUrl: receipt.filePath
      }
    });
  } catch (error) {
    console.error('Error marking withdrawal as paid:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark withdrawal as paid',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Get all withdrawals (Admin only)
 * @route GET /api/withdrawal/admin/history
 * @access Admin
 */
exports.getAllWithdrawals = async (req, res) => {
  try {
    const { page = 1, limit = 20, status, userId, startDate, endDate } = req.query;

    const query = {};
    
    // Filter by status if provided
    if (status) {
      query.status = status;
    }

    // Filter by user ID if provided
    if (userId) {
      query.user = userId;
    }

    // Filter by date range if provided
    if (startDate && endDate) {
      query.createdAt = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }

    const withdrawals = await Withdrawal.find(query)
      .populate('user', 'name email profileImage')
      .populate('approvedBy', 'name email')
      .populate('rejectedBy', 'name email')
      .populate('paidBy', 'name email')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const count = await Withdrawal.countDocuments(query);

    res.status(200).json({
      success: true,
      count,
      data: withdrawals,
      totalPages: Math.ceil(count / limit),
      currentPage: page
    });
  } catch (error) {
    console.error('Error fetching all withdrawals:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch withdrawals',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};
 
module.exports = exports;