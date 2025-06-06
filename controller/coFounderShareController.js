const CoFounderShare = require('../models/CoFounderShare');
const UserShare = require('../models/UserShare');
const PaymentTransaction = require('../models/Transaction');
const PaymentConfig = require('../models/PaymentConfig');
const User = require('../models/User');
const crypto = require('crypto');
const axios = require('axios');
const { ethers } = require('ethers');
const { sendEmail } = require('../utils/emailService');
const { processReferralCommission } = require('../utils/referralUtils');

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
            pricing: {
                priceNaira: coFounderShare.pricing.priceNaira,
                priceUSDT: coFounderShare.pricing.priceUSDT
            },
            availability: {
                totalShares: coFounderShare.totalShares,
                sharesSold: coFounderShare.sharesSold,
                sharesRemaining: coFounderShare.totalShares - coFounderShare.sharesSold
            }
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
        
        // Find co-founder share configuration
        const coFounderShare = await CoFounderShare.findOne();
        
        if (!coFounderShare) {
            return res.status(400).json({
                success: false,
                message: 'Co-founder share configuration not found'
            });
        }
        
        // Validate available shares
        if (coFounderShare.sharesSold + quantity > coFounderShare.totalShares) {
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
        
        const totalPrice = quantity * price;
        
        res.status(200).json({
            success: true,
            purchaseDetails: {
                quantity,
                pricePerShare: price,
                totalPrice,
                currency,
                availableSharesAfterPurchase: coFounderShare.totalShares - (coFounderShare.sharesSold + quantity)
            }
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
const getPaymentConfig = async (req, res) => {
    try {
        // Find current payment configuration
        const paymentConfig = await PaymentConfig.getCurrentConfig();
        
        // Return payment configuration for co-founder shares
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

// Updated initiateCoFounderPaystackPayment function to fix the CoFounderShare.calculatePurchase issue
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
        
        // Instead of using CoFounderShare.calculatePurchase, use the calculateCoFounderPurchase logic directly
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
        
        // Calculate purchase details
        const purchaseDetails = {
            quantity: parsedQuantity,
            pricePerShare,
            totalPrice,
            currency: 'naira',
            availableSharesAfterPurchase: coFounderShare.totalShares - (coFounderShare.sharesSold + parsedQuantity)
        };
        
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
            amount: purchaseDetails.totalPrice,
            currency: 'naira',
            shares: purchaseDetails.quantity,
            status: 'pending',
            reference: transactionId
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
        
        // Update shares sold
        coFounderShare.sharesSold += transaction.shares;
        await coFounderShare.save();
        
        // Add shares to user
        await UserShare.addShares(transaction.userId, transaction.shares, {
            transactionId: transaction._id,
            shares: transaction.shares,
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
        
        // Process referral commissions ONLY for completed transactions - FIXED PARAMETERS
        try {
            // Ensure the transaction is marked as completed first
            if (transaction.status === 'completed') {
                const referralResult = await processReferralCommission(
                    transaction.userId,   // userId
                    transaction.amount,   // purchaseAmount
                    'cofounder',         // purchaseType
                    transaction._id      // transactionId
                );
                
                console.log('Referral commission process result:', referralResult);
            }
        } catch (referralError) {
            console.error('Error processing referral commissions:', referralError);
            // Continue with the verification process despite referral error
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
            shares: transaction.shares,
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

// Get user's co-founder shares
const getUserCoFounderShares = async (req, res) => {
    try {
        const userId = req.user.id;
        
        // Find user shares
        const transactions = await PaymentTransaction.find({ 
            userId,
            type: 'co-founder',
            status: 'completed'
        });
        
        const totalShares = transactions.reduce((sum, t) => sum + t.shares, 0);
        
        res.status(200).json({
            success: true,
            totalShares,
            transactions
        });
    } catch (error) {
        console.error('Error fetching user co-founder shares:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch co-founder shares',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
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
            
            // Process referral commissions - ONLY for now-completed transactions - FIXED PARAMETERS
            try {
                // Verify again that the transaction is marked as completed
                const updatedTransaction = await PaymentTransaction.findById(transactionId);
                if (updatedTransaction.status === 'completed') {
                    const referralResult = await processReferralCommission(
                        transaction.userId,  // userId
                        transaction.amount,  // purchaseAmount
                        'cofounder',        // purchaseType
                        transaction._id     // transactionId
                    );
                    
                    console.log('Referral commission process result:', referralResult);
                }
            } catch (referralError) {
                console.error('Error processing referral commissions:', referralError);
                // Continue with the verification process despite referral error
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
        }
        
        // Check available shares
        if (coFounderShare.sharesSold + parseInt(shares) > coFounderShare.totalShares) {
            return res.status(400).json({
                success: false,
                message: 'Insufficient co-founder shares available'
            });
        }
        
        // Create transaction with completed status immediately
        const transaction = await PaymentTransaction.create({
            userId,
            type: 'co-founder',
            shares: parseInt(shares),
            status: 'completed',
            adminNotes: note || 'Admin share allocation',
            paymentMethod: 'manual',
            amount: coFounderShare.pricing.priceNaira * parseInt(shares), // Use current price for reference
            currency: 'naira'
        });
        
        // Add shares to user
        await UserShare.addShares(userId, parseInt(shares), {
            transactionId: transaction._id,
            shares: parseInt(shares),
            pricePerShare: coFounderShare.pricing.priceNaira, // Use current price for reference
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
        
        // Process referral commissions for admin-added shares - ONLY for completed transactions - FIXED PARAMETERS
        try {
            // Get the user to check if they were referred
            const user = await User.findById(userId);
            
            if (user && user.referralInfo && user.referralInfo.code) {
                // Verify the transaction is completed
                const referralResult = await processReferralCommission(
                    userId,                                               // userId
                    coFounderShare.pricing.priceNaira * parseInt(shares), // purchaseAmount
                    'cofounder',                                         // purchaseType
                    transaction._id                                      // transactionId
                );
                
                console.log('Referral commission process result for admin-added shares:', referralResult);
            }
        } catch (referralError) {
            console.error('Error processing referral commissions for admin-added shares:', referralError);
            // Continue with the process despite referral error
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
        const query = { type: 'co-founder' };
        
        if (status) {
            query.status = status;
        }
        
        // Paginate transactions
        const transactions = await PaymentTransaction.find(query)
            .skip((page - 1) * limit)
            .limit(Number(limit))
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
        console.error('Error fetching co-founder transactions:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch transactions',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
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
                    totalShares: { $sum: '$shares' }
                }
            }
        ]);
        
        res.status(200).json({
            success: true,
            statistics: {
                totalShares: coFounderShare.totalShares,
                sharesSold: coFounderShare.sharesSold,
                sharesRemaining: coFounderShare.totalShares - coFounderShare.sharesSold,
                investorCount,
                transactions
            },
            pricing: coFounderShare.pricing
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

const initiateCoFounderManualPayment = async (req, res) => {
  res.status(501).json({
    success: false,
    message: 'Manual payment initiation not yet implemented'
  });
};

const uploadCoFounderPaymentProof = async (req, res) => {
  res.status(501).json({
    success: false,
    message: 'Payment proof upload not yet implemented'
  });
};

const getCoFounderManualPaymentStatus = async (req, res) => {
  res.status(501).json({
    success: false,
    message: 'Manual payment status check not yet implemented'
  });
};

// Manual Payment - Admin Methods
const getCoFounderPendingManualPayments = async (req, res) => {
  res.status(501).json({
    success: false,
    message: 'Pending manual payments retrieval not yet implemented'
  });
};

const approveCoFounderManualPayment = async (req, res) => {
  res.status(501).json({
    success: false,
    message: 'Manual payment approval not yet implemented'
  });
};

const rejectCoFounderManualPayment = async (req, res) => {
  res.status(501).json({
    success: false,
    message: 'Manual payment rejection not yet implemented'
  });
};

const getAllCoFounderManualPayments = async (req, res) => {
  res.status(501).json({
    success: false,
    message: 'All manual payments retrieval not yet implemented'
  });
};

// Add to exports at the bottom of the file
module.exports = {
  // ... your existing exports
  initiateCoFounderManualPayment,
  uploadCoFounderPaymentProof,
  getCoFounderManualPaymentStatus,
  getCoFounderPendingManualPayments,
  approveCoFounderManualPayment,
  rejectCoFounderManualPayment,
  getAllCoFounderManualPayments,
  updateCompanyWallet,
  getCoFounderShareStatistics,
  getAllCoFounderTransactions,
  adminAddCoFounderShares,
  updateCoFounderSharePricing,
  adminGetWeb3Transactions,
  adminVerifyWeb3Transaction,
  getUserCoFounderShares,
  verifyWeb3Transaction,
  initiateCoFounderPaystackPayment,
  getPaymentConfig,
  calculateCoFounderPurchase,
  getCoFounderShareInfo,
};