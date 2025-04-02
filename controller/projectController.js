// controller/projectController.js

// Add these imports at the top of the file
const Share = require('../models/Share');
const CoFounderShare = require('../models/CoFounderShare');
const User = require('../models/User');
const UserShare = require('../models/UserShare');
const PaymentTransaction = require('../models/Transaction');
const Referral = require('../models/Referral');

// Get overall project statistics
exports.getProjectStats = async (req, res) => {
  try {
    // Get share data
    const shareConfig = await Share.getCurrentConfig();
    const cofounderShareConfig = await CoFounderShare.findOne();
    
    // Get user counts
    const totalUsers = await User.countDocuments();
    const shareHolders = await UserShare.countDocuments({ totalShares: { $gt: 0 } });
    
    // Count co-founder share holders by completed transactions
    const cofounderHolders = await PaymentTransaction.aggregate([
      { 
        $match: { 
          type: 'co-founder', 
          status: 'completed' 
        } 
      },
      {
        $group: {
          _id: '$userId',
          totalShares: { $sum: '$shares' }
        }
      },
      { $count: 'totalHolders' }
    ]);
    
    // Calculate totals
    const totalSharesSold = shareConfig.sharesSold;
    const totalCofounderSharesSold = cofounderShareConfig ? cofounderShareConfig.sharesSold : 0;
    const totalSharesAvailable = shareConfig.totalShares - shareConfig.sharesSold;
    const totalCofounderSharesAvailable = cofounderShareConfig 
      ? cofounderShareConfig.totalShares - cofounderShareConfig.sharesSold 
      : 0;
    
    // Calculate total values (with fallback for undefined values)
    const totalValueNaira = (shareConfig.totalValueNaira || 0) + 
      (cofounderShareConfig ? cofounderShareConfig.pricing.priceNaira * totalCofounderSharesSold : 0);
    const totalValueUSDT = (shareConfig.totalValueUSDT || 0) + 
      (cofounderShareConfig ? cofounderShareConfig.pricing.priceUSDT * totalCofounderSharesSold : 0);
    
    res.status(200).json({
      success: true,
      stats: {
        users: {
          total: totalUsers,
          shareHolders,
          cofounderHolders: cofounderHolders[0]?.totalHolders || 0
        },
        shares: {
          sold: totalSharesSold,
          available: totalSharesAvailable,
          total: shareConfig.totalShares
        },
        cofounderShares: {
          sold: totalCofounderSharesSold,
          available: totalCofounderSharesAvailable,
          total: cofounderShareConfig ? cofounderShareConfig.totalShares : 0
        },
        totalValueNaira,
        totalValueUSDT
      }
    });
  } catch (error) {
    console.error('Error fetching project stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch project statistics',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Get user-specific project statistics
exports.getUserProjectStats = async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Get user's shares
    const userShares = await UserShare.findOne({ user: userId }) || { totalShares: 0 };
    
    // Get user's co-founder shares from transactions
    const userCofounderShares = await PaymentTransaction.aggregate([
      { 
        $match: { 
          userId, 
          type: 'co-founder', 
          status: 'completed' 
        } 
      },
      {
        $group: {
          _id: null,
          totalShares: { $sum: '$shares' }
        }
      }
    ]);
    
    // Get referral stats
    const referralStats = await Referral.findOne({ user: userId }) || { 
      totalEarnings: 0, 
      referredUsers: 0,
      generation1: { count: 0, earnings: 0 },
      generation2: { count: 0, earnings: 0 },
      generation3: { count: 0, earnings: 0 }
    };
    
    res.status(200).json({
      success: true,
      stats: {
        shares: userShares.totalShares,
        cofounderShares: userCofounderShares[0]?.totalShares || 0,
        referrals: {
          totalReferred: referralStats.referredUsers,
          totalEarnings: referralStats.totalEarnings,
          generation1: referralStats.generation1,
          generation2: referralStats.generation2,
          generation3: referralStats.generation3
        }
      }
    });
  } catch (error) {
    console.error('Error fetching user project stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch user project statistics',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};