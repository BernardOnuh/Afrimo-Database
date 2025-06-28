// utils/shareConversionUtils.js

const UserShare = require('../models/UserShare');
const CoFounderShare = require('../models/CoFounderShare');
const PaymentTransaction = require('../models/Transaction');
const User = require('../models/User');
const { sendEmail } = require('./emailService');

// Configuration - how many regular shares equal 1 co-founder share
const SHARES_PER_COFOUNDER = 29;

/**
 * Check if user has enough shares to convert to co-founder shares
 * and automatically perform the conversion
 */
const checkAndConvertToCoFounderShares = async (userId) => {
    try {
        console.log(`[ShareConversion] Checking conversion eligibility for user: ${userId}`);
        
        // Get user's current share data
        const userShares = await UserShare.findOne({ user: userId });
        
        if (!userShares || userShares.totalShares < SHARES_PER_COFOUNDER) {
            console.log(`[ShareConversion] User has ${userShares?.totalShares || 0} shares, need ${SHARES_PER_COFOUNDER} for conversion`);
            return {
                success: false,
                message: `Need ${SHARES_PER_COFOUNDER} shares for co-founder conversion`,
                currentShares: userShares?.totalShares || 0,
                sharesNeeded: SHARES_PER_COFOUNDER - (userShares?.totalShares || 0)
            };
        }
        
        // Calculate how many co-founder shares can be created
        const eligibleCoFounderShares = Math.floor(userShares.totalShares / SHARES_PER_COFOUNDER);
        const sharesToConvert = eligibleCoFounderShares * SHARES_PER_COFOUNDER;
        const remainingShares = userShares.totalShares - sharesToConvert;
        
        console.log(`[ShareConversion] Can convert ${sharesToConvert} shares to ${eligibleCoFounderShares} co-founder shares`);
        
        // Check if co-founder shares are available
        const coFounderConfig = await CoFounderShare.findOne();
        if (!coFounderConfig) {
            throw new Error('Co-founder share configuration not found');
        }
        
        const availableCoFounderShares = coFounderConfig.totalShares - coFounderConfig.sharesSold;
        if (eligibleCoFounderShares > availableCoFounderShares) {
            return {
                success: false,
                message: `Only ${availableCoFounderShares} co-founder shares available, you're eligible for ${eligibleCoFounderShares}`,
                eligibleCoFounderShares,
                availableCoFounderShares
            };
        }
        
        // Perform the conversion
        const conversionResult = await performShareConversion(
            userId, 
            sharesToConvert, 
            eligibleCoFounderShares, 
            remainingShares
        );
        
        return conversionResult;
        
    } catch (error) {
        console.error('[ShareConversion] Error checking conversion:', error);
        return {
            success: false,
            message: 'Error processing share conversion',
            error: error.message
        };
    }
};

/**
 * Perform the actual conversion of shares to co-founder shares
 */
