const User = require('../models/User');
const Referral = require('../models/Referral');
const ReferralTransaction = require('../models/ReferralTransaction');
const SiteConfig = require('../models/SiteConfig');
const { syncReferralStats } = require('../utils/referralUtils');

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
    
    // Sync referral stats if needed (to ensure accuracy)
    if (!referralData || req.query.sync === 'true') {
      const syncResult = await syncReferralStats(userId);
      if (syncResult.success) {
        // If sync was successful, use the latest data
        const refreshedData = await Referral.findOne({ user: userId });
        if (refreshedData) {
          // Format response with synced data
          const response = {
            success: true,
            referralCode,
            referralLink: `${process.env.FRONTEND_URL}/sign-up?ref=${referralCode}`,
            stats: {
              totalReferred: refreshedData.referredUsers,
              totalEarnings: refreshedData.totalEarnings,
              generations: {
                gen1: refreshedData.generation1,
                gen2: refreshedData.generation2,
                gen3: refreshedData.generation3
              }
            }
          };
          
          return res.status(200).json(response);
        }
      }
    }
    
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
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    // Get direct referrals (gen 1)
    const gen1Users = await User.find(
      { 'referralInfo.code': user.userName },
      'name userName email createdAt profileImage'
    );
    
    // Get gen 2 (people referred by your referrals)
    const gen1UserNames = gen1Users.map(user => user.userName);
    const gen2Users = await User.find(
      { 'referralInfo.code': { $in: gen1UserNames } },
      'name userName email referralInfo.code createdAt profileImage'
    );
    
    // Get gen 3 
    const gen2UserNames = gen2Users.map(user => user.userName);
    const gen3Users = await User.find(
      { 'referralInfo.code': { $in: gen2UserNames } },
      'name userName email referralInfo.code createdAt profileImage'
    );
    
    // Track referring relationship more clearly
    const gen2WithReferrer = gen2Users.map(gen2User => {
      // Find which gen1 user referred this gen2 user
      const referredBy = gen1Users.find(gen1User => 
        gen1User.userName === gen2User.referralInfo.code
      );
      
      return {
        ...gen2User.toObject(),
        referredByInfo: referredBy ? {
          id: referredBy._id,
          name: referredBy.name,
          userName: referredBy.userName
        } : null
      };
    });
    
    const gen3WithReferrer = gen3Users.map(gen3User => {
      // Find which gen2 user referred this gen3 user
      const referredBy = gen2Users.find(gen2User => 
        gen2User.userName === gen3User.referralInfo.code
      );
      
      return {
        ...gen3User.toObject(),
        referredByInfo: referredBy ? {
          id: referredBy._id,
          name: referredBy.name,
          userName: referredBy.userName
        } : null
      };
    });
    
    // Structure the tree
    const referralTree = {
      generation1: gen1Users.map(user => ({
        id: user._id,
        name: user.name,
        userName: user.userName,
        email: user.email,
        joinedDate: user.createdAt,
        profileImage: user.profileImage
      })),
      generation2: gen2WithReferrer.map(user => ({
        id: user._id,
        name: user.name,
        userName: user.userName,
        email: user.email,
        referredBy: user.referralInfo.code,
        referredByName: user.referredByInfo?.name,
        joinedDate: user.createdAt,
        profileImage: user.profileImage
      })),
      generation3: gen3WithReferrer.map(user => ({
        id: user._id,
        name: user.name,
        userName: user.userName,
        email: user.email,
        referredBy: user.referralInfo.code,
        referredByName: user.referredByInfo?.name,
        joinedDate: user.createdAt,
        profileImage: user.profileImage
      }))
    };
    
    res.status(200).json({
      success: true,
      referralTree,
      counts: {
        generation1: gen1Users.length,
        generation2: gen2Users.length,
        generation3: gen3Users.length,
        total: gen1Users.length + gen2Users.length + gen3Users.length
      }
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

// Get referral earnings for a user (self or admin view)
const getReferralEarnings = async (req, res) => {
  try {
    let targetUser;
    const isAdminRequest = (req.query.userName || req.query.email) && req.user.isAdmin;
    
    console.log("Request query:", req.query);
    console.log("Is admin request:", isAdminRequest);
    
    // If admin is requesting data for another user
    if (isAdminRequest) {
      // Find user by username or email
      if (req.query.userName) {
        console.log("Searching for userName:", req.query.userName, "Type:", typeof req.query.userName);
        // Debug: Find all usernames to verify what's in the database
        const allUsers = await User.find({}, 'userName email');
        console.log("All usernames in DB:", allUsers.map(u => ({userName: u.userName, email: u.email})));
        
        targetUser = await User.findOne({ userName: req.query.userName });
        console.log("Search result by userName:", targetUser);
      } else if (req.query.email) {
        console.log("Searching for email:", req.query.email);
        targetUser = await User.findOne({ email: req.query.email });
        console.log("Search result by email:", targetUser);
      }
      
      if (!targetUser) {
        console.log("User not found in admin request");
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }
    } else {
      // Regular user requesting their own data
      console.log("Regular user request for:", req.user.id);
      targetUser = await User.findById(req.user.id);
      
      if (!targetUser) {
        console.log("User not found in regular request");
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }
    }
    
    // If trying to access another user's data without being admin
    if (targetUser._id.toString() !== req.user.id && !req.user.isAdmin) {
      console.log("Authorization failure: attempting to access another user's data");
      return res.status(403).json({
        success: false,
        message: 'Not authorized to access this user\'s earnings'
      });
    }
    
    console.log("Target user found:", targetUser.userName, targetUser.email);
    
    // Get referral transactions for the target user
    const referralTransactions = await ReferralTransaction.find({ 
        beneficiary: targetUser._id,
        status: 'completed' // Only include completed transactions
      })
      .populate('referredUser', 'name userName email')
      .sort({ createdAt: -1 });
    
    console.log("Found transactions:", referralTransactions.length);
    
    // Summarize by generation and purchase type
    const summary = {
      generation1: {
        total: 0,
        share: 0,
        cofounder: 0,
        other: 0,
        transactions: 0
      },
      generation2: {
        total: 0,
        share: 0,
        cofounder: 0,
        other: 0,
        transactions: 0
      },
      generation3: {
        total: 0,
        share: 0,
        cofounder: 0,
        other: 0,
        transactions: 0
      },
      total: 0,
      totalTransactions: referralTransactions.length
    };
    
    // Format transactions with additional details
    const formattedTransactions = referralTransactions.map(tx => {
      // Update summary statistics
      const generationKey = `generation${tx.generation}`;
      summary[generationKey].total += tx.amount;
      summary[generationKey][tx.purchaseType || 'other'] += tx.amount;
      summary[generationKey].transactions++;
      summary.total += tx.amount;
      
      return {
        id: tx._id,
        amount: tx.amount,
        currency: tx.currency,
        generation: tx.generation,
        date: tx.createdAt,
        referredUser: {
          id: tx.referredUser?._id || 'Unknown',
          name: tx.referredUser?.name || 'Unknown',
          userName: tx.referredUser?.userName || 'Unknown',
          email: tx.referredUser?.email || 'Unknown'
        },
        purchaseType: tx.purchaseType,
        sourceTransaction: tx.sourceTransaction,
        sourceTransactionModel: tx.sourceTransactionModel,
        status: tx.status
      };
    });
    
    // Get additional referral stats or sync if needed
    let referralStats = await Referral.findOne({ user: targetUser._id });
    console.log("Referral stats found:", !!referralStats);
    
    // Optionally sync stats if requested
    if (req.query.sync === 'true' || !referralStats) {
      console.log("Syncing referral stats");
      const syncResult = await syncReferralStats(targetUser._id);
      if (syncResult.success) {
        referralStats = syncResult.stats;
        console.log("Sync successful");
      }
    }
    
    console.log("Sending response");
    res.status(200).json({
      success: true,
      user: {
        id: targetUser._id,
        userName: targetUser.userName,
        name: targetUser.name,
        email: targetUser.email
      },
      earnings: {
        transactions: formattedTransactions,
        summary,
        stats: referralStats || {
          referredUsers: 0,
          totalEarnings: 0,
          generation1: { count: 0, earnings: 0 },
          generation2: { count: 0, earnings: 0 },
          generation3: { count: 0, earnings: 0 }
        }
      }
    });
  } catch (error) {
    console.error('Error fetching referral earnings:', error);
    console.error('Error stack:', error.stack);
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

// Generate invite link (returns existing referral link)
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

// Admin: Fix or sync referral data for a user
const syncUserReferralData = async (req, res) => {
  try {
    const { userId } = req.params;
    
    // Verify admin
    if (!req.user.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized: Admin access required'
      });
    }
    
    // Find user
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    // Sync referral stats
    const syncResult = await syncReferralStats(userId);
    
    if (!syncResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Failed to sync referral data',
        error: syncResult.message
      });
    }
    
    res.status(200).json({
      success: true,
      message: 'Referral data synced successfully',
      stats: syncResult.stats
    });
  } catch (error) {
    console.error('Error syncing referral data:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to sync referral data',
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
  validateInviteLink,
  syncUserReferralData
};