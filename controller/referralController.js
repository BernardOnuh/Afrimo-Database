// controller/referralController.js
const User = require('../models/User');
const Referral = require('../models/Referral');
const ReferralTransaction = require('../models/ReferralTransaction');
const SiteConfig = require('../models/SiteConfig');

// Get referral statistics
const getReferralStats = async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Get user for referral code
    const user = await User.findById(userId);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    // Referral code is the username
    const referralCode = user.userName;
    
    // Get referral data
    const referralData = await Referral.findOne({ user: userId });
    
    // Format response
    const response = {
      success: true,
      referralCode,
      referralLink: `${process.env.FRONTEND_URL}/sign-up?ref=${referralCode}`,
      stats: {
        totalReferred: 0,
        totalEarnings: 0,
        generations: {
          gen1: { count: 0, earnings: 0 },
          gen2: { count: 0, earnings: 0 },
          gen3: { count: 0, earnings: 0 }
        }
      }
    };
    
    // Add referral data if exists
    if (referralData) {
      response.stats = {
        totalReferred: referralData.referredUsers,
        totalEarnings: referralData.totalEarnings,
        generations: {
          gen1: referralData.generation1,
          gen2: referralData.generation2,
          gen3: referralData.generation3
        }
      };
    }
    
    res.status(200).json(response);
  } catch (error) {
    console.error('Error fetching referral stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch referral statistics',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Validate invite link (username as invite code)
const validateInviteLink = async (req, res) => {
  try {
    const { inviteCode } = req.params;
    
    if (!inviteCode) {
      return res.status(400).json({
        success: false,
        message: 'Invite code is required'
      });
    }
    
    // Find user with this username (invite code)
    const user = await User.findOne({ userName: inviteCode });
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Invalid invite code'
      });
    }
    
    res.status(200).json({
      success: true,
      referrer: {
        name: user.name,
        userName: user.userName,
        id: user._id
      }
    });
  } catch (error) {
    console.error('Error validating invite link:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to validate invite link',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Get referral tree (people you've referred)
const getReferralTree = async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Get the current user's username
    const user = await User.findById(userId);
    
    // Get direct referrals (gen 1)
    const gen1Users = await User.find(
      { 'referralInfo.code': user.userName },
      'name userName email createdAt'
    );
    
    // Get gen 2 (people referred by your referrals)
    const gen1UserNames = gen1Users.map(user => user.userName);
    const gen2Users = await User.find(
      { 'referralInfo.code': { $in: gen1UserNames } },
      'name userName email referralInfo.code createdAt'
    );
    
    // Get gen 3 
    const gen2UserNames = gen2Users.map(user => user.userName);
    const gen3Users = await User.find(
      { 'referralInfo.code': { $in: gen2UserNames } },
      'name userName email referralInfo.code createdAt'
    );
    
    // Structure the tree
    const referralTree = {
      generation1: gen1Users.map(user => ({
        id: user._id,
        name: user.name,
        userName: user.userName,
        email: user.email,
        joinedDate: user.createdAt
      })),
      generation2: gen2Users.map(user => ({
        id: user._id,
        name: user.name,
        userName: user.userName,
        email: user.email,
        referredBy: user.referralInfo.code,
        joinedDate: user.createdAt
      })),
      generation3: gen3Users.map(user => ({
        id: user._id,
        name: user.name,
        userName: user.userName,
        email: user.email,
        referredBy: user.referralInfo.code,
        joinedDate: user.createdAt
      }))
    };
    
    res.status(200).json({
      success: true,
      referralTree
    });
  } catch (error) {
    console.error('Error fetching referral tree:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch referral tree',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Get referral earnings
const getReferralEarnings = async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Get referral transactions
    const referralTransactions = await ReferralTransaction.find({ beneficiary: userId })
      .sort({ createdAt: -1 });
    
    // Format transactions
    const formattedTransactions = referralTransactions.map(tx => ({
      id: tx._id,
      amount: tx.amount,
      currency: tx.currency,
      generation: tx.generation,
      date: tx.createdAt,
      referredUser: tx.referredUser,
      sourceTransaction: tx.sourceTransaction,
      status: tx.status
    }));
    
    res.status(200).json({
      success: true,
      earnings: {
        transactions: formattedTransactions,
        total: formattedTransactions.reduce((sum, tx) => sum + tx.amount, 0)
      }
    });
  } catch (error) {
    console.error('Error fetching referral earnings:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch referral earnings',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Admin route to adjust referral commission settings
const updateReferralSettings = async (req, res) => {
  try {
    const { gen1Commission, gen2Commission, gen3Commission } = req.body;
    
    // Validate input
    if (
      gen1Commission === undefined || 
      gen2Commission === undefined || 
      gen3Commission === undefined
    ) {
      return res.status(400).json({
        success: false,
        message: 'Please provide all commission rates'
      });
    }
    
    // Update site config
    const siteConfig = await SiteConfig.getCurrentConfig();
    
    siteConfig.referralCommission = {
      generation1: parseFloat(gen1Commission),
      generation2: parseFloat(gen2Commission),
      generation3: parseFloat(gen3Commission)
    };
    
    await siteConfig.save();
    
    res.status(200).json({
      success: true,
      message: 'Referral commission rates updated successfully',
      commissionRates: siteConfig.referralCommission
    });
  } catch (error) {
    console.error('Error updating referral settings:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update referral settings',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Generate invite link (now just returns existing referral link)
const generateCustomInviteLink = async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Find the user
    const user = await User.findById(userId);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    res.status(200).json({
      success: true,
      inviteCode: user.userName,
      inviteLink: `${process.env.FRONTEND_URL}/sign-up?ref=${user.userName}`
    });
  } catch (error) {
    console.error('Error generating invite link:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate invite link',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Export all methods
module.exports = {
  getReferralStats,
  getReferralTree,
  getReferralEarnings,
  updateReferralSettings,
  generateCustomInviteLink,
  validateInviteLink
};