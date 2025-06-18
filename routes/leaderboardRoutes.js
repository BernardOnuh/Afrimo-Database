const express = require('express');
const router = express.Router();
const leaderboardController = require('../controller/leaderboardController');
const { protect } = require('../middleware/auth');
const { applyVisibilityRules } = require('../middleware/visibilityMiddleware');
const { restrictTo } = require('../middleware/auth'); 



router.use(applyVisibilityRules);

// // GET current settings
// router.get('/admin/visibility/settings',
//   protect,
//   restrictTo('admin'),
//   leaderboardController.getVisibilitySettings
// );

// POST/UPDATE settings
router.post('/admin/visibility/settings',
  protect,
  restrictTo('admin'),
  leaderboardController.updateVisibilitySettings
);

router.post('/admin/visibility/earnings',
  protect,
  restrictTo('admin'),
  leaderboardController.toggleEarningsVisibility
);

router.post('/admin/visibility/balance',
  protect,
  restrictTo('admin'),
  leaderboardController.toggleBalanceVisibility
);


/**
 * @swagger
 * tags:
 *   - name: Public Leaderboard
 *     description: Public leaderboard endpoints for different categories and time periods
 */

/**
 * @swagger
 * /api/leaderboard:
 *   get:
 *     summary: Get comprehensive leaderboard with filters
 *     tags: [Public Leaderboard]
 *     parameters:
 *       - in: query
 *         name: filter
 *         schema:
 *           type: string
 *           enum: [registration, referrals, spending, cofounder, earnings, shares]
 *           default: registration
 *         description: Category filter for leaderboard
 *       - in: query
 *         name: timeFrame
 *         schema:
 *           type: string
 *           enum: [daily, weekly, monthly, yearly]
 *         description: Time frame filter (optional)
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 10
 *         description: Number of results to return
 *     responses:
 *       200:
 *         description: Leaderboard data retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 filter:
 *                   type: string
 *                   example: "earnings"
 *                 timeFrame:
 *                   type: string
 *                   example: "all-time"
 *                 leaderboard:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       _id:
 *                         type: string
 *                         example: "507f1f77bcf86cd799439011"
 *                       name:
 *                         type: string
 *                         example: "John Doe"
 *                       userName:
 *                         type: string
 *                         example: "johndoe"
 *                       totalShares:
 *                         type: number
 *                         example: 150
 *                       totalCofounderShares:
 *                         type: number
 *                         example: 50
 *                       combinedShares:
 *                         type: number
 *                         example: 200
 *                       referralCount:
 *                         type: number
 *                         example: 25
 *                       totalEarnings:
 *                         type: number
 *                         example: 5000
 *                       currentBalance:
 *                         type: number
 *                         example: 3500
 *                       totalSpent:
 *                         type: number
 *                         example: 15000
 *                       createdAt:
 *                         type: string
 *                         format: date-time
 *                         example: "2024-01-15T10:30:00Z"
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: "Failed to fetch leaderboard"
 */
router.get('/', leaderboardController.getLeaderboard);

// ====================
// CATEGORY-BASED LEADERBOARD ROUTES
// ====================

/**
 * @swagger
 * /api/leaderboard/registration:
 *   get:
 *     summary: Get registration-based leaderboard (newest users first)
 *     tags: [Public Leaderboard]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 10
 *         description: Number of results to return
 *     responses:
 *       200:
 *         description: Registration leaderboard retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 filter:
 *                   type: string
 *                   example: "registration"
 *                 leaderboard:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/LeaderboardUser'
 */
router.get('/registration', leaderboardController.getRegistrationLeaderboard);

/**
 * @swagger
 * /api/leaderboard/referrals:
 *   get:
 *     summary: Get referral-based leaderboard (most referrals first)
 *     tags: [Public Leaderboard]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 10
 *         description: Number of results to return
 *     responses:
 *       200:
 *         description: Referral leaderboard retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 filter:
 *                   type: string
 *                   example: "referrals"
 *                 leaderboard:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/LeaderboardUser'
 */
router.get('/referrals', leaderboardController.getReferralLeaderboard);

/**
 * @swagger
 * /api/leaderboard/spending:
 *   get:
 *     summary: Get spending-based leaderboard (highest spenders first)
 *     tags: [Public Leaderboard]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 10
 *         description: Number of results to return
 *     responses:
 *       200:
 *         description: Spending leaderboard retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                 filter:
 *                   type: string
 *                   example: "spending"
 *                 leaderboard:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/LeaderboardUser'
 */
router.get('/spending', leaderboardController.getSpendingLeaderboard);

