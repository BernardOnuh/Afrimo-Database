// controller/leaderboardController.js
const User = require('../models/User');
const Referral = require('../models/Referral');
const ReferralTransaction = require('../models/ReferralTransaction');

// Helper function to get leaderboard with filter
const getFilteredLeaderboard = async (filter, limit = 10) => {
    // Default sort is by registration date
    let sortField = { createdAt: -1 };
    let matchCriteria = {};
    
    switch (filter) {
      case 'referrals':
        sortField = { referralCount: -1 };
        matchCriteria = { referralCount: { $gt: 0 } };
        break;
      case 'spending':
        sortField = { totalSpent: -1 };
        matchCriteria = { totalSpent: { $gt: 0 } };
        break;
      case 'cofounder':
        sortField = { 'cofounderShares.totalShares': -1 };
        matchCriteria = { 'cofounderShares.totalShares': { $gt: 0 } };
        break;
      default:
        // Registration (default)
        sortField = { createdAt: -1 };
    }
    
    // Aggregate to join user data with their shares, referrals, and referral earnings
    const leaderboard = await User.aggregate([
      {
        $lookup: {
          from: 'usershares',
          localField: '_id',
          foreignField: 'user',
          as: 'shares'
        }
      },
      {
        $lookup: {
          from: 'usercofounderShares',
          localField: '_id',
          foreignField: 'user',
          as: 'cofounderShares'
        }
      },
      {
        $lookup: {
          from: 'referrals',
          localField: '_id',
          foreignField: 'user',
          as: 'referralData'
        }
      },
      {
        $lookup: {
          from: 'referraltransactions',
          localField: '_id',
          foreignField: 'beneficiary',
          as: 'referralTransactions'
        }
      },
      {
        $addFields: {
          totalShares: { $sum: '$shares.totalShares' },
          totalCofounderShares: { $sum: '$cofounderShares.totalShares' },
          referralCount: { $sum: '$referralData.referredUsers' },
          referralEarnings: { $sum: '$referralTransactions.amount' },
          totalSpent: { 
            $sum: [
              { $sum: '$shares.transactions.totalAmount' },
              { $sum: '$cofounderShares.transactions.totalAmount' }
            ]
          }
        }
      },
      { $match: matchCriteria },
      { $sort: sortField },
      { $limit: limit },
      {
        $project: {
          _id: 1,
          name: 1,
          userName: 1,
          totalShares: 1,
          totalCofounderShares: 1,
          referralCount: 1,
          referralEarnings: 1,
          totalSpent: 1,
          createdAt: 1
        }
      }
    ]);
    
    return leaderboard;
  };
  
  // Get registration leaderboard
  exports.getRegistrationLeaderboard = async (req, res) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit) : 10;
      const leaderboard = await getFilteredLeaderboard('registration', limit);
      
      res.status(200).json({
        success: true,
        filter: 'registration',
        leaderboard
      });
    } catch (error) {
      console.error('Error fetching registration leaderboard:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch leaderboard',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  };
  
  // Get referral leaderboard
  exports.getReferralLeaderboard = async (req, res) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit) : 10;
      const leaderboard = await getFilteredLeaderboard('referrals', limit);
      
      res.status(200).json({
        success: true,
        filter: 'referrals',
        leaderboard
      });
    } catch (error) {
      console.error('Error fetching referral leaderboard:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch leaderboard',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  };
  
  // Get spending leaderboard
  exports.getSpendingLeaderboard = async (req, res) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit) : 10;
      const leaderboard = await getFilteredLeaderboard('spending', limit);
      
      res.status(200).json({
        success: true,
        filter: 'spending',
        leaderboard
      });
    } catch (error) {
      console.error('Error fetching spending leaderboard:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch leaderboard',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  };
  
  // Get cofounder leaderboard
  exports.getCofounderLeaderboard = async (req, res) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit) : 10;
      const leaderboard = await getFilteredLeaderboard('cofounder', limit);
      
      res.status(200).json({
        success: true,
        filter: 'cofounder',
        leaderboard
      });
    } catch (error) {
      console.error('Error fetching cofounder leaderboard:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch leaderboard',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  };
  
  // Get comprehensive leaderboard with filter option
  exports.getLeaderboard = async (req, res) => {
    try {
      const filter = req.query.filter || 'registration';
      const limit = req.query.limit ? parseInt(req.query.limit) : 10;
      
      const leaderboard = await getFilteredLeaderboard(filter, limit);
      
      res.status(200).json({
        success: true,
        filter,
        leaderboard
      });
    } catch (error) {
      console.error('Error fetching leaderboard:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch leaderboard',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  };