const performShareConversion = async (userId, sharesToConvert, coFounderSharesToAdd, remainingShares) => {
    try {
        console.log(`[ShareConversion] Starting conversion for user ${userId}: ${sharesToConvert} shares → ${coFounderSharesToAdd} co-founder shares`);
        
        // Start transaction-like operations
        // 1. Update user's regular shares (subtract converted shares)
        const userShares = await UserShare.findOne({ user: userId });
        userShares.totalShares = remainingShares;
        
        // Add conversion transaction to user's history
        const conversionTransactionId = `CONV-${Date.now()}-${userId.toString().slice(-6)}`;
        
        userShares.transactions.push({
            transactionId: conversionTransactionId,
            shares: -sharesToConvert, // Negative to show shares were removed
            pricePerShare: 0, // No money involved in conversion
            currency: 'conversion',
            totalAmount: 0,
            paymentMethod: 'conversion',
            status: 'completed',
            tierBreakdown: {
                tier1: -sharesToConvert, // Assume all from tier1 for simplicity
                tier2: 0,
                tier3: 0
            },
            adminAction: true,
            adminNote: `Converted ${sharesToConvert} regular shares to ${coFounderSharesToAdd} co-founder shares`,
            createdAt: new Date()
        });
        
        await userShares.save();
        
        // 2. Create co-founder share transaction
        const coFounderTransaction = await PaymentTransaction.create({
            userId: userId,
            type: 'co-founder',
            transactionId: conversionTransactionId,
            amount: 0, // No monetary value for conversion
            currency: 'conversion',
            shares: coFounderSharesToAdd,
            status: 'completed',
            paymentMethod: 'conversion',
            adminNotes: `Auto-converted from ${sharesToConvert} regular shares`,
            createdAt: new Date()
        });
        
        // 3. Update co-founder shares sold count
        const coFounderConfig = await CoFounderShare.findOne();
        coFounderConfig.sharesSold += coFounderSharesToAdd;
        await coFounderConfig.save();
        
        // 4. Add co-founder shares to user's UserShare record (for tracking)
        await UserShare.addShares(userId, 0, { // 0 regular shares, but track co-founder
            transactionId: coFounderTransaction._id,
            shares: 0, // This is for regular shares
            pricePerShare: 0,
            currency: 'conversion',
            totalAmount: 0,
            paymentMethod: 'co-founder-conversion',
            status: 'completed',
            tierBreakdown: { tier1: 0, tier2: 0, tier3: 0 },
            adminAction: true,
            adminNote: `Received ${coFounderSharesToAdd} co-founder shares from conversion of ${sharesToConvert} regular shares`,
            coFounderShares: coFounderSharesToAdd // Custom field to track co-founder shares
        });
        
        // 5. Notify user via email
        await notifyUserOfConversion(userId, sharesToConvert, coFounderSharesToAdd, remainingShares);
        
        // 6. Update global share counts (subtract converted shares from total)
        // You might want to update your Share model here if needed
        
        console.log(`[ShareConversion] Conversion completed successfully for user ${userId}`);
        
        return {
            success: true,
            message: `Successfully converted ${sharesToConvert} shares to ${coFounderSharesToAdd} co-founder shares`,
            conversion: {
                regularSharesConverted: sharesToConvert,
                coFounderSharesReceived: coFounderSharesToAdd,
                remainingRegularShares: remainingShares,
                conversionTransactionId
            }
        };
        
    } catch (error) {
        console.error('[ShareConversion] Error performing conversion:', error);
        
        // Rollback operations if possible
        try {
            // You might want to implement rollback logic here
            console.log('[ShareConversion] Attempting rollback...');
        } catch (rollbackError) {
            console.error('[ShareConversion] Rollback failed:', rollbackError);
        }
        
        throw error;
    }
};

/**
 * Send email notification to user about the conversion
 */
const notifyUserOfConversion = async (userId, sharesToConvert, coFounderSharesToAdd, remainingShares) => {
    try {
        const user = await User.findById(userId);
        
        if (user && user.email) {
            await sendEmail({
                email: user.email,
                subject: 'AfriMobile - Shares Converted to Co-Founder Shares!',
                html: `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                        <h2 style="color: #2c5aa0;">🎉 Congratulations! Share Conversion Completed</h2>
                        
                        <p>Dear ${user.name},</p>
                        
                        <p>Great news! You've accumulated enough regular shares to qualify for co-founder shares. We've automatically converted your shares for you.</p>
                        
                        <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
                            <h3 style="color: #28a745; margin-top: 0;">Conversion Summary:</h3>
                            <ul style="list-style: none; padding: 0;">
                                <li style="padding: 5px 0;"><strong>Regular Shares Converted:</strong> ${sharesToConvert}</li>
                                <li style="padding: 5px 0;"><strong>Co-Founder Shares Received:</strong> ${coFounderSharesToAdd}</li>
                                <li style="padding: 5px 0;"><strong>Remaining Regular Shares:</strong> ${remainingShares}</li>
                            </ul>
                        </div>
                        
                        <p><strong>What does this mean?</strong></p>
                        <ul>
                            <li>You now have ${coFounderSharesToAdd} co-founder share(s) in AfriMobile</li>
                            <li>Co-founder shares come with enhanced benefits and voting rights</li>
                            <li>You still have ${remainingShares} regular shares remaining</li>
                            <li>Continue accumulating regular shares for future conversions</li>
                        </ul>
                        
                        <p style="color: #6c757d; font-size: 14px; margin-top: 30px;">
                            <strong>Conversion Rate:</strong> Every ${SHARES_PER_COFOUNDER} regular shares = 1 co-founder share
                        </p>
                        
                        <p>Thank you for your continued investment in AfriMobile!</p>
                        
                        <p>Best regards,<br>The AfriMobile Team</p>
                    </div>
                `
            });
        }
    } catch (emailError) {
        console.error('[ShareConversion] Failed to send conversion notification email:', emailError);
        // Don't throw error, just log it since conversion was successful
    }
};

