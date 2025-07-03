const User = require('../models/User');
const Referral = require('../models/Referral');
const ReferralTransaction = require('../models/ReferralTransaction');
const SiteConfig = require('../models/SiteConfig');
const UserShare = require('../models/UserShare');

// Enhanced referral utility function
const syncReferralStats = async (userId) => {
  try {
    // Get user
    const user = await User.findById(userId);
    if (!user) {
      return { success: false, message: 'User not found' };
    }

    // Get commission rates from site config
    const siteConfig = await SiteConfig.getCurrentConfig();
    const commissionRates = siteConfig.referralCommission || {
      generation1: 15, // 15% for direct referrals
      generation2: 3,  // 3% for second generation
      generation3: 2   // 2% for third generation
    };

    // Find users who have this person as their referrer (Gen 1)
    const gen1Users = await User.find({ 'referralInfo.code': user.userName });
    
    // Initialize stats counters
    let totalReferred = gen1Users.length;
    let totalEarnings = 0;
    
    // Stats by generation
    const generation1 = { count: gen1Users.length, earnings: 0 };
    const generation2 = { count: 0, earnings: 0 };
    const generation3 = { count: 0, earnings: 0 };
    
    // Clear existing referral transactions to avoid duplicates
    await ReferralTransaction.deleteMany({ beneficiary: userId });
    
    // Process Generation 1 users
    for (const gen1User of gen1Users) {
      // Get share transactions for this user
      const userShare = await UserShare.findOne({ user: gen1User._id });
      
      if (userShare) {
        const completedTransactions = userShare.transactions.filter(tx => tx.status === 'completed');
        
        for (const tx of completedTransactions) {
          // Calculate commission (Generation 1)
          const commissionAmount = (tx.totalAmount * commissionRates.generation1) / 100;
          
          // Create referral transaction
          const referralTx = new ReferralTransaction({
            beneficiary: userId,
            referredUser: gen1User._id,
            amount: commissionAmount,
            currency: tx.currency || 'USD',
            generation: 1,
            purchaseType: 'share',
            sourceTransactionModel: 'UserShare',
            status: 'completed',
            createdAt: tx.createdAt || new Date()
          });
          
          await referralTx.save();
          
          generation1.earnings += commissionAmount;
          totalEarnings += commissionAmount;
        }
      }
      
      // Find Generation 2 users
      const gen2Users = await User.find({ 'referralInfo.code': gen1User.userName });
      generation2.count += gen2Users.length;
      
      // Process Generation 2 users
      for (const gen2User of gen2Users) {
        // Get share transactions for this user
        const gen2UserShare = await UserShare.findOne({ user: gen2User._id });
        
        if (gen2UserShare) {
          const gen2CompletedTransactions = gen2UserShare.transactions.filter(tx => tx.status === 'completed');
          
          for (const tx of gen2CompletedTransactions) {
            // Calculate commission (Generation 2)
            const commissionAmount = (tx.totalAmount * commissionRates.generation2) / 100;
            
            // Create referral transaction
            const referralTx = new ReferralTransaction({
              beneficiary: userId,
              referredUser: gen2User._id,
              amount: commissionAmount,
              currency: tx.currency || 'USD',
              generation: 2,
              purchaseType: 'share',
              sourceTransactionModel: 'UserShare',
              status: 'completed',
              createdAt: tx.createdAt || new Date()
            });
            
            await referralTx.save();
            
            generation2.earnings += commissionAmount;
            totalEarnings += commissionAmount;
          }
        }
        
        // Find Generation 3 users
        const gen3Users = await User.find({ 'referralInfo.code': gen2User.userName });
        generation3.count += gen3Users.length;
        
        // Process Generation 3 users
        for (const gen3User of gen3Users) {
          // Get share transactions for this user
          const gen3UserShare = await UserShare.findOne({ user: gen3User._id });
          
          if (gen3UserShare) {
            const gen3CompletedTransactions = gen3UserShare.transactions.filter(tx => tx.status === 'completed');
            
            for (const tx of gen3CompletedTransactions) {
              // Calculate commission (Generation 3)
              const commissionAmount = (tx.totalAmount * commissionRates.generation3) / 100;
              
              // Create referral transaction
              const referralTx = new ReferralTransaction({
                beneficiary: userId,
                referredUser: gen3User._id,
                amount: commissionAmount,
                currency: tx.currency || 'USD',
                generation: 3,
                purchaseType: 'share',
                sourceTransactionModel: 'UserShare',
                status: 'completed',
                createdAt: tx.createdAt || new Date()
              });
              
              await referralTx.save();
              
              generation3.earnings += commissionAmount;
              totalEarnings += commissionAmount;
            }
          }
        }
      }
    }
    
    // Update or create referral stats
    let referralStats = await Referral.findOne({ user: userId });
    
    if (!referralStats) {
      referralStats = new Referral({
        user: userId,
        referredUsers: totalReferred,
        totalEarnings: totalEarnings,
        generation1: generation1,
        generation2: generation2,
        generation3: generation3
      });
    } else {
      referralStats.referredUsers = totalReferred;
      referralStats.totalEarnings = totalEarnings;
      referralStats.generation1 = generation1;
      referralStats.generation2 = generation2;
      referralStats.generation3 = generation3;
    }
    
    await referralStats.save();
    
    return {
      success: true,
      message: 'Referral stats synced successfully',
      stats: referralStats
    };
  } catch (error) {
    console.error('Error syncing referral stats:', error);
    return {
      success: false,
      message: 'Failed to sync referral stats',
      error: error.message
    };
  }
};

