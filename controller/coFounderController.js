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
        
        // Process referral commissions ONLY for completed transactions
        try {
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

// ALSO FIX: Make sure submitCoFounderManualPayment stores the payment method correctly
const submitCoFounderManualPayment = async (req, res) => {
    try {
        const { quantity, paymentMethod, bankName, accountName, reference, currency } = req.body;
        const userId = req.user.id;
        const paymentProofImage = req.file;
        
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
        
        const price = currency === 'naira' ? 
            coFounderShare.pricing.priceNaira : 
            coFounderShare.pricing.priceUSDT;
        
        const totalPrice = parseInt(quantity) * price;
        const transactionId = generateTransactionId();
        const paymentProofPath = paymentProofImage.path;
        
        // FIXED: Ensure payment method is stored with 'manual_' prefix consistently
        const formattedPaymentMethod = `manual_${paymentMethod}`;
        
        console.log(`[submitCoFounderManualPayment] Storing transaction with paymentMethod: ${formattedPaymentMethod}`);
        
        // Record the transaction as "pending verification"
        const transaction = await PaymentTransaction.create({
            userId,
            type: 'co-founder',
            amount: totalPrice,
            currency: currency.toLowerCase(),
            shares: parseInt(quantity),
            status: 'pending',
            transactionId,
            paymentMethod: formattedPaymentMethod, // FIXED: Consistent naming
            paymentProofPath,
            manualPaymentDetails: {
                bankName: bankName || null,
                accountName: accountName || null,
                reference: reference || null
            }
        });
        
        console.log(`[submitCoFounderManualPayment] Transaction created:`, {
            id: transaction._id,
            transactionId: transaction.transactionId,
            paymentMethod: transaction.paymentMethod,
            paymentProofPath: transaction.paymentProofPath
        });
        
        // Get user details and send admin notification
        const user = await User.findById(userId);
        
        try {
            const adminEmail = process.env.ADMIN_EMAIL || 'admin@afrimobile.com';
            await sendEmail({
                email: adminEmail,
                subject: 'AfriMobile - New Co-Founder Manual Payment Requires Verification',
                html: `
                    <h2>Co-Founder Manual Payment Verification Required</h2>
                    <p>A new manual payment has been submitted:</p>
                    <ul>
                        <li>User: ${user.name} (${user.email})</li>
                        <li>Transaction ID: ${transactionId}</li>
                        <li>Amount: ${currency === 'naira' ? '₦' : '$'}${totalPrice}</li>
                        <li>Shares: ${quantity}</li>
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
                shares: parseInt(quantity),
                amount: totalPrice,
                status: 'pending',
                fileUrl: `/uploads/payment-proofs/${require('path').basename(paymentProofPath)}`
            }
        });
    } catch (error) {
        console.error('Error submitting co-founder manual payment:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to submit manual payment',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// NEW: Get payment proof image
const getCoFounderPaymentProof = async (req, res) => {
    try {
        const { transactionId } = req.params;
        const userId = req.user.id;
        
        console.log(`[getCoFounderPaymentProof] Request for transaction: ${transactionId} from user: ${userId}`);
        
        // Find the transaction
        const transaction = await PaymentTransaction.findOne({
            transactionId: transactionId,
            type: 'co-founder'
        });
        
        if (!transaction) {
            console.log(`[getCoFounderPaymentProof] Transaction not found: ${transactionId}`);
            return res.status(404).json({
                success: false,
                message: 'Transaction not found'
            });
        }
        
        if (!transaction.paymentProofPath) {
            console.log(`[getCoFounderPaymentProof] Payment proof path not found for transaction: ${transactionId}`);
            return res.status(404).json({
                success: false,
                message: 'Payment proof path not found for this transaction'
            });
        }
        
        console.log(`[getCoFounderPaymentProof] Original payment proof path: ${transaction.paymentProofPath}`);
        
        // Check if user is admin or transaction owner
        const user = await User.findById(userId);
        if (!(user && (user.isAdmin || transaction.userId.toString() === userId))) {
            console.log(`[getCoFounderPaymentProof] Unauthorized access: ${userId}`);
            return res.status(403).json({
                success: false,
                message: 'Unauthorized: You do not have permission to view this payment proof'
            });
        }

        // Check various possible file paths
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
        
        console.log('[getCoFounderPaymentProof] Checking possible file paths:', JSON.stringify(possiblePaths));
        
        // Check each path
        let validFilePath = null;
        
        for (const testPath of possiblePaths) {
            try {
                if (fs.existsSync(testPath)) {
                    const stats = fs.statSync(testPath);
                    if (stats.isFile()) {
                        validFilePath = testPath;
                        console.log(`[getCoFounderPaymentProof] Found file at: ${validFilePath}, size: ${stats.size} bytes`);
                        break;
                    }
                }
            } catch (err) {
                console.log(`[getCoFounderPaymentProof] Error checking path ${testPath}: ${err.message}`);
            }
        }
        
        if (!validFilePath) {
            console.error('[getCoFounderPaymentProof] File not found at any checked location');
            
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
        
        console.log(`[getCoFounderPaymentProof] Serving file with content type: ${contentType}`);
        
        // Send the file
        res.setHeader('Content-Type', contentType);
        fs.createReadStream(validFilePath).pipe(res);
        
    } catch (error) {
        console.error(`[getCoFounderPaymentProof] Server error: ${error.message}`, error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch payment proof',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
};

// Fix for getUserCoFounderShares
const getUserCoFounderShares = async (req, res) => {
    try {
        const userId = req.user.id;
        
        // Find user shares
        const transactions = await PaymentTransaction.find({ 
            userId,
            type: 'co-founder',
            status: 'completed'
        }).sort({ createdAt: -1 });
        
        const totalShares = transactions.reduce((sum, t) => sum + (t.shares || 0), 0);
        
        res.status(200).json({
            success: true,
            totalShares,
            transactions: transactions.map(t => {
                // Safe handling of paymentMethod
                let cleanPaymentMethod = 'unknown';
                if (t.paymentMethod && typeof t.paymentMethod === 'string') {
                    cleanPaymentMethod = t.paymentMethod.replace('manual_', '');
                }
                
                return {
                    transactionId: t.transactionId || 'No ID',
                    shares: t.shares || 0,
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

// NEW: Admin get manual payment transactions
const adminGetCoFounderManualTransactions = async (req, res) => {
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
        
        console.log('=== DEBUG: Admin Manual Transactions Query ===');
        console.log('Request params:', { status, page, limit });
        
        // FIRST: Let's check what transactions actually exist
        const allCoFounderTransactions = await PaymentTransaction.find({ 
            type: 'co-founder' 
        }).select('transactionId paymentMethod status createdAt').limit(10);
        
        console.log('All co-founder transactions sample:', JSON.stringify(allCoFounderTransactions, null, 2));
        
        // Check if we have ANY manual transactions with different query approaches
        const manualTransactions1 = await PaymentTransaction.find({
            type: 'co-founder',
            paymentMethod: { $regex: /^manual_/i }
        }).select('transactionId paymentMethod status').limit(5);
        
        console.log('Manual transactions (approach 1):', JSON.stringify(manualTransactions1, null, 2));
        
        const manualTransactions2 = await PaymentTransaction.find({
            type: 'co-founder',
            paymentMethod: { $in: ['manual_bank_transfer', 'manual_cash', 'manual_other'] }
        }).select('transactionId paymentMethod status').limit(5);
        
        console.log('Manual transactions (approach 2):', JSON.stringify(manualTransactions2, null, 2));
        
        // Check for transactions that might have been stored differently
        const allPaymentMethods = await PaymentTransaction.distinct('paymentMethod', { type: 'co-founder' });
        console.log('All payment methods found:', allPaymentMethods);
        
        // IMPROVED QUERY - Much more flexible and comprehensive
        const query = {
            type: 'co-founder',
            $or: [
                { paymentMethod: { $regex: /^manual_/i } },
                { paymentMethod: { $in: ['manual_bank_transfer', 'manual_cash', 'manual_other'] } },
                { paymentMethod: 'manual' },
                { 
                    $and: [
                        { paymentProofPath: { $exists: true, $ne: null } },
                        { paymentMethod: { $ne: 'paystack' } },
                        { paymentMethod: { $ne: 'crypto' } },
                        { paymentMethod: { $ne: 'web3' } }
                    ]
                }
            ]
        };
        
        // Add status filter if provided
        if (status && ['pending', 'completed', 'failed'].includes(status)) {
            query.status = status;
        }
        
        console.log('Final query:', JSON.stringify(query, null, 2));
        
        // Get transactions with the improved query
        const transactions = await PaymentTransaction.find(query)
            .skip((page - 1) * limit)
            .limit(Number(limit))
            .populate('userId', 'name email phone')
            .sort({ createdAt: -1 });
        
        console.log(`Found ${transactions.length} manual transactions`);
        
        // If still no results, let's try the most basic approach
        if (transactions.length === 0) {
            console.log('No results with complex query, trying basic approach...');
            
            const basicQuery = {
                type: 'co-founder',
                paymentProofPath: { $exists: true, $ne: null }
            };
            
            if (status) {
                basicQuery.status = status;
            }
            
            const basicTransactions = await PaymentTransaction.find(basicQuery)
                .skip((page - 1) * limit)
                .limit(Number(limit))
                .populate('userId', 'name email phone')
                .sort({ createdAt: -1 });
            
            console.log(`Basic query found ${basicTransactions.length} transactions`);
            
            if (basicTransactions.length > 0) {
                // Use basic transactions if they exist
                const formattedTransactions = basicTransactions.map(formatTransaction);
                const totalCount = await PaymentTransaction.countDocuments(basicQuery);
                
                return res.status(200).json({
                    success: true,
                    transactions: formattedTransactions,
                    pagination: {
                        currentPage: Number(page),
                        totalPages: Math.ceil(totalCount / limit),
                        totalCount
                    },
                    debug: {
                        queryUsed: 'basic',
                        allPaymentMethods: allPaymentMethods
                    }
                });
            }
        }
        
        // Format response with enhanced error handling
        const formattedTransactions = transactions.map(formatTransaction);
        
        // Count total with same query
        const totalCount = await PaymentTransaction.countDocuments(query);
        
        res.status(200).json({
            success: true,
            transactions: formattedTransactions,
            pagination: {
                currentPage: Number(page),
                totalPages: Math.ceil(totalCount / limit),
                totalCount
            },
            debug: process.env.NODE_ENV === 'development' ? {
                queryUsed: 'complex',
                allPaymentMethods: allPaymentMethods,
                foundTransactions: transactions.length
            } : undefined
        });
        
    } catch (error) {
        console.error('Error fetching co-founder manual transactions:', error);
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
        
        // Get ALL co-founder transactions to see what we have
        const allTransactions = await PaymentTransaction.find({ 
            type: 'co-founder' 
        }).select('transactionId paymentMethod status paymentProofPath createdAt').sort({ createdAt: -1 });
        
        // Get unique payment methods
        const uniquePaymentMethods = [...new Set(allTransactions.map(t => t.paymentMethod))];
        
        // Find transactions with payment proof
        const transactionsWithProof = allTransactions.filter(t => 
            t.paymentProofPath && t.paymentProofPath !== null
        );
        
        // Find transactions that look like manual payments
        const potentialManualTransactions = allTransactions.filter(t => 
            t.paymentMethod && (
                t.paymentMethod.includes('manual') ||
                t.paymentProofPath ||
                (t.paymentMethod !== 'paystack' && t.paymentMethod !== 'crypto' && t.paymentMethod !== 'web3')
            )
        );
        
        res.status(200).json({
            success: true,
            debug: {
                totalCoFounderTransactions: allTransactions.length,
                uniquePaymentMethods: uniquePaymentMethods,
                transactionsWithProof: transactionsWithProof.length,
                potentialManualTransactions: potentialManualTransactions.length,
                sampleTransactions: allTransactions.slice(0, 5),
                transactionsWithProofSample: transactionsWithProof.slice(0, 3),
                potentialManualSample: potentialManualTransactions.slice(0, 3)
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
            paymentMethod: { $regex: '^manual_' }
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
                adminNote: adminNote
            });
            
            // Process referral commissions ONLY for now-completed transactions
            try {
                const referralResult = await processReferralCommission(
                    transaction.userId,  // userId
                    transaction.amount,  // purchaseAmount
                    'cofounder',        // purchaseType
                    transaction._id     // transactionId
                );
                
                console.log('Referral commission process result:', referralResult);
            } catch (referralError) {
                console.error('Error processing referral commissions:', referralError);
                // Continue with the verification process despite referral error
            }
        }
        
        // Notify user
        const user = await User.findById(transaction.userId);
        if (user && user.email) {
            try {
                await sendEmail({
                    email: user.email,
                    subject: `Co-Founder Manual Payment ${approved ? 'Approved' : 'Declined'}`,
                    html: `
                        <h2>Co-Founder Share Purchase ${approved ? 'Confirmation' : 'Update'}</h2>
                        <p>Dear ${user.name},</p>
                        <p>Your purchase of ${transaction.shares} co-founder shares for ${transaction.currency === 'naira' ? '₦' : '$'}${transaction.amount} has been ${approved ? 'verified and completed' : 'declined'}.</p>
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
        
        // Process referral commissions for admin-added shares
        try {
            const user = await User.findById(userId);
            
            if (user && user.referralInfo && user.referralInfo.code) {
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
// Get all co-founder transactions (FIXED VERSION)
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