const Share = require('../models/Share');
const UserShare = require('../models/UserShare');
const User = require('../models/User');
const crypto = require('crypto');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');
const { sendEmail } = require('../utils/emailService');
const SiteConfig = require('../models/SiteConfig');
const CoFounderShare = require('../models/CoFounderShare');
const PaymentTransaction = require('../models/Transaction');
const { processReferralCommission, rollbackReferralCommission } = require('../utils/referralUtils');
const { deleteFromCloudinary } = require('../config/cloudinary');
const ReferralTransaction = require('../models/ReferralTransaction');
const Referral = require('../models/Referral');
const TierConfig = require('../models/TierConfig');

// Generate a unique transaction ID
const generateTransactionId = () => {
  return `TXN-${crypto.randomBytes(4).toString('hex').toUpperCase()}-${Date.now().toString().slice(-6)}`;
};

// Helper function to resolve user by ID, username, or email
const resolveUserIdentifier = async (identifier) => {
  const isObjectId = /^[0-9a-fA-F]{24}$/.test(identifier);
  
  if (isObjectId) {
    const user = await User.findById(identifier);
    if (user) return user;
  }
  
  let user = await User.findOne({ 
    username: { $regex: new RegExp(`^${identifier}$`, 'i') } 
  });
  if (user) return user;
  
  user = await User.findOne({ 
    email: { $regex: new RegExp(`^${identifier}$`, 'i') } 
  });
  if (user) return user;
  
  user = await User.findOne({ 
    name: { $regex: identifier, $options: 'i' } 
  });
  if (user) return user;
  
  return null;
};

// ==================== PUBLIC ROUTES ====================