const processReferralCommission = async (userId, purchaseAmount, purchaseType = 'share', transactionId = null) => {
  try {
    // Get the purchaser
    const purchaser = await User.findById(userId);
    if (!purchaser || !purchaser.referralInfo || !purchaser.referralInfo.code) {
      console.log('User has no referrer, skipping commission');
      return { success: false, message: 'User has no referrer' };
    }
    
    // Get site config for commission rates
    const siteConfig = await SiteConfig.getCurrentConfig();
    const commissionRates = siteConfig.referralCommission || {
      generation1: 15,
      generation2: 3,
      generation3: 2
    };

    // **NEW: Handle co-founder purchase amount calculation**
    let effectivePurchaseAmount = purchaseAmount;
    if (purchaseType === 'cofounder') {
      // Get co-founder share configuration for ratio
      const CoFounderShare = require('../models/CoFounderShare');
      const coFounderConfig = await CoFounderShare.findOne();
      const shareToRegularRatio = coFounderConfig?.shareToRegularRatio || 29;
      
      // For commission calculation, treat co-founder shares as their equivalent regular share value
      // This ensures referrers get commissions based on the full value representation
      effectivePurchaseAmount = purchaseAmount; // Keep original amount as commission base
      
      console.log(`Processing co-founder referral commission: Original amount: ${purchaseAmount}, Ratio: ${shareToRegularRatio}`);
    }
    
    console.log(`Processing referral commission for purchase: ${effectivePurchaseAmount} by user: ${purchaser.userName}`);
    console.log(`Purchase type: ${purchaseType}, Referral code: ${purchaser.referralInfo.code}`);
    
    // Find direct referrer (Generation 1)
    const gen1Referrer = await User.findOne({ userName: purchaser.referralInfo.code });
    
    if (!gen1Referrer) {
      console.log(`Referrer with username ${purchaser.referralInfo.code} not found`);
      return { success: false, message: 'Referrer not found' };
    }
    
    console.log(`Found Generation 1 referrer: ${gen1Referrer.userName}`);
    
    // Calculate and create Generation 1 commission
    const gen1Commission = (effectivePurchaseAmount * commissionRates.generation1) / 100;
    
    const gen1Transaction = new ReferralTransaction({
      beneficiary: gen1Referrer._id,
      referredUser: userId,
      amount: gen1Commission,
      currency: 'USD', // **UPDATE: Consider using actual currency from purchase**
      generation: 1,
      purchaseType: purchaseType,
      sourceTransaction: transactionId,
      sourceTransactionModel: purchaseType === 'cofounder' ? 'PaymentTransaction' : 'UserShare', // **NEW: Specify correct model**
      status: 'completed',
      createdAt: new Date()
    });
    
    await gen1Transaction.save();
    console.log(`Created Generation 1 commission: ${gen1Commission} for ${purchaseType} purchase`);
    
    // Update referrer stats
    let gen1Stats = await Referral.findOne({ user: gen1Referrer._id });
    
    if (!gen1Stats) {
      gen1Stats = new Referral({
        user: gen1Referrer._id,
        referredUsers: 1,
        totalEarnings: gen1Commission,
        generation1: { count: 1, earnings: gen1Commission },
        generation2: { count: 0, earnings: 0 },
        generation3: { count: 0, earnings: 0 }
      });
    } else {
      gen1Stats.totalEarnings += gen1Commission;
      gen1Stats.generation1.earnings += gen1Commission;
    }
    
    await gen1Stats.save();
    
    // Continue with Generation 2 and 3 processing (similar updates)...
    if (gen1Referrer.referralInfo && gen1Referrer.referralInfo.code) {
      const gen2Referrer = await User.findOne({ userName: gen1Referrer.referralInfo.code });
      
      if (gen2Referrer) {
        console.log(`Found Generation 2 referrer: ${gen2Referrer.userName}`);
        
        // Calculate and create Generation 2 commission
        const gen2Commission = (effectivePurchaseAmount * commissionRates.generation2) / 100;
        
        const gen2Transaction = new ReferralTransaction({
          beneficiary: gen2Referrer._id,
          referredUser: userId,
          amount: gen2Commission,
          currency: 'USD',
          generation: 2,
          purchaseType: purchaseType,
          sourceTransaction: transactionId,
          sourceTransactionModel: purchaseType === 'cofounder' ? 'PaymentTransaction' : 'UserShare', // **NEW**
          status: 'completed',
          createdAt: new Date()
        });
        
        await gen2Transaction.save();
        console.log(`Created Generation 2 commission: ${gen2Commission} for ${purchaseType} purchase`);
        
        // Update referrer stats
        let gen2Stats = await Referral.findOne({ user: gen2Referrer._id });
        
        if (!gen2Stats) {
          gen2Stats = new Referral({
            user: gen2Referrer._id,
            referredUsers: 0,
            totalEarnings: gen2Commission,
            generation1: { count: 0, earnings: 0 },
            generation2: { count: 1, earnings: gen2Commission },
            generation3: { count: 0, earnings: 0 }
          });
        } else {
          gen2Stats.totalEarnings += gen2Commission;
          gen2Stats.generation2.earnings += gen2Commission;
          gen2Stats.generation2.count += 1;
        }
        
        await gen2Stats.save();
        
        // Look for Generation 3 referrer
        if (gen2Referrer.referralInfo && gen2Referrer.referralInfo.code) {
          const gen3Referrer = await User.findOne({ userName: gen2Referrer.referralInfo.code });
          
          if (gen3Referrer) {
            console.log(`Found Generation 3 referrer: ${gen3Referrer.userName}`);
            
            // Calculate and create Generation 3 commission
            const gen3Commission = (purchaseAmount * commissionRates.generation3) / 100;
            
            const gen3Transaction = new ReferralTransaction({
              beneficiary: gen3Referrer._id,
              referredUser: userId,
              amount: gen3Commission,
              currency: 'USD',
              generation: 3,
              purchaseType: purchaseType,
              sourceTransaction: transactionId,
              sourceTransactionModel: 'UserShare',
              status: 'completed',
              createdAt: new Date()
            });
            
            await gen3Transaction.save();
            console.log(`Created Generation 3 commission: ${gen3Commission}`);
            
            // Update referrer stats
            let gen3Stats = await Referral.findOne({ user: gen3Referrer._id });
            
            if (!gen3Stats) {
              gen3Stats = new Referral({
                user: gen3Referrer._id,
                referredUsers: 0,
                totalEarnings: gen3Commission,
                generation1: { count: 0, earnings: 0 },
                generation2: { count: 0, earnings: 0 },
                generation3: { count: 1, earnings: gen3Commission }
              });
            } else {
              gen3Stats.totalEarnings += gen3Commission;
              gen3Stats.generation3.earnings += gen3Commission;
              gen3Stats.generation3.count += 1;
            }
            
            await gen3Stats.save();
          }
        }
      }
    }
    
    return { success: true };
  } catch (error) {
    console.error('Error processing referral commission:', error);
    return { success: false, message: error.message };
  }
};

