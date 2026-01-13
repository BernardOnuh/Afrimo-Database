// controller/withdrawalController.js
/**
 * COMPLETE WITHDRAWAL CONTROLLER - UPDATED VERSION
 * Handles both Bank and Crypto withdrawals with Receipt Support
 * 
 * This file includes:
 * - All existing bank withdrawal functions
 * - All crypto withdrawal functions  
 * - Receipt generation for both bank and crypto
 * - Admin management functions
 * - Swagger-ready JSDoc comments
 */

const mongoose = require('mongoose');
const User = require('../models/User');
const Referral = require('../models/Referral');
const ReferralTransaction = require('../models/ReferralTransaction');
const Withdrawal = require('../models/Withdrawal');
const Payment = require('../models/Payment');
const CryptoExchangeRate = require('../models/CryptoExchangeRate');
const { sendEmail } = require('../utils/emailService');
const axios = require('axios');
const ethers = require('ethers');
const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');

// ========== CONFIGURATION ==========

// Minimum withdrawal amounts
const MINIMUM_WITHDRAWAL_AMOUNT = 20000; // Bank: 20,000 NGN
const MINIMUM_CRYPTO_WITHDRAWAL = 1000; // Crypto: 1,000 NGN

// BNB Configuration
const BNB_CONFIG = {
  rpcUrl: process.env.BNB_RPC_URL || 'https://bsc-dataseed.binance.org/',
  chainId: 56,
  USDT_CONTRACT: '0x55d398326f99059fF775485246999027B3197955',
  USDT_DECIMALS: 18
};

// ========== BANK WITHDRAWAL FUNCTIONS ==========

/**
 * Process an instant withdrawal to bank account
 * @route POST /api/withdrawal/instant
 * @access Private
 */