exports.getShareInfo = async (req, res) => {
  try {
    const config = await TierConfig.getCurrentConfig();
    const shareTiers = [];
    
    for (const [key, tier] of config.tiers) {
      if (tier.type === 'share' && tier.active === true) {
        shareTiers.push({
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
    
    shareTiers.sort((a, b) => a.priceNaira - b.priceNaira);
    
    res.json({ 
      success: true, 
      packages: shareTiers,
      note: "Use the _id field as packageId or tierKey in other endpoints"
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * @desc    Calculate purchase amount (works for both regular shares and co-founder)
 * @route   POST /api/shares/calculate
 * @access  Public
 */
exports.calculatePurchase = async (req, res) => {
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
      return res.status(400).json({ success: false, message: `Invalid tier: ${tierKey}` });
    }

    const tier = config.tiers.get(tierKey);

    // ✅ FIXED: Accept 'share', 'regular', AND 'co-founder'/'cofounder'
    const isValidShareType = ['share', 'regular', 'co-founder', 'cofounder'].includes(tier.type);
    
    if (!isValidShareType) {
      return res.status(400).json({ 
        success: false, 
        message: `Specified tier is not a valid share tier. Found type: ${tier.type}` 
      });
    }

    // Determine if it's a co-founder tier
    const isCoFounder = ['co-founder', 'cofounder'].includes(tier.type);

    if (tier.active === false) {
      return res.status(400).json({ success: false, message: 'This tier is not currently available' });
    }

    const price = currency === 'naira' ? tier.priceNGN : tier.priceUSD;
    if (!price) {
      return res.status(400).json({ success: false, message: `Tier not available in ${currency}` });
    }

    // Determine tier type for response
    const tierType = isCoFounder ? 'cofounder' : 'share';

    res.json({
      success: true,
      tierKey,
      tierName: tier.name,
      tierType: tierType,
      price,
      currency,
      percentPerShare: tier.percentPerShare,
      earningPerPhone: tier.earningPerPhone,
      sharesIncluded: tier.sharesIncluded || 1,
      isCoFounder: isCoFounder,
      equivalentRegularShares: isCoFounder ? (tier.sharesIncluded || 1) * (config.coFounderToRegularRatio || 22) : null
    });
  } catch (error) {
    console.error('Error in calculatePurchase:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

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

// ==================== ADMIN TIER MANAGEMENT ====================

/**
 * @desc    Admin: Update share tier pricing
 * @route   POST /api/shares/admin/update-pricing
 * @access  Private (Admin)
 */
exports.updateSharePricing = async (req, res) => {
  try {
    const { tierKey, priceNaira, priceUSDT, reason } = req.body;
    const adminId = req.user.id;
    
    const admin = await User.findById(adminId);
    if (!admin || !admin.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized: Admin access required'
      });
    }
    
    if (!tierKey) {
      return res.status(400).json({
        success: false,
        message: 'tierKey is required'
      });
    }
    
    if (!priceNaira && !priceUSDT) {
      return res.status(400).json({
        success: false,
        message: 'At least one price update is required'
      });
    }
    
    const config = await TierConfig.getCurrentConfig();
    
    if (!config.tiers.has(tierKey)) {
      return res.status(404).json({
        success: false,
        message: `Tier '${tierKey}' not found`
      });
    }
    
    const tier = config.tiers.get(tierKey);
    const oldPriceNaira = tier.priceNGN;
    const oldPriceUSDT = tier.priceUSD;
    
    // Update prices
    if (priceNaira) tier.priceNGN = parseFloat(priceNaira);
    if (priceUSDT) tier.priceUSD = parseFloat(priceUSDT);
    
    // Log the price change
    if (!tier.priceHistory) tier.priceHistory = [];
    tier.priceHistory.push({
      oldPriceNaira,
      oldPriceUSDT,
      newPriceNaira: tier.priceNGN,
      newPriceUSDT: tier.priceUSD,
      changedBy: adminId,
      reason: reason || 'Admin price update',
      date: new Date()
    });
    
    config.tiers.set(tierKey, tier);
    config.lastUpdated = new Date();
    config.lastUpdatedBy = adminId;
    await config.save();
    
    res.status(200).json({
      success: true,
      message: `Tier '${tierKey}' pricing updated successfully`,
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
    res.status(500).json({
      success: false,
      message: 'Failed to update pricing',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Admin: Get all share tiers
 * @route   GET /api/shares/admin/tiers
 * @access  Private (Admin)
 */
exports.getAllTiers = async (req, res) => {
  try {
    const admin = await User.findById(req.user.id);
    if (!admin || !admin.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized: Admin access required'
      });
    }
    
    const config = await TierConfig.getCurrentConfig();
    const tiers = [];
    
    for (const [key, tier] of config.tiers) {
      tiers.push({
        key,
        name: tier.name,
        type: tier.type,
        priceNGN: tier.priceNGN,
        priceUSD: tier.priceUSD,
        percentPerShare: tier.percentPerShare,
        earningPerPhone: tier.earningPerPhone,
        sharesIncluded: tier.sharesIncluded || 1,
        active: tier.active,
        description: tier.description || '',
        priceHistory: tier.priceHistory || [],
        createdAt: tier.createdAt,
        updatedAt: tier.updatedAt
      });
    }
    
    res.status(200).json({
      success: true,
      tiers,
      lastUpdated: config.lastUpdated,
      lastUpdatedBy: config.lastUpdatedBy
    });
  } catch (error) {
    console.error('Error getting tiers:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get tiers',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Admin: Create a new share tier
 * @route   POST /api/shares/admin/tiers
 * @access  Private (Admin)
 */
exports.createTier = async (req, res) => {
  try {
    const { tierKey, name, priceNaira, priceUSDT, percentPerShare, earningPerPhone, description } = req.body;
    const adminId = req.user.id;
    
    const admin = await User.findById(adminId);
    if (!admin || !admin.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized: Admin access required'
      });
    }
    
    if (!tierKey || !name || !priceNaira || !percentPerShare || !earningPerPhone) {
      return res.status(400).json({
        success: false,
        message: 'tierKey, name, priceNaira, percentPerShare, and earningPerPhone are required'
      });
    }
    
    const config = await TierConfig.getCurrentConfig();
    
    if (config.tiers.has(tierKey)) {
      return res.status(400).json({
        success: false,
        message: `Tier '${tierKey}' already exists`
      });
    }
    
    const newTier = {
      name,
      type: 'share',
      priceNGN: parseFloat(priceNaira),
      priceUSD: priceUSDT ? parseFloat(priceUSDT) : 0,
      percentPerShare: parseFloat(percentPerShare),
      earningPerPhone: parseInt(earningPerPhone),
      sharesIncluded: 1,
      active: true,
      description: description || '',
      priceHistory: [],
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    config.tiers.set(tierKey, newTier);
    config.lastUpdated = new Date();
    config.lastUpdatedBy = adminId;
    await config.save();
    
    res.status(201).json({
      success: true,
      message: `Tier '${tierKey}' created successfully`,
      tier: {
        key: tierKey,
        ...newTier
      }
    });
  } catch (error) {
    console.error('Error creating tier:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create tier',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Admin: Update tier status (activate/deactivate)
 * @route   PUT /api/shares/admin/tiers/:tierKey
 * @access  Private (Admin)
 */
exports.updateTierStatus = async (req, res) => {
  try {
    const { tierKey } = req.params;
    const { active, reason } = req.body;
    const adminId = req.user.id;
    
    const admin = await User.findById(adminId);
    if (!admin || !admin.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized: Admin access required'
      });
    }
    
    if (active === undefined) {
      return res.status(400).json({
        success: false,
        message: 'active status is required'
      });
    }
    
    const TierConfig = require('../models/TierConfig');
    const config = await TierConfig.getCurrentConfig();
    
    if (!config.tiers.has(tierKey)) {
      return res.status(404).json({
        success: false,
        message: `Tier '${tierKey}' not found`
      });
    }
    
    const tier = config.tiers.get(tierKey);
    tier.active = active;
    tier.updatedAt = new Date();
    
    config.tiers.set(tierKey, tier);
    config.lastUpdated = new Date();
    config.lastUpdatedBy = adminId;
    await config.save();
    
    res.status(200).json({
      success: true,
      message: `Tier '${tierKey}' ${active ? 'activated' : 'deactivated'} successfully`,
      tier: {
        key: tierKey,
        name: tier.name,
        active: tier.active
      }
    });
  } catch (error) {
    console.error('Error updating tier status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update tier status',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Admin: Delete a share tier
 * @route   DELETE /api/shares/admin/tiers/:tierKey
 * @access  Private (Admin)
 */
exports.deleteTier = async (req, res) => {
  try {
    const { tierKey } = req.params;
    const adminId = req.user.id;
    
    const admin = await User.findById(adminId);
    if (!admin || !admin.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized: Admin access required'
      });
    }
    
    const config = await TierConfig.getCurrentConfig();
    
    if (!config.tiers.has(tierKey)) {
      return res.status(404).json({
        success: false,
        message: `Tier '${tierKey}' not found`
      });
    }
    
    // Check if tier has any completed transactions
    const hasTransactions = await PaymentTransaction.exists({
      tierKey: tierKey,
      status: 'completed'
    });
    
    if (hasTransactions) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete tier that has completed transactions. Deactivate it instead.'
      });
    }
    
    config.tiers.delete(tierKey);
    config.lastUpdated = new Date();
    config.lastUpdatedBy = adminId;
    await config.save();
    
    res.status(200).json({
      success: true,
      message: `Tier '${tierKey}' deleted successfully`
    });
  } catch (error) {
    console.error('Error deleting tier:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete tier',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// ==================== ADMIN SHARE MANAGEMENT ====================

/**
 * @desc    Admin: Add shares to user
 * @route   POST /api/shares/admin/add-shares
 * @access  Private (Admin)
 */
exports.adminAddShares = async (req, res) => {
  try {
    const { userId, shares, note, tierKey, packageId } = req.body;
    const adminId = req.user.id;
    
    const admin = await User.findById(adminId);
    if (!admin || !admin.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized: Admin access required'
      });
    }
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'Please provide userId'
      });
    }
    
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    const config = await TierConfig.getCurrentConfig();
    let selectedTierKey = tierKey || packageId;
    let tierData = null;
    
    if (!selectedTierKey) {
      for (const [key, tier] of config.tiers) {
        if (tier.type === 'share' && tier.active === true) {
          selectedTierKey = key;
          tierData = tier;
          break;
        }
      }
      if (!tierData) {
        return res.status(400).json({
          success: false,
          message: 'No active share tiers available'
        });
      }
    } else {
      tierData = config.tiers.get(selectedTierKey);
      if (!tierData) {
        return res.status(400).json({
          success: false,
          message: `Invalid tier: ${selectedTierKey}`
        });
      }
      if (tierData.type !== 'share') {
        return res.status(400).json({
          success: false,
          message: 'Specified tier is not a regular share tier'
        });
      }
    }
    
    const shareCount = shares ? parseInt(shares) : (tierData.sharesIncluded || 1);
    const totalAmountNaira = tierData.priceNGN * shareCount;
    const transactionId = generateTransactionId();
    
    const transactionData = {
      transactionId,
      type: 'share',
      tierKey: selectedTierKey,
      packageId: selectedTierKey,
      packageLabel: tierData.name,
      shares: shareCount,
      ownershipPct: tierData.percentPerShare * shareCount,
      earningKobo: tierData.earningPerPhone * shareCount,
      pricePerShare: tierData.priceNGN,
      currency: 'naira',
      totalAmount: totalAmountNaira,
      paymentMethod: 'admin_override',
      status: 'completed',
      adminAction: true,
      adminNote: note || `Admin added ${shareCount} ${tierData.name} shares`,
      metadata: {
        tierKey: selectedTierKey,
        tierName: tierData.name,
        percentPerShare: tierData.percentPerShare,
        earningPerPhone: tierData.earningPerPhone
      }
    };
    
    await UserShare.addTransaction(userId, transactionData);
    
    await PaymentTransaction.create({
      userId,
      transactionId,
      type: 'share',
      tierKey: selectedTierKey,
      packageId: selectedTierKey,
      packageLabel: tierData.name,
      shares: shareCount,
      ownershipPct: tierData.percentPerShare * shareCount,
      earningKobo: tierData.earningPerPhone * shareCount,
      amount: totalAmountNaira,
      currency: 'naira',
      paymentMethod: 'admin_override',
      status: 'completed',
      adminNotes: note || `Admin added ${shareCount} ${tierData.name} shares`,
      verifiedBy: adminId,
      verifiedAt: new Date(),
      metadata: {
        adminAction: true,
        tierKey: selectedTierKey
      }
    });
    
    try {
      if (user.referralInfo && user.referralInfo.code) {
        await processReferralCommission(
          userId,
          totalAmountNaira,
          'share',
          transactionId,
          shareCount
        );
      }
    } catch (referralError) {
      console.error('Error processing referral commissions:', referralError);
    }
    
    if (user.email) {
      try {
        await sendEmail({
          email: user.email,
          subject: 'AfriMobile - Share Package Added to Your Account',
          html: `
            <h2>Share Package Added</h2>
            <p>Dear ${user.name},</p>
            <p>We are pleased to inform you that a share package has been added to your account:</p>
            <ul>
              <li><strong>Package:</strong> ${tierData.name}</li>
              <li><strong>Quantity:</strong> ${shareCount}</li>
              <li><strong>Ownership Percentage:</strong> ${(tierData.percentPerShare * shareCount * 100).toFixed(7)}%</li>
              <li><strong>Earning per Phone:</strong> ₦${(tierData.earningPerPhone * shareCount / 100).toFixed(2)}</li>
            </ul>
            <p>Transaction Reference: ${transactionId}</p>
            <p>Thank you for being part of AfriMobile!</p>
            ${note ? `<p>Note: ${note}</p>` : ''}
          `
        });
      } catch (emailError) {
        console.error('Failed to send shares added email:', emailError);
      }
    }
    
    res.status(200).json({
      success: true,
      message: `Successfully added ${shareCount} ${tierData.name} share package(s) to user`,
      data: {
        transactionId,
        userId,
        shares: shareCount,
        packageName: tierData.name,
        tierKey: selectedTierKey,
        ownershipPct: tierData.percentPerShare * shareCount,
        earningKobo: tierData.earningPerPhone * shareCount,
        totalAmount: totalAmountNaira
      }
    });
    
  } catch (error) {
    console.error('Error adding shares to user:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add shares to user',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Admin: Update company wallet address
 * @route   POST /api/shares/admin/update-wallet
 * @access  Private (Admin)
 */
exports.updateCompanyWallet = async (req, res) => {
  try {
    const { walletAddress } = req.body;
    const adminId = req.user.id;
    
    const admin = await User.findById(adminId);
    if (!admin || !admin.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized: Admin access required'
      });
    }
    
    if (!walletAddress || !ethers.utils.isAddress(walletAddress)) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid wallet address'
      });
    }
    
    const config = await SiteConfig.getCurrentConfig();
    config.companyWalletAddress = walletAddress;
    config.lastUpdated = Date.now();
    await config.save();
    
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

// ==================== USER ROUTES ====================

exports.getUserShares = async (req, res) => {
  try {
    const record = await UserShare.findOne({ user: req.user.id });
    const paymentTransactions = await PaymentTransaction.find({
      userId: req.user.id,
      type: 'share'
    }).lean();

    if (!record && paymentTransactions.length === 0) {
      return res.json({
        success: true,
        totalOwnershipPct: 0,
        totalEarningKobo: 0,
        formattedOwnership: '0.0000000%',
        breakdown: {
          regular: { ownershipPct: 0, earningKobo: 0, transactions: 0 },
          cofounder: { ownershipPct: 0, earningKobo: 0, transactions: 0 }
        },
        transactions: []
      });
    }

    const summary = record ? record.getOwnershipSummary() : { totalOwnershipPct: 0, totalEarningKobo: 0 };
    const breakdown = await UserShare.getUserBreakdown(req.user.id);

    const allTransactions = [];
    
    if (record) {
      record.transactions.forEach(t => {
        allTransactions.push({
          transactionId: t.transactionId,
          type: t.type || 'share',
          tierKey: t.tierKey,
          packageLabel: t.packageLabel,
          ownershipPct: t.ownershipPct,
          earningKobo: t.earningKobo,
          amount: t.totalAmount || t.amount || 0,
          currency: t.currency || 'naira',
          paymentMethod: (t.paymentMethod || '').replace('manual_', ''),
          status: t.status,
          date: t.createdAt,
          source: 'UserShare'
        });
      });
    }
    
    const userShareTxIds = allTransactions.map(t => t.transactionId);
    paymentTransactions.forEach(tx => {
      if (!userShareTxIds.includes(tx.transactionId)) {
        allTransactions.push({
          transactionId: tx.transactionId,
          type: tx.type || 'share',
          tierKey: tx.tierKey,
          packageLabel: tx.packageLabel,
          ownershipPct: tx.ownershipPct,
          earningKobo: tx.earningKobo,
          amount: tx.amount || 0,
          currency: tx.currency || 'naira',
          paymentMethod: (tx.paymentMethod || '').replace('manual_', ''),
          status: tx.status,
          date: tx.createdAt,
          source: 'PaymentTransaction'
        });
      }
    });

    allTransactions.sort((a, b) => new Date(b.date) - new Date(a.date));

    res.json({
      success: true,
      totalOwnershipPct: summary.totalOwnershipPct || record?.totalOwnershipPct || 0,
      totalEarningKobo: summary.totalEarningKobo || record?.totalEarningKobo || 0,
      formattedOwnership: ((record?.totalOwnershipPct || 0) * 100).toFixed(7) + '%',
      breakdown: {
        regular: {
          ownershipPct: breakdown.regular.ownershipPct,
          earningKobo: breakdown.regular.earningKobo,
          transactions: breakdown.regular.transactions
        },
        cofounder: {
          ownershipPct: breakdown.cofounder.ownershipPct,
          earningKobo: breakdown.cofounder.earningKobo,
          transactions: breakdown.cofounder.transactions
        }
      },
      transactions: allTransactions
    });

  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getTransactionStatus = async (req, res) => {
  try {
    const { transactionId } = req.params;
    const userId = req.user.id;
    
    const user = await User.findById(userId);
    const isAdmin = user && user.isAdmin;
    
    const paymentTransaction = await PaymentTransaction.findOne({
      transactionId,
      type: 'share'
    });
    
    let transaction = null;
    
    if (paymentTransaction) {
      if (!isAdmin && paymentTransaction.userId.toString() !== userId) {
        return res.status(403).json({
          success: false,
          message: 'Access denied'
        });
      }
      
      transaction = {
        transactionId: paymentTransaction.transactionId,
        status: paymentTransaction.status,
        shares: paymentTransaction.shares,
        totalAmount: paymentTransaction.amount,
        currency: paymentTransaction.currency,
        paymentMethod: paymentTransaction.paymentMethod,
        createdAt: paymentTransaction.createdAt,
        updatedAt: paymentTransaction.updatedAt
      };
    } else {
      const userShareRecord = await UserShare.findOne({
        'transactions.transactionId': transactionId
      });
      
      if (userShareRecord) {
        if (!isAdmin && userShareRecord.user.toString() !== userId) {
          return res.status(403).json({
            success: false,
            message: 'Access denied'
          });
        }
        
        const userTransaction = userShareRecord.transactions.find(
          t => t.transactionId === transactionId
        );
        
        if (userTransaction) {
          transaction = {
            transactionId: userTransaction.transactionId,
            status: userTransaction.status,
            shares: userTransaction.shares,
            totalAmount: userTransaction.totalAmount,
            currency: userTransaction.currency,
            paymentMethod: userTransaction.paymentMethod,
            createdAt: userTransaction.createdAt,
            updatedAt: userTransaction.updatedAt || userTransaction.createdAt
          };
        }
      }
    }
    
    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found'
      });
    }
    
    res.status(200).json({
      success: true,
      transaction
    });
    
  } catch (error) {
    console.error('Error getting transaction status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get transaction status',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Admin: Get all tiers (both regular and co-founder)
 * @route   GET /api/shares/admin/tiers
 * @access  Private (Admin)
 */
exports.getAllTiers = async (req, res) => {
  try {
    const admin = await User.findById(req.user.id);
    if (!admin || !admin.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized: Admin access required'
      });
    }
    
    const TierConfig = require('../models/TierConfig');
    const config = await TierConfig.getCurrentConfig();
    const shareTiers = [];
    const cofounderTiers = [];
    
    for (const [key, tier] of config.tiers) {
      const tierData = {
        key,
        name: tier.name,
        type: tier.type,
        priceNGN: tier.priceNGN,
        priceUSD: tier.priceUSD,
        percentPerShare: tier.percentPerShare,
        earningPerPhone: tier.earningPerPhone,
        sharesIncluded: tier.sharesIncluded || 1,
        active: tier.active,
        description: tier.description || '',
        priceHistory: tier.priceHistory || []
      };
      
      if (tier.type === 'share' || tier.type === 'regular') {
        shareTiers.push(tierData);
      } else if (tier.type === 'co-founder' || tier.type === 'cofounder') {
        cofounderTiers.push(tierData);
      }
    }
    
    res.status(200).json({
      success: true,
      tiers: {
        share: shareTiers,
        cofounder: cofounderTiers
      }
    });
  } catch (error) {
    console.error('Error getting tiers:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get tiers',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};


/**
 * @desc    Admin: Create a new share tier
 * @route   POST /api/shares/admin/tiers/create
 * @access  Private (Admin)
 */
exports.createTier = async (req, res) => {
  try {
    const { tierKey, name, type, priceNaira, priceUSDT, percentPerShare, earningPerPhone, sharesIncluded, description } = req.body;
    const adminId = req.user.id;
    
    const admin = await User.findById(adminId);
    if (!admin || !admin.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized: Admin access required'
      });
    }
    
    if (!tierKey || !name || !priceNaira || !percentPerShare || !earningPerPhone) {
      return res.status(400).json({
        success: false,
        message: 'tierKey, name, priceNaira, percentPerShare, and earningPerPhone are required'
      });
    }
    
    const TierConfig = require('../models/TierConfig');
    const config = await TierConfig.getCurrentConfig();
    
    if (config.tiers.has(tierKey)) {
      return res.status(400).json({
        success: false,
        message: `Tier '${tierKey}' already exists`
      });
    }
    
    const newTier = {
      name,
      type: type || 'share',
      priceNGN: parseFloat(priceNaira),
      priceUSD: priceUSDT ? parseFloat(priceUSDT) : 0,
      percentPerShare: parseFloat(percentPerShare),
      earningPerPhone: parseInt(earningPerPhone),
      sharesIncluded: sharesIncluded || 1,
      active: true,
      description: description || '',
      priceHistory: [],
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    config.tiers.set(tierKey, newTier);
    config.lastUpdated = new Date();
    config.lastUpdatedBy = adminId;
    await config.save();
    
    res.status(201).json({
      success: true,
      message: `Tier '${tierKey}' created successfully`,
      tier: {
        key: tierKey,
        ...newTier
      }
    });
  } catch (error) {
    console.error('Error creating tier:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create tier',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};


/**
 * @desc    Admin: Delete a share tier
 * @route   DELETE /api/shares/admin/tiers/:tierKey
 * @access  Private (Admin)
 */
exports.deleteTier = async (req, res) => {
  try {
    const { tierKey } = req.params;
    const adminId = req.user.id;
    
    const admin = await User.findById(adminId);
    if (!admin || !admin.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized: Admin access required'
      });
    }
    
    const TierConfig = require('../models/TierConfig');
    const config = await TierConfig.getCurrentConfig();
    
    if (!config.tiers.has(tierKey)) {
      return res.status(404).json({
        success: false,
        message: `Tier '${tierKey}' not found`
      });
    }
    
    // Check if tier has any completed transactions
    const PaymentTransaction = require('../models/Transaction');
    const hasTransactions = await PaymentTransaction.exists({
      tierKey: tierKey,
      status: 'completed'
    });
    
    if (hasTransactions) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete tier that has completed transactions. Deactivate it instead.'
      });
    }
    
    config.tiers.delete(tierKey);
    config.lastUpdated = new Date();
    config.lastUpdatedBy = adminId;
    await config.save();
    
    res.status(200).json({
      success: true,
      message: `Tier '${tierKey}' deleted successfully`
    });
  } catch (error) {
    console.error('Error deleting tier:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete tier',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};


// ==================== ADMIN STATISTICS ====================
/**
 * @desc    Admin: Get overall share statistics (UPDATED for percentage-based tiers)
 * @route   GET /api/shares/admin/statistics
 * @access  Private (Admin)
 */
/**
 * @desc    Admin: Get overall share statistics (FIXED)
 * @route   GET /api/shares/admin/statistics
 * @access  Private (Admin)
 */
/**
 * @desc    Admin: Get overall share statistics (FIXED with 1:22 ratio)
 * @route   GET /api/shares/admin/statistics
 * @access  Private (Admin)
 */
exports.getShareStatistics = async (req, res) => {
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
    
    // Get tier configuration
    const TierConfig = require('../models/TierConfig');
    const config = await TierConfig.getCurrentConfig();
    
    // Get all completed share transactions
    const completedTransactions = await PaymentTransaction.find({
      type: 'share',
      status: 'completed'
    }).lean();
    
    // Get total supply from config (default 10,000 shares total)
    const totalSupply = config.totalSupply || 10000;
    
    // Initialize counters as NUMBERS
    let totalOwnershipPct = 0;
    let totalEarningKobo = 0;
    let totalValueNaira = 0;
    let totalValueUSDT = 0;
    let sharesSold = 0;
    
    // Track tier sales dynamically
    const tierSales = {};
    
    // Initialize tier sales from config tiers
    for (const [key, tier] of config.tiers) {
      if (tier.type === 'share' || tier.type === 'regular') {
        tierSales[`${key}Sold`] = 0;
      }
    }
    
    // Process all completed transactions
    for (const tx of completedTransactions) {
      // Ensure values are treated as NUMBERS
      const ownershipPct = Number(tx.ownershipPct) || 0;
      const earningKobo = Number(tx.earningKobo) || 0;
      const amount = Number(tx.amount) || 0;
      const shares = Number(tx.shares) || 1;
      
      totalOwnershipPct += ownershipPct;
      totalEarningKobo += earningKobo;
      sharesSold += shares;
      
      if (tx.currency === 'naira') {
        totalValueNaira += amount;
      } else if (tx.currency === 'usdt') {
        totalValueUSDT += amount;
      }
      
      const tierKey = tx.tierKey || tx.packageId;
      if (tierKey && tierSales[`${tierKey}Sold`] !== undefined) {
        tierSales[`${tierKey}Sold`] += shares;
      }
    }
    
    // Get unique investor count
    const uniqueInvestors = new Set();
    for (const tx of completedTransactions) {
      if (tx.userId) {
        uniqueInvestors.add(tx.userId.toString());
      }
    }
    const investorCount = uniqueInvestors.size;
    
    // Get pending transactions count
    const pendingTransactions = await PaymentTransaction.countDocuments({
      type: 'share',
      status: 'pending'
    });
    
    // Calculate remaining shares
    const sharesRemaining = Math.max(0, totalSupply - sharesSold);
    
    // Calculate percentage of total supply sold
    const percentSold = totalSupply > 0 ? ((sharesSold / totalSupply) * 100).toFixed(2) : "0.00";
    
    // Get current pricing for each tier and build tier summaries
    const pricing = {};
    const tierSummaries = [];
    
    for (const [key, tier] of config.tiers) {
      if (tier.type === 'share' || tier.type === 'regular') {
        const sold = tierSales[`${key}Sold`] || 0;
        const priceNGN = Number(tier.priceNGN) || 0;
        const priceUSD = Number(tier.priceUSD) || 0;
        const percentPerShare = Number(tier.percentPerShare) || 0;
        const earningPerPhone = Number(tier.earningPerPhone) || 0;
        
        pricing[key] = {
          name: tier.name,
          priceNaira: priceNGN,
          priceUSDT: priceUSD,
          percentPerShare: percentPerShare,
          earningPerPhone: earningPerPhone,
          sharesIncluded: tier.sharesIncluded || 1
        };
        
        tierSummaries.push({
          key: key,
          name: tier.name,
          priceNaira: priceNGN,
          priceUSDT: priceUSD,
          percentPerShare: percentPerShare,
          formattedPercentPerShare: `${(percentPerShare * 100).toFixed(4)}%`,
          earningPerPhone: earningPerPhone,
          formattedEarningPerPhone: `₦${(earningPerPhone / 100).toLocaleString()}`,
          sharesSold: sold,
          revenueNaira: sold * priceNGN,
          revenueUSDT: sold * priceUSD
        });
      }
    }
    
    // ✅ FIXED: Co-founder share ratio = 1:22
    const SHARE_TO_REGULAR_RATIO = 22; // 1 co-founder share = 22 regular shares
    
    const totalEquivalentCoFounderShares = Math.floor(sharesSold / SHARE_TO_REGULAR_RATIO);
    const remainingRegularShares = sharesSold % SHARE_TO_REGULAR_RATIO;
    
    // Format helper functions
    const formatEarning = (kobo) => {
      const numKobo = Number(kobo) || 0;
      return `₦${(numKobo / 100).toLocaleString()}`;
    };
    
    const formattedTotalOwnership = `${(totalOwnershipPct * 100).toFixed(4)}%`;
    
    res.status(200).json({
      success: true,
      statistics: {
        // Supply metrics
        totalSupply: totalSupply,
        sharesSold: sharesSold,
        sharesRemaining: sharesRemaining,
        percentSold: percentSold,
        
        // Percentage-based metrics
        totalOwnershipPct: totalOwnershipPct,
        formattedTotalOwnership: formattedTotalOwnership,
        totalEarningKobo: totalEarningKobo,
        formattedTotalEarning: formatEarning(totalEarningKobo),
        
        // Value metrics
        totalValueNaira: totalValueNaira,
        totalValueUSDT: totalValueUSDT,
        
        // User metrics
        investorCount: investorCount,
        pendingTransactions: pendingTransactions,
        
        // Tier sales breakdown
        tierSales: tierSales,
        
        // ✅ FIXED: Co-founder comparison with 1:22 ratio
        coFounderComparison: {
          shareToRegularRatio: SHARE_TO_REGULAR_RATIO,
          totalEquivalentCoFounderShares: totalEquivalentCoFounderShares,
          remainingRegularShares: remainingRegularShares,
          explanation: `${sharesSold} regular shares = ${totalEquivalentCoFounderShares} co-founder share${totalEquivalentCoFounderShares !== 1 ? 's' : ''}${remainingRegularShares > 0 ? ` + ${remainingRegularShares} regular share${remainingRegularShares !== 1 ? 's' : ''}` : ''}`
        },
        
        // Tier summaries
        tierSummaries: tierSummaries
      },
      pricing: pricing,
      notes: {
        ownershipNote: "Ownership is measured in percentage points (not number of shares)",
        earningNote: "Earnings are calculated per phone per day based on earningPerPhone value",
        supplyNote: `Total supply is ${totalSupply} packages (each package = 1 share unit)`,
        coFounderNote: `1 Co-Founder Share = ${SHARE_TO_REGULAR_RATIO} Regular Shares`
      }
    });
    
  } catch (error) {
    console.error('Error fetching share statistics:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch share statistics',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// ==================== ADMIN TRANSACTIONS ====================

exports.getAllTransactions = async (req, res) => {
  try {
    const adminId = req.user.id;
    
    const admin = await User.findById(adminId);
    if (!admin || !admin.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized: Admin access required'
      });
    }
    
    const { status, page = 1, limit = 20, paymentMethod } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    const query = {
      type: 'share',
      ...(status && { status }),
      ...(paymentMethod && { paymentMethod: { $regex: paymentMethod, $options: 'i' } })
    };
    
    const transactions = await PaymentTransaction.find(query)
      .populate('userId', 'name email phone username')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();
    
    const totalCount = await PaymentTransaction.countDocuments(query);
    
    const formatted = transactions.map(tx => ({
      transactionId: tx.transactionId,
      user: {
        id: tx.userId?._id || tx.userId,
        name: tx.userId?.name || 'Unknown',
        email: tx.userId?.email || '',
        phone: tx.userId?.phone || ''
      },
      shares: tx.shares,
      totalAmount: tx.amount,
      currency: tx.currency,
      paymentMethod: tx.paymentMethod?.replace('manual_', '').replace('admin_override', 'admin'),
      status: tx.status,
      date: tx.createdAt,
      tierKey: tx.tierKey,
      packageLabel: tx.packageLabel,
      ownershipPct: tx.ownershipPct,
      earningKobo: tx.earningKobo,
      paymentProof: tx.paymentProofCloudinaryUrl ? {
        directUrl: tx.paymentProofCloudinaryUrl,
        originalName: tx.paymentProofOriginalName
      } : null,
      adminNote: tx.adminNotes
    }));
    
    res.status(200).json({
      success: true,
      transactions: formatted,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalCount / parseInt(limit)),
        totalCount
      }
    });
  } catch (error) {
    console.error('Error fetching transactions:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch transactions',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// ==================== ADMIN MANUAL PAYMENTS ====================

exports.adminGetManualTransactions = async (req, res) => {
  try {
    const admin = await User.findById(req.user.id);
    if (!admin?.isAdmin) {
      return res.status(403).json({ success: false, message: 'Admin required' });
    }

    const { status, page = 1, limit = 20, fromDate, toDate } = req.query;

    const query = {
      type: 'share',
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
      tierKey: tx.tierKey,
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

exports.adminVerifyManualPayment = async (req, res) => {
  try {
    const { transactionId, approved, adminNote } = req.body;

    const admin = await User.findById(req.user.id);
    if (!admin?.isAdmin) {
      return res.status(403).json({ success: false, message: 'Admin required' });
    }

    const tx = await PaymentTransaction.findOne({ transactionId, type: 'share' });
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
        await processReferralCommission(tx.userId, tx.amount, 'share', transactionId);
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
          subject: `Share Payment ${approved ? 'Approved' : 'Declined'}`,
          html: `
            <h2>Payment ${approved ? 'Approved ✅' : 'Declined ❌'}</h2>
            <p>Dear ${user.name},</p>
            <p>Your payment of ${tx.currency === 'naira' ? '₦' : '$'}${tx.amount.toLocaleString()} 
            for <strong>${tx.packageLabel}</strong> has been ${approved ? 'approved' : 'declined'}.</p>
            ${approved ? `<p>Ownership added: <strong>+${(tx.ownershipPct * 100).toFixed(7)}%</strong></p>` : ''}
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

exports.adminCancelManualPayment = async (req, res) => {
  try {
    const { transactionId, cancelReason } = req.body;

    const admin = await User.findById(req.user.id);
    if (!admin?.isAdmin) {
      return res.status(403).json({ success: false, message: 'Admin required' });
    }

    const tx = await PaymentTransaction.findOne({ transactionId, type: 'share' });
    if (!tx) {
      return res.status(404).json({ success: false, message: 'Transaction not found' });
    }
    if (tx.status !== 'completed') {
      return res.status(400).json({ success: false, message: `Cannot cancel a transaction that is not completed` });
    }

    await UserShare.rejectTransaction(tx.userId, transactionId, 'pending');

    try {
      await rollbackReferralCommission(tx.userId, transactionId, tx.amount, tx.currency, 'share', 'PaymentTransaction');
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
          subject: 'Payment Approval Cancelled',
          html: `
            <p>Dear ${user.name},</p>
            <p>Your payment approval for <strong>${tx.packageLabel}</strong> has been temporarily reversed.</p>
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

exports.adminDeleteManualPayment = async (req, res) => {
  try {
    const { transactionId } = req.params;
    const adminId = req.user.id;
    
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
    
    const paymentTransaction = await PaymentTransaction.findOne({
      transactionId,
      type: 'share'
    });
    
    const userShareRecord = await UserShare.findOne({
      'transactions.transactionId': transactionId
    });
    
    if (!paymentTransaction && !userShareRecord) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found'
      });
    }
    
    let transactionDetails = {};
    let cloudinaryIds = [];
    
    if (paymentTransaction) {
      transactionDetails = {
        shares: paymentTransaction.shares,
        amount: paymentTransaction.amount,
        currency: paymentTransaction.currency,
        status: paymentTransaction.status,
        tierBreakdown: paymentTransaction.tierBreakdown,
        userId: paymentTransaction.userId
      };
      
      if (paymentTransaction.paymentProofCloudinaryId) {
        cloudinaryIds.push(paymentTransaction.paymentProofCloudinaryId);
      }
    }
    
    if (userShareRecord) {
      const transaction = userShareRecord.transactions.find(
        t => t.transactionId === transactionId
      );
      
      if (transaction) {
        if (!transactionDetails.shares) {
          transactionDetails = {
            shares: transaction.shares,
            amount: transaction.totalAmount,
            currency: transaction.currency,
            status: transaction.status,
            tierBreakdown: transaction.tierBreakdown,
            userId: userShareRecord.user
          };
        }
        
        if (transaction.paymentProofCloudinaryId && 
            !cloudinaryIds.includes(transaction.paymentProofCloudinaryId)) {
          cloudinaryIds.push(transaction.paymentProofCloudinaryId);
        }
      }
    }
    
    if (transactionDetails.status === 'completed') {
      try {
        await rollbackReferralCommission(
          transactionDetails.userId,
          transactionId,
          transactionDetails.amount,
          transactionDetails.currency,
          'share',
          'PaymentTransaction'
        );
      } catch (referralError) {
        console.error('Error rolling back share referral commissions:', referralError);
      }
    }
    
    for (const cloudinaryId of cloudinaryIds) {
      try {
        await deleteFromCloudinary(cloudinaryId);
        console.log(`Share payment proof file deleted from Cloudinary: ${cloudinaryId}`);
      } catch (fileError) {
        console.error('Error deleting share payment proof file from Cloudinary:', fileError);
      }
    }
    
    if (paymentTransaction) {
      await PaymentTransaction.deleteOne({ _id: paymentTransaction._id });
      console.log('Share PaymentTransaction record deleted');
    }
    
    if (userShareRecord) {
      userShareRecord.transactions = userShareRecord.transactions.filter(
        t => t.transactionId !== transactionId
      );
      await userShareRecord.save();
      console.log('Share UserShare record updated');
    }
    
    const user = await User.findById(transactionDetails.userId);
    
    if (user && user.email) {
      try {
        await sendEmail({
          email: user.email,
          subject: 'AfriMobile - Share Transaction Deleted',
          html: `
            <h2>Transaction Deletion Notice</h2>
            <p>Dear ${user.name},</p>
            <p>Your share manual payment transaction has been deleted from our system.</p>
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
            <p>If you believe this was done in error, please contact our support team.</p>
          `
        });
      } catch (emailError) {
        console.error('Failed to send deletion notification email:', emailError);
      }
    }
    
    res.status(200).json({
      success: true,
      message: 'Share manual payment transaction deleted successfully',
      data: {
        transactionId,
        deletedTransaction: {
          shares: transactionDetails.shares,
          amount: transactionDetails.amount,
          currency: transactionDetails.currency,
          previousStatus: transactionDetails.status
        },
        cloudinaryFilesDeleted: cloudinaryIds.length
      }
    });
  } catch (error) {
    console.error('Error deleting share manual payment transaction:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete manual payment transaction',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// ==================== ADMIN REPORTS ====================

exports.getSharePurchaseReport = async (req, res) => {
  try {
    const {
      startDate,
      endDate,
      status = 'completed',
      page = 1,
      limit = 50,
      sortBy = 'date',
      sortOrder = 'desc'
    } = req.query;

    const dateFilter = {};
    if (startDate) {
      const start = new Date(startDate);
      if (isNaN(start.getTime())) {
        return res.status(400).json({ success: false, message: 'Invalid startDate format' });
      }
      dateFilter.$gte = start;
    }
    if (endDate) {
      const end = new Date(endDate);
      if (isNaN(end.getTime())) {
        return res.status(400).json({ success: false, message: 'Invalid endDate format' });
      }
      end.setHours(23, 59, 59, 999);
      dateFilter.$lte = end;
    }

    const query = {
      status: status,
      ...(Object.keys(dateFilter).length > 0 && { createdAt: dateFilter })
    };

    const totalCount = await PaymentTransaction.countDocuments(query);
    const totalPages = Math.ceil(totalCount / limit);
    const skip = (page - 1) * limit;

    let sortField = {};
    switch (sortBy) {
      case 'amount':
        sortField = { amount: sortOrder === 'desc' ? -1 : 1 };
        break;
      case 'shares':
        sortField = { shares: sortOrder === 'desc' ? -1 : 1 };
        break;
      case 'name':
        sortField = { 'userId.name': sortOrder === 'desc' ? -1 : 1 };
        break;
      default:
        sortField = { createdAt: sortOrder === 'desc' ? -1 : 1 };
        break;
    }

    const transactions = await PaymentTransaction.find(query)
      .populate('userId', 'name email phone username isAdmin createdAt')
      .sort(sortField)
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    const config = await TierConfig.getCurrentConfig();
    
    const transformedTransactions = await Promise.all(transactions.map(async (transaction) => {
      let tierInfo = null;
      let tierKey = transaction.tierKey;
      
      if (!tierKey && transaction.packageId) {
        tierKey = transaction.packageId;
      }
      
      if (tierKey && config.tiers.has(tierKey)) {
        const tier = config.tiers.get(tierKey);
        tierInfo = {
          name: tier.name,
          type: tier.type,
          percentPerShare: tier.percentPerShare,
          earningPerPhone: tier.earningPerPhone,
          sharesIncluded: tier.sharesIncluded || 1
        };
      }

      let source = 'direct';
      let franchiseInfo = null;
      
      if (transaction.franchiseId) {
        source = 'franchise';
        const Franchise = require('../models/Franchise');
        const franchise = await Franchise.findById(transaction.franchiseId).select('businessName packageKey');
        if (franchise) {
          franchiseInfo = {
            franchiseId: transaction.franchiseId,
            businessName: franchise.businessName,
            packageKey: franchise.packageKey
          };
        }
      }

      let equivalentRegularShares = transaction.shares || 0;
      let shareToRegularRatio = 1;
      
      if (transaction.type === 'co-founder' || transaction.isCoFounder) {
        shareToRegularRatio = 29;
        equivalentRegularShares = (transaction.shares || 0) * shareToRegularRatio;
      }

      return {
        id: transaction._id,
        transactionId: transaction.transactionId,
        user: {
          id: transaction.userId?._id || transaction.userId,
          name: transaction.userId?.name || 'Unknown User',
          username: transaction.userId?.username || '',
          email: transaction.userId?.email || '',
          phone: transaction.userId?.phone || '',
          registrationDate: transaction.userId?.createdAt,
          isAdmin: transaction.userId?.isAdmin || false
        },
        purchaseDetails: {
          tierKey: tierKey,
          tierName: tierInfo?.name || transaction.packageLabel || 'N/A',
          tierType: tierInfo?.type || transaction.type || 'share',
          percentPerShare: tierInfo?.percentPerShare || transaction.ownershipPct || 0,
          earningPerPhone: tierInfo?.earningPerPhone || transaction.earningKobo || 0,
          sharesInPackage: tierInfo?.sharesIncluded || 1,
          shares: transaction.shares || 1,
          pricePerShare: transaction.pricePerShare || (transaction.amount / (transaction.shares || 1)),
          totalAmount: transaction.amount || 0,
          currency: transaction.currency || 'naira',
          paymentMethod: transaction.paymentMethod,
          status: transaction.status,
          purchaseDate: transaction.createdAt,
          daysSincePurchase: Math.floor((Date.now() - new Date(transaction.createdAt)) / (1000 * 60 * 60 * 24)),
          isCoFounder: transaction.type === 'co-founder' || transaction.isCoFounder || false,
          equivalentRegularShares: equivalentRegularShares,
          shareToRegularRatio: shareToRegularRatio,
          source: source,
          franchiseInfo: franchiseInfo,
          tierBreakdown: transaction.tierBreakdown || {
            tier1: transaction.type === 'co-founder' ? 0 : (transaction.shares || 0),
            tier2: 0,
            tier3: 0
          }
        },
        additionalInfo: {
          adminNote: transaction.adminNotes || '',
          txHash: transaction.transactionHash || transaction.txHash,
          reference: transaction.reference,
          manualPaymentDetails: transaction.manualPaymentDetails || {}
        }
      };
    }));

    const summary = {
      totalAmountNaira: 0,
      totalAmountUSDT: 0,
      totalShares: 0,
      totalCoFounderShares: 0,
      totalRegularShares: 0,
      totalFranchisePurchases: 0,
      totalDirectPurchases: 0,
      uniqueUsers: new Set(),
      byTierType: {
        share: { count: 0, totalAmount: 0, totalShares: 0 },
        'co-founder': { count: 0, totalAmount: 0, totalShares: 0 }
      },
      bySource: {
        direct: { count: 0, totalAmount: 0 },
        franchise: { count: 0, totalAmount: 0 }
      }
    };

    transformedTransactions.forEach(t => {
      const amount = t.purchaseDetails.totalAmount;
      const currency = t.purchaseDetails.currency;
      
      if (currency === 'naira') {
        summary.totalAmountNaira += amount;
      } else if (currency === 'usdt') {
        summary.totalAmountUSDT += amount;
      }
      
      if (t.purchaseDetails.isCoFounder) {
        summary.totalCoFounderShares += t.purchaseDetails.shares;
        summary.byTierType['co-founder'].count++;
        summary.byTierType['co-founder'].totalAmount += amount;
        summary.byTierType['co-founder'].totalShares += t.purchaseDetails.shares;
      } else {
        summary.totalRegularShares += t.purchaseDetails.shares;
        summary.byTierType.share.count++;
        summary.byTierType.share.totalAmount += amount;
        summary.byTierType.share.totalShares += t.purchaseDetails.shares;
      }
      
      summary.totalShares += t.purchaseDetails.shares;
      summary.uniqueUsers.add(t.user.id);
      
      if (t.purchaseDetails.source === 'franchise') {
        summary.totalFranchisePurchases++;
        summary.bySource.franchise.count++;
        summary.bySource.franchise.totalAmount += amount;
      } else {
        summary.totalDirectPurchases++;
        summary.bySource.direct.count++;
        summary.bySource.direct.totalAmount += amount;
      }
    });

    res.status(200).json({
      success: true,
      transactions: transformedTransactions,
      pagination: {
        currentPage: parseInt(page),
        totalPages,
        totalCount,
        limit: parseInt(limit)
      },
      summary: {
        totalAmountNaira: summary.totalAmountNaira,
        totalAmountUSDT: summary.totalAmountUSDT,
        totalShares: summary.totalShares,
        totalRegularShares: summary.totalRegularShares,
        totalCoFounderShares: summary.totalCoFounderShares,
        uniqueInvestors: summary.uniqueUsers.size,
        totalTransactions: transformedTransactions.length,
        franchisePurchases: summary.totalFranchisePurchases,
        directPurchases: summary.totalDirectPurchases,
        byTierType: summary.byTierType,
        bySource: summary.bySource
      },
      filters: {
        startDate: startDate || null,
        endDate: endDate || null,
        status: status
      },
      notes: {
        coFounderShareRatio: "1 Co-Founder Share = 29 Regular Shares",
        earningsNote: "Earnings are calculated per phone per day based on earningPerPhone value",
        ownershipNote: "Ownership percentage is cumulative across all purchases"
      }
    });
    
  } catch (error) {
    console.error('Error in getSharePurchaseReport:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate purchase report',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// ==================== ADMIN USER OVERVIEW ====================
exports.adminGetUserOverview = async (req, res) => {
  try {
    const { identifier } = req.params;
    const adminId = req.user.id;

    const admin = await User.findById(adminId);
    if (!admin || !admin.isAdmin) {
      return res.status(403).json({ success: false, message: 'Unauthorized: Admin access required' });
    }

    const user = await resolveUserIdentifier(identifier);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found', searchedFor: identifier });
    }

    const tierConfig = await TierConfig.getCurrentConfig();

    // ── fetch from both sources, same as getUserProjectStats ─────────────────
    const [allPTxs, userShare] = await Promise.all([
      PaymentTransaction.find({ userId: user._id }).lean(),
      UserShare.findOne({ user: user._id }).lean()
    ]);

    // Deduplicate: legacy = UserShare txs not already in PaymentTransaction
    const ptxIds = new Set(allPTxs.map(t => t.transactionId));
    const legacyTxs = (userShare?.transactions || []).filter(
      t => t.transactionId && !ptxIds.has(t.transactionId)
    );

    // Combine all transactions into one unified list
    const allTxs = [...allPTxs, ...legacyTxs];

    // ── resolveAmount: same logic as getUserProjectStats ─────────────────────
    const resolveAmount = (tx) => {
      let amt = parseFloat(tx.amount ?? tx.totalAmount ?? 0) || 0;
      if (amt === 0 && tx.tierKey) {
        const tier = tierConfig.tiers.get(tx.tierKey);
        if (tier) {
          const currency = (tx.currency || 'naira').toLowerCase();
          const price    = currency === 'usdt' ? tier.priceUSD : tier.priceNGN;
          const shares   = parseFloat(tx.shares) || 1;
          amt = (price || 0) * shares;
        }
      }
      return amt;
    };

    // ── accumulators ──────────────────────────────────────────────────────────
    let totalOwnershipPct = 0, regularOwnershipPct = 0, cofounderOwnershipPct = 0;
    let pendingOwnershipPct = 0;
    let totalEarningKobo = 0, regularEarningKobo = 0, cofounderEarningKobo = 0;
    let regularCount = 0, cofounderCount = 0;
    let completedCount = 0, pendingCount = 0;
    let totalSpentNaira = 0, totalSpentUSDT = 0;
    let completedNaira = 0, completedUSDT = 0;
    let pendingNaira = 0, pendingUSDT = 0;

    for (const tx of allTxs) {
      const isCofounder = tx.type === 'co-founder' ||
                          tx.paymentMethod === 'co-founder';
      const status   = tx.status;
      const pct      = parseFloat(tx.ownershipPct) || 0;
      const earn     = parseFloat(tx.earningKobo)  || 0;
      const amt      = resolveAmount(tx);
      const currency = (tx.currency || 'naira').toLowerCase();

      // Always count money committed
      if (currency === 'naira') totalSpentNaira += amt;
      else if (currency === 'usdt') totalSpentUSDT += amt;

      if (status === 'completed') {
        completedCount++;
        totalOwnershipPct  += pct;
        totalEarningKobo   += earn;

        if (currency === 'naira') completedNaira += amt;
        else if (currency === 'usdt') completedUSDT += amt;

        if (isCofounder) {
          cofounderCount++;
          cofounderOwnershipPct += pct;
          cofounderEarningKobo  += earn;
        } else {
          regularCount++;
          regularOwnershipPct += pct;
          regularEarningKobo  += earn;
        }

      } else if (status === 'pending') {
        pendingCount++;
        pendingOwnershipPct += pct;

        if (currency === 'naira') pendingNaira += amt;
        else if (currency === 'usdt') pendingUSDT += amt;

        // still count type for pending
        if (isCofounder) cofounderCount++;
        else regularCount++;
      }
      // failed: count nothing
    }

    // ── recent transactions — merge both sources ───────────────────────────
    const recentTransactions = allTxs
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 10)
      .map(t => ({
        transactionId  : t.transactionId,
        type           : t.type,
        tierKey        : t.tierKey,
        packageLabel   : t.packageLabel,
        ownershipPct   : t.ownershipPct,
        earningKobo    : t.earningKobo,
        amount         : resolveAmount(t),
        currency       : t.currency,
        paymentMethod  : (t.paymentMethod || '').replace('manual_', '').replace('admin_override', 'admin'),
        status         : t.status,
        date           : t.createdAt,
        hasPaymentProof: !!t.paymentProofCloudinaryUrl,
        source         : ptxIds.has(t.transactionId) ? 'PaymentTransaction' : 'UserShare'
      }));

    // ── referral lookup (unchanged) ───────────────────────────────────────────
    let referredByUser = null;
    if (user.referralInfo?.codeUsed) {
      referredByUser = await User.findOne({
        userName: { $regex: new RegExp(`^${user.referralInfo.codeUsed}$`, 'i') }
      }).select('_id name userName email phone');
    }
    if (!referredByUser && user.referralInfo?.referredBy) {
      referredByUser = await User.findById(user.referralInfo.referredBy)
        .select('_id name userName email phone');
    }
    if (!referredByUser) {
      const referralTx = await ReferralTransaction.findOne({
        referredUser: user._id,
        status: 'completed'
      }).populate('beneficiary', '_id name userName email phone');
      if (referralTx?.beneficiary) referredByUser = referralTx.beneficiary;
    }

    res.status(200).json({
      success: true,
      user: {
        id              : user._id,
        name            : user.name,
        username        : user.username,
        email           : user.email,
        phone           : user.phone,
        walletAddress   : user.walletAddress,
        isAdmin         : user.isAdmin         || false,
        isEmailVerified : user.isEmailVerified  || false,
        registrationDate: user.createdAt,
        lastLogin       : user.lastLogin
      },
      sharesSummary: {
        totalOwnershipPct,
        formattedOwnershipPct : totalOwnershipPct.toFixed(7) + '%',
        totalEarningKobo,
        formattedEarning      : `₦${(totalEarningKobo / 100).toLocaleString()}`,
        breakdown: {
          regular: {
            count              : regularCount,
            ownershipPct       : +regularOwnershipPct.toFixed(7),
            formattedOwnershipPct: regularOwnershipPct.toFixed(7) + '%',
            earningKobo        : regularEarningKobo,
            formattedEarning   : `₦${(regularEarningKobo / 100).toLocaleString()}`
          },
          cofounder: {
            count              : cofounderCount,
            ownershipPct       : +cofounderOwnershipPct.toFixed(7),
            formattedOwnershipPct: cofounderOwnershipPct.toFixed(7) + '%',
            earningKobo        : cofounderEarningKobo,
            formattedEarning   : `₦${(cofounderEarningKobo / 100).toLocaleString()}`
          }
        },
        pending: {
          count              : pendingCount,
          ownershipPct       : +pendingOwnershipPct.toFixed(7),
          formattedOwnershipPct: pendingOwnershipPct.toFixed(7) + '%'
        }
      },
      financialSummary: {
        // Total money ever submitted (all statuses)
        totalSpentNaira,
        totalSpentUSDT,
        formattedTotalSpent : `₦${totalSpentNaira.toLocaleString()} / $${totalSpentUSDT.toLocaleString()}`,
        // Breakdown by status
        completedNaira,
        completedUSDT,
        pendingNaira,
        pendingUSDT,
        formattedBreakdown  : `₦${completedNaira.toLocaleString()} confirmed + ₦${pendingNaira.toLocaleString()} pending`
      },
      transactions: {
        recent : recentTransactions,
        summary: {
          lastTransaction      : recentTransactions[0]?.date || null,
          totalTransactions    : completedCount + pendingCount,
          completedTransactions: completedCount,
          pendingTransactions  : pendingCount
        }
      },
      referralInfo: {
        hasReferralCode : !!user.referralInfo?.code,
        referralCode    : user.referralInfo?.code    || null,
        codeUsed        : user.referralInfo?.codeUsed || null,
        wasReferred     : !!referredByUser,
        referredBy      : referredByUser ? {
          _id     : referredByUser._id,
          name    : referredByUser.name,
          userName: referredByUser.userName,
          username: referredByUser.userName,
          email   : referredByUser.email,
          phone   : referredByUser.phone || null
        } : null,
        totalReferrals : user.referralInfo?.totalReferrals  || 0,
        activeReferrals: user.referralInfo?.activeReferrals || 0
      },
      searchInfo: {
        searchedBy: identifier,
        resolvedBy: /^[0-9a-fA-F]{24}$/.test(identifier) ? 'id' : 'username/email'
      },
      systemInfo: {
        type       : 'percentage-based',
        explanation: 'All shares are measured by ownership percentage. Each transaction adds ownershipPct% and earningKobo per phone.'
      }
    });

  } catch (error) {
    console.error('Error getting user overview:', error);
    res.status(500).json({ success: false, message: 'Failed to get user overview', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
  }
};

// ==================== EMAIL CERTIFICATE ====================

exports.sendCertificateEmail = async (req, res) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    const { imageBase64, transactionId, fileName } = req.body;

    if (!imageBase64 || !transactionId) {
      return res.status(400).json({ success: false, message: 'Image data and transaction ID are required' });
    }

    const user = await User.findById(req.user.id);
    if (!user || !user.email) {
      return res.status(400).json({ success: false, message: 'User email not found' });
    }

    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    const certFileName = fileName || `AfriMobile-Certificate-${transactionId}.png`;

    const emailSent = await sendEmail({
      email: user.email,
      subject: `Your AfriMobile Share Certificate - ${transactionId}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="text-align: center; margin-bottom: 20px;">
            <h1 style="color: #7c3aed;">AfriMobile</h1>
          </div>
          <h2 style="color: #333;">Your Share Certificate</h2>
          <p>Dear ${user.name || 'Valued Shareholder'},</p>
          <p>Please find your share certificate attached to this email.</p>
          <p><strong>Transaction ID:</strong> ${transactionId}</p>
          <p>Thank you for investing in AfriMobile Technology Limited.</p>
          <br/>
          <p>Best regards,<br/>AfriMobile Team</p>
        </div>
      `,
      attachments: [{
        filename: certFileName,
        content: base64Data,
        encoding: 'base64',
        contentType: 'image/png'
      }]
    });

    if (emailSent) {
      return res.json({ success: true, message: `Certificate sent to ${user.email}` });
    } else {
      return res.status(500).json({ success: false, message: 'Failed to send email' });
    }
  } catch (error) {
    console.error('[SHARES] Certificate email error:', error);
    return res.status(500).json({ success: false, message: 'Failed to send certificate email' });
  }
};

// ==================== CHECK PENDING PAYMENT ====================

exports.checkPendingPayment = async (req, res) => {
  try {
    const userId = req.user.id;

    const pendingPaymentTx = await PaymentTransaction.findOne({
      userId,
      type: 'share',
      paymentMethod: { $regex: '^manual_' },
      status: 'pending'
    });

    if (pendingPaymentTx) {
      return res.status(200).json({
        success: true,
        hasPending: true,
        pendingTransaction: {
          transactionId: pendingPaymentTx.transactionId,
          amount: pendingPaymentTx.amount,
          shares: pendingPaymentTx.shares,
          currency: pendingPaymentTx.currency,
          date: pendingPaymentTx.createdAt,
          status: 'pending'
        }
      });
    }

    const userShares = await UserShare.findOne({
      user: userId,
      'transactions.status': 'pending',
      'transactions.paymentMethod': { $regex: '^manual_' }
    });

    if (userShares) {
      const pendingTx = userShares.transactions.find(t => t.status === 'pending' && t.paymentMethod?.startsWith('manual_'));
      if (pendingTx) {
        return res.status(200).json({
          success: true,
          hasPending: true,
          pendingTransaction: {
            transactionId: pendingTx.transactionId,
            amount: pendingTx.totalAmount,
            shares: pendingTx.shares,
            currency: pendingTx.currency,
            date: pendingTx.createdAt,
            status: 'pending'
          }
        });
      }
    }

    res.status(200).json({ success: true, hasPending: false });
  } catch (error) {
    console.error('Error checking pending payment:', error);
    res.status(500).json({ success: false, message: 'Failed to check pending payment' });
  }
};

// ==================== SUBMIT MANUAL PAYMENT ====================

exports.submitManualPayment = async (req, res) => {
  try {
    const { packageId, currency, paymentMethod, bankName, accountName, reference } = req.body;
    const userId = req.user.id;

    if (!userId) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    if (!req.file || !req.file.path) {
      return res.status(400).json({ success: false, message: 'Payment proof is required' });
    }

    const tierKey = req.body.tierKey || req.body.tier || packageId;
    
    const config = await TierConfig.getCurrentConfig();
    if (!config.tiers.has(tierKey)) {
      return res.status(400).json({ success: false, message: `Invalid tier: ${tierKey}` });
    }
    
    const tierData = config.tiers.get(tierKey);
    if (tierData.type !== 'share' || tierData.active === false) {
      return res.status(400).json({ success: false, message: 'Invalid or inactive tier' });
    }
    
    const priceAmount = currency === 'naira' ? tierData.priceNGN : tierData.priceUSD;
    if (!priceAmount) {
      return res.status(400).json({ success: false, message: `Tier not available in ${currency}` });
    }

    const existing = await PaymentTransaction.findOne({
      userId,
      type: 'share',
      status: 'pending'
    });
    if (existing) {
      return res.status(400).json({
        success: false,
        message: 'You already have a pending payment awaiting approval',
        pendingTransaction: {
          transactionId: existing.transactionId,
          amount: existing.amount,
          packageLabel: existing.packageLabel,
          date: existing.createdAt
        }
      });
    }

    const transactionId = `TXN-${crypto.randomBytes(4).toString('hex').toUpperCase()}-${Date.now().toString().slice(-6)}`;

    const txData = {
      transactionId,
      type: 'share',
      tierKey,
      packageId: tierKey,
      packageLabel: tierData.name,
      ownershipPct: tierData.percentPerShare,
      earningKobo: tierData.earningPerPhone,
      amount: priceAmount,
      currency,
      paymentMethod: `manual_${paymentMethod}`,
      status: 'pending',
      shares: 1,
      manualPaymentDetails: { bankName, accountName, reference },
      paymentProofCloudinaryUrl: req.file.path,
      paymentProofCloudinaryId: req.file.filename,
      paymentProofOriginalName: req.file.originalname,
      paymentProofFileSize: req.file.size
    };

    await PaymentTransaction.create({ userId, ...txData });
    await UserShare.addTransaction(userId, txData);

    const user = await User.findById(userId);
    const admins = await User.find({ isAdmin: true, email: { $exists: true } });
    for (const admin of admins) {
      await sendEmail({
        email: admin.email,
        subject: 'New Share Payment Submitted',
        html: `
          <h2>New Manual Payment Requires Review</h2>
          <p><strong>User:</strong> ${user?.name} (${user?.email})</p>
          <p><strong>Transaction ID:</strong> ${transactionId}</p>
          <p><strong>Package:</strong> ${tierData.name}</p>
          <p><strong>Amount:</strong> ${currency === 'naira' ? '₦' : '$'}${priceAmount.toLocaleString()}</p>
          <p><strong>Ownership:</strong> ${(tierData.percentPerShare * 100).toFixed(7)}%</p>
        `
      });
    }

    res.json({
      success: true,
      message: 'Payment submitted successfully. Awaiting admin verification.',
      data: {
        transactionId,
        packageLabel: tierData.name,
        ownershipPct: tierData.percentPerShare,
        amount: priceAmount,
        currency,
        status: 'pending'
      }
    });

  } catch (error) {
    console.error('submitManualPayment error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== GET PAYMENT PROOF ====================

exports.getPaymentProof = async (req, res) => {
  try {
    const { transactionId } = req.params;
    const userId = req.user.id;
    
    let cloudinaryUrl = null;
    let cloudinaryId = null;
    let originalName = null;
    let fileSize = null;
    let format = null;

    const user = await User.findById(userId);
    const isAdmin = user && user.isAdmin;

    const paymentTransaction = await PaymentTransaction.findOne({
      transactionId,
      type: 'share'
    });
    
    if (paymentTransaction) {
      cloudinaryUrl = paymentTransaction.paymentProofCloudinaryUrl;
      cloudinaryId = paymentTransaction.paymentProofCloudinaryId;
      originalName = paymentTransaction.paymentProofOriginalName;
      fileSize = paymentTransaction.paymentProofFileSize;
      
      if (!(isAdmin || paymentTransaction.userId.toString() === userId)) {
        return res.status(403).json({ success: false, message: 'Access denied' });
      }
    }

    if (!cloudinaryUrl) {
      const userShareRecord = await UserShare.findOne({
        'transactions.transactionId': transactionId
      });

      if (userShareRecord) {
        const transaction = userShareRecord.transactions.find(
          t => t.transactionId === transactionId
        );
        
        if (transaction) {
          cloudinaryUrl = transaction.paymentProofCloudinaryUrl;
          cloudinaryId = transaction.paymentProofCloudinaryId;
          originalName = transaction.paymentProofOriginalName;
          fileSize = transaction.paymentProofFileSize;
          format = transaction.paymentProofFormat;
        }
        
        if (!(isAdmin || userShareRecord.user.toString() === userId)) {
          return res.status(403).json({ success: false, message: 'Access denied' });
        }
      }
    }

    if (!cloudinaryUrl) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found or payment proof not available'
      });
    }

    if (req.query.redirect === 'true' || req.headers.accept?.includes('text/html')) {
      return res.redirect(cloudinaryUrl);
    }

    res.status(200).json({
      success: true,
      cloudinaryUrl: cloudinaryUrl,
      publicId: cloudinaryId,
      originalName: originalName,
      fileSize: fileSize,
      format: format,
      directAccess: "You can access this file directly at the cloudinaryUrl"
    });
    
  } catch (error) {
    console.error(`getPaymentProof error: ${error.message}`, error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch payment proof',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

exports.getPaymentProofDirect = async (req, res) => {
  try {
    const { transactionId } = req.params;
    const userId = req.user.id;
    
    const user = await User.findById(userId);
    if (!user || !user.isAdmin) {
      return res.status(403).json({ success: false, message: 'Admin access required' });
    }
    
    let cloudinaryUrl = null;
    
    const paymentTransaction = await PaymentTransaction.findOne({
      transactionId,
      type: 'share'
    });
    
    if (paymentTransaction && paymentTransaction.paymentProofCloudinaryUrl) {
      cloudinaryUrl = paymentTransaction.paymentProofCloudinaryUrl;
    } else {
      const userShareRecord = await UserShare.findOne({
        'transactions.transactionId': transactionId
      });
      
      if (userShareRecord) {
        const transaction = userShareRecord.transactions.find(
          t => t.transactionId === transactionId
        );
        if (transaction && transaction.paymentProofCloudinaryUrl) {
          cloudinaryUrl = transaction.paymentProofCloudinaryUrl;
        }
      }
    }
    
    if (!cloudinaryUrl) {
      return res.status(404).json({ success: false, message: 'Payment proof not found' });
    }
    
    res.redirect(cloudinaryUrl);
    
  } catch (error) {
    console.error('Error in direct payment proof access:', error);
    res.status(500).json({ success: false, message: 'Failed to access payment proof' });
  }
};

// ==================== ADMIN REVOKE TRANSACTION ====================

exports.adminRevokeTransaction = async (req, res) => {
  try {
    const { transactionId } = req.params;
    const { reason } = req.body;
    const adminId = req.user.id;

    const admin = await User.findById(adminId);
    if (!admin || !admin.isAdmin) {
      return res.status(403).json({ success: false, message: 'Unauthorized: Admin access required' });
    }

    if (!transactionId) {
      return res.status(400).json({ success: false, message: 'Transaction ID is required' });
    }

    const paymentTransaction = await PaymentTransaction.findOne({ transactionId });
    const userShareRecord = await UserShare.findOne({ 'transactions.transactionId': transactionId });

    if (!paymentTransaction && !userShareRecord) {
      return res.status(404).json({ success: false, message: 'Transaction not found' });
    }

    let transactionDetails = {};
    let userId = null;

    if (paymentTransaction) {
      transactionDetails = {
        shares: paymentTransaction.shares,
        amount: paymentTransaction.amount,
        currency: paymentTransaction.currency,
        status: paymentTransaction.status,
        tierBreakdown: paymentTransaction.tierBreakdown,
      };
      userId = paymentTransaction.userId;
    }

    if (userShareRecord) {
      const tx = userShareRecord.transactions.find(t => t.transactionId === transactionId);
      if (tx && !transactionDetails.shares) {
        transactionDetails = {
          shares: tx.shares,
          amount: tx.totalAmount,
          currency: tx.currency,
          status: tx.status,
          tierBreakdown: tx.tierBreakdown,
        };
        userId = userShareRecord.user;
      }
    }

    if (transactionDetails.status === 'completed') {
      try {
        await rollbackReferralCommission(userId, transactionId, transactionDetails.amount, transactionDetails.currency, 'share', 'UserShare');
      } catch (e) {
        console.error('Referral rollback error:', e);
      }
    }

    if (paymentTransaction) {
      if (paymentTransaction.paymentProofCloudinaryId) {
        try { await deleteFromCloudinary(paymentTransaction.paymentProofCloudinaryId); } catch (e) { console.error('Cloudinary delete error:', e); }
      }
      await PaymentTransaction.deleteOne({ _id: paymentTransaction._id });
    }

    if (userShareRecord) {
      userShareRecord.transactions = userShareRecord.transactions.filter(t => t.transactionId !== transactionId);
      await userShareRecord.save();
    }

    if (userId) {
      const user = await User.findById(userId);
      if (user && user.email) {
        try {
          await sendEmail({
            email: user.email,
            subject: 'AfriMobile - Transaction Revoked',
            html: `
              <h2>Transaction Revocation Notice</h2>
              <p>Dear ${user.name},</p>
              <p>Your transaction <strong>${transactionId}</strong> has been revoked by an administrator.</p>
              <p>Shares: ${transactionDetails.shares || 0}</p>
              <p>Amount: ${transactionDetails.currency === 'naira' ? '₦' : '$'}${transactionDetails.amount || 0}</p>
              ${reason ? `<p>Reason: ${reason}</p>` : ''}
              <p>If you have questions, please contact support.</p>
            `
          });
        } catch (e) { console.error('Email error:', e); }
      }
    }

    res.status(200).json({
      success: true,
      message: 'Transaction revoked successfully. Shares and commissions rolled back.',
      data: { transactionId, ...transactionDetails }
    });
  } catch (error) {
    console.error('Error revoking transaction:', error);
    res.status(500).json({ success: false, message: 'Failed to revoke transaction' });
  }
};

// ==================== ADMIN EDIT TRANSACTION ====================

exports.adminEditTransaction = async (req, res) => {
  try {
    const admin = await User.findById(req.user.id);
    if (!admin || !admin.isAdmin) return res.status(403).json({ success: false, message: 'Admin required' });

    const { transactionId } = req.params;
    const { status, shares, adminNote, type } = req.body;

    let updated = false;

    const paymentTx = await PaymentTransaction.findOne({ transactionId });
    if (paymentTx) {
      if (status) paymentTx.status = status;
      if (shares) paymentTx.shares = parseInt(shares);
      if (adminNote) paymentTx.adminNotes = adminNote;
      if (type) paymentTx.type = type;
      paymentTx.verifiedBy = req.user.id;
      paymentTx.verifiedAt = new Date();
      await paymentTx.save();
      updated = true;
    }

    const userShare = await UserShare.findOne({ 'transactions.transactionId': transactionId });
    if (userShare) {
      const tx = userShare.transactions.find(t => t.transactionId === transactionId);
      if (tx) {
        if (status) tx.status = status;
        if (shares) tx.shares = parseInt(shares);
        if (adminNote) tx.adminNote = adminNote;
        await userShare.save();
        updated = true;
      }
    }

    if (!updated) return res.status(404).json({ success: false, message: 'Transaction not found' });

    res.status(200).json({ success: true, message: 'Transaction updated successfully', transactionId });
  } catch (error) {
    console.error('Error editing transaction:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== ADMIN UPDATE USER SHARES ====================

exports.adminUpdateUserShares = async (req, res) => {
  try {
    const admin = await User.findById(req.user.id);
    if (!admin || !admin.isAdmin) return res.status(403).json({ success: false, message: 'Admin required' });

    const { userId } = req.params;
    const { ownershipPct, earningKobo, adminNote } = req.body;

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    let userShare = await UserShare.findOne({ user: userId });
    if (!userShare) userShare = new UserShare({ user: userId, transactions: [], totalOwnershipPct: 0, totalEarningKobo: 0 });

    const transactionId = 'ADM-' + crypto.randomBytes(4).toString('hex').toUpperCase() + '-' + Date.now().toString().slice(-6);

    userShare.totalOwnershipPct = (userShare.totalOwnershipPct || 0) + (ownershipPct || 0);
    userShare.totalEarningKobo = (userShare.totalEarningKobo || 0) + (earningKobo || 0);
    userShare.transactions.push({
      transactionId,
      ownershipPct: ownershipPct || 0,
      earningKobo: earningKobo || 0,
      currency: 'naira',
      totalAmount: 0,
      paymentMethod: 'admin_override',
      status: 'completed',
      adminAction: true,
      adminNote: adminNote || 'Direct share ownership override by admin',
    });

    await userShare.save();
    res.status(200).json({ success: true, message: 'User shares updated successfully', userId, ownershipPct, earningKobo });
  } catch (error) {
    console.error('Error updating user shares:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};
/**
 * @desc    Get detailed transaction information
 * @route   GET /api/shares/transactions/:transactionId/details
 * @access  Private (User/Admin)
 */
exports.getTransactionDetails = async (req, res) => {
  try {
    const { transactionId } = req.params;
    const userId = req.user.id;
    
    // Check if user is admin
    const user = await User.findById(userId);
    const isAdmin = user && user.isAdmin;
    
    // Find transaction in PaymentTransaction
    const paymentTransaction = await PaymentTransaction.findOne({
      transactionId,
      type: 'share'
    }).populate('userId', 'name email phone username walletAddress');
    
    // Find in UserShare as fallback
    const userShareRecord = await UserShare.findOne({
      'transactions.transactionId': transactionId
    }).populate('user', 'name email phone username walletAddress');
    
    let transactionData = null;
    
    if (paymentTransaction) {
      // Check ownership
      if (!isAdmin && paymentTransaction.userId._id.toString() !== userId) {
        return res.status(403).json({
          success: false,
          message: 'Access denied'
        });
      }
      
      transactionData = {
        transactionId: paymentTransaction.transactionId,
        user: {
          id: paymentTransaction.userId._id,
          name: paymentTransaction.userId.name,
          email: paymentTransaction.userId.email,
          phone: paymentTransaction.userId.phone,
          username: paymentTransaction.userId.username,
          walletAddress: paymentTransaction.userId.walletAddress
        },
        shares: paymentTransaction.shares,
        pricePerShare: paymentTransaction.pricePerShare || (paymentTransaction.amount / (paymentTransaction.shares || 1)),
        totalAmount: paymentTransaction.amount,
        currency: paymentTransaction.currency,
        paymentMethod: paymentTransaction.paymentMethod,
        status: paymentTransaction.status,
        createdAt: paymentTransaction.createdAt,
        updatedAt: paymentTransaction.updatedAt,
        tierKey: paymentTransaction.tierKey,
        packageLabel: paymentTransaction.packageLabel,
        ownershipPct: paymentTransaction.ownershipPct,
        earningKobo: paymentTransaction.earningKobo,
        tierBreakdown: paymentTransaction.tierBreakdown,
        manualPaymentDetails: paymentTransaction.manualPaymentDetails,
        adminNote: paymentTransaction.adminNotes,
        source: 'PaymentTransaction'
      };
      
      // Add payment proof if available
      if (paymentTransaction.paymentProofCloudinaryUrl) {
        transactionData.paymentProof = {
          cloudinaryUrl: paymentTransaction.paymentProofCloudinaryUrl,
          originalName: paymentTransaction.paymentProofOriginalName,
          fileSize: paymentTransaction.paymentProofFileSize
        };
      }
      
      // Add crypto details if applicable
      if (paymentTransaction.paymentMethod === 'web3' || paymentTransaction.paymentMethod === 'crypto') {
        transactionData.crypto = {
          fromWallet: paymentTransaction.fromWallet,
          toWallet: paymentTransaction.toWallet,
          txHash: paymentTransaction.txHash
        };
      }
      
    } else if (userShareRecord) {
      const transaction = userShareRecord.transactions.find(
        t => t.transactionId === transactionId
      );
      
      if (transaction) {
        // Check ownership
        if (!isAdmin && userShareRecord.user._id.toString() !== userId) {
          return res.status(403).json({
            success: false,
            message: 'Access denied'
          });
        }
        
        transactionData = {
          transactionId: transaction.transactionId,
          user: {
            id: userShareRecord.user._id,
            name: userShareRecord.user.name,
            email: userShareRecord.user.email,
            phone: userShareRecord.user.phone,
            username: userShareRecord.user.username,
            walletAddress: userShareRecord.user.walletAddress
          },
          shares: transaction.shares,
          pricePerShare: transaction.pricePerShare,
          totalAmount: transaction.totalAmount,
          currency: transaction.currency,
          paymentMethod: transaction.paymentMethod,
          status: transaction.status,
          createdAt: transaction.createdAt,
          updatedAt: transaction.updatedAt || transaction.createdAt,
          tierKey: transaction.tierKey,
          packageLabel: transaction.packageLabel,
          ownershipPct: transaction.ownershipPct,
          earningKobo: transaction.earningKobo,
          tierBreakdown: transaction.tierBreakdown,
          adminNote: transaction.adminNote,
          source: 'UserShare'
        };
        
        // Add payment proof if available
        if (transaction.paymentProofCloudinaryUrl) {
          transactionData.paymentProof = {
            cloudinaryUrl: transaction.paymentProofCloudinaryUrl,
            originalName: transaction.paymentProofOriginalName,
            fileSize: transaction.paymentProofFileSize
          };
        }
      }
    }
    
    if (!transactionData) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found'
      });
    }
    
    res.status(200).json({
      success: true,
      transaction: transactionData
    });
    
  } catch (error) {
    console.error('Error getting transaction details:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get transaction details',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Get transaction status
 * @route   GET /api/shares/transactions/:transactionId/status
 * @access  Private (User/Admin)
 */
exports.getTransactionStatus = async (req, res) => {
  try {
    const { transactionId } = req.params;
    const userId = req.user.id;
    
    const user = await User.findById(userId);
    const isAdmin = user && user.isAdmin;
    
    // Check PaymentTransaction
    const paymentTransaction = await PaymentTransaction.findOne({
      transactionId,
      type: 'share'
    });
    
    let transaction = null;
    
    if (paymentTransaction) {
      if (!isAdmin && paymentTransaction.userId.toString() !== userId) {
        return res.status(403).json({
          success: false,
          message: 'Access denied'
        });
      }
      
      transaction = {
        transactionId: paymentTransaction.transactionId,
        status: paymentTransaction.status,
        shares: paymentTransaction.shares,
        totalAmount: paymentTransaction.amount,
        currency: paymentTransaction.currency,
        paymentMethod: paymentTransaction.paymentMethod,
        createdAt: paymentTransaction.createdAt,
        updatedAt: paymentTransaction.updatedAt
      };
    } else {
      // Check UserShare
      const userShareRecord = await UserShare.findOne({
        'transactions.transactionId': transactionId
      });
      
      if (userShareRecord) {
        if (!isAdmin && userShareRecord.user.toString() !== userId) {
          return res.status(403).json({
            success: false,
            message: 'Access denied'
          });
        }
        
        const userTransaction = userShareRecord.transactions.find(
          t => t.transactionId === transactionId
        );
        
        if (userTransaction) {
          transaction = {
            transactionId: userTransaction.transactionId,
            status: userTransaction.status,
            shares: userTransaction.shares,
            totalAmount: userTransaction.totalAmount,
            currency: userTransaction.currency,
            paymentMethod: userTransaction.paymentMethod,
            createdAt: userTransaction.createdAt,
            updatedAt: userTransaction.updatedAt || userTransaction.createdAt
          };
        }
      }
    }
    
    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found'
      });
    }
    
    res.status(200).json({
      success: true,
      transaction
    });
    
  } catch (error) {
    console.error('Error getting transaction status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get transaction status',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Get share purchase report with date range filtering
 * @route   GET /api/shares/admin/purchase-report
 * @access  Private (Admin)
 */
exports.getSharePurchaseReport = async (req, res) => {
  try {
    const {
      startDate,
      endDate,
      status = 'completed',
      page = 1,
      limit = 50,
      sortBy = 'date',
      sortOrder = 'desc'
    } = req.query;

    // Validate admin
    const admin = await User.findById(req.user.id);
    if (!admin || !admin.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized: Admin access required'
      });
    }

    // Build date filter
    const dateFilter = {};
    if (startDate) {
      const start = new Date(startDate);
      if (isNaN(start.getTime())) {
        return res.status(400).json({ success: false, message: 'Invalid startDate format' });
      }
      dateFilter.$gte = start;
    }
    if (endDate) {
      const end = new Date(endDate);
      if (isNaN(end.getTime())) {
        return res.status(400).json({ success: false, message: 'Invalid endDate format' });
      }
      end.setHours(23, 59, 59, 999);
      dateFilter.$lte = end;
    }

    // Build query
    const query = {
      status: status,
      ...(Object.keys(dateFilter).length > 0 && { createdAt: dateFilter })
    };

    // Get total count
    const totalCount = await PaymentTransaction.countDocuments(query);
    const totalPages = Math.ceil(totalCount / limit);
    const skip = (page - 1) * limit;

    // Determine sort order
    let sortField = {};
    switch (sortBy) {
      case 'amount':
        sortField = { amount: sortOrder === 'desc' ? -1 : 1 };
        break;
      case 'shares':
        sortField = { shares: sortOrder === 'desc' ? -1 : 1 };
        break;
      case 'name':
        sortField = { 'userId.name': sortOrder === 'desc' ? -1 : 1 };
        break;
      default:
        sortField = { createdAt: sortOrder === 'desc' ? -1 : 1 };
        break;
    }

    // Fetch transactions
    const transactions = await PaymentTransaction.find(query)
      .populate('userId', 'name email phone username')
      .sort(sortField)
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    // Get TierConfig for tier information
    const TierConfig = require('../models/TierConfig');
    const config = await TierConfig.getCurrentConfig();

    // Transform transactions
    const transformedTransactions = transactions.map(transaction => {
      let tierInfo = null;
      const tierKey = transaction.tierKey || transaction.packageId;
      
      if (tierKey && config.tiers.has(tierKey)) {
        const tier = config.tiers.get(tierKey);
        tierInfo = {
          name: tier.name,
          type: tier.type,
          percentPerShare: tier.percentPerShare,
          earningPerPhone: tier.earningPerPhone,
          sharesIncluded: tier.sharesIncluded || 1
        };
      }

      return {
        id: transaction._id,
        transactionId: transaction.transactionId,
        user: {
          id: transaction.userId?._id || transaction.userId,
          name: transaction.userId?.name || 'Unknown User',
          email: transaction.userId?.email || '',
          phone: transaction.userId?.phone || ''
        },
        purchaseDetails: {
          tierKey: tierKey,
          tierName: tierInfo?.name || transaction.packageLabel || 'N/A',
          tierType: tierInfo?.type || 'share',
          percentPerShare: tierInfo?.percentPerShare || transaction.ownershipPct || 0,
          earningPerPhone: tierInfo?.earningPerPhone || transaction.earningKobo || 0,
          sharesInPackage: tierInfo?.sharesIncluded || 1,
          shares: transaction.shares || 1,
          pricePerShare: transaction.pricePerShare || (transaction.amount / (transaction.shares || 1)),
          totalAmount: transaction.amount || 0,
          currency: transaction.currency || 'naira',
          paymentMethod: transaction.paymentMethod?.replace('manual_', ''),
          status: transaction.status,
          purchaseDate: transaction.createdAt,
          daysSincePurchase: Math.floor((Date.now() - new Date(transaction.createdAt)) / (1000 * 60 * 60 * 24)),
          isCoFounder: transaction.type === 'co-founder' || false,
          source: transaction.franchiseId ? 'franchise' : 'direct'
        },
        additionalInfo: {
          adminNote: transaction.adminNotes || '',
          txHash: transaction.txHash,
          reference: transaction.reference,
          manualPaymentDetails: transaction.manualPaymentDetails || {}
        }
      };
    });

    // Calculate summary
    const summary = {
      totalAmountNaira: 0,
      totalAmountUSDT: 0,
      totalShares: 0,
      totalRegularShares: 0,
      totalCoFounderShares: 0,
      uniqueUsers: new Set(),
      totalTransactions: transformedTransactions.length
    };

    transformedTransactions.forEach(t => {
      const amount = t.purchaseDetails.totalAmount;
      const currency = t.purchaseDetails.currency;
      
      if (currency === 'naira') {
        summary.totalAmountNaira += amount;
      } else if (currency === 'usdt') {
        summary.totalAmountUSDT += amount;
      }
      
      summary.totalShares += t.purchaseDetails.shares;
      if (t.purchaseDetails.isCoFounder) {
        summary.totalCoFounderShares += t.purchaseDetails.shares;
      } else {
        summary.totalRegularShares += t.purchaseDetails.shares;
      }
      summary.uniqueUsers.add(t.user.id);
    });

    res.status(200).json({
      success: true,
      transactions: transformedTransactions,
      pagination: {
        currentPage: parseInt(page),
        totalPages,
        totalCount,
        limit: parseInt(limit)
      },
      summary: {
        totalAmountNaira: summary.totalAmountNaira,
        totalAmountUSDT: summary.totalAmountUSDT,
        totalShares: summary.totalShares,
        totalRegularShares: summary.totalRegularShares,
        totalCoFounderShares: summary.totalCoFounderShares,
        uniqueInvestors: summary.uniqueUsers.size,
        totalTransactions: summary.totalTransactions
      },
      filters: {
        startDate: startDate || null,
        endDate: endDate || null,
        status: status
      }
    });
    
  } catch (error) {
    console.error('Error in getSharePurchaseReport:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate purchase report',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};