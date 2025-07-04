const CoFounderShare = require('../models/CoFounderShare');
const UserShare = require('../models/UserShare');
const PaymentTransaction = require('../models/Transaction');
const PaymentConfig = require('../models/PaymentConfig');
const User = require('../models/User');
const crypto = require('crypto');
const axios = require('axios');
const { ethers } = require('ethers');
const { sendEmail } = require('../utils/emailService');
const { processReferralCommission, rollbackReferralCommission } = require('../utils/referralUtils');

// Generate a unique transaction ID
const generateTransactionId = () => {
    return `CFD-${crypto.randomBytes(4).toString('hex').toUpperCase()}-${Date.now().toString().slice(-6)}`;
};

// Get current co-founder share information
const getCoFounderShareInfo = async (req, res) => {
    try {
        // Find existing configuration or create a new one if not exists
        let coFounderShare = await CoFounderShare.findOne();
        
        // If no configuration exists, create a default one
        if (!coFounderShare) {
            coFounderShare = new CoFounderShare();
            await coFounderShare.save();
        }
        
        // Calculate approved shares
        const response = {
            success: true,
            shareToRegularRatio: coFounderShare.shareToRegularRatio || 29,
            pricing: {
                priceNaira: coFounderShare.pricing.priceNaira,
                priceUSDT: coFounderShare.pricing.priceUSDT
            },
            availability: {
                totalCoFounderShares: coFounderShare.totalShares,
                coFounderSharesSold: coFounderShare.sharesSold,
                coFounderSharesRemaining: coFounderShare.totalShares - coFounderShare.sharesSold,
                equivalentRegularSharesRepresented: coFounderShare.sharesSold * (coFounderShare.shareToRegularRatio || 29)
            },
            explanation: `1 Co-Founder Share = ${coFounderShare.shareToRegularRatio || 29} Regular Shares`
        };
        
        res.status(200).json(response);
    } catch (error) {
        console.error('Error fetching co-founder share info:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch co-founder share information',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};


// Calculate purchase details before payment
const calculateCoFounderPurchase = async (req, res) => {
    try {
        const { quantity, currency } = req.body;
        
        if (!quantity || !currency || !['naira', 'usdt'].includes(currency)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid request. Please provide valid quantity and currency (naira or usdt).'
            });
        }
        
        // Use the static method from the model
        const purchaseDetails = await CoFounderShare.calculatePurchase(parseInt(quantity), currency);
        
        if (!purchaseDetails.success) {
            return res.status(400).json(purchaseDetails);
        }
        
        res.status(200).json({
            success: true,
            purchaseDetails
        });
    } catch (error) {
        console.error('Error calculating co-founder purchase:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to calculate purchase details',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};


// Get payment configuration for co-founder shares
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

// Updated initiateCoFounderPaystackPayment function
const initiateCoFounderPaystackPayment = async (req, res) => {
    try {
        const { quantity, email } = req.body;
        const userId = req.user.id;
        
        if (!quantity || !email) {
            return res.status(400).json({
                success: false,
                message: 'Please provide quantity and email'
            });
        }
        
        const parsedQuantity = parseInt(quantity);
        
        // Find co-founder share configuration
        const coFounderShare = await CoFounderShare.findOne();
        
        if (!coFounderShare) {
            return res.status(400).json({
                success: false,
                message: 'Co-founder share configuration not found'
            });
        }
        
        // Validate available shares
        if (coFounderShare.sharesSold + parsedQuantity > coFounderShare.totalShares) {
            return res.status(400).json({
                success: false,
                message: 'Insufficient shares available',
                availableShares: coFounderShare.totalShares - coFounderShare.sharesSold
            });
        }
        
        // Calculate price based on currency (using naira for PayStack)
        const pricePerShare = coFounderShare.pricing.priceNaira;
        const totalPrice = parsedQuantity * pricePerShare;
        
        // Generate transaction ID
        const transactionId = generateTransactionId();
        
        // Create PayStack request
        const paystackRequest = {
            email,
            amount: totalPrice * 100, // Convert to kobo
            reference: transactionId,
            callback_url: `${process.env.FRONTEND_URL}/cofounder/payment/verify?txref=${transactionId}`,
            metadata: {
                userId,
                shares: parsedQuantity,
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
        const transaction = await PaymentTransaction.create({
            userId,
            type: 'co-founder',
            amount: totalPrice,
            currency: 'naira',
            shares: parsedQuantity,
            status: 'pending',
            reference: transactionId,
            paymentMethod: 'paystack'
        });
        
        // Return success with payment URL
        res.status(200).json({
            success: true,
            message: 'Payment initialized successfully',
            data: {
                authorization_url: paystackResponse.data.data.authorization_url,
                reference: transactionId,
                amount: totalPrice
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

// Submit crypto payment transaction for verification
const verifyWeb3Transaction = async (req, res) => {
    try {
        const { transactionHash, amount, currency, shares } = req.body;
        const userId = req.user.id;
        
        if (!transactionHash || !amount || !currency || !shares) {
            return res.status(400).json({
                success: false,
                message: 'Please provide transaction hash, amount, currency, and shares'
            });
        }
        
        // Generate transaction ID
        const transactionId = generateTransactionId();
        
        // Record the pending transaction
        const transaction = await PaymentTransaction.create({
            userId,
            type: 'co-founder',
            amount: parseFloat(amount),
            currency: currency.toLowerCase(),
            shares: parseInt(shares),
            status: 'pending',
            transactionId,
            transactionHash,
            paymentMethod: 'crypto'
        });
        
        // Notify admin
        const admins = await User.find({ isAdmin: true });
        
        if (admins.length > 0) {
            try {
                for (const admin of admins) {
                    if (admin.email) {
                        await sendEmail({
                            email: admin.email,
                            subject: 'New Co-Founder Share Transaction',
                            html: `
                                <h2>New Co-Founder Share Transaction</h2>
                                <p>A new web3 transaction requires verification:</p>
                                <p>Transaction ID: ${transaction._id}</p>
                                <p>User ID: ${userId}</p>
                                <p>Shares: ${shares}</p>
                                <p>Amount: ${currency === 'naira' ? '₦' : '$'}${amount}</p>
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
        
        res.status(200).json({
            success: true,
            message: 'Transaction submitted for verification',
            transaction: {
                id: transaction._id,
                status: transaction.status,
                shares
            }
        });
    } catch (error) {
        console.error('Error submitting web3 transaction:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to submit transaction',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Verify PayStack payment
const verifyCoFounderPaystackPayment = async (req, res) => {
    try {
        const { reference } = req.params;
        
        if (!reference) {
            return res.status(400).json({
                success: false,
                message: 'Transaction reference is required'
            });
        }
        
        // Find transaction
        const transaction = await PaymentTransaction.findOne({ 
            transactionId: reference,
            type: 'co-founder' 
        });
        
        if (!transaction) {
            return res.status(404).json({
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
            transaction.status = 'failed';
            await transaction.save();
            
            return res.status(400).json({
                success: false,
                message: 'Payment verification failed',
                status: verification.data.data.status
            });
        }
        
        // Find co-founder share configuration
        const coFounderShare = await CoFounderShare.findOne();
        const shareToRegularRatio = coFounderShare?.shareToRegularRatio || 29;
        
        // Update shares sold
        coFounderShare.sharesSold += transaction.shares;
        await coFounderShare.save();
        
        // Use the new addCoFounderShares method
        await UserShare.addCoFounderShares(transaction.userId, transaction.shares, {
            transactionId: transaction._id,
            shares: transaction.shares, // For compatibility
            coFounderShares: transaction.shares,
            equivalentRegularShares: transaction.shares * shareToRegularRatio,
            shareToRegularRatio: shareToRegularRatio,
            pricePerShare: transaction.amount / transaction.shares,
            currency: 'naira',
            totalAmount: transaction.amount,
            paymentMethod: 'co-founder',
            status: 'completed',
            tierBreakdown: {
                tier1: 0,
                tier2: 0,
                tier3: 0
            }
        });
        
        // Update transaction status
        transaction.status = 'completed';
        await transaction.save();
        
        // Process referral commissions for completed transactions
        try {
            if (transaction.status === 'completed') {
                const referralResult = await processReferralCommission(
                    transaction.userId,
                    transaction.amount,
                    'cofounder',
                    transaction._id
                );
                
                console.log('Referral commission process result:', referralResult);
            }
        } catch (referralError) {
            console.error('Error processing referral commissions:', referralError);
        }
        
        // Notify user
        const user = await User.findById(transaction.userId);
        if (user && user.email) {
            try {
                await sendEmail({
                    email: user.email,
                    subject: 'Co-Founder Shares Purchase Confirmation',
                    html: `
                        <h2>Co-Founder Shares Purchase Successful</h2>
                        <p>Dear ${user.name},</p>
                        <p>You have successfully purchased ${transaction.shares} co-founder share(s).</p>
                        <p>This is equivalent to ${transaction.shares * shareToRegularRatio} regular shares.</p>
                        <p>Total Amount: ₦${transaction.amount}</p>
                        <p>Transaction ID: ${transaction._id}</p>
                        <p>Thank you for your investment!</p>
                    `
                });
            } catch (emailError) {
                console.error('Failed to send purchase confirmation email:', emailError);
            }
        }
        
        res.status(200).json({
            success: true,
            message: 'Payment verified successfully',
            coFounderShares: transaction.shares,
            equivalentRegularShares: transaction.shares * shareToRegularRatio,
            amount: transaction.amount
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


// EMERGENCY FIX: Replace the submitCoFounderManualPayment function in your coFounderController.js
const submitCoFounderManualPayment = async (req, res) => {
    try {
        const { quantity, paymentMethod, bankName, accountName, reference, currency } = req.body;
        const userId = req.user.id;
        const paymentProofImage = req.file;
        
        console.log('[FIXED submitCoFounderManualPayment] Request:', {
            quantity, paymentMethod, currency, userId,
            hasFile: !!paymentProofImage,
            fileName: paymentProofImage?.filename
        });
        
        // Validate required fields
        if (!quantity || !paymentMethod || !currency || !paymentProofImage) {
            return res.status(400).json({
                success: false,
                message: 'Please provide quantity, payment method, currency, and payment proof image'
            });
        }
        
        // Validate currency
        if (!['naira', 'usdt'].includes(currency)) {
            return res.status(400).json({
                success: false,
                message: 'Please provide a valid currency (naira or usdt)'
            });
        }
        
        // Get co-founder share configuration
        const coFounderShare = await CoFounderShare.findOne();
        if (!coFounderShare) {
            return res.status(400).json({
                success: false,
                message: 'Co-founder share configuration not found'
            });
        }
        
        // Validate available shares
        const requestedShares = parseInt(quantity);
        if (coFounderShare.sharesSold + requestedShares > coFounderShare.totalShares) {
            return res.status(400).json({
                success: false,
                message: 'Insufficient shares available',
                availableShares: coFounderShare.totalShares - coFounderShare.sharesSold
            });
        }
        
        // Calculate price
        const price = currency === 'naira' ? 
            coFounderShare.pricing.priceNaira : 
            coFounderShare.pricing.priceUSDT;
        
        const totalPrice = requestedShares * price;
        const transactionId = generateTransactionId();
        
        // FIXED: Create transaction with all required fields
        const transactionData = {
            userId: userId,
            type: 'co-founder',
            transactionId: transactionId,  // CRITICAL: Include transactionId
            amount: totalPrice,
            currency: currency.toLowerCase(),
            shares: requestedShares,
            status: 'pending',
            paymentMethod: `manual_${paymentMethod}`,  // Consistent naming
            paymentProofPath: paymentProofImage.path,  // Store file path
            manualPaymentDetails: {
                bankName: bankName || null,
                accountName: accountName || null,
                reference: reference || null
            }
        };
        
        console.log('[FIXED] Creating transaction with data:', JSON.stringify(transactionData, null, 2));
        
        // Create the transaction
        const transaction = await PaymentTransaction.create(transactionData);
        
        console.log('[FIXED] Transaction created successfully:', {
            id: transaction._id,
            transactionId: transaction.transactionId,
            paymentMethod: transaction.paymentMethod,
            status: transaction.status
        });
        
        // Send admin notification
        try {
            const user = await User.findById(userId);
            const adminEmail = process.env.ADMIN_EMAIL || 'admin@afrimobile.com';
            
            await sendEmail({
                email: adminEmail,
                subject: 'New Co-Founder Manual Payment - Verification Required',
                html: `
                    <h2>New Co-Founder Manual Payment Submitted</h2>
                    <p><strong>Transaction Details:</strong></p>
                    <ul>
                        <li>User: ${user.name} (${user.email})</li>
                        <li>Transaction ID: ${transactionId}</li>
                        <li>Amount: ${currency === 'naira' ? '₦' : '$'}${totalPrice}</li>
                        <li>Shares: ${requestedShares}</li>
                        <li>Payment Method: ${paymentMethod}</li>
                        ${bankName ? `<li>Bank: ${bankName}</li>` : ''}
                        ${accountName ? `<li>Account: ${accountName}</li>` : ''}
                        ${reference ? `<li>Reference: ${reference}</li>` : ''}
                    </ul>
                    <p>Please verify this payment in the admin dashboard.</p>
                    <p>Payment proof URL: /cofounder/payment-proof/${transactionId}</p>
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
                shares: requestedShares,
                amount: totalPrice,
                status: 'pending',
                paymentMethod: `manual_${paymentMethod}`,
                fileUrl: `/cofounder/payment-proof/${transactionId}`
            }
        });
        
    } catch (error) {
        console.error('Error in submitCoFounderManualPayment:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to submit manual payment',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
};

// NEW: Get payment proof image
const getCoFounderPaymentProof = async (req, res) => {
    try {
        const { transactionId } = req.params;
        const userId = req.user.id;
        
        console.log(`[FIXED getCoFounderPaymentProof] Request for transaction: ${transactionId}`);
        
        // Find transaction using transactionId field (not _id)
        const transaction = await PaymentTransaction.findOne({
            transactionId: transactionId,
            type: 'co-founder'
        });
        
        if (!transaction) {
            console.log(`[FIXED] Transaction not found: ${transactionId}`);
            return res.status(404).json({
                success: false,
                message: 'Transaction not found'
            });
        }
        
        if (!transaction.paymentProofPath) {
            console.log(`[FIXED] No payment proof path for transaction: ${transactionId}`);
            return res.status(404).json({
                success: false,
                message: 'No payment proof file found for this transaction'
            });
        }
        
        // Check authorization (admin or transaction owner)
        const user = await User.findById(userId);
        if (!(user && (user.isAdmin || transaction.userId.toString() === userId))) {
            return res.status(403).json({
                success: false,
                message: 'Unauthorized access to payment proof'
            });
        }
        
        // FIXED: Enhanced file path resolution
        const fs = require('fs');
        const path = require('path');
        
        const possiblePaths = [
            transaction.paymentProofPath,
            path.join(process.cwd(), transaction.paymentProofPath),
            path.join('/opt/render/project/src/', transaction.paymentProofPath)
        ];
        
        // Add uploads-specific paths
        if (transaction.paymentProofPath.includes('uploads')) {
            const uploadsPart = transaction.paymentProofPath.substring(
                transaction.paymentProofPath.indexOf('uploads')
            );
            possiblePaths.push(path.join(process.cwd(), uploadsPart));
            possiblePaths.push(path.join('/opt/render/project/src/', uploadsPart));
        }
        
        console.log('[FIXED] Checking file paths:', possiblePaths);
        
        // Find the valid file path
        let validFilePath = null;
        for (const testPath of possiblePaths) {
            try {
                if (fs.existsSync(testPath) && fs.statSync(testPath).isFile()) {
                    validFilePath = testPath;
                    console.log(`[FIXED] Found file at: ${validFilePath}`);
                    break;
                }
            } catch (err) {
                // Continue checking other paths
            }
        }
        
        if (!validFilePath) {
            console.error('[FIXED] Payment proof file not found at any location');
            return res.status(404).json({
                success: false,
                message: 'Payment proof file not found on server',
                debug: process.env.NODE_ENV === 'development' ? {
                    originalPath: transaction.paymentProofPath,
                    checkedPaths: possiblePaths
                } : undefined
            });
        }
        
        // Determine content type
        const ext = path.extname(validFilePath).toLowerCase();
        const contentTypes = {
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.png': 'image/png',
            '.gif': 'image/gif',
            '.pdf': 'application/pdf'
        };
        
        const contentType = contentTypes[ext] || 'application/octet-stream';
        
        console.log(`[FIXED] Serving file with content type: ${contentType}`);
        
        // Stream the file
        res.setHeader('Content-Type', contentType);
        res.setHeader('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour
        fs.createReadStream(validFilePath).pipe(res);
        
    } catch (error) {
        console.error('Error in getCoFounderPaymentProof:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to retrieve payment proof',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
};


// Fix for getUserCoFounderShares
const getUserCoFounderShares = async (req, res) => {
    try {
        const userId = req.user.id;
        
        // Find user shares
        const userShares = await UserShare.findOne({ user: userId });
        const transactions = await PaymentTransaction.find({ 
            userId,
            type: 'co-founder',
            status: 'completed'
        }).sort({ createdAt: -1 });
        
        // Get current ratio
        const coFounderConfig = await CoFounderShare.findOne();
        const shareToRegularRatio = coFounderConfig?.shareToRegularRatio || 29;
        
        const totalCoFounderShares = transactions.reduce((sum, t) => sum + (t.shares || 0), 0);
        const totalEquivalentRegularShares = totalCoFounderShares * shareToRegularRatio;
        
        // Get share breakdown if user has shares
        const shareBreakdown = userShares ? userShares.getShareBreakdown() : {
            totalShares: 0,
            regularShares: 0,
            coFounderShares: 0,
            equivalentRegularShares: 0,
            shareBreakdown: { direct: 0, fromCoFounder: 0 }
        };
        
        res.status(200).json({
            success: true,
            coFounderShares: totalCoFounderShares,
            equivalentRegularShares: totalEquivalentRegularShares,
            shareToRegularRatio: shareToRegularRatio,
            shareBreakdown: shareBreakdown,
            transactions: transactions.map(t => {
                let cleanPaymentMethod = 'unknown';
                if (t.paymentMethod && typeof t.paymentMethod === 'string') {
                    cleanPaymentMethod = t.paymentMethod.replace('manual_', '');
                }
                
                return {
                    transactionId: t.transactionId || 'No ID',
                    coFounderShares: t.shares || 0,
                    equivalentRegularShares: (t.shares || 0) * shareToRegularRatio,
                    amount: t.amount || 0,
                    currency: t.currency || 'unknown',
                    paymentMethod: cleanPaymentMethod,
                    status: t.status || 'unknown',
                    date: t.createdAt
                };
            })
        });
    } catch (error) {
        console.error('Error fetching user co-founder shares:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch co-founder shares',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
};


// Admin verify web3 transaction
const adminVerifyWeb3Transaction = async (req, res) => {
    try {
        const { transactionId, status, adminNotes } = req.body;
        const adminId = req.user.id;
        
        // Verify admin
        const admin = await User.findById(adminId);
        if (!admin || !admin.isAdmin) {
            return res.status(403).json({
                success: false,
                message: 'Unauthorized: Admin access required'
            });
        }
        
        // Find transaction
        const transaction = await PaymentTransaction.findById(transactionId);
        
        if (!transaction) {
            return res.status(404).json({
                success: false,
                message: 'Transaction not found'
            });
        }
        
        // Get current status before updating
        const oldStatus = transaction.status;
        
        // Update transaction status
        transaction.status = status;
        transaction.adminNotes = adminNotes;
        transaction.verifiedBy = adminId;
        await transaction.save();
        
        // If approved (moved to completed), add shares and ONLY THEN process referrals
        if (status === 'completed' && oldStatus !== 'completed') {
            // Find co-founder share configuration
            const coFounderShare = await CoFounderShare.findOne();
            
            // Update shares sold
            coFounderShare.sharesSold += transaction.shares;
            await coFounderShare.save();
            
            // Add shares to user
            await UserShare.addShares(transaction.userId, transaction.shares, {
                transactionId: transaction._id,
                shares: transaction.shares,
                pricePerShare: transaction.amount / transaction.shares,
                currency: transaction.currency,
                totalAmount: transaction.amount,
                paymentMethod: 'co-founder',
                status: 'completed',
                tierBreakdown: {
                    tier1: 0,
                    tier2: 0,
                    tier3: 0
                },
                adminAction: true,
                adminNote: adminNotes
            });
            
            // Process referral commissions - ONLY for now-completed transactions
            try {
                const updatedTransaction = await PaymentTransaction.findById(transactionId);
                if (updatedTransaction.status === 'completed') {
                    const referralResult = await processReferralCommission(
                        transaction.userId,  // userId
                        transaction.amount,  // purchaseAmount
                        'cofounder',        // Make sure this says 'cofounder'
                        transaction._id     // transactionId (MongoDB ID)
                    );
                    
                    console.log('Referral commission process result:', referralResult);
                }
            } catch (referralError) {
                console.error('Error processing referral commissions:', referralError);
            }
            
            // Notify user
            const user = await User.findById(transaction.userId);
            if (user && user.email) {
                try {
                    await sendEmail({
                        email: user.email,
                        subject: 'Co-Founder Shares Transaction Verified',
                        html: `
                            <h2>Co-Founder Shares Transaction Verified</h2>
                            <p>Dear ${user.name},</p>
                            <p>Your co-founder shares transaction has been verified.</p>
                            <p>Shares: ${transaction.shares}</p>
                            <p>Amount: ${transaction.currency === 'naira' ? '₦' : '$'}${transaction.amount}</p>
                            <p>Status: ${status}</p>
                            ${adminNotes ? `<p>Admin Notes: ${adminNotes}</p>` : ''}
                        `
                    });
                } catch (emailError) {
                    console.error('Failed to send verification email:', emailError);
                }
            }
        }
        
        res.status(200).json({
            success: true,
            message: 'Transaction verified successfully',
            transaction: {
                id: transaction._id,
                status: transaction.status,
                shares: transaction.shares,
                amount: transaction.amount
            }
        });
    } catch (error) {
        console.error('Error verifying web3 transaction:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to verify transaction',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Get web3 transactions
const adminGetWeb3Transactions = async (req, res) => {
    try {
        const { status, page = 1, limit = 20 } = req.query;
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
        const query = { 
            type: 'co-founder',
            paymentMethod: 'crypto'
        };
        
        if (status) {
            query.status = status;
        }
        
        // Paginate transactions
        const transactions = await PaymentTransaction.find(query)
            .skip((page - 1) * limit).limit(Number(limit))
            .populate('userId', 'name email');
        
        // Count total
        const totalCount = await PaymentTransaction.countDocuments(query);
        
        res.status(200).json({
            success: true,
            transactions,
            pagination: {
                currentPage: Number(page),
                totalPages: Math.ceil(totalCount / limit),
                totalCount
            }
        });
    } catch (error) {
        console.error('Error fetching web3 transactions:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch transactions',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// FIXED: adminGetCoFounderManualTransactions function in coFounderController.js
const adminGetCoFounderManualTransactions = async (req, res) => {
    try {
        const { status, page = 1, limit = 20, fromDate, toDate } = req.query;
        const adminId = req.user.id;
        
        // Verify admin
        const admin = await User.findById(adminId);
        if (!admin || !admin.isAdmin) {
            return res.status(403).json({
                success: false,
                message: 'Unauthorized: Admin access required'
            });
        }
        
        console.log('[FIXED adminGetCoFounderManualTransactions] Query params:', { status, page, limit, fromDate, toDate });
        
        // FIXED: Better query for co-founder manual transactions
        const query = {
            type: 'co-founder',
            paymentMethod: { $regex: /^manual_/i }  // Find all manual_* payment methods
        };
        
        // Add status filter
        if (status && ['pending', 'completed', 'failed'].includes(status)) {
            query.status = status;
        }
        
        // Add date filters
        if (fromDate || toDate) {
            query.createdAt = {};
            if (fromDate) query.createdAt.$gte = new Date(fromDate);
            if (toDate) query.createdAt.$lte = new Date(toDate);
        }
        
        console.log('[FIXED] Using query:', JSON.stringify(query, null, 2));
        
        // Get transactions with user details
        const transactions = await PaymentTransaction.find(query)
            .skip((page - 1) * limit)
            .limit(Number(limit))
            .populate('userId', 'name email phone')
            .sort({ createdAt: -1 });
        
        console.log(`[FIXED] Found ${transactions.length} transactions`);
        
        // FIXED: Format transactions safely
        const formattedTransactions = transactions.map(transaction => {
            const paymentProofUrl = transaction.transactionId ? 
                `/cofounder/payment-proof/${transaction.transactionId}` : null;
            
            // Clean payment method display
            const cleanPaymentMethod = transaction.paymentMethod ? 
                transaction.paymentMethod.replace('manual_', '') : 'unknown';
            
            // Safe user data handling
            const userData = transaction.userId ? {
                id: transaction.userId._id,
                name: transaction.userId.name || 'Unknown',
                email: transaction.userId.email || 'No email',
                phone: transaction.userId.phone || 'No phone'
            } : {
                id: 'unknown',
                name: 'Unknown User',
                email: 'No email',
                phone: 'No phone'
            };
            
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
                paymentProofUrl: paymentProofUrl,
                paymentProofPath: transaction.paymentProofPath || null,
                manualPaymentDetails: transaction.manualPaymentDetails || {},
                adminNotes: transaction.adminNotes || '',
                verifiedBy: transaction.verifiedBy || null
            };
        });
        
        // Count total matching transactions
        const totalCount = await PaymentTransaction.countDocuments(query);
        
        console.log(`[FIXED] Total matching transactions: ${totalCount}`);
        
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
        console.error('Error in adminGetCoFounderManualTransactions:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch manual transactions',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
};


// Helper function to format transactions safely
function formatTransaction(transaction) {
    let paymentProofUrl = null;
    if (transaction.paymentProofPath && transaction.transactionId) {
        paymentProofUrl = `/api/cofounder/payment-proof/${transaction.transactionId}`;
    }
    
    // Safe handling of paymentMethod
    let cleanPaymentMethod = 'unknown';
    if (transaction.paymentMethod && typeof transaction.paymentMethod === 'string') {
        cleanPaymentMethod = transaction.paymentMethod.replace('manual_', '');
    }
    
    // Safe handling of user data
    const userData = transaction.userId ? {
        id: transaction.userId._id,
        name: transaction.userId.name || 'Unknown',
        email: transaction.userId.email || 'No email',
        phone: transaction.userId.phone || 'No phone'
    } : {
        id: 'unknown',
        name: 'Unknown User',
        email: 'No email',
        phone: 'No phone'
    };
    
    return {
        transactionId: transaction.transactionId || 'No ID',
        user: userData,
        shares: transaction.shares || 0,
        amount: transaction.amount || 0,
        currency: transaction.currency || 'unknown',
        paymentMethod: cleanPaymentMethod,
        status: transaction.status || 'unknown',
        date: transaction.createdAt,
        paymentProofUrl: paymentProofUrl,
        paymentProofPath: transaction.paymentProofPath || null,
        manualPaymentDetails: transaction.manualPaymentDetails || {},
        adminNotes: transaction.adminNotes || ''
    };
}

// ALTERNATIVE: Create a simpler debug endpoint to check what's in the database
const debugManualTransactions = async (req, res) => {
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
        
        // Get comprehensive debug info
        const allCoFounderTransactions = await PaymentTransaction.find({ 
            type: 'co-founder' 
        }).select('transactionId paymentMethod status paymentProofPath manualPaymentDetails createdAt userId')
         .populate('userId', 'name email')
         .sort({ createdAt: -1 });
        
        // Analyze payment methods
        const paymentMethods = [...new Set(allCoFounderTransactions.map(t => t.paymentMethod))];
        
        // Find manual transactions
        const manualTransactions = allCoFounderTransactions.filter(t => 
            t.paymentMethod && t.paymentMethod.toString().includes('manual')
        );
        
        // Find transactions with proof
        const transactionsWithProof = allCoFounderTransactions.filter(t => 
            t.paymentProofPath && t.paymentProofPath !== null
        );
        
        // Check file existence for transactions with proof
        const fs = require('fs');
        const path = require('path');
        const fileCheckResults = [];
        
        for (const tx of transactionsWithProof.slice(0, 5)) { // Check first 5
            const possiblePaths = [
                tx.paymentProofPath,
                path.join(process.cwd(), tx.paymentProofPath)
            ];
            
            let fileExists = false;
            let existingPath = null;
            
            for (const testPath of possiblePaths) {
                try {
                    if (fs.existsSync(testPath)) {
                        fileExists = true;
                        existingPath = testPath;
                        break;
                    }
                } catch (err) {
                    // Continue
                }
            }
            
            fileCheckResults.push({
                transactionId: tx.transactionId,
                paymentProofPath: tx.paymentProofPath,
                fileExists,
                existingPath
            });
        }
        
        res.status(200).json({
            success: true,
            debug: {
                totalCoFounderTransactions: allCoFounderTransactions.length,
                uniquePaymentMethods: paymentMethods,
                manualTransactionsCount: manualTransactions.length,
                transactionsWithProofCount: transactionsWithProof.length,
                
                // Sample data
                sampleAllTransactions: allCoFounderTransactions.slice(0, 3).map(t => ({
                    transactionId: t.transactionId,
                    paymentMethod: t.paymentMethod,
                    status: t.status,
                    hasProofPath: !!t.paymentProofPath,
                    user: t.userId ? t.userId.name : 'Unknown'
                })),
                
                sampleManualTransactions: manualTransactions.slice(0, 3).map(t => ({
                    transactionId: t.transactionId,
                    paymentMethod: t.paymentMethod,
                    status: t.status,
                    paymentProofPath: t.paymentProofPath,
                    user: t.userId ? t.userId.name : 'Unknown'
                })),
                
                // File existence check results
                fileCheckResults
            }
        });
        
    } catch (error) {
        console.error('Error in debug endpoint:', error);
        res.status(500).json({
            success: false,
            message: 'Debug failed',
            error: error.message
        });
    }
};


// NEW: Admin verify manual payment
const adminVerifyCoFounderManualPayment = async (req, res) => {
    try {
        const { transactionId, approved, adminNote } = req.body;
        const adminId = req.user.id;
        
        // Verify admin
        const admin = await User.findById(adminId);
        if (!admin || !admin.isAdmin) {
            return res.status(403).json({
                success: false,
                message: 'Unauthorized: Admin access required'
            });
        }
        
        // Find transaction
        const transaction = await PaymentTransaction.findOne({
            transactionId: transactionId,
            type: 'co-founder',
            paymentMethod: { $regex: /^manual_/i }
        });
        
        if (!transaction) {
            return res.status(404).json({
                success: false,
                message: 'Manual transaction not found'
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
        transaction.status = newStatus;
        transaction.adminNotes = adminNote;
        transaction.verifiedBy = adminId;
        await transaction.save();
        
        // If approved, update global share counts and process referrals
        if (approved) {
            const coFounderShare = await CoFounderShare.findOne();
            const shareToRegularRatio = coFounderShare?.shareToRegularRatio || 29;
            
            // Update shares sold
            coFounderShare.sharesSold += transaction.shares;
            await coFounderShare.save();
            
            // Use addCoFounderShares method with ratio
            await UserShare.addCoFounderShares(transaction.userId, transaction.shares, {
                transactionId: transaction._id,
                shares: transaction.shares,
                coFounderShares: transaction.shares,
                equivalentRegularShares: transaction.shares * shareToRegularRatio,
                shareToRegularRatio: shareToRegularRatio,
                pricePerShare: transaction.amount / transaction.shares,
                currency: transaction.currency,
                totalAmount: transaction.amount,
                paymentMethod: 'co-founder',
                status: 'completed',
                tierBreakdown: {
                    tier1: 0,
                    tier2: 0,
                    tier3: 0
                },
                adminAction: true,
                adminNote: adminNote
            });
            
            // Process referral commissions ONLY for now-completed transactions
            try {
                const referralResult = await processReferralCommission(
                    transaction.userId,
                    transaction.amount,
                    'cofounder', // Make sure this says 'cofounder'
                    transaction._id  // Use transaction._id (MongoDB ID)
                );
                
                console.log('Referral commission process result:', referralResult);
            } catch (referralError) {
                console.error('Error processing referral commissions:', referralError);
            }
        }
        
        // Notify user
        const user = await User.findById(transaction.userId);
        if (user && user.email) {
            try {
                const coFounderConfig = await CoFounderShare.findOne();
                const shareToRegularRatio = coFounderConfig?.shareToRegularRatio || 29;
                
                await sendEmail({
                    email: user.email,
                    subject: `AfriMobile - Co-Founder Manual Payment ${approved ? 'Approved' : 'Declined'}`,
                    html: `
                        <h2>Co-Founder Share Purchase ${approved ? 'Confirmation' : 'Update'}</h2>
                        <p>Dear ${user.name},</p>
                        <p>Your purchase of ${transaction.shares} co-founder shares for ${transaction.currency === 'naira' ? '₦' : '$'}${transaction.amount} has been ${approved ? 'verified and completed' : 'declined'}.</p>
                        ${approved ? `<p>This is equivalent to ${transaction.shares * shareToRegularRatio} regular shares.</p>` : ''}
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
        console.error('Error verifying co-founder manual payment:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to verify manual payment',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// NEW: Admin cancel manual payment
const adminCancelCoFounderManualPayment = async (req, res) => {
    try {
        const { transactionId, cancelReason } = req.body;
        const adminId = req.user.id;
        
        // Verify admin
        const admin = await User.findById(adminId);
        if (!admin || !admin.isAdmin) {
            return res.status(403).json({
                success: false,
                message: 'Unauthorized: Admin access required'
            });
        }
        
        // Find transaction
        const transaction = await PaymentTransaction.findOne({
            transactionId: transactionId,
            type: 'co-founder',
            paymentMethod: { $regex: '^manual_' }
        });
        
        if (!transaction) {
            return res.status(404).json({
                success: false,
                message: 'Manual transaction not found'
            });
        }
        
        if (transaction.status !== 'completed') {
            return res.status(400).json({
                success: false,
                message: `Cannot cancel a transaction that is not completed. Current status: ${transaction.status}`
            });
        }
        
        // Rollback global share counts
        const coFounderShare = await CoFounderShare.findOne();
        coFounderShare.sharesSold -= transaction.shares;
        await coFounderShare.save();
        
        // Rollback any referral commissions if applicable
        try {
            const rollbackResult = await rollbackReferralCommission(
                transaction.userId,  // userId
                transaction._id,     // transactionId
                transaction.amount,  // purchaseAmount
                transaction.currency, // currency
                'cofounder',        // purchaseType
                'PaymentTransaction' // sourceModel
            );
            
            console.log('Referral commission rollback result:', rollbackResult);
        } catch (referralError) {
            console.error('Error rolling back referral commissions:', referralError);
            // Continue with the cancellation process despite referral error
        }
        
        // Update transaction status back to pending
        transaction.status = 'pending';
        transaction.adminNotes = `CANCELLATION: ${cancelReason || 'Approved payment canceled by admin'}`;
        await transaction.save();
        try {
            const rollbackResult = await rollbackReferralCommission(
                transaction.userId,  // userId
                transaction._id,     // transactionId (use MongoDB _id, not transactionId field)
                transaction.amount,  // purchaseAmount
                transaction.currency, // currency
                'cofounder',        // purchaseType
                'PaymentTransaction' // sourceModel (change this to PaymentTransaction)
            );
            
            console.log('Referral commission rollback result:', rollbackResult);
        } catch (referralError) {
            console.error('Error rolling back referral commissions:', referralError);
        }

        try {
            const rollbackResult = await rollbackReferralCommission(
                transaction.userId,  // userId
                transaction._id,     // transactionId (use MongoDB _id, not transactionId field)
                transaction.amount,  // purchaseAmount
                transaction.currency, // currency
                'cofounder',        // purchaseType
                'PaymentTransaction' // sourceModel (change this to PaymentTransaction)
            );
            
            console.log('Referral commission rollback result:', rollbackResult);
        } catch (referralError) {
            console.error('Error rolling back referral commissions:', referralError);
        }

        // Notify user
        const user = await User.findById(transaction.userId);
        if (user && user.email) {
            try {
                await sendEmail({
                    email: user.email,
                    subject: 'Co-Founder Payment Approval Canceled',
                    html: `
                        <h2>Co-Founder Share Purchase Update</h2>
                        <p>Dear ${user.name},</p>
                        <p>We need to inform you that your previously approved purchase of ${transaction.shares} co-founder shares 
                        for ${transaction.currency === 'naira' ? '₦' : '$'}${transaction.amount} has been temporarily placed back into pending status.</p>
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
        console.error('Error canceling co-founder approved payment:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to cancel payment approval',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// NEW: Admin delete manual payment transaction
const adminDeleteCoFounderManualPayment = async (req, res) => {
    try {
        const { transactionId } = req.params;
        const adminId = req.user.id;
        
        // Verify admin
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
        
        // Find transaction
        const transaction = await PaymentTransaction.findOne({
            transactionId: transactionId,
            type: 'co-founder',
            paymentMethod: { $regex: '^manual_' }
        });
        
        if (!transaction) {
            return res.status(404).json({
                success: false,
                message: 'Manual transaction not found'
            });
        }
        
        // Store transaction details for cleanup and notification
        const transactionDetails = {
            shares: transaction.shares,
            amount: transaction.amount,
            currency: transaction.currency,
            status: transaction.status,
            paymentProofPath: transaction.paymentProofPath,
            userId: transaction.userId
        };
        
        // If transaction was completed, rollback global share counts
        if (transaction.status === 'completed') {
            const coFounderShare = await CoFounderShare.findOne();
            coFounderShare.sharesSold -= transaction.shares;
            await coFounderShare.save();
            
            // Rollback any referral commissions if applicable
            try {
                const rollbackResult = await rollbackReferralCommission(
                    transaction.userId,  // userId
                    transaction._id,     // transactionId
                    transaction.amount,  // purchaseAmount
                    transaction.currency, // currency
                    'cofounder',        // purchaseType
                    'PaymentTransaction' // sourceModel
                );
                
                console.log('Referral commission rollback result:', rollbackResult);
            } catch (referralError) {
                console.error('Error rolling back referral commissions:', referralError);
                // Continue with the deletion process despite referral error
            }
            
            // Remove shares from UserShare if they were added
            try {
                const userShare = await UserShare.findOne({ user: transaction.userId });
                if (userShare) {
                    // Remove the transaction from user's transactions
                    userShare.transactions = userShare.transactions.filter(
                        t => t.transactionId !== transaction._id.toString()
                    );
                    
                    // Recalculate total shares
                    userShare.totalShares = userShare.transactions
                        .filter(t => t.status === 'completed')
                        .reduce((total, t) => total + t.shares, 0);
                    
                    await userShare.save();
                }
            } catch (userShareError) {
                console.error('Error updating user shares:', userShareError);
            }
        }
        
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
        
        // Delete the transaction
        await PaymentTransaction.findByIdAndDelete(transaction._id);
        
        // Get user details for notification
        const user = await User.findById(transactionDetails.userId);
        
        // Notify user about transaction deletion
        if (user && user.email) {
            try {
                await sendEmail({
                    email: user.email,
                    subject: 'Co-Founder Transaction Deleted',
                    html: `
                        <h2>Co-Founder Transaction Deletion Notice</h2>
                        <p>Dear ${user.name},</p>
                        <p>We are writing to inform you that your co-founder manual payment transaction has been deleted from our system.</p>
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
                console.error('Failed to send transaction deletion notification email:', emailError);
            }
        }
        
        // Log the deletion for audit purposes
        console.log(`Co-founder manual payment transaction deleted:`, {
            transactionId,
            adminId,
            userId: transactionDetails.userId,
            previousStatus: transactionDetails.status,
            shares: transactionDetails.shares,
            amount: transactionDetails.amount,
            currency: transactionDetails.currency,
            timestamp: new Date().toISOString()
        });
        
        // Return success response
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
                }
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
// Update co-founder share pricing
const updateCoFounderSharePricing = async (req, res) => {
    try {
        const { priceNaira, priceUSDT } = req.body;
        const adminId = req.user.id;
        
        // Verify admin
        const admin = await User.findById(adminId);
        if (!admin || !admin.isAdmin) {
            return res.status(403).json({
                success: false,
                message: 'Unauthorized: Admin access required'
            });
        }
        
        // Find or create co-founder share configuration
        let coFounderShare = await CoFounderShare.findOne();
        if (!coFounderShare) {
            coFounderShare = new CoFounderShare();
        }
        
        // Update pricing
        if (priceNaira) {
            coFounderShare.pricing.priceNaira = priceNaira;
        }
        
        if (priceUSDT) {
            coFounderShare.pricing.priceUSDT = priceUSDT;
        }
        
        await coFounderShare.save();
        
        res.status(200).json({
            success: true,
            message: 'Co-founder share pricing updated successfully',
            pricing: coFounderShare.pricing
        });
    } catch (error) {
        console.error('Error updating co-founder share pricing:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update share pricing',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Admin manually add co-founder shares to a user
const adminAddCoFounderShares = async (req, res) => {
    try {
        const { userId, shares, note } = req.body;
        const adminId = req.user.id;
        
        // Verify admin
        const admin = await User.findById(adminId);
        if (!admin || !admin.isAdmin) {
            return res.status(403).json({
                success: false,
                message: 'Unauthorized: Admin access required'
            });
        }
        
        // Find or create co-founder share configuration
        let coFounderShare = await CoFounderShare.findOne();
        if (!coFounderShare) {
            coFounderShare = new CoFounderShare();
            await coFounderShare.save();
        }
        
        const shareToRegularRatio = coFounderShare.shareToRegularRatio || 29;
        
        // Check available shares
        if (coFounderShare.sharesSold + parseInt(shares) > coFounderShare.totalShares) {
            return res.status(400).json({
                success: false,
                message: 'Insufficient co-founder shares available'
            });
        }
        
        // Create transaction with completed status immediately
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
            shareToRegularRatio: shareToRegularRatio,
            coFounderShares: parseInt(shares),
            equivalentRegularShares: parseInt(shares) * shareToRegularRatio
        });
        
        // Add co-founder shares to user using the new method
        await UserShare.addCoFounderShares(userId, parseInt(shares), {
            transactionId: transaction._id,
            shares: parseInt(shares),
            coFounderShares: parseInt(shares),
            equivalentRegularShares: parseInt(shares) * shareToRegularRatio,
            shareToRegularRatio: shareToRegularRatio,
            pricePerShare: coFounderShare.pricing.priceNaira,
            currency: 'naira',
            totalAmount: coFounderShare.pricing.priceNaira * parseInt(shares),
            paymentMethod: 'co-founder',
            status: 'completed',
            tierBreakdown: {
                tier1: 0,
                tier2: 0,
                tier3: 0
            },
            adminAction: true,
            adminNote: note || 'Admin share allocation'
        });
        
        // Update co-founder shares sold
        coFounderShare.sharesSold += parseInt(shares);
        await coFounderShare.save();
        
        try {
            if (user && user.referralInfo && user.referralInfo.code) {
                const referralResult = await processReferralCommission(
                    userId,
                    coFounderShare.pricing.priceNaira * parseInt(shares), // Use correct amount calculation
                    'cofounder', // Make sure this says 'cofounder'
                    transaction._id  // Use transaction._id
                );
                
                console.log('Referral commission process result for admin-added shares:', referralResult);
            }
        } catch (referralError) {
            console.error('Error processing referral commissions for admin-added shares:', referralError);
        }

        // Notify user
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


// Get all co-founder transactions
const getAllCoFounderTransactions = async (req, res) => {
    try {
        const { status, page = 1, limit = 20, paymentMethod, fromDate, toDate } = req.query;
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
        const query = { type: 'co-founder' };
        
        if (status) {
            query.status = status;
        }
        
        if (paymentMethod) {
            query.paymentMethod = paymentMethod;
        }
        
        // Add date filters if provided
        if (fromDate || toDate) {
            query.createdAt = {};
            if (fromDate) {
                query.createdAt.$gte = new Date(fromDate);
            }
            if (toDate) {
                query.createdAt.$lte = new Date(toDate);
            }
        }
        
        // Paginate transactions
        const transactions = await PaymentTransaction.find(query)
            .skip((page - 1) * limit)
            .limit(Number(limit))
            .populate('userId', 'name email')
            .sort({ createdAt: -1 }); // Sort by newest first
        
        // Format transactions with proper null/undefined handling
        const formattedTransactions = transactions.map(transaction => {
            let paymentProofUrl = null;
            if (transaction.paymentProofPath && transaction.transactionId) {
                paymentProofUrl = `/cofounder/payment-proof/${transaction.transactionId}`;
            }
            
            // Safe handling of paymentMethod
            let cleanPaymentMethod = 'unknown';
            if (transaction.paymentMethod) {
                if (typeof transaction.paymentMethod === 'string') {
                    cleanPaymentMethod = transaction.paymentMethod.replace('manual_', '');
                } else {
                    cleanPaymentMethod = String(transaction.paymentMethod).replace('manual_', '');
                }
            }
            
            // Safe handling of user data
            const userData = transaction.userId ? {
                id: transaction.userId._id,
                name: transaction.userId.name || 'Unknown',
                email: transaction.userId.email || 'No email'
            } : {
                id: 'unknown',
                name: 'Unknown User',
                email: 'No email'
            };
            
            return {
                id: transaction._id, // Include MongoDB ID
                transactionId: transaction.transactionId || 'No ID',
                user: userData,
                shares: transaction.shares || 0,
                amount: transaction.amount || 0,
                currency: transaction.currency || 'unknown',
                paymentMethod: cleanPaymentMethod,
                status: transaction.status || 'unknown',
                date: transaction.createdAt,
                paymentProofUrl: paymentProofUrl,
                manualPaymentDetails: transaction.manualPaymentDetails || {},
                adminNotes: transaction.adminNotes || '',
                transactionHash: transaction.transactionHash || null,
                verifiedBy: transaction.verifiedBy || null
            };
        });
        
        // Count total
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

// Get co-founder share statistics
const getCoFounderShareStatistics = async (req, res) => {
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
        
        // Get current co-founder share configuration
        const coFounderShare = await CoFounderShare.findOne();
        const shareToRegularRatio = coFounderShare?.shareToRegularRatio || 29;
        
        // Get investor count (only count completed transactions)
        const investorCount = await PaymentTransaction.countDocuments({
            type: 'co-founder',
            status: 'completed'
        });
        
        // Calculate total value
        const transactions = await PaymentTransaction.aggregate([
            { 
                $match: { 
                    type: 'co-founder', 
                    status: 'completed' 
                } 
            },
            {
                $group: {
                    _id: '$currency',
                    totalAmount: { $sum: '$amount' },
                    totalCoFounderShares: { $sum: '$shares' }
                }
            }
        ]);
        
        // Calculate equivalent regular shares
        const totalEquivalentRegularShares = coFounderShare.sharesSold * shareToRegularRatio;
        
        res.status(200).json({
            success: true,
            statistics: {
                totalCoFounderShares: coFounderShare.totalShares,
                coFounderSharesSold: coFounderShare.sharesSold,
                coFounderSharesRemaining: coFounderShare.totalShares - coFounderShare.sharesSold,
                shareToRegularRatio: shareToRegularRatio,
                totalEquivalentRegularShares: totalEquivalentRegularShares,
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

// Update company wallet (for crypto payments)
const updateCompanyWallet = async (req, res) => {
    try {
        const { walletAddress } = req.body;
        const adminId = req.user.id;
        
        // Verify admin
        const admin = await User.findById(adminId);
        if (!admin || !admin.isAdmin) {
            return res.status(403).json({
                success: false,
                message: 'Unauthorized: Admin access required'
            });
        }
        
        // Validate wallet address
        if (!ethers.utils.isAddress(walletAddress)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid wallet address'
            });
        }
        
        // Update payment configuration
        const paymentConfig = await PaymentConfig.getCurrentConfig();
        paymentConfig.companyWalletAddress = walletAddress;
        await paymentConfig.save();
        
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

// Manual Payment - User Methods (Updated from placeholders)
const initiateCoFounderManualPayment = async (req, res) => {
    try {
        const { quantity, currency, paymentMethod } = req.body;
        const userId = req.user.id;
        
        if (!quantity || !currency || !paymentMethod) {
            return res.status(400).json({
                success: false,
                message: 'Please provide quantity, currency, and payment method'
            });
        }
        
        // Validate currency
        if (!['naira', 'usdt'].includes(currency)) {
            return res.status(400).json({
                success: false,
                message: 'Please provide a valid currency (naira or usdt)'
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
        const price = currency === 'naira' ? 
            coFounderShare.pricing.priceNaira : 
            coFounderShare.pricing.priceUSDT;
        
        const totalPrice = parseInt(quantity) * price;
        
        // Generate transaction ID for manual payment initiation
        const transactionId = generateTransactionId();
        
        res.status(200).json({
            success: true,
            message: 'Manual payment initiated. Please upload payment proof.',
            data: {
                transactionId,
                quantity: parseInt(quantity),
                pricePerShare: price,
                totalPrice,
                currency,
                paymentMethod,
                instructions: 'Please make payment and upload proof using the upload endpoint'
            }
        });
    } catch (error) {
        console.error('Error initiating co-founder manual payment:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to initiate manual payment',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};
const updateShareToRegularRatio = async (req, res) => {
    try {
        const { ratio } = req.body;
        const adminId = req.user.id;
        
        // Verify admin
        const admin = await User.findById(adminId);
        if (!admin || !admin.isAdmin) {
            return res.status(403).json({
                success: false,
                message: 'Unauthorized: Admin access required'
            });
        }
        
        if (!ratio || ratio <= 0 || !Number.isInteger(Number(ratio))) {
            return res.status(400).json({
                success: false,
                message: 'Please provide a valid ratio (must be a positive integer)'
            });
        }
        
        // Find or create co-founder share configuration
        let coFounderShare = await CoFounderShare.findOne();
        if (!coFounderShare) {
            coFounderShare = new CoFounderShare();
        }
        
        const oldRatio = coFounderShare.shareToRegularRatio || 29;
        const newRatio = parseInt(ratio);
        
        coFounderShare.shareToRegularRatio = newRatio;
        await coFounderShare.save();
        
        // Log the change for audit purposes
        console.log(`Admin ${adminId} updated share-to-regular ratio from ${oldRatio} to ${newRatio}`);
        
        res.status(200).json({
            success: true,
            message: 'Share to regular ratio updated successfully',
            oldRatio: oldRatio,
            newRatio: newRatio,
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



const uploadCoFounderPaymentProof = async (req, res) => {
    // This function is now handled by submitCoFounderManualPayment
    // But we keep this for backward compatibility
    res.status(200).json({
        success: true,
        message: 'Please use the manual payment submission endpoint with payment proof'
    });
};

const getCoFounderManualPaymentStatus = async (req, res) => {
    try {
        const { transactionId } = req.params;
        const userId = req.user.id;
        
        // Find transaction
        const transaction = await PaymentTransaction.findOne({
            transactionId: transactionId,
            type: 'co-founder',
            userId: userId
        });
        
        if (!transaction) {
            return res.status(404).json({
                success: false,
                message: 'Transaction not found'
            });
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

// Manual Payment - Admin Methods (Updated from placeholders)
const getCoFounderPendingManualPayments = async (req, res) => {
    try {
        const { page = 1, limit = 20 } = req.query;
        const adminId = req.user.id;
        
        // Verify admin
        const admin = await User.findById(adminId);
        if (!admin || !admin.isAdmin) {
            return res.status(403).json({
                success: false,
                message: 'Unauthorized: Admin access required'
            });
        }
        
        // Build query for pending manual payments
        const query = {
            type: 'co-founder',
            paymentMethod: { $regex: '^manual_' },
            status: 'pending'
        };
        
        // Get transactions
        const transactions = await PaymentTransaction.find(query)
            .skip((page - 1) * limit)
            .limit(Number(limit))
            .populate('userId', 'name email phone')
            .sort({ createdAt: -1 });
        
        // Format response
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
                paymentProofUrl: paymentProofUrl,
                manualPaymentDetails: transaction.manualPaymentDetails || {}
            };
        });
        
        // Count total
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
        
        return await adminVerifyCoFounderManualPayment({
            ...req,
            body: {
                transactionId,
                approved: true,
                adminNote
            }
        }, res);
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
        
        return await adminVerifyCoFounderManualPayment({
            ...req,
            body: {
                transactionId,
                approved: false,
                adminNote
            }
        }, res);
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
        const { status, page = 1, limit = 20 } = req.query;
        
        // Use the existing adminGetCoFounderManualTransactions function
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

// Export all functions
module.exports = {
    // Existing exports
    getCoFounderShareInfo,
    calculateCoFounderPurchase,
    getPaymentConfig,
    initiateCoFounderPaystackPayment,
    verifyCoFounderPaystackPayment,
    verifyWeb3Transaction,
    getUserCoFounderShares,
    adminVerifyWeb3Transaction,
    adminGetWeb3Transactions,
    updateCoFounderSharePricing,
    adminAddCoFounderShares,
    updateCompanyWallet,
    getAllCoFounderTransactions,
    getCoFounderShareStatistics,
    debugManualTransactions,
    // NEW: Manual payment functions
    submitCoFounderManualPayment,
    getCoFounderPaymentProof,
    adminGetCoFounderManualTransactions,
    adminVerifyCoFounderManualPayment,
    adminCancelCoFounderManualPayment,
    adminDeleteCoFounderManualPayment,
    
    // Updated manual payment functions (previously placeholders)
    initiateCoFounderManualPayment,
    uploadCoFounderPaymentProof,
    getCoFounderManualPaymentStatus,
    getCoFounderPendingManualPayments,
    approveCoFounderManualPayment,
    rejectCoFounderManualPayment,
    getAllCoFounderManualPayments
};