/**
 * @swagger
 * /api/leaderboard/cofounder:
 *   get:
 *     summary: Get cofounder shares leaderboard (most cofounder shares first)
 *     tags: [Public Leaderboard]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 10
 *         description: Number of results to return
 *     responses:
 *       200:
 *         description: Cofounder leaderboard retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 filter:
 *                   type: string
 *                   example: "cofounder"
 *                 leaderboard:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/LeaderboardUser'
 */
router.get('/cofounder', leaderboardController.getCofounderLeaderboard);

/**
 * @swagger
 * /api/leaderboard/earnings:
 *   get:
 *     summary: Get earnings-based leaderboard (highest earners first)
 *     tags: [Public Leaderboard]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 10
 *         description: Number of results to return
 *     responses:
 *       200:
 *         description: Earnings leaderboard retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 filter:
 *                   type: string
 *                   example: "earnings"
 *                 leaderboard:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/LeaderboardUser'
 */
router.get('/earnings', leaderboardController.getEarningsLeaderboard);

/**
 * @swagger
 * /api/leaderboard/shares:
 *   get:
 *     summary: Get shares-based leaderboard (most total shares first)
 *     tags: [Public Leaderboard]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 10
 *         description: Number of results to return
 *     responses:
 *       200:
 *         description: Shares leaderboard retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 filter:
 *                   type: string
 *                   example: "shares"
 *                 leaderboard:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/LeaderboardUser'
 */
router.get('/shares', leaderboardController.getSharesLeaderboard);

// ====================
// TIME-BASED LEADERBOARD ROUTES
// ====================

/**
 * @swagger
 * /api/leaderboard/daily:
 *   get:
 *     summary: Get daily leaderboard (today's activity)
 *     tags: [Public Leaderboard]
 *     parameters:
 *       - in: query
 *         name: filter
 *         schema:
 *           type: string
 *           enum: [registration, referrals, spending, cofounder, earnings, shares]
 *           default: earnings
 *         description: Category filter for daily leaderboard
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 10
 *         description: Number of results to return
 *     responses:
 *       200:
 *         description: Daily leaderboard retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 timeFrame:
 *                   type: string
 *                   example: "daily"
 *                 filter:
 *                   type: string
 *                   example: "earnings"
 *                 leaderboard:
 *                   type: array
 *                   items:
 *                     allOf:
 *                       - $ref: '#/components/schemas/LeaderboardUser'
 *                       - type: object
 *                         properties:
 *                           periodEarnings:
 *                             type: number
 *                             description: Earnings for the current day
 *                             example: 150
 */
router.get('/daily', leaderboardController.getDailyLeaderboard);

/**
 * @swagger
 * /api/leaderboard/weekly:
 *   get:
 *     summary: Get weekly leaderboard (this week's activity)
 *     tags: [Public Leaderboard]
 *     parameters:
 *       - in: query
 *         name: filter
 *         schema:
 *           type: string
 *           enum: [registration, referrals, spending, cofounder, earnings, shares]
 *           default: earnings
 *         description: Category filter for weekly leaderboard
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 10
 *         description: Number of results to return
 *     responses:
 *       200:
 *         description: Weekly leaderboard retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 timeFrame:
 *                   type: string
 *                   example: "weekly"
 *                 filter:
 *                   type: string
 *                   example: "earnings"
 *                 leaderboard:
 *                   type: array
 *                   items:
 *                     allOf:
 *                       - $ref: '#/components/schemas/LeaderboardUser'
 *                       - type: object
 *                         properties:
 *                           periodEarnings:
 *                             type: number
 *                             description: Earnings for the current week
 *                             example: 850
 */
router.get('/weekly', leaderboardController.getWeeklyLeaderboard);

/**
 * @swagger
 * /api/leaderboard/monthly:
 *   get:
 *     summary: Get monthly leaderboard (this month's activity)
 *     tags: [Public Leaderboard]
 *     parameters:
 *       - in: query
 *         name: filter
 *         schema:
 *           type: string
 *           enum: [registration, referrals, spending, cofounder, earnings, shares]
 *           default: earnings
 *         description: Category filter for monthly leaderboard
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 10
 *         description: Number of results to return
 *     responses:
 *       200:
 *         description: Monthly leaderboard retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 timeFrame:
 *                   type: string
 *                   example: "monthly"
 *                 filter:
 *                   type: string
 *                   example: "earnings"
 *                 leaderboard:
 *                   type: array
 *                   items:
 *                     allOf:
 *                       - $ref: '#/components/schemas/LeaderboardUser'
 *                       - type: object
 *                         properties:
 *                           periodEarnings:
 *                             type: number
 *                             description: Earnings for the current month
 *                             example: 3200
 */
