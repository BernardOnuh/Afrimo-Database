// controller/paymentController.js
const User = require('../models/User');
const Payment = require('../models/Payment');
const fs = require('fs');
const path = require('path');

/**
 * Get current user's payment details
 * @route GET /api/payment/details
 * @access Private
 */
exports.getPaymentDetails = async (req, res) => {
  try {
    const userId = req.user.id;

    // Find payment details by user ID
    const paymentDetails = await Payment.findOne({ user: userId });
    
    // Get user data to merge with payment details
    const userData = await User.findById(userId).select('name email userName phone country state city interest walletAddress');
    
    if (!paymentDetails) {
      return res.status(200).json({
        success: true,
        message: 'No payment details found',
        data: {
          user: userData || {},
          bankAccount: null,
          cryptoWallet: null,
          kycStatus: {
            governmentId: { status: 'not_submitted' },
            proofOfAddress: { status: 'not_submitted' }
          },
          isVerified: false
        }
      });
    }

    // Format KYC document status for client
    const kycStatus = {
      governmentId: paymentDetails.kycDocuments?.governmentId 
        ? {
            status: paymentDetails.kycDocuments.governmentId.status,
            filename: paymentDetails.kycDocuments.governmentId.filename,
            uploadDate: paymentDetails.kycDocuments.governmentId.uploadDate
          }
        : { status: 'not_submitted' },
      proofOfAddress: paymentDetails.kycDocuments?.proofOfAddress
        ? {
            status: paymentDetails.kycDocuments.proofOfAddress.status,
            filename: paymentDetails.kycDocuments.proofOfAddress.filename,
            uploadDate: paymentDetails.kycDocuments.proofOfAddress.uploadDate
          }
        : { status: 'not_submitted' }
    };

    res.status(200).json({
      success: true,
      data: {
        user: userData || {},
        bankAccount: paymentDetails.bankAccount || null,
        cryptoWallet: paymentDetails.cryptoWallet || null,
        kycStatus,
        kycVerified: paymentDetails.kycVerified || false,
        isVerified: paymentDetails.isVerified || false,
        lastUpdated: paymentDetails.updatedAt
      }
    });
  } catch (error) {
    console.error('Error fetching payment details:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch payment details',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Update user's bank account details
 * @route POST /api/payment/bank-account
 * @access Private
 */
exports.updateBankAccount = async (req, res) => {
  try {
    const userId = req.user.id;
    const { accountName, bankName, accountNumber } = req.body;

    // Basic validation
    if (!accountName || !bankName || !accountNumber) {
      return res.status(400).json({
        success: false,
        message: 'Please provide all bank account details'
      });
    }

    // Validate account number format (basic check - adjust as needed)
    if (!/^\d{8,15}$/.test(accountNumber)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid account number format'
      });
    }

    // Find or create payment record
    let payment = await Payment.findOne({ user: userId });

    if (!payment) {
      // Create new payment record if doesn't exist
      payment = new Payment({
        user: userId,
        bankAccount: {
          accountName,
          bankName,
          accountNumber
        },
        isVerified: false // Any update sets verification to false
      });
    } else {
      // Update existing record
      payment.bankAccount = {
        accountName,
        bankName,
        accountNumber
      };
      payment.isVerified = false; // Reset verification status on update
    }

    await payment.save();

    res.status(200).json({
      success: true,
      message: 'Bank account details updated successfully',
      data: {
        bankAccount: payment.bankAccount,
        isVerified: payment.isVerified
      }
    });
  } catch (error) {
    console.error('Error updating bank account details:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update bank account details',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Update user's crypto wallet details
 * @route POST /api/payment/crypto-wallet
 * @access Private
 */
exports.updateCryptoWallet = async (req, res) => {
  try {
    const userId = req.user.id;
    const { cryptoType, walletAddress } = req.body;

    // Basic validation
    if (!cryptoType || !walletAddress) {
      return res.status(400).json({
        success: false,
        message: 'Please provide crypto type and wallet address'
      });
    }

    // Validate wallet address format (basic Ethereum check - adjust for other chains)
    if (cryptoType.toLowerCase().includes('eth') && !/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid Ethereum wallet address format'
      });
    }

    // Find or create payment record
    let payment = await Payment.findOne({ user: userId });

    if (!payment) {
      // Create new payment record if doesn't exist
      payment = new Payment({
        user: userId,
        cryptoWallet: {
          cryptoType,
          walletAddress
        },
        isVerified: false // Any update sets verification to false
      });
    } else {
      // Update existing record
      payment.cryptoWallet = {
        cryptoType,
        walletAddress
      };
      payment.isVerified = false; // Reset verification status on update
    }

    await payment.save();

    res.status(200).json({
      success: true,
      message: 'Crypto wallet details updated successfully',
      data: {
        cryptoWallet: payment.cryptoWallet,
        isVerified: payment.isVerified
      }
    });
  } catch (error) {
    console.error('Error updating crypto wallet details:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update crypto wallet details',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Upload KYC documents (Government ID and Proof of Address)
 * @route POST /api/payment/kyc-documents
 * @access Private
 */
exports.uploadKycDocuments = async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Check if files were uploaded
    if (!req.files) {
      return res.status(400).json({
        success: false,
        message: 'No files were uploaded'
      });
    }
    
    const { governmentId, proofOfAddress } = req.files;
    
    // Find or create payment record
    let payment = await Payment.findOne({ user: userId });
    
    if (!payment) {
      payment = new Payment({
        user: userId,
        kycDocuments: {}
      });
    }
    
    // Initialize kycDocuments if it doesn't exist
    if (!payment.kycDocuments) {
      payment.kycDocuments = {};
    }
    
    // Update Government ID document if provided
    if (governmentId && governmentId[0]) {
      const file = governmentId[0];
      payment.kycDocuments.governmentId = {
        filename: file.filename,
        originalName: file.originalname,
        mimetype: file.mimetype,
        path: file.path,
        size: file.size,
        uploadDate: new Date(),
        status: 'pending'
      };
    }
    
    // Update Proof of Address document if provided
    if (proofOfAddress && proofOfAddress[0]) {
      const file = proofOfAddress[0];
      payment.kycDocuments.proofOfAddress = {
        filename: file.filename,
        originalName: file.originalname,
        mimetype: file.mimetype,
        path: file.path,
        size: file.size,
        uploadDate: new Date(),
        status: 'pending'
      };
    }
    
    // Reset KYC verification status when new documents are uploaded
    payment.kycVerified = false;
    
    await payment.save();
    
    res.status(200).json({
      success: true,
      message: 'KYC documents uploaded successfully',
      data: {
        governmentId: payment.kycDocuments.governmentId 
          ? { status: payment.kycDocuments.governmentId.status }
          : null,
        proofOfAddress: payment.kycDocuments.proofOfAddress 
          ? { status: payment.kycDocuments.proofOfAddress.status }
          : null
      }
    });
  } catch (error) {
    console.error('Error uploading KYC documents:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to upload KYC documents',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Get KYC verification status
 * @route GET /api/payment/kyc-status
 * @access Private
 */
exports.getKycStatus = async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Find payment record
    const payment = await Payment.findOne({ user: userId });
    
    if (!payment || !payment.kycDocuments) {
      return res.status(200).json({
        success: true,
        data: {
          governmentId: { status: 'not_submitted' },
          proofOfAddress: { status: 'not_submitted' },
          kycVerified: false
        }
      });
    }
    
    // Format response
    const response = {
      governmentId: payment.kycDocuments.governmentId 
        ? {
            status: payment.kycDocuments.governmentId.status,
            uploadDate: payment.kycDocuments.governmentId.uploadDate,
            rejectionReason: payment.kycDocuments.governmentId.rejectionReason
          }
        : { status: 'not_submitted' },
      proofOfAddress: payment.kycDocuments.proofOfAddress 
        ? {
            status: payment.kycDocuments.proofOfAddress.status,
            uploadDate: payment.kycDocuments.proofOfAddress.uploadDate,
            rejectionReason: payment.kycDocuments.proofOfAddress.rejectionReason
          }
        : { status: 'not_submitted' },
      kycVerified: payment.kycVerified || false
    };
    
    res.status(200).json({
      success: true,
      data: response
    });
  } catch (error) {
    console.error('Error fetching KYC status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch KYC status',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Get payment details for a specific user (Admin only)
 * @route GET /api/payment/admin/user-payment-details/:userId
 * @access Private/Admin
 */
exports.getUserPaymentDetails = async (req, res) => {
  try {
    const { userId } = req.params;

    // Validate userId
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'User ID is required'
      });
    }

    // Find payment details by user ID
    const paymentDetails = await Payment.findOne({ user: userId });
    
    // Get user information
    const user = await User.findById(userId).select('name email userName phone country state city interest walletAddress');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // If no payment details found, return user info with empty payment data
    if (!paymentDetails) {
      return res.status(200).json({
        success: true,
        data: {
          user: {
            id: user._id,
            name: user.name,
            email: user.email,
            userName: user.userName,
            phone: user.phone,
            country: user.country,
            state: user.state,
            city: user.city,
            interest: user.interest,
            walletAddress: user.walletAddress
          },
          paymentDetails: {
            bankAccount: null,
            cryptoWallet: null,
            kycDocuments: {
              governmentId: { status: 'not_submitted' },
              proofOfAddress: { status: 'not_submitted' }
            },
            kycVerified: false,
            isVerified: false
          }
        }
      });
    }

    // Format KYC document data for response
    const kycDocuments = {
      governmentId: paymentDetails.kycDocuments?.governmentId
        ? {
            status: paymentDetails.kycDocuments.governmentId.status,
            filename: paymentDetails.kycDocuments.governmentId.filename,
            originalName: paymentDetails.kycDocuments.governmentId.originalName,
            uploadDate: paymentDetails.kycDocuments.governmentId.uploadDate,
            rejectionReason: paymentDetails.kycDocuments.governmentId.rejectionReason
          }
        : { status: 'not_submitted' },
      proofOfAddress: paymentDetails.kycDocuments?.proofOfAddress
        ? {
            status: paymentDetails.kycDocuments.proofOfAddress.status,
            filename: paymentDetails.kycDocuments.proofOfAddress.filename,
            originalName: paymentDetails.kycDocuments.proofOfAddress.originalName,
            uploadDate: paymentDetails.kycDocuments.proofOfAddress.uploadDate,
            rejectionReason: paymentDetails.kycDocuments.proofOfAddress.rejectionReason
          }
        : { status: 'not_submitted' }
    };

    res.status(200).json({
      success: true,
      data: {
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          userName: user.userName,
          phone: user.phone,
          country: user.country,
          state: user.state,
          city: user.city,
          interest: user.interest,
          walletAddress: user.walletAddress
        },
        paymentDetails: {
          bankAccount: paymentDetails.bankAccount || null,
          cryptoWallet: paymentDetails.cryptoWallet || null,
          kycDocuments,
          kycVerified: paymentDetails.kycVerified || false,
          isVerified: paymentDetails.isVerified || false,
          lastUpdated: paymentDetails.updatedAt,
          verificationNotes: paymentDetails.verificationNotes,
          verifiedAt: paymentDetails.verifiedAt
        }
      }
    });
  } catch (error) {
    console.error('Error fetching user payment details:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch user payment details',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Verify user's payment details (Admin only)
 * @route PUT /api/payment/admin/verify-payment-details/:userId
 * @access Private/Admin
 */
exports.verifyUserPaymentDetails = async (req, res) => {
  try {
    const { userId } = req.params;
    const { isVerified, verificationNotes } = req.body;

    // Validate userId
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'User ID is required'
      });
    }

    // Find payment details by user ID
    const paymentDetails = await Payment.findOne({ user: userId });
    
    if (!paymentDetails) {
      return res.status(404).json({
        success: false,
        message: 'No payment details found for this user'
      });
    }

    // Update verification status
    paymentDetails.isVerified = !!isVerified;
    
    // Add verification notes if provided
    if (verificationNotes) {
      paymentDetails.verificationNotes = verificationNotes;
    }

    // Add verification metadata
    paymentDetails.verifiedBy = req.user.id;
    paymentDetails.verifiedAt = new Date();

    await paymentDetails.save();

    res.status(200).json({
      success: true,
      message: `Payment details ${isVerified ? 'verified' : 'unverified'} successfully`,
      data: {
        isVerified: paymentDetails.isVerified,
        verificationNotes: paymentDetails.verificationNotes,
        verifiedAt: paymentDetails.verifiedAt
      }
    });
  } catch (error) {
    console.error('Error verifying payment details:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to verify payment details',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Verify KYC Documents (Admin only)
 * @route PUT /api/payment/admin/verify-kyc/:userId
 * @access Private/Admin
 */
exports.verifyKycDocuments = async (req, res) => {
  try {
    const { userId } = req.params;
    const { 
      governmentIdStatus, 
      governmentIdRejectionReason,
      proofOfAddressStatus,
      proofOfAddressRejectionReason,
      kycVerified
    } = req.body;

    // Validate userId
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'User ID is required'
      });
    }

    // Find payment details by user ID
    const paymentDetails = await Payment.findOne({ user: userId });
    
    if (!paymentDetails) {
      return res.status(404).json({
        success: false,
        message: 'No payment details found for this user'
      });
    }

    // Initialize kycDocuments if it doesn't exist
    if (!paymentDetails.kycDocuments) {
      paymentDetails.kycDocuments = {};
    }

    // Update Government ID status if provided
    if (governmentIdStatus && paymentDetails.kycDocuments.governmentId) {
      paymentDetails.kycDocuments.governmentId.status = governmentIdStatus;
      
      if (governmentIdStatus === 'rejected' && governmentIdRejectionReason) {
        paymentDetails.kycDocuments.governmentId.rejectionReason = governmentIdRejectionReason;
      } else if (governmentIdStatus === 'approved') {
        paymentDetails.kycDocuments.governmentId.rejectionReason = undefined;
      }
    }

    // Update Proof of Address status if provided
    if (proofOfAddressStatus && paymentDetails.kycDocuments.proofOfAddress) {
      paymentDetails.kycDocuments.proofOfAddress.status = proofOfAddressStatus;
      
      if (proofOfAddressStatus === 'rejected' && proofOfAddressRejectionReason) {
        paymentDetails.kycDocuments.proofOfAddress.rejectionReason = proofOfAddressRejectionReason;
      } else if (proofOfAddressStatus === 'approved') {
        paymentDetails.kycDocuments.proofOfAddress.rejectionReason = undefined;
      }
    }

    // Update overall KYC verification status
    if (kycVerified !== undefined) {
      paymentDetails.kycVerified = !!kycVerified;
    } else {
      // Auto-verify if both documents are approved
      const governmentIdApproved = paymentDetails.kycDocuments.governmentId?.status === 'approved';
      const proofOfAddressApproved = paymentDetails.kycDocuments.proofOfAddress?.status === 'approved';
      
      if (governmentIdApproved && proofOfAddressApproved) {
        paymentDetails.kycVerified = true;
      } else {
        paymentDetails.kycVerified = false;
      }
    }

    await paymentDetails.save();
    
    // Notify user about KYC status changes if needed
    // This would be a good place to send an email notification

    res.status(200).json({
      success: true,
      message: 'KYC verification status updated successfully',
      data: {
        governmentId: paymentDetails.kycDocuments.governmentId 
          ? {
              status: paymentDetails.kycDocuments.governmentId.status,
              rejectionReason: paymentDetails.kycDocuments.governmentId.rejectionReason
            }
          : null,
        proofOfAddress: paymentDetails.kycDocuments.proofOfAddress 
          ? {
              status: paymentDetails.kycDocuments.proofOfAddress.status,
              rejectionReason: paymentDetails.kycDocuments.proofOfAddress.rejectionReason
            }
          : null,
        kycVerified: paymentDetails.kycVerified
      }
    });
  } catch (error) {
    console.error('Error verifying KYC documents:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to verify KYC documents',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

module.exports = exports;