// Process new user registration to update referral counts (called when user registers)
const processNewUserReferral = async (userId) => {
  try {
    // Get the new user
    const newUser = await User.findById(userId);
    
    if (!newUser || !newUser.referralInfo || !newUser.referralInfo.code) {
      console.log('New user has no referrer, skipping');
      return { success: false, message: 'User has no referrer' };
    }
    
    const referrerUserName = newUser.referralInfo.code;
    console.log(`Processing new user registration for referral: ${referrerUserName}`);
    
    // Find direct referrer (Generation 1)
    const gen1Referrer = await User.findOne({ userName: referrerUserName });
    
    if (!gen1Referrer) {
      console.log(`Referrer with username ${referrerUserName} not found`);
      return { success: false, message: 'Referrer not found' };
    }
    
    // Update or create Generation 1 referrer stats
    let gen1Stats = await Referral.findOne({ user: gen1Referrer._id });
    
    if (!gen1Stats) {
      gen1Stats = new Referral({
        user: gen1Referrer._id,
        referredUsers: 1,
        totalEarnings: 0,
        generation1: { count: 1, earnings: 0 },
        generation2: { count: 0, earnings: 0 },
        generation3: { count: 0, earnings: 0 },
        referrals: [{
          userId: newUser._id,
          name: newUser.name,
          userName: newUser.userName,
          email: newUser.email,
          date: new Date(),
          status: 'active'
        }]
      });
    } else {
      gen1Stats.referredUsers += 1;
      gen1Stats.generation1.count += 1;
      
      // Add to referrals list if not already there
      const existingReferral = gen1Stats.referrals.find(ref => 
        ref.userId.toString() === newUser._id.toString()
      );
      
      if (!existingReferral) {
        gen1Stats.referrals.push({
          userId: newUser._id,
          name: newUser.name,
          userName: newUser.userName,
          email: newUser.email,
          date: new Date(),
          status: 'active'
        });
      }
    }
    
    await gen1Stats.save();
    console.log(`Updated Generation 1 referrer stats for ${gen1Referrer.userName}`);
    
    // Check for Generation 2 referrer
    if (gen1Referrer.referralInfo && gen1Referrer.referralInfo.code) {
      const gen2ReferrerUserName = gen1Referrer.referralInfo.code;
      const gen2Referrer = await User.findOne({ userName: gen2ReferrerUserName });
      
      if (gen2Referrer) {
        // Update Generation 2 stats
        let gen2Stats = await Referral.findOne({ user: gen2Referrer._id });
        
        if (!gen2Stats) {
          gen2Stats = new Referral({
            user: gen2Referrer._id,
            referredUsers: 0, // Direct referrals only
            totalEarnings: 0,
            generation1: { count: 0, earnings: 0 },
            generation2: { count: 1, earnings: 0 },
            generation3: { count: 0, earnings: 0 }
          });
        } else {
          gen2Stats.generation2.count += 1;
        }
        
        await gen2Stats.save();
        console.log(`Updated Generation 2 referrer stats for ${gen2Referrer.userName}`);
        
        // Check for Generation 3 referrer
        if (gen2Referrer.referralInfo && gen2Referrer.referralInfo.code) {
          const gen3ReferrerUserName = gen2Referrer.referralInfo.code;
          const gen3Referrer = await User.findOne({ userName: gen3ReferrerUserName });
          
          if (gen3Referrer) {
            // Update Generation 3 stats
            let gen3Stats = await Referral.findOne({ user: gen3Referrer._id });
            
            if (!gen3Stats) {
              gen3Stats = new Referral({
                user: gen3Referrer._id,
                referredUsers: 0, // Direct referrals only
                totalEarnings: 0,
                generation1: { count: 0, earnings: 0 },
                generation2: { count: 0, earnings: 0 },
                generation3: { count: 1, earnings: 0 }
              });
            } else {
              gen3Stats.generation3.count += 1;
            }
            
            await gen3Stats.save();
            console.log(`Updated Generation 3 referrer stats for ${gen3Referrer.userName}`);
          }
        }
      }
    }
    
    return { success: true };
  } catch (error) {
    console.error('Error processing new user referral:', error);
    return { success: false, message: error.message };
  }
};

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
      console.log(`Syncing referral stats for user ${user.userName}`);
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
    
    // Get current rates to check if there's a change
    const oldConfig = await SiteConfig.getCurrentConfig();
    const oldRates = oldConfig.referralCommission || {
      generation1: 0,
      generation2: 0,
      generation3: 0
    };
    
    const newRates = {
      generation1: parseFloat(gen1Commission),
      generation2: parseFloat(gen2Commission),
      generation3: parseFloat(gen3Commission)
    };
    
    // Check if rates changed
    const ratesChanged = (
      oldRates.generation1 !== newRates.generation1 ||
      oldRates.generation2 !== newRates.generation2 ||
      oldRates.generation3 !== newRates.generation3
    );
    
    // Update site config
    const siteConfig = await SiteConfig.getCurrentConfig();
    
    siteConfig.referralCommission = newRates;
    
    await siteConfig.save();
    
    // If rates changed significantly, trigger a global recalculation
    let recalcTriggered = false;
    if (ratesChanged) {
      // Start recalculation in background
      process.nextTick(async () => {
        try {
          console.log("Commission rates changed, starting global recalculation...");
          
          // Find all users with referral data
          const referrals = await Referral.find();
          console.log(`Found ${referrals.length} users with referral data to update`);
          
          for (const referral of referrals) {
            await syncReferralStats(referral.user);
          }
          
          console.log("Global recalculation completed successfully");
        } catch (error) {
          console.error("Error in global recalculation:", error);
        }
      });
      
      recalcTriggered = true;
    }
    
    res.status(200).json({
      success: true,
      message: `Referral commission rates updated successfully${recalcTriggered ? ' (Global recalculation started)' : ''}`,
      commissionRates: siteConfig.referralCommission,
      recalculationTriggered: recalcTriggered
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

// NEW: Fix wrong balances function
const fixWrongBalances = async (req, res) => {
  try {
    if (!req.user.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized: Admin access required'
      });
    }

    console.log('🔧 Starting balance fix process...');
    
    // Get all users with referral data
    const referrals = await Referral.find().populate('user', 'userName email');
    
    let fixedCount = 0;
    let errorCount = 0;
    const results = [];

    for (const referral of referrals) {
      try {
        const userId = referral.user._id;
        const userName = referral.user.userName;
        
        console.log(`Fixing balances for ${userName}...`);
        
        // Store old values
        const oldStats = {
          totalEarnings: referral.totalEarnings,
          generation1: { ...referral.generation1 },
          generation2: { ...referral.generation2 },
          generation3: { ...referral.generation3 }
        };

        // Recalculate actual earnings from transactions
        const actualEarnings = await ReferralTransaction.aggregate([
          {
            $match: {
              beneficiary: userId,
              status: 'completed'
            }
          },
          {
            $group: {
              _id: '$generation',
              totalEarnings: { $sum: '$amount' },
              transactionCount: { $sum: 1 }
            }
          }
        ]);

        // Recalculate counts (unique referred users per generation)
        const gen1Count = await ReferralTransaction.distinct('referredUser', {
          beneficiary: userId,
          generation: 1,
          status: 'completed'
        });

        const gen2Count = await ReferralTransaction.distinct('referredUser', {
          beneficiary: userId,
          generation: 2,
          status: 'completed'
        });

        const gen3Count = await ReferralTransaction.distinct('referredUser', {
          beneficiary: userId,
          generation: 3,
          status: 'completed'
        });

        // Calculate new values
        const newStats = {
          generation1: { count: gen1Count.length, earnings: 0 },
          generation2: { count: gen2Count.length, earnings: 0 },
          generation3: { count: gen3Count.length, earnings: 0 },
          totalEarnings: 0
        };

        // Map earnings by generation
        actualEarnings.forEach(earning => {
          newStats[`generation${earning._id}`].earnings = earning.totalEarnings;
          newStats.totalEarnings += earning.totalEarnings;
        });

        // Check if there are differences
        const hasChanges = (
          oldStats.totalEarnings !== newStats.totalEarnings ||
          oldStats.generation1.earnings !== newStats.generation1.earnings ||
          oldStats.generation1.count !== newStats.generation1.count ||
          oldStats.generation2.earnings !== newStats.generation2.earnings ||
          oldStats.generation2.count !== newStats.generation2.count ||
          oldStats.generation3.earnings !== newStats.generation3.earnings ||
          oldStats.generation3.count !== newStats.generation3.count
        );

        if (hasChanges) {
          // Update the referral record
          referral.totalEarnings = newStats.totalEarnings;
          referral.referredUsers = gen1Count.length; // Direct referrals only
          referral.generation1 = newStats.generation1;
          referral.generation2 = newStats.generation2;
          referral.generation3 = newStats.generation3;
          
          await referral.save();
          
          fixedCount++;
          
          results.push({
            userName,
            userId,
            status: 'fixed',
            changes: {
              totalEarnings: {
                old: oldStats.totalEarnings,
                new: newStats.totalEarnings,
                difference: newStats.totalEarnings - oldStats.totalEarnings
              },
              generation1: {
                earnings: {
                  old: oldStats.generation1.earnings,
                  new: newStats.generation1.earnings,
                  difference: newStats.generation1.earnings - oldStats.generation1.earnings
                },
                count: {
                  old: oldStats.generation1.count,
                  new: newStats.generation1.count,
                  difference: newStats.generation1.count - oldStats.generation1.count
                }
              },
              generation2: {
                earnings: {
                  old: oldStats.generation2.earnings,
                  new: newStats.generation2.earnings,
                  difference: newStats.generation2.earnings - oldStats.generation2.earnings
                },
                count: {
                  old: oldStats.generation2.count,
                  new: newStats.generation2.count,
                  difference: newStats.generation2.count - oldStats.generation2.count
                }
              },
              generation3: {
                earnings: {
                  old: oldStats.generation3.earnings,
                  new: newStats.generation3.earnings,
                  difference: newStats.generation3.earnings - oldStats.generation3.earnings
                },
                count: {
                  old: oldStats.generation3.count,
                  new: newStats.generation3.count,
                  difference: newStats.generation3.count - oldStats.generation3.count
                }
              }
            }
          });
          
          console.log(`✅ Fixed balances for ${userName}`);
        } else {
          results.push({
            userName,
            userId,
            status: 'no_changes_needed'
          });
          console.log(`✓ No changes needed for ${userName}`);
        }
        
      } catch (userError) {
        errorCount++;
        console.error(`❌ Error fixing ${referral.user.userName}:`, userError.message);
        
        results.push({
          userName: referral.user.userName,
          userId: referral.user._id,
          status: 'error',
          error: userError.message
        });
      }
    }

    console.log(`🎉 Balance fix completed: ${fixedCount} fixed, ${errorCount} errors`);

    res.status(200).json({
      success: true,
      message: `Balance fix completed: ${fixedCount} users fixed, ${errorCount} errors`,
      summary: {
        totalProcessed: referrals.length,
        fixed: fixedCount,
        noChangesNeeded: referrals.length - fixedCount - errorCount,
        errors: errorCount
      },
      results: results
    });

  } catch (error) {
    console.error('❌ Error in balance fix process:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fix balances',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// This function should be called in your user creation/registration process
const processSignup = async (req, res, next) => {
  try {
    // If this middleware runs after user creation, the user should be in req.user
    // If not, you'll need to adjust this to get the new user's ID
    if (req.user && req.user.referralInfo && req.user.referralInfo.code) {
      // Process the new user's referral
      await processNewUserReferral(req.user.id);
    }
    next(); // Continue to the next middleware
  } catch (error) {
    console.error('Error processing signup referral:', error);
    // Don't block signup if referral processing fails
    next();
  }
};

// This function should be called when a user makes a purchase
const processPurchase = async (userId, amount, purchaseType, transactionId) => {
  try {
    // Process referral commissions for this purchase
    return await processReferralCommission(userId, amount, purchaseType, transactionId);
  } catch (error) {
    console.error('Error processing purchase for referrals:', error);
    return { success: false, error: error.message };
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
  syncUserReferralData,
  fixWrongBalances, // NEW: Added fix balances function
  // Export utility functions for use in other controllers
  syncReferralStats,
  processNewUserReferral,
  processReferralCommission,
  // Export middleware for user signup
  processSignup,
  // Export function for purchase processing
  processPurchase
};