router.get('/monthly', leaderboardController.getMonthlyLeaderboard);

/**
 * @swagger
 * /api/leaderboard/yearly:
 *   get:
 *     summary: Get yearly leaderboard (this year's activity)
 *     tags: [Public Leaderboard]
 *     parameters:
 *       - in: query
 *         name: filter
 *         schema:
 *           type: string
 *           enum: [registration, referrals, spending, cofounder, earnings, shares]
 *           default: earnings
 *         description: Category filter for yearly leaderboard
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 10
 *         description: Number of results to return
 *     responses:
 *       200:
 *         description: Yearly leaderboard retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 timeFrame:
 *                   type: string
 *                   example: "yearly"
 *                 filter:
 *                   type: string
 *                   example: "earnings"
 *                 leaderboard:
 *                   type: array
 *                   items:
 *                     allOf:
 *                       - $ref: '#/components/schemas/LeaderboardUser'
 *                       - type: object
 *                         properties:
 *                           periodEarnings:
 *                             type: number
 *                             description: Earnings for the current year
 *                             example: 25000
 */
router.get('/yearly', leaderboardController.getYearlyLeaderboard);

// ====================
// NEW FILTER ROUTES (FIXED)
// ====================

// Filter by earnings
router.get('/filter/earnings', async (req, res) => {
  try {
    const filters = {
      minEarnings: req.query.minEarnings ? Number(req.query.minEarnings) : 0,
      maxEarnings: req.query.maxEarnings ? Number(req.query.maxEarnings) : null,
      limit: req.query.limit ? Number(req.query.limit) : Number.MAX_SAFE_INTEGER,
      offset: req.query.offset ? Number(req.query.offset) : 0,
      period: req.query.period || 'all_time',
      sortOrder: req.query.sortOrder || 'desc'
    };

    const result = await leaderboardController.getLeaderboardByEarnings(filters);

    res.json({
      success: true,
      data: result.users,
      pagination: {
        currentPage: result.currentPage,
        totalPages: result.totalPages,
        totalItems: result.total,
        hasNext: result.currentPage < result.totalPages,
        hasPrev: result.currentPage > 1,
        limit: filters.limit
      },
      filters
    });

  } catch (error) {
    console.error('Error fetching earnings leaderboard:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch earnings leaderboard',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Filter by available balance
router.get('/filter/balance', async (req, res) => {
  try {
    const filters = {
      minBalance: req.query.minBalance ? Number(req.query.minBalance) : 0,
      maxBalance: req.query.maxBalance ? Number(req.query.maxBalance) : null,
      limit: req.query.limit ? Number(req.query.limit) : Number.MAX_SAFE_INTEGER,
      offset: req.query.offset ? Number(req.query.offset) : 0,
      period: req.query.period || 'all_time',
      sortOrder: req.query.sortOrder || 'desc'
    };

    const result = await leaderboardController.getLeaderboardByBalance(filters);

    res.json({
      success: true,
      data: result.users,
      pagination: {
        currentPage: result.currentPage,
        totalPages: result.totalPages,
        totalItems: result.total,
        hasNext: result.currentPage < result.totalPages,
        hasPrev: result.currentPage > 1,
        limit: filters.limit
      },
      filters
    });

  } catch (error) {
    console.error('Error fetching balance leaderboard:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch balance leaderboard',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Filter by location (state/city)
// Filter by state
router.get('/filter/state', async (req, res) => {
  try {
    const filters = {
      state: req.query.state,
      limit: req.query.limit ? Number(req.query.limit) : Number.MAX_SAFE_INTEGER,
      offset: req.query.offset ? Number(req.query.offset) : 0,
      sortBy: req.query.sortBy || 'totalEarnings',
      sortOrder: req.query.sortOrder || 'desc',
      period: req.query.period || 'all_time'
    };

    if (!filters.state) {
      return res.status(400).json({
        success: false,
        message: 'State parameter is required'
      });
    }

    const result = await leaderboardController.getLeaderboardByLocation(filters);

    res.json({
      success: true,
      data: result.users,
      pagination: {
        currentPage: result.currentPage,
        totalPages: result.totalPages,
        totalItems: result.total,
        hasNext: result.currentPage < result.totalPages,
        hasPrev: result.currentPage > 1,
        limit: filters.limit
      },
      locationStats: result.locationStats,
      filters
    });

  } catch (error) {
    console.error('Error fetching state leaderboard:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch state leaderboard',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Filter by city
router.get('/filter/city', async (req, res) => {
  try {
    const filters = {
      city: req.query.city,
      state: req.query.state, // Optional: can filter by city within a specific state
      limit: req.query.limit ? Number(req.query.limit) : Number.MAX_SAFE_INTEGER,
      offset: req.query.offset ? Number(req.query.offset) : 0,
      sortBy: req.query.sortBy || 'totalEarnings',
      sortOrder: req.query.sortOrder || 'desc',
      period: req.query.period || 'all_time'
    };

    if (!filters.city) {
      return res.status(400).json({
        success: false,
        message: 'City parameter is required'
      });
    }

    const result = await leaderboardController.getLeaderboardByLocation(filters);

    res.json({
      success: true,
      data: result.users,
      pagination: {
        currentPage: result.currentPage,
        totalPages: result.totalPages,
        totalItems: result.total,
        hasNext: result.currentPage < result.totalPages,
        hasPrev: result.currentPage > 1,
        limit: filters.limit
      },
      locationStats: result.locationStats,
      filters
    });

  } catch (error) {
    console.error('Error fetching city leaderboard:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch city leaderboard',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Filter by user status
router.get('/filter/status', async (req, res) => {
  try {
    const filters = {
      status: req.query.status || 'active',
      limit: req.query.limit ? Number(req.query.limit) : Number.MAX_SAFE_INTEGER,
      offset: req.query.offset ? Number(req.query.offset) : 0,
      sortBy: req.query.sortBy || 'totalEarnings',
      sortOrder: req.query.sortOrder || 'desc',
      period: req.query.period || 'all_time'
    };

    const result = await leaderboardController.getLeaderboardByStatus(filters);

    res.json({
      success: true,
      data: result.users,
      pagination: {
        currentPage: result.currentPage,
        totalPages: result.totalPages,
        totalItems: result.total,
        hasNext: result.currentPage < result.totalPages,
        hasPrev: result.currentPage > 1,
        limit: filters.limit
      },
      statusStats: result.statusStats,
      filters
    });

  } catch (error) {
    console.error('Error fetching status leaderboard:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch status leaderboard',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Filter by number of shares
router.get('/filter/shares', async (req, res) => {
  try {
    const filters = {
      minShares: req.query.minShares ? Number(req.query.minShares) : 0,
      maxShares: req.query.maxShares ? Number(req.query.maxShares) : null,
      shareType: req.query.shareType || 'all',
      limit: req.query.limit ? Number(req.query.limit) : Number.MAX_SAFE_INTEGER,
      offset: req.query.offset ? Number(req.query.offset) : 0,
      period: req.query.period || 'all_time',
      sortOrder: req.query.sortOrder || 'desc'
    };

    // Call the getLeaderboardByShares function directly since it's not exported
    const User = require('../models/User');
    
    // Build shares filter
    const sharesFilter = { $gte: filters.minShares };
    if (filters.maxShares !== null) {
      sharesFilter.$lte = filters.maxShares;
    }

    // Build date filter
    let dateFilter = {};
    if (filters.period !== 'all_time') {
      const now = new Date();
      let startDate = new Date();
      
      switch (filters.period) {
        case 'daily':
          startDate.setHours(0, 0, 0, 0);
          break;
        case 'weekly':
          startDate.setDate(now.getDate() - now.getDay());
          startDate.setHours(0, 0, 0, 0);
          break;
        case 'monthly':
          startDate.setDate(1);
          startDate.setHours(0, 0, 0, 0);
          break;
        case 'yearly':
          startDate.setMonth(0, 1);
          startDate.setHours(0, 0, 0, 0);
          break;
      }
      dateFilter.createdAt = { $gte: startDate };
    }

    const pipeline = [
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
        $addFields: {
          regularShares: { $sum: '$shares.totalShares' },
          cofounderSharesTotal: { $sum: '$cofounderShares.totalShares' },
          combinedShares: { 
            $add: [
              { $sum: '$shares.totalShares' }, 
              { $sum: '$cofounderShares.totalShares' }
            ]
          },
          referralInfo: {
            $cond: {
              if: { $gt: [{ $size: "$referralData" }, 0] },
              then: { $arrayElemAt: ["$referralData", 0] },
              else: { totalEarnings: 0 }
            }
          }
        }
      },
      {
        $addFields: {
          filterShareCount: {
            $cond: {
              if: { $eq: [filters.shareType, 'regular'] },
              then: '$regularShares',
              else: {
                $cond: {
                  if: { $eq: [filters.shareType, 'cofounder'] },
                  then: '$cofounderSharesTotal',
                  else: '$combinedShares'
                }
              }
            }
          },
          totalEarnings: { $ifNull: ["$referralInfo.totalEarnings", 0] }
        }
      },
      {
        $match: {
          'status.isActive': true,
          isBanned: { $ne: true },
          filterShareCount: sharesFilter,
          ...dateFilter
        }
      },
      {
        $sort: { 
          filterShareCount: filters.sortOrder === 'desc' ? -1 : 1,
          totalEarnings: -1
        }
      },
      {
        $facet: {
          data: [
            { $skip: filters.offset },
            { $limit: filters.limit },
            {
              $project: {
                _id: 1,
                name: 1,
                userName: 1,
                regularShares: 1,
                cofounderSharesTotal: 1,
                combinedShares: 1,
                totalEarnings: 1,
                'location.state': 1,
                'location.city': 1,
                'status.isActive': 1,
                createdAt: 1,
                shareBreakdown: {
                  regular: '$regularShares',
                  cofounder: '$cofounderSharesTotal',
                  total: '$combinedShares'
                },
                filteredShares: '$filterShareCount'
              }
            }
          ],
          totalCount: [{ $count: "count" }],
          stats: [
            {
              $group: {
                _id: null,
                totalShares: { $sum: '$filterShareCount' },
                averageShares: { $avg: '$filterShareCount' },
                maxShares: { $max: '$filterShareCount' },
                minShares: { $min: '$filterShareCount' },
                totalUsers: { $sum: 1 },
                totalEarnings: { $sum: '$totalEarnings' },
                averageEarnings: { $avg: '$totalEarnings' }
              }
            }
          ]
        }
      }
    ];

    const result = await User.aggregate(pipeline);
    const users = result[0].data;
    const totalCount = result[0].totalCount[0]?.count || 0;
    const stats = result[0].stats[0] || {};

    const finalResult = {
      users: users.map((user, index) => ({
        ...user,
        rank: filters.offset + index + 1
      })),
      total: totalCount,
      totalPages: Math.ceil(totalCount / filters.limit),
      currentPage: Math.floor(filters.offset / filters.limit) + 1,
      shareType: filters.shareType,
      statistics: {
        totalShares: stats.totalShares || 0,
        averageShares: Math.round((stats.averageShares || 0) * 100) / 100,
        maxShares: stats.maxShares || 0,
        minShares: stats.minShares || 0,
        totalUsers: stats.totalUsers || 0,
        totalEarnings: Math.round((stats.totalEarnings || 0) * 100) / 100,
        averageEarnings: Math.round((stats.averageEarnings || 0) * 100) / 100
      }
    };

    res.json({
      success: true,
      data: finalResult.users,
      pagination: {
        currentPage: finalResult.currentPage,
        totalPages: finalResult.totalPages,
        totalItems: finalResult.total,
        hasNext: finalResult.currentPage < finalResult.totalPages,
        hasPrev: finalResult.currentPage > 1,
        limit: filters.limit
      },
      statistics: finalResult.statistics,
      shareType: finalResult.shareType,
      filters
    });

  } catch (error) {
    console.error('Error fetching shares leaderboard:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch shares leaderboard',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * @swagger
 * components:
 *   schemas:
 *     LeaderboardUser:
 *       type: object
 *       properties:
 *         _id:
 *           type: string
 *           description: User's unique identifier
 *           example: "507f1f77bcf86cd799439011"
 *         name:
 *           type: string
 *           description: User's full name
 *           example: "John Doe"
 *         userName:
 *           type: string
 *           description: User's username
 *           example: "johndoe"
 *         totalShares:
 *           type: number
 *           description: Total number of regular shares owned
 *           example: 150
 *         totalCofounderShares:
 *           type: number
 *           description: Total number of cofounder shares owned
 *           example: 50
 *         combinedShares:
 *           type: number
 *           description: Total of all shares (regular + cofounder)
 *           example: 200
 *         referralCount:
 *           type: number
 *           description: Number of users referred
 *           example: 25
 *         totalEarnings:
 *           type: number
 *           description: Total earnings from all sources
 *           example: 5000
 *         currentBalance:
 *           type: number
 *           description: Current available balance (earnings minus withdrawals)
 *           example: 3500
 *         withdrawalAmount:
 *           type: number
 *           description: Total amount withdrawn
 *           example: 1500
 *         pendingWithdrawalsAmount:
 *           type: number
 *           description: Total amount in pending withdrawals
 *           example: 0
 *         processingWithdrawalsAmount:
 *           type: number
 *           description: Total amount in processing withdrawals
 *           example: 0
 *         totalSpent:
 *           type: number
 *           description: Total amount spent on shares
 *           example: 15000
 *         createdAt:
 *           type: string
 *           format: date-time
 *           description: Account creation date
 *           example: "2024-01-15T10:30:00Z"
 */




module.exports = router;