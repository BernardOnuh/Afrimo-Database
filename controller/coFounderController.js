/**
 * Co-Founder Share Controller - COMPLETE FIXED VERSION
 * Uses TierConfig for all tier definitions (type: 'co-founder')
 * FIXED: Consistent tier type validation across all functions
 */

const CoFounderShare = require('../models/CoFounderShare');
const Share = require('../models/Share');
const UserShare = require('../models/UserShare');
const PaymentTransaction = require('../models/Transaction');
const PaymentConfig = require('../models/PaymentConfig');
const User = require('../models/User');
const TierConfig = require('../models/TierConfig');
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

// Helper function to resolve user identifier
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

// ===================================================================
// SHARE INFO & PURCHASE
// ===================================================================

const getCoFounderShareInfo = async (req, res) => {
    try {
        const config = await TierConfig.getCurrentConfig();
        const cofounderTiers = [];
        
        for (const [key, tier] of config.tiers) {
            if (tier.type === 'co-founder' && tier.active === true) {
                cofounderTiers.push({
                    _id: key,
                    label: tier.name,
                    priceNaira: tier.priceNGN,
                    priceUSDT: tier.priceUSD,
                    ownershipPct: tier.percentPerShare,
                    earningKobo: tier.earningPerPhone,
                    sharesIncluded: tier.sharesIncluded || 1,
                    active: tier.active,
                    description: tier.description || ''
                });
            }
        }
        
        cofounderTiers.sort((a, b) => a.priceNaira - b.priceNaira);
        
        res.json({ 
            success: true, 
            packages: cofounderTiers,
            note: "Use the _id field as tierKey in other endpoints"
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const calculateCoFounderPurchase = async (req, res) => {
    try {
        const { tierKey, currency } = req.body;

        if (!tierKey || !currency) {
            return res.status(400).json({ success: false, message: 'tierKey and currency are required' });
        }

        if (!['naira', 'usdt'].includes(currency)) {
            return res.status(400).json({ success: false, message: 'currency must be naira or usdt' });
        }

        const config = await TierConfig.getCurrentConfig();

        if (!config.tiers.has(tierKey)) {
            return res.status(400).json({ success: false, message: `Invalid co-founder tier: ${tierKey}` });
        }

        const tier = config.tiers.get(tierKey);

        // ✅ FIXED: Accept both 'co-founder' and 'cofounder'
        if (tier.type !== 'co-founder' && tier.type !== 'cofounder') {
            return res.status(400).json({ 
                success: false, 
                message: `Specified tier is not a co-founder tier. Found type: ${tier.type}` 
            });
        }

        if (tier.active === false) {
            return res.status(400).json({ success: false, message: 'This co-founder tier is not currently available' });
        }

        const price = currency === 'naira' ? tier.priceNGN : tier.priceUSD;
        if (!price) {
            return res.status(400).json({ success: false, message: `Tier not available in ${currency}` });
        }

        res.json({
            success: true,
            tierKey,
            tierName: tier.name,
            tierType: tier.type,
            price,
            currency,
            percentPerShare: tier.percentPerShare,
            earningPerPhone: tier.earningPerPhone,
            sharesIncluded: tier.sharesIncluded || 1
        });
    } catch (error) {
        console.error('Error in calculateCoFounderPurchase:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

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

const submitCoFounderManualPayment = async (req, res) => {
    try {
        const { tierKey, currency, paymentMethod, bankName, accountName, reference } = req.body;
        const userId = req.user.id;

        if (!userId) {
            return res.status(401).json({ success: false, message: 'Authentication required' });
        }

        if (!req.file || !req.file.path) {
            return res.status(400).json({ success: false, message: 'Payment proof is required' });
        }

        const config = await TierConfig.getCurrentConfig();
        
        if (!tierKey || !config.tiers.has(tierKey)) {
            return res.status(400).json({ success: false, message: `Invalid co-founder tier: ${tierKey}` });
        }

        const tier = config.tiers.get(tierKey);

        // ✅ FIXED: Accept both 'co-founder' and 'cofounder' (CONSISTENT WITH calculateCoFounderPurchase)
        if ((tier.type !== 'co-founder' && tier.type !== 'cofounder') || tier.active === false) {
            return res.status(400).json({ success: false, message: 'Tier is not an active co-founder tier' });
        }

        const priceAmount = currency === 'naira' ? tier.priceNGN : tier.priceUSD;
        if (!priceAmount) {
            return res.status(400).json({ success: false, message: `Tier not available in ${currency}` });
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

        const transactionId = generateTransactionId();

        const txData = {
            transactionId,
            type: 'co-founder',
            tierKey: tierKey,
            packageId: tierKey,
            packageLabel: tier.name,
            ownershipPct: tier.percentPerShare,
            earningKobo: tier.earningPerPhone,
            amount: priceAmount,
            currency,
            paymentMethod: `manual_${paymentMethod}`,
            status: 'pending',
            shares: 1,
            manualPaymentDetails: { bankName, accountName, reference },
            paymentProofPath: req.file.path,
            paymentProofCloudinaryUrl: req.file.path,
            paymentProofCloudinaryId: req.file.filename,
            paymentProofOriginalName: req.file.originalname,
            paymentProofFileSize: req.file.size
        };

        await PaymentTransaction.create({ userId, ...txData });
        await UserShare.addTransaction(userId, txData);

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
                        <p><strong>Package:</strong> ${tier.name}</p>
                        <p><strong>Amount:</strong> ${currency === 'naira' ? '₦' : '$'}${priceAmount.toLocaleString()}</p>
                        <p><strong>Ownership:</strong> ${(tier.percentPerShare * 100).toFixed(6)}%</p>
                        <p><strong>Earning per Phone:</strong> ₦${(tier.earningPerPhone / 100).toLocaleString()}/day</p>
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
                packageLabel: tier.name,
                ownershipPct: tier.percentPerShare,
                formattedOwnership: `${(tier.percentPerShare * 100).toFixed(6)}%`,
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
                paymentMethod: transaction.paymentMethod?.replace('manual_', ''),
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
                message: 'Payment proof not available'
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
            fileSize: transaction.paymentProofFileSize
        });
        
    } catch (error) {
        console.error('getCoFounderPaymentProof error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch payment proof',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
};

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
        console.error('Error in direct payment proof access:', error);
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

        const cofounderTxs = record.transactions.filter(t => t.type === 'co-founder');
        const cofounderOwnershipPct = cofounderTxs
            .filter(t => t.status === 'completed')
            .reduce((sum, t) => sum + (t.ownershipPct || 0), 0);

        res.json({
            success: true,
            totalOwnershipPct: record.totalOwnershipPct || 0,
            cofounderOwnershipPct,
            totalEarningKobo: record.totalEarningKobo || 0,
            formattedOwnership: ((record.totalOwnershipPct || 0) * 100).toFixed(7) + '%',
            transactions: cofounderTxs
                .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
                .map(t => ({
                    transactionId: t.transactionId,
                    packageLabel: t.packageLabel,
                    ownershipPct: t.ownershipPct,
                    earningKobo: t.earningKobo,
                    amount: t.totalAmount || t.amount,
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

        tx.status = approved ? 'completed' : 'failed';
        tx.adminNotes = adminNote;
        tx.verifiedBy = req.user.id;
        tx.verifiedAt = new Date();
        await tx.save();

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

        const user = await User.findById(tx.userId);
        if (user?.email) {
            try {
                await sendEmail({
                    email: user.email,
                    subject: `Co-Founder Payment ${approved ? 'Approved' : 'Declined'}`,
                    html: `
                        <h2>Payment ${approved ? 'Approved ✅' : 'Declined ❌'}</h2>
                        <p>Dear ${user.name},</p>
                        <p>Your co-founder payment of ${tx.currency === 'naira' ? '₦' : '$'}${tx.amount.toLocaleString()} 
                        for <strong>${tx.packageLabel}</strong> has been ${approved ? 'approved' : 'declined'}.</p>
                        ${approved ? `<p>Ownership added: <strong>+${(tx.ownershipPct * 100).toFixed(6)}%</strong></p>` : ''}
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

        await UserShare.rejectTransaction(tx.userId, transactionId, 'pending');

        try {
            await rollbackReferralCommission(
                tx.userId, transactionId, tx.amount,
                tx.currency, 'cofounder', 'PaymentTransaction'
            );
        } catch (e) {
            console.error('Referral rollback error:', e.message);
        }

        tx.status = 'pending';
        tx.adminNotes = `CANCELLED: ${cancelReason || 'Admin cancelled'}`;
        await tx.save();

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

const adminDeleteCoFounderManualPayment = async (req, res) => {
    try {
        const { transactionId } = req.params;
        const adminId = req.user.id;
        
        const admin = await User.findById(adminId);
        if (!admin || !admin.isAdmin) {
            return res.status(403).json({ success: false, message: 'Admin access required' });
        }
        
        if (!transactionId) {
            return res.status(400).json({ success: false, message: 'Transaction ID is required' });
        }
        
        const transaction = await PaymentTransaction.findOne({
            transactionId,
            type: 'co-founder'
        });
        
        if (!transaction) {
            return res.status(404).json({ success: false, message: 'Transaction not found' });
        }
        
        const transactionDetails = {
            shares: transaction.shares,
            amount: transaction.amount,
            currency: transaction.currency,
            status: transaction.status,
            userId: transaction.userId,
            cloudinaryId: transaction.paymentProofCloudinaryId
        };
        
        if (transaction.status === 'completed') {
            try {
                await rollbackReferralCommission(
                    transaction.userId, transactionId, transaction.amount,
                    transaction.currency, 'co-founder', 'PaymentTransaction'
                );
            } catch (referralError) {
                console.error('Error rolling back referral commissions:', referralError);
            }
        }
        
        if (transactionDetails.cloudinaryId) {
            try {
                await deleteFromCloudinary(transactionDetails.cloudinaryId);
                console.log(`Co-founder payment proof deleted from Cloudinary: ${transactionDetails.cloudinaryId}`);
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
                    html: `<h2>Transaction Deleted</h2><p>Your co-founder transaction ${transactionId} has been deleted.</p>`
                });
            } catch (emailError) {
                console.error('Email error:', emailError);
            }
        }
        
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

// ===================================================================
// ADMIN: SHARE MANAGEMENT
// ===================================================================

const adminAddCoFounderShares = async (req, res) => {
    try {
        const { userId, shares, note, tierKey } = req.body;
        const adminId = req.user.id;
        
        const admin = await User.findById(adminId);
        if (!admin || !admin.isAdmin) {
            return res.status(403).json({ success: false, message: 'Admin access required' });
        }
        
        if (!userId) {
            return res.status(400).json({ success: false, message: 'Please provide userId' });
        }
        
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }
        
        if (!tierKey) {
            return res.status(400).json({ success: false, message: 'Please provide tierKey' });
        }
        
        const config = await TierConfig.getCurrentConfig();
        
        if (!config.tiers.has(tierKey)) {
            return res.status(400).json({ success: false, message: `Invalid co-founder tier: ${tierKey}` });
        }
        
        const tier = config.tiers.get(tierKey);
        
        // ✅ FIXED: Accept both 'co-founder' and 'cofounder'
        if (tier.type !== 'co-founder' && tier.type !== 'cofounder') {
            return res.status(400).json({ success: false, message: 'Specified tier is not a co-founder tier' });
        }
        
        const shareCount = shares ? parseInt(shares) : 1;
        const totalAmountNaira = tier.priceNGN * shareCount;
        const totalOwnershipPct = tier.percentPerShare * shareCount;
        const totalEarningKobo = tier.earningPerPhone * shareCount;
        const shareToRegularRatio = config.coFounderToRegularRatio || 22;
        
        const transactionId = generateTransactionId();
        
        await PaymentTransaction.create({
            userId,
            type: 'co-founder',
            transactionId,
            tierKey,
            packageLabel: tier.name,
            shares: shareCount,
            ownershipPct: totalOwnershipPct,
            earningKobo: totalEarningKobo,
            amount: totalAmountNaira,
            currency: 'naira',
            status: 'completed',
            adminNotes: note || `Admin allocated ${shareCount} ${tier.name} co-founder share(s)`,
            paymentMethod: 'admin_override',
            verifiedBy: adminId,
            verifiedAt: new Date(),
            shareToRegularRatio,
            equivalentRegularShares: shareCount * shareToRegularRatio
        });
        
        await UserShare.addCoFounderShares(userId, shareCount, {
            transactionId,
            shares: shareCount,
            coFounderShares: shareCount,
            ownershipPct: totalOwnershipPct,
            earningKobo: totalEarningKobo,
            equivalentRegularShares: shareCount * shareToRegularRatio,
            shareToRegularRatio,
            pricePerShare: tier.priceNGN,
            currency: 'naira',
            totalAmount: totalAmountNaira,
            paymentMethod: 'admin_override',
            status: 'completed',
            packageLabel: tier.name,
            adminAction: true,
            adminNote: note || `Admin allocated ${shareCount} ${tier.name} co-founder share(s)`
        });
        
        if (user.email) {
            try {
                await sendEmail({
                    email: user.email,
                    subject: 'Co-Founder Share Package Allocated',
                    html: `<h2>Co-Founder Share Allocation</h2><p>You have been allocated ${shareCount} ${tier.name} co-founder share(s).</p>`
                });
            } catch (emailError) {
                console.error('Email error:', emailError);
            }
        }
        
        res.status(200).json({
            success: true,
            message: `Successfully added ${shareCount} ${tier.name} co-founder share(s) to user`,
            data: {
                transactionId,
                userId,
                coFounderShares: shareCount,
                packageName: tier.name,
                ownershipPct: totalOwnershipPct,
                formattedOwnershipPct: `${(totalOwnershipPct * 100).toFixed(6)}%`,
                earningKobo: totalEarningKobo,
                formattedEarning: `₦${(totalEarningKobo / 100).toLocaleString()}`,
                equivalentRegularShares: shareCount * shareToRegularRatio,
                totalAmount: totalAmountNaira,
                shareToRegularRatio
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

const adminAddCoFounderSharesFlexible = async (req, res) => {
    try {
        const { userIdentifier, shares, note } = req.body;
        const adminId = req.user.id;
        
        const admin = await User.findById(adminId);
        if (!admin || !admin.isAdmin) {
            return res.status(403).json({ success: false, message: 'Admin access required' });
        }
        
        const user = await resolveUserIdentifier(userIdentifier);
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found', searchedFor: userIdentifier });
        }
        
        // Create a modified request to use the standard add shares function
        const modifiedReq = { ...req, body: { userId: user._id, shares, note } };
        return adminAddCoFounderShares(modifiedReq, res);
    } catch (error) {
        console.error('Error in flexible add shares:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to add co-founder shares',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// ===================================================================
// ADMIN: STATISTICS
// ===================================================================

const getCoFounderShareStatistics = async (req, res) => {
    try {
        const adminId = req.user.id;
        
        const admin = await User.findById(adminId);
        if (!admin || !admin.isAdmin) {
            return res.status(403).json({ success: false, message: 'Admin access required' });
        }
        
        const config = await TierConfig.getCurrentConfig();
        
        const completedTransactions = await PaymentTransaction.find({
            type: 'co-founder',
            status: 'completed'
        }).lean();
        
        let totalOwnershipPct = 0;
        let totalEarningKobo = 0;
        let totalValueNaira = 0;
        let totalShares = 0;
        const tierSales = {};
        
        for (const tx of completedTransactions) {
            totalOwnershipPct += tx.ownershipPct || 0;
            totalEarningKobo += tx.earningKobo || 0;
            totalValueNaira += tx.amount || 0;
            totalShares += tx.shares || 1;
            
            const tierKey = tx.tierKey || tx.packageId;
            if (tierKey) {
                tierSales[`${tierKey}Sold`] = (tierSales[`${tierKey}Sold`] || 0) + (tx.shares || 1);
            }
        }
        
        const uniqueInvestors = new Set(completedTransactions.map(tx => tx.userId.toString()));
        const investorCount = uniqueInvestors.size;
        const pendingCount = await PaymentTransaction.countDocuments({ type: 'co-founder', status: 'pending' });
        
        const shareToRegularRatio = config.coFounderToRegularRatio || 22;
        
        const tierSummaries = [];
        for (const [key, tier] of config.tiers) {
            if (tier.type === 'co-founder') {
                const sold = tierSales[`${key}Sold`] || 0;
                tierSummaries.push({
                    key,
                    name: tier.name,
                    priceNaira: tier.priceNGN,
                    priceUSDT: tier.priceUSD,
                    percentPerShare: tier.percentPerShare,
                    formattedPercentPerShare: `${(tier.percentPerShare * 100).toFixed(6)}%`,
                    earningPerPhone: tier.earningPerPhone,
                    formattedEarningPerPhone: `₦${(tier.earningPerPhone / 100).toLocaleString()}`,
                    sharesSold: sold,
                    revenueNaira: sold * tier.priceNGN,
                    active: tier.active
                });
            }
        }
        
        res.status(200).json({
            success: true,
            statistics: {
                totalCoFounderShares: totalShares,
                coFounderSharesSold: totalShares,
                totalOwnershipPct,
                formattedTotalOwnership: `${(totalOwnershipPct * 100).toFixed(6)}%`,
                totalEarningKobo,
                formattedTotalEarning: `₦${(totalEarningKobo / 100).toLocaleString()}`,
                totalValueNaira,
                investorCount,
                pendingTransactions: pendingCount,
                shareToRegularRatio,
                totalEquivalentRegularShares: totalShares * shareToRegularRatio,
                tierSales,
                tierSummaries
            },
            pricing: tierSummaries.reduce((acc, tier) => {
                acc[tier.key] = {
                    name: tier.name,
                    priceNaira: tier.priceNaira,
                    priceUSDT: tier.priceUSDT,
                    percentPerShare: tier.percentPerShare,
                    earningPerPhone: tier.earningPerPhone
                };
                return acc;
            }, {})
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

// ===================================================================
// ADMIN: TRANSACTIONS
// ===================================================================

const getAllCoFounderTransactions = async (req, res) => {
    try {
        const admin = await User.findById(req.user.id);
        if (!admin || !admin.isAdmin) {
            return res.status(403).json({ success: false, message: 'Admin access required' });
        }
        
        const { status, page = 1, limit = 20 } = req.query;
        const query = { type: 'co-founder' };
        if (status) query.status = status;
        
        const transactions = await PaymentTransaction.find(query)
            .populate('userId', 'name email')
            .sort({ createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(parseInt(limit));
        
        const totalCount = await PaymentTransaction.countDocuments(query);
        
        res.status(200).json({
            success: true,
            transactions: transactions.map(tx => ({
                transactionId: tx.transactionId,
                user: tx.userId ? { name: tx.userId.name, email: tx.userId.email } : null,
                shares: tx.shares,
                amount: tx.amount,
                currency: tx.currency,
                status: tx.status,
                date: tx.createdAt
            })),
            pagination: {
                currentPage: parseInt(page),
                totalPages: Math.ceil(totalCount / limit),
                totalCount
            }
        });
    } catch (error) {
        console.error('Error fetching co-founder transactions:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// ===================================================================
// ADMIN: USER OVERVIEW
// ===================================================================

const adminGetUserCoFounderOverview = async (req, res) => {
    try {
        const { identifier } = req.params;
        const adminId = req.user.id;
        
        const admin = await User.findById(adminId);
        if (!admin || !admin.isAdmin) {
            return res.status(403).json({ success: false, message: 'Admin access required' });
        }
        
        const user = await resolveUserIdentifier(identifier);
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found', searchedFor: identifier });
        }
        
        const cofounderTransactions = await PaymentTransaction.find({
            userId: user._id,
            type: 'co-founder',
            status: 'completed'
        });
        
        let totalOwnershipPct = 0;
        let totalEarningKobo = 0;
        let totalSpent = 0;
        
        for (const tx of cofounderTransactions) {
            totalOwnershipPct += tx.ownershipPct || 0;
            totalEarningKobo += tx.earningKobo || 0;
            totalSpent += tx.amount || 0;
        }
        
        res.status(200).json({
            success: true,
            user: {
                id: user._id,
                name: user.name,
                username: user.username,
                email: user.email,
                phone: user.phone
            },
            coFounderSharesSummary: {
                totalCoFounderShares: cofounderTransactions.length,
                totalOwnershipPct,
                formattedOwnershipPct: `${(totalOwnershipPct * 100).toFixed(6)}%`,
                totalEarningKobo,
                formattedEarning: `₦${(totalEarningKobo / 100).toLocaleString()}`,
                totalSpent,
                formattedSpent: `₦${totalSpent.toLocaleString()}`
            },
            transactions: cofounderTransactions.map(tx => ({
                transactionId: tx.transactionId,
                shares: tx.shares,
                amount: tx.amount,
                currency: tx.currency,
                status: tx.status,
                date: tx.createdAt
            }))
        });
    } catch (error) {
        console.error('Error fetching user co-founder overview:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch user overview',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// ===================================================================
// ADMIN: CONVENIENCE METHODS
// ===================================================================

const getCoFounderPendingManualPayments = async (req, res) => {
    const modifiedReq = { ...req, query: { ...req.query, status: 'pending' } };
    return adminGetCoFounderManualTransactions(modifiedReq, res);
};

const approveCoFounderManualPayment = async (req, res) => {
    const { transactionId } = req.params;
    const { adminNote } = req.body;
    return adminVerifyCoFounderManualPayment({ ...req, body: { transactionId, approved: true, adminNote } }, res);
};

const rejectCoFounderManualPayment = async (req, res) => {
    const { transactionId } = req.params;
    const { adminNote } = req.body;
    return adminVerifyCoFounderManualPayment({ ...req, body: { transactionId, approved: false, adminNote } }, res);
};

const getAllCoFounderManualPayments = async (req, res) => {
    return adminGetCoFounderManualTransactions(req, res);
};

const updateCoFounderToRegularRatio = async (req, res) => {
    try {
        const { ratio, reason } = req.body;
        const adminId = req.user.id;
        
        const admin = await User.findById(adminId);
        if (!admin || !admin.isAdmin) {
            return res.status(403).json({ success: false, message: 'Admin access required' });
        }
        
        if (!ratio || ratio <= 0 || !Number.isInteger(Number(ratio))) {
            return res.status(400).json({ success: false, message: 'Please provide a valid ratio (must be a positive integer)' });
        }
        
        const config = await TierConfig.getCurrentConfig();
        const oldRatio = config.coFounderToRegularRatio || 22;
        const newRatio = parseInt(ratio);
        
        config.coFounderToRegularRatio = newRatio;
        config.lastUpdated = new Date();
        config.lastUpdatedBy = adminId;
        await config.save();
        
        res.status(200).json({
            success: true,
            message: 'Co-founder to regular share ratio updated successfully',
            oldRatio,
            newRatio,
            explanation: `1 Co-Founder Share now equals ${newRatio} Regular Shares`
        });
    } catch (error) {
        console.error('Error updating ratio:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

const updateCoFounderTierPricing = async (req, res) => {
    try {
        const { tierKey, priceNaira, priceUSDT, reason } = req.body;
        const adminId = req.user.id;
        
        const admin = await User.findById(adminId);
        if (!admin || !admin.isAdmin) {
            return res.status(403).json({ success: false, message: 'Admin access required' });
        }
        
        if (!tierKey) {
            return res.status(400).json({ success: false, message: 'tierKey is required' });
        }
        
        const config = await TierConfig.getCurrentConfig();
        
        if (!config.tiers.has(tierKey)) {
            return res.status(404).json({ success: false, message: `Tier '${tierKey}' not found` });
        }
        
        const tier = config.tiers.get(tierKey);
        
        // ✅ FIXED: Accept both 'co-founder' and 'cofounder'
        if (tier.type !== 'co-founder' && tier.type !== 'cofounder') {
            return res.status(400).json({ success: false, message: 'Specified tier is not a co-founder tier' });
        }
        
        const oldPriceNaira = tier.priceNGN;
        const oldPriceUSDT = tier.priceUSD;
        
        if (priceNaira) tier.priceNGN = parseFloat(priceNaira);
        if (priceUSDT) tier.priceUSD = parseFloat(priceUSDT);
        
        config.tiers.set(tierKey, tier);
        config.lastUpdated = new Date();
        config.lastUpdatedBy = adminId;
        await config.save();
        
        res.status(200).json({
            success: true,
            message: `Co-founder tier '${tierKey}' pricing updated successfully`,
            tier: {
                key: tierKey,
                name: tier.name,
                priceNaira: tier.priceNGN,
                priceUSDT: tier.priceUSD,
                oldPriceNaira,
                oldPriceUSDT
            }
        });
    } catch (error) {
        console.error('Error updating tier pricing:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

const disableCoFounderProgramme = async (req, res) => {
    try {
        const admin = await User.findById(req.user.id);
        if (!admin || !admin.isAdmin) {
            return res.status(403).json({ success: false, message: 'Admin required' });
        }

        const config = await TierConfig.getCurrentConfig();
        config.coFounderEnabled = false;
        await config.save();

        res.status(200).json({ success: true, message: 'Co-founder programme disabled successfully' });
    } catch (error) {
        console.error('Error disabling co-founder programme:', error);
        res.status(500).json({ success: false, message: error.message });
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
    getCoFounderPaymentProofDirect,
    getUserCoFounderShares,
    adminGetCoFounderManualTransactions,
    adminVerifyCoFounderManualPayment,
    adminCancelCoFounderManualPayment,
    adminDeleteCoFounderManualPayment,
    adminAddCoFounderShares,
    adminAddCoFounderSharesFlexible,
    getCoFounderShareStatistics,
    getAllCoFounderTransactions,
    adminGetUserCoFounderOverview,
    getCoFounderPendingManualPayments,
    approveCoFounderManualPayment,
    rejectCoFounderManualPayment,
    getAllCoFounderManualPayments,
    updateCoFounderToRegularRatio,
    updateCoFounderTierPricing,
    disableCoFounderProgramme,
    resolveUserIdentifier
};