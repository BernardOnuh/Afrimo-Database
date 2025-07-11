// controller/adminReferralController.js
const User = require('../models/User');
const Referral = require('../models/Referral');
const ReferralTransaction = require('../models/ReferralTransaction');
const SiteConfig = require('../models/SiteConfig');
const UserShare = require('../models/UserShare');
const PaymentTransaction = require('../models/Transaction');
const { sendEmail } = require('../utils/emailService');
const { syncReferralStats, processReferralCommission } = require('../utils/referralUtils');

// Create audit log entry
const createAuditLog = async (adminId, action, targetUserId, details, ipAddress) => {
  try {
    // You might want to create a separate AuditLog model for this
    console.log('AUDIT LOG:', {
      adminId,
      action,
      targetUserId,
      details,
      ipAddress,
      timestamp: new Date()
    });
    
    // For now, we'll just log to console, but in production you'd save this to a database
    // const auditEntry = new AuditLog({
    //   adminId,
    //   action,
    //   targetUserId,
    //   details,
    //   ipAddress,
    //   timestamp: new Date()
    // });
    // await auditEntry.save();
  } catch (error) {
    console.error('Error creating audit log:', error);
  }
};

// Get referral system dashboard overview
const getReferralDashboard = async (req, res) => {
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

    // Get overall statistics
    const totalUsers = await User.countDocuments();
    const activeReferrers = await Referral.countDocuments({ totalEarnings: { $gt: 0 } });
    
    // Get total commissions paid
    const commissionStats = await ReferralTransaction.aggregate([
      { $match: { status: 'completed' } },
      {
        $group: {
          _id: null,
          totalCommissions: { $sum: '$amount' },
          totalTransactions: { $sum: 1 },
          avgCommission: { $avg: '$amount' }
        }
      }
    ]);

    const totalCommissionsPaid = commissionStats[0]?.totalCommissions || 0;
    const totalTransactions = commissionStats[0]?.totalTransactions || 0;
    const avgCommissionPerTransaction = commissionStats[0]?.avgCommission || 0;
    const avgCommissionPerUser = activeReferrers > 0 ? totalCommissionsPaid / activeReferrers : 0;

    // Get generation breakdown
    const generationBreakdown = await ReferralTransaction.aggregate([
      { $match: { status: 'completed' } },
      {
        $group: {
          _id: '$generation',
          totalAmount: { $sum: '$amount' },
          totalTransactions: { $sum: 1 },
          avgAmount: { $avg: '$amount' }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    // Get top performers (top 10)
    const topPerformers = await Referral.find()
      .populate('user', 'name userName email phone createdAt')
      .sort({ totalEarnings: -1 })
      .limit(10);

    // Get recent activity (last 20 transactions)
    const recentActivity = await ReferralTransaction.find({ status: 'completed' })
      .populate('beneficiary', 'name userName email')
      .populate('referredUser', 'name userName email')
      .sort({ createdAt: -1 })
      .limit(20);

    // Format dashboard data
    const dashboard = {
      overview: {
        totalUsers,
        activeReferrers,
        totalCommissionsPaid: Math.round(totalCommissionsPaid * 100) / 100,
        totalTransactions,
        avgCommissionPerUser: Math.round(avgCommissionPerUser * 100) / 100,
        avgCommissionPerTransaction: Math.round(avgCommissionPerTransaction * 100) / 100,
        conversionRate: totalUsers > 0 ? Math.round((activeReferrers / totalUsers) * 100 * 100) / 100 : 0
      },
      topPerformers: topPerformers.map(referral => ({
        id: referral.user._id,
        name: referral.user.name,
        userName: referral.user.userName,
        email: referral.user.email,
        phone: referral.user.phone,
        referralCode: referral.user.userName,
        totalEarnings: referral.totalEarnings,
        totalReferred: referral.referredUsers,
        joinDate: referral.user.createdAt,
        generations: {
          gen1: referral.generation1,
          gen2: referral.generation2,
          gen3: referral.generation3
        }
      })),
      recentActivity: recentActivity.map(transaction => ({
        id: transaction._id,
        beneficiary: {
          id: transaction.beneficiary._id,
          name: transaction.beneficiary.name,
          userName: transaction.beneficiary.userName,
          email: transaction.beneficiary.email
        },
        referredUser: transaction.referredUser ? {
          id: transaction.referredUser._id,
          name: transaction.referredUser.name,
          userName: transaction.referredUser.userName,
          email: transaction.referredUser.email
        } : null,
        amount: transaction.amount,
        currency: transaction.currency,
        generation: transaction.generation,
        purchaseType: transaction.purchaseType,
        createdAt: transaction.createdAt
      })),
      generationBreakdown: {
        generation1: generationBreakdown.find(g => g._id === 1) || { totalAmount: 0, totalTransactions: 0, avgAmount: 0 },
        generation2: generationBreakdown.find(g => g._id === 2) || { totalAmount: 0, totalTransactions: 0, avgAmount: 0 },
        generation3: generationBreakdown.find(g => g._id === 3) || { totalAmount: 0, totalTransactions: 0, avgAmount: 0 }
      }
    };

    res.status(200).json({
      success: true,
      dashboard
    });

  } catch (error) {
    console.error('Error getting referral dashboard:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get referral dashboard',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Get all users with referral data
const getAllUsersWithReferralData = async (req, res) => {
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

    const { 
      page = 1, 
      limit = 20, 
      search = '', 
      sortBy = 'totalEarnings', 
      sortOrder = 'desc',
      minEarnings,
      hasReferrals
    } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Build search query
    let userQuery = {};
    if (search) {
      userQuery = {
        $or: [
          { name: { $regex: search, $options: 'i' } },
          { email: { $regex: search, $options: 'i' } },
          { userName: { $regex: search, $options: 'i' } }
        ]
      };
    }

    // Get users with optional filters
    const users = await User.find(userQuery)
      .select('name userName email phone createdAt')
      .lean();

    // Get referral data for these users
    const userIds = users.map(user => user._id);
    const referralData = await Referral.find({ user: { $in: userIds } }).lean();
    
    // Create a map for quick lookup
    const referralMap = new Map();
    referralData.forEach(ref => {
      referralMap.set(ref.user.toString(), ref);
    });

    // Combine user and referral data
    let combinedData = users.map(user => {
      const referral = referralMap.get(user._id.toString()) || {
        totalEarnings: 0,
        referredUsers: 0,
        generation1: { count: 0, earnings: 0 },
        generation2: { count: 0, earnings: 0 },
        generation3: { count: 0, earnings: 0 }
      };

      return {
        id: user._id,
        name: user.name,
        userName: user.userName,
        email: user.email,
        phone: user.phone,
        referralCode: user.userName,
        totalEarnings: referral.totalEarnings || 0,
        totalReferred: referral.referredUsers || 0,
        joinDate: user.createdAt,
        lastActivity: referral.updatedAt || user.createdAt,
        status: 'active', // You might want to add a status field to users
        generations: {
          gen1: referral.generation1,
          gen2: referral.generation2,
          gen3: referral.generation3
        }
      };
    });

    // Apply filters
    if (minEarnings) {
      combinedData = combinedData.filter(user => user.totalEarnings >= parseFloat(minEarnings));
    }

    if (hasReferrals !== undefined) {
      const hasReferralsBool = hasReferrals === 'true';
      combinedData = combinedData.filter(user => 
        hasReferralsBool ? user.totalReferred > 0 : user.totalReferred === 0
      );
    }

    // Sort data
    combinedData.sort((a, b) => {
      let aValue = a[sortBy];
      let bValue = b[sortBy];

      if (sortBy === 'joinDate' || sortBy === 'lastActivity') {
        aValue = new Date(aValue);
        bValue = new Date(bValue);
      }

      if (sortOrder === 'desc') {
        return bValue > aValue ? 1 : -1;
      } else {
        return aValue > bValue ? 1 : -1;
      }
    });

    // Apply pagination
    const totalCount = combinedData.length;
    const paginatedData = combinedData.slice(skip, skip + parseInt(limit));

    res.status(200).json({
      success: true,
      users: paginatedData,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalCount / parseInt(limit)),
        totalCount,
        hasNext: parseInt(page) < Math.ceil(totalCount / parseInt(limit)),
        hasPrev: parseInt(page) > 1
      }
    });

  } catch (error) {
    console.error('Error getting users with referral data:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get users with referral data',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Get detailed referral data for a specific user
const getUserReferralDetails = async (req, res) => {
    try {
      const adminId = req.user.id;
      const { userId } = req.params;
      
      // Handle the new query parameters gracefully
      const { 
        transactionPage = 1, 
        transactionLimit = 20,  // Use smaller default for now
        transactionSort = 'createdAt',
        transactionOrder = 'desc',
        transactionStatus = '',
        transactionGeneration = ''
      } = req.query;
      
      // Verify admin
      const admin = await User.findById(adminId);
      if (!admin || !admin.isAdmin) {
        return res.status(403).json({
          success: false,
          message: 'Unauthorized: Admin access required'
        });
      }
  
      // Get user
      const user = await User.findById(userId).select('name userName email phone createdAt');
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }
  
      // Get referral data
      const referralData = await Referral.findOne({ user: userId });
      
      // Build transaction filter
      let transactionFilter = { beneficiary: userId };
      if (transactionStatus) {
        transactionFilter.status = transactionStatus;
      }
      if (transactionGeneration) {
        transactionFilter.generation = parseInt(transactionGeneration);
      }
  
      // Get transactions with basic pagination
      const skip = (parseInt(transactionPage) - 1) * parseInt(transactionLimit);
      const sortOrder = transactionOrder === 'desc' ? -1 : 1;
      const sortObj = { [transactionSort]: sortOrder };
  
      const transactions = await ReferralTransaction.find(transactionFilter)
        .populate('referredUser', 'name userName email')
        .sort(sortObj)
        .skip(skip)
        .limit(parseInt(transactionLimit));
  
      // Get total count for pagination
      const totalTransactions = await ReferralTransaction.countDocuments(transactionFilter);
      const totalPages = Math.ceil(totalTransactions / parseInt(transactionLimit));
  
      // Get referral tree (simplified version)
      const gen1Users = await User.find(
        { 'referralInfo.code': user.userName },
        'name userName email createdAt'
      );
  
      const gen1UserNames = gen1Users.map(u => u.userName);
      const gen2Users = await User.find(
        { 'referralInfo.code': { $in: gen1UserNames } },
        'name userName email referralInfo.code createdAt'
      );
  
      const gen2UserNames = gen2Users.map(u => u.userName);
      const gen3Users = await User.find(
        { 'referralInfo.code': { $in: gen2UserNames } },
        'name userName email referralInfo.code createdAt'
      );
  
      // Calculate earnings summary
      const now = new Date();
      const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const thisYear = new Date(now.getFullYear(), 0, 1);
  
      const allCompletedTransactions = await ReferralTransaction.find({
        beneficiary: userId,
        status: 'completed'
      });
  
      const earningsThisMonth = allCompletedTransactions
        .filter(t => new Date(t.createdAt) >= thisMonth)
        .reduce((sum, t) => sum + t.amount, 0);
  
      const earningsThisYear = allCompletedTransactions
        .filter(t => new Date(t.createdAt) >= thisYear)
        .reduce((sum, t) => sum + t.amount, 0);
  
      const totalEarningsAllTime = referralData?.totalEarnings || 0;
      const avgEarningsPerReferral = referralData?.referredUsers > 0 ? 
        totalEarningsAllTime / referralData.referredUsers : 0;
  
      // Calculate transaction summary
      const transactionSummary = {
        totalAmount: allCompletedTransactions.reduce((sum, t) => sum + t.amount, 0),
        totalCount: totalTransactions,
        byGeneration: {
          gen1: {
            count: allCompletedTransactions.filter(t => t.generation === 1).length,
            amount: allCompletedTransactions.filter(t => t.generation === 1).reduce((sum, t) => sum + t.amount, 0)
          },
          gen2: {
            count: allCompletedTransactions.filter(t => t.generation === 2).length,
            amount: allCompletedTransactions.filter(t => t.generation === 2).reduce((sum, t) => sum + t.amount, 0)
          },
          gen3: {
            count: allCompletedTransactions.filter(t => t.generation === 3).length,
            amount: allCompletedTransactions.filter(t => t.generation === 3).reduce((sum, t) => sum + t.amount, 0)
          }
        }
      };
  
      const userReferralData = {
        user: {
          id: user._id,
          name: user.name,
          userName: user.userName,
          email: user.email,
          phone: user.phone,
          referralCode: user.userName,
          totalEarnings: totalEarningsAllTime,
          totalReferred: referralData?.referredUsers || 0,
          joinDate: user.createdAt,
          lastActivity: referralData?.updatedAt || user.createdAt,
          status: 'active',
          generations: {
            gen1: referralData?.generation1 || { count: 0, earnings: 0 },
            gen2: referralData?.generation2 || { count: 0, earnings: 0 },
            gen3: referralData?.generation3 || { count: 0, earnings: 0 }
          }
        },
        referralTree: {
          generation1: gen1Users.map(u => ({
            id: u._id,
            name: u.name,
            userName: u.userName,
            email: u.email,
            joinedDate: u.createdAt
          })),
          generation2: gen2Users.map(u => ({
            id: u._id,
            name: u.name,
            userName: u.userName,
            email: u.email,
            referredBy: u.referralInfo?.code || 'Unknown',
            joinedDate: u.createdAt
          })),
          generation3: gen3Users.map(u => ({
            id: u._id,
            name: u.name,
            userName: u.userName,
            email: u.email,
            referredBy: u.referralInfo?.code || 'Unknown',
            joinedDate: u.createdAt
          }))
        },
        transactions: transactions.map(t => ({
          id: t._id,
          referredUser: t.referredUser ? {
            id: t.referredUser._id,
            name: t.referredUser.name,
            userName: t.referredUser.userName,
            email: t.referredUser.email
          } : null,
          amount: t.amount,
          originalAmount: t.originalAmount || t.amount,
          currency: t.currency,
          generation: t.generation,
          purchaseType: t.purchaseType,
          sourceTransaction: t.sourceTransaction,
          status: t.status,
          createdAt: t.createdAt,
          adjustedBy: t.adjustedBy,
          adjustmentReason: t.adjustmentReason
        })),
        transactionsPagination: {
          currentPage: parseInt(transactionPage),
          totalPages,
          totalCount: totalTransactions,
          hasNext: parseInt(transactionPage) < totalPages,
          hasPrev: parseInt(transactionPage) > 1,
          limit: parseInt(transactionLimit)
        },
        transactionSummary,
        summary: {
          totalEarningsAllTime: Math.round(totalEarningsAllTime * 100) / 100,
          totalEarningsThisMonth: Math.round(earningsThisMonth * 100) / 100,
          totalEarningsThisYear: Math.round(earningsThisYear * 100) / 100,
          avgEarningsPerReferral: Math.round(avgEarningsPerReferral * 100) / 100
        }
      };
  
      res.status(200).json({
        success: true,
        userReferralData
      });
  
    } catch (error) {
      console.error('Error getting user referral details:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get user referral details',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  };
  
  // Add new endpoint for bulk transaction editing
  const bulkEditTransactions = async (req, res) => {
    try {
      const adminId = req.user.id;
      const { transactions, reason } = req.body;
      
      // Verify admin
      const admin = await User.findById(adminId);
      if (!admin || !admin.isAdmin) {
        return res.status(403).json({
          success: false,
          message: 'Unauthorized: Admin access required'
        });
      }
  
      if (!transactions || !Array.isArray(transactions) || transactions.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Transactions array is required'
        });
      }
  
      const results = {
        processed: 0,
        successful: 0,
        failed: 0,
        errors: []
      };
  
      // Process each transaction update
      for (const txUpdate of transactions) {
        results.processed++;
        
        try {
          const { id, newAmount, newStatus } = txUpdate;
          
          if (!id) {
            throw new Error('Transaction ID is required');
          }
  
          const transaction = await ReferralTransaction.findById(id)
            .populate('beneficiary', 'name email');
          
          if (!transaction) {
            throw new Error('Transaction not found');
          }
  
          const oldAmount = transaction.amount;
          const oldStatus = transaction.status;
          let amountChanged = false;
  
          // Update amount if provided
          if (newAmount !== undefined && parseFloat(newAmount) !== oldAmount) {
            transaction.originalAmount = transaction.originalAmount || oldAmount;
            transaction.amount = parseFloat(newAmount);
            amountChanged = true;
          }
  
          // Update status if provided
          if (newStatus && newStatus !== oldStatus) {
            transaction.status = newStatus;
          }
  
          // Add adjustment tracking
          transaction.adjustedBy = adminId;
          transaction.adjustmentReason = reason || 'Bulk transaction edit';
          
          await transaction.save();
  
          // Update user's referral stats if amount changed
          if (amountChanged) {
            const referralData = await Referral.findOne({ user: transaction.beneficiary._id });
            
            if (referralData) {
              const amountDifference = parseFloat(newAmount) - oldAmount;
              
              referralData.totalEarnings += amountDifference;
              
              // Update generation-specific earnings
              const genKey = `generation${transaction.generation}`;
              if (referralData[genKey]) {
                referralData[genKey].earnings += amountDifference;
              }
              
              await referralData.save();
            }
          }
  
          results.successful++;
          
        } catch (error) {
          results.failed++;
          results.errors.push({
            transactionId: txUpdate.id,
            error: error.message
          });
        }
      }
  
      // Create audit log
      await createAuditLog(adminId, 'bulk_transaction_edit', null, {
        transactionCount: transactions.length,
        results,
        reason
      }, req.ip);
  
      res.status(200).json({
        success: true,
        message: `Bulk edit completed: ${results.successful} successful, ${results.failed} failed`,
        results
      });
  
    } catch (error) {
      console.error('Error in bulk edit transactions:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to bulk edit transactions',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  };

// Get all referral transactions
const getAllReferralTransactions = async (req, res) => {
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

    const { 
      page = 1, 
      limit = 20, 
      userId,
      generation,
      purchaseType,
      status,
      fromDate,
      toDate,
      minAmount,
      maxAmount
    } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Build query
    let query = {};

    if (userId) {
      query.beneficiary = userId;
    }

    if (generation) {
      query.generation = parseInt(generation);
    }

    if (purchaseType) {
      query.purchaseType = purchaseType;
    }

    if (status) {
      query.status = status;
    }

    if (fromDate || toDate) {
      query.createdAt = {};
      if (fromDate) {
        query.createdAt.$gte = new Date(fromDate);
      }
      if (toDate) {
        query.createdAt.$lte = new Date(toDate);
      }
    }

    if (minAmount || maxAmount) {
      query.amount = {};
      if (minAmount) {
        query.amount.$gte = parseFloat(minAmount);
      }
      if (maxAmount) {
        query.amount.$lte = parseFloat(maxAmount);
      }
    }

    // Get transactions
    const transactions = await ReferralTransaction.find(query)
      .populate('beneficiary', 'name userName email')
      .populate('referredUser', 'name userName email')
      .populate('adjustedBy', 'name email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    // Get summary statistics
    const summaryStats = await ReferralTransaction.aggregate([
      { $match: query },
      {
        $group: {
          _id: null,
          totalTransactions: { $sum: 1 },
          totalAmount: { $sum: '$amount' },
          avgAmount: { $avg: '$amount' }
        }
      }
    ]);

    const summary = summaryStats[0] || {
      totalTransactions: 0,
      totalAmount: 0,
      avgAmount: 0
    };

    // Count total for pagination
    const totalCount = await ReferralTransaction.countDocuments(query);

    res.status(200).json({
      success: true,
      transactions: transactions.map(t => ({
        id: t._id,
        beneficiary: {
          id: t.beneficiary._id,
          name: t.beneficiary.name,
          userName: t.beneficiary.userName,
          email: t.beneficiary.email
        },
        referredUser: t.referredUser ? {
          id: t.referredUser._id,
          name: t.referredUser.name,
          userName: t.referredUser.userName,
          email: t.referredUser.email
        } : null,
        amount: t.amount,
        currency: t.currency,
        generation: t.generation,
        purchaseType: t.purchaseType,
        sourceTransaction: t.sourceTransaction,
        sourceTransactionModel: t.sourceTransactionModel,
        status: t.status,
        createdAt: t.createdAt,
        adjustedBy: t.adjustedBy ? {
          id: t.adjustedBy._id,
          name: t.adjustedBy.name,
          email: t.adjustedBy.email
        } : null,
        adjustmentReason: t.adjustmentReason,
        originalAmount: t.originalAmount
      })),
      summary: {
        totalTransactions: summary.totalTransactions,
        totalAmount: Math.round(summary.totalAmount * 100) / 100,
        avgAmount: Math.round(summary.avgAmount * 100) / 100
      },
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalCount / parseInt(limit)),
        totalCount
      }
    });

  } catch (error) {
    console.error('Error getting referral transactions:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get referral transactions',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Adjust user's referral earnings
const adjustUserEarnings = async (req, res) => {
  try {
    const adminId = req.user.id;
    const { 
      userId, 
      adjustmentType, 
      amount, 
      reason, 
      generation,
      referredUserId,
      notifyUser = true 
    } = req.body;
    
    // Verify admin
    const admin = await User.findById(adminId);
    if (!admin || !admin.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized: Admin access required'
      });
    }

    // Validate input
    if (!userId || !adjustmentType || !amount || !reason) {
      return res.status(400).json({
        success: false,
        message: 'Please provide userId, adjustmentType, amount, and reason'
      });
    }

    if (!['add', 'subtract', 'set'].includes(adjustmentType)) {
      return res.status(400).json({success: false,
        message: 'Invalid adjustment type. Must be add, subtract, or set'
      });
    }

    if (parseFloat(amount) < 0) {
      return res.status(400).json({
        success: false,
        message: 'Amount must be positive'
      });
    }

    // Get user
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Get user's referral data
    let referralData = await Referral.findOne({ user: userId });
    if (!referralData) {
      // Create new referral data if doesn't exist
      referralData = new Referral({
        user: userId,
        referredUsers: 0,
        totalEarnings: 0,
        generation1: { count: 0, earnings: 0 },
        generation2: { count: 0, earnings: 0 },
        generation3: { count: 0, earnings: 0 }
      });
    }

    const oldEarnings = referralData.totalEarnings;
    const adjustmentAmount = parseFloat(amount);
    let newEarnings;

    // Calculate new earnings based on adjustment type
    switch (adjustmentType) {
      case 'add':
        newEarnings = oldEarnings + adjustmentAmount;
        break;
      case 'subtract':
        newEarnings = Math.max(0, oldEarnings - adjustmentAmount);
        break;
      case 'set':
        newEarnings = adjustmentAmount;
        break;
    }

    // Create adjustment transaction record
    const adjustmentTransaction = new ReferralTransaction({
      beneficiary: userId,
      referredUser: referredUserId || null,
      amount: adjustmentType === 'set' ? (newEarnings - oldEarnings) : 
              (adjustmentType === 'add' ? adjustmentAmount : -adjustmentAmount),
      currency: 'USD',
      generation: generation || 1,
      purchaseType: 'adjustment',
      status: 'completed',
      sourceTransaction: null,
      sourceTransactionModel: 'AdminAdjustment',
      adjustedBy: adminId,
      adjustmentReason: reason,
      originalAmount: oldEarnings
    });

    await adjustmentTransaction.save();

    // Update referral data
    const earningsDifference = newEarnings - oldEarnings;
    
    if (generation) {
      // Adjust specific generation
      const genKey = `generation${generation}`;
      referralData[genKey].earnings += earningsDifference;
    } else {
      // Distribute adjustment across generations proportionally
      const totalGenEarnings = referralData.generation1.earnings + 
                              referralData.generation2.earnings + 
                              referralData.generation3.earnings;
      
      if (totalGenEarnings > 0) {
        const gen1Ratio = referralData.generation1.earnings / totalGenEarnings;
        const gen2Ratio = referralData.generation2.earnings / totalGenEarnings;
        const gen3Ratio = referralData.generation3.earnings / totalGenEarnings;
        
        referralData.generation1.earnings += earningsDifference * gen1Ratio;
        referralData.generation2.earnings += earningsDifference * gen2Ratio;
        referralData.generation3.earnings += earningsDifference * gen3Ratio;
      } else {
        // If no previous earnings, add to generation 1
        referralData.generation1.earnings += earningsDifference;
      }
    }

    referralData.totalEarnings = newEarnings;
    await referralData.save();

    // Create audit log
    await createAuditLog(adminId, 'earnings_adjustment', userId, {
      adjustmentType,
      amount: adjustmentAmount,
      oldEarnings,
      newEarnings,
      reason,
      generation,
      referredUserId
    }, req.ip);

    // Notify user if requested
    if (notifyUser && user.email) {
      try {
        await sendEmail({
          email: user.email,
          subject: 'AfriMobile - Referral Earnings Adjustment',
          html: `
            <h2>Referral Earnings Adjustment</h2>
            <p>Dear ${user.name},</p>
            <p>Your referral earnings have been adjusted by our admin team.</p>
            <p><strong>Adjustment Details:</strong></p>
            <ul>
              <li>Type: ${adjustmentType.charAt(0).toUpperCase() + adjustmentType.slice(1)}</li>
              <li>Amount: $${adjustmentAmount.toFixed(2)}</li>
              <li>Previous Earnings: $${oldEarnings.toFixed(2)}</li>
              <li>New Earnings: $${newEarnings.toFixed(2)}</li>
              <li>Reason: ${reason}</li>
            </ul>
            <p>If you have any questions about this adjustment, please contact our support team.</p>
            <p>Best regards,<br>AfriMobile Team</p>
          `
        });
      } catch (emailError) {
        console.error('Error sending adjustment notification email:', emailError);
      }
    }

    res.status(200).json({
      success: true,
      message: 'Earnings adjusted successfully',
      adjustment: {
        adjustmentId: adjustmentTransaction._id,
        oldEarnings: Math.round(oldEarnings * 100) / 100,
        newEarnings: Math.round(newEarnings * 100) / 100,
        adjustmentAmount: Math.round(adjustmentAmount * 100) / 100,
        adjustmentType,
        reason
      }
    });

  } catch (error) {
    console.error('Error adjusting user earnings:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to adjust user earnings',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Adjust specific referral transaction
// Fixed adjustReferralTransaction function
const adjustReferralTransaction = async (req, res) => {
  try {
    const adminId = req.user.id;
    const { transactionId } = req.params;
    const { newAmount, newStatus, adjustmentReason, notifyUser = true } = req.body;
    
    console.log('🔧 Adjusting transaction:', transactionId);
    console.log('📤 Request body:', req.body);
    
    // Verify admin
    const admin = await User.findById(adminId);
    if (!admin || !admin.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized: Admin access required'
      });
    }

    // Validate input data
    if (newAmount !== undefined) {
      const parsedAmount = parseFloat(newAmount);
      if (isNaN(parsedAmount) || parsedAmount < 0) {
        return res.status(400).json({
          success: false,
          message: 'Invalid amount provided. Amount must be a valid number greater than or equal to 0.'
        });
      }
    }

    if (newStatus && !['completed', 'pending', 'failed', 'cancelled', 'adjusted'].includes(newStatus)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status. Must be one of: completed, pending, failed, cancelled, adjusted'
      });
    }

    if (!newAmount && newAmount !== 0 && !newStatus) {
      return res.status(400).json({
        success: false,
        message: 'Either newAmount or newStatus must be provided'
      });
    }

    if (!adjustmentReason || adjustmentReason.trim().length < 3) {
      return res.status(400).json({
        success: false,
        message: 'Adjustment reason is required (minimum 3 characters)'
      });
    }

    // Find transaction
    console.log('🔍 Looking for transaction:', transactionId);
    const transaction = await ReferralTransaction.findById(transactionId)
      .populate('beneficiary', 'name email');
    
    if (!transaction) {
      console.log('❌ Transaction not found:', transactionId);
      return res.status(404).json({
        success: false,
        message: 'Transaction not found'
      });
    }

    console.log('✅ Transaction found:', transaction);

    // Store original values for audit
    const originalAmount = transaction.originalAmount || transaction.amount;
    const oldAmount = transaction.amount;
    const oldStatus = transaction.status;

    console.log('📊 Original values:', { originalAmount, oldAmount, oldStatus });

    // Check if there are actually changes to make
    const amountChanged = newAmount !== undefined && parseFloat(newAmount) !== oldAmount;
    const statusChanged = newStatus && newStatus !== oldStatus;

    if (!amountChanged && !statusChanged) {
      return res.status(400).json({
        success: false,
        message: 'No changes detected. New values are the same as current values.'
      });
    }

    // Update transaction fields
    if (newAmount !== undefined) {
      transaction.originalAmount = originalAmount;
      transaction.amount = parseFloat(newAmount);
      console.log('💰 Amount updated:', oldAmount, '→', parseFloat(newAmount));
    }

    if (newStatus) {
      transaction.status = newStatus;
      console.log('📋 Status updated:', oldStatus, '→', newStatus);
    }

    transaction.adjustedBy = adminId;
    transaction.adjustmentReason = adjustmentReason.trim();
    
    // Save the transaction
    console.log('💾 Saving transaction...');
    await transaction.save();
    console.log('✅ Transaction saved successfully');

    // Update user's referral stats if amount changed
    if (amountChanged) {
      console.log('📈 Updating user referral stats...');
      
      const referralData = await Referral.findOne({ user: transaction.beneficiary._id });
      
      if (referralData) {
        const amountDifference = parseFloat(newAmount) - oldAmount;
        console.log('💵 Amount difference:', amountDifference);
        
        // Update total earnings
        referralData.totalEarnings += amountDifference;
        
        // Update generation-specific earnings
        const genKey = `generation${transaction.generation}`;
        if (referralData[genKey]) {
          referralData[genKey].earnings += amountDifference;
        }
        
        await referralData.save();
        console.log('✅ User referral stats updated');
      } else {
        console.log('⚠️ No referral data found for user');
      }
    }

    // Create audit log
    await createAuditLog(adminId, 'transaction_adjustment', transaction.beneficiary._id, {
      transactionId,
      oldAmount,
      newAmount: newAmount !== undefined ? parseFloat(newAmount) : oldAmount,
      oldStatus,
      newStatus: newStatus || oldStatus,
      adjustmentReason: adjustmentReason.trim()
    }, req.ip);

    // Notify user if requested and email exists
    if (notifyUser && transaction.beneficiary.email) {
      try {
        console.log('📧 Sending notification email...');
        await sendEmail({
          email: transaction.beneficiary.email,
          subject: 'AfriMobile - Referral Transaction Adjustment',
          html: `
            <h2>Referral Transaction Adjustment</h2>
            <p>Dear ${transaction.beneficiary.name},</p>
            <p>One of your referral transactions has been adjusted by our admin team.</p>
            <p><strong>Transaction Details:</strong></p>
            <ul>
              <li>Transaction ID: ${transactionId}</li>
              ${newAmount !== undefined ? `<li>Previous Amount: $${oldAmount.toFixed(2)}</li>` : ''}
              ${newAmount !== undefined ? `<li>New Amount: $${parseFloat(newAmount).toFixed(2)}</li>` : ''}
              ${newStatus ? `<li>Previous Status: ${oldStatus}</li>` : ''}
              ${newStatus ? `<li>New Status: ${newStatus}</li>` : ''}
              <li>Reason: ${adjustmentReason}</li>
            </ul>
            <p>If you have any questions about this adjustment, please contact our support team.</p>
            <p>Best regards,<br>AfriMobile Team</p>
          `
        });
        console.log('✅ Email sent successfully');
      } catch (emailError) {
        console.error('❌ Error sending transaction adjustment notification email:', emailError);
        // Don't fail the whole operation if email fails
      }
    }

    // Prepare response
    const responseData = {
      id: transaction._id,
      beneficiary: {
        id: transaction.beneficiary._id,
        name: transaction.beneficiary.name,
        email: transaction.beneficiary.email
      },
      amount: transaction.amount,
      originalAmount: transaction.originalAmount,
      status: transaction.status,
      generation: transaction.generation,
      purchaseType: transaction.purchaseType,
      adjustedBy: adminId,
      adjustmentReason: transaction.adjustmentReason,
      createdAt: transaction.createdAt,
      updatedAt: new Date()
    };

    console.log('✅ Transaction adjustment completed successfully');
    
    res.status(200).json({
      success: true,
      message: 'Transaction adjusted successfully',
      transaction: responseData
    });

  } catch (error) {
    console.error('❌ Error adjusting referral transaction:', error);
    console.error('❌ Error stack:', error.stack);
    
    // Check for specific MongoDB errors
    if (error.name === 'ValidationError') {
      return res.status(400).json({
        success: false,
        message: 'Validation error: ' + Object.values(error.errors).map(e => e.message).join(', ')
      });
    }
    
    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid ID format provided'
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Failed to adjust referral transaction',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

// Cancel/Delete a referral transaction
const cancelReferralTransaction = async (req, res) => {
  try {
    const adminId = req.user.id;
    const { transactionId } = req.params;
    const { reason, notifyUser = true } = req.body;
    
    // Verify admin
    const admin = await User.findById(adminId);
    if (!admin || !admin.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized: Admin access required'
      });
    }

    if (!reason || reason.length < 10) {
      return res.status(400).json({
        success: false,
        message: 'Cancellation reason is required (minimum 10 characters)'
      });
    }

    // Find transaction
    const transaction = await ReferralTransaction.findById(transactionId)
      .populate('beneficiary', 'name email');
    
    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found'
      });
    }

    const originalAmount = transaction.amount;
    const beneficiaryId = transaction.beneficiary._id;

    // Update user's referral stats by removing this transaction's amount
    const referralData = await Referral.findOne({ user: beneficiaryId });
    
    if (referralData) {
      referralData.totalEarnings = Math.max(0, referralData.totalEarnings - originalAmount);
      
      // Update generation-specific earnings
      const genKey = `generation${transaction.generation}`;
      if (referralData[genKey]) {
        referralData[genKey].earnings = Math.max(0, referralData[genKey].earnings - originalAmount);
      }
      
      await referralData.save();
    }

    // Mark transaction as cancelled instead of deleting
    transaction.status = 'cancelled';
    transaction.adjustedBy = adminId;
    transaction.adjustmentReason = `CANCELLED: ${reason}`;
    transaction.amount = 0; // Set amount to 0 for cancelled transactions
    await transaction.save();

    // Create audit log
    await createAuditLog(adminId, 'transaction_cancellation', beneficiaryId, {
      transactionId,
      originalAmount,
      reason
    }, req.ip);

    // Notify user if requested
    if (notifyUser && transaction.beneficiary.email) {
      try {
        await sendEmail({
          email: transaction.beneficiary.email,
          subject: 'AfriMobile - Referral Transaction Cancelled',
          html: `
            <h2>Referral Transaction Cancelled</h2>
            <p>Dear ${transaction.beneficiary.name},</p>
            <p>One of your referral transactions has been cancelled by our admin team.</p>
            <p><strong>Transaction Details:</strong></p>
            <ul>
              <li>Transaction ID: ${transactionId}</li>
              <li>Original Amount: $${originalAmount.toFixed(2)}</li>
              <li>Reason for Cancellation: ${reason}</li>
            </ul>
            <p>This amount has been removed from your total referral earnings.</p>
            <p>If you have any questions about this cancellation, please contact our support team.</p>
            <p>Best regards,<br>AfriMobile Team</p>
          `
        });
      } catch (emailError) {
        console.error('Error sending cancellation notification email:', emailError);
      }
    }

    // Calculate new total earnings
    const updatedReferralData = await Referral.findOne({ user: beneficiaryId });
    const newTotalEarnings = updatedReferralData ? updatedReferralData.totalEarnings : 0;

    res.status(200).json({
      success: true,
      message: 'Transaction cancelled successfully',
      cancelledTransaction: {
        transactionId,
        originalAmount: Math.round(originalAmount * 100) / 100,
        beneficiaryId,
        newTotalEarnings: Math.round(newTotalEarnings * 100) / 100
      }
    });

  } catch (error) {
    console.error('Error cancelling referral transaction:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to cancel referral transaction',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Perform bulk actions on multiple users
const performBulkActions = async (req, res) => {
  try {
    const adminId = req.user.id;
    const { action, userIds, adjustmentData } = req.body;
    
    // Verify admin
    const admin = await User.findById(adminId);
    if (!admin || !admin.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized: Admin access required'
      });
    }

    if (!action || !userIds || !Array.isArray(userIds)) {
      return res.status(400).json({
        success: false,
        message: 'Please provide action and userIds array'
      });
    }

    if (!['sync_stats', 'adjust_earnings', 'recalculate_all'].includes(action)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid action. Must be sync_stats, adjust_earnings, or recalculate_all'
      });
    }

    const results = {
      processed: 0,
      successful: 0,
      failed: 0,
      errors: []
    };

    for (const userId of userIds) {
      results.processed++;
      
      try {
        switch (action) {
          case 'sync_stats':
            await syncReferralStats(userId);
            break;
            
          case 'adjust_earnings':
            if (!adjustmentData || !adjustmentData.type || !adjustmentData.amount) {
              throw new Error('Adjustment data required for earnings adjustment');
            }
            
            // Perform individual adjustment (reuse logic from adjustUserEarnings)
            const user = await User.findById(userId);
            if (!user) {
              throw new Error('User not found');
            }
            
            let referralData = await Referral.findOne({ user: userId });
            if (!referralData) {
              referralData = new Referral({
                user: userId,
                referredUsers: 0,
                totalEarnings: 0,
                generation1: { count: 0, earnings: 0 },
                generation2: { count: 0, earnings: 0 },
                generation3: { count: 0, earnings: 0 }
              });
            }
            
            const oldEarnings = referralData.totalEarnings;
            const adjustmentAmount = parseFloat(adjustmentData.amount);
            let newEarnings;
            
            switch (adjustmentData.type) {
              case 'add':
                newEarnings = oldEarnings + adjustmentAmount;
                break;
              case 'subtract':
                newEarnings = Math.max(0, oldEarnings - adjustmentAmount);
                break;
              case 'multiply':
                newEarnings = oldEarnings * adjustmentAmount;
                break;
              default:
                throw new Error('Invalid adjustment type');
            }
            
            // Create adjustment transaction
            const adjustmentTransaction = new ReferralTransaction({
              beneficiary: userId,
              amount: newEarnings - oldEarnings,
              currency: 'USD',
              generation: 1,
              purchaseType: 'bulk_adjustment',
              status: 'completed',
              adjustedBy: adminId,
              adjustmentReason: adjustmentData.reason || 'Bulk adjustment'
            });
            
            await adjustmentTransaction.save();
            
            referralData.totalEarnings = newEarnings;
            await referralData.save();
            break;
            
          case 'recalculate_all':
            // Full recalculation (more intensive)
            await syncReferralStats(userId);
            
            // Additional recalculation logic if needed
            const allTransactions = await ReferralTransaction.find({ 
              beneficiary: userId, 
              status: 'completed' 
            });
            
            const totalCalculated = allTransactions.reduce((sum, tx) => sum + tx.amount, 0);
            
            const referralDataForRecalc = await Referral.findOne({ user: userId });
            if (referralDataForRecalc && Math.abs(referralDataForRecalc.totalEarnings - totalCalculated) > 0.01) {
              referralDataForRecalc.totalEarnings = totalCalculated;
              await referralDataForRecalc.save();
            }
            break;
        }
        
        results.successful++;
      } catch (error) {
        results.failed++;
        results.errors.push({
          userId,
          error: error.message
        });
      }
    }

    // Create audit log for bulk action
    await createAuditLog(adminId, 'bulk_action', null, {
      action,
      userCount: userIds.length,
      results,
      adjustmentData
    }, req.ip);

    res.status(200).json({
      success: true,
      message: `Bulk action '${action}' completed`,
      results
    });

  } catch (error) {
    console.error('Error performing bulk actions:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to perform bulk actions',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Get advanced referral analytics
const getReferralAnalytics = async (req, res) => {
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

    const { period = 'month', includeCharts = true } = req.query;

    // Calculate date range based on period
    const now = new Date();
    let startDate;
    
    switch (period) {
      case 'week':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case 'month':
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      case 'quarter':
        const quarterStart = Math.floor(now.getMonth() / 3) * 3;
        startDate = new Date(now.getFullYear(), quarterStart, 1);
        break;
      case 'year':
        startDate = new Date(now.getFullYear(), 0, 1);
        break;
      case 'all':
        startDate = new Date(2020, 0, 1); // Assuming platform started in 2020
        break;
      default:
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    }

    // Get overview analytics
    const overview = await ReferralTransaction.aggregate([
      { 
        $match: { 
          createdAt: { $gte: startDate },
          status: 'completed'
        }
      },
      {
        $group: {
          _id: null,
          totalTransactions: { $sum: 1 },
          totalCommissions: { $sum: '$amount' },
          avgCommission: { $avg: '$amount' },
          uniqueBeneficiaries: { $addToSet: '$beneficiary' }
        }
      }
    ]);

    const overviewData = overview[0] || {
      totalTransactions: 0,
      totalCommissions: 0,
      avgCommission: 0,
      uniqueBeneficiaries: []
    };

    // Get trends (daily data for the period)
    const dailyTrends = await ReferralTransaction.aggregate([
      { 
        $match: { 
          createdAt: { $gte: startDate },
          status: 'completed'
        }
      },
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m-%d", date: "$createdAt" }
          },
          dailyTransactions: { $sum: 1 },
          dailyCommissions: { $sum: '$amount' }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    // Get top performers for the period
    const topPerformers = await ReferralTransaction.aggregate([
      { 
        $match: { 
          createdAt: { $gte: startDate },
          status: 'completed'
        }
      },
      {
        $group: {
          _id: '$beneficiary',
          totalEarnings: { $sum: '$amount' },
          totalTransactions: { $sum: 1 }
        }
      },
      { $sort: { totalEarnings: -1 } },
      { $limit: 10 },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'user'
        }
      },
      { $unwind: '$user' }
    ]);

    // Get generation analysis
    const generationAnalysis = await ReferralTransaction.aggregate([
      { 
        $match: { 
          createdAt: { $gte: startDate },
          status: 'completed'
        }
      },
      {
        $group: {
          _id: '$generation',
          totalAmount: { $sum: '$amount' },
          totalTransactions: { $sum: 1 },
          avgAmount: { $avg: '$amount' }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    // Calculate conversion rates
    const totalUsers = await User.countDocuments({ createdAt: { $gte: startDate } });
    const usersWithReferrals = await User.countDocuments({
      createdAt: { $gte: startDate },
      'referralInfo.code': { $exists: true, $ne: null }
    });
    
    const activeReferrers = overviewData.uniqueBeneficiaries.length;
    
    const conversionRates = {
      signupToReferral: totalUsers > 0 ? (usersWithReferrals / totalUsers * 100) : 0,
      referralToEarning: usersWithReferrals > 0 ? (activeReferrers / usersWithReferrals * 100) : 0,
      overallConversion: totalUsers > 0 ? (activeReferrers / totalUsers * 100) : 0
    };

    let chartData = {};
    
    if (includeCharts === 'true' || includeCharts === true) {
      chartData = {
        dailyTrends: dailyTrends.map(day => ({
          date: day._id,
          transactions: day.dailyTransactions,
          commissions: Math.round(day.dailyCommissions * 100) / 100
        })),
        generationDistribution: generationAnalysis.map(gen => ({
          generation: gen._id,
          amount: Math.round(gen.totalAmount * 100) / 100,
          transactions: gen.totalTransactions,
          percentage: overviewData.totalCommissions > 0 ? 
            Math.round((gen.totalAmount / overviewData.totalCommissions) * 100 * 100) / 100 : 0
        }))
      };
    }

    const analytics = {
      overview: {
        totalTransactions: overviewData.totalTransactions,
        totalCommissions: Math.round(overviewData.totalCommissions * 100) / 100,
        avgCommission: Math.round(overviewData.avgCommission * 100) / 100,
        uniqueEarners: overviewData.uniqueBeneficiaries.length,
        period: period
      },
      trends: {
        totalDays: dailyTrends.length,
        avgDailyTransactions: dailyTrends.length > 0 ? 
          Math.round((overviewData.totalTransactions / dailyTrends.length) * 100) / 100 : 0,
        avgDailyCommissions: dailyTrends.length > 0 ? 
          Math.round((overviewData.totalCommissions / dailyTrends.length) * 100) / 100 : 0
      },
      topPerformers: topPerformers.map(performer => ({
        user: {
          id: performer.user._id,
          name: performer.user.name,
          userName: performer.user.userName,
          email: performer.user.email
        },
        earnings: Math.round(performer.totalEarnings * 100) / 100,
        transactions: performer.totalTransactions,
        avgPerTransaction: Math.round((performer.totalEarnings / performer.totalTransactions) * 100) / 100
      })),
      generationAnalysis: generationAnalysis.reduce((acc, gen) => {
        acc[`generation${gen._id}`] = {
          totalAmount: Math.round(gen.totalAmount * 100) / 100,
          totalTransactions: gen.totalTransactions,
          avgAmount: Math.round(gen.avgAmount * 100) / 100,
          percentage: overviewData.totalCommissions > 0 ? 
            Math.round((gen.totalAmount / overviewData.totalCommissions) * 100 * 100) / 100 : 0
        };
        return acc;
      }, {}),
      conversionRates: {
        signupToReferral: Math.round(conversionRates.signupToReferral * 100) / 100,
        referralToEarning: Math.round(conversionRates.referralToEarning * 100) / 100,
        overallConversion: Math.round(conversionRates.overallConversion * 100) / 100
      },
      chartData: includeCharts === 'true' || includeCharts === true ? chartData : null
    };

    res.status(200).json({
      success: true,
      analytics
    });

  } catch (error) {
    console.error('Error getting referral analytics:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get referral analytics',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Export referral data
const exportReferralData = async (req, res) => {
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

    const { 
      format = 'csv', 
      type = 'users', 
      fromDate, 
      toDate, 
      includeDetails = true 
    } = req.query;

    // Build date filter
    let dateFilter = {};
    if (fromDate || toDate) {
      dateFilter.createdAt = {};
      if (fromDate) dateFilter.createdAt.$gte = new Date(fromDate);
      if (toDate) dateFilter.createdAt.$lte = new Date(toDate);
    }

    let data;
    let filename;

    switch (type) {
      case 'users':
        // Export users with referral data
        const users = await User.find(dateFilter)
          .select('name userName email phone createdAt')
          .lean();
        
        const userIds = users.map(user => user._id);
        const referralData = await Referral.find({ user: { $in: userIds } }).lean();
        const referralMap = new Map();
        referralData.forEach(ref => {
          referralMap.set(ref.user.toString(), ref);
        });

        data = users.map(user => {
          const referral = referralMap.get(user._id.toString()) || {};
          return {
            'User ID': user._id,
            'Name': user.name,
            'Username': user.userName,
            'Email': user.email,
            'Phone': user.phone || '',
            'Join Date': user.createdAt.toISOString().split('T')[0],
            'Total Earnings': referral.totalEarnings || 0,
            'Total Referred': referral.referredUsers || 0,
            'Gen 1 Count': referral.generation1?.count || 0,
            'Gen 1 Earnings': referral.generation1?.earnings || 0,
            'Gen 2 Count': referral.generation2?.count || 0,
            'Gen 2 Earnings': referral.generation2?.earnings || 0,
            'Gen 3 Count': referral.generation3?.count || 0,
            'Gen 3 Earnings': referral.generation3?.earnings || 0
          };
        });
        filename = `referral_users_${new Date().toISOString().split('T')[0]}`;
        break;

      case 'transactions':
        // Export transactions
        const transactions = await ReferralTransaction.find(dateFilter)
          .populate('beneficiary', 'name userName email')
          .populate('referredUser', 'name userName email')
          .populate('adjustedBy', 'name email')
          .lean();

        data = transactions.map(tx => ({
          'Transaction ID': tx._id,
          'Beneficiary Name': tx.beneficiary?.name || 'Unknown',
          'Beneficiary Username': tx.beneficiary?.userName || 'Unknown',
          'Beneficiary Email': tx.beneficiary?.email || 'Unknown',
          'Referred User Name': tx.referredUser?.name || 'Unknown',
          'Referred User Username': tx.referredUser?.userName || 'Unknown',
          'Amount': tx.amount,
          'Currency': tx.currency,
          'Generation': tx.generation,
          'Purchase Type': tx.purchaseType,
          'Status': tx.status,
          'Created Date': tx.createdAt.toISOString().split('T')[0],
          'Adjusted By': tx.adjustedBy?.name || '',
          'Adjustment Reason': tx.adjustmentReason || '',
          'Original Amount': tx.originalAmount || tx.amount
        }));
        filename = `referral_transactions_${new Date().toISOString().split('T')[0]}`;
        break;

      case 'summary':
        // Export summary statistics
        const summaryStats = await ReferralTransaction.aggregate([
          { $match: { status: 'completed', ...dateFilter } },
          {
            $group: {
              _id: {
                beneficiary: '$beneficiary',
                generation: '$generation'
              },
              totalAmount: { $sum: '$amount' },
              transactionCount: { $sum: 1 }
            }
          },
          {
            $lookup: {
              from: 'users',
              localField: '_id.beneficiary',
              foreignField: '_id',
              as: 'user'
            }
          },
          { $unwind: '$user' }
        ]);

        data = summaryStats.map(stat => ({
          'User ID': stat.user._id,
          'Name': stat.user.name,
          'Username': stat.user.userName,
          'Email': stat.user.email,
          'Generation': stat._id.generation,
          'Total Amount': stat.totalAmount,
          'Transaction Count': stat.transactionCount,
          'Average Per Transaction': Math.round((stat.totalAmount / stat.transactionCount) * 100) / 100
        }));
        filename = `referral_summary_${new Date().toISOString().split('T')[0]}`;
        break;

      default:
        return res.status(400).json({
          success: false,
          message: 'Invalid export type'
        });
    }

    // Generate export based on format
    if (format === 'csv') {
      const csv = convertToCSV(data);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
      res.send(csv);
    } else if (format === 'json') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.json"`);
      res.send(JSON.stringify(data, null, 2));
    } else {
      return res.status(400).json({
        success: false,
        message: 'Unsupported export format'
      });
    }

  } catch (error) {
    console.error('Error exporting referral data:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to export referral data',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Helper function to convert data to CSV
const convertToCSV = (data) => {
  if (!data || data.length === 0) return '';
  
  const headers = Object.keys(data[0]);
  const csvHeaders = headers.join(',');
  
  const csvRows = data.map(row => {
    return headers.map(header => {
      const value = row[header];
      // Escape commas and quotes in CSV
      if (typeof value === 'string' && (value.includes(',') || value.includes('"'))) {
        return `"${value.replace(/"/g, '""')}"`;
      }
      return value;
    }).join(',');
  });
  
  return [csvHeaders, ...csvRows].join('\n');
};

// Get current referral system settings
const getReferralSettings = async (req, res) => {
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

    const siteConfig = await SiteConfig.getCurrentConfig();
    
    const settings = {
      commissionRates: siteConfig.referralCommission || {
        generation1: 15,
        generation2: 3,
        generation3: 2
      },
      isActive: siteConfig.referralSystemActive !== false, // Default to true if not set
      maxGenerations: 3, // This could be configurable
      minimumPayout: siteConfig.minimumReferralPayout || 10,
      lastUpdated: siteConfig.updatedAt || siteConfig.createdAt
    };

    res.status(200).json({
      success: true,
      settings
    });

  } catch (error) {
    console.error('Error getting referral settings:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get referral settings',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Update referral system settings
const updateReferralSettings = async (req, res) => {
  try {
    const adminId = req.user.id;
    const { commissionRates, isActive, maxGenerations, minimumPayout } = req.body;
    
    // Verify admin
    const admin = await User.findById(adminId);
    if (!admin || !admin.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized: Admin access required'
      });
    }

    const siteConfig = await SiteConfig.getCurrentConfig();
    
    // Store old settings for audit log
    const oldSettings = {
      commissionRates: siteConfig.referralCommission,
      isActive: siteConfig.referralSystemActive,
      minimumPayout: siteConfig.minimumReferralPayout
    };

    // Update settings
    if (commissionRates) {
      // Validate commission rates
      const { generation1, generation2, generation3 } = commissionRates;
      
      if (generation1 < 0 || generation1 > 100 ||
          generation2 < 0 || generation2 > 100 ||
          generation3 < 0 || generation3 > 100) {
        return res.status(400).json({
          success: false,
          message: 'Commission rates must be between 0 and 100'
        });
      }
      
      siteConfig.referralCommission = {
        generation1: parseFloat(generation1),
        generation2: parseFloat(generation2),
        generation3: parseFloat(generation3)
      };
    }

    if (isActive !== undefined) {
      siteConfig.referralSystemActive = Boolean(isActive);
    }

    if (minimumPayout !== undefined) {
      if (minimumPayout < 0) {
        return res.status(400).json({
          success: false,
          message: 'Minimum payout must be positive'
        });
      }
      siteConfig.minimumReferralPayout = parseFloat(minimumPayout);
    }

    await siteConfig.save();

    // Create audit log
    await createAuditLog(adminId, 'settings_update', null, {
      oldSettings,
      newSettings: {
        commissionRates: siteConfig.referralCommission,
        isActive: siteConfig.referralSystemActive,
        minimumPayout: siteConfig.minimumReferralPayout
      }
    }, req.ip);

    res.status(200).json({
      success: true,
      message: 'Referral settings updated successfully',
      settings: {
        commissionRates: siteConfig.referralCommission,
        isActive: siteConfig.referralSystemActive,
        minimumPayout: siteConfig.minimumReferralPayout,
        lastUpdated: new Date()
      }
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

// Get referral system audit log
const getAuditLog = async (req, res) => {
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

    const { 
      page = 1, 
      limit = 20, 
      adminId: filterAdminId, 
      action, 
      fromDate, 
      toDate 
    } = req.query;

    // For now, return a mock audit log since we're logging to console
    // In production, you'd fetch from an AuditLog model
    const mockAuditLog = [
      {
        id: '1',
        adminId: adminId,
        adminName: admin.name,
        action: 'earnings_adjustment',
        targetUserId: 'user123',
        targetUserName: 'John Doe',
        details: {
          adjustmentType: 'add',
          amount: 50,
          oldEarnings: 100,
          newEarnings: 150,
          reason: 'Bonus payment'
        },
        timestamp: new Date(),
        ipAddress: req.ip
      }
    ];

    res.status(200).json({
      success: true,
      auditLog: mockAuditLog,
      pagination: {
        currentPage: parseInt(page),
        totalPages: 1,
        totalCount: mockAuditLog.length
      }
    });

  } catch (error) {
    console.error('Error getting audit log:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get audit log',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Sync user's referral data
const syncUserReferralData = async (req, res) => {
  try {
    const adminId = req.user.id;
    const { userId } = req.params;
    
    // Verify admin
    const admin = await User.findById(adminId);
    if (!admin || !admin.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized: Admin access required'
      });
    }

    // Check if user exists
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Get old earnings for comparison
    const oldReferralData = await Referral.findOne({ user: userId });
    const oldEarnings = oldReferralData?.totalEarnings || 0;

    // Perform sync
    const syncResult = await syncReferralStats(userId);

    if (!syncResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Failed to sync referral data',
        error: syncResult.message
      });
    }

    // Get new earnings
    const newReferralData = await Referral.findOne({ user: userId });
    const newEarnings = newReferralData?.totalEarnings || 0;

    // Count transactions processed
    const transactionsCount = await ReferralTransaction.countDocuments({
      beneficiary: userId,
      status: 'completed'
    });

    // Calculate discrepancies found
    const discrepanciesFound = Math.abs(newEarnings - oldEarnings) > 0.01 ? 1 : 0;

    // Create audit log
    await createAuditLog(adminId, 'user_sync', userId, {
      oldEarnings,
      newEarnings,
      transactionsProcessed: transactionsCount,
      discrepanciesFound
    }, req.ip);

    res.status(200).json({
      success: true,
      message: 'User referral data synced successfully',
      syncResults: {
        oldEarnings: Math.round(oldEarnings * 100) / 100,
        newEarnings: Math.round(newEarnings * 100) / 100,
        transactionsProcessed: transactionsCount,
        discrepanciesFound
      }
    });

  } catch (error) {
    console.error('Error syncing user referral data:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to sync user referral data',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Export all functions
module.exports = {
  getReferralDashboard,
  getAllUsersWithReferralData,
    getUserReferralDetails,
  bulkEditTransactions,
  getAllReferralTransactions,
  adjustUserEarnings,
  adjustReferralTransaction,
  cancelReferralTransaction,
  performBulkActions,
  getReferralAnalytics,
  exportReferralData,
  getReferralSettings,
  updateReferralSettings,
  getAuditLog,
  syncUserReferralData
};