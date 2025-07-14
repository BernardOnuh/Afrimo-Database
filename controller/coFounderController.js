const CoFounderShare = require('../models/CoFounderShare');
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
                const referralResult = await handleCofounderPurchase(
                    transaction.userId,
                    transaction.amount,
                    transaction.shares,
                    transaction._id
                );
                
                console.log('Co-founder referral commission process result:', referralResult);
                if (referralResult.success) {
                    console.log('Commissions distributed:', referralResult.commissions);
                }
            }
        } catch (referralError) {
            console.error('Error processing co-founder referral commissions:', referralError);
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


/**
 * @desc    Submit co-founder manual payment proof - Updated for Cloudinary
 * @route   POST /api/cofounder/manual/submit
 * @access  Private (User)
 */
const submitCoFounderManualPayment = async (req, res) => {
    try {
        console.log('[COFOUNDER] Manual payment submission started');
        console.log('[COFOUNDER] req.body:', req.body);
        console.log('[COFOUNDER] req.file:', req.file);
        console.log('[COFOUNDER] req.files:', req.files);
        
        // ✅ FIX: Check if user is authenticated
        if (!req.user || !req.user.id) {
            console.error('[COFOUNDER] User not authenticated or missing user ID');
            console.log('[COFOUNDER] req.user:', req.user);
            return res.status(401).json({
                success: false,
                message: 'Authentication required. Please log in.',
                error: 'USER_NOT_AUTHENTICATED',
                debug: {
                    hasUser: !!req.user,
                    userKeys: req.user ? Object.keys(req.user) : [],
                    authHeaders: req.headers.authorization ? 'present' : 'missing'
                }
            });
        }

        const { quantity, paymentMethod, bankName, accountName, reference, currency } = req.body;
        const userId = req.user.id;
        
        console.log('[COFOUNDER] Authenticated user ID:', userId);
        
        // Validate required fields
        if (!quantity || !paymentMethod || !currency) {
            console.error('[COFOUNDER] Missing required fields');
            return res.status(400).json({
                success: false,
                message: 'Please provide quantity, payment method, and currency',
                error: 'MISSING_FIELDS'
            });
        }
        
        // ✅ CLOUDINARY: Check for Cloudinary file upload
        if (!req.file && !req.files && !req.body.adminNote) {
            console.error('[COFOUNDER] No payment proof uploaded');
            return res.status(400).json({
                success: false,
                message: 'Please upload payment proof or provide admin notes',
                error: 'MISSING_FILE',
                debug: {
                    hasFile: !!req.file,
                    hasFiles: !!req.files,
                    hasAdminNote: !!req.body.adminNote,
                    fileKeys: req.file ? Object.keys(req.file) : [],
                    bodyKeys: Object.keys(req.body)
                }
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
        const CoFounderShare = require('../models/CoFounderShare');
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
        
        // Generate transaction ID
        const crypto = require('crypto'); // Make sure crypto is imported
        const generateTransactionId = () => {
            return `CFD-${crypto.randomBytes(4).toString('hex').toUpperCase()}-${Date.now().toString().slice(-6)}`;
        };
        const transactionId = generateTransactionId();
        
        // ✅ CLOUDINARY: Extract file info (same pattern as share controller)
        let fileInfo = {};
        if (req.file) {
            // Cloudinary file structure
            fileInfo = {
                cloudinaryUrl: req.file.path,
                cloudinaryId: req.file.filename,
                originalname: req.file.originalname,
                size: req.file.size,
                mimetype: req.file.mimetype,
                format: req.file.format
            };
            console.log('[COFOUNDER] Cloudinary file detected:', {
                url: fileInfo.cloudinaryUrl,
                publicId: fileInfo.cloudinaryId,
                size: fileInfo.size
            });
        } else if (req.files && req.files.paymentProof) {
            // Alternative file structure
            const file = Array.isArray(req.files.paymentProof) ? req.files.paymentProof[0] : req.files.paymentProof;
            fileInfo = {
                cloudinaryUrl: file.path || file.location || file.url,
                cloudinaryId: file.filename || file.key,
                originalname: file.originalname || file.name,
                size: file.size,
                mimetype: file.mimetype || file.type,
                format: file.format
            };
        }
        
        // Create PaymentTransaction record with Cloudinary data
        const PaymentTransaction = require('../models/Transaction');
        const paymentTransactionData = {
            userId,
            transactionId,
            type: 'co-founder',
            shares: parseInt(quantity),
            amount: totalPrice,
            currency,
            paymentMethod: `manual_${paymentMethod}`,
            status: 'pending',
            manualPaymentDetails: {
                bankName: bankName || null,
                accountName: accountName || null,
                reference: reference || null
            },
            
            // 🔥 CRITICAL ADDITION: These fields satisfy your model validation
            paymentProofPath: fileInfo.cloudinaryUrl || null,  // This is what your validation checks for!
            paymentProofOriginalName: fileInfo.originalname || null,
            paymentProofFilename: fileInfo.cloudinaryId || null
        };
        
        // ✅ CLOUDINARY: Add Cloudinary fields as well (for future use)
        if (fileInfo.cloudinaryUrl) {
            paymentTransactionData.paymentProofCloudinaryUrl = fileInfo.cloudinaryUrl;
            paymentTransactionData.paymentProofCloudinaryId = fileInfo.cloudinaryId;
            paymentTransactionData.paymentProofOriginalName = fileInfo.originalname;
            paymentTransactionData.paymentProofFileSize = fileInfo.size;
            paymentTransactionData.paymentProofFormat = fileInfo.format;
        }
        
        const paymentTransaction = new PaymentTransaction(paymentTransactionData);
        await paymentTransaction.save();
        console.log('[COFOUNDER] Payment transaction created with Cloudinary data:', transactionId);
        
        // Send success response
        res.status(200).json({
            success: true,
            message: 'Payment proof submitted successfully and awaiting verification',
            data: {
                transactionId,
                shares: requestedShares,
                amount: totalPrice,
                currency,
                status: 'pending',
                fileInfo: fileInfo,
                paymentMethod: `manual_${paymentMethod}`,
                fileUrl: `/api/cofounder/payment-proof/${transactionId}`,
                cloudinaryUrl: fileInfo.cloudinaryUrl // Include direct Cloudinary URL
            }
        });
        
    } catch (error) {
        console.error('[COFOUNDER] Manual payment submission error:', error);
        
        res.status(500).json({
            success: false,
            message: 'Failed to submit manual payment',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
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
        
        console.log(`[COFOUNDER getPaymentProof] Request for transaction: ${transactionId} from user: ${userId}`);
        
        // Look in PaymentTransaction for Cloudinary data
        let cloudinaryUrl = null;
        let cloudinaryId = null;
        let originalName = null;
        let fileSize = null;
        let format = null;
        let isAdmin = false;

        // Check if user is admin
        const user = await User.findById(userId);
        isAdmin = user && user.isAdmin;

        // Find transaction using transactionId field (not _id)
        const transaction = await PaymentTransaction.findOne({
            transactionId: transactionId,
            type: 'co-founder'
        });
        
        if (!transaction) {
            console.error(`[COFOUNDER] Transaction not found: ${transactionId}`);
            return res.status(404).json({
                success: false,
                message: 'Transaction not found'
            });
        }
        
        // Get Cloudinary data
        cloudinaryUrl = transaction.paymentProofCloudinaryUrl;
        cloudinaryId = transaction.paymentProofCloudinaryId;
        originalName = transaction.paymentProofOriginalName;
        fileSize = transaction.paymentProofFileSize;
        format = transaction.paymentProofFormat;
        
        // Check if user owns this transaction or is admin
        if (!(isAdmin || transaction.userId.toString() === userId)) {
            console.error('[COFOUNDER] Access denied - user does not own transaction');
            return res.status(403).json({
                success: false,
                message: 'Access denied'
            });
        }

        if (!cloudinaryUrl) {
            console.error('[COFOUNDER] Transaction not found or no Cloudinary file:', transactionId);
            return res.status(404).json({
                success: false,
                message: 'Transaction not found or payment proof not available'
            });
        }

        console.log(`[COFOUNDER getPaymentProof] Serving Cloudinary file: ${cloudinaryUrl}`);

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
        console.error(`[COFOUNDER getPaymentProof] Server error: ${error.message}`, error);
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
                    const referralResult = await handleCofounderPurchase(
                        transaction.userId,  // userId
                        transaction.amount,  // purchaseAmount
                        transaction.shares,  // shares
                        transaction._id     // transactionId (MongoDB ID)
                    );
                    
                    console.log('Co-founder referral commission process result:', referralResult);
                    if (referralResult.success) {
                        console.log('Commissions distributed:', referralResult.commissions);
                    }
                }
            } catch (referralError) {
                console.error('Error processing co-founder referral commissions:', referralError);
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



/**
 * @desc    Get co-founder payment proof direct access (Admin only)
 * @route   GET /api/cofounder/admin/payment-proof/:transactionId
 * @access  Private (Admin)
 */
const getCoFounderPaymentProofDirect = async (req, res) => {
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
        
        // Check PaymentTransaction
        const transaction = await PaymentTransaction.findOne({
            transactionId,
            type: 'co-founder'
        });
        
        if (!transaction || !transaction.paymentProofCloudinaryUrl) {
            return res.status(404).json({
                success: false,
                message: 'Payment proof not found'
            });
        }
        
        cloudinaryUrl = transaction.paymentProofCloudinaryUrl;
        
        // Direct redirect to Cloudinary URL
        res.redirect(cloudinaryUrl);
        
    } catch (error) {
        console.error('Error in co-founder direct payment proof access:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to access payment proof'
        });
    }
};

/**
 * @desc    Admin: Get co-founder manual transactions (FINAL FIXED VERSION with paymentProof support)
 * @route   GET /api/cofounder/admin/manual/transactions
 * @access  Private (Admin)
 */
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
        
        // Query for co-founder manual transactions
        const query = {
            type: 'co-founder',
            paymentMethod: { $regex: /^manual_/i }
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
        
        console.log('🔍 Co-founder manual transactions query:', query);
        
        const transactions = await PaymentTransaction.find(query)
            .populate('userId', 'name email phone username')
            .sort({ createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(parseInt(limit));

        console.log(`✅ Found ${transactions.length} co-founder PaymentTransaction records`);

        // 🔥 CRITICAL: Format response with paymentProof object
        const formattedTransactions = transactions.map(transaction => {
            console.log(`🔍 Processing co-founder transaction ${transaction.transactionId}:`, {
                hasCloudinaryUrl: !!transaction.paymentProofCloudinaryUrl,
                hasPaymentProofPath: !!transaction.paymentProofPath,
                originalName: transaction.paymentProofOriginalName
            });

            // Get Cloudinary URL from any available field
            let cloudinaryUrl = transaction.paymentProofCloudinaryUrl || 
                               transaction.paymentProofPath || 
                               null;

            // 🔥 CREATE THE paymentProof OBJECT (THIS IS MISSING IN YOUR CURRENT CODE!)
            let paymentProofData = null;
            
            if (cloudinaryUrl) {
                paymentProofData = {
                    // 🔥 THIS IS THE KEY FIELD YOUR FRONTEND NEEDS!
                    directUrl: cloudinaryUrl,
                    
                    // Additional fields
                    apiUrl: `/api/cofounder/payment-proof/${transaction.transactionId}`,
                    viewUrl: `/api/cofounder/payment-proof/${transaction.transactionId}?redirect=true`,
                    adminDirectUrl: `/api/cofounder/admin/payment-proof/${transaction.transactionId}`,
                    originalName: transaction.paymentProofOriginalName,
                    fileSize: transaction.paymentProofFileSize,
                    format: transaction.paymentProofFormat,
                    publicId: transaction.paymentProofCloudinaryId
                };
                
                console.log(`✅ Created paymentProof for co-founder ${transaction.transactionId}:`, paymentProofData.directUrl);
            } else {
                console.log(`⚠️  No Cloudinary URL for co-founder ${transaction.transactionId}`);
            }

            return {
                id: transaction._id,
                transactionId: transaction.transactionId,
                user: {
                    id: transaction.userId._id,
                    name: transaction.userId.name,
                    username: transaction.userId.username,
                    email: transaction.userId.email,
                    phone: transaction.userId.phone
                },
                shares: transaction.shares,
                pricePerShare: transaction.amount / transaction.shares,
                currency: transaction.currency,
                totalAmount: transaction.amount,
                paymentMethod: transaction.paymentMethod.replace('manual_', ''),
                status: transaction.status,
                date: transaction.createdAt,
                
                // 🔥 THIS IS THE CRITICAL ADDITION YOUR CURRENT CODE IS MISSING!
                paymentProof: paymentProofData,
                
                // Keep legacy fields for compatibility
                paymentProofUrl: paymentProofData ? paymentProofData.apiUrl : null,
                cloudinaryPublicId: transaction.paymentProofCloudinaryId,
                
                manualPaymentDetails: transaction.manualPaymentDetails || {},
                adminNote: transaction.adminNotes,
                verifiedBy: transaction.verifiedBy
            };
        });

        // Count total
        const totalCount = await PaymentTransaction.countDocuments(query);
        
        // 🔥 DEBUG LOG
        console.log('📤 Co-founder final response check:', {
            transactionCount: formattedTransactions.length,
            firstHasPaymentProof: formattedTransactions[0]?.paymentProof ? 'YES' : 'NO',
            firstDirectUrl: formattedTransactions[0]?.paymentProof?.directUrl || 'MISSING'
        });
        
        res.status(200).json({
            success: true,
            transactions: formattedTransactions,
            pagination: {
                currentPage: parseInt(page),
                totalPages: Math.ceil(totalCount / parseInt(limit)),
                totalCount
            },
            cloudinaryInfo: {
                cdnEnabled: true,
                message: "Use paymentProof.directUrl for Cloudinary access"
            }
        });
        
    } catch (error) {
        console.error('❌ Error in adminGetCoFounderManualTransactions:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch co-founder manual transactions',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
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
                const referralResult = await handleCofounderPurchase(
                    transaction.userId,
                    transaction.amount,
                    transaction.shares,
                    transaction._id  // Use transaction._id (MongoDB ID)
                );
                
                console.log('Co-founder referral commission process result:', referralResult);
                if (referralResult.success) {
                    console.log('Commissions distributed:', referralResult.commissions);
                }
            } catch (referralError) {
                console.error('Error processing co-founder referral commissions:', referralError);
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
/**
 * @desc    Admin: Delete co-founder manual payment transaction with Cloudinary cleanup
 * @route   DELETE /api/cofounder/admin/manual/:transactionId
 * @access  Private (Admin)
 */
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
            userId: transaction.userId,
            cloudinaryId: transaction.paymentProofCloudinaryId,
            cloudinaryUrl: transaction.paymentProofCloudinaryUrl
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
                
                console.log('Co-founder referral commission rollback result:', rollbackResult);
            } catch (referralError) {
                console.error('Error rolling back co-founder referral commissions:', referralError);
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
        
        // ✅ UPDATED: Delete Cloudinary file if it exists
        if (transactionDetails.cloudinaryId) {
            try {
                const deleteResult = await deleteFromCloudinary(transactionDetails.cloudinaryId);
                if (deleteResult.result === 'ok') {
                    console.log(`Co-founder payment proof file deleted from Cloudinary: ${transactionDetails.cloudinaryId}`);
                } else {
                    console.log(`Co-founder payment proof file not found in Cloudinary: ${transactionDetails.cloudinaryId}`);
                }
            } catch (fileError) {
                console.error('Error deleting co-founder payment proof file from Cloudinary:', fileError);
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
                console.error('Failed to send co-founder transaction deletion notification email:', emailError);
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
            cloudinaryFileDeleted: !!transactionDetails.cloudinaryId,
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
            // Process referral commissions for admin-added co-founder shares
            const referralResult = await handleCofounderPurchase(
                userId,
                coFounderShare.pricing.priceNaira * parseInt(shares), // Use correct amount calculation
                parseInt(shares), // shares count
                transaction._id  // Use transaction._id
            );
            
            console.log('Co-founder referral commission process result for admin-added shares:', referralResult);
            if (referralResult.success) {
                console.log('Admin-added shares commissions distributed:', referralResult.commissions);
            }
        } catch (referralError) {
            console.error('Error processing co-founder referral commissions for admin-added shares:', referralError);
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
    getCoFounderPaymentProofDirect,
    // Updated manual payment functions (previously placeholders)
    initiateCoFounderManualPayment,
    uploadCoFounderPaymentProof,
    getCoFounderManualPaymentStatus,
    getCoFounderPendingManualPayments,
    approveCoFounderManualPayment,
    rejectCoFounderManualPayment,
    getAllCoFounderManualPayments
};