exports.processInstantWithdrawal = async (req, res) => {
  try {
    const userId = req.user.id;
    const { amount, notes } = req.body;

    console.log(`Starting withdrawal process for user ${userId}, amount: ${amount}`);

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

    // Check for ANY non-completed withdrawal (pending OR processing)
    const existingWithdrawal = await Withdrawal.findOne({
      user: userId,
      status: { $in: ['pending', 'processing'] }
    });

    if (existingWithdrawal) {
      return res.status(400).json({
        success: false,
        message: `You have a ${existingWithdrawal.status} withdrawal in progress. Please wait for it to complete before making another withdrawal request.`
      });
    }

    // Get referral data for balance check
    const referralData = await Referral.findOne({ user: userId });
    if (!referralData || referralData.totalEarnings < amount) {
      return res.status(400).json({
        success: false,
        message: 'Insufficient balance for this withdrawal'
      });
    }

    // Calculate available balance
    const availableBalance = referralData.totalEarnings - 
                            (referralData.totalWithdrawn || 0) - 
                            (referralData.pendingWithdrawals || 0) - 
                            (referralData.processingWithdrawals || 0);

    console.log(`User ${userId} - Available balance: ${availableBalance}, Requested: ${amount}`);

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
    
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      console.log(`Creating withdrawal record with reference: ${clientReference}`);
      
      // Create a pending withdrawal record
      const withdrawal = new Withdrawal({
        user: userId,
        amount,
        withdrawalType: 'bank',
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

      await withdrawal.save({ session });

      // Update referral to add pending withdrawal amount
      await Referral.findOneAndUpdate(
        { user: userId },
        { $inc: { pendingWithdrawals: amount } },
        { session }
      );

      console.log(`Making API call to Lenco for withdrawal...`);
      
      // Process the bank transfer using Lenco API
      const lencoPayload = {
        accountId: process.env.LENCO_ACCOUNT_ID,
        accountNumber: paymentData.bankAccount.accountNumber,
        bankCode: paymentData.bankAccount.bankCode,
        amount: amount.toString(),
        narration: `Afrimobile Earnings Withdrawal`,
        reference: clientReference,
        senderName: 'Afrimobile'
      };
      
      console.log('Lenco request payload:', JSON.stringify(lencoPayload));
      console.log('Using Lenco account ID:', process.env.LENCO_ACCOUNT_ID);
      
      const response = await axios.post('https://api.lenco.co/access/v1/transactions', lencoPayload, {
        headers: {
          'Authorization': `Bearer ${process.env.LENCO_API_KEY}`,
          'Content-Type': 'application/json'
        }
      });

      console.log(`Lenco API response status:`, response.status);
      console.log(`Lenco API response:`, JSON.stringify(response.data));

      if (response.data && response.data.status) {
        // Update withdrawal with transaction reference
        withdrawal.transactionReference = response.data.data.transactionReference;
        
        // Set status based on immediate response
        if (response.data.data.status === 'successful') {
          withdrawal.status = 'paid';
          withdrawal.processedAt = new Date();
          
          // Move amount from pending to totalWithdrawn
          await Referral.findOneAndUpdate(
            { user: userId },
            { 
              $inc: { 
                pendingWithdrawals: -amount,
                totalWithdrawn: amount 
              } 
            },
            { session }
          );
          
          // Create a transaction record
          const transaction = new ReferralTransaction({
            user: userId,
            type: 'withdrawal',
            amount: -amount,
            description: `Withdrawal to ${paymentData.bankAccount.bankName} - ${paymentData.bankAccount.accountNumber}`,
            status: 'completed',
            reference: clientReference,
            generation: 0,
            referredUser: userId,
            beneficiary: userId
          });
          await transaction.save({ session });
          
        } else if (response.data.data.status === 'failed' || response.data.data.status === 'declined') {
          withdrawal.status = 'failed';
          withdrawal.rejectionReason = response.data.data.reasonForFailure || 'Transaction failed';
          
          // Remove pending withdrawal amount
          await Referral.findOneAndUpdate(
            { user: userId },
            { $inc: { pendingWithdrawals: -amount } },
            { session }
          );
          
        } else if (response.data.data.status === 'processing') {
          withdrawal.status = 'processing';
          
          // Move amount from pending to processing
          await Referral.findOneAndUpdate(
            { user: userId },
            { 
              $inc: { 
                pendingWithdrawals: -amount,
                processingWithdrawals: amount 
              } 
            },
            { session }
          );
        }

        await withdrawal.save({ session });
        await session.commitTransaction();
        session.endSession();

        console.log(`Withdrawal record updated with status: ${withdrawal.status}`);

        // Get user info for receipt and notification
        const user = await User.findById(userId);

        // Generate receipt for successful payments
        let receipt = null;
        if (withdrawal.status === 'paid') {
          try {
            receipt = await generateBankWithdrawalReceipt(withdrawal, user);
            
            // Send confirmation email
            try {
              await sendEmail({
                email: user.email,
                subject: 'Withdrawal Successful',
                html: `
                  <h2>Withdrawal Successful</h2>
                  <p>Hello ${user.name},</p>
                  <p>Your withdrawal of ₦${amount.toLocaleString()} has been processed successfully.</p>
                  <p><strong>Transaction Reference:</strong> ${response.data.data.transactionReference}</p>
                  <p>Thank you for using our platform!</p>
                `
              });
            } catch (emailError) {
              console.error('Failed to send withdrawal confirmation email:', emailError);
            }
          } catch (receiptError) {
            console.error('Failed to generate receipt:', receiptError);
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
            receiptUrl: receipt?.filePath || null
          }
        });
      } else {
        // Rollback if API response is invalid
        await session.abortTransaction();
        session.endSession();
        throw new Error('Failed to process transaction with payment provider');
      }
    } catch (transferError) {
      await session.abortTransaction();
      session.endSession();
      
      console.error('Bank transfer error:', transferError.message);
      
      // Update withdrawal status to failed
      const withdrawal = await Withdrawal.findOne({ clientReference });
      if (withdrawal) {
        withdrawal.status = 'failed';
        withdrawal.rejectionReason = transferError.response?.data?.message || 'Payment processing failed';
        await withdrawal.save();
      }

      return res.status(400).json({
        success: false,
        message: 'Failed to process withdrawal',
        error: transferError.response?.data?.message || 'Payment processing failed'
      });
    }
  } catch (error) {
    console.error('Error processing instant withdrawal:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to process withdrawal',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Check if user has any pending or processing withdrawal
 * @middleware
 */
exports.checkExistingWithdrawals = async (req, res, next) => {
  try {
    const userId = req.user.id;
    
    const existingWithdrawal = await Withdrawal.findOne({
      user: userId,
      status: { $in: ['pending', 'processing'] }
    });

    if (existingWithdrawal) {
      return res.status(400).json({
        success: false,
        message: `You have a ${existingWithdrawal.status} withdrawal in progress. Please wait for it to complete before making another withdrawal request.`
      });
    }
    
    next();
  } catch (error) {
    console.error('Error checking existing withdrawals:', error);
    return res.status(500).json({
      success: false,
      message: 'Error checking withdrawal status',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Get user's current withdrawal status
 * @route GET /api/withdrawal/status
 * @access Private
 */
exports.getWithdrawalStatus = async (req, res) => {
  try {
    const userId = req.user.id;
    
    const existingWithdrawal = await Withdrawal.findOne({
      user: userId,
      status: { $in: ['pending', 'processing'] }
    }).sort({ createdAt: -1 });
    
    const referralData = await Referral.findOne({ user: userId });
    
    const availableBalance = referralData ? 
      referralData.totalEarnings - 
      (referralData.totalWithdrawn || 0) - 
      (referralData.pendingWithdrawals || 0) - 
      (referralData.processingWithdrawals || 0) : 0;
    
    return res.status(200).json({
      success: true,
      data: {
        canWithdraw: !existingWithdrawal && availableBalance >= MINIMUM_WITHDRAWAL_AMOUNT,
        availableBalance: availableBalance,
        minimumWithdrawalAmount: MINIMUM_WITHDRAWAL_AMOUNT,
        activeWithdrawal: existingWithdrawal ? {
          id: existingWithdrawal._id,
          amount: existingWithdrawal.amount,
          status: existingWithdrawal.status,
          createdAt: existingWithdrawal.createdAt,
          clientReference: existingWithdrawal.clientReference
        } : null
      }
    });
  } catch (error) {
    console.error('Error getting withdrawal status:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch withdrawal status',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Verify pending withdrawals with Lenco API
 * @route GET /api/withdrawal/verify-pending
 * @access Private
 */
exports.verifyPendingWithdrawals = async (req, res) => {
  try {
    const userId = req.user.id;
    
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
            
            const transaction = new ReferralTransaction({
              user: userId,
              type: 'withdrawal',
              amount: -withdrawal.amount,
              description: `Withdrawal to ${withdrawal.paymentDetails.bankName}`,
              status: 'completed',
              reference: withdrawal.clientReference
            });
            await transaction.save();
            
          } else if (transactionData.status === 'failed' || transactionData.status === 'declined') {
            withdrawal.status = 'failed';
            withdrawal.rejectionReason = transactionData.reasonForFailure || 'Transaction failed';
          }
          
          await withdrawal.save();
        }
      } catch (apiError) {
        console.error(`Error verifying withdrawal ${withdrawal._id}:`, apiError);
      }
    }

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
    
    // If transaction is still processing, check status with Lenco
    if (withdrawal.status === 'processing' || withdrawal.status === 'pending') {
      try {
        const session = await mongoose.startSession();
        session.startTransaction();
        
        try {
          const response = await axios.get(`https://api.lenco.co/access/v1/transaction-by-reference/${withdrawal.clientReference}`, {
            headers: {
              'Authorization': `Bearer ${process.env.LENCO_API_KEY}`
            }
          });
          
          if (response.data && response.data.status) {
            const transactionData = response.data.data;
            
            if (transactionData.status === 'successful') {
              const prevStatus = withdrawal.status;
              
              withdrawal.status = 'paid';
              withdrawal.processedAt = new Date();
              withdrawal.transactionReference = transactionData.transactionReference;
              
              const existingTransaction = await ReferralTransaction.findOne({ reference: withdrawal.clientReference });
              if (!existingTransaction) {
                const transaction = new ReferralTransaction({
                  user: withdrawal.user,
                  type: 'withdrawal',
                  amount: -withdrawal.amount,
                  description: `Withdrawal to ${withdrawal.paymentDetails.bankName}`,
                  status: 'completed',
                  reference: withdrawal.clientReference
                });
                await transaction.save({ session });
              }
              
              const updateObj = { $inc: { totalWithdrawn: withdrawal.amount } };
              
              if (prevStatus === 'pending') {
                updateObj.$inc.pendingWithdrawals = -withdrawal.amount;
              } else if (prevStatus === 'processing') {
                updateObj.$inc.processingWithdrawals = -withdrawal.amount;
              }
              
              await Referral.findOneAndUpdate(
                { user: withdrawal.user },
                updateObj,
                { session }
              );
              
            } else if (transactionData.status === 'failed' || transactionData.status === 'declined') {
              const prevStatus = withdrawal.status;
              
              withdrawal.status = 'failed';
              withdrawal.failedAt = transactionData.failedAt;
              withdrawal.rejectionReason = transactionData.reasonForFailure || 'Transaction failed';
              
              const updateObj = { $inc: {} };
              
              if (prevStatus === 'pending') {
                updateObj.$inc.pendingWithdrawals = -withdrawal.amount;
              } else if (prevStatus === 'processing') {
                updateObj.$inc.processingWithdrawals = -withdrawal.amount;
              }
              
              await Referral.findOneAndUpdate(
                { user: withdrawal.user },
                updateObj,
                { session }
              );
            }
            
            await withdrawal.save({ session });
            await session.commitTransaction();
            session.endSession();
          }
        } catch (error) {
          await session.abortTransaction();
          session.endSession();
          throw error;
        }
      } catch (apiError) {
        console.error('Error checking transaction status:', apiError);
      }
    }
    
    const referralData = await Referral.findOne({ user: withdrawal.user });
    
    const availableBalance = referralData ? 
      referralData.totalEarnings - 
      (referralData.totalWithdrawn || 0) - 
      (referralData.pendingWithdrawals || 0) - 
      (referralData.processingWithdrawals || 0) : 0;
    
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
        failedAt: withdrawal.failedAt,
        availableBalance: availableBalance
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
 * Check for pending withdrawals middleware
 */
exports.checkPendingWithdrawal = async (req, res, next) => {
  try {
    const userId = req.user.id;
    
    const pendingWithdrawal = await Withdrawal.findOne({
      user: userId,
      status: 'pending'
    });

    if (pendingWithdrawal) {
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
 * Get withdrawal receipt URL
 * @route GET /api/withdrawal/receipt/:id
 * @access Private
 */
exports.getWithdrawalReceipt = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const withdrawal = await Withdrawal.findById(id);
    
    if (!withdrawal) {
      return res.status(404).json({
        success: false,
        message: 'Withdrawal not found'
      });
    }
    
    if (withdrawal.user.toString() !== userId && !req.user.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to access this receipt'
      });
    }

    const user = await User.findById(withdrawal.user);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    const receipt = await generateBankWithdrawalReceipt(withdrawal, user);
    
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
 * Download bank withdrawal receipt as PDF
 * @route GET /api/withdrawal/download-receipt/:id
 * @access Private
 */
exports.downloadWithdrawalReceipt = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const withdrawal = await Withdrawal.findById(id);
    
    if (!withdrawal) {
      return res.status(404).json({
        success: false,
        message: 'Withdrawal not found'
      });
    }
    
    if (withdrawal.user.toString() !== userId && !req.user.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to access this receipt'
      });
    }

    const user = await User.findById(withdrawal.user);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const doc = new PDFDocument({
      size: 'A4',
      margin: 50,
      info: {
        Title: 'Withdrawal Receipt',
        Author: 'Afrimobile',
        Subject: 'Withdrawal Receipt',
      }
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="withdrawal-receipt-${id}.pdf"`);
    
    doc.pipe(res);
    
    // Add header
    doc.fontSize(20)
      .fillColor('#5A19A0')
      .text('WITHDRAWAL RECEIPT', { align: 'center' })
      .moveDown(1);
      
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
    
    const formatAmount = (amount) => {
      return amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    };
    
    doc.rect(50, 130, 500, 450)
      .lineWidth(1)
      .stroke('#5A19A0');
      
    doc.fontSize(14)
      .fillColor('#333333')
      .text('TRANSACTION DETAILS', 70, 150)
      .moveDown(0.5);
      
    doc.moveTo(70, 175).lineTo(530, 175).stroke('#CCCCCC');
    
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
    
    let yPos = withdrawal.transactionReference && withdrawal.clientReference ? 365 : 
              (withdrawal.transactionReference || withdrawal.clientReference) ? 340 : 315;
    doc.moveTo(70, yPos).lineTo(530, yPos).stroke('#CCCCCC');
    
    yPos += 25;
    
    doc.fontSize(14)
      .fillColor('#333333')
      .text('USER DETAILS', 70, yPos)
      .moveDown(0.5);
      
    yPos += 25;
    
    doc.moveTo(70, yPos).lineTo(530, yPos).stroke('#CCCCCC');
    
    yPos += 25;
    
    doc.fontSize(10)
      .text('Name:', 70, yPos)
      .text(user.name, 200, yPos);
      
    yPos += 25;
      
    doc.text('Email:', 70, yPos)
      .text(user.email, 200, yPos);
      
    yPos += 50;
    
    if (withdrawal.paymentDetails) {
      doc.moveTo(70, yPos).lineTo(530, yPos).stroke('#CCCCCC');
      
      yPos += 25;
      
      doc.fontSize(14)
        .fillColor('#333333')
        .text('PAYMENT DETAILS', 70, yPos)
        .moveDown(0.5);
        
      yPos += 25;
      
      doc.moveTo(70, yPos).lineTo(530, yPos).stroke('#CCCCCC');
      
      yPos += 25;
      
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
      }
    }
    
    doc.fontSize(8)
      .fillColor('#999999')
      .text('This is an electronically generated receipt', 50, 700, { align: 'center' })
      .text('Afrimobile - Your Time', 50, 715, { align: 'center' });
    
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
 * Request a withdrawal (pending approval)
 * @route POST /api/withdrawal/request
 * @access Private
 */
exports.requestWithdrawal = async (req, res) => {
  try {
    const userId = req.user.id;
    const { amount, paymentMethod, paymentDetails, notes } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid withdrawal amount'
      });
    }

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

    const referralData = await Referral.findOne({ user: userId });
    if (!referralData || referralData.totalEarnings < amount) {
      return res.status(400).json({
        success: false,
        message: 'Insufficient balance for this withdrawal'
      });
    }

    const paymentData = await Payment.findOne({ user: userId });
    
    if (paymentMethod === 'bank') {
      if (!paymentDetails.bankName || !paymentDetails.accountName || !paymentDetails.accountNumber) {
        return res.status(400).json({
          success: false,
          message: 'Please provide complete bank details'
        });
      }
    }

    const withdrawal = new Withdrawal({
      user: userId,
      amount,
      withdrawalType: 'bank',
      paymentMethod,
      paymentDetails,
      notes,
      status: 'pending'
    });

    await withdrawal.save();

    try {
      const user = await User.findById(userId);
      
      await sendEmail({
        email: process.env.ADMIN_EMAIL || 'admin@afrimobile.com',
        subject: 'New Withdrawal Request',
        html: `
          <h2>New Withdrawal Request Submitted</h2>
          <p><strong>User:</strong> ${user.name} (${user.email})</p>
          <p><strong>Amount:</strong> ₦${amount.toLocaleString()}</p>
          <p><strong>Payment Method:</strong> ${paymentMethod}</p>
        `
      });
    } catch (emailError) {
      console.error('Failed to send admin notification email:', emailError);
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
 * @route GET /api/withdrawal/earnings-balance
 * @access Private
 */
exports.getEarningsBalance = async (req, res) => {
  try {
    const userId = req.user.id;

    const referralData = await Referral.findOne({ user: userId });
    
    if (!referralData) {
      return res.status(200).json({
        success: true,
        data: {
          totalEarnings: 0,
          pendingWithdrawals: 0,
          processingWithdrawals: 0,
          totalWithdrawn: 0,
          availableBalance: 0,
          minimumWithdrawalAmount: MINIMUM_WITHDRAWAL_AMOUNT,
          canWithdraw: false
        }
      });
    }
    
    const totalEarnings = referralData.totalEarnings || 0;
    const pendingWithdrawals = referralData.pendingWithdrawals || 0;
    const processingWithdrawals = referralData.processingWithdrawals || 0;
    const totalWithdrawn = referralData.totalWithdrawn || 0;
    
    const availableBalance = totalEarnings - totalWithdrawn - pendingWithdrawals - processingWithdrawals;

    res.status(200).json({
      success: true,
      data: {
        totalEarnings,
        pendingWithdrawals,
        processingWithdrawals,
        totalWithdrawn,
        availableBalance,
        minimumWithdrawalAmount: MINIMUM_WITHDRAWAL_AMOUNT,
        canWithdraw: availableBalance >= MINIMUM_WITHDRAWAL_AMOUNT && 
                     pendingWithdrawals === 0 && 
                     processingWithdrawals === 0
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

// ========== ADMIN BANK WITHDRAWAL FUNCTIONS ==========

/**
 * Get withdrawal statistics (Admin)
 * @route GET /api/withdrawal/admin/stats
 * @access Admin
 */
exports.getWithdrawalStats = async (req, res) => {
  try {
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

    const statusCounts = await Withdrawal.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
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
        statusCounts
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
 * Get all instant withdrawals (Admin)
 * @route GET /api/withdrawal/admin/instant
 * @access Admin
 */
exports.getInstantWithdrawals = async (req, res) => {
  try {
    const { page = 1, limit = 20, status, startDate, endDate } = req.query;

    const query = {};
    
    if (status) {
      query.status = status;
    }

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
 * Get pending withdrawals (Admin)
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
 * Approve a withdrawal (Admin)
 * @route PUT /api/withdrawal/admin/:id/approve
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

    withdrawal.status = 'approved';
    withdrawal.approvedBy = req.user.id;
    withdrawal.approvedAt = new Date();
    withdrawal.adminNotes = notes;

    await withdrawal.save();

    const user = await User.findById(withdrawal.user);

    try {
      await sendEmail({
        email: user.email,
        subject: 'Withdrawal Request Approved',
        html: `
          <h2>Withdrawal Request Approved</h2>
          <p>Hello ${user.name},</p>
          <p>Your withdrawal request of ₦${withdrawal.amount.toLocaleString()} has been approved.</p>
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
 * Reject a withdrawal (Admin)
 * @route PUT /api/withdrawal/admin/:id/reject
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

    withdrawal.status = 'rejected';
    withdrawal.rejectedBy = req.user.id;
    withdrawal.rejectedAt = new Date();
    withdrawal.rejectionReason = rejectionReason;
    withdrawal.adminNotes = notes;

    await withdrawal.save();

    const user = await User.findById(withdrawal.user);

    try {
      await sendEmail({
        email: user.email,
        subject: 'Withdrawal Request Rejected',
        html: `
          <h2>Withdrawal Request Rejected</h2>
          <p>Hello ${user.name},</p>
          <p>Your withdrawal request of ₦${withdrawal.amount.toLocaleString()} has been rejected.</p>
          <p><strong>Reason:</strong> ${rejectionReason}</p>
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
 * Mark withdrawal as paid (Admin)
 * @route PUT /api/withdrawal/admin/:id/pay
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

    withdrawal.status = 'paid';
    withdrawal.paidBy = req.user.id;
    withdrawal.processedAt = new Date();
    if (transactionReference) {
      withdrawal.transactionReference = transactionReference;
    }

    await withdrawal.save();

    const transaction = new ReferralTransaction({
      user: withdrawal.user,
      type: 'withdrawal',
      amount: -withdrawal.amount,
      description: `Withdrawal to ${withdrawal.paymentMethod}`,
      status: 'completed',
      reference: withdrawal.transactionReference || `MANUAL-${withdrawal._id}`
    });
    await transaction.save();

    const user = await User.findById(withdrawal.user);

    try {
      await sendEmail({
        email: user.email,
        subject: 'Withdrawal Completed',
        html: `
          <h2>Withdrawal Completed</h2>
          <p>Hello ${user.name},</p>
          <p>Your withdrawal of ₦${withdrawal.amount.toLocaleString()} has been processed successfully.</p>
        `
      });
    } catch (emailError) {
      console.error('Failed to send payment confirmation email:', emailError);
    }

    res.status(200).json({
      success: true,
      message: 'Withdrawal marked as paid successfully',
      data: withdrawal
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
 * Get all withdrawals (Admin)
 * @route GET /api/withdrawal/admin/all
 * @access Admin
 */
exports.getAllWithdrawals = async (req, res) => {
  try {
    const { page = 1, limit = 20, status, userId, startDate, endDate } = req.query;

    const query = {};
    
    if (status) {
      query.status = status;
    }

    if (userId) {
      query.user = userId;
    }

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

// ========== CRYPTO WITHDRAWAL FUNCTIONS ==========

/**
 * Get current crypto exchange rates
 * @route GET /api/withdrawal/crypto/rates
 * @access Public
 */
exports.getCryptoRates = async (req, res) => {
  try {
    let rates = await CryptoExchangeRate.findOne({ active: true });
    
    if (!rates) {
      const response = await axios.get(
        'https://api.coingecko.com/api/v3/simple/price?ids=tether,binancecoin&vs_currencies=ngn'
      );

      const usdtPriceNGN = response.data.tether.ngn;
      const bnbPriceNGN = response.data.binancecoin.ngn;

      rates = await CryptoExchangeRate.findOneAndUpdate(
        { active: true },
        {
          usdtPriceNGN,
          bnbPriceNGN,
          lastUpdated: new Date(),
          source: 'CoinGecko'
        },
        { upsert: true, new: true }
      );
    }

    return res.json({
      success: true,
      data: {
        usdtPriceNGN: rates.usdtPriceNGN,
        bnbPriceNGN: rates.bnbPriceNGN,
        minimumWithdrawalNGN: MINIMUM_CRYPTO_WITHDRAWAL,
        equivalentUSDT: (MINIMUM_CRYPTO_WITHDRAWAL / rates.usdtPriceNGN).toFixed(6)
      }
    });
  } catch (error) {
    console.error('Error fetching crypto rates:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch crypto exchange rates',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Get user's crypto wallet
 * @route GET /api/withdrawal/crypto/wallet
 * @access Private
 */
exports.getUserCryptoWallet = async (req, res) => {
  try {
    const userId = req.user.id;

    const paymentData = await Payment.findOne({ user: userId });

    if (!paymentData || !paymentData.cryptoWallet) {
      return res.json({
        success: true,
        data: null,
        message: 'No crypto wallet set up yet'
      });
    }

    const safeWallet = {
      walletAddress: paymentData.cryptoWallet.walletAddress,
      chainName: paymentData.cryptoWallet.chainName || 'BNB',
      cryptoType: paymentData.cryptoWallet.cryptoType || 'USDT',
      verified: paymentData.cryptoWallet.verified || false
    };

    return res.json({
      success: true,
      data: safeWallet
    });
  } catch (error) {
    console.error('Error fetching crypto wallet:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch crypto wallet',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Setup or update user's crypto wallet
 * @route POST /api/withdrawal/crypto/wallet/setup
 * @access Private
 */
exports.setupCryptoWallet = async (req, res) => {
  try {
    const userId = req.user.id;
    const { walletAddress, cryptoType = 'USDT', chainName = 'BNB' } = req.body;

    if (!walletAddress || !ethers.utils.isAddress(walletAddress)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid wallet address. Please provide a valid BNB chain address.'
      });
    }

    let paymentData = await Payment.findOne({ user: userId });

    if (!paymentData) {
      paymentData = new Payment({ user: userId });
    }

    paymentData.cryptoWallet = {
      walletAddress: walletAddress.toLowerCase(),
      cryptoType,
      chainName,
      verified: false
    };

    await paymentData.save();

    const user = await User.findById(userId);
    try {
      await sendEmail({
        email: user.email,
        subject: 'Crypto Wallet Setup Confirmation',
        html: `
          <h2>Crypto Wallet Added</h2>
          <p>Hello ${user.name},</p>
          <p>You've successfully added a crypto wallet to your account.</p>
          <p><strong>Wallet Address:</strong> ${walletAddress}</p>
          <p><strong>Network:</strong> ${chainName}</p>
          <p>You can now withdraw your earnings directly to this wallet.</p>
        `
      });
    } catch (emailError) {
      console.error('Failed to send email:', emailError);
    }

    res.json({
      success: true,
      message: 'Crypto wallet setup successfully',
      data: {
        walletAddress,
        cryptoType,
        chainName,
        verified: false
      }
    });
  } catch (error) {
    console.error('Error setting up crypto wallet:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to setup crypto wallet',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Request crypto withdrawal
 * @route POST /api/withdrawal/crypto/request
 * @access Private
 */
exports.processCryptoWithdrawal = async (req, res) => {
  try {
    const userId = req.user.id;
    const { amountNGN } = req.body;

    console.log(`Crypto withdrawal request: user ${userId}, amount ${amountNGN}`);

    if (!amountNGN || amountNGN <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid withdrawal amount'
      });
    }

    if (amountNGN < MINIMUM_CRYPTO_WITHDRAWAL) {
      return res.status(400).json({
        success: false,
        message: `Minimum crypto withdrawal is ₦${MINIMUM_CRYPTO_WITHDRAWAL.toLocaleString()}`
      });
    }

    const existingCrypto = await Withdrawal.findOne({
      user: userId,
      withdrawalType: 'crypto',
      status: { $in: ['pending', 'processing'] }
    });

    if (existingCrypto) {
      return res.status(400).json({
        success: false,
        message: `You have a pending crypto withdrawal in progress.`
      });
    }

    const existingBank = await Withdrawal.findOne({
      user: userId,
      withdrawalType: 'bank',
      status: { $in: ['pending', 'processing'] }
    });

    if (existingBank) {
      return res.status(400).json({
        success: false,
        message: `You have a pending bank withdrawal. Complete it before requesting crypto withdrawal.`
      });
    }

    const paymentData = await Payment.findOne({ user: userId });
    if (!paymentData || !paymentData.cryptoWallet) {
      return res.status(400).json({
        success: false,
        message: 'Please setup a crypto wallet first'
      });
    }

    const rates = await CryptoExchangeRate.findOne({ active: true });
    if (!rates) {
      throw new Error('Exchange rates not available');
    }

    const amountUSDT = parseFloat((amountNGN / rates.usdtPriceNGN).toFixed(6));

    const referralData = await Referral.findOne({ user: userId });
    if (!referralData || referralData.totalEarnings < amountNGN) {
      return res.status(400).json({
        success: false,
        message: 'Insufficient balance'
      });
    }

    const availableBalance = referralData.totalEarnings - 
                            (referralData.totalWithdrawn || 0) - 
                            (referralData.pendingWithdrawals || 0) - 
                            (referralData.processingWithdrawals || 0);

    if (availableBalance < amountNGN) {
      return res.status(400).json({
        success: false,
        message: 'Insufficient available balance'
      });
    }

    const reference = `CRYPTO-${userId.substr(-6)}-${Date.now()}`;
    
    const withdrawal = new Withdrawal({
      user: userId,
      amount: amountNGN,
      withdrawalType: 'crypto',
      cryptoDetails: {
        amountUSDT,
        walletAddress: paymentData.cryptoWallet.walletAddress,
        chainName: 'BNB',
        exchangeRate: rates.usdtPriceNGN
      },
      status: 'pending',
      clientReference: reference
    });

    await withdrawal.save();

    await Referral.findOneAndUpdate(
      { user: userId },
      { $inc: { pendingWithdrawals: amountNGN } }
    );

    const user = await User.findById(userId);
    try {
      await sendEmail({
        email: user.email,
        subject: 'Crypto Withdrawal Request Received',
        html: `
          <h2>Withdrawal Request Submitted</h2>
          <p>Hello ${user.name},</p>
          <p>Your crypto withdrawal request has been received.</p>
          <p><strong>Amount:</strong> ${amountUSDT} USDT (₦${amountNGN.toLocaleString()})</p>
          <p><strong>Wallet:</strong> ${paymentData.cryptoWallet.walletAddress}</p>
          <p>Your request will be processed shortly.</p>
        `
      });
    } catch (emailError) {
      console.error('Failed to send email:', emailError);
    }

    res.status(201).json({
      success: true,
      message: 'Crypto withdrawal request submitted',
      data: {
        id: withdrawal._id,
        amountNGN,
        amountUSDT,
        walletAddress: paymentData.cryptoWallet.walletAddress,
        status: 'pending',
        reference
      }
    });
  } catch (error) {
    console.error('Error processing crypto withdrawal:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process withdrawal',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Get user's crypto withdrawal history
 * @route GET /api/withdrawal/crypto/history
 * @access Private
 */
exports.getCryptoWithdrawalHistory = async (req, res) => {
  try {
    const userId = req.user.id;

    const withdrawals = await Withdrawal.find({ 
      user: userId,
      withdrawalType: 'crypto'
    }).sort({ createdAt: -1 });

    res.json({
      success: true,
      count: withdrawals.length,
      data: withdrawals
    });
  } catch (error) {
    console.error('Error fetching crypto history:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch history',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Get crypto withdrawal status
 * @route GET /api/withdrawal/crypto/status/:id
 * @access Private
 */
exports.getCryptoWithdrawalStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const withdrawal = await Withdrawal.findById(id);

    if (!withdrawal) {
      return res.status(404).json({
        success: false,
        message: 'Withdrawal not found'
      });
    }

    if (withdrawal.user.toString() !== userId && !req.user.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized'
      });
    }

    res.json({
      success: true,
      data: withdrawal
    });
  } catch (error) {
    console.error('Error fetching status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch status',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Get crypto withdrawal receipt URL
 * @route GET /api/withdrawal/crypto/receipt/:id
 * @access Private
 */
exports.getCryptoWithdrawalReceipt = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const withdrawal = await Withdrawal.findById(id);

    if (!withdrawal) {
      return res.status(404).json({
        success: false,
        message: 'Withdrawal not found'
      });
    }

    if (withdrawal.user.toString() !== userId && !req.user.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized'
      });
    }

    if (withdrawal.withdrawalType !== 'crypto') {
      return res.status(400).json({
        success: false,
        message: 'This is not a crypto withdrawal'
      });
    }

    const user = await User.findById(withdrawal.user);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const receipt = await generateCryptoWithdrawalReceipt(withdrawal, user);

    res.json({
      success: true,
      data: {
        receiptUrl: receipt.filePath
      }
    });
  } catch (error) {
    console.error('Error generating receipt:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate receipt',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Download crypto withdrawal receipt as PDF
 * @route GET /api/withdrawal/crypto/download-receipt/:id
 * @access Private
 */
exports.downloadCryptoWithdrawalReceipt = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const withdrawal = await Withdrawal.findById(id);

    if (!withdrawal) {
      return res.status(404).json({
        success: false,
        message: 'Withdrawal not found'
      });
    }

    if (withdrawal.user.toString() !== userId && !req.user.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized'
      });
    }

    if (withdrawal.withdrawalType !== 'crypto') {
      return res.status(400).json({
        success: false,
        message: 'This is not a crypto withdrawal'
      });
    }

    const user = await User.findById(withdrawal.user);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const doc = new PDFDocument({
      size: 'A4',
      margin: 50,
      info: {
        Title: 'Crypto Withdrawal Receipt',
        Author: 'Afrimobile',
        Subject: 'Crypto Withdrawal Receipt',
      }
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="crypto-withdrawal-receipt-${id}.pdf"`);

    doc.pipe(res);

    // Header
    doc.fontSize(20)
      .fillColor('#5A19A0')
      .text('CRYPTO WITHDRAWAL RECEIPT', { align: 'center' })
      .moveDown(1);

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

    const formatAmount = (amount) => {
      return amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    };

    // Transaction details section
    doc.rect(50, 130, 500, 380)
      .lineWidth(1)
      .stroke('#5A19A0');

    doc.fontSize(14)
      .fillColor('#333333')
      .text('TRANSACTION DETAILS', 70, 150)
      .moveDown(0.5);

    doc.moveTo(70, 175).lineTo(530, 175).stroke('#CCCCCC');

    doc.fontSize(10)
      .text('Withdrawal ID:', 70, 190)
      .text(withdrawal._id.toString(), 200, 190)
      .text('Date & Time:', 70, 215)
      .text(formatDate(withdrawal.createdAt), 200, 215)
      .text('Status:', 70, 240);

    if (withdrawal.status === 'paid') {
      doc.fillColor('#27ae60').text('✓ Completed', 200, 240);
    } else if (withdrawal.status === 'processing') {
      doc.fillColor('#f39c12').text('⏳ Processing', 200, 240);
    } else {
      doc.fillColor('#e74c3c').text('⏸ Pending', 200, 240);
    }

    doc.fillColor('#333333')
      .text('Amount (NGN):', 70, 265)
      .text(`₦${formatAmount(withdrawal.amount)}`, 200, 265)
      .text('Amount (USDT):', 70, 290)
      .text(`${formatAmount(withdrawal.cryptoDetails.amountUSDT)} USDT`, 200, 290)
      .text('Exchange Rate:', 70, 315)
      .text(`1 USDT = ₦${formatAmount(withdrawal.cryptoDetails.exchangeRate)}`, 200, 315);

    let yPos = 340;

    if (withdrawal.cryptoDetails.transactionHash) {
      doc.text('Transaction Hash:', 70, yPos)
          .fontSize(8)
          .text(withdrawal.cryptoDetails.transactionHash, 70, yPos + 20, { width: 460, align: 'left' });
      yPos += 50;
      doc.fontSize(10);
    }

    if (withdrawal.cryptoDetails.blockNumber) {
      doc.text('Block Number:', 70, yPos)
          .text(withdrawal.cryptoDetails.blockNumber.toString(), 200, yPos);
      yPos += 25;
    }

    if (withdrawal.processedAt) {
      doc.text('Processed At:', 70, yPos)
          .text(formatDate(withdrawal.processedAt), 200, yPos);
      yPos += 25;
    }

    // Wallet details
    yPos += 25;
    doc.moveTo(70, yPos).lineTo(530, yPos).stroke('#CCCCCC');
    yPos += 25;

    doc.fontSize(14)
      .fillColor('#333333')
      .text('WALLET INFORMATION', 70, yPos);

    yPos += 25;
    doc.moveTo(70, yPos).lineTo(530, yPos).stroke('#CCCCCC');
    yPos += 25;

    doc.fontSize(10)
      .text('Recipient Wallet Address:', 70, yPos)
      .fontSize(8)
      .text(withdrawal.cryptoDetails.walletAddress, 70, yPos + 20, { width: 460, align: 'left' });

    yPos += 45;
    doc.fontSize(10)
      .text('Blockchain Network:', 70, yPos)
      .text(withdrawal.cryptoDetails.chainName, 200, yPos);

    yPos += 25;
    doc.text('Token:', 70, yPos)
      .text(withdrawal.cryptoDetails.cryptoType || 'USDT', 200, yPos);

    // User information
    yPos += 50;
    doc.moveTo(70, yPos).lineTo(530, yPos).stroke('#CCCCCC');
    yPos += 25;

    doc.fontSize(14)
      .fillColor('#333333')
      .text('RECIPIENT INFORMATION', 70, yPos);

    yPos += 25;
    doc.moveTo(70, yPos).lineTo(530, yPos).stroke('#CCCCCC');
    yPos += 25;

    doc.fontSize(10)
      .text('Full Name:', 70, yPos)
      .text(user.name, 200, yPos);

    yPos += 25;
    doc.text('Email Address:', 70, yPos)
      .text(user.email, 200, yPos);

    yPos += 25;
    doc.text('User ID:', 70, yPos)
      .fontSize(8)
      .text(user._id.toString(), 70, yPos + 20, { width: 460, align: 'left' });

    // Footer
    doc.fontSize(8)
      .fillColor('#999999')
      .text('This is an electronically generated receipt for a crypto withdrawal transaction', 50, 750, { align: 'center' })
      .text('Afrimobile - Your Time', 50, 765, { align: 'center' });

    if (withdrawal.status === 'paid' && withdrawal.cryptoDetails.transactionHash) {
      doc.fillColor('#5A19A0')
          .text(`View Transaction: https://bscscan.com/tx/${withdrawal.cryptoDetails.transactionHash}`, 50, 780, { 
            align: 'center', 
            fontSize: 7,
            link: `https://bscscan.com/tx/${withdrawal.cryptoDetails.transactionHash}`
          });
    }

    doc.end();

  } catch (error) {
    console.error('Error generating crypto receipt:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to generate receipt',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// ========== ADMIN CRYPTO FUNCTIONS ==========

/**
 * Setup admin crypto wallet
 * @route POST /api/withdrawal/admin/crypto/wallet/setup
 * @access Admin
 */
exports.setupAdminCryptoWallet = async (req, res) => {
  try {
    const { privateKey, seedPhrase } = req.body;

    if (!privateKey && !seedPhrase) {
      return res.status(400).json({
        success: false,
        message: 'Please provide private key or seed phrase'
      });
    }

    let wallet;
    try {
      if (privateKey) {
        wallet = new ethers.Wallet(privateKey);
      } else {
        wallet = ethers.Wallet.fromMnemonic(seedPhrase);
      }
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid private key or seed phrase'
      });
    }

    const provider = new ethers.providers.JsonRpcProvider(BNB_CONFIG.rpcUrl);
    const balance = await provider.getBalance(wallet.address);
    const balanceBNB = parseFloat(ethers.utils.formatEther(balance));

    if (balanceBNB < 0.01) {
      return res.status(400).json({
        success: false,
        message: `Insufficient BNB. Need 0.01+ BNB, have ${balanceBNB} BNB`
      });
    }

    global.adminCryptoWallet = {
      address: wallet.address,
      encryptedPrivateKey: Buffer.from(privateKey || seedPhrase).toString('base64'),
      balanceBNB,
      setupAt: new Date()
    };

    res.json({
      success: true,
      message: 'Admin wallet setup successfully',
      data: {
        walletAddress: wallet.address,
        balanceBNB,
        setupAt: new Date()
      }
    });
  } catch (error) {
    console.error('Error setting up admin wallet:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to setup wallet',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Get admin wallet status
 * @route GET /api/withdrawal/admin/crypto/wallet/status
 * @access Admin
 */
exports.getAdminCryptoWalletStatus = async (req, res) => {
  try {
    if (!global.adminCryptoWallet) {
      return res.json({
        success: true,
        data: null,
        message: 'Admin wallet not configured'
      });
    }

    const provider = new ethers.providers.JsonRpcProvider(BNB_CONFIG.rpcUrl);
    const balance = await provider.getBalance(global.adminCryptoWallet.address);
    const balanceBNB = parseFloat(ethers.utils.formatEther(balance));

    const usdtContract = new ethers.Contract(
      BNB_CONFIG.USDT_CONTRACT,
      ['function balanceOf(address) view returns (uint256)'],
      provider
    );

    const usdtBalance = await usdtContract.balanceOf(global.adminCryptoWallet.address);
    const balanceUSDT = parseFloat(ethers.utils.formatUnits(usdtBalance, BNB_CONFIG.USDT_DECIMALS));

    res.json({
      success: true,
      data: {
        walletAddress: global.adminCryptoWallet.address,
        balanceBNB,
        balanceUSDT,
        setupAt: global.adminCryptoWallet.setupAt
      }
    });
  } catch (error) {
    console.error('Error fetching wallet status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch status',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Get pending crypto withdrawals (Admin)
 * @route GET /api/withdrawal/admin/crypto/pending
 * @access Admin
 */
exports.getPendingCryptoWithdrawals = async (req, res) => {
  try {
    const pending = await Withdrawal.find({ 
      withdrawalType: 'crypto',
      status: 'pending' 
    })
      .populate('user', 'name email')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      count: pending.length,
      data: pending
    });
  } catch (error) {
    console.error('Error fetching pending:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch pending',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Process pending crypto withdrawals (Admin)
 * @route POST /api/withdrawal/admin/crypto/process
 * @access Admin
 */
exports.processPendingCryptoWithdrawals = async (req, res) => {
  try {
    if (!global.adminCryptoWallet) {
      return res.status(400).json({
        success: false,
        message: 'Admin wallet not configured'
      });
    }

    const pending = await Withdrawal.find({ 
      withdrawalType: 'crypto',
      status: 'pending' 
    }).limit(10);

    if (pending.length === 0) {
      return res.json({
        success: true,
        message: 'No pending withdrawals',
        data: { processed: 0, failed: 0 }
      });
    }

    const provider = new ethers.providers.JsonRpcProvider(BNB_CONFIG.rpcUrl);
    const privateKey = Buffer.from(global.adminCryptoWallet.encryptedPrivateKey, 'base64').toString();
    const signer = new ethers.Wallet(privateKey, provider);

    let processed = 0;
    let failed = 0;
    const results = [];

    for (const withdrawal of pending) {
      try {
        withdrawal.status = 'processing';
        await withdrawal.save();

        const usdtContract = new ethers.Contract(
          BNB_CONFIG.USDT_CONTRACT,
          [
            'function transfer(address to, uint256 amount) public returns (bool)',
            'function balanceOf(address) view returns (uint256)'
          ],
          signer
        );

        const amountWei = ethers.utils.parseUnits(
          withdrawal.cryptoDetails.amountUSDT.toString(),
          BNB_CONFIG.USDT_DECIMALS
        );

        const balance = await usdtContract.balanceOf(signer.address);
        if (balance.lt(amountWei)) {
          throw new Error('Insufficient USDT balance');
        }

        const tx = await usdtContract.transfer(withdrawal.cryptoDetails.walletAddress, amountWei);
        const receipt = await tx.wait();

        withdrawal.status = 'paid';
        withdrawal.cryptoDetails.transactionHash = receipt.transactionHash;
        withdrawal.cryptoDetails.blockNumber = receipt.blockNumber;
        withdrawal.processedAt = new Date();
        await withdrawal.save();

        await Referral.findOneAndUpdate(
          { user: withdrawal.user },
          {
            $inc: {
              pendingWithdrawals: -withdrawal.amount,
              totalWithdrawn: withdrawal.amount
            }
          }
        );

        const transaction = new ReferralTransaction({
          user: withdrawal.user,
          type: 'crypto_withdrawal',
          amount: -withdrawal.amount,
          description: `USDT withdrawal: ${withdrawal.cryptoDetails.amountUSDT} USDT`,
          status: 'completed',
          reference: receipt.transactionHash
        });
        await transaction.save();

        const user = await User.findById(withdrawal.user);
        try {
          await sendEmail({
            email: user.email,
            subject: 'Crypto Withdrawal Completed',
            html: `
              <h2>Withdrawal Complete!</h2>
              <p>Hello ${user.name},</p>
              <p>Your ${withdrawal.cryptoDetails.amountUSDT} USDT withdrawal has been sent.</p>
              <p><strong>Hash:</strong> ${receipt.transactionHash.substring(0, 20)}...</p>
            `
          });
        } catch (emailError) {
          console.error('Failed to send email:', emailError);
        }

        results.push({
          withdrawalId: withdrawal._id,
          status: 'success',
          transactionHash: receipt.transactionHash
        });
        processed++;
      } catch (error) {
        console.error(`Failed to process ${withdrawal._id}:`, error.message);

        withdrawal.status = 'failed';
        withdrawal.failureReason = error.message;
        await withdrawal.save();

        await Referral.findOneAndUpdate(
          { user: withdrawal.user },
          { $inc: { pendingWithdrawals: -withdrawal.amount } }
        );

        results.push({
          withdrawalId: withdrawal._id,
          status: 'failed',
          error: error.message
        });
        failed++;
      }
    }

    res.json({
      success: true,
      message: `Processed: ${processed}, Failed: ${failed}`,
      data: { processed, failed, results }
    });
  } catch (error) {
    console.error('Error processing withdrawals:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Get crypto withdrawal statistics (Admin)
 * @route GET /api/withdrawal/admin/crypto/stats
 * @access Admin
 */
exports.getCryptoStats = async (req, res) => {
  try {
    const stats = await Withdrawal.aggregate([
      {
        $match: { withdrawalType: 'crypto' }
      },
      {
        $group: {
          _id: null,
          totalWithdrawals: { $sum: 1 },
          totalAmountNGN: { $sum: '$amount' },
          completedCount: { $sum: { $cond: [{ $eq: ['$status', 'paid'] }, 1, 0] } },
          pendingCount: { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] } },
          failedCount: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } }
        }
      }
    ]);

    res.json({
      success: true,
      data: stats[0] || {
        totalWithdrawals: 0,
        totalAmountNGN: 0,
        completedCount: 0,
        pendingCount: 0,
        failedCount: 0
      }
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch stats',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// ========== HELPER FUNCTIONS ==========

/**
 * Helper function to generate bank withdrawal receipt and save to disk
 */
async function generateBankWithdrawalReceipt(withdrawal, user) {
  try {
    const receiptsDir = path.join(process.cwd(), 'receipts');
    if (!fs.existsSync(receiptsDir)) {
      fs.mkdirSync(receiptsDir, { recursive: true });
    }

    const receiptPath = path.join(receiptsDir, `bank-receipt-${withdrawal._id}.pdf`);
    const doc = new PDFDocument({
      size: 'A4',
      margin: 50,
      info: {
        Title: 'Withdrawal Receipt',
        Author: 'Afrimobile',
        Subject: 'Withdrawal Receipt'
      }
    });

    const stream = fs.createWriteStream(receiptPath);
    doc.pipe(stream);

    doc.fontSize(20)
      .fillColor('#5A19A0')
      .text('WITHDRAWAL RECEIPT', { align: 'center' })
      .moveDown(1);

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

    const formatAmount = (amount) => {
      return amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    };

    doc.rect(50, 130, 500, 380)
      .lineWidth(1)
      .stroke('#5A19A0');

    doc.fontSize(14)
      .fillColor('#333333')
      .text('TRANSACTION DETAILS', 70, 150)
      .moveDown(0.5);

    doc.moveTo(70, 175).lineTo(530, 175).stroke('#CCCCCC');

    doc.fontSize(10)
      .text('Transaction ID:', 70, 190)
      .text(withdrawal._id.toString(), 200, 190)
      .text('Date & Time:', 70, 215)
      .text(formatDate(withdrawal.createdAt), 200, 215)
      .text('Status:', 70, 240)
      .fillColor(withdrawal.status === 'paid' ? '#27ae60' : '#e74c3c')
      .text(withdrawal.status.charAt(0).toUpperCase() + withdrawal.status.slice(1), 200, 240)
      .fillColor('#333333')
      .text('Amount:', 70, 265)
      .text(`₦${formatAmount(withdrawal.amount)}`, 200, 265);

    doc.end();

    return new Promise((resolve, reject) => {
      stream.on('finish', () => {
        resolve({
          filePath: `/receipts/bank-receipt-${withdrawal._id}.pdf`,
          fullPath: receiptPath
        });
      });
      stream.on('error', reject);
    });
  } catch (error) {
    console.error('Error generating receipt:', error);
    throw error;
  }
}

/**
 * Helper function to generate crypto withdrawal receipt and save to disk
 */
async function generateCryptoWithdrawalReceipt(withdrawal, user) {
  try {
    const receiptsDir = path.join(process.cwd(), 'receipts');
    if (!fs.existsSync(receiptsDir)) {
      fs.mkdirSync(receiptsDir, { recursive: true });
    }

    const receiptPath = path.join(receiptsDir, `crypto-receipt-${withdrawal._id}.pdf`);
    const doc = new PDFDocument({
      size: 'A4',
      margin: 50,
      info: {
        Title: 'Crypto Withdrawal Receipt',
        Author: 'Afrimobile',
        Subject: 'Crypto Withdrawal Receipt'
      }
    });

    const stream = fs.createWriteStream(receiptPath);
    doc.pipe(stream);

    doc.fontSize(20)
      .fillColor('#5A19A0')
      .text('CRYPTO WITHDRAWAL RECEIPT', { align: 'center' })
      .moveDown(1);

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

    const formatAmount = (amount) => {
      return amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    };

    doc.rect(50, 130, 500, 350)
      .lineWidth(1)
      .stroke('#5A19A0');

    doc.fontSize(14)
      .fillColor('#333333')
      .text('TRANSACTION DETAILS', 70, 150)
      .moveDown(0.5);

    doc.moveTo(70, 175).lineTo(530, 175).stroke('#CCCCCC');

    doc.fontSize(10)
      .text('Withdrawal ID:', 70, 190)
      .text(withdrawal._id.toString().substring(0, 24), 200, 190)
      .text('Date & Time:', 70, 215)
      .text(formatDate(withdrawal.createdAt), 200, 215)
      .text('Status:', 70, 240);

    if (withdrawal.status === 'paid') {
      doc.fillColor('#27ae60').text('✓ Completed', 200, 240);
    } else if (withdrawal.status === 'processing') {
      doc.fillColor('#f39c12').text('⏳ Processing', 200, 240);
    } else {
      doc.fillColor('#e74c3c').text('⏸ Pending', 200, 240);
    }

    doc.fillColor('#333333')
      .text('Amount (NGN):', 70, 265)
      .text(`₦${formatAmount(withdrawal.amount)}`, 200, 265)
      .text('Amount (USDT):', 70, 290)
      .text(`${formatAmount(withdrawal.cryptoDetails.amountUSDT)} USDT`, 200, 290)
      .text('Exchange Rate:', 70, 315)
      .text(`1 USDT = ₦${formatAmount(withdrawal.cryptoDetails.exchangeRate)}`, 200, 315);

    doc.fontSize(8)
      .fillColor('#999999')
      .text('This is an electronically generated receipt', 50, 750, { align: 'center' })
      .text('Afrimobile - Your Time', 50, 765, { align: 'center' });

    doc.end();

    return new Promise((resolve, reject) => {
      stream.on('finish', () => {
        resolve({
          filePath: `/receipts/crypto-receipt-${withdrawal._id}.pdf`,
          fullPath: receiptPath
        });
      });
      stream.on('error', reject);
    });
  } catch (error) {
    console.error('Error generating receipt:', error);
    throw error;
  }
}

module.exports = exports;