/**
 * Manual conversion endpoint for admin or user-triggered conversions
 */
const manualShareConversion = async (req, res) => {
    try {
        const { userId, force = false } = req.body;
        const requestingUserId = req.user.id;
        
        // Check if user is admin or converting their own shares
        const requestingUser = await User.findById(requestingUserId);
        if (!requestingUser.isAdmin && requestingUserId !== userId) {
            return res.status(403).json({
                success: false,
                message: 'Unauthorized: Can only convert your own shares or admin access required'
            });
        }
        
        if (!userId) {
            return res.status(400).json({
                success: false,
                message: 'User ID is required'
            });
        }
        
        // Perform conversion check and execution
        const result = await checkAndConvertToCoFounderShares(userId);
        
        res.status(200).json(result);
        
    } catch (error) {
        console.error('Error in manual share conversion:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to process share conversion',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/**
 * Get conversion status for a user
 */
const getConversionStatus = async (req, res) => {
    try {
        const userId = req.params.userId || req.user.id;
        
        // Check if user is admin or checking their own status
        const requestingUser = await User.findById(req.user.id);
        if (!requestingUser.isAdmin && req.user.id !== userId) {
            return res.status(403).json({
                success: false,
                message: 'Unauthorized: Can only check your own status or admin access required'
            });
        }
        
        const userShares = await UserShare.findOne({ user: userId });
        const currentShares = userShares?.totalShares || 0;
        
        const eligibleCoFounderShares = Math.floor(currentShares / SHARES_PER_COFOUNDER);
        const sharesNeededForNext = SHARES_PER_COFOUNDER - (currentShares % SHARES_PER_COFOUNDER);
        
        // Get current co-founder shares count
        const coFounderTransactions = await PaymentTransaction.find({
            userId: userId,
            type: 'co-founder',
            status: 'completed'
        });
        
        const currentCoFounderShares = coFounderTransactions.reduce((sum, t) => sum + t.shares, 0);
        
        res.status(200).json({
            success: true,
            conversionStatus: {
                currentRegularShares: currentShares,
                currentCoFounderShares: currentCoFounderShares,
                eligibleForConversion: eligibleCoFounderShares,
                sharesNeededForNextConversion: sharesNeededForNext,
                conversionRate: `${SHARES_PER_COFOUNDER} regular shares = 1 co-founder share`,
                canConvertNow: eligibleCoFounderShares > 0
            }
        });
        
    } catch (error) {
        console.error('Error getting conversion status:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get conversion status',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/**
 * Hook this into your existing share addition process
 * Call this function after any successful share purchase
 */
const autoCheckConversionAfterPurchase = async (userId) => {
    try {
        console.log(`[ShareConversion] Auto-checking conversion after purchase for user: ${userId}`);
        
        // Automatically check and convert if eligible
        const result = await checkAndConvertToCoFounderShares(userId);
        
        if (result.success) {
            console.log(`[ShareConversion] Auto-conversion successful:`, result);
            
            // You might want to add this to a queue or notification system
            // to inform admins about automatic conversions
        }
        
        return result;
        
    } catch (error) {
        console.error('[ShareConversion] Error in auto-check conversion:', error);
        // Don't throw error since the main purchase was successful
        return { success: false, error: error.message };
    }
};

module.exports = {
    checkAndConvertToCoFounderShares,
    performShareConversion,
    manualShareConversion,
    getConversionStatus,
    autoCheckConversionAfterPurchase,
    SHARES_PER_COFOUNDER
};