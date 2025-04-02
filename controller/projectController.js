// controller/projectController.js

// Get overall project statistics
exports.getProjectStats = async (req, res) => {
  try {
    // Get share data
    const shareConfig = await Share.getCurrentConfig();
    const cofounderShareConfig = await CofounderShare.getCurrentConfig();
    
    // Get user counts
    const totalUsers = await User.countDocuments();
    const shareHolders = await UserShare.countDocuments({ totalShares: { $gt: 0 } });
    const cofounderHolders = await UserCofounderShare.countDocuments({ totalShares: { $gt: 0 } });
    
    // Calculate totals
    const totalSharesSold = shareConfig.sharesSold;
    const totalCofounderSharesSold = cofounderShareConfig.sharesSold;
    const totalSharesAvailable = shareConfig.totalShares - shareConfig.sharesSold;
    const totalCofounderSharesAvailable = cofounderShareConfig.totalShares - cofounderShareConfig.sharesSold;
    
    res.status(200).json({
      success: true,
      stats: {
        users: {
          total: totalUsers,
          shareHolders,
          cofounderHolders
        },
        shares: {
          sold: totalSharesSold,
          available: totalSharesAvailable,
          total: shareConfig.totalShares
        },
        cofounderShares: {
          sold: totalCofounderSharesSold,
          available: totalCofounderSharesAvailable,
          total: cofounderShareConfig.totalShares
        },
        totalValueNaira: shareConfig.totalValueNaira + cofounderShareConfig.totalValueNaira,
        totalValueUSDT: shareConfig.totalValueUSDT + cofounderShareConfig.totalValueUSDT
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
    const userCofounderShares = await UserCofounderShare.findOne({ user: userId }) || { totalShares: 0 };
    
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
        cofounderShares: userCofounderShares.totalShares,
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